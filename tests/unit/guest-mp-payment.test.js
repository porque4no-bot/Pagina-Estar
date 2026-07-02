/* Frente A — Mercado Pago para pedidos del guest app (cobro en línea → folio).
 *
 * Cubre el espejo de Mercado Pago del flujo Wompi del guest service:
 *   1. _guest-payments.createGuestMercadoPagoCheckout: arma la preferencia MP,
 *      guarda el intent server-authoritative (monto del catálogo, no del cliente),
 *      y queda inerte/mock-safe sin MERCADOPAGO_ACCESS_TOKEN.
 *   2. guest-action.resolveOnlineProvider: el modo (env) es la compuerta; el
 *      cliente solo puede *acotar* cuando mode='both', nunca habilitar.
 *   3. mercadopago-webhook.handleGuestServicePayment: al aprobar postea add_extra
 *      + add_payment al folio, verifica el monto server-side, es idempotente y
 *      marca seguimiento manual ante fallas (sin reintentos no idempotentes).
 *   4. create-mercadopago-preference: el endpoint público rechaza referencias
 *      de pedidos del huésped (GST-...).
 *
 * Todas las dependencias se inyectan: sin red, sin Blobs reales, sin credenciales.
 */

const test = require('node:test');
const assert = require('node:assert');

const guestPayments = require('../../netlify/functions/_guest-payments');
const guestAction = require('../../netlify/functions/guest-action');
const mpWebhook = require('../../netlify/functions/mercadopago-webhook');

const ORDER_REF = 'GST-1718700000000-AB12CD';
const sampleRecord = {
  eventId: ORDER_REF,
  total: 60000,
  items: [
    { id: 'breakfast', name: 'Desayuno', unitPrice: 20000, quantity: 2, subtotal: 40000 },
    { id: 'laundry', name: 'Lavandería', unitPrice: 20000, quantity: 1, subtotal: 20000 }
  ]
};

/* ── 1. createGuestMercadoPagoCheckout ─────────────────────────────── */

test('createGuestMercadoPagoCheckout builds a preference, stores a server-authoritative intent, returns init_point', async () => {
  let savedIntent = null;
  let sentPreference = null;
  const url = await guestPayments.createGuestMercadoPagoCheckout(
    { record: sampleRecord, bookingCode: 'RES-99', redirectBase: 'https://estar.com.co/' },
    {
      env: { MERCADOPAGO_ACCESS_TOKEN: 'tok' },
      saveIntent: async (i) => { savedIntent = i; return i; },
      createPreference: async (pref) => { sentPreference = pref; return { id: 'PREF1', init_point: 'https://mp/checkout/PREF1' }; }
    }
  );

  assert.equal(url, 'https://mp/checkout/PREF1');

  // Intent mirrors the Wompi intent shape + provider tag, amount from the record.
  assert.equal(savedIntent.reference, ORDER_REF);
  assert.equal(savedIntent.eventId, ORDER_REF);
  assert.equal(savedIntent.bookingCode, 'RES-99');
  assert.equal(savedIntent.provider, 'mercadopago');
  assert.equal(savedIntent.amountInCents, 6000000);
  assert.equal(savedIntent.currency, 'COP');
  assert.equal(savedIntent.status, 'pending');
  assert.deepEqual(savedIntent.items, [
    { id: 'breakfast', name: 'Desayuno', unitPrice: 20000, quantity: 2 },
    { id: 'laundry', name: 'Lavandería', unitPrice: 20000, quantity: 1 }
  ]);

  // Preference: external_reference = order id, unit_price = server total, COP.
  assert.equal(sentPreference.external_reference, ORDER_REF);
  assert.equal(sentPreference.items[0].unit_price, 60000);
  assert.equal(sentPreference.items[0].currency_id, 'COP');
  assert.equal(sentPreference.metadata.order_id, ORDER_REF);
  assert.equal(sentPreference.metadata.expected_amount_cents, 6000000);
  assert.equal(sentPreference.metadata.source, 'guest');
  assert.equal(sentPreference.notification_url, 'https://estar.com.co/api/mercadopago-webhook');
  assert.equal(sentPreference.back_urls.success, 'https://estar.com.co/guest.html?order=GST-1718700000000-AB12CD');
});

