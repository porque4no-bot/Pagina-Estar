require('./_env');
const { authorize } = require('./_authz');
const { getReservationsByDate, hasOtasyncCreds, isHoldReservation } = require('./_otasync');
const hoy = require('./_staff-hoy');

/*
 * staff-today — Staff App v1 (read-only), Sprint 1 (Mesa Redonda: el mayor vacío
 * era que no existe una consola operativa del día). Una sola llamada que arma el
 * tablero "Hoy" combinando piezas que YA existen en el código:
 *   - roster del día vía getReservationsByDate (hoy invisible para el staff):
 *       · llegadas (date_arrival = fecha)
 *       · salidas   (date_departure = fecha)
 *       · en casa   (date_arrival <= fecha < date_departure)
 *   - cola de reembolsos pendientes (solo si el rol tiene refunds.view).
 *   - (Frente Hoy) por reserva: canal, teléfono, saldo del folio, pago en línea
 *     y su estado (booking-results / payment-details), ¿check-in hecho? y marca
 *     de revisión manual (guest-checkins), pedidos "cargar a la cuenta" sin cobrar
 *     y documentos por verificar (ops-queue). Ver _staff-hoy.js.
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

/* Ventana hacia atrás (desde la llegada más antigua del tablero) en la que se
   buscan check-ins: el huésped puede hacer el check-in en línea días antes. */
const CHECKIN_LOOKBACK_DAYS = 30;

/* Forma operativa de una reserva para recepción. `extra` trae el cruce con lo
   que guarda el sistema (pago en línea, check-in, tareas). Sin correo ni datos
   de documento: el detalle del check-in va por staff-checkin-view (auditado). */
function publicReservation(r, extra = {}) {
  const payment = extra.payment || null;
  const checkins = Array.isArray(extra.checkins) ? extra.checkins : [];
  const latest = checkins[0] || null;
  const tasks = extra.tasks || { pendingOrders: [], verifyDocument: 0 };
  const pendingOrders = Array.isArray(tasks.pendingOrders) ? tasks.pendingOrders : [];
  return {
    bookingCode: r.idReservations,
    guestName: `${r.firstName || ''} ${r.lastName || ''}`.trim(),
    roomName: r.roomName || '',
    roomNumber: r.roomNumber || '',
    checkIn: r.dateArrival,
    checkOut: r.dateDeparture,
    nights: r.nights,
    status: r.status,
    hasBreakfast: r.hasBreakfast,
    channel: hoy.channelLabel(r, payment),
    /* Web = motor propio (referencia EST-…); las cotizaciones (COT-) tienen pago
       en línea pero su propio correo, por eso no cuentan como web. */
    isWeb: hoy.isWebReference(r.reference),
    webCode: hoy.isWebReference(r.reference) ? String(r.reference).trim() : null,
    phone: r.phone || '',
    hasEmail: Boolean(r.email),
    totalPrice: Number(r.totalPrice) || 0,
    balance: Number(r.remainingAmount) || 0,
    payment,
    /* true = no se pudo leer el registro de pago (Blobs caído): la UI no debe
       mostrar "sin registro de pago" en ese caso. */
    paymentUnknown: extra.paymentUnknown === true,
    /* true = no se pudo leer la cola de tareas: "0 pedidos" no es confiable. */
    tasksUnknown: extra.tasksUnknown === true,
    checkin: latest
      ? {
          done: true,
          checkinId: latest.checkinId,
          createdAt: latest.createdAt,
          manualReview: latest.manualReview === true,
          manualReviewGuests: latest.manualReviewGuests || 0,
          guests: latest.guests,
          count: checkins.length
        }
      : { done: false },
    pendingOrders,
    pendingOrdersCount: pendingOrders.length,
    verifyDocumentTasks: Number(tasks.verifyDocument) || 0
  };
}

function uniqueByCode(list) {
  const seen = new Map();
  for (const r of list) if (r && r.idReservations && !seen.has(r.idReservations)) seen.set(r.idReservations, r);
  return [...seen.values()];
}

/* Cruce best-effort con Blobs (pagos web, check-ins, cola de tareas). Cada pieza
   falla por separado sin tumbar el tablero; `status` dice qué se pudo leer. */
