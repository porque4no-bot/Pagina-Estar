require('./_env');

// In-memory rate limiter: max 15 requests per IP per minute
const getBookingRateLimit = new Map(); // ip -> [timestamps]

// In-memory cache for the authentication session key (pkey), matching check-availability.js pattern
/* Session key (pkey) shared across functions via Netlify Blobs.
   See _otasync.getSessionKey for the implementation. */
const { getSessionKey: sharedGetSessionKey } = require('./_otasync');

async function getSessionKey(_token, _username, _password) {
  return sharedGetSessionKey();
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
    guestLastName: String(guest.last_name || ''),
    guestEmail: String(guest.email || guest.mail || raw.guest_email || raw.email || ''),
    roomName: room.room_type || room.name || '',
    checkIn,
    checkOut,
    nights,
    totalAmount,
    canCancel
  };
}

/* Normalize for last-name comparison: strip accents, lowercase, collapse to
   single spaces. Used to require the booking code AND the full surname as a
   second factor, so a guessed/enumerated code alone never reveals PII (A-1/A-2). */
function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/* Second-factor check. The reservation is disclosed only when the caller
   proves knowledge of the booking email OR the guest surname — never the code
   alone (A-1/A-2). Email match is exact (case-insensitive); surname match
   mirrors guest-session (full last name or a token >= 3 chars) so two-surname
   guests who type only one surname still pass. */
function identityMatches(reservation, providedFactor) {
  const candidate = normalizeName(providedFactor);
  if (!candidate || candidate.length < 2) return false;

  // Email match (the manage-booking form already collects the email).
  const email = String(reservation.guestEmail || '').trim().toLowerCase();
  if (email && email === String(providedFactor || '').trim().toLowerCase()) return true;

  // Surname match.
  const lastName = normalizeName(reservation.guestLastName);
  const tokens = (lastName || normalizeName(reservation.guestName)).split(' ').filter(Boolean);
  if (lastName && lastName === candidate) return true;
  if (tokens.includes(candidate) && candidate.length >= 3) return true;
  const candidateTokens = candidate.split(' ').filter(Boolean);
  if (candidateTokens.length > 1 && lastName) {
    const set = new Set(tokens);
    return candidateTokens.every(tok => set.has(tok));
  }
  return false;
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

  // Rate limiting: max 15 requests per IP per minute
  const clientIp = event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
                   event.headers['x-nf-client-connection-ip'] || 'unknown';
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  const maxRequests = 15;

  const timestamps = (getBookingRateLimit.get(clientIp) || []).filter(t => now - t < windowMs);
  if (timestamps.length >= maxRequests) {
    return {
      statusCode: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': '60',
        'X-RateLimit-Limit': String(maxRequests),
        'X-RateLimit-Remaining': '0'
      },
      body: JSON.stringify({ error: 'Rate limit exceeded. Please try again in a minute.' })
    };
  }
  timestamps.push(now);
  getBookingRateLimit.set(clientIp, timestamps);

  // Cleanup stale entries
  if (getBookingRateLimit.size > 1000) {
    for (const [ip, ts] of getBookingRateLimit) {
      if (ts.every(t => now - t > windowMs)) getBookingRateLimit.delete(ip);
    }
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method Not Allowed. Use GET.' })
    };
  }

  // Extract booking code + surname (second factor) from the query string:
  // ?code=EST-XXXXX&apellido=<lastName>. The surname is mandatory so an
  // enumerated code alone can never disclose guest PII (A-1/A-2).
  const params = event.queryStringParameters || {};
  const bookingCode = (params.code || '').trim();
  /* Second factor: email (preferred, collected by the manage-booking form) or
     surname. Either one is accepted. */
  const providedFactor = (params.email || params.apellido || params.lastName || params.lastname || '').trim();

  if (!bookingCode) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing required query param: code' })
    };
  }

  if (!providedFactor) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing required query param: email or apellido' })
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
    if (process.env.DEBUG) console.warn('[get-booking] OTASync credentials not configured. Returning not-found fallback.');
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

    const searchPayload = {
      key: pkey,
      token: token,
      id_properties: propertyId,
      id_reservations: String(bookingCode)
    };

    const getController = new AbortController();
    const getTimeoutId = setTimeout(() => getController.abort(), 10000);
    let response;
    try {
      response = await fetch('https://app.otasync.me/api/reservation/data/reservation', {
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

    /* Second-factor gate: the surname must match. On mismatch we return the
       SAME "not found" shape as a missing reservation so an attacker cannot
       distinguish "wrong surname" from "no such code" (no enumeration oracle). */
    if (!identityMatches(normalized, providedFactor)) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ found: false })
      };
    }

    // Do not echo internal-only comparison fields back to the client.
    delete normalized.guestLastName;
    delete normalized.guestEmail;
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

exports._test = { identityMatches, normalizeName };
/* Shared with request-cancellation so both endpoints apply the exact same
   second-factor gate and reservation normalization. */
exports.helpers = { identityMatches, normalizeName, normalizeReservation, calcNights };
