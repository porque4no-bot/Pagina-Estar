'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

/* ── In-memory @netlify/blobs mock, installed before requiring the modules ── */
const registry = new Map();
function memStore(name) {
  if (!registry.has(name)) {
    const m = new Map();
    registry.set(name, {
      _m: m,
      async set(key, value, opts = {}) { m.set(key, { value, metadata: (opts && opts.metadata) || {} }); return { modified: true }; },
      async get(key) { return m.has(key) ? m.get(key).value : null; },
      async getWithMetadata(key, opts = {}) {
        if (!m.has(key)) return null;
        const e = m.get(key);
        if (opts.type === 'arrayBuffer') return { data: Buffer.from(String(e.value)), metadata: e.metadata };
        return { data: e.value, metadata: e.metadata };
      },
      async list() { return { blobs: Array.from(m.keys()).map(key => ({ key })) }; },
      async delete(key) { m.delete(key); }
    });
  }
  return registry.get(name);
}

const blobsPath = require.resolve('@netlify/blobs');
require.cache[blobsPath] = { id: blobsPath, filename: blobsPath, loaded: true, exports: { getStore: (opts) => memStore(opts.name) } };

const _backup = require('../../netlify/functions/_backup');
const { backupDateKey, isExpiredBackupKey, snapshotStore, purgeOldBackups, getBlobStore } = _backup;

const DAY = 24 * 60 * 60 * 1000;

test('backupDateKey returns YYYY-MM-DD (America/Bogota)', () => {
  // 2026-06-19 02:00 UTC is still 2026-06-18 21:00 in Bogota (UTC-5)
  assert.equal(backupDateKey(new Date('2026-06-19T02:00:00Z')), '2026-06-18');
  assert.match(backupDateKey(new Date('2026-06-19T18:00:00Z')), /^\d{4}-\d{2}-\d{2}$/);
});

test('isExpiredBackupKey: old expired, recent kept, unparseable kept', () => {
  const now = Date.parse('2026-06-19T00:00:00Z');
  assert.equal(isExpiredBackupKey('2026-05-19/business/quotes.json', now, 30 * DAY), true); // 31d
  assert.equal(isExpiredBackupKey('2026-06-14/business/quotes.json', now, 30 * DAY), false); // 5d
  assert.equal(isExpiredBackupKey('no-date-here.json', now, 30 * DAY), false); // fail-safe keep
});

test('snapshotStore round-trips bytes via base64 and preserves metadata', async () => {
  const src = memStore('quotes');
  await src.set('COT-1', JSON.stringify({ a: 1 }), { metadata: { kind: 'quote' } });
  await src.set('COT-2', JSON.stringify({ b: 2 }));
  const snap = await snapshotStore('quotes');
  assert.equal(snap.scanned, 2);
  const e1 = snap.entries.find(e => e.key === 'COT-1');
  assert.equal(Buffer.from(e1.b64, 'base64').toString(), JSON.stringify({ a: 1 }));
  assert.deepEqual(e1.metadata, { kind: 'quote' });
});

test('snapshotStore caps oversized entries (no base64, marked oversized)', async () => {
  const src = memStore('refunds');
  await src.set('big', 'x'.repeat(50));
  const snap = await snapshotStore('refunds', { maxEntryBytes: 10 });
  const big = snap.entries.find(e => e.key === 'big');
  assert.equal(big.oversized, true);
  assert.ok(!big.b64);
});

test('purgeOldBackups deletes only expired snapshot keys', async () => {
  const bs = memStore('backups-purge-test');
  await bs.set('2026-05-01/business/quotes.json', '{}');
  await bs.set('2026-06-18/business/quotes.json', '{}');
  const now = Date.parse('2026-06-19T00:00:00Z');
  const res = await purgeOldBackups(bs, now, 30 * DAY);
  assert.equal(res.deleted, 1);
  assert.equal(await bs.get('2026-05-01/business/quotes.json'), null);
  assert.ok(await bs.get('2026-06-18/business/quotes.json'));
});

test('handler is a no-op when BACKUP_ENABLED is not true', async () => {
  const prev = process.env.BACKUP_ENABLED;
  delete process.env.BACKUP_ENABLED;
  try {
    const { handler } = require('../../netlify/functions/backup-blobs');
    const r = await handler();
    assert.equal(r.body, 'skipped: disabled');
  } finally {
    if (prev !== undefined) process.env.BACKUP_ENABLED = prev;
  }
});

test('handler ON backs up business stores and omits PII unless included', async () => {
  registry.clear();
  const quotes = memStore('quotes');
  await quotes.set('COT-9', JSON.stringify({ id: 'COT-9' }));
  memStore('guest-checkins'); // exists but PII

  const prev = { en: process.env.BACKUP_ENABLED, pii: process.env.BACKUP_INCLUDE_PII, drive: process.env.BACKUP_TO_DRIVE };
  process.env.BACKUP_ENABLED = 'true';
  delete process.env.BACKUP_INCLUDE_PII;
  delete process.env.BACKUP_TO_DRIVE;
  try {
    delete require.cache[require.resolve('../../netlify/functions/backup-blobs')];
    const { handler } = require('../../netlify/functions/backup-blobs');
    const r = await handler();
    const out = JSON.parse(r.body);
    const dateKey = out.dateKey;

    const backups = memStore('backups');
    const quotesSnap = await backups.get(`${dateKey}/business/quotes.json`);
    assert.ok(quotesSnap, 'business/quotes snapshot written');
    const parsed = JSON.parse(quotesSnap);
    assert.equal(parsed.entries[0].key, 'COT-9');

    // PII group skipped (no BACKUP_INCLUDE_PII)
    const piiSnap = await backups.get(`${dateKey}/pii/guest-checkins.json`);
    assert.equal(piiSnap, null, 'PII not backed up by default');
    assert.ok(out.results.some(x => x.group === 'pii' && x.skipped === 'pii-excluded'));
  } finally {
    if (prev.en === undefined) delete process.env.BACKUP_ENABLED; else process.env.BACKUP_ENABLED = prev.en;
    if (prev.pii !== undefined) process.env.BACKUP_INCLUDE_PII = prev.pii;
    if (prev.drive !== undefined) process.env.BACKUP_TO_DRIVE = prev.drive;
  }
});
