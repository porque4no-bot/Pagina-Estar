/* Valida y registra una foto de calidad de aseo (panel de staff aseo.html).
 *
 * Flujo:
 *   1. Auth: permiso `cleaning.audit` (`_authz.authorize`: rol 'aseo' del panel
 *      /admin, o ADMIN_EMAILS/STAFF_EMAILS como superusuarios de respaldo).
 *   2. Audita la foto con IA (visión de Claude) contra el ítem de la lista.
 *   3. Decisión híbrida (evaluateDecision, en código):
 *        - rechazada → NO se guarda; el staff repite la foto.
 *        - advertida → se guarda con las observaciones (no bloquea) y abre una
 *          TAREA en la cola operativa (ops-queue, vía _alert.reportAlert) para
 *          que recepción la revise desde "Hoy" — deduplicada por
 *          apartamento+ítem+día.
 *        - aprobada  → se guarda; si había tarea abierta de ese mismo
 *          apartamento+ítem+día (la foto se repitió y quedó bien), se resuelve.
 *   4. Al guardar: imagen a Google Drive (best-effort) y a Blobs (respaldo),
 *      + metadato/veredicto a Blobs.
 *
 * La imagen viaja como data URL base64 en el cuerpo JSON; el cliente la
 * comprime antes de enviarla (ver aseo.html). */

const { json, corsHeaders, parseJsonBody } = require('./_guest-app');
const { authorize } = require('./_authz');
const { getChecklistItem, auditPhoto, evaluateDecision } = require('./_cleaning-audit');
const { saveAudit, getAudit, savePhoto, apartmentSlug, todayBogota } = require('./_cleaning-store');
const drive = require('./_google-drive');

const MAX_BODY_BYTES = 8 * 1024 * 1024;   /* ~8 MB: cubre una foto comprimida en base64 */

/* Extrae { mediaType, base64, buffer } de un data URL o de base64 crudo. */
function parseImage(input) {
  const s = String(input || '');
  const m = s.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  const mediaType = m ? m[1].toLowerCase() : 'image/jpeg';
  const base64 = (m ? m[2] : s).replace(/\s+/g, '');
  if (!base64) return null;
  let buffer;
  try { buffer = Buffer.from(base64, 'base64'); } catch (e) { return null; }
  if (!buffer.length) return null;
  return { mediaType, base64, buffer };
}

const DRIVE_MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/* Sube la imagen a Drive bajo aseo/<fecha>/<apartamento>/. Best-effort:
   devuelve null si Drive no está configurado o si falla. */
async function uploadToDrive({ image, slug, apartmentLabel, itemId, date }) {
  try {
    if (!(await drive.isConfigured())) return null;
    const root = drive.rootFolderId();
    const aseoFolder = await drive.findOrCreateFolder({ parentId: root, name: 'aseo' });
    const dayFolder = await drive.findOrCreateFolder({ parentId: aseoFolder, name: date });
    const aptFolder = await drive.findOrCreateFolder({ parentId: dayFolder, name: apartmentLabel || slug });
    const ext = DRIVE_MIME_EXT[image.mediaType] || 'jpg';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = await drive.uploadFile({
      folderId: aptFolder,
      name: `${itemId}-${stamp}.${ext}`,
      mimeType: image.mediaType,
      body: image.buffer
    });
    return { id: file.id, link: file.webViewLink || null };
  } catch (e) {
    console.error('[validate-cleaning-photo] Drive upload falló:', e.message);
    return null;
  }
}

/* Clave de la tarea operativa de un ítem con observaciones: una por
   apartamento + ítem + día (repetir la foto no duplica la tarea). */
function cleaningTaskKey(slug, itemId, date) {
  return `cleaning:${slug}:${itemId}:${date}`;
}

/* Dependencias inyectables (tests sin red/Blobs). Carga perezosa de _alert y
   _ops-queue para no acoplar el arranque de la función a esos módulos. */
const deps = {
  authorize: (event, permission) => authorize(event, permission),
  auditPhoto: (item, image) => auditPhoto(item, image),
  uploadToDrive: args => uploadToDrive(args),
  savePhoto: args => savePhoto(args),
  saveAudit: args => saveAudit(args),
  getAudit: (slug, item, date) => getAudit(slug, item, date),
  reportAlert: args => require('./_alert').reportAlert(args)
};

/* Rastro de observaciones: una foto nueva SOBRESCRIBE el registro del día
   (misma clave apto:ítem:fecha). Si el registro anterior fue 'advertida', se
   conserva como observación previa para que recepción vea qué se señaló y quién
   lo corrigió. Nunca se pierde una advertida. */
function carryPreviousWarnings(prev) {
  if (!prev) return [];
  const history = Array.isArray(prev.observacionesPrevias) ? prev.observacionesPrevias.slice(-9) : [];
  if (prev.decision === 'advertida') {
    history.push({
      decision: prev.decision,
      problemas: (prev.verdict && prev.verdict.problemas) || [],
      sugerencia: (prev.verdict && prev.verdict.sugerencia) || '',
      staffEmail: prev.staffEmail || '',
      auditedAt: prev.auditedAt || null,
      driveLink: prev.driveLink || null
    });
  }
  return history;
}

