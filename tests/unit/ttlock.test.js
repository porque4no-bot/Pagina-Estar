/* Cliente TTLock (chapas con teclado): modo mock sin credenciales/flag,
   parseo del mapeo de chapas, OAuth con token cacheado, y la emisión de
   códigos temporales contra un transporte HTTP simulado (fetch inyectado).
   Sin red ni Blobs reales. */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const TTLOCK = path.join(__dirname, '../../netlify/functions/_ttlock.js');

const ENV = [
  'TTLOCK_ENABLED', 'TTLOCK_CLIENT_ID', 'TTLOCK_CLIENT_SECRET',
  'TTLOCK_USERNAME', 'TTLOCK_PASSWORD_MD5', 'TTLOCK_PASSWORD',
  'TTLOCK_LOCKS_JSON', 'TTLOCK_API_BASE', 'TTLOCK_TIMEOUT_MS', 'TTLOCK_PASSCODE_TYPE'
];
function clearEnv() { for (const k of ENV) delete process.env[k]; }
function setEnv() {
  process.env.TTLOCK_ENABLED = 'true';
  process.env.TTLOCK_CLIENT_ID = 'cid';
  process.env.TTLOCK_CLIENT_SECRET = 'csecret';
  process.env.TTLOCK_USERNAME = 'estar@hotel.co';
  // 32 hex minúsculas = MD5 ya calculado.
  process.env.TTLOCK_PASSWORD_MD5 = '0123456789abcdef0123456789abcdef';
  process.env.TTLOCK_LOCKS_JSON = '{"101":1001,"102":1002,"main":9999}';
}

/* Transporte HTTP simulado. `handlers` mapea el path (p.ej. '/oauth2/token')
   a un objeto JSON de respuesta (o una función que recibe los params
   x-www-form-urlencoded ya parseados y devuelve el JSON). */
function fakeTransport(handlers) {
  const calls = [];
  return {
    calls,
    transport: async (url, init) => {
      const u = new URL(url);
      const pathName = u.pathname;
      const params = Object.fromEntries(new URLSearchParams(init.body));
      calls.push({ path: pathName, params });
      const h = handlers[pathName];
      const json = typeof h === 'function' ? h(params) : h;
      return { ok: true, status: 200, json: async () => (json || {}) };
    }
  };
}

const STAY = { startMs: 1750000000000, endMs: 1750300000000 };

test('md5Hex produce 32 hex en minúsculas', () => {
  const tt = require(TTLOCK);
  const h = tt.md5Hex('secreta');
  assert.match(h, /^[0-9a-f]{32}$/);
});

test('resolvePasswordMd5 usa el MD5 si ya viene calculado', () => {
  clearEnv();
  process.env.TTLOCK_PASSWORD_MD5 = 'ABCDEF0123456789ABCDEF0123456789';
  const tt = require(TTLOCK);
  // se normaliza a minúsculas
  assert.equal(tt.resolvePasswordMd5(), 'abcdef0123456789abcdef0123456789');
  clearEnv();
});

test('resolvePasswordMd5 hashea la contraseña en claro si no hay MD5', () => {
  clearEnv();
  process.env.TTLOCK_PASSWORD = 'mi-clave';
  const tt = require(TTLOCK);
  assert.equal(tt.resolvePasswordMd5(), tt.md5Hex('mi-clave'));
  clearEnv();
});

test('isConfigured es false sin flag aunque haya credenciales', () => {
  clearEnv();
  const tt = require(TTLOCK);
  setEnv();
  process.env.TTLOCK_ENABLED = 'false'; // flag apagado
  assert.equal(tt.isConfigured(), false);
  process.env.TTLOCK_ENABLED = 'true';
  assert.equal(tt.isConfigured(), true);
  clearEnv();
});

test('isConfigured es false si faltan credenciales aunque el flag esté ON', () => {
  clearEnv();
  const tt = require(TTLOCK);
  process.env.TTLOCK_ENABLED = 'true';
  assert.equal(tt.isConfigured(), false);
  clearEnv();
});

test('parseLocksMap normaliza valores numéricos y objetos { lockId, name }', () => {
  clearEnv();
  process.env.TTLOCK_LOCKS_JSON = '{"101":1001,"main":{"lockId":9999,"name":"Puerta principal"}}';
  const tt = require(TTLOCK);
  const map = tt.parseLocksMap();
  assert.deepEqual(map.get('101'), { lockId: 1001, name: '101' });
  assert.deepEqual(map.get('main'), { lockId: 9999, name: 'Puerta principal' });
  clearEnv();
});

test('parseLocksMap devuelve mapa vacío con JSON inválido (no tumba)', () => {
  clearEnv();
  process.env.TTLOCK_LOCKS_JSON = 'no-es-json';
  const tt = require(TTLOCK);
  assert.equal(tt.parseLocksMap().size, 0);
  clearEnv();
});

