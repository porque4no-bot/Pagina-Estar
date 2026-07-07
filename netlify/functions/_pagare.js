require('./_env');
const crypto = require('crypto');

/*
 * _pagare.js — Generación de PAGARÉ (título valor) + firma electrónica Ley 527
 * con proveedor de firma SWAPPABLE (intercambiable).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ HACE
 *   1) Construye el contenido legal del pagaré (buildPagareData) como TÍTULO VALOR
 *      a la orden de Hotel Estar, con la "mención del derecho" incorporada.
 *   2) Renderiza el pagaré a PDF (renderPagarePDF, reusa pdfkit igual que
 *      _pdf-render.js) y calcula su hash.
 *   3) Captura la firma electrónica con la EVIDENCIA que exige la Ley 527 de 1999
 *      y el Decreto 2364 de 2012 (firma electrónica simple) para dar fiabilidad y
 *      no repudio: consentimiento explícito, marca de tiempo, IP/canal/user-agent,
 *      identidad del firmante y HASH del documento firmado, todo sellado con un
 *      "acuse" HMAC (integridad de la evidencia).
 *   4) Interfaz de proveedor intercambiable: implementación 'own' (firma
 *      electrónica propia con acuse, sin dependencias externas) + stub de
 *      proveedor EXTERNO (p.ej. un prestador de servicios de certificación /
 *      firma avanzada) que se activa por credenciales — HOY solo interfaz.
 *
 * MOCK-SAFE (convención #2/#7 del repo):
 *   - La implementación 'own' funciona SIN credenciales externas (firma propia).
 *   - El proveedor 'external' sin credenciales devuelve { isMock:true } y NUNCA
 *     ejecuta red ni lanza.
 *   - Sin secreto de acuse en producción, la firma se marca { signed:false } en
 *     vez de lanzar — el orquestador decide.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️  CHECKLIST DE VALIDEZ DEL TÍTULO VALOR — PENDIENTE DE REVISIÓN POR ABOGADO.
 *     Este módulo estructura la evidencia técnica, PERO la exigibilidad del
 *     pagaré como título valor y su firma electrónica deben ser validadas por el
 *     abogado ANTES de encender PAGARE_ESIGN_ENABLED. Requisitos a confirmar:
 *
 *     Título valor (Código de Comercio, arts. 619, 621 y 709 C.Co):
 *       [ ] Mención del derecho incorporado ("pagaré incondicionalmente…").
 *       [ ] Promesa INCONDICIONAL de pagar una suma DETERMINADA de dinero.
 *       [ ] Nombre del otorgante (deudor) e identificación.
 *       [ ] Nombre del beneficiario / a la orden (Hotel Estar).
 *       [ ] Fecha y lugar de creación y de pago.
 *       [ ] Firma del otorgante (aquí: firma electrónica + evidencia).
 *       [ ] Indicación de ser "pagaré" en el texto.
 *       [ ] ¿Se otorga con espacios en blanco? → CARTA DE INSTRUCCIONES separada
 *           (art. 622 C.Co) con las instrucciones de llenado. (No implementada.)
 *
 *     Firma electrónica (Ley 527/1999, Decreto 2364/2012):
 *       [ ] Método confiable y apropiado según la operación (art. 7 Ley 527).
 *       [ ] Evidencia que permita identificar al firmante y su consentimiento.
 *       [ ] Integridad del mensaje de datos (hash + acuse).
 *       [ ] Conservación del mensaje de datos y su evidencia (art. 12 Ley 527).
 *       [ ] ¿Se requiere firma DIGITAL certificada (no solo electrónica simple)
 *           para exigibilidad ejecutiva? → decisión del abogado / proveedor externo.
 *
 *     Habeas Data financiero (Ley 1266/2008): el reporte a operadores de
 *     información (DataCredito) requiere base legal + AVISO PREVIO al titular; se
 *     controla en pagare-sign.js (gated DATACREDITO_ENABLED, hoy solo interfaz).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const ACUSE_ALG = 'HMAC-SHA256';
const CONTRACT_VERSION = 'ESTAR-PAGARE-2026-01';
const BENEFICIARIO = {
  nombre: 'Hotel Estar',
  identificacion: 'RNT 276306',
  ciudad: 'Manizales, Caldas — Colombia'
};

/* ── entorno / secretos ──────────────────────────────────────────────────── */

