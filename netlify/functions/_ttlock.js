/* Cliente de TTLock Open Platform (chapas con teclado/PIN) — Frente D.

   Objetivo: que cada reserva pueda generar un CÓDIGO TEMPORAL de teclado
   (keyboardPwd) por apartamento, válido SOLO durante las fechas de la estadía.
   El código se entrega al huésped por correo (`accessCodesHtml` ya existe en
   `_email.js`; aquí solo se generan los códigos).

   El dueño tiene 14 chapas (apts 101-305, todas con teclado/PIN/wifi/bluetooth)
   + la chapa de la puerta principal. Para subir códigos remotamente (sin estar
   al lado de la chapa por Bluetooth) cada chapa necesita un gateway/wifi: por
   eso usamos el endpoint `keyboardPwd/get`, que hace que el SERVIDOR de TTLock
   genere un código aleatorio y lo programe vía gateway (addType remoto).

   Diseño (idéntico patrón a `_odoo.js`):
   - Habla con la Open Platform por HTTP/JSON sobre `fetch`.
   - OAuth2: client_id/client_secret + username + password (MD5, 32 hex, minús.)
     → access_token. El token cacheado se reusa por proceso (vive 90 días).
   - **Sin credenciales o TTLOCK_ENABLED != 'true' = no-op logueado (mock):**
     nada se rompe en local ni mientras no carguemos credenciales reales.
   - El transporte (`fetch`) es inyectable para pruebas sin red.
   - **Nunca debe tumbar el flujo de check-in:** los llamadores envuelven en
     try/catch y tratan cualquier error como no fatal (el huésped igual entra,
     el equipo entrega el código manualmente).

   Variables de entorno (NO están en .env.example aún; cargarlas en Netlify):
     TTLOCK_ENABLED        'true' para activar (default OFF → mock).
     TTLOCK_CLIENT_ID      Application ID de la Open Platform.
     TTLOCK_CLIENT_SECRET  Application secret.
     TTLOCK_USERNAME       cuenta de usuario TTLock (no la de desarrollador).
     TTLOCK_PASSWORD_MD5   contraseña del usuario en MD5 (32 hex minúsculas).
                           Se acepta también la contraseña en claro vía
                           TTLOCK_PASSWORD (se hashea aquí), pero lo recomendado
                           es guardar ya el MD5 para no tener el plano en Netlify.
     TTLOCK_LOCKS_JSON     mapeo apartamento→lockId, p.ej.
                           {"101":1234567,"102":1234568,"main":7654321}
                           Gestionable desde /admin → Configuración (override
                           del panel → env). No es secreto. Verificable con
                           /api/ttlock-probe (lista las chapas de la cuenta).
                           (claves: número de apto como string, o 'main' para la
                           puerta principal). Acepta lockId numérico u objeto
                           { lockId, name }.
     TTLOCK_API_BASE       opcional. Default https://api.sciener.com
                           (UE: https://euapi.ttlock.com).
     TTLOCK_TIMEOUT_MS     opcional, default 10000.
     TTLOCK_PASSCODE_TYPE  opcional, tipo de keyboardPwd. Default 3 (período:
                           válido entre startDate y endDate). 1=una vez, 2=fijo.
*/

const crypto = require('crypto');
const { getSync } = require('./_settings'); // TTLOCK_ENABLED gestionable desde /admin

const DEFAULT_API_BASE = 'https://api.sciener.com';
const KEYBOARD_PWD_VERSION = 4; // última versión soportada por la plataforma.

function md5Hex(value) {
  return crypto.createHash('md5').update(String(value), 'utf8').digest('hex');
}

/* Resuelve el MD5 de la contraseña: si ya viene en MD5 (32 hex) lo usa tal cual
   (en minúsculas); si solo hay la contraseña en claro, la hashea aquí. */
function resolvePasswordMd5() {
  const pre = String(process.env.TTLOCK_PASSWORD_MD5 || '').trim().toLowerCase();
  if (/^[0-9a-f]{32}$/.test(pre)) return pre;
  const plain = process.env.TTLOCK_PASSWORD;
  if (plain) return md5Hex(plain);
  return '';
}

function ttlockConfig() {
  return {
    enabled: String(getSync('TTLOCK_ENABLED', '') || '').toLowerCase() === 'true',
    apiBase: (process.env.TTLOCK_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, ''),
    clientId: process.env.TTLOCK_CLIENT_ID || '',
    clientSecret: process.env.TTLOCK_CLIENT_SECRET || '',
    username: process.env.TTLOCK_USERNAME || '',
    passwordMd5: resolvePasswordMd5(),
    timeoutMs: parseInt(process.env.TTLOCK_TIMEOUT_MS, 10) || 10000,
    passcodeType: parseInt(process.env.TTLOCK_PASSCODE_TYPE, 10) || 3
  };
}

