require('./_env');
const { authorize } = require('./_authz');
const { ALL_PERMISSIONS, DEFAULT_ROLES, BUILTIN_ROLE_IDS, ROLE_LABELS } = require('./_permissions');

/* Devuelve al panel /admin los permisos efectivos del usuario autenticado, para
   que la UI muestre solo las pestañas/acciones que puede usar. Solo expone los
   permisos del PROPIO usuario (nunca de otros). Read-only. */
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (!['GET', 'POST'].includes(event.httpMethod)) {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const auth = await authorize(event, null);
  if (!auth.ok) return { statusCode: auth.statusCode, headers, body: JSON.stringify({ error: auth.error }) };

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      email: auth.email,
      permissions: auth.permissions,
      roles: auth.roles,
      isEnvAdmin: !!auth.isEnvAdmin,
      isEnvStaff: !!auth.isEnvStaff,
      status: auth.status || 'active',
      /* Catálogo para que la UI pinte la matriz de roles/permisos. */
      catalog: { permissions: ALL_PERMISSIONS, builtinRoles: BUILTIN_ROLE_IDS, defaultRoles: DEFAULT_ROLES, roleLabels: ROLE_LABELS }
    })
  };
};
