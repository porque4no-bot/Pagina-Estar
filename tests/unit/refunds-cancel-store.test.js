/* Frente cancel — _refunds-store: búsqueda del pago por id de OTASync Y por
 * código EST (Mercado Pago guarda con la clave EST), nota de Kunas como último
 * recurso, monto sugerido por la política de la tarifa, y datos bancarios
 * CIFRADOS (seal/open con AAD) visibles solo con permiso. Blobs en memoria. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.GUEST_APP_DATA_ENCRYPTION_KEY = 'unit-test-refunds-vault-key';
delete process.env.GUEST_APP_KEY_RING;
delete process.env.GUEST_APP_ACTIVE_KEY_ID;

const registry = new Map();
function memStore(name) {
  if (!registry.has(name)) {
    const m = new Map();
    registry.set(name, {
      _m: m,
      async set(key, value, opts = {}) {
        if (opts.onlyIfNew && m.has(key)) return { modified: false };
        m.set(key, value);
        return { modified: true };
      },
      async get(key) { return m.has(key) ? m.get(key) : null; },
      async list() { return { blobs: Array.from(m.keys()).map(key => ({ key })) }; },
      async delete(key) { m.delete(key); }
    });
  }
  return registry.get(name);
}
const blobsPath = require.resolve('@netlify/blobs');
require.cache[blobsPath] = { id: blobsPath, filename: blobsPath, loaded: true, exports: { getStore: (opts) => memStore(typeof opts === 'string' ? opts : opts.name) } };

const store = require('../../netlify/functions/_refunds-store');
const {
  recoverPaymentInfo, parsePaymentFromPmsNote, policySuggestion, createRefundRequest, getRefund,
  sealBankDetailsFields, openBankDetails, redactRefund, transitionStatus, saveBankDetails, KIND, ROUTE
} = store;

function reset() { for (const s of registry.values()) s._m.clear(); }

/* ── Búsqueda del pago ─────────────────────────────────────────────────── */

test('parsePaymentFromPmsNote lee proveedor e id de la nota del webhook (MP y Wompi)', () => {
  const mp = parsePaymentFromPmsNote('Telefono del huesped: 300. Extras: ninguno. IVA (19%): EXENTO. Creado por Webhook mercadopago. ID Transaccion: 1323456789');
  assert.deepEqual(mp, { paymentProvider: 'mercadopago', transactionId: '1323456789' });
  const wompi = parsePaymentFromPmsNote('Plan: Flexible. Creado por Webhook Wompi. ID Transacción: 12345-1690000000-54321');
  assert.deepEqual(wompi, { paymentProvider: 'wompi', transactionId: '12345-1690000000-54321' });
  assert.deepEqual(parsePaymentFromPmsNote(''), {});
  assert.deepEqual(parsePaymentFromPmsNote(null), {});
});

test('recoverPaymentInfo encuentra el pago de Mercado Pago por el código EST (antes fallaba por id de OTASync)', async () => {
  reset();
  await memStore('booking-results').set('direct-EST-ABC12', JSON.stringify({
    bookingCode: '3273564', otasyncId: '3273564', provider: 'mercadopago',
    paymentMethod: 'visa', transactionId: 'MP-998877', amountInCents: 33000000
  }));
  const miss = await recoverPaymentInfo('3273564');
  assert.equal(miss.transactionId, undefined, 'solo con el id de OTASync no lo encuentra');
  const hit = await recoverPaymentInfo('3273564', { reference: 'EST-ABC12' });
  assert.equal(hit.paymentProvider, 'mercadopago');
  assert.equal(hit.transactionId, 'MP-998877');
  assert.equal(hit.originalAmountCents, 33000000);
  assert.equal(hit.transactionIdSource, 'payment');
  assert.equal(hit.originalAmountSource, 'payment');
  assert.deepEqual(hit.paymentLookup, ['booking-results:EST-ABC12']);
});

