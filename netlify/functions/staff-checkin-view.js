require('./_env');
const { authorize } = require('./_authz');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limit');
const hoy = require('./_staff-hoy');

/*
 * staff-checkin-view — Frente "Panel Hoy para recepción": visor de check-ins.
 *
 * GET ?checkinId=CHK-…            → un check-in descifrado (ocupantes + contexto).
 * GET ?bookingCode=12345          → los check-ins recientes de esa reserva.
 * GET ?checkinId=CHK-…&doc=<key>&store=adult|minor
 *                                 → un documento que EXISTA (imagen/PDF) en base64.
 *
 * Auth: guests.checkin.view (recepción + admin). Devuelve SOLO lo que pide el
 * registro hotelero (SIRE/TRA): nombres, tipo y número de documento,
 * nacionalidad, nacimiento, sexo, ocupación, residencia, procedencia, destino
 * (extranjeros) y la marca de revisión manual. Nunca correo/teléfono/dirección.
 *
 * Ley 1581 — trazabilidad: CADA acceso queda en el store `staff-audit`
 * (quién, cuándo, qué reserva/check-in/documento, IP). Fuera de modo demo el
 * visor es fail-closed: si la auditoría no se puede escribir, NO muestra datos.
 *
 * Las imágenes del documento de adultos solo existen si GUEST_APP_STORE_DOCUMENTS
 * estuvo encendido al hacer el check-in (hoy apagado); los del menor (registro
 * civil / autorización) siempre se guardan cifrados. Se lista lo que existe.
 */

const MAX_DOC_BYTES = 4 * 1024 * 1024; /* límite de respuesta de la función (~6 MB en base64) */
const BOOKING_CODE_RE = /^[A-Za-z0-9-]{1,50}$/;
const BOOKING_SCAN_DAYS = 400;         /* búsqueda por reserva: check-ins del último ~año */

function jsonResponse(statusCode, body) {
  const headers = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;
  return { statusCode, headers, body: JSON.stringify(body) };
}

const defaultDeps = {
  isDemoMode: () => require('./_guest-app').isDemoMode(),
  openBinaryFromStore: (stored, aad) => require('./_guest-app').openBinaryFromStore(stored, aad),
  now: () => Date.now()
};
const deps = { ...defaultDeps };

/* Registra el acceso. Devuelve true si se puede continuar (auditado, o demo). */
async function audit(entry) {
  const res = await hoy.appendStaffAudit(entry, deps);
  if (res.ok) return true;
  if (deps.isDemoMode()) {
    console.warn('[staff-checkin-view] auditoría no persistida (modo demo, se continúa)');
    return true;
  }
  console.error('[staff-checkin-view] auditoría no persistida → acceso denegado (fail-closed)');
  return false;
}

