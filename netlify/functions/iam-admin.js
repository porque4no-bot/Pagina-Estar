require('./_env');
const { authorize } = require('./_authz');
const {
  ALL_PERMISSIONS, PERMISSION_SET, isValidPermission,
  DEFAULT_ROLES, BUILTIN_ROLE_IDS, permissionsForRoles
} = require('./_permissions');
const iam = require('./_iam-store');

/* Gestión de usuarios y roles del panel /admin (la capa de AUTORIZACIÓN; la
   identidad sigue siendo Firebase). Acciones (por POST { action, ... }):
     list-users / upsert-user / delete-user / suspend-user   → permiso users.manage
     list-roles / upsert-role / delete-role                  → permiso roles.manage
   Guardas de seguridad (anti-escalada): un actor no puede otorgar permisos que
   no tiene; solo un superusuario-env o un admin completo puede crear admins;
   nadie se puede auto-bloquear; nunca se queda el sistema sin admin; toda
   mutación queda en un audit append-only. Las env vars (ADMIN_EMAILS) siguen
   siendo el respaldo y NO se editan desde aquí. */

/* ── Helpers puros (testeables) ── */

function sanitizePermissionList(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map(p => String(p || '').trim()).filter(p => PERMISSION_SET.has(p)))];
}

function sanitizeRoleList(list, knownRoleIds) {
  if (!Array.isArray(list)) return [];
  const known = new Set(knownRoleIds || BUILTIN_ROLE_IDS);
  return [...new Set(list.map(r => String(r || '').trim()).filter(r => known.has(r)))];
}

/* Permisos efectivos que TENDRÍA un registro de usuario (sin contar env vars). */
function effectivePermsForRecord(record, customRolesMap) {
  const perms = permissionsForRoles(record.roles || [], customRolesMap || {});
  for (const p of (record.extraPermissions || [])) if (isValidPermission(p)) perms.add(p);
  for (const p of (record.deniedPermissions || [])) perms.delete(p);
  return perms;
}

/* Anti-escalada: el actor solo puede conceder permisos que él mismo posee
   (salvo superusuario-env, que tiene todos). */
function canActorGrant(actorPermsSet, isEnvAdmin, targetPermsSet) {
  if (isEnvAdmin) return true;
  for (const p of targetPermsSet) if (!actorPermsSet.has(p)) return false;
  return true;
}

/* Cuántos administradores efectivos quedarían si se elimina/suspende a
   `targetEmail`: superadmins de env (ADMIN_EMAILS) + usuarios iam ACTIVOS con
   users.manage, excluyendo al target. Guard "nunca quedar sin admin". Pura/testeable. */
function adminsRemainingAfter(users, envAdmins, targetEmail, customRolesMap) {
  const t = String(targetEmail || '').toLowerCase();
  const iamAdmins = (users || []).filter(u =>
    String(u.email || '').toLowerCase() !== t && u.status !== 'suspended' &&
    effectivePermsForRecord(u, customRolesMap || {}).has('users.manage')
  ).length;
  return (Array.isArray(envAdmins) ? envAdmins.length : 0) + iamAdmins;
}

function nowIso() { return new Date().toISOString(); }

