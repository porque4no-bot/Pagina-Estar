/* Frente codes — reglas/plantillas de descuento, códigos PERSONALES ligados a
 * un email y las nuevas validaciones del camino autoritativo (_discount-store).
 * Sin Blobs ni red reales: store en memoria inyectado (deps.getStore). */

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeBlobs } = require('../helpers/fake-blobs');
const store = require('../../netlify/functions/_discount-store');
const rules = require('../../netlify/functions/_discount-rules');

function deps(extra) { return Object.assign({ getStore: makeBlobs().getStore }, extra || {}); }

function baseRule(over) {
  return rules.buildRule(Object.assign({
    name: 'Gracias por tu reseña', purpose: 'review', prefix: 'RESENA',
    type: 'percent', value: 10, validityMode: 'days', validityDays: 90,
    minNights: 2, singleUse: true, bindEmail: true, active: true,
    blackoutDates: [{ from: '2026-12-20', to: '2027-01-10' }]
  }, over || {}), { actor: 'admin@x.co', now: '2026-10-08T15:00:00Z' });
}

/* ── _discount-store: email ligado ── */
test('buildDefinition: boundEmail se normaliza y se valida', () => {
  const ok = store.buildDefinition({ code: 'BOUND1', type: 'percent', value: 10, boundEmail: '  Ana@Correo.CO ' });
  assert.equal(ok.def.boundEmail, 'ana@correo.co');
  const bad = store.buildDefinition({ code: 'BOUND2', type: 'percent', value: 10, boundEmail: 'no-es-email' });
  assert.ok(bad.error);
  const none = store.buildDefinition({ code: 'BOUND3', type: 'percent', value: 10 });
  assert.equal(none.def.boundEmail, null);
  assert.equal(none.def.origin, 'manual');
});

test('buildDefinition: un update sin la clave boundEmail conserva el email ligado; vacío lo quita', () => {
  const first = store.buildDefinition({ code: 'KEEPB', type: 'percent', value: 10, boundEmail: 'a@b.co' }, {
    meta: { origin: 'personal', ruleId: 'r1', issuedAt: '2026-10-01T00:00:00Z', issuedToEmail: 'a@b.co' }
  }).def;
  const toggled = store.buildDefinition(Object.assign({}, first, { active: true }), { existing: first }).def;
  assert.equal(toggled.boundEmail, 'a@b.co');
  const partial = store.buildDefinition({ code: 'KEEPB', type: 'percent', value: 15 }, { existing: first }).def;
  assert.equal(partial.boundEmail, 'a@b.co');
  const cleared = store.buildDefinition({ code: 'KEEPB', type: 'percent', value: 15, boundEmail: '' }, { existing: first }).def;
  assert.equal(cleared.boundEmail, null);
  /* los campos de emisión son inmutables */
  assert.equal(partial.origin, 'personal');
  assert.equal(partial.ruleId, 'r1');
  assert.equal(partial.issuedToEmail, 'a@b.co');
  const forged = store.buildDefinition({ code: 'KEEPB', type: 'percent', value: 15, origin: 'manual' }, { existing: first, meta: { origin: 'manual' } }).def;
  assert.equal(forged.origin, 'personal');
});

test('checkRules: código ligado rechaza otro email y la ausencia de email (email_mismatch)', () => {
  const def = store.buildDefinition({ code: 'MINE', type: 'percent', value: 10, active: true, boundEmail: 'ana@x.co' }).def;
  assert.equal(store.checkRules(def, { now: '2026-10-08', email: 'otro@x.co' }).reason, 'email_mismatch');
  assert.equal(store.checkRules(def, { now: '2026-10-08' }).reason, 'email_mismatch');
  assert.equal(store.checkRules(def, { now: '2026-10-08', email: ' ANA@x.co ' }).valid, true);
});

test('verifyDiscountCode aplica email ligado, vencimiento, mínimo de noches y fechas bloqueadas', async () => {
  const d = deps();
  await store.saveCode(store.buildDefinition({
    code: 'FULL', type: 'percent', value: 10, active: true, boundEmail: 'ana@x.co',
    validFrom: '2026-10-08', validTo: '2027-01-06', minNights: 2,
    blackoutDates: [{ from: '2026-12-20', to: '2027-01-10' }]
  }).def, d);
  const base = { code: 'FULL', email: 'ana@x.co', nights: 2, checkin: '2026-11-01', checkout: '2026-11-03', subtotalCents: 50000000, now: '2026-10-20' };
  const ok = await store.verifyDiscountCode(base, d);
  assert.equal(ok.valid, true);
  assert.equal(ok.discountCents, 5000000);
  assert.equal((await store.verifyDiscountCode(Object.assign({}, base, { email: 'pepe@x.co' }), d)).reason, 'email_mismatch');
  assert.equal((await store.verifyDiscountCode(Object.assign({}, base, { nights: 1, checkout: '2026-11-02' }), d)).reason, 'min_nights');
  assert.equal((await store.verifyDiscountCode(Object.assign({}, base, { checkin: '2026-12-22', checkout: '2026-12-24' }), d)).reason, 'blackout');
  assert.equal((await store.verifyDiscountCode(Object.assign({}, base, { now: '2027-01-07' }), d)).reason, 'expired');
});

