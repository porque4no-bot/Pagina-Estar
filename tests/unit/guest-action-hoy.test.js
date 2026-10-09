/* Frente "Panel Hoy para recepción" — pedidos "cargar a la cuenta" con el folio
 * APAGADO: además del correo, una tarea en la cola de recepción para que el
 * cargo no se pierda. Con el folio encendido o pago en línea, no se encola. */

const assert = require('node:assert/strict');
const test = require('node:test');

process.env.GUEST_APP_TOKEN_SECRET = 'unit-test-token-secret';
process.env.GUEST_APP_DATA_ENCRYPTION_KEY = 'unit-test-encryption-secret';
process.env.GUEST_APP_DEMO_MODE = 'true';
delete process.env.GUEST_APP_SYNC_WEBHOOK_URL;
delete process.env.GUEST_APP_DRIVE_WEBHOOK_URL;
delete process.env.GUEST_SERVICE_FOLIO_ENABLED;
delete process.env.GUEST_SERVICE_PAYMENT_MODE;

const guestHelpers = require('../../netlify/functions/_guest-app');
const mod = require('../../netlify/functions/guest-action');

function token() {
  return guestHelpers.signGuestToken({ bookingCode: '9001', guestName: 'María López', nights: 2, totalAmount: 400000 }, 300);
}

function order(paymentPreference, items = [{ id: 'breakfast', quantity: 2 }]) {
  return {
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1', authorization: `Bearer ${token()}` },
    body: JSON.stringify({ type: 'order', items, paymentPreference, deliveryTime: 'mañana 8am' })
  };
}

function setup(extra = {}) {
  const tasks = [];
  const persisted = [];
  let notified = null;
  mod._test.setDeps({
    protectRecord: record => record,
    guestStore: () => ({ setJSON: async (k, v) => { persisted.push({ k, v: JSON.parse(JSON.stringify(v)) }); } }),
    archiveGuestPayload: async () => ({ delivered: false, configured: false }),
    syncGuestEvent: async () => ({ delivered: false }),
    notifyOrderTeam: async (r) => { notified = r; },
    enqueueOps: async (t) => { tasks.push(t); return { queued: true, id: t.dedupeKey }; },
    postOrderToFolio: async () => ({ posted: true }),
    reportAlert: async () => {},
    ...extra
  });
  return { tasks, persisted, get notified() { return notified; } };
}

test('folio apagado + "cargar a la cuenta" → tarea folio_manual_charge sin PII y evento marcado manual', async () => {
  const s = setup();
  try {
    const res = await mod.handler(order('account'));
    assert.equal(res.statusCode, 201, res.body);
    assert.equal(s.tasks.length, 1);
    const t = s.tasks[0];
    assert.equal(t.kind, 'folio_manual_charge');
    assert.equal(t.severity, 'warn');
    assert.match(t.dedupeKey, /^folio_manual_charge:GST-/);
    assert.equal(t.context.bookingCode, '9001');
    assert.match(t.context.eventId, /^GST-/);
    assert.equal(t.context.total, 40000);
    assert.equal(t.context.items, 'Desayuno × 2');
    assert.doesNotMatch(JSON.stringify(t), /María/, 'la tarea no lleva el nombre del huésped');
    const last = s.persisted[s.persisted.length - 1].v;
    assert.equal(last.folioStatus, 'manual', 'el evento queda marcado para cargo manual');
    assert.equal(s.notified.folioStatus, 'manual', 'el correo al equipo sigue saliendo');
  } finally {
    mod._test.resetDeps();
  }
});

test('si la cola falla, el pedido igual se registra (best-effort)', async () => {
  setup({ enqueueOps: async () => { throw new Error('cola caída'); } });
  try {
    const res = await mod.handler(order('account'));
    assert.equal(res.statusCode, 201);
  } finally {
    mod._test.resetDeps();
  }
});

test('folio encendido (posteado) o pago en línea con link → NO encola cargo manual', async () => {
  let s = setup();
  process.env.GUEST_SERVICE_FOLIO_ENABLED = 'true';
  try {
    const res = await mod.handler(order('account'));
    assert.equal(res.statusCode, 201);
    assert.equal(s.tasks.length, 0, 'con el folio posteado no hay tarea manual');
  } finally {
    delete process.env.GUEST_SERVICE_FOLIO_ENABLED;
    mod._test.resetDeps();
  }
  process.env.GUEST_SERVICE_PAYMENT_MODE = 'wompi';
  s = setup({ createGuestWompiCheckout: async () => 'https://checkout.example/pay' });
  try {
    const res = await mod.handler(order('online'));
    assert.equal(res.statusCode, 201);
    assert.equal(JSON.parse(res.body).paymentRequired, true);
    assert.equal(s.tasks.length, 0, 'con link de pago en curso no hay tarea manual');
  } finally {
    delete process.env.GUEST_SERVICE_PAYMENT_MODE;
    mod._test.resetDeps();
  }
});

test('"Pagar en línea" sin link (modo room_charge de producción) → tarea folio_manual_charge', async () => {
  process.env.GUEST_SERVICE_PAYMENT_MODE = 'room_charge';
  const s = setup();
  try {
    const res = await mod.handler(order('online'));
    assert.equal(res.statusCode, 201);
    assert.equal(JSON.parse(res.body).paymentRequired, false);
    assert.equal(s.tasks.length, 1);
    assert.equal(s.tasks[0].kind, 'folio_manual_charge');
    assert.equal(s.tasks[0].context.paymentPreference, 'online');
    assert.match(s.tasks[0].title, /sin pago en línea/);
    assert.equal(s.persisted[s.persisted.length - 1].v.folioStatus, 'manual');
  } finally {
    delete process.env.GUEST_SERVICE_PAYMENT_MODE;
    mod._test.resetDeps();
  }
});

test('"Pagar en línea" con checkout de Wompi caído → tarea folio_manual_charge', async () => {
  process.env.GUEST_SERVICE_PAYMENT_MODE = 'wompi';
  const s = setup({ createGuestWompiCheckout: async () => { throw new Error('wompi caído'); } });
  try {
    const res = await mod.handler(order('online'));
    assert.equal(res.statusCode, 201);
    assert.equal(JSON.parse(res.body).paymentRequired, false);
    assert.equal(s.tasks.length, 1);
    assert.equal(s.tasks[0].context.paymentPreference, 'online');
  } finally {
    delete process.env.GUEST_SERVICE_PAYMENT_MODE;
    mod._test.resetDeps();
  }
});
