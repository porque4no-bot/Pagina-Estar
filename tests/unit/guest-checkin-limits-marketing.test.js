/* guest-checkin (frente guestapp):
   - cupos de uso SEPARADOS para leer documentos y para enviar el check-in;
   - el opt-in de marketing del check-in llega a Odoo (partner + Newsletter),
     solo con consentimiento y sin tumbar el check-in si Odoo falla;
   - errores con código estable (la app traduce);
   - menores: el servidor no les exige correo/WhatsApp/privacidad (el cliente
     ahora se alinea con esto). */
const assert = require('node:assert/strict');
const test = require('node:test');

process.env.GUEST_APP_TOKEN_SECRET = 'unit-test-token-secret';
process.env.GUEST_APP_DATA_ENCRYPTION_KEY = 'unit-test-encryption-secret';
process.env.GUEST_APP_DEMO_MODE = 'true';
delete process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
delete process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
delete process.env.TTLOCK_ENABLED;

const guestCheckin = require('../../netlify/functions/guest-checkin');
const { _test } = guestCheckin;

const file = (n = 0) => ({
  name: `doc-${n}.png`,
  type: 'image/png',
  dataUrl: `data:image/png;base64,${Buffer.from(`file-${n}`).toString('base64')}`
});

function adult(overrides = {}) {
  return {
    firstName: 'Andrea',
    lastName: 'Restrepo',
    documentType: 'CC',
    documentNumber: '1001',
    birthDate: '1990-01-01',
    nationality: 'Colombia',
    email: 'andrea@example.com',
    phone: '+57 300 111 1111',
    privacyAccepted: true,
    ...overrides
  };
}

function submitEvent(payload, ip = '10.30.0.1') {
  return { httpMethod: 'POST', headers: { 'x-forwarded-for': ip }, body: JSON.stringify({ mode: 'submit', ...payload }) };
}

function baseDeps(extra = {}) {
  const persisted = [];
  const odoo = { partners: [], mailing: [] };
  _test.setDeps({
    requireGuest: () => ({ sub: 'TEST-MKT-1', guest: 'Andrea Restrepo', capacity: 2 }),
    protectRecord: record => record,
    guestStore: name => ({
      setJSON: async (key, value) => persisted.push({ name, key, value }),
      set: async () => {},
      get: async () => null,
      delete: async () => {}
    }),
    archiveGuestPayload: async () => ({ delivered: false }),
    syncGuestEvent: async () => ({ delivered: false }),
    checkRateLimit: async () => ({ ok: true, retryAfter: 1 }),
    upsertPartner: async data => { odoo.partners.push(data); return { id: 77, created: true, isMock: false }; },
    addToMailingList: async data => { odoo.mailing.push(data); return { listId: 1, contactId: 9, isMock: false }; },
    ...extra
  });
  return { persisted, odoo };
}

test.afterEach(() => _test.resetDeps());

test('reading documents and submitting the check-in use separate rate-limit buckets', () => {
  assert.equal(_test.rateLimitForMode('submit').name, 'guest-checkin-submit');
  assert.equal(_test.rateLimitForMode('analyze').name, 'guest-checkin-analyze');
  assert.equal(_test.rateLimitForMode('analyze-minor-doc').name, 'guest-checkin-analyze');
  assert.ok(_test.RATE_LIMITS.analyze.limit >= 20, 'margen para reintentos de lectura de varios huéspedes');
  assert.ok(_test.RATE_LIMITS.submit.limit >= 5);
});

test('exhausting the analyze bucket does not block the submit', async () => {
  const buckets = new Map();
  const { persisted } = baseDeps({
    checkRateLimit: async (event, { name, limit }) => {
      const count = (buckets.get(name) || 0) + 1;
      buckets.set(name, count);
      return { ok: count <= limit, retryAfter: 60 };
    }
  });
  const analyzeEvent = {
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '10.30.0.9' },
    body: JSON.stringify({ mode: 'analyze', file: file(1), slotIndex: 0 })
  };
  let last;
  for (let i = 0; i <= _test.RATE_LIMITS.analyze.limit; i += 1) {
    last = await guestCheckin.handler(analyzeEvent);
  }
  assert.equal(last.statusCode, 429, 'el cupo de lectura se agota');
  assert.equal(JSON.parse(last.body).code, 'rate_limited');

  const submit = await guestCheckin.handler(submitEvent({ guests: [{ guest: adult(), file: file(2), isPrimary: true }] }, '10.30.0.9'));
  assert.equal(submit.statusCode, 201, 'el envío del check-in sigue disponible');
  assert.ok(persisted.some(item => item.name === 'guest-checkins'));
});

test('marketing opt-in reaches Odoo: partner with the opt-in tag + Newsletter list', async () => {
  const { odoo } = baseDeps();
  const res = await guestCheckin.handler(submitEvent({
    marketingAccepted: true,
    lang: 'en',
    guests: [{ guest: adult({ residenceCountry: 'España' }), file: file(3), isPrimary: true }]
  }));
  assert.equal(res.statusCode, 201);
  const data = JSON.parse(res.body);
  assert.equal(data.marketingConsent.accepted, true);
  assert.equal(data.marketingConsent.synced, true);
  assert.equal(odoo.partners.length, 1);
  assert.deepEqual(odoo.partners[0].tags, ['Huésped', 'Opt-in marketing']);
  assert.equal(odoo.partners[0].email, 'andrea@example.com');
  assert.equal(odoo.partners[0].country, 'España');
  assert.equal(odoo.partners[0].lang, 'en');
  assert.match(odoo.partners[0].comment, /TEST-MKT-1/);
  assert.equal(odoo.mailing.length, 1);
  assert.deepEqual(odoo.mailing[0], { email: 'andrea@example.com', name: 'Andrea Restrepo', listName: 'Newsletter' });
});

