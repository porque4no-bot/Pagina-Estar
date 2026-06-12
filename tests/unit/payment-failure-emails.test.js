/* Unit tests for the guest notification emails sent by the payment webhooks
 * when a transaction is DECLINED/VOIDED/ERROR or stays PENDING. The helpers
 * accept dependency overrides (same pattern as handleQuotePayment), so no
 * network or Blobs access happens here. */

const test = require('node:test');
const assert = require('node:assert/strict');

const { _test: wompi } = require('../../netlify/functions/wompi-webhook');
const { _test: mercadopago } = require('../../netlify/functions/mercadopago-webhook');
const { createDirectReference } = require('../../netlify/functions/_payments');

function encodeWompiReference(parts) {
  return Buffer.from(parts.join('|'), 'utf8').toString('base64url');
}

function directWompiReference({ email = 'ana@example.com' } = {}) {
  return encodeWompiReference([
    '1', '260701', '260705', '2', '31348', 'Ana', 'Pérez',
    email, '+573001112233', '000000', 'EST-ABC12', '1', '0'
  ]);
}

function mailbox() {
  const sent = [];
  return { sent, sendEmail: async (msg) => { sent.push(msg); return { sent: true }; } };
}

/* Unique transaction ids per test: the dedup set is module-level state. */
let txSeq = 0;
function tx(reference) {
  txSeq += 1;
  return { id: `tx-test-${txSeq}`, reference, status: 'DECLINED', amount_in_cents: 100000 };
}

test('declined direct booking emails the guest in Spanish with a retry link', async () => {
  const box = mailbox();
  await wompi.notifyGuestPaymentOutcome(tx(directWompiReference()), 'declined', { sendEmail: box.sendEmail });

  assert.equal(box.sent.length, 1);
  assert.equal(box.sent[0].to, 'ana@example.com');
  assert.match(box.sent[0].subject, /no pudo procesarse/);
  assert.match(box.sent[0].html, /EST-ABC12/);
  assert.match(box.sent[0].html, /https:\/\/estar\.com\.co\/reservar\.html/);
  assert.match(box.sent[0].html, /3D Secure/);
  assert.match(box.sent[0].html, /No se realizó ningún cobro/);
});

test('pending direct booking warns the guest not to pay again', async () => {
  const box = mailbox();
  await wompi.notifyGuestPaymentOutcome(tx(directWompiReference()), 'pending', { sendEmail: box.sendEmail });

  assert.equal(box.sent.length, 1);
  assert.match(box.sent[0].subject, /en proceso/);
  assert.match(box.sent[0].html, /no vuelvas a pagar/i);
  assert.match(box.sent[0].html, /cobro doble/);
});

test('the same transaction and kind is only emailed once', async () => {
  const box = mailbox();
  const transaction = tx(directWompiReference());
  await wompi.notifyGuestPaymentOutcome(transaction, 'declined', { sendEmail: box.sendEmail });
  await wompi.notifyGuestPaymentOutcome(transaction, 'declined', { sendEmail: box.sendEmail });

  assert.equal(box.sent.length, 1);
});

test('a transaction that goes pending then declined gets both emails', async () => {
  const box = mailbox();
  const transaction = tx(directWompiReference());
  await wompi.notifyGuestPaymentOutcome(transaction, 'pending', { sendEmail: box.sendEmail });
  await wompi.notifyGuestPaymentOutcome(transaction, 'declined', { sendEmail: box.sendEmail });

  assert.equal(box.sent.length, 2);
  assert.match(box.sent[0].subject, /en proceso/);
  assert.match(box.sent[1].subject, /no pudo procesarse/);
});

test('undecodable or email-less references send nothing and do not throw', async () => {
  const box = mailbox();
  await wompi.notifyGuestPaymentOutcome(tx('garbage-reference'), 'declined', { sendEmail: box.sendEmail });
  await wompi.notifyGuestPaymentOutcome(tx(directWompiReference({ email: '' })), 'declined', { sendEmail: box.sendEmail });

  assert.equal(box.sent.length, 0);
});

test('declined quote payment emails the quote contact with its public link', async () => {
  const box = mailbox();
  const quote = {
    quoteId: 'COT-2026-AB12C',
    email: 'compras@example.com',
    contacto: 'María Gómez',
    empresa: 'Acme SAS',
    publicToken: 'tok123'
  };
  await wompi.notifyGuestPaymentOutcome(tx('COT-2026-AB12C'), 'declined', {
    sendEmail: box.sendEmail,
    getQuoteStore: () => ({}),
    loadQuote: async (_store, id) => (id === 'COT-2026-AB12C' ? quote : null)
  });

  assert.equal(box.sent.length, 1);
  assert.equal(box.sent[0].to, 'compras@example.com');
  assert.match(box.sent[0].html, /cotizacion\.html\?id=COT-2026-AB12C&t=tok123/);
  assert.match(box.sent[0].html, /María Gómez/);
});

test('quote store failures are non-fatal and send nothing', async () => {
  const box = mailbox();
  await assert.doesNotReject(
    wompi.notifyGuestPaymentOutcome(tx('COT-2026-ZZ99Z'), 'declined', {
      sendEmail: box.sendEmail,
      getQuoteStore: () => { throw new Error('blobs down'); },
      loadQuote: async () => null
    })
  );
  assert.equal(box.sent.length, 0);
});

test('sendEmail failures are swallowed (webhook must not break)', async () => {
  await assert.doesNotReject(
    wompi.notifyGuestPaymentOutcome(tx(directWompiReference()), 'declined', {
      sendEmail: async () => { throw new Error('smtp down'); }
    })
  );
});

test('mercadopago declined direct booking emails the guest', async () => {
  const box = mailbox();
  const reference = createDirectReference({
    checkin: '2026-07-01', checkout: '2026-07-05', guestsCount: 2, roomTypeId: '31348',
    firstName: 'Luis', lastName: 'Díaz', email: 'luis@example.com', phone: '+573001112233',
    extrasMask: '000000', bookingCode: 'EST-XYZ99', isColombian: true, isBusiness: false,
    amountCents: 100000
  });
  const transaction = { id: 'mp-test-1', reference, status: 'rejected', rawStatus: 'rejected' };
  await mercadopago.notifyGuestPaymentOutcome(transaction, 'declined', { sendEmail: box.sendEmail });

  assert.equal(box.sent.length, 1);
  assert.equal(box.sent[0].to, 'luis@example.com');
  assert.match(box.sent[0].subject, /no pudo procesarse/);
  assert.match(box.sent[0].html, /EST-XYZ99/);
  assert.match(box.sent[0].html, /https:\/\/estar\.com\.co\/reservar\.html/);
});

test('mercadopago pending payment is emailed once per payment id', async () => {
  const box = mailbox();
  const reference = createDirectReference({
    checkin: '2026-07-01', checkout: '2026-07-05', guestsCount: 1, roomTypeId: '31349',
    firstName: 'Sofía', lastName: 'Ramos', email: 'sofia@example.com', phone: '+573001112233',
    extrasMask: '000000', bookingCode: 'EST-PEN01', isColombian: true, isBusiness: false,
    amountCents: 50000
  });
  const transaction = { id: 'mp-test-2', reference, status: 'pending', rawStatus: 'in_process' };
  await mercadopago.notifyGuestPaymentOutcome(transaction, 'pending', { sendEmail: box.sendEmail });
  await mercadopago.notifyGuestPaymentOutcome(transaction, 'pending', { sendEmail: box.sendEmail });

  assert.equal(box.sent.length, 1);
  assert.match(box.sent[0].html, /no vuelvas a pagar/i);
});
