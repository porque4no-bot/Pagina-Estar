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
    requireGuest: () => ({ sub: 'TEST-300', guest: 'Andrea Restrepo', capacity: 3 }),
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

test('calculateAge returns integer years for a valid birth date', () => {
  const today = new Date();
  const tenYearsAgo = new Date(today);
  tenYearsAgo.setFullYear(today.getFullYear() - 10);
  const birthDate = tenYearsAgo.toISOString().slice(0, 10);
  assert.equal(_test.calculateAge(birthDate), 10);
});

test('calculateAge returns 0 for invalid birth dates', () => {
  assert.equal(_test.calculateAge(''), 0);
  assert.equal(_test.calculateAge('not-a-date'), 0);
  assert.equal(_test.calculateAge(null), 0);
});

test('matchProgenitor finds adult by exact full name', () => {
  const result = _test.matchProgenitor('Carlos Pérez Gómez', [
    { guest: { firstName: 'Carlos', lastName: 'Pérez Gómez' } }
  ]);
  assert.equal(result.matched, true);
});

test('matchProgenitor returns false when no adult matches', () => {
  const result = _test.matchProgenitor('Carlos Eduardo', [
    { guest: { firstName: 'Juan', lastName: 'Ramírez' } }
  ]);
  assert.equal(result.matched, false);
});

test('guest check-in submit blocks minor without registro civil', async () => {
  _test.setDeps({
    requireGuest: () => ({ sub: 'TEST-MNR-1', guest: 'Carlos Pérez', capacity: 3 }),
    protectRecord: record => record,
    guestStore: () => ({
      setJSON: async () => {},
      set: async () => {},
      get: async () => null
    }),
    archiveGuestPayload: async () => ({ delivered: true }),
    syncGuestEvent: async () => ({ delivered: true })
  });

  const file = index => ({
    name: `doc-${index}.png`,
    type: 'image/png',
    dataUrl: `data:image/png;base64,${Buffer.from(`file-${index}`).toString('base64')}`
  });
  const today = new Date();
  const minorBirthDate = new Date(today);
  minorBirthDate.setFullYear(today.getFullYear() - 10);

  try {
    const response = await guestCheckin.handler({
      httpMethod: 'POST',
      headers: {},
      body: JSON.stringify({
        mode: 'submit',
        guests: [
          {
            guest: {
              firstName: 'Carlos', lastName: 'Pérez',
              documentType: 'CC', documentNumber: '111', birthDate: '1985-06-01',
              nationality: 'Colombia', email: 'c@example.com', phone: '3000000001',
              privacyAccepted: true
            },
            file: file(0),
            isPrimary: true
          },
          {
            guest: {
              firstName: 'Juanito', lastName: 'Pérez',
              documentType: 'CC', documentNumber: '222',
              birthDate: minorBirthDate.toISOString().slice(0, 10),
              nationality: 'Colombia', email: 'j@example.com', phone: '3000000002',
              privacyAccepted: true
            },
            file: file(1),
            isPrimary: false
          }
        ]
      })
    });
    assert.equal(response.statusCode, 422);
    const body = JSON.parse(response.body);
    assert.ok(body.validation.missing.includes('guests.1.registroCivil'));
  } finally {
    _test.resetDeps();
  }
});