/* ¿Están las 4 credenciales cargadas? (independiente del flag). */
function hasCredentials() {
  const c = ttlockConfig();
  return Boolean(c.clientId && c.clientSecret && c.username && c.passwordMd5);
}

/* Activo solo si el flag está encendido Y hay credenciales completas. */
function isConfigured() {
  const c = ttlockConfig();
  return Boolean(c.enabled && hasCredentials());
}

/* Texto crudo del mapeo apartamento→chapa. Gestionable desde /admin
   (Configuración, override del panel → env TTLOCK_LOCKS_JSON): NO es secreto
   (un lockId solo no abre nada sin las credenciales OAuth). */
function rawLocksJson() {
  return String(getSync('TTLOCK_LOCKS_JSON', '') || '').trim();
}

/* Parsea TTLOCK_LOCKS_JSON → Map normalizado: clave string → { lockId, name }.
   Acepta valores numéricos (solo lockId) u objetos { lockId, name }. */
function parseLocksMap() {
  const raw = rawLocksJson();
  if (!raw) return new Map();
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (err) {
    if (process.env.DEBUG) console.log('[ttlock] TTLOCK_LOCKS_JSON inválido (se ignora):', err.message);
    return new Map();
  }
  const map = new Map();
  if (obj && typeof obj === 'object') {
    for (const [key, val] of Object.entries(obj)) {
      const k = String(key).trim();
      if (!k) continue;
      let lockId = null;
      let name = '';
      if (val && typeof val === 'object') {
        lockId = parseInt(val.lockId, 10) || null;
        name = val.name ? String(val.name) : '';
      } else {
        lockId = parseInt(val, 10) || null;
      }
      if (lockId) map.set(k, { lockId, name: name || k });
    }
  }
  return map;
}

/* Resuelve la lista de chapas a programar para una reserva.
   - Si llega `lockIds` explícito (array de números), se usa tal cual.
   - Si llega un `apartment` (número de apto), se busca en el mapeo + 'main'.
   Devuelve [{ lockId, name }]. */
function resolveLocks({ lockIds, apartment, includeMain } = {}) {
  if (Array.isArray(lockIds) && lockIds.length) {
    return lockIds
      .map((id) => parseInt(id, 10))
      .filter((id) => Number.isFinite(id) && id > 0)
      .map((id) => ({ lockId: id, name: String(id) }));
  }
  const map = parseLocksMap();
  const out = [];
  if (apartment != null) {
    const key = String(apartment).trim();
    if (map.has(key)) out.push(map.get(key));
  }
  // La puerta principal se incluye por defecto si está en el mapeo.
  if (includeMain !== false && map.has('main')) out.push(map.get('main'));
  // Dedup por lockId.
  const seen = new Set();
  return out.filter((l) => (seen.has(l.lockId) ? false : (seen.add(l.lockId), true)));
}

/* ── HTTP/JSON sobre fetch, con timeout y errcode de TTLock ──
   La plataforma responde 200 con { errcode, errmsg } cuando hay error de
   negocio (token vencido, lock inexistente, sin gateway, etc.); hay que
   inspeccionar errcode además del status HTTP. */
async function ttlockRequest(path, params, transport, reqOpts) {
  const c = ttlockConfig();
  const fetchImpl = transport || fetch;
  const method = (reqOpts && reqOpts.method) === 'GET' ? 'GET' : 'POST';
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), c.timeoutMs);
  // La Open Platform recibe los parámetros como x-www-form-urlencoded (POST)
  // o como query string (GET, consultas de solo lectura como lock/list).
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;
    body.append(k, String(v));
  }
  try {
    const res = await fetchImpl(
      method === 'GET' ? `${c.apiBase}${path}?${body.toString()}` : `${c.apiBase}${path}`,
      method === 'GET'
        ? { method: 'GET', signal: ctrl.signal }
        : {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
          signal: ctrl.signal
        }
    );
    clearTimeout(tid);
    if (res && res.ok === false) throw new Error('TTLock HTTP ' + res.status);
    const data = await res.json().catch(() => ({}));
    if (data && data.errcode) {
      throw new Error('TTLock errcode ' + data.errcode + (data.errmsg ? ': ' + data.errmsg : ''));
    }
    return data || {};
  } catch (err) {
    clearTimeout(tid);
    throw err.name === 'AbortError' ? new Error('TTLock request timeout') : err;
  }
}

