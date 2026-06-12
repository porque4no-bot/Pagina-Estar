/* WhatsApp AI layer: tool-use loop with a mocked Anthropic client, tool
   execution against injected business deps, refusal handling, history
   trimming, and the bot's AI-first routing with state-machine fallback. */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const FUNCTIONS_DIR = path.join(__dirname, '../../netlify/functions');
const ai = require(path.join(FUNCTIONS_DIR, '_whatsapp-ai.js'));
const bot = require(path.join(FUNCTIONS_DIR, '_whatsapp-bot.js'));

function makeBizDeps(overrides) {
  const sent = [];
  const deps = {
    wa: {
      sendText: async (to, body) => { sent.push({ kind: 'text', to, body }); return { sent: true }; },
      sendButtons: async (to, body, buttons) => { sent.push({ kind: 'buttons', to, body, buttons }); return { sent: true }; },
      sendList: async (to, body, btn, sections) => { sent.push({ kind: 'list', to, body, sections }); return { sent: true }; }
    },
    getDynamicPricing: async () => ({
      nights: 3, isMock: false,
      byRoomType: { 31348: { avgPrice: 220000, available: 2 }, 31349: { avgPrice: 265000, available: 1 } }
    }),
    sendEmail: async (args) => { sent.push({ kind: 'email', ...args }); return { sent: true }; },
    adminEmail: () => 'reservas@estar.com.co',
    roomMeta: { 31348: { name: 'Clásica', capacity: 2 }, 31349: { name: 'Selección', capacity: 5 } },
    loadSession: async () => ({ state: 'MAIN', data: {}, lang: null, updatedAt: Date.now() }),
    saveSession: async () => {},
    lookupBooking: async () => null,
    submitCancellation: async () => ({ ok: true, code: 'submitted' }),
    ...overrides
  };
  return { deps, sent };
}

/* Scripted fake Anthropic client: returns the queued responses in order. */
function fakeClient(responses) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (req) => {
        /* Snapshot — the loop mutates the messages array after the call. */
        calls.push(structuredClone(req));
        if (!responses.length) throw new Error('fake client exhausted');
        return responses.shift();
      }
    }
  };
}

test('isEnabled reflects ANTHROPIC_API_KEY presence', () => {
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal(ai.isEnabled(), false);
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  assert.equal(ai.isEnabled(), true);
  delete process.env.ANTHROPIC_API_KEY;
});

test('plain answer: one model turn, history persisted and text returned', async () => {
  const { deps } = makeBizDeps();
  const client = fakeClient([
    { stop_reason: 'end_turn', content: [{ type: 'text', text: '¡Hola! ¿En qué te ayudo?' }] }
  ]);
  const session = { state: 'MAIN', data: {}, lang: 'es' };
  const reply = await ai.handleWithAI(
    { from: '573001112233', text: 'hola, una pregunta', profileName: 'Ana' },
    session,
    { ...deps, anthropicClient: client }
  );
  assert.equal(reply, '¡Hola! ¿En qué te ayudo?');
  assert.equal(session.aiHistory.length, 2);
  assert.equal(session.aiHistory[0].content, 'hola, una pregunta');
  /* Request shape: stable system with cache breakpoint, tools present */
  const req = client.calls[0];
  assert.ok(Array.isArray(req.tools) && req.tools.length === 4);
  assert.deepEqual(req.system[0].cache_control, { type: 'ephemeral' });
  assert.deepEqual(req.thinking, { type: 'adaptive' });
});

test('tool loop: check_availability executes and result feeds the final answer', async () => {
  const { deps } = makeBizDeps();
  const client = fakeClient([
    {
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'Déjame revisar.' },
        { type: 'tool_use', id: 'tu_1', name: 'check_availability', input: { checkin: '2026-08-15', checkout: '2026-08-18', guests: 2 } }
      ]
    },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hay Clásica y Selección disponibles ✶' }] }
  ]);
  const session = { state: 'MAIN', data: {}, lang: 'es' };
  const reply = await ai.handleWithAI(
    { from: '573001112233', text: 'hay disponibilidad del 15 al 18 de agosto para 2?' },
    session,
    { ...deps, anthropicClient: client }
  );
  assert.match(reply, /Clásica y Selección/);
  /* Second call must carry the tool_result with the live data + deep link */
  const secondReq = client.calls[1];
  const lastMsg = secondReq.messages[secondReq.messages.length - 1];
  assert.equal(lastMsg.role, 'user');
  assert.equal(lastMsg.content[0].type, 'tool_result');
  const payload = JSON.parse(lastMsg.content[0].content);
  assert.equal(payload.nights, 3);
  assert.equal(payload.rooms.length, 2);
  assert.match(payload.bookingLink, /reservar\.html\?checkin=2026-08-15&checkout=2026-08-18&guests=2/);
});

