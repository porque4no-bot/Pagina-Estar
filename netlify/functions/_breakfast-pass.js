/* Token de pase de desayuno (Fase 2) — abre la página de pases SIN login.
 *
 * Firmado con HMAC sobre una clave DERIVADA del secreto del guest-app (namespace
 * 'breakfast-pass'). Así un token de pase NO sirve como sesión de la guest-app
 * (requireGuest, que usa el secreto base, lo rechaza) ni al revés: el pase es de
 * baja sensibilidad (mostrar un QR) y no debe dar acceso a los datos del huésped.
 * Vida larga (cubre la estadía); el estado real de desayuno se resuelve aparte.
 *
 * VERSIONES (Frente confirm, 2026-10):
 *  - v2 (namespace 'breakfast-pass-v2'): la ÚNICA que se emite hoy, y solo en
 *    el servidor (send-confirmation, llamado por los webhooks de pago tras crear
 *    la reserva). Es la que breakfast-passes acepta para mostrar datos del
 *    huésped (nombre, apartamento, fechas).
 *  - v1 (namespace 'breakfast-pass-v1'): LEGADO. Hasta oct-2026 el endpoint
 *    público /api/send-confirmation firmaba v1 para CUALQUIER código que le
 *    mandaran, así que un v1 no prueba que su portador sea el huésped. Se sigue
 *    aceptando (para no romper pases legítimos ya enviados; caducan solos en
 *    ≤45 días) pero se marca `legacy: true` y breakfast-passes NO devuelve PII.
 */

const crypto = require('crypto');
const { isDemoMode } = require('./_guest-app');

const PASS_TTL_SECONDS = 45 * 24 * 60 * 60; // ~45 días: fallback si no se conoce el check-out
/* Con check-out conocido, el pase vale hasta el FIN del día de salida (hora
   Colombia, UTC-5) + este margen. Antes vencía a 45 días de emitido: una reserva
   hecha con más de 45 días de anticipación llegaba con el pase ya vencido. */
const PASS_GRACE_AFTER_CHECKOUT_SECONDS = 24 * 60 * 60;
/* Tope de seguridad: un check-out absurdo (año 2099) no debe emitir un pase eterno. */
const PASS_MAX_TTL_SECONDS = 550 * 24 * 60 * 60;

/* exp (epoch s) para un check-out 'YYYY-MM-DD': 23:59:59 de ese día en Bogotá
   + margen. null si la fecha no es válida. */
function expiryForCheckOut(checkOut) {
  const value = String(checkOut || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const endOfDay = Date.parse(`${value}T23:59:59-05:00`);
  if (Number.isNaN(endOfDay)) return null;
  return Math.floor(endOfDay / 1000) + PASS_GRACE_AFTER_CHECKOUT_SECONDS;
}

/* Firma compatible: signPassToken(bookingCode) y signPassToken(bookingCode,
   ttlSeconds) siguen igual; signPassToken(bookingCode, { checkOut }) vence
   relativo al check-out (y { checkOut, ttlSeconds } usa ttlSeconds solo si la
   fecha no sirve). */
function resolvePassExpiry(options, nowSeconds) {
  if (typeof options === 'number' && Number.isFinite(options)) return nowSeconds + options;
  const opts = options && typeof options === 'object' ? options : {};
  const fallbackTtl = typeof opts.ttlSeconds === 'number' && Number.isFinite(opts.ttlSeconds)
    ? opts.ttlSeconds
    : PASS_TTL_SECONDS;
  const fromCheckOut = expiryForCheckOut(opts.checkOut);
  if (fromCheckOut == null) return nowSeconds + fallbackTtl;
  return Math.min(fromCheckOut, nowSeconds + PASS_MAX_TTL_SECONDS);
}

function baseSecret() {
  const configured = process.env.GUEST_APP_TOKEN_SECRET || '';
  if (configured) return configured;
  if (isDemoMode()) return 'estar-guest-app-local-development-secret';
  const error = new Error('GUEST_APP_TOKEN_SECRET is not configured');
  error.statusCode = 503;
  throw error;
}

/* Clave derivada con namespace: separa los tokens de pase de los de sesión
   (y la v2 de la v1 legada). */
const PASS_NAMESPACES = { 1: 'breakfast-pass-v1', 2: 'breakfast-pass-v2' };
const CURRENT_PASS_VERSION = 2;

function passKey(version = CURRENT_PASS_VERSION) {
  return crypto.createHmac('sha256', baseSecret()).update(PASS_NAMESPACES[version]).digest();
}

function hmacMatches(encoded, signature, version) {
  const expected = crypto.createHmac('sha256', passKey(version)).update(encoded).digest('base64url');
  const a = Buffer.from(String(signature));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function signPassToken(bookingCode, options = PASS_TTL_SECONDS) {
  const payload = {
    bc: String(bookingCode),
    scope: 'breakfast-pass',
    v: CURRENT_PASS_VERSION,
    exp: resolvePassExpiry(options, Math.floor(Date.now() / 1000))
  };
  const encoded = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', passKey(CURRENT_PASS_VERSION)).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyPassToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;
  /* Primero la versión actual; si no, la legada v1 (sin PII aguas abajo). */
  let version = 0;
  if (hmacMatches(encoded, signature, CURRENT_PASS_VERSION)) version = CURRENT_PASS_VERSION;
  else if (hmacMatches(encoded, signature, 1)) version = 1;
  if (!version) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (payload.scope !== 'breakfast-pass') return null;
    if (!payload.bc || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    /* Un payload v2 firmado con la clave v1 (o al revés) no es válido. */
    if (version === CURRENT_PASS_VERSION && payload.v !== CURRENT_PASS_VERSION) return null;
    if (version === 1 && payload.v != null) return null;
    return { bookingCode: payload.bc, exp: payload.exp, version, legacy: version !== CURRENT_PASS_VERSION };
  } catch (e) {
    return null;
  }
}

module.exports = {
  signPassToken,
  verifyPassToken,
  expiryForCheckOut,
  PASS_TTL_SECONDS,
  PASS_GRACE_AFTER_CHECKOUT_SECONDS,
  PASS_MAX_TTL_SECONDS,
  CURRENT_PASS_VERSION
};
