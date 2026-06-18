/* Autenticación del personal del restaurante para el pase de desayuno.
 *
 * Reusa la verificación de tokens de Firebase de _firebase-auth y aplica una
 * allowlist propia: STAFF_EMAILS ∪ ADMIN_EMAILS (un admin también puede entrar
 * al panel del comedor). Mismo patrón que authenticateAdmin, sin tocar ese
 * módulo, para que el panel de staff tenga su propio control de acceso. */

const { verifyFirebaseToken } = require('./_firebase-auth');
const { isDemoMode } = require('./_guest-app');

function staffAllowlist() {
  const read = name => (process.env[name] || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([...read('STAFF_EMAILS'), ...read('ADMIN_EMAILS')])];
}

/* Verifies the Authorization header and enforces the staff allowlist.
   Returns { ok: true, email } or { ok: false, statusCode, error }. */
async function authenticateStaff(event) {
  // Modo demo local (sin Firebase configurado): se permite el acceso para poder
  // probar el panel sin credenciales. En cualquier deploy Netlify isDemoMode()
  // es false, así que esto NO abre nada en producción.
  if (isDemoMode() && !process.env.FIREBASE_PROJECT_ID) {
    return { ok: true, email: 'demo@local', demo: true };
  }

  const authHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return { ok: false, statusCode: 401, error: 'Autenticación requerida' };

  let payload;
  try {
    payload = await verifyFirebaseToken(match[1], process.env.FIREBASE_PROJECT_ID);
  } catch (err) {
    return { ok: false, statusCode: 401, error: `Token inválido: ${err.message}` };
  }

  if (!payload.email_verified) return { ok: false, statusCode: 403, error: 'Correo no verificado' };
  const email = (payload.email || '').toLowerCase();

  const allowlist = staffAllowlist();
  if (allowlist.length === 0) return { ok: false, statusCode: 403, error: 'STAFF_EMAILS/ADMIN_EMAILS no configurado' };
  if (!allowlist.includes(email)) return { ok: false, statusCode: 403, error: 'Acceso no autorizado' };

  return { ok: true, email };
}

module.exports = { authenticateStaff, staffAllowlist };
