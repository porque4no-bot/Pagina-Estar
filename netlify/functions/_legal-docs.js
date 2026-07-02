require('./_env');
const { flag, get } = require('./_settings');

/*
 * _legal-docs.js — registro de documentos legales de la empresa con control de
 * vigencia y alertas de renovación.
 *
 * Qué resuelve: MIRADA SAS guarda en una carpeta de Google Drive los documentos
 * legales que a cada rato le piden (bancos, portales de OTA, aliados): RUT, RNT,
 * Cámara de Comercio y certificaciones bancarias. Varios caducan o "envejecen" y
 * hay que volver a pedirlos actualizados. Este módulo lee esa carpeta, entiende el
 * nombre de cada archivo (nomenclatura estándar de la empresa), calcula qué tan
 * viejo está cada documento y avisa cuáles conviene renovar.
 *
 * Nomenclatura de archivo: 'YYMMDD - TIPO [número opcional] - EMPRESA.pdf'
 *   '260216 - RNT 276306 - MIRADA SAS.pdf'   → RNT nº 276306, emitido 2026-02-16
 *   '260216 - RUT - MIRADA SAS.pdf'          → RUT (sin vencimiento)
 *   '260701 - CCM - MIRADA SAS.pdf'          → Cámara de Comercio, emitido 2026-07-01
 *   'CB - CA 3504 BANCOLOMBIA - MIRADA SAS.pdf' → certif. bancaria (sin fecha), Bancolombia CA 3504
 *   'CB - CA 1726 DAVIVIENDA - MIRADA SAS.pdf'  → certif. bancaria (sin fecha), Davivienda CA 1726
 *
 * Mock-safe: sin credenciales de Drive (o si el helper no expone listado, o si el
 * flag está apagado), listDocs devuelve { isMock:true, docs:[] } y NUNCA lanza.
 *
 * Config (todo NO secreto → gestionable desde /admin; los secretos de Drive viven
 * solo en Netlify vía _google-drive):
 *   LEGAL_DOCS_ENABLED             'true' para activar el listado real
 *   LEGAL_DOCS_DRIVE_FOLDER_ID     carpeta de Drive con los PDF (default abajo)
 *   LEGAL_DOCS_REQUEST_CONTACT     a quién pedirle un documento actualizado
 */

const DEFAULT_FOLDER_ID = '1uo3ozZVsQN5xXqnziA4PXW7tr5ZNwcMQ';
const DEFAULT_REQUEST_CONTACT = 'el área administrativa';

/* Etiquetas de cara al dueño por tipo. */
const TIPO_LABEL = {
  RUT: 'RUT',
  RNT: 'Registro Nacional de Turismo (RNT)',
  CCM: 'Cámara de Comercio',
  CB: 'Certificación bancaria'
};

/* Reglas de vigencia por tipo. umbralAviso = a cuántos días de emitido conviene
   avisar que ya toca renovarlo (antes de que quede "vencido" para quien lo pida). */
const FRESHNESS_RULES = {
  RUT: { vigenciaDias: null, umbralAviso: null },   /* el RUT no vence */
  RNT: { vigenciaDias: 365,  umbralAviso: 330 },    /* renovación anual */
  CCM: { vigenciaDias: 30,   umbralAviso: 20 },     /* suelen pedirla "reciente" */
  CB:  { vigenciaDias: 30,   umbralAviso: 20 }      /* idem certificación bancaria */
};

const MS_DAY = 86400000;

function pad2(n) { return String(n).padStart(2, '0'); }

/* Convierte 'YYMMDD' a 'YYYY-MM-DD' validando que sea una fecha real.
   Asume siglo 2000 (documentos de la empresa, YY ∈ 00-99 → 2000-2099). null si inválida. */
