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
  return guestHelpers.signGuestToken({ bookingCode: 'EST-TEST-42', guestName: 'María López' }, 300);
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
      { id: 'parking', quantity: 1 }
    ],
    paymentPreference: 'room'
  }, token));
  assert.equal(res.statusCode, 201);
  const data = body(res);
  assert.equal(data.ok, true);
  assert.equal(data.total, 2 * 28000 + 25000);
});

test('guest-action order: 400 when items list is empty or all invalid', async () => {
  const token = validToken();

  const noItems = await guestAction(makeEvent({ type: 'order', items: [] }, token));
  assert.equal(noItems.statusCode, 400);

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
