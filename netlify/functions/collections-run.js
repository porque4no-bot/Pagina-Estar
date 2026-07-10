require('./_env');
const { flag, get } = require('./_settings');
const { authorize } = require('./_authz');
const C = require('./_collections');

/*
 * collections-run.js — orquestador del motor de COBRANZA.
 *
 * GATED OFF por COLLECTIONS_ENABLED (convención #7). Con el flag apagado la
 * función responde INERTE (200 { ran:false, reason:'disabled' }) y NO envía nada.
 *
 * Escalado por edad de mora (derivado en _collections.nextAction):
 *   whatsapp (plantilla PRE-APROBADA en Meta, fuera de la ventana de 24h) →
 *   llamada PSTN (Twilio, número de voz aparte, vía _escalation/_twilio-voice).
 *
 * DECISIÓN DE CUMPLIMIENTO — SIN ROTACIÓN DE NÚMEROS (explícito):
 *   El hotel contacta al deudor SIEMPRE desde UN ÚNICO número identificado por
 *   canal: WhatsApp = el WHATSAPP_PHONE_NUMBER_ID del hotel; voz = el
 *   TWILIO_VOICE_NUMBER dedicado. NO se rota el número de origen para "esquivar"
 *   bloqueos ni para presionar (práctica prohibida). El destino es SIEMPRE el
 *   teléfono del deudor. Un solo número, identificado, con opt-out y horarios.
 *
 * Frenos legales (Ley 1266 + convención #13), aplicados ANTES de contactar:
 *   - PRECONDICIÓN opt-out ENTRANTE cableado (COLLECTIONS_OPTOUT_INGEST_READY):
 *     mientras whatsapp-webhook no escriba STOP/"no contactar" en 'collections-optout',
 *     el contacto queda inerte (reason:'optout-ingest-not-wired') aunque
 *     COLLECTIONS_ENABLED esté encendido — así el deudor puede ejercer el cese.
 *   - opt-out del deudor (store 'collections-optout')
 *   - franja horaria permitida (withinAllowedHours)
 *   - tope de intentos (maxIntentos)
 *   - dedup por etapa/canal (~24h, COLLECTIONS_DEDUP_WINDOW_HOURS) en DOS capas:
 *     (1) lectura del log (ran:false reason:'ya-gestionado-hoy') y (2) marcador
 *     ATÓMICO mark-before-work (store 'collections-locks', set onlyIfNew) que cierra
 *     la carrera de dos invocaciones concurrentes del mismo deudor: la perdedora
 *     responde ran:false reason:'gestion-en-curso' sin re-enviar ni re-cobrar.
 *     UNA gestión por escalón realmente efectuada; el costo fijo nunca se duplica.
 * Gastos de cobranza: se registra la gestión con su MONTO ACUMULATIVO (costo fijo
 * por gestión efectuada, default 0) SOLO si el envío fue realmente efectuado
 * (sent/ok===true). El clausulado del pagaré/cobro queda PENDIENTE DE ABOGADO.
 *
 * Mock-safe: sin credenciales los senders devuelven isMock y no se cobra gestión.
 * Best-effort: nunca lanza fuera del handler; el handler responde 500 genérico.
 */

const LOG_STORE = 'collections-log';
const OPTOUT_STORE = 'collections-optout';
const LOCK_STORE = 'collections-locks';

function corsHeaders() {
  const h = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };
  if (process.env.ALLOWED_ORIGIN && process.env.ALLOWED_ORIGIN !== '*') {
    h['Access-Control-Allow-Origin'] = process.env.ALLOWED_ORIGIN;
  }
  return h;
}

function json(statusCode, body, headers = corsHeaders()) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

/* Blobs helper — mock-safe: sin contexto Blobs devuelve null y el flujo sigue. */
function blobStore(name, deps = {}) {
  if (deps.getStore) return deps.getStore(name);
  try {
    const { getStore } = require('@netlify/blobs');
    const opts = { name, consistency: 'strong' };
    const siteID = process.env.BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
    const token = process.env.BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
    if (siteID && token) { opts.siteID = siteID; opts.token = token; }
    return getStore(opts);
  } catch (e) { return null; }
}

