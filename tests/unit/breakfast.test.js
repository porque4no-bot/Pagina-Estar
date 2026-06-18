/* Pase de desayuno (Fase 1): lógica de derecho/estado y store idempotente.
 *
 * El store usa @netlify/blobs vía guestStore; aquí lo reemplazamos por un store
 * en memoria que respeta el contrato onlyIfNew + list({prefix}), para probar la
 * idempotencia (1 desayuno por persona/día) sin un backend real. También se
 * fuerza el modo demo (sin OTASync) para resolveBreakfastStatus. */

const test = require('node:test');
const assert = require('node:assert/strict');

// ── Mock de @netlify/blobs (store en memoria) ──
const blobsPath = require.resolve('@netlify/blobs');
const mem = new Map();
const memStore = {
  async set(key, val, opts) {
    if (opts && opts.onlyIfNew && mem.has(key)) return { modified: false };
    mem.set(key, val);
    return { modified: true };
  },
  async get(key) { return mem.has(key) ? mem.get(key) : null; },
  async list(opts) {
    const prefix = (opts && opts.prefix) || '';
    return { blobs: [...mem.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) };
  }
};
require.cache[blobsPath] = { id: blobsPath, filename: blobsPath, loaded: true, exports: { getStore: () => memStore } };

// Forzar modo demo: sin credenciales OTASync, getReservationDetail usa la reserva demo.
delete process.env.OTASYNC_TOKEN;
delete process.env.OTASYNC_USERNAME;
delete process.env.OTASYNC_PASSWORD;

const {
  extractBreakfastEntitlement, demoEntitlement, pickNextGuestIndex, withinStay, resolveBreakfastStatus
} = require('../../netlify/functions/_breakfast');
const store = require('../../netlify/functions/_breakfast-store');

test.beforeEach(() => {
  mem.clear();
  // _env (cargado al requerir _guest-app) repuebla las credenciales desde el
  // .env del dev DESPUÉS del borrado de arriba; las quitamos aquí para forzar
  // la reserva demo en resolveBreakfastStatus tanto en local como en CI.
  delete process.env.OTASYNC_TOKEN;
  delete process.env.OTASYNC_USERNAME;
  delete process.env.OTASYNC_PASSWORD;
});

// ── extractBreakfastEntitlement (el derecho se LEE de la reserva, no del canal) ──
test('extract: first_meal breakfast + nights.breakfast => incluido, perDay = personas', () => {
  const raw = { rooms: [{ first_meal: 'breakfast', occupancy: 2, nights: [{ breakfast: 2 }, { breakfast: 2 }] }] };
  assert.deepEqual(extractBreakfastEntitlement(raw, 2), { included: true, perDay: 2 });
});

test('extract: sin desayuno => no incluido', () => {
  const raw = { rooms: [{ first_meal: 'none', nights: [{ breakfast: 0 }] }] };
  assert.deepEqual(extractBreakfastEntitlement(raw, 2), { included: false, perDay: 0 });
});

test('extract: lee reservation_rooms (forma real del detalle de OTASync)', () => {
  // El detalle de reserva entrega `reservation_rooms`, no `rooms`. Con el agregado
  // `breakfast` por noche => perDay = ese número.
  const raw = { reservation_rooms: [{ first_meal: 'breakfast', occupancy: 2, nights: [{ breakfast: 2, breakfast_adults: 2 }, { breakfast: 2, breakfast_adults: 2 }] }] };
  assert.deepEqual(extractBreakfastEntitlement(raw, 2), { included: true, perDay: 2 });
});

test('extract: suma los desayunos de menores (desglose por tipo, sin agregado)', () => {
  const raw = { reservation_rooms: [{ first_meal: 'breakfast', nights: [{ breakfast_adults: 1, breakfast_children_1: 1 }] }] };
  assert.deepEqual(extractBreakfastEntitlement(raw, 0), { included: true, perDay: 2 });
});

test('extract: no doble-cuenta cuando breakfast (agregado) ya incluye a los menores', () => {
  // Si `breakfast` es el total de la noche y el desglose suma lo mismo, perDay = total.
  const raw = { reservation_rooms: [{ first_meal: 'breakfast', nights: [{ breakfast: 3, breakfast_adults: 2, breakfast_children_1: 1 }] }] };
  assert.deepEqual(extractBreakfastEntitlement(raw, 0), { included: true, perDay: 3 });
});

test('extract: varias habitaciones suman el derecho diario', () => {
  const raw = { rooms: [
    { first_meal: 'breakfast', nights: [{ breakfast: 2 }] },
    { first_meal: 'breakfast', nights: [{ breakfast: 1 }] }
  ] };
  assert.deepEqual(extractBreakfastEntitlement(raw, 3), { included: true, perDay: 3 });
});

