const crypto = require('crypto');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limit');
const { renderContractHTML } = require('./_contract-template');
const { SERVICES } = require('./_services-catalog');
const { postOrderExtrasToFolio: _postOrderExtrasToFolio } = require('./_otasync');
const { upsertPartner: _upsertPartner, createHelpdeskTicket: _createHelpdeskTicket } = require('./_odoo');
const {
  createGuestWompiCheckout: _createGuestWompiCheckout,
  createGuestMercadoPagoCheckout: _createGuestMercadoPagoCheckout
} = require('./_guest-payments');
const { sendEmail, adminEmail, esc, formatCOP } = require('./_email');
const { reportAlert: _reportAlert } = require('./_alert');
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
const { flag, get } = require('./_settings');

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

/* Phase C — team notification. Emails the team a summary of every service order
   so they can prepare/deliver it and settle it in Kunas (the paymentPreference
   tells them whether it's charged to the folio or paid online). Best-effort:
   sendEmail no-ops without RESEND_API_KEY, and the caller never fails the order
   on a mail error. Internal ops mail → Spanish only, like the other admin alerts. */
async function notifyOrderTeam(record) {
  const cell = 'padding:6px 0;font-family:Arial,sans-serif;font-size:13px;color:#444;border-bottom:1px solid #eee;';
  const rows = (record.items || []).map(it =>
    `<tr><td style="${cell}">${esc(it.name)} × ${it.quantity}</td>` +
    `<td style="${cell}text-align:right;">${formatCOP(it.subtotal)}</td></tr>`
  ).join('');
  let payLabel = record.paymentPreference === 'online' ? 'Pagar en línea' : 'Cargar a la cuenta';
  /* Refleja el estado REAL del folio para que el equipo no asuma que el cargo
     quedó cuando falló (Mesa Redonda — fuga de folio). */
  if (record.paymentPreference !== 'online' && record.folioStatus === 'failed') {
    payLabel = 'Cargar a la cuenta — ⚠️ NO se pudo cargar al folio, cobrar al check-out';
  } else if (record.paymentPreference !== 'online' && record.folioStatus === 'posted') {
    payLabel = 'Cargar a la cuenta — ✓ cargado al folio';
  }
  const extras = [];
  if (record.deliveryTime) extras.push(`<p style="margin:4px 0;font-size:13px;">Cuándo: <strong>${esc(record.deliveryTime)}</strong></p>`);
  if (record.notes) extras.push(`<p style="margin:4px 0;font-size:13px;">Notas: ${esc(record.notes)}</p>`);
  const html = `<!DOCTYPE html><html lang="es"><body style="font-family:Arial,sans-serif;color:#2C2C2C;">
    <h2 style="color:#9A6A2E;">Nuevo pedido de servicios</h2>
    <p>Reserva <strong>${esc(record.bookingCode)}</strong> · ${esc(record.guestName || '')}</p>
    <table style="width:100%;max-width:480px;border-collapse:collapse;">${rows}
      <tr><td style="padding-top:8px;font-weight:bold;">Total</td>
      <td style="padding-top:8px;font-weight:bold;text-align:right;">${formatCOP(record.total)}</td></tr>
    </table>
    <p style="margin-top:12px;font-size:13px;">Forma de pago: <strong>${payLabel}</strong></p>
    ${extras.join('')}
    <p style="color:#888;font-size:12px;margin-top:14px;">Pedido ${esc(record.eventId)}</p>
  </body></html>`;
  return sendEmail({
    to: adminEmail(),
    subject: `Nuevo pedido de servicios — ${record.bookingCode}`,
    html
  });
}

/* Bilingual copy for the Odoo Helpdesk ticket (Fase 4 — PQR). The ticket is
   internal (Atención al cliente), but new strings keep ES/EN parity in the "tú"
   tone. The guest's language is honoured when the record carries it (contracts
   do; order / reservation_change records default to ES). */
