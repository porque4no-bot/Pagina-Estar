/* Portal empresa (solo-lectura) del conector Odoo: cálculo puro de aging por
   buckets, resolución de partnerKey, y las lecturas getCartera/getInvoices/
   getOrders contra un transporte JSON-RPC simulado. Sin red real. */

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
   mapea `${service}.${method}` o `${model}.${objMethod}` a un valor o función
   `(posArgs, kwargs) => result`. */
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

/* ── Núcleo PURO: buckets de aging ── */

const NOW = Date.UTC(2026, 6, 7); // 2026-07-07 (coincide con currentDate)
function dueDaysAgo(days) {
  return new Date(NOW - days * 86400000).toISOString().slice(0, 10);
}

test('agingBucket clasifica en las fronteras exactas', () => {
  const odoo = require(ODOO);
  assert.equal(odoo.agingBucket(-5), 'corriente');
  assert.equal(odoo.agingBucket(0), 'corriente');
  assert.equal(odoo.agingBucket(1), 'd1_30');
  assert.equal(odoo.agingBucket(30), 'd1_30');
  assert.equal(odoo.agingBucket(31), 'd31_60');
  assert.equal(odoo.agingBucket(60), 'd31_60');
  assert.equal(odoo.agingBucket(61), 'd61_90');
  assert.equal(odoo.agingBucket(90), 'd61_90');
  assert.equal(odoo.agingBucket(91), 'mas90');
  assert.equal(odoo.agingBucket(400), 'mas90');
});

test('daysOverdue es determinista con nowMs inyectado y UTC-safe', () => {
  const odoo = require(ODOO);
  assert.equal(odoo.daysOverdue('2026-07-01', NOW), 6);
  assert.equal(odoo.daysOverdue('2026-07-07', NOW), 0);
  assert.equal(odoo.daysOverdue('2026-07-10', NOW), -3); // vence en el futuro
  assert.equal(odoo.daysOverdue(null, NOW), 0);          // sin vencimiento → corriente
  assert.equal(odoo.daysOverdue(false, NOW), 0);
});

test('computeAging suma total, reparte por buckets e itemiza documentos', () => {
  const odoo = require(ODOO);
  const lines = [
    { moveName: 'FAC/1', dateMaturity: dueDaysAgo(-2), invoiceDate: '2026-07-01', amountResidual: 100 }, // corriente
    { moveName: 'FAC/2', dateMaturity: dueDaysAgo(10), invoiceDate: '2026-06-20', amountResidual: 200 }, // d1_30
    { moveName: 'FAC/3', dateMaturity: dueDaysAgo(45), invoiceDate: '2026-05-15', amountResidual: 50 },  // d31_60
    { moveName: 'FAC/4', dateMaturity: dueDaysAgo(75), invoiceDate: '2026-04-10', amountResidual: 25 },  // d61_90
    { moveName: 'FAC/5', dateMaturity: dueDaysAgo(200), invoiceDate: '2025-12-01', amountResidual: 300 } // mas90
  ];
  const r = odoo.computeAging(lines, NOW);
  assert.equal(r.total, 675);
  assert.deepEqual(r.buckets, { corriente: 100, d1_30: 200, d31_60: 50, d61_90: 25, mas90: 300 });
  assert.equal(r.documentos.length, 5);
  const d2 = r.documentos.find(d => d.documento === 'FAC/2');
  assert.equal(d2.saldo, 200);
  assert.equal(d2.bucket, 'd1_30');
  assert.equal(d2.diasVencido, 10);
});

test('computeAging ignora líneas con saldo cero y acumula en el mismo bucket', () => {
  const odoo = require(ODOO);
  const lines = [
    { moveName: 'A', dateMaturity: dueDaysAgo(5), amountResidual: 100 },
    { moveName: 'B', dateMaturity: dueDaysAgo(15), amountResidual: 0 },   // ignorada
    { moveName: 'C', dateMaturity: dueDaysAgo(20), amountResidual: 40 }
  ];
  const r = odoo.computeAging(lines, NOW);
  assert.equal(r.total, 140);
  assert.equal(r.buckets.d1_30, 140); // 100 + 40 en el mismo bucket
  assert.equal(r.documentos.length, 2);
});

test('computeAging con lista vacía o inválida devuelve ceros', () => {
  const odoo = require(ODOO);
  const empty = odoo.computeAging([], NOW);
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.buckets, odoo.emptyBuckets());
  assert.deepEqual(empty.documentos, []);
  assert.equal(odoo.computeAging(null, NOW).total, 0);
});

