/* Frente codes — flujo de reseñas: registrar → aprobar ⇒ se emite un código
 * personal desde la regla de reseña, ligado al email, y se envía por correo.
 * Idempotencia (doble clic / dos admins), descarte, reenvío y deduplicación.
 * Store en memoria inyectado; envío de correo inyectado (sin Resend real). */

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeBlobs } = require('../helpers/fake-blobs');
const store = require('../../netlify/functions/_discount-store');
const rules = require('../../netlify/functions/_discount-rules');
const reviews = require('../../netlify/functions/_discount-reviews');

function setup(opts = {}) {
  const sent = [];
  const d = {
    getStore: makeBlobs().getStore,
    sendEmail: opts.sendEmail || (async (m) => { sent.push(m); return { sent: true, id: 'mail-1' }; })
  };
  return { d, sent };
}

async function seedReviewRule(d, over) {
  const { rule } = rules.buildRule(Object.assign({
    name: 'Reseña verificada', purpose: 'review', prefix: 'GRACIAS',
    type: 'percent', value: 12, validityMode: 'days', validityDays: 120,
    minNights: 2, singleUse: true, bindEmail: true, active: true,
    blackoutDates: [{ from: '2027-01-02', to: '2027-01-10' }]
  }, over || {}), { actor: 'admin@x.co' });
  return rules.saveRule(rule, d);
}

const INPUT = { email: 'Ana@Correo.co', name: 'Ana Gómez', bookingCode: 'est-123', platform: 'google', link: 'https://g.page/r/abc', lang: 'en', note: '5 estrellas' };

test('buildReview valida email, plataforma y enlace', () => {
  assert.ok(reviews.buildReview(Object.assign({}, INPUT, { email: 'x' })).error);
  assert.ok(reviews.buildReview(Object.assign({}, INPUT, { platform: 'facebook' })).error);
  assert.ok(reviews.buildReview(Object.assign({}, INPUT, { link: 'javascript:alert(1)' })).error);
  assert.ok(reviews.buildReview(Object.assign({}, INPUT, { link: 'no es url' })).error);
  const { review } = reviews.buildReview(Object.assign({}, INPUT, { platform: 'TripAdvisor', link: '' }), { id: 'REV-1' });
  assert.equal(review.email, 'ana@correo.co');
  assert.equal(review.platform, 'tripadvisor');
  assert.equal(review.bookingCode, 'EST-123');
  assert.equal(review.link, null);
  assert.equal(review.status, 'pending');
  assert.equal(review.lang, 'en');
});

test('createReview registra pendientes y rechaza duplicados (misma plataforma + reserva)', async () => {
  const { d } = setup();
  const a = await reviews.createReview(INPUT, { actor: 'admin@x.co' }, d);
  assert.equal(a.ok, true);
  assert.match(a.review.id, /^REV-\d{8}-[A-Z0-9]{6}$/);
  const dup = await reviews.createReview(INPUT, { actor: 'admin@x.co' }, d);
  assert.equal(dup.ok, false);
  assert.equal(dup.status, 409);
  /* misma reserva en OTRA plataforma sí se permite */
  const other = await reviews.createReview(Object.assign({}, INPUT, { platform: 'booking' }), {}, d);
  assert.equal(other.ok, true);
  const list = await reviews.listReviews(d);
  assert.equal(list.length, 2);
  assert.ok(list.every(r => r.status === 'pending'));
});

test('approveReview sin regla de reseña activa ⇒ 409 y la reseña sigue pendiente', async () => {
  const { d, sent } = setup();
  await seedReviewRule(d, { active: false });
  const { review } = await reviews.createReview(INPUT, {}, d);
  const r = await reviews.approveReview(review.id, { actor: 'admin@x.co' }, d);
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.equal((await reviews.loadReview(review.id, d)).status, 'pending');
  assert.equal(sent.length, 0);
});

