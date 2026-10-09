/* Frente cancel — puertas de entrada del flujo:
 *  - request-cancellation: el registro de reembolso encuentra el pago de MP por
 *    el código EST (reference de Kunas) y `preVerified` (sesión del guest app)
 *    no pide de nuevo el segundo factor; sin él, el anti-enumeración sigue igual.
 *  - guest-action: cancelar desde la app reutiliza submitCancellationRequest.
 *  - get-pending-refunds: datos bancarios solo con refunds.mark_done + política.
 *  - _payment-details: snapshot durable del pago normalizado de Mercado Pago.
 * Sin red: Blobs en memoria, OTASync y Resend interceptados en fetch. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.GUEST_APP_DATA_ENCRYPTION_KEY = 'unit-test-entrypoints-key';
process.env.GUEST_APP_TOKEN_SECRET = 'unit-test-entrypoints-token';
process.env.GUEST_APP_DEMO_MODE = 'true';
process.env.RESEND_API_KEY = 're_test_fake';
process.env.ALERT_ENABLED = 'false';
delete process.env.GUEST_APP_SYNC_WEBHOOK_URL;
delete process.env.GUEST_APP_DRIVE_WEBHOOK_URL;

const registry = new Map();
function memStore(name) {
  if (!registry.has(name)) {
    const m = new Map();
    registry.set(name, {
      _m: m,
      async set(key, value, opts = {}) {
        if (opts.onlyIfNew && m.has(key)) return { modified: false };
        m.set(key, value);
        return { modified: true };
      },
      async get(key) { return m.has(key) ? m.get(key) : null; },
      async list(opts = {}) { return { blobs: Array.from(m.keys()).filter(k => !opts.prefix || k.startsWith(opts.prefix)).map(key => ({ key })) }; },
      async delete(key) { m.delete(key); }
    });
  }
  return registry.get(name);
}
const P = (m) => require.resolve('../../netlify/functions/' + m);
function fake(id, exportsObj) { require.cache[id] = { id, filename: id, loaded: true, exports: exportsObj }; }
const blobsPath = require.resolve('@netlify/blobs');
fake(blobsPath, { getStore: (opts) => memStore(typeof opts === 'string' ? opts : opts.name) });

const authState = { perms: [] };
fake(P('_authz'), {
  authorize: async (event, perm) => (authState.perms.includes(perm)
    ? { ok: true, email: 'x@estar.com.co', permissions: authState.perms.slice() }
    : { ok: false, statusCode: 403, error: 'No tienes permiso para esta acción' })
});

/* OTASync: solo la sesión (la reserva llega por fetch). */
const realOtasync = require('../../netlify/functions/_otasync');
fake(P('_otasync'), { ...realOtasync, getSessionKey: async () => 'pkey-test', hasOtasyncCreds: () => true });

const RESERVATION = {
  id_reservations: '3273564',
  reference: 'EST-ABC12',
  status: 'confirmed',
  date_arrival: '2026-11-20',
  date_departure: '2026-11-22',
  total_price: 330000,
  note: 'Telefono del huesped: 3001234567. Creado por Webhook mercadopago. ID Transaccion: 1323456789',
  guests: [{ first_name: 'Ana', last_name: 'Ruiz', email: 'ana@example.com' }],
  rooms: [{ room_type: 'Selección' }]
};
const sent = [];
global.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('api.resend.com')) {
    sent.push(JSON.parse(opts.body));
    return { ok: true, status: 200, json: async () => ({ id: 'e' + sent.length }) };
  }
  if (u.includes('reservation/data/reservation')) {
    return { ok: true, status: 200, json: async () => ({ ...RESERVATION }) };
  }
  throw new Error('red bloqueada en pruebas: ' + u);
};

function reset() { for (const s of registry.values()) s._m.clear(); sent.length = 0; }

/* ── request-cancellation ── */

test('submitCancellationRequest (preVerified) crea el reembolso con el pago de MP hallado por código EST', async () => {
  reset();
  await memStore('booking-results').set('direct-EST-ABC12', JSON.stringify({
    bookingCode: '3273564', provider: 'mercadopago', paymentMethod: 'visa', transactionId: 'MP-998877', amountInCents: 33000000
  }));
  const { submitCancellationRequest } = require('../../netlify/functions/request-cancellation');
  const r = await submitCancellationRequest({ bookingCode: '3273564', preVerified: true, clientIp: '1.2.3.4', source: 'guest-app', lang: 'en' });
  assert.equal(r.ok, true);
  assert.equal(r.code, 'submitted');
  const refund = JSON.parse(await memStore('refunds').get('3273564'));
  assert.equal(refund.kind, 'cancellation');
  assert.equal(refund.reference, 'EST-ABC12');
  assert.equal(refund.transactionId, 'MP-998877');
  assert.equal(refund.route, 'GATEWAY_AUTO');
  assert.equal(refund.originalAmountCents, 33000000);
  assert.equal(refund.lang, 'en');
  assert.equal(refund.source, 'guest-app');
  assert.ok(!JSON.stringify(refund).includes('3001234567'), 'la nota de Kunas (con el teléfono) no se guarda');
  const ack = sent.find(m => m.to === 'ana@example.com');
  assert.match(ack.subject, /We received your cancellation request — 3273564/);
});

