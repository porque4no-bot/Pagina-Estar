/* Conector Odoo — Fase 1 enriquecimiento del contacto + ciclo de vida del lead.
   Cubre: mapeo de idioma, comentario enriquecido con datos de estadía, campos
   estándar (lang/function), resolución de country_id contra res.country (con
   caché), y el cierre del embudo (markLeadWonByQuote / markLeadLost) contra un
   transporte JSON-RPC simulado. Mock-safe sin credenciales. */

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

/* Transporte JSON-RPC simulado (mismo patrón que odoo.test.js). `handlers`
   mapea `${service}.${method}` / `${model}.${objMethod}` a un valor o función. */
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

/* ── mapLang ── */
test('mapLang traduce es/en a códigos de Odoo y respeta xx_YY ya formado', () => {
  const odoo = require(ODOO);
  assert.equal(odoo.mapLang('es'), 'es_CO');
  assert.equal(odoo.mapLang('en'), 'en_US');
  assert.equal(odoo.mapLang('EN'), 'en_US');
  assert.equal(odoo.mapLang('es_CO'), 'es_CO');
  assert.equal(odoo.mapLang('fr'), '');
  assert.equal(odoo.mapLang(''), '');
  assert.equal(odoo.mapLang(undefined), '');
});

/* ── buildComment ── */
test('buildComment agrega datos de estadía a la nota cuando vienen', () => {
  const odoo = require(ODOO);
  const c = odoo.buildComment({
    comment: 'Origen: web.',
    lastCheckout: '2026-07-10',
    nights: 4,
    budget: '$2.000.000',
    motive: 'Trabajo remoto'
  });
  assert.match(c, /Origen: web\./);
  assert.match(c, /Último checkout: 2026-07-10/);
  assert.match(c, /Noches: 4/);
  assert.match(c, /Presupuesto: \$2\.000\.000/);
  assert.match(c, /Motivo: Trabajo remoto/);
});

test('buildComment sin datos de estadía deja la nota original intacta', () => {
  const odoo = require(ODOO);
  assert.equal(odoo.buildComment({ comment: 'Solo nota.' }), 'Solo nota.');
  assert.equal(odoo.buildComment({}), '');
  // noches inválidas/0 no agregan ruido
  assert.equal(odoo.buildComment({ nights: 0 }), '');
  assert.equal(odoo.buildComment({ nights: 'x' }), '');
});

/* ── buildPartnerValues: campos estándar nuevos ── */
test('buildPartnerValues mapea lang, function y comment enriquecido (sin x_)', () => {
  const odoo = require(ODOO);
  const v = odoo.buildPartnerValues({
    name: 'Ana', email: 'a@b.co', lang: 'en', function: 'Compras',
    comment: 'Origen: web.', motive: 'Vacaciones', nights: 3
  });
  assert.equal(v.lang, 'en_US');
  assert.equal(v.function, 'Compras');
  assert.match(v.comment, /Origen: web\./);
  assert.match(v.comment, /Motivo: Vacaciones/);
  assert.match(v.comment, /Noches: 3/);
  // country_id NO se setea aquí (función pura, sin red)
  assert.equal(v.country_id, undefined);
});

/* ── resolveCountryId ── */
test('resolveCountryId busca por nombre, por ISO2 y cachea', async () => {
  setEnv();
  const odoo = require(ODOO);
  odoo._resetAuthCache();
  const { transport, calls } = fakeTransport({
    'common.authenticate': 7,
    'res.country.search': (posArgs) => {
      const domain = posArgs[0][0]; // [['name','=ilike','Colombia']] | [['code','=','CO']]
      if (domain[0] === 'code') return [49];
      return [49];
    }
  });
  const byName = await odoo.resolveCountryId('Colombia', transport);
  assert.equal(byName, 49);
  const byIso = await odoo.resolveCountryId('CO', transport);
  assert.equal(byIso, 49);
  // ISO2 va contra `code`, nombre va contra `name`
  const searches = calls.filter(c => c.key === 'res.country.search');
  assert.deepEqual(searches[0].args[5][0], [['name', '=ilike', 'Colombia']]);
  assert.deepEqual(searches[1].args[5][0], [['code', '=', 'CO']]);
  // 2da llamada idéntica viene de caché (no agrega search)
  const again = await odoo.resolveCountryId('colombia', transport);
  assert.equal(again, 49);
  assert.equal(calls.filter(c => c.key === 'res.country.search').length, 2);
  clearEnv();
});

