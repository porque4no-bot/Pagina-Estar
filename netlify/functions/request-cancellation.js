require('./_env');

/* Guest-initiated cancellation REQUEST for a direct booking.
   This endpoint does NOT delete the reservation in OTASync nor trigger an
   automatic refund: refund rails (Wompi reversal vs. manual transfer, cash /
   datáfono cases) are still being defined — see docs/pendientes.md. Until
   that lands, the contract with the guest is:
     1. We verify the booking exists and the caller proves knowledge of the
        booking email or surname (same second-factor gate as get-booking).
     2. We record the request (Netlify Blobs, audit + idempotency).
     3. We alert the hotel team (admin email) to apply the rate-plan policy
        (Estricta: 100% refund up to 7 days before / Flexible: 100% up to 24 h before)
        and process the refund through the original payment channel.
     4. We acknowledge to the guest by email.
   The previous UI pretended to cancel while calling no API at all; this
   endpoint replaces that dead end with a real, auditable request. */

const { checkRateLimit, rateLimitResponse } = require('./_rate-limit');
const { sendEmail, adminEmail, esc, formatCOP, formatDateES, cancellationAckHtml } = require('./_email');
const { helpers: bookingHelpers } = require('./get-booking');
const { getSessionKey } = require('./_otasync');
const { createRefundRequest, recoverPaymentInfo, REFUND_SLA_BUSINESS_DAYS } = require('./_refunds-store');

/* A repeated request for the same booking within this window is answered as
   success without re-alerting the hotel (guests double-click / retry). */
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

