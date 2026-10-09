/* Frente "Panel Hoy para recepción" — un check-in que queda en revisión manual
 * (el OCR no leyó el documento) abre la tarea "verificar documento" en la cola
 * de recepción. Un check-in normal no. La cola es falsa (require.cache). */

const assert = require('node:assert/strict');
const test = require('node:test');

process.env.GUEST_APP_TOKEN_SECRET = 'unit-test-token-secret';
process.env.GUEST_APP_DATA_ENCRYPTION_KEY = 'unit-test-encryption-secret';
process.env.GUEST_APP_DEMO_MODE = 'true';
delete process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
delete process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
delete process.env.TTLOCK_ENABLED;
delete process.env.GUEST_APP_STORE_DOCUMENTS;

const queued = [];
const opsId = require.resolve('../../netlify/functions/_ops-queue');
require.cache[opsId] = {
  id: opsId, filename: opsId, loaded: true,
  exports: { enqueue: async (t) => { queued.push(t); return { queued: true }; }, listOpen: async () => [], resolve: async () => ({ ok: true }), getItem: async () => null }
};

const guestCheckin = require('../../netlify/functions/guest-checkin');
const { _test } = guestCheckin;

const PNG = { name: 'doc.png', type: 'image/png', dataUrl: `data:image/png;base64,${Buffer.from('x').toString('base64')}` };

function submit(analysisSource, ocrAttempts) {
  return guestCheckin.handler({
    httpMethod: 'POST',
    headers: {},
    body: JSON.stringify({
      mode: 'submit',
      guests: [{
        guest: {
          firstName: 'Ana', lastName: 'Gómez', documentType: 'CC', documentNumber: '111',
          birthDate: '1990-01-01', nationality: 'Colombia', email: 'ana@example.com', phone: '3000000000', privacyAccepted: true
        },
        file: PNG, isPrimary: true, analysisSource, ocrAttempts
      }]
    })
  });
}

function deps() {
  _test.setDeps({
    requireGuest: () => ({ sub: '9001', guest: 'Ana Gómez', capacity: 1, checkIn: '2026-10-08', checkOut: '2026-10-10', roomNumber: '402' }),
    protectRecord: record => record,
    guestStore: () => ({ setJSON: async () => {}, set: async () => {} }),
    archiveGuestPayload: async () => ({ delivered: true }),
    syncGuestEvent: async () => ({ delivered: true })
  });
}

test('check-in en revisión manual → tarea checkin_manual_review sin PII', async () => {
  queued.length = 0;
  deps();
  try {
    const res = await submit('azure-error', _test.MAX_OCR_ATTEMPTS);
    assert.equal(res.statusCode, 201, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body.manualReview, true);
    assert.equal(queued.length, 1);
    const t = queued[0];
    assert.equal(t.kind, 'checkin_manual_review');
    assert.equal(t.dedupeKey, `checkin_manual_review:${body.checkinId}`);
    assert.equal(t.context.bookingCode, '9001');
    assert.equal(t.context.checkinId, body.checkinId);
    assert.equal(t.context.guestsToVerify, 1);
    assert.equal(t.context.roomNumber, '402');
    assert.doesNotMatch(JSON.stringify(t), /Gómez|111|ana@example/, 'sin nombre ni documento en la tarea');
  } finally {
    _test.resetDeps();
  }
});

test('check-in leído por OCR (sin revisión manual) → no encola tarea', async () => {
  queued.length = 0;
  deps();
  try {
    const res = await submit('azure', 1);
    assert.equal(res.statusCode, 201, res.body);
    assert.equal(JSON.parse(res.body).manualReview, false);
    assert.equal(queued.length, 0);
  } finally {
    _test.resetDeps();
  }
});