test('todayBogota usa la fecha de Colombia (UTC-5), no la UTC', () => {
  /* 2026-11-01 02:00 UTC = 2026-10-31 21:00 en Bogotá */
  assert.equal(store.todayBogota(Date.parse('2026-11-01T02:00:00Z')), '2026-10-31');
  assert.equal(store.todayBogota(Date.parse('2026-11-01T06:00:00Z')), '2026-11-01');
});

test('createCodeIfNew no pisa un código existente', async () => {
  const d = deps();
  const def = store.buildDefinition({ code: 'UNICO', type: 'percent', value: 5, active: true }).def;
  assert.equal((await store.createCodeIfNew(def, d)).ok, true);
  const again = await store.createCodeIfNew(store.buildDefinition({ code: 'UNICO', type: 'percent', value: 50, active: true }).def, d);
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'exists');
  assert.equal((await store.loadCode('UNICO', d)).value, 5);
});

test('listCodeBookings devuelve las reservas que consumieron el código', async () => {
  const d = deps();
  await store.saveCode(store.buildDefinition({ code: 'USADO', type: 'percent', value: 5, active: true }).def, d);
  await store.consumeDiscountUse('USADO', { email: 'a@b.co', bookingCode: 'EST-111' }, d);
  await store.consumeDiscountUse('USADO', { email: 'c@b.co', bookingCode: 'EST-222' }, d);
  assert.deepEqual((await store.listCodeBookings('USADO', d)).sort(), ['EST-111', 'EST-222']);
  assert.deepEqual(await store.listCodeBookings('NADA', d), []);
});

/* ── buildRule ── */
test('buildRule: regla válida (días desde emisión, un solo uso, ligada a email)', () => {
  const { rule, error } = baseRule();
  assert.equal(error, undefined);
  assert.equal(rule.id, 'gracias-por-tu-resena');
  assert.equal(rule.prefix, 'RESENA');
  assert.equal(rule.purpose, 'review');
  assert.equal(rule.validityDays, 90);
  assert.equal(rule.maxUses, 1);
  assert.equal(rule.bindEmail, true);
  assert.equal(rule.active, true);
  assert.deepEqual(rule.blackoutDates, [{ from: '2026-12-20', to: '2027-01-10' }]);
  assert.equal(rule.audit[0].action, 'create');
});

test('buildRule rechaza entradas inválidas', () => {
  assert.ok(rules.buildRule({ name: '', type: 'percent', value: 10, validityDays: 30 }).error);
  assert.ok(rules.buildRule({ name: 'X regla', type: 'bogus', value: 10, validityDays: 30 }).error);
  assert.ok(rules.buildRule({ name: 'X regla', type: 'percent', value: 150, validityDays: 30 }).error);
  assert.ok(rules.buildRule({ name: 'X regla', type: 'percent', value: 10, validityDays: 0 }).error);
  assert.ok(rules.buildRule({ name: 'X regla', type: 'percent', value: 10, validityDays: 9999 }).error);
  assert.ok(rules.buildRule({ name: 'X regla', type: 'percent', value: 10, validityMode: 'fixed' }).error, 'fechas fijas exige "hasta"');
  assert.ok(rules.buildRule({ name: 'X regla', type: 'percent', value: 10, validityMode: 'fixed', validFrom: '2026-12-01', validTo: '2026-11-01' }).error);
  assert.ok(rules.buildRule({ name: 'X regla', type: 'percent', value: 10, validityDays: 30, blackoutDates: [{ from: '2026-12-10', to: '2026-12-01' }] }).error);
  assert.ok(rules.buildRule({ name: 'X regla', type: 'fixed', value: 20000, validityDays: 30, maxUses: -1 }).error);
});

test('buildRule: update conserva id/createdAt y singleUse fuerza maxUses=1', () => {
  const first = baseRule().rule;
  const upd = rules.buildRule(Object.assign({}, first, { name: 'Otro nombre', value: 15, singleUse: false, maxUses: 3 }), { existing: first, actor: 'b@x.co', now: '2026-10-09T00:00:00Z' }).rule;
  assert.equal(upd.id, first.id, 'el id no cambia al renombrar');
  assert.equal(upd.createdAt, first.createdAt);
  assert.equal(upd.maxUses, 3);
  assert.equal(upd.audit[upd.audit.length - 1].action, 'update');
  const single = rules.buildRule(Object.assign({}, first, { singleUse: true, maxUses: 9 }), { existing: first }).rule;
  assert.equal(single.maxUses, 1);
});

