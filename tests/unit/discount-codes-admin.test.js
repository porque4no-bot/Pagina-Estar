/* Frente codes — handlers: admin-discount-codes (reglas, código personalizado,
 * reseñas) y validate-discount-code (email ligado). @netlify/blobs se reemplaza
 * por un fake en memoria en require.cache, _authz por un stub que registra el
 * permiso pedido, y el envío de correo por una función que solo registra.
 * Nada sale a red (node --test aísla cada archivo en su propio proceso). */

const test = require('node:test');
const assert = require('node:assert/strict');
const { installFakeBlobsModule } = require('../helpers/fake-blobs');

/* El fake debe instalarse ANTES de requerir cualquier módulo que importe
   getStore al cargar (_discount-store, _settings, _rate-limit…). */
installFakeBlobsModule();

const P = (m) => require.resolve('../../netlify/functions/' + m);
const askedPerms = [];
let authOk = true;
require.cache[P('_authz')] = {
  id: P('_authz'), filename: P('_authz'), loaded: true,
  exports: {
    authorize: async (event, perm) => {
      askedPerms.push(perm);
      return authOk ? { ok: true, email: 'admin@estar.co' } : { ok: false, statusCode: 403, error: 'Sin permiso' };
    }
  }
};

delete process.env.RESEND_API_KEY;
const email = require('../../netlify/functions/_email');
const sentMails = [];
email.sendEmail = async (m) => { sentMails.push(m); return { sent: true, id: 'fake' }; };

const admin = require('../../netlify/functions/admin-discount-codes');
const validate = require('../../netlify/functions/validate-discount-code');
const store = require('../../netlify/functions/_discount-store');

