/* credit-enroll.js — Alta de una solicitud de crédito (portal Estar).
 *
 * Flujo (POST /api/credit-enroll):
 *   1) Feature gate: CREDIT_ENABLED (OFF por defecto → respuesta inerte).
 *   2) Rate limit + sesión del portal (token propio firmado, patrón guest-session;
 *      NO expone credenciales OTASync/Odoo al cliente — convención #8).
 *   3) Consentimiento Ley 1266 EXPLÍCITO y REGISTRADO (canal + timestamp servidor).
 *      Sin consentimiento aceptado no se consulta ni almacena nada financiero.
 *   4) Guarda los PDFs (extractos + DataCredito) CIFRADOS en reposo con
 *      _crypto-vault.seal (AAD atada a la solicitud) — convención #11.
 *   5) Corre el análisis: la IA EXTRAE señales (separado), el CÓDIGO decide la
 *      RECOMENDACIÓN. La aprobación NO ocurre aquí: la solicitud queda
 *      'pendiente_revision' y la aprueba un humano con `credito.aprobar`
 *      en otra función (convención #12).
 *
 * MOCK-SAFE: sin credenciales de IA usa señales mock; sin Blobs en local no
 * persiste pero no lanza; sin clave de cifrado en prod rechaza (no guarda PII en
 * claro). Nunca lanza al cliente un error sin statusCode.
 *
 * ⚠️ TRANSFERENCIA A TERCERO / TRANSFRONTERIZA (Ley 1266/1581): cuando
 *   CREDIT_ENABLED está ON y hay ANTHROPIC_API_KEY, la extracción de señales
 *   (_credit-analysis.extractCreditSignals) ENVÍA los PDFs financieros
 *   (extractos + DataCrédito) como bloques `document` a la API de Anthropic
 *   (sub-encargado en EE. UU.). Por eso NO se corre esa extracción salvo que se
 *   cumplan DOS condiciones acumulativas: (a) el titular ACEPTÓ explícitamente el
 *   procesamiento por un proveedor externo en el exterior
 *   (`consentimiento.procesamientoExterno`), y (b) la IDENTIDAD de quien sube los
 *   documentos está verificada (la sesión que emitió el consentimiento coincide
 *   con el titular). Si el titular aceptó pero su identidad aún no coincide con la
 *   sesión (`requiereVerificacionIdentidad`), la transferencia queda DIFERIDA: la
 *   solicitud se guarda cifrada en estado pendiente y ningún dato sale del país
 *   hasta que un humano verifique la identidad (Ley 1266 / Ley 1581 art. 26). Sin
 *   aceptación ocurre lo mismo. El aviso de privacidad Ley 1266/1581
 *   (pendiente-abogado) debe declarar este sub-encargado y la base de transferencia.
 *
 * ⚠️ RETENCIÓN / CADUCIDAD (Ley 1266, distinta de la purga Ley 1581 de 5 años):
 *   el dato financiero/crediticio tiene reglas de caducidad propias. Cada
 *   solicitud lleva un bloque `retencion` con la política y el `retenerHasta`
 *   calculado (CREDIT_RETENTION_YEARS, default conservador). El applicationId
 *   embebe el timestamp en ms (CRD-<ms>-...), así una purga programada puede
 *   fecharlo SIN descifrar (mismo patrón que purge-guest-data). El job de purga
 *   de los stores de crédito queda PENDIENTE de cablear y de confirmar plazos
 *   con abogado (ver integrationNotes).
 *
 * Store Blobs: 'credit-applications' (una clave por solicitud).
 */

require('./_env');
const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limit');
const { flag, get } = require('./_settings');
const vault = require('./_crypto-vault');
const {
  corsHeaders,
  json,
  parseJsonBody
} = require('./_guest-app');
const { extractCreditSignals, evaluateCreditRecommendation } = require('./_credit-analysis');
const { requirePortalSession: requireSignedPortalSession } = require('./portal-session');