/* Sanea un identificador de deudor para usarlo como prefijo de clave en Blobs. */
function deudorKey(id) {
  return String(id || '').replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 80) || 'anon';
}

/* Lee las gestiones previas registradas para un deudor (para el tope de intentos
   y para acumular los gastos). Nunca lanza; sin store devuelve []. */
async function loadGestiones(store, deudorId) {
  if (!store) return [];
  try {
    const res = await store.list({ prefix: `log/${deudorKey(deudorId)}/` });
    const blobs = (res && res.blobs) || [];
    const rows = await Promise.all(blobs.map(async b => {
      try { const raw = await store.get(b.key); return raw ? JSON.parse(raw) : null; }
      catch (e) { return null; }
    }));
    return rows.filter(Boolean);
  } catch (e) { return []; }
}

/* Registra una gestión (con su monto) en el log de cobranza — la evidencia que
   justifica el gasto itemizado. Best-effort. */
async function recordGestion(store, deudorId, gestion) {
  if (!store) return { saved: false, reason: 'no-store' };
  try {
    const at = gestion.at || new Date().toISOString();
    const key = `log/${deudorKey(deudorId)}/${at}-${Math.random().toString(36).slice(2, 8)}`;
    await store.set(key, JSON.stringify({ ...gestion, at }));
    return { saved: true, key };
  } catch (e) { return { saved: false, reason: 'error' }; }
}

/* Dedup por etapa/canal dentro de una ventana (~24h). Freno de cumplimiento
   (convención #13: UNA gestión por escalón realmente efectuada): evita que un
   doble disparo del endpoint el mismo día (cron que re-dispara, re-run manual o
   reintento del cliente) envíe OTRO WhatsApp/llamada al deudor y sume OTRO costo
   fijo. Solo cuentan gestiones REALMENTE efectuadas (efectuada!==false): un
   intento fallido/mock no contactó ni cobró, así que un reintento legítimo no se
   bloquea. Se compara por etapa O por canal (lo que pida el hallazgo). */
function hasRecentGestion(gestiones, { etapa, canal, now, windowHours } = {}) {
  const hrs = Number(windowHours);
  const windowMs = (Number.isFinite(hrs) && hrs > 0 ? hrs : 24) * 3600 * 1000;
  const nowMs = (now instanceof Date ? now : new Date(now)).getTime();
  if (!Number.isFinite(nowMs)) return false;
  for (const g of Array.isArray(gestiones) ? gestiones : []) {
    if (!g || g.efectuada === false) continue;
    const sameStage = etapa != null && g.etapa === etapa;
    const sameChannel = canal != null && g.tipo === canal;
    if (!sameStage && !sameChannel) continue;
    const t = g.at ? Date.parse(g.at) : NaN;
    if (!Number.isFinite(t)) continue;
    if (nowMs - t < windowMs) return true;
  }
  return false;
}

async function isOptedOut(store, phone, deps = {}) {
  if (deps.optOut != null) return Boolean(deps.optOut);
  if (!store || !phone) return false;
  try { return Boolean(await store.get(`optout/${deudorKey(phone)}`)); }
  catch (e) { return false; }
}

/* Contrato defensivo del write condicional de Blobs (espeja _quote-lock.js):
   set(..., { onlyIfNew: true }) resuelve { modified:false } cuando la clave ya
   existe (NO lanza). Un store polyfilled que lance ante la precondición se mapea
   a "no escrito" en el catch del llamador. */
function wasWritten(writeResult) {
  return !writeResult || writeResult.modified !== false;
}