function isDemoMode() {
  if (process.env.PAGARE_DEMO_MODE === 'true') return true;
  return process.env.NETLIFY !== 'true' && process.env.NODE_ENV !== 'production';
}

/* Secreto que sella el ACUSE de la evidencia (integridad/no repudio). Es un
   secreto propio del módulo — NO se reutiliza el de la guest app para mantener
   audiencias de token separadas (mismo criterio que _guest-app.tokenSecret). En
   demo cae a un secreto de desarrollo; en producción sin secreto devuelve ''
   (el llamador marca la firma como no sellada, NUNCA lanza). */
function acuseSecret() {
  const configured = process.env.PAGARE_SIGN_SECRET || '';
  if (configured) return configured;
  if (isDemoMode()) return 'estar-pagare-local-development-secret';
  return '';
}

/* ── hashing / canonicalización ──────────────────────────────────────────── */

function sha256Hex(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/* JSON canónico: claves ordenadas recursivamente para que el hash sea estable
   independientemente del orden de inserción. */
function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k =>
      JSON.stringify(k) + ':' + canonicalJson(value[k])
    ).join(',') + '}';
  }
  return JSON.stringify(value === undefined ? null : value);
}

/* ── número a letras (COP) — la suma en letras es parte del título valor ──── */

const UNIDADES = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
  'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve',
  'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis',
  'veintisiete', 'veintiocho', 'veintinueve'];
const DECENAS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const CENTENAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos',
  'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

/* apócope de 'uno' ante sustantivo: 'uno'→'un', 'veintiuno'→'veintiún',
   'treinta y uno'→'treinta y un', 'ciento uno'→'ciento un'. En el pagaré cada
   grupo va seguido de un sustantivo (mil / millones / pesos) y el español exige
   la forma apocopada ("veintiún mil pesos", no "veintiuno mil pesos"). Puro. */
function apocopar(text) {
  if (/veintiuno$/.test(text)) return text.replace(/veintiuno$/, 'veintiún');
  if (/(?:^|\s)uno$/.test(text)) return text.replace(/uno$/, 'un');
  return text;
}

function tresCifras(n) {
  if (n === 0) return '';
  if (n === 100) return 'cien';
  let out = '';
  const c = Math.floor(n / 100);
  const resto = n % 100;
  if (c > 0) out += CENTENAS[c] + (resto ? ' ' : '');
  if (resto > 0) {
    if (resto < 30) out += UNIDADES[resto];
    else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      out += DECENAS[d] + (u ? ' y ' + UNIDADES[u] : '');
    }
  }
  return out.trim();
}

/* hasta999999(n) -> letras para 0..999.999 (bloque de "miles" + "cientos").
   Puro. Se usa como pieza reutilizable para CADA grupo de tres cifras superior
   (millones, billones), de modo que un grupo >= 1000 (p.ej. 1234 millones) se
   descompone con la lógica completa en vez de romper tresCifras (que solo maneja
   hasta 999 e indexaría CENTENAS fuera de rango devolviendo 'undefined'). */
function hasta999999(n) {
  const miles = Math.floor(n / 1000);
  const cientos = n % 1000;
  const partes = [];
  if (miles > 0) {
    partes.push(miles === 1 ? 'mil' : apocopar(tresCifras(miles)) + ' mil');
  }
  if (cientos > 0) partes.push(tresCifras(cientos));
  return partes.join(' ');
}

