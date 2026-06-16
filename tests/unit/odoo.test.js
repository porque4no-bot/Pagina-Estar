/* Conector Odoo (maestro de clientes): modo mock sin credenciales,
   normalización de datos, y el flujo upsert (create / write / dedup) contra
   un transporte JSON-RPC simulado. */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ODOO = path.join(__dirname, '../../netlify/functions/_odoo.js');

const ENV = ['ODOO_URL', 'ODOO_DB', 'ODOO_USERNAME', 'ODOO_API_KEY', 'ODOO_COMPANY_ID'];
function clearEnv() { for (const k of ENV) delete process.env[k]; }
function setEnv() {
  process.env.ODOO_URL = 'https://demo.odoo.com';
  process.env.ODOO_DB = 'demo';
  process.env.ODOO_USERNAME = 'integ@estar.com.co';
  process.env.ODOO_API_KEY = 'k';
}

/* Transporte JSON-RPC simulado. `handlers` mapea
   `${service}.${method}` (y para object: `${model}.${objMethod}`) a un valor. */
function fakeTransport(handlers) {
  const calls = [];
  return {
    calls,
    transport: async (_url, init) => {
      const body = JSON.parse(init.body);
      const { service, method, args } = body.params;
      let key, result;
      if (service === 'common') {
        key = `common.${method}`;
        result = handlers[key];
      } else {
        // object.execute_kw → args = [db, uid, key, model, objMethod, args, kwargs]
        const model = args[3], objMethod = args[4];
        key = `${model}.${objMethod}`;
        const h = handlers[key];
        try {
          result = typeof h === 'function' ? h(args[5], args[6]) : h;
        } catch (e) {
          // Un handler que lanza simula un error de Odoo (p. ej. validación).
          calls.push({ key, args });
          return { json: async () => ({ jsonrpc: '2.0', id: body.id, error: { message: e.message } }) };
        }
      }
      calls.push({ key, args });
      return { json: async () => ({ jsonrpc: '2.0', id: body.id, result }) };
    }
  };
}

test('isConfigured refleja la presencia de credenciales', () => {
  clearEnv();
  const odoo = require(ODOO);
  assert.equal(odoo.isConfigured(), false);
  setEnv();
  assert.equal(odoo.isConfigured(), true);
  clearEnv();
});

test('normalizeVat deja solo dígitos, K y guion', () => {
  const odoo = require(ODOO);
  assert.equal(odoo.normalizeVat('900.123.456-7'), '900123456-7');
  assert.equal(odoo.normalizeVat('NIT 901032515'), '901032515');
  assert.equal(odoo.normalizeVat(''), '');
});

test('buildPartnerValues normaliza nombre, vat, email, empresa', () => {
  const odoo = require(ODOO);
  const v = odoo.buildPartnerValues({
    name: 'Hospital de Caldas', nit: '900.123.456-7',
    email: '  Compras@HOSPITAL.CO ', isCompany: true, phone: '+57 300'
  });
  assert.equal(v.name, 'Hospital de Caldas');
  assert.equal(v.vat, '900123456-7');
  assert.equal(v.email, 'compras@hospital.co');
  assert.equal(v.is_company, true);
  assert.equal(v.phone, '+57 300');
});

test('upsertPartner sin credenciales es un no-op mock', async () => {
  clearEnv();
  const odoo = require(ODOO);
  const r = await odoo.upsertPartner({ name: 'X', email: 'x@y.co' });
  assert.deepEqual(r, { id: null, created: false, isMock: true });
});

test('upsertPartner crea el partner cuando no existe', async () => {
  setEnv();
  const odoo = require(ODOO);
  odoo._resetAuthCache();
  const { transport, calls } = fakeTransport({
    'common.authenticate': 7,
    'res.partner.search': [],            // no existe
    'res.partner.create': 42
  });
  const r = await odoo.upsertPartner(
    { name: 'Hospital', nit: '900123456-7', email: 'c@h.co', isCompany: true },
    { transport }
  );
  assert.deepEqual(r, { id: 42, created: true, isMock: false });
  // dedup por vat
  const search = calls.find(c => c.key === 'res.partner.search');
  assert.deepEqual(search.args[5][0], [['vat', '=', '900123456-7']]);
  clearEnv();
});

