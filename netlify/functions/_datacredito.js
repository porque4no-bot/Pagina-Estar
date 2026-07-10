require('./_env');
const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');
const { flag } = require('./_settings');
const { enqueue } = require('./_ops-queue');
const vault = require('./_crypto-vault');

/*
 * _datacredito.js — Integración DataCrédito, versión 1: MANUAL (gated OFF).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ ES ESTO (v1 MANUAL — API/RPA ES FUTURA)
 *   Este módulo NO consulta ni reporta a ninguna central de riesgo por sí mismo.
 *   La v1 es 100% MANUAL: un humano autorizado sube el reporte que ya obtuvo del
 *   portal de DataCrédito y, para reportar una obligación en mora, un humano hace
 *   el cargue en el portal de la central. Este código solo:
 *     1) ingestManualReport(): CONSERVA de forma segura (CIFRADA en reposo) el PDF
 *        del reporte que trajo el humano y registra metadatos para el análisis.
 *     2) reportObligation(): STUB gated que NO llama API ni scrapea nada; solo deja
 *        una TAREA de "cargue manual" en la cola operativa para que una persona lo
 *        realice en el portal de DataCrédito.
 *
 *   La automatización por API oficial (operador de información) o por RPA/scraping
 *   es TRABAJO FUTURO. Cuando se implemente, debe respetar la MISMA firma de estas
 *   funciones (drop-in) y quedar detrás del mismo flag.
 *
 * MOCK-SAFE (convención #2/#7):
 *   - Todo detrás del flag DATACREDITO_ENABLED (OFF por defecto → respuesta inerte,
 *     NUNCA ejecuta el efecto).
 *   - Sin Blobs / sin clave de cifrado NO lanza: degrada a { stored:false, ... } y,
 *     crucial, NUNCA persiste PII financiera EN CLARO (Ley 1266, convención #11).
 *   - Ninguna función lanza hacia afuera; devuelven objetos de resultado.
 *
 * ⚠️  HABEAS DATA FINANCIERO (Ley 1266/2008) — PENDIENTE DE ABOGADO.
 *   Reportar a un operador de información exige BASE LEGAL + AVISO PREVIO al titular
 *   (mínimo 20 días calendario antes del reporte negativo). reportObligation() marca
 *   `avisoPrevioRequerido:true` en la tarea, pero el control de ese aviso y la
 *   decisión de reportar la toma SIEMPRE un humano con el permiso correspondiente
 *   (convención #12: la IA jamás reporta sola). El clausulado queda pendiente de
 *   revisión legal antes de encender DATACREDITO_ENABLED.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const STORE_NAME = 'datacredito-reports';
const MAX_DOC_BYTES = 8 * 1024 * 1024; // ~8MB por PDF decodificado

function clean(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function newReportId(deps = {}) {
  const now = (deps.now || Date.now)();
  return `DC-${now}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

/* Store Blobs (patrón compartido del repo). Mock-safe: si no hay contexto Blobs
   devuelve null en vez de lanzar. deps.getStore permite inyectar un store falso
   en los tests. */
function reportStore(deps = {}) {
  if (deps.getStore) return deps.getStore();
  try {
    const opts = { name: STORE_NAME, consistency: 'strong' };
    const siteID = process.env.BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
    const token = process.env.BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
    if (siteID && token) {
      opts.siteID = siteID;
      opts.token = token;
    }
    return getStore(opts);
  } catch (e) {
    return null;
  }
}

/*
 * ingestManualReport(pdfBuffer, meta, deps?) -> {
 *   stored, enabled, reportId?, encrypted?, record?, reason?
 * }
 *
 * Conserva el PDF del reporte de DataCrédito que trajo un humano, CIFRADO en
 * reposo (_crypto-vault), y registra los metadatos para el análisis posterior. Es
 * SOLO ALMACENAMIENTO SEGURO — no consulta ninguna central.
 *
 * meta: {
 *   pagareRef, bookingCode, titular, documentoTitular, tipoReporte, mediaType,
 *   consentimiento, obligacion, notas, reportId?
 * }
 * Los campos con PII (titular/documento/consentimiento/obligación/notas) se guardan
 * en un sobre CIFRADO aparte; en claro solo queda un resumen operativo no sensible.
 *
 * NUNCA lanza. Sin cifrado configurado NO guarda los bytes del PDF ni la PII en
 * claro (omitido), pero sí deja el registro de metadatos no sensibles.
 */