/* montoEnLetras(1234567) -> 'un millón doscientos treinta y cuatro mil quinientos
   sesenta y siete'. Puro y determinista. Solo enteros no negativos (COP sin
   centavos). Para pagaré se envuelve con moneda: `${letras} pesos m/cte`.
   Maneja correctamente montos >= 1.000.000.000 (mil millones) y hasta el rango
   de billones (10^12) — la suma en letras es texto legalmente vinculante del
   título valor, así que NUNCA debe salir corrupta. */
function montoEnLetras(amount) {
  let n = Math.floor(Math.abs(Number(amount) || 0));
  if (n === 0) return 'cero';
  const billones = Math.floor(n / 1e12);
  const millones = Math.floor((n % 1e12) / 1e6);
  const resto = n % 1e6;
  const partes = [];
  if (billones > 0) {
    partes.push(billones === 1 ? 'un billón' : apocopar(hasta999999(billones)) + ' billones');
  }
  if (millones > 0) {
    partes.push(millones === 1 ? 'un millón' : apocopar(hasta999999(millones)) + ' millones');
  }
  if (resto > 0) partes.push(hasta999999(resto));
  /* Cardinal estándar (sin apócope final): 'uno', 'veintiuno'. La apócope ante el
     sustantivo "pesos" la aplica el llamador con apocopar() al envolver la moneda,
     porque depende de la palabra que sigue. Internamente los grupos mil/millones sí
     van apocopados ("veintiún mil") porque su sustantivo es fijo. */
  return partes.join(' ').replace(/\s+/g, ' ').trim();
}

/* ── intereses: TECHO DURO en la tasa de usura (convención #13) ───────────── */

/* capRate(requested, usura) -> min(requested, usura). En Colombia la usura
   (Art. 884 C.Co, Art. 305 C.P.) aplica POR IGUAL al interés remuneratorio/
   corriente y al moratorio: pactar CUALQUIERA de ellos por encima de la usura es
   delito y torna la cláusula inexigible. Este helper impone el mismo techo a AMBOS
   intereses. La usura se lee de config por el llamador (jamás hardcodeada por
   encima). Puro. Ambas tasas como número anual efectivo (%). */
function capRate(requested, usura) {
  const r = Number(requested);
  const u = Number(usura);
  if (!Number.isFinite(u) || u <= 0) return 0;            /* sin usura válida → sin interés exigible */
  if (!Number.isFinite(r) || r <= 0) return 0;
  return Math.min(r, u);
}

/* Alias retrocompatible: el techo de mora es el MISMO techo de usura que el
   corriente (delega en capRate). Se conserva el nombre por compatibilidad de la
   API pública exportada. */
function capMoraRate(requested, usura) {
  return capRate(requested, usura);
}

/* ── construcción del contenido del pagaré (mención del derecho) ──────────── */

function nowIso(deps = {}) {
  return (deps.now ? new Date(deps.now) : new Date()).toISOString();
}

/* buildPagareData(input, deps?) -> objeto normalizado del título valor. Puro
   (salvo el reloj inyectable). NO genera identificadores aleatorios aquí para que
   el hash del contenido sea reproducible; el pagareId lo asigna el orquestador y
   se pasa dentro de input. */
