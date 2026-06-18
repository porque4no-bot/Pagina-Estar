/* Lógica del pase de desayuno (Fase 1).
 *
 * Resuelve el "estado de desayuno" de una reserva combinando:
 *   - el DERECHO leído de OTASync (plan de comida / desayunos por noche), o una
 *     convención demo cuando no hay credenciales, y
 *   - las REDENCIONES ya registradas hoy (_breakfast-store).
 *
 * El derecho se LEE de la reserva, no se asume por canal: una tarifa con
 * desayuno (directa o de OTA) sale hasBreakfast=true; las que no lo traen
 * (Airbnb siempre, u otra OTA sin esa tarifa) salen false y el panel ofrece el
 * upgrade (Fase 3). El que liquida es el sistema: solo cuenta lo registrado.
 */

const { getReservationDetail } = require('./_guest-app');
const { getBookingRedemptions, todayBogota } = require('./_breakfast-store');

/* Extrae el derecho de desayuno del payload crudo de OTASync.
 * Estructura real (docs/OTASync-Public-API.md, detalle de reserva): el array de
 * habitaciones es `reservation_rooms` (NO `rooms` — eso es disponibilidad), con
 * reservation_rooms[].first_meal === 'breakfast' y reservation_rooms[].nights[]
 * con `breakfast` (agregado de desayunos de la noche) y el desglose por tipo
 * `breakfast_adults` / `breakfast_children_N` / `breakfast_seniors`. Por robustez
 * leemos también `rooms` por si una variante del payload lo usa. El nº de
 * desayunos por noche se toma como el MÁXIMO entre el agregado y el desglose:
 * así es correcto tanto si `breakfast` es el total como si es solo adultos, sin
 * doble-contar. Tomamos el máximo por habitación como derecho diario y sumamos
 * las habitaciones. PENDIENTE: validar contra una reserva real con desayuno. */
function extractBreakfastEntitlement(raw, fallbackCapacity) {
  const rooms = Array.isArray(raw && raw.reservation_rooms) ? raw.reservation_rooms
    : Array.isArray(raw && raw.rooms) ? raw.rooms
    : [];
  let perDay = 0;
  let included = false;

  for (const room of rooms) {
    if (!room) continue;
    const planHasBreakfast = String(room.first_meal || '').toLowerCase().includes('breakfast');
    const nights = Array.isArray(room.nights) ? room.nights : [];
    let roomPerDay = 0;
    for (const night of nights) {
      if (!night) continue;
      const aggregate = Number(night.breakfast) || 0;
      let breakdown = (Number(night.breakfast_adults) || 0) + (Number(night.breakfast_seniors) || 0);
      for (let i = 1; i <= 7; i++) breakdown += Number(night[`breakfast_children_${i}`]) || 0;
      roomPerDay = Math.max(roomPerDay, aggregate, breakdown);
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

/* Convención SOLO para el modo demo (sin OTASync), para probar verde y rojo:
 * códigos con AIRBNB/SIN/NOBF salen sin desayuno; el resto, con desayuno.
 * OJO: en producción el derecho NO se asume por canal — se lee de la reserva
 * (extractBreakfastEntitlement). Una tarifa de OTA con desayuno sale verde;
 * solo las que de verdad no lo traen (Airbnb siempre, u otra OTA sin esa
 * tarifa) salen rojas para el upgrade. */
function demoEntitlement(booking) {
  const code = String(booking.bookingCode || '').toUpperCase();
  const noBreakfast = /AIRBNB|SIN|NOBF/.test(code);
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
