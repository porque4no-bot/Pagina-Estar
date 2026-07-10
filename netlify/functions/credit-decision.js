/* credit-decision.js — Revisión y DECISIÓN HUMANA de crédito (portal Estar).
 *
 * Cierra el lazo que abre credit-enroll: las solicitudes quedan
 * 'pendiente_revision' con una RECOMENDACIÓN de la IA (que solo sugiere), y la
 * decisión — aprobar / rechazar / requiere_codeudor — la toma SIEMPRE un humano
 * con el permiso `credito.aprobar` (convención #12; Ley 1266). Esta función NO
 * usa el token del portal (ese es el carril del solicitante): usa `_authz` /
 * Firebase, el mismo carril staff que Reembolsos.
 *
 *   GET  /api/credit-decision                → cola de solicitudes (credito.ver)
 *   GET  /api/credit-decision?applicationId= → detalle + análisis descifrado
 *                                              (credito.ver; acceso registrado)
 *   POST /api/credit-decision                → decisión humana (credito.aprobar)
 *        body { applicationId, decision, notas }
 *
 * Gated CREDIT_ENABLED (OFF por defecto → inerte). Mock-safe: sin Blobs no lista
 * ni decide pero no lanza. La lectura del análisis descifra el bloque confidencial
 * (PII financiera, Ley 1266) SOLO para quien tiene `credito.ver`, y registra el
 * acceso. Nunca filtra la recomendación al solicitante (eso es credit-enroll).
 */

require('./_env');
const { getStore } = require('@netlify/blobs');
const { flag } = require('./_settings');
const { authorize } = require('./_authz');
const vault = require('./_crypto-vault');

const STORE_NAME = 'credit-applications';
const AUDIT_STORE_NAME = 'credit-audit';

/* Estados terminales que puede fijar la decisión humana. La IA jamás los escribe. */
const DECISIONS = {
  aprobar:            'aprobada',
  rechazar:           'rechazada',
  requiere_codeudor:  'requiere_codeudor'
};

function headersFor() {
  const h = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  if (process.env.ALLOWED_ORIGIN) h['Access-Control-Allow-Origin'] = process.env.ALLOWED_ORIGIN;
  return h;
}

function json(statusCode, headers, obj) {
  return { statusCode, headers, body: JSON.stringify(obj) };
}

/* Blob store — mismo patrón que credit-enroll (strong consistency). */
function storeFor(name) {
  const opts = { name, consistency: 'strong' };
  const siteID = process.env.BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) { opts.siteID = siteID; opts.token = token; }
  return getStore(opts);
}

