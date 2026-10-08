/* Frente "Panel Hoy para recepción" — visor de check-ins (staff-checkin-view):
 * auth, descifrado, proyección mínima (sin correo/teléfono), documentos que
 * existen, auditoría de CADA acceso y fail-closed si la auditoría no se escribe.
 * Authz y rate-limit falsos en require.cache; Blobs en memoria; bóveda real. */

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.GUEST_APP_TOKEN_SECRET = 'unit-test-token-secret';
process.env.GUEST_APP_DATA_ENCRYPTION_KEY = 'unit-test-encryption-secret';
process.env.GUEST_APP_DEMO_MODE = 'true';

const { memStores } = require('../helpers/mem-blobs');
const { protectRecord, sealBinaryForStore } = require('../../netlify/functions/_guest-app');

const P = (m) => require.resolve('../../netlify/functions/' + m);
function fakeModule(id, exportsObj) {
  require.cache[id] = { id, filename: id, loaded: true, exports: exportsObj };
}

const CHK = `CHK-${Date.now() - 3600e3}-ABCDEF`;
const BOOKING = '9001';

function record() {
  return {
    type: 'guest_checkin', checkinId: CHK, bookingCode: BOOKING, createdAt: new Date(Date.now() - 3600e3).toISOString(),
    manualReview: true,
    reservation: { checkIn: '2026-10-08', checkOut: '2026-10-10', roomNumber: '402', motive: 'Turismo' },
    guests: [
      {
        guest: {
          firstName: 'John', lastName: 'Doe', documentType: 'Pasaporte', documentNumber: 'P999',
          nationality: 'Canadá', birthDate: '1985-02-02', sex: 'M', email: 'john@example.com', phone: '+1 555 0100',
          originCountry: 'Canadá', destination: 'Cartagena'
        },
        document: { needsManualReview: true, analysisSource: 'azure-error', ocrAttempts: 3 },
        isPrimary: true, isMinor: false
      },
      {
        guest: { firstName: 'Mia', lastName: 'Doe', documentType: 'TI', documentNumber: 'M1', nationality: 'Canadá', birthDate: '2015-03-03' },
        document: { needsManualReview: false }, isPrimary: false, isMinor: true,
        minorDocuments: { registroCivil: { name: 'rc.jpg' }, fatherName: 'John Doe', parentPresent: true }
      }
    ],
    status: 'received'
  };
}

function setup({ authOk = true, auditFails = false, demo = true } = {}) {
  fakeModule(P('_authz'), {
    authorize: async () => authOk
      ? { ok: true, email: 'rec@estar.co', permissions: ['guests.checkin.view'] }
      : { ok: false, statusCode: 403, error: 'No tienes permiso para esta acción' }
  });
  fakeModule(P('_rate-limit'), {
    checkRateLimit: async () => ({ ok: true }),
    rateLimitResponse: () => ({ statusCode: 429, headers: {}, body: '{}' })
  });
  delete require.cache[P('staff-checkin-view')];
  const mod = require('../../netlify/functions/staff-checkin-view');
  const imgBytes = Buffer.from('fake-jpeg-bytes');
  const sealed = sealBinaryForStore(imgBytes, `${BOOKING}|minor-rcn`);
  const blobs = memStores({
    'guest-checkins': { [CHK]: protectRecord(record()) },
    'guest-minor-documents': { [`${CHK}/1/registro-civil.jpg`]: sealed.value },
    'guest-documents': {}
  });
  blobs.stores['guest-minor-documents'].meta[`${CHK}/1/registro-civil.jpg`] = { contentType: 'image/jpeg' };
  blobs.getStore('staff-audit').failSet = auditFails;
  mod._test.resetDeps();
  mod._test.setDeps({ getStore: blobs.getStore, isDemoMode: () => demo });
  return { mod, blobs, imgBytes };
}

function get(mod, qs) {
  return mod.handler({ httpMethod: 'GET', queryStringParameters: qs, headers: { 'x-forwarded-for': '10.0.0.1' } });
}

function auditEntries(blobs) {
  return Object.values(blobs.stores['staff-audit'].data).map(v => JSON.parse(v));
}

