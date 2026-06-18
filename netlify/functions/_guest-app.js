require('./_env');
const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

let sessionCache = { pkey: null, expiresAt: 0, promise: null };

function corsHeaders() {
  const headers = {
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8'
  };
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin && allowedOrigin !== '*') {
    headers['Access-Control-Allow-Origin'] = allowedOrigin;
  }
  return headers;
}

function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { ...corsHeaders(), ...headers },
    body: JSON.stringify(body)
  };
}

function parseJsonBody(event, maxBytes = 20000) {
  const body = event.body || '';
  const size = Buffer.byteLength(body, event.isBase64Encoded ? 'base64' : 'utf8');
  if (size > maxBytes) {
    const error = new Error('Payload too large');
    error.statusCode = 413;
    throw error;
  }
  const decoded = event.isBase64Encoded
    ? Buffer.from(body, 'base64').toString('utf8')
    : body;
  try {
    return JSON.parse(decoded || '{}');
  } catch (error) {
    const invalid = new Error('Invalid JSON request body');
    invalid.statusCode = 400;
    throw invalid;
  }
}

function isDemoMode() {
  if (process.env.GUEST_APP_DEMO_MODE === 'true') return true;
  return process.env.NETLIFY !== 'true' && process.env.NODE_ENV !== 'production';
}

function otasyncCreds() {
  return {
    token: process.env.OTASYNC_TOKEN || '',
    username: process.env.OTASYNC_USERNAME || '',
    password: process.env.OTASYNC_PASSWORD || '',
    propertyId: process.env.OTASYNC_PROPERTY_ID || '9889'
  };
}

function hasOtasyncCreds() {
  const creds = otasyncCreds();
  return Boolean(creds.token && creds.username && creds.password);
}

async function getOtasyncSessionKey() {
  const now = Date.now();
  if (sessionCache.pkey && sessionCache.expiresAt > now) return sessionCache.pkey;
  if (sessionCache.promise) return sessionCache.promise;

  const { token, username, password } = otasyncCreds();
  sessionCache.promise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch('https://app.otasync.me/api/user/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, username, password, remember: 0 }),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`OTASync authentication returned ${response.status}`);
      const data = await response.json();
      if (!data.pkey) throw new Error('OTASync authentication did not return pkey');
      sessionCache.pkey = data.pkey;
      sessionCache.expiresAt = Date.now() + 30 * 60 * 1000;
      return data.pkey;
    } finally {
      clearTimeout(timeout);
      sessionCache.promise = null;
    }
  })();

  return sessionCache.promise;
}

async function fetchOtasyncReservation(bookingCode) {
  const { token, propertyId } = otasyncCreds();
  const key = await getOtasyncSessionKey();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch('https://app.otasync.me/api/reservation/data/reservation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key,
        token,
        id_properties: propertyId,
        id_reservations: String(bookingCode)
      }),
      signal: controller.signal
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`OTASync reservation lookup returned ${response.status}`);
    const data = await response.json();
    return data && data.id_reservations ? data : null;
  } finally {
    clearTimeout(timeout);
  }
}

function calcNights(checkIn, checkOut) {
  const start = new Date(checkIn);
  const end = new Date(checkOut);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(0, Math.ceil((end - start) / 86400000));
}

function primaryGuest(raw) {
  if (Array.isArray(raw && raw.guests) && raw.guests.length) return raw.guests[0];
  const room = Array.isArray(raw && raw.rooms) ? raw.rooms[0] : null;
  if (room && Array.isArray(room.guests) && room.guests.length) return room.guests[0];
  return {};
}

function normalizeReservation(raw) {
  const guest = primaryGuest(raw);
  const room = Array.isArray(raw.rooms) && raw.rooms.length ? raw.rooms[0] : {};
  const checkIn = raw.date_arrival || raw.checkin || '';
  const checkOut = raw.date_departure || raw.checkout || '';
  const status = String(raw.status || 'confirmed').toLowerCase();
  return {
    bookingCode: String(raw.id_reservations || raw.reference || ''),
    status,
    guestName: `${guest.first_name || ''} ${guest.last_name || ''}`.trim(),
    guestLastName: String(guest.last_name || ''),
    guestEmail: String(guest.email || guest.mail || raw.email || ''),
    roomName: room.room_type || room.name || 'Apartaestudio',
    roomNumber: room.room_number || room.name || '',
    capacity: Number(raw.total_guests || raw.adults || 1) || 1,
    checkIn,
    checkOut,
    nights: calcNights(checkIn, checkOut),
    totalAmount: Number(raw.total_price || raw.rooms_price || 0),
    canCancel: ['confirmed', 'pending'].includes(status),
    canModify: ['confirmed', 'pending'].includes(status)
  };
}

function demoReservation(bookingCode, accessKey) {
  const checkInDate = new Date();
  checkInDate.setDate(checkInDate.getDate() + 12);
  const checkOutDate = new Date(checkInDate);
  checkOutDate.setDate(checkOutDate.getDate() + 4);
  const iso = date => date.toISOString().slice(0, 10);
  return {
    bookingCode: bookingCode || 'EST-DEMO-2026',
    status: 'confirmed',
    guestName: `Andrea ${accessKey || 'Restrepo'}`.trim(),
    guestLastName: accessKey || 'Restrepo',
    guestEmail: 'huesped@example.com',
    roomName: 'Apartaestudio Selección',
    roomNumber: '402',
    capacity: 2,
    checkIn: iso(checkInDate),
    checkOut: iso(checkOutDate),
    nights: 4,
    totalAmount: 1280000,
    canCancel: true,
    canModify: true,
    demo: true
  };
}

