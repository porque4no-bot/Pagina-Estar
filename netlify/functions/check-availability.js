const fs = require('fs');
const path = require('path');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limit');

// Helper to load local .env variables if not already set (e.g. running outside Netlify dev)
function loadEnv() {
  if (process.env.NODE_ENV === 'production' || process.env.NETLIFY === 'true') {
    return;
  }
  try {
    const envPath = path.join(__dirname, '../../.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      envContent.split('\n').forEach(line => {
        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (match) {
          const key = match[1];
          let value = match[2] || '';
          if (value.startsWith('"') && value.endsWith('"')) {
            value = value.substring(1, value.length - 1);
          } else if (value.startsWith("'") && value.endsWith("'")) {
            value = value.substring(1, value.length - 1);
          }
          if (!process.env[key]) {
            process.env[key] = value.trim();
          }
        }
      });
    }
  } catch (e) {
    console.error('Failed to load local .env file:', e.message);
  }
}

loadEnv();

// In-memory cache for the authentication session key (pkey)
/* Session key (pkey) shared across functions via Netlify Blobs.
   See _otasync.getSessionKey for the implementation. */
const { getSessionKey: sharedGetSessionKey } = require('./_otasync');

async function getSessionKey(_token, _username, _password) {
  return sharedGetSessionKey();
}

