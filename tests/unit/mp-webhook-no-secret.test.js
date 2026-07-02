/* Frente D — el webhook de Mercado Pago funciona SIN MERCADOPAGO_WEBHOOK_SECRET.
 *
 * Checkout Pro no siempre permite generar el secreto del webhook en el panel, así
 * que mercadopago-webhook ya no rechaza cuando falta. En su lugar la FUENTE DE
 * VERDAD es la API de Mercado Pago: el webhook trae un payment id, se hace
 * GET /v1/payments/{id} con nuestro access token, y SOLO se procesa la reserva si
 * la API responde status='approved' con el monto esperado. Un webhook falso no
 * puede falsificar esa respuesta (no tiene el access token), así que no puede
 * crear reservas.
 *
 *   1. aprobado + monto ok (sin secreto) → procesa la reserva.
 *   2. status distinto de 'approved' → NO procesa.
 *   3. monto distinto → NO crea la reserva (verificación server-side dentro de
 *      processApprovedPayment vía la referencia directa codificada).
 *   4. con el secreto presente → sigue validando la firma HMAC (defensa en
 *      profundidad) y rechaza una firma inválida.
 *
 * fetch, env y las dependencias de procesamiento se inyectan: sin red, sin
 * Blobs reales, sin credenciales, sin tocar OTASync.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const mpWebhook = require('../../netlify/functions/mercadopago-webhook');
const { createDirectReference } = require('../../netlify/functions/_payments');

const { handleWebhook, verifyMercadoPagoSignature } = mpWebhook._test;

/* Fake del fetch a la API de MP: devuelve el payment que le pasemos. */
function fakeFetch(paymentJson, capture) {
  return async (url, opts) => {
    if (capture) { capture.url = url; capture.opts = opts; }
    return { ok: paymentJson.__httpOk !== false, status: paymentJson.__httpStatus || 200, json: async () => paymentJson };
  };
}

/* Referencia directa codificada con un monto esperado, igual que la que arma el
   motor para una reserva directa pagada por Mercado Pago. */
const EXPECTED_CENTS = 30000000; // $300.000 COP
const DIRECT_REF = createDirectReference({
  checkin: '2026-07-01', checkout: '2026-07-03', guestsCount: 2, roomTypeId: '31348',
  firstName: 'Ana', lastName: 'Pérez', email: 'ana@example.com', phone: '+57 300 0000000',
  extrasMask: '0000000', bookingCode: 'EST-TESTMP', isColombian: false, isBusiness: false,
  amountCents: EXPECTED_CENTS
});

/* Respuesta de la API de MP para un pago aprobado con el monto esperado. */
function apiApproved(overrides = {}) {
  return {
    id: 'MP-PAY-100',
    status: 'approved',
    transaction_amount: EXPECTED_CENTS / 100, // pesos → la API responde en pesos
    currency_id: 'COP',
    external_reference: DIRECT_REF,
    payment_method_id: 'visa',
    payment_type_id: 'credit_card',
    ...overrides
  };
}

const baseEvent = (overrides = {}) => ({
  httpMethod: 'POST',
  headers: {},
  body: JSON.stringify({ type: 'payment', data: { id: 'MP-PAY-100' } }),
  ...overrides
});

/* ── 1. aprobado + monto ok, SIN secreto → procesa ──────────────────── */

test('without a webhook secret: approved + matching amount processes the reservation (API is the source of truth)', async () => {
  let processedTx = null;
  const cap = {};
  const res = await handleWebhook(baseEvent(), {
    // Sin MERCADOPAGO_WEBHOOK_SECRET (Checkout Pro no lo da); el access token sí
    // existe y es lo que autentica la consulta a la API (fuente de verdad).
    env: { MERCADOPAGO_ACCESS_TOKEN: 'TEST-TOKEN' },
    fetchImpl: fakeFetch(apiApproved(), cap),
    processApprovedPayment: async (tx, h) => { processedTx = tx; return { statusCode: 200, headers: h, body: JSON.stringify({ success: true }) }; }
  });

  assert.equal(res.statusCode, 200);
  const out = JSON.parse(res.body);
  assert.equal(out.success, true);
  assert.ok(processedTx, 'processApprovedPayment debe llamarse');
  assert.equal(processedTx.status, 'approved');
  assert.equal(processedTx.amountCents, EXPECTED_CENTS);
  assert.equal(processedTx.reference, DIRECT_REF);
  // Se consultó la API con el id del webhook y nuestro access token.
  assert.match(cap.url, /\/v1\/payments\/MP-PAY-100$/);
  assert.equal(cap.opts.headers.Authorization, 'Bearer TEST-TOKEN');
});

