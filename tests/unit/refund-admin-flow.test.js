/* Frente cancel — refund-admin-action de punta a punta: "Aprobar" hace todo
 * (cancelar en Kunas o dejar la tarea, devolver por Mercado Pago o dejar la tarea,
 * avisar al huésped), "Denegar" avisa con el motivo, "Marcar reembolsado" avisa y
 * cierra la tarea; caso especial; permisos por acción; nunca se filtra el sobre
 * cifrado. Sin red: Blobs en memoria, OTASync / Mercado Pago falsos y el correo
 * (Resend) interceptado en fetch. node --test aísla este archivo en su proceso. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.GUEST_APP_DATA_ENCRYPTION_KEY = 'unit-test-refund-flow-key';
process.env.RESEND_API_KEY = 're_test_fake';
process.env.ALERT_ENABLED = 'false';
delete process.env.OTASYNC_AUTO_CANCEL_ENABLED;
delete process.env.REFUND_GATEWAY_AUTO_ENABLED;
delete process.env.REFUND_BANK_FORM_ENABLED;

/* ── Blobs en memoria ── */
const registry = new Map();
const etagOf = (v) => require('crypto').createHash('sha1').update(String(v)).digest('hex');
function memStore(name) {
  if (!registry.has(name)) {
    const m = new Map();
    registry.set(name, {
      _m: m,
      async set(key, value, opts = {}) {
        if (opts.onlyIfNew && m.has(key)) return { modified: false };
        if (opts.onlyIfMatch && (!m.has(key) || etagOf(m.get(key)) !== opts.onlyIfMatch)) return { modified: false };
        m.set(key, value);
        return { modified: true };
      },
      async get(key) { return m.has(key) ? m.get(key) : null; },
      async getWithMetadata(key) {
        if (!m.has(key)) return null;
        const data = m.get(key);
        /* cede el turno: deja que dos peticiones concurrentes lean el mismo etag */
        await new Promise(r => setImmediate(r));
        return { data, etag: etagOf(data) };
      },
      async list(opts = {}) { return { blobs: Array.from(m.keys()).filter(k => !opts.prefix || k.startsWith(opts.prefix)).map(key => ({ key })) }; },
      async delete(key) { m.delete(key); }
    });
  }
  return registry.get(name);
}
const P = (m) => require.resolve('../../netlify/functions/' + m);
function fake(id, exportsObj) { require.cache[id] = { id, filename: id, loaded: true, exports: exportsObj }; }
const blobsPath = require.resolve('@netlify/blobs');
fake(blobsPath, { getStore: (opts) => memStore(typeof opts === 'string' ? opts : opts.name) });

/* ── Identidad / permisos ── */
const ALL = ['refunds.view', 'refunds.approve', 'refunds.deny', 'refunds.set_amount', 'refunds.mark_done'];
const authState = { perms: ALL.slice(), asked: [] };
fake(P('_authz'), {
  authorize: async (event, perm) => {
    authState.asked.push(perm);
    if (perm && !authState.perms.includes(perm)) return { ok: false, statusCode: 403, error: 'No tienes permiso para esta acción' };
    return { ok: true, email: 'tesoreria@estar.com.co', permissions: authState.perms.slice() };
  }
});

/* ── OTASync y Mercado Pago falsos ── */
const pms = { cancels: [], cancelImpl: null };
fake(P('_otasync'), {
  hasOtasyncCreds: () => false,
  cancelReservation: async (id) => { pms.cancels.push(id); return pms.cancelImpl ? pms.cancelImpl(id) : { ok: true, status: 'canceled' }; }
});
const mp = { calls: [], result: { ok: true, refundId: 'RF-1', status: 'approved' } };
fake(P('_mp-refund'), { refundMercadoPago: async (args) => { mp.calls.push(args); return mp.result; } });

/* ── Resend interceptado ── */
const sent = [];
global.fetch = async (url, opts) => {
  if (String(url).includes('api.resend.com')) {
    sent.push(JSON.parse(opts.body));
    return { ok: true, status: 200, json: async () => ({ id: 'email-' + sent.length }) };
  }
  throw new Error('red bloqueada en pruebas: ' + url);
};