/* advertida → tarea en la cola operativa (y correo al equipo si ALERT_ENABLED).
   Best-effort: nunca tumba el registro de la foto. Devuelve true si se pidió. */
async function openCleaningTask({ apartmentLabel, slug, item, date, verdict, staffEmail, driveLink }) {
  try {
    await deps.reportAlert({
      kind: 'cleaning_warning',
      severity: 'warn',
      message: `Aseo con observaciones — apto ${apartmentLabel} · ${item.label}`,
      context: {
        apartamento: apartmentLabel,
        item: item.label,
        fecha: date,
        problemas: (verdict.problemas || []).slice(0, 5).join('; ') || '(sin detalle)',
        sugerencia: verdict.sugerencia || '',
        registradoPor: staffEmail || '',
        foto: driveLink || '(respaldo en Blobs; Drive no configurado)'
      },
      dedupeKey: cleaningTaskKey(slug, item.id, date)
    });
    return true;
  } catch (e) {
    console.warn('[validate-cleaning-photo] no se pudo abrir la tarea de aseo:', e.message);
    return false;
  }
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await deps.authorize(event, 'cleaning.audit');
  if (!auth.ok) return json(auth.statusCode, { error: auth.error });

  try {
    const body = parseJsonBody(event, MAX_BODY_BYTES);

    const apartmentLabel = String(body.apartment || '').trim().slice(0, 80);
    if (!apartmentLabel) return json(400, { error: 'Indica el apartamento.' });

    const item = getChecklistItem(String(body.item || '').trim());
    if (!item) return json(400, { error: 'Ítem de la lista de chequeo inválido.' });

    const image = parseImage(body.image);
    if (!image) return json(400, { error: 'Falta la foto o el formato es inválido.' });

    /* Auditoría con IA */
    let verdict;
    try {
      verdict = await deps.auditPhoto(item, image);
    } catch (e) {
      console.error('[validate-cleaning-photo] auditoría falló:', e.message);
      return json(502, { error: 'No fue posible auditar la foto. Intenta de nuevo.' });
    }

    const decision = evaluateDecision(verdict);
    const clean = {
      esElObjeto: verdict.es_el_objeto === true,
      calidadFoto: verdict.calidad_foto === 'mala' ? 'mala' : 'buena',
      aseoCorrecto: verdict.aseo_correcto === true,
      problemas: Array.isArray(verdict.problemas) ? verdict.problemas.slice(0, 10).map(p => String(p).slice(0, 200)) : [],
      sugerencia: String(verdict.sugerencia || '').slice(0, 300),
      confianza: Number(verdict.confianza) || 0,
      mock: verdict.mock === true
    };

    /* Rechazada: bloqueo duro, no se registra — el staff repite la foto. */
    if (decision === 'rechazada') {
      return json(200, { decision, stored: false, verdict: clean, item: { id: item.id, label: item.label } });
    }

    /* Aprobada o advertida: se registra. */
    const date = todayBogota();
    const slug = apartmentSlug(apartmentLabel);

    const driveInfo = await deps.uploadToDrive({ image, slug, apartmentLabel, itemId: item.id, date });

    /* Respaldo de bytes en Blobs (best-effort; no bloquea el registro). */
    try {
      await deps.savePhoto({ apartmentSlug: slug, item: item.id, date, buffer: image.buffer, mediaType: image.mediaType });
    } catch (e) {
      console.error('[validate-cleaning-photo] respaldo de imagen en Blobs falló:', e.message);
    }

    let prev = null;
    try { prev = await deps.getAudit(slug, item.id, date); } catch (e) { prev = null; }
    const observacionesPrevias = carryPreviousWarnings(prev);

    const record = await deps.saveAudit({
      apartment: apartmentLabel,
      apartmentSlug: slug,
      item: item.id,
      itemLabel: item.label,
      date,
      staffEmail: auth.email,
      decision,
      verdict: clean,
      driveFileId: driveInfo ? driveInfo.id : null,
      driveLink: driveInfo ? driveInfo.link : null,
      observacionesPrevias
    });

    /* Seguimiento operativo: advertida abre tarea. Una 'aprobada' posterior NO
       la cierra: la persona de aseo es quien está siendo supervisada, así que la
       tarea la cierra recepción desde la pestaña Hoy (staff-ops, con su permiso)
       tras verificar la corrección. */
    let followUp = false;
    if (decision === 'advertida') {
      followUp = await openCleaningTask({
        apartmentLabel, slug, item, date, verdict: clean,
        staffEmail: auth.email, driveLink: record.driveLink
      });
    }

    return json(200, {
      decision,
      stored: true,
      verdict: clean,
      item: { id: item.id, label: item.label },
      driveLink: record.driveLink,
      followUp,
      date
    });
  } catch (error) {
    console.error('[validate-cleaning-photo]', error.message);
    return json(error.statusCode || 500, {
      error: error.statusCode ? error.message : 'No fue posible validar la foto.'
    });
  }
};

exports._test = { deps, cleaningTaskKey, parseImage, carryPreviousWarnings };
