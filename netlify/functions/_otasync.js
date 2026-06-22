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

/* Wraps loginOtasync so a sustained OTASync auth outage raises ONE alert
   (A3, deduped 5 min). Re-throws so callers still fall back / fail as today. */
async function loginOtasyncAlerted() {
  try {
    return await loginOtasync();
  } catch (err) {
    try {
      await require('./_alert').reportAlert({
        kind: 'otasync_auth_down', severity: 'critical',
        message: `No se pudo autenticar contra OTASync: ${err.message}`,
        dedupeKey: 'otasync-auth-down', ttlSec: 300
      });
    } catch (_) { /* best-effort */ }
    throw err;
  }
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
    const pkey = await loginOtasyncAlerted();
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

/* Returns the authoritative pricing for a specific stay from OTASync. This is
   the SAME source-of-truth the cliente sees in /api/check-availability — using
   it server-side in create-booking guarantees the cliente cannot supply an
   arbitrary paidAmount and have it recorded as the booking total.

   Returns { isMock, byRoomType: { '<id>': { avgPrice, totalPrice, dailyPrices,
   available, nights } }, nights }. avgPrice and totalPrice include the extra
   guest surcharge ($31,000/night per person beyond the first). */
const { EXTRA_GUEST_SURCHARGE, PRICE_FALLBACK } = require('./_pricing');

async function getDynamicPricing(checkin, checkout, guests) {
  const nights = nightsBetween(checkin, checkout);
  if (!hasOtasyncCreds()) return { isMock: true, byRoomType: {}, nights };
  const { propertyId } = otasyncCreds();
  const guestsCount = Math.max(1, parseInt(guests) || 1);
  const surcharge = Math.max(0, guestsCount - 1) * EXTRA_GUEST_SURCHARGE;

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
      throw err.name === 'AbortError' ? new Error('Request timeout during pricing lookup') : err;
    }
  };

  const res = await withSessionRetry(makeRequest);
  if (!res.ok) throw new Error(`getRooms (pricing) returned status ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data.rooms)) throw new Error('Invalid getRooms response: expected rooms list');

  const byRoomType = {};
  data.rooms.forEach(otaRoom => {
    const id = String(otaRoom.id_room_types);
    const available = (parseInt(otaRoom.avail) || 0) > 0;
    const dailyPrices = [];
    let totalAmount = 0, count = 0;

    const plan = Array.isArray(otaRoom.pricing_plans) && otaRoom.pricing_plans.length > 0 ? otaRoom.pricing_plans[0] : null;
    if (plan && Array.isArray(plan.prices) && plan.prices.length > 0 && plan.prices[0].prices) {
      const datePrices = plan.prices[0].prices;
      Object.keys(datePrices).forEach(dateStr => {
        const price = parseFloat(datePrices[dateStr]) || 0;
        dailyPrices.push({ date: dateStr, price });
        totalAmount += price;
        count++;
      });
    }

    let avgPrice, totalPrice;
    if (count > 0) {
      avgPrice = Math.round(totalAmount / count) + surcharge;
      totalPrice = avgPrice * nights;
    } else if (otaRoom.price) {
      avgPrice = Math.round(parseFloat(otaRoom.price)) + surcharge;
      totalPrice = avgPrice * nights;
    } else {
      avgPrice = PRICE_FALLBACK + surcharge;
      totalPrice = avgPrice * nights;
    }

    byRoomType[id] = { avgPrice, totalPrice, dailyPrices, available, nights };
  });

  return { isMock: false, byRoomType, nights };
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

/* insertReservation runs AFTER an approved payment: a transient network blip,
   timeout or 5xx here strands the booking in manual-pending. Retry transient
   failures up to 3 attempts total with exponential backoff (1s, 2s). 4xx
   responses are NOT retried — a bad payload won't fix itself. Each attempt
   re-runs the whole withSessionRetry cycle, so expired-session (401) re-logins
   stay handled there without double-wrapping. */
const INSERT_MAX_ATTEMPTS = 3;
const INSERT_BACKOFF_MS = [1000, 2000];
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

  let lastErr = null;
  try {
    for (let attempt = 1; attempt <= INSERT_MAX_ATTEMPTS; attempt++) {
      let res;
      try {
        res = await withSessionRetry(makeRequest);
      } catch (err) {
        /* fetch/network error or timeout — transient, retry with backoff */
        lastErr = err;
        if (attempt === INSERT_MAX_ATTEMPTS) throw lastErr;
        console.warn(`[otasync] insert/reservation attempt ${attempt}/${INSERT_MAX_ATTEMPTS} failed (${err.message}); retrying in ${INSERT_BACKOFF_MS[attempt - 1]}ms`);
        await sleep(INSERT_BACKOFF_MS[attempt - 1]);
        continue;
      }
      if (res.ok) return res.json();
      /* 5xx is a transient server-side failure; anything else (4xx) is final. */
      if (res.status >= 500 && attempt < INSERT_MAX_ATTEMPTS) {
        console.warn(`[otasync] insert/reservation attempt ${attempt}/${INSERT_MAX_ATTEMPTS} returned status ${res.status}; retrying in ${INSERT_BACKOFF_MS[attempt - 1]}ms`);
        await sleep(INSERT_BACKOFF_MS[attempt - 1]);
        continue;
      }
      throw new Error(`insert/reservation returned status ${res.status}`);
    }
    /* Unreachable (the last attempt always returns or throws) — kept for safety. */
    throw lastErr || new Error('insert/reservation failed');
  } catch (err) {
    /* Pago cobrado pero la reserva no se pudo crear: alerta crítica (A3). */
    try {
      await require('./_alert').reportAlert({
        kind: 'otasync_insert_failed', severity: 'critical',
        message: `insert/reservation falló tras ${INSERT_MAX_ATTEMPTS} intentos: ${err.message}`,
        context: { reference: payload && payload.reference, attempts: INSERT_MAX_ATTEMPTS },
        dedupeKey: `otasync-insert-${(payload && payload.reference) || 'unknown'}`
      });
    } catch (_) { /* alerta best-effort */ }
    throw err;
  }
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

/* Cancel a CONFIRMED guest reservation (Mesa Redonda C3 — cerrar el lazo de
   cancelación). Uses the documented reservation/delete/delete endpoint, which
   SOFT-cancels: sets status→canceled + date_canceled and PRESERVES the record
   (correcto para contabilidad/SIRE), a diferencia del delete/reservation que
   usa releaseHold para holds tentativos. Mirrors insertReservation's resilience:
   retries transient/timeout/5xx con backoff (4xx es final), y alerta crítica si
   se agotan los intentos (cancelación pedida pero no aplicada). Idempotente: un
   404 (ya no existe) se resuelve como { ok:true, alreadyGone:true }.
   Returns { ok, status?, alreadyGone?, isMock? }. */
const CANCEL_MAX_ATTEMPTS = 3;
const CANCEL_BACKOFF_MS = [1000, 2000];

async function cancelReservation(idReservations) {
  if (!idReservations) return { ok: false, reason: 'no-id' };
  if (!hasOtasyncCreds()) return { ok: true, isMock: true };
  const { token, propertyId } = otasyncCreds();

  const makeRequest = async (pkey) => {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 10000);
    try {
      const r = await fetch('https://app.otasync.me/api/reservation/delete/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: pkey, token, id_properties: propertyId, id_reservations: idReservations }),
        signal: ctrl.signal
      });
      clearTimeout(tid);
      return r;
    } catch (err) {
      clearTimeout(tid);
      throw err.name === 'AbortError' ? new Error('Request timeout during reservation cancel') : err;
    }
  };

  let lastErr = null;
  try {
    for (let attempt = 1; attempt <= CANCEL_MAX_ATTEMPTS; attempt++) {
      let res;
      try {
        res = await withSessionRetry(makeRequest);
      } catch (err) {
        lastErr = err;
        if (attempt === CANCEL_MAX_ATTEMPTS) throw lastErr;
        console.warn(`[otasync] delete/delete attempt ${attempt}/${CANCEL_MAX_ATTEMPTS} failed (${err.message}); retrying in ${CANCEL_BACKOFF_MS[attempt - 1]}ms`);
        await sleep(CANCEL_BACKOFF_MS[attempt - 1]);
        continue;
      }
      if (res.status === 404) return { ok: true, alreadyGone: true }; /* idempotente */
      if (res.ok) {
        let data = {};
        try { data = await res.json(); } catch (_) { /* tolera respuesta sin cuerpo */ }
        const status = (data && data.reservation && data.reservation.status) || (data && data.status) || 'canceled';
        return { ok: true, status };
      }
      if (res.status >= 500 && attempt < CANCEL_MAX_ATTEMPTS) {
        console.warn(`[otasync] delete/delete attempt ${attempt}/${CANCEL_MAX_ATTEMPTS} returned status ${res.status}; retrying in ${CANCEL_BACKOFF_MS[attempt - 1]}ms`);
        await sleep(CANCEL_BACKOFF_MS[attempt - 1]);
        continue;
      }
      throw new Error(`delete/delete returned status ${res.status}`);
    }
    throw lastErr || new Error('delete/delete failed');
  } catch (err) {
    try {
      await require('./_alert').reportAlert({
        kind: 'otasync_cancel_failed', severity: 'critical',
        message: `delete/delete (cancelación) falló tras ${CANCEL_MAX_ATTEMPTS} intentos: ${err.message}`,
        context: { idReservations, attempts: CANCEL_MAX_ATTEMPTS },
        dedupeKey: `otasync-cancel-${idReservations}`
      });
    } catch (_) { /* alerta best-effort */ }
    throw err;
  }
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

/* ── Guest-app service orders → reservation folio ──────────────────────────
   Posts the extras a guest ordered through the guest app onto their existing
   OTASync/Kunas reservation so the charge shows on the folio at check-out. This
   is what makes the guest app's "cargar a mi cuenta" reach Kunas. Gated by the
   caller (guest-action) behind GUEST_SERVICE_FOLIO_ENABLED + hasOtasyncCreds().
   Endpoints: docs/OTASync-Public-API.md → Extras / New reservations (add_extra). */

/* Small POST helper mirroring the timeout + session-retry boilerplate the rest
   of this module uses. The caller passes the body WITHOUT `key`; we inject the
   live pkey. Throws on non-2xx so callers can log/alert. */
async function otasyncPostJson(path, payload, { timeoutMs = 10000, label = path } = {}) {
  const makeRequest = async (pkey) => {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(`https://app.otasync.me${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, key: pkey }), signal: ctrl.signal
      });
      clearTimeout(tid);
      return r;
    } catch (err) {
      clearTimeout(tid);
      throw err.name === 'AbortError' ? new Error(`Request timeout during ${label}`) : err;
    }
  };
  const res = await withSessionRetry(makeRequest);
  if (!res.ok) throw new Error(`${label} returned status ${res.status}`);
  return res.json();
}