const HELPDESK_COPY = {
  es: {
    order: 'Solicitud de servicio',
    modification: 'Solicitud de modificación',
    cancel: 'Cancelación',
    reservation: 'Reserva',
    guest: 'Huésped',
    services: 'Servicios',
    payment: 'Forma de pago',
    when: 'Cuándo',
    notes: 'Notas',
    requestKind: 'Tipo de solicitud',
    newCheckIn: 'Nueva entrada',
    newCheckOut: 'Nueva salida',
    message: 'Mensaje',
    payAccount: 'Cargar a la cuenta',
    payOnline: 'Pagar en línea',
    eventRef: 'Solicitud',
    kinds: { dates: 'Cambio de fechas', guests: 'Cambio de huéspedes', cancel: 'Cancelación', invoice: 'Factura', other: 'Otra' }
  },
  en: {
    order: 'Service request',
    modification: 'Change request',
    cancel: 'Cancellation',
    reservation: 'Booking',
    guest: 'Guest',
    services: 'Services',
    payment: 'Payment method',
    when: 'When',
    notes: 'Notes',
    requestKind: 'Request type',
    newCheckIn: 'New check-in',
    newCheckOut: 'New check-out',
    message: 'Message',
    payAccount: 'Charge to the room',
    payOnline: 'Pay online',
    eventRef: 'Request',
    kinds: { dates: 'Date change', guests: 'Guest change', cancel: 'Cancellation', invoice: 'Invoice', other: 'Other' }
  }
};

/* Decides whether a guest event should open a Helpdesk PQR ticket and builds its
   subject + description. Service orders → 'order'; reservation cancellations →
   'cancel'; any other reservation_change → 'modification'. Returns null for event
   types that are not PQR (contract / contract_preview / support). */
function buildHelpdeskTicket(record) {
  if (!record) return null;
  const lang = String(record.lang || 'es').slice(0, 2).toLowerCase() === 'en' ? 'en' : 'es';
  const t = HELPDESK_COPY[lang];
  const ref = record.bookingCode || '';

  if (record.type === 'order') {
    const lines = (record.items || []).map(it => `· ${it.name} × ${it.quantity} — ${formatCOP(it.subtotal)}`);
    const payLabel = record.paymentPreference === 'online' ? t.payOnline : t.payAccount;
    const desc = [
      `${t.reservation}: ${ref}`,
      record.guestName ? `${t.guest}: ${record.guestName}` : '',
      `${t.services}:`,
      ...lines,
      `Total: ${formatCOP(record.total)}`,
      `${t.payment}: ${payLabel}`,
      record.deliveryTime ? `${t.when}: ${record.deliveryTime}` : '',
      record.notes ? `${t.notes}: ${record.notes}` : '',
      `${t.eventRef}: ${record.eventId}`
    ].filter(Boolean).join('\n');
    return { name: `${t.order} — ${ref}`, description: desc };
  }

  if (record.type === 'reservation_change') {
    const isCancel = record.requestKind === 'cancel';
    const heading = isCancel ? t.cancel : t.modification;
    const desc = [
      `${t.reservation}: ${ref}`,
      record.guestName ? `${t.guest}: ${record.guestName}` : '',
      `${t.requestKind}: ${(t.kinds[record.requestKind] || t.kinds.other)}`,
      record.requestedCheckIn ? `${t.newCheckIn}: ${record.requestedCheckIn}` : '',
      record.requestedCheckOut ? `${t.newCheckOut}: ${record.requestedCheckOut}` : '',
      record.message ? `${t.message}: ${record.message}` : '',
      `${t.eventRef}: ${record.eventId}`
    ].filter(Boolean).join('\n');
    return { name: `${heading} — ${ref}`, description: desc };
  }

  return null;
}

/* Fase 4 — opens a PQR ticket in Odoo Helpdesk for service orders and
   reservation modifications/cancellations. Best-effort: gated by HELPDESK_ENABLED
   and wrapped in try/catch by the caller, so a guest's request never fails when
   Odoo is down or unconfigured (mock no-op without credentials). Reuses
   upsertPartner to resolve/create the partner_id when the record carries an
   email, so the ticket hangs off the same customer master record. */
async function openHelpdeskTicket(record) {
  const ticket = buildHelpdeskTicket(record);
  if (!ticket) return { created: false, skipped: true };
  let partnerId = null;
  const email = record && record.email ? String(record.email).trim() : '';
  if (email) {
    try {
      const partner = await deps.upsertPartner({
        name: record.guestName || email,
        email,
        tags: ['Huésped'],
        comment: `Origen: app del huésped (guest.html). Reserva ${record.bookingCode || ''}.`.trim()
      });
      if (partner && partner.id) partnerId = partner.id;
    } catch (partnerErr) {
      /* No fatal: the ticket is still created without partner_id. */
      console.error('[guest-action] helpdesk partner upsert failed:', partnerErr.message);
    }
  }
  const res = await deps.createHelpdeskTicket({
    name: ticket.name,
    description: ticket.description,
    email: email || undefined,
    partnerName: record.guestName || undefined,
    partnerId: partnerId || undefined
  });
  return { created: Boolean(res && res.id), id: res && res.id, isMock: res && res.isMock };
}