async function getReservation(bookingCode, accessKey) {
  if (hasOtasyncCreds()) {
    const raw = await fetchOtasyncReservation(bookingCode);
    return raw ? normalizeReservation(raw) : null;
  }
  if (isDemoMode()) return demoReservation(bookingCode, accessKey);
  const error = new Error('Guest app PMS credentials are not configured');
  error.statusCode = 503;
  throw error;
}

/* Like getReservation but also attaches the raw OTASync payload (`.raw`) so the
   breakfast layer can read per-night / extras flags that the normalized shape
   drops. Used only by the authenticated staff breakfast panel, so it skips the
   guest second-factor (accessKey is optional, for demo naming only). */
async function getReservationDetail(bookingCode, accessKey) {
  if (hasOtasyncCreds()) {
    const raw = await fetchOtasyncReservation(bookingCode);
    if (!raw) return null;
    const booking = normalizeReservation(raw);
    booking.raw = raw;
    return booking;
  }
  if (isDemoMode()) return demoReservation(bookingCode, accessKey);
  const error = new Error('Guest app PMS credentials are not configured');
  error.statusCode = 503;
  throw error;
}

function normalizeComparable(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9@.]+/g, ' ')
    .trim();
}

function matchesAccessKey(booking, accessKey) {
  const candidate = normalizeComparable(accessKey);
  if (!candidate || candidate.length < 2) return false;
  const lastName = normalizeComparable(booking.guestLastName);
  if (lastName) {
    return lastName === candidate || lastName.split(' ').includes(candidate);
  }
  const nameParts = normalizeComparable(booking.guestName).split(/\s+/).filter(Boolean);
  const inferredLastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
  if (inferredLastName && inferredLastName === candidate) return true;
  const email = normalizeComparable(booking.guestEmail);
  return email && email === candidate;
}

function tokenSecret() {
  const configured = process.env.GUEST_APP_TOKEN_SECRET || '';
  if (configured) return configured;
  if (isDemoMode()) return 'estar-guest-app-local-development-secret';
  const error = new Error('GUEST_APP_TOKEN_SECRET is not configured');
  error.statusCode = 503;
  throw error;
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function signGuestToken(booking, ttlSeconds = 24 * 60 * 60) {
  /* nights + totalAmount are signed in so guest-action can price the
     %-of-night services (late/early check-out) server-side WITHOUT trusting a
     client-supplied amount. They are the booking's average paid night base
     (totalAmount / nights). Absent on pre-existing tokens; guest-action rejects
     %-of-night orders when they are missing (tokens roll over within 24h). */
  const payload = {
    sub: booking.bookingCode,
    guest: booking.guestName,
    capacity: booking.capacity,
    nights: Number(booking.nights) || 0,
    totalAmount: Number(booking.totalAmount) || 0,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds
  };
  const encoded = base64url(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', tokenSecret())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyGuestToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;
  const expected = crypto
    .createHmac('sha256', tokenSecret())
    .update(encoded)
    .digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload.sub || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (error) {
    return null;
  }
}

function guestTokenFromEvent(event) {
  const headers = event.headers || {};
  const auth = headers.authorization || headers.Authorization || '';
  const match = String(auth).match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

function requireGuest(event) {
  const payload = verifyGuestToken(guestTokenFromEvent(event));
  if (!payload) {
    const error = new Error('Guest session is invalid or expired');
    error.statusCode = 401;
    throw error;
  }
  return payload;
}

function guestStore(name, consistency = 'strong') {
  const options = { name, consistency };
  const siteID = process.env.BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) {
    options.siteID = siteID;
    options.token = token;
  }
  return getStore(options);
}

function encryptionKey() {
  const raw = process.env.GUEST_APP_DATA_ENCRYPTION_KEY || '';
  if (raw) return crypto.createHash('sha256').update(raw).digest();
  if (isDemoMode()) return null;
  const error = new Error('GUEST_APP_DATA_ENCRYPTION_KEY is not configured');
  error.statusCode = 503;
  throw error;
}

function protectRecord(record) {
  const key = encryptionKey();
  if (!key) return { encrypted: false, ...record };
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(record), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encrypted: true,
    version: 1,
    algorithm: 'aes-256-gcm',
    createdAt: record.createdAt,
    bookingCode: record.bookingCode,
    type: record.type,
    id: record.checkinId || record.eventId,
    iv: iv.toString('base64url'),
    tag: tag.toString('base64url'),
    data: ciphertext.toString('base64url')
  };
}

function cleanText(value, max = 500) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

async function postWebhook(url, payload, secret) {
  if (!url) return { configured: false, delivered: false };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (secret) headers.Authorization = `Bearer ${secret}`;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Webhook returned ${response.status}`);
    return { configured: true, delivered: true };
  } catch (error) {
    console.error('[guest-app] Webhook delivery failed:', error.message);
    return { configured: true, delivered: false, error: error.message };
  } finally {
    clearTimeout(timeout);
  }
}

async function syncGuestEvent(eventRecord) {
  return postWebhook(
    process.env.GUEST_APP_SYNC_WEBHOOK_URL,
    eventRecord,
    process.env.GUEST_APP_SYNC_WEBHOOK_SECRET
  );
}

async function archiveGuestPayload(payload) {
  return postWebhook(
    process.env.GUEST_APP_DRIVE_WEBHOOK_URL,
    payload,
    process.env.GUEST_APP_DRIVE_WEBHOOK_SECRET
  );
}

module.exports = {
  archiveGuestPayload,
  cleanText,
  corsHeaders,
  getReservation,
  getReservationDetail,
  guestStore,
  isDemoMode,
  json,
  matchesAccessKey,
  parseJsonBody,
  protectRecord,
  requireGuest,
  signGuestToken,
  syncGuestEvent
};
