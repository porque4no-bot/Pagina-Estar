/* Frente codes — el código PERSONAL (ligado a un email, con mínimo de noches y
 * fechas bloqueadas) se respeta en el camino AUTORITATIVO del pago Wompi:
 * _direct-pricing.verifyDirectBookingAmount (lo usan create-wompi-signature y
 * wompi-webhook) valida con el email que viaja en la referencia firmada.
 * OTASync se simula con fetch; el store de descuentos es un fake en memoria. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeBlobs } = require('../helpers/fake-blobs');
const dstore = require('../../netlify/functions/_discount-store');

function withMockedFetch(roomsResponse, run) {
  const originalFetch = global.fetch;
  const keys = ['OTASYNC_TOKEN', 'OTASYNC_USERNAME', 'OTASYNC_PASSWORD', 'OTASYNC_PROPERTY_ID'];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  process.env.OTASYNC_TOKEN = 'test-token';
  process.env.OTASYNC_USERNAME = 'test-user';
  process.env.OTASYNC_PASSWORD = 'test-password';
  process.env.OTASYNC_PROPERTY_ID = '9889';
  const otaPath = require.resolve('../../netlify/functions/_otasync');
  const dpPath = require.resolve('../../netlify/functions/_direct-pricing');
  delete require.cache[otaPath];
  delete require.cache[dpPath];
  global.fetch = async (url) => {
    if (url.endsWith('/api/user/auth/login')) {
      return new Response(JSON.stringify({ pkey: 'test-pkey' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.endsWith('/api/engine/data/getRooms')) {
      return new Response(JSON.stringify(roomsResponse), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error('Unexpected fetch in mock: ' + url);
  };
  return Promise.resolve(run()).finally(() => {
    global.fetch = originalFetch;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    delete require.cache[otaPath];
    delete require.cache[dpPath];
  });
}

/* 200k/noche, 1 huésped, 2 noches → Estricta 400.000 (40.000.000 centavos). */
const OTA_200K = {
  rooms: [{
    id_room_types: 31348, avail: 3, price: 0,
    pricing_plans: [{ prices: [{ prices: { '2026-11-01': 200000, '2026-11-02': 200000 } }] }]
  }]
};
const DECODED = { checkin: '2026-11-01', checkout: '2026-11-03', guestsCount: 1, roomTypeId: '31348', extrasMask: '000000', email: 'ana@correo.co' };

async function seed(def) {
  const blobs = makeBlobs();
  const deps = { getStore: blobs.getStore };
  await dstore.saveCode(dstore.buildDefinition(Object.assign({ type: 'percent', value: 10, active: true }, def)).def, deps);
  return deps;
}

test('código ligado + email de la referencia correcto ⇒ se firma el monto con descuento', async () => {
  const deps = await seed({ code: 'GRACIAS-ANA', boundEmail: 'ana@correo.co' });
  await withMockedFetch(OTA_200K, async () => {
    const { verifyDirectBookingAmount } = require('../../netlify/functions/_direct-pricing');
    const ok = await verifyDirectBookingAmount(DECODED, 36000000, { discountCode: 'GRACIAS-ANA', email: DECODED.email, deps });
    assert.equal(ok.ok, true);
    assert.equal(ok.discount.applied, true);
    const full = await verifyDirectBookingAmount(DECODED, 40000000, { discountCode: 'GRACIAS-ANA', email: DECODED.email, deps });
    assert.equal(full.ok, false, 'con descuento válido, el precio lleno no cuadra');
  });
});

test('código ligado a OTRO email ⇒ no hay descuento (email_mismatch) y el monto rebajado se rechaza', async () => {
  const deps = await seed({ code: 'GRACIAS-ANA', boundEmail: 'ana@correo.co' });
  const other = Object.assign({}, DECODED, { email: 'pepe@correo.co' });
  await withMockedFetch(OTA_200K, async () => {
    const { verifyDirectBookingAmount, computeDirectBookingTotals } = require('../../netlify/functions/_direct-pricing');
    const totals = await computeDirectBookingTotals(other, { discountCode: 'GRACIAS-ANA', deps });
    assert.equal(totals.discount.applied, false);
    assert.equal(totals.discount.reason, 'email_mismatch');
    const cheated = await verifyDirectBookingAmount(other, 36000000, { discountCode: 'GRACIAS-ANA', deps });
    assert.equal(cheated.ok, false);
    assert.equal(cheated.reason, 'price_mismatch');
  });
});

test('mínimo de noches del código personal se exige al firmar', async () => {
  const deps = await seed({ code: 'LARGA3', boundEmail: 'ana@correo.co', minNights: 3 });
  await withMockedFetch(OTA_200K, async () => {
    const { computeDirectBookingTotals } = require('../../netlify/functions/_direct-pricing');
    const totals = await computeDirectBookingTotals(DECODED, { discountCode: 'LARGA3', deps });
    assert.equal(totals.discount.applied, false);
    assert.equal(totals.discount.reason, 'min_nights');
  });
});