function buildPagareData(input = {}, deps = {}) {
  const monto = Math.max(0, Math.floor(Number(input.monto) || 0));
  const moneda = String(input.moneda || 'COP');
  const usura = Number(input.tasaUsura) || 0;
  const moraSolicitada = Number(input.interesMora) || 0;
  return {
    tipo: 'PAGARE',
    contractVersion: CONTRACT_VERSION,
    pagareId: String(input.pagareId || ''),
    bookingCode: String(input.bookingCode || ''),
    lugarCreacion: String(input.lugarCreacion || 'Manizales, Caldas — Colombia'),
    fechaCreacion: String(input.fechaCreacion || nowIso(deps)),
    otorgante: {
      nombre: String(input.deudorNombre || '').trim(),
      tipoDocumento: String(input.deudorTipoDocumento || '').trim(),
      documento: String(input.deudorDocumento || '').trim(),
      direccion: String(input.deudorDireccion || '').trim(),
      email: String(input.deudorEmail || '').trim()
    },
    beneficiario: { ...BENEFICIARIO },
    monto,
    montoEnLetras: apocopar(montoEnLetras(monto)) + (moneda === 'COP' ? ' pesos moneda corriente' : ` ${moneda}`),
    moneda,
    /* AMBOS intereses (corriente/remuneratorio y mora) con el MISMO techo de
       usura (convención #13; Art. 884 C.Co, Art. 305 C.P.). Un corriente > usura
       es delito de usura y torna el título inexigible, así que se capa aquí de
       forma autoritativa aunque el llamador (pagare-sign.js) pase el valor crudo. */
    interesCorriente: capRate(Number(input.interesCorriente) || 0, usura),
    interesMora: capRate(moraSolicitada, usura),
    tasaUsuraReferencia: usura,
    lugarPago: String(input.lugarPago || 'Manizales, Caldas — Colombia'),
    fechaVencimiento: String(input.fechaVencimiento || ''),
    /* Cláusula incondicional (mención del derecho, art. 621 C.Co). */
    clausula:
      `Yo, ${String(input.deudorNombre || '________')}, identificado como aparece al pie de mi firma, ` +
      `pagaré INCONDICIONALMENTE y a la orden de ${BENEFICIARIO.nombre} (${BENEFICIARIO.identificacion}), ` +
      `en ${String(input.lugarPago || 'Manizales')}, la suma de ${apocopar(montoEnLetras(monto))} ` +
      `${moneda === 'COP' ? 'pesos moneda corriente' : moneda} ($${monto.toLocaleString('es-CO')} ${moneda}). ` +
      `En caso de mora reconoceré intereses moratorios a la tasa máxima legal permitida sin exceder la tasa de usura vigente.`
  };
}

/* Texto canónico del pagaré (los TÉRMINOS legales, sin metadatos volátiles de
   render). Su hash es la huella del "mensaje de datos" que se firma (integridad,
   art. 8 Ley 527) — determinista y verificable. */
function canonicalPagareText(data) {
  const legal = {
    tipo: data.tipo,
    contractVersion: data.contractVersion,
    pagareId: data.pagareId,
    bookingCode: data.bookingCode,
    lugarCreacion: data.lugarCreacion,
    fechaCreacion: data.fechaCreacion,
    otorgante: data.otorgante,
    beneficiario: data.beneficiario,
    monto: data.monto,
    montoEnLetras: data.montoEnLetras,
    moneda: data.moneda,
    interesCorriente: data.interesCorriente,
    interesMora: data.interesMora,
    lugarPago: data.lugarPago,
    fechaVencimiento: data.fechaVencimiento,
    clausula: data.clausula
  };
  return canonicalJson(legal);
}

function contentHash(data) {
  return sha256Hex(canonicalPagareText(data));
}

/* ── evidencia Ley 527 + acuse (integridad de la evidencia) ──────────────── */

/* buildEvidence({...}) -> objeto de evidencia COMPLETO (sin acuse aún). Puro.
   Campos exigidos por la fiabilidad de la firma electrónica: consentimiento
   explícito, marca de tiempo, IP/canal/user-agent, identidad del firmante y hash
   del documento firmado. */
