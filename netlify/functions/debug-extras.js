const { getSessionKey, otasyncCreds } = require('./_otasync');

exports.handler = async () => {
  const { token, propertyId } = otasyncCreds();
  const headers = { 'Content-Type': 'application/json' };

  let pkey;
  try {
    pkey = await getSessionKey();
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Auth failed: ' + e.message }) };
  }

  const base = { token, key: pkey, id_properties: propertyId };
  const results = {};

  // 1. Try to list all extras
  try {
    const r = await fetch('https://app.otasync.me/api/extras/data/extras', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(base)
    });
    results.extras_list = { status: r.status, body: await r.json().catch(() => r.text()) };
  } catch (e) {
    results.extras_list = { error: e.message };
  }

  // 2. Try room types to get their IDs (needed for prices_per_person)
  try {
    const r = await fetch('https://app.otasync.me/api/room/data/roomTypes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(base)
    });
    results.room_types = { status: r.status, body: await r.json().catch(() => r.text()) };
  } catch (e) {
    results.room_types = { error: e.message };
  }

  // 3. prices_per_person via available_rooms for each known room type
  const roomTypeIds = ['31348', '31349', '31350', '31351', '31352'];
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfter = new Date(); dayAfter.setDate(dayAfter.getDate() + 2);
  const fmt = d => d.toISOString().split('T')[0];

  results.prices_per_person = {};
  for (const rtId of roomTypeIds) {
    try {
      const r = await fetch('https://app.otasync.me/api/room/data/available_rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...base, dfrom: fmt(tomorrow), dto: fmt(dayAfter), id_room_types: parseInt(rtId) })
      });
      const body = await r.json().catch(() => r.text());
      results.prices_per_person[rtId] = {
        status: r.status,
        prices_per_person: body.prices_per_person,
        children_prices: body.children_prices
      };
    } catch (e) {
      results.prices_per_person[rtId] = { error: e.message };
    }
  }

  // 4. Try getRooms (booking engine) to see if extras come in that response
  try {
    const r = await fetch('https://app.otasync.me/api/engine/data/getRooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: pkey,
        dfrom: fmt(tomorrow),
        dto: fmt(dayAfter),
        currency: 'COP',
        id_language: 'es',
        guests: [{ guest_filter_id: 1, adults: 2, children: 0, children_age: [] }],
        id_properties: propertyId
      })
    });
    const body = await r.json().catch(() => r.text());
    // Only return the fields relevant to extras/person pricing, not the full price list
    if (body && Array.isArray(body.rooms)) {
      results.get_rooms_extras = body.rooms.map(rm => ({
        id_room_types: rm.id_room_types,
        name: rm.name,
        occupancy: rm.occupancy,
        extras: rm.extras,
        prices_per_person: rm.prices_per_person,
        additional_guest: rm.additional_guest
      }));
    } else {
      results.get_rooms_extras = { status: r.status, body };
    }
  } catch (e) {
    results.get_rooms_extras = { error: e.message };
  }

  return { statusCode: 200, headers, body: JSON.stringify(results, null, 2) };
};