function clean(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

/* Vista NO sensible de una solicitud para la cola de revisión: sin PII, sin el
   sobre cifrado. Solo lo operativo (estado, recomendación, marcas de proceso). */
function toQueueItem(record) {
  return {
    applicationId: record.applicationId,
    estado: record.estado,
    createdAt: record.createdAt,
    recomendacion: record.recomendacion,          // sugerencia de la IA (no es la decisión)
    esRecomendacion: record.esRecomendacion === true,
    requiereVerificacionIdentidad: record.requiereVerificacionIdentidad === true,
    externoDiferidoPorIdentidad: record.externoDiferidoPorIdentidad === true,
    fuenteSenales: record.fuenteSenales,
    revision: record.revision || { decision: null, revisadoPor: null, revisadoEn: null }
  };
}

/* Detalle CON el análisis descifrado (PII financiera). Solo credito.ver. */
function toDetail(record) {
  const item = toQueueItem(record);
  let analisis = null;
  let solicitante = null;
  if (record.confidential && vault.isConfigured()) {
    try {
      const conf = vault.openJSON(record.confidential, `${record.applicationId}|credito-solicitud`);
      analisis = conf && conf.analisis ? conf.analisis : null;
      // Solo un resumen del solicitante para contactarlo/identificarlo, no los docs.
      if (conf && conf.applicant) {
        solicitante = {
          nombre: conf.applicant.nombre || '',
          email: conf.applicant.email || '',
          telefono: conf.applicant.telefono || '',
          tipoDoc: conf.applicant.tipoDoc || '',
          numeroDoc: conf.applicant.numeroDoc || ''
        };
      }
      if (conf) {
        item.montoSolicitado = conf.montoSolicitado || 0;
        item.plazoMeses = conf.plazoMeses || 0;
      }
    } catch (e) {
      analisis = { error: 'No fue posible descifrar el análisis.' };
    }
  }
  return { ...item, solicitante, analisis, documentos: (record.documentos || []).map(d => ({ kind: d.kind, size: d.size, omitted: d.omitted === true })) };
}

/* Auditoría append-only del acceso/decisión (Ley 1266: trazabilidad de quién
   vio o decidió sobre un dato financiero). Best-effort, nunca tumba la operación. */
async function appendAudit(entry) {
  try {
    const key = `${entry.applicationId}/${Date.now()}-${entry.action}`;
    await storeFor(AUDIT_STORE_NAME).set(key, JSON.stringify(entry));
  } catch (e) {
    console.warn('[credit-decision] auditoría no persistida:', e.message);
  }
}

exports.handler = async event => {
  const headers = headersFor();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return json(405, headers, { error: 'Method Not Allowed' });
  }

  // Feature gate PRIMERO — inerte con el flag OFF (convención #7), sin tocar Blobs.
  let enabled = false;
  try { enabled = await flag('CREDIT_ENABLED'); } catch { enabled = false; }
  if (!enabled) return json(200, headers, { ok: false, enabled: false });

  // ── GET: cola de revisión / detalle ──────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const auth = await authorize(event, 'credito.ver');
    if (!auth.ok) return json(auth.statusCode, headers, { error: auth.error });

    const applicationId = clean((event.queryStringParameters || {}).applicationId, 80);
    try {
      const store = storeFor(STORE_NAME);
      if (applicationId) {
        const raw = await store.get(applicationId);
        if (!raw) return json(404, headers, { error: 'Solicitud no encontrada' });
        const record = JSON.parse(raw);
        // Ley 1266: registrar que este asesor descifró/vio el expediente financiero.
        await appendAudit({ applicationId, action: 'view', actor: auth.email || 'staff', at: new Date().toISOString() });
        return json(200, headers, { ok: true, application: toDetail(record) });
      }
      // Listado (por defecto solo pendientes; ?estado=all|<estado> para el resto).
      const filtro = clean((event.queryStringParameters || {}).estado, 40) || 'pendiente_revision';
      const listing = await store.list();
      const blobs = (listing && listing.blobs) || [];
      const items = [];
      for (const b of blobs) {
        const raw = await store.get(b.key);
        if (!raw) continue;
        let rec; try { rec = JSON.parse(raw); } catch { continue; }
        if (filtro !== 'all' && rec.estado !== filtro) continue;
        items.push(toQueueItem(rec));
      }
      items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return json(200, headers, { ok: true, applications: items, count: items.length });
    } catch (e) {
      console.error('[credit-decision] GET', e.message);
      return json(503, headers, { error: 'Almacenamiento de solicitudes no disponible' });
    }
  }

  // ── POST: DECISIÓN HUMANA ─────────────────────────────────────────────────
  const auth = await authorize(event, 'credito.aprobar');
  if (!auth.ok) return json(auth.statusCode, headers, { error: auth.error });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, headers, { error: 'Cuerpo JSON inválido' }); }

  const applicationId = clean(body.applicationId, 80);
  const decision = clean(body.decision, 40);
  const notas = clean(body.notas, 2000);
  if (!applicationId) return json(400, headers, { error: 'applicationId requerido' });
  if (!Object.prototype.hasOwnProperty.call(DECISIONS, decision)) {
    return json(400, headers, { error: "decision debe ser 'aprobar', 'rechazar' o 'requiere_codeudor'" });
  }
  const nuevoEstado = DECISIONS[decision];
  const actor = auth.email || 'staff';

  try {
    const store = storeFor(STORE_NAME);
    const raw = await store.get(applicationId);
    if (!raw) return json(404, headers, { error: 'Solicitud no encontrada' });
    const record = JSON.parse(raw);

    const revisadoEn = new Date().toISOString();
    const prevRevision = record.revision || {};
    const historial = Array.isArray(record.revisionHistorial) ? record.revisionHistorial.slice() : [];
    if (prevRevision.decision) {
      historial.push({ decision: prevRevision.decision, revisadoPor: prevRevision.revisadoPor, revisadoEn: prevRevision.revisadoEn, notas: prevRevision.notas || null });
    }

    record.estado = nuevoEstado;
    record.revision = { decision, estado: nuevoEstado, revisadoPor: actor, revisadoEn, notas: notas || null };
    record.revisionHistorial = historial;
    // La decisión humana es la autoridad: deja constancia de que NO fue la IA.
    record.decididoPorHumano = true;

    await store.set(applicationId, JSON.stringify(record));
    await appendAudit({ applicationId, action: `decision:${decision}`, actor, estado: nuevoEstado, at: revisadoEn, notas: notas || null });

    return json(200, headers, { ok: true, applicationId, estado: nuevoEstado, decision, revisadoPor: actor, revisadoEn });
  } catch (e) {
    console.error('[credit-decision] POST', e.message);
    return json(503, headers, { error: 'No fue posible registrar la decisión' });
  }
};

/* Utilidades puras para pruebas. */
exports._test = { toQueueItem, toDetail, DECISIONS };