/* ── Demo mode PROPIO del carril de crédito ────────────────────────────────
   NO reutilizamos _guest-app.isDemoMode: ese honra GUEST_APP_DEMO_MODE, un
   toggle documentado del guest-app que un operador puede activar en producción.
   En un endpoint de PII financiera (Ley 1266) eso sería un foot-gun: abriría
   identidad sin token y permitiría guardar documentos sin cifrar. Aquí demo =
   SOLO desarrollo local real (nunca un deploy Netlify, nunca NODE_ENV=production),
   igual que el isDemoMode de portal-session que falla cerrado en prod. */
function creditDemoMode() {
  return process.env.NETLIFY !== 'true' && process.env.NODE_ENV !== 'production';
}

const STORE_NAME = 'credit-applications';
const MAX_BODY_BYTES = 6 * 1024 * 1024;     // ~6MB: PDFs en base64
const MAX_DOCS = 12;
const MAX_DOC_BYTES = 4 * 1024 * 1024;      // ~4MB por PDF (tamaño decodificado)
const ALLOWED_DOC_KINDS = new Set(['extracto', 'datacredito']);
/* Caducidad del expediente financiero (Ley 1266). Conservador por defecto;
   ajustable sin redeploy vía CREDIT_RETENTION_YEARS. Plazo final = abogado. */
const DEFAULT_CREDIT_RETENTION_YEARS = 5;

/* ── Sesión del portal (token propio firmado, aislado de guest/admin) ──────
   Reutiliza el guard compartido de portal-session para que el modo demo local
   (secreto fijo de desarrollo) y producción verifiquen exactamente igual. */
function requireCreditPortalSession(event) {
  try {
    return requireSignedPortalSession(event);
  } catch (e) {
    if (!creditDemoMode()) throw e;
  }
  // Identidad demo SIN token: exclusiva de desarrollo local real. Falla CERRADO
  // en cualquier deploy Netlify o NODE_ENV=production — nunca se concede acceso a
  // este endpoint de PII financiera sin un token de sesión válido en producción,
  // ni aunque GUEST_APP_DEMO_MODE esté activo.
  return { sub: 'demo-portal', profile: 'residente', demo: true };
}

/* ── Blob store (patrón compartido del repo) ── */
function creditStore() {
  const opts = { name: STORE_NAME, consistency: 'strong' };
  const siteID = process.env.BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) {
    opts.siteID = siteID;
    opts.token = token;
  }
  return getStore(opts);
}

