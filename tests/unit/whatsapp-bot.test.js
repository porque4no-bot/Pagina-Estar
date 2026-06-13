/* WhatsApp bot: signature validation, webhook handshake/envelope parsing,
   date/guest parsers and the conversation state machine with injected deps
   (no network access). */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

const FUNCTIONS_DIR = path.join(__dirname, '../../netlify/functions');

const wa = require(path.join(FUNCTIONS_DIR, '_whatsapp.js'));
const bot = require(path.join(FUNCTIONS_DIR, '_whatsapp-bot.js'));
const webhook = require(path.join(FUNCTIONS_DIR, 'whatsapp-webhook.js'));

/* ── Signature validation ───────────────────────────── */

test('verifySignature accepts a valid HMAC and rejects tampering', () => {
  process.env.WHATSAPP_APP_SECRET = 'test-app-secret';
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
  const sig = 'sha256=' + crypto.createHmac('sha256', 'test-app-secret').update(body, 'utf8').digest('hex');

  assert.equal(wa.verifySignature(body, sig), true);
  assert.equal(wa.verifySignature(body + ' ', sig), false);
  assert.equal(wa.verifySignature(body, 'sha256=' + '0'.repeat(64)), false);
  assert.equal(wa.verifySignature(body, ''), false);
  assert.equal(wa.verifySignature(body, undefined), false);
});

test('verifySignature fails closed when the app secret is not configured', () => {
  delete process.env.WHATSAPP_APP_SECRET;
  const body = '{}';
  const sig = 'sha256=' + crypto.createHmac('sha256', '').update(body).digest('hex');
  assert.equal(wa.verifySignature(body, sig), false);
});

/* ── Webhook GET handshake ──────────────────────────── */

test('webhook GET echoes hub.challenge when the verify token matches', async () => {
  process.env.WHATSAPP_VERIFY_TOKEN = 'verify-me';
  const res = await webhook.handler({
    httpMethod: 'GET',
    headers: {},
    queryStringParameters: { 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': '12345token' }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, '12345token');
  assert.match(res.headers['Content-Type'], /text\/plain/);
});

test('webhook GET rejects a wrong or missing verify token', async () => {
  process.env.WHATSAPP_VERIFY_TOKEN = 'verify-me';
  const bad = await webhook.handler({
    httpMethod: 'GET',
    headers: {},
    queryStringParameters: { 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': 'x' }
  });
  assert.equal(bad.statusCode, 403);

  delete process.env.WHATSAPP_VERIFY_TOKEN;
  const unset = await webhook.handler({
    httpMethod: 'GET',
    headers: {},
    queryStringParameters: { 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': 'x' }
  });
  assert.equal(unset.statusCode, 403);
});

test('webhook POST without a valid signature returns 401', async () => {
  process.env.WHATSAPP_APP_SECRET = 'test-app-secret';
  const res = await webhook.handler({
    httpMethod: 'POST',
    headers: { 'x-hub-signature-256': 'sha256=deadbeef' },
    body: JSON.stringify({ object: 'whatsapp_business_account', entry: [] })
  });
  assert.equal(res.statusCode, 401);
});

/* ── Envelope parsing ───────────────────────────────── */

test('extractMessages normalizes text, button replies and list replies', () => {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        field: 'messages',
        value: {
          contacts: [{ profile: { name: 'Juan Pérez' }, wa_id: '573001112233' }],
          messages: [
            { from: '573001112233', id: 'wamid.1', type: 'text', text: { body: 'hola' } },
            { from: '573001112233', id: 'wamid.2', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'bot_book', title: 'Reservar' } } },
            { from: '573001112233', id: 'wamid.3', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'bot_vivir', title: 'Estadías largas' } } }
          ]
        }
      }]
    }]
  };
  const msgs = webhook._test.extractMessages(payload);
  assert.equal(msgs.length, 3);
  assert.equal(msgs[0].text, 'hola');
  assert.equal(msgs[0].profileName, 'Juan Pérez');
  assert.equal(msgs[1].replyId, 'bot_book');
  assert.equal(msgs[2].replyId, 'bot_vivir');
});

test('extractMessages ignores status-only events', () => {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: 'wamid.9', status: 'delivered' }] } }] }]
  };
  assert.equal(webhook._test.extractMessages(payload).length, 0);
});

/* ── Parsers ────────────────────────────────────────── */

test('parseDateRange handles dd/mm pairs, Spanish months and ISO', () => {
  const now = new Date('2026-06-12T12:00:00Z');
  assert.deepEqual(bot.parseDateRange('15/08 al 18/08', now), { checkin: '2026-08-15', checkout: '2026-08-18' });
  assert.deepEqual(bot.parseDateRange('15/8 a 18/8/2026', now), { checkin: '2026-08-15', checkout: '2026-08-18' });
  assert.deepEqual(bot.parseDateRange('del 15 al 18 de agosto', now), { checkin: '2026-08-15', checkout: '2026-08-18' });
  assert.deepEqual(bot.parseDateRange('2026-08-15 a 2026-08-18', now), { checkin: '2026-08-15', checkout: '2026-08-18' });
  /* Past dd/mm rolls into next year */
  assert.deepEqual(bot.parseDateRange('15/01 al 18/01', now), { checkin: '2027-01-15', checkout: '2027-01-18' });
  /* Year-end crossing */
  assert.deepEqual(bot.parseDateRange('28/12 al 02/01', now), { checkin: '2026-12-28', checkout: '2027-01-02' });
  /* Garbage */
  assert.equal(bot.parseDateRange('no tengo fechas', now), null);
  assert.equal(bot.parseDateRange('31/02 al 03/03', now), null);
});