test('mapCarteraLine extrae move_id [id,nombre] y normaliza campos', () => {
  const odoo = require(ODOO);
  const ln = odoo.mapCarteraLine({
    move_id: [42, 'FAC/2026/0007'], date_maturity: '2026-06-01',
    invoice_date: '2026-05-01', amount_residual: 123.456
  });
  assert.equal(ln.moveId, 42);
  assert.equal(ln.moveName, 'FAC/2026/0007');
  assert.equal(ln.dateMaturity, '2026-06-01');
  assert.equal(ln.invoiceDate, '2026-05-01');
  assert.equal(ln.amountResidual, 123.456);
});

/* ── Modo mock (sin credenciales): coherente, isMock:true, nunca lanza ── */

test('getCartera sin credenciales es mock coherente', async () => {
  clearEnv();
  const odoo = require(ODOO);
  const r = await odoo.getCartera({ vat: '900123456-7' });
  assert.deepEqual(r, {
    partnerId: null, total: 0,
    buckets: { corriente: 0, d1_30: 0, d31_60: 0, d61_90: 0, mas90: 0 },
    documentos: [], count: 0, isMock: true
  });
});

test('getInvoices y getOrders sin credenciales son mock coherentes', async () => {
  clearEnv();
  const odoo = require(ODOO);
  assert.deepEqual(await odoo.getInvoices({ email: 'a@b.co' }), { partnerId: null, count: 0, invoices: [], isMock: true });
  assert.deepEqual(await odoo.getOrders(5), { partnerId: null, count: 0, orders: [], isMock: true });
});

/* ── resolvePartnerId ── */

test('resolvePartnerId acepta número directo sin tocar red', async () => {
  setEnv();
  const odoo = require(ODOO);
  odoo._resetAuthCache();
  const { transport, calls } = fakeTransport({ 'common.authenticate': 7 });
  assert.equal(await odoo.resolvePartnerId(88, { transport }), 88);
  assert.equal(calls.length, 0); // no hizo search
  clearEnv();
});

test('resolvePartnerId busca por vat (prioridad) y luego por email', async () => {
  setEnv();
  const odoo = require(ODOO);
  odoo._resetAuthCache();
  const { transport, calls } = fakeTransport({
    'common.authenticate': 7,
    'res.partner.search': [55]
  });
  assert.equal(await odoo.resolvePartnerId({ vat: '900.123.456-7', email: 'x@y.co' }, { transport }), 55);
  const search = calls.find(c => c.key === 'res.partner.search');
  assert.deepEqual(search.args[5][0], [['vat', '=', '900123456-7']]); // vat normalizado, gana a email
  clearEnv();
});

test('resolvePartnerId devuelve null si no hay match (no lanza)', async () => {
  setEnv();
  const odoo = require(ODOO);
  odoo._resetAuthCache();
  const { transport } = fakeTransport({ 'common.authenticate': 7, 'res.partner.search': [] });
  assert.equal(await odoo.resolvePartnerId({ email: 'nadie@x.co' }, { transport }), null);
  clearEnv();
});

/* ── Lecturas end-to-end contra transporte simulado ── */

test('getCartera consulta cuentas por cobrar, normaliza y agrega por buckets', async () => {
  setEnv();
  const odoo = require(ODOO);
  odoo._resetAuthCache();
  let searchDomain = null;
  const { transport } = fakeTransport({
    'common.authenticate': 7,
    'res.partner.search': [10],
    'account.move.line.search_read': (posArgs) => {
      searchDomain = posArgs[0];
      return [
        { id: 1, move_id: [1, 'FAC/1'], date_maturity: dueDaysAgo(5), invoice_date: '2026-06-30', amount_residual: 100, currency_id: [3, 'COP'] },
        { id: 2, move_id: [2, 'FAC/2'], date_maturity: dueDaysAgo(120), invoice_date: '2026-03-01', amount_residual: 250, currency_id: [3, 'COP'] }
      ];
    }
  });
  const r = await odoo.getCartera({ nit: '901032515' }, { transport, nowMs: NOW });
  assert.equal(r.isMock, false);
  assert.equal(r.partnerId, 10);
  assert.equal(r.total, 350);
  assert.equal(r.buckets.d1_30, 100);
  assert.equal(r.buckets.mas90, 250);
  assert.equal(r.count, 2);
  assert.equal(r.currency, 'COP');
  // domain incluye el filtro de cuenta por cobrar posteada con saldo
  assert.ok(searchDomain.some(d => d[0] === 'account_id.account_type' && d[2] === 'asset_receivable'));
  assert.ok(searchDomain.some(d => d[0] === 'partner_id' && d[2] === 10));
  clearEnv();
});

