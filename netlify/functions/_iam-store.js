/* Almacén de usuarios y roles (IAM) del panel /admin, en Netlify Blobs.
 *
 * Capa de AUTORIZACIÓN sobre la identidad de Firebase: aquí vive QUÉ puede hacer
 * cada email. Es aditivo a las env vars (ADMIN_EMAILS/STAFF_EMAILS siguen siendo
 * superusuarios de respaldo, evaluados en `_authz.js`). Best-effort: sin Blobs
 * (dev) las lecturas devuelven vacío y el sistema cae a las env vars.
 *
 * Claves:
 *   user/<email>  → registro de usuario (roles, permisos extra/denegados, estado)
 *   role/<id>     → rol personalizado / override de permisos de un rol builtin
 */

const STORE = 'iam';

function getIamStore() {
  const { getStore } = require('@netlify/blobs');
  const opts = { name: STORE, consistency: 'strong' };
  if (process.env.BLOBS_TOKEN && process.env.NETLIFY_SITE_ID) {
    opts.token = process.env.BLOBS_TOKEN;
    opts.siteID = process.env.NETLIFY_SITE_ID;
  }
  return getStore(opts);
}

function normEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function nowIso() { return new Date().toISOString(); }

/* ---- Usuarios ---- */

async function getUser(email, deps = {}) {
  const e = normEmail(email);
  if (!e) return null;
  try {
    const store = deps.store || getIamStore();
    const raw = await store.get(`user/${e}`);
    return raw ? JSON.parse(raw) : null;
  } catch (err) { return null; }
}

async function listUsers(deps = {}) {
  const out = [];
  try {
    const store = deps.store || getIamStore();
    const listing = await store.list({ prefix: 'user/' });
    for (const entry of (listing.blobs || [])) {
      try {
        const raw = await store.get(entry.key);
        if (raw) out.push(JSON.parse(raw));
      } catch (e) { /* skip unreadable */ }
    }
  } catch (err) { /* no blobs */ }
  out.sort((a, b) => String(a.email).localeCompare(String(b.email)));
  return out;
}

async function saveUser(record, deps = {}) {
  const e = normEmail(record && record.email);
  if (!e) throw new Error('email requerido');
  const store = deps.store || getIamStore();
  record.email = e;
  record.updatedAt = nowIso();
  await store.set(`user/${e}`, JSON.stringify(record));
  return record;
}

async function deleteUser(email, deps = {}) {
  const e = normEmail(email);
  if (!e) return;
  const store = deps.store || getIamStore();
  await store.delete(`user/${e}`);
}

/* ---- Roles personalizados / overrides ---- */

async function getRole(id, deps = {}) {
  const rid = String(id || '').trim();
  if (!rid) return null;
  try {
    const store = deps.store || getIamStore();
    const raw = await store.get(`role/${rid}`);
    return raw ? JSON.parse(raw) : null;
  } catch (err) { return null; }
}

async function listRoles(deps = {}) {
  const out = [];
  try {
    const store = deps.store || getIamStore();
    const listing = await store.list({ prefix: 'role/' });
    for (const entry of (listing.blobs || [])) {
      try {
        const raw = await store.get(entry.key);
        if (raw) out.push(JSON.parse(raw));
      } catch (e) { /* skip */ }
    }
  } catch (err) { /* no blobs */ }
  return out;
}

async function saveRole(record, deps = {}) {
  const rid = String(record && record.id || '').trim();
  if (!rid) throw new Error('id de rol requerido');
  const store = deps.store || getIamStore();
  record.id = rid;
  record.updatedAt = nowIso();
  await store.set(`role/${rid}`, JSON.stringify(record));
  return record;
}

async function deleteRole(id, deps = {}) {
  const rid = String(id || '').trim();
  if (!rid) return;
  const store = deps.store || getIamStore();
  await store.delete(`role/${rid}`);
}

/* Mapa id → { permissions } de los roles personalizados/override, para que
   `_permissions.permissionsForRoles` los aplique encima de los builtins. */
async function getCustomRolesMap(deps = {}) {
  const map = {};
  const roles = await listRoles(deps);
  for (const r of roles) {
    if (r && r.id && Array.isArray(r.permissions)) map[r.id] = { permissions: r.permissions };
  }
  return map;
}

module.exports = {
  getIamStore, normEmail,
  getUser, listUsers, saveUser, deleteUser,
  getRole, listRoles, saveRole, deleteRole, getCustomRolesMap
};
