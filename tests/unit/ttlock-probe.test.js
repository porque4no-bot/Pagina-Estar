/* TTLock — probe de SOLO LECTURA (botón "Probar conexión TTLock" en /admin →
 * Configuración) y las consultas de lectura nuevas de _ttlock (listLocks,
 * describeLocksMap). Sin red real: `fetch` global se reemplaza por un falso que
 * responde /oauth2/token y /v3/lock/list y registra cada llamada.
 *
 * Garantías verificadas:
 *   - pide settings.manage;
 *   - sin credenciales: 200 ok:false, sin tocar la red (mock-safe);
 *   - funciona con TTLOCK_ENABLED apagado (verificar ANTES de encender);
 *   - solo lee: nunca llama keyboardPwd/* ni otro endpoint de escritura;
 *   - nunca devuelve secretos (client secret, contraseña/MD5, access token,
 *     lockData de Bluetooth);
 *   - cruza el mapeo apartamento→chapa con las chapas de la cuenta. */

const test = require('node:test');
const assert = require('node:assert/strict');

/* Blobs vacío (sin overrides del panel). */
const blobsPath = require.resolve('@netlify/blobs');
require.cache[blobsPath] = {
  id: blobsPath, filename: blobsPath, loaded: true,
  exports: { getStore: () => ({ async get() { return null; }, async set() { return { modified: true }; } }) }
};

const authzPath = require.resolve('../../netlify/functions/_authz');
let authzState = { allow: true, calls: [] };
require.cache[authzPath] = {
  id: authzPath, filename: authzPath, loaded: true,
  exports: {
    async authorize(event, permission) {
      authzState.calls.push(permission);
      if (!authzState.allow) return { ok: false, statusCode: 403, error: 'No tienes permiso para esta acción' };
      return { ok: true, email: 'owner@estar.com', permissions: [permission], roles: ['admin'] };
    }
  }
};

const ttlock = require('../../netlify/functions/_ttlock');
const probeMod = require('../../netlify/functions/ttlock-probe');
const { suggestKey, crossCheck } = probeMod._test;

const ENV = ['TTLOCK_ENABLED', 'TTLOCK_CLIENT_ID', 'TTLOCK_CLIENT_SECRET', 'TTLOCK_USERNAME',
  'TTLOCK_PASSWORD_MD5', 'TTLOCK_PASSWORD', 'TTLOCK_LOCKS_JSON', 'TTLOCK_API_BASE'];
function clearEnv() { for (const k of ENV) delete process.env[k]; }
function setCreds() {
  process.env.TTLOCK_CLIENT_ID = 'cid-123';
  process.env.TTLOCK_CLIENT_SECRET = 'super-secret-xyz';
  process.env.TTLOCK_USERNAME = 'estar@hotel.co';
  process.env.TTLOCK_PASSWORD_MD5 = 'aaaaaaaaaaaaaaaabbbbbbbbbbbbbbbb';
}

/* Página de lock/list según TTLock Open API. lockData/lockMac deben NO salir. */
function lockRow(id, alias, battery, gw) {
  return { lockId: id, lockName: 'S31_' + id, lockAlias: alias, electricQuantity: battery, hasGateway: gw ? 1 : 0, lockData: 'BLE-SECRET-' + id, lockMac: 'AA:BB:' + id };
}

const realFetch = globalThis.fetch;
let fetchCalls;
function installFetch(pages, { tokenError } = {}) {
  fetchCalls = [];
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    fetchCalls.push({ path: u.pathname, method: (init && init.method) || 'GET', query: Object.fromEntries(u.searchParams) });
    let json;
    if (u.pathname === '/oauth2/token') {
      json = tokenError ? { errcode: 10003, errmsg: 'invalid client' } : { access_token: 'ACCESS-TOKEN-SECRET', expires_in: 7776000, uid: 9 };
    } else if (u.pathname === '/v3/lock/list') {
      const pageNo = Number(u.searchParams.get('pageNo')) || 1;
      json = pages[pageNo - 1] || { list: [], pages: pages.length };
    } else {
      json = { errcode: 1, errmsg: 'endpoint inesperado en un probe de solo lectura' };
    }
    return { ok: true, status: 200, json: async () => json };
  };
}

function get() { return probeMod.handler({ httpMethod: 'GET', headers: { authorization: 'Bearer t' } }); }

test.beforeEach(() => {
  clearEnv();
  ttlock._resetTokenCache();
  authzState = { allow: true, calls: [] };
});
test.after(() => { globalThis.fetch = realFetch; clearEnv(); });

test('pide settings.manage; sin permiso → 403', async () => {
  authzState.allow = false;
  const res = await get();
  assert.deepEqual(authzState.calls, ['settings.manage']);
  assert.equal(res.statusCode, 403);
});

test('sin credenciales: 200 ok:false con la nota de qué falta y SIN tocar la red', async () => {
  installFetch([]);
  process.env.TTLOCK_LOCKS_JSON = '{"101":111}';
  const res = await get();
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, false);
  assert.match(body.note, /Faltan credenciales/);
  assert.equal(body.config.clientId, false);
  assert.equal(body.mapping.defined, true);
  assert.deepEqual(body.mapping.entries, [{ key: '101', lockId: 111, name: '101' }]);
  assert.equal(fetchCalls.length, 0);
});

