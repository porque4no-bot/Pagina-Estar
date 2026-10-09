/* Devuelve la lista de chequeo de aseo para la página de staff (aseo.html).
 *
 * La fuente única de los ítems es _cleaning-audit.CHECKLIST; el panel los
 * renderiza desde aquí para que no haya que duplicar la lista en el HTML.
 * Auth: permiso `cleaning.audit` vía `_authz.authorize` — así el personal de
 * aseo creado en /admin (rol 'aseo') puede entrar, no solo STAFF_EMAILS/ADMIN_EMAILS
 * (que siguen entrando como superusuarios de respaldo). */

const { json, corsHeaders } = require('./_guest-app');
const { authorize } = require('./_authz');
const { CHECKLIST, isEnabled } = require('./_cleaning-audit');

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await authorize(event, 'cleaning.audit');
  if (!auth.ok) return json(auth.statusCode, { error: auth.error });

  return json(200, {
    aiEnabled: isEnabled(),
    items: CHECKLIST.map(i => ({ id: i.id, label: i.label, hint: i.hint }))
  });
};
