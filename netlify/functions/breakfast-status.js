/* Consulta el estado de desayuno de una reserva/persona (panel del restaurante).
 *
 * Auth: personal del restaurante (Firebase + STAFF_EMAILS). Acepta el código de
 * reserva (escrito a mano) o el contenido del QR ("bookingCode:guestIndex").
 * Devuelve el derecho (incluido/cuántos), lo servido hoy y lo que falta. */

const { json, corsHeaders, parseJsonBody } = require('./_guest-app');
const { authorize } = require('./_authz');
const { resolveBreakfastStatus } = require('./_breakfast');
const { flag } = require('./_settings');
const { hasOtasyncCreds } = require('./_otasync');

/* ¿Puede ESTE usuario agregar desayuno (upgrade, cobra al folio) AHORA?
   Misma regla que breakfast-upgrade: permiso `breakfast.upgrade` y, con
   credenciales reales de OTASync, el flag BREAKFAST_UPGRADE_ENABLED encendido
   (sin credenciales = demo local, el upgrade se registra sin tocar folio).
   El panel del comedor usa esto para NO mostrar "Agregar desayuno" a quien no
   puede usarlo (p.ej. el tercero de desayunos, o con el flag apagado). */
async function canUpgradeNow(auth, d = {}) {
  const perms = Array.isArray(auth && auth.permissions) ? auth.permissions : [];
  if (!perms.includes('breakfast.upgrade')) return false;
  const creds = (d.hasOtasyncCreds || hasOtasyncCreds)();
  if (!creds) return true;
  try { return await (d.flag || flag)('BREAKFAST_UPGRADE_ENABLED'); }
  catch (e) { return false; }
}

/* "EST-123:2" → { code:"EST-123", guestIndex:2 }; "EST-123" → { code, guestIndex:undefined } */
function parseQr(input) {
  const s = String(input || '').trim();
  const m = s.match(/^(.+?):(\d+)$/);
  if (m) return { code: m[1], guestIndex: Number(m[2]) };
  return { code: s, guestIndex: undefined };
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await authorize(event, 'breakfast.status');
  if (!auth.ok) return json(auth.statusCode, { error: auth.error });

  try {
    const body = parseJsonBody(event, 2000);
    let code = String(body.code || '').trim().slice(0, 80);
    let guestIndex = body.guestIndex;
    if (body.qr) {
      const parsed = parseQr(body.qr);
      code = String(parsed.code).slice(0, 80);
      if (guestIndex == null || guestIndex === '') guestIndex = parsed.guestIndex;
    }
    if (!code) return json(400, { error: 'Falta el código de reserva.' });

    const status = await resolveBreakfastStatus(code, { guestIndex });
    if (!status) return json(404, { error: 'No encontramos una reserva con ese código.' });
    const canUpgrade = status.hasBreakfast ? false : await canUpgradeNow(auth);
    return json(200, { ok: true, status, canUpgrade });
  } catch (error) {
    console.error('[breakfast-status]', error.message);
    return json(error.statusCode || 500, {
      error: error.statusCode ? error.message : 'No fue posible consultar la reserva.'
    });
  }
};

exports._test = { canUpgradeNow, parseQr };
