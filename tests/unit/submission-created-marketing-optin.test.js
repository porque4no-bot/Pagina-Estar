/* Frente B — cableado backend del consentimiento de marketing (Ley 1581) en el
   handler submission-created. El checkbox público canónico es `marketingOptIn`,
   SEPARADO de la aceptación de privacidad (`habeas_data`, obligatoria y que NO
   implica marketing). Sin opt-in = NO marketing. Sin credenciales de Odoo el
   upsert/mailing corren en modo mock (no-op), así que se prueba sin red. */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Modo mock de Odoo: sin credenciales el upsert/mailing son no-op.
for (const k of ['ODOO_URL', 'ODOO_DB', 'ODOO_USERNAME', 'ODOO_API_KEY', 'ODOO_COMPANY_ID']) delete process.env[k];

const { handler, _test } = require(path.join(__dirname, '../../netlify/functions/submission-created.js'));

function ev(payload) { return { body: JSON.stringify(payload === undefined ? {} : { payload }) }; }

/* ── hasMarketingOptIn: campo canónico + alias + Ley 1581 ── */
test('hasMarketingOptIn lee el campo canónico marketingOptIn', () => {
  assert.equal(_test.hasMarketingOptIn({ marketingOptIn: 'on' }), true);
  assert.equal(_test.hasMarketingOptIn({ marketingOptIn: true }), true);
  assert.equal(_test.hasMarketingOptIn({ marketingOptIn: 'yes' }), true);
  assert.equal(_test.hasMarketingOptIn({ marketingOptIn: '' }), false);
  assert.equal(_test.hasMarketingOptIn({ marketingOptIn: 'off' }), false);
  assert.equal(_test.hasMarketingOptIn({}), false);
});

test('hasMarketingOptIn acepta alias antiguos por compatibilidad', () => {
  assert.equal(_test.hasMarketingOptIn({ marketing: 'on' }), true);
  assert.equal(_test.hasMarketingOptIn({ acepto_marketing: 'true' }), true);
});

test('la aceptación de privacidad sola (habeas_data) NO es opt-in de marketing', () => {
  assert.equal(_test.hasMarketingOptIn({ habeas_data: 'on' }), false);
});

/* ── estancias-largas: opt-in opcional, separado de privacidad ── */
test('estancias-largas SIN opt-in: tag solo Larga estadía, sin marketing', () => {
  const v = _test.FORM_HANDLERS['estancias-largas']({ nombre: 'Ana', correo: 'a@b.co', habeas_data: 'on' });
  assert.deepEqual(v.tags, ['Larga estadía']);
  assert.equal(v.marketing, undefined);
  assert.ok(!/Opt-in marketing aceptado/.test(v.comment));
});

test('estancias-largas CON marketingOptIn: añade tag, nota de consentimiento y entra a la lista', () => {
  const v = _test.FORM_HANDLERS['estancias-largas']({ nombre: 'Ana', correo: 'a@b.co', marketingOptIn: 'on' });
  assert.deepEqual(v.tags, ['Larga estadía', 'Opt-in marketing']);
  assert.ok(v.marketing);
  assert.equal(v.marketing.listName, 'Newsletter');
  assert.equal(v.marketing.name, 'Ana');
  assert.match(v.comment, /Opt-in marketing aceptado \(vivir\.html\) el \d{4}-\d{2}-\d{2}/);
});

/* ── contacto: lee el campo canónico marketingOptIn ── */
test('contacto con marketingOptIn entra a la lista y se etiqueta', () => {
  const v = _test.FORM_HANDLERS['contacto']({ nombre: 'Luis', email: 'luis@mail.co', marketingOptIn: 'on' });
  assert.deepEqual(v.tags, ['Web-Contacto', 'Opt-in marketing']);
  assert.ok(v.marketing);
  assert.equal(v.marketing.name, 'Luis');
  assert.match(v.comment, /Opt-in marketing aceptado \(contacto\.html\)/);
});

