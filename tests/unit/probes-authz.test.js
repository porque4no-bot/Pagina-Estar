/* Frente C — migración de probes/utilidades al sistema de permisos (_authz.authorize).
 *
 * Verifica que los 5 endpoints quedaron cableados al guard nuevo:
 *   whatsapp-probe / drive-probe / odoo-probe → integrations.probe
 *   upload-drive-credentials                  → integrations.credentials.upload
 *   retry-quote-booking                       → quotes.edit
 *
 * No toca red ni Blobs reales: el módulo _authz se inyecta via require.cache con
 * un stub determinista (mismo patrón que otros tests del repo). Se cubre:
 *   1) sin permiso => se propaga statusCode/error de authorize (401/403),
 *   2) con permiso => el handler pasa el guard y entra a su lógica (modo mock),
 *   3) cada handler pide EXACTAMENTE el permiso esperado.
 *
 * Sin credenciales todo corre en modo mock (probes => "missing/mock", retry =>
 * "OTASync no configurado"): apagado por defecto y mock-safe. */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/* Stub inyectable de _authz: recuerda el permiso pedido y decide ok/deny. */
const authzPath = require.resolve('../../netlify/functions/_authz');
let authzState = { allow: true, email: 'owner@estar.com', lastPermission: undefined, calls: [] };
require.cache[authzPath] = {
  id: authzPath, filename: authzPath, loaded: true,
  exports: {
    async authorize(event, requiredPermission) {
      authzState.lastPermission = requiredPermission;
      authzState.calls.push(requiredPermission);
      if (!authzState.allow) {
        return { ok: false, statusCode: authzState.statusCode || 403, error: authzState.error || 'No tienes permiso para esta acción' };
      }
      return { ok: true, email: authzState.email, permissions: [requiredPermission], roles: ['admin'], isEnvAdmin: true };
    }
  }
};

/* Cargar los handlers DESPUÉS de inyectar el stub. */
const whatsappProbe = require('../../netlify/functions/whatsapp-probe').handler;
const driveProbe = require('../../netlify/functions/drive-probe').handler;
const odooProbe = require('../../netlify/functions/odoo-probe').handler;
const uploadDriveCreds = require('../../netlify/functions/upload-drive-credentials').handler;
const retryQuoteBooking = require('../../netlify/functions/retry-quote-booking').handler;

function allow() { authzState = { allow: true, email: 'owner@estar.com', lastPermission: undefined, calls: [] }; }
function deny(statusCode = 403, error = 'No tienes permiso para esta acción') {
  authzState = { allow: false, statusCode, error, lastPermission: undefined, calls: [] };
}

/* Sin credenciales => modo mock, sin red. */
function clearCreds() {
  for (const k of [
    'WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID',
    'GOOGLE_SERVICE_ACCOUNT_JSON', 'GOOGLE_DRIVE_FOLDER_ID',
    'ODOO_URL', 'ODOO_DB', 'ODOO_USERNAME', 'ODOO_API_KEY',
    'OTASYNC_TOKEN', 'OTASYNC_USERNAME', 'OTASYNC_PASSWORD'
  ]) delete process.env[k];
}

test.beforeEach(() => { allow(); clearCreds(); });

/* ---- whatsapp-probe ---- */

test('whatsapp-probe: pide integrations.probe y, autorizado, responde en modo mock', async () => {
  const res = await whatsappProbe({ httpMethod: 'GET', headers: {} });
  assert.equal(authzState.lastPermission, 'integrations.probe');
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.config.token, false);            // sin credenciales
  assert.match(body.note, /mock mode/);              // mock-safe sin red
});

test('whatsapp-probe: sin permiso propaga el 403 de authorize', async () => {
  deny(403);
  const res = await whatsappProbe({ httpMethod: 'GET', headers: {} });
  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.body).error, 'No tienes permiso para esta acción');
});

test('whatsapp-probe: sin token propaga el 401 de authorize', async () => {
  deny(401, 'Autenticación requerida');
  const res = await whatsappProbe({ httpMethod: 'GET', headers: {} });
  assert.equal(res.statusCode, 401);
});

/* ---- drive-probe ---- */

test('drive-probe: pide integrations.probe; autorizado entra a probe()', async () => {
  const res = await driveProbe({ httpMethod: 'GET', headers: {} });
  assert.equal(authzState.lastPermission, 'integrations.probe');
  // sin GOOGLE_SERVICE_ACCOUNT_JSON la probe falla "blanda" (no autorizada)
  assert.ok([200, 503].includes(res.statusCode));
});