test('createGuestMercadoPagoCheckout uses sandbox init_point when MERCADOPAGO_CHECKOUT_MODE=sandbox', async () => {
  const url = await guestPayments.createGuestMercadoPagoCheckout(
    { record: sampleRecord, bookingCode: 'RES-1' },
    {
      env: { MERCADOPAGO_ACCESS_TOKEN: 'tok', MERCADOPAGO_CHECKOUT_MODE: 'sandbox' },
      saveIntent: async (i) => i,
      createPreference: async () => ({ id: 'P', init_point: 'https://mp/prod', sandbox_init_point: 'https://mp/sandbox' })
    }
  );
  assert.equal(url, 'https://mp/sandbox');
});

test('createGuestMercadoPagoCheckout rejects a non-positive amount before persisting', async () => {
  let persisted = false;
  await assert.rejects(
    guestPayments.createGuestMercadoPagoCheckout(
      { record: { eventId: ORDER_REF, total: 0, items: [] }, bookingCode: 'RES-1' },
      { env: { MERCADOPAGO_ACCESS_TOKEN: 'tok' }, saveIntent: async () => { persisted = true; }, createPreference: async () => ({}) }
    ),
    /Monto inválido/
  );
  assert.equal(persisted, false);
});

test('createMercadoPagoPreference is inert (throws 503) without an access token — mock-safe local', async () => {
  await assert.rejects(
    guestPayments.createMercadoPagoPreference({}, { env: {} }),
    (err) => err.statusCode === 503 && /no está configurado/.test(err.message)
  );
});

/* ── 2. resolveOnlineProvider (env gate, client can only narrow) ─────── */

test('resolveOnlineProvider: env mode is the authoritative gate', () => {
  const r = guestAction._test.resolveOnlineProvider;
  // OFF by default — no online charge unless explicitly configured.
  assert.equal(r(undefined, 'mercadopago'), null);
  assert.equal(r('', 'wompi'), null);
  assert.equal(r('account', 'mercadopago'), null);
  assert.equal(r('payment_link', 'mercadopago'), null);

  // Single-provider modes ignore the client choice (can't widen).
  assert.equal(r('wompi', 'mercadopago'), 'wompi');
  assert.equal(r('mercadopago', 'wompi'), 'mercadopago');

  // 'both' lets the client pick; default + unknown fall back to wompi.
  assert.equal(r('both', 'mercadopago'), 'mercadopago');
  assert.equal(r('both', 'wompi'), 'wompi');
  assert.equal(r('both', undefined), 'wompi');
  assert.equal(r('both', 'evil'), 'wompi');
});

/* ── 3. guest-action order flow picks MP and builds its checkout ─────── */