async function fetchReservation(bookingCode) {
  const token = process.env.OTASYNC_TOKEN || '';
  const propertyId = process.env.OTASYNC_PROPERTY_ID || '9889';
  const pkey = await getSessionKey();

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 10000);
  let response;
  try {
    response = await fetch('https://app.otasync.me/api/reservation/data/reservation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: pkey, token, id_properties: propertyId, id_reservations: String(bookingCode) }),
      signal: ctrl.signal
    });
    clearTimeout(tid);
  } catch (err) {
    clearTimeout(tid);
    throw err.name === 'AbortError' ? new Error('Request timeout during reservation lookup') : err;
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Kunas API returned status ${response.status} when looking up booking ${bookingCode}`);
  const data = await response.json();
  if (!data || !data.id_reservations) return null;
  return bookingHelpers.normalizeReservation(data);
}

function adminCancellationHtml({ booking, clientIp }) {
  return `<p>Un huésped solicitó la <strong>cancelación</strong> de su reserva desde la web (Gestionar reserva).</p>
    <ul>
      <li><strong>Código:</strong> ${esc(booking.bookingCode)}</li>
      <li><strong>Huésped:</strong> ${esc(booking.guestName)}</li>
      <li><strong>Email:</strong> ${esc(booking.guestEmail)}</li>
      <li><strong>Habitación:</strong> ${esc(booking.roomName)}</li>
      <li><strong>Fechas:</strong> ${esc(formatDateES(booking.checkIn))} → ${esc(formatDateES(booking.checkOut))} (${booking.nights} noche(s))</li>
      <li><strong>Total:</strong> ${esc(formatCOP(booking.totalAmount))}</li>
      <li><strong>IP del solicitante:</strong> ${esc(clientIp)}</li>
    </ul>
    <p>Acciones pendientes del equipo:</p>
    <ol>
      <li>Verificar la tarifa de la reserva (Estricta: gratis hasta 7 días antes · Flexible: gratis hasta 24 h antes; fuera de plazo se cobra 1ª noche + impuestos + 3,5%; no-show 24 h tras el check-in sin reembolso) en la nota de OTASync.</li>
      <li>Cancelar la reserva en OTASync si la política lo permite.</li>
      <li>Tramitar el reembolso por el canal de pago original (Wompi / Mercado Pago / datáfono / efectivo) <strong>dentro de ${REFUND_SLA_BUSINESS_DAYS} días hábiles</strong> y responder al huésped. Registrar el avance en el panel (/admin → Reembolsos).</li>
    </ol>`;
}

/* Guest cancellation acknowledgment is now the branded cancellationAckHtml() in _email.js. */

/* Core flow shared by the HTTP handler and the WhatsApp bot
   (_whatsapp-bot.js). Returns a discriminated result:
     { ok: false, code: 'not_found' | 'not_cancellable' | 'notify_failed' }
     { ok: true,  code: 'submitted' | 'already_requested', booking }
   Throws on infrastructure errors (OTASync down) — callers map that to their
   own error response. */
async function submitCancellationRequest({ bookingCode, providedFactor, clientIp, source }) {
  const booking = await fetchReservation(bookingCode);
  /* Uniform not-found on mismatch — same anti-enumeration contract as
     get-booking (A-1/A-2). */
  if (!booking || !bookingHelpers.identityMatches(booking, providedFactor)) {
    return { ok: false, code: 'not_found' };
  }
  if (!booking.canCancel) {
    return { ok: false, code: 'not_cancellable', status: booking.status };
  }

  /* Idempotencia + auditoría. Reservamos el marcador ATÓMICAMENTE (onlyIfNew)
     ANTES de enviar correos, para que dos solicitudes concurrentes de la misma
     reserva no generen alertas duplicadas. Clave canónica (id de OTASync),
     robusta a casing/espacios. Blobs no disponible (dev) no bloquea. */
  let store = null;
  let claimed = false;
  const dedupKey = booking.bookingCode;
  try {
    const { getStore } = require('@netlify/blobs');
    store = getStore({ name: 'cancellation-requests', consistency: 'strong' });
    const existing = await store.get(dedupKey);
    if (existing) {
      const prev = JSON.parse(existing);
      if (prev.requestedAt && Date.now() - prev.requestedAt < DEDUP_WINDOW_MS) {
        return { ok: true, code: 'already_requested', booking };
      }
    }
    const marker = JSON.stringify({ requestedAt: Date.now(), clientIp: clientIp || 'unknown', status: booking.status, source: source || 'web' });
    const res = await store.set(dedupKey, marker, { onlyIfNew: !existing });
    if (!existing && res && res.modified === false) {
      /* Otra invocación reclamó la misma reserva entre el get y el set. */
      return { ok: true, code: 'already_requested', booking };
    }
    claimed = true;
  } catch (e) {
    if (process.env.DEBUG) console.warn('[request-cancellation] Blobs unavailable, skipping dedup:', e.message);
    store = null;
  }

  const adminResult = await sendEmail({
    to: adminEmail(),
    subject: `Solicitud de cancelación — ${booking.bookingCode}`,
    html: adminCancellationHtml({ booking, clientIp: clientIp || 'unknown' })
  });
  if (!adminResult.sent) {
    /* If the hotel was not notified the request would silently die; tell
       the guest to use WhatsApp instead of faking success. Liberar el claim
       para que un reintento pueda volver a notificar. */
    if (claimed && store) { try { await store.delete(dedupKey); } catch (_) {} }
    console.error('[request-cancellation] admin alert failed for', booking.bookingCode);
    return { ok: false, code: 'notify_failed' };
  }

  if (booking.guestEmail) {
    try {
      await sendEmail({
        to: booking.guestEmail,
        subject: `Recibimos tu solicitud de cancelación — ${booking.bookingCode}`,
        html: cancellationAckHtml({ booking, lang: booking.lang })
      });
    } catch (e) {
      console.error('[request-cancellation] guest ack failed:', e.message);
    }
  }

  /* Fase 1 de reembolsos: registrar el reembolso (estado NEEDS_REVIEW) para que
     un admin lo apruebe/deniegue desde el panel. Idempotente por bookingCode y
     no-fatal — la solicitud de cancelación ya quedó registrada y notificada. */
  try {
    const paymentInfo = await recoverPaymentInfo(booking.bookingCode);
    await createRefundRequest({
      booking, paymentInfo, clientIp,
      source: source || 'web',
      reason: 'Cancelación solicitada por el huésped'
    });
  } catch (e) {
    if (process.env.DEBUG) console.warn('[request-cancellation] refund record creation failed:', e.message);
  }

  return { ok: true, code: 'submitted', booking };
}

exports.handler = async (event) => {
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  const corsHeaders = {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  if (allowedOrigin) corsHeaders['Access-Control-Allow-Origin'] = allowedOrigin;

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method Not Allowed. Use POST.' }) };
  }

  const limited = await checkRateLimit(event, { name: 'request-cancellation', limit: 6, windowMs: 10 * 60 * 1000 });
  if (!limited.ok) return rateLimitResponse(corsHeaders, limited.retryAfter);

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }
  const bookingCode = String(body.code || '').trim();
  const providedFactor = String(body.email || body.apellido || '').trim();
  if (!bookingCode || !providedFactor) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Missing required fields: code and email (or apellido)' }) };
  }

  const token = process.env.OTASYNC_TOKEN || '';
  const username = process.env.OTASYNC_USERNAME || '';
  const password = process.env.OTASYNC_PASSWORD || '';
  if (!(token && username && password)) {
    if (process.env.DEBUG) console.warn('[request-cancellation] OTASync credentials not configured.');
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: false, found: false, reason: 'PMS credentials not configured on this environment' }) };
  }

  try {
    const clientIp = event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
                     event.headers['x-nf-client-connection-ip'] || 'unknown';
    const result = await submitCancellationRequest({ bookingCode, providedFactor, clientIp, source: 'web' });

    if (result.code === 'not_found') {
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: false, found: false }) };
    }
    if (result.code === 'not_cancellable') {
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: false, found: true, reason: 'not_cancellable', status: result.status }) };
    }
    if (result.code === 'notify_failed') {
      return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ success: false, error: 'notify_failed' }) };
    }
    if (result.code === 'already_requested') {
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, alreadyRequested: true }) };
    }
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true }) };
  } catch (error) {
    console.error('[request-cancellation] Error:', error.message);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ success: false, error: 'Failed to submit cancellation request' }) };
  }
};

exports.submitCancellationRequest = submitCancellationRequest;
/* Reused by the WhatsApp bot for read-only booking lookups. */
exports.fetchReservation = fetchReservation;
