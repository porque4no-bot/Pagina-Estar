const assert = require('node:assert/strict');
const test = require('node:test');

/* Mock-safe env: demo mode + dummy secrets so requiring the module and the
   shared _guest-app helpers never reach Blobs, OTASync or Azure. */
process.env.GUEST_APP_TOKEN_SECRET = 'unit-test-token-secret';
process.env.GUEST_APP_DATA_ENCRYPTION_KEY = 'unit-test-encryption-secret';
process.env.GUEST_APP_DEMO_MODE = 'true';
delete process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
delete process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
delete process.env.TTLOCK_ENABLED;

const guestCheckin = require('../../netlify/functions/guest-checkin');
const guestApp = require('../../netlify/functions/_guest-app');
const { _test } = guestCheckin;

const PNG = index => ({
  name: `doc-${index}.png`,
  type: 'image/png',
  dataUrl: `data:image/png;base64,${Buffer.from(`file-${index}`).toString('base64')}`
});

/* ---- documentType normalization (SIRE/TRA canonical list) ---- */

test('normalizeDocumentType maps common aliases onto canonical types', () => {
  assert.equal(_test.normalizeDocumentType('cc'), 'CC');
  assert.equal(_test.normalizeDocumentType('Cédula de ciudadanía'), 'CC');
  assert.equal(_test.normalizeDocumentType('national identity card'), 'CC');
  assert.equal(_test.normalizeDocumentType('Tarjeta de identidad'), 'TI');
  assert.equal(_test.normalizeDocumentType('cédula de extranjería'), 'CE');
  assert.equal(_test.normalizeDocumentType('residence permit'), 'CE');
  assert.equal(_test.normalizeDocumentType('PASSPORT'), 'Pasaporte');
  assert.equal(_test.normalizeDocumentType('Pasaporte'), 'Pasaporte');
});

test('normalizeDocumentType returns empty string for unknown labels', () => {
  assert.equal(_test.normalizeDocumentType('licencia de conducción'), '');
  assert.equal(_test.normalizeDocumentType('foo'), '');
  assert.equal(_test.normalizeDocumentType(''), '');
  assert.equal(_test.normalizeDocumentType(null), '');
});

/* ---- gender normalization ---- */

test('normalizeSex maps labels to M / F and empty otherwise', () => {
  assert.equal(_test.normalizeSex('Masculino'), 'M');
  assert.equal(_test.normalizeSex('male'), 'M');
  assert.equal(_test.normalizeSex('F'), 'F');
  assert.equal(_test.normalizeSex('Femenino'), 'F');
  assert.equal(_test.normalizeSex('x'), '');
  assert.equal(_test.normalizeSex(''), '');
});

/* ---- normalizeGuest captures the full SIRE/TRA raw material ---- */

test('normalizeGuest captures and normalizes all SIRE/TRA fields', () => {
  const guest = _test.normalizeGuest({
    guest: {
      firstName: 'Andrea',
      lastName: 'Restrepo',
      documentType: 'cedula de ciudadania',
      documentNumber: '1234567890',
      birthDate: '1992-05-16',
      nationality: 'Colombia',
      sex: 'Femenino',
      occupation: 'Ingeniera',
      birthPlace: 'Manizales, Colombia',
      residenceCountry: 'Colombia',
      residenceState: 'Caldas',
      residenceCity: 'Manizales',
      originCountry: 'Colombia',
      originState: 'Antioquia',
      originCity: 'Medellín',
      destination: 'Bogotá, Colombia',
      email: 'andrea@example.com',
      phone: '3001234567',
      privacyAccepted: true
    }
  }, {});

  assert.equal(guest.documentType, 'CC');
  assert.equal(guest.sex, 'F');
  assert.equal(guest.occupation, 'Ingeniera');
  assert.equal(guest.birthPlace, 'Manizales, Colombia');
  assert.equal(guest.residenceCountry, 'Colombia');
  assert.equal(guest.residenceState, 'Caldas');
  assert.equal(guest.residenceCity, 'Manizales');
  assert.equal(guest.originCountry, 'Colombia');
  assert.equal(guest.originState, 'Antioquia');
  assert.equal(guest.originCity, 'Medellín');
  assert.equal(guest.destination, 'Bogotá, Colombia');
});

/* ---- validation: foreign guests need a destination ---- */

test('isForeignGuest is true for non-Colombian nationality', () => {
  assert.equal(_test.isForeignGuest({ nationality: 'Colombia' }), false);
  assert.equal(_test.isForeignGuest({ nationality: 'Colombiano' }), false);
  assert.equal(_test.isForeignGuest({ nationality: 'España' }), true);
  assert.equal(_test.isForeignGuest({ nationality: '' }), false);
});

test('validateGuest requires destination for foreign guests', () => {
  const base = {
    firstName: 'John', lastName: 'Doe', documentType: 'Pasaporte',
    documentNumber: 'X1', birthDate: '1990-01-01', nationality: 'España',
    expirationDate: '2030-01-01', email: 'john@example.com', phone: '3000000000',
    privacyAccepted: true, destination: ''
  };
  const missing = _test.validateGuest(base);
  assert.ok(missing.missing.includes('destination'), 'foreign guest without destination should be missing it');

  const ok = _test.validateGuest({ ...base, destination: 'Lima, Perú' });
  assert.ok(!ok.missing.includes('destination'));
});

