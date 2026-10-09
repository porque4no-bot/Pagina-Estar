/* A10 — scheduled pre-arrival + post-stay emails (frente "stay").
 *
 * Reads upcoming arrivals and recent departures from OTASync (read-only,
 * POST /api/reservation/data/reservations) and sends one pre-arrival email
 * (default 2 days before arrival) and one post-stay email (default 1 day after
 * departure) per reservation. NEVER inserts/edits a reservation, touches folio,
 * payments or availability.
 *
 * Works with reservations from EVERY channel (web, Booking.com, Expedia, Airbnb,
 * private/walk-in…). OTA guests usually come with a relay/masked address
 * (…@guest.booking.com, …@m.expediapartnercentral.com): `contactPolicy` decides
 * per guest whether to email, and the post-stay email only offers the review
 * discount to DIRECT guests (never to OTA guests: their terms forbid luring
 * them to book direct, and the OTA runs its own review invite). Placeholder /
 * invalid / our own addresses are skipped.
 *
 * Ventanas (no fecha exacta): el cron corre una vez al día, así que cada corrida
 * toma las llegadas entre HOY y hoy+PRE_DAYS y las salidas entre
 * hoy-POST_DAYS-POST_RETRY_DAYS y hoy-POST_DAYS. Con el dedupe por reserva:
 *   - lo normal sigue siendo 2 días antes / 1 día después (primera corrida en
 *     que la reserva entra a la ventana);
 *   - una reserva hecha con menos de PRE_DAYS de anticipación recibe el correo
 *     en la corrida siguiente a su creación (si aún no ha llegado);
 *   - un envío que Resend rechaza (o una lectura de OTASync que falla) se
 *     reintenta solo en la corrida siguiente mientras siga dentro de la ventana.
 *     En la última oportunidad la alerta pide enviarlo a mano y lista códigos.
 *
 * Safety: gated by STAY_EMAILS_ENABLED (OFF by default); no-op without OTASync
 * creds or RESEND_API_KEY; dedupe per reservation+type in Blobs (marked only
 * after Resend CONFIRMS the send). Sin store de dedupe la ventana se reduce a la
 * fecha exacta (nunca se repite un correo a diario). Si leer el dedupe falla,
 * esa reserva se salta en esta corrida (mejor tarde que duplicado).
 * Several reservations with the same email on the same day → ONE email.
 *
 * NOTE: filter_by='date_departure' is not explicitly documented by OTASync
 * (only date_received/date_arrival are). The post-stay path therefore ALSO
 * reads arrivals of the last POST_LOOKBACK_DAYS and filters client-side on
 * dateDeparture===postDate, so correctness does not depend on the server
 * honouring that filter. Validate against a real reservation before enabling.
 */

require('./_env');
const { getReservationsByDate, hasOtasyncCreds, isHoldReservation } = require('./_otasync');
const { sendEmail, preArrivalHtml, postStayHtml, formatDateES, formatDateEN } = require('./_email');
const { flag, get } = require('./_settings');

/* Valores por defecto (de Netlify). El panel puede sobreescribirlos en runtime
   vía `get(...)` dentro del handler — estas constantes solo dan el fallback de
   `targetDates` cuando se llama sin días explícitos (helper sync, tests). */
const PRE_ARRIVAL_DAYS = parseInt(process.env.STAY_EMAILS_PRE_DAYS, 10) || 2;
const POST_DEPARTURE_LAG_DAYS = parseInt(process.env.STAY_EMAILS_POST_DAYS, 10) || 1;
/* Ventana de llegadas que se relee para el post-estadía (respaldo del filtro
   date_departure no documentado). Cubre estadías de hasta ~2 meses. */
const POST_LOOKBACK_DAYS = 62;
/* Días extra de reintento del post-estadía (salidas hasta POST_DAYS+2 atrás). */
const POST_RETRY_DAYS = 2;

/* Estados que NO reciben correo: canceladas, no-show, holds/ofertas sin
   confirmar (tentative/pending) y borradas. */
const SKIP_STATUSES = new Set(['cancelled', 'canceled', 'no_show', 'noshow', 'tentative', 'pending', 'offer', 'deleted']);

