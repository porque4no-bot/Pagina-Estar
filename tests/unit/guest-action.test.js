const assert = require('node:assert/strict');
const test = require('node:test');

process.env.GUEST_APP_TOKEN_SECRET = 'unit-test-token-secret';
process.env.GUEST_APP_DATA_ENCRYPTION_KEY = 'unit-test-encryption-secret';
process.env.GUEST_APP_DEMO_MODE = 'true';
// Disable sync/archive webhooks so tests don't need fetch mocks for side-effects
delete process.env.GUEST_APP_SYNC_WEBHOOK_URL;
delete process.env.GUEST_APP_DRIVE_WEBHOOK_URL;

const guestHelpers = require('../../netlify/functions/_guest-app');
const guestActionModule = require('../../netlify/functions/guest-action');
const guestAction = guestActionModule.handler;

const persisted = [];
guestActionModule._test.setDeps({
  protectRecord: record => record,
  guestStore: () => ({
    setJSON: async (key, value) => { persisted.push({ key, value }); }
  }),
  archiveGuestPayload: async () => ({ delivered: false, configured: false }),
  syncGuestEvent: async () => ({ delivered: false })
});

function body(response) {
  return JSON.parse(response.body);
}

function makeEvent(payload, token) {
  return {
    httpMethod: 'POST',
    headers: {
      'x-forwarded-for': '127.0.0.1',
      authorization: token ? `Bearer ${token}` : ''
    },
    body: JSON.stringify(payload)
  };
}

function validToken() {
  // nights + totalAmount give a 320000 average-night base for %-of-night services.
  return guestHelpers.signGuestToken(
    { bookingCode: 'EST-TEST-42', guestName: 'María López', nights: 4, totalAmount: 1280000 },
    300
  );
}

test('guest-action rejects missing or invalid tokens', async () => {
  const noToken = await guestAction({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify({ type: 'support', message: 'Hola' })
  });
  assert.equal(noToken.statusCode, 401);

  const badToken = await guestAction(makeEvent({ type: 'support', message: 'Hola' }, 'bogus.token'));
  assert.equal(badToken.statusCode, 401);
});

test('guest-action rejects an unknown action type', async () => {
  const token = validToken();
  const res = await guestAction(makeEvent({ type: 'launch_rocket' }, token));
  assert.equal(res.statusCode, 400);
  assert.match(body(res).error, /no válido/i);
});

test('guest-action support: persists event and returns 201', async () => {
  const token = validToken();
  const res = await guestAction(makeEvent({
    type: 'support',
    category: 'concierge',
    message: 'Necesito más toallas',
    urgency: 'normal'
  }, token));
  assert.equal(res.statusCode, 201);
  const data = body(res);
  assert.equal(data.ok, true);
  assert.match(data.eventId, /^GST-/);
  assert.equal(data.status, 'received');
});

test('guest-action support: 400 when message is empty', async () => {
  const token = validToken();
  const res = await guestAction(makeEvent({ type: 'support', message: '' }, token));
  assert.equal(res.statusCode, 400);
  assert.match(body(res).error, /ayudarte/i);
});

test('guest-action order: persists event with sanitized items', async () => {
  const token = validToken();
  const res = await guestAction(makeEvent({
    type: 'order',
    items: [
      { id: 'breakfast', quantity: 2 },
      { id: 'laundry', quantity: 1 }
    ],
    paymentPreference: 'account'
  }, token));
  assert.equal(res.statusCode, 201);
  const data = body(res);
  assert.equal(data.ok, true);
  assert.equal(data.total, 2 * 20000 + 35000);
});

test('guest-action order: prices %-of-night services from the booking night base', async () => {
  const token = validToken(); // night base = 1280000 / 4 = 320000
  const res = await guestAction(makeEvent({
    type: 'order',
    items: [
      { id: 'late_checkout', quantity: 1 }, // 15% × 320000 = 48000
      { id: 'early_checkin', quantity: 1 }  // 35% × 320000 = 112000
    ]
  }, token));
  assert.equal(res.statusCode, 201);
  assert.equal(body(res).total, 48000 + 112000);
});

