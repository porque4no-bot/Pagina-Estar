const { getSessionKey, otasyncCreds } = require('./_otasync');

async function call(url, body) {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await r.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: r.status, body: parsed };
  } catch (e) {
    return { error: e.message };
  }
}

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

  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const inWeek = new Date(); inWeek.setDate(inWeek.getDate() + 8);
  const fmt = d => d.toISOString().split('T')[0];

  // 1. List all room types
  results.room_types_list = await call('https://app.otasync.me/api/room/data/roomTypes', base);

  // 2. Detail for each known room type (try both singular and plural endpoint names)
  const roomTypeIds = ['31348', '31349', '31350', '31351', '31352'];
  results.room_type_detail = {};
  for (const rtId of roomTypeIds) {
    results.room_type_detail[rtId] = await call(
      'https://app.otasync.me/api/room/data/roomType',
      { ...base, id_room_types: parseInt(rtId) }
    );
  }

  // 3. Room types with physical units
  results.room_types_with_rooms = await call(
    'https://app.otasync.me/api/room/data/roomTypesWithRooms', base
  );

  // 4. Pricing plans
  results.pricing_plans = await call(
    'https://app.otasync.me/api/pricingplans/data/pricingplans', base
  );

  // 5. Current prices per room type (next 7 days) — try two possible endpoint patterns
  results.room_prices = {};
  for (const rtId of roomTypeIds) {
    const r1 = await call('https://app.otasync.me/api/prices/data/prices', {
      ...base, id_room_types: parseInt(rtId), dfrom: fmt(tomorrow), dto: fmt(inWeek)
    });
    const r2 = r1.status !== 200
      ? await call('https://app.otasync.me/api/room/data/roomTypePrices', {
          ...base, id_room_types: parseInt(rtId), dfrom: fmt(tomorrow), dto: fmt(inWeek)
        })
      : null;
    results.room_prices[rtId] = r2 || r1;
  }

  // 6. Restrictions
  results.restrictions = await call(
    'https://app.otasync.me/api/restrictions/data/restrictions',
    { ...base, dfrom: fmt(tomorrow), dto: fmt(inWeek) }
  );

  return { statusCode: 200, headers, body: JSON.stringify(results, null, 2) };
};
