require('./_env');
const { authorize } = require('./_authz');
const { listDocs } = require('./_legal-docs');

/* GET — documentos legales de la empresa (RUT, RNT, Cámara de Comercio,
   certificaciones bancarias) con su estado de vigencia y alerta de renovación.
   Devuelve lo que arma _legal-docs.listDocs(): cada documento ya trae el tipo,
   número, empresa, fecha de emisión, días desde la emisión, estado
   (ok/por-vencer/vencido/sin-vencimiento) y, cuando corresponde, el texto de
   alerta de cara al dueño.

   Mock-safe: sin credenciales de Drive o con LEGAL_DOCS_ENABLED apagado,
   listDocs devuelve { isMock:true, docs:[] } sin tocar la red. Read-only.
   Backs la pestaña de documentos legales en /admin. */
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  const auth = await authorize(event, 'docs.view');
  if (!auth.ok) return { statusCode: auth.statusCode, headers, body: JSON.stringify({ error: auth.error }) };

  try {
    const result = await listDocs();
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        docs: (result && result.docs) || [],
        folderId: (result && result.folderId) || null,
        isMock: !!(result && result.isMock)
      })
    };
  } catch (e) {
    console.error('[get-legal-docs]', e.message);
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'No se pudo leer el registro de documentos legales' }) };
  }
};
