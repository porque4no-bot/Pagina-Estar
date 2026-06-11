const { checkRateLimit, rateLimitResponse } = require('./_rate-limit');
const {
  corsHeaders,
  getReservation,
  json,
  matchesAccessKey,
  parseJsonBody,
  signGuestToken
} = require('./_guest-app');

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
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
      return json(400, { error: 'Ingresa el código de reserva y el apellido del titular.' });
    }

    const booking = await getReservation(bookingCode, accessKey);
    if (!booking || !matchesAccessKey(booking, accessKey)) {
      return json(404, {
        error: 'No encontramos una reserva que coincida con esos datos.'
      });
    }

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
        demo: Boolean(booking.demo)
      }
    });
  } catch (error) {
    console.error('[guest-session]', error.message);
    return json(error.statusCode || 500, {
      error: error.statusCode ? error.message : 'No fue posible consultar la reserva.'
    });
  }
};
