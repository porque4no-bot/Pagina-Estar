const crypto = require('crypto');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limit');
const { renderContractHTML } = require('./_contract-template');
const {
  archiveGuestPayload: _archiveGuestPayload,
  cleanText,
  corsHeaders,
  guestStore: _guestStore,
  json,
  parseJsonBody,
  protectRecord: _protectRecord,
  requireGuest: _requireGuest,
  syncGuestEvent: _syncGuestEvent
} = require('./_guest-app');

/* Pinned contract template version. Bump whenever the contract clause text
   in _contract-template.js or _pdf-render.js changes; the contractHash for
   each signed event reflects the text that was rendered, so prior audit
   records stay bound to what the guest actually saw. */
const CURRENT_CONTRACT_VERSION = 'ESTAR-HOSPEDAJE-2026-01';

function extractClientIp(event) {
  /* Mirrors _rate-limit.clientIp ordering. Netlify sets
     x-nf-client-connection-ip for the real client; x-forwarded-for can
     contain a chain — first hop is the originating client. */
  const headers = event.headers || {};
  const raw =
    headers['x-nf-client-connection-ip'] ||
    headers['client-ip'] ||
    headers['x-forwarded-for'] ||
    headers['X-Forwarded-For'] ||
    '';
  return String(raw).split(',')[0].trim().slice(0, 64) || 'unknown';
}

