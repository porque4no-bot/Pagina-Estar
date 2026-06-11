/* RETIRED ENDPOINT — C-1 (auditoría 360°, 2026-06).
 *
 * `/api/create-booking` solía crear la reserva en OTASync directamente desde
 * el cliente. Ese diseño confiaba en `paymentDetails.status` enviado por el
 * navegador, por lo que permitía crear reservas CONFIRMADAS sin verificar el
 * pago (agotamiento de inventario / reservas fraudulentas de forma anónima).
 *
 * El flujo de producción ya no lo usa: tras el pago, la reserva la crea
 * exclusivamente el webhook de la pasarela (`wompi-webhook` / `_payments`) y
 * el motor (`motor-app.jsx`) hace polling de `/api/booking-status`. Este
 * endpoint queda retirado y responde 410 Gone para que cualquier integración
 * antigua falle de forma visible en vez de crear reservas sin pago.
 *
 * Si en el futuro se necesita una vía alterna de creación de reservas, debe
 * verificar la transacción server-side contra la pasarela (estado + monto +
 * referencia) ANTES de insertar en OTASync. No reintroducir confianza en
 * datos de pago provistos por el cliente. */

const GONE_MESSAGE =
  'Este endpoint fue retirado. La reserva se crea automáticamente tras el pago. ' +
  'Si tienes un cargo sin reserva, contáctanos con tu código de transacción.';

exports.handler = async (event) => {
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  const corsHeaders = {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'OPTIONS',
    'Content-Type': 'application/json'
  };
  if (allowedOrigin && allowedOrigin !== '*') {
    corsHeaders['Access-Control-Allow-Origin'] = allowedOrigin;
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  return {
    statusCode: 410,
    headers: corsHeaders,
    body: JSON.stringify({ error: 'gone', message: GONE_MESSAGE })
  };
};