test('sin pago registrado, el id de la transacción sale de la nota de Kunas', async () => {
  reset();
  const { submitCancellationRequest } = require('../../netlify/functions/request-cancellation');
  await submitCancellationRequest({ bookingCode: '3273564', preVerified: true, source: 'web' });
  const refund = JSON.parse(await memStore('refunds').get('3273564'));
  assert.equal(refund.transactionId, '1323456789');
  assert.equal(refund.transactionIdSource, 'pms-note');
  assert.equal(refund.originalAmountSource, 'pms_total');
  assert.equal(refund.route, 'GATEWAY_AUTO', 'pago MP de la nota (sin método) → se devuelve por Mercado Pago');
});

test('sin preVerified se sigue exigiendo el segundo factor (anti-enumeración)', async () => {
  reset();
  const { submitCancellationRequest } = require('../../netlify/functions/request-cancellation');
  const bad = await submitCancellationRequest({ bookingCode: '3273564', providedFactor: 'otro@x.co', source: 'web' });
  assert.deepEqual(bad, { ok: false, code: 'not_found' });
  const ok = await submitCancellationRequest({ bookingCode: '3273564', providedFactor: 'Ruiz', source: 'web' });
  assert.equal(ok.ok, true);
});

/* ── guest-action ── */

const guestHelpers = require('../../netlify/functions/_guest-app');
const guestAction = require('../../netlify/functions/guest-action');
function guestEvent(payload) {
  const token = guestHelpers.signGuestToken({ bookingCode: '3273564', guestName: 'Ana Ruiz', nights: 2, totalAmount: 330000 }, 300);
  return { httpMethod: 'POST', headers: { 'x-forwarded-for': '203.0.113.7', authorization: `Bearer ${token}` }, body: JSON.stringify(payload) };
}
function baseDeps(extra) {
  guestAction._test.setDeps(Object.assign({
    protectRecord: record => record,
    guestStore: () => ({ setJSON: async () => {} }),
    archiveGuestPayload: async () => ({ delivered: false, configured: false }),
    syncGuestEvent: async () => ({ delivered: false })
  }, extra || {}));
}

test('guest app: "cancelar" llama a submitCancellationRequest con la reserva de la sesión (preVerified)', async () => {
  const calls = [];
  baseDeps({ hasPmsCredentials: () => true, submitCancellationRequest: async (args) => { calls.push(args); return { ok: true, code: 'submitted' }; } });
  try {
    const res = await guestAction.handler(guestEvent({ type: 'reservation_change', requestKind: 'cancel', message: 'Ya no viajo', lang: 'en' }));
    assert.equal(res.statusCode, 201);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].bookingCode, '3273564');
    assert.equal(calls[0].preVerified, true);
    assert.equal(calls[0].source, 'guest-app');
    assert.equal(calls[0].lang, 'en');
    assert.equal(calls[0].clientIp, '203.0.113.7');
    assert.deepEqual(JSON.parse(res.body).cancellation, { submitted: true, code: 'submitted' });
  } finally { guestAction._test.resetDeps(); }
});

test('guest app: otros cambios de reserva NO disparan la cancelación', async () => {
  let called = 0;
  baseDeps({ hasPmsCredentials: () => true, submitCancellationRequest: async () => { called++; return { ok: true, code: 'submitted' }; } });
  try {
    const res = await guestAction.handler(guestEvent({ type: 'reservation_change', requestKind: 'dates', message: 'Cambiar fechas' }));
    assert.equal(res.statusCode, 201);
    assert.equal(called, 0);
    assert.equal(JSON.parse(res.body).cancellation, undefined);
  } finally { guestAction._test.resetDeps(); }
});

test('guest app: si el flujo falla, la solicitud del huésped no se cae y se alerta al equipo', async () => {
  const alerts = [];
  baseDeps({
    hasPmsCredentials: () => true,
    submitCancellationRequest: async () => { throw new Error('OTASync caído'); },
    reportAlert: async (a) => { alerts.push(a); return { alerted: true }; }
  });
  try {
    const res = await guestAction.handler(guestEvent({ type: 'reservation_change', requestKind: 'cancel', message: 'x' }));
    assert.equal(res.statusCode, 201);
    assert.deepEqual(JSON.parse(res.body).cancellation, { submitted: false, code: 'error' });
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].kind, 'guest_cancel_request_failed');
  } finally { guestAction._test.resetDeps(); }
});

