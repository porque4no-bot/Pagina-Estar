'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

process.env.REFUND_LINK_SECRET = process.env.REFUND_LINK_SECRET || 'test-refund-link-secret';

const {
  signBankDetailsToken, verifyBankDetailsToken, sanitizeBankDetails
} = require('../../netlify/functions/_refunds-store');

test('signBankDetailsToken / verifyBankDetailsToken round-trips the bookingCode', () => {
  const token = signBankDetailsToken('EST-ABCDE');
  const payload = verifyBankDetailsToken(token);
  assert.ok(payload);
  assert.equal(payload.sub, 'EST-ABCDE');
});

test('a tampered token is rejected', () => {
  const token = signBankDetailsToken('EST-ABCDE');
  const tampered = token.slice(0, -2) + (token.slice(-2) === 'aa' ? 'bb' : 'aa');
  assert.equal(verifyBankDetailsToken(tampered), null);
});

test('a token whose payload was swapped (different code) fails the signature', () => {
  const t1 = signBankDetailsToken('EST-AAAAA');
  const t2 = signBankDetailsToken('EST-BBBBB');
  // splice t1 signature onto t2 encoded → signature mismatch
  const forged = t2.split('.')[0] + '.' + t1.split('.')[1];
  assert.equal(verifyBankDetailsToken(forged), null);
});

test('an expired token is rejected', () => {
  const token = signBankDetailsToken('EST-ABCDE', -10); // already expired
  assert.equal(verifyBankDetailsToken(token), null);
});

test('garbage tokens return null, never throw', () => {
  assert.equal(verifyBankDetailsToken(''), null);
  assert.equal(verifyBankDetailsToken('nope'), null);
  assert.equal(verifyBankDetailsToken('a.b.c'), null);
  assert.equal(verifyBankDetailsToken(null), null);
});

test('sanitizeBankDetails accepts valid input and normalizes numbers', () => {
  const { valid, details } = sanitizeBankDetails({
    bankName: 'Bancolombia', accountType: 'ahorros', accountNumber: '123-456 789',
    holderName: 'Ana Ruiz', docType: 'CC', docNumber: '1.234.567'
  });
  assert.equal(valid, true);
  assert.equal(details.accountNumber, '123456789');
  assert.equal(details.docNumber, '1234567');
  assert.equal(details.bankName, 'Bancolombia');
});

test('sanitizeBankDetails rejects invalid account/doc types and missing fields', () => {
  assert.equal(sanitizeBankDetails({ bankName: 'X', accountType: 'cripto', accountNumber: '1', holderName: 'Y', docType: 'CC', docNumber: '1' }).valid, false);
  assert.equal(sanitizeBankDetails({ bankName: 'X', accountType: 'ahorros', accountNumber: '1', holderName: 'Y', docType: 'SSN', docNumber: '1' }).valid, false);
  assert.equal(sanitizeBankDetails({ bankName: '', accountType: 'ahorros', accountNumber: '1', holderName: 'Y', docType: 'CC', docNumber: '1' }).valid, false);
  assert.equal(sanitizeBankDetails({}).valid, false);
});

test('sanitizeBankDetails caps lengths', () => {
  const { details } = sanitizeBankDetails({
    bankName: 'b'.repeat(200), accountType: 'corriente', accountNumber: '9'.repeat(80),
    holderName: 'h'.repeat(300), docType: 'NIT', docNumber: '1'.repeat(80)
  });
  assert.ok(details.bankName.length <= 60);
  assert.ok(details.accountNumber.length <= 30);
  assert.ok(details.holderName.length <= 100);
  assert.ok(details.docNumber.length <= 30);
});
