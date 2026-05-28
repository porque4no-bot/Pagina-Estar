/* Shared OTASync/Kunas access: session auth + availability lookup.
   Used by create-quote, update-quote and the scheduled revalidation job
   so the auth + getRooms logic lives in one place. */

let sessionCache = { pkey: null, expiresAt: null, promise: null };

function otasyncCreds() {
  return {
    token: process.env.OTASYNC_TOKEN || '',
    username: process.env.OTASYNC_USERNAME || '',
    password: process.env.OTASYNC_PASSWORD || '',
    propertyId: process.env.OTASYNC_PROPERTY_ID || '9889'
  };
}

function hasOtasyncCreds() {
  const c = otasyncCreds();
  return !!(c.token && c.username && c.password);
}

async function getSessionKey() {
  const { token, username, password } = otasyncCreds();
  const now = Date.now();
  if (sessionCache.pkey && sessionCache.expiresAt && sessionCache.expiresAt > now) {
    return sessionCache.pkey;
  }
  if (sessionCache.promise) {
    try { return await sessionCache.promise; }
    catch (e) { sessionCache.promise = null; }
  }

  sessionCache.promise = (async () => {
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
    sessionCache.pkey = data.pkey;
    sessionCache.expiresAt = Date.now() + 30 * 60 * 1000;
    return data.pkey;
  })();

  try { return await sessionCache.promise; }
  finally { sessionCache.promise = null; }
}

/* Returns available units per room type id for the given stay.
   { availByType: { '31348': 3, ... }, isMock: boolean }
   When credentials are missing returns isMock:true and an empty map so
   callers can decide to skip the availability gate locally. */
async function getAvailabilityByType(checkin, checkout) {
  if (!hasOtasyncCreds()) return { availByType: {}, isMock: true };

  const { propertyId } = otasyncCreds();
  const pkey = await getSessionKey();

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
  let res;
  try {
    res = await fetch('https://app.otasync.me/api/engine/data/getRooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
    clearTimeout(tid);
  } catch (err) {
    clearTimeout(tid);
    throw err.name === 'AbortError' ? new Error('Request timeout during availability lookup') : err;
  }
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

module.exports = {
  hasOtasyncCreds, getSessionKey, getAvailabilityByType, findUnavailable
};
