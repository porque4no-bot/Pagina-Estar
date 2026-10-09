/* Frente cancel — correos al huésped (ES/EN) y detalle de la pestaña Reembolsos.
 *
 * Correos: aprobado (monto, medio, 15 días hábiles, enlace de cuenta si es
 * transferencia), denegado (motivo, escapado), realizado (referencia).
 * Panel: la lógica de render vive en un <script> de cotizar-admin.html; se
 * extrae y se ejecuta en un sandbox `vm` (sin DOM ni red) para comprobar que los
 * botones aparecen SEGÚN EL PERMISO, que los datos bancarios completos solo se
 * pintan si el servidor los mandó, y que el plan "al aprobar" refleja los
 * interruptores. */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const email = require('../../netlify/functions/_email');
const flow = require('../../netlify/functions/_refund-flow');

const BASE = { bookingCode: '3273564', guestName: 'Ana Ruiz', checkIn: '2026-11-20', checkOut: '2026-11-22', refundAmountCents: 40000000 };

/* ── Correos ── */

test('aprobado (ES, Mercado Pago): monto, medio y plazo de 15 días hábiles', () => {
  const html = email.refundApprovedHtml({ refund: { ...BASE, route: 'GATEWAY_AUTO', kind: 'cancellation' }, lang: 'es', slaDays: 15 });
  assert.match(html, /\$ 400\.000/);
  assert.match(html, /tarjeta o cuenta de Mercado Pago/);
  assert.match(html, /15 días hábiles/);
  assert.match(html, /Aprobamos la cancelación de tu reserva/);
  assert.match(html, /<html lang="es">/);
});

test('approved (EN, Wompi card) mirrors the Spanish copy', () => {
  const html = email.refundApprovedHtml({ refund: { ...BASE, route: 'GATEWAY_ASSISTED' }, lang: 'en', slaDays: 15 });
  assert.match(html, /\$ 400\.000/);
  assert.match(html, /same card you paid with/);
  assert.match(html, /15 business days/);
  assert.match(html, /<html lang="en">/);
});

test('aprobado por transferencia: con enlace muestra el botón; sin enlace avisa que lo contactan', () => {
  const withForm = email.refundApprovedHtml({ refund: { ...BASE, route: 'MANUAL_BANK' }, lang: 'es', formUrl: 'https://estar.com.co/datos-cuenta.html?c=1&t=x' });
  assert.match(withForm, /Indicar mi cuenta bancaria/);
  assert.match(withForm, /después de recibir tus datos bancarios/);
  const noForm = email.refundApprovedHtml({ refund: { ...BASE, route: 'MANUAL_BANK' }, lang: 'en' });
  assert.match(noForm, /We will contact you/);
});

test('caso especial aprobado no habla de cancelación', () => {
  const html = email.refundApprovedHtml({ refund: { ...BASE, route: 'GATEWAY_AUTO', kind: 'special' }, lang: 'es' });
  assert.match(html, /Aprobamos un reembolso para tu reserva/);
  assert.doesNotMatch(html, /Aprobamos la cancelación/);
});

test('denegado: incluye el motivo escapado (sin inyección HTML), ES y EN', () => {
  const es = email.refundDeniedHtml({ refund: BASE, lang: 'es', reason: 'Fuera de plazo <script>alert(1)</script>' });
  assert.match(es, /no aplica reembolso/);
  assert.match(es, /Fuera de plazo &lt;script&gt;/);
  assert.doesNotMatch(es, /<script>alert/);
  const en = email.refundDeniedHtml({ refund: BASE, lang: 'en', reason: 'Late cancellation' });
  assert.match(en, /no refund applies/);
  assert.match(en, /Late cancellation/);
});

test('realizado: monto, medio y referencia', () => {
  const html = email.refundDoneHtml({ refund: { ...BASE, route: 'MANUAL_BANK', payoutRef: 'COMP-123' }, lang: 'es' });
  assert.match(html, /Ya realizamos el reembolso/);
  assert.match(html, /transferencia bancaria/);
  assert.match(html, /COMP-123/);
  const en = email.refundDoneHtml({ refund: { ...BASE, route: 'GATEWAY_AUTO' }, lang: 'en' });
  assert.match(en, /We sent the refund/);
});

