/* Analítica de desayunos (Fase 4) — endpoint del panel de administración.
 *
 * Agrega las redenciones registradas (_breakfast-store) en un rango de fechas:
 * total servidos (= base para liquidarle al proveedor), incluidos vs upgrades
 * vendidos (y su monto), y la distribución por día y por hora (horarios pico).
 * Default: mes en curso. Auth de equipo (Firebase + STAFF_EMAILS∪ADMIN_EMAILS). */

const { json, corsHeaders, parseJsonBody } = require('./_guest-app');
const { authenticateStaff } = require('./_staff-auth');
const { listRedemptions, todayBogota } = require('./_breakfast-store');
const { SERVICES } = require('./_services-catalog');

/* Hora de Colombia (UTC-5, sin DST) de un timestamp ISO. */
function hourBogota(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return (d.getUTCHours() + 24 - 5) % 24;
}

function firstOfMonth() {
  return todayBogota().slice(0, 8) + '01';
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await authenticateStaff(event);
  if (!auth.ok) return json(auth.statusCode, { error: auth.error });

  try {
    const body = parseJsonBody(event, 1000);
    const fromDate = String(body.fromDate || firstOfMonth()).slice(0, 10);
    const toDate = String(body.toDate || todayBogota()).slice(0, 10);

    const reds = await listRedemptions({ fromDate, toDate });
    const unitPrice = Number(SERVICES.desayuno && SERVICES.desayuno.price) || 20000;

    let included = 0;
    let upgrades = 0;
    const byDay = {};
    const byHour = {};
    for (const r of reds) {
      if (r.source === 'upgrade') upgrades++; else included++;
      if (r.date) byDay[r.date] = (byDay[r.date] || 0) + 1;
      const h = hourBogota(r.servedAt);
      if (h != null) byHour[h] = (byHour[h] || 0) + 1;
    }
    const served = reds.length;

    return json(200, {
      ok: true,
      range: { fromDate, toDate },
      served,                       // total servidos = base para liquidar al proveedor
      toLiquidate: served,
      included,                     // desayunos incluidos en la tarifa (sin cobro extra)
      upgrades,                     // desayunos vendidos en el momento (OTA/Airbnb)
      upgradeAmount: upgrades * unitPrice,
      unitPrice,
      byDay,                        // { 'YYYY-MM-DD': count }
      byHour                        // { hour(0-23): count }
    });
  } catch (error) {
    console.error('[breakfast-analytics]', error.message);
    return json(error.statusCode || 500, {
      error: error.statusCode ? error.message : 'No fue posible cargar la analítica.'
    });
  }
};
