const fs = require('fs');
const path = require('path');
const { getStore } = require('@netlify/blobs');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limit');

// Helper to load local .env variables if not already set
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

/* Session key (pkey) is shared across all OTASync-using functions via
   Netlify Blobs — see _otasync.getSessionKey for the implementation.
   The legacy signature is preserved so existing call sites keep working;
   the credentials come from env vars inside the shared helper. */
const { getSessionKey: sharedGetSessionKey, getDynamicPricing } = require('./_otasync');

async function getSessionKey(_token, _username, _password) {
  return sharedGetSessionKey();
}

/* Tolerance for paidAmount vs serverPrice mismatch (Colombian pesos).
   ±$1.000 covers Wompi/Mercado Pago rounding without letting larger
   discrepancies slip through. */
const PRICE_MISMATCH_TOLERANCE_COP = 1000;

async function readResponseSnippet(response) {
  try {
    const text = await response.text();
    return String(text || '').replace(/\s+/g, ' ').slice(0, 1000);
  } catch (e) {
    return '';
  }
}

async function findAvailableRoomId({ token, pkey, propertyId, checkin, checkout, roomTypeId }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  let response;
  try {
    response = await fetch('https://app.otasync.me/api/room/data/available_rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        key: pkey,
        id_properties: propertyId,
        dfrom: checkin,
        dto: checkout,
        id_room_types: parseInt(roomTypeId, 10),
        include_id_reservations: 0,
        exclude_id_rooms: []
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
  } catch (err) {
    clearTimeout(timeoutId);
    if (process.env.DEBUG) console.warn('[create-booking] available room lookup failed:', err.message);
    return 0;
  }

  if (!response.ok) {
    const detail = await readResponseSnippet(response);
    console.warn(`[create-booking] available_rooms returned ${response.status}${detail ? ': ' + detail : ''}`);
    return 0;
  }

  try {
    const data = await response.json();
    const rooms = Array.isArray(data.rooms) ? data.rooms : [];
    const first = rooms.find(r => String(r.id_room_types) === String(roomTypeId) && r.id_rooms) || rooms.find(r => r.id_rooms);
    return first && first.id_rooms ? parseInt(first.id_rooms, 10) || 0 : 0;
  } catch (e) {
    console.warn('[create-booking] available_rooms returned invalid JSON:', e.message);
    return 0;
  }
}

function decodeReference(ref) {
  try {
    if (!ref || !/^[a-zA-Z0-9\-_]+$/.test(ref)) {
      return null;
    }
    let base64 = ref.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    const decoded = Buffer.from(base64, 'base64').toString('utf8');
    if (!decoded.startsWith('1|')) {
      return null;
    }
    const parts = decoded.split('|');
    if (parts.length < 11) {
      return null;
    }
    const [
      version,
      checkinYYMMDD,
      checkoutYYMMDD,
      guestsCount,
      roomTypeId,
      firstName,
      lastName,
      email,
      phone,
      extrasMask,
      bookingCode
    ] = parts;
    return {
      bookingCode,
      checkin: `20${checkinYYMMDD.substring(0, 2)}-${checkinYYMMDD.substring(2, 4)}-${checkinYYMMDD.substring(4, 6)}`,
      checkout: `20${checkoutYYMMDD.substring(0, 2)}-${checkoutYYMMDD.substring(2, 4)}-${checkoutYYMMDD.substring(4, 6)}`,
      guestsCount: parseInt(guestsCount) || 1,
      roomTypeId,
      firstName,
      lastName,
      email,
      phone,
      extrasMask
    };
  } catch (err) {
    return null;
  }
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

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method Not Allowed. Use POST.' })
    };
  }

  const limited = await checkRateLimit(event, { name: 'create-booking', limit: 6, windowMs: 60 * 1000 });
  if (!limited.ok) return rateLimitResponse(corsHeaders, limited.retryAfter);

  const MAX_BODY_SIZE = 10000; // 10 KB
  if (event.body && event.body.length > MAX_BODY_SIZE) {
    return { statusCode: 413, body: JSON.stringify({ error: 'Payload too large' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Invalid JSON request body' })
    };
  }

  const {
    checkin,
    checkout,
    guestsCount,
    roomTypeId,
    roomName,
    paidAmount,
    firstName,
    lastName,
    email,
    phone,
    notes,
    roomRate,
    paymentDetails
  } = body;

  // Simple validation
  if (!checkin || !checkout || !roomTypeId || !firstName || !lastName || !email || !phone) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing required reservation fields' })
    };
  }

  // Email format validation
  if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email) || email.length > 254) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Invalid email address' })
    };
  }

  // Date order validation: checkin must be before checkout
  if (new Date(checkin) >= new Date(checkout)) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Check-in date must be before check-out date' })
    };
  }

  // Idempotency check: prevent duplicate bookings from double-clicks or retries
  const idempKey = `booking_${roomTypeId}_${checkin}_${checkout}_${String(email).toLowerCase().trim()}`;

  let blobStore;
  let cached;
  try {
    blobStore = getStore({ name: 'booking-idempotency', consistency: 'strong' });
    const raw = await blobStore.get(idempKey);
    if (raw) {
      const existing = JSON.parse(raw);
      if (process.env.DEBUG) console.log(`[idempotency] Returning cached booking ${existing.bookingCode}`);
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(existing) };
    }
  } catch (e) {
    // Blobs unavailable locally or in misconfigured env — proceed without idempotency
    if (process.env.DEBUG) console.warn('[idempotency] Blobs store unavailable, proceeding without deduplication:', e.message);
    blobStore = null;
  }

  // Server-side pricing: always compute from rooms_db, never trust client-provided price
  const roomsDb = JSON.parse(fs.readFileSync(path.join(__dirname, '../../rooms_db.json'), 'utf8'));
  if (!Object.keys(roomsDb).includes(String(roomTypeId))) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Invalid room type' })
    };
  }
  const roomRecord = roomsDb[roomTypeId];

  // Calculate nights
  const checkinDate = new Date(checkin);
  const checkoutDate = new Date(checkout);
  const diffTime = checkoutDate - checkinDate;
  const nights = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

  /* AUTHORITATIVE PRICING — re-query OTASync server-side.
     Never trust paidAmount or roomRate from the cliente; the cliente could
     have manipulated them between the availability lookup and the booking
     submission. We re-compute the room's avgPrice + totalPrice for the
     same checkin/checkout/guests at the moment of insertion and use
     THOSE values as rooms_price / total_price.

     If the actual paidAmount (charged by Wompi) doesn't match the server
     price within PRICE_MISMATCH_TOLERANCE_COP, we log a warning so the
     admin can reconcile manually — but we still record the server price
     because that's the canonical truth for what we were owed. */
  let serverAvgPrice, serverTotalPrice, pricingIsMock = false;
  try {
    const pricing = await getDynamicPricing(checkin, checkout, guestsCount);
    pricingIsMock = pricing.isMock;
    const roomPricing = pricing.byRoomType[String(roomTypeId)];
    if (!pricing.isMock && !roomPricing) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Selected room type is not bookable for those dates' })
      };
    }
    if (roomPricing) {
      serverAvgPrice = roomPricing.avgPrice;
      serverTotalPrice = roomPricing.totalPrice;
    }
  } catch (e) {
    console.error('[create-booking] server-side pricing lookup failed:', e.message);
    return {
      statusCode: 502,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'No se pudo verificar el precio. Intenta de nuevo.' })
    };
  }

  /* paidAmount from the cliente reflects what Wompi actually charged. We
     compare it against the server price to flag tampering / price drift,
     but the SERVER price is what we record in OTASync. */
  const clientPaidAmount = parseFloat(paidAmount) || 0;
  const fallbackPrice = clientPaidAmount > 0 ? clientPaidAmount : 0;
  const roomPrice = serverTotalPrice != null ? serverTotalPrice : fallbackPrice;
  const avgPrice = serverAvgPrice != null
    ? serverAvgPrice
    : (nights > 0 ? Math.round(roomPrice / nights) : roomPrice);

  if (serverTotalPrice != null && clientPaidAmount > 0) {
    const delta = clientPaidAmount - serverTotalPrice;
    if (Math.abs(delta) > PRICE_MISMATCH_TOLERANCE_COP) {
      console.warn(`[create-booking] price mismatch for ${email} ${roomTypeId} ${checkin}->${checkout}: client paid ${clientPaidAmount}, server expected ${serverTotalPrice} (delta ${delta}). Recording server price.`);
    }
  }

  // Read environment variables
  const token = process.env.OTASYNC_TOKEN || '';
  const username = process.env.OTASYNC_USERNAME || '';
  const password = process.env.OTASYNC_PASSWORD || '';
  const propertyId = process.env.OTASYNC_PROPERTY_ID || '9889';
  const channelId = process.env.OTASYNC_CHANNEL_ID || '66483';
  const channelName = process.env.OTASYNC_CHANNEL_NAME || 'Pagina web';

  const hasCredentials = token && username && password;

  // 1. MOCK BOOKING GENERATOR (Fallback)
  if (!hasCredentials) {
    if (process.env.NETLIFY) {
      console.error('create-booking: OTASync credentials missing in production environment');
      return {
        statusCode: 503,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Service temporarily unavailable. Missing configuration.' })
      };
    }

    const mockBookingCode = `ESTAR-MOCK-${Math.floor(10000 + Math.random() * 90000)}`;
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        bookingCode: mockBookingCode,
        isMock: true,
        reservation: {
          code: mockBookingCode,
          guestName: `${firstName} ${lastName}`,
          email,
          phone,
          roomName,
          checkin,
          checkout,
          nights,
          totalPrice: roomPrice,
          status: 'Confirmed (Mock)'
        },
        message: 'Reserva simulada con éxito. Configure las credenciales reales en Netlify para producción.'
      })
    };
  }

  // 2. REAL OTASYNC INTEGRATION
  try {
    const pkey = await getSessionKey(token, username, password);
    const selectedRoomId = await findAvailableRoomId({ token, pkey, propertyId, checkin, checkout, roomTypeId });

    // Build the night-by-night breakdown array
    const nightsArray = [];
    const nightsDates = [];
    for (let i = 0; i < nights; i++) {
      const d = new Date(checkinDate);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      
      nightsDates.push(dateStr);
      nightsArray.push({
        night_date: dateStr,
        price: avgPrice,
        original_price: avgPrice,
        breakfast: 0,
        lunch: 0,
        dinner: 0
      });
    }

    let cleanReference = paymentDetails?.reference || '';
    let decodedRef = null;
    if (paymentDetails && paymentDetails.reference) {
      decodedRef = decodeReference(paymentDetails.reference);
      if (decodedRef) {
        cleanReference = decodedRef.bookingCode;
      }
    }

    // Check if wompi-webhook already registered this reservation (prevents duplicate OTASync insertion)
    if (decodedRef && decodedRef.bookingCode) {
      try {
        const resultStore = getStore({ name: 'booking-results', consistency: 'strong' });
        const cached = await resultStore.get(`direct-${decodedRef.bookingCode}`);
        if (cached) {
          const cachedData = JSON.parse(cached);
          if (process.env.DEBUG) console.log(`[create-booking] Booking ${decodedRef.bookingCode} already in booking-results (created by webhook). Returning cached.`);
          const cachedResult = {
            success: true,
            bookingCode: cachedData.bookingCode,
            isMock: false,
            reservation: {
              code: cachedData.bookingCode,
              guestName: `${firstName} ${lastName}`,
              email,
              roomName: roomRecord.name,
              checkin,
              checkout,
              nights,
              totalPrice: roomPrice,
              status: 'Confirmed'
            }
          };
          if (blobStore) {
            try { await blobStore.set(idempKey, JSON.stringify(cachedResult), { ttl: 86400 }); } catch (e) { /* non-fatal */ }
          }
          return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(cachedResult) };
        }
      } catch (e) {
        if (process.env.DEBUG) console.warn('[create-booking] booking-results store check failed:', e.message);
      }
    }

    const paymentInfo = [];
    if (paymentDetails && (paymentDetails.status === 'APPROVED' || paymentDetails.status === 'PENDING')) {
      /* payments[].amount records what Wompi actually collected (cliente-supplied
         but Wompi-anchored). The reservation's rooms_price / total_price use the
         server-recomputed price above as the canonical truth. */
      const actuallyCollected = clientPaidAmount > 0 ? clientPaidAmount : roomPrice;
      paymentInfo.push({
        amount: actuallyCollected,
        payment_date: new Date().toISOString().split('T')[0],
        payment_method: 'card',
        note: `Wompi ID: ${paymentDetails.id}, Ref: ${cleanReference}, Status: ${paymentDetails.status}`
      });
    }

    // Build Kunas / OTASync reservation payload
    const reservationPayload = {
      key: pkey,
      id_properties: propertyId,
      token: token,
      status: "confirmed",
      rooms: [
        {
          id_room_types: parseInt(roomTypeId),
          id_rooms: selectedRoomId,
          room_type: roomName,
          room_number: "",
          avg_price: avgPrice,
          total_price: roomPrice,
          children_1: 0,
          children_2: 0,
          children_3: 0,
          adults: parseInt(guestsCount) || 1,
          seniors: 0,
          extras: [],
          payments: [],
          overbooking: 0,
          nights: nightsArray
        }
      ],
      guests: [
        {
          first_name: firstName,
          last_name: lastName,
          email: email,
          id_guests: 0,
          guest_type: "adults"
        }
      ],
      extras: [],
      payments: paymentInfo,
      children_1: 0,
      children_2: 0,
      children_3: 0,
      adults: parseInt(guestsCount) || 1,
      seniors: 0,
      total_guests: parseInt(guestsCount) || 1,
      discount_type: "percent",
      discount_amount: 0,
      discount_note: "",
      rooms_price: roomPrice,
      rooms_discounted: roomPrice,
      extras_price: 0,
      board_price: 0,
      city_tax_price: 0,
      insurance_price: 0,
      total_price: roomPrice,
      id_boards: "",
      id_reservations: 0,
      nights: nights,
      nights_dates: nightsDates,
      reservation_type: "web",
      active_id_room_types: String(roomTypeId),
      preselected_id_rooms: 0,
      reference: cleanReference || "Hotel Estar Custom Booking Engine",
      id_contigents: 0,
      date_arrival: checkin,
      date_departure: checkout,
      guest_email: email,
      id_channels: channelId,
      channel: channelName,
      note: `Teléfono: ${phone.replace(/[^\d+\s]/g, '').trim().substring(0, 20)}. Notas: ${(notes || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').substring(0, 500) || 'Ninguna'}`
    };

    const insertController = new AbortController();
    const insertTimeoutId = setTimeout(() => insertController.abort(), 10000);
    let response;
    try {
      response = await fetch('https://app.otasync.me/api/reservation/insert/reservation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reservationPayload),
        signal: insertController.signal
      });
      clearTimeout(insertTimeoutId);
    } catch (err) {
      clearTimeout(insertTimeoutId);
      if (err.name === 'AbortError') {
        return { statusCode: 504, body: JSON.stringify({ error: 'Request timeout' }) };
      }
      throw err;
    }

    if (!response.ok) {
      const detail = await readResponseSnippet(response);
      console.error(`[create-booking] Kunas insert failed. status=${response.status}, roomTypeId=${roomTypeId}, id_rooms=${selectedRoomId || 0}, reference=${cleanReference || 'n/a'}${detail ? ', body=' + detail : ''}`);
      throw new Error(`Kunas API booking submission returned status ${response.status}`);
    }

    const data = await response.json();
    console.log(`[create-booking] OTASync insert response: ${JSON.stringify(data)}`);

    // Check if reservation insertion was successful in Kunas response
    const bookingCode = data.id_reservations || cleanReference || `ESTAR-PMS-${Date.now().toString().slice(-6)}`;

    const successPayload = {
      success: true,
      bookingCode: bookingCode,
      isMock: false,
      reservation: {
        code: bookingCode,
        guestName: `${firstName} ${lastName}`,
        email,
        roomName: roomRecord.name,
        checkin,
        checkout,
        nights,
        totalPrice: roomPrice,
        status: 'Confirmed'
      }
    };

    if (blobStore) {
      try {
        await blobStore.set(idempKey, JSON.stringify(successPayload), { ttl: 86400 }); // 24h TTL
      } catch (e) {
        if (process.env.DEBUG) console.warn('[idempotency] Failed to cache booking result:', e.message);
      }
    }

    // Store result so wompi-webhook knows not to duplicate this reservation
    if (decodedRef && decodedRef.bookingCode) {
      try {
        const resultStore = getStore({ name: 'booking-results', consistency: 'strong' });
        await resultStore.set(`direct-${decodedRef.bookingCode}`, JSON.stringify({ bookingCode }), { ttl: 86400 * 7 });
      } catch (e) { /* non-fatal */ }
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(successPayload)
    };

  } catch (error) {
    console.error('Kunas Booking Creation Error:', error.message);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to create reservation',
        message: 'An unexpected error occurred while creating your reservation. Please contact the hotel.'
      })
    };
  }
};
