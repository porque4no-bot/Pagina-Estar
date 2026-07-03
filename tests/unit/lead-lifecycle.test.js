/* revalidate-quotes: sincronización del ciclo de vida del lead CRM (Odoo) con
   el estado de las cotizaciones. Prueba syncLeadLifecycle de forma aislada con
   un Odoo inyectado (sin red) y un store de Blobs simulado. Sin credenciales de
   Odoo es no-op (mock-safe). */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { _test } = require(path.join(__dirname, '../../netlify/functions/revalidate-quotes.js'));
const { syncLeadLifecycle } = _test;

/* Store de Blobs simulado: solo necesita set() (saveQuote escribe por quoteId).
   Guarda las cotizaciones guardadas para verificar persistencia idempotente. */
function fakeStore() {
  const saved = {};
  return {
    saved,
    async set(key, value) { saved[key] = JSON.parse(value); },
    async get(key) { return saved[key] ? JSON.stringify(saved[key]) : null; }
  };
}

/* Odoo inyectado: registra las llamadas a markLeadWonByQuote / markLeadLost. */
function fakeOdoo({ configured = true, wonId = 100, lostId = 200 } = {}) {
  const calls = { won: [], lost: [] };
  return {
    calls,
    isConfigured: () => configured,
    markLeadWonByQuote: async (q) => { calls.won.push(q); return { id: wonId, won: true, isMock: !configured }; },
    markLeadLost: async (q, reason) => { calls.lost.push({ q, reason }); return { id: lostId, lost: true, isMock: !configured }; }
  };
}

const future = new Date(Date.now() + 30 * 86400000).toISOString();
const past = new Date(Date.now() - 86400000).toISOString();

test('cotización aceptada → lead ganado (y persiste el desenlace)', async () => {
  const store = fakeStore();
  const odoo = fakeOdoo();
  const quotes = [{ quoteId: 'COT-1', email: 'a@b.co', status: 'aceptada', expiresAt: future }];
  const r = await syncLeadLifecycle(store, quotes, { odoo });
  assert.equal(r.won, 1);
  assert.equal(r.lost, 0);
  assert.equal(odoo.calls.won.length, 1);
  assert.equal(odoo.calls.won[0].quoteId, 'COT-1');
  // persistió el desenlace + leadId devuelto
  assert.equal(store.saved['COT-1'].leadLifecycle, 'won');
  assert.equal(store.saved['COT-1'].leadId, 100);
  assert.ok(store.saved['COT-1'].leadLifecycleAt);
});

test('cotización cancelada → lead perdido con motivo', async () => {
  const store = fakeStore();
  const odoo = fakeOdoo();
  const quotes = [{ quoteId: 'COT-2', email: 'a@b.co', status: 'cancelada', expiresAt: future }];
  const r = await syncLeadLifecycle(store, quotes, { odoo });
  assert.equal(r.lost, 1);
  assert.equal(odoo.calls.lost.length, 1);
  assert.match(odoo.calls.lost[0].reason, /cancelada/i);
  assert.equal(store.saved['COT-2'].leadLifecycle, 'lost');
});

test('cotización vencida (por expiresAt en el pasado) → lead perdido', async () => {
  const store = fakeStore();
  const odoo = fakeOdoo();
  // status activa pero expiró → effectiveStatus = 'vencida'
  const quotes = [{ quoteId: 'COT-3', email: 'a@b.co', status: 'activa', expiresAt: past }];
  const r = await syncLeadLifecycle(store, quotes, { odoo });
  assert.equal(r.lost, 1);
  assert.match(odoo.calls.lost[0].reason, /vencida/i);
  assert.equal(store.saved['COT-3'].leadLifecycle, 'lost');
});

test('cotización activa vigente → no toca el lead', async () => {
  const store = fakeStore();
  const odoo = fakeOdoo();
  const quotes = [{ quoteId: 'COT-4', email: 'a@b.co', status: 'activa', expiresAt: future }];
  const r = await syncLeadLifecycle(store, quotes, { odoo });
  assert.equal(r.won, 0);
  assert.equal(r.lost, 0);
  assert.equal(odoo.calls.won.length + odoo.calls.lost.length, 0);
  assert.equal(store.saved['COT-4'], undefined);
});

test('idempotente: no re-sincroniza si ya quedó en el mismo desenlace', async () => {
  const store = fakeStore();
  const odoo = fakeOdoo();
  const quotes = [{ quoteId: 'COT-5', email: 'a@b.co', status: 'aceptada', expiresAt: future, leadLifecycle: 'won' }];
  const r = await syncLeadLifecycle(store, quotes, { odoo });
  assert.equal(r.won, 0);
  assert.equal(odoo.calls.won.length, 0);
  assert.equal(store.saved['COT-5'], undefined); // no re-escribe
});

test('cambia de ganado a perdido si la cotización pasó a cancelada', async () => {
  const store = fakeStore();
  const odoo = fakeOdoo();
  // antes marcada won, ahora cancelada → se actualiza a lost
  const quotes = [{ quoteId: 'COT-6', email: 'a@b.co', status: 'cancelada', expiresAt: future, leadLifecycle: 'won' }];
  const r = await syncLeadLifecycle(store, quotes, { odoo });
  assert.equal(r.lost, 1);
  assert.equal(store.saved['COT-6'].leadLifecycle, 'lost');
});

test('sin credenciales de Odoo es no-op (mock-safe)', async () => {
  const store = fakeStore();
  const odoo = fakeOdoo({ configured: false });
  const quotes = [{ quoteId: 'COT-7', email: 'a@b.co', status: 'aceptada', expiresAt: future }];
  const r = await syncLeadLifecycle(store, quotes, { odoo });
  assert.deepEqual(r, { won: 0, lost: 0 });
  assert.equal(store.saved['COT-7'], undefined);
});

test('no fatal: un error de Odoo en una cotización no detiene a las demás', async () => {
  const store = fakeStore();
  const odoo = fakeOdoo();
  let n = 0;
  odoo.markLeadWonByQuote = async (q) => {
    n++;
    if (q.quoteId === 'COT-A') throw new Error('Odoo caído');
    return { id: 100, won: true, isMock: false };
  };
  const quotes = [
    { quoteId: 'COT-A', email: 'a@b.co', status: 'aceptada', expiresAt: future },
    { quoteId: 'COT-B', email: 'b@b.co', status: 'aceptada', expiresAt: future }
  ];
  const r = await syncLeadLifecycle(store, quotes, { odoo });
  assert.equal(n, 2);                 // intentó las dos
  assert.equal(r.won, 1);             // solo COT-B contó
  assert.equal(store.saved['COT-B'].leadLifecycle, 'won');
  assert.equal(store.saved['COT-A'], undefined);
});

test('respuesta isMock de Odoo no marca el desenlace en la cotización', async () => {
  const store = fakeStore();
  const odoo = fakeOdoo();
  odoo.markLeadWonByQuote = async () => ({ id: null, won: false, isMock: true });
  const quotes = [{ quoteId: 'COT-8', email: 'a@b.co', status: 'aceptada', expiresAt: future }];
  const r = await syncLeadLifecycle(store, quotes, { odoo });
  assert.equal(r.won, 0);
  assert.equal(store.saved['COT-8'], undefined);
});