/* Marcador ATÓMICO anti-doble-cobro / doble-contacto por deudor+etapa+canal+ventana.
   Cierra la carrera que hasRecentGestion (lectura pura, check-then-act) no puede:
   dos invocaciones casi simultáneas del mismo deudor (cron + re-run manual, o
   reintento del cliente) leen ambas el mismo log sin gestión reciente y ambas
   pasarían el dedup de 24h → duplicarían el WhatsApp/llamada y el costo fijo.
   Aquí solo UNA gana el set(onlyIfNew:true) (modified===true); la otra obtiene
   modified===false y NO envía ni cobra. La ventana se bucketiza con el MISMO
   COLLECTIONS_DEDUP_WINDOW_HOURS, así un período nuevo abre marcador nuevo
   (Netlify Blobs no tiene TTL; el bucket temporal hace de expiración). Sin store
   (mock/local sin Blobs) → fail-open, igual que _quote-lock. Nunca lanza. */
async function acquireGestionMarker(store, { deudorId, etapa, canal, now, windowHours } = {}) {
  if (!store) return { acquired: true, blobsUnavailable: true, key: null };
  const hrs = Number(windowHours);
  const windowMs = (Number.isFinite(hrs) && hrs > 0 ? hrs : 24) * 3600 * 1000;
  const nowMs = (now instanceof Date ? now : new Date(now)).getTime();
  const bucket = Number.isFinite(nowMs) ? Math.floor(nowMs / windowMs) : 0;
  const key = `mark/${deudorKey(deudorId)}/${etapa || 'na'}/${canal || 'na'}/${bucket}`;
  const value = JSON.stringify({ at: new Date(Number.isFinite(nowMs) ? nowMs : Date.now()).toISOString(), etapa, canal });
  try {
    const created = wasWritten(await store.set(key, value, { onlyIfNew: true }));
    return { acquired: created, key };
  } catch (e) {
    /* store que lanza ante precondición fallida → la clave ya existía → no adquirido */
    return { acquired: false, key };
  }
}

/* Libera el marcador cuando la gestión NO fue efectiva (mock/fallo de envío), para
   no bloquear un reintento legítimo dentro de la misma ventana. Una gestión SÍ
   efectuada conserva su marcador (ese es el freno anti-doble-contacto). Best-effort. */
async function releaseGestionMarker(store, key) {
  if (!store || !key) return;
  try { await store.delete(key); } catch (e) { /* best-effort */ }
}

/* Lee los costos fijos por gestión desde config (panel → env). Default 0. */
async function loadCostos(deps = {}) {
  const getFn = deps.get || get;
  const num = async (k) => {
    let v = 0;
    try { v = Number(await getFn(k, '0')); } catch (e) { v = 0; }
    return Number.isFinite(v) && v > 0 ? v : 0;
  };
  return {
    whatsapp: await num('COLLECTIONS_COST_WHATSAPP'),
    llamada: await num('COLLECTIONS_COST_LLAMADA'),
    carta: await num('COLLECTIONS_COST_CARTA')
  };
}

/* Núcleo orquestador. Recibe el contexto del deudor y decide/ejecuta UNA gestión.
   deps inyectables para pruebas de integración locales (no cubierto por unit tests). */