async function buildEnrichment(reservations, deps = {}) {
  const list = uniqueByCode(reservations);
  const codes = list.map(r => r.idReservations);
  const status = { payments: true, checkins: true, tasks: true };
  const payments = new Map();
  const unknownPayments = new Set();
  let checkinMap = new Map();
  let taskMap = new Map();

  const arrivalsMs = list.map(r => Date.parse(`${r.dateArrival}T00:00:00Z`)).filter(Number.isFinite);
  const sinceMs = arrivalsMs.length ? Math.min(...arrivalsMs) - CHECKIN_LOOKBACK_DAYS * hoy.DAY_MS : 0;

  await Promise.all([
    (async () => {
      /* getWebPayment LANZA si booking-results/payment-details no responden: esa
         reserva queda "desconocida" (no "sin registro de pago") y el tablero
         avisa lectura parcial con enrichment.payments=false. */
      try {
        await hoy.mapLimit(list, 8, async (r) => {
          try {
            const p = await hoy.getWebPayment({ reference: r.reference, bookingCode: r.idReservations }, deps);
            /* La fila ES una reserva de Kunas: si el pago decía "sin reserva",
               ya se creó (a mano o por reintento) → no es alarma. */
            if (p) payments.set(r.idReservations, hoy.withReservationMatch(p, r));
          } catch (e) {
            status.payments = false;
            unknownPayments.add(r.idReservations);
          }
        });
      } catch (e) { status.payments = false; }
    })(),
    (async () => {
      try {
        const res = await hoy.findCheckins(codes, { sinceMs, deps });
        checkinMap = res.byBooking;
        if (res.unavailable) status.checkins = false;
      } catch (e) { status.checkins = false; }
    })(),
    (async () => {
      try {
        /* strict: un fallo de la cola LANZA en vez de devolver [] — si no, el
           tablero diría "0 pedidos por cobrar" cuando en verdad no pudo leerla. */
        const listOpen = deps.listOpen || require('./_ops-queue').listOpen;
        taskMap = hoy.tasksByBooking(await listOpen({ strict: true }));
      } catch (e) { status.tasks = false; }
    })()
  ]);

  const toPublic = (r) => publicReservation(r, {
    payment: payments.get(r.idReservations) || null,
    paymentUnknown: unknownPayments.has(r.idReservations),
    tasksUnknown: !status.tasks,
    checkins: checkinMap.get(r.idReservations) || [],
    tasks: taskMap.get(r.idReservations)
  });
  return { toPublic, status };
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

    /* Excluir nuestros holds internos (BLOQUEO/COT-) para que recepción no vea
       "huéspedes fantasma" ni se inflen los conteos del tablero. */
    const windowList = (windowArrivals.reservations || []).filter(r => ACTIVE_STATUSES.has(String(r.status || '').toLowerCase()) && !isHoldReservation(r));
    const arrivals = windowList.filter(r => r.dateArrival === date);
    const inHouse = windowList.filter(r => r.dateArrival <= date && r.dateDeparture > date);
    const departures = (departuresRes.reservations || []).filter(r => ACTIVE_STATUSES.has(String(r.status || '').toLowerCase()) && !isHoldReservation(r));

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

    const { toPublic, status: enrichment } = await buildEnrichment([...arrivals, ...inHouse, ...departures], deps);

    return jsonResponse(200, {
      date, isMock: false,
      arrivals: arrivals.map(toPublic),
      departures: departures.map(toPublic),
      inHouse: inHouse.map(toPublic),
      counts: { arrivals: arrivals.length, departures: departures.length, inHouse: inHouse.length },
      refunds,
      enrichment
    });
  } catch (e) {
    console.error('[staff-today]', e.message);
    return jsonResponse(503, { error: 'No se pudo cargar el tablero del día' });
  }
};

/* Deps inyectables en pruebas (stores de Blobs falsos, cola de tareas). */
const deps = {};

exports._test = {
  publicReservation, buildEnrichment, shiftDate, bogotaToday, isValidDate, LOOKBACK_DAYS, CHECKIN_LOOKBACK_DAYS,
  setDeps(overrides = {}) { Object.assign(deps, overrides); },
  resetDeps() { Object.keys(deps).forEach(k => delete deps[k]); }
};