test('asuntos ES/EN por tipo de aviso', () => {
  assert.equal(flow.noticeSubject('approved', BASE, 'es'), 'Reembolso aprobado — 3273564');
  assert.equal(flow.noticeSubject('approved', BASE, 'en'), 'Refund approved — 3273564');
  assert.equal(flow.noticeSubject('done', BASE, 'es'), 'Reembolso realizado — 3273564');
  assert.equal(flow.noticeSubject('denied', BASE, 'es'), 'Tu cancelación quedó registrada — 3273564');
  assert.equal(flow.noticeSubject('denied', { ...BASE, kind: 'special' }, 'en'), 'Your refund request — 3273564');
});

test('notifyGuest sin correo del huésped no envía nada', async () => {
  const n = await flow.notifyGuest('approved', { ...BASE, guestEmail: '' });
  assert.equal(n.sent, false);
  assert.equal(n.reason, 'no_email');
});

test('tareas: Wompi trae los 4 datos para soporte; transferencia y Kunas con instrucciones', () => {
  const w = flow.payTask({ ...BASE, route: 'GATEWAY_ASSISTED', authCode: 'A1', cardLast4: '4242', paymentDate: '2026-11-01' }, 40000000, 'wompi_no_api');
  assert.equal(w.kind, 'refund_wompi');
  assert.equal(w.dedupeKey, 'refund-pay-3273564');
  assert.equal(w.context.authCode, 'A1');
  assert.match(w.context.instructions, /mismo día|HOY/);
  const t = flow.payTask({ ...BASE, route: 'MANUAL_BANK' }, 1000, 'bank_details_ready');
  assert.match(t.title, /ya envió su cuenta/);
  const k = flow.pmsCancelTask(BASE);
  assert.equal(k.dedupeKey, 'refund-pms-cancel-3273564');
  assert.match(k.title, /Cancelar en Kunas la reserva 3273564 \(Ana Ruiz\)/);
});

/* ── Panel /admin → Reembolsos ── */

const html = fs.readFileSync(path.resolve(__dirname, '../../cotizar-admin.html'), 'utf8');

function extractBlock(src, header) {
  const start = src.indexOf(header);
  assert.notEqual(start, -1, `No se encontró ${header}`);
  const open = header.trim().endsWith('=') ? src.slice(start).search(/[{[]/) + start : src.indexOf('{', start);
  const opener = src[open];
  const closer = opener === '{' ? '}' : ']';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === opener) depth++;
    else if (src[i] === closer) { depth--; if (depth === 0) return src.slice(start, i + 1) + (header.startsWith('const') ? ';' : ''); }
  }
  throw new Error(`No se cerró ${header}`);
}

function sandbox() {
  const parts = [
    'function formatCOP(', 'function escHtml(', 'function fmtShortDate(', 'function fmtCents(', 'function fmtDateTime(',
    'const REFUND_STATUS_LABEL =', 'const REFUND_ROUTE_LABEL =', 'const REFUND_KIND_LABEL =', 'const REFUND_ROUTE_HOWTO =',
    'const RF_PAYMENT_OPTIONS =',
    'function rfTrustedTx(', 'function refundApprovePlan(', 'function refundPolicyBlock(', 'function refundPmsBlock(',
    'function refundBankBlock(', 'function renderRefundModal('
  ].map(h => extractBlock(html, h));
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(parts.join('\n') + '\nthis.renderRefundModal = renderRefundModal; this.refundApprovePlan = refundApprovePlan;', ctx);
  return ctx;
}
const ctx = sandbox();
const ALLP = { approve: true, deny: true, setAmount: true, markDone: true };
const NONE = { approve: false, deny: false, setAmount: false, markDone: false };
const REVIEW = {
  bookingCode: '3273564', status: 'NEEDS_REVIEW', kind: 'cancellation', cancelReservation: true, route: 'GATEWAY_AUTO',
  paymentProvider: 'mercadopago', paymentMethod: 'visa', transactionId: 'MP-1', transactionIdSource: 'payment',
  originalAmountCents: 40000000, guestEmail: 'ana@example.com', checkIn: '2026-11-20', checkOut: '2026-11-22',
  policy: { rule: 'full', amountCents: 40000000, text: 'Estricta: canceló a tiempo', hoursBefore: 300 }, auditLog: []
};