test('recoverPaymentInfo usa payment-details (durable) por código EST cuando booking-results venció', async () => {
  reset();
  await memStore('payment-details').set('EST-OLD01', JSON.stringify({
    provider: 'mercadopago', transactionId: 'MP-111', method: 'master', amountInCents: 25000000
  }));
  const info = await recoverPaymentInfo('4000001', { reference: 'EST-OLD01' });
  assert.equal(info.transactionId, 'MP-111');
  assert.equal(info.paymentMethod, 'master');
  assert.equal(info.originalAmountCents, 25000000);
  assert.deepEqual(info.paymentLookup, ['payment-details:EST-OLD01']);
});

test('recoverPaymentInfo cae a la nota de Kunas si no hay ningún registro del pago', async () => {
  reset();
  const info = await recoverPaymentInfo('4000002', {
    reference: 'EST-NOTE1',
    note: 'Creado por Webhook mercadopago. ID Transaccion: 55443322'
  });
  assert.equal(info.transactionId, '55443322');
  assert.equal(info.paymentProvider, 'mercadopago');
  assert.equal(info.transactionIdSource, 'pms-note');
  assert.equal(info.originalAmountCents, undefined, 'la nota no trae el monto: lo ingresa el admin');
});

test('createRefundRequest guarda tipo, código EST, idioma, noches y el origen de los datos', async () => {
  reset();
  const { created, refund } = await createRefundRequest({
    booking: { bookingCode: '3273564', reference: 'EST-ABC12', guestName: 'Ana Ruiz', guestEmail: 'ana@x.co', lang: 'en', checkIn: '2026-11-20', checkOut: '2026-11-22', nights: 2, totalAmount: 330000 },
    paymentInfo: { paymentProvider: 'mercadopago', paymentMethod: 'visa', transactionId: 'MP-1', transactionIdSource: 'payment', originalAmountCents: 33000000, originalAmountSource: 'payment' },
    source: 'guest-app'
  });
  assert.equal(created, true);
  assert.equal(refund.kind, KIND.CANCELLATION);
  assert.equal(refund.cancelReservation, true);
  assert.equal(refund.reference, 'EST-ABC12');
  assert.equal(refund.lang, 'en');
  assert.equal(refund.nights, 2);
  assert.equal(refund.route, ROUTE.GATEWAY_AUTO);
  assert.equal(refund.transactionIdSource, 'payment');
  assert.equal(refund.originalAmountSource, 'payment');
  assert.equal(refund.source, 'guest-app');
});

test('createRefundRequest: sin pago encontrado usa el total de Kunas marcado como aproximado', async () => {
  reset();
  const { refund } = await createRefundRequest({ booking: { bookingCode: '777', totalAmount: 200000 }, paymentInfo: {} });
  assert.equal(refund.originalAmountCents, 20000000);
  assert.equal(refund.originalAmountSource, 'pms_total');
  assert.equal(refund.transactionIdSource, null);
});

test('caso especial: no cancela la reserva salvo que el admin lo pida', async () => {
  reset();
  const a = await createRefundRequest({ booking: { bookingCode: 'S-1' }, paymentInfo: {}, kind: 'special', reason: 'Cobro duplicado', actor: 'admin@x.co' });
  assert.equal(a.refund.kind, 'special');
  assert.equal(a.refund.cancelReservation, false);
  assert.equal(a.refund.createdBy, 'admin@x.co');
  assert.match(a.refund.auditLog[0].notes, /Caso especial creado: Cobro duplicado/);
  const b = await createRefundRequest({ booking: { bookingCode: 'S-2' }, paymentInfo: {}, kind: 'special', cancelReservation: true });
  assert.equal(b.refund.cancelReservation, true);
});

/* ── Política de cancelación ───────────────────────────────────────────── */

const CHECKIN = '2026-11-20'; // check-in 3:00 p. m. Colombia = 2026-11-20T20:00Z
const at = (iso) => iso;