const GUEST_SERVICE_EXTRA_NAME = 'Pedido guest app';
let guestServiceExtraIdCache = null;

async function getExtras() {
  const { token, propertyId } = otasyncCreds();
  const data = await otasyncPostJson('/api/extras/data/extras',
    { token, id_properties: propertyId }, { label: 'extras/data' });
  return Array.isArray(data && data.extras) ? data.extras : [];
}

async function insertExtra({ name, price = 0, tax = 0, type = 'one' }) {
  const { token, propertyId } = otasyncCreds();
  return otasyncPostJson('/api/extras/insert/extra', {
    token, id_properties: propertyId,
    name, price, tax, type,
    description: 'Cargos de servicios pedidos desde la guest app.',
    period_type: 'period', dfrom: '2000-01-01', dto: '2099-12-31',
    id_restriction_plans: 0, use_on_booking_engine: 0,
    rooms: [], specific_rooms: [], image: ''
  }, { label: 'extras/insert' });
}

/* id_extras for the generic "guest app order" line, resolved once and cached.
   Each folio line carries the real service name; this just satisfies OTASync's
   requirement that an extra reference an existing definition. tax:0 so the
   price we send is the final charge (no tax added on top). Override with
   OTASYNC_GUEST_SERVICE_EXTRA_ID to point at a pre-made extra instead. */
