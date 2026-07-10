/* Persistencia de las auditorías de aseo (Netlify Blobs).
 *
 * "Ambos" almacenamientos: los metadatos + veredicto van en el store
 * 'cleaning-audits', y la imagen aprobada se guarda tanto en Google Drive
 * (carpetas navegables para el equipo, vía _google-drive) como en el store
 * de bytes 'cleaning-photos' (respaldo que sobrevive aunque Drive falle o no
 * esté configurado). Reusa guestStore de _guest-app.
 *
 *   cleaning-audits  key: `${apartmentSlug}:${item}:${YYYY-MM-DD}`  → JSON metadato
 *   cleaning-photos  key: `${apartmentSlug}:${item}:${YYYY-MM-DD}`  → bytes de la imagen
 *
 * Una foto por (apartamento, ítem, día): repetir sobrescribe (la última gana),
 * de modo que el registro refleja el estado final aceptado del aseo del día. */

const { guestStore } = require('./_guest-app');

/* Fecha "de hoy" en hora de Colombia (el servidor corre en UTC). en-CA
   entrega formato ISO YYYY-MM-DD. */
function todayBogota() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

function nowIso() { return new Date().toISOString(); }

/* Identificador seguro de apartamento para llaves y rutas: minúsculas, sin
   tildes, solo alfanumérico y guiones. */
function apartmentSlug(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'apto';
}

function auditKey(slug, item, date) {
  return `${slug}:${item}:${date}`;
}

function auditsStore() { return guestStore('cleaning-audits'); }
function photosStore() { return guestStore('cleaning-photos'); }

/* Guarda (o sobrescribe) el metadato de una auditoría. Devuelve el registro. */
async function saveAudit(record) {
  const day = record.date || todayBogota();
  const slug = record.apartmentSlug || apartmentSlug(record.apartment);
  const key = auditKey(slug, record.item, day);
  const value = {
    ...record,
    apartmentSlug: slug,
    date: day,
    auditedAt: nowIso()
  };
  await auditsStore().set(key, JSON.stringify(value));
  return value;
}

/* Guarda los bytes de la imagen aprobada (respaldo local a Drive). */
async function savePhoto({ apartmentSlug: slug, item, date, buffer, mediaType }) {
  const day = date || todayBogota();
  const key = auditKey(slug, item, day);
  await photosStore().set(key, buffer, {
    metadata: { mediaType: mediaType || 'image/jpeg', item, date: day }
  });
  return key;
}

/* Todas las auditorías de un apartamento en un día (default hoy). */
async function getApartmentAudits(slug, date) {
  const day = date || todayBogota();
  const s = auditsStore();
  const out = [];
  const listing = await s.list({ prefix: `${slug}:` });
  for (const entry of (listing.blobs || [])) {
    if (!String(entry.key).endsWith(`:${day}`)) continue;
    try {
      const raw = await s.get(entry.key);
      if (raw) out.push(JSON.parse(raw));
    } catch (e) { /* saltar ilegibles */ }
  }
  return out;
}

module.exports = {
  todayBogota,
  apartmentSlug,
  auditKey,
  saveAudit,
  savePhoto,
  getApartmentAudits,
  getCleaningStore: auditsStore
};
