/* Roles parte 2 — guardas de la gestión de usuarios/roles (anti-escalada,
 * saneo de permisos/roles, permisos efectivos de un registro). Helpers puros,
 * sin red ni Blobs. */

const test = require('node:test');
const assert = require('node:assert/strict');

const { _test: g } = require('../../netlify/functions/iam-admin');

test('sanitizePermissionList keeps only catalog permissions, dedupes', () => {
  const out = g.sanitizePermissionList(['refunds.approve', 'refunds.approve', 'fake.perm', '', 'users.manage']);
  assert.deepEqual(out.sort(), ['refunds.approve', 'users.manage']);
});

test('sanitizeRoleList keeps only known roles', () => {
  assert.deepEqual(g.sanitizeRoleList(['recepcion', 'hacker', 'cocina'], ['admin', 'recepcion', 'cocina', 'tesoreria']), ['recepcion', 'cocina']);
});

test('effectivePermsForRecord = roles ∪ extra − denied', () => {
  const perms = g.effectivePermsForRecord(
    { roles: ['recepcion'], extraPermissions: ['refunds.approve'], deniedPermissions: ['guests.register'] },
    {}
  );
  assert.ok(perms.has('refunds.approve'));   // extra
  assert.ok(perms.has('quotes.view'));        // de recepción
  assert.equal(perms.has('guests.register'), false); // denegado
});

test('canActorGrant blocks granting a permission the actor lacks', () => {
  const actor = new Set(['users.manage', 'quotes.view']);
  assert.equal(g.canActorGrant(actor, false, new Set(['quotes.view'])), true);
  assert.equal(g.canActorGrant(actor, false, new Set(['refunds.approve'])), false);
});

test('canActorGrant: an env superadmin can grant anything', () => {
  assert.equal(g.canActorGrant(new Set(), true, new Set(['users.manage', 'refunds.approve'])), true);
});

test('granting the admin role requires the actor to already have every permission', () => {
  const { DEFAULT_ROLES } = require('../../netlify/functions/_permissions');
  const adminPerms = new Set(DEFAULT_ROLES.admin);
  const targetIfAdmin = g.effectivePermsForRecord({ roles: ['admin'] }, {});
  // A non-env actor with only some permissions cannot mint an admin.
  assert.equal(g.canActorGrant(new Set(['users.manage']), false, targetIfAdmin), false);
  // A full admin (has all perms) can.
  assert.equal(g.canActorGrant(adminPerms, false, targetIfAdmin), true);
});

/* Guard "nunca quedar sin admin" (hallazgo de la validación: faltaban tests). */
test('adminsRemainingAfter: queda 0 si el único admin iam es el target y no hay env admins', () => {
  const users = [{ email: 'a@x.com', roles: ['admin'], status: 'active' }];
  assert.equal(g.adminsRemainingAfter(users, [], 'a@x.com', {}), 0);
});

test('adminsRemainingAfter: un env admin cuenta aunque se quite el único admin iam', () => {
  const users = [{ email: 'a@x.com', roles: ['admin'], status: 'active' }];
  assert.equal(g.adminsRemainingAfter(users, ['owner@estar.com'], 'a@x.com', {}), 1);
});

test('adminsRemainingAfter: suspendidos y no-admins no cuentan', () => {
  const users = [
    { email: 'a@x.com', roles: ['admin'], status: 'suspended' }, // no cuenta (suspendido)
    { email: 'b@x.com', roles: ['recepcion'], status: 'active' }, // no cuenta (sin users.manage)
    { email: 'c@x.com', roles: ['admin'], status: 'active' }
  ];
  assert.equal(g.adminsRemainingAfter(users, [], 'c@x.com', {}), 0); // quitando c no queda ninguno
  assert.equal(g.adminsRemainingAfter(users, [], 'b@x.com', {}), 1); // c sigue siendo admin
});
