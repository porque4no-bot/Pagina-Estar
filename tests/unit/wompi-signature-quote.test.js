/* Unit tests for create-wompi-signature: ensure the amount signed for a
 * quote payment comes from the server-stored quote, not from the cliente. */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function load(quotesStub) {
  /* Stub _quotes-store for the duration of this load. */
  const resolvedStore = require.resolve('../../netlify/functions/_quotes-store');
  const resolvedFn = require.resolve('../../netlify/functions/create-wompi-signature');
  const original = require.cache[resolvedStore];
  require.cache[resolvedStore] = {
    id: resolvedStore,
    filename: resolvedStore,
    loaded: true,
    exports: quotesStub
  };
  delete require.cache[resolvedFn];
  const fn = require('../../netlify/functions/create-wompi-signature');
  if (original) require.cache[resolvedStore] = original; else delete require.cache[resolvedStore];
  delete require.cache[resolvedFn];
  return fn;
}

function makeEvent({ method = 'POST', body = {} } = {}) {
  return { httpMethod: method, body: JSON.stringify(body), headers: {} };
}

test('signs the cliente amount for non-quote references (direct booking)', async () => {
  process.env.WOMPI_INTEGRITY_SECRET = 'test_integrity_xxxx';
  process.env.WOMPI_PUBLIC_KEY = 'pub_test_xxxx';
  delete process.env.ALLOWED_ORIGIN;

  const stub = {
    getQuoteStore: () => { throw new Error('should not be called'); },
    loadQuote: async () => { throw new Error('should not be called'); },
    effectiveStatus: () => { throw new Error('should not be called'); },
    computeQuoteTotal: () => { throw new Error('should not be called'); }
  };
  const fn = load(stub);
  const res = await fn.handler(makeEvent({ body: {
    reference: 'EST-DIRECT-123', amountInCents: 119000, currency: 'COP'
  } }));
  assert.equal(res.statusCode, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.reference, 'EST-DIRECT-123');
  assert.equal(json.amountInCents, 119000);
  assert.ok(json.signature.integrity);
});

test('signs the server-computed total for a quote payment, ignoring cliente amount', async () => {
  process.env.WOMPI_INTEGRITY_SECRET = 'test_integrity_xxxx';
  process.env.WOMPI_PUBLIC_KEY = 'pub_test_xxxx';

  const stub = {
    getQuoteStore: () => ({}),
    loadQuote: async () => ({ quoteId: 'COT-2026-ABCDE', status: 'activa' }),
    effectiveStatus: () => 'activa',
    computeQuoteTotal: () => ({ totalCents: 23800000 })  /* server says 238.000 */
  };
  const fn = load(stub);
  const res = await fn.handler(makeEvent({ body: {
    reference: 'COT-2026-ABCDE',
    amountInCents: 1,  /* cliente tries to pay only 1 cent */
    currency: 'COP'
  } }));
  assert.equal(res.statusCode, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.amountInCents, 23800000);
  /* Verify the integrity signature is computed against the server amount,
     not the cliente amount. */
  const crypto = require('crypto');
  const expected = crypto.createHash('sha256')
    .update('COT-2026-ABCDE' + 23800000 + 'COP' + 'test_integrity_xxxx')
    .digest('hex');
  assert.equal(json.signature.integrity, expected);
});

test('rejects payment signature for a cancelled quote', async () => {
  process.env.WOMPI_INTEGRITY_SECRET = 'test_integrity_xxxx';
  process.env.WOMPI_PUBLIC_KEY = 'pub_test_xxxx';

  const stub = {
    getQuoteStore: () => ({}),
    loadQuote: async () => ({ quoteId: 'COT-2026-ABCDE', status: 'cancelada' }),
    effectiveStatus: () => 'cancelada',
    computeQuoteTotal: () => ({ totalCents: 0 })
  };
  const fn = load(stub);
  const res = await fn.handler(makeEvent({ body: {
    reference: 'COT-2026-ABCDE', amountInCents: 23800000, currency: 'COP'
  } }));
  assert.equal(res.statusCode, 409);
  assert.match(JSON.parse(res.body).error, /cancelada/);
});

test('rejects payment signature for an already accepted quote', async () => {
  process.env.WOMPI_INTEGRITY_SECRET = 'test_integrity_xxxx';
  process.env.WOMPI_PUBLIC_KEY = 'pub_test_xxxx';

  const stub = {
    getQuoteStore: () => ({}),
    loadQuote: async () => ({ quoteId: 'COT-2026-ABCDE', status: 'aceptada' }),
    effectiveStatus: () => 'aceptada',
    computeQuoteTotal: () => ({ totalCents: 23800000 })
  };
  const fn = load(stub);
  const res = await fn.handler(makeEvent({ body: {
    reference: 'COT-2026-ABCDE', amountInCents: 23800000, currency: 'COP'
  } }));
  assert.equal(res.statusCode, 409);
  assert.match(JSON.parse(res.body).error, /aceptada/);
});

test('returns 404 for an unknown quote reference', async () => {
  process.env.WOMPI_INTEGRITY_SECRET = 'test_integrity_xxxx';
  process.env.WOMPI_PUBLIC_KEY = 'pub_test_xxxx';

  const stub = {
    getQuoteStore: () => ({}),
    loadQuote: async () => null,
    effectiveStatus: () => 'activa',
    computeQuoteTotal: () => ({ totalCents: 0 })
  };
  const fn = load(stub);
  const res = await fn.handler(makeEvent({ body: {
    reference: 'COT-2026-ZZZZZ', amountInCents: 1000, currency: 'COP'
  } }));
  assert.equal(res.statusCode, 404);
});
