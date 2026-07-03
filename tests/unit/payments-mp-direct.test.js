/* Sprint 2 (Mesa Redonda C4/C5) — ruta directa RESILIENTE de Mercado Pago en
 * _payments (detrás de MP_DIRECT_RESILIENT_ENABLED): lock single-writer +
 * idempotencia por estadía + insertReservation + recordPending SIEMPRE. Mock de
 * dependencias vía require.cache. node --test aísla el archivo en su proceso. */

const test = require('node:test');
const assert = require('node:assert/strict');

const R = (m) => require.resolve('../../netlify/functions/' + m);
const BLOBS = require.resolve('@netlify/blobs');

function fake(id, exportsObj) { require.cache[id] = { id, filename: id, loaded: true, exports: exportsObj }; }

function makeBlobs(seed = {}) {
  const buckets = new Map();
  const bucket = (n) => { if (!buckets.has(n)) buckets.set(n, new Map()); return buckets.get(n); };
  for (const [n, e] of Object.entries(seed)) { const b = bucket(n); for (const [k, v] of Object.entries(e)) b.set(k, typeof v === 'string' ? v : JSON.stringify(v)); }
  const getStore = (opts) => {
    const b = bucket(typeof opts === 'string' ? opts : opts.name);
    return {
      async get(k) { return b.has(k) ? b.get(k) : null; },
      async set(k, v) { b.set(k, v); return { modified: true }; },
      async delete(k) { b.delete(k); }
    };
  };
  return { getStore, buckets };
}

function load({ flag = true, lock = { acquired: true }, insertImpl, avail = { '31348': 5 }, seed = {} } = {}) {
  const calls = { insert: 0, lockAcquired: 0, lockReleased: 0, emails: [] };
  const blobs = makeBlobs(seed);

  fake(BLOBS, { getStore: blobs.getStore });
  fake(R('_otasync'), {
    hasOtasyncCreds: () => true,
    getAvailabilityByType: async () => ({ availByType: avail, isMock: false }),
    findUnavailable: () => [],
    releaseHold: async () => {},
    createConfirmedReservation: async () => ({}),
    otasyncCreds: () => ({ token: 't', propertyId: '9889', channelId: '', channelName: '' }),
    getSessionKey: async () => 'pkey',
    insertReservation: async (payload) => {
      calls.insert++;
      if (insertImpl) return insertImpl(payload);
      return { id_reservations: 'RES-MP-1' };
    }
  });
  fake(R('_quote-lock'), {
    acquireQuoteLock: async () => { calls.lockAcquired++; return lock; },
    releaseQuoteLock: async () => { calls.lockReleased++; }
  });
  fake(R('_email'), {
    sendEmail: async (m) => { calls.emails.push(m); return { sent: true }; },
    adminEmail: () => 'admin@x.co',
    paymentConfirmationHtml: () => '<p>ok</p>',
    adminPendingHtml: () => '<p>pending</p>'
  });
  fake(R('_analytics'), { trackPurchase: async () => {} });
  fake(R('_quotes-store'), {
    getQuoteStore: () => ({}), loadQuote: async () => null, saveQuote: async () => {},
    effectiveStatus: () => 'activa', computeQuoteTotal: () => ({ totalCents: 0 })
  });

  const saved = process.env.MP_DIRECT_RESILIENT_ENABLED;
  if (flag) process.env.MP_DIRECT_RESILIENT_ENABLED = 'true'; else delete process.env.MP_DIRECT_RESILIENT_ENABLED;

  delete require.cache[R('_payments')];
  const payments = require('../../netlify/functions/_payments');
  const cleanup = () => {
    if (saved === undefined) delete process.env.MP_DIRECT_RESILIENT_ENABLED; else process.env.MP_DIRECT_RESILIENT_ENABLED = saved;
    for (const m of ['_otasync', '_quote-lock', '_email', '_analytics', '_quotes-store', '_payments']) delete require.cache[R(m)];
    delete require.cache[BLOBS];
  };
  return { payments, blobs, calls, cleanup };
}

function mpTx(ref, id, amountCents) {
  return { id, provider: 'mercadopago', status: 'approved', currency: 'COP', reference: ref, amountCents, amount: amountCents / 100, paymentMethod: 'visa', approved: true };
}
function refFor(payments, bookingCode, amountCents, over = {}) {
  return payments.createDirectReference({
    checkin: '2026-08-01', checkout: '2026-08-03', guestsCount: 1, roomTypeId: '31348',
    firstName: 'Ana', lastName: 'R', email: 'a@x.co', phone: '300', extrasMask: '0000000',
    bookingCode, amountCents, ...over
  });
}