function buildEvidence(params = {}) {
  const consent = params.consent || {};
  const signer = params.signer || {};
  return {
    alg: ACUSE_ALG,
    documentHash: String(params.documentHash || ''),
    documentVersion: String(params.documentVersion || CONTRACT_VERSION),
    timestamp: String(params.at || new Date().toISOString()),
    consent: {
      accepted: Boolean(consent.accepted),
      text: String(consent.text || ''),
      /* momento en que el titular aceptó (puede diferir del timestamp de firma) */
      acceptedAt: String(consent.acceptedAt || params.at || new Date().toISOString())
    },
    channel: String(params.channel || 'web'),
    ip: String(params.ip || ''),
    userAgent: String(params.userAgent || ''),
    signer: {
      nombre: String(signer.nombre || ''),
      documento: String(signer.documento || ''),
      email: String(signer.email || ''),
      sessionRef: String(signer.sessionRef || '')
    }
  };
}

/* Devuelve true si la evidencia tiene TODO lo mínimo requerido para ser fiable. */
function evidenceIsComplete(evidence) {
  if (!evidence || typeof evidence !== 'object') return false;
  const c = evidence.consent || {};
  return Boolean(
    evidence.documentHash &&
    evidence.timestamp &&
    c.accepted === true &&
    c.text &&
    (evidence.signer && (evidence.signer.nombre || evidence.signer.documento))
  );
}

/* Sella la evidencia con HMAC (acuse de recibo / integridad). Devuelve
   { acuse, alg, sealed } donde sealed=false si no hay secreto (prod sin config).
   NUNCA lanza. */
function signEvidence(evidence, deps = {}) {
  const secret = deps.secret !== undefined ? deps.secret : acuseSecret();
  const payload = canonicalJson(evidence);
  if (!secret) return { acuse: null, alg: ACUSE_ALG, sealed: false };
  const acuse = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return { acuse, alg: ACUSE_ALG, sealed: true };
}

/* Verifica que el acuse corresponde a la evidencia (timing-safe). NUNCA lanza. */
function verifyEvidence(evidence, acuse, deps = {}) {
  const secret = deps.secret !== undefined ? deps.secret : acuseSecret();
  if (!secret || !acuse) return false;
  const expected = crypto.createHmac('sha256', secret).update(canonicalJson(evidence)).digest('hex');
  const a = Buffer.from(String(acuse));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch (e) { return false; }
}

/* ── render PDF (reusa pdfkit, patrón de _pdf-render.js) ──────────────────── */

const OLIVE = '#9b9065';
const INK = '#1f1f1f';
const MUTED = '#555555';
const BORDER = '#e1ddca';
const MARGIN = 50;

function formatMoney(amount, moneda = 'COP') {
  const num = Number(amount);
  if (Number.isNaN(num)) return String(amount);
  try {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: moneda, maximumFractionDigits: 0 }).format(num);
  } catch { return `${moneda} ${num.toLocaleString('es-CO')}`; }
}

/* renderPagarePDF(data) -> Promise<Buffer>. Mock-safe: si pdfkit no cargara,
   cae a un Buffer de texto plano determinista (nunca lanza hacia afuera). */