function extractUserAgent(event) {
  const headers = event.headers || {};
  const ua = headers['user-agent'] || headers['User-Agent'] || '';
  return cleanText(ua, 400);
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

const defaultDeps = {
  archiveGuestPayload: _archiveGuestPayload,
  guestStore: _guestStore,
  protectRecord: _protectRecord,
  requireGuest: _requireGuest,
  syncGuestEvent: _syncGuestEvent
};
const deps = { ...defaultDeps };

exports._test = {
  setDeps(overrides = {}) { Object.assign(deps, overrides); },
  resetDeps() { Object.assign(deps, defaultDeps); },
  extractClientIp,
  extractUserAgent,
  sha256Hex,
  CURRENT_CONTRACT_VERSION
};

const SERVICE_CATALOG = {
  breakfast: { name: 'Desayuno local', price: 28000 },
  parking: { name: 'Parqueadero por noche', price: 25000 },
  laundry: { name: 'Lavandería express', price: 35000 },
  late_checkout: { name: 'Late check-out', price: 80000 },
  airport_transfer: { name: 'Traslado aeropuerto', price: 120000 },
  city_experience: { name: 'Experiencia cafetera', price: 95000 }
};

function sanitizeItems(items) {
  return (Array.isArray(items) ? items : []).slice(0, 20).map(item => {
    const service = SERVICE_CATALOG[item.id];
    if (!service) return null;
    const quantity = Math.max(1, Math.min(10, parseInt(item.quantity, 10) || 1));
    return {
      id: item.id,
      name: service.name,
      quantity,
      unitPrice: service.price,
      subtotal: service.price * quantity
    };
  }).filter(Boolean);
}

function sanitizeContractGuests(guests) {
  const sanitizedGuests = (Array.isArray(guests) ? guests : []).slice(0, 5).map(entry => {
    const guest = entry && entry.guest ? entry.guest : entry;
    return {
      firstName: cleanText(guest && guest.firstName, 100),
      lastName: cleanText(guest && guest.lastName, 100),
      documentType: cleanText(guest && guest.documentType, 60),
      documentNumber: cleanText(guest && guest.documentNumber, 80),
      nationality: cleanText(guest && guest.nationality, 80),
      birthDate: cleanText(guest && guest.birthDate, 20),
      email: cleanText(guest && guest.email, 254),
      phone: cleanText(guest && guest.phone, 50),
      isPrimary: Boolean(entry && entry.isPrimary)
    };
  }).filter(guest => guest.firstName || guest.lastName || guest.documentNumber);
  const primaryIndex = sanitizedGuests.findIndex(guest => guest.isPrimary);
  return sanitizedGuests.map((guest, index) => ({
    ...guest,
    isPrimary: index === (primaryIndex >= 0 ? primaryIndex : 0)
  }));
}

function buildEvent(type, body, session, event) {
  const eventId = `GST-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const base = {
    eventId,
    type,
    bookingCode: session.sub,
    guestName: session.guest,
    status: 'received',
    createdAt: new Date().toISOString()
  };

  if (type === 'order') {
    const items = sanitizeItems(body.items);
    if (!items.length) throw Object.assign(new Error('Selecciona al menos un servicio.'), { statusCode: 400 });
    return {
      ...base,
      items,
      total: items.reduce((sum, item) => sum + item.subtotal, 0),
      deliveryTime: cleanText(body.deliveryTime, 60),
      notes: cleanText(body.notes, 500),
      paymentPreference: ['room', 'hotel', 'online'].includes(body.paymentPreference)
        ? body.paymentPreference
        : 'room'
    };
  }

  if (type === 'contract') {
    const signedName = cleanText(body.signedName, 160);
    if (!signedName || body.acceptedTerms !== true) {
      throw Object.assign(new Error('Escribe tu nombre y acepta el contrato para firmar.'), { statusCode: 400 });
    }
    const guests = sanitizeContractGuests(body.guests);
    const primaryGuest = guests.find(guest => guest.isPrimary) || guests[0] || {};
    /* Audit trail — Ley 527 art. 7 / Decreto 2364:
       - clientIp + userAgent identify the device the signer used;
       - signedAt is the server timestamp (clock under our control);
       - acknowledgedAt records when the user finished reading the preview
         (client-supplied, sanity-clamped to a reasonable range);
       - contractVersion pins the template revision presented;
       - consentText is the explicit acceptance wording shown to the user;
       - contractHash is SHA-256 over the rendered HTML the template will
         produce for this signature, so we can later prove the exact text. */
    const signedAt = new Date().toISOString();
    const contractVersion = cleanText(body.contractVersion || CURRENT_CONTRACT_VERSION, 80);
    const consentText = cleanText(body.consentText, 600) ||
      'Declaro que he leído, entiendo y acepto íntegramente este contrato de hospedaje y firmo electrónicamente con plenos efectos legales conforme a la Ley 527 de 1999.';
    const clientIp = event ? extractClientIp(event) : 'unknown';
    const userAgent = event ? extractUserAgent(event) : '';
    /* Acknowledgement timestamp from the client; reject anything that is
       not a valid ISO string OR is more than 24h away from server time. */
    let acknowledgedAt = '';
    if (body.acknowledgedAt) {
      const parsed = new Date(String(body.acknowledgedAt));
      if (!Number.isNaN(parsed.getTime()) && Math.abs(Date.now() - parsed.getTime()) < 24 * 3600 * 1000) {
        acknowledgedAt = parsed.toISOString();
      }
    }
    const contractRecord = {
      ...base,
      signedName,
      phone: primaryGuest.phone || '',
      email: primaryGuest.email || '',
      guests,
      acceptedTerms: true,
      contractVersion,
      signedAt,
      acknowledgedAt,
      consentText,
      clientIp,
      userAgent,
      checkIn: cleanText(body.checkIn, 20) || cleanText(session.checkIn, 20) || '',
      checkOut: cleanText(body.checkOut, 20) || cleanText(session.checkOut, 20) || '',
      roomName: cleanText(body.roomName, 120) || cleanText(session.roomName, 120) || '',
      capacity: Number.isFinite(Number(session.capacity)) ? Number(session.capacity) : guests.length
    };
    let renderedHtml = '';
    try {
      renderedHtml = renderContractHTML(contractRecord);
    } catch (renderErr) {
      console.warn('[guest-action] contract render for hash failed:', renderErr && renderErr.message);
    }
    contractRecord.contractHash = renderedHtml ? sha256Hex(renderedHtml) : '';
    contractRecord.contractHashAlgorithm = 'sha256';
    return contractRecord;
  }

  if (type === 'reservation_change') {
    const requestKind = ['dates', 'guests', 'cancel', 'invoice', 'other'].includes(body.requestKind)
      ? body.requestKind
      : 'other';
    return {
      ...base,
      requestKind,
      requestedCheckIn: cleanText(body.requestedCheckIn, 20),
      requestedCheckOut: cleanText(body.requestedCheckOut, 20),
      message: cleanText(body.message, 1200)
    };
  }

  if (type === 'support') {
    const message = cleanText(body.message, 1200);
    if (!message) throw Object.assign(new Error('Cuéntanos cómo podemos ayudarte.'), { statusCode: 400 });
    return {
      ...base,
      category: cleanText(body.category || 'concierge', 80),
      message,
      urgency: body.urgency === 'urgent' ? 'urgent' : 'normal'
    };
  }

  throw Object.assign(new Error('Tipo de solicitud no válido.'), { statusCode: 400 });
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const limited = await checkRateLimit(event, {
    name: 'guest-action',
    limit: 30,
    windowMs: 10 * 60 * 1000
  });
  if (!limited.ok) return rateLimitResponse(corsHeaders(), limited.retryAfter);

  try {
    const session = deps.requireGuest(event);
    const body = parseJsonBody(event, 50000);
    const type = String(body.type || '');
    const record = buildEvent(type, body, session, event);
    await deps.guestStore('guest-events').setJSON(record.eventId, deps.protectRecord(record));

    const sync = await deps.syncGuestEvent(record);
    const archive = type === 'contract'
      ? await deps.archiveGuestPayload({ kind: 'guest-contract', record })
      : { configured: false, delivered: false };

    const response = {
      ok: true,
      eventId: record.eventId,
      status: record.status,
      sync,
      archive
    };

    if (type === 'order') {
      response.total = record.total;
      response.paymentRequired =
        record.paymentPreference === 'online' &&
        process.env.GUEST_SERVICE_PAYMENT_MODE === 'payment_link';
      if (response.paymentRequired && process.env.GUEST_SERVICE_PAYMENT_URL) {
        const url = new URL(process.env.GUEST_SERVICE_PAYMENT_URL);
        url.searchParams.set('reference', record.eventId);
        url.searchParams.set('amount', String(record.total));
        response.paymentUrl = url.toString();
      }
    }

    return json(201, response);
  } catch (error) {
    console.error('[guest-action]', error.message);
    return json(error.statusCode || 500, {
      error: error.statusCode ? error.message : 'No fue posible registrar la solicitud.'
    });
  }
};