function clean(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function newApplicationId() {
  return `CRD-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

/* Valida y decodifica los PDFs entrantes. Lanza 400 si algo no cuadra. */
function readDocuments(rawDocs) {
  if (!Array.isArray(rawDocs) || rawDocs.length === 0) {
    const e = new Error('Adjunta al menos un documento (extracto o DataCredito).');
    e.statusCode = 400;
    throw e;
  }
  if (rawDocs.length > MAX_DOCS) {
    const e = new Error('Demasiados documentos.');
    e.statusCode = 400;
    throw e;
  }
  const out = [];
  for (const doc of rawDocs) {
    const kind = clean(doc && doc.kind, 24).toLowerCase();
    if (!ALLOWED_DOC_KINDS.has(kind)) {
      const e = new Error('Tipo de documento no soportado.');
      e.statusCode = 400;
      throw e;
    }
    const base64 = String((doc && doc.base64) || '');
    if (!base64) {
      const e = new Error('Documento vacío.');
      e.statusCode = 400;
      throw e;
    }
    const bytes = Buffer.from(base64, 'base64');
    if (!bytes.length || bytes.length > MAX_DOC_BYTES) {
      const e = new Error('Documento inválido o demasiado grande.');
      e.statusCode = 400;
      throw e;
    }
    out.push({
      kind,
      mediaType: clean((doc && doc.mediaType) || 'application/pdf', 80),
      base64,
      bytes,
      size: bytes.length
    });
  }
  return out;
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  // 1) Feature gate PRIMERO — OFF por defecto: respuesta inerte, sin siquiera
  //    tocar el store de rate-limit (convención #7: el flag corta el efecto antes
  //    de cualquier I/O). Nunca lanza.
  let creditEnabled = false;
  try { creditEnabled = await flag('CREDIT_ENABLED'); } catch { creditEnabled = false; }
  if (!creditEnabled) {
    return json(200, { ok: false, enabled: false, message: 'La solicitud de crédito no está habilitada por el momento.' });
  }

  const limited = await checkRateLimit(event, {
    name: 'credit-enroll',
    limit: 5,
    windowMs: 10 * 60 * 1000
  });
  if (!limited.ok) return rateLimitResponse(corsHeaders(), limited.retryAfter);

  try {
    // 2) Sesión del portal (identidad del solicitante; no se confía para decidir).
    const session = requireCreditPortalSession(event);
    if (session.profile !== 'residente') {
      return json(403, { error: 'La solicitud de crédito es solo para residentes.' });
    }

    const body = parseJsonBody(event, MAX_BODY_BYTES);

    // 3) Consentimiento Ley 1266 — explícito, registrado y ATADO A LA IDENTIDAD.
    const consentIn = body.consentimiento || {};
    const aceptado = consentIn.aceptado === true || String(consentIn.aceptado).toLowerCase() === 'true';
    const canal = clean(consentIn.canal, 40);
    if (!aceptado || !canal) {
      return json(400, {
        error: 'Se requiere tu consentimiento explícito (Habeas Data / Ley 1266) para consultar centrales de riesgo y procesar tus documentos financieros.'
      });
    }
    // Aceptación SEPARADA del procesamiento por un proveedor externo en el
    // exterior (Anthropic, EE. UU.) para OCR/extracción. Si NO se acepta, no
    // sale ningún dato del país (la extracción se omite más abajo).
    const procesamientoExternoAceptado =
      consentIn.procesamientoExterno === true ||
      String(consentIn.procesamientoExterno).toLowerCase() === 'true';

    // Datos del solicitante (PII; se cifran junto al resto).
    const applicantIn = body.solicitante || {};
    const applicant = {
      nombre: clean(applicantIn.nombre, 160),
      email: clean(applicantIn.email, 160),
      telefono: clean(applicantIn.telefono, 40),
      tipoDoc: clean(applicantIn.tipoDoc, 20),
      numeroDoc: clean(applicantIn.numeroDoc, 40),
      portalSub: clean(session.sub, 160)
    };

    // Vínculo consentimiento ↔ identidad autenticada (Ley 1266): el consentimiento
    // sólo es prueba válida si lo emite el propio titular. La identidad manda: el
    // emisor real es session.sub, no lo que venga en el cuerpo. Si el email del
    // solicitante no coincide con la sesión, NO rechazamos en seco (el sub del
    // portal puede no ser un email), pero marcamos el expediente para verificación
    // manual por el asesor y lo registramos como prueba de origen.
    const sesionEsDemo = session.demo === true;
    const emailSolicitante = applicant.email.toLowerCase();
    const subSesion = clean(session.sub, 160).toLowerCase();
    const identidadCoincide = sesionEsDemo || (!!emailSolicitante && emailSolicitante === subSesion);
    const requiereVerificacionIdentidad = !identidadCoincide && !sesionEsDemo;

    const consentimiento = {
      aceptado: true,
      canal,                                   // 'web' | 'app' | 'whatsapp' | ...
      titular: clean(consentIn.titular, 160),
      documentoTitular: clean(consentIn.documentoTitular, 40),
      version: clean(consentIn.version, 40) || 'ley-1266-v1',
      // Prueba de origen: quién emitió realmente el consentimiento (identidad de
      // sesión, no el cuerpo) y si el titular declarado coincide con ella.
      emisorSesion: clean(session.sub, 160),
      vinculadoAIdentidad: identidadCoincide,
      // Divulgación + aceptación de la transferencia a tercero en el exterior.
      // La transferencia transfronteriza sólo procede con identidad verificada
      // (Ley 1266 / Ley 1581 art. 26): si el titular aceptó pero su identidad aún
      // no coincide con la sesión, la salida de datos queda DIFERIDA hasta que un
      // humano la verifique — se registra la base para trazabilidad.
      procesamientoExterno: {
        divulgado: true,
        proveedor: 'anthropic',
        ubicacion: 'EEUU',
        finalidad: 'OCR/extracción de señales de documentos financieros',
        aceptado: procesamientoExternoAceptado,
        baseTransferencia: 'consentimiento-expreso-titular (Ley 1581 art. 26 lit. a)',
        identidadVerificada: identidadCoincide,
        transferenciaDiferida: procesamientoExternoAceptado && requiereVerificacionIdentidad
      },
      timestampServidor: new Date().toISOString(),
      timestampCliente: clean(consentIn.timestamp, 40) || null,
      ip: clean((event.headers && (event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for'])) || '', 60),
      userAgent: clean((event.headers && (event.headers['user-agent'] || event.headers['User-Agent'])) || '', 300)
    };
    const montoSolicitado = Math.max(0, Number(body.montoSolicitado) || 0);
    const plazoMeses = Math.max(0, Number(body.plazoMeses) || 0);

    const docs = readDocuments(body.documentos);

    const applicationId = newApplicationId();
    const createdAt = new Date().toISOString();

    // 4) Cifrado en reposo de los PDFs (convención #11). Sin clave configurada:
    //    en prod NO se guarda PII financiera en claro (503); en local/demo se
    //    omiten los bytes y se sigue para poder probar el flujo.
    const vaultReady = vault.isConfigured();
    if (!vaultReady && !creditDemoMode()) {
      return json(503, { error: 'El almacenamiento cifrado no está configurado; no se procesan documentos financieros sin cifrado.' });
    }
    const documentos = docs.map(d => {
      const meta = { kind: d.kind, mediaType: d.mediaType, size: d.size };
      if (vaultReady) {
        meta.envelope = vault.seal(d.bytes, `${applicationId}|credito-${d.kind}`);
      } else {
        meta.omitted = true; // solo demo local sin clave
      }
      return meta;
    });

    // 5) Análisis: IA extrae señales (separado) → el código decide la recomendación.
    //    La extracción envía los PDFs a un tercero en el exterior (Anthropic, EE.
    //    UU.). Sólo se corre si se cumplen DOS condiciones acumulativas:
    //      (a) el titular ACEPTÓ el procesamiento externo, y
    //      (b) la identidad de quien sube los documentos está VERIFICADA — es
    //          decir, la sesión que emitió el consentimiento coincide con el
    //          titular (o es demo local). Si `requiereVerificacionIdentidad`, NO
    //          sacamos PII financiera del país antes de que un humano confirme que
    //          quien sube los documentos es el titular que autorizó su tratamiento
    //          (Ley 1266 / Ley 1581 art. 26). En ese caso diferimos: guardamos el
    //          sobre cifrado en estado pendiente y el asesor correrá la extracción
    //          tras la verificación.
    const externoDiferidoPorIdentidad = procesamientoExternoAceptado && requiereVerificacionIdentidad;
    const puedeProcesarExterno = procesamientoExternoAceptado && !requiereVerificacionIdentidad;
    let signals;
    if (puedeProcesarExterno) {
      signals = await extractCreditSignals(
        { documents: docs.map(d => ({ kind: d.kind, base64: d.base64, mediaType: d.mediaType })) },
        {}
      );
    } else {
      signals = { isMock: true, externoOmitido: true };
    }
    const recomendacion = evaluateCreditRecommendation({ ...signals, montoSolicitado, plazoMeses });

    // Datos confidenciales (PII + financieros) cifrados en un solo sobre.
    const confidentialPayload = {
      applicant,
      montoSolicitado,
      plazoMeses,
      consentimiento,
      analisis: {
        justificacion: recomendacion.justificacion,
        motivos: recomendacion.motivos,
        senales: recomendacion.senales
      }
    };

    // Caducidad del expediente financiero (Ley 1266) — separada de la purga de 5
    // años de Ley 1581. El applicationId embebe el ms para poder fechar sin
    // descifrar; el job de purga de los stores de crédito queda pendiente (abogado).
    const retentionYears = Math.max(1, Number(await get('CREDIT_RETENTION_YEARS', DEFAULT_CREDIT_RETENTION_YEARS)) || DEFAULT_CREDIT_RETENTION_YEARS);
    const retenerHasta = new Date(Date.parse(createdAt) + retentionYears * 365 * 24 * 60 * 60 * 1000).toISOString();

    const record = {
      applicationId,
      estado: 'pendiente_revision',            // la aprobación la hace un humano (credito.aprobar)
      createdAt,
      // Marca para el asesor: identidad del titular aún por verificar (el email
      // declarado no coincide con la sesión que emitió el consentimiento).
      requiereVerificacionIdentidad,
      // Insumos operativos NO sensibles para la cola de revisión:
      recomendacion: recomendacion.recomendacion,
      esRecomendacion: true,
      fuenteSenales: puedeProcesarExterno
        ? (signals.isMock ? 'mock' : 'ia')
        : (externoDiferidoPorIdentidad
            ? 'pendiente_verificacion_identidad'
            : 'pendiente_sin_procesamiento_externo'),
      analisisExternoOmitido: !puedeProcesarExterno,
      // El asesor debe verificar identidad ANTES de correr la extracción externa:
      // el titular aceptó el procesamiento pero su identidad no está confirmada, así
      // que ningún dato salió del país todavía (Ley 1266 / Ley 1581 art. 26).
      externoDiferidoPorIdentidad,
      documentos,                              // envelopes (ciphertext) — seguros de guardar
      consentimientoResumen: {
        canal: consentimiento.canal,
        timestampServidor: consentimiento.timestampServidor,
        version: consentimiento.version,
        emisorSesion: consentimiento.emisorSesion,
        vinculadoAIdentidad: consentimiento.vinculadoAIdentidad,
        procesamientoExternoAceptado,
        transferenciaExternaDiferida: externoDiferidoPorIdentidad
      },
      // Política de retención (Ley 1266). purgaPendiente: aún sin job cableado.
      retencion: { politica: 'ley-1266', years: retentionYears, retenerHasta, purgaPendiente: true },
      // Bloque confidencial cifrado (o null en demo local sin clave):
      confidential: vaultReady ? vault.sealJSON(confidentialPayload, `${applicationId}|credito-solicitud`) : null,
      revision: { decision: null, revisadoPor: null, revisadoEn: null }
    };

    let persisted = false;
    try {
      await creditStore().set(applicationId, JSON.stringify(record));
      persisted = true;
    } catch (e) {
      if (creditDemoMode()) {
        console.warn('[credit-enroll] demo local sin Blobs, no se persistió:', e.message);
      } else {
        throw e;
      }
    }

    // Respuesta al solicitante: NUNCA se filtra la recomendación interna
    // (la decisión la toma un asesor). Solo el acuse.
    return json(201, {
      ok: true,
      applicationId,
      estado: 'pendiente_revision',
      persisted,
      encrypted: vaultReady,
      message: 'Recibimos tu solicitud y tus documentos de forma segura. Un asesor autorizado la revisará y te contactará.'
    });
  } catch (error) {
    console.error('[credit-enroll]', error.message);
    return json(error.statusCode || 500, {
      error: error.statusCode ? error.message : 'No fue posible procesar la solicitud de crédito.'
    });
  }
};
