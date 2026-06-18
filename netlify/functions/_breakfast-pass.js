/* Token de pase de desayuno (Fase 2) — abre la página de pases SIN login.
 *
 * Firmado con HMAC sobre una clave DERIVADA del secreto del guest-app (namespace
 * 'breakfast-pass'). Así un token de pase NO sirve como sesión de la guest-app
 * (requireGuest, que usa el secreto base, lo rechaza) ni al revés: el pase es de
 * baja sensibilidad (mostrar un QR) y no debe dar acceso a los datos del huésped.
 * Vida larga (cubre la estadía); el estado real de desayuno se resuelve aparte.
 */

const crypto = require('crypto');
const { isDemoMode } = require('./_guest-app');

const PASS_TTL_SECONDS = 45 * 24 * 60 * 60; // ~45 días: estadía + margen

function baseSecret() {
  const configured = process.env.GUEST_APP_TOKEN_SECRET || '';
  if (configured) return configured;
  if (isDemoMode()) return 'estar-guest-app-local-development-secret';
  const error = new Error('GUEST_APP_TOKEN_SECRET is not configured');
  error.statusCode = 503;
  throw error;
}

/* Clave derivada con namespace: separa los tokens de pase de los de sesión. */
function passKey() {
  return crypto.createHmac('sha256', baseSecret()).update('breakfast-pass-v1').digest();
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function signPassToken(bookingCode, ttlSeconds = PASS_TTL_SECONDS) {
  const payload = {
    bc: String(bookingCode),
    scope: 'breakfast-pass',
    exp: Math.floor(Date.now() / 1000) + ttlSeconds
  };
  const encoded = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', passKey()).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyPassToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;
  const expected = crypto.createHmac('sha256', passKey()).update(encoded).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (payload.scope !== 'breakfast-pass') return null;
    if (!payload.bc || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { bookingCode: payload.bc, exp: payload.exp };
  } catch (e) {
    return null;
  }
}

module.exports = { signPassToken, verifyPassToken, PASS_TTL_SECONDS };
