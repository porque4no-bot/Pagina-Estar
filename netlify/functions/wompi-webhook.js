const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Helper to load local .env variables if not already set (e.g. local development)
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
let sessionCache = {
  pkey: null,
  expiresAt: null
};

// In-memory simple processed transaction ID deduplicator (warm instances)
const processedTransactionIds = new Set();

// Helper to get session key from Kunas PMS
async function getSessionKey(token, username, password) {
  const now = Date.now();
  if (sessionCache.pkey && sessionCache.expiresAt && sessionCache.expiresAt > now) {
    return sessionCache.pkey;
  }

  const response = await fetch('https://app.otasync.me/api/user/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, username, password, remember: 0 })
  });

  if (!response.ok) {
    throw new Error(`Authentication failed with status ${response.status}`);
  }

  const data = await response.json();
  if (!data.pkey) {
    throw new Error('Authentication response did not contain a session key (pkey)');
  }

  // Cache session key for 30 minutes
  sessionCache.pkey = data.pkey;
  sessionCache.expiresAt = now + 30 * 60 * 1000;
  return data.pkey;
}

// Sanitize phone: only digits, +, spaces
function sanitizePhone(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw.replace(/[^\d+\s]/g, '').trim().substring(0, 20);
}

// Escape HTML special characters to prevent XSS in PMS notes
function escapeHtml(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeNotes(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return escapeHtml(raw).substring(0, 500);
}

// Helper to decode the URL-safe base64 reference string
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
      extrasMask,
      // Optional flags encoded at positions 11 and 12
      isColombian: parts[11] === '1' ? true : parts[11] === '0' ? false : undefined,
      isBusiness:  parts[12] === '1' ? true : parts[12] === '0' ? false : undefined
    };
  } catch (err) {
    console.error("Error decoding reference:", err.message);
    return null;
  }
}

// Helper to obfuscate base64 references for logs
function obfuscateReference(ref) {
  if (!ref || typeof ref !== 'string') return '';
  return ref.length > 8 ? `${ref.substring(0, 4)}...${ref.substring(ref.length - 4)}` : '***';
}

