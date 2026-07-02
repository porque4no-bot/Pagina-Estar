require('./_env');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limit');
const { verifyDiscountCode, normalizeCode } = require('./_discount-store');
const { flag } = require('./_settings');

/* Validación pública (solo lectura) de un código de descuento para la UI del
   Paso 4 del motor. NO revela códigos válidos: ante cualquier fallo devuelve un
   { valid:false } uniforme con un motivo genérico (no "no existe" vs "expiró")
   para no permitir enumeración. La verificación de monto REAL y la firma viven
   en create-wompi-signature; esto es solo para el feedback en vivo.

   Gated OFF por defecto con DISCOUNT_CODES_ENABLED=true: si no está encendido,
   responde 'disabled' (la UI no muestra el campo). Mock-safe: sin Blobs todo
   código "no existe" → valid:false.

   Parámetros GET: code, email?, nights?, roomTypeId?, checkin?, checkout?,
   subtotalCents? (para mostrar el ahorro estimado en pantalla). */

/* Gestionable desde /admin (override del panel → env). */
async function discountEnabled() { return await flag('DISCOUNT_CODES_ENABLED'); }

function corsHeaders() {
  const headers = {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;
  return headers;
}

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  if (!(await discountEnabled())) {
    return { statusCode: 200, headers, body: JSON.stringify({ valid: false, reason: 'disabled', enabled: false }) };
  }

  /* Rate-limit: evita probing/enumeración de códigos. Best-effort. */
  const limited = await checkRateLimit(event, { name: 'validate-discount', limit: 20, windowMs: 5 * 60 * 1000 });
  if (!limited.ok) return rateLimitResponse(headers, limited.retryAfter);

  const p = event.queryStringParameters || {};
  const code = normalizeCode(p.code);
  if (!code) {
    return { statusCode: 200, headers, body: JSON.stringify({ valid: false, reason: 'invalid', enabled: true }) };
  }

  const subtotalCents = p.subtotalCents !== undefined ? parseInt(p.subtotalCents, 10) : undefined;
  const nights = p.nights !== undefined ? parseInt(p.nights, 10) : undefined;

  let result;
  try {
    result = await verifyDiscountCode({
      code,
      email: p.email || '',
      nights: Number.isFinite(nights) ? nights : undefined,
      roomTypeId: p.roomTypeId || '',
      checkin: p.checkin || '',
      checkout: p.checkout || '',
      subtotalCents: Number.isFinite(subtotalCents) ? subtotalCents : undefined
    });
  } catch (e) {
    console.error('[validate-discount-code] verify failed:', e.message);
    /* Fail-closed: ante error, el código simplemente no aplica. */
    return { statusCode: 200, headers, body: JSON.stringify({ valid: false, reason: 'unavailable', enabled: true }) };
  }

  if (!result.valid) {
    /* Motivo genérico salvo los casos que ayudan al usuario sin revelar nada
       sobre OTROS códigos (estadía mínima / habitación / fechas son del propio
       intento del usuario, no enumeran códigos). */
    const SAFE = new Set(['min_nights', 'room_not_eligible', 'blackout', 'expired', 'already_used', 'exhausted']);
    const reason = SAFE.has(result.reason) ? result.reason : 'invalid';
    return { statusCode: 200, headers, body: JSON.stringify({ valid: false, reason, enabled: true }) };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      valid: true,
      code,
      type: result.def.type,
      value: result.def.value,
      discountCents: result.discountCents || 0,
      enabled: true
    })
  };
};

exports._test = { discountEnabled };