/* ── generación ── */
test('generateCode: PREFIJO-XXXXXXXX con alfabeto sin caracteres ambiguos', () => {
  for (let i = 0; i < 50; i++) {
    const c = rules.generateCode('Reseña');
    assert.match(c, /^RESENA-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  }
});

test('codeInputFromRule: vigencia por días = hoy (Bogotá) + N; fechas fijas se copian', () => {
  const r = baseRule().rule;
  const inp = rules.codeInputFromRule(r, { code: 'X-1', email: 'a@b.co', today: '2026-10-08' });
  assert.equal(inp.validFrom, '2026-10-08');
  assert.equal(inp.validTo, '2027-01-06');
  assert.equal(inp.maxUses, 1);
  assert.equal(inp.minNights, 2);
  assert.equal(inp.boundEmail, 'a@b.co');
  const fixed = rules.buildRule({ name: 'Navidad', type: 'fixed', value: 30000, validityMode: 'fixed', validFrom: '2026-11-01', validTo: '2026-11-30', bindEmail: false, active: true }).rule;
  const inp2 = rules.codeInputFromRule(fixed, { code: 'X-2', email: 'a@b.co', today: '2026-10-08' });
  assert.equal(inp2.validFrom, '2026-11-01');
  assert.equal(inp2.validTo, '2026-11-30');
  assert.equal(inp2.boundEmail, '', 'regla sin "ligado a email" no liga el código');
});

/* ── emisión ── */
test('issueCodeFromRule: emite un código único ligado al email, con metadatos de emisión', async () => {
  const d = deps({ now: () => '2026-10-08T15:00:00Z' });
  const rule = await rules.saveRule(baseRule().rule, d);
  const res = await rules.issueCodeFromRule(rule.id, { email: 'Ana@X.co', name: 'Ana', note: 'Compensación', actor: 'admin@x.co', today: '2026-10-08' }, d);
  assert.equal(res.ok, true);
  const def = res.def;
  assert.match(def.code, /^RESENA-/);
  assert.equal(def.boundEmail, 'ana@x.co');
  assert.equal(def.origin, 'personal');
  assert.equal(def.ruleId, rule.id);
  assert.equal(def.issuedToEmail, 'ana@x.co');
  assert.equal(def.issuedToName, 'Ana');
  assert.equal(def.description, 'Compensación');
  assert.equal(def.active, true);
  assert.equal(def.maxUses, 1);
  /* y el camino autoritativo lo respeta */
  const saved = await store.loadCode(def.code, d);
  assert.equal(saved.boundEmail, 'ana@x.co');
  const v = await store.verifyDiscountCode({ code: def.code, email: 'otro@x.co', nights: 3, now: '2026-10-10' }, d);
  assert.equal(v.reason, 'email_mismatch');
  const v2 = await store.verifyDiscountCode({ code: def.code, email: 'ana@x.co', nights: 3, checkin: '2026-11-01', checkout: '2026-11-04', now: '2026-10-10', subtotalCents: 10000000 }, d);
  assert.equal(v2.valid, true);
  assert.equal(v2.discountCents, 1000000);
});

test('issueCodeFromRule: código personalizado escrito por el admin; duplicado ⇒ 409', async () => {
  const d = deps();
  const rule = await rules.saveRule(baseRule().rule, d);
  const a = await rules.issueCodeFromRule(rule, { email: 'a@b.co', code: 'anamaria10' }, d);
  assert.equal(a.ok, true);
  assert.equal(a.def.code, 'ANAMARIA10');
  const b = await rules.issueCodeFromRule(rule, { email: 'c@b.co', code: 'ANAMARIA10' }, d);
  assert.equal(b.ok, false);
  assert.equal(b.status, 409);
});

test('issueCodeFromRule: reintenta si el aleatorio colisiona', async () => {
  /* randomInt determinista: la 1.ª generación da AAAAAAAA (ya existe), la 2.ª BBBBBBBB */
  let call = 0;
  const d = deps({ randomInt: () => (call++ < 8 ? 0 : 1) });
  const rule = await rules.saveRule(baseRule().rule, d);
  await store.saveCode(store.buildDefinition({ code: 'RESENA-AAAAAAAA', type: 'percent', value: 1, active: true }).def, d);
  const res = await rules.issueCodeFromRule(rule, { email: 'a@b.co' }, d);
  assert.equal(res.ok, true);
  assert.equal(res.def.code, 'RESENA-BBBBBBBB');
  assert.equal((await store.loadCode('RESENA-AAAAAAAA', d)).value, 1, 'no pisa el existente');
});

test('issueCodeFromRule: regla inactiva, email inválido o vigencia fija vencida ⇒ error', async () => {
  const d = deps();
  const inactive = await rules.saveRule(baseRule({ name: 'Inactiva', active: false }).rule, d);
  assert.equal((await rules.issueCodeFromRule(inactive, { email: 'a@b.co' }, d)).status, 409);
  const active = await rules.saveRule(baseRule().rule, d);
  assert.equal((await rules.issueCodeFromRule(active, { email: 'nope' }, d)).status, 400);
  assert.equal((await rules.issueCodeFromRule('no-existe', { email: 'a@b.co' }, d)).status, 404);
  const old = await rules.saveRule(rules.buildRule({ name: 'Vieja', type: 'percent', value: 10, validityMode: 'fixed', validTo: '2026-01-31', active: true }).rule, d);
  assert.equal((await rules.issueCodeFromRule(old, { email: 'a@b.co', today: '2026-10-08' }, d)).status, 409);
});

test('pickReviewRule elige la regla de reseña ACTIVA más reciente', () => {
  const a = baseRule({ name: 'Reseña A' }).rule; a.updatedAt = '2026-10-01T00:00:00Z';
  const b = baseRule({ name: 'Reseña B' }).rule; b.updatedAt = '2026-10-05T00:00:00Z';
  const c = baseRule({ name: 'Reseña C', active: false }).rule; c.updatedAt = '2026-10-07T00:00:00Z';
  const g = baseRule({ name: 'General', purpose: 'general' }).rule; g.updatedAt = '2026-10-08T00:00:00Z';
  assert.equal(rules.pickReviewRule([a, b, c, g]).name, 'Reseña B');
  assert.equal(rules.pickReviewRule([c, g]), null);
});

test('listRules / loadRule / saveRule (store en memoria)', async () => {
  const d = deps();
  await rules.saveRule(baseRule({ name: 'Uno' }).rule, d);
  await rules.saveRule(baseRule({ name: 'Dos' }).rule, d);
  const list = await rules.listRules(d);
  assert.deepEqual(list.map(r => r.id).sort(), ['dos', 'uno']);
  assert.equal((await rules.loadRule('UNO', d)).name, 'Uno');
  assert.equal(await rules.loadRule('', d), null);
});

test('mapLimit conserva el orden y no supera la concurrencia pedida', async () => {
  let inFlight = 0;
  let peak = 0;
  const out = await store.mapLimit([5, 1, 4, 2, 3, 0, 6], 3, async (n) => {
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise(r => setTimeout(r, n));
    inFlight--;
    return n * 10;
  });
  assert.deepEqual(out, [50, 10, 40, 20, 30, 0, 60]);
  assert.ok(peak <= 3);
  assert.deepEqual(await store.mapLimit([], 8, async () => 1), []);
});

test('describeDiscount: porcentaje y valor fijo en ES/EN', () => {
  assert.equal(rules.describeDiscount({ type: 'percent', value: 15 }, 'es'), '15% de descuento');
  assert.equal(rules.describeDiscount({ type: 'percent', value: 15 }, 'en'), '15% off');
  assert.equal(rules.describeDiscount({ type: 'fixed', value: 50000 }, 'es'), '$50.000 de descuento');
  assert.equal(rules.describeDiscount({ type: 'fixed', value: 50000 }, 'en'), '$50.000 COP off');
});

test('sendIssuedCodeEmail: arma asunto/HTML en el idioma pedido y manda al email emitido', async () => {
  const sent = [];
  const d = deps({ sendEmail: async (m) => { sent.push(m); return { sent: true, id: 'x' }; } });
  const rule = await rules.saveRule(baseRule().rule, d);
  const { def } = await rules.issueCodeFromRule(rule, { email: 'ana@x.co', name: 'Ana', today: '2026-10-08' }, d);
  const r = await rules.sendIssuedCodeEmail(def, { kind: 'personal', name: 'Ana', lang: 'en' }, d);
  assert.equal(r.sent, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'ana@x.co');
  assert.match(sent[0].subject, /personal estar discount code/i);
  assert.ok(sent[0].html.includes(def.code));
  assert.ok(sent[0].html.includes('/en/reservar.html?codigo=' + def.code));
  /* falla del proveedor → { sent:false } sin lanzar */
  const bad = await rules.sendIssuedCodeEmail(def, { kind: 'review', lang: 'es' }, { sendEmail: async () => { throw new Error('boom'); } });
  assert.equal(bad.sent, false);
});
