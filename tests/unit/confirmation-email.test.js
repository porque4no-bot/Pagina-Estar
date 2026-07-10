/* Unit tests for the robust booking-confirmation email.
 *
 * Two layers:
 *  - sendConfirmationEmail (send-confirmation.js): the shared, idempotent
 *    sender used by BOTH the client endpoint and wompi-webhook. Dedup, the
 *    breakfast-pass link, and the mark-after-success behaviour are covered with
 *    injected deps (no network, no Blobs).
 *  - sendDirectBookingConfirmation (wompi-webhook.js): derives `breakfast` from
 *    the extras mask and forwards the right params, never throwing.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

/* _breakfast-pass derives its key lazily, but set a secret defensively so the
   require chain (and any default signPassToken) never throws. */
process.env.GUEST_APP_TOKEN_SECRET = process.env.GUEST_APP_TOKEN_SECRET || 'test-secret';

const { sendConfirmationEmail } = require('../../netlify/functions/send-confirmation');
const { _test: wompi } = require('../../netlify/functions/wompi-webhook');

function fakeStore() {
  const map = new Map();
  return {
    map,
    get: async (k) => (map.has(k) ? map.get(k) : null),
    /* Emula la semántica de Netlify Blobs: onlyIfNew no sobrescribe una clave
       existente y devuelve { modified:false }; delete la borra. */
    set: async (k, v, opts) => {
      if (opts && opts.onlyIfNew && map.has(k)) return { modified: false };
      map.set(k, v);
      return { modified: true };
    },
    delete: async (k) => { map.delete(k); }
  };
}

function okFetch(captured) {
  captured.calls = 0;
  return async (url, opts) => {
    captured.calls += 1;
    captured.url = url;
    captured.opts = opts;
    captured.body = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({ id: 're_test_1' }) };
  };
}

async function withResendKey(value, run) {
  const prev = process.env.RESEND_API_KEY;
  if (value === null) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = value;
  try {
    return await run();
  } finally {
    if (prev === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prev;
  }
}

function baseParams(overrides = {}) {
  return {
    guestEmail: 'ana@example.com',
    guestName: 'Ana Pérez',
    bookingCode: 'RES-100',
    roomName: 'Clásica',
    checkIn: '2026-07-01',
    checkOut: '2026-07-03',
    nights: 2,
    paidAmount: 200000,
    totalAmount: 200000,
    ...overrides
  };
}

/* ── sendConfirmationEmail ─────────────────────────────────────────────── */

test('sends the confirmation, embeds the breakfast pass link, and marks the dedup key', async () => {
  const store = fakeStore();
  const captured = {};
  await withResendKey('re_key', async () => {
    const result = await sendConfirmationEmail(
      baseParams({ breakfast: true, via: 'webhook' }),
      { fetch: okFetch(captured), signPassToken: () => 'PASS123', getStore: () => store }
    );
    assert.equal(result.sent, true);
    assert.equal(result.resendId, 're_test_1');
  });
  assert.equal(captured.calls, 1);
  assert.equal(captured.body.to, 'ana@example.com');
  assert.match(captured.body.subject, /RES-100/);
  assert.match(captured.body.html, /pase-desayuno\?t=PASS123/);
  assert.match(captured.body.html, /Ver mis pases de desayuno/);
  assert.ok(store.map.has('RES-100'), 'dedup key should be marked after a successful send');
});

test('a second send for the same booking is suppressed (idempotent)', async () => {
  const store = fakeStore();
  store.map.set('RES-100', '1'); // a prior trigger already sent it
  let fetched = 0;
  await withResendKey('re_key', async () => {
    const result = await sendConfirmationEmail(
      baseParams(),
      { fetch: async () => { fetched += 1; throw new Error('must not send'); }, getStore: () => store }
    );
    assert.equal(result.sent, false);
    assert.equal(result.duplicate, true);
    assert.equal(result.reason, 'duplicate');
  });
  assert.equal(fetched, 0);
});

test('the client and the webhook dedup on the same booking code → one email', async () => {
  // Shared store across both triggers (the real Blobs store is global too).
  const store = fakeStore();
  const captured = {};
  const fetchSpy = okFetch(captured); // one shared spy so calls accumulate
  await withResendKey('re_key', async () => {
    // Webhook fires first (reliable path).
    const first = await sendConfirmationEmail(
      baseParams({ via: 'webhook' }),
      { fetch: fetchSpy, getStore: () => store }
    );
    // Client poll then fires for the same OTASync id.
    const second = await sendConfirmationEmail(
      baseParams({ via: 'client' }),
      { fetch: fetchSpy, getStore: () => store }
    );
    assert.equal(first.sent, true);
    assert.equal(second.sent, false);
    assert.equal(second.duplicate, true);
  });
  assert.equal(captured.calls, 1, 'exactly one network send across both triggers');
});

test('omits the breakfast pass link when the reservation has no breakfast', async () => {
  const store = fakeStore();
  const captured = {};
  await withResendKey('re_key', async () => {
    await sendConfirmationEmail(
      baseParams({ bookingCode: 'RES-200', breakfast: false }),
      { fetch: okFetch(captured), getStore: () => store, signPassToken: () => 'SHOULD-NOT-APPEAR' }
    );
  });
  assert.doesNotMatch(captured.body.html, /pase-desayuno/);
  assert.doesNotMatch(captured.body.html, /SHOULD-NOT-APPEAR/);
});

test('a failed Resend send is NOT marked, so it stays retryable by the other trigger', async () => {
  const store = fakeStore();
  await withResendKey('re_key', async () => {
    const result = await sendConfirmationEmail(
      baseParams({ bookingCode: 'RES-300' }),
      {
        fetch: async () => ({ ok: false, status: 502, json: async () => ({ message: 'boom' }) }),
        getStore: () => store
      }
    );
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'resend-error');
  });
  assert.equal(store.map.has('RES-300'), false);
});

