/* Sprint 2 (Mesa Redonda C5) — reconcile-payments extendido a Mercado Pago +
 * arreglo del riesgo sutil: una reserva DIRECTA marcada 'processed' pero con
 * reservationPending:true en booking-results DEBE seguir reportándose (no se omite
 * por processed). Mock de @netlify/blobs + global.fetch. node --test aísla el
 * archivo en su proceso → la cache no se filtra. */

const test = require('node:test');
const assert = require('node:assert/strict');

const BLOBS = require.resolve('@netlify/blobs');
/* createDirectReference es una función pura; la tomamos una vez para construir
   referencias MP de prueba (independiente de la instancia recargada en load()). */
const payments = require('../../netlify/functions/_payments');

function makeBlobs(seed = {}) {
  const buckets = new Map();
  const bucket = (name) => { if (!buckets.has(name)) buckets.set(name, new Map()); return buckets.get(name); };
  for (const [name, entries] of Object.entries(seed)) {
    const b = bucket(name);
    for (const [k, v] of Object.entries(entries)) b.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  const getStore = (opts) => {
    const name = typeof opts === 'string' ? opts : opts.name;
    const b = bucket(name);
    return {
      async get(k) { return b.has(k) ? b.get(k) : null; },
      async set(k, v) { b.set(k, v); return { modified: true }; },
      async delete(k) { b.delete(k); },
      async getWithMetadata(k) { return b.has(k) ? { data: b.get(k), etag: 'e' } : null; },
      async list() { return { blobs: [...b.keys()].map(key => ({ key })) }; }
    };
  };
  return { getStore, buckets };
}

/* Carga reconcile-payments fresco con un mock de blobs y un fetch dado. */
function load({ seed = {}, fetchImpl, env = {} } = {}) {
  const blobs = makeBlobs(seed);
  require.cache[BLOBS] = { id: BLOBS, filename: BLOBS, loaded: true, exports: { getStore: blobs.getStore } };
  const savedEnv = {};
  const envKeys = ['WOMPI_PRIVATE_KEY', 'MERCADOPAGO_ACCESS_TOKEN', 'PAYMENT_PROVIDER', 'WOMPI_SANDBOX', 'RESEND_API_KEY'];
  for (const k of envKeys) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const origFetch = global.fetch;
  if (fetchImpl) global.fetch = fetchImpl;

  // limpiar módulos que cierran sobre getStore al cargar
  for (const m of ['reconcile-payments', '_payments', '_quotes-store', '_direct-pricing', '_otasync']) {
    try { delete require.cache[require.resolve('../../netlify/functions/' + m)]; } catch (e) {}
  }
  const recon = require('../../netlify/functions/reconcile-payments');
  const payments = require('../../netlify/functions/_payments');
  const cleanup = () => {
    global.fetch = origFetch;
    for (const k of envKeys) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
    delete require.cache[BLOBS];
  };
  return { recon, payments, blobs, cleanup };
}

function mpPayment(extRef, id, amount) {
  return { id, external_reference: extRef, transaction_amount: amount, status: 'approved', date_created: new Date(Date.now() - 60000).toISOString() };
}

test('fetchRecentApprovedMP: sin token → skip limpio', async () => {
  const { recon, cleanup } = load({});
  try {
    const r = await recon._test.fetchRecentApprovedMP();
    assert.deepEqual(r.transactions, []);
    assert.match(r.reason, /not configured/);
  } finally { cleanup(); }
});

test('fetchRecentApprovedMP: lee una página de la Search API', async () => {
  const fetchImpl = async (url) => {
    assert.match(String(url), /api\.mercadopago\.com\/v1\/payments\/search/);
    return new Response(JSON.stringify({ results: [mpPayment('MPDIR-x', '111', 100000)], paging: { total: 1, limit: 50, offset: 0 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const { recon, cleanup } = load({ env: { MERCADOPAGO_ACCESS_TOKEN: 'tok' }, fetchImpl });
  try {
    const r = await recon._test.fetchRecentApprovedMP();
    assert.equal(r.transactions.length, 1);
    assert.equal(r.transactions[0].id, '111');
  } finally { cleanup(); }
});

test('handler: pago directo MP sin reserva → huérfano reportado', async () => {
  const ref = payments.createDirectReference({ checkin: '2026-08-01', checkout: '2026-08-03', guestsCount: 1, roomTypeId: '31348', firstName: 'Ana', lastName: 'R', email: 'a@x.co', phone: '300', extrasMask: '0000000', bookingCode: 'EST-MP-1', amountCents: 30000000 });
  const fetchImpl = async (url) => {
    if (String(url).includes('mercadopago')) {
      return new Response(JSON.stringify({ results: [mpPayment(ref, 'MP-1', 300000)], paging: { total: 1 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error('unexpected ' + url);
  };
  const ctx = load({ env: { MERCADOPAGO_ACCESS_TOKEN: 'tok' }, fetchImpl, seed: {} });
  try {
    const res = await ctx.recon.handler();
    const body = JSON.parse(res.body);
    assert.equal(body.orphans, 1, 'el pago MP sin reserva es huérfano');
  } finally { ctx.cleanup(); }
});

test('handler (FIX riesgo sutil): directo PROCESADO pero reservationPending → SE reporta', async () => {
  const built = load({});
  built.cleanup();
  const ref = built.payments.createDirectReference({ checkin: '2026-08-10', checkout: '2026-08-12', guestsCount: 1, roomTypeId: '31349', firstName: 'B', lastName: 'C', email: 'b@x.co', phone: '300', extrasMask: '0000000', bookingCode: 'EST-MP-2', amountCents: 25000000 });

  const fetchImpl = async (url) => {
    if (String(url).includes('mercadopago')) {
      return new Response(JSON.stringify({ results: [mpPayment(ref, 'MP-2', 250000)], paging: { total: 1 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error('unexpected ' + url);
  };
  const ctx = load({
    env: { MERCADOPAGO_ACCESS_TOKEN: 'tok' },
    fetchImpl,
    seed: {
      'processed-transactions': { 'MP-2': '1' }, // YA marcado processed (mark-before-work)
      'booking-results': { 'direct-EST-MP-2': { bookingCode: 'EST-MP-2', reservationPending: true, reason: 'insert_failed' } }
    }
  });
  try {
    const res = await ctx.recon.handler();
    const body = JSON.parse(res.body);
    assert.equal(body.orphans, 1, 'processed pero pending → debe reportarse (no se omite por processed)');
  } finally { ctx.cleanup(); }
});

test('handler: directo con reserva creada (booking-results sin pending) → NO se reporta', async () => {
  const ref = payments.createDirectReference({ checkin: '2026-08-20', checkout: '2026-08-22', guestsCount: 1, roomTypeId: '31350', firstName: 'D', lastName: 'E', email: 'd@x.co', phone: '300', extrasMask: '0000000', bookingCode: 'EST-MP-3', amountCents: 25000000 });
  const fetchImpl = async (url) => {
    if (String(url).includes('mercadopago')) {
      return new Response(JSON.stringify({ results: [mpPayment(ref, 'MP-3', 250000)], paging: { total: 1 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error('unexpected ' + url);
  };
  const ctx = load({
    env: { MERCADOPAGO_ACCESS_TOKEN: 'tok' },
    fetchImpl,
    seed: { 'booking-results': { 'direct-EST-MP-3': { bookingCode: 'RES-999', reservationPending: false } } }
  });
  try {
    const res = await ctx.recon.handler();
    /* sin huérfanos el handler devuelve un body de texto, no JSON */
    assert.match(res.body, /no orphans/);
  } finally { ctx.cleanup(); }
});

test('handler: fallo del fetch MP NO impide reportar huérfanos de Wompi (try/catch independiente)', async () => {
  const dp = require('../../netlify/functions/_direct-pricing');
  const wRef = dp.createDirectReference
    ? dp.createDirectReference({ checkin: '2026-09-01', checkout: '2026-09-03', guestsCount: 1, roomTypeId: '31348', firstName: 'W', lastName: 'P', email: 'w@x.co', phone: '300', extrasMask: '0000000', bookingCode: 'EST-W-1', amountCents: 20000000 })
    : null;

  const fetchImpl = async (url) => {
    const s = String(url);
    if (s.includes('mercadopago')) throw new Error('MP API down');
    if (s.includes('wompi') || s.includes('/transactions')) {
      return new Response(JSON.stringify({ data: [{ id: 'W-1', reference: wRef, amount_in_cents: 20000000, created_at: new Date(Date.now() - 60000).toISOString() }], meta: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error('unexpected ' + url);
  };
  const ctx = load({ env: { WOMPI_PRIVATE_KEY: 'wk', MERCADOPAGO_ACCESS_TOKEN: 'tok' }, fetchImpl, seed: {} });
  try {
    if (!wRef) { ctx.cleanup(); return; } // si el decoder Wompi no expone createDirectReference, omitir
    const res = await ctx.recon.handler();
    const body = JSON.parse(res.body);
    assert.equal(body.orphans, 1, 'el huérfano de Wompi se reporta aunque MP falle');
  } finally { ctx.cleanup(); }
});