test('upsertPartner resuelve country_id y lo escribe en el partner', async () => {
  setEnv();
  const odoo = require(ODOO);
  odoo._resetAuthCache();
  let createdValues = null;
  const { transport } = fakeTransport({
    'common.authenticate': 7,
    'res.country.search': [49],
    'res.partner.search': [],
    'res.partner.create': (posArgs) => { createdValues = posArgs[0]; return 11; }
  });
  const r = await odoo.upsertPartner(
    { name: 'Tourist', email: 't@x.co', country: 'Colombia', lang: 'en' },
    { transport }
  );
  assert.equal(r.id, 11);
  assert.equal(createdValues.country_id, 49);
  assert.equal(createdValues.lang, 'en_US');
  clearEnv();
});

test('upsertPartner conserva country_id aun si Odoo rechaza el NIT', async () => {
  setEnv();
  const odoo = require(ODOO);
  odoo._resetAuthCache();
  let createdValues = null;
  const { transport } = fakeTransport({
    'common.authenticate': 7,
    'res.country.search': [49],
    'res.partner.search': [],
    'res.partner.create': (posArgs) => {
      const values = posArgs[0];
      if (values.vat) throw new Error('NIT inválido para la localización');
      createdValues = values;
      return 12;
    }
  });
  const r = await odoo.upsertPartner(
    { name: 'X', nit: '900123456-7', email: 'x@y.co', country: 'CO' },
    { transport }
  );
  assert.equal(r.vatRejected, true);
  assert.equal(createdValues.country_id, 49);
  assert.equal(createdValues.vat, undefined);
  clearEnv();
});

/* ── quoteMarker ── */
test('quoteMarker produce un token estable y único por cotización', () => {
  const odoo = require(ODOO);
  assert.equal(odoo.quoteMarker('COT-2026-ABCDE'), '[cotizacion:COT-2026-ABCDE]');
});

/* ── createLead embebe el marcador de cotización ── */
test('createLead embebe quoteMarker en la descripción cuando se pasa quoteId', async () => {
  setEnv();
  const odoo = require(ODOO);
  odoo._resetAuthCache();
  let vals = null;
  const { transport } = fakeTransport({
    'common.authenticate': 7,
    'crm.lead.create': (posArgs) => { vals = posArgs[0]; return 5; }
  });
  await odoo.createLead({ subject: 'Lead', email: 'a@b.co', description: 'Detalle.', quoteId: 'COT-2026-ABCDE' }, { transport });
  assert.match(vals.description, /Detalle\./);
  assert.match(vals.description, /\[cotizacion:COT-2026-ABCDE\]/);
  clearEnv();
});

/* ── markLeadWonByQuote ── */
test('markLeadWonByQuote sin credenciales es no-op mock', async () => {
  clearEnv();
  const odoo = require(ODOO);
  const r = await odoo.markLeadWonByQuote('COT-1');
  assert.deepEqual(r, { id: null, won: false, isMock: true });
});

test('markLeadWonByQuote lleva el lead a la etapa is_won y lo reactiva', async () => {
  setEnv();
  const odoo = require(ODOO);
  odoo._resetAuthCache();
  let written = null;
  const { transport } = fakeTransport({
    'common.authenticate': 7,
    'crm.lead.search': [33],           // encontrado por marcador
    'crm.stage.search': [9],           // etapa is_won
    'crm.lead.write': (posArgs) => { written = posArgs; return true; }
  });
  const r = await odoo.markLeadWonByQuote({ quoteId: 'COT-2026-ABCDE', email: 'a@b.co' }, { transport });
  assert.deepEqual(r, { id: 33, won: true, isMock: false });
  assert.deepEqual(written[0], [33]);
  assert.equal(written[1].stage_id, 9);
  assert.equal(written[1].active, true);
});

