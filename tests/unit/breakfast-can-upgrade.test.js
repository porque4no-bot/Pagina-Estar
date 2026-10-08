/* Panel del comedor (desayuno.html): "Agregar desayuno" solo se ofrece si el
 * usuario PUEDE usarlo ahora. breakfast-status devuelve `canUpgrade` con la
 * misma regla que breakfast-upgrade: permiso breakfast.upgrade y, con
 * credenciales reales de OTASync, el flag BREAKFAST_UPGRADE_ENABLED encendido.
 * El tercero de desayunos (solo status+redeem) nunca lo ve. */

const test = require('node:test');
const assert = require('node:assert/strict');

/* Blobs en memoria (redenciones del día) — mismo patrón que breakfast-upgrade. */
const blobsPath = require.resolve('@netlify/blobs');
const mem = new Map();
const memStore = {
  async set(key, val, opts) {
    if (opts && opts.onlyIfNew && mem.has(key)) return { modified: false };
    mem.set(key, val);
    return { modified: true };
  },
  async get(key) { return mem.has(key) ? mem.get(key) : null; },
  async list(opts) {
    const prefix = (opts && opts.prefix) || '';
    return { blobs: [...mem.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) };
  }
};
require.cache[blobsPath] = { id: blobsPath, filename: blobsPath, loaded: true, exports: { getStore: () => memStore } };

/* _authz stub: permisos configurables por test. */
const authzPath = require.resolve('../../netlify/functions/_authz');
let currentPerms = [];
require.cache[authzPath] = {
  id: authzPath, filename: authzPath, loaded: true,
  exports: {
    async authorize(event, permission) {
      if (!currentPerms.includes(permission)) return { ok: false, statusCode: 403, error: 'No tienes permiso para esta acción' };
      return { ok: true, email: 'x@estar.com', permissions: currentPerms.slice(), roles: [] };
    }
  }
};

for (const k of ['OTASYNC_TOKEN', 'OTASYNC_USERNAME', 'OTASYNC_PASSWORD', 'BREAKFAST_UPGRADE_ENABLED']) delete process.env[k];

const statusMod = require('../../netlify/functions/breakfast-status');
const { canUpgradeNow } = statusMod._test;

const auth = permissions => ({ ok: true, permissions });

test('sin permiso breakfast.upgrade → nunca (aunque el flag esté encendido)', async () => {
  assert.equal(await canUpgradeNow(auth(['breakfast.status', 'breakfast.redeem']), {
    hasOtasyncCreds: () => true, flag: async () => true
  }), false);
});

test('con permiso + credenciales reales + flag apagado → no', async () => {
  assert.equal(await canUpgradeNow(auth(['breakfast.upgrade']), {
    hasOtasyncCreds: () => true, flag: async () => false
  }), false);
});

test('con permiso + credenciales reales + flag encendido → sí', async () => {
  assert.equal(await canUpgradeNow(auth(['breakfast.upgrade']), {
    hasOtasyncCreds: () => true, flag: async () => true
  }), true);
});

test('con permiso y sin credenciales (demo local) → sí (el upgrade no toca folio)', async () => {
  assert.equal(await canUpgradeNow(auth(['breakfast.upgrade']), {
    hasOtasyncCreds: () => false, flag: async () => false
  }), true);
});

test('si leer el flag falla → no (fail-closed: no ofrecer un cobro)', async () => {
  assert.equal(await canUpgradeNow(auth(['breakfast.upgrade']), {
    hasOtasyncCreds: () => true, flag: async () => { throw new Error('blobs'); }
  }), false);
});

function call(code) {
  return statusMod.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify({ code }) });
}

test('handler: el tercero (status+redeem) ve canUpgrade:false en una reserva sin desayuno', async () => {
  currentPerms = ['breakfast.status', 'breakfast.redeem'];
  const res = await call('EST-AIRBNB-3');
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.status.hasBreakfast, false);
  assert.equal(body.canUpgrade, false);
});

test('handler: con breakfast.upgrade (demo sin credenciales) → canUpgrade:true', async () => {
  currentPerms = ['breakfast.status', 'breakfast.upgrade'];
  const res = await call('EST-AIRBNB-3');
  const body = JSON.parse(res.body);
  assert.equal(body.canUpgrade, true);
});

test('handler: una reserva que YA incluye desayuno nunca ofrece upgrade', async () => {
  currentPerms = ['breakfast.status', 'breakfast.upgrade'];
  const res = await call('EST-DEMO-2026');
  const body = JSON.parse(res.body);
  assert.equal(body.status.hasBreakfast, true);
  assert.equal(body.canUpgrade, false);
});
