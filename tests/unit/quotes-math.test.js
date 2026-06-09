const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeQuoteTotal,
  effectiveStatus,
  effectiveTarifa,
  nightsBetween,
  sanitizeQuoteInput,
  sanitizeService,
  toPublic
} = require('../../netlify/functions/_quotes-store');
const {
  buildExtrasFromQuote,
  findUnavailable
} = require('../../netlify/functions/_otasync');

function quoteWith({ items = [], servicios = {}, descuento = null } = {}) {
  return { items, servicios, descuento };
}

test('computeQuoteTotal calculates room-only IVA', () => {
  assert.deepEqual(computeQuoteTotal(quoteWith({
    items: [{ subtotal: 1_000_000 }]
  })), {
    subtotal: 1_000_000,
    descuentoAmt: 0,
    iva: 190_000,
    inc: 0,
    total: 1_190_000,
    totalCents: 119_000_000
  });
});

test('computeQuoteTotal calculates rooms plus food and INC', () => {
  const total = computeQuoteTotal(quoteWith({
    items: [{ subtotal: 1_000_000 }],
    servicios: { desayuno: { cantidad: 2, precioUnitario: 50_000 } }
  }));

  assert.equal(total.subtotal, 1_100_000);
  assert.equal(total.iva, 190_000);
  assert.equal(total.inc, 8_000);
  assert.equal(total.total, 1_298_000);
});

test('computeQuoteTotal calculates rooms plus parking IVA', () => {
  const total = computeQuoteTotal(quoteWith({
    items: [{ subtotal: 1_000_000 }],
    servicios: { parqueadero: { cantidad: 2, precioUnitario: 25_000 } }
  }));

  assert.equal(total.subtotal, 1_050_000);
  assert.equal(total.iva, 199_500);
  assert.equal(total.total, 1_249_500);
});

test('computeQuoteTotal applies percentage discounts pro-rata to IVA and INC', () => {
  const total = computeQuoteTotal(quoteWith({
    items: [{ subtotal: 1_000_000 }],
    servicios: {
      desayuno: { cantidad: 2, precioUnitario: 50_000 },
      parqueadero: { cantidad: 2, precioUnitario: 25_000 }
    },
    descuento: { tipo: 'porcentaje', valor: 10 }
  }));

  assert.equal(total.subtotal, 1_150_000);
  assert.equal(total.descuentoAmt, 115_000);
  assert.equal(total.iva, 179_550);
  assert.equal(total.inc, 7_200);
  assert.equal(total.total, 1_221_750);
});

test('computeQuoteTotal applies fixed discounts pro-rata and caps them at subtotal', () => {
  const mixed = computeQuoteTotal(quoteWith({
    items: [{ subtotal: 1_000_000 }],
    servicios: {
      desayuno: { cantidad: 2, precioUnitario: 50_000 },
      parqueadero: { cantidad: 2, precioUnitario: 25_000 }
    },
    descuento: { tipo: 'fijo', valor: 115_000 }
  }));
  assert.equal(mixed.total, 1_221_750);

  const fullyDiscounted = computeQuoteTotal(quoteWith({
    items: [{ subtotal: 100_000 }],
    descuento: { tipo: 'fijo', valor: 999_999 }
  }));
  assert.equal(fullyDiscounted.descuentoAmt, 100_000);
  assert.equal(fullyDiscounted.iva, 0);
  assert.equal(fullyDiscounted.total, 0);
});

test('computeQuoteTotal handles an empty quote', () => {
  assert.deepEqual(computeQuoteTotal(quoteWith()), {
    subtotal: 0,
    descuentoAmt: 0,
    iva: 0,
    inc: 0,
    total: 0,
    totalCents: 0
  });
});

test('sanitizeQuoteInput supplies safe defaults and a 30-day expiry', () => {
  const before = Date.now() + 30 * 24 * 60 * 60 * 1000;
  const result = sanitizeQuoteInput();
  const after = Date.now() + 30 * 24 * 60 * 60 * 1000;

  assert.equal(result.empresa, '');
  assert.equal(result.email, '');
  assert.equal(result.numPersonas, 1);
  assert.equal(result.comision, 0);
  assert.deepEqual(result.items, []);
  assert.ok(new Date(result.expiresAt).getTime() >= before);
  assert.ok(new Date(result.expiresAt).getTime() <= after);
});

