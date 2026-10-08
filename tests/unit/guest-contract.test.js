/* Contrato de hospedaje de la guest app (frente guestapp):
   - se ve y se firma SOLO después del check-in, con los huéspedes registrados;
   - la vista previa es determinista y su SHA-256 es el que queda como evidencia
     (si el contrato cambió, la firma se rechaza con 409);
   - incluye el apartaestudio (roomName firmado en el token);
   - al firmar se genera el PDF (_pdf-render), se guarda su huella y se envía
     una copia al correo del huésped (best-effort). */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

process.env.GUEST_APP_TOKEN_SECRET = 'unit-test-token-secret';
process.env.GUEST_APP_DATA_ENCRYPTION_KEY = 'unit-test-encryption-secret';
process.env.GUEST_APP_DEMO_MODE = 'true';
delete process.env.GUEST_APP_SYNC_WEBHOOK_URL;
delete process.env.GUEST_APP_DRIVE_WEBHOOK_URL;
delete process.env.RESEND_API_KEY;

const guestHelpers = require('../../netlify/functions/_guest-app');
const guestActionModule = require('../../netlify/functions/guest-action');
const { renderContractHTML, CONSENT_TEXT } = require('../../netlify/functions/_contract-template');
const { renderContractPDF } = require('../../netlify/functions/_pdf-render');
const guestAction = guestActionModule.handler;

const BOOKING = 'EST-TEST-42';
const sha256 = value => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');

function body(response) {
  return JSON.parse(response.body);
}

function token(overrides = {}) {
  return guestHelpers.signGuestToken({
    bookingCode: BOOKING,
    guestName: 'María López',
    nights: 4,
    totalAmount: 1280000,
    capacity: 2,
    checkIn: '2026-11-01',
    checkOut: '2026-11-05',
    roomName: 'Selección',
    roomNumber: '402',
    ...overrides
  }, 300);
}

function makeEvent(payload, authToken, headers = {}) {
  return {
    httpMethod: 'POST',
    headers: {
      'x-forwarded-for': '127.0.0.1',
      authorization: authToken ? `Bearer ${authToken}` : '',
      ...headers
    },
    body: JSON.stringify(payload)
  };
}

function sampleCheckin(overrides = {}) {
  return {
    type: 'guest_checkin',
    checkinId: 'CHK-1700000000000-ABC123',
    bookingCode: BOOKING,
    createdAt: '2026-10-08T12:00:00.000Z',
    guests: [
      {
        guest: {
          firstName: 'María',
          lastName: 'López',
          documentType: 'CC',
          documentNumber: '52123456',
          nationality: 'Colombia',
          birthDate: '1990-01-01',
          email: 'maria@example.com',
          phone: '+57 300 111 2222'
        },
        isPrimary: true
      },
      {
        guest: {
          firstName: 'Juan',
          lastName: 'Pérez',
          documentType: 'Pasaporte',
          documentNumber: 'X998877',
          nationality: 'España',
          birthDate: '1988-05-05'
        },
        isPrimary: false
      }
    ],
    ...overrides
  };
}

/* Store en memoria por nombre: guest-checkins + guest-checkin-index se leen,
   todo setJSON queda capturado. */
function memoryStores({ checkin, protect = record => record, index = true } = {}) {
  const captured = [];
  const data = { 'guest-checkins': new Map(), 'guest-checkin-index': new Map() };
  if (checkin) {
    data['guest-checkins'].set(checkin.checkinId, protect(checkin));
    if (index) data['guest-checkin-index'].set(checkin.bookingCode, { checkinId: checkin.checkinId });
  }
  const guestStore = name => ({
    setJSON: async (key, value) => { captured.push({ name, key, value }); },
    get: async key => (data[name] ? data[name].get(key) || null : null)
  });
  return { guestStore, captured };
}

function setup({ checkin = sampleCheckin(), protect, index, sendContractCopy, renderPdf } = {}) {
  const stores = memoryStores({ checkin, protect, index });
  const mails = [];
  guestActionModule._test.setDeps({
    guestStore: stores.guestStore,
    protectRecord: record => record,
    unprotectRecord: guestHelpers.unprotectRecord,
    archiveGuestPayload: async () => ({ delivered: false, configured: false }),
    syncGuestEvent: async () => ({ delivered: false }),
    renderContractPDF: renderPdf || renderContractPDF,
    sendContractCopy: sendContractCopy || (async args => { mails.push(args); return { sent: true, id: 'mail-1' }; })
  });
  return { ...stores, mails };
}