test('without marketing consent nothing is sent to Odoo (Ley 1581)', async () => {
  const { odoo } = baseDeps();
  const res = await guestCheckin.handler(submitEvent({
    guests: [{ guest: adult(), file: file(4), isPrimary: true }]
  }));
  assert.equal(res.statusCode, 201);
  assert.equal(JSON.parse(res.body).marketingConsent.accepted, false);
  assert.equal(odoo.partners.length, 0);
  assert.equal(odoo.mailing.length, 0);
});

test('an Odoo failure never breaks the check-in', async () => {
  baseDeps({
    upsertPartner: async () => { throw new Error('odoo down'); },
    addToMailingList: async () => { throw new Error('odoo down'); }
  });
  const res = await guestCheckin.handler(submitEvent({
    marketingAccepted: true,
    guests: [{ guest: adult(), file: file(5), isPrimary: true }]
  }));
  assert.equal(res.statusCode, 201);
  assert.equal(JSON.parse(res.body).marketingConsent.synced, false);
});

test('opt-in uses the first ADULT with email when the primary has none', async () => {
  baseDeps();
  const result = await _test.syncMarketingConsent({
    marketingConsent: { accepted: true, acceptedAt: '2026-10-08T00:00:00Z' },
    bookingCode: 'B-1',
    entries: [
      { guest: { firstName: 'Niño', lastName: 'X', email: '' }, isPrimary: true, isMinor: true },
      { guest: { firstName: 'Papá', lastName: 'X', email: 'papa@example.com' }, isPrimary: false, isMinor: false }
    ]
  });
  assert.equal(result.attempted, true);
  assert.equal(result.partner, true);
  const none = await _test.syncMarketingConsent({ marketingConsent: { accepted: true }, entries: [{ guest: { email: 'no-es-correo' } }] });
  assert.equal(none.attempted, false);
});

test('a foreign guest without destination gets a 422 with a stable code and field list', async () => {
  baseDeps();
  const res = await guestCheckin.handler(submitEvent({
    guests: [{ guest: adult({ nationality: 'España', documentType: 'Pasaporte', expirationDate: '2031-01-01' }), file: file(6), isPrimary: true }]
  }));
  assert.equal(res.statusCode, 422);
  const data = JSON.parse(res.body);
  assert.equal(data.code, 'validation_failed');
  assert.ok(data.validation.missing.includes('guests.0.destination'));
});

test('minors: email, WhatsApp and privacy are not required (matches the client)', () => {
  const minor = { firstName: 'Sofía', lastName: 'R', documentType: 'TI', documentNumber: '9', birthDate: '2015-01-01', nationality: 'Colombia' };
  assert.deepEqual(_test.validateGuest(minor, { isMinor: true }).missing, []);
  assert.deepEqual(
    _test.validateGuest(minor, { isMinor: false }).missing.sort(),
    ['email', 'phone', 'privacyAccepted'].sort()
  );
});

test('file errors carry stable codes; session errors answer 401 session_expired', async () => {
  baseDeps();
  const bad = await guestCheckin.handler({
    httpMethod: 'POST',
    headers: {},
    body: JSON.stringify({ mode: 'analyze', file: { name: 'x.gif', type: 'image/gif', dataUrl: 'data:image/gif;base64,R0lG' } })
  });
  assert.equal(bad.statusCode, 400);
  assert.equal(JSON.parse(bad.body).code, 'unsupported_type');

  _test.setDeps({
    requireGuest: () => { throw Object.assign(new Error('Tu sesión expiró'), { statusCode: 401, code: 'session_expired' }); }
  });
  const expired = await guestCheckin.handler(submitEvent({ guests: [] }));
  assert.equal(expired.statusCode, 401);
  assert.equal(JSON.parse(expired.body).code, 'session_expired');
});

test('a booking cancelled after the token was issued cannot submit the check-in (403 booking_cancelled)', async () => {
  const checked = [];
  const { persisted, odoo } = baseDeps({
    assertBookingActive: async code => {
      checked.push(code);
      throw Object.assign(new Error('Esta reserva fue cancelada.'), { statusCode: 403, code: 'booking_cancelled' });
    }
  });
  const res = await guestCheckin.handler(submitEvent({
    marketingAccepted: true,
    guests: [{ guest: adult(), file: file(9), isPrimary: true }]
  }));
  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.body).code, 'booking_cancelled');
  assert.deepEqual(checked, ['TEST-MKT-1'], 'se re-verifica la reserva del token');
  assert.equal(persisted.length, 0, 'no se guarda PII de una estadía cancelada');
  assert.equal(odoo.partners.length + odoo.mailing.length, 0, 'ni se sincroniza Odoo');
});