test('markLeadWonByQuote sin lead encontrado no escribe nada', async () => {
  setEnv();
  const odoo = require(ODOO);
  odoo._resetAuthCache();
  let wrote = false;
  const { transport } = fakeTransport({
    'common.authenticate': 7,
    'crm.lead.search': [],             // ni por marcador ni por email
    'crm.lead.write': () => { wrote = true; return true; }
  });
  const r = await odoo.markLeadWonByQuote({ quoteId: 'COT-X', email: 'no@hay.co' }, { transport });
  assert.deepEqual(r, { id: null, won: false, isMock: false });
  assert.equal(wrote, false);
  clearEnv();
});

/* ── markLeadLost ── */
test('markLeadLost archiva el lead y registra el motivo', async () => {
  setEnv();
  const odoo = require(ODOO);
  odoo._resetAuthCache();
  let written = null, createdReason = null;
  const { transport } = fakeTransport({
    'common.authenticate': 7,
    'crm.lead.search': [44],
    'crm.lost.reason.search': [],                       // no existe → se crea
    'crm.lost.reason.create': (posArgs) => { createdReason = posArgs[0]; return 7; },
    'crm.lead.write': (posArgs) => { written = posArgs; return true; }
  });
  const r = await odoo.markLeadLost({ quoteId: 'COT-9', email: 'a@b.co' }, 'Cotización vencida', { transport });
  assert.deepEqual(r, { id: 44, lost: true, isMock: false });
  assert.equal(written[1].active, false);
  assert.equal(written[1].lost_reason_id, 7);
  assert.equal(written[1].lost_reason, 7);             // compat versiones
  assert.equal(createdReason.name, 'Cotización vencida');
  clearEnv();
});

test('markLeadLost sin credenciales es no-op mock', async () => {
  clearEnv();
  const odoo = require(ODOO);
  const r = await odoo.markLeadLost('COT-1', 'x');
  assert.deepEqual(r, { id: null, lost: false, isMock: true });
});

/* ── findLeadIdForQuote: prioridades ── */
test('findLeadIdForQuote prioriza leadId explícito sin tocar la red', async () => {
  setEnv();
  const odoo = require(ODOO);
  odoo._resetAuthCache();
  let searched = false;
  const { transport } = fakeTransport({
    'common.authenticate': 7,
    'crm.lead.search': () => { searched = true; return [1]; }
  });
  const id = await odoo.findLeadIdForQuote('COT-1', { leadId: 88, transport });
  assert.equal(id, 88);
  assert.equal(searched, false);
  clearEnv();
});

test('findLeadIdForQuote cae a búsqueda por email cuando no hay marcador', async () => {
  setEnv();
  const odoo = require(ODOO);
  odoo._resetAuthCache();
  const { transport, calls } = fakeTransport({
    'common.authenticate': 7,
    'crm.lead.search': (posArgs) => {
      const domain = posArgs[0];
      // 1er intento: por marcador en description → vacío
      if (domain[0][0] === 'description') return [];
      // 2do intento: por email_from → encontrado
      return [200];
    }
  });
  const id = await odoo.findLeadIdForQuote('COT-2026-ABCDE', { email: 'a@b.co', transport });
  assert.equal(id, 200);
  const emailSearch = calls.filter(c => c.key === 'crm.lead.search')
    .find(c => c.args[5][0][0][0] === 'email_from');
  assert.ok(emailSearch, 'debe intentar búsqueda por email_from');
  assert.equal(emailSearch.args[6].order, 'id desc'); // el más reciente
  clearEnv();
});
