#!/usr/bin/env node
/* Diagnóstico de la conexión con Odoo — se corre EN LOCAL (tu PC sí alcanza
   Odoo; el entorno de desarrollo del asistente no).

   Uso (Node 18+):
     ODOO_URL=https://bpo-dici.odoo.com \
     ODOO_DB=bpo-dici \
     ODOO_USERNAME=hola.dici.sas@gmail.com \
     ODOO_API_KEY=la_api_key \
     node scripts/odoo-test.js

   (En Windows PowerShell:
     $env:ODOO_URL="https://bpo-dici.odoo.com"; $env:ODOO_DB="bpo-dici";
     $env:ODOO_USERNAME="hola.dici.sas@gmail.com"; $env:ODOO_API_KEY="...";
     node scripts/odoo-test.js)

   Prueba, en orden: alcance del servidor, autenticación, contexto multiempresa
   del usuario, y la creación de un contacto de prueba (el mismo upsertPartner
   que usa la web). Imprime el resultado o el error EXACTO de cada paso. */

const odoo = require('../netlify/functions/_odoo');

const c = odoo.odooConfig();

function line() { console.log('─'.repeat(60)); }
function ok(msg) { console.log('  ✅ ' + msg); }
function fail(msg) { console.log('  ❌ ' + msg); }

async function main() {
  line();
  console.log('DIAGNÓSTICO ODOO');
  line();
  console.log('URL :', c.url || '(vacío)');
  console.log('DB  :', c.db || '(vacío)');
  console.log('USER:', c.username || '(vacío)');
  console.log('KEY :', c.apiKey ? '(presente, ' + c.apiKey.length + ' chars)' : '(vacío)');
  line();

  if (!odoo.isConfigured()) {
    fail('Faltan variables — define ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_API_KEY y reintenta.');
    process.exit(1);
  }

  // 1) Alcance del servidor (sin auth)
  console.log('\n1) Alcance del servidor (common.version)');
  try {
    const v = await odoo.jsonRpc('common', 'version', []);
    ok('Servidor alcanzable. Versión: ' + (v && (v.server_version || JSON.stringify(v))));
  } catch (e) {
    fail('No se pudo alcanzar el servidor: ' + e.message);
    console.log('   → Revisa ODOO_URL (sin slash final) y la conexión a internet.');
    process.exit(1);
  }

  // 2) Autenticación
  console.log('\n2) Autenticación (common.authenticate)');
  let uid;
  try {
    odoo._resetAuthCache();
    uid = await odoo.authenticate();
    ok('Autenticado. uid = ' + uid);
  } catch (e) {
    fail('Falló la autenticación: ' + e.message);
    console.log('   → Revisa ODOO_DB (nombre exacto), ODOO_USERNAME (login) y ODOO_API_KEY.');
    process.exit(1);
  }

  // 3) Contexto multiempresa del usuario
  console.log('\n3) Contexto multiempresa del usuario');
  try {
    const users = await odoo.executeKw('res.users', 'read', [[uid], ['name', 'login', 'company_id', 'company_ids']]);
    const u = users && users[0];
    if (u) {
      ok('Usuario: ' + u.name + ' (' + u.login + ')');
      console.log('   Empresa por defecto :', JSON.stringify(u.company_id));
      console.log('   Empresas permitidas :', JSON.stringify(u.company_ids));
      console.log('   → Anota el ID de la empresa del hotel (Mirada SAS) para asignar ahí ventas/facturas.');
    }
  } catch (e) {
    fail('No se pudo leer el usuario (¿permisos?): ' + e.message);
  }

  // 4) Permiso de lectura de Contactos
  console.log('\n4) Lectura de Contactos (res.partner)');
  try {
    const count = await odoo.executeKw('res.partner', 'search_count', [[]]);
    ok('El usuario ve ' + count + ' contactos.');
  } catch (e) {
    fail('Sin acceso a Contactos: ' + e.message);
    console.log('   → El usuario de integración necesita permiso de Contactos/Ventas.');
  }

  // 5) Crear contacto de prueba (mismo upsertPartner de la web)
  console.log('\n5) Crear contacto de prueba (upsertPartner)');
  try {
    const r = await odoo.upsertPartner({
      name: 'PRUEBA ODOO SAS',
      nit: '901234567-8',
      email: 'prueba.odoo@example.com',
      isCompany: true,
      comment: 'Contacto de prueba creado por scripts/odoo-test.js — se puede borrar.'
    });
    if (r.isMock) {
      fail('Corrió en modo MOCK (no debería con credenciales presentes).');
    } else {
      ok('upsertPartner OK → id=' + r.id + ', creado=' + r.created + (r.vatRejected ? ', (NIT rechazado por la localización → guardado en la nota)' : ''));
      // Leer dónde quedó (empresa)
      try {
        const p = await odoo.executeKw('res.partner', 'read', [[r.id], ['name', 'company_id', 'vat']]);
        console.log('   Contacto:', JSON.stringify(p && p[0]));
        console.log('   → Búscalo en Odoo → Contactos como "PRUEBA ODOO SAS". Si NO lo ves en la UI');
        console.log('     pero acá salió un id, es un tema de filtro por empresa (multiempresa).');
      } catch (e) { /* no crítico */ }
    }
  } catch (e) {
    fail('Falló la creación: ' + e.message);
    console.log('   → Pega este mensaje de error y lo resolvemos.');
  }

  line();
  console.log('Fin del diagnóstico. Copia toda la salida y compártela.');
  line();
}

main().catch(e => { console.error('Error inesperado:', e); process.exit(1); });
