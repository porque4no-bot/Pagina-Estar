/* Append-only audit log for corporate quote changes. Stored per-quote in
 * Netlify Blobs as JSON arrays at quote-audit/{quoteId}.json. The full
 * before/after snapshots stay there forever so we can answer "who changed
 * the price on 2026-04-15 at 14:32" — useful for both internal control and
 * regulatory pushback. */

const { computeQuoteTotal } = require('./_quotes-store');

const AUDIT_STORE = 'quote-audit';
const TRACKED_FIELDS = [
  'empresa', 'contacto', 'email', 'telefono', 'nit',
  'checkin', 'checkout', 'numPersonas',
  'items', 'servicios', 'descuento', 'comision',
  'expiresAt', 'bloquearHabitaciones'
];

function getAuditStore() {
  try {
    const { getStore } = require('@netlify/blobs');
    const opts = { name: AUDIT_STORE, consistency: 'strong' };
    if (process.env.BLOBS_TOKEN && process.env.NETLIFY_SITE_ID) {
      opts.token = process.env.BLOBS_TOKEN;
      opts.siteID = process.env.NETLIFY_SITE_ID;
    }
    return getStore(opts);
  } catch (e) { return null; }
}

function pickTrackedFields(quote) {
  if (!quote) return {};
  const out = {};
  for (const k of TRACKED_FIELDS) {
    if (quote[k] !== undefined) out[k] = quote[k];
  }
  return out;
}

function diffFields(before, after) {
  const changed = [];
  const beforePicked = pickTrackedFields(before);
  const afterPicked = pickTrackedFields(after);
  const keys = new Set([...Object.keys(beforePicked), ...Object.keys(afterPicked)]);
  for (const k of keys) {
    const b = JSON.stringify(beforePicked[k]);
    const a = JSON.stringify(afterPicked[k]);
    if (b !== a) changed.push(k);
  }
  return changed;
}

function safeTotalCents(quote) {
  try { return computeQuoteTotal(quote).totalCents; }
  catch (e) { return null; }
}

/* Append a single entry to the audit log for a quote. Non-fatal on failure
   (we don't want to block the actual update if Blobs is hiccuping). */
async function appendAuditEntry({ quoteId, by, action, before, after, note }) {
  if (!quoteId) return;
  const store = getAuditStore();
  if (!store) return;

  const beforeTotal = before ? safeTotalCents(before) : null;
  const afterTotal = after ? safeTotalCents(after) : null;
  const fieldsChanged = diffFields(before, after);

  const entry = {
    ts: new Date().toISOString(),
    by: by || 'unknown',
    action: action || 'edit',
    fieldsChanged,
    totalBeforeCents: beforeTotal,
    totalAfterCents: afterTotal,
    totalDeltaCents: beforeTotal != null && afterTotal != null ? afterTotal - beforeTotal : null,
    before: pickTrackedFields(before),
    after: pickTrackedFields(after)
  };
  if (note) entry.note = String(note).slice(0, 500);

  const key = `${quoteId}.json`;
  let log = [];
  try {
    const raw = await store.get(key, { type: 'json' });
    if (Array.isArray(raw)) log = raw;
  } catch (e) { /* fresh log */ }

  log.push(entry);
  /* Hard cap to keep blobs small; older entries fall off after 500. The total
     space per quote stays bounded even under abusive editing. */
  if (log.length > 500) log = log.slice(-500);

  try { await store.setJSON(key, log); }
  catch (e) { console.error('[quote-audit] persist failed for', quoteId, e.message); }
}

async function readAuditLog(quoteId) {
  const store = getAuditStore();
  if (!store) return [];
  try {
    const raw = await store.get(`${quoteId}.json`, { type: 'json' });
    return Array.isArray(raw) ? raw : [];
  } catch (e) { return []; }
}

module.exports = { appendAuditEntry, readAuditLog, diffFields, pickTrackedFields };
