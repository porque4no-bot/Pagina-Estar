/* Incidentes de dinero YA alertados por el webhook (doble pago, monto incorrecto).
 *
 * Problema que resuelve: cuando el webhook detecta un doble pago o un monto
 * incorrecto NO crea reserva ni escribe booking-results para ese código, y abre
 * su propia tarea (pay-double-<tx> / pay-amount-<tx>). La reconciliación, al no
 * encontrar booking-results, volvía a reportar el MISMO pago como "pago sin
 * reserva — crear la reserva o reembolsar" (pay-noreservation-<tx>): dos tareas
 * contradictorias, y la segunda invitaba a crear una reserva duplicada.
 *
 * El webhook deja aquí una marca por (proveedor, tx); reconcile-payments la lee
 * y no vuelve a alertar ese tx. Store 'payment-incidents', clave
 * `<proveedor>:<txId>`. Best-effort: nunca lanza.
 */

const STORE_NAME = 'payment-incidents';
const HANDLED_KINDS = new Set(['payment_double_charge', 'payment_amount_mismatch']);

function incidentKey(provider, transactionId) {
  return `${String(provider || 'unknown').toLowerCase()}:${String(transactionId)}`;
}

function defaultGetStore(name) {
  const { getStore } = require('@netlify/blobs');
  return getStore({ name, consistency: 'strong' });
}

async function recordPaymentIncident({ provider, transactionId, kind, bookingCode }, deps = {}) {
  if (!transactionId || !HANDLED_KINDS.has(kind)) return false;
  try {
    const store = (deps.getStore || defaultGetStore)(STORE_NAME);
    if (!store) return false;
    await store.set(incidentKey(provider, transactionId), JSON.stringify({
      kind, bookingCode: bookingCode || null, at: new Date((deps.now || Date.now)()).toISOString()
    }));
    return true;
  } catch (e) {
    console.warn('[payment-incidents] record failed (non-fatal):', e && e.message);
    return false;
  }
}

async function readPaymentIncident(store, provider, transactionId) {
  if (!store || !transactionId) return null;
  try {
    const raw = await store.get(incidentKey(provider, transactionId));
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return { kind: 'unknown' }; }
  } catch (e) {
    return null;
  }
}

module.exports = { recordPaymentIncident, readPaymentIncident, incidentKey, STORE_NAME, HANDLED_KINDS };
