/* Frente A — handler-level tests for validate-discount-code (public, read-only,
 * no-leak) and admin-discount-codes (authz gating). No real Blobs nor Firebase:
 * the feature flag and the absence of credentials drive the paths we assert. */

const test = require('node:test');
const assert = require('node:assert/strict');

function freshHandler(modPath) {
  const p = require.resolve(modPath);
  delete require.cache[p];
  return require(modPath);
}

function getEvent(query) {
  return { httpMethod: 'GET', queryStringParameters: query || {}, headers: {} };
}

async function withEnv(env, run) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  try { return await run(); }
  finally { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}

/* ── validate-discount-code ── */

test('validate-discount-code is OFF by default (enabled:false, no validation)', async () => {
  await withEnv({ DISCOUNT_CODES_ENABLED: undefined }, async () => {
    const mod = freshHandler('../../netlify/functions/validate-discount-code');
    const res = await mod.handler(getEvent({ code: 'ANY' }));
    const body = JSON.parse(res.body);
    assert.equal(res.statusCode, 200);
    assert.equal(body.enabled, false);
    assert.equal(body.valid, false);
    assert.equal(body.reason, 'disabled');
  });
});

test('validate-discount-code: unknown code never leaks not_found (reports generic "invalid")', async () => {
  await withEnv({ DISCOUNT_CODES_ENABLED: 'true', BLOBS_SITE_ID: undefined, NETLIFY_SITE_ID: undefined, SITE_ID: undefined }, async () => {
    const mod = freshHandler('../../netlify/functions/validate-discount-code');
    /* No Blobs configured -> loadCode returns null -> reason not_found, but the
       handler must surface the generic 'invalid' so codes can't be enumerated. */
    const res = await mod.handler(getEvent({ code: 'SECRET123', subtotalCents: '100000' }));
    const body = JSON.parse(res.body);
    assert.equal(res.statusCode, 200);
    assert.equal(body.enabled, true);
    assert.equal(body.valid, false);
    assert.equal(body.reason, 'invalid');
    assert.notEqual(body.reason, 'not_found');
  });
});

test('validate-discount-code: blank/garbage code -> invalid (still no leak)', async () => {
  await withEnv({ DISCOUNT_CODES_ENABLED: 'true' }, async () => {
    const mod = freshHandler('../../netlify/functions/validate-discount-code');
    const res = await mod.handler(getEvent({ code: '!!!' }));
    const body = JSON.parse(res.body);
    assert.equal(body.valid, false);
    assert.equal(body.reason, 'invalid');
  });
});

test('validate-discount-code rejects non-GET', async () => {
  await withEnv({ DISCOUNT_CODES_ENABLED: 'true' }, async () => {
    const mod = freshHandler('../../netlify/functions/validate-discount-code');
    const res = await mod.handler({ httpMethod: 'POST', headers: {}, queryStringParameters: {} });
    assert.equal(res.statusCode, 405);
  });
});

test('validate-discount-code _test.discountEnabled reflects the env flag', async () => {
  const mod = freshHandler('../../netlify/functions/validate-discount-code');
  await withEnv({ DISCOUNT_CODES_ENABLED: 'true' }, async () => { assert.equal(await mod._test.discountEnabled(), true); });
  await withEnv({ DISCOUNT_CODES_ENABLED: undefined }, async () => { assert.equal(await mod._test.discountEnabled(), false); });
});

/* ── admin-discount-codes ── */

test('admin-discount-codes requires auth (401 without a token)', async () => {
  await withEnv({ FIREBASE_PROJECT_ID: 'demo-project', GUEST_APP_DEMO_MODE: undefined }, async () => {
    const mod = freshHandler('../../netlify/functions/admin-discount-codes');
    const res = await mod.handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ action: 'list' }) });
    assert.equal(res.statusCode, 401);
  });
});

test('admin-discount-codes rejects an unknown action before auth check matters (400)', async () => {
  await withEnv({ FIREBASE_PROJECT_ID: 'demo-project' }, async () => {
    const mod = freshHandler('../../netlify/functions/admin-discount-codes');
    const res = await mod.handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ action: 'nope' }) });
    assert.equal(res.statusCode, 400);
  });
});

test('admin-discount-codes rejects non-POST', async () => {
  const mod = freshHandler('../../netlify/functions/admin-discount-codes');
  const res = await mod.handler({ httpMethod: 'GET', headers: {} });
  assert.equal(res.statusCode, 405);
});