async function ensureGuestServiceExtra() {
  if (process.env.OTASYNC_GUEST_SERVICE_EXTRA_ID) {
    return String(process.env.OTASYNC_GUEST_SERVICE_EXTRA_ID);
  }
  if (guestServiceExtraIdCache) return guestServiceExtraIdCache;
  const extras = await getExtras();
  const existing = extras.find(e =>
    String(e && e.name).trim().toLowerCase() === GUEST_SERVICE_EXTRA_NAME.toLowerCase());
  if (existing && existing.id_extras) {
    guestServiceExtraIdCache = String(existing.id_extras);
    return guestServiceExtraIdCache;
  }
  const created = await insertExtra({ name: GUEST_SERVICE_EXTRA_NAME });
  const newId = created && (created.id_extras || created.id);
  if (!newId) throw new Error('Could not resolve id_extras after inserting the guest-app extra');
  guestServiceExtraIdCache = String(newId);
  return guestServiceExtraIdCache;
}

/* The first room of a reservation (add_extra/add_payment attach to a room). */
async function getReservationFirstRoom(idReservations) {
  const { token, propertyId } = otasyncCreds();
  const data = await otasyncPostJson('/api/reservation/data/reservation',
    { token, id_properties: propertyId, id_reservations: String(idReservations) },
    { label: 'reservation/data' });
  const rows = Array.isArray(data && data.guests) ? data.guests : [];
  const withRoom = rows.find(r => r && r.id_reservations_rooms);
  return withRoom ? String(withRoom.id_reservations_rooms) : null;
}

