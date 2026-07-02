/* Roles/usuarios — capa de autorización aditiva. Las env vars (ADMIN_EMAILS/
 * STAFF_EMAILS) son superusuarios de respaldo; encima, el store iam da permisos
 * por rol. El verificador de token y el store se inyectan (sin Firebase ni
 * Blobs). FIREBASE_PROJECT_ID se fija para desactivar el modo demo local. */

process.env.FIREBASE_PROJECT_ID = 'test-project';

const test = require('node:test');
const assert = require('node:assert/strict');

const authz = require('../../netlify/functions/_authz');
const { ALL_PERMISSIONS } = require('../../netlify/functions/_permissions');

function ev(token = 'tok') { return { headers: { authorization: `Bearer ${token}` } }; }
function tokenFor(email, verified = true) { return async () => ({ email, email_verified: verified, sub: 'uid' }); }

test('ADMIN_EMAILS grants every permission and cannot be denied', async () => {
  process.env.ADMIN_EMAILS = 'owner@estar.com';
  process.env.STAFF_EMAILS = '';
  const eff = await authz.getEffectivePermissions('owner@estar.com', {});
  assert.equal(eff.isEnvAdmin, true);
  assert.equal(eff.permissions.size, ALL_PERMISSIONS.length);
  assert.ok(eff.permissions.has('users.manage'));
  assert.ok(eff.permissions.has('refunds.approve'));
});

test('STAFF_EMAILS grants only the breakfast (kitchen) permissions', async () => {
  process.env.ADMIN_EMAILS = 'owner@estar.com';
  process.env.STAFF_EMAILS = 'cocina@estar.com';
  const eff = await authz.getEffectivePermissions('cocina@estar.com', { getUser: async () => null });
  assert.equal(eff.isEnvAdmin, false);
  assert.ok(eff.permissions.has('breakfast.redeem'));
  assert.ok(eff.permissions.has('breakfast.day'));
  assert.equal(eff.permissions.has('refunds.approve'), false);
  assert.equal(eff.permissions.has('users.manage'), false);
});

test('an iam user gets the permissions of its role (recepción)', async () => {
  process.env.ADMIN_EMAILS = 'owner@estar.com';
  process.env.STAFF_EMAILS = '';
  const user = { email: 'front@estar.com', roles: ['recepcion'], status: 'active' };
  const eff = await authz.getEffectivePermissions('front@estar.com', {
    getUser: async () => user, getCustomRolesMap: async () => ({})
  });
  assert.ok(eff.permissions.has('guests.register'));
  assert.ok(eff.permissions.has('refunds.view'));
  assert.equal(eff.permissions.has('refunds.approve'), false); // recepción no aprueba
  assert.deepEqual(eff.roles, ['recepcion']);
});

test('deniedPermissions removes an iam permission but NEVER an env one', async () => {
  process.env.ADMIN_EMAILS = 'owner@estar.com';
  process.env.STAFF_EMAILS = 'mix@estar.com'; // env staff → breakfast.redeem
  const user = {
    email: 'mix@estar.com', roles: ['tesoreria'], status: 'active',
    deniedPermissions: ['refunds.approve', 'breakfast.redeem']
  };
  const eff = await authz.getEffectivePermissions('mix@estar.com', {
    getUser: async () => user, getCustomRolesMap: async () => ({})
  });
  // iam permission denied → removed
  assert.equal(eff.permissions.has('refunds.approve'), false);
  // but breakfast.redeem comes from STAFF_EMAILS → env wins, denied ignored
  assert.ok(eff.permissions.has('breakfast.redeem'));
});

test('a suspended iam user loses iam permissions (env still applies)', async () => {
  process.env.ADMIN_EMAILS = 'owner@estar.com';
  process.env.STAFF_EMAILS = 'sus@estar.com';
  const user = { email: 'sus@estar.com', roles: ['admin'], status: 'suspended' };
  const eff = await authz.getEffectivePermissions('sus@estar.com', {
    getUser: async () => user, getCustomRolesMap: async () => ({})
  });
  assert.equal(eff.status, 'suspended');
  assert.equal(eff.permissions.has('users.manage'), false); // role admin revoked
  assert.ok(eff.permissions.has('breakfast.redeem')); // env staff survives
});

test('authorize: 403 without the permission, ok with it', async () => {
  process.env.ADMIN_EMAILS = 'owner@estar.com';
  process.env.STAFF_EMAILS = '';
  const okRes = await authz.authorize(ev(), 'refunds.approve', { verifyToken: tokenFor('owner@estar.com') });
  assert.equal(okRes.ok, true);
  assert.equal(okRes.isEnvAdmin, true);

  const denyRes = await authz.authorize(ev(), 'refunds.approve', {
    verifyToken: tokenFor('front@estar.com'),
    getUser: async () => ({ email: 'front@estar.com', roles: ['recepcion'], status: 'active' }),
    getCustomRolesMap: async () => ({})
  });
  assert.equal(denyRes.ok, false);
  assert.equal(denyRes.statusCode, 403);
});

test('authorize: 401 without token, 403 with unverified email', async () => {
  process.env.ADMIN_EMAILS = 'owner@estar.com';
  const noToken = await authz.authorize({ headers: {} }, 'quotes.view', {});
  assert.equal(noToken.statusCode, 401);

  const unverified = await authz.authorize(ev(), 'quotes.view', { verifyToken: tokenFor('x@estar.com', false) });
  assert.equal(unverified.statusCode, 403);
});
