/* Capa de AUTORIZACIÓN del panel /admin.
 *
 * La IDENTIDAD sigue siendo 100% Firebase (RS256, email_verified) — esto solo
 * decide QUÉ permisos tiene un email. Es ADITIVO y las env vars son
 * SUPERUSUARIOS de respaldo ("break-glass"), evaluadas antes del store:
 *
 *   1) Token Firebase válido + email verificado.
 *   2) ¿email en ADMIN_EMAILS?  → TODOS los permisos (no se le puede revocar).
 *   3) ¿email en STAFF_EMAILS?  → permisos de cocina (comportamiento actual).
 *   4) ¿usuario activo en el store iam? → permisos por sus roles + extra.
 *   5) Efectivos = unión(2,3,4) menos deniedPermissions (pero los permisos que
 *      vienen de env NUNCA se pueden quitar, para no auto-bloquear al dueño).
 *
 * Un usuario suspendido pierde sus permisos del store, pero conserva los que le
 * den las env vars (el dueño no se puede bloquear a sí mismo).
 *
 * NO cambia el comportamiento de las funciones existentes: estas siguen usando
 * authenticateAdmin/authenticateStaff hasta que se migren a `authorize`.
 */

const { verifyFirebaseToken } = require('./_firebase-auth');
const {
  ALL_PERMISSIONS, STAFF_ENV_PERMISSIONS, permissionsForRoles, isValidPermission
} = require('./_permissions');

function readEnvList(name) {
  return (process.env[name] || '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
}
function adminEnvList() { return readEnvList('ADMIN_EMAILS'); }
function staffEnvList() { return [...new Set([...readEnvList('STAFF_EMAILS'), ...readEnvList('ADMIN_EMAILS')])]; }

function bearerToken(event) {
  const h = (event && event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

/* Demo local (sin Firebase configurado) — concede todo para poder probar el
   panel sin credenciales. En cualquier deploy Netlify FIREBASE_PROJECT_ID está
   definido, así que esto NUNCA abre nada en producción. */
function isDemoLocal() {
  try {
    const { isDemoMode } = require('./_guest-app');
    /* Solo en desarrollo local: NUNCA en un deploy Netlify (que siempre define
       process.env.NETLIFY), aunque falte FIREBASE_PROJECT_ID — blindaje contra
       el foot-gun de quedar con admin sin token en producción. */
    if (process.env.NETLIFY) return false;
    return typeof isDemoMode === 'function' && isDemoMode() && !process.env.FIREBASE_PROJECT_ID;
  } catch (e) { return false; }
}

/* Verifica la identidad (Firebase). Devuelve { ok, email, payload } o el error. */
async function verifyIdentity(event, deps = {}) {
  const verify = deps.verifyToken || (t => verifyFirebaseToken(t, process.env.FIREBASE_PROJECT_ID));
  const token = bearerToken(event);
  if (!token) return { ok: false, statusCode: 401, error: 'Autenticación requerida' };
  let payload;
  try { payload = await verify(token); }
  catch (err) { return { ok: false, statusCode: 401, error: `Token inválido: ${err.message}` }; }
  if (!payload.email_verified) return { ok: false, statusCode: 403, error: 'Correo no verificado' };
  const email = (payload.email || '').toLowerCase();
  if (!email) return { ok: false, statusCode: 403, error: 'Token sin correo' };
  return { ok: true, email, payload };
}

/* Calcula los permisos efectivos de un email cruzando env vars + store iam.
   Devuelve { permissions:Set, roles:[], isEnvAdmin, isEnvStaff, status, sources:[] }. */
async function getEffectivePermissions(email, deps = {}) {
  const e = String(email || '').toLowerCase();
  const isEnvAdmin = adminEnvList().includes(e);
  const isEnvStaff = staffEnvList().includes(e);
  const out = {
    permissions: new Set(), roles: [],
    isEnvAdmin, isEnvStaff: isEnvStaff && !isEnvAdmin,
    status: 'active', sources: []
  };

  /* (2) ADMIN_EMAILS → todos los permisos, no revocables. */
  if (isEnvAdmin) {
    ALL_PERMISSIONS.forEach(p => out.permissions.add(p));
    out.roles = ['admin'];
    out.sources.push('env:ADMIN_EMAILS');
    return out;
  }

  /* (3) STAFF_EMAILS → permisos de cocina (comportamiento actual). */
  const envPerms = new Set();
  if (isEnvStaff) { STAFF_ENV_PERMISSIONS.forEach(p => envPerms.add(p)); out.sources.push('env:STAFF_EMAILS'); }

  /* (4) Usuario del store iam. */
  const getUser = deps.getUser || require('./_iam-store').getUser;
  const getCustomRolesMap = deps.getCustomRolesMap || require('./_iam-store').getCustomRolesMap;
  let user = null;
  try { user = await getUser(e, deps); } catch (_) { /* sin blobs */ }

  let iamPerms = new Set();
  if (user) {
    out.sources.push('iam');
    if (user.status === 'suspended') {
      out.status = 'suspended';
    } else {
      let customRoles = {};
      try { customRoles = await getCustomRolesMap(deps); } catch (_) { customRoles = {}; }
      iamPerms = permissionsForRoles(user.roles || [], customRoles);
      (user.extraPermissions || []).forEach(p => { if (isValidPermission(p)) iamPerms.add(p); });
      out.roles = Array.isArray(user.roles) ? user.roles.slice() : [];
    }
  }

  /* (5) Unión env + iam, luego restar denied (env siempre gana). */
  envPerms.forEach(p => out.permissions.add(p));
  iamPerms.forEach(p => out.permissions.add(p));
  if (user && user.status !== 'suspended' && Array.isArray(user.deniedPermissions)) {
    for (const p of user.deniedPermissions) {
      if (!envPerms.has(p)) out.permissions.delete(p);
    }
  }
  return out;
}

/* Autoriza una acción. Si `requiredPermission` es null/undefined, basta con una
   identidad válida (cualquier usuario autenticado del panel). */
async function authorize(event, requiredPermission, deps = {}) {
  if (isDemoLocal()) {
    return { ok: true, email: 'demo@local', demo: true, permissions: ALL_PERMISSIONS.slice(), roles: ['admin'], isEnvAdmin: true };
  }
  const id = await verifyIdentity(event, deps);
  if (!id.ok) return id;
  const eff = await getEffectivePermissions(id.email, deps);
  if (requiredPermission && !eff.permissions.has(requiredPermission)) {
    return { ok: false, statusCode: 403, error: 'No tienes permiso para esta acción', email: id.email };
  }
  return {
    ok: true, email: id.email,
    permissions: [...eff.permissions], roles: eff.roles,
    isEnvAdmin: eff.isEnvAdmin, isEnvStaff: eff.isEnvStaff, status: eff.status
  };
}

module.exports = {
  verifyIdentity, getEffectivePermissions, authorize,
  adminEnvList, staffEnvList
};
