require('./_env');
const crypto = require('crypto');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limit');
const {
  corsHeaders,
  json,
  parseJsonBody
} = require('./_guest-app');
const { requirePortalSession } = require('./portal-session');
const { flag, get } = require('./_settings');
const pagare = require('./_pagare');
const vault = require('./_crypto-vault');

/*
 * pagare-sign.js — Orquesta la firma electrónica de un PAGARÉ (título valor):
 *   1) Autentica al firmante con la sesión propia (self-signed, patrón
 *      guest-session — NO expone credenciales OTASync/Odoo al cliente, regla #8).
 *   2) Construye el pagaré + hash, captura la firma y la EVIDENCIA Ley 527 vía el
 *      proveedor intercambiable (_pagare.getProvider).
 *   3) Cifra la evidencia (dato financiero, Ley 1266 — regla #11) con _crypto-vault
 *      (seal/open, AAD = `${pagareId}|pagare`) y la guarda en Blobs ('pagares').
 *   4) Punto de integración con DataCredito — gated DATACREDITO_ENABLED, SOLO
 *      interfaz, sin envío real.
 *
 * GATED OFF (regla #7): sin PAGARE_ESIGN_ENABLED la función responde INERTE y no
 * genera ni firma nada. MOCK-SAFE: sin Blobs/secretos no lanza; degrada.
 *
 * ⚠️  El clausulado, la exigibilidad del título valor y la validez de la firma
 *     electrónica están PENDIENTES DE REVISIÓN POR ABOGADO (ver checklist en
 *     _pagare.js). No encender en producción sin ese visto bueno.
 */

/* ── store cifrado ('pagares') ────────────────────────────────────────────── */

function pagareStore() {
  const { getStore } = require('@netlify/blobs');
  const opts = { name: 'pagares', consistency: 'strong' };
  const siteID = process.env.BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) { opts.siteID = siteID; opts.token = token; }
  return getStore(opts);
}

/* AAD ata el sobre cifrado a su pagaré: no puede "moverse" a otro registro. */
function pagareAad(pagareId) { return `${pagareId || ''}|pagare`; }

/* Persiste el expediente del pagaré cifrado en reposo. Metadatos NO sensibles en
   claro para indexar (id/booking/estado/hash/proveedor); la evidencia y los datos
   del deudor van dentro del sobre. Best-effort: devuelve {stored, encrypted}. */
async function persistPagare(record, deps = {}) {
  const store = deps.store || pagareStore();
  const aad = pagareAad(record.pagareId);
  let blob;
  if (vault.isConfigured()) {
    const env = vault.sealJSON(record, aad);
    blob = {
      encrypted: true, v: 2, kid: env.kid, algorithm: env.alg,
      pagareId: record.pagareId, bookingCode: record.bookingCode,
      status: record.status, provider: record.provider,
      documentHash: record.documentHash, createdAt: record.createdAt,
      iv: env.iv, tag: env.tag, ct: env.ct
    };
  } else if (pagare.isDemoMode()) {
    blob = { encrypted: false, ...record };   /* local sin clave: mock, sin cifrar */
  } else {
    const e = new Error('GUEST_APP_DATA_ENCRYPTION_KEY is not configured');
    e.statusCode = 503;
    throw e;
  }
  await store.set(record.pagareId, JSON.stringify(blob));
  return { stored: true, encrypted: Boolean(blob.encrypted) };
}

/* ── DataCredito: SOLO interfaz, sin envío real (gated DATACREDITO_ENABLED) ── */

/*
 * reportToDataCredito(record, deps?) -> { reported:false, ... }.
 *
 * Punto de integración con el operador de información financiera (DataCrédito /
 * TransUnion). HOY es SOLO interfaz: NUNCA envía nada. Deja el andamiaje para el
 * reporte y, sobre todo, deja explícitos los requisitos legales.
 *
 * ⚠️  Habeas Data financiero (Ley 1266 de 2008): reportar a un operador exige
 *     (a) base legal / obligación clara, expresa y exigible; (b) AVISO PREVIO al
 *     titular con al menos 20 días de antelación al reporte negativo; (c) registro
 *     del consentimiento. La DECISIÓN de reportar es SIEMPRE de un humano con
 *     permiso (p.ej. credito.aprobar / tesorería); este módulo jamás reporta solo.
 */