function renderPagarePDF(data = {}) {
  return new Promise(resolve => {
    let PDFDocument;
    try { PDFDocument = require('pdfkit'); } catch (e) { PDFDocument = null; }
    if (!PDFDocument) {
      resolve(Buffer.from(canonicalPagareText(data), 'utf8'));
      return;
    }
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
        info: { Title: `Pagaré ${data.pagareId || ''}`, Author: 'Hotel Estar', Subject: 'Pagaré (título valor)' }
      });
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', () => resolve(Buffer.from(canonicalPagareText(data), 'utf8')));

      const contentW = doc.page.width - MARGIN * 2;
      doc.font('Helvetica-Bold').fontSize(20).fillColor(OLIVE).text('Hotel Estar', MARGIN, MARGIN);
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('APARTAESTUDIOS — MANIZALES', MARGIN);
      const metaX = doc.page.width - MARGIN - 180;
      doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text('Pagaré N.º', metaX, MARGIN, { width: 180, align: 'right' });
      doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(String(data.pagareId || '—'), metaX, doc.y, { width: 180, align: 'right' });
      doc.font('Helvetica').fontSize(8).fillColor(MUTED)
        .text(`Versión: ${data.contractVersion || CONTRACT_VERSION}`, metaX, doc.y, { width: 180, align: 'right' });

      const lineY = Math.max(doc.y, MARGIN + 40) + 8;
      doc.moveTo(MARGIN, lineY).lineTo(doc.page.width - MARGIN, lineY).strokeColor(OLIVE).lineWidth(1.5).stroke();
      doc.y = lineY + 14;

      doc.font('Helvetica-Bold').fontSize(16).fillColor(INK)
        .text('PAGARÉ', MARGIN, doc.y, { width: contentW, align: 'center' });
      doc.y += 6;
      doc.font('Helvetica').fontSize(8).fillColor(MUTED)
        .text(`Lugar y fecha de creación: ${data.lugarCreacion || '—'} · ${data.fechaCreacion || '—'}`,
          MARGIN, doc.y, { width: contentW, align: 'center' });
      doc.y += 14;

      doc.font('Helvetica').fontSize(10).fillColor(INK)
        .text(String(data.clausula || ''), MARGIN, doc.y, { width: contentW, align: 'justify' });
      doc.y += 12;

      const kv = (label, value) => {
        const y = doc.y;
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(MUTED).text(label, MARGIN, y, { width: 170 });
        doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(String(value == null || value === '' ? '—' : value), MARGIN + 178, y, { width: contentW - 178 });
        doc.y = Math.max(doc.y, y) + 3;
      };
      const ot = data.otorgante || {};
      kv('Otorgante (deudor)', ot.nombre);
      kv('Documento', `${ot.tipoDocumento || ''} ${ot.documento || ''}`.trim());
      kv('Beneficiario (a la orden)', `${(data.beneficiario || {}).nombre || ''} — ${(data.beneficiario || {}).identificacion || ''}`);
      kv('Valor (números)', formatMoney(data.monto, data.moneda));
      kv('Valor (letras)', data.montoEnLetras);
      kv('Interés corriente (E.A.)', data.interesCorriente ? `${data.interesCorriente}%` : '—');
      kv('Interés de mora (E.A., ≤ usura)', data.interesMora ? `${data.interesMora}%` : '—');
      kv('Lugar de pago', data.lugarPago);
      kv('Vencimiento', data.fechaVencimiento);

      doc.y += 30;
      const sigLineY = doc.y + 20;
      doc.moveTo(MARGIN, sigLineY).lineTo(MARGIN + 240, sigLineY).strokeColor(INK).lineWidth(0.5).stroke();
      doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(ot.nombre || 'Otorgante', MARGIN, sigLineY + 5, { width: 240 });
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(`${ot.tipoDocumento || 'C.C.'} ${ot.documento || ''}`.trim(), MARGIN, doc.y, { width: 240 });
      doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(MUTED)
        .text('Firmado electrónicamente (Ley 527 de 1999). La evidencia de firma y su acuse se conservan por separado.', MARGIN, doc.y + 6, { width: contentW });

      doc.end();
    } catch (e) {
      resolve(Buffer.from(canonicalPagareText(data), 'utf8'));
    }
  });
}

/* ── proveedores intercambiables ─────────────────────────────────────────── */