function yymmddToIso(yymmdd) {
  const m = /^(\d{2})(\d{2})(\d{2})$/.exec(String(yymmdd || ''));
  if (!m) return null;
  const year = 2000 + Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  /* rechaza fechas que "se desbordan" (ej. 30 de febrero) */
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/* Normaliza a un tipo conocido. Acepta variantes comunes (RNT/CCM/RUT/CB). */
function normalizeTipo(raw) {
  const t = String(raw || '').trim().toUpperCase();
  if (Object.prototype.hasOwnProperty.call(TIPO_LABEL, t)) return t;
  return t || null;
}

/* parseDocName(filename) → { tipo, numero, empresa, fechaEmision, raw }
   fechaEmision en 'YYYY-MM-DD' o null (CB suele venir sin fecha). Nunca lanza. */
function parseDocName(filename) {
  const raw = String(filename || '');
  /* quita ruta y extensión */
  const base = raw.replace(/\\/g, '/').split('/').pop().replace(/\.[^.]+$/, '');
  const parts = base.split(' - ').map(s => s.trim());

  const out = { tipo: null, numero: null, empresa: null, fechaEmision: null, raw };

  if (parts.length < 2) return out;

  let idx = 0;
  /* El primer segmento es la fecha YYMMDD, o directamente el TIPO (caso CB sin fecha). */
  const firstIso = yymmddToIso(parts[0]);
  if (firstIso) {
    out.fechaEmision = firstIso;
    idx = 1;
  }

  /* Segmento de tipo (+ número opcional en el MISMO segmento): 'RNT 276306',
     'RUT', 'CCM'. El tipo es el primer token; lo demás del segmento es número/detalle. */
  const tipoSeg = parts[idx] || '';
  const tokens = tipoSeg.split(/\s+/).filter(Boolean);
  const numeroParts = [];
  if (tokens.length) {
    out.tipo = normalizeTipo(tokens[0]);
    const rest = tokens.slice(1).join(' ').trim();
    if (rest) numeroParts.push(rest);
  }

  /* Último segmento = empresa. Los segmentos intermedios (entre el tipo y la
     empresa) son parte del número/detalle: caso CB → 'CB - CA 3504 BANCOLOMBIA - EMPRESA'. */
  const last = parts.length - 1 > idx ? parts[parts.length - 1] : null;
  if (last) out.empresa = last;

  const middleEnd = last ? parts.length - 1 : parts.length;
  for (let i = idx + 1; i < middleEnd; i++) {
    const seg = (parts[i] || '').trim();
    if (seg) numeroParts.push(seg);
  }

  const numero = numeroParts.join(' ').trim();
  if (numero) out.numero = numero;

  return out;
}

function todayIso(today) {
  if (today instanceof Date) return today.toISOString().slice(0, 10);
  if (typeof today === 'string' && today) return today.slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

/* Días completos entre dos fechas ISO (b - a), en UTC. */
function daysBetween(aIso, bIso) {
  const a = Date.parse(`${aIso}T00:00:00Z`);
  const b = Date.parse(`${bIso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.floor((b - a) / MS_DAY);
}

/* freshness(tipo, fechaEmision, today) →
   { diasDesdeEmision, estado, umbralDias }
   estado: 'ok' | 'por-vencer' | 'vencido' | 'sin-vencimiento'.
   - RUT (sin vigencia) → siempre 'sin-vencimiento'.
   - Sin fecha de emisión (ej. CB sin fecha) → 'sin-vencimiento' (no se puede fechar).
   - Con vigencia: vencido si diasDesdeEmision >= vigenciaDias; por-vencer si >= umbralAviso.
   today inyectable (Date o 'YYYY-MM-DD'). Nunca lanza. */
function freshness(tipo, fechaEmision, today) {
  const t = normalizeTipo(tipo);
  const rule = FRESHNESS_RULES[t] || { vigenciaDias: null, umbralAviso: null };
  const umbralDias = rule.vigenciaDias;

  /* Sin regla de vigencia (RUT) → no vence. */
  if (rule.vigenciaDias == null) {
    return { diasDesdeEmision: null, estado: 'sin-vencimiento', umbralDias: null };
  }

  /* Con vigencia pero sin fecha de emisión → no se puede calcular. */
  if (!fechaEmision) {
    return { diasDesdeEmision: null, estado: 'sin-vencimiento', umbralDias };
  }

  const dias = daysBetween(fechaEmision, todayIso(today));
  if (dias == null) {
    return { diasDesdeEmision: null, estado: 'sin-vencimiento', umbralDias };
  }

  let estado = 'ok';
  if (dias >= rule.vigenciaDias) estado = 'vencido';
  else if (rule.umbralAviso != null && dias >= rule.umbralAviso) estado = 'por-vencer';

  return { diasDesdeEmision: dias, estado, umbralDias };
}

/* alertMessage(doc) → texto de cara al dueño con los días y el contacto.
   doc debe traer { tipo, diasDesdeEmision } (p.ej. el resultado combinado de listDocs). */
function alertMessage(doc, deps = {}) {
  const d = doc || {};
  const tipo = normalizeTipo(d.tipo) || 'documento';
  const label = TIPO_LABEL[tipo] || tipo;
  const dias = (d.diasDesdeEmision == null) ? '?' : d.diasDesdeEmision;
  const contacto = deps.contact || process.env.LEGAL_DOCS_REQUEST_CONTACT || DEFAULT_REQUEST_CONTACT;
  return `Este documento (${label}) se emitió hace ${dias} días. Si necesitas uno actualizado, solicítalo a ${contacto}.`;
}

/* ---- Configuración (mock-safe) ---- */

async function configFolderId(deps = {}) {
  const getFn = deps.get || get;
  try { return await getFn('LEGAL_DOCS_DRIVE_FOLDER_ID', DEFAULT_FOLDER_ID); }
  catch (e) { return process.env.LEGAL_DOCS_DRIVE_FOLDER_ID || DEFAULT_FOLDER_ID; }
}

async function isEnabled(deps = {}) {
  const flagFn = deps.flag || flag;
  try { return await flagFn('LEGAL_DOCS_ENABLED'); }
  catch (e) { return String(process.env.LEGAL_DOCS_ENABLED || '').toLowerCase() === 'true'; }
}

/* listDocs(deps) → { isMock?, folderId, docs: [ { ...parse, ...freshness, alerta } ] }
 *
 * Lee los PDF de la carpeta de Drive y combina parse + freshness por documento.
 * _google-drive NO expone un listado propio, así que usamos su cliente autenticado
 * (getDriveClient) para hacer un files.list solo de esta carpeta.
 *
 * Mock-safe: si el flag está apagado, si faltan credenciales de Drive, o si por
 * cualquier razón no se puede listar → { isMock:true, docs:[] }. NUNCA lanza.
 *
 * deps inyectables para tests: { flag, get, drive, today, contact }
 *   drive = objeto tipo _google-drive ({ isConfigured, getDriveClient }) o un
 *           listado ya resuelto vía drive.listFiles(folderId) si lo expusiera.
 */
async function listDocs(deps = {}) {
  const today = deps.today;
  const folderId = await configFolderId(deps);

  if (!(await isEnabled(deps))) {
    return { isMock: true, folderId, docs: [] };
  }

  const drive = deps.drive || safeRequireDrive();
  if (!drive) return { isMock: true, folderId, docs: [] };

  /* ¿Está Drive configurado (credenciales + carpeta raíz)? */
  try {
    if (typeof drive.isConfigured === 'function') {
      const ok = await drive.isConfigured();
      if (!ok) return { isMock: true, folderId, docs: [] };
    }
  } catch (e) { return { isMock: true, folderId, docs: [] }; }

  let files = [];
  try {
    files = await listDriveFiles(drive, folderId);
  } catch (e) {
    return { isMock: true, folderId, docs: [] };
  }
  if (!Array.isArray(files)) return { isMock: true, folderId, docs: [] };

  const contact = deps.contact;
  const docs = files.map(f => {
    const name = (f && (f.name || f.filename)) || '';
    const parsed = parseDocName(name);
    const fresh = freshness(parsed.tipo, parsed.fechaEmision, today);
    const combined = {
      ...parsed,
      ...fresh,
      fileId: (f && (f.id || f.fileId)) || null,
      webViewLink: (f && (f.webViewLink || f.link)) || null
    };
    combined.necesitaAviso = combined.estado === 'por-vencer' || combined.estado === 'vencido';
    combined.alerta = combined.necesitaAviso
      ? alertMessage(combined, { contact })
      : null;
    return combined;
  });

  return { folderId, docs };
}

function safeRequireDrive() {
  try { return require('./_google-drive'); }
  catch (e) { return null; }
}

/* Lista los archivos (PDF) de la carpeta. Prefiere un listado propio del helper si
   lo expusiera (drive.listFiles); si no, usa el cliente autenticado directamente. */
async function listDriveFiles(drive, folderId) {
  if (typeof drive.listFiles === 'function') {
    return await drive.listFiles(folderId);
  }
  if (typeof drive.getDriveClient !== 'function') {
    throw new Error('drive no expone getDriveClient ni listFiles');
  }
  const client = await drive.getDriveClient();
  const escapedId = String(folderId).replace(/'/g, "\\'");
  const q = `'${escapedId}' in parents and trashed = false`;
  const res = await client.files.list({
    q,
    fields: 'files(id, name, webViewLink, modifiedTime, mimeType)',
    pageSize: 200,
    orderBy: 'name',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: 'allDrives'
  });
  const all = (res && res.data && res.data.files) || [];
  /* solo PDF (o cualquier cosa cuyo nombre termine en .pdf) */
  return all.filter(f => {
    const mt = String(f.mimeType || '').toLowerCase();
    const nm = String(f.name || '').toLowerCase();
    return mt === 'application/pdf' || nm.endsWith('.pdf');
  });
}

module.exports = {
  parseDocName,
  freshness,
  alertMessage,
  listDocs,
  yymmddToIso,
  normalizeTipo,
  TIPO_LABEL,
  FRESHNESS_RULES
};