async function ingestManualReport(pdfBuffer, meta = {}, deps = {}) {
  try {
    const flagFn = deps.flag || flag;
    // Gate OFF por defecto: respuesta inerte, sin persistir nada.
    if (!(await flagFn('DATACREDITO_ENABLED'))) {
      return { stored: false, enabled: false, reason: 'disabled' };
    }

    const v = deps.vault || vault;
    const reportId = clean(meta.reportId, 80) || newReportId(deps);
    const createdAt = new Date((deps.now || Date.now)()).toISOString();

    let buf = null;
    if (Buffer.isBuffer(pdfBuffer)) buf = pdfBuffer;
    else if (typeof pdfBuffer === 'string' && pdfBuffer) buf = Buffer.from(pdfBuffer, 'base64');
    if (buf && buf.length > MAX_DOC_BYTES) {
      return { stored: false, enabled: true, reason: 'document-too-large', reportId };
    }

    const encReady = typeof v.isConfigured === 'function' ? v.isConfigured() : false;

    // AADs que atan cada ciphertext a ESTE reporte (no puede "moverse" a otro).
    const aadDoc = `${reportId}|datacredito-report`;
    const aadMeta = `${reportId}|datacredito-meta`;

    // Bloque confidencial (PII financiera). Solo se persiste CIFRADO.
    const confidential = {
      titular: clean(meta.titular, 160),
      documentoTitular: clean(meta.documentoTitular, 40),
      obligacion: meta.obligacion || null,
      consentimiento: meta.consentimiento || null,
      notas: clean(meta.notas, 2000)
    };

    // Documento (PDF). Solo se guardan bytes si hay cifrado; nunca en claro.
    let document = null;
    if (buf && buf.length) {
      if (encReady) {
        document = {
          envelope: v.seal(buf, aadDoc),
          size: buf.length,
          mediaType: clean(meta.mediaType || 'application/pdf', 80)
        };
      } else {
        // Sin clave: NO se guarda el PDF en claro (Ley 1266). Se deja constancia.
        document = { omitted: true, reason: 'no-encryption', size: buf.length };
      }
    }

    const record = {
      reportId,
      pagareRef: clean(meta.pagareRef, 80),
      bookingCode: clean(meta.bookingCode, 60),
      tipoReporte: clean(meta.tipoReporte, 40) || 'manual', // p.ej. 'positivo' | 'mora' | 'al_dia'
      origen: 'manual',                    // v1 manual; API/RPA es futura
      estado: 'registrado_para_analisis',
      createdAt,
      document,                            // ciphertext o { omitted:true }
      confidential: encReady ? v.sealJSON(confidential, aadMeta) : null,
      // Resumen NO sensible para colas/paneles (sin PII):
      resumen: {
        pagareRef: clean(meta.pagareRef, 80),
        tipoReporte: clean(meta.tipoReporte, 40) || 'manual',
        createdAt,
        encrypted: Boolean(encReady && document && document.envelope)
      }
    };

    const s = reportStore(deps);
    if (!s) {
      return { stored: false, enabled: true, reason: 'no-store', reportId, encrypted: encReady, record };
    }

    let stored = false;
    try {
      await s.set(`report/${reportId}`, JSON.stringify(record));
      stored = true;
    } catch (e) {
      stored = false;
    }

    return {
      stored,
      enabled: true,
      reportId,
      encrypted: encReady,
      record,
      reason: stored ? undefined : 'store-error'
    };
  } catch (e) {
    // Best-effort: jamás lanza hacia afuera.
    return { stored: false, enabled: true, reason: 'error', error: e && e.message };
  }
}

/*
 * reportObligation(pagareRef, obligation, deps?) -> {
 *   reported, enabled, manual, queued, taskId?, reason?, note?
 * }
 *
 * STUB gated de reporte de obligación (mora / al día) a DataCrédito.
 *
 * v1 MANUAL: NO llama a ninguna API y NO scrapea. Cuando el flag está encendido,
 * lo único que hace es dejar una TAREA de "cargue manual" en la cola operativa
 * (_ops-queue) para que un humano autorizado realice el reporte en el portal de la
 * central — previo AVISO al titular (Ley 1266). Por eso `reported` es SIEMPRE
 * false: este módulo nunca reporta por su cuenta (convención #12).
 *
 * NUNCA lanza.
 */