/* Encuesta NPS post-estadía (Odoo Fase 3). Default = encuesta pública por
   defecto; configurable con NPS_SURVEY_URL. Solo se enlaza cuando NPS_ENABLED. */
const DEFAULT_NPS_SURVEY_URL = 'https://bpo-dici.odoo.com/survey/start/d2c5a098-72b3-4865-aad8-864341dcab8b';

/* Reseñas: enlace directo "escribir reseña" de Google (el mismo que usa el bot,
   docs/bot-conocimiento.md §8) y la ficha de Booking.com. Ambos sobreescribibles
   desde /admin (GOOGLE_REVIEW_URL / BOOKING_REVIEW_URL). REVIEW_LINK_URL (legado)
   sigue valiendo como respaldo del de Google. */
const DEFAULT_GOOGLE_REVIEW_URL = 'https://g.page/r/CW6uBmyymSHlEBM/review';
const DEFAULT_BOOKING_REVIEW_URL = 'https://www.booking.com/hotel/co/estar-apartaestudios.html#tab-reviews';

/* ── Correo del huésped: relay de OTA / marcador / propio ── */

/* Dominios relay (direcciones enmascaradas que reenvía la OTA al huésped). */
const RELAY_DOMAINS = [
  ['guest.booking.com', 'booking'],
  ['m.expediapartnercentral.com', 'expedia'],
  ['guest.airbnb.com', 'airbnb'],
  ['agoda-messaging.com', 'agoda'],
  ['messages.homeaway.com', 'vrbo']
];
/* Relays a los que NO escribimos: Airbnb mantiene la conversación dentro de su
   plataforma (sus reglas prohíben sacar al huésped del canal) — recepción le
   escribe por la mensajería de Airbnb. */
const RELAY_DO_NOT_EMAIL = new Set(['airbnb']);
/* Nuestros propios dominios (recepción a veces pone el correo del hotel como
   marcador en reservas de walk-in/teléfono): nunca nos escribimos a nosotros. */