test('por revisar con permisos: Aprobar + Denegar, sugerencia de la política y monto prellenado', () => {
  const out = ctx.renderRefundModal(REVIEW, ALLP, { autoCancelPms: false, mpAutoRefund: false });
  assert.match(out, /id="rfApproveBtn"/);
  assert.match(out, /id="rfDenyBtn"/);
  assert.match(out, /data-rf-suggest="400000"/);
  assert.match(out, /id="rfAmount"[^>]*value="400000"/);
  assert.match(out, /Queda una tarea en Hoy:<\/span> cancelar la reserva a mano en Kunas/);
  assert.match(out, /devolver desde el panel de Mercado Pago \(auto-reembolso apagado\)/);
  assert.match(out, /Motivo para el huésped/);
});

test('recepción (solo refunds.view): ve la solicitud pero sin botones de decisión ni de pago', () => {
  const out = ctx.renderRefundModal(REVIEW, NONE, {});
  assert.doesNotMatch(out, /rfApproveBtn|rfDenyBtn|rfDoneBtn/);
  assert.match(out, /requiere permiso de tesorería/);
  const inProgress = ctx.renderRefundModal({ ...REVIEW, status: 'APPROVED' }, NONE, {});
  assert.doesNotMatch(inProgress, /rfDoneBtn|rfProcessingBtn/);
});

test('solo "denegar" sin "aprobar": aparece solo Denegar', () => {
  const out = ctx.renderRefundModal(REVIEW, { ...NONE, deny: true }, {});
  assert.match(out, /rfDenyBtn/);
  assert.doesNotMatch(out, /rfApproveBtn/);
});

test('con interruptores encendidos, el plan dice que todo es automático', () => {
  const plan = ctx.refundApprovePlan(REVIEW, { autoCancelPms: true, mpAutoRefund: true }, 'cancellation', false);
  assert.match(plan, /Se cancela automáticamente en Kunas/);
  assert.match(plan, /se devuelve automáticamente por Mercado Pago/);
  const typed = ctx.refundApprovePlan({ ...REVIEW, transactionIdSource: 'admin' }, { mpAutoRefund: true }, 'cancellation', false);
  assert.match(typed, /el número de pago no viene de MP/);
  const special = ctx.refundApprovePlan(REVIEW, {}, 'special', false);
  assert.match(special, /No se cancela la reserva en Kunas/);
});

test('faltan datos del pago: pide monto pagado, medio y número', () => {
  const out = ctx.renderRefundModal({ ...REVIEW, originalAmountCents: null, paymentProvider: null, transactionId: null, policy: { rule: 'unknown_amount', amountCents: null, text: 'Falta el monto pagado' } }, ALLP, {});
  assert.match(out, /id="rfPaid"/);
  assert.match(out, /id="rfPayMethod"/);
  assert.match(out, /id="rfPayTx"/);
});

test('proveedor conocido pero sin método (MP de la nota de Kunas): pide el método, solo opciones de ese proveedor', () => {
  const out = ctx.renderRefundModal({ ...REVIEW, paymentMethod: null, transactionIdSource: 'pms-note' }, ALLP, {});
  assert.match(out, /id="rfPayMethod"/);
  assert.match(out, /mercadopago\|credit_card/);
  assert.doesNotMatch(out, /wompi\|CARD/);
  const complete = ctx.renderRefundModal(REVIEW, ALLP, {});
  assert.doesNotMatch(complete, /id="rfPayMethod"/);
});

test('plan desconocido: ofrece las dos lecturas (Estricta / Flexible)', () => {
  const out = ctx.renderRefundModal({ ...REVIEW, policy: { rule: 'unknown_plan', amountCents: null, alternatives: { strict: 18600000, flexible: 40000000 }, text: 'Plan desconocido' } }, ALLP, {});
  assert.match(out, /Si es Estricta: \$ 186\.000/);
  assert.match(out, /Si es Flexible: \$ 400\.000/);
});