async function addReservationExtra({ idReservations, idReservationsRooms, idExtras, name, pricePerUnit, quantity }) {
  const { token, propertyId } = otasyncCreds();
  return otasyncPostJson('/api/reservation/edit/add_extra', {
    token, id_properties: propertyId, id_reservations: String(idReservations),
    extra: {
      id_reservation_extras: '0',
      id_extras: String(idExtras),
      name: String(name),
      price_per_unit: String(pricePerUnit),
      quantity: String(quantity),
      id_reservations_rooms: String(idReservationsRooms)
    }
  }, { label: 'reservation/add_extra' });
}

/* Records a payment on a reservation (used when a guest-app order is paid online
   — the charge goes on the folio via add_extra, the payment via add_payment, so
   the folio nets out). */
async function addReservationPayment({ idReservations, idReservationsRooms, amount, method = 'card', paymentDate, note }) {
  const { token, propertyId } = otasyncCreds();
  return otasyncPostJson('/api/reservation/edit/add_payment', {
    token, id_properties: propertyId, id_reservations: String(idReservations),
    payment: {
      payment_date: paymentDate || new Date().toISOString().split('T')[0],
      amount: String(amount),
      method: String(method),
      created_advance: 0,
      id_reservations_rooms: String(idReservationsRooms),
      ...(note ? { note: String(note) } : {})
    }
  }, { label: 'reservation/add_payment' });
}

/* Posts a guest-app order onto the reservation folio. Each item becomes an
   add_extra charge; when `payment` is supplied (order paid online) a matching
   add_payment is posted too, so the folio balance nets to zero. Returns a status
   object; throws only on a hard OTASync failure (callers catch so the order —
   already stored — is never lost over a folio hiccup). */
async function postOrderExtrasToFolio({ idReservations, items, payment }) {
  if (!hasOtasyncCreds()) return { posted: false, reason: 'no-creds' };
  if (!idReservations || !Array.isArray(items) || !items.length) {
    return { posted: false, reason: 'no-items' };
  }
  const idReservationsRooms = await getReservationFirstRoom(idReservations);
  if (!idReservationsRooms) return { posted: false, reason: 'no-room' };
  const idExtras = await ensureGuestServiceExtra();
  for (const item of items) {
    await addReservationExtra({
      idReservations, idReservationsRooms, idExtras,
      name: `${item.name} (app)`,
      pricePerUnit: item.unitPrice,
      quantity: item.quantity
    });
  }
  let paymentPosted = false;
  if (payment && Number(payment.amount) > 0) {
    await addReservationPayment({
      idReservations, idReservationsRooms,
      amount: payment.amount, method: payment.method || 'card', note: payment.note
    });
    paymentPosted = true;
  }
  return { posted: true, count: items.length, idExtras, idReservationsRooms, paymentPosted };
}

