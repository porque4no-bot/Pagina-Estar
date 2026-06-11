const assert = require('node:assert/strict');
const test = require('node:test');

process.env.GUEST_APP_TOKEN_SECRET = 'unit-test-token-secret';
process.env.GUEST_APP_DATA_ENCRYPTION_KEY = 'unit-test-encryption-secret';
process.env.GUEST_APP_DEMO_MODE = 'true';

const guestCheckin = require('../../netlify/functions/guest-checkin');
const { _test } = guestCheckin;

test('Azure Colombian national ID docType maps to CC and Colombia without CountryRegion', () => {
  const parsed = _test.parseAzureResult({
    analyzeResult: {
      documents: [
        {
          docType: 'idDocument.nationalIdentityCard',
          fields: {
            FirstName: { valueString: 'Andrea', confidence: 0.98 },
            LastName: { valueString: 'Restrepo', confidence: 0.97 },
            DocumentNumber: { valueString: '1234567890', confidence: 0.99 },
            DateOfBirth: { valueDate: '1992-05-16', confidence: 0.96 }
          }
        }
      ]
    }
  });

  assert.equal(parsed.fields.documentType, 'CC');
  assert.equal(parsed.fields.nationality, 'Colombia');
});

test('guest check-in submit persists 3 guests and archives each document', async () => {
  const persisted = [];
  const archived = [];
  _test.setDeps({
    requireGuest: () => ({ sub: 'TEST-300', guest: 'Andrea Restrepo' }),
    protectRecord: record => record,
    guestStore: () => ({
      setJSON: async (key, value) => persisted.push({ key, value }),
      set: async () => {}
    }),
    archiveGuestPayload: async payload => {
      archived.push(payload);
      return { delivered: true };
    },
    syncGuestEvent: async () => ({ delivered: true })
  });

  const file = index => ({
    name: `doc-${index}.png`,
    type: 'image/png',
    dataUrl: `data:image/png;base64,${Buffer.from(`file-${index}`).toString('base64')}`
  });
  const guest = index => ({
    firstName: `Nombre${index}`,
    lastName: `Apellido${index}`,
    documentType: 'CC',
    documentNumber: `100${index}`,
    birthDate: '1990-01-01',
    nationality: 'Colombia',
    email: `guest${index}@example.com`,
    phone: `300000000${index}`,
    privacyAccepted: true
  });

  try {
    const response = await guestCheckin.handler({
      httpMethod: 'POST',
      headers: {},
      body: JSON.stringify({
        mode: 'submit',
        guests: [0, 1, 2].map(index => ({
          guest: guest(index),
          file: file(index),
          isPrimary: index === 0,
          analysisSource: 'azure',
          confidence: 98
        }))
      })
    });

    assert.equal(response.statusCode, 201);
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].value.guests.length, 3);
    assert.equal(persisted[0].value.guests[0].isPrimary, true);
    assert.equal(archived.length, 3);
    assert.deepEqual(archived.map(item => item.guestIndex), [0, 1, 2]);
    assert.equal(archived[2].guestName, 'Nombre2 Apellido2');
  } finally {
    _test.resetDeps();
  }
});