async function runCollection(debtor = {}, deps = {}) {
  const flagFn = deps.flag || flag;
  const getFn = deps.get || get;

  if (String(await flagFn('COLLECTIONS_ENABLED')).toLowerCase() !== 'true') {
    return { ran: false, reason: 'disabled' };
  }

  const deudorId = debtor.deudorId || debtor.phone || debtor.bookingCode || 'anon';
  const lang = debtor.lang === 'en' ? 'en' : 'es';
  const logStore = blobStore(LOG_STORE, deps);
  const optoutStore = blobStore(OPTOUT_STORE, deps);
  const lockStore = blobStore(LOCK_STORE, deps);

  const gestiones = await loadGestiones(logStore, deudorId);
  const costos = await loadCostos(deps);
  const optOut = await isOptedOut(optoutStore, debtor.phone, deps);

  const maxIntentos = Number(await getFn('COLLECTIONS_MAX_INTENTOS', '5')) || 5;
  const startHour = Number(await getFn('COLLECTIONS_HOUR_START', '7')) || 7;
  const endHour = Number(await getFn('COLLECTIONS_HOUR_END', '19')) || 19;
  const now = deps.now ? new Date(deps.now) : new Date();
  const withinHours = C.withinAllowedHours(now, { startHour, endHour });

  const decision = C.nextAction({
    diasMora: debtor.diasMora,
    gestiones,
    maxIntentos,
    optOut,
    withinHours
  });

  /* Estado de cartera del deudor (interés de mora con techo de usura) — informativo,
     nunca aplica un cobro por su cuenta; la decisión de cobrar la toma un humano. */
  let mora = null;
  if (debtor.saldoVencido != null) {
    const usura = Number(await getFn('COLLECTIONS_TASA_USURA_MENSUAL', '0'));
    mora = C.computeMoraInterest({
      saldoVencido: debtor.saldoVencido,
      diasMora: debtor.diasMora,
      tasaUsuraMensual: usura,
      tasaPactadaMensual: debtor.tasaPactadaMensual
    });
  }

  const acumuladoPrevio = C.computeCollectionFees(gestiones, costos);

  if (decision.action === 'none') {
    return {
      ran: false, reason: decision.reason, decision, mora,
      gastos: acumuladoPrevio
    };
  }

  /* Marcador de gestión: se adquiere ANTES de enviar y solo se libera si el envío
     no fue efectivo. Debe estar visible en el scope de retorno para poder liberarlo. */
  let marker = { acquired: true, key: null };

  /* Freno anti-doble-cobro / doble-contacto en DOS capas, solo para canales de
     contacto (whatsapp/llamada); la etapa jurídica no contacta ni cobra y ya está
     deduplicada por dedupeKey en su alerta. */
  if (decision.action === 'whatsapp' || decision.action === 'llamada') {
    /* PRECONDICIÓN DE ACTIVACIÓN — derecho de oposición / opt-out (Ley 1266,
       lineamientos SIC): NO se contacta al deudor mientras la captura ENTRANTE del
       opt-out no esté cableada (whatsapp-webhook escribiendo STOP / "no contactar"
       en el store 'collections-optout'). Ese cableado vive en whatsapp-webhook
       (otro dueño, ver integrationNotes); hasta que exista, este health-check
       mantiene el CONTACTO inerte aunque COLLECTIONS_ENABLED esté encendido, para
       no seguir contactando a quien pidió el cese. Se confirma explícitamente con
       COLLECTIONS_OPTOUT_INGEST_READY=true (default OFF, gated). */
    if (String(await flagFn('COLLECTIONS_OPTOUT_INGEST_READY')).toLowerCase() !== 'true') {
      return {
        ran: false, reason: 'optout-ingest-not-wired', decision, mora,
        gastos: acumuladoPrevio
      };
    }

    const dedupWindowHours = Number(await getFn('COLLECTIONS_DEDUP_WINDOW_HOURS', '24')) || 24;

    /* Capa 1 (lectura): dedup rápido por el log de gestiones (~24h). */
    if (hasRecentGestion(gestiones, {
      etapa: decision.etapa, canal: decision.action, now, windowHours: dedupWindowHours
    })) {
      return {
        ran: false, reason: 'ya-gestionado-hoy', decision, mora,
        gastos: acumuladoPrevio
      };
    }

    /* Capa 2 (atómica): mark-before-work. Cierra la carrera check-then-act que la
       lectura no puede: si otra invocación concurrente ya tomó el marcador de este
       deudor+etapa+canal+ventana, esta obtiene acquired:false y responde sin
       re-enviar ni re-cobrar. */
    marker = await acquireGestionMarker(lockStore, {
      deudorId, etapa: decision.etapa, canal: decision.action, now, windowHours: dedupWindowHours
    });
    if (!marker.acquired) {
      return {
        ran: false, reason: 'gestion-en-curso', decision, mora,
        gastos: acumuladoPrevio
      };
    }
  }

  /* Ejecuta la gestión del canal decidido — UN solo número de origen por canal. */
  let sent = false;
  let tipo = null;
  let detail = null;

  if (decision.action === 'whatsapp') {
    tipo = 'whatsapp';
    const wa = deps.whatsapp || require('./_whatsapp');
    /* Fuera de la ventana de 24h SOLO vale una plantilla PRE-APROBADA en Meta. */
    const template = await getFn('COLLECTIONS_WA_TEMPLATE', 'cobranza_recordatorio');
    let r;
    try { r = await wa.sendTemplate(debtor.phone, template, lang, debtor.templateComponents); }
    catch (e) { r = { sent: false, error: (e && e.message) || 'error' }; }
    sent = !!(r && r.sent);
    detail = { provider: 'whatsapp', template, isMock: !!(r && r.isMock) };
  } else if (decision.action === 'llamada') {
    tipo = 'llamada';
    const escalation = deps.escalation || require('./_escalation');
    const message = lang === 'en'
      ? 'This is a payment reminder from Hotel Estar. Please contact us to arrange your balance.'
      : 'Le habla Hotel Estar por un recordatorio de pago. Por favor comuníquese para ponerse al día.';
    let r;
    try {
      r = await escalation.escalate(
        { reason: 'cobranza', summary: message, lang, guestNumber: debtor.phone },
        { targets: [debtor.phone] }
      );
    } catch (e) { r = { callOk: false }; }
    sent = !!(r && r.callOk);
    detail = { provider: 'twilio-voice', callOk: sent };
  } else if (decision.action === 'escalar-juridico') {
    /* Etapa jurídica: NO se auto-contacta; se levanta alerta para gestión humana. */
    try {
      const reportAlert = (deps.alert && deps.alert.reportAlert) || require('./_alert').reportAlert;
      await reportAlert({
        kind: 'cobranza_juridico',
        severity: 'warn',
        message: `Cuenta en etapa jurídica (deudor ${deudorId})`,
        context: { deudorId, diasMora: debtor.diasMora, mora: mora && mora.interes },
        dedupeKey: `cobranza:juridico:${deudorKey(deudorId)}`
      });
    } catch (e) { /* best-effort */ }
    return { ran: false, reason: 'escalar-juridico', decision, mora, gastos: acumuladoPrevio };
  }

  /* Si el envío NO fue efectivo (mock/fallo), se libera el marcador para no bloquear
     un reintento legítimo dentro de la misma ventana (una gestión no efectuada no
     contactó ni cobró). Un envío efectivo conserva el marcador → freno del doble
     contacto. Best-effort. */
  if (!sent) await releaseGestionMarker(lockStore, marker.key);

  /* La gestión SOLO se cobra si fue realmente efectuada (sent/ok===true).
     Costo fijo por tipo (default 0). Se registra en el log para la evidencia. */
  const costo = sent ? C.costoDeGestion(tipo, costos) : 0;
  const gestion = {
    tipo, efectuada: sent, costo, at: now.toISOString(),
    etapa: decision.etapa, ref: detail
  };
  await recordGestion(logStore, deudorId, gestion);

  const acumulado = C.computeCollectionFees([...gestiones, gestion], costos);

  return {
    ran: true,
    efectuada: sent,
    canal: tipo,
    decision,
    mora,
    gestion,
    gastos: acumulado
  };
}

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  /* Autorización (Firebase → permiso de cobranza). Ver integrationNotes: falta
     declarar 'cobranza.gestionar' en _permissions.js; hasta entonces solo los
     superusuarios de entorno (ADMIN_EMAILS) pasan. */
  const auth = await authorize(event, 'cobranza.gestionar');
  if (!auth.ok) return json(auth.statusCode, { error: auth.error });

  try {
    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'JSON inválido' }); }
    const result = await runCollection(body, {});
    return json(200, result);
  } catch (e) {
    console.error('[collections-run]', e && e.message);
    return json(500, { error: 'No fue posible ejecutar la gestión de cobranza.' });
  }
};

module.exports.runCollection = runCollection;
module.exports._test = {
  loadGestiones, recordGestion, deudorKey, loadCostos, hasRecentGestion,
  wasWritten, acquireGestionMarker, releaseGestionMarker
};
