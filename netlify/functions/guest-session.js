const { checkRateLimit, rateLimitResponse } = require('./_rate-limit');
const {
  corsHeaders,
  getReservation: _getReservation,
  guestStore: _guestStore,
  isCancelledBooking,
  json,
  matchesAccessKey,
  parseJsonBody,
  signGuestToken
} = require('./_guest-app');
const { get: _getSetting } = require('./_settings');

const defaultDeps = {
  getReservation: _getReservation,
  guestStore: _guestStore,
  getSetting: _getSetting
};
const deps = { ...defaultDeps };

/* ¿El modo de pago de servicios permite cobrar en línea? Con room_charge (el de
   producción hoy) NO: la guest app solo debe ofrecer "Cargar a mi cuenta". Es el
   mismo criterio que usa guest-action al armar el checkout (resolveOnlineProvider
   + payment_link con URL configurada). */
function onlinePaymentEnabled(mode) {
  const m = String(mode || '').trim().toLowerCase();
  if (['wompi', 'mercadopago', 'both'].includes(m)) return true;
  return m === 'payment_link' && Boolean(process.env.GUEST_SERVICE_PAYMENT_URL);
}

/* Último check-in registrado para la reserva (índice que escribe guest-checkin
   en el store `guest-checkin-index`, sin PII). Best-effort: si Blobs no
   responde, la app simplemente no sabe que ya hubo check-in. */
async function lastCheckinId(bookingCode) {
  try {
    const store = deps.guestStore('guest-checkin-index');
    if (!store || typeof store.get !== 'function') return '';
    const entry = await store.get(String(bookingCode), { type: 'json' });
    const id = entry && typeof entry.checkinId === 'string' ? entry.checkinId : '';
    return /^CHK-[A-Za-z0-9-]+$/.test(id) ? id : '';
  } catch (error) {
    return '';
  }
}

exports._test = {
  onlinePaymentEnabled,
  lastCheckinId,
  setDeps(overrides = {}) { Object.assign(deps, overrides); },
  resetDeps() { Object.assign(deps, defaultDeps); }
};

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Método no permitido.' });
  }

  const limited = await checkRateLimit(event, {
    name: 'guest-session',
    limit: 10,
    windowMs: 10 * 60 * 1000
  });
  if (!limited.ok) return rateLimitResponse(corsHeaders(), limited.retryAfter);

  try {
    const body = parseJsonBody(event, 5000);
    const bookingCode = String(body.bookingCode || '').trim().slice(0, 80);
    const accessKey = String(body.accessKey || '').trim().slice(0, 120);
    if (!bookingCode || !accessKey) {
      return json(400, { error: 'Ingresa el código de reserva y el apellido del titular.', code: 'missing_login' });
    }

    const booking = await deps.getReservation(bookingCode, accessKey);
    if (!booking || !matchesAccessKey(booking, accessKey)) {
      return json(404, {
        error: 'No encontramos una reserva que coincida con esos datos.',
        code: 'booking_not_found'
      });
    }

    /* Reserva cancelada: no se emite sesión. El segundo factor ya se validó, así
       que decirlo no filtra nada a un tercero, y le evita al huésped hacer un
       check-in o firmar un contrato de una estadía que no existe. */
    if (isCancelledBooking(booking)) {
      return json(403, {
        error: 'Esta reserva fue cancelada, así que no es posible hacer el check-in ni pedir servicios. Si crees que es un error, escríbenos por WhatsApp.',
        code: 'booking_cancelled'
      });
    }

    const [paymentMode, checkinId] = await Promise.all([
      deps.getSetting('GUEST_SERVICE_PAYMENT_MODE', '').catch(() => ''),
      lastCheckinId(booking.bookingCode)
    ]);

    return json(200, {
      ok: true,
      token: signGuestToken(booking),
      booking: {
        bookingCode: booking.bookingCode,
        status: booking.status,
        guestName: booking.guestName,
        guestEmail: booking.guestEmail,
        roomName: booking.roomName,
        roomNumber: booking.roomNumber,
        capacity: booking.capacity,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        nights: booking.nights,
        totalAmount: booking.totalAmount,
        canCancel: booking.canCancel,
        canModify: booking.canModify,
        onlinePayment: onlinePaymentEnabled(paymentMode),
        checkinId: checkinId || undefined,
        demo: Boolean(booking.demo)
      }
    });
  } catch (error) {
    console.error('[guest-session]', error.message);
    if (error.statusCode === 503) {
      return json(503, {
        error: 'El servicio no está disponible en este momento. Intenta más tarde o escríbenos por WhatsApp.',
        code: 'service_unavailable'
      });
    }
    return json(error.statusCode || 500, {
      error: error.statusCode ? error.message : 'No fue posible consultar la reserva.',
      code: error.code || undefined
    });
  }
};