test('resolveLocks resuelve apto + main por defecto, deduplicando', () => {
  clearEnv();
  process.env.TTLOCK_LOCKS_JSON = '{"101":1001,"main":9999}';
  const tt = require(TTLOCK);
  const locks = tt.resolveLocks({ apartment: '101' });
  assert.deepEqual(locks.map(l => l.lockId), [1001, 9999]);
  clearEnv();
});

test('resolveLocks respeta lockIds explícitos e ignora el mapeo', () => {
  clearEnv();
  process.env.TTLOCK_LOCKS_JSON = '{"101":1001,"main":9999}';
  const tt = require(TTLOCK);
  const locks = tt.resolveLocks({ lockIds: [55, 56] });
  assert.deepEqual(locks.map(l => l.lockId), [55, 56]);
  clearEnv();
});

test('resolveLocks puede excluir la puerta principal con includeMain:false', () => {
  clearEnv();
  process.env.TTLOCK_LOCKS_JSON = '{"101":1001,"main":9999}';
  const tt = require(TTLOCK);
  const locks = tt.resolveLocks({ apartment: '101', includeMain: false });
  assert.deepEqual(locks.map(l => l.lockId), [1001]);
  clearEnv();
});

test('toMs acepta ms, segundos, Date e ISO', () => {
  const tt = require(TTLOCK);
  assert.equal(tt.toMs(1750000000000), 1750000000000);     // ya en ms
  assert.equal(tt.toMs(1750000000), 1750000000000);          // segundos → ms
  assert.equal(tt.toMs(new Date(1750000000000)), 1750000000000);
  assert.equal(tt.toMs('2025-06-15T00:00:00Z'), Date.parse('2025-06-15T00:00:00Z'));
  assert.ok(Number.isNaN(tt.toMs('no-fecha')));
});

test('issueAccessCodes sin credenciales/flag es un no-op mock', async () => {
  clearEnv();
  const tt = require(TTLOCK);
  const r = await tt.issueAccessCodes({ apartment: '101', ...STAY });
  assert.deepEqual(r, { isMock: true, codes: [], errors: [] });
});

test('issueAccessCodes con flag OFF no llama a la red', async () => {
  clearEnv();
  setEnv();
  process.env.TTLOCK_ENABLED = 'false';
  const tt = require(TTLOCK);
  let called = false;
  const transport = async () => { called = true; return { ok: true, json: async () => ({}) }; };
  const r = await tt.issueAccessCodes({ apartment: '101', ...STAY }, { transport });
  assert.equal(r.isMock, true);
  assert.equal(called, false);
  clearEnv();
});

test('getAccessToken obtiene y cachea el access_token', async () => {
  clearEnv();
  setEnv();
  const tt = require(TTLOCK);
  tt._resetTokenCache();
  const { transport, calls } = fakeTransport({
    '/oauth2/token': (params) => {
      // manda las credenciales correctas en form-urlencoded
      assert.equal(params.client_id, 'cid');
      assert.equal(params.username, 'estar@hotel.co');
      assert.equal(params.password, '0123456789abcdef0123456789abcdef');
      return { access_token: 'TOK', refresh_token: 'RTK', uid: 7, expires_in: 7776000 };
    }
  });
  const tok = await tt.getAccessToken({ transport });
  assert.equal(tok.accessToken, 'TOK');
  assert.equal(tok.uid, 7);
  // segunda llamada usa la caché (no vuelve a pegarle a /oauth2/token)
  await tt.getAccessToken({ transport });
  assert.equal(calls.filter(c => c.path === '/oauth2/token').length, 1);
  clearEnv();
});

test('getAccessToken lanza si la plataforma no devuelve access_token', async () => {
  clearEnv();
  setEnv();
  const tt = require(TTLOCK);
  tt._resetTokenCache();
  const { transport } = fakeTransport({ '/oauth2/token': { errcode: 10003, errmsg: 'invalid client' } });
  await assert.rejects(() => tt.getAccessToken({ transport }), /TTLock errcode 10003/);
  clearEnv();
});