test('approveReview emite el código desde la regla de reseña, ligado al email, y lo envía por correo', async () => {
  const { d, sent } = setup();
  const rule = await seedReviewRule(d);
  const { review } = await reviews.createReview(INPUT, { actor: 'admin@x.co' }, d);
  const r = await reviews.approveReview(review.id, { actor: 'admin@x.co' }, d);
  assert.equal(r.ok, true);
  assert.equal(r.alreadyApproved, undefined);
  const code = r.code;
  assert.match(code.code, /^GRACIAS-/);
  assert.equal(code.origin, 'review');
  assert.equal(code.reviewId, review.id);
  assert.equal(code.ruleId, rule.id);
  assert.equal(code.boundEmail, 'ana@correo.co');
  assert.equal(code.maxUses, 1);
  assert.equal(code.minNights, 2);
  assert.equal(code.lang, 'en');
  /* correo enviado en el idioma de la reseña */
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'ana@correo.co');
  assert.match(sent[0].subject, /Thank you for your review/);
  assert.ok(sent[0].html.includes(code.code));
  /* registro de la reseña */
  const saved = await reviews.loadReview(review.id, d);
  assert.equal(saved.status, 'approved');
  assert.equal(saved.issuedCode, code.code);
  assert.equal(saved.approvedBy, 'admin@x.co');
  assert.equal(saved.emailSent, true);
  /* y el camino autoritativo: solo Ana, mín. 2 noches, fuera del bloqueo */
  const today = store.todayBogota();
  assert.equal((await store.verifyDiscountCode({ code: code.code, email: 'pepe@x.co', nights: 3, now: today }, d)).reason, 'email_mismatch');
  assert.equal((await store.verifyDiscountCode({ code: code.code, email: 'ana@correo.co', nights: 1, now: today }, d)).reason, 'min_nights');
  assert.equal((await store.verifyDiscountCode({ code: code.code, email: 'ana@correo.co', nights: 2, checkin: '2027-01-03', checkout: '2027-01-05', now: today }, d)).reason, 'blackout');
  assert.equal((await store.verifyDiscountCode({ code: code.code, email: 'ana@correo.co', nights: 2, now: today }, d)).valid, true);
  /* un solo uso: tras consumirse queda agotado */
  await store.consumeDiscountUse(code.code, { email: 'ana@correo.co', bookingCode: 'EST-900' }, d);
  assert.equal((await store.verifyDiscountCode({ code: code.code, email: 'ana@correo.co', nights: 2, now: today }, d)).valid, false);
  assert.deepEqual(await store.listCodeBookings(code.code, d), ['EST-900']);
});

test('approveReview es idempotente: re-aprobar devuelve el mismo código y no reenvía', async () => {
  const { d, sent } = setup();
  await seedReviewRule(d);
  const { review } = await reviews.createReview(INPUT, {}, d);
  const first = await reviews.approveReview(review.id, { actor: 'a@x.co' }, d);
  const second = await reviews.approveReview(review.id, { actor: 'b@x.co' }, d);
  assert.equal(second.ok, true);
  assert.equal(second.alreadyApproved, true);
  assert.equal(second.code.code, first.code.code);
  assert.equal(sent.length, 1);
  const issued = (await store.listCodes(d)).filter(c => c.origin === 'review');
  assert.equal(issued.length, 1);
});

test('dos aprobaciones simultáneas: solo una emite un código activo', async () => {
  const { d, sent } = setup();
  await seedReviewRule(d);
  const { review } = await reviews.createReview(INPUT, {}, d);
  const [a, b] = await Promise.all([
    reviews.approveReview(review.id, { actor: 'a@x.co' }, d),
    reviews.approveReview(review.id, { actor: 'b@x.co' }, d)
  ]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.code.code, b.code.code, 'ambos ven el código ganador');
  const active = (await store.listCodes(d)).filter(c => c.origin === 'review' && c.active);
  assert.equal(active.length, 1, 'el código del perdedor queda desactivado');
  assert.equal(sent.length, 1, 'solo el ganador envía correo');
  assert.equal((await reviews.loadReview(review.id, d)).issuedCode, active[0].code);
});

test('approveReview con sendEmail:false no envía; resend lo envía después', async () => {
  const { d, sent } = setup();
  await seedReviewRule(d);
  const { review } = await reviews.createReview(INPUT, {}, d);
  const r = await reviews.approveReview(review.id, { sendEmail: false }, d);
  assert.equal(r.ok, true);
  assert.equal(r.email, null);
  assert.equal(sent.length, 0);
  const again = await reviews.resendReviewEmail(review.id, { actor: 'a@x.co' }, d);
  assert.equal(again.ok, true);
  assert.equal(again.email.sent, true);
  assert.equal(sent.length, 1);
  assert.equal((await reviews.loadReview(review.id, d)).emailSent, true);
});

test('si el correo falla, la aprobación se mantiene y queda marcado emailSent=false', async () => {
  const { d } = setup({ sendEmail: async () => ({ sent: false, reason: 'no-key' }) });
  await seedReviewRule(d);
  const { review } = await reviews.createReview(INPUT, {}, d);
  const r = await reviews.approveReview(review.id, {}, d);
  assert.equal(r.ok, true);
  assert.equal(r.email.sent, false);
  const saved = await reviews.loadReview(review.id, d);
  assert.equal(saved.status, 'approved');
  assert.equal(saved.emailSent, false);
  assert.equal(saved.emailReason, 'no-key');
});

