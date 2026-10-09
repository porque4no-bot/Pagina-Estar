/* Frente "Mercado Pago igual de sólido que Wompi" (2/2): webhook (solo avisos de
 * pago), preferencia (source_news, back_urls en inglés, descuento, datos
 * laterales), cotizaciones y la ruta legacy. Sin red ni Blobs reales. */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createDirectReference, decodeDirectReference } = require('../../netlify/functions/_payments');

function memBlobs(seed = {}) {
  const buckets = new Map();
  const bucket = (n) => { if (!buckets.has(n)) buckets.set(n, new Map()); return buckets.get(n); };
  for (const [n, e] of Object.entries(seed)) {
    const b = bucket(n);
    for (const [k, v] of Object.entries(e)) b.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  const getStore = (name) => {
    const b = bucket(typeof name === 'string' ? name : name.name);
    return {
      async get(k) { return b.has(k) ? b.get(k) : null; },
      async set(k, v) { b.set(k, v); return { modified: true }; },
      async delete(k) { b.delete(k); }
    };
  };
  const read = (n, k) => { const b = buckets.get(n); return b && b.has(k) ? JSON.parse(b.get(k)) : null; };
  return { getStore, read };
}

let seq = 0;
const nextTx = () => `MPW-${Date.now()}-${++seq}`;
const H = { 'Content-Type': 'application/json' };

function makeDeps({ blobs = memBlobs(), lock = { acquired: true }, resilient = 'true' } = {}) {
  const calls = { insert: 0, legacy: 0, alerts: [] };
  return {
    calls,
    deps: {
      getStore: blobs.getStore,
      hasOtasyncCreds: () => true,
      getAvailabilityByType: async () => ({ availByType: { '31348': 2 }, isMock: false }),
      insertReservation: async () => { calls.insert++; return { id_reservations: 1 }; },
      legacyInsert: async () => { calls.legacy++; return { id_reservations: 2 }; },
      acquireQuoteLock: async () => lock,
      releaseQuoteLock: async () => {},
      otasyncCreds: () => ({ token: 't', propertyId: '9889' }),
      getSessionKey: async () => 'k',
      findReservationByReference: async () => null,
      verifyDirectBookingAmount: async () => ({ ok: true, matchedPlan: 'best' }),
      sendConfirmationEmail: async () => ({ sent: true }),
      savePaymentDetails: async () => ({ saved: true }),
      consumeDiscountUse: async () => ({ ok: true }),
      upsertPartner: async () => ({}),
      addToMailingList: async () => ({}),
      reportAlert: async (a) => { calls.alerts.push(a); return {}; },
      settingsGet: async (k, fb) => (k === 'MP_DIRECT_RESILIENT_ENABLED' ? resilient : fb),
      flag: async () => false,
      trackPurchase: async () => {}
    }
  };
}

function mpTx(ref, id, amountCents) {
  return { id, provider: 'mercadopago', status: 'approved', currency: 'COP', reference: ref, amountCents, amount: amountCents / 100, paymentMethod: 'visa', approved: true };
}

/* ── ruta legacy ('false'): tampoco duplica ─────────────────────────────── */

test('ruta legacy (false) también se niega a duplicar si booking-results ya está confirmado', async () => {
  const payments = require('../../netlify/functions/_payments');
  const txId = nextTx();
  const ref = createDirectReference({ checkin: '2026-11-10', checkout: '2026-11-12', guestsCount: 1, roomTypeId: '31348', firstName: 'A', lastName: 'B', email: 'a@x.co', phone: '300', extrasMask: '0000000', bookingCode: 'EST-LEG2', amountCents: 30000000 });
  const blobs = memBlobs({ 'booking-results': { 'direct-EST-LEG2': { bookingCode: 3300400, transactionId: txId } } });
  const { deps, calls } = makeDeps({ blobs, resilient: 'false' });
  const res = await payments.processApprovedPayment(mpTx(ref, txId, 30000000), H, deps);
  assert.equal(JSON.parse(res.body).duplicate, true);
  assert.equal(calls.legacy, 0);
});

/* ── cotizaciones MP: alertas de dinero por reportAlert ─────────────────── */

test('cotización MP: monto incorrecto y doble pago alertan vía reportAlert (correo + tarea)', async () => {
  const R = (m) => require.resolve('../../netlify/functions/' + m);
  const quote = { quoteId: 'COT-2026-ABCDE', status: 'enviada', empresa: 'ACME', items: [], checkin: '2026-11-10', checkout: '2026-11-12' };
  require.cache[R('_quotes-store')] = {
    id: R('_quotes-store'), filename: R('_quotes-store'), loaded: true,
    exports: {
      getQuoteStore: () => ({}), loadQuote: async () => ({ ...quote }), saveQuote: async () => {},
      effectiveStatus: (q) => q.status, computeQuoteTotal: () => ({ totalCents: 50000000 })
    }
  };
  delete require.cache[R('_payments')];
  const fresh = require('../../netlify/functions/_payments');
  try {
    const a = makeDeps({});
    const tx1 = nextTx();
    await fresh.processApprovedPayment(mpTx('COT-2026-ABCDE', tx1, 100), H, a.deps);
    assert.equal(a.calls.alerts.length, 1);
    assert.equal(a.calls.alerts[0].kind, 'payment_amount_mismatch');
    assert.equal(a.calls.alerts[0].severity, 'critical');
    assert.equal(a.calls.alerts[0].dedupeKey, `pay-amount-${tx1}`);

    const b = makeDeps({ lock: { acquired: false, ownerTx: 'MP-FIRST' } });
    await fresh.processApprovedPayment(mpTx('COT-2026-ABCDE', nextTx(), 50000000), H, b.deps);
    assert.equal(b.calls.alerts.length, 1);
    assert.equal(b.calls.alerts[0].kind, 'payment_double_charge');

    const c = makeDeps({ lock: { acquired: false, ownerTx: 'MP-SAMEQ' } });
    await fresh.processApprovedPayment(mpTx('COT-2026-ABCDE', 'MP-SAMEQ', 50000000), H, c.deps);
    assert.equal(c.calls.alerts.length, 0, 're-entrega del mismo tx con el lock tomado: sin alerta');

    /* Revisión final: cotización YA aceptada por otro pago + nuevo pago aprobado
       = doble cobro (antes: duplicado silencioso y reconcile lo saltaba). */
    quote.status = 'aceptada';
    quote.transactionId = 'MP-PAID-1';
    const d = makeDeps({});
    const tx4 = nextTx();
    const r4 = await fresh.processApprovedPayment(mpTx('COT-2026-ABCDE', tx4, 50000000), H, d.deps);
    assert.equal(JSON.parse(r4.body).duplicate, true);
    assert.equal(d.calls.alerts.length, 1);
    assert.equal(d.calls.alerts[0].kind, 'payment_double_charge');
    assert.equal(d.calls.alerts[0].dedupeKey, `pay-double-${tx4}`);

    const e = makeDeps({});
    await fresh.processApprovedPayment(mpTx('COT-2026-ABCDE', 'MP-PAID-1', 50000000), H, e.deps);
    assert.equal(e.calls.alerts.length, 0, 're-entrega del pago que la aceptó: sin alerta');
  } finally {
    delete require.cache[R('_quotes-store')];
    delete require.cache[R('_payments')];
  }
});

/* ── webhook: solo avisos de PAGO; merchant_order y 404 → 200 ───────────── */

const mpWebhook = require('../../netlify/functions/mercadopago-webhook');
const { handleWebhook, classifyNotification } = mpWebhook._test;

test('classifyNotification: IPN merchant_order se ignora; webhook/IPN de pago se procesan con el id correcto', () => {
  assert.deepEqual(
    classifyNotification({ queryStringParameters: { topic: 'merchant_order', id: '777' } }, {}),
    { kind: 'ignore', topic: 'merchant_order' }
  );
  const ipnPay = classifyNotification({ queryStringParameters: { topic: 'payment', id: '555' } }, {});
  assert.equal(ipnPay.kind, 'payment');
  assert.equal(ipnPay.id, '555');
  const wh = classifyNotification({ queryStringParameters: { 'data.id': '999', type: 'payment' } },
    { id: 12345, type: 'payment', action: 'payment.updated', data: { id: '999' } });
  assert.equal(wh.kind, 'payment');
  assert.equal(wh.id, '999', 'el id del PAGO (data.id), no el id de la notificación');
  assert.equal(classifyNotification({ queryStringParameters: {} }, { action: 'merchant_order.updated', data: { id: '1' } }).kind, 'ignore');
  assert.equal(classifyNotification({ queryStringParameters: {} }, { type: 'topic_chargebacks_wh', data: { id: '1' } }).kind, 'ignore');
  const ipnBody = classifyNotification({ queryStringParameters: {} }, { resource: 'https://api.mercadolibre.com/collections/notifications/4321', topic: 'payment' });
  assert.equal(ipnBody.id, '4321');
  assert.equal(classifyNotification({ queryStringParameters: {} }, { data: { id: '42' } }).kind, 'payment', 'formato viejo sin topic = pago');
});

test('webhook: aviso merchant_order → 200 sin consultar la API (antes 502 + reintentos sin fin)', async () => {
  let fetched = false;
  const res = await handleWebhook({
    httpMethod: 'POST', headers: {}, queryStringParameters: { topic: 'merchant_order', id: '28374928' },
    body: JSON.stringify({ resource: 'https://api.mercadolibre.com/merchant_orders/28374928', topic: 'merchant_order' })
  }, {
    env: { MERCADOPAGO_ACCESS_TOKEN: 'TEST' },
    fetchImpl: async () => { fetched = true; throw new Error('no debe consultar'); },
    processApprovedPayment: async () => { throw new Error('no debe procesar'); }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).ignored, 'merchant_order');
  assert.equal(fetched, false);
});

test('webhook: un id de pago que la API no encuentra (404) → 200 ignorado, no 502', async () => {
  const res = await handleWebhook({
    httpMethod: 'POST', headers: {}, queryStringParameters: { 'data.id': '123', type: 'payment' },
    body: JSON.stringify({ type: 'payment', data: { id: '123' } })
  }, {
    env: { MERCADOPAGO_ACCESS_TOKEN: 'TEST' },
    fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({ message: 'Payment not found' }) }),
    processApprovedPayment: async () => { throw new Error('no debe procesar'); }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).ignored, 'payment_not_found');
});

