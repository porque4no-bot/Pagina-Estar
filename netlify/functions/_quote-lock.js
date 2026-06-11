/* Per-quote single-writer lock used by payment webhooks.
 *
 * If two webhooks for the same quote reference arrive in parallel (two
 * approved transactions against the same COT-..., or duplicated provider
 * deliveries that slip past the per-transaction dedup), the lock makes
 * sure only one of them runs the create-reservation path. Without it
 * both writers can race and we double-book in OTASync.
 *
 * Backed by Netlify Blobs `onlyIfNew` as a compare-and-set primitive,
 * with a TTL + staleness check so a crashed holder doesn't wedge the
 * quote forever.
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
const LOCK_TTL_S   = 360;            // 6 min blob TTL — auto-expiry safety net

function defaultGetLockStore() {
  return getStore({ name: 'quote-locks', consistency: 'strong' });
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

  try {
    await lockStore.setJSON(quoteId, { transactionId, startedAt: Date.now() }, { onlyIfNew: true, ttl: LOCK_TTL_S });
    return { acquired: true };
  } catch (e) {
    /* Lock already exists. Check staleness first; if stale, overwrite. */
    let existing;
    try { existing = await lockStore.get(quoteId, { type: 'json' }); }
    catch (readErr) { existing = null; }

    const isStale = !existing || (Date.now() - (existing.startedAt || 0)) > LOCK_STALE_MS;
    if (isStale) {
      try {
        await lockStore.setJSON(quoteId, { transactionId, startedAt: Date.now() }, { ttl: LOCK_TTL_S });
        logger.warn(`[quote-lock] overwrote stale lock for ${quoteId} (owner was ${existing && existing.transactionId})`);
        return { acquired: true };
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
  LOCK_STALE_MS,
  LOCK_TTL_S
};