test('guest app: not_cancellable / not_found también alertan al equipo (no se pierde la solicitud)', async () => {
  for (const code of ['not_cancellable', 'not_found']) {
    const alerts = [];
    baseDeps({
      hasPmsCredentials: () => true,
      submitCancellationRequest: async () => ({ ok: false, code }),
      reportAlert: async (a) => { alerts.push(a); return { alerted: true }; }
    });
    try {
      const res = await guestAction.handler(guestEvent({ type: 'reservation_change', requestKind: 'cancel', message: 'x' }));
      assert.equal(res.statusCode, 201);
      assert.equal(alerts.length, 1, code);
      assert.equal(alerts[0].kind, 'guest_cancel_request_failed');
      assert.equal(alerts[0].context.code, code);
    } finally { guestAction._test.resetDeps(); }
  }
  /* registrada o ya pedida: sin alerta */
  for (const code of ['submitted', 'already_requested']) {
    const alerts = [];
    baseDeps({ hasPmsCredentials: () => true, submitCancellationRequest: async () => ({ ok: true, code }), reportAlert: async (a) => { alerts.push(a); } });
    try {
      await guestAction.handler(guestEvent({ type: 'reservation_change', requestKind: 'cancel', message: 'x' }));
      assert.equal(alerts.length, 0, code);
    } finally { guestAction._test.resetDeps(); }
  }
});

test('guest app sin credenciales del PMS (demo): no intenta el flujo', async () => {
  let called = 0;
  baseDeps({ hasPmsCredentials: () => false, submitCancellationRequest: async () => { called++; }, reportAlert: async () => ({ alerted: false }) });
  try {
    const res = await guestAction.handler(guestEvent({ type: 'reservation_change', requestKind: 'cancel', message: 'x' }));
    assert.equal(res.statusCode, 201);
    assert.equal(called, 0);
    assert.equal(JSON.parse(res.body).cancellation.code, 'pms_unavailable');
  } finally { guestAction._test.resetDeps(); }
});

/* ── get-pending-refunds ── */

test('get-pending-refunds: recepción ve el resumen; quien tramita ve la cuenta; nunca el sobre; trae la política', async () => {
  reset();
  const { sealBankDetailsFields } = require('../../netlify/functions/_refunds-store');
  const fields = sealBankDetailsFields('BK-9', { bankName: 'Davivienda', accountType: 'corriente', accountNumber: '44556677', holderName: 'Ana', docType: 'CC', docNumber: '9' });
  await memStore('refunds').set('BK-9', JSON.stringify({
    bookingCode: 'BK-9', status: 'BANK_DETAILS_READY', route: 'MANUAL_BANK', ratePlan: 'best',
    checkIn: '2026-11-20', nights: 2, createdAt: '2026-11-01T10:00:00Z', originalAmountCents: 40000000, ...fields
  }));
  const { handler } = require('../../netlify/functions/get-pending-refunds');

  authState.perms = ['refunds.view'];
  const rec = JSON.parse((await handler({ httpMethod: 'GET', headers: {} })).body);
  const r1 = rec.refunds[0];
  assert.equal(r1.bankDetails, undefined);
  assert.equal(r1.bankDetailsSealed, undefined);
  assert.equal(r1.bankDetailsSummary.accountLast4, '6677');
  assert.equal(rec.viewer.canSeeBank, false);
  assert.equal(r1.policy.rule, 'full');
  assert.equal(r1.policy.amountCents, 40000000);
  assert.equal(typeof rec.config.autoCancelPms, 'boolean');
  assert.equal(rec.config.slaDays, 15);

  authState.perms = ['refunds.view', 'refunds.mark_done'];
  const tes = JSON.parse((await handler({ httpMethod: 'GET', headers: {} })).body);
  assert.equal(tes.refunds[0].bankDetails.accountNumber, '44556677');
  assert.equal(tes.refunds[0].bankDetailsSealed, undefined);
  assert.equal(tes.viewer.canSeeBank, true);
});

/* ── _payment-details (Mercado Pago) ── */

test('savePaymentDetails guarda el pago NORMALIZADO de Mercado Pago (antes quedaba como "wompi" vacío)', async () => {
  reset();
  const { savePaymentDetails, getPaymentDetails } = require('../../netlify/functions/_payment-details');
  const tx = { id: '1323456789', provider: 'mercadopago', status: 'approved', reference: 'MPDIR-xyz', amountCents: 33000000, amount: 330000, currency: 'COP', paymentMethod: 'visa', approved: true };
  const res = await savePaymentDetails('EST-ABC12', tx);
  assert.equal(res.saved, true);
  const d = await getPaymentDetails('EST-ABC12');
  assert.equal(d.provider, 'mercadopago');
  assert.equal(d.transactionId, '1323456789');
  assert.equal(d.method, 'visa');
  assert.equal(d.amountInCents, 33000000);
});

test('savePaymentDetails sigue leyendo la transacción CRUDA de Wompi igual que antes', async () => {
  reset();
  const { savePaymentDetails, getPaymentDetails } = require('../../netlify/functions/_payment-details');
  await savePaymentDetails('W-1', { id: 'w-77', amount_in_cents: 1000, payment_method_type: 'CARD', payment_method: { extra: { last_four: '4242', brand: 'VISA' } } });
  const d = await getPaymentDetails('W-1');
  assert.equal(d.provider, 'wompi');
  assert.equal(d.cardLast4, '4242');
});
