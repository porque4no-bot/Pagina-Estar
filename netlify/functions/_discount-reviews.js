/* Frente codes — flujo de RESEÑAS → código de agradecimiento.
 *
 * El admin registra en /admin → Códigos → Reseñas al huésped que dejó una
 * reseña (email, nombre, código de reserva, plataforma Google/Booking/
 * TripAdvisor/otra, enlace opcional). Queda en "reseñas por aprobar". Al
 * "Aprobar reseña", el sistema emite un código personal desde la regla de
 * reseña configurada (purpose 'review' en _discount-rules) ligado al email del
 * huésped y se lo envía por correo (plantilla ES/EN en _email.js).
 *
 * Store en Netlify Blobs: 'discount-reviews' (clave = id REV-…).
 * Estados: pending → approved | rejected.
 *
 * Aprobación IDEMPOTENTE y a prueba de doble clic: la transición pending →
 * approved se escribe con compare-and-set (onlyIfMatch del etag leído). Si dos
 * admins aprueban a la vez, solo uno gana; el código que emitió el perdedor se
 * desactiva (queda auditado) y se devuelve el del ganador. Re-aprobar una
 * reseña ya aprobada devuelve el mismo código, nunca emite otro.
 *
 * Mock-safe; inyección de dependencias (deps.getStore, deps.now,
 * deps.randomInt, deps.sendEmail) para tests sin red. */

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');
const discountStore = require('./_discount-store');
const rules = require('./_discount-rules');

const REVIEWS_STORE = 'discount-reviews';
/* Reclamos de unicidad: una entrada por identidad de reseña (plataforma +
   reserva, o plataforma + email sin reserva), escrita con onlyIfNew. Es lo que
   hace ATÓMICA la regla "no dos reseñas vivas del mismo huésped": dos altas
   simultáneas (doble clic) listan antes de que la otra guarde, pero solo una
   gana el reclamo. Store aparte para no mezclarse con el listado de reseñas. */
const REVIEW_CLAIMS_STORE = 'discount-review-claims';
const PLATFORMS = ['google', 'booking', 'tripadvisor', 'otra'];
const STATUS = { PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected' };

function getReviewsStore(deps = {}) {
  const get = deps.getStore || getStore;
  const opts = { name: REVIEWS_STORE, consistency: 'strong' };
  const siteID = process.env.BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) { opts.siteID = siteID; opts.token = token; }
  return get(opts);
}

function nowIso(deps) {
  if (deps && typeof deps.now === 'function') return deps.now();
  return new Date().toISOString();
}

function normalizeReviewId(raw) {
  return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 40);
}

function newReviewId(deps = {}) {
  const day = nowIso(deps).slice(0, 10).replace(/-/g, '');
  const rnd = deps.randomInt || ((max) => crypto.randomInt(max));
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let tail = '';
  for (let i = 0; i < 6; i++) tail += alphabet[rnd(alphabet.length)];
  return `REV-${day}-${tail}`;
}

function sanitizeBookingCode(raw) {
  return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40);
}

function sanitizeLink(raw) {
  const s = String(raw || '').trim();
  if (!s) return { link: null };
  if (s.length > 500) return { error: 'El enlace de la reseña es demasiado largo.' };
  let u;
  try { u = new URL(s); } catch (e) { return { error: 'El enlace de la reseña no es una URL válida.' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'El enlace de la reseña debe empezar por https://.' };
  return { link: u.toString() };
}

/* Construye un registro de reseña a partir de la entrada del admin (pura).
   Devuelve { review } o { error }. */
function buildReview(input, opts = {}) {
  const src = input || {};
  const email = discountStore.normalizeEmail(src.email);
  if (!discountStore.isValidEmail(email)) return { error: 'Ingresa un email válido del huésped.' };
  const name = String(src.name || '').trim().slice(0, 120);
  const platform = PLATFORMS.includes(String(src.platform || '').toLowerCase()) ? String(src.platform).toLowerCase() : null;
  if (!platform) return { error: 'Elige la plataforma de la reseña (Google, Booking, TripAdvisor u otra).' };
  const { link, error: linkError } = sanitizeLink(src.link);
  if (linkError) return { error: linkError };
  const at = opts.now || new Date().toISOString();
  const actor = opts.actor || 'system';
  return {
    review: {
      id: opts.id,
      status: STATUS.PENDING,
      email,
      name,
      bookingCode: sanitizeBookingCode(src.bookingCode) || null,
      platform,
      link,
      lang: src.lang === 'en' ? 'en' : 'es',
      note: String(src.note || '').trim().slice(0, 300),
      createdAt: at,
      createdBy: actor,
      updatedAt: at,
      issuedCode: null,
      ruleId: null,
      approvedAt: null,
      approvedBy: null,
      rejectedAt: null,
      rejectedBy: null,
      rejectReason: null,
      emailSent: null,
      emailSentAt: null,
      audit: [{ at, by: actor, action: 'create' }]
    }
  };
}

/* ¿Es un duplicado de una reseña ya registrada (no rechazada)? Misma
   plataforma y mismo código de reserva — o, sin código, mismo email. */
function findDuplicate(existing, candidate) {
  return (existing || []).find(r => r
    && r.status !== STATUS.REJECTED
    && r.platform === candidate.platform
    && (candidate.bookingCode
      ? r.bookingCode === candidate.bookingCode
      : (!r.bookingCode && r.email === candidate.email))) || null;
}

function getClaimsStore(deps = {}) {
  const get = deps.getStore || getStore;
  const opts = { name: REVIEW_CLAIMS_STORE, consistency: 'strong' };
  const siteID = process.env.BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) { opts.siteID = siteID; opts.token = token; }
  return get(opts);
}