test('guest check-in submit accepts minor when parent is present', async () => {
  const persisted = [];
  const archived = [];
  const minorBlobsSet = [];
  const draftPayload = {
    name: 'rcn.pdf',
    contentType: 'application/pdf',
    size: 1024,
    dataBase64: Buffer.from('registro-civil-pdf').toString('base64')
  };
  _test.setDeps({
    requireGuest: () => ({ sub: 'TEST-MNR-2', guest: 'Carlos Pérez', capacity: 3 }),
    protectRecord: record => record,
    guestStore: name => ({
      setJSON: async (key, value) => persisted.push({ name, key, value }),
      set: async (key, value, opts) => minorBlobsSet.push({ name, key, opts }),
      get: async key => key && key.startsWith('TEST-MNR-2/') ? draftPayload : null
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
  const today = new Date();
  const minorBirthDate = new Date(today);
  minorBirthDate.setFullYear(today.getFullYear() - 10);

  try {
    const response = await guestCheckin.handler({
      httpMethod: 'POST',
      headers: {},
      body: JSON.stringify({
        mode: 'submit',
        guests: [
          {
            guest: {
              firstName: 'Carlos', lastName: 'Pérez Gómez',
              documentType: 'CC', documentNumber: '111', birthDate: '1985-06-01',
              nationality: 'Colombia', email: 'c@example.com', phone: '3000000001',
              privacyAccepted: true
            },
            file: file(0),
            isPrimary: true
          },
          {
            guest: {
              firstName: 'Juanito', lastName: 'Pérez Restrepo',
              documentType: 'CC', documentNumber: '222',
              birthDate: minorBirthDate.toISOString().slice(0, 10),
              nationality: 'Colombia', email: 'j@example.com', phone: '3000000002',
              privacyAccepted: true
            },
            file: file(1),
            isPrimary: false,
            registroCivilDocumentRef: { key: 'TEST-MNR-2/registro-civil/abc.json', name: 'rcn.pdf', contentType: 'application/pdf', size: 1024 },
            fatherName: 'Carlos Pérez Gómez',
            motherName: 'María Restrepo'
          }
        ]
      })
    });

    assert.equal(response.statusCode, 201);
    const body = JSON.parse(response.body);
    assert.equal(body.validation.valid, true);
    assert.equal(persisted[0].value.guests[1].minorDocuments.parentPresent, true);
    assert.equal(persisted[0].value.guests[1].minorDocuments.parentMatchedIndex, 0);
    /* one archive per guest identity + one for the RCN */
    const rcnArchives = archived.filter(p => p.kind === 'guest-minor-rcn');
    assert.equal(rcnArchives.length, 1);
    assert.equal(rcnArchives[0].guestIndex, 1);
    /* RCN binary should be persisted in guest-minor-documents (no auth letter needed) */
    assert.equal(minorBlobsSet.length, 1);
    assert.ok(minorBlobsSet[0].key.includes('registro-civil'));
  } finally {
    _test.resetDeps();
  }
});

test('guest check-in submit blocks minor when no parent present and no letter', async () => {
  const draftPayload = {
    name: 'rcn.pdf',
    contentType: 'application/pdf',
    size: 1024,
    dataBase64: Buffer.from('registro-civil-pdf').toString('base64')
  };
  _test.setDeps({
    requireGuest: () => ({ sub: 'TEST-MNR-3', guest: 'Tia Ana', capacity: 3 }),
    protectRecord: record => record,
    guestStore: () => ({
      setJSON: async () => {},
      set: async () => {},
      get: async key => key && key.startsWith('TEST-MNR-3/') ? draftPayload : null
    }),
    archiveGuestPayload: async () => ({ delivered: true }),
    syncGuestEvent: async () => ({ delivered: true })
  });

  const file = index => ({
    name: `doc-${index}.png`,
    type: 'image/png',
    dataUrl: `data:image/png;base64,${Buffer.from(`file-${index}`).toString('base64')}`
  });
  const today = new Date();
  const minorBirthDate = new Date(today);
  minorBirthDate.setFullYear(today.getFullYear() - 10);

  try {
    const response = await guestCheckin.handler({
      httpMethod: 'POST',
      headers: {},
      body: JSON.stringify({
        mode: 'submit',
        guests: [
          {
            guest: {
              firstName: 'Ana', lastName: 'Salazar',
              documentType: 'CC', documentNumber: '111', birthDate: '1985-06-01',
              nationality: 'Colombia', email: 'a@example.com', phone: '3000000001',
              privacyAccepted: true
            },
            file: file(0),
            isPrimary: true
          },
          {
            guest: {
              firstName: 'Juanito', lastName: 'Pérez',
              documentType: 'CC', documentNumber: '222',
              birthDate: minorBirthDate.toISOString().slice(0, 10),
              nationality: 'Colombia', email: 'j@example.com', phone: '3000000002',
              privacyAccepted: true
            },
            file: file(1),
            isPrimary: false,
            registroCivilDocumentRef: { key: 'TEST-MNR-3/registro-civil/abc.json', name: 'rcn.pdf', contentType: 'application/pdf', size: 1024 },
            fatherName: 'Carlos Pérez Gómez',
            motherName: 'María Restrepo'
          }
        ]
      })
    });
    assert.equal(response.statusCode, 422);
    const body = JSON.parse(response.body);
    assert.ok(body.validation.missing.includes('guests.1.authorization'));
  } finally {
    _test.resetDeps();
  }
});

test('guest check-in submit accepts minor with RCN and authorization letter', async () => {
  const persisted = [];
  const archived = [];
  const minorBlobsSet = [];
  const draftPayload = {
    name: 'rcn.pdf',
    contentType: 'application/pdf',
    size: 1024,
    dataBase64: Buffer.from('registro-civil-pdf').toString('base64')
  };
  const authPayload = {
    name: 'autorizacion.pdf',
    contentType: 'application/pdf',
    size: 2048,
    dataBase64: Buffer.from('carta-autorizacion-pdf').toString('base64')
  };
  _test.setDeps({
    requireGuest: () => ({ sub: 'TEST-MNR-4', guest: 'Tia Ana', capacity: 3 }),
    protectRecord: record => record,
    guestStore: name => ({
      setJSON: async (key, value) => persisted.push({ name, key, value }),
      set: async (key, value, opts) => {
        if (name === 'guest-minor-documents') minorBlobsSet.push({ key, opts });
      },
      get: async key => {
        if (!key) return null;
        if (key.includes('autorizacion')) return authPayload;
        if (key.includes('registro-civil')) return draftPayload;
        return null;
      }
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
  const today = new Date();
  const minorBirthDate = new Date(today);
  minorBirthDate.setFullYear(today.getFullYear() - 10);

  try {
    const response = await guestCheckin.handler({
      httpMethod: 'POST',
      headers: {},
      body: JSON.stringify({
        mode: 'submit',
        guests: [
          {
            guest: {
              firstName: 'Ana', lastName: 'Salazar',
              documentType: 'CC', documentNumber: '111', birthDate: '1985-06-01',
              nationality: 'Colombia', email: 'a@example.com', phone: '3000000001',
              privacyAccepted: true
            },
            file: file(0),
            isPrimary: true
          },
          {
            guest: {
              firstName: 'Juanito', lastName: 'Pérez',
              documentType: 'CC', documentNumber: '222',
              birthDate: minorBirthDate.toISOString().slice(0, 10),
              nationality: 'Colombia', email: 'j@example.com', phone: '3000000002',
              privacyAccepted: true
            },
            file: file(1),
            isPrimary: false,
            registroCivilDocumentRef: { key: 'TEST-MNR-4/registro-civil/abc.json', name: 'rcn.pdf', contentType: 'application/pdf', size: 1024 },
            authorizationDocumentRef: { key: 'TEST-MNR-4/autorizacion/xyz.json', name: 'autorizacion.pdf', contentType: 'application/pdf', size: 2048 },
            fatherName: 'Carlos Pérez Gómez',
            motherName: 'María Restrepo'
          }
        ]
      })
    });
    assert.equal(response.statusCode, 201);
    const body = JSON.parse(response.body);
    assert.equal(body.validation.valid, true);
    const minorDocs = persisted[0].value.guests[1].minorDocuments;
    assert.equal(minorDocs.parentPresent, false);
    assert.ok(minorDocs.authorization);
    assert.equal(minorBlobsSet.length, 2);
    const rcnArchives = archived.filter(p => p.kind === 'guest-minor-rcn');
    const authArchives = archived.filter(p => p.kind === 'guest-minor-authorization');
    assert.equal(rcnArchives.length, 1);
    assert.equal(authArchives.length, 1);
  } finally {
    _test.resetDeps();
  }
});

test('guest check-in submit rejects guests beyond reservation capacity', async () => {
  _test.setDeps({
    requireGuest: () => ({ sub: 'TEST-301', guest: 'Andrea Restrepo', capacity: 2 }),
    protectRecord: record => record,
    guestStore: () => ({
      setJSON: async () => {},
      set: async () => {}
    }),
    archiveGuestPayload: async () => ({ delivered: true }),
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
          isPrimary: index === 0
        }))
      })
    });

    assert.equal(response.statusCode, 400);
    assert.match(JSON.parse(response.body).error, /máximo 2 huéspedes/);
  } finally {
    _test.resetDeps();
  }
});