const OWN_DOMAINS = new Set(['estar.com.co']);
const PLACEHOLDER_DOMAINS = new Set([
  'example.com', 'example.org', 'example.net', 'test.com', 'prueba.com',
  'sincorreo.com', 'nomail.com', 'noemail.com', 'otasync.me'
]);
const PLACEHOLDER_LOCAL = /^(no-?reply|do-?not-?reply|noemail|nomail|sin-?correo|sin-?email|none|null|na|n\.a|test|prueba|xxx+|correo|email)$/i;
const EMAIL_RE = /^[^\s@,;<>()"']+@[^\s@,;<>()"']+\.[a-z]{2,}$/i;

function domainMatches(domain, suffix) {
  return domain === suffix || domain.endsWith(`.${suffix}`);
}

/* Clasifica el correo de la reserva. Si trae varios (coma/punto y coma), toma el
   primero válido. kind: personal | relay | own | placeholder | invalid. */
function classifyEmail(raw) {
  const candidates = String(raw || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
  const address = candidates.find(c => EMAIL_RE.test(c));
  if (!address) return { kind: 'invalid', address: '', relayChannel: null };
  const lower = address.toLowerCase();
  const [local, domain] = lower.split('@');
  for (const own of OWN_DOMAINS) if (domainMatches(domain, own)) return { kind: 'own', address: lower, relayChannel: null };
  for (const [suffix, channel] of RELAY_DOMAINS) {
    if (domainMatches(domain, suffix)) return { kind: 'relay', address: lower, relayChannel: channel };
  }
  if (PLACEHOLDER_DOMAINS.has(domain) || PLACEHOLDER_LOCAL.test(local)) {
    return { kind: 'placeholder', address: lower, relayChannel: null };
  }
  return { kind: 'personal', address: lower, relayChannel: null };
}

/* Reservas creadas por NUESTRA web (wompi-webhook/_payments ponen reference =
   código EST-XXXXX del motor, o el texto fijo del motor) o cotizaciones
   corporativas pagadas (COT-…): son directas aunque OTASync no devuelva
   channel_name. */
const DIRECT_REFERENCE_RE = /^(EST-[A-Z0-9]{3,}|COT-[A-Z0-9-]+|Hotel Estar Custom Booking Engine)$/i;

/* Familia del canal de la reserva. OJO: "Booking engine" es el motor PROPIO de
   OTASync (venta directa), NO Booking.com. Sin canal → por reference propia
   'direct'; si tampoco → 'unknown' (no se asume directa: el descuento por reseña
   solo va a canales directos identificados). */
const DIRECT_CHANNEL_RE = /(p[aá]gina\s*web|sitio\s*web|website|^web$|booking engine|motor de reservas|private reservation|reserva privada|directa?\b|direct\b|recepci[oó]n|front desk|walk[\s-]?in|tel[eé]fono|phone|whatsapp|manual|\bestar\b)/i;
function channelFamily(channelName, relayChannel, webChannelName, reference) {
  if (relayChannel) return relayChannel;
  const name = String(channelName || '').trim();
  if (!name) return DIRECT_REFERENCE_RE.test(String(reference || '').trim()) ? 'direct' : 'unknown';
  const web = String(webChannelName || '').trim().toLowerCase();
  if (web && name.toLowerCase() === web) return 'direct';
  if (/booking\.com|^booking$/i.test(name)) return 'booking';
  if (/expedia|hotels\.com/i.test(name)) return 'expedia';
  if (/airbnb/i.test(name)) return 'airbnb';
  if (/agoda/i.test(name)) return 'agoda';
  if (/vrbo|homeaway/i.test(name)) return 'vrbo';
  if (/despegar|hostelworld|trip\.com|tripadvisor|priceline|hotelbeds|lastminute|kayak|trivago|ostrovok|ctrip/i.test(name)) return 'ota';
  if (DIRECT_CHANNEL_RE.test(name)) return 'direct';
  return 'unknown';
}

/* Decide si se le escribe al huésped y cómo.
   → { send, reason, address, family, isDirect } */
function contactPolicy(r, opts = {}) {
  const email = classifyEmail(r && r.email);
  const family = channelFamily(r && r.channel, email.relayChannel, opts.webChannelName, r && r.reference);
  const base = { address: email.address, family, isDirect: family === 'direct' };
  if (email.kind === 'invalid') return { ...base, send: false, reason: 'no_email' };
  if (email.kind === 'own') return { ...base, send: false, reason: 'own_address' };
  if (email.kind === 'placeholder') return { ...base, send: false, reason: 'placeholder' };
  if (email.kind === 'relay' && RELAY_DO_NOT_EMAIL.has(email.relayChannel)) {
    return { ...base, send: false, reason: 'relay_in_app_only' };
  }
  return { ...base, send: true, reason: email.kind === 'relay' ? 'relay' : 'ok' };
}

/* Idioma del correo: español para Colombia y países hispanohablantes (o sin
   país); inglés para el resto. */
const SPANISH_COUNTRIES = new Set([
  'CO', 'COL', 'COLOMBIA', 'ES', 'ESP', 'ESPAÑA', 'ESPANA', 'SPAIN', 'MX', 'MEX', 'MEXICO', 'MÉXICO',
  'AR', 'ARG', 'ARGENTINA', 'CL', 'CHL', 'CHILE', 'PE', 'PER', 'PERU', 'PERÚ', 'EC', 'ECU', 'ECUADOR',
  'VE', 'VEN', 'VENEZUELA', 'BO', 'BOL', 'BOLIVIA', 'PY', 'PRY', 'PARAGUAY', 'UY', 'URY', 'URUGUAY',
  'PA', 'PAN', 'PANAMA', 'PANAMÁ', 'CR', 'CRI', 'COSTA RICA', 'GT', 'GTM', 'GUATEMALA', 'HN', 'HND',
  'HONDURAS', 'SV', 'SLV', 'EL SALVADOR', 'NI', 'NIC', 'NICARAGUA', 'DO', 'DOM', 'REPUBLICA DOMINICANA',
  'REPÚBLICA DOMINICANA', 'CU', 'CUB', 'CUBA', 'PR', 'PRI', 'PUERTO RICO'
]);
function stayLang(r) {
  const c = String((r && r.country) || '').trim().toUpperCase();
  if (!c || SPANISH_COUNTRIES.has(c)) return 'es';
  return 'en';
}

/* ── Pure helpers (exported for tests) ── */
function ymd(date) {
  return date.toISOString().split('T')[0];
}

/* Fechas objetivo según el día en Colombia (UTC-5, sin horario de verano): el
   cron corre 12:00 UTC = 7:00 a. m. en Manizales. */
function targetDates(now = new Date(), preDays = PRE_ARRIVAL_DAYS, postDays = POST_DEPARTURE_LAG_DAYS) {
  const bogota = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  const pre = new Date(bogota); pre.setUTCDate(pre.getUTCDate() + preDays);
  const post = new Date(bogota); post.setUTCDate(post.getUTCDate() - postDays);
  return { preDate: ymd(pre), postDate: ymd(post) };
}

/* Ventanas de elegibilidad (ver cabecera). today = día de Colombia.
   pre:  [today, today+preDays]   post: [today-postDays-POST_RETRY_DAYS, today-postDays]
   windowed=false (sin store de dedupe) → solo la fecha exacta. */
function targetWindows(now = new Date(), preDays = PRE_ARRIVAL_DAYS, postDays = POST_DEPARTURE_LAG_DAYS, windowed = true) {
  const { preDate, postDate } = targetDates(now, preDays, postDays);
  const today = ymd(new Date(now.getTime() - 5 * 60 * 60 * 1000));
  return {
    today, preDate, postDate,
    pre: { from: windowed ? today : preDate, to: preDate },
    post: { from: windowed ? shiftDate(postDate, -POST_RETRY_DAYS) : postDate, to: postDate }
  };
}

function shiftDate(isoDate, deltaDays) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return ymd(d);
}

function activeReservation(r) {
  return !!(r && !SKIP_STATUSES.has(String(r.status || '').toLowerCase()) && !isHoldReservation(r));
}

/* target: 'YYYY-MM-DD' (fecha exacta) o { from, to } (ventana inclusiva). */
function inTarget(date, target) {
  const d = String(date || '');
  if (!d) return false;
  if (target && typeof target === 'object') return d >= target.from && d <= target.to;
  return d === target;
}

function eligiblePreArrival(r, target) {
  return !!(r && r.email && inTarget(r.dateArrival, target) && activeReservation(r));
}

function eligiblePostStay(r, target) {
  return !!(r && r.email && inTarget(r.dateDeparture, target) && activeReservation(r));
}

/* Une listas de reservas sin repetir id. */
function mergeReservations(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const r of (list || [])) {
      const id = String((r && r.idReservations) || '');
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      out.push(r);
    }
  }
  return out;
}