async function preview(authToken, extra = {}) {
  const res = await guestAction(makeEvent({ type: 'contract_preview', lang: 'es', ...extra }, authToken));
  return { res, data: body(res) };
}

test.afterEach(() => guestActionModule._test.resetDeps());

test('contract_preview: 409 checkin_required when the booking has no check-in yet', async () => {
  setup({ checkin: null });
  const { res, data } = await preview(token());
  assert.equal(res.statusCode, 409);
  assert.equal(data.code, 'checkin_required');
});

test('contract_preview: renders the check-in guests (not the body), the studio and a stable hash', async () => {
  const { captured } = setup();
  const authToken = token();
  const first = await preview(authToken, {
    /* Un navegador manipulado no puede cambiar las partes del contrato. */
    guests: [{ guest: { firstName: 'Intruso', lastName: 'X', documentNumber: '1' }, isPrimary: true }]
  });
  assert.equal(first.res.statusCode, 200);
  assert.match(first.data.html, /Contrato de Hospedaje/);
  assert.match(first.data.html, /María López/);
  assert.match(first.data.html, /Juan Pérez/);
  assert.doesNotMatch(first.data.html, /Intruso/);
  assert.match(first.data.html, /Selección · 402/, 'el apartaestudio ya no sale "—"');
  assert.match(first.data.html, /52123456/, 'documento del huésped principal');
  assert.match(first.data.html, /Pendiente de firma/);
  assert.equal(first.data.contractHash, sha256(first.data.html), 'hash = SHA-256 del HTML mostrado');
  assert.equal(first.data.checkinId, 'CHK-1700000000000-ABC123');

  const second = await preview(authToken);
  assert.equal(second.data.html, first.data.html, 'render determinista');
  assert.equal(second.data.contractHash, first.data.contractHash);
  assert.equal(captured.length, 0, 'la vista previa no persiste nada');
});

test('contract_preview: English preview and a draft PDF on request', async () => {
  setup();
  const authToken = token();
  const en = await preview(authToken, { lang: 'en' });
  assert.match(en.data.html, /Hospitality Agreement/);
  assert.match(en.data.html, /Pending signature/);

  const pdf = await preview(authToken, { format: 'pdf' });
  assert.equal(pdf.res.statusCode, 200);
  assert.equal(Buffer.from(pdf.data.pdfBase64, 'base64').subarray(0, 4).toString(), '%PDF');
  assert.match(pdf.data.filename, /^contrato-hospedaje-EST-TEST-42-borrador\.pdf$/);
  assert.equal(pdf.data.contractHash, (await preview(authToken)).data.contractHash);
});

test('contract_preview: a check-in from ANOTHER booking is never used', async () => {
  setup({ checkin: sampleCheckin({ bookingCode: 'OTRA-RESERVA' }), index: false });
  const { res, data } = await preview(token(), { checkinId: 'CHK-1700000000000-ABC123' });
  assert.equal(res.statusCode, 409);
  assert.equal(data.code, 'checkin_required');
});

test('contract_preview: decrypts the encrypted check-in record (crypto vault + AAD)', async () => {
  setup({ protect: guestHelpers.protectRecord });
  const { res, data } = await preview(token());
  assert.equal(res.statusCode, 200);
  assert.match(data.html, /María López/);
});

test('contract: 409 checkin_required when signing before the check-in', async () => {
  setup({ checkin: null });
  const res = await guestAction(makeEvent({
    type: 'contract', signedName: 'María López', acceptedTerms: true, previewHash: 'a'.repeat(64)
  }, token()));
  assert.equal(res.statusCode, 409);
  assert.equal(body(res).code, 'checkin_required');
});