test('Estricta: ≥7 días antes → 100%', () => {
  const p = policySuggestion({ ratePlan: 'best', checkIn: CHECKIN, nights: 2, requestedAt: at('2026-11-12T10:00:00Z'), originalAmountCents: 40000000 });
  assert.equal(p.rule, 'full');
  assert.equal(p.amountCents, 40000000);
  assert.equal(p.plan, 'strict');
});

test('Estricta: menos de 7 días → se retiene 1ª noche + 3,5% del total', () => {
  const p = policySuggestion({ ratePlan: 'best', checkIn: CHECKIN, nights: 2, requestedAt: at('2026-11-15T10:00:00Z'), originalAmountCents: 40000000 });
  assert.equal(p.rule, 'late');
  // 400.000 − 200.000 (1ª noche) − 14.000 (3,5%) = 186.000
  assert.equal(p.amountCents, 18600000);
  assert.equal(p.firstNightCents, 20000000);
  assert.equal(p.feeCents, 1400000);
});

test('Flexible: ≥24 h antes → 100%; menos de 24 h → tardía', () => {
  const ok = policySuggestion({ ratePlan: 'flexible', checkIn: CHECKIN, nights: 3, requestedAt: at('2026-11-19T19:00:00Z'), originalAmountCents: 30000000 });
  assert.equal(ok.rule, 'full');
  assert.equal(ok.amountCents, 30000000);
  const late = policySuggestion({ ratePlan: 'flexible', checkIn: CHECKIN, nights: 3, requestedAt: at('2026-11-20T08:00:00Z'), originalAmountCents: 30000000 });
  assert.equal(late.rule, 'late');
  // 300.000 − 100.000 − 10.500 = 189.500
  assert.equal(late.amountCents, 18950000);
});

test('una sola noche fuera de plazo → no queda nada por reembolsar', () => {
  const p = policySuggestion({ ratePlan: 'best', checkIn: CHECKIN, nights: 1, requestedAt: at('2026-11-19T10:00:00Z'), originalAmountCents: 20000000 });
  assert.equal(p.rule, 'late');
  assert.equal(p.amountCents, 0);
});

test('no-show: más de 24 h después de la hora de check-in → 0', () => {
  const p = policySuggestion({ ratePlan: 'flexible', checkIn: CHECKIN, nights: 2, requestedAt: at('2026-11-21T21:00:00Z'), originalAmountCents: 30000000 });
  assert.equal(p.rule, 'no_show');
  assert.equal(p.amountCents, 0);
});

test('plan desconocido (pagos de MP): devuelve las dos lecturas para que el admin elija', () => {
  const p = policySuggestion({ ratePlan: null, checkIn: CHECKIN, nights: 2, requestedAt: at('2026-11-17T10:00:00Z'), originalAmountCents: 40000000 });
  assert.equal(p.rule, 'unknown_plan');
  assert.equal(p.amountCents, null);
  assert.equal(p.alternatives.flexible, 40000000, 'Flexible: más de 24 h antes → 100%');
  assert.equal(p.alternatives.strict, 18600000, 'Estricta: menos de 7 días → tardía');
});

test('sin monto pagado o sin fecha no sugiere monto', () => {
  assert.equal(policySuggestion({ ratePlan: 'best', checkIn: CHECKIN, originalAmountCents: null }).rule, 'unknown_amount');
  assert.equal(policySuggestion({ ratePlan: 'best', checkIn: '', originalAmountCents: 100 }).rule, 'unknown_dates');
});

/* ── Datos bancarios cifrados ──────────────────────────────────────────── */

const BANK = { bankName: 'Bancolombia', accountType: 'ahorros', accountNumber: '12345678901', holderName: 'Ana Ruiz', docType: 'CC', docNumber: '1053999888' };

test('sealBankDetailsFields cifra (sin texto en claro) y openBankDetails lo recupera', () => {
  const fields = sealBankDetailsFields('EST-B1', BANK);
  assert.equal(fields.bankDetailsEncrypted, true);
  assert.equal(fields.bankDetails, undefined);
  const raw = JSON.stringify(fields);
  assert.ok(!raw.includes('12345678901'), 'el número de cuenta no queda en claro');
  assert.ok(!raw.includes('1053999888'), 'el documento no queda en claro');
  assert.equal(fields.bankDetailsSummary.accountLast4, '8901');
  const opened = openBankDetails({ bookingCode: 'EST-B1', ...fields });
  assert.equal(opened.accountNumber, '12345678901');
});