/* Identidad de una reseña para la unicidad (la misma que usa findDuplicate). */
function reviewIdentityKey(review) {
  const r = review || {};
  const who = r.bookingCode ? 'booking:' + r.bookingCode : 'email:' + (r.email || '');
  const digest = crypto.createHash('sha256').update(String(r.platform || '') + '|' + who).digest('hex').slice(0, 40);
  return 'CLAIM-' + digest;
}

/* Reclama atómicamente la identidad de la reseña para review.id.
   Devuelve { ok:true } o { ok:false, holder } (la reseña viva que ya la tiene).
   Un reclamo cuya reseña fue descartada o ya no existe se puede retomar
   (compare-and-set sobre su etag). Si el store no soporta escrituras
   condicionales, cae a "sin reclamo" (queda el chequeo por listado). */
async function claimReviewIdentity(review, deps = {}) {
  const key = reviewIdentityKey(review);
  const store = getClaimsStore(deps);
  const payload = JSON.stringify({ reviewId: review.id, at: review.createdAt });
  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    try { res = await store.set(key, payload, { onlyIfNew: true }); }
    catch (e) { return { ok: true, unsupported: true }; }
    if (!res || res.modified !== false) return { ok: true };
    /* Ya existe: ¿la reseña que lo tiene sigue viva? */
    let current = null;
    try {
      if (typeof store.getWithMetadata === 'function') {
        const got = await store.getWithMetadata(key, { type: 'text' });
        if (got && got.data) current = { data: JSON.parse(got.data), etag: got.etag || null };
      }
    } catch (e) { current = null; }
    if (!current) continue; /* lo borraron entre medio: reintenta el alta */
    const holder = current.data && current.data.reviewId ? await loadReview(current.data.reviewId, deps) : null;
    /* Reclamo de una alta que aún no termina de guardar la reseña: se trata
       como vivo (el reclamo es reciente). Solo se retoma si la reseña fue
       descartada, o si el reclamo es viejo y su reseña nunca se guardó. */
    const claimAgeMs = Date.parse(nowIso(deps)) - Date.parse((current.data && current.data.at) || 0);
    const orphanStale = !holder && !(claimAgeMs < 10 * 60 * 1000);
    const reusable = (holder && holder.status === STATUS.REJECTED) || orphanStale;
    if (!reusable) return { ok: false, holder: holder || null };
    if (!current.etag) return { ok: true, unsupported: true };
    let taken;
    try { taken = await store.set(key, payload, { onlyIfMatch: current.etag }); }
    catch (e) { return { ok: true, unsupported: true }; }
    if (!taken || taken.modified !== false) return { ok: true };
    /* Otro lo retomó primero: vuelve a evaluar. */
  }
  return { ok: false, holder: null };
}

