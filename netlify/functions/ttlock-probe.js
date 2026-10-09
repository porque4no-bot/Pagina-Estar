/* Health probe de TTLock (chapas con teclado) — SOLO LECTURA.
   GET /api/ttlock-probe   (permiso settings.manage — botón "Probar conexión
   TTLock" en /admin → Configuración).

   Qué hace:
     1. Reporta qué credenciales están cargadas (solo booleanos — NUNCA ecoa
        secretos) y si TTLOCK_ENABLED está encendido.
     2. Con credenciales: pide el access_token (OAuth) y lista las chapas de la
        cuenta (GET /v3/lock/list): lockId, alias, batería, si tiene gateway.
        No programa NADA en las chapas (no emite códigos, no abre, no borra).
        Funciona con TTLOCK_ENABLED apagado, para verificar ANTES de encender.
     3. Cruza el mapeo actual TTLOCK_LOCKS_JSON (apartamento → lockId) con las
        chapas de la cuenta: qué entradas apuntan a una chapa que no existe y
        qué chapas no están mapeadas, y propone un mapa sugerido (por alias).

   Mock-safe: sin credenciales responde 200 con ok:false y la nota de qué falta,
   sin tocar la red. Mismo patrón que drive-probe / whatsapp-probe. */

require('./_env');
const { authorize } = require('./_authz');
const ttlock = require('./_ttlock');
const { preload, flag } = require('./_settings');

/* Clave sugerida para una chapa a partir de su alias: el primer número de 3-4
   dígitos ("Apto 101" → "101"); "principal"/"main"/"entrada"/"portón" → "main".
   Si no se reconoce, null (el admin la completa a mano). Pura/testeable. */
function suggestKey(alias) {
  const a = String(alias || '').toLowerCase();
  if (/\b(main|principal|entrada|porter[ií]a|port[oó]n|puerta principal|lobby)\b/.test(a)) return 'main';
  const m = a.match(/\b(\d{3,4})\b/);
  return m ? m[1] : null;
}

/* Cruza el mapeo con las chapas de la cuenta. Pura/testeable. */
function crossCheck(locks, mapping) {
  const byId = new Map((locks || []).map(l => [l.lockId, l]));
  const mappedIds = new Set((mapping.entries || []).map(e => e.lockId));
  const entries = (mapping.entries || []).map(e => ({
    key: e.key,
    lockId: e.lockId,
    foundInAccount: byId.has(e.lockId),
    alias: byId.has(e.lockId) ? byId.get(e.lockId).alias : null
  }));
  const unmapped = (locks || []).filter(l => !mappedIds.has(l.lockId)).map(l => l.lockId);

  /* Mapa sugerido = lo ya mapeado (que existe) + sugerencias por alias para lo
     que falta, sin pisar claves existentes. */
  const suggested = {};
  for (const e of entries) if (e.foundInAccount) suggested[e.key] = e.lockId;
  const pending = [];
  for (const l of (locks || [])) {
    if (mappedIds.has(l.lockId)) continue;
    const k = suggestKey(l.alias || l.name);
    if (k && suggested[k] === undefined) suggested[k] = l.lockId;
    else pending.push(l.lockId);
  }
  return { entries, unmapped, suggested, pendingWithoutKey: pending };
}

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) corsHeaders['Access-Control-Allow-Origin'] = allowedOrigin;

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  const auth = await authorize(event, 'settings.manage');
  if (!auth.ok) return { statusCode: auth.statusCode, headers: corsHeaders, body: JSON.stringify({ error: auth.error }) };

  /* Calienta el snapshot de overrides del panel (TTLOCK_ENABLED /
     TTLOCK_LOCKS_JSON se leen en sync dentro de _ttlock). */
  await preload({ fresh: true }); /* sin caché: el mapa recién guardado desde el panel se ve de inmediato */

  const c = ttlock.ttlockConfig();
  const mapping = ttlock.describeLocksMap();
  const result = {
    ok: false,
    config: {
      enabled: await flag('TTLOCK_ENABLED'),
      clientId: Boolean(c.clientId),
      clientSecret: Boolean(c.clientSecret),
      username: Boolean(c.username),
      password: Boolean(c.passwordMd5),
      apiBase: c.apiBase
    },
    mapping,
    locks: []
  };

  if (!ttlock.hasCredentials()) {
    result.note = 'Faltan credenciales de TTLock (TTLOCK_CLIENT_ID / TTLOCK_CLIENT_SECRET / TTLOCK_USERNAME / TTLOCK_PASSWORD o TTLOCK_PASSWORD_MD5) en Netlify. No se consultó la plataforma.';
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(result) };
  }

  try {
    const locks = await ttlock.listLocks();
    result.ok = true;
    result.locks = locks;
    result.check = crossCheck(locks, mapping);
    if (!locks.length) result.note = 'Conexión correcta, pero la cuenta no tiene chapas registradas.';
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(result) };
  } catch (e) {
    /* El mensaje de TTLock (errcode/errmsg) no incluye secretos; se recorta. */
    result.error = String(e && e.message ? e.message : e).slice(0, 200);
    return { statusCode: 502, headers: corsHeaders, body: JSON.stringify(result) };
  }
};

exports._test = { suggestKey, crossCheck };
