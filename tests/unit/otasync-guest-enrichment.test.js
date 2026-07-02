/* otasync-webhook: enriquecimiento del huésped OTA hacia el maestro de clientes.
   extractGuest ahora también extrae país, idioma y fechas; syncReservationGuests
   se los pasa a upsertPartner (país/idioma/último checkout/noches), sin tocar la
   sincronización de canal existente. _odoo se inyecta por la caché de require. */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ODOO_PATH = path.join(__dirname, '../../netlify/functions/_odoo.js');
const OW_PATH = path.join(__dirname, '../../netlify/functions/otasync-webhook.js');

function loadWebhookWithOdooStub() {
  const captured = [];
  const fakeOdoo = {
    upsertPartner: async (data) => { captured.push(data); return { id: 1, isMock: false }; }
  };
  require.cache[ODOO_PATH] = { id: ODOO_PATH, filename: ODOO_PATH, loaded: true, exports: fakeOdoo };
  delete require.cache[OW_PATH];
  const mod = require(OW_PATH);
  return { mod, captured };
}
function cleanup() {
  delete require.cache[ODOO_PATH];
  delete require.cache[OW_PATH];
}

test('extractGuest extrae país, idioma y fechas además del canal', () => {
  const { mod } = loadWebhookWithOdooStub();
  try {
    const g = mod._test.extractGuest({
      id_reservations: 7,
      guests: [{ first_name: 'John', last_name: 'Doe', email: 'j@d.co', country: 'United States', language: 'en' }],
      channel: 'Booking.com', id_channels: '999',
      date_arrival: '2026-08-01', date_departure: '2026-08-04'
    });
    assert.equal(g.country, 'United States');
    assert.equal(g.lang, 'en');
    assert.equal(g.checkin, '2026-08-01');
    assert.equal(g.checkout, '2026-08-04');
    assert.equal(g.channel, 'Booking.com');
  } finally { cleanup(); }
});

test('syncReservationGuests pasa país/idioma/checkout/noches al upsert', async () => {
  process.env.OTASYNC_CHANNEL_ID = '66483';
  const { mod, captured } = loadWebhookWithOdooStub();
  try {
    const n = await mod._test.syncReservationGuests([{
      data_type: 'reservation', action: 'insert',
      data: {
        id_reservations: 7,
        guests: [{ first_name: 'John', last_name: 'Doe', email: 'j@d.co', country: 'US', language: 'en' }],
        channel: 'Booking.com', id_channels: '999',
        date_arrival: '2026-08-01', date_departure: '2026-08-04'
      }
    }]);
    assert.equal(n, 1);
    assert.equal(captured.length, 1);
    const v = captured[0];
    assert.equal(v.country, 'US');
    assert.equal(v.lang, 'en');
    assert.equal(v.lastCheckout, '2026-08-04');
    assert.equal(v.nights, 3);
    assert.deepEqual(v.tags, ['Booking.com']);   // canal intacto
    assert.match(v.comment, /OTASync/);
  } finally { cleanup(); delete process.env.OTASYNC_CHANNEL_ID; }
});

test('syncReservationGuests omite reservas del canal web propio', async () => {
  process.env.OTASYNC_CHANNEL_ID = '66483';
  const { mod, captured } = loadWebhookWithOdooStub();
  try {
    const n = await mod._test.syncReservationGuests([{
      data_type: 'reservation', action: 'insert',
      data: { guests: [{ first_name: 'Web', email: 'w@e.co' }], id_channels: '66483' }
    }]);
    assert.equal(n, 0);
    assert.equal(captured.length, 0);
  } finally { cleanup(); delete process.env.OTASYNC_CHANNEL_ID; }
});