async function loadReview(id, deps = {}) {
  const key = normalizeReviewId(id);
  if (!key) return null;
  let raw;
  try { raw = await getReviewsStore(deps).get(key); }
  catch (e) { return null; }
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

async function loadReviewWithEtag(id, deps = {}) {
  const key = normalizeReviewId(id);
  if (!key) return { review: null, etag: null };
  const store = getReviewsStore(deps);
  if (typeof store.getWithMetadata === 'function') {
    try {
      const res = await store.getWithMetadata(key, { type: 'text' });
      if (!res || !res.data) return { review: null, etag: null };
      return { review: JSON.parse(res.data), etag: res.etag || null };
    } catch (e) { /* cae a get simple */ }
  }
  return { review: await loadReview(key, deps), etag: null };
}

async function saveReview(review, deps = {}, { etag } = {}) {
  const key = normalizeReviewId(review && review.id);
  if (!key) throw new Error('reseña inválida');
  review.id = key;
  const store = getReviewsStore(deps);
  if (etag) {
    try {
      const res = await store.set(key, JSON.stringify(review), { onlyIfMatch: etag });
      if (res && res.modified === false) return { ok: false, reason: 'conflict' };
      return { ok: true, review };
    } catch (e) { /* store sin escrituras condicionales: escritura simple */ }
  }
  await store.set(key, JSON.stringify(review));
  return { ok: true, review };
}

async function listReviews(deps = {}) {
  const store = getReviewsStore(deps);
  let listing;
  try { listing = await store.list(); }
  catch (e) { return []; }
  const rows = await discountStore.mapLimit(listing.blobs || [], 8, async (b) => {
    try {
      const raw = await store.get(b.key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; /* salta ilegibles */ }
  });
  const out = rows.filter(Boolean);
  /* Pendientes primero; dentro de cada grupo, lo más reciente arriba. */
  out.sort((a, b) => {
    const pa = a.status === STATUS.PENDING ? 0 : 1;
    const pb = b.status === STATUS.PENDING ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''));
  });
  return out;
}

/* Registra una reseña "por aprobar". Devuelve { ok, review } o
   { ok:false, status, error, duplicate? }. */
async function createReview(input, { actor } = {}, deps = {}) {
  const id = newReviewId(deps);
  const built = buildReview(input, { actor, now: nowIso(deps), id });
  if (built.error) return { ok: false, status: 400, error: built.error };
  const dupError = 'Ya hay una reseña registrada de ese huésped en esa plataforma.';
  /* Chequeo por listado (cubre reseñas anteriores a los reclamos) … */
  const dup = findDuplicate(await listReviews(deps), built.review);
  if (dup) {
    return { ok: false, status: 409, error: dupError, duplicate: { id: dup.id, status: dup.status } };
  }
  /* … y reclamo atómico (cubre dos altas simultáneas, p. ej. doble clic). */
  const claim = await claimReviewIdentity(built.review, deps);
  if (!claim.ok) {
    const h = claim.holder;
    return { ok: false, status: 409, error: dupError, duplicate: h ? { id: h.id, status: h.status } : null };
  }
  await saveReview(built.review, deps);
  return { ok: true, review: built.review };
}

/* Aprueba una reseña: emite el código desde la regla de reseña (o la regla
   indicada) y envía el correo. Idempotente (ver cabecera).
   opts: { actor, ruleId?, sendEmail? (default true) }.
   Devuelve { ok, review, code, alreadyApproved?, email? } o
   { ok:false, status, error }. */
async function approveReview(id, opts = {}, deps = {}) {
  const actor = opts.actor || 'system';
  const { review, etag } = await loadReviewWithEtag(id, deps);
  if (!review) return { ok: false, status: 404, error: 'Reseña no encontrada.' };
  if (review.status === STATUS.APPROVED) {
    return { ok: true, alreadyApproved: true, review, code: review.issuedCode ? await discountStore.loadCode(review.issuedCode, deps) : null };
  }
  if (review.status === STATUS.REJECTED) return { ok: false, status: 409, error: 'La reseña fue descartada; regístrala de nuevo si corresponde.' };

  /* Una sola reseña aprobada por identidad: si ya hay OTRA aprobada del mismo
     huésped/plataforma/reserva (p. ej. duplicados creados antes de los
     reclamos), no se emite un segundo código. */
  const twin = (await listReviews(deps)).find(r => r && r.id !== review.id
    && r.status === STATUS.APPROVED && findDuplicate([r], review));
  if (twin) {
    return { ok: false, status: 409, error: 'Ya hay una reseña aprobada de ese huésped en esa plataforma (' + twin.id + ', código ' + (twin.issuedCode || '—') + '). Descarta esta.', duplicate: { id: twin.id, status: twin.status } };
  }

  let rule;
  if (opts.ruleId) {
    rule = await rules.loadRule(opts.ruleId, deps);
    if (!rule) return { ok: false, status: 404, error: 'Regla no encontrada.' };
  } else {
    rule = rules.pickReviewRule(await rules.listRules(deps));
    if (!rule) return { ok: false, status: 409, error: 'No hay una regla de reseña activa. Crea una en Reglas (propósito "Reseña") y actívala.' };
  }

  const issued = await rules.issueCodeFromRule(rule, {
    email: review.email,
    name: review.name,
    note: `Reseña ${review.platform}${review.bookingCode ? ' · ' + review.bookingCode : ''}`,
    lang: review.lang,
    origin: 'review',
    reviewId: review.id,
    actor
  }, deps);
  if (!issued.ok) return { ok: false, status: issued.status || 400, error: issued.error };

  const at = nowIso(deps);
  const next = Object.assign({}, review, {
    status: STATUS.APPROVED,
    issuedCode: issued.def.code,
    ruleId: rule.id,
    approvedAt: at,
    approvedBy: actor,
    updatedAt: at,
    audit: (Array.isArray(review.audit) ? review.audit.slice(-30) : []).concat([{ at, by: actor, action: 'approve', code: issued.def.code }])
  });
  const saved = await saveReview(next, deps, { etag });
  if (!saved.ok) {
    /* Perdió la carrera: otro admin aprobó primero. Desactiva el código que
       acabamos de emitir (queda auditado, nunca se envía) y devuelve el del
       ganador. */
    try {
      const built = discountStore.buildDefinition(Object.assign({}, issued.def, { active: false }), { actor, existing: issued.def });
      if (built.def) await discountStore.saveCode(built.def, deps);
    } catch (e) { /* best-effort */ }
    const winner = await loadReview(id, deps);
    return {
      ok: true,
      alreadyApproved: true,
      review: winner,
      code: winner && winner.issuedCode ? await discountStore.loadCode(winner.issuedCode, deps) : null
    };
  }

  let email = null;
  if (opts.sendEmail !== false) {
    email = await rules.sendIssuedCodeEmail(issued.def, { kind: 'review', name: review.name, lang: review.lang, to: review.email }, deps);
    await recordEmailResult(next.id, email, actor, deps);
  }
  const finalReview = await loadReview(next.id, deps) || next;
  return { ok: true, review: finalReview, code: issued.def, email };
}

