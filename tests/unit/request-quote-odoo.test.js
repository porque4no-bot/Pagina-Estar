/* request-quote: enriquecimiento del maestro de clientes (Odoo) desde el
   formulario corporativo. Verifica los campos de estadía que se pasan a
   upsertPartner/createLead y que el endpoint público NUNCA devuelve el leadId
   interno de CRM. Se inyecta un _odoo simulado por la caché de require (sin red);
   sin RESEND el handler responde 200 sin enviar correo. */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const ODOO_PATH = path.join(__dirname, '../../netlify/functions/_odoo.js');
const RL_PATH = path.join(__dirname, '../../netlify/functions/_rate-limit.js');
const RQ_PATH = path.join(__dirname, '../../netlify/functions/request-quote.js');

/* Instala stubs en la caché de require para _odoo y _rate-limit, carga el
   handler fresco, y devuelve { handler, captured }. */
function loadHandlerWithStubs() {
  for (const k of ['ODOO_URL', 'ODOO_DB', 'ODOO_USERNAME', 'ODOO_API_KEY']) delete process.env[k];
  delete process.env.RESEND_API_KEY;

  const captured = { partner: null, lead: null, mailing: null };
  const fakeOdoo = {
    upsertPartner: async (data) => { captured.partner = data; return { id: 42, created: true, isMock: false }; },
    createLead: async (data) => { captured.lead = data; return { id: 777, isMock: false }; },
    addToMailingList: async (data) => { captured.mailing = data; return { listId: 1, contactId: 2, created: true, isMock: false }; }
  };
  const fakeRateLimit = {
    checkRateLimit: async () => ({ ok: true }),
    rateLimitResponse: () => ({ statusCode: 429, body: 'rate' })
  };

  // Pre-poblar la caché para que el require interno resuelva a los stubs.
  require.cache[ODOO_PATH] = { id: ODOO_PATH, filename: ODOO_PATH, loaded: true, exports: fakeOdoo };
  require.cache[RL_PATH] = { id: RL_PATH, filename: RL_PATH, loaded: true, exports: fakeRateLimit };
  delete require.cache[RQ_PATH];
  const mod = require(RQ_PATH);
  return { handler: mod.handler, captured };
}

function cleanup() {
  delete require.cache[ODOO_PATH];
  delete require.cache[RL_PATH];
  delete require.cache[RQ_PATH];
}

function ev(body) {
  return { httpMethod: 'POST', headers: {}, body: JSON.stringify(body) };
}

test('pasa datos de estadía (lastCheckout, nights, motive) al upsert de Odoo', async () => {
  const { handler, captured } = loadHandlerWithStubs();
  try {
    const res = await handler(ev({
      empresa: 'ACME', contacto: 'Ana', email: 'a@b.co',
      whatsapp: '3001112233',
      fechaCheckin: '2026-07-01', fechaCheckout: '2026-07-05',
      tipoEstadia: 'larga', numHabitaciones: 3
    }), {});
    assert.equal(res.statusCode, 200);
    assert.ok(captured.partner, 'debe llamar upsertPartner');
    assert.equal(captured.partner.lastCheckout, '2026-07-05');
    assert.equal(captured.partner.nights, 4);
    assert.match(captured.partner.motive, /[Ll]arga estad/);
    assert.equal(captured.partner.isCompany, true);
    assert.deepEqual(captured.partner.tags, ['Corporativo']);
  } finally { cleanup(); }
});

test('SIN opt-in de marketing: tag solo Corporativo y NO entra a la lista (Ley 1581)', async () => {
  const { handler, captured } = loadHandlerWithStubs();
  try {
    await handler(ev({ empresa: 'ACME', contacto: 'Ana', email: 'a@b.co' }), {});
    assert.deepEqual(captured.partner.tags, ['Corporativo']);
    assert.equal(captured.mailing, null, 'sin opt-in NO debe llamar addToMailingList');
    assert.ok(!/Opt-in marketing/.test(captured.partner.comment || ''));
  } finally { cleanup(); }
});

test('CON opt-in (marketingOptIn): añade tag Opt-in marketing, nota de consentimiento y entra a la lista', async () => {
  const { handler, captured } = loadHandlerWithStubs();
  try {
    const res = await handler(ev({
      empresa: 'ACME', contacto: 'Ana', email: 'a@b.co', marketingOptIn: 'on'
    }), {});
    assert.equal(res.statusCode, 200);
    assert.deepEqual(captured.partner.tags, ['Corporativo', 'Opt-in marketing']);
    assert.match(captured.partner.comment, /Opt-in marketing aceptado \(empresas\.html\)/);
    assert.ok(captured.mailing, 'con opt-in debe llamar addToMailingList');
    assert.equal(captured.mailing.email, 'a@b.co');
    assert.equal(captured.mailing.name, 'Ana');
    assert.equal(captured.mailing.listName, 'Newsletter');
  } finally { cleanup(); }
});