test('webhook: una caída de la API (500) sigue respondiendo 502 para que MP reintente', async () => {
  const res = await handleWebhook({
    httpMethod: 'POST', headers: {}, queryStringParameters: { 'data.id': '123', type: 'payment' },
    body: JSON.stringify({ type: 'payment', data: { id: '123' } })
  }, {
    env: { MERCADOPAGO_ACCESS_TOKEN: 'TEST' },
    fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }),
    processApprovedPayment: async () => { throw new Error('no debe procesar'); }
  });
  assert.equal(res.statusCode, 502);
});

test('webhook: IPN topic=payment consulta la API con ese id y procesa', async () => {
  const cap = {};
  let processed = null;
  const res = await handleWebhook({
    httpMethod: 'POST', headers: {}, queryStringParameters: { topic: 'payment', id: '183120683902' }, body: ''
  }, {
    env: { MERCADOPAGO_ACCESS_TOKEN: 'TEST' },
    fetchImpl: async (url) => { cap.url = url; return { ok: true, status: 200, json: async () => ({ id: 183120683902, status: 'approved', transaction_amount: 1000, currency_id: 'COP', external_reference: 'MPDIR-x', payment_method_id: 'visa' }) }; },
    processApprovedPayment: async (tx, h) => { processed = tx; return { statusCode: 200, headers: h, body: '{"success":true}' }; }
  });
  assert.equal(res.statusCode, 200);
  assert.match(cap.url, /\/v1\/payments\/183120683902$/);
  assert.equal(processed.id, '183120683902');
});

