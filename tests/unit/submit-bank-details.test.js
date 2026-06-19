'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

process.env.REFUND_BANK_FORM_ENABLED = 'true';
process.env.REFUND_LINK_SECRET = 'test-submit-secret';
delete process.env.RESEND_API_KEY; // keep treasury email a no-op

/* Shared in-memory @netlify/blobs mock (refunds store + rate-limit buckets). */
const registry = new Map();
function memStore(name) {
  if (!registry.has(name)) {
    const m = new Map();
    let etag = 0;
    registry.set(name, {
      _m: m,
      async set(key, value, opts = {}) {
        if (opts.onlyIfNew && m.has(key)) return { modified: false };
        if (opts.onlyIfMatch && (!m.has(key) || m.get(key).etag !== opts.onlyIfMatch)) return { modified: false };
        m.set(key, { value, etag: String(++etag) });
        return { modified: true };
      },
      async get(key) { return m.has(key) ? m.get(key).value : null; },
      async getWithMetadata(key, opts = {}) {
        if (!m.has(key)) return null;
        const e = m.get(key);
        return { data: opts.type === 'json' ? JSON.parse(e.value) : e.value, etag: e.etag, metadata: {} };
      },
      async list() { return { blobs: Array.from(m.keys()).map(key => ({ key })) }; },
      async delete(key) { m.delete(key); }
    });
  }
  return registry.get(name);
}
const blobsPath = require.resolve('@netlify/blobs');
require.cache[blobsPath] = { id: blobsPath, filename: blobsPath, loaded: true, exports: { getStore: (opts) => memStore(opts.name) } };

const { signBankDetailsToken, getRefund } = require('../../netlify/functions/_refunds-store');
const { handler } = require('../../netlify/functions/submit-bank-details');

function seedRefund(code, over) {
  const rec = Object.assign({
    bookingCode: code, refundId: 'REF-' + code, route: 'MANUAL_BANK',
    status: 'NEEDS_BANK_DETAILS', guestName: 'Ana', guestEmail: 'ana@x.co', auditLog: []
  }, over || {});
  memStore('refunds')._m.set(code, { value: JSON.stringify(rec), etag: '1' });
}
function ev(body) { return { httpMethod: 'POST', headers: { 'x-forwarded-for': '203.0.113.' + Math.floor(Math.random() * 0) + '9' }, body: JSON.stringify(body) }; }
const validBank = { bankName: 'Bancolombia', accountType: 'ahorros', accountNumber: '12345', holderName: 'Ana Ruiz', docType: 'CC', docNumber: '999' };

test('404 when REFUND_BANK_FORM_ENABLED is off', async () => {
  process.env.REFUND_BANK_FORM_ENABLED = 'false';
  const r = await handler(ev({ code: 'EST-1', token: 'x' }));
  assert.equal(r.statusCode, 404);
  process.env.REFUND_BANK_FORM_ENABLED = 'true';
});

test('invalid token → uniform negative (anti-enumeration), 200', async () => {
  seedRefund('EST-AAAAA');
  const r = await handler(ev(Object.assign({ code: 'EST-AAAAA', token: 'not-a-valid-token' }, validBank)));
  assert.equal(r.statusCode, 200);
  assert.deepEqual(JSON.parse(r.body), { ok: false, error: 'invalid_or_expired' });
});

test('valid token but code mismatch → same uniform negative', async () => {
  const token = signBankDetailsToken('EST-BBBBB');
  const r = await handler(ev(Object.assign({ code: 'EST-CCCCC', token }, validBank)));
  assert.deepEqual(JSON.parse(r.body), { ok: false, error: 'invalid_or_expired' });
});

test('valid token, refund not found → same uniform negative (no code disclosure)', async () => {
  const token = signBankDetailsToken('EST-NONE');
  const r = await handler(ev(Object.assign({ code: 'EST-NONE', token }, validBank)));
  assert.deepEqual(JSON.parse(r.body), { ok: false, error: 'invalid_or_expired' });
});

test('valid token + invalid fields → 400 invalid_fields', async () => {
  seedRefund('EST-FIELDS');
  const token = signBankDetailsToken('EST-FIELDS');
  const r = await handler(ev({ code: 'EST-FIELDS', token, bankName: '', accountType: 'x', accountNumber: '', holderName: '', docType: 'ZZ', docNumber: '' }));
  assert.equal(r.statusCode, 400);
  assert.equal(JSON.parse(r.body).error, 'invalid_fields');
});

test('happy path: saves details and moves refund to BANK_DETAILS_READY', async () => {
  seedRefund('EST-OK');
  const token = signBankDetailsToken('EST-OK');
  const r = await handler(ev(Object.assign({ code: 'EST-OK', token }, validBank)));
  assert.deepEqual(JSON.parse(r.body), { ok: true });
  const refund = await getRefund('EST-OK');
  assert.equal(refund.status, 'BANK_DETAILS_READY');
  assert.equal(refund.bankDetails.accountNumber, '12345');
});

test('second submit after READY → not ok (already), no re-disclosure', async () => {
  const token = signBankDetailsToken('EST-OK');
  const r = await handler(ev(Object.assign({ code: 'EST-OK', token }, validBank)));
  assert.equal(JSON.parse(r.body).ok, false);
});
