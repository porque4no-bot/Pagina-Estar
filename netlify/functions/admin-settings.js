require('./_env');
const { authorize } = require('./_authz');
const settings = require('./_settings');

/* Lee/escribe la configuración gestionable del panel (toggles + valores NO
   secretos). GET → estado efectivo de cada clave + de dónde viene (panel/Netlify).
   POST { key, value } → fija (o limpia si value vacío) un override. SOLO claves
   de la lista blanca de _settings (rechaza cualquier secreto). Permiso: settings.manage. */
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (!['GET', 'POST'].includes(event.httpMethod)) {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const auth = await authorize(event, 'settings.manage');
  if (!auth.ok) return { statusCode: auth.statusCode, headers, body: JSON.stringify({ error: auth.error }) };

  try {
    if (event.httpMethod === 'GET') {
      const effective = await settings.getAllEffective();
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, settings: effective }) };
    }

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON inválido' }) }; }

    const key = String(body.key || '').trim();
    if (!settings.isManageable(key)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Clave no gestionable (los secretos se manejan solo en Netlify)' }) };
    }
    /* value vacío/null = limpiar el override (vuelve a regir Netlify). */
    const value = (body.value === undefined) ? '' : body.value;
    await settings.setSetting(key, value);
    if (process.env.DEBUG) console.log(`[admin-settings] ${auth.email} set ${key}=${value === '' ? '(limpiado)' : value}`);
    const effective = await settings.getAllEffective();
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, settings: effective }) };
  } catch (e) {
    console.error('[admin-settings]', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'No se pudo actualizar la configuración' }) };
  }
};
