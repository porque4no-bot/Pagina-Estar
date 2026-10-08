require('./_env');
const { authorize } = require('./_authz');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limit');
const hoy = require('./_staff-hoy');

/*
 * staff-resend-confirmation — Frente "Panel Hoy para recepción".
 *
 * POST { bookingCode } → reenvía al huésped el correo de confirmación de reserva
 * (el mismo de send-confirmation.sendConfirmationEmail).
 *
 * Seguridad: el endpoint público send-confirmation acepta los datos del cliente;
 * este NO. Solo recibe el código y arma el correo EXCLUSIVAMENTE con datos que
 * están en el servidor: la reserva leída de OTASync (solo lectura) + el pago en
 * línea registrado por el webhook (booking-results / payment-details). Así nadie
 * puede usar el panel para mandar un correo con datos o a un destinatario
 * inventado. El destinatario es SIEMPRE el correo que tiene la reserva.
 *
 * Auth: guests.checkin.view (recepción + admin). Rate-limited. Cada reenvío
 * queda en el store `staff-audit` (quién y cuándo). Salta el dedupe a propósito
 * (es un reenvío explícito); sin RESEND_API_KEY es un no-op (reason: no-key).
 */

const BOOKING_CODE_RE = /^[A-Za-z0-9-]{1,50}$/;

function jsonResponse(statusCode, body) {
  const headers = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;
  return { statusCode, headers, body: JSON.stringify(body) };
}

const defaultDeps = {
  getReservationDetail: (code) => require('./_guest-app').getReservationDetail(code),
  sendConfirmationEmail: (params, opts) => require('./send-confirmation').sendConfirmationEmail(params, opts),
  extractBreakfastEntitlement: (raw, cap) => require('./_breakfast').extractBreakfastEntitlement(raw, cap)
};
const deps = { ...defaultDeps };

function obfuscate(email) {
  const [user, domain] = String(email || '').split('@');
  if (!user || !domain) return '';
  return `${user.slice(0, 2)}***@${domain}`;
}

/* Arma los parámetros del correo SOLO con datos de servidor. Pura (testeable). */
function buildConfirmationParams(booking, payment, breakfast) {
  const raw = (booking && booking.raw) || {};
  const guestEmail = String((booking && booking.guestEmail) || raw.email || '').trim();
  const total = Number(booking && booking.totalAmount) || Number(raw.total_price) || 0;
  const remaining = Number(raw.remaining_amount);
  let paidAmount = 0;
  if (payment && payment.amountCents) paidAmount = payment.amountCents / 100;
  else if (Number.isFinite(remaining) && raw.remaining_amount != null) paidAmount = Math.max(0, total - remaining);
  return {
    guestEmail,
    guestName: (booking && booking.guestName) || `${raw.first_name || ''} ${raw.last_name || ''}`.trim() || 'Huésped',
    bookingCode: String((booking && booking.bookingCode) || ''),
    roomName: (booking && booking.roomName) || '',
    checkIn: (booking && booking.checkIn) || '',
    checkOut: (booking && booking.checkOut) || '',
    nights: Number(booking && booking.nights) || 1,
    totalAmount: total,
    paidAmount,
    phone: String(raw.phone || ''),
    breakfast: Boolean(breakfast),
    via: 'staff-resend'
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return jsonResponse(200, {});
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method Not Allowed' });

  const auth = await authorize(event, 'guests.checkin.view');
  if (!auth.ok) return jsonResponse(auth.statusCode, { error: auth.error });

  const limited = await checkRateLimit(event, { name: 'staff-resend-confirmation', limit: 20, windowMs: 60 * 60 * 1000 });
  if (!limited.ok) return rateLimitResponse({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, limited.retryAfter);

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return jsonResponse(400, { error: 'JSON inválido' }); }
  const bookingCode = String((body && body.bookingCode) || '').trim();
  if (!BOOKING_CODE_RE.test(bookingCode)) return jsonResponse(400, { error: 'bookingCode no válido' });

  let booking;
  try {
    booking = await deps.getReservationDetail(bookingCode);
  } catch (e) {
    console.error('[staff-resend-confirmation] reservation lookup failed:', e.message);
    return jsonResponse(503, { error: 'No se pudo consultar la reserva en el PMS' });
  }
  if (!booking) return jsonResponse(404, { error: 'Reserva no encontrada' });
  const status = String(booking.status || '').toLowerCase();
  if (status === 'canceled' || status === 'cancelled') {
    return jsonResponse(409, { error: 'La reserva está cancelada; no se reenvía la confirmación' });
  }

  const raw = booking.raw || {};
  const payment = await hoy.getWebPayment({ reference: raw.reference, bookingCode: booking.bookingCode || bookingCode }, deps);
  let breakfast = false;
  try {
    breakfast = booking.demo ? false : Boolean(deps.extractBreakfastEntitlement(raw, booking.capacity).included);
  } catch (e) { breakfast = false; }

  const params = buildConfirmationParams(booking, payment, breakfast);
  if (!params.guestEmail) return jsonResponse(422, { error: 'La reserva no tiene correo del huésped en el PMS' });

  let result;
  try {
    result = await deps.sendConfirmationEmail(params, { dedupe: false });
  } catch (e) {
    console.error('[staff-resend-confirmation] send failed:', e.message);
    result = { sent: false, reason: 'error' };
  }

  await hoy.appendStaffAudit({
    action: 'confirmation.resend', actor: auth.email, bookingCode: params.bookingCode,
    sent: Boolean(result && result.sent), reason: (result && result.reason) || null, ip: hoy.clientIp(event)
  }, deps);

  if (result && result.sent) {
    return jsonResponse(200, { sent: true, to: obfuscate(params.guestEmail), bookingCode: params.bookingCode });
  }
  const reason = (result && result.reason) || 'error';
  const code = reason === 'no-key' ? 200 : (reason === 'timeout' ? 504 : 502);
  return jsonResponse(code, { sent: false, reason, to: obfuscate(params.guestEmail) });
};

exports._test = {
  buildConfirmationParams, obfuscate,
  setDeps(overrides = {}) { Object.assign(deps, overrides); },
  resetDeps() { Object.keys(deps).forEach(k => delete deps[k]); Object.assign(deps, defaultDeps); }
};
