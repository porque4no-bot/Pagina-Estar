'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { reportAlert } = require('../../netlify/functions/_alert');
const { stableHash, alertHtml } = require('../../netlify/functions/_alert')._test;

/* In-memory Blobs stub mimicking @netlify/blobs set(onlyIfNew)/getWithMetadata. */
function memStore() {
  const m = new Map();
  let etag = 0;
  return {
    _m: m,
    async set(key, value, opts = {}) {
      if (opts.onlyIfNew && m.has(key)) return { modified: false };
      if (opts.onlyIfMatch && (!m.has(key) || m.get(key).etag !== opts.onlyIfMatch)) return { modified: false };
      m.set(key, { value, etag: String(++etag) });
      return { modified: true };
    },
    async getWithMetadata(key) {
      if (!m.has(key)) return null;
      const e = m.get(key);
      return { data: JSON.parse(e.value), etag: e.etag };
    }
  };
}

function makeDeps(store, sent, { now = 1_000_000 } = {}) {
  return {
    sendEmail: async (msg) => { sent.push(msg); return { sent: true }; },
    adminEmail: () => 'team@estar.test',
    getStore: () => store,
    logger: { warn() {}, error() {} },
    now: () => now
  };
}

test('reportAlert sends an email the first time and dedupes within the TTL', async () => {
  const store = memStore();
  const sent = [];
  const deps = makeDeps(store, sent);

  const r1 = await reportAlert({ kind: 'otasync_insert_failed', message: 'boom', context: { ref: 'EST-1' }, deps });
  assert.equal(r1.alerted, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /otasync_insert_failed/);

  const r2 = await reportAlert({ kind: 'otasync_insert_failed', message: 'boom', context: { ref: 'EST-1' }, deps });
  assert.equal(r2.alerted, false);
  assert.equal(r2.reason, 'deduped');
  assert.equal(sent.length, 1, 'no second email within TTL');
});

test('reportAlert re-alerts once the dedupe TTL has elapsed', async () => {
  const store = memStore();
  const sent = [];
  await reportAlert({ kind: 'k', message: 'm', ttlSec: 60, deps: makeDeps(store, sent, { now: 1_000_000 }) });
  assert.equal(sent.length, 1);
  // 2 minutes later (> 60s ttl) → re-arm and send again
  await reportAlert({ kind: 'k', message: 'm', ttlSec: 60, deps: makeDeps(store, sent, { now: 1_000_000 + 120_000 }) });
  assert.equal(sent.length, 2);
});

test('distinct fingerprints alert independently', async () => {
  const store = memStore();
  const sent = [];
  const deps = makeDeps(store, sent);
  await reportAlert({ kind: 'a', message: 'one', deps });
  await reportAlert({ kind: 'b', message: 'two', deps });
  assert.equal(sent.length, 2);
});

test('explicit dedupeKey collapses different messages into one alert', async () => {
  const store = memStore();
  const sent = [];
  const deps = makeDeps(store, sent);
  await reportAlert({ kind: 'x', message: 'first', dedupeKey: 'fixed', deps });
  await reportAlert({ kind: 'x', message: 'second', dedupeKey: 'fixed', deps });
  assert.equal(sent.length, 1);
});

test('ALERT_ENABLED=false suppresses the email (kill switch) but still returns', async () => {
  const store = memStore();
  const sent = [];
  const prev = process.env.ALERT_ENABLED;
  process.env.ALERT_ENABLED = 'false';
  try {
    const r = await reportAlert({ kind: 'k', message: 'm', deps: makeDeps(store, sent) });
    assert.equal(r.alerted, false);
    assert.equal(r.reason, 'disabled');
    assert.equal(sent.length, 0);
  } finally {
    if (prev === undefined) delete process.env.ALERT_ENABLED; else process.env.ALERT_ENABLED = prev;
  }
});

test('reportAlert never throws and fails open when the store errors', async () => {
  const sent = [];
  const deps = {
    sendEmail: async (msg) => { sent.push(msg); return { sent: true }; },
    adminEmail: () => 'team@estar.test',
    getStore: () => { throw new Error('no blobs'); },
    logger: { warn() {}, error() {} },
    now: () => 1
  };
  const r = await reportAlert({ kind: 'k', message: 'm', deps });
  assert.equal(r.alerted, true, 'fails open: alert still sent when dedupe store is unavailable');
  assert.equal(sent.length, 1);
});

test('a throwing sendEmail is swallowed (best-effort)', async () => {
  const store = memStore();
  const deps = {
    sendEmail: async () => { throw new Error('resend down'); },
    adminEmail: () => 'team@estar.test',
    getStore: () => store,
    logger: { warn() {}, error() {} },
    now: () => 1
  };
  const r = await reportAlert({ kind: 'k', message: 'm', deps });
  assert.equal(r.alerted, false);
  assert.equal(r.reason, 'error');
});

test('stableHash is deterministic and short; template escapes context', () => {
  assert.equal(stableHash('abc'), stableHash('abc'));
  assert.equal(stableHash('abc').length, 16);
  const html = alertHtml({ kind: 'k', severity: 'critical', message: '<x>', context: { a: '<b>' }, at: 'now' });
  assert.ok(!html.includes('<x>'), 'message is escaped');
  assert.ok(html.includes('&lt;b&gt;'), 'context value is escaped');
});
