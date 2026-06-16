/* otasync-webhook: extracción del huésped del objeto `reservation` que llega por
   webhook, para sincronizarlo al maestro de clientes (Odoo). Prueba la forma del
   modelo de OTASync (array `guests` + `guest_email`/`channel`/`id_channels`). */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { _test } = require(path.join(__dirname, '../../netlify/functions/otasync-webhook.js'));
const { extractGuest } = _test;

test('extractGuest saca nombre/email/phone/canal del array guests', () => {
  const g = extractGuest({
    id_reservations: 555,
    guests: [{ first_name: 'María', last_name: 'Pérez', email: 'm@p.co', phone: '3001112233' }],
    channel: 'Booking.com', id_channels: '999'
  });
  assert.equal(g.name, 'María Pérez');
  assert.equal(g.email, 'm@p.co');
  assert.equal(g.phone, '3001112233');
  assert.equal(g.channel, 'Booking.com');
  assert.equal(g.channelId, '999');
});

test('extractGuest usa guest_email/email de nivel superior si el guest no trae', () => {
  const g = extractGuest({ guests: [{ first_name: 'Ana' }], guest_email: 'ana@x.co' });
  assert.equal(g.name, 'Ana');
  assert.equal(g.email, 'ana@x.co');
});

test('extractGuest cae a email como nombre si no hay nombre', () => {
  const g = extractGuest({ guest_email: 'solo@correo.co' });
  assert.equal(g.email, 'solo@correo.co');
  assert.equal(g.name, 'solo@correo.co');
});

test('extractGuest devuelve null sin datos útiles', () => {
  assert.equal(extractGuest({ guests: [{}] }), null);
  assert.equal(extractGuest(null), null);
  assert.equal(extractGuest({}), null);
});