const { handler } = require('../../netlify/functions/refund-admin-action');
const { sealBankDetailsFields } = require('../../netlify/functions/_refunds-store');

function reset() {
  for (const s of registry.values()) s._m.clear();
  sent.length = 0; mp.calls.length = 0; pms.cancels.length = 0; pms.cancelImpl = null;
  mp.result = { ok: true, refundId: 'RF-1', status: 'approved' };
  authState.perms = ALL.slice(); authState.asked.length = 0;
  delete process.env.OTASYNC_AUTO_CANCEL_ENABLED;
  delete process.env.REFUND_GATEWAY_AUTO_ENABLED;
  delete process.env.REFUND_BANK_FORM_ENABLED;
}
function seed(rec) {
  const r = Object.assign({
    refundId: 'REF-' + rec.bookingCode, kind: 'cancellation', cancelReservation: true,
    guestName: 'Ana Ruiz', guestEmail: 'ana@example.com', lang: 'es',
    checkIn: '2026-11-20', checkOut: '2026-11-22', nights: 2,
    status: 'NEEDS_REVIEW', auditLog: [], createdAt: '2026-11-01T10:00:00Z'
  }, rec);
  memStore('refunds')._m.set(r.bookingCode, JSON.stringify(r));
  return r;
}
async function call(body) {
  const res = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify(body) });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}
async function stored(code) { return JSON.parse(await memStore('refunds').get(code)); }
function openTasks() {
  const m = memStore('ops-queue')._m;
  return Array.from(m.keys()).filter(k => k.startsWith('ops/')).map(k => JSON.parse(m.get(k)));
}

const MP_REFUND = {
  bookingCode: '3273564', route: 'GATEWAY_AUTO', paymentProvider: 'mercadopago', paymentMethod: 'visa',
  transactionId: 'MP-998877', transactionIdSource: 'payment',
  originalAmountCents: 40000000, originalAmountSource: 'payment', ratePlan: null
};

test('Aprobar MP con los interruptores APAGADOS: tareas (Kunas + devolver en MP) y correo al huésped', async () => {
  reset();
  seed(MP_REFUND);
  const r = await call({ bookingCode: '3273564', action: 'approve', amountCents: 40000000 });
  assert.equal(r.status, 200);
  assert.equal(r.body.refund.status, 'APPROVED');
  assert.equal(mp.calls.length, 0, 'no mueve plata con el flag apagado');
  assert.equal(pms.cancels.length, 0, 'no escribe en Kunas con el flag apagado');
  assert.equal(r.body.pms.mode, 'task');
  const tasks = openTasks();
  const kinds = tasks.map(t => t.kind).sort();
  assert.deepEqual(kinds, ['refund_cancel_pms', 'refund_mercadopago']);
  const pay = tasks.find(t => t.kind === 'refund_mercadopago');
  assert.match(pay.title, /Reembolsar \$ 400\.000 en Mercado Pago — reserva 3273564 \(pago MP-998877\)/);
  assert.match(pay.context.instructions, /Devolver dinero/);
  assert.equal(pay.context.reason, 'auto_refund_off');
  assert.match(tasks.find(t => t.kind === 'refund_cancel_pms').title, /Cancelar en Kunas la reserva 3273564/);
  /* correo */
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'ana@example.com');
  assert.match(sent[0].subject, /Reembolso aprobado — 3273564/);
  assert.match(sent[0].html, /\$ 400\.000/);
  assert.match(sent[0].html, /15 días hábiles/);
  assert.match(sent[0].html, /Mercado Pago/);
  const rec = await stored('3273564');
  assert.equal(rec.guestNotices.length, 1);
  assert.equal(rec.guestNotices[0].type, 'approved');
  assert.equal(rec.guestNotices[0].sent, true);
});