test('extract: plan con desayuno pero sin conteo cae a la ocupación', () => {
  const raw = { rooms: [{ first_meal: 'breakfast', occupancy: 3, nights: [{}] }] };
  assert.deepEqual(extractBreakfastEntitlement(raw, 0), { included: true, perDay: 3 });
});

// ── demoEntitlement (el canal NO decide; sólo Airbnb/SIN salen sin desayuno) ──
test('demo: una reserva con desayuno incluye para toda la capacidad', () => {
  assert.deepEqual(demoEntitlement({ bookingCode: 'EST-DEMO-2026', capacity: 2 }), { included: true, perDay: 2 });
});

test('demo: una reserva de OTA con desayuno llega en verde (el canal no decide)', () => {
  assert.deepEqual(demoEntitlement({ bookingCode: 'EST-BOOKING-5', capacity: 2 }), { included: true, perDay: 2 });
});

test('demo: una reserva sin desayuno (p.ej. Airbnb) llega en rojo', () => {
  assert.deepEqual(demoEntitlement({ bookingCode: 'EST-AIRBNB-1', capacity: 2 }), { included: false, perDay: 0 });
});

// ── pickNextGuestIndex ──
test('pickNext: nadie servido => persona 0', () => {
  assert.equal(pickNextGuestIndex({ perDay: 2, servedIndexes: [] }), 0);
});

test('pickNext: una persona servida => la siguiente', () => {
  assert.equal(pickNextGuestIndex({ perDay: 2, servedIndexes: [0] }), 1);
});

test('pickNext: todas servidas => null', () => {
  assert.equal(pickNextGuestIndex({ perDay: 2, servedIndexes: [0, 1] }), null);
});

// ── withinStay ──
test('withinStay: una fecha dentro del rango', () => {
  assert.equal(withinStay('2026-06-10', '2026-06-20', '2026-06-15'), true);
});

test('withinStay: una fecha fuera del rango', () => {
  assert.equal(withinStay('2026-06-10', '2026-06-20', '2026-06-25'), false);
});

// ── store: idempotencia 1 por persona/día ──
test('store: recordRedemption es idempotente por persona/día', async () => {
  const first = await store.recordRedemption({ bookingCode: 'EST-1', guestIndex: 0, date: '2026-06-18' });
  assert.equal(first.created, true);
  const second = await store.recordRedemption({ bookingCode: 'EST-1', guestIndex: 0, date: '2026-06-18' });
  assert.equal(second.created, false);
});

test('store: getBookingRedemptions filtra por reserva y día', async () => {
  await store.recordRedemption({ bookingCode: 'EST-1', guestIndex: 0, date: '2026-06-18' });
  await store.recordRedemption({ bookingCode: 'EST-1', guestIndex: 1, date: '2026-06-18' });
  await store.recordRedemption({ bookingCode: 'EST-1', guestIndex: 0, date: '2026-06-17' });
  await store.recordRedemption({ bookingCode: 'EST-2', guestIndex: 0, date: '2026-06-18' });
  const today = await store.getBookingRedemptions('EST-1', '2026-06-18');
  assert.equal(today.length, 2);
});

test('store: hasRedeemed distingue persona servida de pendiente', async () => {
  await store.recordRedemption({ bookingCode: 'EST-9', guestIndex: 0, date: '2026-06-18' });
  assert.equal(await store.hasRedeemed('EST-9', 0, '2026-06-18'), true);
  assert.equal(await store.hasRedeemed('EST-9', 1, '2026-06-18'), false);
});

// ── resolveBreakfastStatus (modo demo) ──
test('resolve: demo con desayuno refleja servidos y restantes', async () => {
  const before = await resolveBreakfastStatus('EST-DEMO-2026', { date: '2026-06-18' });
  assert.equal(before.hasBreakfast, true);
  assert.equal(before.servedToday, 0);
  assert.equal(before.remaining, before.perDay);

  await store.recordRedemption({ bookingCode: 'EST-DEMO-2026', guestIndex: 0, date: '2026-06-18' });
  const after = await resolveBreakfastStatus('EST-DEMO-2026', { date: '2026-06-18' });
  assert.equal(after.servedToday, 1);
  assert.equal(after.remaining, after.perDay - 1);
});

test('resolve: demo sin desayuno (p.ej. Airbnb) llega en rojo, candidato a upgrade', async () => {
  const s = await resolveBreakfastStatus('EST-AIRBNB-7', { date: '2026-06-18' });
  assert.equal(s.hasBreakfast, false);
  assert.equal(s.perDay, 0);
});