/* ── Reservations by date (A10 stay emails / breakfast roster) ─────────────
   Reads OTASync "Get reservations" (POST /api/reservation/data/reservations),
   which supports filter_by=date_arrival/date_departure + dfrom/dto + arrivals/
   departures flags. READ-ONLY: never inserts/edits a reservation, never touches
   folio/pago/disponibilidad. Returns normalized rows. */

function inferLang(country) {
  const c = String(country || '').trim().toUpperCase();
  if (!c || c === 'CO' || c === 'COL' || c === 'COLOMBIA') return 'es';
  return 'en';
}

function reservaTieneDesayuno(r) {
  const rooms = (r && Array.isArray(r.rooms)) ? r.rooms : [];
  for (const room of rooms) {
    const nights = Array.isArray(room && room.nights) ? room.nights : [];
    for (const n of nights) {
      if (Number(n && n.breakfast) > 0 || Number(n && n.breakfast_adults) > 0) return true;
    }
  }
  return false;
}

function normalizeReservation(r) {
  r = r || {};
  return {
    idReservations: String(r.id_reservations || ''),
    status: r.status || '',
    guestStatus: r.guest_status || '',
    /* slice to YYYY-MM-DD in case OTASync ever returns a time component
       (the date predicates in send-stay-emails compare exact strings) */
    dateArrival: String(r.date_arrival || '').slice(0, 10),
    dateDeparture: String(r.date_departure || '').slice(0, 10),
    firstName: r.first_name || '',
    lastName: r.last_name || '',
    email: String(r.email || '').trim(),
    phone: r.phone || '',
    country: String(r.country || '').trim(),
    nights: parseInt(r.nights, 10) || 0,
    hasBreakfast: reservaTieneDesayuno(r),
    roomName: (r.rooms && r.rooms[0] && r.rooms[0].name) || '',
    lang: inferLang(r.country)
  };
}

const RESERVATIONS_MAX_PAGES = 20;

async function getReservationsByDate({ filterBy, dfrom, dto, arrivals = 0, departures = 0, status = '0' } = {}) {
  if (!hasOtasyncCreds()) return { reservations: [], isMock: true };
  const { token, propertyId } = otasyncCreds();
  const out = [];
  let page = 1;
  let totalPages = 1;
  do {
    const pageNum = page;
    const makeRequest = async (pkey) => {
      const payload = {
        key: pkey, token, id_properties: propertyId,
        filter_by: filterBy, order_by: filterBy, order_type: 'desc',
        dfrom, dto, arrivals, departures, status,
        multiple_properties: '0', view_type: 'reservations',
        show_rooms: 1, show_nights: 1, page: pageNum,
        channels: [], countries: [], rooms: [], companies: [], contigents: [], pricing_plans: []
      };
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 10000);
      try {
        const r = await fetch('https://app.otasync.me/api/reservation/data/reservations', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload), signal: ctrl.signal
        });
        clearTimeout(tid);
        return r;
      } catch (err) {
        clearTimeout(tid);
        throw err.name === 'AbortError' ? new Error('Request timeout during reservations lookup') : err;
      }
    };
    const res = await withSessionRetry(makeRequest);
    if (!res.ok) throw new Error(`reservations returned status ${res.status}`);
    const data = await res.json();
    const list = Array.isArray(data.reservations) ? data.reservations : [];
    list.forEach(r => out.push(normalizeReservation(r)));
    totalPages = Number(data.total_pages_number) || 1;
    page++;
  } while (page <= totalPages && page <= RESERVATIONS_MAX_PAGES);
  return { reservations: out, isMock: false };
}

module.exports = {
  getReservationsByDate, normalizeReservation, inferLang, reservaTieneDesayuno,
  otasyncCreds, hasOtasyncCreds, getSessionKey, getAvailabilityByType, findUnavailable,
  buildRoomsFromQuote, buildExtrasFromQuote, createHold, releaseHold, cancelReservation, createConfirmedReservation,
  insertReservation,
  getDynamicPricing, EXTRA_GUEST_SURCHARGE,
  getExtras, insertExtra, ensureGuestServiceExtra, getReservationFirstRoom,
  addReservationExtra, addReservationPayment, postOrderExtrasToFolio
};
