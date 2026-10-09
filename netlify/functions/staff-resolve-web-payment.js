require('./_env');
const { authorize } = require('./_authz');
const hoy = require('./_staff-hoy');

/*
 * staff-resolve-web-payment — Frente "Panel Hoy para recepción".
 *
 * POST { webCode: 'EST-…', resolution: 'reserva_creada' | 'devuelto', note? }
 *
 * Un "pago sin reserva" (booking-results `direct-<EST-…>` con reservationPending)
 * se queda en rojo para siempre: nada lo borra cuando recepción crea la reserva a
 * mano en Kunas o se devuelve la plata. Esta acción deja constancia de que ya se
 * resolvió, escribiendo resolvedAt/resolvedBy/resolution EN LA MISMA ENTRADA (no
 * borra nada: reservationPending, monto y transacción se conservan como
 * histórico). paymentFromResult y reconcile-payments la respetan.
 *
 * NO toca Kunas ni las pasarelas: solo el registro interno de Blobs.
 *
 * Auth: guests.register (recepción + admin: quien crea la reserva a mano).
 * Auditado en `staff-audit` ANTES de escribir; si la auditoría no se puede
 * guardar, no se marca nada (fail-closed).
 */

const RESOLUTIONS = new Set(['reserva_creada', 'devuelto']);

function jsonResponse(statusCode, body) {
  const headers = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;
  return { statusCode, headers, body: JSON.stringify(body) };
}

/* Deps inyectables en pruebas (getStore, now). */
const deps = {};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return jsonResponse(200, {});
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method Not Allowed' });

  const auth = await authorize(event, 'guests.register');
  if (!auth.ok) return jsonResponse(auth.statusCode, { error: auth.error });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return jsonResponse(400, { error: 'JSON inválido' }); }
  const webCode = String((body && body.webCode) || '').trim().toUpperCase();
  const resolution = String((body && body.resolution) || '').trim();
  const note = String((body && body.note) || '').trim().slice(0, 300);
  if (!hoy.isWebReference(webCode)) return jsonResponse(400, { error: 'Código web no válido' });
  if (!RESOLUTIONS.has(resolution)) return jsonResponse(400, { error: 'Resolución no válida' });

  let store;
  try { store = hoy.blobStore('booking-results', deps); } catch (e) { store = null; }
  if (!store) return jsonResponse(503, { error: 'Registro de pagos no disponible' });

  const key = `direct-${webCode}`;
  let entry;
  try {
    const raw = await store.get(key);
    if (!raw) return jsonResponse(404, { error: 'No hay registro de pago para ese código' });
    entry = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    return jsonResponse(503, { error: 'No se pudo leer el registro de pago' });
  }
  if (!entry || entry.reservationPending !== true) {
    return jsonResponse(409, { error: 'Ese pago no está marcado como "pago sin reserva"' });
  }
  if (entry.resolvedAt) {
    return jsonResponse(200, { ok: true, alreadyResolved: true, resolvedAt: entry.resolvedAt, resolution: entry.resolution || null });
  }

  const audit = await hoy.appendStaffAudit({
    action: 'web-payment.resolve', actor: auth.email, webCode, resolution, note: note || null,
    transactionId: entry.transactionId || null, ip: hoy.clientIp(event)
  }, deps);
  if (!audit || !audit.ok) {
    return jsonResponse(503, { error: 'No se pudo registrar la auditoría; no se marcó nada' });
  }

  const resolvedAt = new Date((deps.now || Date.now)()).toISOString();
  const updated = { ...entry, resolvedAt, resolvedBy: auth.email || null, resolution, resolutionNote: note || null };
  try {
    await store.set(key, JSON.stringify(updated));
  } catch (e) {
    console.error('[staff-resolve-web-payment] write failed:', e.message);
    return jsonResponse(503, { error: 'No se pudo guardar; intenta de nuevo' });
  }
  return jsonResponse(200, { ok: true, webCode, resolution, resolvedAt });
};

exports._test = {
  RESOLUTIONS,
  setDeps(overrides = {}) { Object.assign(deps, overrides); },
  resetDeps() { Object.keys(deps).forEach(k => delete deps[k]); }
};