test('guest-action order: rejects %-of-night services when the token has no night base', async () => {
  // Pre-deploy tokens lack nights/totalAmount, so the server can't price 15%-of-night.
  const token = guestHelpers.signGuestToken({ bookingCode: 'EST-OLD-1', guestName: 'Old Token' }, 300);
  const res = await guestAction(makeEvent({
    type: 'order',
    items: [{ id: 'late_checkout', quantity: 1 }]
  }, token));
  assert.equal(res.statusCode, 400);
  assert.match(body(res).error, /iniciar sesión|precio/i);
});

test('guest-action order: 400 when items list is empty or all invalid', async () => {
  const token = validToken();

  const noItems = await guestAction(makeEvent({ type: 'order', items: [] }, token));
  assert.equal(noItems.statusCode, 400);

  // parqueadero was retired — its id is no longer in the catalogue.
  const retired = await guestAction(makeEvent({ type: 'order', items: [{ id: 'parking', quantity: 1 }] }, token));
  assert.equal(retired.statusCode, 400);

  const badIds = await guestAction(makeEvent({ type: 'order', items: [{ id: 'rocket_fuel', quantity: 1 }] }, token));
  assert.equal(badIds.statusCode, 400);
});

test('guest-action contract: persists event with guests and returns 201', async () => {
  const token = validToken();
  const res = await guestAction(makeEvent({
    type: 'contract',
    signedName: 'María López',
    acceptedTerms: true,
    guests: [{ guest: { firstName: 'María', lastName: 'López', documentNumber: 'CC123' }, isPrimary: true }],
    contractVersion: 'ESTAR-HOSPEDAJE-2026-01'
  }, token));
  assert.equal(res.statusCode, 201);
  const data = body(res);
  assert.equal(data.ok, true);
  assert.match(data.eventId, /^GST-/);
});

test('guest-action contract: 400 when signedName is empty', async () => {
  const token = validToken();
  const res = await guestAction(makeEvent({
    type: 'contract',
    signedName: '',
    acceptedTerms: true
  }, token));
  assert.equal(res.statusCode, 400);
  assert.match(body(res).error, /nombre/i);
});

test('guest-action contract: 400 when acceptedTerms is not exactly true', async () => {
  const token = validToken();

  const falsy = await guestAction(makeEvent({
    type: 'contract',
    signedName: 'María López',
    acceptedTerms: false
  }, token));
  assert.equal(falsy.statusCode, 400);

  const stringTrue = await guestAction(makeEvent({
    type: 'contract',
    signedName: 'María López',
    acceptedTerms: 'true'
  }, token));
  assert.equal(stringTrue.statusCode, 400);
});

test('guest-action contract: persists Ley 527 audit trail (IP, UA, hash, version)', async () => {
  const token = validToken();
  const captured = [];
  guestActionModule._test.setDeps({
    protectRecord: record => record,
    guestStore: () => ({
      setJSON: async (key, value) => { captured.push({ key, value }); }
    }),
    archiveGuestPayload: async () => ({ delivered: false, configured: false }),
    syncGuestEvent: async () => ({ delivered: false })
  });
  const event = {
    httpMethod: 'POST',
    headers: {
      'x-nf-client-connection-ip': '203.0.113.42',
      'user-agent': 'Mozilla/5.0 (Macintosh; Apple) Test/1.0',
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      type: 'contract',
      signedName: 'María López',
      acceptedTerms: true,
      guests: [{ guest: { firstName: 'María', lastName: 'López', documentType: 'CC', documentNumber: 'CC123' }, isPrimary: true }],
      acknowledgedAt: new Date().toISOString(),
      consentText: 'Declaro que he leído y acepto el contrato (test).'
    })
  };
  const res = await guestAction(event);
  assert.equal(res.statusCode, 201);
  assert.ok(captured.length, 'event was persisted');
  const persisted = captured[captured.length - 1].value;
  assert.equal(persisted.type, 'contract');
  assert.equal(persisted.clientIp, '203.0.113.42', 'IP captured from x-nf-client-connection-ip');
  assert.match(persisted.userAgent, /Test\/1\.0/, 'user agent captured');
  assert.equal(persisted.contractHashAlgorithm, 'sha256');
  assert.match(persisted.contractHash, /^[a-f0-9]{64}$/, 'contract hash is sha256 hex');
  assert.equal(persisted.contractVersion, guestActionModule._test.CURRENT_CONTRACT_VERSION);
  assert.ok(persisted.signedAt, 'signedAt set server-side');
  assert.ok(persisted.acknowledgedAt, 'acknowledgedAt accepted from client');
  assert.match(persisted.consentText, /he leído y acepto/);
  guestActionModule._test.resetDeps();
});