test('sanitizeQuoteInput clamps submitted values to business limits', () => {
  const result = sanitizeQuoteInput({
    checkin: '2026-01-01',
    checkout: '2028-01-01',
    numPersonas: 999,
    comision: 999,
    items: [{
      roomTypeId: '31348',
      unidades: 999,
      tarifaBase: -50
    }],
    servicios: {
      desayuno: { cantidad: 999_999, precioUnitario: -1 }
    }
  });

  assert.equal(result.items[0].noches, 365);
  assert.equal(result.numPersonas, 200);
  assert.equal(result.comision, 100);
  assert.equal(result.items[0].unidades, 100);
  assert.equal(result.items[0].tarifaBase, 0);
  assert.equal(result.servicios.desayuno.cantidad, 100_000);
  assert.equal(result.servicios.desayuno.precioUnitario, 0);
});

test('sanitizeQuoteInput falls back from an invalid room ID to its room name', () => {
  const result = sanitizeQuoteInput({
    items: [{
      roomTypeId: 'invalid',
      habitacion: 'Selección',
      unidades: 2,
      tarifaBase: 250_000
    }]
  });

  assert.equal(result.items[0].roomTypeId, '31349');
  assert.equal(result.items[0].subtotal, 500_000);
});

test('effectiveStatus covers accepted, cancelled, expired and active quotes', () => {
  assert.equal(effectiveStatus({ status: 'aceptada' }), 'aceptada');
  assert.equal(effectiveStatus({ status: 'cancelada' }), 'cancelada');
  assert.equal(effectiveStatus({ status: 'activa', expiresAt: '2000-01-01T00:00:00.000Z' }), 'vencida');
  assert.equal(effectiveStatus({ status: 'activa', expiresAt: '2999-01-01T00:00:00.000Z' }), 'activa');
});

test('small quote helpers normalize dates, rates, services and public output', () => {
  assert.equal(nightsBetween('2026-06-01', '2026-06-05'), 4);
  assert.equal(nightsBetween('invalid', '2026-06-05'), 0);
  assert.equal(nightsBetween('2026-06-05', '2026-06-01'), 0);
  assert.equal(effectiveTarifa(100_000, 10), 110_000);
  assert.deepEqual(sanitizeService({ cantidad: '2', precioUnitario: '50000' }), {
    cantidad: 2,
    precioUnitario: 50_000
  });

  const publicQuote = toPublic({
    id: 'Q-1',
    comision: 10,
    items: [{ roomTypeId: '31348', tarifaBase: 100_000, tarifaPorNoche: 120_000 }]
  });
  assert.equal(publicQuote.comision, undefined);
  assert.equal(publicQuote.items[0].tarifaBase, undefined);
  assert.equal(publicQuote.items[0].tarifaPorNoche, 120_000);
});

test('findUnavailable detects exact availability, shortfalls and aggregated room types', () => {
  assert.deepEqual(findUnavailable([{ roomTypeId: '31348', unidades: 2 }], { 31348: 2 }), []);
  assert.deepEqual(findUnavailable([
    { roomTypeId: '31348', habitacion: 'Clásica', unidades: 2 }
  ], { 31348: 1 }), [{
    roomTypeId: '31348',
    habitacion: 'Clásica',
    requested: 2,
    available: 1
  }]);
  assert.deepEqual(findUnavailable([
    { roomTypeId: '31348', habitacion: 'Clásica', unidades: 1 }
  ], { 31348: 0 }), [{
    roomTypeId: '31348',
    habitacion: 'Clásica',
    requested: 1,
    available: 0
  }]);
  assert.deepEqual(findUnavailable([
    { roomTypeId: '31348', habitacion: 'Clásica', unidades: 1 },
    { roomTypeId: '31348', habitacion: 'Clásica', unidades: 2 },
    { roomTypeId: '31349', habitacion: 'Selección', unidades: 1 }
  ], { 31348: 2, 31349: 1 }), [{
    roomTypeId: '31348',
    habitacion: 'Clásica',
    requested: 3,
    available: 2
  }]);
});

test('buildExtrasFromQuote maps named services, custom extras and empty quotes', () => {
  assert.deepEqual(buildExtrasFromQuote({ servicios: {} }), { extras: [], extrasPrice: 0 });

  assert.deepEqual(buildExtrasFromQuote({
    servicios: {
      desayuno: { cantidad: 2, precioUnitario: 30_000 },
      parqueadero: { cantidad: 1, precioUnitario: 20_000 },
      otros: [
        { descripcion: 'Decoración', cantidad: 1, precioUnitario: 80_000 },
        { descripcion: '', cantidad: 3, precioUnitario: 10_000 }
      ]
    }
  }), {
    extras: [
      { id_extras: 0, name: 'Desayuno', qty: 2, price: 30_000, total_price: 60_000 },
      { id_extras: 0, name: 'Parqueadero', qty: 1, price: 20_000, total_price: 20_000 },
      { id_extras: 0, name: 'Decoración', qty: 1, price: 80_000, total_price: 80_000 }
    ],
    extrasPrice: 160_000
  });
});
