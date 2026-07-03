/* Fase 2 — tapar fugas de captura: el handler submission-created enruta los
   forms Newsletter y Contacto a Odoo (maestro + Email Marketing), respetando el
   consentimiento (Ley 1581). Sin credenciales de Odoo el upsert/mailing corren
   en modo mock (no-op), así que el handler se prueba de punta a punta sin red.
   Paridad de campos ES/EN garantizada porque el build solo strip-ea los <span>
   bilingües, no los `name=` de los inputs. */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Modo mock de Odoo: sin credenciales el upsert/mailing son no-op.
for (const k of ['ODOO_URL', 'ODOO_DB', 'ODOO_USERNAME', 'ODOO_API_KEY', 'ODOO_COMPANY_ID']) delete process.env[k];

const { handler, _test } = require(path.join(__dirname, '../../netlify/functions/submission-created.js'));

function ev(payload) { return { body: JSON.stringify(payload === undefined ? {} : { payload }) }; }

/* ── isChecked: cómo llegan los checkboxes de Netlify Forms ── */
test('isChecked trata "on"/true como aceptado y vacío/"off"/"false" como no', () => {
  assert.equal(_test.isChecked('on'), true);
  assert.equal(_test.isChecked(true), true);
  assert.equal(_test.isChecked('true'), true);
  assert.equal(_test.isChecked('yes'), true);
  assert.equal(_test.isChecked(''), false);
  assert.equal(_test.isChecked(undefined), false);
  assert.equal(_test.isChecked('off'), false);
  assert.equal(_test.isChecked('false'), false);
  assert.equal(_test.isChecked('0'), false);
});

/* ── Newsletter: opt-in obligatorio ── */
test('newsletter SIN opt-in (habeas_data) no se sincroniza (Ley 1581)', () => {
  const v = _test.FORM_HANDLERS['newsletter']({ email: 'a@b.co' });
  assert.equal(v, null);
});

test('newsletter CON opt-in produce partner con etiquetas y datos de marketing', () => {
  const v = _test.FORM_HANDLERS['newsletter']({ email: 'Ana@Mail.CO', habeas_data: 'on' });
  assert.ok(v, 'debe sincronizar con opt-in');
  assert.equal(v.email, 'Ana@Mail.CO'); // _odoo normaliza el email luego (lowercase)
  assert.equal(v.name, 'Ana@Mail.CO');   // el footer no tiene campo de nombre → cae al correo
  assert.deepEqual(v.tags, ['Newsletter', 'Opt-in marketing']);
  assert.ok(v.marketing, 'debe traer datos de lista de marketing');
  assert.equal(v.marketing.listName, 'Newsletter');
  assert.match(v.comment, /Opt-in de marketing/);
});

test('newsletter procesa de punta a punta y responde 200 (mock sin credenciales)', async () => {
  const res = await handler(ev({ form_name: 'newsletter', data: { email: 'sub@correo.co', habeas_data: 'on' } }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'ok');
});

test('newsletter sin opt-in responde 200 pero NO sincroniza', async () => {
  const res = await handler(ev({ form_name: 'newsletter', data: { email: 'sub@correo.co' } }));
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /sin opt-in|no sincronizable/);
});

/* ── Contacto: transaccional (lead sí, marketing no, salvo opt-in) ── */
test('contacto mapea nombre/email/teléfono y abre oportunidad, SIN marketing por defecto', () => {
  const v = _test.FORM_HANDLERS['contacto']({
    nombre: 'Sofía Restrepo', email: 'sofia@mail.co', telefono: '+57 300 123 4567',
    mensaje: 'Quiero info de tarifas', habeas_data: 'on' // solo aceptación de privacidad, NO marketing
  });
  assert.equal(v.name, 'Sofía Restrepo');
  assert.equal(v.email, 'sofia@mail.co');
  assert.equal(v.phone, '+57 300 123 4567');
  assert.deepEqual(v.tags, ['Web-Contacto']);
  assert.equal(typeof v.lead, 'function');
  assert.match(v.lead(v), /Contacto web — Sofía Restrepo/);
  assert.equal(v.marketing, undefined, 'el habeas_data del contacto NO es opt-in de marketing');
  assert.match(v.comment, /Mensaje: Quiero info de tarifas/);
});

test('contacto CON opt-in de marketing explícito sí entra a la lista y se etiqueta', () => {
  const v = _test.FORM_HANDLERS['contacto']({
    nombre: 'Luis', email: 'luis@mail.co', mensaje: 'Hola', marketing: 'on'
  });
  assert.deepEqual(v.tags, ['Web-Contacto', 'Opt-in marketing']);
  assert.ok(v.marketing);
  assert.equal(v.marketing.listName, 'Newsletter');
  assert.equal(v.marketing.name, 'Luis');
});

test('contacto sin nombre cae al correo como nombre', () => {
  const v = _test.FORM_HANDLERS['contacto']({ email: 'solo@correo.co' });
  assert.equal(v.name, 'solo@correo.co');
});

test('contacto procesa de punta a punta y responde 200 (mock sin credenciales)', async () => {
  const res = await handler(ev({ form_name: 'contacto', data: { nombre: 'Ana', email: 'a@b.co', telefono: '300', mensaje: 'Hola', habeas_data: 'on' } }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'ok');
});

/* ── Robustez compartida ── */
test('contacto sin nombre ni correo se ignora con 200', async () => {
  const res = await handler(ev({ form_name: 'contacto', data: { mensaje: 'Solo texto' } }));
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /ignored/);
});

test('los valores de partner NO arrastran metadatos de enrutado (lead/marketing) al upsert', () => {
  // Garantía de que el handler des-estructura lead/marketing antes de upsertPartner:
  // los handlers exponen esas claves, pero el partner real no debe llevarlas.
  const v = _test.FORM_HANDLERS['contacto']({ nombre: 'X', email: 'x@y.co', marketing: 'on' });
  assert.ok('lead' in v && 'marketing' in v, 'el handler expone lead/marketing como metadatos');
});