async function recordEmailResult(id, result, actor, deps = {}) {
  try {
    const review = await loadReview(id, deps);
    if (!review) return null;
    const at = nowIso(deps);
    review.emailSent = !!(result && result.sent);
    review.emailSentAt = review.emailSent ? at : review.emailSentAt || null;
    review.emailReason = review.emailSent ? null : ((result && result.reason) || 'error');
    review.updatedAt = at;
    review.audit = (Array.isArray(review.audit) ? review.audit.slice(-30) : []).concat([{ at, by: actor || 'system', action: review.emailSent ? 'email_sent' : 'email_failed' }]);
    await saveReview(review, deps);
    return review;
  } catch (e) { return null; }
}

/* Reenvía el correo de una reseña aprobada (p. ej. si falló el primero). */
async function resendReviewEmail(id, { actor } = {}, deps = {}) {
  const review = await loadReview(id, deps);
  if (!review) return { ok: false, status: 404, error: 'Reseña no encontrada.' };
  if (review.status !== STATUS.APPROVED || !review.issuedCode) return { ok: false, status: 409, error: 'Solo se puede reenviar el correo de una reseña aprobada.' };
  const def = await discountStore.loadCode(review.issuedCode, deps);
  if (!def) return { ok: false, status: 404, error: 'El código emitido ya no existe.' };
  const email = await rules.sendIssuedCodeEmail(def, { kind: 'review', name: review.name, lang: review.lang, to: review.email }, deps);
  const updated = await recordEmailResult(review.id, email, actor, deps);
  return { ok: true, review: updated || review, code: def, email };
}

/* Descarta una reseña pendiente (no emite código). */
async function rejectReview(id, { actor, reason } = {}, deps = {}) {
  const { review, etag } = await loadReviewWithEtag(id, deps);
  if (!review) return { ok: false, status: 404, error: 'Reseña no encontrada.' };
  if (review.status === STATUS.APPROVED) return { ok: false, status: 409, error: 'La reseña ya fue aprobada y su código emitido; desactiva el código si hace falta.' };
  if (review.status === STATUS.REJECTED) return { ok: true, review, alreadyRejected: true };
  const at = nowIso(deps);
  const next = Object.assign({}, review, {
    status: STATUS.REJECTED,
    rejectedAt: at,
    rejectedBy: actor || 'system',
    rejectReason: String(reason || '').trim().slice(0, 300) || null,
    updatedAt: at,
    audit: (Array.isArray(review.audit) ? review.audit.slice(-30) : []).concat([{ at, by: actor || 'system', action: 'reject' }])
  });
  const saved = await saveReview(next, deps, { etag });
  if (!saved.ok) return { ok: false, status: 409, error: 'La reseña cambió mientras la descartabas. Recarga e intenta de nuevo.' };
  return { ok: true, review: next };
}

module.exports = {
  REVIEWS_STORE, REVIEW_CLAIMS_STORE, PLATFORMS, STATUS,
  getReviewsStore, getClaimsStore, reviewIdentityKey, claimReviewIdentity, normalizeReviewId, newReviewId,
  buildReview, findDuplicate, loadReview, saveReview, listReviews,
  createReview, approveReview, rejectReview, resendReviewEmail
};
