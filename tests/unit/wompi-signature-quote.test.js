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

function encodeDirectRef(parts) {
  return Buffer.from(parts.join('|'), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

test('rejects a non-encoded direct reference as invalid', async () => {
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
  /* The literal 'EST-DIRECT-123' is not a quote id nor a base64 reservation
     payload, so the signer refuses it. Production references are always
     produced by motor-app.jsx and are URL-safe base64. */
  const res = await fn.handler(makeEvent({ body: {
    reference: 'EST-DIRECT-123', amountInCents: 119000, currency: 'COP'
  } }));
  assert.equal(res.statusCode, 400);
  const json = JSON.parse(res.body);
  assert.equal(json.error, 'invalid_reference');
});

test('signs an encoded direct reference when OTASync mock fallback is active', async () => {
  /* Without OTASync credentials the recompute returns isMock and the signer
     accepts the cliente amount as a dev-only fallback. */
  const originalCreds = {
    OTASYNC_TOKEN: process.env.OTASYNC_TOKEN,
    OTASYNC_USERNAME: process.env.OTASYNC_USERNAME,
    OTASYNC_PASSWORD: process.env.OTASYNC_PASSWORD
  };
  delete process.env.OTASYNC_TOKEN;
  delete process.env.OTASYNC_USERNAME;
  delete process.env.OTASYNC_PASSWORD;
  process.env.WOMPI_INTEGRITY_SECRET = 'test_integrity_xxxx';
  process.env.WOMPI_PUBLIC_KEY = 'pub_test_xxxx';
  delete process.env.ALLOWED_ORIGIN;

  /* Drop cached modules so the absent credentials are observed. */
  const otaPath = require.resolve('../../netlify/functions/_otasync');
  const dpPath = require.resolve('../../netlify/functions/_direct-pricing');
  delete require.cache[otaPath];
  delete require.cache[dpPath];

  const stub = {
    getQuoteStore: () => { throw new Error('should not be called'); },
    loadQuote: async () => { throw new Error('should not be called'); },
    effectiveStatus: () => { throw new Error('should not be called'); },
    computeQuoteTotal: () => { throw new Error('should not be called'); }
  };

  try {
    const fn = load(stub);
    const ref = encodeDirectRef(['1', '260701', '260703', '2', '31348', 'Ana', 'Lopez', 'a@b.co', '+57 300 000 0000', '000000', 'EST-ABCDE', '1', '0']);
    const res = await fn.handler(makeEvent({ body: {
      reference: ref, amountInCents: 50200000, currency: 'COP'
    } }));
    assert.equal(res.statusCode, 200);
    const json = JSON.parse(res.body);
    assert.equal(json.reference, ref);
    assert.equal(json.amountInCents, 50200000);
    assert.ok(json.signature.integrity);
  } finally {
    for (const [k, v] of Object.entries(originalCreds)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    delete require.cache[otaPath];
    delete require.cache[dpPath];
  }
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

test('fails closed in production if OTASync mock fallback is active', async () => {
  const originalEnv = {
    OTASYNC_TOKEN: process.env.OTASYNC_TOKEN,
    OTASYNC_USERNAME: process.env.OTASYNC_USERNAME,
    OTASYNC_PASSWORD: process.env.OTASYNC_PASSWORD,
    NODE_ENV: process.env.NODE_ENV,
    NETLIFY: process.env.NETLIFY
  };
  delete process.env.OTASYNC_TOKEN;
  delete process.env.OTASYNC_USERNAME;
  delete process.env.OTASYNC_PASSWORD;
  process.env.NODE_ENV = 'production';
  process.env.NETLIFY = 'true';
  process.env.WOMPI_INTEGRITY_SECRET = 'test_integrity_xxxx';
  process.env.WOMPI_PUBLIC_KEY = 'pub_test_xxxx';

  const otaPath = require.resolve('../../netlify/functions/_otasync');
  const dpPath = require.resolve('../../netlify/functions/_direct-pricing');
  delete require.cache[otaPath];
  delete require.cache[dpPath];

  const stub = {
    getQuoteStore: () => { throw new Error('should not be called'); },
    loadQuote: async () => { throw new Error('should not be called'); },
    effectiveStatus: () => { throw new Error('should not be called'); },
    computeQuoteTotal: () => { throw new Error('should not be called'); }
  };

  try {
    const fn = load(stub);
    const ref = encodeDirectRef(['1', '260701', '260703', '2', '31348', 'Ana', 'Lopez', 'a@b.co', '+57 300 000 0000', '000000', 'EST-ABCDE', '1', '0']);
    const res = await fn.handler(makeEvent({ body: {
      reference: ref, amountInCents: 50200000, currency: 'COP'
    } }));
    assert.equal(res.statusCode, 503);
    const json = JSON.parse(res.body);
    assert.equal(json.error, 'OTASync credentials missing');
  } finally {
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    delete require.cache[otaPath];
    delete require.cache[dpPath];
  }
});