const defaultDeps = {
  archiveGuestPayload: _archiveGuestPayload,
  guestStore: _guestStore,
  protectRecord: _protectRecord,
  requireGuest: _requireGuest,
  syncGuestEvent: _syncGuestEvent,
  postOrderToFolio: _postOrderExtrasToFolio,
  createGuestWompiCheckout: _createGuestWompiCheckout,
  createGuestMercadoPagoCheckout: _createGuestMercadoPagoCheckout,
  notifyOrderTeam,
  upsertPartner: _upsertPartner,
  createHelpdeskTicket: _createHelpdeskTicket,
  reportAlert: _reportAlert
};

/* Decide which provider settles an online service order. The env mode is the
   authoritative gate (defaults OFF — only 'wompi' or 'mercadopago' enable an
   online charge). When mode === 'both', the front-end may pick either via
   body.paymentProvider (default 'wompi'); any other request value is ignored.
   For a single-provider mode the client choice can't widen it. Returns null
   when online charging isn't enabled. */
function resolveOnlineProvider(mode, requested) {
  const m = String(mode || '').toLowerCase();
  const req = String(requested || '').toLowerCase();
  if (m === 'wompi') return 'wompi';
  if (m === 'mercadopago') return 'mercadopago';
  if (m === 'both') return req === 'mercadopago' ? 'mercadopago' : 'wompi';
  return null;
}

/* Site origin for the provider redirect/back-url, from the request (falls back
   to env inside _guest-payments). */
function originFromEvent(event) {
  const h = (event && event.headers) || {};
  const proto = h['x-forwarded-proto'] || h['X-Forwarded-Proto'] || 'https';
  const host = h.host || h.Host || '';
  return host ? `${proto}://${host}` : '';
}
const deps = { ...defaultDeps };

