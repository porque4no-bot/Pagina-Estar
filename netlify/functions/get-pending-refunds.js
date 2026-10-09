require('./_env');
const { authorize } = require('./_authz');
const { listRefunds, redactRefund, policySuggestion, REFUND_SLA_BUSINESS_DAYS } = require('./_refunds-store');
const { flag } = require('./_settings');

/* Lista los reembolsos (opcional ?status=) para la pestaña "Reembolsos" de
   /admin. Solo lectura.
   Frente cancel:
   - Los datos bancarios (cifrados en reposo) se descifran SOLO para quien tiene
     refunds.mark_done (quien hace la transferencia); el resto ve un resumen
     enmascarado (banco, tipo de cuenta, últimos 4).
   - Cada registro trae `policy`: el monto sugerido por la política de la tarifa.
   - `config` dice qué hará "Aprobar" con los interruptores actuales (para que el
     panel lo explique antes de hacer clic) y `viewer` qué puede hacer quien mira. */
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

  const auth = await authorize(event, 'refunds.view');
  if (!auth.ok) return { statusCode: auth.statusCode, headers, body: JSON.stringify({ error: auth.error }) };

  const perms = Array.isArray(auth.permissions) ? auth.permissions : [];
  const canSeeBank = !!auth.isEnvAdmin || perms.includes('refunds.mark_done');

  const status = (event.queryStringParameters || {}).status || null;
  try {
    const raw = await listRefunds(status);
    const now = Date.now();
    const refunds = raw.map((r) => {
      const view = redactRefund(r, { canSeeBank });
      try {
        view.policy = policySuggestion({
          ratePlan: r.ratePlan, checkIn: r.checkIn, nights: r.nights,
          requestedAt: r.createdAt, originalAmountCents: r.originalAmountCents,
          originalAmountSource: r.originalAmountSource
        }, now);
      } catch (e) { view.policy = null; }
      return view;
    });
    let config = null;
    try {
      config = {
        autoCancelPms: await flag('OTASYNC_AUTO_CANCEL_ENABLED'),
        mpAutoRefund: await flag('REFUND_GATEWAY_AUTO_ENABLED'),
        bankForm: await flag('REFUND_BANK_FORM_ENABLED'),
        slaDays: REFUND_SLA_BUSINESS_DAYS
      };
    } catch (e) { config = null; }
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ refunds, config, viewer: { canSeeBank } })
    };
  } catch (e) {
    console.error('[get-pending-refunds]', e.message);
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'Almacenamiento de reembolsos no disponible' }) };
  }
};
