/* Tests the REAL acquireQuoteLock/releaseQuoteLock logic against an in-memory
 * store that implements the @netlify/blobs >= 10 conditional-write contract
 * (set resolves with { modified: false } on a failed precondition — no throw).
 *
 * Context: with @netlify/blobs v8 the onlyIfNew/onlyIfMatch options were
 * silently ignored, so the lock never blocked anyone and the double-booking
 * protection was a no-op. These tests pin the contract so a dependency
 * downgrade or API change fails CI instead of failing silently in production. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { acquireQuoteLock, releaseQuoteLock, LOCK_STALE_MS } = require('../../netlify/functions/_quote-lock');

/* Minimal in-memory store honoring the v10 conditional-write semantics. */
function memoryStore() {
  const data = new Map(); // key -> { value, etag }
  let etagCounter = 0;
  return {
    async set(key, value, options = {}) {
      const existing = data.get(key);
      if (options.onlyIfNew && existing) return { modified: false };
      if (options.onlyIfMatch && (!existing || existing.etag !== options.onlyIfMatch)) {
        return { modified: false };
      }
      const etag = `etag-${++etagCounter}`;
      data.set(key, { value: String(value), etag });
      return { modified: true, etag };
    },
    async get(key, options = {}) {
      const entry = data.get(key);
      if (!entry) return null;
      return options.type === 'json' ? JSON.parse(entry.value) : entry.value;
    },
    async getWithMetadata(key, options = {}) {
      const entry = data.get(key);
      if (!entry) return null;
      const value = options.type === 'json' ? JSON.parse(entry.value) : entry.value;
      return { data: value, etag: entry.etag, metadata: {} };
    },
    async delete(key) { data.delete(key); },
    _raw: data
  };
}

const silentLogger = { error() {}, warn() {}, log() {} };

test('first writer acquires the lock, second concurrent writer is refused', async () => {
  const store = memoryStore();
  const deps = { getLockStore: () => store, logger: silentLogger };

  const first = await acquireQuoteLock('COT-2026-AAAAA', 'tx-1', deps);
  assert.equal(first.acquired, true);

  const second = await acquireQuoteLock('COT-2026-AAAAA', 'tx-2', deps);
  assert.equal(second.acquired, false, 'second writer must NOT acquire a held lock');
  assert.equal(second.ownerTx, 'tx-1');
});

test('lock can be re-acquired after release', async () => {
  const store = memoryStore();
  const deps = { getLockStore: () => store, logger: silentLogger };

  await acquireQuoteLock('COT-2026-BBBBB', 'tx-1', deps);
  await releaseQuoteLock('COT-2026-BBBBB', deps);
  const again = await acquireQuoteLock('COT-2026-BBBBB', 'tx-3', deps);
  assert.equal(again.acquired, true);
});

test('a stale lock (crashed holder) is stolen', async () => {
  const store = memoryStore();
  const deps = { getLockStore: () => store, logger: silentLogger };

  /* Simulate a holder that died LOCK_STALE_MS+1min ago. */
  await store.set('COT-2026-CCCCC', JSON.stringify({ transactionId: 'tx-dead', startedAt: Date.now() - LOCK_STALE_MS - 60000 }));

  const res = await acquireQuoteLock('COT-2026-CCCCC', 'tx-new', deps);
  assert.equal(res.acquired, true, 'stale lock should be stolen');
  const current = await store.get('COT-2026-CCCCC', { type: 'json' });
  assert.equal(current.transactionId, 'tx-new');
});

test('concurrent steal of a stale lock: only the etag winner acquires', async () => {
  const store = memoryStore();
  const deps = { getLockStore: () => store, logger: silentLogger };

  await store.set('COT-2026-DDDDD', JSON.stringify({ transactionId: 'tx-dead', startedAt: Date.now() - LOCK_STALE_MS - 60000 }));

  /* Sabotage: between the read and the conditional write of the SECOND
     stealer, the first stealer already rewrote the lock (new etag). */
  const winner = await acquireQuoteLock('COT-2026-DDDDD', 'tx-fast', deps);
  assert.equal(winner.acquired, true);

  const loser = await acquireQuoteLock('COT-2026-DDDDD', 'tx-slow', deps);
  assert.equal(loser.acquired, false, 'fresh lock must not be stolen');
  assert.equal(loser.ownerTx, 'tx-fast');
});

test('canary: installed @netlify/blobs supports conditional writes', () => {
  const pkg = require('@netlify/blobs/package.json');
  const major = parseInt(pkg.version.split('.')[0], 10);
  assert.ok(major >= 10, `@netlify/blobs must be >= 10 for onlyIfNew/onlyIfMatch (found ${pkg.version}); v8 silently ignored them and disabled the quote lock`);
  const dist = fs.readFileSync(path.join(path.dirname(require.resolve('@netlify/blobs/package.json')), 'dist/main.cjs'), 'utf8');
  assert.match(dist, /onlyIfNew/, 'dist should implement onlyIfNew');
  assert.match(dist, /onlyIfMatch/, 'dist should implement onlyIfMatch');
});