test('guest-action contract: falls back to x-forwarded-for and rejects bogus acknowledgedAt', async () => {
  const token = validToken();
  const captured = [];
  guestActionModule._test.setDeps({
    protectRecord: record => record,
    guestStore: () => ({
      setJSON: async (key, value) => { captured.push({ key, value }); }
    }),
    archiveGuestPayload: async () => ({ delivered: false, configured: false }),
    syncGuestEvent: async () => ({ delivered: false })
  });
  const event = {
    httpMethod: 'POST',
    headers: {
      'x-forwarded-for': '198.51.100.7, 10.0.0.1',
      'user-agent': 'curl/8.0',
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      type: 'contract',
      signedName: 'María López',
      acceptedTerms: true,
      guests: [{ guest: { firstName: 'María', lastName: 'López' }, isPrimary: true }],
      acknowledgedAt: 'not-a-timestamp'
    })
  };
  const res = await guestAction(event);
  assert.equal(res.statusCode, 201);
  const persisted = captured[captured.length - 1].value;
  assert.equal(persisted.clientIp, '198.51.100.7', 'IP from x-forwarded-for first hop');
  assert.equal(persisted.acknowledgedAt, '', 'invalid client acknowledgedAt is dropped');
  guestActionModule._test.resetDeps();
});

test('guest-action contract_preview: returns 200 with rendered HTML and does not persist', async () => {
  const token = validToken();
  const captured = [];
  guestActionModule._test.setDeps({
    protectRecord: record => record,
    guestStore: () => ({
      setJSON: async (key, value) => { captured.push({ key, value }); }
    })
  });

  const event = makeEvent({
    type: 'contract_preview',
    lang: 'en',
    guests: [{ guest: { firstName: 'John', lastName: 'Doe', documentType: 'Passport', documentNumber: '123' }, isPrimary: true }]
  }, token);

  const res = await guestAction(event);
  assert.equal(res.statusCode, 200);
  const data = body(res);
  assert.equal(data.ok, true);
  assert.match(data.html, /<!DOCTYPE html>/i);
  assert.match(data.html, /Hospitality Agreement/i); // English title
  assert.match(data.html, /John Doe/i); // Guest name is in it
  assert.equal(captured.length, 0, 'No event was persisted for preview');

  guestActionModule._test.resetDeps();
});

function setFolioDeps(onFolio) {
  guestActionModule._test.setDeps({
    protectRecord: record => record,
    guestStore: () => ({ setJSON: async () => {} }),
    archiveGuestPayload: async () => ({ delivered: false, configured: false }),
    syncGuestEvent: async () => ({ delivered: false }),
    postOrderToFolio: onFolio
  });
}

test('guest-action order: posts charge-to-account orders to the folio when enabled', async () => {
  const token = validToken();
  const calls = [];
  setFolioDeps(async (arg) => { calls.push(arg); return { posted: true, count: arg.items.length }; });
  process.env.GUEST_SERVICE_FOLIO_ENABLED = 'true';
  try {
    const res = await guestAction(makeEvent({
      type: 'order',
      items: [{ id: 'breakfast', quantity: 2 }],
      paymentPreference: 'account'
    }, token));
    assert.equal(res.statusCode, 201);
    assert.equal(calls.length, 1, 'folio posting called once');
    assert.equal(calls[0].idReservations, 'EST-TEST-42');
    assert.equal(calls[0].items[0].name, 'Desayuno');
    assert.equal(body(res).folio.posted, true);
  } finally {
    delete process.env.GUEST_SERVICE_FOLIO_ENABLED;
    guestActionModule._test.resetDeps();
  }
});

test('guest-action order: a folio failure does not fail the order', async () => {
  const token = validToken();
  setFolioDeps(async () => { throw new Error('OTASync down'); });
  process.env.GUEST_SERVICE_FOLIO_ENABLED = 'true';
  try {
    const res = await guestAction(makeEvent({
      type: 'order',
      items: [{ id: 'breakfast', quantity: 1 }],
      paymentPreference: 'account'
    }, token));
    assert.equal(res.statusCode, 201, 'order still succeeds');
    assert.equal(body(res).folio.posted, false);
    assert.match(body(res).folio.error, /OTASync down/);
  } finally {
    delete process.env.GUEST_SERVICE_FOLIO_ENABLED;
    guestActionModule._test.resetDeps();
  }
});

