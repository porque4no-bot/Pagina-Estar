/* Audiencias separadas: el enlace del formulario bancario de reembolso y la
 * sesión de la app del huésped NO son intercambiables. Antes los dos firmaban
 * {sub, exp} con el mismo HMAC (GUEST_APP_TOKEN_SECRET cuando REFUND_LINK_SECRET
 * no está): un token de sesión de guest.html (código + apellido) bastaba para
 * registrar la cuenta bancaria del reembolso, y el enlace del correo abría una
 * sesión del huésped. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

delete process.env.REFUND_LINK_SECRET;
process.env.GUEST_APP_TOKEN_SECRET = 'shared-guest-secret-for-audience-test';

const { signBankDetailsToken, verifyBankDetailsToken } = require('../../netlify/functions/_refunds-store');
const { signGuestToken, verifyGuestToken } = require('../../netlify/functions/_guest-app');

function legacySign(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

test('un token de sesión del huésped NO sirve como enlace del formulario bancario', () => {
  const session = signGuestToken({ bookingCode: '3273564', guestName: 'Ana', capacity: 2, nights: 2, totalAmount: 400000 });
  assert.ok(verifyGuestToken(session), 'la sesión es válida para la app');
  assert.equal(verifyBankDetailsToken(session), null);
});

test('el enlace bancario NO abre una sesión de la app del huésped (formato nuevo y viejo)', () => {
  const link = signBankDetailsToken('3273564');
  const p = verifyBankDetailsToken(link);
  assert.equal(p.sub, '3273564');
  assert.equal(p.scope, 'refund-bank');
  assert.equal(verifyGuestToken(link), null);

  const legacy = legacySign({ sub: '3273564', exp: Math.floor(Date.now() / 1000) + 3600 }, process.env.GUEST_APP_TOKEN_SECRET);
  assert.equal(verifyGuestToken(legacy), null, 'el enlace viejo tampoco abre sesión');
});

test('enlaces ya enviados con el formato viejo siguen funcionando hasta vencer', () => {
  const legacy = legacySign({ sub: '3273564', exp: Math.floor(Date.now() / 1000) + 3600 }, process.env.GUEST_APP_TOKEN_SECRET);
  assert.equal(verifyBankDetailsToken(legacy).sub, '3273564');
  const expired = legacySign({ sub: '3273564', exp: Math.floor(Date.now() / 1000) - 10 }, process.env.GUEST_APP_TOKEN_SECRET);
  assert.equal(verifyBankDetailsToken(expired), null);
});

test('un payload con scope distinto firmado con la clave del enlace no pasa', () => {
  const key = crypto.createHmac('sha256', process.env.GUEST_APP_TOKEN_SECRET).update('refund-bank-v1').digest();
  const forged = legacySign({ sub: '3273564', scope: 'otra-cosa', exp: Math.floor(Date.now() / 1000) + 3600 }, key);
  assert.equal(verifyBankDetailsToken(forged), null);
});