/* ── create-mercadopago-preference ──────────────────────────────────────── */

const pref = require('../../netlify/functions/create-mercadopago-preference')._test;

test('notification_url pide solo Webhooks (source_news=webhooks)', () => {
  assert.equal(pref.notificationUrl('https://estar.com.co'), 'https://estar.com.co/api/mercadopago-webhook?source_news=webhooks');
});

test('back_urls: huésped en inglés vuelve a /en/reservar.html (también con las URL de entorno)', () => {
  const es = pref.directBackUrls('https://estar.com.co', 'es', {});
  assert.equal(es.success, 'https://estar.com.co/reservar.html?payment=success');
  const en = pref.directBackUrls('https://estar.com.co', 'en', {});
  assert.equal(en.success, 'https://estar.com.co/en/reservar.html?payment=success');
  assert.equal(en.failure, 'https://estar.com.co/en/reservar.html?payment=failure');
  assert.equal(en.pending, 'https://estar.com.co/en/reservar.html?payment=pending');
  const env = { MERCADOPAGO_SUCCESS_URL: 'https://estar.com.co/reservar.html?payment=success' };
  assert.equal(pref.directBackUrls('https://x', 'es', env).success, env.MERCADOPAGO_SUCCESS_URL);
  assert.equal(pref.directBackUrls('https://x', 'en', env).success, 'https://estar.com.co/en/reservar.html?payment=success');
});