test('validateGuest does not require destination for Colombian guests', () => {
  const colombian = {
    firstName: 'Ana', lastName: 'Gómez', documentType: 'CC',
    documentNumber: '111', birthDate: '1990-01-01', nationality: 'Colombia',
    email: 'ana@example.com', phone: '3000000000', privacyAccepted: true,
    destination: ''
  };
  assert.ok(!_test.validateGuest(colombian).missing.includes('destination'));
});

test('validateGuest flags an unrecognized document type as missing', () => {
  const guest = {
    firstName: 'Ana', lastName: 'Gómez', documentType: 'Licencia',
    documentNumber: '111', birthDate: '1990-01-01', nationality: 'Colombia',
    email: 'ana@example.com', phone: '3000000000', privacyAccepted: true
  };
  assert.ok(_test.validateGuest(guest).missing.includes('documentType'));
});

/* ---- marketing consent (separate, opt-in, with date + channel) ---- */

test('normalizeMarketingConsent defaults to not accepted', () => {
  assert.deepEqual(_test.normalizeMarketingConsent({}), { accepted: false });
  assert.deepEqual(_test.normalizeMarketingConsent({ marketingAccepted: false }), { accepted: false });
});

test('normalizeMarketingConsent records timestamp and channel when accepted', () => {
  const consent = _test.normalizeMarketingConsent({ marketingAccepted: true });
  assert.equal(consent.accepted, true);
  assert.equal(consent.channel, 'guest-app');
  assert.ok(!Number.isNaN(Date.parse(consent.acceptedAt)));

  const custom = _test.normalizeMarketingConsent({
    marketingAccepted: true,
    marketingConsent: { channel: 'whatsapp' }
  });
  assert.equal(custom.channel, 'whatsapp');
});

/* ---- 3-attempts OCR gate → manual review (no hard reject) ---- */

test('normalizeGuestEntry flags manual review after MAX_OCR_ATTEMPTS without azure success', async () => {
  const session = { sub: 'S', capacity: 3 };
  const entry = {
    guest: {
      firstName: 'Ana', lastName: 'Gómez', documentType: 'CC',
      documentNumber: '111', birthDate: '1990-01-01', nationality: 'Colombia',
      email: 'ana@example.com', phone: '3000000000', privacyAccepted: true
    },
    file: PNG(0),
    analysisSource: 'azure-error',
    ocrAttempts: _test.MAX_OCR_ATTEMPTS
  };
  const normalized = await _test.normalizeGuestEntry(entry, 0, session);
  assert.equal(normalized.needsManualReview, true);
  assert.equal(normalized.ocrAttempts, _test.MAX_OCR_ATTEMPTS);
});

test('normalizeGuestEntry does not flag manual review when azure recognized the doc', async () => {
  const session = { sub: 'S', capacity: 3 };
  const entry = {
    guest: {
      firstName: 'Ana', lastName: 'Gómez', documentType: 'CC',
      documentNumber: '111', birthDate: '1990-01-01', nationality: 'Colombia',
      email: 'ana@example.com', phone: '3000000000', privacyAccepted: true
    },
    file: PNG(0),
    analysisSource: 'azure',
    ocrAttempts: 5
  };
  const normalized = await _test.normalizeGuestEntry(entry, 0, session);
  assert.equal(normalized.needsManualReview, false);
});

test('submit accepts a guest in manual review and persists the flag instead of rejecting', async () => {
  const persisted = [];
  _test.setDeps({
    requireGuest: () => ({
      sub: 'TEST-SIRE-1', guest: 'Ana Gómez', capacity: 1,
      checkIn: '2026-07-01', checkOut: '2026-07-04', roomNumber: '402', motive: 'Turismo'
    }),
    protectRecord: record => record,
    guestStore: () => ({ setJSON: async (key, value) => persisted.push({ key, value }), set: async () => {} }),
    archiveGuestPayload: async () => ({ delivered: true }),
    syncGuestEvent: async () => ({ delivered: true })
  });
  try {
    const response = await guestCheckin.handler({
      httpMethod: 'POST',
      headers: {},
      body: JSON.stringify({
        mode: 'submit',
        marketingAccepted: true,
        guests: [{
          guest: {
            firstName: 'Ana', lastName: 'Gómez', documentType: 'CC',
            documentNumber: '111', birthDate: '1990-01-01', nationality: 'Colombia',
            email: 'ana@example.com', phone: '3000000000', privacyAccepted: true,
            occupation: 'Docente'
          },
          file: PNG(0),
          isPrimary: true,
          analysisSource: 'azure-error',
          ocrAttempts: _test.MAX_OCR_ATTEMPTS
        }]
      })
    });

    assert.equal(response.statusCode, 201, response.body);
    const body = JSON.parse(response.body);
    assert.equal(body.manualReview, true);
    assert.equal(body.marketingConsent.accepted, true);
    /* persisted record carries reservation context (from signed session),
       marketing consent with date/channel, and the manual-review flag. */
    const record = persisted[0].value;
    assert.equal(record.manualReview, true);
    assert.equal(record.reservation.checkIn, '2026-07-01');
    assert.equal(record.reservation.checkOut, '2026-07-04');
    assert.equal(record.reservation.roomNumber, '402');
    assert.equal(record.reservation.motive, 'Turismo');
    assert.equal(record.marketingConsent.accepted, true);
    assert.equal(record.marketingConsent.channel, 'guest-app');
    assert.ok(!Number.isNaN(Date.parse(record.marketingConsent.acceptedAt)));
    assert.equal(record.guest.occupation, 'Docente');
    assert.equal(record.guests[0].document.needsManualReview, true);
  } finally {
    _test.resetDeps();
  }
});