test('con credenciales y TTLOCK_ENABLED APAGADO: lista las chapas (solo lectura) y cruza el mapa', async () => {
  setCreds();
  process.env.TTLOCK_LOCKS_JSON = '{"101":1001,"999":5555}';
  installFetch([{ list: [lockRow(1001, 'Apto 101', 87, true), lockRow(1002, 'Apto 102', 15, false), lockRow(2000, 'Puerta principal', 64, true), lockRow(3000, 'Bodega', 90, true)], pages: 1 }]);
  const res = await get();
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.config.enabled, false);
  assert.deepEqual(body.locks.map(l => l.lockId), [1001, 1002, 2000, 3000]);
  assert.deepEqual(body.locks[0], { lockId: 1001, name: 'S31_1001', alias: 'Apto 101', battery: 87, hasGateway: true });
  assert.equal(body.locks[1].hasGateway, false);

  /* Mapa: 101 existe, 999 apunta a una chapa que no está en la cuenta. */
  const byKey = Object.fromEntries(body.check.entries.map(e => [e.key, e.foundInAccount]));
  assert.deepEqual(byKey, { 101: true, 999: false });
  assert.deepEqual(body.check.unmapped, [1002, 2000, 3000]);
  /* Sugerido: lo ya mapeado que existe + alias reconocibles; "Bodega" queda pendiente. */
  assert.deepEqual(body.check.suggested, { 101: 1001, 102: 1002, main: 2000 });
  assert.deepEqual(body.check.pendingWithoutKey, [3000]);

  /* Solo lectura: token + lock/list por GET; nada de keyboardPwd. */
  assert.deepEqual(fetchCalls.map(c => c.path), ['/oauth2/token', '/v3/lock/list']);
  assert.equal(fetchCalls[1].method, 'GET');
  assert.equal(fetchCalls.some(c => /keyboardPwd|unlock|delete/i.test(c.path)), false);

  /* Nunca secretos ni lockData en la respuesta. */
  for (const secret of ['super-secret-xyz', 'aaaaaaaaaaaaaaaabbbbbbbbbbbbbbbb', 'ACCESS-TOKEN-SECRET', 'BLE-SECRET', 'AA:BB:']) {
    assert.equal(res.body.includes(secret), false, `la respuesta no debe incluir ${secret}`);
  }
});

test('pagina lock/list hasta completar todas las páginas', async () => {
  setCreds();
  const page1 = { list: Array.from({ length: 100 }, (_, i) => lockRow(5000 + i, 'Apto ' + (100 + i), 50, true)), pages: 2 };
  const page2 = { list: [lockRow(9001, 'Principal', 70, true)], pages: 2 };
  installFetch([page1, page2]);
  const locks = await ttlock.listLocks();
  assert.equal(locks.length, 101);
  assert.deepEqual(fetchCalls.filter(c => c.path === '/v3/lock/list').map(c => c.query.pageNo), ['1', '2']);
});

test('error de la plataforma (credenciales malas) → 502 con el motivo, sin secretos', async () => {
  setCreds();
  installFetch([], { tokenError: true });
  const res = await get();
  assert.equal(res.statusCode, 502);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, false);
  assert.match(body.error, /10003/);
  assert.equal(res.body.includes('super-secret-xyz'), false);
});

test('emitir códigos sigue exigiendo TTLOCK_ENABLED aunque el probe ya haya sacado token', async () => {
  setCreds();
  process.env.TTLOCK_LOCKS_JSON = '{"101":1001}';
  installFetch([{ list: [lockRow(1001, 'Apto 101', 80, true)], pages: 1 }]);
  await ttlock.listLocks();
  const r = await ttlock.issueAccessCodes({ apartment: '101', startMs: 1750000000000, endMs: 1750300000000 });
  assert.equal(r.isMock, true);
  assert.equal(fetchCalls.some(c => /keyboardPwd/.test(c.path)), false);
});

test('describeLocksMap: sin definir / JSON inválido / no-objeto / válido', () => {
  delete process.env.TTLOCK_LOCKS_JSON;
  assert.deepEqual(ttlock.describeLocksMap(), { defined: false, valid: true, entries: [] });
  process.env.TTLOCK_LOCKS_JSON = '{101:1}';
  const bad = ttlock.describeLocksMap();
  assert.equal(bad.defined, true);
  assert.equal(bad.valid, false);
  assert.match(bad.error, /JSON inválido/);
  process.env.TTLOCK_LOCKS_JSON = '[1,2]';
  assert.equal(ttlock.describeLocksMap().valid, false);
  process.env.TTLOCK_LOCKS_JSON = '{"101":1001,"main":{"lockId":2000,"name":"Entrada"}}';
  assert.deepEqual(ttlock.describeLocksMap().entries, [
    { key: '101', lockId: 1001, name: '101' },
    { key: 'main', lockId: 2000, name: 'Entrada' }
  ]);
});

test('suggestKey reconoce número de apto y la puerta principal', () => {
  assert.equal(suggestKey('Apto 101'), '101');
  assert.equal(suggestKey('Estar-305'), '305');
  assert.equal(suggestKey('Puerta principal'), 'main');
  assert.equal(suggestKey('MAIN door'), 'main');
  assert.equal(suggestKey('Bodega'), null);
});

test('crossCheck no pisa una clave ya mapeada con una sugerencia', () => {
  const locks = [{ lockId: 1, alias: 'Apto 101' }, { lockId: 2, alias: 'Apto 101 (vieja)' }];
  const out = crossCheck(locks, { entries: [{ key: '101', lockId: 1 }] });
  assert.deepEqual(out.suggested, { 101: 1 });
  assert.deepEqual(out.pendingWithoutKey, [2]);
});
