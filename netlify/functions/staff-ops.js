require('./_env');
const { authorize } = require('./_authz');
const opsQueue = require('./_ops-queue');

/*
 * staff-ops — Staff App v2 (Sprint 2, Mesa Redonda). La cola de tareas accionable
 * que reemplaza la bandeja de correo como mecanismo operativo.
 *   GET                       → lista las tareas abiertas (auth guests.checkin.view).
 *   POST {action:'resolve', id}        → marca una tarea como resuelta.
 *   POST {action:'retry-folio', eventId} → reintenta postear al folio un pedido cuyo
 *        cargo a la cuenta falló (folioStatus:'failed'), reutilizando
 *        postOrderExtrasToFolio; al éxito actualiza el evento y resuelve la tarea
 *        `folio_post_failed:<eventId>`. Gated por GUEST_SERVICE_FOLIO_ENABLED.
 * Read-only salvo las acciones POST explícitas; nunca crea reservas.
 */

function jsonResponse(statusCode, body) {
  const headers = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;
  return { statusCode, headers, body: JSON.stringify(body) };
}

/* Reintenta el cargo al folio de un guest-event fallido. Idempotente: si ya está
   posteado, no duplica. Devuelve { ok, posted, reason }. */
async function retryFolio(eventId, actor, deps = {}) {
  if (!eventId) return { ok: false, reason: 'no-event' };
  const { flag } = deps.settings || require('./_settings');
  if (!(await flag('GUEST_SERVICE_FOLIO_ENABLED'))) return { ok: false, reason: 'folio-disabled' };

  const { guestStore, unprotectRecord, protectRecord } = deps.guestApp || require('./_guest-app');
  const { postOrderExtrasToFolio } = deps.otasync || require('./_otasync');

  let stored;
  try {
    stored = await guestStore('guest-events').get(String(eventId), { type: 'json' });
  } catch (e) {
    return { ok: false, reason: 'load-failed', error: e.message };
  }
  if (!stored) return { ok: false, reason: 'not-found' };

  let record;
  try { record = unprotectRecord(stored); } catch (e) { return { ok: false, reason: 'decrypt-failed' }; }
  if (!record || !Array.isArray(record.items) || !record.items.length) return { ok: false, reason: 'no-items' };
  if (record.folioStatus === 'posted') return { ok: true, posted: true, alreadyPosted: true };

  let folio;
  try {
    folio = await postOrderExtrasToFolio({ idReservations: record.bookingCode, items: record.items });
  } catch (e) {
    return { ok: false, posted: false, reason: 'post-threw', error: e.message };
  }
  const posted = Boolean(folio && folio.posted === true);
  record.folioStatus = posted ? 'posted' : 'failed';
  record.folioRetriedAt = new Date().toISOString();
  record.folioRetriedBy = actor || 'staff';
  try {
    await guestStore('guest-events').setJSON(String(eventId), protectRecord(record));
  } catch (e) { /* non-fatal: el folio ya se posteó/aún falla; el estado se re-evalúa */ }

  if (posted) {
    try { await opsQueue.resolve(`folio_post_failed:${eventId}`, actor); } catch (e) { /* non-fatal */ }
  }
  return { ok: posted, posted, reason: posted ? 'posted' : ((folio && folio.reason) || 'still-failing') };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return jsonResponse(200, {});

  if (event.httpMethod === 'GET') {
    const auth = await authorize(event, 'guests.checkin.view');
    if (!auth.ok) return jsonResponse(auth.statusCode, { error: auth.error });
    try {
      const items = await opsQueue.listOpen();
      return jsonResponse(200, { items, count: items.length });
    } catch (e) {
      return jsonResponse(503, { error: 'No se pudo cargar la cola de tareas' });
    }
  }

  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch (e) { return jsonResponse(400, { error: 'JSON inválido' }); }
    const action = String(body.action || '');

    if (action === 'resolve') {
      const auth = await authorize(event, 'guests.checkin.view');
      if (!auth.ok) return jsonResponse(auth.statusCode, { error: auth.error });
      const id = String(body.id || '').trim();
      if (!id) return jsonResponse(400, { error: 'Falta id' });
      const r = await opsQueue.resolve(id, auth.email);
      return jsonResponse(r.ok ? 200 : 404, { ok: r.ok, reason: r.reason });
    }

    if (action === 'retry-folio') {
      /* Repostear al folio toca el PMS → exige guests.register (recepción/admin). */
      const auth = await authorize(event, 'guests.register');
      if (!auth.ok) return jsonResponse(auth.statusCode, { error: auth.error });
      const r = await retryFolio(String(body.eventId || '').trim(), auth.email);
      return jsonResponse(r.ok || r.posted ? 200 : 422, r);
    }

    return jsonResponse(400, { error: 'Acción no válida (resolve|retry-folio)' });
  }

  return jsonResponse(405, { error: 'Method Not Allowed' });
};

exports._test = { retryFolio };
