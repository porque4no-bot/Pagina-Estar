const fs = require('fs');
const path = require('path');

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

// In-memory cache for the authentication session key (pkey), matching check-availability.js pattern
let sessionCache = {
  pkey: null,
  expiresAt: null
};

/**
 * Authenticate with OTASync/Kunas and return a session key (pkey).
 * Caches the key for 30 minutes to avoid redundant auth requests.
 */
async function getSessionKey(token, username, password) {
  const now = Date.now();
  if (sessionCache.pkey && sessionCache.expiresAt && sessionCache.expiresAt > now) {
    return sessionCache.pkey;
  }

  const authController = new AbortController();
  const authTimeoutId = setTimeout(() => authController.abort(), 10000);
  let authResponse;
  try {
    authResponse = await fetch('https://app.otasync.me/api/user/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, username, password, remember: 0 }),
      signal: authController.signal
    });
    clearTimeout(authTimeoutId);
  } catch (err) {
    clearTimeout(authTimeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Request timeout during authentication');
    }
    throw err;
  }

  if (!authResponse.ok) {
    throw new Error(`Authentication failed with status ${authResponse.status}`);
  }

  const data = await authResponse.json();
  if (!data.pkey) {
    throw new Error('Authentication response did not contain a session key (pkey)');
  }

  // Cache the session key for 30 minutes
  sessionCache.pkey = data.pkey;
  sessionCache.expiresAt = now + 30 * 60 * 1000;
  return data.pkey;
}

/**
 * Calculates the number of nights between two ISO date strings.
 */
function calcNights(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 0;
  const a = new Date(checkIn);
  const b = new Date(checkOut);
  return Math.max(0, Math.ceil((b - a) / (1000 * 60 * 60 * 24)));
}

/**
 * Normalizes a Kunas/OTASync reservation response into Estar's standard format.
 * Adjust field names here if the OTASync API shape changes.
 */
function normalizeReservation(raw) {
  // OTASync reservation fields (adjust based on actual API response):
  const room = Array.isArray(raw.rooms) && raw.rooms.length > 0 ? raw.rooms[0] : {};
  const guest = Array.isArray(raw.guests) && raw.guests.length > 0 ? raw.guests[0] : {};

  const checkIn = raw.date_arrival || raw.checkin || '';
  const checkOut = raw.date_departure || raw.checkout || '';
  const nights = calcNights(checkIn, checkOut);
  const totalAmount = parseFloat(raw.total_price || raw.rooms_price || 0);

  // Map Kunas status values to a readable string
  const statusMap = {
    confirmed: 'confirmed',
    pending: 'pending',
    cancelled: 'cancelled',
    checked_in: 'checked_in',
    checked_out: 'checked_out',
    no_show: 'no_show'
  };
  const rawStatus = (raw.status || '').toLowerCase();
  const status = statusMap[rawStatus] || rawStatus || 'confirmed';

  // A booking can be cancelled only if it's confirmed/pending
  const canCancel = status === 'confirmed' || status === 'pending';

  return {
    found: true,
    bookingCode: String(raw.id_reservations || raw.reference || ''),
    status,
    guestName: `${guest.first_name || ''} ${guest.last_name || ''}`.trim(),
    roomName: room.room_type || room.name || '',
    checkIn,
    checkOut,
    nights,
    totalAmount,
    canCancel
  };
}

exports.handler = async (event, context) => {
  // CORS Headers
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  const corsHeaders = {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  if (allowedOrigin) {
    corsHeaders['Access-Control-Allow-Origin'] = allowedOrigin;
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method Not Allowed. Use GET.' })
    };
  }

  // Extract booking code from query string: ?code=EST-XXXXX
  const params = event.queryStringParameters || {};
  const bookingCode = (params.code || '').trim();

  if (!bookingCode) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing required query param: code' })
    };
  }

  // Read OTASync credentials from environment
  const token = process.env.OTASYNC_TOKEN || '';
  const username = process.env.OTASYNC_USERNAME || '';
  const password = process.env.OTASYNC_PASSWORD || '';
  const propertyId = process.env.OTASYNC_PROPERTY_ID || '9889';

  const hasCredentials = token && username && password;

  // If no credentials are configured, return a mock "not found" so the UI
  // can guide the guest to contact the hotel. This avoids silent failure.
  if (!hasCredentials) {
    console.warn('[get-booking] OTASync credentials not configured. Returning not-found fallback.');
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        found: false,
        reason: 'PMS credentials not configured on this environment'
      })
    };
  }

  try {
    const pkey = await getSessionKey(token, username, password);

    // TODO: confirmar endpoint de búsqueda con Kunas.
    // OTASync no documenta públicamente un endpoint de búsqueda por código de reserva.
    // Los endpoints conocidos son:
    //   POST /api/reservation/insert/reservation  → crear reserva
    //   POST /api/engine/data/getRooms             → disponibilidad
    //
    // Candidatos más probables (a confirmar con soporte de OTASync/Kunas):
    //   GET  /api/reservation/get/reservation?key=PKEY&id_reservations=ID
    //   POST /api/reservation/search  con { key, token, id_properties, id_reservations }
    //
    // Se usa el patrón más conservador observado en create-booking.js:
    const searchPayload = {
      key: pkey,
      token: token,
      id_properties: propertyId,
      // Pass the booking code both as a numeric ID (if numeric) and as a reference string
      id_reservations: parseInt(bookingCode, 10) || 0,
      reference: bookingCode
    };

    // TODO: confirmar endpoint de búsqueda con Kunas
    const getController = new AbortController();
    const getTimeoutId = setTimeout(() => getController.abort(), 10000);
    let response;
    try {
      response = await fetch('https://app.otasync.me/api/reservation/get/reservation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(searchPayload),
        signal: getController.signal
      });
      clearTimeout(getTimeoutId);
    } catch (err) {
      clearTimeout(getTimeoutId);
      if (err.name === 'AbortError') {
        return { statusCode: 504, body: JSON.stringify({ error: 'Request timeout' }) };
      }
      throw err;
    }

    // If the PMS returns 404 or a similar "not found" status
    if (response.status === 404) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ found: false })
      };
    }

    if (!response.ok) {
      throw new Error(`Kunas API returned status ${response.status} when looking up booking ${bookingCode}`);
    }

    const data = await response.json();

    // OTASync may return an empty object or null when the reservation is not found
    if (!data || !data.id_reservations) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ found: false })
      };
    }

    const normalized = normalizeReservation(data);
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(normalized)
    };

  } catch (error) {
    console.error('[get-booking] Error looking up reservation:', error.message);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to retrieve booking from PMS',
        message: 'An unexpected error occurred while retrieving the booking.'
      })
    };
  }
};