function prefBody(over = {}) {
  return {
    type: 'direct', bookingCode: 'EST-PREF1', amountCents: 27000000, checkin: '2026-11-10', checkout: '2026-11-12',
    guestsCount: 1, roomTypeId: '31348', roomName: 'Clásica', firstName: 'Ana', lastName: 'Ríos',
    email: 'ana@example.com', phone: '3001112233', extrasMask: '0000000', ratePlan: 'flexible', ...over
  };
}
const prefEvent = { headers: { host: 'estar.com.co', 'x-forwarded-proto': 'https' } };

test('preferencia MP con descuento: verifica CON el código, cobra el monto descontado y guarda el código para el webhook', async () => {
  let verifyArgs = null, created = null, persisted = null;
  const res = await pref.preferenceForDirectBooking(prefBody({ discountCode: ' resena10 ', notes: 'Hola <b>', marketingOptIn: true, lang: 'en' }), prefEvent, {
    flag: async (k) => k === 'DISCOUNT_CODES_ENABLED',
    verifyDirectBookingAmount: async (d, cents, opts) => { verifyArgs = { d, cents, opts }; return { ok: true, matchedPlan: 'flexible', discount: { applied: true, code: 'RESENA10' } }; },
    createPreference: async (p) => { created = p; return { id: 'PREF', init_point: 'https://mp/init', sandbox_init_point: 'https://mp/sb' }; },
    persistDirectSideData: async (x) => { persisted = x; return {}; }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(verifyArgs.cents, 27000000);
  assert.equal(verifyArgs.opts.discountCode, 'RESENA10', 'el código se normaliza y se valida en el servidor');
  assert.equal(created.items[0].unit_price, 270000, 'MP cobra el monto con descuento');
  assert.equal(created.notification_url, 'https://estar.com.co/api/mercadopago-webhook?source_news=webhooks');
  assert.equal(created.back_urls.success, 'https://estar.com.co/en/reservar.html?payment=success');
  assert.equal(persisted.discountCode, 'RESENA10');
  assert.equal(persisted.notes, 'Hola  b'.replace(/\s+/g, ' '), 'nota saneada');
  assert.equal(persisted.marketingOptIn, true);
  const decoded = decodeDirectReference(created.external_reference);
  assert.equal(decoded.amountCents, 27000000);
  assert.equal(decoded.ratePlan, 'flexible');
});

test('preferencia MP con DISCOUNT_CODES apagado: el código se ignora (no se valida ni se guarda)', async () => {
  let verifyOpts = null, persisted = null;
  await pref.preferenceForDirectBooking(prefBody({ discountCode: 'RESENA10', amountCents: 30000000 }), prefEvent, {
    flag: async () => false,
    verifyDirectBookingAmount: async (d, c, opts) => { verifyOpts = opts; return { ok: true, matchedPlan: 'best', discount: { applied: false } }; },
    createPreference: async () => ({ id: 'P', init_point: 'u' }),
    persistDirectSideData: async (x) => { persisted = x; return {}; }
  });
  assert.deepEqual(verifyOpts, {});
  assert.equal(persisted.discountCode, '');
});

test('preferencia MP: monto manipulado (no cuadra con OTASync) → 400 sin crear preferencia', async () => {
  let created = false;
  const res = await pref.preferenceForDirectBooking(prefBody({ amountCents: 100 }), prefEvent, {
    flag: async () => false,
    verifyDirectBookingAmount: async () => ({ ok: false, reason: 'price_mismatch' }),
    createPreference: async () => { created = true; return {}; },
    persistDirectSideData: async () => ({})
  });
  assert.equal(res.statusCode, 400);
  assert.equal(created, false);
});

test('persistDirectSideData: mismos stores/claves que Wompi; la nota solo con GUEST_NOTES_TO_PMS_ENABLED', async () => {
  const blobs = memBlobs();
  const out = await pref.persistDirectSideData(
    { bookingCode: 'EST-SD1', email: 'a@x.co', discountCode: 'RESENA10', amountCents: 100, notes: 'n', marketingOptIn: true },
    { getStore: blobs.getStore, flag: async () => false }
  );
  assert.deepEqual(out, { discount: true, notes: false, marketing: true, lang: false });
  assert.equal(blobs.read('booking-discounts', 'disc-EST-SD1').code, 'RESENA10');
  assert.equal(blobs.read('booking-marketing', 'mkt-EST-SD1').accepted, true);
  assert.equal(blobs.read('booking-notes', 'note-EST-SD1'), null);
  const on = await pref.persistDirectSideData(
    { bookingCode: 'EST-SD2', email: 'a@x.co', notes: 'llego tarde' },
    { getStore: blobs.getStore, flag: async (k) => k === 'GUEST_NOTES_TO_PMS_ENABLED' }
  );
  assert.equal(on.notes, true);
  assert.equal(blobs.read('booking-notes', 'note-EST-SD2').notes, 'llego tarde');
});

/* ── wompi-webhook: las alertas de dinero de la reserva directa van por reportAlert ── */

test('wompi-webhook: "pago sin reserva", "doble pago" y "monto incorrecto" usan reportAlert (no sendEmail suelto)', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../netlify/functions/wompi-webhook.js'), 'utf8');
  for (const legacy of ['Pago Wompi con monto incorrecto — ${decoded.bookingCode}`,\n        html',
    'Doble pago de reserva directa — ${decoded.bookingCode}',
    'Pago sin reserva directa (Habitación Agotada)',
    'subject: `⚠ Pago sin reserva directa — ${decoded.bookingCode}`']) {
    assert.ok(!src.includes(legacy), `sigue el correo suelto: ${legacy}`);
  }
  const kinds = (src.match(/await moneyAlert\(\{\s*kind: '(payment_[a-z_]+)'/g) || []).length;
  assert.ok(kinds >= 4, 'las 4 alertas de dinero de la ruta directa usan moneyAlert');
  assert.match(src, /require\('\.\/_alert'\)\.reportAlert/);
});