/* ── 2. status distinto de approved → NO procesa ────────────────────── */

test('a status other than approved never creates a reservation (even though the webhook posted it)', async () => {
  let processed = false;
  const res = await handleWebhook(baseEvent(), {
    env: { MERCADOPAGO_ACCESS_TOKEN: 'TEST-TOKEN' },
    fetchImpl: fakeFetch(apiApproved({ status: 'pending' })),
    processApprovedPayment: async () => { processed = true; return { statusCode: 200, headers: {}, body: '{}' }; },
    notifyGuestPaymentOutcome: async () => {} // silencia el correo de "en proceso"
  });
  const out = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(processed, false, 'pending no debe crear reserva');
  assert.match(out.message, /Skipping reservation/i);
});

test('a rejected payment from the API never creates a reservation', async () => {
  let processed = false;
  const res = await handleWebhook(baseEvent(), {
    env: { MERCADOPAGO_ACCESS_TOKEN: 'TEST-TOKEN' },
    fetchImpl: fakeFetch(apiApproved({ status: 'rejected' })),
    processApprovedPayment: async () => { processed = true; return { statusCode: 200, headers: {}, body: '{}' }; },
    notifyGuestPaymentOutcome: async () => {}
  });
  const out = JSON.parse(res.body);
  assert.equal(processed, false);
  assert.match(out.message, /Logged for manual follow-up/i);
});

/* Un webhook falso que MIENTE diciendo approved no sirve: la API es la verdad.
   El atacante no controla la respuesta de la API (no tiene el access token). */
test('a forged webhook claiming approved is ignored when the API says the payment is not approved', async () => {
  let processed = false;
  // El cuerpo del webhook dice approved, pero la API (fuente de verdad) dice rejected.
  const res = await handleWebhook(baseEvent({
    body: JSON.stringify({ type: 'payment', data: { id: 'MP-PAY-100' }, status: 'approved' })
  }), {
    env: { MERCADOPAGO_ACCESS_TOKEN: 'TEST-TOKEN' },
    fetchImpl: fakeFetch(apiApproved({ status: 'rejected' })),
    processApprovedPayment: async () => { processed = true; return { statusCode: 200, headers: {}, body: '{}' }; },
    notifyGuestPaymentOutcome: async () => {}
  });
  assert.equal(processed, false, 'lo que diga el webhook no importa; solo la API');
});

/* ── 3. monto distinto → NO crea reserva (verificación server-side) ──── */

test('amount mismatch does not create a reservation (server-side amount check against the encoded reference)', async () => {
  /* Aquí NO inyectamos processApprovedPayment: usamos el real para verificar que
     el chequeo de monto server-side (decoded.amountCents vs paid) rechaza.
     processApprovedPayment usa la dedup en memoria (alreadyProcessed) que no
     toca Blobs en tests, y processDirectPayment retorna antes de llegar a
     OTASync por el mismatch. */
  const res = await handleWebhook(baseEvent(), {
    env: { MERCADOPAGO_ACCESS_TOKEN: 'TEST-TOKEN' },
    // La API dice approved pero por un monto mucho menor que el esperado.
    fetchImpl: fakeFetch(apiApproved({ id: 'MP-PAY-MISMATCH', transaction_amount: 100 }))
  });
  const out = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.match(out.message, /mismatch/i, 'el monto que no coincide debe registrarse como mismatch, no crear reserva');
  assert.ok(!out.success, 'no debe reportar éxito de reserva');
});

/* ── 4. con secreto presente → sigue validando la firma HMAC ─────────── */

test('with the secret configured: a valid signature still passes (defense in depth)', () => {
  const secret = 'WHSEC';
  const paymentId = 'MP-PAY-100';
  const ts = '1700000000';
  const requestId = 'req-abc';
  const manifest = `id:${paymentId};request-id:${requestId};ts:${ts};`;
  const v1 = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  const sig = verifyMercadoPagoSignature(
    { headers: { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId } },
    paymentId,
    { MERCADOPAGO_WEBHOOK_SECRET: secret }
  );
  assert.equal(sig.ok, true);
  assert.equal(sig.verified, true);
});

