const crypto = require('crypto');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limit');
const {
  archiveGuestPayload,
  cleanText,
  corsHeaders,
  guestStore,
  json,
  parseJsonBody,
  protectRecord,
  requireGuest,
  syncGuestEvent
} = require('./_guest-app');

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

function buildEvent(type, body, session) {
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
    return {
      ...base,
      signedName,
      phone: primaryGuest.phone || '',
      email: primaryGuest.email || '',
      guests,
      acceptedTerms: true,
      contractVersion: cleanText(body.contractVersion || 'ESTAR-HOSPEDAJE-2026-01', 80),
      signedAt: new Date().toISOString(),
      consentText: 'Firma electrónica simple aceptada desde la guest app.'
    };
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
    const session = requireGuest(event);
    const body = parseJsonBody(event, 50000);
    const type = String(body.type || '');
    const record = buildEvent(type, body, session);
    await guestStore('guest-events').setJSON(record.eventId, protectRecord(record));

    const sync = await syncGuestEvent(record);
    const archive = type === 'contract'
      ? await archiveGuestPayload({ kind: 'guest-contract', record })
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