test('flag ON: éxito → inserta una vez, escribe booking-results e idempotencia por estadía, libera lock', async () => {
  const ctx = load({});
  try {
    const ref = refFor(ctx.payments, 'EST-D1', 30000000);
    const res = await ctx.payments.processApprovedPayment(mpTx(ref, 'MP-D1', 30000000), { 'Content-Type': 'application/json' });
    const body = JSON.parse(res.body);
    assert.equal(body.success, true);
    assert.equal(body.bookingCode, 'RES-MP-1');
    assert.equal(ctx.calls.insert, 1);
    assert.equal(ctx.calls.lockAcquired, 1);
    assert.equal(ctx.calls.lockReleased, 1);
    const br = ctx.blobs.buckets.get('booking-results').get('direct-EST-D1');
    assert.ok(br && !JSON.parse(br).reservationPending, 'booking-results sin pending');
    assert.ok(ctx.blobs.buckets.get('booking-idempotency').size === 1, 'idempotencia por estadía persistida');
  } finally { ctx.cleanup(); }
});

test('flag ON: doble pago de la misma estadía (otro tx) → duplicate, NO inserta, alerta', async () => {
  const ref1 = '__seed__';
  const ctx = load({
    seed: { 'booking-idempotency': { ['booking_31348_2026-08-01_2026-08-03_a@x.co']: { bookingCode: 'RES-PREV', transactionId: 'MP-OLD', createdAt: Date.now() } } }
  });
  try {
    const ref = refFor(ctx.payments, 'EST-D2', 30000000);
    const res = await ctx.payments.processApprovedPayment(mpTx(ref, 'MP-NEW', 30000000), {});
    const body = JSON.parse(res.body);
    assert.equal(body.duplicate, true);
    assert.equal(body.bookingCode, 'RES-PREV');
    assert.equal(ctx.calls.insert, 0, 'no se crea una segunda reserva');
    assert.ok(ctx.calls.emails.some(e => /misma estadía/i.test(e.subject)));
  } finally { ctx.cleanup(); }
});

test('flag ON: lock rechazado (otro tx en curso) → duplicate, NO inserta', async () => {
  const ctx = load({ lock: { acquired: false, ownerTx: 'MP-OTHER' } });
  try {
    const ref = refFor(ctx.payments, 'EST-D3', 30000000);
    const res = await ctx.payments.processApprovedPayment(mpTx(ref, 'MP-D3', 30000000), {});
    const body = JSON.parse(res.body);
    assert.equal(body.duplicate, true);
    assert.equal(ctx.calls.insert, 0);
    assert.equal(ctx.calls.lockReleased, 0, 'no libera un lock que no adquirió');
  } finally { ctx.cleanup(); }
});

test('flag ON: insertReservation falla → recordPending SIEMPRE + alerta + 200 reservationPending', async () => {
  const ctx = load({ insertImpl: async () => { throw new Error('OTASync 500 persistente'); } });
  try {
    const ref = refFor(ctx.payments, 'EST-D4', 30000000);
    const res = await ctx.payments.processApprovedPayment(mpTx(ref, 'MP-D4', 30000000), {});
    const body = JSON.parse(res.body);
    assert.equal(body.reservationPending, true);
    const br = JSON.parse(ctx.blobs.buckets.get('booking-results').get('direct-EST-D4'));
    assert.equal(br.reservationPending, true);
    assert.equal(br.reason, 'insert_failed');
    assert.ok(ctx.calls.emails.length >= 1);
    assert.equal(ctx.calls.lockReleased, 1, 'libera el lock aun cuando el insert falla (finally)');
  } finally { ctx.cleanup(); }
});

test('flag ON: mark-before-work → re-entrega del MISMO tx es no-op (duplicate)', async () => {
  const ctx = load({});
  try {
    const ref = refFor(ctx.payments, 'EST-D5', 30000000);
    const first = JSON.parse((await ctx.payments.processApprovedPayment(mpTx(ref, 'MP-D5', 30000000), {})).body);
    assert.equal(first.success, true);
    const second = JSON.parse((await ctx.payments.processApprovedPayment(mpTx(ref, 'MP-D5', 30000000), {})).body);
    assert.equal(second.duplicate, true);
    assert.equal(ctx.calls.insert, 1, 'la segunda entrega no vuelve a insertar');
  } finally { ctx.cleanup(); }
});

test('flag OFF: comportamiento previo (fetch crudo, sin lock ni idempotencia por estadía)', async () => {
  const ctx = load({ flag: false });
  const origFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ id_reservations: 'RES-RAW' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  try {
    const ref = refFor(ctx.payments, 'EST-D6', 30000000);
    const res = await ctx.payments.processApprovedPayment(mpTx(ref, 'MP-D6', 30000000), {});
    const body = JSON.parse(res.body);
    assert.equal(body.success, true);
    assert.equal(body.bookingCode, 'RES-RAW');
    assert.equal(ctx.calls.insert, 0, 'no usa insertReservation con el flag OFF');
    assert.equal(ctx.calls.lockAcquired, 0, 'no toma lock con el flag OFF');
    assert.equal(ctx.blobs.buckets.has('booking-idempotency') ? ctx.blobs.buckets.get('booking-idempotency').size : 0, 0, 'sin idempotencia por estadía');
  } finally { global.fetch = origFetch; ctx.cleanup(); }
});
