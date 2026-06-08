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

  // 1. List all room types for the property
  try {
    const r = await fetch('https://app.otasync.me/api/room/data/roomTypes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(base)
    });
    results.room_types_list = { status: r.status, body: await r.json().catch(() => r.text()) };
  } catch (e) {
    results.room_types_list = { error: e.message };
  }

  // 2. Full detail for each known room type
  const roomTypeIds = ['31348', '31349', '31350', '31351', '31352'];
  results.room_types_detail = {};
  for (const rtId of roomTypeIds) {
    try {
      const r = await fetch('https://app.otasync.me/api/room/data/roomType', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...base, id_room_types: parseInt(rtId) })
      });
      results.room_types_detail[rtId] = { status: r.status, body: await r.json().catch(() => r.text()) };
    } catch (e) {
      results.room_types_detail[rtId] = { error: e.message };
    }
  }

  // 3. Room types with their individual rooms (units)
  try {
    const r = await fetch('https://app.otasync.me/api/room/data/roomTypesWithRooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(base)
    });
    results.room_types_with_rooms = { status: r.status, body: await r.json().catch(() => r.text()) };
  } catch (e) {
    results.room_types_with_rooms = { error: e.message };
  }

  // 4. Pricing plans for the property
  try {
    const r = await fetch('https://app.otasync.me/api/pricingplans/data/pricingplans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(base)
    });
    results.pricing_plans = { status: r.status, body: await r.json().catch(() => r.text()) };
  } catch (e) {
    results.pricing_plans = { error: e.message };
  }

  // 5. Current prices for each room type (next 7 days)
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const inWeek = new Date(); inWeek.setDate(inWeek.getDate() + 8);
  const fmt = d => d.toISOString().split('T')[0];

  results.room_prices = {};
  for (const rtId of roomTypeIds) {
    try {
      const r = await fetch('https://app.otasync.me/api/prices/data/prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...base, id_room_types: parseInt(rtId), dfrom: fmt(tomorrow), dto: fmt(inWeek) })
      });
      results.room_prices[rtId] = { status: r.status, body: await r.json().catch(() => r.text()) };
    } catch (e) {
      results.room_prices[rtId] = { error: e.message };
    }
  }

  return { statusCode: 200, headers, body: JSON.stringify(results, null, 2) };
};