test('Aprobar MP con auto-reembolso y auto-cancelación ENCENDIDOS: hace todo y manda UN solo correo de "realizado"', async () => {
  reset();
  process.env.REFUND_GATEWAY_AUTO_ENABLED = 'true';
  process.env.OTASYNC_AUTO_CANCEL_ENABLED = 'true';
  seed(MP_REFUND);
  const r = await call({ bookingCode: '3273564', action: 'approve', amountCents: 30000000 });
  assert.equal(r.status, 200);
  assert.equal(mp.calls.length, 1);
  assert.equal(mp.calls[0].paymentId, 'MP-998877');
  assert.equal(mp.calls[0].amountCents, 30000000);
  assert.equal(mp.calls[0].originalAmountCents, 40000000, 'monto de la pasarela → MP decide total/parcial');
  assert.deepEqual(pms.cancels, ['3273564']);
  const rec = await stored('3273564');
  assert.equal(rec.status, 'DONE');
  assert.equal(rec.reservationCanceled, true);
  assert.equal(rec.payoutRef, 'RF-1');
  assert.equal(openTasks().length, 0, 'nada pendiente');
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /Reembolso realizado — 3273564/);
  assert.match(sent[0].html, /\$ 300\.000/);
});

test('monto pagado ingresado a mano → a MP se le manda el monto explícito (nunca un reembolso total a ciegas)', async () => {
  reset();
  process.env.REFUND_GATEWAY_AUTO_ENABLED = 'true';
  seed({ ...MP_REFUND, bookingCode: 'MP-ADM', originalAmountCents: null, originalAmountSource: null });
  const r = await call({ bookingCode: 'MP-ADM', action: 'approve', amountCents: 25000000, originalAmountCents: 25000000 });
  assert.equal(r.status, 200);
  assert.equal(mp.calls.length, 1);
  assert.equal(mp.calls[0].originalAmountCents, null);
  const rec = await stored('MP-ADM');
  assert.equal(rec.originalAmountSource, 'admin');
});

test('número de pago digitado por el admin → NO auto-reembolso (riesgo de devolver otro pago): queda tarea', async () => {
  reset();
  process.env.REFUND_GATEWAY_AUTO_ENABLED = 'true';
  seed({ ...MP_REFUND, bookingCode: 'MP-NOTX', paymentProvider: null, paymentMethod: null, route: 'MANUAL_BANK', transactionId: null, transactionIdSource: null });
  const r = await call({
    bookingCode: 'MP-NOTX', action: 'approve', amountCents: 40000000,
    payment: { provider: 'mercadopago', method: 'credit_card', transactionId: '123456' }
  });
  assert.equal(r.status, 200);
  const rec = await stored('MP-NOTX');
  assert.equal(rec.route, 'GATEWAY_AUTO', 'la ruta se recalcula con el medio que completó el admin');
  assert.equal(rec.transactionIdSource, 'admin');
  assert.equal(mp.calls.length, 0);
  const pay = openTasks().find(t => t.kind === 'refund_mercadopago');
  assert.equal(pay.context.reason, 'transaction_id_entered_by_admin');
});

test('Wompi tarjeta: sin API → tarea con instrucciones (dashboard el mismo día o soporte con los 4 datos)', async () => {
  reset();
  seed({ bookingCode: 'W-1', route: 'GATEWAY_ASSISTED', paymentProvider: 'wompi', paymentMethod: 'CARD', transactionId: 'w-1', authCode: '123456', cardLast4: '4242', originalAmountCents: 20000000, originalAmountSource: 'payment' });
  const r = await call({ bookingCode: 'W-1', action: 'approve', amountCents: 20000000 });
  assert.equal(r.status, 200);
  const task = openTasks().find(t => t.kind === 'refund_wompi');
  assert.ok(task);
  assert.match(task.context.instructions, /Anular transacción/);
  assert.match(task.context.instructions, /soporte de Wompi/);
  assert.equal(task.context.authCode, '123456');
  assert.match(sent[0].html, /misma tarjeta/);
});

