const test = require('node:test');
const assert = require('node:assert/strict');

/* Pruebas SIN red del andamiaje de Facturación (Numera) + SIRE/TRA + documentos
   legales: permisos nuevos, flags gestionables, el stub gated de emisión y el
   listado mock-safe de borradores de factura. Todo con store/flag inyectados. */

/* ── _permissions: catálogo + asignación a roles ── */

test('_permissions incluye los 3 permisos nuevos en el catálogo', () => {
  const perms = require('../../netlify/functions/_permissions');
  for (const p of ['invoices.view', 'invoices.issue', 'docs.view']) {
    assert.ok(perms.ALL_PERMISSIONS.includes(p), `falta ${p} en ALL_PERMISSIONS`);
    assert.ok(perms.isValidPermission(p), `${p} debería ser válido`);
  }
});

test('_permissions asigna los nuevos permisos a los roles correctos', () => {
  const { DEFAULT_ROLES } = require('../../netlify/functions/_permissions');
  /* admin = todos */
  for (const p of ['invoices.view', 'invoices.issue', 'docs.view']) {
    assert.ok(DEFAULT_ROLES.admin.includes(p), `admin debería tener ${p}`);
  }
  /* tesoreria = invoices.view/issue + docs.view */
  assert.ok(DEFAULT_ROLES.tesoreria.includes('invoices.view'));
  assert.ok(DEFAULT_ROLES.tesoreria.includes('invoices.issue'));
  assert.ok(DEFAULT_ROLES.tesoreria.includes('docs.view'));
  /* recepcion = docs.view (pero NO facturación) */
  assert.ok(DEFAULT_ROLES.recepcion.includes('docs.view'));
  assert.ok(!DEFAULT_ROLES.recepcion.includes('invoices.view'));
  assert.ok(!DEFAULT_ROLES.recepcion.includes('invoices.issue'));
  /* cocina = ninguno de los nuevos */
  for (const p of ['invoices.view', 'invoices.issue', 'docs.view']) {
    assert.ok(!DEFAULT_ROLES.cocina.includes(p), `cocina NO debería tener ${p}`);
  }
});

test('_permissions no rompe permisos existentes (siguen en el catálogo)', () => {
  const { ALL_PERMISSIONS } = require('../../netlify/functions/_permissions');
  for (const p of ['settings.manage', 'refunds.view', 'quotes.view', 'invoices.request']) {
    assert.ok(ALL_PERMISSIONS.includes(p), `se perdió el permiso existente ${p}`);
  }
});

test('_permissions expone labels ES/EN de los permisos nuevos', () => {
  const { PERMISSION_LABELS } = require('../../netlify/functions/_permissions');
  for (const p of ['invoices.view', 'invoices.issue', 'docs.view']) {
    assert.ok(PERMISSION_LABELS[p] && PERMISSION_LABELS[p].es && PERMISSION_LABELS[p].en, `falta label ES/EN de ${p}`);
  }
});

/* ── _settings: flags gestionables (sin secretos) ── */

test('_settings vuelve gestionables los 4 flags nuevos', () => {
  const { MANAGEABLE, isManageable } = require('../../netlify/functions/_settings');
  for (const k of ['NUMERA_INVOICING_ENABLED', 'TRA_ENABLED', 'SIRE_ENABLED', 'LEGAL_DOCS_ENABLED']) {
    assert.ok(isManageable(k), `${k} debería ser gestionable`);
    assert.equal(MANAGEABLE[k].type, 'bool');
    assert.ok(MANAGEABLE[k].group, `${k} debería tener grupo`);
    assert.ok(MANAGEABLE[k].label && MANAGEABLE[k].desc, `${k} debería tener label y desc`);
  }
});

test('_settings NUNCA admite secretos de Numera/TRA/SIRE como gestionables', () => {
  const { isManageable } = require('../../netlify/functions/_settings');
  for (const secret of ['NUMERA_PASSWORD', 'NUMERA_USERNAME', 'NUMERA_COMPANY_ID', 'TRA_TOKEN', 'SIRE_HOTEL_CODE']) {
    assert.equal(isManageable(secret), false, `${secret} NO debería ser gestionable`);
  }
});

test('_settings.flag lee override del panel (store inyectado, sin red)', async () => {
  const { flag } = require('../../netlify/functions/_settings');
  const store = { get: async () => JSON.stringify({ NUMERA_INVOICING_ENABLED: 'true' }) };
  const on = await flag('NUMERA_INVOICING_ENABLED', { store, now: () => 0 });
  assert.equal(on, true);
});

/* ── get-pending-invoices: listado mock-safe con store inyectado ── */

test('get-pending-invoices.listInvoiceDrafts devuelve los borradores del store', async () => {
  const { _test } = require('../../netlify/functions/get-pending-invoices');
  const data = {
    'INV-1': JSON.stringify({ invoiceId: 'INV-1', status: 'draft', total: 100 }),
    'INV-2': JSON.stringify({ invoiceId: 'INV-2', status: 'issued', total: 200 })
  };
  const store = {
    list: async () => ({ blobs: Object.keys(data).map(key => ({ key })) }),
    get: async (key) => data[key]
  };
  const res = await _test.listInvoiceDrafts({ store });
  assert.equal(res.invoices.length, 2);
  assert.ok(!res.isMock);
});

test('get-pending-invoices.listInvoiceDrafts es mock-safe si el store falla', async () => {
  const { _test } = require('../../netlify/functions/get-pending-invoices');
  const store = { list: async () => { throw new Error('sin blobs'); }, get: async () => null };
  const res = await _test.listInvoiceDrafts({ store });
  assert.deepEqual(res, { isMock: true, invoices: [] });
});

test('get-pending-invoices rechaza métodos que no sean GET', async () => {
  const { handler } = require('../../netlify/functions/get-pending-invoices');
  const res = await handler({ httpMethod: 'DELETE', headers: {} });
  assert.equal(res.statusCode, 405);
});

test('get-pending-invoices responde el preflight OPTIONS', async () => {
  const { handler } = require('../../netlify/functions/get-pending-invoices');
  const res = await handler({ httpMethod: 'OPTIONS', headers: {} });
  assert.equal(res.statusCode, 200);
});

/* ── invoice-admin-action: stub gated (validación previa a auth) ── */

test('invoice-admin-action rechaza método que no sea POST', async () => {
  const { handler } = require('../../netlify/functions/invoice-admin-action');
  const res = await handler({ httpMethod: 'GET', headers: {} });
  assert.equal(res.statusCode, 405);
});

test('invoice-admin-action rechaza JSON inválido (antes de auth)', async () => {
  const { handler } = require('../../netlify/functions/invoice-admin-action');
  const res = await handler({ httpMethod: 'POST', headers: {}, body: '{no-json' });
  assert.equal(res.statusCode, 400);
});

test('invoice-admin-action rechaza action inválido (antes de auth)', async () => {
  const { handler } = require('../../netlify/functions/invoice-admin-action');
  const res = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ action: 'foo' }) });
  assert.equal(res.statusCode, 400);
  const parsed = JSON.parse(res.body);
  assert.match(parsed.error, /emit\|void\|credit-note/);
});

test('invoice-admin-action responde el preflight OPTIONS', async () => {
  const { handler } = require('../../netlify/functions/invoice-admin-action');
  const res = await handler({ httpMethod: 'OPTIONS', headers: {} });
  assert.equal(res.statusCode, 200);
});
