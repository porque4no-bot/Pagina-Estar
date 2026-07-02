/* A4 — Netlify Blobs backup helpers.
 *
 * Quotes, refunds, breakfast redemptions, cancellation requests and (opt-in)
 * encrypted guest PII live ONLY in Netlify Blobs. This module snapshots the
 * durable stores into an isolated `backups` store, versioned by date, with
 * retention/purge. backup-blobs.js (cron) drives it.
 *
 * Design notes (from adversarial review):
 *  - Only DURABLE stores are backed up. TTL/ephemeral stores (booking-results,
 *    processed-transactions, booking-idempotency, rate-limit, whatsapp-*) are
 *    excluded: backing up a 7-day rolling window adds noise and restoring it
 *    reintroduces stale entries.
 *  - Binary docs are read WITH metadata (getWithMetadata) so contentType /
 *    bookingCode / guestIndex survive a restore — a plain arrayBuffer get would
 *    discard them and leave the document unusable.
 *  - PII stores are encrypted at rest already (AES-256-GCM); the snapshot copies
 *    ciphertext as-is (the encryption key never touches the backup) and is
 *    opt-in via BACKUP_INCLUDE_PII. PII in clear never goes to Drive.
 *  - A per-entry size cap avoids OOM when serializing large binaries to base64.
 */

const { getStore } = require('@netlify/blobs');

const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS, 10) || 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const MAX_ENTRY_BYTES = parseInt(process.env.BACKUP_MAX_ENTRY_BYTES, 10) || 6 * 1024 * 1024; /* 6 MB/entry */

/* Declarative source of truth — update when a new durable store is added. */
const BACKUP_STORE_GROUPS = [
  {
    id: 'business', pii: false,
    stores: ['quotes', 'quote-audit', 'refunds', 'breakfast-redemptions', 'cancellation-requests']
  },
  {
    id: 'pii', pii: true,
    stores: ['guest-checkins', 'guest-events', 'guest-documents', 'guest-minor-documents']
  }
];

function getBlobStore(name) {
  try {
    const opts = { name, consistency: 'strong' };
    const siteID = process.env.BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
    const token = process.env.BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
    if (siteID && token) { opts.siteID = siteID; opts.token = token; }
    return getStore(opts);
  } catch (e) {
    return null;
  }
}

/* YYYY-MM-DD in America/Bogota. Pure (pass `now` for tests). */
function backupDateKey(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

/* True when a backup key (prefixed by its YYYY-MM-DD) is older than retention.
   Unparseable keys are KEPT (fail-safe). Pure. */
function isExpiredBackupKey(key, now, retentionMs) {
  const m = String(key || '').match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return false;
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  if (Number.isNaN(t)) return false;
  return now - t > retentionMs;
}

/* Read every blob in a source store. Per-blob try/catch (skip unreadable),
   per-entry size cap (skip oversized to avoid OOM). Preserves metadata. */
async function snapshotStore(name, deps = {}) {
  const store = (deps.getBlobStore || getBlobStore)(name);
  if (!store) return { store: name, entries: [], scanned: 0, totalBytes: 0, skipped: true };
  const maxEntry = deps.maxEntryBytes || MAX_ENTRY_BYTES;
  let listing;
  try { listing = await store.list(); }
  catch (e) { return { store: name, entries: [], scanned: 0, totalBytes: 0, error: e.message }; }

  const blobs = (listing && listing.blobs) || [];
  const entries = [];
  let totalBytes = 0;
  for (const b of blobs) {
    try {
      const got = await store.getWithMetadata(b.key, { type: 'arrayBuffer' });
      if (!got || got.data == null) continue;
      const buf = Buffer.from(got.data);
      if (buf.length > maxEntry) {
        entries.push({ key: b.key, bytes: buf.length, oversized: true });
        continue;
      }
      totalBytes += buf.length;
      entries.push({ key: b.key, bytes: buf.length, b64: buf.toString('base64'), metadata: got.metadata || {} });
    } catch (e) {
      entries.push({ key: b.key, error: e.message });
    }
  }
  return { store: name, entries, scanned: blobs.length, totalBytes };
}

/* One blob per source store: `${dateKey}/${groupId}/${store}.json`. */
async function writeSnapshot(backupStore, dateKey, groupId, snap, deps = {}) {
  const now = (deps.now || Date.now)();
  const key = `${dateKey}/${groupId}/${snap.store}.json`;
  const payload = JSON.stringify({ version: 1, takenAt: new Date(now).toISOString(), group: groupId, store: snap.store, entries: snap.entries });
  await backupStore.set(key, payload);
  return key;
}

async function purgeOldBackups(backupStore, now, retentionMs = RETENTION_MS) {
  let deleted = 0, scanned = 0;
  let listing;
  try { listing = await backupStore.list(); }
  catch (e) { return { deleted: 0, scanned: 0, error: e.message }; }
  const blobs = (listing && listing.blobs) || [];
  for (const b of blobs) {
    scanned++;
    if (!isExpiredBackupKey(b.key, now, retentionMs)) continue;
    try { await backupStore.delete(b.key); deleted++; } catch (e) { /* skip */ }
  }
  return { deleted, scanned };
}

module.exports = {
  BACKUP_STORE_GROUPS, RETENTION_DAYS, RETENTION_MS, MAX_ENTRY_BYTES,
  getBlobStore, backupDateKey, isExpiredBackupKey, snapshotStore, writeSnapshot, purgeOldBackups
};
