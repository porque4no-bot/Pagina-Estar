/* A4 — scheduled daily backup of durable Netlify Blobs stores.
 *
 * Read-only over the source stores (list + get); writes ONLY to the isolated
 * `backups` store and, optionally, to Google Drive (off-site, business stores
 * only). Gated by BACKUP_ENABLED (OFF by default). Best-effort per store: one
 * store failing never aborts the rest. Never touches OTASync, payments or
 * availability. Restore is manual — see docs/backup-blobs.md.
 *
 * Env: BACKUP_ENABLED, BACKUP_RETENTION_DAYS, BACKUP_INCLUDE_PII,
 *      BACKUP_TO_DRIVE, BACKUP_ALWAYS_EMAIL.
 */

require('./_env');
const {
  BACKUP_STORE_GROUPS, RETENTION_MS, getBlobStore,
  backupDateKey, snapshotStore, writeSnapshot, purgeOldBackups
} = require('./_backup');
const { sendEmail, adminEmail, esc } = require('./_email');
const { flag } = require('./_settings');

function fmtMB(bytes) { return (bytes / (1024 * 1024)).toFixed(2) + ' MB'; }

async function maybeCopyToDrive(dateKey, group, snap, results) {
  if (process.env.BACKUP_TO_DRIVE !== 'true') return;
  if (group.pii) return; /* PII never leaves the Netlify perimeter in clear/ciphertext to Drive */
  try {
    const drive = require('./_google-drive');
    if (!(await drive.isConfigured())) return;
    const root = await drive.findOrCreateFolder({ parentId: drive.rootFolderId(), name: 'backups-blobs' });
    const dayFolder = await drive.findOrCreateFolder({ parentId: root.id || root, name: dateKey });
    const body = Buffer.from(JSON.stringify({ version: 1, store: snap.store, entries: snap.entries }));
    await drive.uploadFile({ folderId: dayFolder.id || dayFolder, name: `${group.id}__${snap.store}.json`, mimeType: 'application/json', body });
    results.driveCopied = (results.driveCopied || 0) + 1;
  } catch (e) {
    console.warn(`[backup-blobs] Drive copy failed for ${snap.store} (non-fatal):`, e.message);
  }
}

exports.handler = async () => {
  if (!(await flag('BACKUP_ENABLED'))) {
    return { statusCode: 200, body: 'skipped: disabled' };
  }
  const backupStore = getBlobStore('backups');
  if (!backupStore) {
    console.error('[backup-blobs] backups store unavailable.');
    return { statusCode: 503, body: 'backups store unavailable' };
  }

  const dateKey = backupDateKey();
  const includePii = process.env.BACKUP_INCLUDE_PII === 'true';
  const results = [];
  let hadError = false;

  for (const group of BACKUP_STORE_GROUPS) {
    if (group.pii && !includePii) {
      results.push({ group: group.id, skipped: 'pii-excluded' });
      continue;
    }
    for (const store of group.stores) {
      try {
        const snap = await snapshotStore(store);
        await writeSnapshot(backupStore, dateKey, group.id, snap);
        const err = snap.error || snap.entries.some(e => e.error);
        if (err) hadError = true;
        results.push({ group: group.id, store, scanned: snap.scanned, bytes: snap.totalBytes, ok: !snap.error });
        await maybeCopyToDrive(dateKey, group, snap, results);
      } catch (e) {
        hadError = true;
        results.push({ group: group.id, store, ok: false, error: e.message });
        console.error(`[backup-blobs] snapshot failed for ${store}:`, e.message);
      }
    }
  }

  let purged = { deleted: 0, scanned: 0 };
  try { purged = await purgeOldBackups(backupStore, Date.now(), RETENTION_MS); }
  catch (e) { console.warn('[backup-blobs] purge failed (non-fatal):', e.message); }

  /* Summary email: only on error, or always if asked. */
  try {
    if (hadError || process.env.BACKUP_ALWAYS_EMAIL === 'true') {
      const totalBytes = results.reduce((s, r) => s + (r.bytes || 0), 0);
      const rows = results.map(r => `<li>${esc(r.group)}/${esc(r.store || '—')}: ${r.skipped ? esc(r.skipped) : `${r.scanned || 0} blobs, ${fmtMB(r.bytes || 0)}${r.ok ? '' : ' ⚠ ' + esc(r.error || 'error')}`}</li>`).join('');
      await sendEmail({
        to: adminEmail(),
        subject: `${hadError ? '⚠ ' : ''}Respaldo Blobs ${dateKey} — ${fmtMB(totalBytes)}`,
        html: `<!DOCTYPE html><html lang="es"><body style="font-family:Arial,sans-serif;color:#2C2C2C;"><h2>Respaldo de Blobs — ${esc(dateKey)}</h2><ul>${rows}</ul><p>Purgados (>retención): ${purged.deleted}/${purged.scanned}.</p></body></html>`
      });
    }
  } catch (e) { console.warn('[backup-blobs] summary email failed (non-fatal):', e.message); }

  console.log(`[backup-blobs] ${dateKey}: ${results.length} entries, purged ${purged.deleted}/${purged.scanned}, hadError=${hadError}`);
  return { statusCode: 200, body: JSON.stringify({ dateKey, results, purged }) };
};

exports._test = { maybeCopyToDrive, fmtMB };
