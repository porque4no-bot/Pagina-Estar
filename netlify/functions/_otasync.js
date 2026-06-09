/* Shared OTASync/Kunas access: session auth + availability lookup.
   Used by create-quote, update-quote and the scheduled revalidation job
   so the auth + getRooms logic lives in one place. */

const fs = require('fs');
const path = require('path');

/* Session key (pkey) lives in Netlify Blobs so every function shares a
   single auth and OTASync isn't hammered with a fresh login per cold
   start. A small in-process memo (hotCache) cuts read latency on warm
   invocations. inflightPromise dedupes parallel refreshes. */
const SESSION_STORE = 'otasync-session';
const SESSION_KEY = 'pkey';
const PKEY_TTL_MS = 25 * 60 * 1000;        /* refresh 5 min before OTASync expires it */
const HOT_CACHE_MS = 60 * 1000;            /* trust in-process value for 60 s */

let hotCache = { pkey: null, fetchedAt: 0 };
let inflightPromise = null;

function getSessionStore() {
  /* Lazy require so loading the module without Blobs (unit tests) still works. */
  try {
    const { getStore } = require('@netlify/blobs');
    const opts = { name: SESSION_STORE, consistency: 'strong' };
    if (process.env.BLOBS_TOKEN && process.env.NETLIFY_SITE_ID) {
      opts.token = process.env.BLOBS_TOKEN;
      opts.siteID = process.env.NETLIFY_SITE_ID;
    }
    return getStore(opts);
  } catch (e) {
    return null;
  }
}

async function readSessionBlob() {
  const store = getSessionStore();
  if (!store) return null;
  try {
    const raw = await store.get(SESSION_KEY, { type: 'json' });
    if (raw && raw.pkey && raw.expiresAt && raw.expiresAt > Date.now()) return raw;
  } catch (e) { /* fall through to refresh */ }
  return null;
}

async function writeSessionBlob(pkey, expiresAt) {
  const store = getSessionStore();
  if (!store) return;
  try {
    await store.setJSON(SESSION_KEY, { pkey, expiresAt });
  } catch (e) { /* non-fatal — local cache still works */ }
}

async function clearSessionBlob() {
  hotCache = { pkey: null, fetchedAt: 0 };
  const store = getSessionStore();
  if (!store) return;
  try { await store.delete(SESSION_KEY); } catch (e) { /* non-fatal */ }
}

async function loginOtasync() {
  const { token, username, password } = otasyncCreds();
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 10000);
  let res;
  try {
    res = await fetch('https://app.otasync.me/api/user/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, username, password, remember: 0 }),
      signal: ctrl.signal
    });
    clearTimeout(tid);
  } catch (err) {
    clearTimeout(tid);
    throw err.name === 'AbortError' ? new Error('Request timeout during authentication') : err;
  }
  if (!res.ok) throw new Error(`Authentication failed with status ${res.status}`);
  const data = await res.json();
  if (!data.pkey) throw new Error('Authentication response did not contain a session key (pkey)');
  return data.pkey;
}

function otasyncCreds() {
  return {
    token: process.env.OTASYNC_TOKEN || '',
    username: process.env.OTASYNC_USERNAME || '',
    password: process.env.OTASYNC_PASSWORD || '',
    propertyId: process.env.OTASYNC_PROPERTY_ID || '9889',
    channelId: process.env.OTASYNC_CHANNEL_ID || '66483',
    channelName: process.env.OTASYNC_CHANNEL_NAME || 'Pagina web'
  };
}

function hasOtasyncCreds() {
  const c = otasyncCreds();
  return !!(c.token && c.username && c.password);
}

async function getSessionKey({ force = false } = {}) {
  const now = Date.now();
  if (!force && hotCache.pkey && now - hotCache.fetchedAt < HOT_CACHE_MS) {
    return hotCache.pkey;
  }

  if (!force) {
    const blob = await readSessionBlob();
    if (blob) {
      hotCache = { pkey: blob.pkey, fetchedAt: now };
      return blob.pkey;
    }
  }

  if (inflightPromise) {
    try { return await inflightPromise; }
    catch (e) { inflightPromise = null; }
  }

  inflightPromise = (async () => {
    const pkey = await loginOtasync();
    const expiresAt = Date.now() + PKEY_TTL_MS;
    hotCache = { pkey, fetchedAt: Date.now() };
    await writeSessionBlob(pkey, expiresAt);
    return pkey;
  })();

  try { return await inflightPromise; }
  finally { inflightPromise = null; }
}