test('getCartera con Contabilidad ausente (search_read lanza) marca cartera no disponible', async () => {
  setEnv();
  const odoo = require(ODOO);
  odoo._resetAuthCache();
  const { transport } = fakeTransport({
    'common.authenticate': 7,
    'res.partner.search': [10],
    'account.move.line.search_read': () => { throw new Error('model account.move.line no existe'); }
  });
  const r = await odoo.getCartera(10, { transport, nowMs: NOW });
  assert.equal(r.partnerId, 10);
  assert.equal(r.total, null);
  assert.deepEqual(r.documentos, []);
  assert.equal(r.isMock, false);
  assert.equal(r.unavailable, true);
  assert.equal(r.error, 'odoo_cartera_unavailable');
  clearEnv();
});

test('getCartera sin partner devuelve estructura vacía (no consulta cartera)', async () => {
  setEnv();
  const odoo = require(ODOO);
  odoo._resetAuthCache();
  const { transport, calls } = fakeTransport({
    'common.authenticate': 7,
    'res.partner.search': []
  });
  const r = await odoo.getCartera({ email: 'ghost@x.co' }, { transport });
  assert.equal(r.partnerId, null);
  assert.equal(r.total, 0);
  assert.equal(r.isMock, false);
  assert.ok(!calls.find(c => c.key === 'account.move.line.search_read'));
  clearEnv();
});

test('getInvoices mapea out_invoice con numero/fecha/monto/estado/saldo', async () => {
  setEnv();
  const odoo = require(ODOO);
  odoo._resetAuthCache();
  let dom = null;
  const { transport } = fakeTransport({
    'common.authenticate': 7,
    'res.partner.search': [10],
    'account.move.search_read': (posArgs) => {
      dom = posArgs[0];
      return [
        { id: 5, name: 'FAC/2026/0005', invoice_date: '2026-06-01', invoice_date_due: '2026-07-01', amount_total: 1190, amount_residual: 500, amount_untaxed: 1000, move_type: 'out_invoice', state: 'posted', payment_state: 'partial', currency_id: [3, 'COP'] }
      ];
    }
  });
  const r = await odoo.getInvoices({ vat: '901032515' }, { transport });
  assert.equal(r.count, 1);
  const f = r.invoices[0];
  assert.equal(f.numero, 'FAC/2026/0005');
  assert.equal(f.fecha, '2026-06-01');
  assert.equal(f.monto, 1190);
  assert.equal(f.saldo, 500);
  assert.equal(f.subtotal, 1000);
  assert.equal(f.estado, 'posted');
  assert.equal(f.estadoPago, 'partial');
  assert.equal(f.moneda, 'COP');
  // por defecto solo out_invoice (sin notas crédito)
  assert.ok(dom.some(d => d[0] === 'move_type' && d[1] === 'in' && d[2].join() === 'out_invoice'));
  clearEnv();
});

test('getInvoices includeRefunds añade out_refund al domain', async () => {
  setEnv();
  const odoo = require(ODOO);
  odoo._resetAuthCache();
  let dom = null;
  const { transport } = fakeTransport({
    'common.authenticate': 7,
    'res.partner.search': [10],
    'account.move.search_read': (posArgs) => { dom = posArgs[0]; return []; }
  });
  await odoo.getInvoices(10, { transport, includeRefunds: true });
  assert.ok(dom.some(d => d[0] === 'move_type' && d[2].includes('out_refund')));
  clearEnv();
});

test('getOrders mapea sale.order y tolera Ventas no instalado', async () => {
  setEnv();
  const odoo = require(ODOO);
  odoo._resetAuthCache();
  const { transport } = fakeTransport({
    'common.authenticate': 7,
    'res.partner.search': [10],
    'sale.order.search_read': [
      { id: 9, name: 'S00009', date_order: '2026-06-15 10:00:00', amount_total: 2380, amount_untaxed: 2000, state: 'sale', invoice_status: 'to invoice', currency_id: [3, 'COP'] }
    ]
  });
  const r = await odoo.getOrders(10, { transport });
  assert.equal(r.count, 1);
  const o = r.orders[0];
  assert.equal(o.numero, 'S00009');
  assert.equal(o.monto, 2380);
  assert.equal(o.subtotal, 2000);
  assert.equal(o.estado, 'sale');
  assert.equal(o.estadoFactura, 'to invoice');
  assert.equal(o.moneda, 'COP');

  // Ventas no instalado: el modelo lanza → lista vacía, no fatal
  odoo._resetAuthCache();
  const { transport: t2 } = fakeTransport({
    'common.authenticate': 7,
    'res.partner.search': [10],
    'sale.order.search_read': () => { throw new Error('model sale.order no existe'); }
  });
  const r2 = await odoo.getOrders(10, { transport: t2 });
  assert.deepEqual(r2, { partnerId: 10, count: 0, orders: [], isMock: false });
  clearEnv();
});