/* access_token cacheado por proceso. Vive ~90 días; lo refrescamos un poco
   antes de su expiración para no usar uno recién vencido. */
let _cachedToken = null; // { accessToken, uid, expiresAt }

async function getAccessToken(opts) {
  opts = opts || {};
  const transport = opts.transport;
  const now = Date.now();
  if (!opts.force && _cachedToken && _cachedToken.expiresAt > now + 60000) {
    return _cachedToken;
  }
  /* allowDisabled: SOLO para consultas de lectura (ttlock-probe), que deben
     poder verificar las credenciales ANTES de encender TTLOCK_ENABLED. La
     emisión de códigos sigue exigiendo el flag (isConfigured). */
  const ready = opts.allowDisabled ? hasCredentials() : isConfigured();
  if (!ready) {
    throw new Error('TTLock no configurado (faltan credenciales o TTLOCK_ENABLED != true)');
  }
  const c = ttlockConfig();
  const data = await ttlockRequest('/oauth2/token', {
    client_id: c.clientId,
    client_secret: c.clientSecret,
    username: c.username,
    password: c.passwordMd5
  }, transport);
  if (!data.access_token) {
    throw new Error('TTLock OAuth sin access_token (revisa credenciales)');
  }
  const expiresInMs = (parseInt(data.expires_in, 10) || 7776000) * 1000;
  _cachedToken = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || '',
    uid: data.uid || null,
    expiresAt: now + expiresInMs
  };
  return _cachedToken;
}

/* Programa un código de teclado en UNA chapa para el rango [startMs, endMs].
   Usa `keyboardPwd/get`: el servidor de TTLock GENERA el código y lo envía a la
   chapa por gateway (no requiere Bluetooth/SDK como `keyboardPwd/add`).
   Devuelve { lockId, name, keyboardPwd, keyboardPwdId, startMs, endMs }. */
async function issueCodeForLock({ lockId, name, startMs, endMs, keyboardPwdName, keyboardPwdType }, opts) {
  opts = opts || {};
  const transport = opts.transport;
  const c = ttlockConfig();
  const token = await getAccessToken(opts);
  const params = {
    clientId: c.clientId,
    accessToken: token.accessToken,
    lockId,
    keyboardPwdVersion: KEYBOARD_PWD_VERSION,
    keyboardPwdType: keyboardPwdType || c.passcodeType,
    startDate: startMs,
    endDate: endMs,
    date: Date.now()
  };
  if (keyboardPwdName) params.keyboardPwdName = String(keyboardPwdName).slice(0, 100);
  const data = await ttlockRequest('/v3/keyboardPwd/get', params, transport);
  if (!data.keyboardPwd) {
    throw new Error('TTLock no devolvió keyboardPwd para lock ' + lockId);
  }
  return {
    lockId,
    name: name || String(lockId),
    keyboardPwd: String(data.keyboardPwd),
    keyboardPwdId: data.keyboardPwdId || null,
    startMs,
    endMs
  };
}

/* ── API principal ──
   Genera códigos temporales para una reserva. Acepta:
     - lockIds: [num]            (chapas explícitas), o
     - apartment / reservation:  (resuelve por TTLOCK_LOCKS_JSON + main)
     - startMs / endMs           (vigencia = fechas de la estadía, en ms)
   Devuelve { isMock, codes: [{ lockId, name, keyboardPwd, keyboardPwdId,... }],
              errors: [{ lockId, name, error }] }.
   Mock no-op sin credenciales o flag apagado. Errores por-chapa NO tumban el
   resto: se acumulan en `errors` y se devuelven los códigos que sí salieron. */