test('with the secret configured: an invalid signature is rejected with 401 (does not fall through to the API)', async () => {
  let fetched = false;
  let processed = false;
  const res = await handleWebhook(
    baseEvent({ headers: { 'x-signature': 'ts=1700000000,v1=deadbeef', 'x-request-id': 'req-abc' } }),
    {
      env: { MERCADOPAGO_WEBHOOK_SECRET: 'WHSEC', MERCADOPAGO_ACCESS_TOKEN: 'TEST-TOKEN' },
      fetchImpl: async () => { fetched = true; return { ok: true, status: 200, json: async () => apiApproved() }; },
      processApprovedPayment: async () => { processed = true; return { statusCode: 200, headers: {}, body: '{}' }; }
    }
  );
  assert.equal(res.statusCode, 401);
  assert.equal(fetched, false, 'firma inválida no debe siquiera llamar a la API');
  assert.equal(processed, false);
});

test('with the secret configured: missing signature headers are rejected with 401', async () => {
  const res = await handleWebhook(baseEvent({ headers: {} }), {
    env: { MERCADOPAGO_WEBHOOK_SECRET: 'WHSEC', MERCADOPAGO_ACCESS_TOKEN: 'TEST-TOKEN' },
    fetchImpl: async () => { throw new Error('should not fetch'); },
    processApprovedPayment: async () => { throw new Error('should not process'); }
  });
  assert.equal(res.statusCode, 401);
});

test('with a valid signature AND matching amount: the reservation is processed (both gates pass)', async () => {
  const secret = 'WHSEC';
  const paymentId = 'MP-PAY-100';
  const ts = '1700000000';
  const requestId = 'req-abc';
  const manifest = `id:${paymentId};request-id:${requestId};ts:${ts};`;
  const v1 = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  let processedTx = null;
  const res = await handleWebhook(
    baseEvent({ headers: { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId } }),
    {
      env: { MERCADOPAGO_WEBHOOK_SECRET: secret, MERCADOPAGO_ACCESS_TOKEN: 'TEST-TOKEN' },
      fetchImpl: fakeFetch(apiApproved()),
      processApprovedPayment: async (tx, h) => { processedTx = tx; return { statusCode: 200, headers: h, body: JSON.stringify({ success: true }) }; }
    }
  );
  assert.equal(res.statusCode, 200);
  assert.ok(processedTx);
  assert.equal(processedTx.status, 'approved');
});

/* ── extras: robustez del handler ───────────────────────────────────── */

test('a non-COP currency from the API is not processed', async () => {
  let processed = false;
  const res = await handleWebhook(baseEvent(), {
    env: { MERCADOPAGO_ACCESS_TOKEN: 'TEST-TOKEN' },
    fetchImpl: fakeFetch(apiApproved({ currency_id: 'USD' })),
    processApprovedPayment: async () => { processed = true; return { statusCode: 200, headers: {}, body: '{}' }; }
  });
  const out = JSON.parse(res.body);
  assert.equal(processed, false);
  assert.match(out.message, /Invalid currency/i);
});

test('a missing payment id is rejected before any API call', async () => {
  let fetched = false;
  const res = await handleWebhook(baseEvent({ body: JSON.stringify({ type: 'payment', data: {} }) }), {
    env: {},
    fetchImpl: async () => { fetched = true; return { ok: true, status: 200, json: async () => ({}) }; },
    processApprovedPayment: async () => ({ statusCode: 200, headers: {}, body: '{}' })
  });
  assert.equal(res.statusCode, 400);
  assert.equal(fetched, false);
});

test('an API lookup failure returns 502 (so MP retries) and never processes', async () => {
  let processed = false;
  const res = await handleWebhook(baseEvent(), {
    env: { MERCADOPAGO_ACCESS_TOKEN: 'TEST-TOKEN' },
    fetchImpl: async () => { throw new Error('network down'); },
    processApprovedPayment: async () => { processed = true; return { statusCode: 200, headers: {}, body: '{}' }; }
  });
  assert.equal(res.statusCode, 502);
  assert.equal(processed, false);
});