/* Proveedor 'own': firma electrónica propia con acuse HMAC. Autónomo, sin red. */
const ownProvider = {
  name: 'own',
  isConfigured() { return true; },

  /* createDocument(input, deps?) -> genera el pagaré + su hash de contenido.
     Devuelve también el PDF (buffer). NUNCA lanza. */
  async createDocument(input = {}, deps = {}) {
    try {
      const data = buildPagareData(input, deps);
      const pdf = await renderPagarePDF(data);
      return {
        provider: 'own',
        isMock: false,
        documentId: data.pagareId,
        data,
        documentHash: contentHash(data),          /* huella de los TÉRMINOS (determinista) */
        canonicalText: canonicalPagareText(data),
        pdf,                                       /* Buffer del render */
        pdfHash: sha256Hex(pdf),                   /* huella del archivo renderizado */
        createdAt: nowIso(deps)
      };
    } catch (e) {
      return { provider: 'own', isMock: false, error: e.message, documentId: input.pagareId || '' };
    }
  },

  /* captureSignature({ document, consent, signer, ip, channel, userAgent, at }, deps?)
     -> captura firma + evidencia sellada. Requiere consentimiento aceptado; si no,
     devuelve { signed:false, reason:'no-consent' } (no lanza). */
  async captureSignature(params = {}, deps = {}) {
    const doc = params.document || {};
    const consent = params.consent || {};
    if (!consent.accepted) {
      return { signed: false, provider: 'own', reason: 'no-consent' };
    }
    const evidence = buildEvidence({
      documentHash: doc.documentHash,
      documentVersion: (doc.data && doc.data.contractVersion) || CONTRACT_VERSION,
      at: params.at || nowIso(deps),
      consent,
      channel: params.channel,
      ip: params.ip,
      userAgent: params.userAgent,
      signer: params.signer
    });
    if (!evidenceIsComplete(evidence)) {
      return { signed: false, provider: 'own', reason: 'incomplete-evidence', evidence };
    }
    const sealed = signEvidence(evidence, deps);
    return {
      signed: true,
      provider: 'own',
      signatureId: 'sig_' + sha256Hex(`${doc.documentId || ''}|${evidence.timestamp}|${evidence.documentHash}`).slice(0, 24),
      evidence,
      acuse: sealed.acuse,
      acuseAlg: sealed.alg,
      acuseSealed: sealed.sealed          /* false en prod sin PAGARE_SIGN_SECRET */
    };
  }
};

/* Proveedor 'external' (STUB intercambiable): un prestador externo de firma /
   certificación. HOY solo interfaz — sin credenciales devuelve { isMock:true } y
   nunca ejecuta red. Cuando se implemente, respetar la MISMA firma que ownProvider
   para que sea drop-in. */
function externalConfigured() {
  return Boolean(process.env.PAGARE_PROVIDER_API_KEY && process.env.PAGARE_PROVIDER_URL);
}
const externalProvider = {
  name: 'external',
  isConfigured() { return externalConfigured(); },
  async createDocument(input = {}) {
    if (!externalConfigured()) {
      return { provider: 'external', isMock: true, reason: 'no-creds', documentId: input.pagareId || '' };
    }
    /* Interfaz solamente: aquí iría la llamada al prestador externo (crear sobre
       de firma). No implementada — se devuelve mock para no lanzar. */
    return { provider: 'external', isMock: true, reason: 'not-implemented', documentId: input.pagareId || '' };
  },
  async captureSignature() {
    if (!externalConfigured()) {
      return { signed: false, provider: 'external', isMock: true, reason: 'no-creds' };
    }
    return { signed: false, provider: 'external', isMock: true, reason: 'not-implemented' };
  }
};

const PROVIDERS = { own: ownProvider, external: externalProvider };

/* getProvider(name) -> proveedor. Default 'own'. Nombre desconocido → 'own'
   (nunca lanza; el 'own' siempre funciona sin credenciales externas). */
function getProvider(name) {
  const key = String(name || 'own').toLowerCase();
  return PROVIDERS[key] || ownProvider;
}

module.exports = {
  CONTRACT_VERSION,
  BENEFICIARIO,
  /* proveedores */
  getProvider,
  ownProvider,
  externalProvider,
  /* construcción / render */
  buildPagareData,
  canonicalPagareText,
  contentHash,
  renderPagarePDF,
  /* evidencia / firma */
  buildEvidence,
  evidenceIsComplete,
  signEvidence,
  verifyEvidence,
  /* utilidades puras */
  sha256Hex,
  canonicalJson,
  montoEnLetras,
  apocopar,
  capRate,
  capMoraRate,
  isDemoMode
};
