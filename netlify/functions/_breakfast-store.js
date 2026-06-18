/* Breakfast redemption store — Fase 1 del pase de desayuno.
 *
 * El escaneo que autoriza servir un desayuno ES el registro: por construcción
 * todo lo servido queda registrado, y el total del sistema es la base para
 * liquidarle al proveedor tercerizado (que cobra por desayuno servido). Un
 * registro por (reserva, persona, día), idempotente vía onlyIfNew, así una
 * misma persona no se sirve dos veces el mismo día y un doble escaneo es un
 * no-op (no un duplicado).
 *
 * Store Blobs 'breakfast-redemptions' (reusa guestStore de _guest-app):
 *   Key:   `${bookingCode}:${guestIndex}:${YYYY-MM-DD}`
 *   Value: { bookingCode, guestIndex, guestName, date, servedAt, staffEmail, source }
 */

const { guestStore } = require('./_guest-app');

const SOURCE = { INCLUDED: 'included', UPGRADE: 'upgrade' };

function nowIso() { return new Date().toISOString(); }

/* Fecha "de hoy" en hora de Colombia (America/Bogota, sin horario de verano).
   El servidor corre en UTC; sin esto, un desayuno de la madrugada caería en el
   día equivocado. en-CA ya entrega formato ISO (YYYY-MM-DD). */
function todayBogota() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

function redemptionKey(bookingCode, guestIndex, date) {
  return `${bookingCode}:${guestIndex}:${date}`;
}

function store() { return guestStore('breakfast-redemptions'); }

/* Registra un desayuno servido. Idempotente por (reserva, persona, día): si ya
   existía, devuelve created:false con el registro previo (doble escaneo = no-op). */
async function recordRedemption({ bookingCode, guestIndex, guestName, staffEmail, source, date }) {
  const day = date || todayBogota();
  const idx = Number.isFinite(Number(guestIndex)) ? Number(guestIndex) : 0;
  const key = redemptionKey(bookingCode, idx, day);
  const record = {
    bookingCode: String(bookingCode),
    guestIndex: idx,
    guestName: guestName || null,
    date: day,
    servedAt: nowIso(),
    staffEmail: staffEmail || null,
    source: source === SOURCE.UPGRADE ? SOURCE.UPGRADE : SOURCE.INCLUDED
  };
  const s = store();
  const res = await s.set(key, JSON.stringify(record), { onlyIfNew: true });
  if (res && res.modified === false) {
    const existing = await s.get(key);
    return { created: false, redemption: existing ? JSON.parse(existing) : record };
  }
  return { created: true, redemption: record };
}

/* Todas las redenciones de una reserva en un día (default hoy). */
async function getBookingRedemptions(bookingCode, date) {
  const day = date || todayBogota();
  const s = store();
  const out = [];
  const listing = await s.list({ prefix: `${bookingCode}:` });
  for (const entry of (listing.blobs || [])) {
    if (!String(entry.key).endsWith(`:${day}`)) continue;
    try {
      const raw = await s.get(entry.key);
      if (raw) out.push(JSON.parse(raw));
    } catch (e) { /* skip unreadable */ }
  }
  out.sort((a, b) => Number(a.guestIndex) - Number(b.guestIndex));
  return out;
}

/* ¿Esta persona ya fue servida hoy? */
async function hasRedeemed(bookingCode, guestIndex, date) {
  const day = date || todayBogota();
  const s = store();
  const raw = await s.get(redemptionKey(bookingCode, Number(guestIndex) || 0, day));
  return Boolean(raw);
}

/* Todas las redenciones en un rango de fechas (analítica — Fase 4). */
async function listRedemptions({ fromDate, toDate } = {}) {
  const s = store();
  const out = [];
  const listing = await s.list();
  for (const entry of (listing.blobs || [])) {
    try {
      const raw = await s.get(entry.key);
      if (!raw) continue;
      const r = JSON.parse(raw);
      if (fromDate && r.date < fromDate) continue;
      if (toDate && r.date > toDate) continue;
      out.push(r);
    } catch (e) { /* skip unreadable */ }
  }
  out.sort((a, b) => String(a.servedAt).localeCompare(String(b.servedAt)));
  return out;
}

module.exports = {
  SOURCE,
  todayBogota,
  redemptionKey,
  getBreakfastStore: store,
  recordRedemption,
  getBookingRedemptions,
  hasRedeemed,
  listRedemptions
};
