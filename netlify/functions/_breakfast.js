/* Lógica del pase de desayuno (Fase 1).
 *
 * Resuelve el "estado de desayuno" de una reserva combinando:
 *   - el DERECHO leído de OTASync (plan de comida / desayunos por noche), o una
 *     convención demo cuando no hay credenciales, y
 *   - las REDENCIONES ya registradas hoy (_breakfast-store).
 *
 * Funciona igual para reservas directas y de OTA: una OTA sin desayuno sale con
 * hasBreakfast=false y el panel ofrece el upgrade (Fase 3). El que liquida es el
 * sistema: solo cuenta lo registrado, así no hay doble contabilidad.
 */

const { getReservationDetail } = require('./_guest-app');
const { getBookingRedemptions, todayBogota } = require('./_breakfast-store');

/* Extrae el derecho de desayuno del payload crudo de OTASync.
 * Estructura (docs/OTASync-Public-API.md): rooms[].first_meal === 'breakfast' y
 * rooms[].nights[].breakfast = nº de desayunos (adultos) esa noche, más
 * breakfast_children_N para menores. Tomamos el máximo por habitación como el
 * derecho diario (personas con desayuno) y sumamos las habitaciones. Defensivo
 * ante variaciones del payload; la forma exacta se valida con datos reales. */
function extractBreakfastEntitlement(raw, fallbackCapacity) {
  const rooms = Array.isArray(raw && raw.rooms) ? raw.rooms : [];
  let perDay = 0;
  let included = false;

  for (const room of rooms) {
    const planHasBreakfast = String((room && room.first_meal) || '').toLowerCase().includes('breakfast');
    const nights = Array.isArray(room && room.nights) ? room.nights : [];
    let roomPerDay = 0;
    for (const night of nights) {
      const adults = Number(night && night.breakfast) || 0;
      let children = 0;
      for (let i = 1; i <= 7; i++) children += Number(night && night[`breakfast_children_${i}`]) || 0;
      roomPerDay = Math.max(roomPerDay, adults + children);
    }
    if (planHasBreakfast && roomPerDay === 0) {
      // El plan dice desayuno pero sin conteo por noche: cae a la ocupación.
      roomPerDay = Number(room.occupancy || room.total_guests || room.adults) || 0;
    }
    if (roomPerDay > 0 || planHasBreakfast) included = true;
    perDay += roomPerDay;
  }

  if (included && perDay === 0) perDay = Number(fallbackCapacity) || 0;
  return { included: included && perDay > 0, perDay };
}

/* Convención para el modo demo (sin OTASync), así se prueban verde y rojo:
 * códigos con OTA/SIN/NOBF salen sin desayuno; el resto, desayuno para todos. */
function demoEntitlement(booking) {
  const code = String(booking.bookingCode || '').toUpperCase();
  const noBreakfast = /OTA|SIN|NOBF/.test(code);
  return { included: !noBreakfast, perDay: noBreakfast ? 0 : (Number(booking.capacity) || 2) };
}

/* Hoy cae dentro de la estadía (informativo, no bloquea: el staff es la
   autoridad — si la persona está en el comedor, está). */
function withinStay(checkIn, checkOut, day) {
  if (!checkIn || !checkOut) return true;
  return String(day) >= String(checkIn).slice(0, 10) && String(day) <= String(checkOut).slice(0, 10);
}

async function resolveBreakfastStatus(bookingCode, { guestIndex, date } = {}) {
  const booking = await getReservationDetail(bookingCode);
  if (!booking) return null;
  const day = date || todayBogota();
  const ent = booking.demo
    ? demoEntitlement(booking)
    : extractBreakfastEntitlement(booking.raw, booking.capacity);

  const redemptions = await getBookingRedemptions(bookingCode, day);
  const servedIndexes = redemptions.map(r => Number(r.guestIndex));
  const perDay = Number(ent.perDay) || 0;
  const servedToday = redemptions.length;

  const status = {
    bookingCode: booking.bookingCode,
    guestName: booking.guestName,
    roomName: booking.roomName,
    roomNumber: booking.roomNumber || '',
    capacity: Number(booking.capacity) || 0,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    date: day,
    withinStay: withinStay(booking.checkIn, booking.checkOut, day),
    hasBreakfast: Boolean(ent.included) && perDay > 0,
    perDay,
    servedToday,
    remaining: Math.max(0, perDay - servedToday),
    servedIndexes,
    demo: Boolean(booking.demo)
  };
  if (guestIndex != null && guestIndex !== '') {
    status.guestIndex = Number(guestIndex) || 0;
    status.thisPersonServed = servedIndexes.includes(status.guestIndex);
  }
  return status;
}

/* Siguiente guestIndex sin servir hoy en [0, perDay). null si no quedan cupos.
   Para la búsqueda manual cuando no hay QR por persona. */
function pickNextGuestIndex(status) {
  const served = new Set((status.servedIndexes || []).map(Number));
  for (let i = 0; i < status.perDay; i++) {
    if (!served.has(i)) return i;
  }
  return null;
}

module.exports = {
  extractBreakfastEntitlement,
  demoEntitlement,
  withinStay,
  resolveBreakfastStatus,
  pickNextGuestIndex
};
