/* Conector Odoo — Fase 2: Email Marketing (mailing.list + mailing.contact).
   addToMailingList busca/crea la lista por nombre y liga el contacto (por email)
   con el comando (4,id), sin pisar otras suscripciones. Mock-safe sin
   credenciales; transporte JSON-RPC inyectable (mismo patrón que odoo.test.js). */

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
        const model = args[3], objMethod = args[4];
        key = `${model}.${objMethod}`;
        const h = handlers[key];
        try {
          result = typeof h === 'function' ? h(args[5], args[6]) : h;
        } catch (e) {
          calls.push({ key, args });
          return { json: async () => ({ jsonrpc: '2.0', id: body.id, error: { message: e.message } }) };
        }
      }
      calls.push({ key, args });
      return { json: async () => ({ jsonrpc: '2.0', id: body.id, result }) };
    }
  };
}

test('addToMailingList sin credenciales es un no-op mock', async () => {
  clearEnv();
  const odoo = require(ODOO);
  const r = await odoo.addToMailingList({ email: 'a@b.co', listName: 'Newsletter' });
  assert.deepEqual(r, { listId: null, contactId: null, created: false, isMock: true });
});

test('addToMailingList exige email', async () => {
  setEnv();
  const odoo = require(ODOO);
  odoo._resetAuthCache();
  await assert.rejects(() => odoo.addToMailingList({ listName: 'Newsletter' }, { transport: async () => ({}) }), /requiere email/);
  clearEnv();
});

test('addToMailingList crea la lista si no existe y crea el contacto ligado', async () => {
  setEnv();
  const odoo = require(ODOO);
  odoo._resetAuthCache();
  let listVals = null, contactVals = null;
  const { transport, calls } = fakeTransport({
    'common.authenticate': 7,
    'mailing.list.search': [],                              // no existe → se crea
    'mailing.list.create': (posArgs) => { listVals = posArgs[0]; return 3; },
    'mailing.contact.search': [],                           // contacto nuevo
    'mailing.contact.create': (posArgs) => { contactVals = posArgs[0]; return 21; }
  });
  const r = await odoo.addToMailingList({ email: 'Nueva@Mail.CO', name: 'Sofía', listName: 'Newsletter' }, { transport });
  assert.deepEqual(r, { listId: 3, contactId: 21, created: true, isMock: false });
  assert.equal(listVals.name, 'Newsletter');
  // contacto deduplicado por email (normalizado) y ligado a la lista con (4,id)
  assert.equal(contactVals.email, 'nueva@mail.co');
  assert.equal(contactVals.name, 'Sofía');
  assert.deepEqual(contactVals.list_ids, [[4, 3]]);
  // búsqueda de contacto insensible a may/min
  const cSearch = calls.find(c => c.key === 'mailing.contact.search');
  assert.deepEqual(cSearch.args[5][0], [['email', '=ilike', 'nueva@mail.co']]);
  clearEnv();
});

test('addToMailingList reutiliza la lista existente y AÑADE la suscripción al contacto existente', async () => {
  setEnv();
  const odoo = require(ODOO);
  odoo._resetAuthCache();
  let written = null, created = false;
  const { transport } = fakeTransport({
    'common.authenticate': 7,
    'mailing.list.search': [9],                             // la lista ya existe
    'mailing.list.create': () => { throw new Error('no debería crear la lista'); },
    'mailing.contact.search': [55],                         // el contacto ya existe
    'mailing.contact.write': (posArgs) => { written = posArgs; return true; },
    'mailing.contact.create': () => { created = true; return 1; }
  });
  const r = await odoo.addToMailingList({ email: 'ya@existe.co', listName: 'Newsletter' }, { transport });
  assert.deepEqual(r, { listId: 9, contactId: 55, created: false, isMock: false });
  assert.equal(created, false, 'no debe crear contacto si ya existe');
  // solo AÑADE la lista (4,id), no reemplaza otras suscripciones
  assert.deepEqual(written[0], [55]);
  assert.deepEqual(written[1].list_ids, [[4, 9]]);
  clearEnv();
});

test('addToMailingList asigna company_id a la lista y pasa allowed_company_ids (multiempresa)', async () => {
  setEnv();
  process.env.ODOO_COMPANY_ID = '5';
  const odoo = require(ODOO);
  odoo._resetAuthCache();
  let listVals = null, listKw = null;
  const { transport, calls } = fakeTransport({
    'common.authenticate': 7,
    'mailing.list.search': [],
    'mailing.list.create': (posArgs, kwargs) => { listVals = posArgs[0]; listKw = kwargs; return 4; },
    'mailing.contact.search': [],
    'mailing.contact.create': 8
  });
  const r = await odoo.addToMailingList({ email: 'c@h.co', listName: 'Newsletter' }, { transport });
  assert.equal(r.listId, 4);
  assert.equal(listVals.company_id, 5);
  assert.deepEqual(listKw.context, { allowed_company_ids: [5] });
  // la búsqueda del contacto también va con el contexto de empresa
  const cSearch = calls.find(c => c.key === 'mailing.contact.search');
  assert.deepEqual(cSearch.args[6].context, { allowed_company_ids: [5] });
  delete process.env.ODOO_COMPANY_ID;
  clearEnv();
});

test('addToMailingList reintenta crear la lista sin company_id si Odoo lo rechaza', async () => {
  setEnv();
  process.env.ODOO_COMPANY_ID = '5';
  const odoo = require(ODOO);
  odoo._resetAuthCache();
  let lastListVals = null;
  const { transport } = fakeTransport({
    'common.authenticate': 7,
    'mailing.list.search': [],
    'mailing.list.create': (posArgs) => {
      const vals = posArgs[0];
      if (vals.company_id) throw new Error('company_id no soportado en mailing.list');
      lastListVals = vals;
      return 6;
    },
    'mailing.contact.search': [],
    'mailing.contact.create': 12
  });
  const r = await odoo.addToMailingList({ email: 'c@h.co', listName: 'Newsletter' }, { transport });
  assert.equal(r.listId, 6);
  assert.equal(lastListVals.company_id, undefined);
  assert.equal(lastListVals.name, 'Newsletter');
  delete process.env.ODOO_COMPANY_ID;
  clearEnv();
});

test('addToMailingList usa "Newsletter" por defecto si no se pasa listName', async () => {
  setEnv();
  const odoo = require(ODOO);
  odoo._resetAuthCache();
  let listVals = null;
  const { transport } = fakeTransport({
    'common.authenticate': 7,
    'mailing.list.search': [],
    'mailing.list.create': (posArgs) => { listVals = posArgs[0]; return 1; },
    'mailing.contact.search': [],
    'mailing.contact.create': 2
  });
  await odoo.addToMailingList({ email: 'x@y.co' }, { transport });
  assert.equal(listVals.name, 'Newsletter');
  clearEnv();
});