test('returns no-key and does not send when RESEND_API_KEY is unset', async () => {
  const store = fakeStore();
  let fetched = 0;
  await withResendKey(null, async () => {
    const result = await sendConfirmationEmail(
      baseParams({ bookingCode: 'RES-400' }),
      { fetch: async () => { fetched += 1; return { ok: true, json: async () => ({}) }; }, getStore: () => store }
    );
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'no-key');
  });
  assert.equal(fetched, 0);
});

/* ── sendDirectBookingConfirmation (webhook) ───────────────────────────── */

function decodedReservation(overrides = {}) {
  return {
    email: 'ana@example.com',
    firstName: 'Ana',
    lastName: 'Pérez',
    checkin: '2026-07-01',
    checkout: '2026-07-03',
    phone: '+57 300 111 2233',
    extrasMask: '0000000',
    bookingCode: 'EST-ORIG',
    ...overrides
  };
}

test('webhook derives breakfast=true from the extras mask and forwards the right params', async () => {
  const calls = [];
  const result = await wompi.sendDirectBookingConfirmation(
    {
      decoded: decodedReservation({ extrasMask: '1000000' }), // position 0 = desayuno
      displayBookingCode: 'RES-900',
      roomName: 'Clásica',
      nights: 2,
      paidAmount: 200000,
      totalAmount: 238000
    },
    { sendConfirmationEmail: async (p) => { calls.push(p); return { sent: true }; } }
  );
  assert.equal(result.sent, true);
  assert.equal(calls.length, 1);
  const p = calls[0];
  assert.equal(p.breakfast, true);
  // bookingCode is the OTASync id — the shared dedup key with the client send.
  assert.equal(p.bookingCode, 'RES-900');
  assert.equal(p.guestEmail, 'ana@example.com');
  assert.equal(p.guestName, 'Ana Pérez');
  assert.equal(p.checkIn, '2026-07-01');
  assert.equal(p.checkOut, '2026-07-03');
  assert.equal(p.nights, 2);
  assert.equal(p.paidAmount, 200000);
  assert.equal(p.via, 'webhook');
});

test('webhook derives breakfast=false when the mask has no breakfast bit', async () => {
  const calls = [];
  await wompi.sendDirectBookingConfirmation(
    { decoded: decodedReservation({ extrasMask: '0100000' }), displayBookingCode: 'RES-901', nights: 1, paidAmount: 1, totalAmount: 1 },
    { sendConfirmationEmail: async (p) => { calls.push(p); return { sent: true }; } }
  );
  assert.equal(calls[0].breakfast, false);
});

test('webhook sends nothing when the decoded reservation has no email', async () => {
  let called = 0;
  const result = await wompi.sendDirectBookingConfirmation(
    { decoded: decodedReservation({ email: '', extrasMask: '1000000' }), displayBookingCode: 'RES-902' },
    { sendConfirmationEmail: async () => { called += 1; return { sent: true }; } }
  );
  assert.equal(called, 0);
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'no-email');
});

test('webhook confirmation never throws when the sender fails', async () => {
  let result;
  await assert.doesNotReject(async () => {
    result = await wompi.sendDirectBookingConfirmation(
      { decoded: decodedReservation(), displayBookingCode: 'RES-903', nights: 1, paidAmount: 1, totalAmount: 1 },
      { sendConfirmationEmail: async () => { throw new Error('resend down'); } }
    );
  });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'error');
});