test('parseGuests accepts digits and number words within limits', () => {
  assert.equal(bot.parseGuests('2'), 2);
  assert.equal(bot.parseGuests('somos 4 personas'), 4);
  assert.equal(bot.parseGuests('dos'), 2);
  assert.equal(bot.parseGuests('three'), 3);
  assert.equal(bot.parseGuests('9'), null);
  assert.equal(bot.parseGuests('no sé'), null);
});

/* ── Conversation flow with injected deps ───────────── */

function makeDeps(overrides) {
  const sent = [];
  const sessions = new Map();
  const deps = {
    wa: {
      sendText: async (to, body) => { sent.push({ kind: 'text', to, body }); return { sent: true }; },
      sendButtons: async (to, body, buttons) => { sent.push({ kind: 'buttons', to, body, buttons }); return { sent: true }; },
      sendList: async (to, body, btn, sections) => { sent.push({ kind: 'list', to, body, sections }); return { sent: true }; }
    },
    getDynamicPricing: async () => ({
      nights: 3, isMock: false,
      byRoomType: {
        31348: { avgPrice: 220000, available: 2 },
        31349: { avgPrice: 265000, available: 1 }
      }
    }),
    sendEmail: async (args) => { sent.push({ kind: 'email', ...args }); return { sent: true }; },
    adminEmail: () => 'reservas@estar.com.co',
    roomMeta: { 31348: { name: 'Clásica', capacity: 2 }, 31349: { name: 'Selección', capacity: 5 } },
    loadSession: async (id) => sessions.get(id) || { state: 'MAIN', data: {}, lang: null, updatedAt: Date.now() },
    saveSession: async (id, s) => { sessions.set(id, s); },
    lookupBooking: async () => null,
    submitCancellation: async () => ({ ok: true, code: 'submitted' }),
    ...overrides
  };
  return { deps, sent, sessions };
}

test('greeting shows the main menu with three buttons', async () => {
  const { deps, sent } = makeDeps();
  await bot.handleIncoming({ from: '573001112233', id: 'w1', type: 'text', text: 'hola', profileName: 'Ana' }, deps);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, 'buttons');
  assert.equal(sent[0].buttons.length, 3);
});

test('full booking flow: dates → guests → availability with deep link', async () => {
  const { deps, sent } = makeDeps();
  const from = '573001112233';
  await bot.handleIncoming({ from, id: 'w1', type: 'interactive', text: 'Reservar', replyId: 'bot_book' }, deps);
  assert.match(sent[sent.length - 1].body, /fechas|dates/i);

  await bot.handleIncoming({ from, id: 'w2', type: 'text', text: '15/08 al 18/08' }, deps);
  assert.match(sent[sent.length - 1].body, /personas|guests/i);

  await bot.handleIncoming({ from, id: 'w3', type: 'text', text: '2' }, deps);
  const reply = sent[sent.length - 1].body;
  assert.match(reply, /Clásica/);
  assert.match(reply, /Selección/);
  assert.match(reply, /reservar\.html\?checkin=\d{4}-08-15&checkout=\d{4}-08-18&guests=2/);
});

test('availability filters rooms below the requested capacity', async () => {
  const { deps, sent } = makeDeps();
  const from = '573001112233';
  await bot.handleIncoming({ from, id: 'w1', type: 'interactive', text: '', replyId: 'bot_book' }, deps);
  await bot.handleIncoming({ from, id: 'w2', type: 'text', text: '15/08 al 18/08' }, deps);
  await bot.handleIncoming({ from, id: 'w3', type: 'text', text: '4' }, deps);
  const reply = sent[sent.length - 1].body;
  assert.doesNotMatch(reply, /Clásica/);
  assert.match(reply, /Selección/);
});

test('manage flow looks up the booking and offers cancellation', async () => {
  const booking = {
    bookingCode: 'EST-123', status: 'confirmed', roomName: 'Clásica',
    checkIn: '2026-07-01', checkOut: '2026-07-04', nights: 3, canCancel: true
  };
  const { deps, sent } = makeDeps({ lookupBooking: async () => booking });
  const from = '573001112233';
  await bot.handleIncoming({ from, id: 'w1', type: 'interactive', text: '', replyId: 'bot_manage' }, deps);
  await bot.handleIncoming({ from, id: 'w2', type: 'text', text: 'EST-123' }, deps);
  await bot.handleIncoming({ from, id: 'w3', type: 'text', text: 'Pérez' }, deps);

  const last = sent[sent.length - 1];
  assert.equal(last.kind, 'buttons');
  assert.match(last.body, /EST-123/);
  assert.ok(last.buttons.some(b => b.id === 'bot_cancel'));

  await bot.handleIncoming({ from, id: 'w4', type: 'interactive', text: '', replyId: 'bot_cancel' }, deps);
  assert.match(sent[sent.length - 1].body, /solicitud|request/i);
});

test('human handoff emails the admin and acknowledges in chat', async () => {
  const { deps, sent } = makeDeps();
  await bot.handleIncoming({ from: '573001112233', id: 'w1', type: 'text', text: 'quiero hablar con un agente', profileName: 'Ana' }, deps);
  const email = sent.find(s => s.kind === 'email');
  assert.ok(email, 'expected an admin email');
  assert.match(email.subject, /WhatsApp/);
  assert.equal(sent[sent.length - 1].kind, 'text');
});

test('english is detected and answered in english', async () => {
  const { deps, sent } = makeDeps();
  await bot.handleIncoming({ from: '573001112233', id: 'w1', type: 'text', text: 'I want to book please' }, deps);
  assert.match(sent[sent.length - 1].body, /Which dates/i);
});
