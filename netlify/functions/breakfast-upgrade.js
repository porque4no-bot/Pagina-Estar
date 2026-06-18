/* Upgrade de desayuno en vivo (Fase 3) — el comedor agrega desayuno a una
 * reserva que no lo trae (Airbnb, u OTA sin esa tarifa).
 *
 * Reusa la infra de folio del guest-app: carga el desayuno a la cuenta de la
 * reserva en OTASync/Kunas (add_extra) y registra la redención como 'upgrade'
 * para que cuente en la liquidación al proveedor. El huésped lo paga al
 * check-out (modo "cargar a la cuenta"); el cobro en línea queda para después.
 *
 * Gated por BREAKFAST_UPGRADE_ENABLED (apagado por defecto): en producción no
 * mueve nada al folio hasta activarlo. En demo local (sin credenciales OTASync)
 * registra el upgrade sin tocar folio, para poder probar el flujo. */

const { json, corsHeaders, parseJsonBody } = require('./_guest-app');
const { authenticateStaff } = require('./_staff-auth');
const { resolveBreakfastStatus } = require('./_breakfast');
const { recordRedemption, SOURCE } = require('./_breakfast-store');
const { postOrderExtrasToFolio, hasOtasyncCreds } = require('./_otasync');
const { SERVICES } = require('./_services-catalog');

function parseQr(input) {
  const s = String(input || '').trim();
  const m = s.match(/^(.+?):(\d+)$/);
  return m ? { code: m[1] } : { code: s };
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await authenticateStaff(event);
  if (!auth.ok) return json(auth.statusCode, { error: auth.error });

  try {
    const body = parseJsonBody(event, 2000);
    let code = String(body.code || '').trim().slice(0, 80);
    if (!code && body.qr) code = parseQr(body.qr).code.slice(0, 80);
    if (!code) return json(400, { error: 'Falta el código de reserva.' });

    const status = await resolveBreakfastStatus(code, {});
    if (!status) return json(404, { error: 'No encontramos una reserva con ese código.' });
    if (status.hasBreakfast) {
      return json(409, { error: 'Esta reserva ya incluye desayuno; no necesita upgrade.', status });
    }

    const unitPrice = Number(SERVICES.desayuno && SERVICES.desayuno.price) || 20000;
    const maxPersons = Math.max(1, Number(status.capacity) || 1);
    let persons = Number(body.persons);
    if (!Number.isFinite(persons) || persons < 1) persons = maxPersons;
    persons = Math.min(persons, maxPersons);

    const enabled = process.env.BREAKFAST_UPGRADE_ENABLED === 'true';
    const creds = hasOtasyncCreds();

    // Con credenciales reales, el upgrade DEBE estar habilitado para cobrar al
    // folio antes de servir; si no, no se registra (no se sirve sin cobrar).
    if (creds && !enabled) {
      return json(403, { error: 'El upgrade de desayuno no está habilitado (BREAKFAST_UPGRADE_ENABLED).', status });
    }

    let folio = { posted: false, reason: creds ? 'enabled' : 'demo' };
    if (creds && enabled) {
      folio = await postOrderExtrasToFolio({
        idReservations: code,
        items: [{ name: 'Desayuno', unitPrice, quantity: persons }]
      });
    }

    // Registrar la(s) redención(es) como upgrade (cuentan en la liquidación).
    const redemptions = [];
    for (let i = 0; i < persons; i++) {
      redemptions.push(await recordRedemption({
        bookingCode: code, guestIndex: i, guestName: status.guestName,
        staffEmail: auth.email, source: SOURCE.UPGRADE
      }));
    }

    const fresh = await resolveBreakfastStatus(code, {});
    return json(200, {
      ok: true,
      added: persons,
      unitPrice,
      amount: unitPrice * persons,
      chargedToFolio: Boolean(folio.posted),
      folioReason: folio.reason || null,
      status: fresh
    });
  } catch (error) {
    console.error('[breakfast-upgrade]', error.message);
    return json(error.statusCode || 500, {
      error: error.statusCode ? error.message : 'No fue posible agregar el desayuno.'
    });
  }
};
