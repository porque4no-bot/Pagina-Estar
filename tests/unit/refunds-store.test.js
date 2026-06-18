const test = require('node:test');
const assert = require('node:assert/strict');

const { refundRoute, ROUTE, STATUS, REFUND_SLA_BUSINESS_DAYS, createRefundRequest } = require('../../netlify/functions/_refunds-store');

test('refundRoute: Mercado Pago card/account is gateway-auto', () => {
  assert.equal(refundRoute('mercadopago', 'visa'), ROUTE.GATEWAY_AUTO);
  assert.equal(refundRoute('mercadopago', 'master'), ROUTE.GATEWAY_AUTO);
  assert.equal(refundRoute('mercadopago', 'account_money'), ROUTE.GATEWAY_AUTO);
  assert.equal(refundRoute('mercadopago', 'debit_card'), ROUTE.GATEWAY_AUTO);
});

test('refundRoute: Mercado Pago offline methods are manual', () => {
  assert.equal(refundRoute('mercadopago', 'pse'), ROUTE.MANUAL_BANK);
  assert.equal(refundRoute('mercadopago', 'ticket'), ROUTE.MANUAL_BANK);
  assert.equal(refundRoute('mercadopago', 'efecty'), ROUTE.MANUAL_BANK);
});

test('refundRoute: Wompi card is assisted (no API), the rest manual', () => {
  assert.equal(refundRoute('wompi', 'CARD'), ROUTE.GATEWAY_ASSISTED);
  assert.equal(refundRoute('wompi', 'NEQUI'), ROUTE.MANUAL_BANK);
  assert.equal(refundRoute('wompi', 'PSE'), ROUTE.MANUAL_BANK);
  assert.equal(refundRoute('wompi', 'BANCOLOMBIA_TRANSFER'), ROUTE.MANUAL_BANK);
});

test('refundRoute: unknown / cash / null routes to manual', () => {
  assert.equal(refundRoute(null, null), ROUTE.MANUAL_BANK);
  assert.equal(refundRoute('', ''), ROUTE.MANUAL_BANK);
  assert.equal(refundRoute('datafono', 'cash'), ROUTE.MANUAL_BANK);
});

test('createRefundRequest degrades gracefully without a Blobs backend', async () => {
  const res = await createRefundRequest({
    booking: { bookingCode: 'TEST-REF-1', guestEmail: 'a@b.co', totalAmount: 500000 },
    paymentInfo: { paymentProvider: 'mercadopago', paymentMethod: 'visa' },
    clientIp: '127.0.0.1', source: 'web'
  });
  assert.equal(res.created, false);
});

test('createRefundRequest returns not-created for a booking with no code', async () => {
  const res = await createRefundRequest({ booking: {}, paymentInfo: {} });
  assert.equal(res.created, false);
  assert.equal(res.refund, null);
});

test('STATUS exposes the documented refund lifecycle states', () => {
  assert.equal(STATUS.NEEDS_REVIEW, 'NEEDS_REVIEW');
  assert.equal(STATUS.APPROVED, 'APPROVED');
  assert.equal(STATUS.PROCESSING, 'PROCESSING');
  assert.equal(STATUS.DONE, 'DONE');
});

test('REFUND_SLA_BUSINESS_DAYS is the single source for the 15-business-day promise', () => {
  assert.equal(REFUND_SLA_BUSINESS_DAYS, 15);
});
