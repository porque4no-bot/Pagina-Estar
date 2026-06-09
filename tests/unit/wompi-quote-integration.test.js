const test = require('node:test');
const assert = require('node:assert/strict');

const { _test } = require('../../netlify/functions/wompi-webhook');

const QUOTE_ID = 'COT-2026-ABCDE';
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
    id: 'TX-001',
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
  try {
    return await run();
  } finally {
    if (previous.token === undefined) delete process.env.OTASYNC_TOKEN;
    else process.env.OTASYNC_TOKEN = previous.token;
    if (previous.username === undefined) delete process.env.OTASYNC_USERNAME;
    else process.env.OTASYNC_USERNAME = previous.username;
    if (previous.password === undefined) delete process.env.OTASYNC_PASSWORD;
    else process.env.OTASYNC_PASSWORD = previous.password;
  }
}

test('quote payment rejects an amount mismatch without creating a reservation', async () => {
  const quote = baseQuote();
  let saved = false;
  let fetched = false;
  const response = await _test.handleQuotePayment(
    transaction({ amount_in_cents: 23_799_899 }),
    CORS,
    dependencies(quote, {
      saveQuote: async () => { saved = true; },
      fetch: async () => {
        fetched = true;
        throw new Error('must not fetch');
      }
    })
  );

  assert.equal(response.statusCode, 200);
  assert.match(JSON.parse(response.body).message, /Amount mismatch/);
  assert.equal(saved, false);
  assert.equal(fetched, false);
});

test('an already accepted quote is idempotent', async () => {
  const quote = baseQuote({ status: 'aceptada' });
  let totalCalculated = false;
  const response = await _test.handleQuotePayment(
    transaction(),
    CORS,
    dependencies(quote, {
      computeQuoteTotal: () => {
        totalCalculated = true;
        return { totalCents: 23_800_000 };
      }
    })
  );

  assert.deepEqual(JSON.parse(response.body), { received: true, duplicate: true });
  assert.equal(totalCalculated, false);
});

test('a paid quote with unavailable rooms becomes pending and alerts the admin', async () => {
  await withOtasyncCredentials(async () => {
    const quote = baseQuote();
    const saved = [];
    const emails = [];
    let fetched = false;
    const shortfalls = [{
      roomTypeId: '31348',
      habitacion: 'Clásica',
      requested: 1,
      available: 0
    }];

    const response = await _test.handleQuotePayment(
      transaction(),
      CORS,
      dependencies(quote, {
        getAvailabilityByType: async () => ({ availByType: { 31348: 0 }, isMock: false }),
        findUnavailable: () => shortfalls,
        saveQuote: async (_store, value) => saved.push(structuredClone(value)),
        sendEmail: async message => emails.push(message),
        fetch: async () => {
          fetched = true;
          throw new Error('must not fetch');
        }
      })
    );

    assert.deepEqual(JSON.parse(response.body), {
      success: true,
      quoteId: QUOTE_ID,
      reservationPending: true
    });
    assert.equal(fetched, false);
    assert.equal(saved.at(-1).status, 'aceptada');
    assert.equal(saved.at(-1).reservationPending, true);
    assert.equal(saved.at(-1).availabilityOk, false);
    assert.deepEqual(saved.at(-1).unavailable, shortfalls);
    assert.equal(emails.length, 1);
    assert.equal(emails[0].to, 'admin@example.com');
  });
});

test('room holds are released before the confirmed OTASync reservation', async () => {
  await withOtasyncCredentials(async () => {
    const quote = baseQuote({ holdReservationIds: ['HOLD-1', 'HOLD-2'] });
    const events = [];
    const saved = [];

    const response = await _test.handleQuotePayment(
      transaction(),
      CORS,
      dependencies(quote, {
        releaseHold: async holdId => events.push(`release:${holdId}`),
        getAvailabilityByType: async () => {
          throw new Error('availability must be skipped when a hold existed');
        },
        getSessionKey: async () => {
          events.push('auth');
          return 'session-key';
        },
        fetch: async () => {
          events.push('insert');
          return new Response(JSON.stringify({ id_reservations: 'RES-100' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        },
        saveQuote: async (_store, value) => saved.push(structuredClone(value))
      })
    );

    assert.deepEqual(events, ['release:HOLD-1', 'release:HOLD-2', 'auth', 'insert']);
    assert.equal(JSON.parse(response.body).bookingCode, 'RES-100');
    assert.deepEqual(saved.at(-1).bookingCodes, ['RES-100']);
    assert.equal(saved.at(-1).reservationPending, false);
    assert.deepEqual(saved.at(-1).holdReservationIds, []);
  });
});

test('an OTASync failure records the paid quote as pending and sends an alert', async () => {
  await withOtasyncCredentials(async () => {
    const quote = baseQuote();
    const saved = [];
    const emails = [];

    const response = await _test.handleQuotePayment(
      transaction(),
      CORS,
      dependencies(quote, {
        getAvailabilityByType: async () => ({ availByType: {}, isMock: true }),
        fetch: async () => {
          throw new Error('OTASync unavailable');
        },
        saveQuote: async (_store, value) => saved.push(structuredClone(value)),
        sendEmail: async message => emails.push(message)
      })
    );

    assert.deepEqual(JSON.parse(response.body), {
      success: true,
      quoteId: QUOTE_ID,
      reservationPending: true
    });
    assert.equal(saved.at(-1).status, 'aceptada');
    assert.equal(saved.at(-1).transactionId, 'TX-001');
    assert.equal(saved.at(-1).reservationPending, true);
    assert.deepEqual(saved.at(-1).bookingCodes, []);
    assert.equal(emails.length, 1);
    assert.equal(emails[0].to, 'admin@example.com');
  });
});