test('monto prellenado: vacío si la política da 0 o el plan es desconocido (nunca un 100% por descuido)', () => {
  const zero = ctx.renderRefundModal({ ...REVIEW, policy: { rule: 'no_show', amountCents: 0, text: 'No-show' } }, ALLP, {});
  assert.match(zero, /id="rfAmount"[^>]*value=""/);
  assert.match(zero, /usa <strong>Denegar<\/strong>/);
  const unknown = ctx.renderRefundModal({ ...REVIEW, policy: { rule: 'unknown_plan', amountCents: null, alternatives: { strict: 1, flexible: 2 }, text: 'x' } }, ALLP, {});
  assert.match(unknown, /id="rfAmount"[^>]*value=""/);
  const late = ctx.renderRefundModal({ ...REVIEW, policy: { rule: 'late', amountCents: 18600000, text: 'tardía' } }, ALLP, {});
  assert.match(late, /id="rfAmount"[^>]*value="186000"/);
});

test('datos bancarios: completos solo si el servidor los mandó (permiso); si no, el resumen enmascarado', () => {
  const ready = { ...REVIEW, status: 'BANK_DETAILS_READY', route: 'MANUAL_BANK', bankDetailsSummary: { bankName: 'Bancolombia', accountType: 'ahorros', accountLast4: '8901' } };
  const masked = ctx.renderRefundModal(ready, ALLP, {});
  assert.match(masked, /····8901/);
  assert.match(masked, /solo los ve quien tiene permiso/);
  const full = ctx.renderRefundModal({ ...ready, bankDetails: { bankName: 'Bancolombia', accountType: 'ahorros', accountNumber: '12345678901', holderName: 'Ana', docType: 'CC', docNumber: '99' } }, ALLP, {});
  assert.match(full, /12345678901/);
});

test('tras decidir: estado en Kunas con "Ya la cancelé" (tesorería) y reintento solo si la auto-cancelación está activa', () => {
  const denied = { ...REVIEW, status: 'DENIED' };
  const off = ctx.renderRefundModal(denied, ALLP, { autoCancelPms: false });
  assert.match(off, /Pendiente de cancelar en Kunas/);
  assert.match(off, /rfPmsManualBtn/);
  assert.doesNotMatch(off, /rfPmsRetryBtn/);
  const on = ctx.renderRefundModal(denied, ALLP, { autoCancelPms: true });
  assert.match(on, /rfPmsRetryBtn/);
  const done = ctx.renderRefundModal({ ...denied, reservationCanceled: true, reservationCancelResult: { manual: true } }, ALLP, {});
  assert.match(done, /Cancelada<\/span> a mano/);
  const special = ctx.renderRefundModal({ ...denied, kind: 'special', cancelReservation: false }, ALLP, {});
  assert.doesNotMatch(special, /Reserva en Kunas/);
});

test('fallo de Mercado Pago: muestra el error y el botón de reintento solo con auto-reembolso activo', () => {
  const failed = { ...REVIEW, status: 'FAILED', refundAmountCents: 100, refundExecution: { ok: false, error: 'insufficient balance' } };
  const on = ctx.renderRefundModal(failed, ALLP, { mpAutoRefund: true });
  assert.match(on, /rfRetryGatewayBtn/);
  assert.match(on, /insufficient balance/);
  const off = ctx.renderRefundModal(failed, ALLP, { mpAutoRefund: false });
  assert.doesNotMatch(off, /rfRetryGatewayBtn/);
});

test('correos al huésped quedan listados en el detalle', () => {
  const out = ctx.renderRefundModal({ ...REVIEW, status: 'APPROVED', guestNotices: [{ type: 'approved', at: '2026-11-02T10:00:00Z', sent: true }] }, ALLP, {});
  assert.match(out, /Correos al huésped/);
  assert.match(out, /Reembolso aprobado — <span class="rf-ok">enviado/);
});

test('la pestaña muestra "Nuevo caso especial" y el detalle se arma con hasPerm', () => {
  assert.match(html, /id="newSpecialRefundBtn"/);
  assert.match(html, /function rfPerms\(\)[\s\S]*hasPerm\('refunds\.approve'\)[\s\S]*hasPerm\('refunds\.mark_done'\)/);
});