test('transferencia con formulario activo: enlace en el correo y la tarea llega cuando el huésped envía la cuenta', async () => {
  reset();
  process.env.REFUND_BANK_FORM_ENABLED = 'true';
  process.env.REFUND_LINK_SECRET = 'unit-test-link-secret';
  seed({ bookingCode: 'T-1', route: 'MANUAL_BANK', paymentProvider: 'wompi', paymentMethod: 'PSE', originalAmountCents: 15000000, originalAmountSource: 'payment' });
  const r = await call({ bookingCode: 'T-1', action: 'approve', amountCents: 15000000 });
  assert.equal(r.status, 200);
  assert.equal(r.body.refund.status, 'NEEDS_BANK_DETAILS');
  assert.ok(r.body.bankFormUrl.includes('datos-cuenta.html?c=T-1'));
  assert.equal(sent.length, 1, 'un solo correo (aprobado + enlace)');
  assert.ok(sent[0].html.includes('datos-cuenta.html'));
  assert.equal(openTasks().filter(t => t.kind === 'refund_transfer').length, 0);
});

test('aprobar sin monto pagado conocido exige originalAmountCents (y no supera lo pagado)', async () => {
  reset();
  seed({ bookingCode: 'NP-1', route: 'MANUAL_BANK', originalAmountCents: null });
  const a = await call({ bookingCode: 'NP-1', action: 'approve', amountCents: 10000000 });
  assert.equal(a.status, 400);
  assert.match(a.body.error, /originalAmountCents/);
  const b = await call({ bookingCode: 'NP-1', action: 'approve', amountCents: 10000000, originalAmountCents: 5000000 });
  assert.equal(b.status, 400);
  assert.match(b.body.error, /superar el monto pagado/);
  const c = await call({ bookingCode: 'NP-1', action: 'approve', amountCents: 5000000, originalAmountCents: 5000000 });
  assert.equal(c.status, 200);
});

test('Denegar: correo con el motivo, la reserva igual se cierra en Kunas (tarea con el flag apagado)', async () => {
  reset();
  seed({ bookingCode: 'D-1', route: 'GATEWAY_AUTO', originalAmountCents: 20000000, lang: 'en' });
  const r = await call({ bookingCode: 'D-1', action: 'deny', reason: 'Requested after the Strict rate deadline.', notes: 'nota interna que no va' });
  assert.equal(r.status, 200);
  assert.equal(r.body.refund.status, 'DENIED');
  assert.equal(r.body.pms.mode, 'task');
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /Your cancellation is registered — D-1/);
  assert.match(sent[0].html, /Requested after the Strict rate deadline/);
  assert.ok(!sent[0].html.includes('nota interna'), 'la nota interna no va al huésped');
  assert.equal((await stored('D-1')).deniedReason, 'Requested after the Strict rate deadline.');
});

test('Marcar reembolsado: correo de "realizado" (una vez), cierra la tarea de pago', async () => {
  reset();
  seed({ ...MP_REFUND, bookingCode: 'MD-1' });
  await call({ bookingCode: 'MD-1', action: 'approve', amountCents: 40000000 });
  assert.equal(openTasks().filter(t => t.kind === 'refund_mercadopago').length, 1);
  sent.length = 0;
  const r = await call({ bookingCode: 'MD-1', action: 'mark-done', payoutRef: 'DEV-55' });
  assert.equal(r.status, 200);
  assert.equal(r.body.refund.status, 'DONE');
  assert.equal(openTasks().filter(t => t.kind === 'refund_mercadopago').length, 0, 'tarea resuelta');
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /Reembolso realizado — MD-1/);
  assert.match(sent[0].html, /DEV-55/);
  const again = await call({ bookingCode: 'MD-1', action: 'mark-done' });
  assert.equal(again.status, 409);
});

test('aprobar o denegar algo que ya no está por revisar → 409 (no re-ejecuta reembolsos ni correos)', async () => {
  reset();
  seed({ ...MP_REFUND, bookingCode: 'AP-2', status: 'APPROVED', refundAmountCents: 100 });
  assert.equal((await call({ bookingCode: 'AP-2', action: 'approve', amountCents: 100 })).status, 409);
  assert.equal((await call({ bookingCode: 'AP-2', action: 'deny', reason: 'x' })).status, 409);
  assert.equal(sent.length, 0);
});