test('maskBankDetails (correo a tesorería) deja solo los últimos dígitos', () => {
  const m = store.maskBankDetails(BANK);
  assert.equal(m.accountNumber, '••••8901');
  assert.equal(m.docNumber, '••••888');
  assert.equal(m.bankName, 'Bancolombia');
});

test('AAD: un sobre copiado a OTRO reembolso no se puede abrir', () => {
  const fields = sealBankDetailsFields('EST-B1', BANK);
  assert.equal(openBankDetails({ bookingCode: 'EST-OTRO', ...fields }), null);
});

test('redactRefund: sin permiso solo el resumen; con refunds.mark_done los datos completos; nunca el sobre', () => {
  const rec = { bookingCode: 'EST-B1', status: 'BANK_DETAILS_READY', ...sealBankDetailsFields('EST-B1', BANK) };
  const hidden = redactRefund(rec, { canSeeBank: false });
  assert.equal(hidden.bankDetails, undefined);
  assert.equal(hidden.bankDetailsSealed, undefined);
  assert.equal(hidden.bankDetailsVisible, false);
  assert.equal(hidden.bankDetailsSummary.accountLast4, '8901');
  const shown = redactRefund(rec, { canSeeBank: true });
  assert.equal(shown.bankDetails.accountNumber, '12345678901');
  assert.equal(shown.bankDetailsSealed, undefined);
  assert.equal(shown.bankDetailsVisible, true);
});

test('registro legado con datos en claro: se ocultan sin permiso y se cifran en la siguiente escritura', async () => {
  reset();
  const legacy = { bookingCode: 'EST-LEG', status: 'BANK_DETAILS_READY', bankDetails: { ...BANK }, auditLog: [] };
  await memStore('refunds').set('EST-LEG', JSON.stringify(legacy));
  assert.equal(redactRefund(legacy, { canSeeBank: false }).bankDetails, undefined);
  await transitionStatus('EST-LEG', 'PROCESSING', 'admin@x.co', 'en proceso', {});
  const raw = await memStore('refunds').get('EST-LEG');
  assert.ok(!raw.includes('12345678901'), 'migrado: ya no hay número en claro');
  const after = await getRefund('EST-LEG');
  assert.equal(openBankDetails(after).accountNumber, '12345678901');
});

test('saveBankDetails guarda cifrado (lo que usa el formulario del huésped)', async () => {
  reset();
  await memStore('refunds').set('EST-F1', JSON.stringify({ bookingCode: 'EST-F1', route: 'MANUAL_BANK', status: 'NEEDS_BANK_DETAILS', auditLog: [] }));
  const res = await saveBankDetails('EST-F1', BANK, 'guest');
  assert.equal(res.ok, true);
  const raw = await memStore('refunds').get('EST-F1');
  assert.ok(!raw.includes('12345678901'));
  assert.equal(openBankDetails(JSON.parse(raw)).holderName, 'Ana Ruiz');
});

test('producción sin clave de cifrado: falla CERRADO (no guarda en claro)', () => {
  const saved = { key: process.env.GUEST_APP_DATA_ENCRYPTION_KEY, netlify: process.env.NETLIFY };
  delete process.env.GUEST_APP_DATA_ENCRYPTION_KEY;
  process.env.NETLIFY = 'true';
  try {
    assert.throws(() => sealBankDetailsFields('EST-X', BANK), (e) => e.statusCode === 503);
  } finally {
    process.env.GUEST_APP_DATA_ENCRYPTION_KEY = saved.key;
    if (saved.netlify === undefined) delete process.env.NETLIFY; else process.env.NETLIFY = saved.netlify;
  }
});
