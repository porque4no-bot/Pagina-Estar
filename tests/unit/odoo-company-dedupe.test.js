/* upsertPartner con dedupeByCompanyName (formulario público de convenios):
   la empresa se busca por NOMBRE entre las empresas, nunca por el correo del
   contacto, y una empresa existente no pierde su nombre ni su nota. Transporte
   JSON-RPC simulado (mismo patrón que odoo-enrichment.test.js). */

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
        key = `${args[3]}.${args[4]}`;
        const h = handlers[key];
        result = typeof h === 'function' ? h(args[5], args[6]) : h;
      }
      calls.push({ key, args });
      return { json: async () => ({ jsonrpc: '2.0', id: body.id, result }) };
    }
  };
}

test('dedupeByCompanyName busca la empresa por nombre + is_company, no por correo', async () => {
  setEnv();
  const odoo = require(ODOO);
  odoo._resetAuthCache();
  let searchDomain = null;
  let created = null;
  const { transport, calls } = fakeTransport({
    'common.authenticate': 7,
    'res.partner.search': (pos) => { searchDomain = pos[0]; return []; },
    'res.partner.create': (pos) => { created = pos[0]; return 31; }
  });
  const r = await odoo.upsertPartner(
    { name: 'Hospital de Caldas', isCompany: true, dedupeByCompanyName: true, comment: 'Solicitud de convenio.' },
    { transport }
  );
  assert.equal(r.id, 31);
  assert.deepEqual(searchDomain, [['name', '=ilike', 'Hospital de Caldas'], ['is_company', '=', true]]);
  assert.equal(created.email, undefined);
  assert.equal(created.is_company, true);
  assert.ok(!calls.some(c => c.key === 'res.partner.write'));
  clearEnv();
});

test('empresa existente encontrada por nombre: no se reescriben nombre ni nota', async () => {
  setEnv();
  const odoo = require(ODOO);
  odoo._resetAuthCache();
  let written = null;
  const { transport } = fakeTransport({
    'common.authenticate': 7,
    'res.partner.search': [44],
    'res.partner.write': (pos) => { written = pos[1]; return true; }
  });
  const r = await odoo.upsertPartner(
    { name: 'hospital de caldas', isCompany: true, dedupeByCompanyName: true, comment: 'Nueva solicitud.' },
    { transport }
  );
  assert.equal(r.id, 44);
  assert.equal(r.created, false);
  assert.equal(written.name, undefined, 'no se renombra la ficha existente');
  assert.equal(written.comment, undefined, 'no se reemplaza la nota (historial/consentimientos)');
  clearEnv();
});

test('sin dedupeByCompanyName una empresa sin NIT ni correo se crea sin buscar (comportamiento previo)', async () => {
  setEnv();
  const odoo = require(ODOO);
  odoo._resetAuthCache();
  const { transport, calls } = fakeTransport({
    'common.authenticate': 7,
    'res.partner.search': [99],
    'res.partner.create': 12
  });
  const r = await odoo.upsertPartner({ name: 'ACME', isCompany: true }, { transport });
  assert.equal(r.id, 12);
  assert.ok(!calls.some(c => c.key === 'res.partner.search'));
  clearEnv();
});