async function issueAccessCodes(input, opts) {
  input = input || {};
  opts = opts || {};

  // Acepta una reserva como atajo: { reservation: { apartment, checkInMs, checkOutMs } }.
  const reservation = input.reservation || {};
  const apartment = input.apartment != null ? input.apartment : reservation.apartment;
  const startMs = toMs(input.startMs != null ? input.startMs : reservation.checkInMs || reservation.startMs);
  const endMs = toMs(input.endMs != null ? input.endMs : reservation.checkOutMs || reservation.endMs);

  if (!isConfigured()) {
    if (process.env.DEBUG) {
      console.log('[ttlock] mock issueAccessCodes (sin credenciales o flag OFF):',
        { apartment, lockIds: input.lockIds, startMs, endMs });
    }
    return { isMock: true, codes: [], errors: [] };
  }

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error('issueAccessCodes requiere startMs < endMs (timestamps en ms)');
  }

  const locks = resolveLocks({
    lockIds: input.lockIds,
    apartment,
    includeMain: input.includeMain
  });
  if (!locks.length) {
    throw new Error('issueAccessCodes: no se resolvió ninguna chapa (revisa apartment/lockIds y TTLOCK_LOCKS_JSON)');
  }

  const codes = [];
  const errors = [];
  for (const lock of locks) {
    try {
      const code = await issueCodeForLock({
        lockId: lock.lockId,
        name: lock.name,
        startMs,
        endMs,
        keyboardPwdName: input.keyboardPwdName || (reservation.code ? 'Reserva ' + reservation.code : null),
        keyboardPwdType: input.keyboardPwdType
      }, opts);
      codes.push(code);
    } catch (err) {
      // Falla de una chapa no impide programar las demás (no fatal).
      if (process.env.DEBUG) console.log('[ttlock] chapa', lock.lockId, 'falló:', err.message);
      errors.push({ lockId: lock.lockId, name: lock.name, error: err.message });
    }
  }
  return { isMock: false, codes, errors };
}

/* ── Consultas de SOLO LECTURA (ttlock-probe) ──
   Lista las chapas de la cuenta: GET /v3/lock/list (paginado). No programa
   nada en las chapas. Funciona con TTLOCK_ENABLED apagado (allowDisabled) para
   poder verificar la conexión antes de encender la emisión de códigos.
   Devuelve [{ lockId, name, alias, battery, hasGateway }] — NUNCA lockData
   (llave de Bluetooth) ni la MAC. */
async function listLocks(opts) {
  opts = opts || {};
  const transport = opts.transport;
  const c = ttlockConfig();
  const token = await getAccessToken({ transport, allowDisabled: true, force: opts.force });
  const pageSize = 100;
  const maxPages = 10;
  const out = [];
  for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
    const data = await ttlockRequest('/v3/lock/list', {
      clientId: c.clientId,
      accessToken: token.accessToken,
      pageNo,
      pageSize,
      date: Date.now()
    }, transport, { method: 'GET' });
    const list = Array.isArray(data.list) ? data.list : [];
    for (const l of list) {
      const lockId = parseInt(l.lockId, 10);
      if (!lockId) continue;
      const battery = Number(l.electricQuantity);
      out.push({
        lockId,
        name: String(l.lockName || ''),
        alias: String(l.lockAlias || l.lockName || ''),
        battery: Number.isFinite(battery) && battery >= 0 ? battery : null,
        hasGateway: Number(l.hasGateway) === 1 || l.hasGateway === true
      });
    }
    const pages = parseInt(data.pages, 10) || 1;
    if (pageNo >= pages || list.length < pageSize) break;
  }
  return out;
}

/* Estado del mapeo apartamento→chapa para la UI (sin red): si está definido,
   si el JSON es válido y las entradas normalizadas. */
function describeLocksMap() {
  const raw = rawLocksJson();
  if (!raw) return { defined: false, valid: true, entries: [] };
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return { defined: true, valid: false, error: 'Debe ser un objeto JSON {"101": 1234567, ...}', entries: [] };
    }
  } catch (err) {
    return { defined: true, valid: false, error: 'JSON inválido: ' + err.message, entries: [] };
  }
  const entries = [];
  for (const [key, val] of parseLocksMap()) entries.push({ key, lockId: val.lockId, name: val.name });
  return { defined: true, valid: true, entries };
}

/* Convierte fechas/timestamps variados a ms. Acepta number (ms o s), Date,
   o string ISO. Devuelve NaN si no se puede. */
function toMs(value) {
  if (value == null) return NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') {
    // Heurística: si parece estar en segundos (10 dígitos), pásalo a ms.
    return value < 1e12 ? value * 1000 : value;
  }
  const n = Date.parse(value);
  return Number.isNaN(n) ? NaN : n;
}

/* Para tests: limpiar el token cacheado entre escenarios. */
function _resetTokenCache() { _cachedToken = null; }

module.exports = {
  ttlockConfig, isConfigured, hasCredentials, md5Hex, resolvePasswordMd5,
  parseLocksMap, describeLocksMap, resolveLocks, toMs,
  ttlockRequest, getAccessToken, issueCodeForLock, issueAccessCodes,
  listLocks,
  _resetTokenCache
};