test('contract: 409 contract_changed when the hash the guest saw does not match', async () => {
  const { captured } = setup();
  const authToken = token();
  for (const previewHash of [undefined, 'f'.repeat(64)]) {
    const res = await guestAction(makeEvent({
      type: 'contract', signedName: 'María López', acceptedTerms: true, previewHash
    }, authToken));
    assert.equal(res.statusCode, 409);
    assert.equal(body(res).code, 'contract_changed');
  }
  /* Vista previa en inglés, firma pidiendo español → otro documento → 409. */
  const en = await preview(authToken, { lang: 'en' });
  const res = await guestAction(makeEvent({
    type: 'contract', signedName: 'María López', acceptedTerms: true, previewHash: en.data.contractHash, lang: 'es'
  }, authToken));
  assert.equal(res.statusCode, 409);
  assert.equal(captured.length, 0, 'nada se firma con un hash que no corresponde');
});

test('contract: signs with the previewed hash, Ley 527 evidence, PDF and an emailed copy', async () => {
  const { captured, mails } = setup();
  const authToken = token();
  const { data: shown } = await preview(authToken);
  const res = await guestAction(makeEvent({
    type: 'contract',
    signedName: 'María López',
    acceptedTerms: true,
    previewHash: shown.contractHash,
    acknowledgedAt: new Date().toISOString(),
    consentText: 'texto manipulado por el navegador',
    contractVersion: 'VERSION-FALSA',
    lang: 'es'
  }, authToken, {
    'x-nf-client-connection-ip': '203.0.113.42',
    'user-agent': 'Mozilla/5.0 (Macintosh; Apple) Test/1.0'
  }));
  assert.equal(res.statusCode, 201);
  const data = body(res);
  assert.match(data.eventId, /^GST-/);
  assert.equal(data.contractHash, shown.contractHash);
  assert.equal(data.emailed, true);
  assert.equal(Buffer.from(data.pdfBase64, 'base64').subarray(0, 4).toString(), '%PDF');
  assert.equal(data.pdfFilename, 'contrato-hospedaje-EST-TEST-42.pdf');

  const record = captured.find(item => item.name === 'guest-events').value;
  assert.equal(record.type, 'contract');
  assert.equal(record.contractHash, shown.contractHash, 'la evidencia es el hash del texto leído');
  /* Reproducible después: el mismo documento (token + check-in + idioma) da el
     mismo hash que quedó en la evidencia. */
  const session = guestHelpers.requireGuest({ headers: { authorization: `Bearer ${authToken}` } });
  const rebuilt = guestActionModule._test.buildContractDocument(
    session, { checkinId: 'CHK-1700000000000-ABC123', record: sampleCheckin() }, 'es'
  );
  assert.equal(record.contractHash, sha256(renderContractHTML(rebuilt)));
  assert.equal(record.contractHashScope, 'preview-html');
  assert.equal(record.contractHashAlgorithm, 'sha256');
  assert.equal(record.contractVersion, guestActionModule._test.CURRENT_CONTRACT_VERSION, 'versión fijada por el servidor');
  assert.equal(record.consentText, CONSENT_TEXT.es, 'texto de consentimiento canónico del servidor');
  assert.equal(record.clientIp, '203.0.113.42');
  assert.match(record.userAgent, /Test\/1\.0/);
  assert.ok(record.signedAt);
  assert.ok(record.acknowledgedAt);
  assert.equal(record.checkinId, 'CHK-1700000000000-ABC123');
  assert.equal(record.roomName, 'Selección');
  assert.equal(record.roomNumber, '402');
  assert.equal(record.guests.length, 2);
  assert.equal(record.email, 'maria@example.com');
  assert.match(record.pdfSha256, /^[a-f0-9]{64}$/);
  assert.equal(record.pdfSha256, crypto.createHash('sha256').update(Buffer.from(data.pdfBase64, 'base64')).digest('hex'));

  assert.equal(mails.length, 1);
  assert.equal(mails[0].record.email, 'maria@example.com');
  assert.ok(Buffer.isBuffer(mails[0].pdfBuffer));
});

test('contract: x-forwarded-for fallback and a bogus acknowledgedAt is dropped', async () => {
  const { captured } = setup();
  const authToken = token();
  const { data: shown } = await preview(authToken);
  const res = await guestAction(makeEvent({
    type: 'contract', signedName: 'María López', acceptedTerms: true,
    previewHash: shown.contractHash, acknowledgedAt: 'not-a-timestamp'
  }, authToken, { 'x-forwarded-for': '198.51.100.7, 10.0.0.1', 'user-agent': 'curl/8.0' }));
  assert.equal(res.statusCode, 201);
  const record = captured.find(item => item.name === 'guest-events').value;
  assert.equal(record.clientIp, '198.51.100.7');
  assert.equal(record.acknowledgedAt, '');
});