test('guest-action order with mode=mercadopago builds the MP checkout and returns paymentProvider', async () => {
  const prev = process.env.GUEST_SERVICE_PAYMENT_MODE;
  process.env.GUEST_SERVICE_PAYMENT_MODE = 'mercadopago';
  let mpCalled = false, wompiCalled = false, folioCalled = false;
  guestAction._test.setDeps({
    requireGuest: () => ({ sub: 'RES-77', guest: 'Ana', nights: 2, totalAmount: 400000 }),
    guestStore: () => ({ setJSON: async () => {} }),
    protectRecord: (r) => r,
    syncGuestEvent: async () => ({ ok: true }),
    archiveGuestPayload: async () => ({ configured: false }),
    notifyOrderTeam: async () => {},
    postOrderToFolio: async () => { folioCalled = true; return {}; },
    createGuestWompiCheckout: async () => { wompiCalled = true; return 'WOMPI_URL'; },
    createGuestMercadoPagoCheckout: async ({ record, bookingCode }) => {
      mpCalled = true;
      assert.equal(bookingCode, 'RES-77');
      assert.equal(record.total, 40000); // 2 × desayuno 20000
      return 'https://mp/checkout/X';
    }
  });
  try {
    const res = await guestAction.handler({
      httpMethod: 'POST',
      headers: { host: 'estar.com.co' },
      body: JSON.stringify({ type: 'order', items: [{ id: 'breakfast', quantity: 2 }], paymentPreference: 'online' })
    });
    const out = JSON.parse(res.body);
    assert.equal(res.statusCode, 201);
    assert.equal(out.paymentRequired, true);
    assert.equal(out.paymentProvider, 'mercadopago');
    assert.equal(out.paymentUrl, 'https://mp/checkout/X');
    assert.equal(mpCalled, true);
    assert.equal(wompiCalled, false);
    assert.equal(folioCalled, false, 'online orders must not post to folio before payment');
  } finally {
    guestAction._test.resetDeps();
    if (prev === undefined) delete process.env.GUEST_SERVICE_PAYMENT_MODE;
    else process.env.GUEST_SERVICE_PAYMENT_MODE = prev;
  }
});

test('guest-action mode=both honours the client provider choice (mercadopago)', async () => {
  const prev = process.env.GUEST_SERVICE_PAYMENT_MODE;
  process.env.GUEST_SERVICE_PAYMENT_MODE = 'both';
  let mpCalled = false, wompiCalled = false;
  guestAction._test.setDeps({
    requireGuest: () => ({ sub: 'RES-5', guest: 'Bea' }),
    guestStore: () => ({ setJSON: async () => {} }),
    protectRecord: (r) => r,
    syncGuestEvent: async () => ({ ok: true }),
    archiveGuestPayload: async () => ({ configured: false }),
    notifyOrderTeam: async () => {},
    createGuestWompiCheckout: async () => { wompiCalled = true; return 'WOMPI'; },
    createGuestMercadoPagoCheckout: async () => { mpCalled = true; return 'MP'; }
  });
  try {
    const res = await guestAction.handler({
      httpMethod: 'POST',
      headers: { host: 'estar.com.co' },
      body: JSON.stringify({ type: 'order', items: [{ id: 'breakfast', quantity: 1 }], paymentPreference: 'online', paymentProvider: 'mercadopago' })
    });
    const out = JSON.parse(res.body);
    assert.equal(out.paymentProvider, 'mercadopago');
    assert.equal(out.paymentUrl, 'MP');
    assert.equal(mpCalled, true);
    assert.equal(wompiCalled, false);
  } finally {
    guestAction._test.resetDeps();
    if (prev === undefined) delete process.env.GUEST_SERVICE_PAYMENT_MODE;
    else process.env.GUEST_SERVICE_PAYMENT_MODE = prev;
  }
});

/* ── 4. mercadopago-webhook.handleGuestServicePayment ───────────────── */

const CORS = { 'Content-Type': 'application/json' };

function approvedTx(overrides = {}) {
  return {
    id: 'MP-PAY-1',
    provider: 'mercadopago',
    status: 'approved',
    reference: ORDER_REF,
    amountCents: 6000000,
    amount: 60000,
    currency: 'COP',
    paymentMethod: 'visa',
    ...overrides
  };
}

test('handleGuestServicePayment posts the charge + payment to the folio and marks the intent paid', async () => {
  const { handleGuestServicePayment } = mpWebhook._test;
  let folioArgs = null;
  let marked = null;
  const res = await handleGuestServicePayment(approvedTx(), CORS, {
    loadIntent: async () => ({ status: 'pending', bookingCode: 'RES-99', amountInCents: 6000000, items: sampleRecord.items }),
    postOrderToFolio: async (args) => { folioArgs = args; return { posted: true, count: 2 }; },
    markIntentStatus: async (ref, status, extra) => { marked = { ref, status, extra }; }
  });
  const out = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(out.received, true);
  assert.equal(folioArgs.idReservations, 'RES-99');
  assert.equal(folioArgs.items.length, 2);
  assert.equal(folioArgs.payment.amount, 60000);
  assert.match(folioArgs.payment.note, /Mercado Pago MP-PAY-1/);
  assert.equal(marked.ref, ORDER_REF);
  assert.equal(marked.status, 'paid');
  assert.equal(marked.extra.transactionId, 'MP-PAY-1');
});