test('upsertPartner asigna company_id y pasa allowed_company_ids con ODOO_COMPANY_ID (multiempresa)', async () => {
  setEnv();
  process.env.ODOO_COMPANY_ID = '5';
  const odoo = require(ODOO);
  odoo._resetAuthCache();
  let createdValues = null, createKwargs = null;
  const { transport, calls } = fakeTransport({
    'common.authenticate': 7,
    'res.partner.search': [],
    'res.partner.create': (posArgs, kwargs) => { createdValues = posArgs[0]; createKwargs = kwargs; return 88; }
  });
  const r = await odoo.upsertPartner(
    { name: 'Cliente hotel', nit: '900123456-7', email: 'c@h.co' },
    { transport }
  );
  assert.equal(r.id, 88);
  // el partner queda asignado a la empresa configurada (la del hotel)
  assert.equal(createdValues.company_id, 5);
  // create y search van con el contexto de empresa permitido
  assert.deepEqual(createKwargs.context, { allowed_company_ids: [5] });
  const search = calls.find(c => c.key === 'res.partner.search');
  assert.deepEqual(search.args[6].context, { allowed_company_ids: [5] });
  clearEnv();
});

test('upsertPartner sin ODOO_COMPANY_ID deja el partner compartido (sin company_id ni contexto)', async () => {
  setEnv();
  const odoo = require(ODOO);
  odoo._resetAuthCache();
  let createdValues = null, createKwargs = null;
  const { transport } = fakeTransport({
    'common.authenticate': 7,
    'res.partner.search': [],
    'res.partner.create': (posArgs, kwargs) => { createdValues = posArgs[0]; createKwargs = kwargs; return 9; }
  });
  await odoo.upsertPartner({ name: 'Cliente', email: 'c@h.co' }, { transport });
  assert.equal(createdValues.company_id, undefined);
  assert.equal(createKwargs.context, undefined);
  clearEnv();
});

test('upsertPartner actualiza el partner existente (dedup)', async () => {
  setEnv();
  const odoo = require(ODOO);
  odoo._resetAuthCache();
  let written = null;
  const { transport } = fakeTransport({
    'common.authenticate': 7,
    'res.partner.search': [99],          // ya existe
    'res.partner.write': (args) => { written = args; return true; }
  });
  const r = await odoo.upsertPartner(
    { name: 'Hospital nuevo nombre', nit: '900123456-7' },
    { transport }
  );
  assert.deepEqual(r, { id: 99, created: false, isMock: false });
  assert.deepEqual(written[0], [99]);
  assert.equal(written[1].name, 'Hospital nuevo nombre');
  clearEnv();
});

test('upsertPartner deduplica por email cuando no hay vat', async () => {
  setEnv();
  const odoo = require(ODOO);
  odoo._resetAuthCache();
  const { transport, calls } = fakeTransport({
    'common.authenticate': 7,
    'res.partner.search': [],
    'res.partner.create': 5
  });
  await odoo.upsertPartner({ name: 'Ana', email: 'Ana@Mail.CO' }, { transport });
  const search = calls.find(c => c.key === 'res.partner.search');
  assert.deepEqual(search.args[5][0], [['email', '=ilike', 'ana@mail.co']]);
  clearEnv();
});

test('upsertPartner reintenta sin vat si Odoo rechaza el NIT (localización CO)', async () => {
  setEnv();
  const odoo = require(ODOO);
  odoo._resetAuthCache();
  let createdValues = null;
  const { transport } = fakeTransport({
    'common.authenticate': 7,
    'res.partner.search': [],
    'res.partner.create': (posArgs) => {
      const values = posArgs[0];   // create recibe [values]
      if (values.vat) throw new Error('El NIT no es válido para la localización');
      createdValues = values;
      return 77;
    }
  });
  const r = await odoo.upsertPartner(
    { name: 'Hospital', nit: '900123456-7', email: 'c@h.co', comment: 'Origen X.' },
    { transport }
  );
  assert.equal(r.id, 77);
  assert.equal(r.created, true);
  assert.equal(r.vatRejected, true);
  // se creó sin vat y el NIT quedó en la nota
  assert.equal(createdValues.vat, undefined);
  assert.match(createdValues.comment, /NIT: 900123456-7\./);
  clearEnv();
});

test('upsertPartner exige al menos name, email o vat', async () => {
  setEnv();
  const odoo = require(ODOO);
  await assert.rejects(() => odoo.upsertPartner({ phone: '300' }, { transport: async () => ({}) }));
  clearEnv();
});
