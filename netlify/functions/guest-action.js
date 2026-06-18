const crypto = require('crypto');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limit');
const { renderContractHTML } = require('./_contract-template');
const { SERVICES } = require('./_services-catalog');
const { postOrderExtrasToFolio: _postOrderExtrasToFolio } = require('./_otasync');
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
  syncGuestEvent: _syncGuestEvent,
  postOrderToFolio: _postOrderExtrasToFolio
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

/* Guest-app service ids → canonical catalog keys (_services-catalog.js). The
   guest app (and the order records / contracts it has always stored) use these
   ids; the single catalog is keyed by the booking-engine names. We keep the ids
   the front-end already sends and pull every price from the catalog so the three
   surfaces (reservas / cotización / guest app) can't silently drift again.
   Parqueadero is intentionally absent — it was retired from every surface. */
const GUEST_SERVICE_KEYS = {
  breakfast: 'desayuno',
  laundry: 'laundry',
  late_checkout: 'late',
  early_checkin: 'early',
  airport_transfer: 'airport_transfer',
  city_experience: 'city_experience',
  mascota: 'mascota'
};

/* Derived from the catalog, keeping only services offered on the 'guest'
   surface. Flat services carry a fixed `price`; %-of-night services (late/early
   check-out) carry `pct` and are priced per booking in sanitizeItems(). */
const SERVICE_CATALOG = Object.fromEntries(
  Object.entries(GUEST_SERVICE_KEYS)
    .map(([guestId, catalogKey]) => {
      const svc = SERVICES[catalogKey];
      if (!svc || !Array.isArray(svc.surfaces) || !svc.surfaces.includes('guest')) return null;
      const entry = { name: svc.es };
      if (svc.multiplier === 'pctOfNight') entry.pct = svc.pct;
      else entry.price = svc.price;
      return [guestId, entry];
    })
    .filter(Boolean)
);

/* Exposed for the anti-drift guard test (services-catalog.test.js). */
exports._test.SERVICE_CATALOG = SERVICE_CATALOG;
exports._test.GUEST_SERVICE_KEYS = GUEST_SERVICE_KEYS;

/* Average paid night for the booking (totalAmount / nights), used as the base
   for %-of-night services. totalAmount already includes IVA, so the resulting
   late/early fee is IVA-inclusive — internally consistent with what the guest
   sees, even if it's an approximation of the booking engine's net-rate math
   (the owner accepted this on 2026-06-18). Returns 0 when not computable. */
function nightBaseFromSession(session) {
  const nights = Number(session && session.nights) || 0;
  const totalAmount = Number(session && session.totalAmount) || 0;
  return nights > 0 && totalAmount > 0 ? totalAmount / nights : 0;
}

/* Authoritative unit price. Flat → catalog price. %-of-night → pct × nightBase,
   rounded to the peso (the guest app mirrors this exact formula client-side).
   Returns null when a %-of-night service can't be priced (token missing the
   night base, e.g. an order placed on a pre-deploy session). */
function priceForService(service, nightBase) {
  if (typeof service.pct === 'number') {
    return nightBase > 0 ? Math.round(service.pct * nightBase) : null;
  }
  return service.price;
}

function sanitizeItems(items, session) {
  const nightBase = nightBaseFromSession(session);
  return (Array.isArray(items) ? items : []).slice(0, 20).map(item => {
    const service = SERVICE_CATALOG[item.id];
    if (!service) return null;
    const unitPrice = priceForService(service, nightBase);
    if (unitPrice == null) {
      throw Object.assign(
        new Error('No pudimos calcular el precio de ese servicio. Vuelve a iniciar sesión e inténtalo de nuevo.'),
        { statusCode: 400 }
      );
    }
    const quantity = Math.max(1, Math.min(10, parseInt(item.quantity, 10) || 1));
    return {
      id: item.id,
      name: service.name,
      quantity,
      unitPrice,
      subtotal: unitPrice * quantity
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
    const items = sanitizeItems(body.items, session);
    if (!items.length) throw Object.assign(new Error('Selecciona al menos un servicio.'), { statusCode: 400 });
    /* paymentPreference is recorded so the team knows how to settle each order
       in Kunas: 'account' = charge to the guest folio at check-out, 'online' =
       paid (or to be paid) online. The full amount breakdown above travels with
       the event so the Kunas posting is unambiguous. */
    return {
      ...base,
      items,
      total: items.reduce((sum, item) => sum + item.subtotal, 0),
      deliveryTime: cleanText(body.deliveryTime, 60),
      notes: cleanText(body.notes, 500),
      paymentPreference: ['account', 'online'].includes(body.paymentPreference)
        ? body.paymentPreference
        : 'account'
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
      capacity: Number.isFinite(Number(session.capacity)) ? Number(session.capacity) : guests.length,
      lang: cleanText(body.lang || 'es', 5)
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

    if (type === 'contract_preview') {
      const guests = sanitizeContractGuests(body.guests);
      const primaryGuest = guests.find(guest => guest.isPrimary) || guests[0] || {};
      const contractRecord = {
        bookingCode: session.sub,
        guestName: session.guest,
        signedName: cleanText(body.signedName || (primaryGuest.firstName && `${primaryGuest.firstName} ${primaryGuest.lastName || ''}`.trim()) || session.guest, 160),
        phone: primaryGuest.phone || '',
        email: primaryGuest.email || '',
        guests,
        acceptedTerms: false,
        contractVersion: cleanText(body.contractVersion || CURRENT_CONTRACT_VERSION, 80),
        signedAt: new Date().toISOString(),
        consentText: cleanText(body.consentText, 600),
        checkIn: cleanText(body.checkIn, 20) || cleanText(session.checkIn, 20) || '',
        checkOut: cleanText(body.checkOut, 20) || cleanText(session.checkOut, 20) || '',
        roomName: cleanText(body.roomName, 120) || cleanText(session.roomName, 120) || '',
        capacity: Number.isFinite(Number(session.capacity)) ? Number(session.capacity) : guests.length,
        lang: cleanText(body.lang || 'es', 5)
      };
      const html = renderContractHTML(contractRecord);
      return json(200, { ok: true, html });
    }

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
      /* Charge-to-account orders: post the charge onto the reservation folio in
         OTASync/Kunas so reception sees it at check-out. Flagged + best-effort —
         a folio hiccup never fails the order, which is already stored above.
         ('online' orders post to the folio after payment, in the webhook — see
         Phase B in docs/pendientes.md §5.) */
      if (record.paymentPreference === 'account' &&
          process.env.GUEST_SERVICE_FOLIO_ENABLED === 'true') {
        try {
          response.folio = await deps.postOrderToFolio({ idReservations: session.sub, items: record.items });
        } catch (folioErr) {
          console.error('[guest-action] folio posting failed:', folioErr.message);
          response.folio = { posted: false, error: folioErr.message };
        }
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
