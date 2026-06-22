/* Tablero "día de desayunos" (panel admin + comedor) — SIN montos.
 *
 * Muestra lo SERVIDO en una fecha (default hoy) agrupado por reserva, más un
 * resumen de conteos (del día y del ciclo de facturación en curso = mes),
 * desglosado por fuente (incluido / upgrade / cortesía). Reusa las redenciones
 * (_breakfast-store), que son la fuente de verdad de lo realmente servido. NO
 * expone dinero, así que el comedor (STAFF_EMAILS) también puede verlo.
 *
 * Nota de alcance: el "total de desayunos esperados/disponibles para el día"
 * (roster de reservas in-house aún no servidas) NO se incluye aquí — OTASync no
 * expone limpio el listado de reservas in-house por fecha (su endpoint de
 * huéspedes es un maestro de CRM sin id_reservations). Para ver el derecho/pendiente
 * de UNA reserva, usar el lookup (breakfast-status). */

const { json, corsHeaders, parseJsonBody } = require('./_guest-app');
const { authorize } = require('./_authz');
const { listRedemptions, todayBogota } = require('./_breakfast-store');

function firstOfMonth(day) { return String(day).slice(0, 8) + '01'; }

function tallyBySource(reds) {
  const t = { included: 0, upgrade: 0, courtesy: 0 };
  for (const r of reds) { if (t[r.source] != null) t[r.source]++; else t.included++; }
  return t;
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await authorize(event, 'breakfast.day');
  if (!auth.ok) return json(auth.statusCode, { error: auth.error });

  try {
    const body = parseJsonBody(event, 1000);
    const date = String(body.date || todayBogota()).slice(0, 10);

    const dayReds = await listRedemptions({ fromDate: date, toDate: date });
    const cycleReds = await listRedemptions({ fromDate: firstOfMonth(date), toDate: date });

    const byReservation = {};
    for (const r of dayReds) {
      const key = r.bookingCode;
      if (!byReservation[key]) byReservation[key] = { bookingCode: key, guestName: r.guestName || null, served: [] };
      byReservation[key].served.push({ guestIndex: r.guestIndex, source: r.source, servedAt: r.servedAt });
    }
    const reservations = Object.values(byReservation)
      .map(r => ({ bookingCode: r.bookingCode, guestName: r.guestName, count: r.served.length, served: r.served.sort((a, b) => Number(a.guestIndex) - Number(b.guestIndex)) }))
      .sort((a, b) => String(a.guestName || a.bookingCode).localeCompare(String(b.guestName || b.bookingCode)));

    return json(200, {
      ok: true,
      date,
      cycle: { fromDate: firstOfMonth(date), toDate: date },
      servedToday: dayReds.length,
      servedThisCycle: cycleReds.length,
      bySource: tallyBySource(dayReds),        // del día
      cycleBySource: tallyBySource(cycleReds), // del ciclo de facturación (mes)
      reservations                              // [{ bookingCode, guestName, count, served:[{guestIndex,source,servedAt}] }]
    });
  } catch (error) {
    console.error('[breakfast-day]', error.message);
    return json(error.statusCode || 500, {
      error: error.statusCode ? error.message : 'No fue posible cargar el día de desayunos.'
    });
  }
};
