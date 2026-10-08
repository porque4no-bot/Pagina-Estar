/* Frente staff — perfiles del personal (decisión del dueño):
 *   - administrador-recepcionista → rol 'admin' (todo)
 *   - recepcionista de reemplazo   → rol 'recepcion'
 *   - aseo                         → rol NUEVO 'aseo' (solo cleaning.audit)
 *   - tercero de desayunos         → rol 'cocina' (id histórico, NO se renombra
 *     para no romper usuarios guardados) con etiqueta "Desayunos (tercero)" y
 *     SOLO breakfast.status + breakfast.redeem.
 * Sin Firebase ni Blobs: el verificador y el store se inyectan. */

process.env.FIREBASE_PROJECT_ID = 'test-project';

const test = require('node:test');
const assert = require('node:assert/strict');

const perms = require('../../netlify/functions/_permissions');
const authz = require('../../netlify/functions/_authz');
const iamAdmin = require('../../netlify/functions/iam-admin')._test;

function ev() { return { headers: { authorization: 'Bearer tok' } }; }
function tokenFor(email) { return async () => ({ email, email_verified: true, sub: 'uid' }); }

test('cleaning.audit existe en el catálogo y no está reservado (ya tiene consumidor)', () => {
  assert.ok(perms.isValidPermission('cleaning.audit'));
  assert.equal(perms.isReservedPermission('cleaning.audit'), false);
  assert.ok(perms.PERMISSION_LABELS['cleaning.audit'].es);
  assert.ok(perms.PERMISSION_LABELS['cleaning.audit'].en);
});

test('rol aseo = solo cleaning.audit, con etiqueta ES/EN', () => {
  assert.deepEqual(perms.DEFAULT_ROLES.aseo, ['cleaning.audit']);
  assert.equal(perms.ROLE_LABELS.aseo.es, 'Aseo');
  assert.ok(perms.ROLE_LABELS.aseo.en);
  assert.ok(perms.BUILTIN_ROLE_IDS.includes('aseo'));
});

test('rol del tercero de desayunos (id cocina) = solo consultar y marcar servido', () => {
  assert.deepEqual([...perms.DEFAULT_ROLES.cocina].sort(), ['breakfast.redeem', 'breakfast.status']);
  assert.equal(perms.ROLE_LABELS.cocina.es, 'Desayunos (tercero)');
  assert.ok(perms.ROLE_LABELS.cocina.en);
  const p = perms.permissionsForRoles(['cocina'], {});
  for (const forbidden of ['breakfast.day', 'breakfast.upgrade', 'breakfast.analytics', 'breakfast.courtesy', 'cleaning.audit', 'quotes.view']) {
    assert.equal(p.has(forbidden), false, `el tercero NO debe tener ${forbidden}`);
  }
});

test('admin tiene todo (incluido cleaning.audit); recepción no audita aseo por defecto', () => {
  assert.ok(perms.DEFAULT_ROLES.admin.includes('cleaning.audit'));
  assert.equal(perms.DEFAULT_ROLES.admin.length, perms.ALL_PERMISSIONS.length);
  assert.equal(perms.DEFAULT_ROLES.recepcion.includes('cleaning.audit'), false);
});

test('todos los roles integrados tienen etiqueta ES y EN', () => {
  for (const id of perms.BUILTIN_ROLE_IDS) {
    assert.ok(perms.ROLE_LABELS[id] && perms.ROLE_LABELS[id].es && perms.ROLE_LABELS[id].en, `falta etiqueta de ${id}`);
  }
});

test('STAFF_EMAILS conserva acceso al panel de aseo (paridad con el viejo _staff-auth)', async () => {
  assert.ok(perms.STAFF_ENV_PERMISSIONS.includes('cleaning.audit'));
  process.env.ADMIN_EMAILS = 'owner@estar.com';
  process.env.STAFF_EMAILS = 'staff@estar.com';
  const eff = await authz.getEffectivePermissions('staff@estar.com', { getUser: async () => null });
  assert.ok(eff.permissions.has('cleaning.audit'));
});

test('un usuario del panel con rol aseo pasa authorize(cleaning.audit) y nada más', async () => {
  process.env.ADMIN_EMAILS = 'owner@estar.com';
  process.env.STAFF_EMAILS = '';
  const deps = {
    verifyToken: tokenFor('aseo@estar.com'),
    getUser: async () => ({ email: 'aseo@estar.com', roles: ['aseo'], status: 'active' }),
    getCustomRolesMap: async () => ({})
  };
  const ok = await authz.authorize(ev(), 'cleaning.audit', deps);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.permissions, ['cleaning.audit']);
  const deny = await authz.authorize(ev(), 'breakfast.redeem', deps);
  assert.equal(deny.ok, false);
  assert.equal(deny.statusCode, 403);
});

test('compatibilidad: un usuario guardado con roles:[cocina] sigue funcionando', async () => {
  process.env.ADMIN_EMAILS = 'owner@estar.com';
  process.env.STAFF_EMAILS = '';
  const deps = {
    verifyToken: tokenFor('tercero@proveedor.com'),
    getUser: async () => ({ email: 'tercero@proveedor.com', roles: ['cocina'], status: 'active' }),
    getCustomRolesMap: async () => ({})
  };
  assert.equal((await authz.authorize(ev(), 'breakfast.status', deps)).ok, true);
  assert.equal((await authz.authorize(ev(), 'breakfast.redeem', deps)).ok, true);
  assert.equal((await authz.authorize(ev(), 'breakfast.upgrade', deps)).statusCode, 403);
  assert.equal((await authz.authorize(ev(), 'breakfast.day', deps)).statusCode, 403);
});

test('iam-admin acepta el rol aseo al crear usuarios', () => {
  assert.deepEqual(iamAdmin.sanitizeRoleList(['aseo', 'inventado'], perms.BUILTIN_ROLE_IDS), ['aseo']);
  const eff = iamAdmin.effectivePermsForRecord({ roles: ['aseo'] }, {});
  assert.deepEqual([...eff], ['cleaning.audit']);
});