async function readDocument({ record, store, key }) {
  const storeName = hoy.DOC_STORES[store];
  if (!storeName) return { statusCode: 400, body: { error: 'Tipo de documento no válido' } };
  if (!String(key).startsWith(`${record.checkinId}/`) || key.includes('..')) {
    return { statusCode: 400, body: { error: 'Documento no válido para este check-in' } };
  }
  const blob = hoy.safeStore(storeName, deps);
  if (!blob) return { statusCode: 503, body: { error: 'Almacenamiento no disponible' } };
  let got;
  try {
    got = typeof blob.getWithMetadata === 'function'
      ? await blob.getWithMetadata(key, { type: 'arrayBuffer' })
      : { data: await blob.get(key, { type: 'arrayBuffer' }), metadata: {} };
  } catch (e) {
    return { statusCode: 503, body: { error: 'No se pudo leer el documento' } };
  }
  if (!got || got.data == null) return { statusCode: 404, body: { error: 'El documento no existe' } };
  const raw = Buffer.isBuffer(got.data) ? got.data : Buffer.from(got.data);
  let buffer;
  try {
    buffer = deps.openBinaryFromStore(raw, hoy.documentAad(store, key, record.bookingCode));
  } catch (e) {
    return { statusCode: 500, body: { error: 'No se pudo descifrar el documento' } };
  }
  if (!buffer || buffer.length > MAX_DOC_BYTES) {
    return { statusCode: 413, body: { error: 'El documento es demasiado grande para mostrarse aquí' } };
  }
  const meta = (got && got.metadata) || {};
  return {
    statusCode: 200,
    body: {
      checkinId: record.checkinId,
      key,
      store,
      kind: hoy.docKind(store, key),
      contentType: String(meta.contentType || 'application/octet-stream'),
      size: buffer.length,
      dataBase64: buffer.toString('base64')
    }
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return jsonResponse(200, {});
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method Not Allowed' });

  const auth = await authorize(event, 'guests.checkin.view');
  if (!auth.ok) return jsonResponse(auth.statusCode, { error: auth.error });

  const limited = await checkRateLimit(event, { name: 'staff-checkin-view', limit: 120, windowMs: 10 * 60 * 1000 });
  if (!limited.ok) return rateLimitResponse({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, limited.retryAfter);

  const qp = event.queryStringParameters || {};
  const checkinId = String(qp.checkinId || '').trim();
  const bookingCode = String(qp.bookingCode || '').trim();
  const docKey = String(qp.doc || '').trim();
  const ip = hoy.clientIp(event);

  try {
    /* ── Un documento concreto ── */
    if (docKey) {
      if (!hoy.CHECKIN_ID_RE.test(checkinId)) return jsonResponse(400, { error: 'Falta un checkinId válido' });
      const record = await hoy.loadCheckin(checkinId, deps);
      if (!record) return jsonResponse(404, { error: 'Check-in no encontrado' });
      record.checkinId = record.checkinId || checkinId;
      const okAudit = await audit({
        action: 'checkin.document', actor: auth.email, bookingCode: record.bookingCode || null,
        checkinId, docKey, store: String(qp.store || ''), ip
      });
      if (!okAudit) return jsonResponse(503, { error: 'No se pudo registrar la auditoría del acceso. Intenta de nuevo.' });
      const r = await readDocument({ record, store: String(qp.store || ''), key: docKey });
      return jsonResponse(r.statusCode, r.body);
    }

    /* ── Check-in(s) ── */
    let records = [];
    if (checkinId) {
      if (!hoy.CHECKIN_ID_RE.test(checkinId)) return jsonResponse(400, { error: 'checkinId no válido' });
      const record = await hoy.loadCheckin(checkinId, deps);
      if (record) {
        record.checkinId = record.checkinId || checkinId;
        records = [record];
      }
    } else if (bookingCode) {
      if (!BOOKING_CODE_RE.test(bookingCode)) return jsonResponse(400, { error: 'bookingCode no válido' });
      const sinceMs = deps.now() - BOOKING_SCAN_DAYS * hoy.DAY_MS;
      const res = await hoy.findCheckins([bookingCode], { sinceMs, deps, withRecords: true });
      records = (res.byBooking.get(bookingCode) || []).map(x => x.record).filter(Boolean);
    } else {
      return jsonResponse(400, { error: 'Indica checkinId o bookingCode' });
    }

    if (!records.length) {
      /* Una consulta sin resultado no expone datos: no se audita. */
      return jsonResponse(404, { error: 'No hay check-in registrado para esa reserva' });
    }

    const okAudit = await audit({
      action: 'checkin.view', actor: auth.email,
      bookingCode: records[0].bookingCode || bookingCode || null,
      checkinIds: records.map(r => r.checkinId), ip
    });
    if (!okAudit) return jsonResponse(503, { error: 'No se pudo registrar la auditoría del acceso. Intenta de nuevo.' });

    const checkins = [];
    for (const record of records) {
      const view = hoy.checkinView(record);
      view.documents = await hoy.listCheckinDocuments(view.checkinId, deps);
      checkins.push(view);
    }
    checkins.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return jsonResponse(200, { bookingCode: checkins[0].bookingCode, checkins, audited: true });
  } catch (e) {
    console.error('[staff-checkin-view]', e.message);
    return jsonResponse(500, { error: 'No fue posible abrir el check-in.' });
  }
};

exports._test = {
  setDeps(overrides = {}) { Object.assign(deps, overrides); },
  resetDeps() { Object.keys(deps).forEach(k => delete deps[k]); Object.assign(deps, defaultDeps); },
  readDocument, MAX_DOC_BYTES
};