test('handleGuestServicePayment is idempotent when the intent is already paid', async () => {
  const { handleGuestServicePayment } = mpWebhook._test;
  let folioCalled = false;
  const res = await handleGuestServicePayment(approvedTx(), CORS, {
    loadIntent: async () => ({ status: 'paid', bookingCode: 'RES-99', amountInCents: 6000000, items: [] }),
    postOrderToFolio: async () => { folioCalled = true; return {}; },
    markIntentStatus: async () => {}
  });
  const out = JSON.parse(res.body);
  assert.equal(out.duplicate, true);
  assert.equal(folioCalled, false);
});

test('handleGuestServicePayment refuses to post when the paid amount differs from the stored intent (server-side check)', async () => {
  const { handleGuestServicePayment } = mpWebhook._test;
  let folioCalled = false;
  let marked = null;
  const res = await handleGuestServicePayment(approvedTx({ amountCents: 100 }), CORS, {
    loadIntent: async () => ({ status: 'pending', bookingCode: 'RES-99', amountInCents: 6000000, items: sampleRecord.items }),
    postOrderToFolio: async () => { folioCalled = true; return {}; },
    markIntentStatus: async (ref, status, extra) => { marked = { ref, status, extra }; }
  });
  const out = JSON.parse(res.body);
  assert.equal(folioCalled, false, 'must not charge the folio on amount mismatch');
  assert.match(out.message, /mismatch/i);
  assert.equal(marked.status, 'amount_mismatch');
  assert.equal(marked.extra.paidCents, 100);
});

test('handleGuestServicePayment flags manual follow-up (no retry) when folio posting fails', async () => {
  const { handleGuestServicePayment } = mpWebhook._test;
  let marked = null;
  const res = await handleGuestServicePayment(approvedTx(), CORS, {
    loadIntent: async () => ({ status: 'pending', bookingCode: 'RES-99', amountInCents: 6000000, items: sampleRecord.items }),
    postOrderToFolio: async () => { throw new Error('OTASync down'); },
    markIntentStatus: async (ref, status, extra) => { marked = { ref, status, extra }; }
  });
  const out = JSON.parse(res.body);
  assert.equal(res.statusCode, 200, 'always 200 so MP does not hammer retries');
  assert.match(out.message, /folio posting failed/i);
  assert.equal(marked.status, 'paid_folio_failed');
  assert.equal(marked.extra.error, 'OTASync down');
});

test('handleGuestServicePayment returns gracefully when the intent is missing', async () => {
  const { handleGuestServicePayment } = mpWebhook._test;
  const res = await handleGuestServicePayment(approvedTx(), CORS, {
    loadIntent: async () => null,
    postOrderToFolio: async () => { throw new Error('should not run'); },
    markIntentStatus: async () => {}
  });
  const out = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.match(out.message, /not found/i);
});

/* ── 5. create-mercadopago-preference rejects guest-order references ──── */

test('create-mercadopago-preference rejects guest-order references (must go through guest-action)', async () => {
  const mpPref = require('../../netlify/functions/create-mercadopago-preference');
  const res = await mpPref.handler({
    httpMethod: 'POST',
    headers: { host: 'estar.com.co' },
    body: JSON.stringify({ source: 'guest', reference: ORDER_REF })
  });
  const out = JSON.parse(res.body);
  assert.equal(res.statusCode, 400);
  assert.equal(out.error, 'guest_orders_not_supported_here');
});
