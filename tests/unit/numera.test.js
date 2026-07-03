const test = require('node:test');
const assert = require('node:assert/strict');
const numera = require('../../netlify/functions/_numera');

/* ── validate() ─────────────────────────────────────────────────────────────── */

function goodPayload() {
  return {
    company_id: 42,
    data: {
      encabezado: {
        tipo_factura: 'InvoiceType',
        subtotal_documento: 300000,      // 2*100000 + 1*100000
        valor_impuesto_documento: 57000, // IVA 19% de 300000
        retenciones_documento: 11000,    // retefuente
        total_documento: 346000
      },
      lineas: [
        { descripcion: 'Noche', cantidad: 2, precio_unitario_documento: 100000, precio_total_documento: 200000 },
        { descripcion: 'Desayuno', cantidad: 1, precio_unitario_documento: 100000, precio_total_documento: 100000 }
      ],
      impuestos: [
        { nombre: 'IVA', valor: 57000, es_retencion: false },
        { nombre: 'ReteFuente', valor: 11000, es_retencion: true }
      ],
      cliente: { nombre: 'Juan Perez', documento: '123' }
    }
  };
}

test('validate() acepta un payload con sumas correctas', () => {
  assert.equal(numera.validate(goodPayload()), true);
});

test('validate() rechaza precio_total_documento mal calculado en una línea', () => {
  const p = goodPayload();
  p.data.lineas[0].precio_total_documento = 999999; // != 2*100000
  assert.throws(() => numera.validate(p), /precio_total_documento/);
});

test('validate() rechaza subtotal_documento que no suma las líneas', () => {
  const p = goodPayload();
  p.data.encabezado.subtotal_documento = 123; // != 300000
  assert.throws(() => numera.validate(p), /subtotal_documento/);
});

test('validate() rechaza valor_impuesto_documento que no suma los impuestos no-retención', () => {
  const p = goodPayload();
  p.data.encabezado.valor_impuesto_documento = 1; // != 57000
  assert.throws(() => numera.validate(p), /valor_impuesto_documento/);
});

test('validate() rechaza retenciones_documento que no suma las retenciones', () => {
  const p = goodPayload();
  p.data.encabezado.retenciones_documento = 5; // != 11000
  assert.throws(() => numera.validate(p), /retenciones_documento/);
});

test('validate() exige ref_factura en una nota crédito (CreditNoteType)', () => {
  const p = goodPayload();
  p.data.encabezado.tipo_factura = 'CreditNoteType';
  assert.throws(() => numera.validate(p), /ref_factura/);
  p.data.encabezado.ref_factura = 'FE-100';
  assert.equal(numera.validate(p), true);
});

/* ── buildInvoicePayload() ──────────────────────────────────────────────────── */

test('buildInvoicePayload() calcula totales del encabezado y pasa validate()', () => {
  const payload = numera.buildInvoicePayload({
    reserva: { company_id: 7, referencia: 'EST-2026-001' },
    huesped: { nombre: 'Ana', documento: '900' },
    lineas: [
      { descripcion: 'Noche', cantidad: 3, precio_unitario_documento: 165000 },
      { descripcion: 'Parqueadero', cantidad: 1, precio_unitario_documento: 25000 }
    ],
    impuestos: [
      { nombre: 'IVA', valor: 98800, es_retencion: false },
      { nombre: 'ReteFuente', valor: 10000, es_retencion: true }
    ],
    tipo: 'InvoiceType'
  });
  assert.equal(payload.company_id, 7);
  assert.equal(payload.data.lineas[0].precio_total_documento, 495000); // 3*165000
  assert.equal(payload.data.lineas[1].precio_total_documento, 25000);
  assert.equal(payload.data.encabezado.subtotal_documento, 520000);
  assert.equal(payload.data.encabezado.valor_impuesto_documento, 98800);
  assert.equal(payload.data.encabezado.retenciones_documento, 10000);
  assert.equal(payload.data.encabezado.total_documento, 608800); // 520000+98800-10000
  assert.equal(payload.data.encabezado.referencia_interna, 'EST-2026-001');
});

test('buildInvoicePayload() rechaza un tipo de factura inválido', () => {
  assert.throws(
    () => numera.buildInvoicePayload({ lineas: [{ cantidad: 1, precio_unitario_documento: 1 }], tipo: 'Chevere' }),
    /tipo de factura/
  );
});

/* ── sendInvoice() gating ───────────────────────────────────────────────────── */