/* Wraps an OTASync fetch and retries once with a fresh pkey if the server
   answers 401 / session expired. Callers must accept (key) so the second
   attempt can supply the new pkey. */
async function withSessionRetry(makeRequest) {
  let pkey = await getSessionKey();
  let res = await makeRequest(pkey);
  if (res.status !== 401) return res;

  /* Try to detect "session expired" payloads even when status is 200.
     OTASync usually answers 401 but some endpoints return 200 with an
     error body — we handle the unambiguous 401 case here. */
  await clearSessionBlob();
  pkey = await getSessionKey({ force: true });
  return await makeRequest(pkey);
}

/* Returns available units per room type id for the given stay.
   { availByType: { '31348': 3, ... }, isMock: boolean }
   When credentials are missing returns isMock:true and an empty map so
   callers can decide to skip the availability gate locally. */
async function getAvailabilityByType(checkin, checkout) {
  if (!hasOtasyncCreds()) return { availByType: {}, isMock: true };
  const { propertyId } = otasyncCreds();

  const makeRequest = async (pkey) => {
    const payload = {
      key: pkey,
      dfrom: checkin,
      dto: checkout,
      currency: 'COP',
      id_language: 'es',
      guests: [{ guest_filter_id: 1, adults: 1, children: 0, children_age: [] }],
      id_properties: propertyId
    };
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 10000);
    try {
      const r = await fetch('https://app.otasync.me/api/engine/data/getRooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl.signal
      });
      clearTimeout(tid);
      return r;
    } catch (err) {
      clearTimeout(tid);
      throw err.name === 'AbortError' ? new Error('Request timeout during availability lookup') : err;
    }
  };

  const res = await withSessionRetry(makeRequest);
  if (!res.ok) throw new Error(`getRooms returned status ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data.rooms)) throw new Error('Invalid getRooms response: expected rooms list');
  const availByType = {};
  data.rooms.forEach(r => {
    availByType[String(r.id_room_types)] = parseInt(r.avail) || 0;
  });
  return { availByType, isMock: false };
}


/* Given quote items, returns the list of room types whose requested units
   exceed current availability. Empty array means the stay is bookable. */
function findUnavailable(items, availByType) {
  const required = {};
  (items || []).forEach(it => {
    const id = String(it.roomTypeId || '');
    if (!id) return;
    required[id] = (required[id] || 0) + (parseInt(it.unidades) || 1);
  });
  const shortfalls = [];
  Object.keys(required).forEach(id => {
    const have = availByType[id] || 0;
    if (have < required[id]) {
      const item = (items || []).find(i => String(i.roomTypeId) === id);
      shortfalls.push({
        roomTypeId: id,
        habitacion: (item && item.habitacion) || id,
        requested: required[id],
        available: have
      });
    }
  });
  return shortfalls;
}

/* ── Room holds (tentative reservations that block availability) ── */

let _roomsDb = null;
function roomsDb() {
  if (_roomsDb) return _roomsDb;
  try {
    const p = path.join(__dirname, '../../rooms_db.json');
    _roomsDb = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
  } catch (e) { _roomsDb = {}; }
  return _roomsDb;
}

function nightsBetween(checkin, checkout) {
  return Math.max(1, Math.round((new Date(checkout) - new Date(checkin)) / 86400000) || 1);
}

// Convert quote.servicios into an OTASync extras array + total price.
function buildExtrasFromQuote(quote) {
  const sv = (quote && quote.servicios) || {};
  const extras = [];

  const named = [
    { key: 'desayuno', name: 'Desayuno' },
    { key: 'almuerzo', name: 'Almuerzo' },
    { key: 'cena', name: 'Cena' },
    { key: 'parqueadero', name: 'Parqueadero' },
    { key: 'personaAdicional', name: 'Persona Adicional' }
  ];
  for (const { key, name } of named) {
    const s = sv[key];
    if (!s || !s.cantidad || !s.precioUnitario) continue;
    const totalPrice = s.cantidad * s.precioUnitario;
    extras.push({ id_extras: 0, name, qty: s.cantidad, price: s.precioUnitario, total_price: totalPrice });
  }
  for (const o of (sv.otros || [])) {
    if (!o || !o.cantidad || !o.precioUnitario || !o.descripcion) continue;
    const totalPrice = o.cantidad * o.precioUnitario;
    extras.push({ id_extras: 0, name: String(o.descripcion).slice(0, 100), qty: o.cantidad, price: o.precioUnitario, total_price: totalPrice });
  }

  const extrasPrice = extras.reduce((s, e) => s + e.total_price, 0);
  return { extras, extrasPrice };
}

// Expand quote items into an OTASync rooms array (one entry per unit).
function buildRoomsFromQuote(quote) {
  const details = roomsDb();
  const rooms = [];
  const nights = nightsBetween(quote.checkin, quote.checkout);
  (quote.items || []).forEach(it => {
    const avgPrice = it.tarifaPorNoche || 0;
    const totalPrice = avgPrice * nights;
    const matched = details[it.roomTypeId];
    const roomName = (matched && matched.name) || it.habitacion || 'Clásica';
    const nightsArray = [];
    for (let n = 0; n < nights; n++) {
      const d = new Date(quote.checkin);
      d.setDate(d.getDate() + n);
      nightsArray.push({ night_date: d.toISOString().split('T')[0], price: avgPrice, original_price: avgPrice, breakfast: 0, lunch: 0, dinner: 0 });
    }
    const units = Math.max(1, parseInt(it.unidades) || 1);
    for (let u = 0; u < units; u++) {
      rooms.push({
        id_room_types: parseInt(it.roomTypeId) || 0,
        id_rooms: 0, room_type: roomName, room_number: "",
        avg_price: avgPrice, total_price: totalPrice,
        children_1: 0, children_2: 0, children_3: 0,
        adults: 1, seniors: 0, extras: [], payments: [], overbooking: 0,
        nights: nightsArray
      });
    }
  });
  return { rooms, nights };
}

async function insertReservation(payload) {
  const makeRequest = async (pkey) => {
    const body = { ...payload, key: pkey };
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 10000);
    try {
      const r = await fetch('https://app.otasync.me/api/reservation/insert/reservation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: ctrl.signal
      });
      clearTimeout(tid);
      return r;
    } catch (err) {
      clearTimeout(tid);
      throw err.name === 'AbortError' ? new Error('Request timeout during reservation insert') : err;
    }
  };
  const res = await withSessionRetry(makeRequest);
  if (!res.ok) throw new Error(`insert/reservation returned status ${res.status}`);
  return res.json();
}

/* Create a tentative reservation that holds the quoted rooms. Returns the
   created reservation id. Hold status is configurable (OTASYNC_HOLD_STATUS). */
async function createHold(quote) {
  if (!hasOtasyncCreds()) return null;
  const { token, propertyId, channelId, channelName } = otasyncCreds();
  const pkey = await getSessionKey();
  const holdStatus = process.env.OTASYNC_HOLD_STATUS || 'tentative';

  const { rooms, nights } = buildRoomsFromQuote(quote);
  if (!rooms.length) return null;
  const roomsPrice = rooms.reduce((s, r) => s + r.total_price, 0);
  const totalGuests = quote.numPersonas || rooms.length || 1;

  const nightsDates = [];
  for (let n = 0; n < nights; n++) {
    const d = new Date(quote.checkin); d.setDate(d.getDate() + n);
    nightsDates.push(d.toISOString().split('T')[0]);
  }

  const payload = {
    key: pkey, id_properties: propertyId, token,
    status: holdStatus,
    rooms,
    guests: [{ first_name: 'BLOQUEO', last_name: (quote.empresa || 'Cotización').slice(0, 60), id_guests: 0, guest_type: 'adults' }],
    extras: [], payments: [],
    children_1: 0, children_2: 0, children_3: 0,
    adults: totalGuests, seniors: 0, total_guests: totalGuests,
    discount_type: 'percent', discount_amount: 0, discount_note: '',
    rooms_price: roomsPrice, rooms_discounted: roomsPrice,
    extras_price: 0, board_price: 0, city_tax_price: 0, insurance_price: 0,
    total_price: roomsPrice, id_boards: '', id_reservations: 0,
    nights, nights_dates: nightsDates,
    reservation_type: 'web',
    active_id_room_types: String((quote.items[0] && quote.items[0].roomTypeId) || ''),
    preselected_id_rooms: 0,
    reference: quote.quoteId,
    id_contigents: 0,
    date_arrival: quote.checkin, date_departure: quote.checkout,
    ...(channelId ? { id_channels: channelId, channel: channelName } : {}),
    note: `BLOQUEO temporal por cotización ${quote.quoteId} (${quote.empresa || ''}). No es una venta confirmada.`
  };

  const data = await insertReservation(payload);
  return data.id_reservations || null;
}

/* Release a hold by deleting the tentative reservation
   (OTASync: reservation/delete/reservation). */
async function releaseHold(idReservations) {
  if (!hasOtasyncCreds() || !idReservations) return;
  const { token, propertyId } = otasyncCreds();

  const makeRequest = async (pkey) => {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 10000);
    try {
      const r = await fetch('https://app.otasync.me/api/reservation/delete/reservation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: pkey, token, id_properties: propertyId, id_reservations: idReservations }),
        signal: ctrl.signal
      });
      clearTimeout(tid);
      return r;
    } catch (err) {
      clearTimeout(tid);
      throw err.name === 'AbortError' ? new Error('Request timeout during reservation delete') : err;
    }
  };
  const res = await withSessionRetry(makeRequest);
  if (!res.ok) throw new Error(`delete/reservation returned status ${res.status}`);
}

/* Create a CONFIRMED reservation for a paid quote. Returns the booking code.
   Shared by the Wompi webhook (on payment) and the admin retry endpoint. */
async function createConfirmedReservation(quote, opts) {
  opts = opts || {};
  const { token, propertyId, channelId, channelName } = otasyncCreds();
  const pkey = await getSessionKey();

  const { rooms, nights } = buildRoomsFromQuote(quote);
  if (!rooms.length) throw new Error('Quote has no rooms');
  const roomsPrice = rooms.reduce((s, r) => s + r.total_price, 0);
  const { extras, extrasPrice } = buildExtrasFromQuote(quote);
  const totalGuests = quote.numPersonas || rooms.length || 1;

  const nightsDates = [];
  for (let n = 0; n < nights; n++) {
    const d = new Date(quote.checkin); d.setDate(d.getDate() + n);
    nightsDates.push(d.toISOString().split('T')[0]);
  }

  const contacto = (quote.contacto || quote.empresa || 'Empresa').trim();
  const parts = contacto.split(/\s+/);
  const firstName = parts.shift() || quote.empresa || 'Empresa';
  const lastName = parts.join(' ') || quote.empresa || '';

  const paidAmount = opts.paidAmount != null ? opts.paidAmount : roomsPrice;
  const providerLabel = opts.paymentProvider || 'payment';
  const payments = [{
    amount: paidAmount,
    payment_date: new Date().toISOString().split('T')[0],
    payment_method: 'card',
    note: `Cotización: ${quote.quoteId}${opts.transactionId ? ', ' + providerLabel + ' ID: ' + opts.transactionId : ''}, Status: APPROVED`
  }];

  const payload = {
    key: pkey, id_properties: propertyId, token,
    status: 'confirmed',
    rooms,
    guests: [{ first_name: firstName, last_name: lastName, id_guests: 0, guest_type: 'adults' }],
    extras, payments,
    children_1: 0, children_2: 0, children_3: 0,
    adults: totalGuests, seniors: 0, total_guests: totalGuests,
    discount_type: 'percent', discount_amount: 0, discount_note: '',
    rooms_price: roomsPrice, rooms_discounted: roomsPrice,
    extras_price: extrasPrice, board_price: 0, city_tax_price: 0, insurance_price: 0,
    total_price: roomsPrice + extrasPrice, id_boards: '', id_reservations: 0,
    nights, nights_dates: nightsDates,
    reservation_type: 'web',
    active_id_room_types: String((quote.items[0] && quote.items[0].roomTypeId) || ''),
    preselected_id_rooms: 0,
    reference: quote.quoteId,
    id_contigents: 0,
    date_arrival: quote.checkin, date_departure: quote.checkout,
    ...(channelId ? { id_channels: channelId, channel: channelName } : {}),
    note: `Reserva corporativa desde cotización ${quote.quoteId}. Empresa: ${quote.empresa || ''}. NIT: ${quote.nit || 'N/D'}. Total pagado: ${paidAmount}.${opts.transactionId ? ' ID Transacción ' + providerLabel + ': ' + opts.transactionId : ''}`
  };

  const data = await insertReservation(payload);
  return data.id_reservations || quote.quoteId;
}

module.exports = {
  otasyncCreds, hasOtasyncCreds, getSessionKey, getAvailabilityByType, findUnavailable,
  buildRoomsFromQuote, buildExtrasFromQuote, createHold, releaseHold, createConfirmedReservation
};
