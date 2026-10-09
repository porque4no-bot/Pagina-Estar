require('./_env');
const { authorize } = require('./_authz');
const hoy = require('./_staff-hoy');

/*
 * staff-web-bookings — Frente "Panel Hoy para recepción": reservas web recientes.
 *
 * GET ?days=30 → las reservas pagadas en la web (Wompi o Mercado Pago) de los
 * últimos N días (máx. 60), tomadas de `booking-results` — lo que escribe el
 * webhook al confirmar el pago — y cruzadas (solo lectura) con OTASync por
 * fecha de recepción para traer huésped, fechas, habitación y estado.
 *
 * Marca en rojo los "pago sin reserva" (reservationPending: agotada o falla al
 * crear en Kunas), que hoy solo llegan por correo/reconciliación. También lista
 * reservas con referencia web (EST-…) que OTASync tiene pero SIN registro de
 * pago en el sistema, para que recepción las revise.
 *
 * Auth: guests.checkin.view. Read-only: no escribe en OTASync ni en Blobs.
 */

const DEFAULT_DAYS = 30;
const MAX_DAYS = 60;

function jsonResponse(statusCode, body) {
  const headers = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;
  return { statusCode, headers, body: JSON.stringify(body) };
}

const defaultDeps = {
  now: () => Date.now(),
  hasOtasyncCreds: () => require('./_otasync').hasOtasyncCreds(),
  getReservationsByDate: (args) => require('./_otasync').getReservationsByDate(args)
};
const deps = { ...defaultDeps };

function isoDay(ms) {
  /* Día en Colombia (UTC-5). */
  return new Date(ms - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/* Fila de la lista a partir de la entrada de booking-results (+ reserva OTASync
   si se encontró). Pura (testeable). */
function webRow({ webCode, entry }, reservation) {
  const e = entry || {};
  const r = reservation || null;
  const payment = hoy.withReservationMatch(hoy.paymentFromResult(e, null), r);
  const otasyncId = (r && r.idReservations) || e.otasyncId ||
    (e.bookingCode && String(e.bookingCode) !== String(webCode) ? String(e.bookingCode) : null);
  return {
    webCode,
    bookingCode: otasyncId || null,
    createdAt: e.createdAt || null,
    payment,
    needsAttention: payment ? payment.status === 'pago_sin_reserva' : false,
    guestName: r ? `${r.firstName || ''} ${r.lastName || ''}`.trim() : '',
    roomName: r ? (r.roomName || '') : '',
    checkIn: r ? r.dateArrival : null,
    checkOut: r ? r.dateDeparture : null,
    nights: r ? r.nights : null,
    pmsStatus: r ? (r.status || '') : null,
    hasEmail: r ? Boolean(r.email) : false,
    source: 'booking-results'
  };
}

/* Reserva web que OTASync tiene pero de la que no quedó registro de pago. */
function orphanRow(r) {
  return {
    webCode: String(r.reference || '').trim(),
    bookingCode: r.idReservations,
    createdAt: null,
    payment: null,
    needsAttention: false,
    guestName: `${r.firstName || ''} ${r.lastName || ''}`.trim(),
    roomName: r.roomName || '',
    checkIn: r.dateArrival,
    checkOut: r.dateDeparture,
    nights: r.nights,
    pmsStatus: r.status || '',
    hasEmail: Boolean(r.email),
    source: 'otasync'
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return jsonResponse(200, {});
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method Not Allowed' });

  const auth = await authorize(event, 'guests.checkin.view');
  if (!auth.ok) return jsonResponse(auth.statusCode, { error: auth.error });

  const qp = event.queryStringParameters || {};
  const days = Math.min(MAX_DAYS, Math.max(1, parseInt(qp.days, 10) || DEFAULT_DAYS));
  const now = deps.now();

  try {
    const results = await hoy.listRecentWebResults({ days, now, deps });

    /* Cruce con OTASync por fecha de recepción (solo lectura). Un día extra de
       margen por el desfase entre el pago y la creación en Kunas. */
    let reservations = [];
    let pmsAvailable = false;
    if (deps.hasOtasyncCreds()) {
      try {
        const res = await deps.getReservationsByDate({
          filterBy: 'date_received', dfrom: isoDay(now - (days + 1) * hoy.DAY_MS), dto: isoDay(now)
        });
        reservations = (res && res.reservations) || [];
        pmsAvailable = true;
      } catch (e) {
        console.error('[staff-web-bookings] OTASync lookup failed (non-fatal):', e.message);
      }
    }
    const byRef = new Map();
    const byId = new Map();
    for (const r of reservations) {
      if (r.reference) byRef.set(String(r.reference).trim().toUpperCase(), r);
      if (r.idReservations) byId.set(String(r.idReservations), r);
    }

    const matched = new Set();
    const items = results.items.map((it) => {
      const e = it.entry || {};
      const r = byRef.get(String(it.webCode).toUpperCase()) ||
        byId.get(String(e.otasyncId || '')) || byId.get(String(e.bookingCode || '')) || null;
      if (r) matched.add(r.idReservations);
      return webRow(it, r);
    });

    const orphans = reservations
      .filter(r => hoy.isWebReference(r.reference) && !matched.has(r.idReservations))
      .map(orphanRow);

    const all = items.concat(orphans);
    return jsonResponse(200, {
      days,
      count: all.length,
      attention: all.filter(x => x.needsAttention).length,
      items: all,
      pmsAvailable,
      storeAvailable: !results.unavailable,
      /* Lectura parcial de booking-results: la UI no debe marcar "sin registro
         de pago" en las reservas de Kunas sin cruce. */
      partial: Boolean(results.unavailable || results.partial)
    });
  } catch (e) {
    console.error('[staff-web-bookings]', e.message);
    return jsonResponse(503, { error: 'No se pudo cargar la lista de reservas web' });
  }
};

exports._test = {
  webRow, orphanRow, isoDay, DEFAULT_DAYS, MAX_DAYS,
  setDeps(overrides = {}) { Object.assign(deps, overrides); },
  resetDeps() { Object.keys(deps).forEach(k => delete deps[k]); Object.assign(deps, defaultDeps); }
};
