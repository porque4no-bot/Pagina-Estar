/* Función de evento submission-created: enrutado de formularios nativos de
   Netlify al maestro de clientes (Odoo). Sin credenciales de Odoo, el upsert
   corre en modo mock (no-op), así que el handler se puede probar de punta a
   punta sin red. */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Modo mock de Odoo: sin credenciales el upsert es no-op.
for (const k of ['ODOO_URL', 'ODOO_DB', 'ODOO_USERNAME', 'ODOO_API_KEY', 'ODOO_COMPANY_ID']) delete process.env[k];

const { handler, _test } = require(path.join(__dirname, '../../netlify/functions/submission-created.js'));

function ev(payload) { return { body: JSON.stringify(payload === undefined ? {} : { payload }) }; }

test('mapea el form estancias-largas a valores de partner (persona)', () => {
  const v = _test.FORM_HANDLERS['estancias-largas']({
    nombre: 'Carlos Mendoza', correo: 'carlos@mail.co',
    motivo_viaje: 'Trabajo remoto', tiempo_estimado: '6 — 11 meses',
    tipologia: 'seleccion', fecha_mudanza: '2026-07-01', mensaje: 'Con mascota'
  });
  assert.equal(v.name, 'Carlos Mendoza');
  assert.equal(v.email, 'carlos@mail.co');
  assert.equal(v.isCompany, false);
  assert.match(v.comment, /larga estadía/);
  assert.match(v.comment, /Motivo: Trabajo remoto/);
  assert.match(v.comment, /Tipología: seleccion/);
});

test('ignora formularios que no son del maestro de clientes', async () => {
  const res = await handler(ev({ form_name: 'otro-form', data: { x: '1' } }));
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /ignored \(form otro-form\)/);
});

test('ignora envíos sin nombre ni correo', async () => {
  const res = await handler(ev({ form_name: 'estancias-largas', data: {} }));
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /ignored/);
});

test('procesa larga estadía y responde 200 (upsert mock sin credenciales)', async () => {
  const res = await handler(ev({ form_name: 'estancias-largas', data: { nombre: 'Ana', correo: 'a@b.co' } }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'ok');
});

test('cuerpo inválido no rompe el flujo (200)', async () => {
  const res = await handler({ body: 'no-json{' });
  assert.equal(res.statusCode, 200);
});
