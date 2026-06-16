/* Health check admin para la integración con Odoo.
   GET /api/odoo-probe
   Reporta qué variables están presentes (solo booleanos — nunca expone
   secretos) y, si están las credenciales, intenta autenticar contra Odoo y
   contar los contactos para confirmar que la conexión y los permisos
   funcionan. Útil durante la configuración, antes de empezar a sincronizar. */

const { authenticateAdmin } = require('./_firebase-auth');
const { odooConfig, isConfigured, authenticate, executeKw, _resetAuthCache } = require('./_odoo');

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) corsHeaders['Access-Control-Allow-Origin'] = allowedOrigin;

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  const auth = await authenticateAdmin(event);
  if (!auth.ok) return { statusCode: auth.statusCode, headers: corsHeaders, body: JSON.stringify({ error: auth.error }) };

  const c = odooConfig();
  const result = {
    ok: false,
    config: {
      url: c.url || null,            // la URL no es secreta
      db: c.db || null,             // el nombre de la base no es secreto
      username: Boolean(c.username),
      apiKey: Boolean(c.apiKey)
    }
  };

  if (!isConfigured()) {
    result.note = 'Faltan variables de Odoo (ODOO_URL / ODOO_DB / ODOO_USERNAME / ODOO_API_KEY) — el conector corre en modo mock.';
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(result) };
  }

  try {
    _resetAuthCache();
    const uid = await authenticate();
    let partnerCount = null;
    try {
      partnerCount = await executeKw('res.partner', 'search_count', [[]]);
    } catch (e) { /* el usuario autenticó pero quizá sin permiso de Contactos */ }
    result.ok = true;
    result.connection = { authenticatedUid: uid, partnerCount };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(result) };
  } catch (e) {
    result.connection = { error: e.message };
    return { statusCode: 503, headers: corsHeaders, body: JSON.stringify(result) };
  }
};