test('marketingOptIn === true (boolean) también activa el opt-in', async () => {
  const { handler, captured } = loadHandlerWithStubs();
  try {
    await handler(ev({ empresa: 'ACME', contacto: 'Ana', email: 'a@b.co', marketingOptIn: true }), {});
    assert.deepEqual(captured.partner.tags, ['Corporativo', 'Opt-in marketing']);
    assert.ok(captured.mailing);
  } finally { cleanup(); }
});

test('marketingOptIn falsy ("off"/"false"/"") NO activa marketing', async () => {
  for (const v of ['off', 'false', '', '0', 'no']) {
    const { handler, captured } = loadHandlerWithStubs();
    try {
      await handler(ev({ empresa: 'ACME', contacto: 'Ana', email: 'a@b.co', marketingOptIn: v }), {});
      assert.deepEqual(captured.partner.tags, ['Corporativo'], `valor ${JSON.stringify(v)} no debe optar`);
      assert.equal(captured.mailing, null);
    } finally { cleanup(); }
  }
});

test('un fallo de addToMailingList no rompe la solicitud (200)', async () => {
  for (const k of ['ODOO_URL', 'ODOO_DB', 'ODOO_USERNAME', 'ODOO_API_KEY']) delete process.env[k];
  delete process.env.RESEND_API_KEY;
  const fakeOdoo = {
    upsertPartner: async () => ({ id: 42, created: true, isMock: false }),
    createLead: async () => ({ id: 777, isMock: false }),
    addToMailingList: async () => { throw new Error('mailing caído'); }
  };
  const fakeRateLimit = { checkRateLimit: async () => ({ ok: true }), rateLimitResponse: () => ({ statusCode: 429 }) };
  require.cache[ODOO_PATH] = { id: ODOO_PATH, filename: ODOO_PATH, loaded: true, exports: fakeOdoo };
  require.cache[RL_PATH] = { id: RL_PATH, filename: RL_PATH, loaded: true, exports: fakeRateLimit };
  delete require.cache[RQ_PATH];
  const { handler } = require(RQ_PATH);
  try {
    const res = await handler(ev({ empresa: 'X', contacto: 'Y', email: 'y@x.co', marketingOptIn: 'on' }), {});
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { received: true });
  } finally { cleanup(); }
});

test('crea el lead CRM ligado al partner', async () => {
  const { handler, captured } = loadHandlerWithStubs();
  try {
    await handler(ev({ empresa: 'ACME', contacto: 'Ana', email: 'a@b.co' }), {});
    assert.ok(captured.lead, 'debe llamar createLead');
    assert.equal(captured.lead.partnerId, 42);
    assert.match(captured.lead.subject, /ACME/);
  } finally { cleanup(); }
});

test('la respuesta pública nunca expone el leadId interno de CRM', async () => {
  const { handler } = loadHandlerWithStubs();
  try {
    const res = await handler(ev({ empresa: 'ACME', contacto: 'Ana', email: 'a@b.co' }), {});
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.deepEqual(body, { received: true });
    assert.equal(body.leadId, undefined);
    assert.ok(!/777/.test(res.body), 'no debe filtrarse el leadId');
  } finally { cleanup(); }
});

test('un fallo de Odoo no rompe la solicitud (200)', async () => {
  for (const k of ['ODOO_URL', 'ODOO_DB', 'ODOO_USERNAME', 'ODOO_API_KEY']) delete process.env[k];
  delete process.env.RESEND_API_KEY;
  const fakeOdoo = {
    upsertPartner: async () => { throw new Error('Odoo caído'); },
    createLead: async () => ({ id: null, isMock: true })
  };
  const fakeRateLimit = { checkRateLimit: async () => ({ ok: true }), rateLimitResponse: () => ({ statusCode: 429 }) };
  require.cache[ODOO_PATH] = { id: ODOO_PATH, filename: ODOO_PATH, loaded: true, exports: fakeOdoo };
  require.cache[RL_PATH] = { id: RL_PATH, filename: RL_PATH, loaded: true, exports: fakeRateLimit };
  delete require.cache[RQ_PATH];
  const { handler } = require(RQ_PATH);
  try {
    const res = await handler(ev({ empresa: 'X', contacto: 'Y', email: 'y@x.co' }), {});
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { received: true });
  } finally { cleanup(); }
});
