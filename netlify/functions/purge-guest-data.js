/* Scheduled data-retention purge (A-3, auditoría 360°).
 *
 * Colombian habeas data (Ley 1581/2012) requires a defined retention period
 * and deletion once the purpose is fulfilled. The business retention policy is
 * 5 YEARS after the stay; this job deletes guest PII (check-in records,
 * identity documents, minor documents, guest events and sync queue entries)
 * whose creation timestamp is older than that.
 *
 * Timestamps are embedded in the blob keys (CHK-<ms>-..., GST-<ms>-...,
 * SYNC-<ms>-..., or "<checkinId>/..." for document stores), so we can decide
 * age WITHOUT reading or decrypting any record.
 *
 * Runs daily (see netlify.toml). Alert-and-delete; failures are logged. */

const { getStore } = require('@netlify/blobs');
const { adminEmail, sendEmail } = require('./_email');

const RETENTION_YEARS = 5;
const RETENTION_MS = RETENTION_YEARS * 365 * 24 * 60 * 60 * 1000;

/* Stores that hold guest PII and the key prefix that carries the ms timestamp.
   For document stores the key is "<checkinId>/..." where checkinId itself is
   CHK-<ms>-..., so the same parser works for all of them. */
const PII_STORES = [
  'guest-checkins',
  'guest-documents',
  'guest-minor-documents',
  'guest-events',
  'guest-sync-queue'
];

/* Pull the leading-millisecond timestamp out of an id/key like
   "CHK-1717000000000-AB12", "GST-1717000000000-ab12",
   "SYNC-1717000000000-ABCD" or "CHK-1717000000000-AB12/2/registro-civil.jpg".
   Returns the epoch ms or null when no recognizable timestamp is present. */
function timestampFromKey(key) {
  const m = String(key || '').match(/^[A-Z]+-(\d{13})/);
  if (!m) return null;
  const ms = parseInt(m[1], 10);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

function isExpired(key, now = Date.now()) {
  const ms = timestampFromKey(key);
  /* Unparseable keys are kept (fail-safe: never delete what we can't date). */
  if (ms === null) return false;
  return now - ms > RETENTION_MS;
}

function getStoreSafe(name) {
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

async function purgeStore(name, now) {
  const store = getStoreSafe(name);
  if (!store) return { store: name, deleted: 0, scanned: 0, skipped: true };
  let deleted = 0, scanned = 0;
  let listing;
  try {
    listing = await store.list();
  } catch (e) {
    console.error(`[purge-guest-data] list failed for ${name}:`, e.message);
    return { store: name, deleted: 0, scanned: 0, error: e.message };
  }
  const blobs = (listing && Array.isArray(listing.blobs)) ? listing.blobs : [];
  for (const b of blobs) {
    scanned++;
    if (!isExpired(b.key, now)) continue;
    try {
      await store.delete(b.key);
      deleted++;
    } catch (e) {
      console.error(`[purge-guest-data] delete failed ${name}/${b.key}:`, e.message);
    }
  }
  return { store: name, deleted, scanned };
}

exports.handler = async () => {
  const now = Date.now();
  const results = [];
  for (const name of PII_STORES) {
    results.push(await purgeStore(name, now));
  }
  const totalDeleted = results.reduce((s, r) => s + (r.deleted || 0), 0);
  console.log(`[purge-guest-data] retention=${RETENTION_YEARS}y, deleted ${totalDeleted}:`, JSON.stringify(results));

  if (totalDeleted > 0) {
    try {
      await sendEmail({
        to: adminEmail(),
        subject: `Purga de datos de huéspedes — ${totalDeleted} registro(s) eliminados`,
        html: `<p>Se eliminaron ${totalDeleted} registro(s) de huésped con más de ${RETENTION_YEARS} años (política de retención, Ley 1581).</p>
               <pre>${results.map(r => `${r.store}: ${r.deleted}/${r.scanned}`).join('\n')}</pre>`
      });
    } catch (e) { console.error('[purge-guest-data] summary email failed:', e.message); }
  }

  return { statusCode: 200, body: JSON.stringify({ retentionYears: RETENTION_YEARS, totalDeleted, results }) };
};

exports._test = { timestampFromKey, isExpired, RETENTION_MS, RETENTION_YEARS };