test('issueAccessCodes programa código en apto + main y devuelve los códigos', async () => {
  clearEnv();
  setEnv();
  const tt = require(TTLOCK);
  tt._resetTokenCache();
  const { transport, calls } = fakeTransport({
    '/oauth2/token': { access_token: 'TOK', expires_in: 7776000 },
    '/v3/keyboardPwd/get': (params) => {
      // valida que mandamos token, versión, tipo período y rango de la estadía
      assert.equal(params.accessToken, 'TOK');
      assert.equal(params.keyboardPwdVersion, '4');
      assert.equal(params.keyboardPwdType, '3');
      assert.equal(params.startDate, String(STAY.startMs));
      assert.equal(params.endDate, String(STAY.endMs));
      const code = params.lockId === '1001' ? '551122' : '883344';
      return { keyboardPwd: code, keyboardPwdId: Number(params.lockId) };
    }
  });
  const r = await tt.issueAccessCodes({ apartment: '101', ...STAY }, { transport });
  assert.equal(r.isMock, false);
  assert.equal(r.errors.length, 0);
  assert.equal(r.codes.length, 2);
  const byLock = Object.fromEntries(r.codes.map(c => [c.lockId, c.keyboardPwd]));
  assert.equal(byLock[1001], '551122');  // apto 101
  assert.equal(byLock[9999], '883344');  // puerta principal
  // se autenticó una sola vez y emitió 2 códigos
  assert.equal(calls.filter(c => c.path === '/oauth2/token').length, 1);
  assert.equal(calls.filter(c => c.path === '/v3/keyboardPwd/get').length, 2);
  clearEnv();
});

test('issueAccessCodes acepta una reserva (apartment + checkIn/checkOut)', async () => {
  clearEnv();
  setEnv();
  const tt = require(TTLOCK);
  tt._resetTokenCache();
  const { transport } = fakeTransport({
    '/oauth2/token': { access_token: 'TOK', expires_in: 7776000 },
    '/v3/keyboardPwd/get': (params) => {
      assert.equal(params.keyboardPwdName, 'Reserva EST-9');
      return { keyboardPwd: '445566', keyboardPwdId: 1 };
    }
  });
  const r = await tt.issueAccessCodes({
    reservation: { apartment: '102', code: 'EST-9', checkInMs: STAY.startMs, checkOutMs: STAY.endMs }
  }, { transport });
  assert.equal(r.codes.length, 2); // 102 + main
  clearEnv();
});

test('issueAccessCodes: el fallo de una chapa no tumba el resto (no fatal)', async () => {
  clearEnv();
  setEnv();
  const tt = require(TTLOCK);
  tt._resetTokenCache();
  const { transport } = fakeTransport({
    '/oauth2/token': { access_token: 'TOK', expires_in: 7776000 },
    '/v3/keyboardPwd/get': (params) => {
      if (params.lockId === '9999') return { errcode: 80003, errmsg: 'lock offline' };
      return { keyboardPwd: '111222', keyboardPwdId: 1 };
    }
  });
  const r = await tt.issueAccessCodes({ apartment: '101', ...STAY }, { transport });
  assert.equal(r.codes.length, 1);
  assert.equal(r.codes[0].lockId, 1001);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].lockId, 9999);
  assert.match(r.errors[0].error, /80003/);
  clearEnv();
});

test('issueAccessCodes exige startMs < endMs', async () => {
  clearEnv();
  setEnv();
  const tt = require(TTLOCK);
  tt._resetTokenCache();
  const { transport } = fakeTransport({ '/oauth2/token': { access_token: 'TOK', expires_in: 7776000 } });
  await assert.rejects(
    () => tt.issueAccessCodes({ apartment: '101', startMs: STAY.endMs, endMs: STAY.startMs }, { transport }),
    /startMs < endMs/
  );
  clearEnv();
});

test('issueAccessCodes lanza si no se resuelve ninguna chapa', async () => {
  clearEnv();
  setEnv();
  process.env.TTLOCK_LOCKS_JSON = '{}'; // mapeo vacío
  const tt = require(TTLOCK);
  tt._resetTokenCache();
  const { transport } = fakeTransport({ '/oauth2/token': { access_token: 'TOK', expires_in: 7776000 } });
  await assert.rejects(
    () => tt.issueAccessCodes({ apartment: '999', ...STAY }, { transport }),
    /ninguna chapa/
  );
  clearEnv();
});

test('un error de red en la emisión se propaga como no fatal (acumulado en errors)', async () => {
  clearEnv();
  setEnv();
  const tt = require(TTLOCK);
  tt._resetTokenCache();
  // token OK, pero la emisión revienta la red.
  const transport = async (url) => {
    const u = new URL(url);
    if (u.pathname === '/oauth2/token') {
      return { ok: true, status: 200, json: async () => ({ access_token: 'TOK', expires_in: 7776000 }) };
    }
    throw new Error('ECONNRESET');
  };
  const r = await tt.issueAccessCodes({ apartment: '101', includeMain: false, ...STAY }, { transport });
  assert.equal(r.codes.length, 0);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].error, /ECONNRESET/);
  clearEnv();
});

test('ttlockRequest lanza ante HTTP no-ok (5xx)', async () => {
  clearEnv();
  setEnv();
  const tt = require(TTLOCK);
  const transport = async () => ({ ok: false, status: 502, json: async () => { throw new Error('not json'); } });
  await assert.rejects(() => tt.ttlockRequest('/v3/keyboardPwd/get', {}, transport), /TTLock HTTP 502/);
  clearEnv();
});
