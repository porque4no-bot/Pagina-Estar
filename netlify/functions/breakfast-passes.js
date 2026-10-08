/* Pases de desayuno por persona (Fase 2) — endpoint público.
 *
 * Recibe el token de pase firmado, lo valida y devuelve un pase por persona
 * (`bookingCode:guestIndex`) + el estado de desayuno de la reserva, para que la
 * página pública (pase-desayuno.html) renderice los QR SIN login. El token no da
 * acceso a la guest-app; solo identifica la reserva para mostrar sus pases.
 *
 * PII (Frente confirm, 2026-10): los datos del huésped (nombre, apartamento,
 * fechas) SOLO se devuelven con un token v2, que únicamente emite el servidor
 * (send-confirmation, desde los webhooks de pago, para reservas ya creadas).
 * Un token v1 legado pudo ser firmado por el antiguo endpoint público para
 * cualquier código, así que con él se entregan los pases (QR) pero NO la PII —
 * sin esto, un token v1 era un atajo al 2º factor de get-booking. */

const { json, corsHeaders, parseJsonBody } = require('./_guest-app');
const { verifyPassToken } = require('./_breakfast-pass');
const { resolveBreakfastStatus, BREAKFAST_SCHEDULE } = require('./_breakfast');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limit');

/* Datos de la reserva que ve el portador del pase. Con un token que no está
   ligado a una reserva verificada (legacy) solo el código, que ya conoce. */
function bookingView(status, claims) {
  if (!claims || claims.legacy) {
    return { bookingCode: status.bookingCode };
  }
  return {
    bookingCode: status.bookingCode,
    guestName: status.guestName,
    roomName: status.roomName,
    roomNumber: status.roomNumber,
    checkIn: status.checkIn,
    checkOut: status.checkOut
  };
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const limited = await checkRateLimit(event, { name: 'breakfast-passes', limit: 30, windowMs: 10 * 60 * 1000 });
  if (!limited.ok) return rateLimitResponse(corsHeaders(), limited.retryAfter);

  try {
    const body = parseJsonBody(event, 2000);
    const claims = verifyPassToken(body.token);
    if (!claims) return json(401, { error: 'Pase inválido o expirado.' });

    const status = await resolveBreakfastStatus(claims.bookingCode, {});
    if (!status) return json(404, { error: 'No encontramos la reserva.' });

    // Un pase por persona. Con desayuno, perDay personas; sin desayuno, al menos
    // una (para que el comedor pueda escanear y ofrecer el upgrade — Fase 3).
    const count = status.hasBreakfast ? status.perDay : Math.max(1, status.capacity || 1);
    const served = new Set((status.servedIndexes || []).map(Number));
    const passes = [];
    for (let i = 0; i < count; i++) {
      passes.push({
        guestIndex: i,
        label: `Huésped ${i + 1}`,
        code: `${status.bookingCode}:${i}`,
        served: served.has(i)
      });
    }

    return json(200, {
      ok: true,
      booking: bookingView(status, claims),
      limited: Boolean(claims.legacy),
      hasBreakfast: status.hasBreakfast,
      perDay: status.perDay,
      servedToday: status.servedToday,
      date: status.date,
      schedule: BREAKFAST_SCHEDULE,
      passes
    });
  } catch (error) {
    console.error('[breakfast-passes]', error.message);
    return json(error.statusCode || 500, {
      error: error.statusCode ? error.message : 'No fue posible cargar los pases.'
    });
  }
};

exports._test = { bookingView };