exports._test = {
  setDeps(overrides = {}) { Object.assign(deps, overrides); },
  resetDeps() { Object.assign(deps, defaultDeps); },
  extractClientIp,
  extractUserAgent,
  sha256Hex,
  resolveOnlineProvider,
  buildHelpdeskTicket,
  openHelpdeskTicket,
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
exports._test.priceForService = priceForService;

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
   Los servicios con `round5k` (early check-in, decisión firme) se redondean a los
   $5.000 más cercanos. Returns null when a %-of-night service can't be priced. */
function priceForService(service, nightBase) {
  if (typeof service.pct === 'number') {
    if (!(nightBase > 0)) return null;
    const raw = service.pct * nightBase;
    return service.round5k ? Math.round(raw / 5000) * 5000 : Math.round(raw);
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
        : 'account',
      /* Guest language — drives the Helpdesk ticket copy (ES/EN). */
      lang: cleanText(body.lang || 'es', 5)
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
      message: cleanText(body.message, 1200),
      /* Guest language — drives the Helpdesk ticket copy (ES/EN). */
      lang: cleanText(body.lang || 'es', 5)
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
      response.paymentRequired = false;
      /* Gestionable desde /admin (override del panel → env). */
      const paymentMode = await get('GUEST_SERVICE_PAYMENT_MODE');
      /* Provider for online charges. The env mode is the authoritative gate; the
         front-end may *narrow* it (body.paymentProvider) only to a provider the
         env already permits, so a tampered request can never enable an online
         charge that wasn't configured. With mode='wompi' or 'mercadopago' that
         single provider is used regardless of what the client asks for. */
      const onlineProvider = resolveOnlineProvider(paymentMode, body.paymentProvider);
      if (record.paymentPreference === 'online' && onlineProvider === 'wompi') {
        /* Signed Wompi checkout with a server-authoritative amount (Phase B).
           The charge + payment land on the reservation folio after Wompi
           approves, via wompi-webhook → handleGuestServicePayment. */
        try {
          response.paymentUrl = await deps.createGuestWompiCheckout({
            record, bookingCode: session.sub, redirectBase: originFromEvent(event)
          });
          response.paymentProvider = 'wompi';
          response.paymentRequired = true;
        } catch (payErr) {
          console.error('[guest-action] wompi checkout build failed:', payErr.message);
        }
      } else if (record.paymentPreference === 'online' && onlineProvider === 'mercadopago') {
        /* Mercado Pago Checkout Pro with a server-authoritative amount. The
           charge + payment land on the folio after MP approves, via
           mercadopago-webhook → handleGuestServicePayment (mirror of Wompi). */
        try {
          response.paymentUrl = await deps.createGuestMercadoPagoCheckout({
            record, bookingCode: session.sub, redirectBase: originFromEvent(event)
          });
          response.paymentProvider = 'mercadopago';
          response.paymentRequired = true;
        } catch (payErr) {
          console.error('[guest-action] mercadopago checkout build failed:', payErr.message);
        }
      } else if (record.paymentPreference === 'online' &&
                 paymentMode === 'payment_link' && process.env.GUEST_SERVICE_PAYMENT_URL) {
        const url = new URL(process.env.GUEST_SERVICE_PAYMENT_URL);
        url.searchParams.set('reference', record.eventId);
        url.searchParams.set('amount', String(record.total));
        response.paymentUrl = url.toString();
        response.paymentRequired = true;
      }
      /* Charge-to-account orders: post the charge onto the reservation folio in
         OTASync/Kunas so reception sees it at check-out. Flagged + best-effort —
         a folio hiccup never fails the order, which is already stored above.
         ('online' orders post to the folio after payment, in the webhook — see
         Phase B in docs/pendientes.md §5.) */
      if (record.paymentPreference === 'account' &&
          (await flag('GUEST_SERVICE_FOLIO_ENABLED'))) {
        try {
          response.folio = await deps.postOrderToFolio({ idReservations: session.sub, items: record.items });
        } catch (folioErr) {
          console.error('[guest-action] folio posting failed:', folioErr.message);
          response.folio = { posted: false, error: folioErr.message };
        }
        /* Mesa Redonda (Hospitality, crítico — fuga de ingresos silenciosa): hasta
           ahora postOrderExtrasToFolio podía devolver {posted:false} SIN lanzar
           (no entraba al catch) y el equipo recibía "cargar a la cuenta" aunque el
           cargo nunca llegó al folio de Kunas; con check-out automático el huésped
           se iba sin pagar. Ahora un folio no posteado es un INCIDENTE: alerta +
           estado persistido en el evento para que recepción/conciliación reintenten. */
        const folioPosted = Boolean(response.folio && response.folio.posted === true);
        record.folioStatus = folioPosted ? 'posted' : 'failed';
        if (!folioPosted) {
          await deps.reportAlert({
            kind: 'folio_post_failed',
            severity: 'error',
            message: `Cargo a la cuenta NO posteado al folio — reserva ${record.bookingCode}`,
            context: {
              bookingCode: record.bookingCode,
              eventId: record.eventId,
              total: record.total,
              reason: (response.folio && (response.folio.reason || response.folio.error)) || 'unknown'
            },
            dedupeKey: `folio_post_failed:${record.eventId}`
          });
        }
        /* Re-sella el evento con el estado del cargo para reintento idempotente
           por eventId (conciliación futura). Best-effort: nunca tumba el pedido. */
        try {
          await deps.guestStore('guest-events').setJSON(record.eventId, deps.protectRecord(record));
        } catch (persistErr) {
          console.error('[guest-action] folio status persist failed:', persistErr.message);
        }
      }

      /* Phase C — notify the team (best-effort; never fails the order). */
      try {
        await deps.notifyOrderTeam(record);
      } catch (mailErr) {
        console.error('[guest-action] order team notification failed:', mailErr.message);
      }
    }

    /* Fase 4 — Odoo Helpdesk (PQR): service orders and reservation
       modifications/cancellations open a ticket for Atención al cliente. Gated by
       HELPDESK_ENABLED and best-effort: a ticket failure never breaks the guest's
       request (which is already stored above). Mock no-op without Odoo creds. */
    if ((type === 'order' || type === 'reservation_change') && (await flag('HELPDESK_ENABLED'))) {
      try {
        response.helpdesk = await openHelpdeskTicket(record);
      } catch (helpdeskErr) {
        console.error('[guest-action] helpdesk ticket failed:', helpdeskErr.message);
        response.helpdesk = { created: false, error: helpdeskErr.message };
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