test('permisos: cada acción pide el suyo; sin refunds.approve no se aprueba', async () => {
  reset();
  seed({ ...MP_REFUND, bookingCode: 'PERM-1' });
  authState.perms = ['refunds.view', 'refunds.mark_done'];
  const r = await call({ bookingCode: 'PERM-1', action: 'approve', amountCents: 100 });
  assert.equal(r.status, 403);
  assert.deepEqual(authState.asked, ['refunds.approve']);
  authState.asked.length = 0;
  await call({ bookingCode: 'PERM-1', action: 'pms-cancel', manual: true });
  assert.deepEqual(authState.asked, ['refunds.mark_done'], 'confirmar la cancelación manual = quien tramita');
  authState.asked.length = 0;
  authState.perms = ['refunds.view'];
  await call({ bookingCode: 'PERM-1', action: 'pms-cancel', manual: false });
  assert.deepEqual(authState.asked, ['refunds.approve'], 'reintentar la automática = quien aprueba');
});

test('"Ya la cancelé en Kunas": marca la reserva y cierra la tarea (también en solicitudes cerradas)', async () => {
  reset();
  seed({ bookingCode: 'PM-1', route: 'MANUAL_BANK', originalAmountCents: 100 });
  await call({ bookingCode: 'PM-1', action: 'deny', reason: 'No-show' });
  assert.equal(openTasks().filter(t => t.kind === 'refund_cancel_pms').length, 1);
  const r = await call({ bookingCode: 'PM-1', action: 'pms-cancel', manual: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.refund.reservationCanceled, true);
  assert.equal(r.body.refund.reservationCancelResult.manual, true);
  assert.equal(openTasks().filter(t => t.kind === 'refund_cancel_pms').length, 0);
});

test('reintentar la cancelación automática con el flag apagado → 400 (indica hacerlo a mano)', async () => {
  reset();
  seed({ bookingCode: 'PM-2', status: 'APPROVED' });
  const r = await call({ bookingCode: 'PM-2', action: 'pms-cancel', manual: false });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /a mano/);
  assert.equal(pms.cancels.length, 0);
});

test('caso especial: se crea desde el panel, no cancela en Kunas por defecto y no se duplica', async () => {
  reset();
  const r = await call({ bookingCode: '5550001', action: 'create-special', reason: 'Mercado Pago cobró dos veces', guestName: 'Luis', guestEmail: 'luis@example.com', originalAmountCents: 30000000 });
  assert.equal(r.status, 200);
  assert.equal(r.body.refund.kind, 'special');
  assert.equal(r.body.refund.cancelReservation, false);
  assert.equal(r.body.refund.originalAmountSource, 'admin');
  assert.equal(r.body.refund.guestEmail, 'luis@example.com');
  const dup = await call({ bookingCode: '5550001', action: 'create-special', reason: 'otra vez' });
  assert.equal(dup.status, 409);
  /* aprobarlo: no toca Kunas */
  const ap = await call({ bookingCode: '5550001', action: 'approve', amountCents: 15000000 });
  assert.equal(ap.status, 200);
  assert.equal(ap.body.pms.mode, 'skipped');
  assert.equal(openTasks().filter(t => t.kind === 'refund_cancel_pms').length, 0);
  assert.match(sent[sent.length - 1].html, /Aprobamos un reembolso para tu reserva/);
});

test('caso especial sin motivo o con código inválido → 400', async () => {
  reset();
  assert.equal((await call({ bookingCode: '5550002', action: 'create-special' })).status, 400);
  assert.equal((await call({ bookingCode: 'x<script>', action: 'create-special', reason: 'r' })).status, 400);
});

test('reintentar el reembolso de MP tras un fallo: lo ejecuta y avisa al huésped', async () => {
  reset();
  process.env.REFUND_GATEWAY_AUTO_ENABLED = 'true';
  seed({ ...MP_REFUND, bookingCode: 'RT-1' });
  mp.result = { ok: false, error: 'mp_error_400', detail: 'insufficient balance' };
  const a = await call({ bookingCode: 'RT-1', action: 'approve', amountCents: 40000000 });
  assert.equal(a.body.refund.status, 'FAILED');
  assert.match(sent[0].subject, /Reembolso aprobado/, 'el huésped sabe que se aprobó; el equipo termina el pago');
  mp.result = { ok: true, refundId: 'RF-2', status: 'approved' };
  sent.length = 0;
  const b = await call({ bookingCode: 'RT-1', action: 'retry-gateway' });
  assert.equal(b.status, 200);
  assert.equal(b.body.refund.status, 'DONE');
  assert.equal(mp.calls.length, 2);
  assert.match(sent[0].subject, /Reembolso realizado/);
});

