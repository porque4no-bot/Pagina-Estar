const assert = require('node:assert/strict');
const test = require('node:test');

process.env.GUEST_APP_TOKEN_SECRET = 'unit-test-token-secret';
process.env.GUEST_APP_DATA_ENCRYPTION_KEY = 'unit-test-encryption-secret';
process.env.GUEST_APP_DEMO_MODE = 'true';

const guestHelpers = require('../../netlify/functions/_guest-app');
const guestSession = require('../../netlify/functions/guest-session').handler;
const guestDriveModule = require('../../netlify/functions/guest-drive');
const guestDrive = guestDriveModule.handler;

function body(response) {
  return JSON.parse(response.body);
}

test('guest tokens identify the reservation and reject tampering', () => {
  const booking = { bookingCode: 'TEST-100', guestName: 'Andrea Restrepo' };
  const token = guestHelpers.signGuestToken(booking, 60);
  const session = guestHelpers.requireGuest({
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(session.sub, booking.bookingCode);

  assert.throws(() => guestHelpers.requireGuest({
    headers: { authorization: `Bearer ${token}x` }
  }), /invalid or expired/i);
});

test('guest session validates required fields and opens a demo reservation', async () => {
  const missing = await guestSession({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.10' },
    body: '{}'
  });
  assert.equal(missing.statusCode, 400);

  const response = await guestSession({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.11' },
    body: JSON.stringify({ bookingCode: 'EST-TEST', accessKey: 'Restrepo' })
  });
  const payload = body(response);
  assert.equal(response.statusCode, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.booking.demo, true);
  assert.ok(payload.token);
});

test('Drive webhook rejects requests without the internal secret', async () => {
  process.env.GUEST_APP_DRIVE_WEBHOOK_SECRET = 'drive-internal-secret';
  const response = await guestDrive({
    httpMethod: 'POST',
    headers: {},
    body: '{}'
  });
  assert.equal(response.statusCode, 401);
});

test('Drive webhook generates the contract PDF via service account without calling Apps Script', async () => {
  const originalFetch = global.fetch;
  process.env.GUEST_APP_DRIVE_WEBHOOK_SECRET = 'drive-internal-secret';
  process.env.GOOGLE_DRIVE_APPS_SCRIPT_URL = 'https://script.example/exec';
  process.env.GOOGLE_DRIVE_APPS_SCRIPT_SECRET = 'apps-script-secret';

  const driveSA = require('../../netlify/functions/_google-drive');
  const contractTemplate = require('../../netlify/functions/_contract-template');

  const originals = {
    isConfigured: driveSA.isConfigured,
    findOrCreateFolder: driveSA.findOrCreateFolder,
    uploadFile: driveSA.uploadFile
  };

  const uploads = [];
  let appsScriptCalled = false;
  let pdfInputRecord = null;

  try {
    driveSA.isConfigured = async () => true;
    driveSA.rootFolderId = () => 'root-folder-id';
    driveSA.findOrCreateFolder = async ({ name }) => `folder-${name}`;
    driveSA.uploadFile = async args => {
      uploads.push({ name: args.name, mimeType: args.mimeType, folderId: args.folderId });
      return { id: `id-${uploads.length}`, name: args.name, webViewLink: `https://drive/${args.name}` };
    };
    guestDriveModule._test.setDeps({
      renderContractPDF: async record => {
        pdfInputRecord = record;
        return Buffer.from('%PDF-fake-contents');
      }
    });

    global.fetch = async () => {
      appsScriptCalled = true;
      return new Response('{}', { status: 200 });
    };

    const response = await guestDrive({
      httpMethod: 'POST',
      headers: { authorization: 'Bearer drive-internal-secret' },
      body: JSON.stringify({
        kind: 'guest-contract',
        record: {
          bookingCode: 'TEST-200',
          signedName: 'Andrea <Test> Restrepo',
          documentNumber: '123456',
          acceptedTerms: true
        }
      })
    });

    assert.equal(response.statusCode, 201);
    const payload = body(response);
    assert.equal(payload.delivered, true);
    assert.equal(payload.drive.via, 'service-account');
    assert.equal(payload.drive.kind, 'guest-contract');
    assert.equal(appsScriptCalled, false, 'Apps Script must not be called when SA succeeds');

    const pdfUpload = uploads.find(u => u.mimeType === 'application/pdf');
    assert.ok(pdfUpload, 'expected a PDF upload to be performed');
    assert.match(pdfUpload.name, /^contrato-TEST-200-/);
    assert.equal(pdfUpload.folderId, 'folder-02_contratos');

    /* Confirm renderContractPDF was called with the correct booking code. */
    assert.ok(pdfInputRecord, 'renderContractPDF must have been called');
    assert.equal(pdfInputRecord.bookingCode, 'TEST-200');

    /* Confirm the template escapes HTML so guest names with `<` cannot inject markup. */
    const sampleHtml = contractTemplate.renderContractHTML({
      bookingCode: 'X<>&"', signedName: 'A <b> B'
    });
    assert.ok(!sampleHtml.includes('<b>'), 'template must escape angle brackets in inputs');
  } finally {
    driveSA.isConfigured = originals.isConfigured;
    driveSA.findOrCreateFolder = originals.findOrCreateFolder;
    driveSA.uploadFile = originals.uploadFile;
    guestDriveModule._test.resetDeps();
    global.fetch = originalFetch;
  }
});

test('Drive webhook accepts only a valid Apps Script JSON success response', async () => {
  const originalFetch = global.fetch;
  process.env.GUEST_APP_DRIVE_WEBHOOK_SECRET = 'drive-internal-secret';
  process.env.GOOGLE_DRIVE_APPS_SCRIPT_URL = 'https://script.example/exec';
  process.env.GOOGLE_DRIVE_APPS_SCRIPT_SECRET = 'apps-script-secret';

  try {
    global.fetch = async (url, options) => {
      assert.equal(url, process.env.GOOGLE_DRIVE_APPS_SCRIPT_URL);
      const envelope = JSON.parse(options.body);
      assert.equal(envelope.secret, process.env.GOOGLE_DRIVE_APPS_SCRIPT_SECRET);
      assert.equal(envelope.payload.kind, 'guest-contract');
      return new Response(JSON.stringify({ ok: true, contract: { id: 'pdf-1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const success = await guestDrive({
      httpMethod: 'POST',
      headers: { authorization: 'Bearer drive-internal-secret' },
      body: JSON.stringify({ kind: 'guest-contract', record: { bookingCode: 'TEST-100' } })
    });
    assert.equal(success.statusCode, 201);
    assert.equal(body(success).delivered, true);

    global.fetch = async () => new Response('<html>Sign in</html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' }
    });
    const invalid = await guestDrive({
      httpMethod: 'POST',
      headers: { authorization: 'Bearer drive-internal-secret' },
      body: JSON.stringify({ kind: 'guest-contract', record: { bookingCode: 'TEST-100' } })
    });
    assert.equal(invalid.statusCode, 502);
  } finally {
    global.fetch = originalFetch;
  }
});
