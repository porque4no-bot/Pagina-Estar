require('./_env');
const { authorize } = require('./_authz');
const {
  loadCode, saveCode, listCodes, buildDefinition, getUsageCount, normalizeCode
} = require('./_discount-store');

/* Panel admin de códigos de descuento (Frente A).
 *
 * Acciones (POST { action, ... }):
 *   list       → lista todos los códigos + su conteo de usos.  (quotes.view)
 *   get        → un código por su id.                          (quotes.view)
 *   create     → crea un código nuevo.                         (quotes.edit)
 *   update     → edita un código existente.                    (quotes.edit)
 *   deactivate → apaga un código (active=false) sin borrarlo.  (quotes.edit)
 *   activate   → enciende un código.                           (quotes.edit)
 *
 * Reusa el catálogo de permisos existente (quotes.view / quotes.edit) — no
 * añade permisos nuevos para no tocar _permissions.js. El audit de cada cambio
 * lo lleva la propia definición (campo audit, ver _discount-store.buildDefinition).
 *
 * Identidad 100% Firebase vía _authz.authorize. Mock-safe: sin Blobs, las
 * lecturas devuelven vacío y las escrituras propagan el error como 503. */

const READ_ACTIONS = new Set(['list', 'get']);
const WRITE_ACTIONS = new Set(['create', 'update', 'deactivate', 'activate']);

function corsHeaders() {
  const headers = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;
  return headers;
}

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON inválido' }) }; }

  const action = String(body.action || '').trim();
  const isRead = READ_ACTIONS.has(action);
  const isWrite = WRITE_ACTIONS.has(action);
  if (!isRead && !isWrite) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Acción inválida (list|get|create|update|deactivate|activate)' }) };
  }

  const auth = await authorize(event, isWrite ? 'quotes.edit' : 'quotes.view');
  if (!auth.ok) return { statusCode: auth.statusCode, headers, body: JSON.stringify({ error: auth.error }) };
  const actor = auth.email || 'admin';

  try {
    if (action === 'list') {
      const codes = await listCodes();
      /* adjunta conteo de usos (para el panel). */
      for (const c of codes) {
        try { c.usedCount = await getUsageCount(c.code); } catch (e) { c.usedCount = 0; }
      }
      codes.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
      return { statusCode: 200, headers, body: JSON.stringify({ codes }) };
    }

    if (action === 'get') {
      const code = normalizeCode(body.code);
      const def = await loadCode(code);
      if (!def) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Código no encontrado' }) };
      def.usedCount = await getUsageCount(code).catch(() => 0);
      return { statusCode: 200, headers, body: JSON.stringify({ code: def }) };
    }

    if (action === 'create') {
      const code = normalizeCode(body.code);
      const existing = await loadCode(code);
      if (existing) return { statusCode: 409, headers, body: JSON.stringify({ error: 'Ya existe un código con ese nombre. Usa "update" para editarlo.' }) };
      const { def, error } = buildDefinition(body, { actor });
      if (error) return { statusCode: 400, headers, body: JSON.stringify({ error }) };
      await saveCode(def);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, code: def }) };
    }

    if (action === 'update') {
      const code = normalizeCode(body.code);
      const existing = await loadCode(code);
      if (!existing) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Código no encontrado' }) };
      const { def, error } = buildDefinition(body, { actor, existing });
      if (error) return { statusCode: 400, headers, body: JSON.stringify({ error }) };
      await saveCode(def);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, code: def }) };
    }

    if (action === 'deactivate' || action === 'activate') {
      const code = normalizeCode(body.code);
      const existing = await loadCode(code);
      if (!existing) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Código no encontrado' }) };
      const wantActive = action === 'activate';
      const { def, error } = buildDefinition(
        Object.assign({}, existing, { active: wantActive }),
        { actor, existing }
      );
      if (error) return { statusCode: 400, headers, body: JSON.stringify({ error }) };
      await saveCode(def);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, code: def }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Acción inválida' }) };
  } catch (e) {
    console.error('[admin-discount-codes]', e.message);
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'Almacenamiento no disponible' }) };
  }
};