test('la respuesta nunca trae el sobre cifrado; los datos completos solo con refunds.mark_done', async () => {
  reset();
  const fields = sealBankDetailsFields('BK-1', { bankName: 'Bancolombia', accountType: 'ahorros', accountNumber: '99887766', holderName: 'Ana', docType: 'CC', docNumber: '123' });
  seed({ bookingCode: 'BK-1', route: 'MANUAL_BANK', status: 'BANK_DETAILS_READY', refundAmountCents: 100, ...fields });
  authState.perms = ['refunds.view', 'refunds.mark_done'];
  const r = await call({ bookingCode: 'BK-1', action: 'mark-processing' });
  assert.equal(r.status, 200);
  assert.equal(r.body.refund.bankDetailsSealed, undefined);
  assert.equal(r.body.refund.bankDetails.accountNumber, '99887766');
});

/* ── Hallazgos de revisión ── */
test('Dos aprobaciones concurrentes con montos distintos: un solo reembolso en MP y un solo correo', async () => {
  reset();
  process.env.REFUND_GATEWAY_AUTO_ENABLED = 'true';
  seed(MP_REFUND);
  const [a, b] = await Promise.all([
    call({ bookingCode: '3273564', action: 'approve', amountCents: 30000000 }),
    call({ bookingCode: '3273564', action: 'approve', amountCents: 25000000 })
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  assert.equal(mp.calls.length, 1, 'un solo reembolso real');
  assert.match(mp.calls[0].idempotencyKey, /-refund-0$/, 'clave de idempotencia sin el monto (intento 0)');
  assert.equal(sent.length, 1);
});

test('Marcar reembolsado sobre una solicitud POR REVISAR se rechaza (sin correo ni cierre)', async () => {
  reset();
  seed({ ...MP_REFUND, refundAmountCents: null });
  for (const action of ['mark-done', 'mark-processing']) {
    const r = await call({ bookingCode: '3273564', action, payoutRef: 'X' });
    assert.equal(r.status, 409);
  }
  assert.equal(sent.length, 0);
  assert.equal((await stored('3273564')).status, 'NEEDS_REVIEW');
});

/* ── Hallazgos de revisión (2ª ronda) ── */
test('MP recuperado de la nota de Kunas (sin método): va por Mercado Pago, no por transferencia', async () => {
  reset();
  process.env.REFUND_GATEWAY_AUTO_ENABLED = 'true';
  const { refundRoute } = require('../../netlify/functions/_refunds-store');
  seed({ bookingCode: 'NOTE-1', paymentProvider: 'mercadopago', paymentMethod: null, route: refundRoute('mercadopago', null),
    transactionId: '55443322', transactionIdSource: 'pms-note', originalAmountCents: null });
  const r = await call({ bookingCode: 'NOTE-1', action: 'approve', amountCents: 20000000, originalAmountCents: 30000000 });
  assert.equal(r.status, 200);
  assert.equal(mp.calls.length, 1, 'se reembolsa por MP con el id de la nota');
  assert.equal(mp.calls[0].paymentId, '55443322');
  assert.equal(mp.calls[0].originalAmountCents, null, 'monto pagado digitado → monto explícito');
  assert.doesNotMatch(sent[0].html, /transferencia bancaria/);
  assert.equal(openTasks().filter(t => t.kind === 'refund_transfer').length, 0);
});

test('registro viejo MP en MANUAL_BANK sin método: el admin elige el método y la ruta pasa a Mercado Pago', async () => {
  reset();
  seed({ bookingCode: 'NOTE-2', paymentProvider: 'mercadopago', paymentMethod: null, route: 'MANUAL_BANK',
    transactionId: '55443323', transactionIdSource: 'pms-note', originalAmountCents: 30000000, originalAmountSource: 'pms_total' });
  const r = await call({ bookingCode: 'NOTE-2', action: 'approve', amountCents: 30000000, payment: { provider: 'mercadopago', method: 'credit_card' } });
  assert.equal(r.status, 200);
  const rec = await stored('NOTE-2');
  assert.equal(rec.route, 'GATEWAY_AUTO');
  assert.equal(rec.paymentMethod, 'credit_card');
  assert.equal(rec.status, 'APPROVED');
  assert.equal(openTasks().filter(t => t.kind === 'refund_mercadopago').length, 1, 'tarea de MP (auto apagado), no de transferencia');
});

test('paymentFixPatch: un método de OTRO proveedor no se mezcla con el proveedor conocido', () => {
  const { paymentFixPatch } = require('../../netlify/functions/refund-admin-action')._test;
  const p = paymentFixPatch({ paymentProvider: 'mercadopago', paymentMethod: null }, { provider: 'wompi', method: 'CARD' });
  assert.deepEqual(p, {});
});

test('"Ya la cancelé en Kunas" también cierra la tarea de la alerta de cancelación automática fallida', async () => {
  reset();
  process.env.OTASYNC_AUTO_CANCEL_ENABLED = 'true';
  process.env.ALERT_ENABLED = 'true';
  pms.cancelImpl = () => { throw new Error('Kunas no confirmó'); };
  seed({ bookingCode: '3273565', route: 'MANUAL_BANK', originalAmountCents: 100 });
  try {
    await call({ bookingCode: '3273565', action: 'deny', reason: 'Fuera de plazo' });
    assert.equal(openTasks().filter(t => t.id === 'otasync-cancel-3273565').length, 1, 'la alerta quedó como tarea');
    const r = await call({ bookingCode: '3273565', action: 'pms-cancel', manual: true });
    assert.equal(r.status, 200);
    assert.equal(openTasks().filter(t => t.id === 'otasync-cancel-3273565').length, 0);
  } finally { process.env.ALERT_ENABLED = 'false'; }
});

test('reintento de cancelación lento + "Reembolsado" en paralelo: el estado DONE no se revierte', async () => {
  reset();
  process.env.OTASYNC_AUTO_CANCEL_ENABLED = 'true';
  seed({ ...MP_REFUND, bookingCode: 'RACE-1', status: 'APPROVED', refundAmountCents: 100 });
  let release;
  const gate = new Promise(r => { release = r; });
  pms.cancelImpl = async () => { await gate; return { ok: true, status: 'canceled' }; };
  const slow = call({ bookingCode: 'RACE-1', action: 'pms-cancel', manual: false });
  await new Promise(r => setImmediate(r));
  const done = await call({ bookingCode: 'RACE-1', action: 'mark-done', payoutRef: 'TR-9' });
  assert.equal(done.status, 200);
  release();
  const r = await slow;
  assert.equal(r.status, 200);
  const rec = await stored('RACE-1');
  assert.equal(rec.status, 'DONE', 'la marca de Kunas no revierte el estado');
  assert.equal(rec.reservationCanceled, true);
  assert.equal(rec.guestNotices.length, 1, 'el aviso de "realizado" no se pierde');
});

test('reintento de MP: tras un rechazo definitivo cambia la clave; tras un timeout la reusa', async () => {
  reset();
  process.env.REFUND_GATEWAY_AUTO_ENABLED = 'true';
  seed({ ...MP_REFUND, bookingCode: 'IK-1' });
  mp.result = { ok: false, error: 'timeout' };
  await call({ bookingCode: 'IK-1', action: 'approve', amountCents: 40000000 });
  mp.result = { ok: false, error: 'mp_error_400', detail: 'x', status: 400 };
  await call({ bookingCode: 'IK-1', action: 'retry-gateway' });
  mp.result = { ok: true, refundId: 'RF-3', status: 'approved' };
  await call({ bookingCode: 'IK-1', action: 'retry-gateway' });
  const keys = mp.calls.map(c => c.idempotencyKey);
  assert.deepEqual(keys, ['REF-IK-1-refund-0', 'REF-IK-1-refund-0', 'REF-IK-1-refund-1']);
  assert.equal((await stored('IK-1')).status, 'DONE');
});