async function reportToDataCredito(record, deps = {}) {
  const isOn = deps.flag ? await deps.flag('DATACREDITO_ENABLED') : await flag('DATACREDITO_ENABLED');
  if (!isOn) return { reported: false, reason: 'disabled' };
  const configured = Boolean(process.env.DATACREDITO_API_URL && process.env.DATACREDITO_API_KEY);
  if (!configured) return { reported: false, reason: 'mock', isMock: true };
  /* Interfaz solamente: aquí se construiría el payload y se entregaría al operador
     TRAS el aviso previo y con aprobación humana. No implementado a propósito. */
  return { reported: false, reason: 'not-implemented', isMock: true, pagareId: record.pagareId };
}

/* ── helpers de request ───────────────────────────────────────────────────── */

function clientIp(event) {
  const h = event.headers || {};
  const xff = h['x-forwarded-for'] || h['X-Forwarded-For'] || '';
  if (xff) return String(xff).split(',')[0].trim();
  return String(h['client-ip'] || h['x-nf-client-connection-ip'] || '').trim();
}

function newPagareId() {
  return 'PAG-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' +
    crypto.randomBytes(4).toString('hex').toUpperCase();
}

/* ── handler ──────────────────────────────────────────────────────────────── */

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  /* GATE: apagado por defecto → respuesta inerte, sin efecto alguno. */
  if (!(await flag('PAGARE_ESIGN_ENABLED'))) {
    return json(200, { ok: false, disabled: true, reason: 'feature-disabled' });
  }

  const limited = await checkRateLimit(event, {
    name: 'pagare-sign', limit: 6, windowMs: 10 * 60 * 1000
  });
  if (!limited.ok) return rateLimitResponse(corsHeaders(), limited.retryAfter);

  try {
    /* Identidad del firmante: sesión propia del PORTAL, firmada (self-signed,
       audiencia PORTAL_SESSION_SECRET — regla #8, no expone credenciales). El
       residente porta un token de portal, no de guest-app: las audiencias deben
       coincidir para que pueda firmar su pagaré desde el portal. */
    const session = requirePortalSession(event);
    if (session.profile !== 'residente') {
      return json(403, { error: 'La firma de pagaré es solo para residentes.' });
    }

    const body = parseJsonBody(event, 20000);
    const consent = body.consent || {};
    if (!consent.accepted || !String(consent.text || '').trim()) {
      return json(422, { error: 'Debes aceptar y firmar el pagaré para continuar.' });
    }

    /* Título valor (arts. 621/709 C.Co): un pagaré exige una SUMA DETERMINADA de
       dinero y una fecha de vencimiento. No firmamos con monto<=0 ni vencimiento
       en blanco: un pagaré con espacios en blanco (art. 622 C.Co) requeriría una
       CARTA DE INSTRUCCIONES separada que este flujo NO genera (checklist en
       _pagare.js la marca como pendiente). Bloque pendiente de ABOGADO. */
    const monto = Number(body.monto);
    if (!Number.isFinite(monto) || monto <= 0) {
      return json(422, {
        error: 'El pagaré debe expresar una suma determinada de dinero mayor a cero.'
      });
    }
    const fechaVencimiento = String(body.fechaVencimiento || '').trim().slice(0, 40);
    if (!fechaVencimiento) {
      return json(422, {
        error: 'El pagaré debe indicar la fecha de vencimiento.'
      });
    }

    const usura = Number(await get('TASA_USURA_ANUAL', '', {})) || 0;
    const pagareId = newPagareId();
    const providerName = await get('PAGARE_PROVIDER', 'own', {});
    const provider = pagare.getProvider(providerName);
    const bookingCode = String(session.reservation || session.bookingCode || '').slice(0, 80);

    /* Datos del pagaré. El nombre/documento del deudor se toman del cuerpo pero la
       referencia de reserva y el nombre confiable vienen de la sesión firmada. */
    const input = {
      pagareId,
      bookingCode,
      deudorNombre: String(body.deudorNombre || session.name || '').slice(0, 160),
      deudorTipoDocumento: String(body.deudorTipoDocumento || '').slice(0, 20),
      deudorDocumento: String(body.deudorDocumento || '').slice(0, 40),
      deudorDireccion: String(body.deudorDireccion || '').slice(0, 200),
      deudorEmail: String(body.deudorEmail || '').slice(0, 160),
      monto,
      moneda: body.moneda || 'COP',
      interesCorriente: body.interesCorriente,
      interesMora: body.interesMora,
      tasaUsura: usura,
      fechaVencimiento,
      lugarPago: body.lugarPago,
      lugarCreacion: body.lugarCreacion
    };

    const document = await provider.createDocument(input);
    if (!document || document.isMock || document.error || !document.documentHash) {
      return json(503, {
        error: 'El proveedor de firma no está disponible.',
        reason: (document && (document.reason || document.error)) || 'no-document'
      });
    }

    const signature = await provider.captureSignature({
      document,
      consent: {
        accepted: true,
        text: String(consent.text).slice(0, 4000),
        acceptedAt: consent.acceptedAt
      },
      channel: String(body.channel || 'web').slice(0, 40),
      ip: clientIp(event),
      userAgent: String((event.headers || {})['user-agent'] || '').slice(0, 400),
      signer: {
        nombre: input.deudorNombre,
        documento: input.deudorDocumento,
        email: input.deudorEmail,
        sessionRef: session.sub || ''
      }
    });

    if (!signature || !signature.signed) {
      return json(422, {
        error: 'No fue posible registrar la firma.',
        reason: (signature && signature.reason) || 'not-signed'
      });
    }

    const record = {
      pagareId,
      type: 'pagare',
      bookingCode: input.bookingCode,
      status: 'signed',
      provider: signature.provider,
      documentHash: document.documentHash,
      pdfHash: document.pdfHash || null,
      data: document.data,
      signatureId: signature.signatureId,
      evidence: signature.evidence,
      acuse: signature.acuse,
      acuseAlg: signature.acuseAlg,
      acuseSealed: signature.acuseSealed,
      createdAt: document.createdAt || new Date().toISOString()
    };

    /* Persistencia cifrada (best-effort: si Blobs no está disponible en local,
       no rompemos la firma; se reporta persisted:false). */
    let persisted = { stored: false };
    try {
      persisted = await persistPagare(record);
    } catch (e) {
      if (e.statusCode === 503 && !pagare.isDemoMode()) throw e; /* prod sin clave: falla fuerte */
      console.error('[pagare-sign] persist', e.message);
    }

    /* DataCredito — solo interfaz, gated (nunca envía). */
    const dataCredito = await reportToDataCredito(record);

    return json(201, {
      ok: true,
      pagareId,
      documentHash: record.documentHash,
      signatureId: record.signatureId,
      signedAt: record.evidence.timestamp,
      acuseSealed: Boolean(record.acuseSealed),
      persisted: persisted.stored,
      encrypted: Boolean(persisted.encrypted),
      evidenceSummary: {
        consentAccepted: record.evidence.consent.accepted,
        channel: record.evidence.channel,
        hasIp: Boolean(record.evidence.ip),
        documentHash: record.evidence.documentHash
      },
      dataCredito
    });
  } catch (error) {
    console.error('[pagare-sign]', error.message);
    return json(error.statusCode || 500, {
      error: error.statusCode ? error.message : 'No fue posible firmar el pagaré.'
    });
  }
};

/* Exportado para tests de lógica pura (no I/O real). */
exports._internal = { reportToDataCredito, pagareAad, newPagareId, clientIp, persistPagare };