test('executeTool: capacity filter and cancellation passthrough', async () => {
  const { deps } = makeBizDeps();
  const avail = JSON.parse(await ai.executeTool('check_availability',
    { checkin: '2026-08-15', checkout: '2026-08-18', guests: 4 },
    { ...deps, guestNumber: '57300', guestName: 'Ana' }));
  assert.equal(avail.rooms.length, 1);
  assert.equal(avail.rooms[0].name, 'Selección');

  const cancel = JSON.parse(await ai.executeTool('request_cancellation',
    { booking_code: 'EST-1', email_or_lastname: 'Pérez' },
    { ...deps, guestNumber: '57300' }));
  assert.deepEqual(cancel, { ok: true, code: 'submitted' });
});

test('executeTool: notify_team emails the admin with guest context', async () => {
  const { deps, sent } = makeBizDeps();
  const out = JSON.parse(await ai.executeTool('notify_team',
    { reason: 'long_stay_quote', summary: 'Quiere 3 meses desde septiembre, tipología Selección.' },
    { ...deps, guestNumber: '573001112233', guestName: 'Ana' }));
  assert.equal(out.notified, true);
  const email = sent.find(s => s.kind === 'email');
  assert.match(email.subject, /long_stay_quote/);
  assert.match(email.html, /573001112233/);
});

test('refusal stop_reason returns the polite fallback', async () => {
  const { deps } = makeBizDeps();
  const client = fakeClient([{ stop_reason: 'refusal', content: [] }]);
  const session = { state: 'MAIN', data: {}, lang: 'es' };
  const reply = await ai.handleWithAI(
    { from: '573001112233', text: 'x' }, session, { ...deps, anthropicClient: client });
  assert.match(reply, /agente/);
});

test('history is capped to the window', async () => {
  const { deps } = makeBizDeps();
  const client = fakeClient([
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }
  ]);
  const longHistory = [];
  for (let i = 0; i < 30; i++) longHistory.push({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` });
  const session = { state: 'MAIN', data: {}, lang: 'es', aiHistory: longHistory };
  await ai.handleWithAI({ from: '57300', text: 'última' }, session, { ...deps, anthropicClient: client });
  assert.equal(session.aiHistory.length, ai.MAX_HISTORY_MESSAGES);
  assert.equal(session.aiHistory[session.aiHistory.length - 2].content, 'última');
});

test('bot routes through AI when enabled and falls back to the menu when AI throws', async () => {
  const { deps, sent } = makeBizDeps();
  /* AI path answers the greeting */
  const okModule = {
    isEnabled: () => true,
    handleWithAI: async () => 'Respuesta IA ✶'
  };
  await bot.handleIncoming(
    { from: '573001112233', id: 'w1', type: 'text', text: 'hola' },
    { ...deps, aiModule: okModule }
  );
  assert.equal(sent[sent.length - 1].kind, 'text');
  assert.match(sent[sent.length - 1].body, /Respuesta IA/);

  /* AI failure → deterministic menu still answers */
  const failingModule = {
    isEnabled: () => true,
    handleWithAI: async () => { throw new Error('boom'); }
  };
  await bot.handleIncoming(
    { from: '573001112233', id: 'w2', type: 'text', text: 'hola' },
    { ...deps, aiModule: failingModule }
  );
  assert.equal(sent[sent.length - 1].kind, 'buttons');
});

test('agente keyword stays deterministic even with AI enabled', async () => {
  const { deps, sent } = makeBizDeps();
  const neverCalled = { isEnabled: () => true, handleWithAI: async () => { throw new Error('should not run'); } };
  await bot.handleIncoming(
    { from: '573001112233', id: 'w1', type: 'text', text: 'quiero un agente', profileName: 'Ana' },
    { ...deps, aiModule: neverCalled }
  );
  assert.ok(sent.find(s => s.kind === 'email'));
  assert.equal(sent[sent.length - 1].kind, 'text');
});
