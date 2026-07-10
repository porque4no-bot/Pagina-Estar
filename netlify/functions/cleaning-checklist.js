/* Devuelve la lista de chequeo de aseo para la página de staff (aseo.html).
 *
 * La fuente única de los ítems es _cleaning-audit.CHECKLIST; el panel los
 * renderiza desde aquí para que no haya que duplicar la lista en el HTML.
 * Requiere auth de personal — el panel completo es de uso interno. */

const { json, corsHeaders } = require('./_guest-app');
const { authenticateStaff } = require('./_staff-auth');
const { CHECKLIST, isEnabled } = require('./_cleaning-audit');

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await authenticateStaff(event);
  if (!auth.ok) return json(auth.statusCode, { error: auth.error });

  return json(200, {
    aiEnabled: isEnabled(),
    items: CHECKLIST.map(i => ({ id: i.id, label: i.label, hint: i.hint }))
  });
};