test('sin permiso guests.checkin.view → 403 y no audita', async () => {
  const { mod, blobs } = setup({ authOk: false });
  const r = await get(mod, { checkinId: CHK });
  assert.equal(r.statusCode, 403);
  assert.equal(auditEntries(blobs).length, 0);
});

test('por checkinId: devuelve ocupantes del registro, sin correo/teléfono, y audita el acceso', async () => {
  const { mod, blobs } = setup();
  const r = await get(mod, { checkinId: CHK });
  assert.equal(r.statusCode, 200, r.body);
  const b = JSON.parse(r.body);
  assert.equal(b.bookingCode, BOOKING);
  assert.equal(b.audited, true);
  const ci = b.checkins[0];
  assert.equal(ci.manualReview, true);
  assert.equal(ci.guests.length, 2);
  assert.equal(ci.guests[0].documentNumber, 'P999');
  assert.equal(ci.guests[0].foreign, true);
  assert.equal(ci.guests[0].destination, 'Cartagena');
  assert.equal(ci.guests[1].isMinor, true);
  assert.equal(ci.guests[1].minor.parentPresent, true);
  assert.doesNotMatch(r.body, /john@example\.com/);
  assert.doesNotMatch(r.body, /555 0100/);
  assert.equal(ci.documents.length, 1, 'solo existe el registro civil del menor');
  assert.equal(ci.documents[0].kind, 'registro-civil');

  const audits = auditEntries(blobs);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'checkin.view');
  assert.equal(audits[0].actor, 'rec@estar.co');
  assert.equal(audits[0].bookingCode, BOOKING);
  assert.deepEqual(audits[0].checkinIds, [CHK]);
  assert.equal(audits[0].ip, '10.0.0.1');
});

test('por bookingCode: encuentra el check-in de esa reserva', async () => {
  const { mod } = setup();
  const r = await get(mod, { bookingCode: BOOKING });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(JSON.parse(r.body).checkins[0].checkinId, CHK);
  const none = await get(mod, { bookingCode: '0000' });
  assert.equal(none.statusCode, 404);
});

test('documento existente: lo descifra con la AAD correcta y audita; rechaza claves ajenas', async () => {
  const { mod, blobs, imgBytes } = setup();
  const r = await get(mod, { checkinId: CHK, doc: `${CHK}/1/registro-civil.jpg`, store: 'minor' });
  assert.equal(r.statusCode, 200, r.body);
  const b = JSON.parse(r.body);
  assert.equal(b.contentType, 'image/jpeg');
  assert.equal(Buffer.from(b.dataBase64, 'base64').toString(), imgBytes.toString());
  assert.equal(auditEntries(blobs).some(a => a.action === 'checkin.document'), true);

  const foreign = await get(mod, { checkinId: CHK, doc: 'CHK-1-OTRO/1/registro-civil.jpg', store: 'minor' });
  assert.equal(foreign.statusCode, 400);
  const badStore = await get(mod, { checkinId: CHK, doc: `${CHK}/1/registro-civil.jpg`, store: 'otro' });
  assert.equal(badStore.statusCode, 400);
});

test('fuera de demo, si la auditoría no se puede escribir NO entrega datos (fail-closed)', async () => {
  const { mod } = setup({ auditFails: true, demo: false });
  const r = await get(mod, { checkinId: CHK });
  assert.equal(r.statusCode, 503);
  assert.doesNotMatch(r.body, /P999/);
});

test('validaciones: checkinId inválido / sin parámetros / inexistente', async () => {
  const { mod, blobs } = setup();
  assert.equal((await get(mod, { checkinId: '../etc' })).statusCode, 400);
  assert.equal((await get(mod, {})).statusCode, 400);
  assert.equal((await get(mod, { checkinId: 'CHK-1700000000000-AAAAAA' })).statusCode, 404);
  assert.equal(auditEntries(blobs).length, 0, 'consultas sin datos no se auditan');
  const post = await mod.handler({ httpMethod: 'POST', headers: {} });
  assert.equal(post.statusCode, 405);
});
