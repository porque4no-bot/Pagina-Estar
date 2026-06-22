/* Marca un desayuno como servido (panel del restaurante).
 *
 * Auth: personal del restaurante (Firebase + STAFF_EMAILS). El registro ES la
 * autorización para servir: idempotente por (reserva, persona, día), así un
 * doble escaneo no duplica y nadie se sirve dos veces el mismo día. En Fase 1,
 * si la reserva no incluye desayuno se rechaza (el upgrade en vivo es Fase 3). */

const { json, corsHeaders, parseJsonBody } = require('./_guest-app');
const { authorize } = require('./_authz');
const { resolveBreakfastStatus, pickNextGuestIndex } = require('./_breakfast');
const { recordRedemption, SOURCE } = require('./_breakfast-store');

function parseQr(input) {
  const s = String(input || '').trim();
  const m = s.match(/^(.+?):(\d+)$/);
  if (m) return { code: m[1], guestIndex: Number(m[2]) };
  return { code: s, guestIndex: undefined };
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await authorize(event, 'breakfast.redeem');
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
    if (!status.hasBreakfast) {
      return json(409, { error: 'Esta reserva no tiene desayuno incluido.', status });
    }

    // Persona a servir: la del QR si vino, o la siguiente sin servir hoy.
    const hasIdx = guestIndex != null && guestIndex !== '';
    const idx = hasIdx ? Number(guestIndex) : pickNextGuestIndex(status);
    if (idx == null) return json(409, { error: 'Ya se sirvieron todos los desayunos de hoy.', status });
    if (idx < 0 || idx >= status.perDay) return json(400, { error: 'Persona fuera del cupo de desayunos.', status });

    const result = await recordRedemption({
      bookingCode: status.bookingCode,
      guestIndex: idx,
      guestName: status.guestName,
      staffEmail: auth.email,
      source: SOURCE.INCLUDED
    });

    const fresh = await resolveBreakfastStatus(code, { guestIndex: idx });
    return json(200, {
      ok: true,
      created: result.created,
      alreadyServed: !result.created,
      guestIndex: idx,
      status: fresh
    });
  } catch (error) {
    console.error('[breakfast-redeem]', error.message);
    return json(error.statusCode || 500, {
      error: error.statusCode ? error.message : 'No fue posible registrar el desayuno.'
    });
  }
};
