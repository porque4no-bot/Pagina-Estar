const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limit');
const { getQuoteStore, loadQuote, effectiveStatus, computeQuoteTotal } = require('./_quotes-store');
const { decodeDirectReference, verifyDirectBookingAmount } = require('./_direct-pricing');
const { normalizeCode } = require('./_discount-store');
const { flag } = require('./_settings');

/* Frente A — el motor de descuentos se enciende con DISCOUNT_CODES_ENABLED.
   Apagado: el discountCode entrante se ignora por completo (firma sin descuento).
   Gestionable desde /admin (override del panel → env). */
async function discountEnabled() { return await flag('DISCOUNT_CODES_ENABLED'); }

/* A8 — guest free-text notes to the PMS. The note never travels in the Wompi
   reference (length/escapes/sensitivity); instead it is persisted server-side
   here at signing time and read by wompi-webhook when it creates the
   reservation. Gated OFF by default. */
function notesToPmsEnabled() { return process.env.GUEST_NOTES_TO_PMS_ENABLED === 'true'; }
function sanitizeIncomingNotes(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw.replace(/[<>\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
}

/* Frente C: normaliza el opt-in de marketing entrante a booleano. Ley 1581:
   solo TRUE explícito cuenta como opt-in; cualquier otra cosa (ausente, false,
   string vacío, etc.) = NO marketing. */
function parseMarketingOptIn(raw) {
  return raw === true || raw === 'true' || raw === 1 || raw === '1';
}

function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ba.length === bb.length && ba.length > 0 && crypto.timingSafeEqual(ba, bb);
}

function corsHeaders() {
  const headers = {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;
  return headers;
}

function json(statusCode, body) {
  return { statusCode, headers: corsHeaders(), body: JSON.stringify(body) };
}

function cleanReference(value) {
  return String(value || '').trim();
}

function cleanEnv(value) {
  return String(value || '').trim();
}

function wompiModeFromPublicKey(value) {
  const key = cleanEnv(value);
  if (key.startsWith('pub_prod_')) return 'prod';
  if (key.startsWith('pub_test_')) return 'test';
  return '';
}

function wompiModeFromIntegritySecret(value) {
  const secret = cleanEnv(value);
  if (secret.startsWith('prod_integrity_')) return 'prod';
  if (secret.startsWith('test_integrity_')) return 'test';
  return '';
}

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed. Use POST.' });

  /* A11 GAP-2: rate-limit so a direct reference can't be replayed to hammer the
     OTASync price recompute (cost amplification / price probing). Best-effort. */
  const limited = await checkRateLimit(event, { name: 'wompi-signature', limit: 30, windowMs: 5 * 60 * 1000 });
  if (!limited.ok) return rateLimitResponse(headers, limited.retryAfter);

  if (event.body && event.body.length > 3600) return json(413, { error: 'Payload too large' });

  const secret = cleanEnv(process.env.WOMPI_INTEGRITY_SECRET);
  if (!secret) {
    console.error('CRITICAL: WOMPI_INTEGRITY_SECRET is not configured.');
    return json(503, { error: 'Wompi integrity secret is not configured' });
  }

  const publicKeyMode = wompiModeFromPublicKey(process.env.WOMPI_PUBLIC_KEY);
  const integrityMode = wompiModeFromIntegritySecret(secret);
  if (publicKeyMode && integrityMode && publicKeyMode !== integrityMode) {
    console.error(`CRITICAL: Wompi key mode mismatch. public=${publicKeyMode}, integrity=${integrityMode}`);
    return json(503, { error: 'Wompi public key and integrity secret belong to different environments' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return json(400, { error: 'Invalid JSON request body' }); }

  const reference = cleanReference(body.reference);
  const clientAmountInCents = parseInt(body.amountInCents, 10);
  const currency = String(body.currency || 'COP').trim().toUpperCase();
  const publicToken = String(body.publicToken || '').trim();
  const guestNotes = sanitizeIncomingNotes(body.notes); /* A8: free-text guest note, optional */
  /* Frente C: opt-in de marketing (Ley 1581). Booleano OPCIONAL; sin él/false =
     NO marketing. Viaja en el body, NUNCA en la referencia firmable. Se persiste
     server-side aquí y lo lee wompi-webhook tras crear la reserva. */
  const marketingOptIn = parseMarketingOptIn(body.marketingOptIn);
  /* Frente A: el código de descuento viaja APARTE de la referencia (límite de
     255 chars + no debe ir en texto plano firmable por el cliente). Se revalida
     server-side y, si aplica, se firma el monto YA con descuento. */
  const discountCode = (await discountEnabled()) ? normalizeCode(body.discountCode) : '';

  if (!reference || reference.length > 255 || !Number.isFinite(clientAmountInCents) || clientAmountInCents <= 0 || currency !== 'COP') {
    return json(400, { error: 'Invalid Wompi signature payload' });
  }

  /* For corporate quote payments (reference matches COT-YYYY-XXXXX), the amount
     is NOT trusted from the cliente. We load the quote from the store, recompute
     the total via computeQuoteTotal and sign with THAT value. This prevents a
     cliente from initiating arbitrary-amount payments against any quote. */
  let amountInCents = clientAmountInCents;
  const isQuoteRef = /^COT-\d{4}-[A-Z0-9]{5}$/.test(reference);
  if (isQuoteRef) {
    let quote;
    try { quote = await loadQuote(getQuoteStore(), reference); }
    catch (e) {
      console.error('[create-wompi-signature] quote store unavailable:', e.message);
      return json(503, { error: 'Cotización no disponible. Intenta de nuevo.' });
    }
    if (!quote) return json(404, { error: 'Cotización no encontrada' });

    if (quote.publicToken && !timingSafeEqual(publicToken, quote.publicToken)) {
      return json(403, { error: 'Token de acceso inválido' });
    }

    const status = effectiveStatus(quote);
    if (status === 'cancelada' || status === 'vencida' || status === 'aceptada') {
      return json(409, { error: `Cotización ${status}, no se puede pagar` });
    }

    const totals = computeQuoteTotal(quote);
    amountInCents = totals.totalCents;
  } else {
    /* Direct booking: the reference is a base64-encoded payload that pins
       the room type, dates, extras and IVA flags. Recompute the authoritative
       subtotal from OTASync availability so a tampered client amount cannot
       be signed. Quote payments are already protected above via the store. */
    const decoded = decodeDirectReference(reference);
    if (!decoded) {
      console.warn('[create-wompi-signature] reference is neither a quote id nor a decodable direct payload; refusing to sign');
      return json(400, { error: 'invalid_reference' });
    }

    let verdict;
    try {
      verdict = await verifyDirectBookingAmount(decoded, clientAmountInCents, {
        discountCode,
        email: decoded.email || ''
      });
    } catch (e) {
      console.error('[create-wompi-signature] price recompute failed:', e.message);
      return json(503, { error: 'price_check_unavailable' });
    }

    if (!verdict.ok) {
      console.error(`[create-wompi-signature] pricing verification failed refusing to sign: bookingCode=${decoded.bookingCode}, roomType=${decoded.roomTypeId}, client=${clientAmountInCents}, expected=${verdict.expectedCentsAll ? verdict.expectedCentsAll.join('|') : verdict.expectedCents}, reason=${verdict.reason}`);
      return json(400, { error: verdict.reason || 'price_mismatch' });
    }
    if (verdict.isMock) {
      if (process.env.NODE_ENV === 'production' || process.env.NETLIFY === 'true') {
        console.error('[create-wompi-signature] OTASync credentials missing in production. Refusing to sign client amount.');
        return json(503, { error: 'OTASync credentials missing' });
      }
      console.warn(`[create-wompi-signature] OTASync mock fallback active — accepting client amount without recompute. bookingCode=${decoded.bookingCode}, client=${clientAmountInCents}`);
    }

    /* A8: persist the guest's free-text note keyed by bookingCode so the webhook
       can attach it to the OTASync reservation. Best-effort; never blocks the
       signature. Gated OFF by default. */
    if (notesToPmsEnabled() && guestNotes && decoded.bookingCode) {
      try {
        const notesStore = getStore({ name: 'booking-notes', consistency: 'strong' });
        await notesStore.set(`note-${decoded.bookingCode}`, JSON.stringify({ notes: guestNotes, createdAt: new Date().toISOString() }));
      } catch (e) {
        console.warn('[create-wompi-signature] note persist failed (non-fatal):', e.message);
      }
    }

    /* Frente A: persist the applied discount code keyed by bookingCode so the
       webhook can RE-validate it (not expired/exhausted/blackout) and increment
       its usage idempotently after the reservation is created. The code never
       travels inside the Wompi reference. Only persist when the discount
       actually applied to the signed amount; best-effort, never blocks. */
    if (discountCode && verdict.discount && verdict.discount.applied && decoded.bookingCode) {
      try {
        const discStore = getStore({ name: 'booking-discounts', consistency: 'strong' });
        await discStore.set(`disc-${decoded.bookingCode}`, JSON.stringify({
          code: discountCode,
          email: decoded.email || '',
          signedAmountCents: amountInCents,
          createdAt: new Date().toISOString()
        }));
      } catch (e) {
        console.warn('[create-wompi-signature] discount persist failed (non-fatal):', e.message);
      }
    }

    /* Frente C: persist the marketing opt-in keyed by bookingCode so the webhook
       can wire it to Odoo (tag 'Opt-in marketing' + Email Marketing list) AFTER
       the reservation is created. Ley 1581: only persist a positive opt-in; a
       missing/false value means NO marketing and we store nothing. The flag never
       travels inside the Wompi reference. Best-effort, never blocks the signature. */
    if (marketingOptIn && decoded.bookingCode) {
      try {
        const mktStore = getStore({ name: 'booking-marketing', consistency: 'strong' });
        await mktStore.set(`mkt-${decoded.bookingCode}`, JSON.stringify({
          accepted: true,
          email: decoded.email || '',
          channel: 'motor-reserva-directa',
          createdAt: new Date().toISOString()
        }));
      } catch (e) {
        console.warn('[create-wompi-signature] marketing opt-in persist failed (non-fatal):', e.message);
      }
    }
  }

  const integrity = crypto
    .createHash('sha256')
    .update(`${reference}${amountInCents}${currency}${secret}`)
    .digest('hex');

  return json(200, { reference, amountInCents, currency, signature: { integrity } });
};

exports._test = { sanitizeIncomingNotes, notesToPmsEnabled, discountEnabled, parseMarketingOptIn };