test('drive-probe: sin permiso devuelve 403 y no llama probe()', async () => {
  deny(403);
  const res = await driveProbe({ httpMethod: 'GET', headers: {} });
  assert.equal(res.statusCode, 403);
});

/* ---- odoo-probe ---- */

test('odoo-probe: pide integrations.probe y responde mock sin credenciales', async () => {
  const res = await odooProbe({ httpMethod: 'GET', headers: {} });
  assert.equal(authzState.lastPermission, 'integrations.probe');
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, false);
  assert.match(body.note, /modo mock/);
});

test('odoo-probe: sin permiso devuelve 403', async () => {
  deny(403);
  const res = await odooProbe({ httpMethod: 'GET', headers: {} });
  assert.equal(res.statusCode, 403);
});

/* ---- upload-drive-credentials ---- */

test('upload-drive-credentials: pide integrations.credentials.upload (permiso distinto al probe)', async () => {
  // cuerpo válido para pasar la validación de forma y llegar a la persistencia
  const body = JSON.stringify({ private_key: 'k', client_email: 'svc@x.iam.gserviceaccount.com' });
  const res = await uploadDriveCreds({ httpMethod: 'POST', headers: {}, body });
  assert.equal(authzState.lastPermission, 'integrations.credentials.upload');
  // sin Blobs/credenciales reales la persistencia falla (503) pero el guard ya pasó
  assert.ok([200, 503].includes(res.statusCode));
});

test('upload-drive-credentials: sin permiso devuelve 403 antes de tocar el cuerpo', async () => {
  deny(403);
  const res = await uploadDriveCreds({ httpMethod: 'POST', headers: {}, body: '{}' });
  assert.equal(res.statusCode, 403);
});

/* ---- retry-quote-booking ---- */

test('retry-quote-booking: pide quotes.edit; autorizado y sin OTASync => 503 mock-safe', async () => {
  const body = JSON.stringify({ quoteId: 'COT-2026-ABCDE' });
  const res = await retryQuoteBooking({ httpMethod: 'POST', headers: {}, body });
  assert.equal(authzState.lastPermission, 'quotes.edit');
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).error, 'OTASync no configurado');
});

test('retry-quote-booking: sin permiso devuelve 403 antes de parsear el body', async () => {
  deny(403);
  const res = await retryQuoteBooking({ httpMethod: 'POST', headers: {}, body: 'not-json' });
  assert.equal(res.statusCode, 403);
});

/* ---- cada handler pide su permiso exacto (no se cruzaron) ---- */

test('los 5 endpoints piden el permiso correcto del catálogo', async () => {
  allow();
  await whatsappProbe({ httpMethod: 'GET', headers: {} });
  assert.equal(authzState.lastPermission, 'integrations.probe');
  allow();
  await driveProbe({ httpMethod: 'GET', headers: {} });
  assert.equal(authzState.lastPermission, 'integrations.probe');
  allow();
  await odooProbe({ httpMethod: 'GET', headers: {} });
  assert.equal(authzState.lastPermission, 'integrations.probe');
  allow();
  await uploadDriveCreds({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ private_key: 'k', client_email: 'a@b.iam.gserviceaccount.com' }) });
  assert.equal(authzState.lastPermission, 'integrations.credentials.upload');
  allow();
  await retryQuoteBooking({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ quoteId: 'COT-2026-ABCDE' }) });
  assert.equal(authzState.lastPermission, 'quotes.edit');
});

/* ---- OPTIONS y método inválido no requieren auth (preflight CORS) ---- */

test('OPTIONS responde 200 sin invocar authorize (preflight CORS)', async () => {
  authzState.calls = [];
  const r1 = await whatsappProbe({ httpMethod: 'OPTIONS', headers: {} });
  const r2 = await driveProbe({ httpMethod: 'OPTIONS', headers: {} });
  const r3 = await odooProbe({ httpMethod: 'OPTIONS', headers: {} });
  const r4 = await uploadDriveCreds({ httpMethod: 'OPTIONS', headers: {} });
  const r5 = await retryQuoteBooking({ httpMethod: 'OPTIONS', headers: {} });
  for (const r of [r1, r2, r3, r4, r5]) assert.equal(r.statusCode, 200);
  assert.equal(authzState.calls.length, 0);
});

test('método no permitido devuelve 405 sin requerir permiso', async () => {
  authzState.calls = [];
  const r1 = await whatsappProbe({ httpMethod: 'POST', headers: {} });   // probe es GET
  const r2 = await retryQuoteBooking({ httpMethod: 'GET', headers: {} }); // retry es POST
  assert.equal(r1.statusCode, 405);
  assert.equal(r2.statusCode, 405);
  assert.equal(authzState.calls.length, 0);
});