/* ── HTTP ── */

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON inválido' }) }; }

  const action = String(body.action || '').trim();
  const USER_ACTIONS = ['list-users', 'upsert-user', 'delete-user', 'suspend-user'];
  const ROLE_ACTIONS = ['list-roles', 'upsert-role', 'delete-role'];
  if (![...USER_ACTIONS, ...ROLE_ACTIONS].includes(action)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'action inválida' }) };
  }

  /* Permiso requerido según el grupo de acción. */
  const required = USER_ACTIONS.includes(action) ? 'users.manage' : 'roles.manage';
  const auth = await authorize(event, required);
  if (!auth.ok) return { statusCode: auth.statusCode, headers, body: JSON.stringify({ error: auth.error }) };

  const actorPerms = new Set(auth.permissions || []);
  const isEnvAdmin = !!auth.isEnvAdmin;
  const actor = auth.email;

  try {
    /* ── Roles ── */
    if (action === 'list-roles') {
      const custom = await iam.listRoles();
      return ok(headers, { builtins: DEFAULT_ROLES, custom, catalog: ALL_PERMISSIONS });
    }
    if (action === 'upsert-role') {
      const id = String(body.id || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (!id) return bad(headers, 'id de rol requerido (a-z, 0-9, _-)');
      const permissions = sanitizePermissionList(body.permissions);
      /* No puedes crear/editar un rol con permisos que tú no tienes. */
      if (!canActorGrant(actorPerms, isEnvAdmin, new Set(permissions))) {
        return forbidden(headers, 'No puedes asignar a un rol permisos que tú no tienes');
      }
      const existing = await iam.getRole(id);
      /* Anti-escalada SIMÉTRICA: tampoco puedes QUITAR permisos que tú no tienes.
         Sin esto, un actor con solo roles.manage podría sobrescribir el rol
         integrado 'admin' con [] y dejar sin permisos a todos los admins del
         store (lockout), o degradar 'tesoreria' quitándole refunds.approve. Los
         permisos actuales del rol son los del registro custom o, si es integrado
         y aún no se ha editado, su default. */
      const currentPerms = (existing && Array.isArray(existing.permissions))
        ? existing.permissions
        : (DEFAULT_ROLES[id] || []);
      const removed = new Set(currentPerms.filter(p => !permissions.includes(p)));
      if (!canActorGrant(actorPerms, isEnvAdmin, removed)) {
        return forbidden(headers, 'No puedes quitar de un rol permisos que tú no tienes');
      }
      const record = Object.assign({ id, builtin: BUILTIN_ROLE_IDS.includes(id) }, existing || {}, {
        id, label: body.label || (existing && existing.label) || { es: id, en: id },
        permissions, updatedBy: actor, updatedAt: nowIso()
      });
      await iam.saveRole(record);
      return ok(headers, { role: record });
    }
    if (action === 'delete-role') {
      const id = String(body.id || '').trim();
      if (BUILTIN_ROLE_IDS.includes(id)) return bad(headers, 'No se puede borrar un rol integrado');
      await iam.deleteRole(id);
      return ok(headers, { deleted: id });
    }

    /* ── Usuarios ── */
    if (action === 'list-users') {
      const users = await iam.listUsers();
      const envAdmins = require('./_authz').adminEnvList();
      const envStaff = require('./_authz').staffEnvList();
      return ok(headers, { users, envAdmins, envStaff });
    }

    const targetEmail = iam.normEmail(body.email);
    if (!targetEmail) return bad(headers, 'email requerido');

    if (action === 'upsert-user') {
      const customRolesMap = await iam.getCustomRolesMap();
      const knownRoleIds = [...BUILTIN_ROLE_IDS, ...Object.keys(customRolesMap)];
      const roles = sanitizeRoleList(body.roles, knownRoleIds);
      const extraPermissions = sanitizePermissionList(body.extraPermissions);
      const deniedPermissions = sanitizePermissionList(body.deniedPermissions);

      const draft = { email: targetEmail, roles, extraPermissions, deniedPermissions };
      const targetPerms = effectivePermsForRecord(draft, customRolesMap);
      /* Anti-escalada: no puedes conceder lo que no tienes. */
      if (!canActorGrant(actorPerms, isEnvAdmin, targetPerms)) {
        return forbidden(headers, 'No puedes otorgar permisos que tú no tienes');
      }
      /* No quitarte a ti mismo el control. */
      if (targetEmail === actor && !targetPerms.has('users.manage') && !isEnvAdmin) {
        return forbidden(headers, 'No puedes quitarte a ti mismo el permiso de gestión de usuarios');
      }

      const existing = await iam.getUser(targetEmail);
      const record = Object.assign({
        email: targetEmail, status: 'active', createdAt: nowIso(), createdBy: actor, auditLog: []
      }, existing || {}, {
        name: body.name != null ? String(body.name).slice(0, 200) : (existing && existing.name) || '',
        roles, extraPermissions, deniedPermissions,
        /* Preserva el estado existente cuando el body NO trae status: editar el
           nombre/roles de un usuario suspendido NO debe reactivarlo. Solo un
           status explícito ('active'/'suspended') lo cambia. */
        status: body.status === 'suspended' ? 'suspended'
              : body.status === 'active' ? 'active'
              : (existing && existing.status) || 'active',
        updatedBy: actor
      });
      /* Guard "nunca sin admin" también por la vía upsert: suspender al último
         admin (o a uno mismo) con status:'suspended' dejaría el panel sin
         administrador. El invariante existía en suspend/delete pero no aquí. */
      if (record.status === 'suspended') {
        if (targetEmail === actor && !isEnvAdmin) {
          return forbidden(headers, 'No puedes suspenderte a ti mismo');
        }
        const envAdmins = require('./_authz').adminEnvList();
        const allUsers = await iam.listUsers();
        if (adminsRemainingAfter(allUsers, envAdmins, targetEmail, customRolesMap) < 1) {
          return forbidden(headers, 'La operación dejaría el sistema sin ningún administrador');
        }
      }
      record.auditLog = Array.isArray(record.auditLog) ? record.auditLog : [];
      record.auditLog.push({ ts: nowIso(), actor, action: existing ? 'update' : 'create', detail: `roles=[${roles.join(',')}]` });
      await iam.saveUser(record);
      return ok(headers, { user: record });
    }

    if (action === 'delete-user' || action === 'suspend-user') {
      if (targetEmail === actor) return forbidden(headers, 'No puedes eliminarte/suspenderte a ti mismo');
      /* Guard "nunca sin admin": cuenta admins efectivos restantes (env + iam). */
      const envAdmins = require('./_authz').adminEnvList();
      const users = await iam.listUsers();
      const customRolesMap = await iam.getCustomRolesMap();
      if (adminsRemainingAfter(users, envAdmins, targetEmail, customRolesMap) < 1) {
        return forbidden(headers, 'La operación dejaría el sistema sin ningún administrador');
      }

      if (action === 'delete-user') {
        await iam.deleteUser(targetEmail);
        return ok(headers, { deleted: targetEmail });
      }
      const existing = await iam.getUser(targetEmail);
      if (!existing) return notFound(headers, 'Usuario no encontrado');
      existing.status = 'suspended';
      existing.updatedBy = actor;
      existing.auditLog = Array.isArray(existing.auditLog) ? existing.auditLog : [];
      existing.auditLog.push({ ts: nowIso(), actor, action: 'suspend', detail: '' });
      await iam.saveUser(existing);
      return ok(headers, { user: existing });
    }

    return bad(headers, 'action no manejada');
  } catch (e) {
    console.error('[iam-admin]', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'No se pudo completar la operación' }) };
  }
};

function ok(headers, obj) { return { statusCode: 200, headers, body: JSON.stringify(Object.assign({ ok: true }, obj)) }; }
function bad(headers, error) { return { statusCode: 400, headers, body: JSON.stringify({ error }) }; }
function forbidden(headers, error) { return { statusCode: 403, headers, body: JSON.stringify({ error }) }; }
function notFound(headers, error) { return { statusCode: 404, headers, body: JSON.stringify({ error }) }; }

exports._test = { sanitizePermissionList, sanitizeRoleList, effectivePermsForRecord, canActorGrant, adminsRemainingAfter };
