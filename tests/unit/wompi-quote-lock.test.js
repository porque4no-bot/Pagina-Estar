/* Unit tests for the per-quote lock that prevents two concurrent Wompi
 * webhooks for the same reference from double-booking in OTASync. */

const test = require('node:test');
const assert = require('node:assert/strict');

const { _test } = require('../../netlify/functions/wompi-webhook');

const QUOTE_ID = 'COT-2026-LOCKT';
const CORS = { 'Content-Type': 'application/json' };

function baseQuote(overrides = {}) {
  return {
    quoteId: QUOTE_ID,
    status: 'activa',
    expiresAt: '2999-01-01T00:00:00.000Z',
    checkin: '2026-07-01',
    checkout: '2026-07-03',
    empresa: 'Empresa Prueba',
    contacto: 'Ana Pérez',
    email: 'qa@example.com',
    numPersonas: 2,
    items: [{
      roomTypeId: '31348',
      habitacion: 'Clásica',
      unidades: 1,
      noches: 2,
      tarifaPorNoche: 100_000,
      subtotal: 200_000
    }],
    servicios: {},
    ...overrides
  };
}

function transaction(overrides = {}) {
  return {
    id: 'TX-FIRST',
    reference: QUOTE_ID,
    amount_in_cents: 23_800_000,
    ...overrides
  };
}

function dependencies(quote, overrides = {}) {
  return {
    getQuoteStore: () => ({ name: 'test-store' }),
    loadQuote: async () => quote,
    saveQuote: async () => {},
    effectiveStatus: () => quote.status,
    computeQuoteTotal: () => ({ totalCents: 23_800_000 }),
    releaseHold: async () => {},
    getAvailabilityByType: async () => ({ availByType: { 31348: 10 }, isMock: false }),
    findUnavailable: () => [],
    buildExtrasFromQuote: () => ({ extras: [], extrasPrice: 0 }),
    sendEmail: async () => {},
    adminEmail: () => 'admin@example.com',
    paymentConfirmationHtml: () => '<p>confirmed</p>',
    adminPendingHtml: () => '<p>pending</p>',
    getSessionKey: async () => 'session-key',
    fetch: async () => new Response(JSON.stringify({ id_reservations: 'RES-100' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }),
    /* Default lock stub — acquire always succeeds, like the in-memory case. */
    acquireQuoteLock: async () => ({ acquired: true }),
    ...overrides
  };
}

async function withOtasyncCredentials(run) {
  const previous = {
    token: process.env.OTASYNC_TOKEN,
    username: process.env.OTASYNC_USERNAME,
    password: process.env.OTASYNC_PASSWORD
  };
  process.env.OTASYNC_TOKEN = 'test-token';
  process.env.OTASYNC_USERNAME = 'test-user';
  process.env.OTASYNC_PASSWORD = 'test-password';
  try { return await run(); }
  finally {
    if (previous.token === undefined) delete process.env.OTASYNC_TOKEN; else process.env.OTASYNC_TOKEN = previous.token;
    if (previous.username === undefined) delete process.env.OTASYNC_USERNAME; else process.env.OTASYNC_USERNAME = previous.username;
    if (previous.password === undefined) delete process.env.OTASYNC_PASSWORD; else process.env.OTASYNC_PASSWORD = previous.password;
  }
}

test('a refused lock blocks the booking and alerts the admin', async () => {
  await withOtasyncCredentials(async () => {
    const quote = baseQuote();
    const emails = [];
    let fetched = false;
    const saved = [];

    const response = await _test.handleQuotePayment(
      transaction({ id: 'TX-SECOND' }),
      CORS,
      dependencies(quote, {
        acquireQuoteLock: async () => ({ acquired: false, ownerTx: 'TX-FIRST', startedAt: 12345 }),
        sendEmail: async (msg) => emails.push(msg),
        saveQuote: async (_s, q) => saved.push(q),
        fetch: async () => { fetched = true; throw new Error('must not fetch'); }
      })
    );

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.match(body.message, /already being processed/);
    assert.equal(body.ownerTx, 'TX-FIRST');
    assert.equal(fetched, false);
    assert.equal(saved.length, 0);
    assert.equal(emails.length, 1);
    assert.match(emails[0].subject, /Doble pago/);
  });
});

test('a successfully acquired lock proceeds with the booking', async () => {
  await withOtasyncCredentials(async () => {
    const quote = baseQuote();
    const saved = [];

    const response = await _test.handleQuotePayment(
      transaction(),
      CORS,
      dependencies(quote, {
        acquireQuoteLock: async () => ({ acquired: true }),
        saveQuote: async (_s, q) => saved.push(q)
      })
    );

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.success, true);
    assert.equal(body.bookingCode, 'RES-100');
    assert.equal(saved.at(-1).status, 'aceptada');
  });
});

test('acquireQuoteLock returns acquired:true when Blobs is unavailable', async () => {
  /* The real acquireQuoteLock is exported via _test; here we verify the
     fail-safe path used in environments without Blobs. */
  const lock = await _test.acquireQuoteLock(QUOTE_ID, 'TX-X');
  assert.equal(lock.acquired, true);
});