test('sendInvoice() sin credenciales y flag off → isMock, sin red', async () => {
  let called = false;
  const res = await numera.sendInvoice(goodPayload(), {
    flag: async () => false,
    config: { username: '', password: '', companyId: '', apiBase: 'https://x', timeoutMs: 1000 },
    fetch: async () => { called = true; return { ok: true, json: async () => ({}) }; }
  });
  assert.equal(res.ok, false);
  assert.equal(res.isMock, true);
  assert.equal(called, false, 'no debe tocar la red');
});

test('sendInvoice() con credenciales pero flag off → isMock, sin red', async () => {
  let called = false;
  const res = await numera.sendInvoice(goodPayload(), {
    flag: async () => false,
    config: { username: 'u', password: 'p', companyId: '9', apiBase: 'https://x', timeoutMs: 1000 },
    fetch: async () => { called = true; return { ok: true, json: async () => ({}) }; }
  });
  assert.equal(res.isMock, true);
  assert.equal(called, false);
});

/* ── sendInvoice() con flag on + fetch inyectado ────────────────────────────── */

test('sendInvoice() con flag on arma bien login + emisión (URL, header Auth, body) y parsea', async () => {
  const calls = [];
  const config = { username: 'user1', password: 'secret', companyId: 55, apiBase: 'https://esnumera.com/api/v1', timeoutMs: 1000 };

  /* Solo captura los requests; las aserciones van DESPUÉS (si asertáramos aquí,
     sendInvoice atraparía el error en su try/catch y lo enmascararía). */
  const fakeFetch = async (url, opts) => {
    calls.push({ url, opts });
    if (url.endsWith('/login/')) {
      return { ok: true, json: async () => ({ access_token: 'TOKEN-XYZ' }) };
    }
    return { ok: true, json: async () => ({ status: 'OK', cufe: 'abc123', number: 'FE-001' }) };
  };

  const res = await numera.sendInvoice(goodPayload(), { flag: async () => true, config, fetch: fakeFetch });
  assert.equal(res.ok, true);
  assert.deepEqual(res.raw, { status: 'OK', cufe: 'abc123', number: 'FE-001' });

  // login + emisión = 2 llamadas
  assert.equal(calls.length, 2);

  // login: form-urlencoded con username/password
  const loginCall = calls[0];
  assert.ok(loginCall.url.endsWith('/login/'));
  assert.equal(loginCall.opts.method, 'POST');
  assert.equal(loginCall.opts.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.match(loginCall.opts.body, /username=user1/);
  assert.match(loginCall.opts.body, /password=secret/);

  // emisión: URL, header Auth con el token, body con el payload
  const sendCall = calls[1];
  assert.ok(sendCall.url.endsWith('/electronic-documents/send-electronic-invoice/'));
  assert.equal(sendCall.opts.headers['Auth'], 'TOKEN-XYZ');
  assert.equal(sendCall.opts.headers['Content-Type'], 'application/json');
  const sent = JSON.parse(sendCall.opts.body);
  assert.equal(sent.company_id, 42); // toma el company_id del payload
  assert.equal(sent.data.encabezado.tipo_factura, 'InvoiceType');
  assert.equal(sent.data.lineas.length, 2);
});

test('sendInvoice() con flag on pero login fallido → ok:false y NO emite', async () => {
  const calls = [];
  const config = { username: 'u', password: 'p', companyId: 1, apiBase: 'https://x', timeoutMs: 1000 };
  const fakeFetch = async (url) => {
    calls.push(url);
    return { ok: false, status: 401, json: async () => ({ message: 'bad creds' }) };
  };
  const res = await numera.sendInvoice(goodPayload(), { flag: async () => true, config, fetch: fakeFetch });
  assert.equal(res.ok, false);
  assert.match(res.error, /bad creds|login/);
  assert.equal(calls.length, 1, 'solo intenta el login, no la emisión');
});

/* ── login() aislado ────────────────────────────────────────────────────────── */

test('login() sin credenciales → isMock', async () => {
  const res = await numera.login({ config: { username: '', password: '', apiBase: 'https://x', timeoutMs: 1000 } });
  assert.equal(res.isMock, true);
});

test('login() con fetch inyectado devuelve accessToken', async () => {
  const res = await numera.login({
    config: { username: 'u', password: 'p', apiBase: 'https://esnumera.com/api/v1', timeoutMs: 1000 },
    fetch: async () => ({ ok: true, json: async () => ({ access_token: 'T1' }) })
  });
  assert.equal(res.ok, true);
  assert.equal(res.accessToken, 'T1');
});

/* ── isConfigured() ─────────────────────────────────────────────────────────── */

test('isConfigured() refleja las credenciales inyectadas', () => {
  assert.equal(numera.isConfigured({ config: { username: 'u', password: 'p', companyId: '9' } }), true);
  assert.equal(numera.isConfigured({ config: { username: '', password: 'p', companyId: '9' } }), false);
});