function staySubject(type, lang, resv) {
  const r = resv || {};
  if (type === 'pre') {
    return lang === 'en'
      ? `Your stay at estar — ${formatDateEN(r.dateArrival)} · online check-in`
      : `Tu llegada a estar — ${formatDateES(r.dateArrival)} · check-in en línea`;
  }
  return lang === 'en' ? 'Thank you for staying with us — estar' : 'Gracias por tu estadía — estar';
}

function safeHttpsUrl(u) {
  const s = String(u || '').trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(s) ? s : '';
}

/* Enlace de reseña pegado desde el panel: completa "g.page/…" / "www.google…"
   sin esquema y sube http→https; si aun así no es válido devuelve ''. */
function normalizeReviewUrl(u) {
  let s = String(u || '').trim();
  if (!s) return '';
  if (/^http:\/\//i.test(s)) s = `https://${s.slice(7)}`;
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(s) && /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(s)) s = `https://${s}`;
  return safeHttpsUrl(s);
}

/* Primer enlace válido de la lista (panel → legado → default). */
function firstReviewUrl(...candidates) {
  for (const c of candidates) {
    const u = normalizeReviewUrl(c);
    if (u) return u;
  }
  return '';
}

function getStayStore() {
  try {
    const { getStore } = require('@netlify/blobs');
    const opts = { name: 'stay-emails', consistency: 'strong' };
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

/* true / false, o null si el store falló (no se sabe → no arriesgar duplicado). */
async function alreadySent(store, key) {
  if (!store) return false;
  try { return !!(await store.get(key)); } catch (e) { return null; }
}

async function markSent(store, key, meta) {
  if (!store) return;
  try { await store.set(key, JSON.stringify({ at: new Date().toISOString(), ...(meta || {}) })); } catch (e) { /* non-fatal */ }
}

/* Procesa un lote. opts:
     sendEmail (inyectable), npsUrl, reviews {googleUrl, bookingUrl},
     discountEnabled (bool), webChannelName.
   Devuelve { sent, checked, skipped, failed, already, reasons }. */
async function processBatch(store, reservations, type, predicate, targetDate, opts = {}) {
  const send = opts.sendEmail || sendEmail; /* inyectable para tests */
  const reviews = opts.reviews || {};
  const stats = { sent: 0, checked: 0, skipped: 0, failed: 0, already: 0, reasons: {}, failedItems: [] };
  const dateOf = (r) => (type === 'pre' ? r.dateArrival : r.dateDeparture);

  /* 1) elegibles por fecha/estado → política de contacto → agrupar por correo */
  const groups = new Map();
  for (const r of (reservations || [])) {
    if (!predicate(r, targetDate)) continue;
    stats.checked++;
    const policy = contactPolicy(r, { webChannelName: opts.webChannelName });
    if (!policy.send) {
      stats.skipped++;
      stats.reasons[policy.reason] = (stats.reasons[policy.reason] || 0) + 1;
      continue;
    }
    const key = `${r.idReservations}:${type}`;
    const seen = await alreadySent(store, key);
    if (seen === null) {
      stats.failed++;
      stats.failedItems.push({ code: String(r.idReservations || ''), date: dateOf(r), reason: 'dedupe_unavailable' });
      continue;
    }
    if (seen) { stats.already++; continue; }
    if (!groups.has(policy.address)) groups.set(policy.address, { policy, items: [] });
    groups.get(policy.address).items.push({ r, key });
  }

  /* 2) un correo por dirección (varias reservas del mismo huésped → uno solo) */
  for (const [address, { policy, items }] of groups) {
    const first = items[0].r;
    const lang = stayLang(first);
    const resv = { ...first, bookingCodes: items.map(i => i.r.idReservations).filter(Boolean) };
    /* familia "booking" si CUALQUIERA de sus reservas vino de Booking.com */
    const families = items.map(i => contactPolicy(i.r, { webChannelName: opts.webChannelName }).family);
    const isBooking = families.includes('booking');
    const allDirect = families.every(f => f === 'direct');
    try {
      const html = type === 'pre'
        ? preArrivalHtml({ resv, lang })
        : postStayHtml({
          resv, lang, npsUrl: opts.npsUrl,
          reviews: { googleUrl: reviews.googleUrl || '', bookingUrl: isBooking ? (reviews.bookingUrl || '') : '' },
          discountOffer: !!opts.discountEnabled && allDirect
        });
      const res = await send({ to: address, subject: staySubject(type, lang, resv), html });
      if (!res || res.sent !== true) {
        stats.failed++;
        for (const i of items) stats.failedItems.push({ code: String(i.r.idReservations || ''), date: dateOf(i.r), reason: (res && res.reason) || 'resend_error' });
        console.error(`[send-stay-emails] ${type} email not sent for ${items.map(i => i.r.idReservations).join(',')}: ${(res && res.reason) || 'resend error'}`);
        continue;
      }
      for (const i of items) await markSent(store, i.key, { channel: policy.family });
      stats.sent++;
    } catch (e) {
      stats.failed++;
      for (const i of items) stats.failedItems.push({ code: String(i.r.idReservations || ''), date: dateOf(i.r), reason: 'exception' });
      console.error(`[send-stay-emails] ${type} email failed for ${items.map(i => i.r.idReservations).join(',')}:`, e.message);
    }
  }
  return stats;
}

/* Lee la configuración efectiva (panel /admin → Netlify → default). */
async function resolveSettings() {
  /* Días configurables desde /admin (override del panel → env → default). */
  const preDays = parseInt(await get('STAY_EMAILS_PRE_DAYS', PRE_ARRIVAL_DAYS), 10) || PRE_ARRIVAL_DAYS;
  const postDays = parseInt(await get('STAY_EMAILS_POST_DAYS', POST_DEPARTURE_LAG_DAYS), 10) || POST_DEPARTURE_LAG_DAYS;
  /* NPS post-estadía (Odoo Fase 3): si está activo, enlaza la encuesta en el
     correo post-estadía. No afecta el gating de STAY_EMAILS_ENABLED. */
  const npsUrl = (await flag('NPS_ENABLED'))
    ? await get('NPS_SURVEY_URL', DEFAULT_NPS_SURVEY_URL)
    : null;
  return {
    preDays,
    postDays,
    npsUrl,
    /* Un valor inválido en el panel NUNCA deja el correo sin botón de reseña:
       se ignora y se cae al legado/default. */
    reviews: {
      googleUrl: firstReviewUrl(await get('GOOGLE_REVIEW_URL', ''), process.env.REVIEW_LINK_URL, DEFAULT_GOOGLE_REVIEW_URL),
      bookingUrl: firstReviewUrl(await get('BOOKING_REVIEW_URL', ''), DEFAULT_BOOKING_REVIEW_URL)
    },
    discountEnabled: await flag('STAY_REVIEW_DISCOUNT_ENABLED'),
    webChannelName: process.env.OTASYNC_CHANNEL_NAME || 'Pagina web'
  };
}

/* Corrida completa (inyectable para tests):
     deps.fetchReservations (= getReservationsByDate), deps.store, deps.sendEmail,
     deps.reportAlert, deps.now; settings = resolveSettings(). */
async function runStayEmails(settings, deps = {}) {
  const fetchReservations = deps.fetchReservations || getReservationsByDate;
  const store = deps.store === undefined ? getStayStore() : deps.store;
  const alert = deps.reportAlert || (async (a) => { try { await require('./_alert').reportAlert(a); } catch (_) { /* best-effort */ } });
  const win = targetWindows(deps.now || new Date(), settings.preDays, settings.postDays, !!store);
  const { preDate, postDate, today } = win;
  const batchOpts = { sendEmail: deps.sendEmail, webChannelName: settings.webChannelName };
  const empty = { sent: 0, checked: 0, skipped: 0, failed: 0, already: 0, reasons: {}, failedItems: [] };
  let pre = empty;
  let post = empty;

  try {
    const arrivals = await fetchReservations({ filterBy: 'date_arrival', dfrom: win.pre.from, dto: win.pre.to, arrivals: 1 });
    if (!arrivals.isMock) pre = await processBatch(store, arrivals.reservations, 'pre', eligiblePreArrival, win.pre, batchOpts);
  } catch (e) {
    console.error('[send-stay-emails] pre-arrival batch failed:', e.message);
    await alert({ kind: 'cron_failed', severity: 'error', message: `El cron de correos de pre-llegada falló hoy. Se reintenta mañana, pero los huéspedes que llegan hoy (${today}) ya no lo recibirán: revisa en recepción.`, context: { fase: 'pre-arrival', detail: String(e.message || '').slice(0, 200) }, dedupeKey: 'stay-emails-pre' });
  }

  /* Post-estadía: salidas por date_departure (no documentado) + respaldo con las
     llegadas de la ventana, filtrando en cliente por dateDeparture en la ventana. */
  let departures = null;
  let windowArrivals = null;
  let lastError = null;
  try {
    departures = await fetchReservations({ filterBy: 'date_departure', dfrom: win.post.from, dto: win.post.to, departures: 1 });
  } catch (e) { lastError = e; }
  try {
    windowArrivals = await fetchReservations({ filterBy: 'date_arrival', dfrom: shiftDate(win.post.from, -POST_LOOKBACK_DAYS), dto: win.post.to, arrivals: 1 });
  } catch (e) { lastError = e; }
  if (lastError && (departures || windowArrivals)) {
    console.warn('[send-stay-emails] post-stay: una de las dos lecturas falló, sigo con la otra:', lastError.message);
  }
  if (!departures && !windowArrivals) {
    const detail = String((lastError && lastError.message) || '').slice(0, 200);
    console.error('[send-stay-emails] post-stay batch failed:', detail);
    await alert({ kind: 'cron_failed', severity: 'error', message: 'El cron de correos de post-estadía falló hoy. Se reintenta en la próxima corrida (las salidas de los últimos días siguen en la ventana).', context: { fase: 'post-stay', detail }, dedupeKey: 'stay-emails-post' });
  } else if (!((departures && departures.isMock) || (windowArrivals && windowArrivals.isMock))) {
    const rows = mergeReservations(departures && departures.reservations, windowArrivals && windowArrivals.reservations);
    try {
      post = await processBatch(store, rows, 'post', eligiblePostStay, win.post, {
        ...batchOpts, npsUrl: settings.npsUrl, reviews: settings.reviews, discountEnabled: settings.discountEnabled
      });
    } catch (e) {
      console.error('[send-stay-emails] post-stay batch failed:', e.message);
      await alert({ kind: 'cron_failed', severity: 'error', message: 'El cron de correos de post-estadía falló hoy. Se reintenta en la próxima corrida (las salidas de los últimos días siguen en la ventana).', context: { fase: 'post-stay', detail: String(e.message || '').slice(0, 200) }, dedupeKey: 'stay-emails-post' });
    }
  }

  const failed = pre.failed + post.failed;
  if (failed > 0) {
    /* Mañana la ventana empieza un día después: lo que hoy está en el primer día
       de su ventana ya no se reintenta → hay que mandarlo a mano. */
    const split = (items, lastDay) => {
      const retry = []; const manual = [];
      for (const it of items) (String(it.date || '') <= lastDay ? manual : retry).push(it.code);
      return { retry, manual };
    };
    const p = split(pre.failedItems, win.pre.from);
    const q = split(post.failedItems, win.post.from);
    const retry = [...p.retry.map(c => `${c} (pre-llegada)`), ...q.retry.map(c => `${c} (post-estadía)`)];
    const manual = [...p.manual.map(c => `${c} (pre-llegada)`), ...q.manual.map(c => `${c} (post-estadía)`)];
    const parts = [`${failed} correo(s) de estadía no salieron hoy (Resend rechazó o falló).`];
    if (manual.length) parts.push(`ENVIAR A MANO (ya no se reintentan): ${manual.join(', ')}.`);
    if (retry.length) parts.push(`Se reintentan solos mañana: ${retry.join(', ')}.`);
    await alert({
      kind: 'email_failed', severity: manual.length ? 'error' : 'warn',
      message: parts.join(' '),
      context: { preDate, postDate, preFailed: pre.failed, postFailed: post.failed, manual, retry },
      dedupeKey: `stay-emails-send-failed-${today}`
    });
  }

  console.log(`[send-stay-emails] pre=${win.pre.from}..${win.pre.to} post=${win.post.from}..${win.post.to} preDate=${preDate} sent=${pre.sent}/${pre.checked} skipped=${pre.skipped} failed=${pre.failed}, postDate=${postDate} sent=${post.sent}/${post.checked} skipped=${post.skipped} failed=${post.failed}`);
  return {
    preDate, postDate, preWindow: win.pre, postWindow: win.post,
    preSent: pre.sent, postSent: post.sent, preChecked: pre.checked, postChecked: post.checked,
    preSkipped: pre.skipped, postSkipped: post.skipped, preFailed: pre.failed, postFailed: post.failed,
    skipReasons: { pre: pre.reasons, post: post.reasons }
  };
}

exports.handler = async () => {
  if (!(await flag('STAY_EMAILS_ENABLED'))) {
    return { statusCode: 200, body: 'disabled' };
  }
  if (!hasOtasyncCreds()) {
    console.log('[send-stay-emails] OTASync credentials missing; skipping.');
    return { statusCode: 200, body: 'skipped: no otasync creds' };
  }
  if (!process.env.RESEND_API_KEY) {
    console.log('[send-stay-emails] RESEND_API_KEY missing; skipping.');
    return { statusCode: 200, body: 'skipped: no resend key' };
  }
  const result = await runStayEmails(await resolveSettings());
  return { statusCode: 200, body: JSON.stringify(result) };
};

exports._test = {
  runStayEmails, resolveSettings,
  ymd, targetDates, targetWindows, inTarget, shiftDate, normalizeReviewUrl, firstReviewUrl, eligiblePreArrival, eligiblePostStay, processBatch, mergeReservations,
  classifyEmail, channelFamily, contactPolicy, stayLang, staySubject, safeHttpsUrl,
  PRE_ARRIVAL_DAYS, POST_DEPARTURE_LAG_DAYS, POST_LOOKBACK_DAYS, POST_RETRY_DAYS,
  DEFAULT_NPS_SURVEY_URL, DEFAULT_GOOGLE_REVIEW_URL, DEFAULT_BOOKING_REVIEW_URL
};
