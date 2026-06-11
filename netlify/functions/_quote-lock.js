/* Per-quote single-writer lock used by payment webhooks.
 *
 * If two webhooks for the same quote reference arrive in parallel (two
 * approved transactions against the same COT-..., or duplicated provider
 * deliveries that slip past the per-transaction dedup), the lock makes
 * sure only one of them runs the create-reservation path. Without it
 * both writers can race and we double-book in OTASync.
 *
 * Backed by Netlify Blobs conditional writes (@netlify/blobs >= 10):
 * `set(..., { onlyIfNew: true })` resolves with `{ modified: false }` when the
 * key already exists — it does NOT throw. Netlify Blobs has no TTL, so expiry
 * is age-based: a lock older than LOCK_STALE_MS is treated as abandoned and
 * stolen with an etag-conditional write (onlyIfMatch) so two stealers can't
 * both win.
 *
 * Exports:
 *   acquireQuoteLock(quoteId, transactionId, deps?)
 *     -> { acquired: true }                       — first writer, proceed
 *     -> { acquired: true, blobsUnavailable: true } — fail-open when Blobs unavailable
 *     -> { acquired: false, ownerTx, startedAt }  — another tx holds the lock
 *
 *   releaseQuoteLock(quoteId, deps?)
 *     Best-effort delete; never throws.
 */

const { getStore } = require('@netlify/blobs');

const LOCK_STALE_MS = 5 * 60 * 1000; // 5 minutes: a lock older than this is treated as abandoned

function defaultGetLockStore() {
  return getStore({ name: 'quote-locks', consistency: 'strong' });
}

/* Treat both contracts defensively: current @netlify/blobs returns
   { modified: boolean }; if a future/polyfilled store throws on a failed
   precondition instead, the caller maps the throw to "not acquired". */
function wasWritten(writeResult) {
  return !writeResult || writeResult.modified !== false;
}

async function acquireQuoteLock(quoteId, transactionId, deps = {}) {
  const getLockStore = deps.getLockStore || defaultGetLockStore;
  const logger = deps.logger || console;

  let lockStore;
  try { lockStore = getLockStore(); }
  catch (e) {
    logger.error('[quote-lock] quote-locks store unavailable:', e.message);
    /* Without Blobs we cannot prevent the race; let the caller proceed. The
       transaction-level dedup in processed-transactions still protects
       against duplicate webhook deliveries of the same txId. */
    return { acquired: true, blobsUnavailable: true };
  }

  const lockValue = JSON.stringify({ transactionId, startedAt: Date.now() });

  let created;
  try {
    created = wasWritten(await lockStore.set(quoteId, lockValue, { onlyIfNew: true }));
  } catch (e) {
    created = false; /* precondition-throwing store: key already exists */
  }
  if (created) return { acquired: true };

  /* Lock already exists. Read it (with etag) and check staleness; a stale
     lock is stolen with an etag-conditional write so concurrent stealers
     can't both succeed. */
  let existing = null;
  let etag = null;
  try {
    const current = await lockStore.getWithMetadata(quoteId, { type: 'json' });
    if (current) { existing = current.data; etag = current.etag; }
  } catch (readErr) { existing = null; }

  const isStale = !existing || (Date.now() - (existing.startedAt || 0)) > LOCK_STALE_MS;
  if (isStale) {
    try {
      const stealOpts = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
      const stolen = wasWritten(await lockStore.set(quoteId, lockValue, stealOpts));
      if (stolen) {
        logger.warn(`[quote-lock] overwrote stale lock for ${quoteId} (owner was ${existing && existing.transactionId})`);
        return { acquired: true };
      }
    } catch (overwriteErr) {
      logger.error('[quote-lock] stale lock overwrite failed:', overwriteErr.message);
    }
  }

  return {
    acquired: false,
    ownerTx: existing && existing.transactionId,
    startedAt: existing && existing.startedAt
  };
}

async function releaseQuoteLock(quoteId, deps = {}) {
  const getLockStore = deps.getLockStore || defaultGetLockStore;
  const logger = deps.logger || console;
  try {
    const lockStore = getLockStore();
    await lockStore.delete(quoteId);
  } catch (e) {
    logger.warn('[quote-lock] releaseQuoteLock failed (non-fatal):', e.message);
  }
}

module.exports = {
  acquireQuoteLock,
  releaseQuoteLock,
  LOCK_STALE_MS
};