test('submit blocks a foreign guest missing the destination (422, not persisted)', async () => {
  const persisted = [];
  _test.setDeps({
    requireGuest: () => ({ sub: 'TEST-SIRE-2', guest: 'John Doe', capacity: 1 }),
    protectRecord: record => record,
    guestStore: () => ({ setJSON: async (key, value) => persisted.push({ key, value }), set: async () => {} }),
    archiveGuestPayload: async () => ({ delivered: true }),
    syncGuestEvent: async () => ({ delivered: true })
  });
  try {
    const response = await guestCheckin.handler({
      httpMethod: 'POST',
      headers: {},
      body: JSON.stringify({
        mode: 'submit',
        guests: [{
          guest: {
            firstName: 'John', lastName: 'Doe', documentType: 'Pasaporte',
            documentNumber: 'X1', birthDate: '1990-01-01', nationality: 'España',
            expirationDate: '2030-01-01', email: 'john@example.com',
            phone: '3000000000', privacyAccepted: true
          },
          file: PNG(0),
          isPrimary: true,
          analysisSource: 'azure'
        }]
      })
    });
    assert.equal(response.statusCode, 422);
    const body = JSON.parse(response.body);
    assert.ok(body.validation.missing.includes('guests.0.destination'));
    assert.equal(persisted.length, 0);
  } finally {
    _test.resetDeps();
  }
});

/* ---- reservation context is signed into the JWT ---- */

test('signGuestToken signs reservation context so guest-checkin can trust it', () => {
  const token = guestApp.signGuestToken({
    bookingCode: 'EST-1', guestName: 'Ana Gómez', capacity: 2,
    nights: 3, totalAmount: 900000,
    checkIn: '2026-07-01', checkOut: '2026-07-04', roomNumber: '402', motive: 'Turismo'
  });
  const payload = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
  assert.equal(payload.checkIn, '2026-07-01');
  assert.equal(payload.checkOut, '2026-07-04');
  assert.equal(payload.roomNumber, '402');
  assert.equal(payload.motive, 'Turismo');
});

/* ---- TTLock hook: gated OFF by default, lazy, never throws ---- */

test('maybeIssueDoorCodes is a no-op when TTLOCK_ENABLED is not true', async () => {
  delete process.env.TTLOCK_ENABLED;
  const result = await _test.maybeIssueDoorCodes(
    { bookingCode: 'EST-1', checkinId: 'CHK-1', reservation: {}, guestName: 'Ana' },
    {}
  );
  assert.deepEqual(result, { configured: false, issued: false });
});

test('maybeIssueDoorCodes is mock-safe when enabled but TTLock has no credentials', async () => {
  process.env.TTLOCK_ENABLED = 'true';
  try {
    const result = await _test.maybeIssueDoorCodes(
      { bookingCode: 'EST-1', checkinId: 'CHK-1', reservation: { roomNumber: '402' }, guestName: 'Ana' },
      {}
    );
    /* _ttlock.js (created by another agent) is mock-safe without credentials:
       it returns { isMock: true, codes: [] }. The wrapper must never throw and
       must report no real codes were issued. */
    assert.equal(typeof result, 'object');
    assert.equal(result.issued, false);
  } finally {
    delete process.env.TTLOCK_ENABLED;
  }
});

/* ---- parseAzureResult now normalizes documentType + sex and surfaces birthPlace ---- */

test('parseAzureResult normalizes sex and surfaces birthPlace', () => {
  const parsed = _test.parseAzureResult({
    analyzeResult: {
      documents: [{
        docType: 'idDocument.passport',
        fields: {
          FirstName: { valueString: 'John', confidence: 0.98 },
          LastName: { valueString: 'Doe', confidence: 0.97 },
          DocumentNumber: { valueString: 'X1', confidence: 0.99 },
          Sex: { valueString: 'M', confidence: 0.9 },
          PlaceOfBirth: { valueString: 'Madrid', confidence: 0.8 }
        }
      }]
    }
  });
  assert.equal(parsed.fields.documentType, 'Pasaporte');
  assert.equal(parsed.fields.sex, 'M');
  assert.equal(parsed.fields.birthPlace, 'Madrid');
});