test('contract: a failed copy email or PDF never undoes the signature', async () => {
  const authToken = token();
  setup({ sendContractCopy: async () => { throw new Error('resend down'); } });
  let shown = (await preview(authToken)).data;
  let res = await guestAction(makeEvent({
    type: 'contract', signedName: 'María López', acceptedTerms: true, previewHash: shown.contractHash
  }, authToken));
  assert.equal(res.statusCode, 201);
  assert.equal(body(res).emailed, false);

  const { captured } = setup({ renderPdf: async () => { throw new Error('pdfkit boom'); } });
  shown = (await preview(authToken)).data;
  res = await guestAction(makeEvent({
    type: 'contract', signedName: 'María López', acceptedTerms: true, previewHash: shown.contractHash
  }, authToken));
  assert.equal(res.statusCode, 201);
  assert.equal(body(res).pdfBase64, undefined);
  assert.ok(captured.find(item => item.name === 'guest-events'), 'la firma quedó guardada');
});

test('contract template: wording is coherent (no cancellation policy is claimed) and deterministic', () => {
  const record = {
    bookingCode: 'X-1', lang: 'es', roomName: 'Reserva', roomNumber: '301', checkIn: '2026-11-01', checkOut: '2026-11-03',
    guests: [{ guest: { firstName: 'Ana', lastName: 'Ruiz', documentType: 'CC', documentNumber: '9' }, isPrimary: true }]
  };
  const a = renderContractHTML(record);
  const b = renderContractHTML({ ...record });
  assert.equal(a, b);
  assert.match(a, /Reserva · 301/);
  /* Sin total ni medio de pago no se imprimen filas vacías "—". */
  assert.doesNotMatch(a, /Medio de pago/);
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../guest.html'), 'utf8');
  assert.doesNotMatch(html, /políticas de convivencia y cancelación/, 'la casilla ya no menciona una política que el contrato no tiene');
});

test('contract PDF renders in both languages with the signature evidence', async () => {
  const base = {
    bookingCode: 'X-2', roomName: 'Clásica', checkIn: '2026-11-01', checkOut: '2026-11-03',
    guests: [{ guest: { firstName: 'Ana', lastName: 'Ruiz', documentType: 'CC', documentNumber: '9' }, isPrimary: true }],
    signedAt: '2026-10-08T15:00:00.000Z', eventId: 'GST-1', acceptedTerms: true, contractHash: 'a'.repeat(64),
    clientIp: '203.0.113.1', acknowledgedAt: '2026-10-08T14:59:00.000Z'
  };
  for (const lang of ['es', 'en']) {
    const pdf = await renderContractPDF({ ...base, lang });
    assert.ok(Buffer.isBuffer(pdf));
    assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
    assert.ok(pdf.length > 1500);
  }
  const draft = await renderContractPDF({ bookingCode: 'X-3' });
  assert.equal(draft.subarray(0, 4).toString(), '%PDF');
});

test('contract copy email: bilingual, escapes input and carries the hash', () => {
  const { contractCopyHtml } = require('../../netlify/functions/_email');
  const record = {
    bookingCode: 'EST-9', signedName: 'Ana <b>Ruiz</b>', signedAt: '2026-10-08T15:00:00.000Z',
    checkIn: '2026-11-01', checkOut: '2026-11-03', roomName: 'Selección', roomNumber: '402', contractHash: 'c'.repeat(64)
  };
  const es = contractCopyHtml({ record, lang: 'es' });
  const en = contractCopyHtml({ record, lang: 'en' });
  assert.match(es, /Contrato firmado/);
  assert.match(es, /Huella SHA-256/);
  assert.match(es, /c{64}/);
  assert.match(es, /Selección · 402/);
  assert.doesNotMatch(es, /<b>Ruiz<\/b>/);
  assert.match(en, /Agreement signed/);
  assert.match(en, /SHA-256 fingerprint/);
});