test('rejectReview descarta una pendiente; una descartada no se puede aprobar ni una aprobada descartar', async () => {
  const { d } = setup();
  await seedReviewRule(d);
  const { review } = await reviews.createReview(INPUT, {}, d);
  const rej = await reviews.rejectReview(review.id, { actor: 'a@x.co', reason: 'No encontramos la reseña' }, d);
  assert.equal(rej.ok, true);
  assert.equal(rej.review.status, 'rejected');
  assert.equal(rej.review.rejectReason, 'No encontramos la reseña');
  assert.equal((await reviews.approveReview(review.id, {}, d)).status, 409);
  /* tras descartarla, se puede volver a registrar la misma reseña */
  const again = await reviews.createReview(INPUT, {}, d);
  assert.equal(again.ok, true);
  await reviews.approveReview(again.review.id, {}, d);
  assert.equal((await reviews.rejectReview(again.review.id, {}, d)).status, 409);
});

test('approveReview con ruleId explícito usa esa regla', async () => {
  const { d } = setup();
  await seedReviewRule(d);
  const { rule: other } = rules.buildRule({ name: 'Super fan', purpose: 'general', prefix: 'FAN', type: 'fixed', value: 40000, validityDays: 30, active: true });
  await rules.saveRule(other, d);
  const { review } = await reviews.createReview(INPUT, {}, d);
  const r = await reviews.approveReview(review.id, { ruleId: 'super-fan' }, d);
  assert.equal(r.ok, true);
  assert.match(r.code.code, /^FAN-/);
  assert.equal(r.code.type, 'fixed');
  assert.equal(r.code.value, 40000);
});

test('listReviews: pendientes primero', async () => {
  const { d } = setup();
  await seedReviewRule(d);
  const a = await reviews.createReview(INPUT, {}, d);
  await reviews.approveReview(a.review.id, {}, d);
  await reviews.createReview(Object.assign({}, INPUT, { email: 'b@x.co', bookingCode: 'EST-2' }), {}, d);
  const list = await reviews.listReviews(d);
  assert.equal(list[0].status, 'pending');
  assert.equal(list[1].status, 'approved');
});

/* Hallazgo de revisión: la deduplicación no era atómica. Dos altas
   simultáneas (doble clic en "Agregar a pendientes") listaban antes de que la
   otra guardara y quedaban DOS reseñas pendientes ⇒ dos códigos al aprobar. */
test('dos altas simultáneas de la misma reseña: solo una queda registrada', async () => {
  const { d } = setup();
  const results = await Promise.all([
    reviews.createReview(INPUT, { actor: 'admin@x.co' }, d),
    reviews.createReview(INPUT, { actor: 'admin@x.co' }, d),
    reviews.createReview(INPUT, { actor: 'admin@x.co' }, d)
  ]);
  assert.equal(results.filter(r => r.ok).length, 1, 'solo una alta gana');
  assert.ok(results.filter(r => !r.ok).every(r => r.status === 409));
  assert.equal((await reviews.listReviews(d)).length, 1);
});

test('una alta en vuelo (reclamo reciente sin reseña aún) bloquea el duplicado; un reclamo huérfano viejo se retoma', async () => {
  const { d } = setup();
  const { review } = reviews.buildReview(INPUT, { id: 'REV-20260101-AAAAAA', now: new Date().toISOString() });
  const claimsStore = reviews.getClaimsStore(d);
  const key = reviews.reviewIdentityKey(review);
  await claimsStore.set(key, JSON.stringify({ reviewId: 'REV-20260101-AAAAAA', at: new Date().toISOString() }));
  const blocked = await reviews.createReview(INPUT, {}, d);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, 409);
  /* El mismo reclamo, pero de hace una hora y sin reseña guardada: se retoma. */
  await claimsStore.set(key, JSON.stringify({ reviewId: 'REV-20260101-AAAAAA', at: new Date(Date.now() - 3600e3).toISOString() }));
  const ok = await reviews.createReview(INPUT, {}, d);
  assert.equal(ok.ok, true);
});

test('duplicados heredados (sin reclamo): aprobar el segundo no emite otro código', async () => {
  const { d, sent } = setup();
  await seedReviewRule(d);
  const a = reviews.buildReview(INPUT, { id: 'REV-20260101-AAAAAA', now: new Date().toISOString() }).review;
  const b = reviews.buildReview(INPUT, { id: 'REV-20260101-BBBBBB', now: new Date().toISOString() }).review;
  await reviews.saveReview(a, d);
  await reviews.saveReview(b, d);
  assert.equal((await reviews.approveReview(a.id, {}, d)).ok, true);
  const second = await reviews.approveReview(b.id, {}, d);
  assert.equal(second.ok, false);
  assert.equal(second.status, 409);
  assert.equal((await reviews.loadReview(b.id, d)).status, 'pending');
  assert.equal((await store.listCodes(d)).filter(c => c.origin === 'review').length, 1);
  assert.equal(sent.length, 1);
});