async function call(action, payload) {
  const res = await admin.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer x' }, body: JSON.stringify(Object.assign({ action }, payload || {})) });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

const REVIEW_RULE = {
  name: 'Gracias por tu reseña', purpose: 'review', prefix: 'GRACIAS', type: 'percent', value: 10,
  validityMode: 'days', validityDays: 90, minNights: 2, singleUse: true, bindEmail: true, active: true
};

test('permisos: lecturas piden quotes.view y escrituras quotes.edit (sin permisos nuevos)', async () => {
  askedPerms.length = 0;
  await call('rule-list');
  await call('review-list');
  await call('rule-create', Object.assign({}, REVIEW_RULE, { name: 'Permisos', purpose: 'general' }));
  await call('review-create', { email: 'p@x.co', platform: 'google' });
  assert.deepEqual(askedPerms, ['quotes.view', 'quotes.view', 'quotes.edit', 'quotes.edit']);
});

test('sin permiso ⇒ 403 y no escribe', async () => {
  authOk = false;
  try {
    const r = await call('rule-create', Object.assign({}, REVIEW_RULE, { name: 'Prohibida', purpose: 'general' }));
    assert.equal(r.status, 403);
  } finally { authOk = true; }
  const list = await call('rule-list');
  assert.ok(!list.body.rules.some(r => r.name === 'Prohibida'));
});

test('flujo completo: regla de reseña → registrar y aprobar ⇒ código ligado enviado por correo', async () => {
  sentMails.length = 0;
  const created = await call('rule-create', REVIEW_RULE);
  assert.equal(created.status, 200);
  assert.equal(created.body.rule.id, 'gracias-por-tu-resena');
  const dup = await call('rule-create', REVIEW_RULE);
  assert.equal(dup.status, 409);

  const r = await call('review-create', {
    email: 'Huesped@Correo.co', name: 'Laura', bookingCode: 'EST-555', platform: 'booking',
    link: 'https://www.booking.com/reviews/x', lang: 'es', approve: true
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.review.status, 'approved');
  assert.equal(r.body.discountEnabled, false, 'informa que el flag público está apagado');
  const code = r.body.code;
  assert.match(code.code, /^GRACIAS-/);
  assert.equal(code.boundEmail, 'huesped@correo.co');
  assert.equal(code.origin, 'review');
  assert.equal(sentMails.length, 1);
  assert.equal(sentMails[0].to, 'huesped@correo.co');
  assert.match(sentMails[0].subject, /Gracias por tu reseña/);

  /* aparece en el listado de códigos con su origen, y la reseña en el historial */
  const list = await call('list');
  const found = list.body.codes.find(c => c.code === code.code);
  assert.ok(found);
  assert.equal(found.origin, 'review');
  assert.equal(found.usedCount, 0);
  const revs = await call('review-list');
  assert.ok(revs.body.reviews.some(v => v.issuedCode === code.code && v.emailSent === true));

  /* se marca como usado (con la reserva) cuando el webhook lo consume */
  await store.consumeDiscountUse(code.code, { email: 'huesped@correo.co', bookingCode: 'EST-777' });
  const after = await call('get', { code: code.code });
  assert.equal(after.body.code.usedCount, 1);
  assert.deepEqual(after.body.code.usedBy, ['EST-777']);
});

test('reseña pendiente → review-approve (idempotente) y review-reject', async () => {
  const a = await call('review-create', { email: 'otro@correo.co', name: 'Pedro', platform: 'tripadvisor' });
  assert.equal(a.status, 200);
  assert.equal(a.body.review.status, 'pending');
  const ap1 = await call('review-approve', { id: a.body.review.id });
  const ap2 = await call('review-approve', { id: a.body.review.id });
  assert.equal(ap1.status, 200);
  assert.equal(ap2.body.alreadyApproved, true);
  assert.equal(ap2.body.code.code, ap1.body.code.code);

  const b = await call('review-create', { email: 'tercero@correo.co', platform: 'google' });
  const rej = await call('review-reject', { id: b.body.review.id, reason: 'no existe' });
  assert.equal(rej.status, 200);
  assert.equal(rej.body.review.status, 'rejected');
  const bad = await call('review-approve', { id: b.body.review.id });
  assert.equal(bad.status, 409);
  const missing = await call('review-approve', { id: 'REV-NOPE' });
  assert.equal(missing.status, 404);
});

test('review-create con datos inválidos ⇒ 400', async () => {
  const r = await call('review-create', { email: 'no-email', platform: 'google' });
  assert.equal(r.status, 400);
  const r2 = await call('review-create', { email: 'a@b.co', platform: 'myspace' });
  assert.equal(r2.status, 400);
});

test('issue: genera un código personalizado desde una regla y lo envía si se pide', async () => {
  sentMails.length = 0;
  const rule = await call('rule-create', { name: 'Compensación', purpose: 'general', prefix: 'ESTAR', type: 'fixed', value: 50000, validityDays: 60, bindEmail: true, singleUse: true, active: true });
  assert.equal(rule.status, 200);
  const r = await call('issue', { ruleId: rule.body.rule.id, email: 'cliente@x.co', name: 'Clara', note: 'Ruido en la noche', lang: 'en', sendEmail: true });
  assert.equal(r.status, 200);
  assert.match(r.body.code.code, /^ESTAR-[A-Z2-9]{8}$/);
  assert.equal(r.body.code.origin, 'personal');
  assert.equal(r.body.code.boundEmail, 'cliente@x.co');
  assert.equal(r.body.code.type, 'fixed');
  assert.equal(r.body.email.sent, true);
  assert.equal(sentMails.length, 1);
  assert.match(sentMails[0].subject, /personal estar discount code/i);

  const custom = await call('issue', { ruleId: rule.body.rule.id, email: 'cliente@x.co', code: 'clara50' });
  assert.equal(custom.body.code.code, 'CLARA50');
  assert.equal(sentMails.length, 1, 'sin sendEmail no envía');
  const again = await call('issue', { ruleId: rule.body.rule.id, email: 'x@x.co', code: 'CLARA50' });
  assert.equal(again.status, 409);
  const noRule = await call('issue', { ruleId: 'nope', email: 'x@x.co' });
  assert.equal(noRule.status, 404);
});

test('rule-deactivate impide emitir; rule-update conserva el id', async () => {
  const rule = await call('rule-create', { name: 'Temporal', type: 'percent', value: 5, validityDays: 10, active: true });
  const off = await call('rule-deactivate', { id: rule.body.rule.id });
  assert.equal(off.body.rule.active, false);
  const blocked = await call('issue', { ruleId: rule.body.rule.id, email: 'a@b.co' });
  assert.equal(blocked.status, 409);
  const upd = await call('rule-update', Object.assign({}, off.body.rule, { name: 'Temporal renombrada', value: 7 }));
  assert.equal(upd.body.rule.id, rule.body.rule.id);
  assert.equal(upd.body.rule.value, 7);
});

test('update de un código emitido desde el panel no lo desliga del email ni cambia su origen', async () => {
  const rule = await call('rule-create', { name: 'Edición', type: 'percent', value: 5, validityDays: 10, active: true });
  const issued = await call('issue', { ruleId: rule.body.rule.id, email: 'fijo@x.co' });
  const code = issued.body.code;
  /* el form manual de edición no manda origin; sí manda boundEmail */
  const upd = await call('update', { code: code.code, type: 'percent', value: 8, active: true, boundEmail: 'fijo@x.co' });
  assert.equal(upd.body.code.boundEmail, 'fijo@x.co');
  assert.equal(upd.body.code.origin, 'personal');
  const off = await call('deactivate', { code: code.code });
  assert.equal(off.body.code.boundEmail, 'fijo@x.co');
  assert.equal(off.body.code.active, false);
});

/* ── validate-discount-code (público, detrás de DISCOUNT_CODES_ENABLED) ── */
test('validate-discount-code: código ligado a otro email ⇒ reason email_mismatch; el correcto ⇒ válido', async () => {
  const prev = process.env.DISCOUNT_CODES_ENABLED;
  process.env.DISCOUNT_CODES_ENABLED = 'true';
  try {
    await store.saveCode(store.buildDefinition({ code: 'SOLOANA', type: 'percent', value: 10, active: true, boundEmail: 'ana@x.co' }).def);
    const ev = (q) => ({ httpMethod: 'GET', headers: { 'x-nf-client-connection-ip': '10.0.0.' + Math.floor(Math.random() * 200) }, queryStringParameters: q });
    const wrong = JSON.parse((await validate.handler(ev({ code: 'SOLOANA', email: 'pepe@x.co', subtotalCents: '10000000' }))).body);
    assert.equal(wrong.valid, false);
    assert.equal(wrong.reason, 'email_mismatch');
    assert.ok(!JSON.stringify(wrong).includes('ana@x.co'), 'no revela el email ligado');
    const right = JSON.parse((await validate.handler(ev({ code: 'SOLOANA', email: 'ANA@x.co', subtotalCents: '10000000' }))).body);
    assert.equal(right.valid, true);
    assert.equal(right.discountCents, 1000000);
  } finally {
    if (prev === undefined) delete process.env.DISCOUNT_CODES_ENABLED; else process.env.DISCOUNT_CODES_ENABLED = prev;
  }
});

test('validate-discount-code sigue apagado por defecto (la parte pública depende del flag)', async () => {
  const prev = process.env.DISCOUNT_CODES_ENABLED;
  delete process.env.DISCOUNT_CODES_ENABLED;
  try {
    const res = JSON.parse((await validate.handler({ httpMethod: 'GET', headers: {}, queryStringParameters: { code: 'SOLOANA', email: 'ana@x.co' } })).body);
    assert.equal(res.enabled, false);
    assert.equal(res.valid, false);
  } finally {
    if (prev !== undefined) process.env.DISCOUNT_CODES_ENABLED = prev;
  }
});
