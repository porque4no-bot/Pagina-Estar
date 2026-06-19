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
const { sendEmail, preArrivalHtml, postStayHtml, formatDateES } = require('./_email');

const PRE_ARRIVAL_DAYS = parseInt(process.env.STAY_EMAILS_PRE_DAYS, 10) || 2;
const POST_DEPARTURE_LAG_DAYS = parseInt(process.env.STAY_EMAILS_POST_DAYS, 10) || 1;
const CANCELLED = new Set(['cancelled', 'canceled', 'no_show', 'noshow']);

/* ── Pure helpers (exported for tests) ── */
function ymd(date) {
  return date.toISOString().split('T')[0];
}

function targetDates(now = new Date()) {
  const pre = new Date(now); pre.setUTCDate(pre.getUTCDate() + PRE_ARRIVAL_DAYS);
  const post = new Date(now); post.setUTCDate(post.getUTCDate() - POST_DEPARTURE_LAG_DAYS);
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
    if (process.env.BLOBS_TOKEN && process.env.NETLIFY_SITE_ID) {
      opts.token = process.env.BLOBS_TOKEN;
      opts.siteID = process.env.NETLIFY_SITE_ID;
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

async function processBatch(store, reservations, type, predicate, targetDate) {
  let sent = 0, checked = 0;
  for (const r of reservations) {
    if (!predicate(r, targetDate)) continue;
    checked++;
    const key = `${r.idReservations}:${type}`;
    if (await alreadySent(store, key)) continue;
    try {
      const html = type === 'pre' ? preArrivalHtml({ resv: r, lang: r.lang }) : postStayHtml({ resv: r, lang: r.lang });
      const subject = type === 'pre'
        ? (r.lang === 'en' ? `Your stay at Estar — ${formatDateES(r.dateArrival)}` : `Tu llegada a Estar — ${formatDateES(r.dateArrival)}`)
        : (r.lang === 'en' ? 'Thank you for staying with us — Estar' : 'Gracias por tu estadía — Estar');
      await sendEmail({ to: r.email, subject, html });
      await markSent(store, key);
      sent++;
    } catch (e) {
      console.error(`[send-stay-emails] ${type} email failed for ${r.idReservations}:`, e.message);
    }
  }
  return { sent, checked };
}

exports.handler = async () => {
  if (process.env.STAY_EMAILS_ENABLED !== 'true') {
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
  const { preDate, postDate } = targetDates();
  let pre = { sent: 0, checked: 0 };
  let post = { sent: 0, checked: 0 };

  try {
    const arrivals = await getReservationsByDate({ filterBy: 'date_arrival', dfrom: preDate, dto: preDate, arrivals: 1 });
    if (!arrivals.isMock) pre = await processBatch(store, arrivals.reservations, 'pre', eligiblePreArrival, preDate);
  } catch (e) {
    console.error('[send-stay-emails] pre-arrival batch failed:', e.message);
  }

  try {
    const departures = await getReservationsByDate({ filterBy: 'date_departure', dfrom: postDate, dto: postDate, departures: 1 });
    if (!departures.isMock) post = await processBatch(store, departures.reservations, 'post', eligiblePostStay, postDate);
  } catch (e) {
    console.error('[send-stay-emails] post-stay batch failed:', e.message);
  }

  console.log(`[send-stay-emails] preDate=${preDate} sent=${pre.sent}/${pre.checked}, postDate=${postDate} sent=${post.sent}/${post.checked}`);
  return { statusCode: 200, body: JSON.stringify({ preSent: pre.sent, postSent: post.sent, preChecked: pre.checked, postChecked: post.checked }) };
};

exports._test = { ymd, targetDates, eligiblePreArrival, eligiblePostStay, processBatch, PRE_ARRIVAL_DAYS, POST_DEPARTURE_LAG_DAYS };