test('contacto con SOLO habeas_data (privacidad) NO entra a marketing', () => {
  const v = _test.FORM_HANDLERS['contacto']({ nombre: 'Luis', email: 'luis@mail.co', habeas_data: 'on' });
  assert.deepEqual(v.tags, ['Web-Contacto']);
  assert.equal(v.marketing, undefined);
});

/* ── cotizacion-grupos: nuevo handler ── */
test('cotizacion-grupos mapea organizador/email/whatsapp y abre oportunidad CRM', () => {
  const v = _test.FORM_HANDLERS['cotizacion-grupos']({
    organizador: 'Carlos Mendoza', email: 'carlos@mail.co', whatsapp: '+57 300 000 0000',
    motivo: 'boda', huespedes: '15', apartaestudios: '6',
    llegada: '2026-08-01', salida: '2026-08-03', requerimientos: 'Habitaciones continuas',
    habeas_data: 'on'
  });
  assert.equal(v.name, 'Carlos Mendoza');
  assert.equal(v.email, 'carlos@mail.co');
  assert.equal(v.phone, '+57 300 000 0000');
  assert.equal(v.isCompany, false);
  assert.deepEqual(v.tags, ['Grupos']);
  assert.equal(typeof v.lead, 'function');
  assert.match(v.lead(v), /Grupos — Carlos Mendoza/);
  assert.equal(v.marketing, undefined, 'el habeas_data del form NO es opt-in de marketing');
  assert.match(v.comment, /Motivo: boda/);
  assert.match(v.comment, /Huéspedes: 15/);
  assert.match(v.comment, /Fechas: 2026-08-01 → 2026-08-03/);
});

test('cotizacion-grupos CON marketingOptIn entra a la lista y se etiqueta', () => {
  const v = _test.FORM_HANDLERS['cotizacion-grupos']({
    organizador: 'Carlos', email: 'carlos@mail.co', whatsapp: '300', marketingOptIn: 'on'
  });
  assert.deepEqual(v.tags, ['Grupos', 'Opt-in marketing']);
  assert.ok(v.marketing);
  assert.equal(v.marketing.listName, 'Newsletter');
  assert.match(v.comment, /Opt-in marketing aceptado \(grupos\.html\)/);
});

test('cotizacion-grupos sin organizador cae al correo como nombre', () => {
  const v = _test.FORM_HANDLERS['cotizacion-grupos']({ email: 'solo@correo.co' });
  assert.equal(v.name, 'solo@correo.co');
});

/* ── End-to-end (mock sin credenciales) ── */
test('estancias-largas con opt-in procesa de punta a punta y responde 200', async () => {
  const res = await handler(ev({ form_name: 'estancias-largas', data: { nombre: 'Ana', correo: 'a@b.co', marketingOptIn: 'on' } }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'ok');
});

test('cotizacion-grupos procesa de punta a punta y responde 200 (mock sin credenciales)', async () => {
  const res = await handler(ev({ form_name: 'cotizacion-grupos', data: { organizador: 'Carlos', email: 'c@d.co', whatsapp: '300', marketingOptIn: 'on' } }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'ok');
});

test('cotizacion-grupos sin nombre ni correo se ignora con 200', async () => {
  const res = await handler(ev({ form_name: 'cotizacion-grupos', data: { motivo: 'boda' } }));
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /ignored/);
});

/* ── newsletter: acepta el canónico marketingOptIn como consentimiento ── */
test('newsletter acepta marketingOptIn (además de habeas_data) como opt-in', () => {
  const v = _test.FORM_HANDLERS['newsletter']({ email: 'a@b.co', marketingOptIn: 'on' });
  assert.ok(v, 'marketingOptIn debe valer como consentimiento del newsletter');
  assert.deepEqual(v.tags, ['Newsletter', 'Opt-in marketing']);
  assert.ok(v.marketing);
});
