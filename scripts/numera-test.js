#!/usr/bin/env node
/* Diagnóstico de la API de facturación de Numera — se corre EN LOCAL.

   Uso (Node 18+):
     node scripts/numera-test.js            # sondeo + login (si hay credenciales)
     node scripts/numera-test.js --payload  # además imprime un payload de ejemplo (DRY-RUN)

   (Windows PowerShell, con credenciales:
     $env:NUMERA_USERNAME="..."; $env:NUMERA_PASSWORD="..."; $env:NUMERA_COMPANY_ID="...";
     node scripts/numera-test.js)

   NO emite nada: el sondeo manda cuerpos deliberadamente incompletos (los
   rechaza la validación del servidor antes de tocar la DIAN) y `sendInvoice`
   sigue apagado por NUMERA_INVOICING_ENABLED. Sirve para ver, en orden:
   alcance del servidor, forma de los errores, qué campos exige el encabezado,
   el nombre real de la cabecera de autenticación y si nuestras credenciales
   sirven. */

const numera = require('../netlify/functions/_numera');

const cfg = numera.numeraConfig();
const UUID_DUMMY = '00000000-0000-0000-0000-000000000000';

function line() { console.log('─'.repeat(64)); }
function ok(msg) { console.log('  ✅ ' + msg); }
function warn(msg) { console.log('  ⚠️  ' + msg); }
function fail(msg) { console.log('  ❌ ' + msg); }

/* POST crudo al endpoint de emisión; devuelve { status, detail } con el motivo
   legible (Numera responde FastAPI: `detail` string o arreglo de validación). */
async function postInvoice(data, headers = {}) {
  const url = `${cfg.apiBase}/electronic-documents/send-electronic-invoice/`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
      body: JSON.stringify({ company_id: cfg.companyId || UUID_DUMMY, data })
    });
    let body = {};
    try { body = await res.json(); } catch (e) { /* sin cuerpo json */ }
    return { status: res.status, detail: numera.describeError(body) || JSON.stringify(body) };
  } catch (err) {
    return { status: 0, detail: `${err.name}: ${err.message}` };
  }
}

async function main() {
  line();
  console.log('DIAGNÓSTICO NUMERA (facturación electrónica DIAN)');
  line();
  console.log('API BASE  :', cfg.apiBase);
  console.log('USUARIO   :', cfg.username || '(vacío)');
  console.log('PASSWORD  :', cfg.password ? `(presente, ${cfg.password.length} chars)` : '(vacío)');
  console.log('COMPANY_ID:', cfg.companyId || '(vacío → se usa un UUID de relleno para el sondeo)');
  console.log('EMISIÓN   :', String(process.env.NUMERA_INVOICING_ENABLED).toLowerCase() === 'true'
    ? '⚠️ NUMERA_INVOICING_ENABLED=true (sendInvoice SÍ emitiría)'
    : 'OFF (dry-run)');
  line();

  /* 1. ¿Responde el servidor? */
  console.log('\n1) Alcance del servidor');
  const ping = await postInvoice({});
  if (ping.status === 0) { fail('no se pudo conectar — ' + ping.detail); return; }
  ok(`responde (${ping.status}): ${ping.detail}`);

  /* 2. Cabecera de autenticación: confirma que el nombre es `Auth`. */
  console.log('\n2) Cabecera de autenticación');
  const encMin = {
    encabezado: {
      invoiceNum: '1', legalNumber: '1',
      subtotal_documento: 0, valor_impuesto_documento: 0, retenciones_documento: 0
    },
    lineas: [], impuestos: [], cliente: {}
  };
  const sinAuth = await postInvoice(encMin);
  const conAuth = await postInvoice(encMin, { Auth: 'token-invalido' });
  const bearer = await postInvoice(encMin, { Authorization: 'Bearer token-invalido' });
  console.log('   sin cabecera            →', sinAuth.status, sinAuth.detail);
  console.log('   Auth: <token>           →', conAuth.status, conAuth.detail);
  console.log('   Authorization: Bearer   →', bearer.status, bearer.detail);
  if (conAuth.detail !== sinAuth.detail && bearer.detail === sinAuth.detail) {
    ok('la cabecera correcta es `Auth: <access_token>` (Bearer se ignora) — es la que usa _numera.js');
  }

  /* 3. Campos que el servidor exige ANTES de autenticar (así descubrimos el
        contrato real sin credenciales y sin emitir nada). */
  console.log('\n3) Campos obligatorios del encabezado (validados antes del token)');
  const data = { encabezado: {}, lineas: [], impuestos: [], cliente: {} };
  const exigidos = [];
  for (let i = 0; i < 20; i++) {
    const res = await postInvoice(data);
    const m = /^(?:encabezado\.)?([A-Za-z_0-9]+) es obligatorio/.exec(res.detail || '');
    if (!m) { console.log(`   se detiene en: ${res.status} — ${res.detail}`); break; }
    const campo = m[1];
    exigidos.push(campo);
    data.encabezado[campo] = /subtotal|total|valor|reten|impuesto/i.test(campo) ? 0 : '1';
  }
  ok('exige: ' + (exigidos.join(', ') || '(ninguno)'));
  if (exigidos.includes('invoiceNum') || exigidos.includes('legalNumber')) {
    warn('la API pide el NÚMERO de la factura ⇒ el consecutivo lo enviamos nosotros, no lo asigna Numera (pregunta 15 → resolución/prefijo DIAN para ventas web)');
  }

  /* 4. Login real (solo si hay credenciales). */
  console.log('\n4) Login');
  if (!numera.isConfigured()) {
    warn('sin NUMERA_USERNAME / NUMERA_PASSWORD / NUMERA_COMPANY_ID → no se puede probar la autenticación');
  } else {
    const auth = await numera.login();
    if (auth.ok) {
      ok(`login correcto — access_token de ${String(auth.accessToken).length} chars`);
      /* El sondeo AUTENTICADO va aparte (--probe-auth): el usuario puede ser el de
         producción, así que por defecto no le mandamos NADA al endpoint de emisión
         con un token válido encima. */
      if (process.argv.includes('--probe-auth')) {
        const conToken = await postInvoice(encMin, { Auth: auth.accessToken });
        console.log('   emisión con token y payload mínimo →', conToken.status, conToken.detail);
        warn('payload de relleno (sin líneas ni cliente): sirve para ver qué valida el servidor DESPUÉS del token');
      } else {
        console.log('   (sondeo autenticado omitido — se corre con --probe-auth)');
      }
    } else {
      fail(`login falló (${auth.status || '-'}): ${auth.error}`);
    }
  }

  /* 5. Payload de ejemplo (armado local, nunca se envía). */
  if (process.argv.includes('--payload')) {
    console.log('\n5) Payload de ejemplo (DRY-RUN, no se envía)');
    const payload = numera.buildInvoicePayload({
      reserva: { referencia: 'EST-2026-001', company_id: cfg.companyId || null },
      huesped: { nombre: 'Consumidor final', identificacion: '222222222222' },
      lineas: [{ descripcion: 'Alojamiento 2 noches — Clásica', cantidad: 2, precio_unitario_documento: 165000 }],
      impuestos: [{ nombre: 'IVA', valor: 62700 }]
    });
    console.log(JSON.stringify(payload, null, 2));
  }

  line();
  console.log('Fin. Nada se emitió ante la DIAN.');
  line();
}

main().catch((err) => { fail(err && err.message); process.exit(1); });