exports.handler = async (event, context) => {
  // CORS Headers
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  const corsHeaders = {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  if (allowedOrigin && allowedOrigin !== '*') {
    corsHeaders['Access-Control-Allow-Origin'] = allowedOrigin;
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  const limited = await checkRateLimit(event, { name: 'check-availability', limit: 30, windowMs: 60 * 1000 });
  if (!limited.ok) return rateLimitResponse(corsHeaders, limited.retryAfter);

  // Parse parameters (supports both query string and POST body)
  let checkin = '';
  let checkout = '';
  let guests = 1;

  if (event.httpMethod === 'POST' && event.body) {
    const MAX_BODY_SIZE = 10000; // 10 KB
    if (event.body && event.body.length > MAX_BODY_SIZE) {
      return { statusCode: 413, body: JSON.stringify({ error: 'Payload too large' }) };
    }
    try {
      const body = JSON.parse(event.body);
      checkin = body.checkin;
      checkout = body.checkout;
      guests = parseInt(body.guests) || 1;
    } catch (e) {
      // fallback to query parameters
    }
  }

  if (!checkin || !checkout) {
    const qs = event.queryStringParameters || {};
    checkin = qs.checkin;
    checkout = qs.checkout;
    guests = parseInt(qs.guests) || 1;
  }

  if (!checkin || !checkout) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing checkin or checkout parameters' })
    };
  }

  const checkinDate = new Date(checkin);
  const checkoutDate = new Date(checkout);
  if (Number.isNaN(checkinDate.getTime()) || Number.isNaN(checkoutDate.getTime())) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid date format' }) };
  }

  if (checkinDate >= checkoutDate) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Check-in must be before check-out' }) };
  }

  if (guests < 1 || guests > 10) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Guests must be between 1 and 10' }) };
  }

  // Calculate number of nights
  const diffTime = checkoutDate - checkinDate;
  const nights = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

  // Read environment variables
  const token = process.env.OTASYNC_TOKEN || '';
  const username = process.env.OTASYNC_USERNAME || '';
  const password = process.env.OTASYNC_PASSWORD || '';
  const propertyId = process.env.OTASYNC_PROPERTY_ID || '9889';

  const hasCredentials = token && username && password;

  // ROOM DETAILS (Load from rooms_db.json file)
  let roomDetails = {};
  try {
    const dbPath = path.join(__dirname, '../../rooms_db.json');
    if (fs.existsSync(dbPath)) {
      roomDetails = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    }
  } catch (dbErr) {
    console.error('Failed to load rooms_db.json database:', dbErr.message);
  }

  // 1. MOCK DATA FALLBACK (If no credentials are set in Environment)
  if (!hasCredentials) {
    if (process.env.NETLIFY) {
      console.error('check-availability: OTASync credentials missing in production environment');
      return {
        statusCode: 503,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Service temporarily unavailable. Missing configuration.' })
      };
    }

    const extraGuestSurchargeMock = Math.max(0, guests - 1) * 31000;
    const mockRooms = Object.keys(roomDetails).map(id => {
      const details = roomDetails[id];
      const mockPrice = 195000 + extraGuestSurchargeMock;
      const totalPrice = mockPrice * nights;

      // Calculate daily price details
      const dailyPrices = [];
      for (let i = 0; i < nights; i++) {
        const d = new Date(checkinDate);
        d.setDate(d.getDate() + i);
        const dateStr = d.toISOString().split('T')[0];
        dailyPrices.push({
          date: dateStr,
          price: mockPrice
        });
      }

      return {
        id_room_types: id,
        name: details.name,
        sub: details.sub,
        description: details.description,
        capacity: details.capacity,
        beds: details.beds,
        area: details.area,
        view: details.view,
        image: details.image,
        gallery: details.gallery,
        available: guests <= details.capacity,
        totalPrice: totalPrice,
        avgPrice: mockPrice,
        nights: nights,
        dailyPrices: dailyPrices,
        currency: 'COP'
      };
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        rooms: mockRooms,
        isMock: true,
        note: 'fallback: OTASYNC_USERNAME or OTASYNC_PASSWORD is missing in server configuration'
      })
    };
  }

  // 2. REAL OTASYNC INTEGRATION
  try {
    const pkey = await getSessionKey(token, username, password);

    const payload = {
      key: pkey,
      dfrom: checkin,
      dto: checkout,
      currency: "COP",
      id_language: "es",
      guests: [
        {
          guest_filter_id: 1,
          adults: guests,
          children: 0,
          children_age: []
        }
      ],
      id_properties: propertyId
    };

    const getRoomsController = new AbortController();
    const getRoomsTimeoutId = setTimeout(() => getRoomsController.abort(), 10000);
    let response;
    try {
      response = await fetch('https://app.otasync.me/api/engine/data/getRooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: getRoomsController.signal
      });
      clearTimeout(getRoomsTimeoutId);
    } catch (err) {
      clearTimeout(getRoomsTimeoutId);
      if (err.name === 'AbortError') {
        return { statusCode: 504, body: JSON.stringify({ error: 'Request timeout' }) };
      }
      throw err;
    }

    if (!response.ok) {
      throw new Error(`Kunas API returned status ${response.status}`);
    }

    const otaData = await response.json();
    const otaRooms = otaData.rooms;
    
    if (!Array.isArray(otaRooms)) {
      throw new Error('Invalid response from Kunas API: expected rooms list');
    }

    // Map Kunas response to Estar format
    const rooms = otaRooms.map(otaRoom => {
      const id = String(otaRoom.id_room_types);
      const details = roomDetails[id] || {
        name: otaRoom.name,
        sub: "Habitación de Hotel Estar",
        description: otaRoom.description || "Disfruta de tu estadía en Manizales.",
        capacity: parseInt(otaRoom.occupancy) || 2,
        beds: "1 cama",
        area: otaRoom.area ? `${otaRoom.area} m²` : "30 m²",
        view: "Ciudad",
        image: "assets/photos/tipo1/1.webp",
        gallery: ["assets/photos/tipo1/1.webp"]
      };

      // Check room availability (avail is the units count)
      const isAvailable = (parseInt(otaRoom.avail) || 0) > 0;

      // Extract daily prices from the first pricing plan if present
      const dailyPrices = [];
      let totalAmount = 0;
      let count = 0;

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

      // If we didn't find any specific prices, fallback to average/total price on the room object or details
      let avgPrice = 0;
      let totalPrice = 0;

      // Additional guest surcharge: $31,000/night per person beyond the first
      const extraGuestSurcharge = Math.max(0, guests - 1) * 31000;

      if (count > 0) {
        avgPrice = totalAmount / count + extraGuestSurcharge;
        totalPrice = avgPrice * nights;
      } else if (otaRoom.price) {
        avgPrice = parseFloat(otaRoom.price) + extraGuestSurcharge;
        totalPrice = avgPrice * nights;

        // Populate dummy daily prices for display consistency
        for (let i = 0; i < nights; i++) {
          const d = new Date(checkinDate);
          d.setDate(d.getDate() + i);
          const dateStr = d.toISOString().split('T')[0];
          dailyPrices.push({ date: dateStr, price: avgPrice });
        }
      } else {
        avgPrice = 195000 + extraGuestSurcharge;
        totalPrice = avgPrice * nights;
        
        for (let i = 0; i < nights; i++) {
          const d = new Date(checkinDate);
          d.setDate(d.getDate() + i);
          const dateStr = d.toISOString().split('T')[0];
          dailyPrices.push({ date: dateStr, price: avgPrice });
        }
      }

      return {
        id_room_types: id,
        name: details.name,
        sub: details.sub,
        description: details.description,
        capacity: details.capacity,
        beds: details.beds,
        area: details.area,
        view: details.view,
        image: details.image,
        gallery: details.gallery,
        available: isAvailable && (guests <= details.capacity),
        totalPrice: totalPrice,
        avgPrice: avgPrice,
        nights: nights,
        dailyPrices: dailyPrices,
        currency: 'COP'
      };
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ rooms, isMock: false })
    };

  } catch (error) {
    console.error('Kunas Integration Error:', error.message);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to retrieve availability',
        message: 'An unexpected error occurred while retrieving availability. Please try again later.'
      })
    };
  }
};
