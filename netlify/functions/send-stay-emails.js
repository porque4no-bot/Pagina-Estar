/* A10 — scheduled pre-arrival + post-stay emails.
 *
 * Reads upcoming arrivals and recent departures from OTASync (read-only,
 * POST /api/reservation/data/reservations) and sends one pre-arrival and one
 * post-stay email per reservation. NEVER inserts/edits a reservation, touches
 * folio, payments or availability.
 *
 * Safety: gated by STAY_EMAILS_ENABLED (OFF by default); no-op without OTASync
 * creds or RESEND_API_KEY; dedupe per reservation+type in Blobs (marked only
 * after a successful send, so a failure stays retryable the next day).
 *
 * NOTE: filter_by='date_departure' is not explicitly documented by OTASync
 * (only date_received/date_arrival are). The post-stay path therefore ALSO
 * filters client-side on dateDeparture===postDate, so correctness does not
 * depend on the server honouring that filter. Validate against a real
 * reservation before enabling (owner test, ver docs/pendientes B8).
 */

require('./_env');
const { getReservationsByDate, hasOtasyncCreds } = require('./_otasync');
const { sendEmail, preArrivalHtml, postStayHtml, formatDateES, formatDateEN } = require('./_email');
const { flag, get } = require('./_settings');

/* Valores por defecto (de Netlify). El panel puede sobreescribirlos en runtime
   vía `get(...)` dentro del handler — estas constantes solo dan el fallback de
   `targetDates` cuando se llama sin días explícitos (helper sync, tests). */
const PRE_ARRIVAL_DAYS = parseInt(process.env.STAY_EMAILS_PRE_DAYS, 10) || 2;
const POST_DEPARTURE_LAG_DAYS = parseInt(process.env.STAY_EMAILS_POST_DAYS, 10) || 1;
const CANCELLED = new Set(['cancelled', 'canceled', 'no_show', 'noshow']);

/* Encuesta NPS post-estadía (Odoo Fase 3). Default = encuesta pública por
   defecto; configurable con NPS_SURVEY_URL. Solo se enlaza cuando NPS_ENABLED. */
const DEFAULT_NPS_SURVEY_URL = 'https://bpo-dici.odoo.com/survey/start/d2c5a098-72b3-4865-aad8-864341dcab8b';

/* ── Pure helpers (exported for tests) ── */
function ymd(date) {
  return date.toISOString().split('T')[0];
}

function targetDates(now = new Date(), preDays = PRE_ARRIVAL_DAYS, postDays = POST_DEPARTURE_LAG_DAYS) {
  const pre = new Date(now); pre.setUTCDate(pre.getUTCDate() + preDays);
  const post = new Date(now); post.setUTCDate(post.getUTCDate() - postDays);
  return { preDate: ymd(pre), postDate: ymd(post) };
}

function eligiblePreArrival(r, preDate) {
  return !!(r && r.email && r.dateArrival === preDate && !CANCELLED.has(String(r.status).toLowerCase()));
}

function eligiblePostStay(r, postDate) {
  return !!(r && r.email && r.dateDeparture === postDate && !CANCELLED.has(String(r.status).toLowerCase()));
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

async function alreadySent(store, key) {
  if (!store) return false;
  try { return !!(await store.get(key)); } catch (e) { return false; }
}

async function markSent(store, key) {
  if (!store) return;
  try { await store.set(key, JSON.stringify({ at: new Date().toISOString() })); } catch (e) { /* non-fatal */ }
}

async function processBatch(store, reservations, type, predicate, targetDate, opts = {}) {
  const npsUrl = opts.npsUrl;
  const send = opts.sendEmail || sendEmail; /* inyectable para tests */
  let sent = 0, checked = 0;
  for (const r of reservations) {
    if (!predicate(r, targetDate)) continue;
    checked++;
    const key = `${r.idReservations}:${type}`;
    if (await alreadySent(store, key)) continue;
    try {
      const html = type === 'pre' ? preArrivalHtml({ resv: r, lang: r.lang }) : postStayHtml({ resv: r, lang: r.lang, npsUrl });
      const subject = type === 'pre'
        ? (r.lang === 'en' ? `Your stay at Estar — ${formatDateEN(r.dateArrival)}` : `Tu llegada a Estar — ${formatDateES(r.dateArrival)}`)
        : (r.lang === 'en' ? 'Thank you for staying with us — Estar' : 'Gracias por tu estadía — Estar');
      await send({ to: r.email, subject, html });
      await markSent(store, key);
      sent++;
    } catch (e) {
      console.error(`[send-stay-emails] ${type} email failed for ${r.idReservations}:`, e.message);
    }
  }
  return { sent, checked };
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

  const store = getStayStore();
  /* Días configurables desde /admin (override del panel → env → default). */
  const preDays = parseInt(await get('STAY_EMAILS_PRE_DAYS', PRE_ARRIVAL_DAYS), 10) || PRE_ARRIVAL_DAYS;
  const postDays = parseInt(await get('STAY_EMAILS_POST_DAYS', POST_DEPARTURE_LAG_DAYS), 10) || POST_DEPARTURE_LAG_DAYS;
  const { preDate, postDate } = targetDates(new Date(), preDays, postDays);
  /* NPS post-estadía (Odoo Fase 3): si está activo, enlaza la encuesta en el
     correo post-estadía. No afecta el gating de STAY_EMAILS_ENABLED. */
  const npsUrl = (await flag('NPS_ENABLED'))
    ? await get('NPS_SURVEY_URL', DEFAULT_NPS_SURVEY_URL)
    : null;
  let pre = { sent: 0, checked: 0 };
  let post = { sent: 0, checked: 0 };

  try {
    const arrivals = await getReservationsByDate({ filterBy: 'date_arrival', dfrom: preDate, dto: preDate, arrivals: 1 });
    if (!arrivals.isMock) pre = await processBatch(store, arrivals.reservations, 'pre', eligiblePreArrival, preDate);
  } catch (e) {
    console.error('[send-stay-emails] pre-arrival batch failed:', e.message);
    try { await require('./_alert').reportAlert({ kind: 'cron_failed', severity: 'error', message: 'El cron de correos de pre-llegada falló (no se enviaron los avisos de hoy).', context: { fase: 'pre-arrival', detail: String(e.message || '').slice(0, 200) }, dedupeKey: 'stay-emails-pre' }); } catch (_) {}
  }

  try {
    const departures = await getReservationsByDate({ filterBy: 'date_departure', dfrom: postDate, dto: postDate, departures: 1 });
    if (!departures.isMock) post = await processBatch(store, departures.reservations, 'post', eligiblePostStay, postDate, { npsUrl });
  } catch (e) {
    console.error('[send-stay-emails] post-stay batch failed:', e.message);
    try { await require('./_alert').reportAlert({ kind: 'cron_failed', severity: 'error', message: 'El cron de correos de post-estadía falló (no se enviaron los avisos de hoy).', context: { fase: 'post-stay', detail: String(e.message || '').slice(0, 200) }, dedupeKey: 'stay-emails-post' }); } catch (_) {}
  }

  console.log(`[send-stay-emails] preDate=${preDate} sent=${pre.sent}/${pre.checked}, postDate=${postDate} sent=${post.sent}/${post.checked}`);
  return { statusCode: 200, body: JSON.stringify({ preSent: pre.sent, postSent: post.sent, preChecked: pre.checked, postChecked: post.checked }) };
};

exports._test = { ymd, targetDates, eligiblePreArrival, eligiblePostStay, processBatch, PRE_ARRIVAL_DAYS, POST_DEPARTURE_LAG_DAYS, DEFAULT_NPS_SURVEY_URL };