async function reportObligation(pagareRef, obligation = {}, deps = {}) {
  try {
    const flagFn = deps.flag || flag;
    // Gate OFF por defecto: no deja tarea, no hace nada.
    if (!(await flagFn('DATACREDITO_ENABLED'))) {
      return { reported: false, enabled: false, manual: true, queued: false, reason: 'disabled' };
    }

    const ref = clean(pagareRef, 80);
    const tipo = clean(obligation.tipo, 40) || 'mora';
    // reportId opaco que apunta al registro CIFRADO (ingestManualReport) desde el
    // que la persona que gestiona la tarea resolverá titular/monto en caliente.
    const reportId = clean(obligation.reportId, 80);
    const enqueueFn = deps.enqueue || enqueue;

    // Ley 1266 (convención #11): la cola operativa NO está cifrada y es visible en
    // el panel Staff. Por eso NUNCA se escribe aquí el nombre del titular, el monto
    // ni "quién está en mora" en claro. Solo quedan referencias OPACAS (pagareRef/
    // reportId); titular/monto se resuelven del registro cifrado con
    // resolveObligationForTask() al momento de gestionar la tarea.
    const task = {
      kind: 'datacredito_manual_report',
      severity: 'warning',
      // Título sin PII: solo referencias opacas (sin nombre ni monto).
      title: `Cargue manual a DataCrédito — pagaré ${ref || '(sin ref)'}`,
      context: {
        pagareRef: ref,
        tipo,                          // clase de cargue (operativo), sin identificar persona
        reportId: reportId || null,    // puntero al registro cifrado; NO es PII
        // Recordatorio de cumplimiento visible en la tarea:
        avisoPrevioRequerido: true,   // Ley 1266: aviso previo al titular antes del reporte
        canal: 'manual',
        origen: 'v1-manual',
        // Señal explícita: los datos sensibles NO viajan en la tarea.
        piiEnClaro: false,
        resolverConfidencial: 'resolveObligationForTask(reportId)'
      },
      // Idempotente: no duplica el cargue pendiente del mismo pagaré+tipo.
      dedupeKey: `datacredito:${ref}:${tipo}`
    };

    const q = await enqueueFn(task, deps);

    return {
      reported: false,          // v1 nunca reporta sola: lo hace un humano
      enabled: true,
      manual: true,
      queued: Boolean(q && q.queued),
      taskId: q && q.id,
      reportId: reportId || undefined,
      note: 'v1 manual: un humano realiza el cargue en el portal de DataCrédito tras el aviso previo al titular (Ley 1266). Titular/monto NO van en la cola: se resuelven del registro cifrado. Automatización por API/RPA es futura.'
    };
  } catch (e) {
    return { reported: false, enabled: true, manual: true, queued: false, reason: 'error', error: e && e.message };
  }
}

/*
 * resolveObligationForTask(reportId, deps?) -> {
 *   ok, enabled, found, titular?, monto?, documentoTitular?, tipoReporte?,
 *   pagareRef?, reason?
 * }
 *
 * Resuelve, EN CALIENTE y solo al gestionar la tarea, los datos confidenciales
 * (titular/monto/documento) que reportObligation() deliberadamente NO deja en la
 * cola operativa. Lee el registro guardado por ingestManualReport() y abre el
 * sobre CIFRADO (_crypto-vault). La PII financiera nunca queda en claro en reposo
 * fuera del sobre; aquí se descifra en memoria para la persona que hace el cargue.
 *
 * Debe invocarse desde una superficie ya autorizada (permiso de gestión de mora /
 * datacredito): este módulo no expone HTTP; es responsabilidad del llamador el
 * control de acceso.
 *
 * NUNCA lanza. Gated OFF → respuesta inerte.
 */
async function resolveObligationForTask(reportId, deps = {}) {
  try {
    const flagFn = deps.flag || flag;
    if (!(await flagFn('DATACREDITO_ENABLED'))) {
      return { ok: false, enabled: false, found: false, reason: 'disabled' };
    }

    const id = clean(reportId, 80);
    if (!id) return { ok: false, enabled: true, found: false, reason: 'no-report-id' };

    const s = reportStore(deps);
    if (!s) return { ok: false, enabled: true, found: false, reason: 'no-store' };

    let raw = null;
    try {
      raw = await s.get(`report/${id}`);
    } catch (e) {
      return { ok: false, enabled: true, found: false, reason: 'store-error' };
    }
    if (!raw) return { ok: false, enabled: true, found: false, reason: 'not-found' };

    let record = null;
    try {
      record = JSON.parse(raw);
    } catch (e) {
      return { ok: false, enabled: true, found: false, reason: 'corrupt-record' };
    }

    const out = {
      ok: true,
      enabled: true,
      found: true,
      reportId: id,
      pagareRef: record.pagareRef || '',
      tipoReporte: record.tipoReporte || ''
    };

    if (!record.confidential) {
      // El registro se guardó sin cifrado (no había clave): la PII no está disponible.
      return { ...out, confidentialAvailable: false, reason: 'no-encryption' };
    }

    const v = deps.vault || vault;
    const aadMeta = `${id}|datacredito-meta`;
    let conf = null;
    try {
      conf = v.openJSON(record.confidential, aadMeta);
    } catch (e) {
      return { ...out, confidentialAvailable: false, reason: 'decrypt-error' };
    }
    if (!conf) return { ...out, confidentialAvailable: false, reason: 'decrypt-empty' };

    return {
      ...out,
      confidentialAvailable: true,
      titular: conf.titular || '',
      documentoTitular: conf.documentoTitular || '',
      obligacion: conf.obligacion || null,
      monto: conf.obligacion && conf.obligacion.monto != null
        ? Math.max(0, Number(conf.obligacion.monto) || 0)
        : null
    };
  } catch (e) {
    return { ok: false, enabled: true, found: false, reason: 'error', error: e && e.message };
  }
}

module.exports = {
  STORE_NAME,
  ingestManualReport,
  reportObligation,
  resolveObligationForTask,
  /* exportado para tests */
  _test: { newReportId, reportStore }
};