test('guest-action order: does NOT post to the folio when off or for online orders', async () => {
  const token = validToken();
  let called = 0;
  setFolioDeps(async () => { called++; return { posted: true }; });
  try {
    // Flag off → no folio call even for 'account'.
    await guestAction(makeEvent({ type: 'order', items: [{ id: 'breakfast', quantity: 1 }], paymentPreference: 'account' }, token));
    // Flag on but 'online' → no folio call (charged after payment, Phase B).
    process.env.GUEST_SERVICE_FOLIO_ENABLED = 'true';
    await guestAction(makeEvent({ type: 'order', items: [{ id: 'breakfast', quantity: 1 }], paymentPreference: 'online' }, token));
    assert.equal(called, 0, 'folio posting must not run when off or for online orders');
  } finally {
    delete process.env.GUEST_SERVICE_FOLIO_ENABLED;
    guestActionModule._test.resetDeps();
  }
});

test('guest-action order: online + wompi mode returns a signed checkout URL', async () => {
  const token = validToken();
  let checkoutArg = null;
  guestActionModule._test.setDeps({
    protectRecord: record => record,
    guestStore: () => ({ setJSON: async () => {} }),
    archiveGuestPayload: async () => ({ delivered: false, configured: false }),
    syncGuestEvent: async () => ({ delivered: false }),
    createGuestWompiCheckout: async (arg) => { checkoutArg = arg; return `https://checkout.wompi.co/p/?reference=${arg.record.eventId}`; }
  });
  process.env.GUEST_SERVICE_PAYMENT_MODE = 'wompi';
  try {
    const res = await guestAction(makeEvent({
      type: 'order',
      items: [{ id: 'breakfast', quantity: 1 }],
      paymentPreference: 'online'
    }, token));
    assert.equal(res.statusCode, 201);
    const data = body(res);
    assert.equal(data.paymentRequired, true);
    assert.match(data.paymentUrl, /checkout\.wompi\.co/);
    assert.equal(checkoutArg.bookingCode, 'EST-TEST-42');
    assert.equal(checkoutArg.record.total, 20000);
  } finally {
    delete process.env.GUEST_SERVICE_PAYMENT_MODE;
    guestActionModule._test.resetDeps();
  }
});

test('guest-action order: notifies the team with the order summary (Phase C)', async () => {
  const token = validToken();
  const mails = [];
  guestActionModule._test.setDeps({
    protectRecord: record => record,
    guestStore: () => ({ setJSON: async () => {} }),
    archiveGuestPayload: async () => ({ delivered: false, configured: false }),
    syncGuestEvent: async () => ({ delivered: false }),
    notifyOrderTeam: async (record) => { mails.push(record); }
  });
  try {
    const res = await guestAction(makeEvent({
      type: 'order',
      items: [{ id: 'breakfast', quantity: 2 }, { id: 'laundry', quantity: 1 }],
      paymentPreference: 'account',
      deliveryTime: 'Mañana 8am'
    }, token));
    assert.equal(res.statusCode, 201);
    assert.equal(mails.length, 1, 'team notified once');
    assert.equal(mails[0].bookingCode, 'EST-TEST-42');
    assert.equal(mails[0].total, 2 * 20000 + 35000);
    assert.equal(mails[0].items.length, 2);
    assert.equal(mails[0].paymentPreference, 'account');
  } finally {
    guestActionModule._test.resetDeps();
  }
});

test('guest-action order: a team-notification failure does not fail the order', async () => {
  const token = validToken();
  guestActionModule._test.setDeps({
    protectRecord: record => record,
    guestStore: () => ({ setJSON: async () => {} }),
    archiveGuestPayload: async () => ({ delivered: false, configured: false }),
    syncGuestEvent: async () => ({ delivered: false }),
    notifyOrderTeam: async () => { throw new Error('Resend down'); }
  });
  try {
    const res = await guestAction(makeEvent({
      type: 'order',
      items: [{ id: 'breakfast', quantity: 1 }],
      paymentPreference: 'account'
    }, token));
    assert.equal(res.statusCode, 201, 'order still succeeds despite mail failure');
  } finally {
    guestActionModule._test.resetDeps();
  }
});
