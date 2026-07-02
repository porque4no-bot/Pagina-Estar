require('./_env');
const { authorize } = require('./_authz');
const { getReservationsByDate, hasOtasyncCreds } = require('./_otasync');

/*
 * staff-today — Staff App v1 (read-only), Sprint 1 (Mesa Redonda: el mayor vacío
 * era que no existe una consola operativa del día). Una sola llamada que arma el
 * tablero "Hoy" combinando piezas que YA existen en el código:
 *   - roster del día vía getReservationsByDate (hoy invisible para el staff):
 *       · llegadas (date_arrival = fecha)
 *       · salidas   (date_departure = fecha)
 *       · en casa   (date_arrival <= fecha < date_departure)
 *   - cola de reembolsos pendientes (solo si el rol tiene refunds.view).
 *
 * Auth: guests.checkin.view (recepción + admin). La cocina usa el panel de
 * desayunos aparte. Read-only: NO escribe en OTASync ni en Blobs.
 *
 * El "en casa" se deriva de una ventana de llegadas hacia atrás (LOOKBACK días),
 * porque OTASync no lista limpio las reservas en curso por fecha. LOOKBACK cubre
 * estadías largas razonables; una estadía más larga que eso podría no aparecer en
 * "en casa" (sí en su día de llegada). Es la limitación documentada del PMS.
 */

const LOOKBACK_DAYS = 92; /* ~3 meses: cubre estadías normales y largas (vivir) */

function jsonResponse(statusCode, body, extraHeaders = {}) {
  const headers = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...extraHeaders
  };
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;
  return { statusCode, headers, body: JSON.stringify(body) };
}

/* Fecha "hoy" en Colombia (UTC-5, sin horario de verano). */
function bogotaToday() {
  return new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function isValidDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(new Date(s).getTime());
}

function shiftDate(isoDate, deltaDays) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

const ACTIVE_STATUSES = new Set(['confirmed', 'tentative', 'pending', '']);

/* Forma mínima y operativa de una reserva (sin sobre-exponer PII). */
function publicReservation(r) {
  return {
    bookingCode: r.idReservations,
    guestName: `${r.firstName || ''} ${r.lastName || ''}`.trim(),
    roomName: r.roomName || '',
    checkIn: r.dateArrival,
    checkOut: r.dateDeparture,
    nights: r.nights,
    status: r.status,
    hasBreakfast: r.hasBreakfast
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return jsonResponse(200, {});
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method Not Allowed' });

  const auth = await authorize(event, 'guests.checkin.view');
  if (!auth.ok) return jsonResponse(auth.statusCode, { error: auth.error });
  const canSeeRefunds = Array.isArray(auth.permissions) && auth.permissions.includes('refunds.view');

  const qp = event.queryStringParameters || {};
  const date = isValidDate(qp.date) ? qp.date : bogotaToday();

  /* Sin credenciales OTASync (dev) → tablero vacío y bandera isMock, sin romper. */
  if (!hasOtasyncCreds()) {
    return jsonResponse(200, {
      date, isMock: true,
      arrivals: [], departures: [], inHouse: [],
      counts: { arrivals: 0, departures: 0, inHouse: 0 },
      refunds: canSeeRefunds ? { pending: [], count: 0 } : null
    });
  }

  try {
    const windowFrom = shiftDate(date, -LOOKBACK_DAYS);
    const [windowArrivals, departuresRes] = await Promise.all([
      /* llegadas desde hace LOOKBACK hasta hoy → de aquí salen "llegadas hoy" y "en casa" */
      getReservationsByDate({ filterBy: 'date_arrival', dfrom: windowFrom, dto: date, arrivals: 1 }),
      getReservationsByDate({ filterBy: 'date_departure', dfrom: date, dto: date, departures: 1 })
    ]);

    const windowList = (windowArrivals.reservations || []).filter(r => ACTIVE_STATUSES.has(String(r.status || '').toLowerCase()));
    const arrivals = windowList.filter(r => r.dateArrival === date);
    const inHouse = windowList.filter(r => r.dateArrival <= date && r.dateDeparture > date);
    const departures = (departuresRes.reservations || []).filter(r => ACTIVE_STATUSES.has(String(r.status || '').toLowerCase()));

    let refunds = null;
    if (canSeeRefunds) {
      try {
        const { listRefunds, STATUS } = require('./_refunds-store');
        const terminal = new Set([STATUS.DONE, STATUS.DENIED]);
        const all = await listRefunds(null);
        const pending = (all || []).filter(x => !terminal.has(x.status));
        refunds = {
          count: pending.length,
          pending: pending.map(x => ({
            bookingCode: x.bookingCode, status: x.status, route: x.route,
            amountCents: x.refundAmountCents || null, guestName: x.guestName || '',
            reservationCanceled: !!x.reservationCanceled, createdAt: x.createdAt || null
          }))
        };
      } catch (e) {
        console.error('[staff-today] refunds list failed (non-fatal):', e.message);
        refunds = { count: 0, pending: [], error: 'refunds_unavailable' };
      }
    }

    return jsonResponse(200, {
      date, isMock: false,
      arrivals: arrivals.map(publicReservation),
      departures: departures.map(publicReservation),
      inHouse: inHouse.map(publicReservation),
      counts: { arrivals: arrivals.length, departures: departures.length, inHouse: inHouse.length },
      refunds
    });
  } catch (e) {
    console.error('[staff-today]', e.message);
    return jsonResponse(503, { error: 'No se pudo cargar el tablero del día' });
  }
};

exports._test = { publicReservation, shiftDate, bogotaToday, isValidDate, LOOKBACK_DAYS };
