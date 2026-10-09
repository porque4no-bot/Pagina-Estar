/* Idioma del huésped en la confirmación que manda el SERVIDOR. El navegador ya
 * no envía el correo; el webhook (Wompi o Mercado Pago) no sabía en qué idioma
 * reservó el huésped y la plantilla EN nunca se usaba. Ahora el idioma se guarda
 * al crear la firma / preferencia y el webhook lo lee. Blobs en memoria. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { saveBookingLang, readBookingLang } = require('../../netlify/functions/_booking-lang');
const { _test: wompi } = require('../../netlify/functions/wompi-webhook');
const { persistDirectSideData } = require('../../netlify/functions/create-mercadopago-preference')._test
  || require('../../netlify/functions/create-mercadopago-preference');

function mem() {
  const buckets = new Map();
  const getStore = (name) => {
    const n = typeof name === 'string' ? name : name.name;
    if (!buckets.has(n)) buckets.set(n, new Map());
    const b = buckets.get(n);
    return {
      async get(k) { return b.has(k) ? b.get(k) : null; },
      async set(k, v) { b.set(k, v); return { modified: true }; }
    };
  };
  return { getStore, buckets };
}

test('saveBookingLang guarda solo inglés; sin registro (o error) = español', async () => {
  const m = mem();
  assert.equal(await saveBookingLang('EST-EN1', 'en', m), true);
  assert.equal(await saveBookingLang('EST-ES1', 'es', m), false);
  assert.equal(await readBookingLang('EST-EN1', m), 'en');
  assert.equal(await readBookingLang('EST-ES1', m), 'es');
  assert.equal(await readBookingLang('EST-EN1', { getStore: () => { throw new Error('no blobs'); } }), 'es');
});

test('la preferencia de Mercado Pago guarda el idioma del huésped', async () => {
  const m = mem();
  const saved = await persistDirectSideData({ bookingCode: 'EST-MPEN', email: 'a@x.co', lang: 'en' }, { getStore: m.getStore, flag: async () => false });
  assert.equal(saved.lang, true);
  assert.equal(await readBookingLang('EST-MPEN', m), 'en');
});

test('wompi-webhook manda la confirmación en el idioma guardado', async () => {
  const calls = [];
  await wompi.sendDirectBookingConfirmation(
    { decoded: { email: 'ann@example.com', firstName: 'Ann', lastName: 'Lee', checkin: '2026-07-01', checkout: '2026-07-03', extrasMask: '0000000', bookingCode: 'EST-WEN' }, displayBookingCode: 'RES-950', nights: 2, paidAmount: 1, totalAmount: 1 },
    { sendConfirmationEmail: async (p) => { calls.push(p); return { sent: true }; }, readBookingLang: async (code) => (code === 'EST-WEN' ? 'en' : 'es') }
  );
  assert.equal(calls[0].lang, 'en');
});