exports.handler = async (event, context) => {
  // CORS Headers
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  const corsHeaders = {
    'Access-Control-Allow-Headers': 'Content-Type, X-Event-Checksum',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  if (allowedOrigin) {
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

  // Wompi Signature Verification — MANDATORY
  const receivedSignature = event.headers['x-event-checksum'] || (body.signature && body.signature.checksum);
  const WOMPI_WEBHOOK_SECRET = process.env.WOMPI_WEBHOOK_SECRET;

  if (!WOMPI_WEBHOOK_SECRET) {
    console.error('CRITICAL: WOMPI_WEBHOOK_SECRET is not configured. Rejecting webhook.');
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Webhook secret not configured on server' })
    };
  }

  if (!body.signature || !body.signature.properties || !receivedSignature) {
    console.error("Wompi signature verification failed: signature, properties, or checksum is missing.");
    return {
      statusCode: 401,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Unauthorized. Missing signature components.' })
    };
  }

  try {
    const properties = body.signature.properties;
    let dataToSign = "";
    properties.forEach(prop => {
      const keys = prop.split('.');
      let value = body.data;
      keys.forEach(k => {
        if (value) value = value[k];
      });
      dataToSign += value;
    });

    dataToSign += body.timestamp;
    dataToSign += WOMPI_WEBHOOK_SECRET;

    const expectedSignature = crypto
      .createHash('sha256')
      .update(dataToSign)
      .digest('hex');

    if (receivedSignature !== expectedSignature) {
      console.error("Wompi signature verification failed");
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Unauthorized. Invalid signature.' })
      };
    }
    console.log("Wompi signature successfully verified");
  } catch (sigErr) {
    console.error("Error verifying Wompi signature:", sigErr.message);
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Signature verification processing error' })
    };
  }

  const { event: eventName, data } = body;
  
  if (eventName !== 'transaction.updated') {
    console.log(`Ignoring unsupported Wompi event: ${eventName}`);
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ message: `Event ${eventName} ignored` })
    };
  }

  const transaction = data && data.transaction;
  if (!transaction) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing transaction data' })
    };
  }

  console.log(`Processing Wompi webhook: transaction.id=${transaction.id}, reference=${obfuscateReference(transaction.reference)}, status=${transaction.status}`);

  if (transaction.status === 'DECLINED' || transaction.status === 'VOIDED' || transaction.status === 'ERROR') {
    const failedDecoded = decodeReference(transaction.reference);
    const bookingCodeForLog = failedDecoded ? failedDecoded.bookingCode : transaction.reference;
    console.error(`FAILED PAYMENT — status=${transaction.status}, transactionId=${transaction.id}, bookingCode=${bookingCodeForLog}, amount_cents=${transaction.amount_in_cents}, reference=${obfuscateReference(transaction.reference)}. Manual follow-up required.`);
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ message: `Transaction ${transaction.status}. Logged for manual follow-up.` })
    };
  }

  if (transaction.status !== 'APPROVED') {
    console.log(`Transaction status is not APPROVED: ${transaction.status}. Skipping PMS insertion.`);
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ message: `Transaction status is ${transaction.status}. Skipping.` })
    };
  }

  // Check simple in-memory deduplication
  if (processedTransactionIds.has(transaction.id)) {
    console.log(`Transaction ${transaction.id} was already processed by this container. Skipping duplicate PMS insertion.`);
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Transaction already processed (duplicate)' })
    };
  }

  // Decode the reservation details from the transaction reference
  const decoded = decodeReference(transaction.reference);
  if (!decoded) {
    console.warn(`Wompi transaction reference ${obfuscateReference(transaction.reference)} is not a valid encoded reservation. Skipping PMS insertion.`);
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Reference was not an encoded reservation payload' })
    };
  }

  processedTransactionIds.add(transaction.id);

  // Kunas Credentials from Environment
  const token = process.env.OTASYNC_TOKEN || '';
  const username = process.env.OTASYNC_USERNAME || '';
  const password = process.env.OTASYNC_PASSWORD || '';
  const propertyId = process.env.OTASYNC_PROPERTY_ID || '9889';

  const hasCredentials = token && username && password;
  if (!hasCredentials) {
    console.warn("Kunas credentials not configured. Simulating successful webhook insertion.");
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Mock booking confirmed. Credentials missing on Netlify.',
        bookingCode: decoded.bookingCode
      })
    };
  }

  try {
    const pkey = await getSessionKey(token, username, password);

    // Calculate dates & nights
    const checkinDate = new Date(decoded.checkin);
    const checkoutDate = new Date(decoded.checkout);
    const diffTime = checkoutDate - checkinDate;
    const nights = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

    // Load rooms_db.json to lookup Room Name by roomTypeId
    let roomDetails = {};
    try {
      const dbPath = path.join(__dirname, '../../rooms_db.json');
      if (fs.existsSync(dbPath)) {
        roomDetails = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
      }
    } catch (dbErr) {
      console.error('Failed to load rooms_db.json database:', dbErr.message);
    }

    const matchedRoom = roomDetails[decoded.roomTypeId];
    const roomName = matchedRoom ? matchedRoom.name : 'Clásica';

    // pricing math: paidAmount = Wompi paid amount (subtotal without IVA)
    const paidAmount = transaction.amount_in_cents / 100;
    
    // Determine IVA: use flags encoded in reference first (set by front-end),
    // then fall back to phone heuristic to match front-end logic exactly.
    let mustPayIva;
    if (decoded.isColombian !== undefined || decoded.isBusiness !== undefined) {
      mustPayIva = !!(decoded.isColombian || decoded.isBusiness);
    } else {
      const cleanPhone = sanitizePhone(decoded.phone).replace(/\s+/g, '');
      mustPayIva = cleanPhone.startsWith('+57') || cleanPhone.startsWith('57') || (cleanPhone.length === 10 && cleanPhone.startsWith('3'));
    }

    const roomPrice = mustPayIva ? Math.round(paidAmount * 1.19) : paidAmount;
    const avgPrice = Math.round(roomPrice / nights);

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

    const paymentInfo = [{
      amount: paidAmount,
      date_payment: new Date().toISOString().split('T')[0],
      payment_method: 'card',
      note: `Wompi ID: ${transaction.id}, Ref: ${decoded.bookingCode}, Status: APPROVED`
    }];

    // Map extras from extrasMask
    // BE_EXTRAS: desayuno, parqueadero, late, early, traslado, tour
    const extrasList = [];
    const extraNames = ['Desayuno', 'Parqueadero', 'Late Check-out', 'Early Check-in', 'Traslado Aeropuerto', 'Tour Manizales'];
    for (let i = 0; i < 6; i++) {
      if (decoded.extrasMask[i] === '1') {
        extrasList.push(extraNames[i]);
      }
    }
    const extrasText = extrasList.length > 0 ? extrasList.join(', ') : 'Ninguno';

    // Build Kunas / OTASync reservation payload
    const reservationPayload = {
      key: pkey,
      id_properties: propertyId,
      token: token,
      status: "confirmed",
      rooms: [
        {
          id_room_types: parseInt(decoded.roomTypeId),
          id_rooms: 0, // Auto-assign room in Kunas
          room_type: roomName,
          room_number: "",
          avg_price: avgPrice,
          total_price: roomPrice,
          children_1: 0,
          children_2: 0,
          children_3: 0,
          adults: decoded.guestsCount || 1,
          seniors: 0,
          extras: [],
          payments: paymentInfo,
          overbooking: 0,
          nights: nightsArray
        }
      ],
      guests: [
        {
          first_name: decoded.firstName,
          last_name: decoded.lastName,
          id_guests: 0,
          guest_type: "adults"
        }
      ],
      extras: [],
      payments: paymentInfo,
      children_1: 0,
      children_2: 0,
      children_3: 0,
      adults: decoded.guestsCount || 1,
      seniors: 0,
      total_guests: decoded.guestsCount || 1,
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
      active_id_room_types: String(decoded.roomTypeId),
      preselected_id_rooms: 0,
      reference: decoded.bookingCode || "Hotel Estar Custom Booking Engine",
      id_contigents: 0,
      date_arrival: decoded.checkin,
      date_departure: decoded.checkout,
      id_channels: "392", // Default channel ID for private/direct reservations
      channel: "Private reservation",
      note: `Teléfono del huésped: ${sanitizePhone(decoded.phone)}. Extras: ${escapeHtml(extrasText)}. IVA (19%): ${mustPayIva ? 'POR COBRAR EN HOTEL (' + Math.round(paidAmount * 0.19) + ')' : 'EXENTO'}. Creado por Webhook Wompi. ID Transacción: ${transaction.id}`
    };

    const response = await fetch('https://app.otasync.me/api/reservation/insert/reservation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reservationPayload)
    });

    if (!response.ok) {
      throw new Error(`Kunas API booking submission returned status ${response.status}`);
    }

    const data = await response.json();
    console.log("Kunas API webhook insertion successful, reservation ID:", data.id_reservations || decoded.bookingCode);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        bookingCode: data.id_reservations || decoded.bookingCode
      })
    };
  } catch (err) {
    console.error("Error creating booking in Kunas from webhook:", err.message);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to create booking in PMS',
        message: 'An unexpected error occurred while processing the webhook.'
      })
    };
  }
};
