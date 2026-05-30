const {
  createDirectReference,
  QUOTE_ID_RE,
  CURRENCY
} = require('./_payments');
const {
  getQuoteStore,
  loadQuote,
  effectiveStatus,
  computeQuoteTotal
} = require('./_quotes-store');

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

function originFromEvent(event) {
  const proto = event.headers['x-forwarded-proto'] || 'https';
  const host = event.headers.host || 'estar.com.co';
  return `${proto}://${host}`;
}

function clean(value, max) {
  return String(value || '').trim().slice(0, max || 200);
}

async function createPreference(preference) {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!accessToken) throw new Error('MERCADOPAGO_ACCESS_TOKEN is not configured');

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 12000);
  let res;
  try {
    res = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(preference),
      signal: ctrl.signal
    });
    clearTimeout(tid);
  } catch (err) {
    clearTimeout(tid);
    throw err.name === 'AbortError' ? new Error('Request timeout creating Mercado Pago preference') : err;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Mercado Pago preference failed with status ${res.status}: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return data;
}

async function preferenceForQuote(body, event) {
  const quoteId = clean(body.quoteId || body.id, 40);
  if (!QUOTE_ID_RE.test(quoteId)) return json(400, { error: 'Invalid quote id' });

  let quote;
  try {
    quote = await loadQuote(getQuoteStore(), quoteId);
  } catch (e) {
    return json(503, { error: 'Quote store unavailable' });
  }
  if (!quote) return json(404, { error: 'Quote not found' });

  const status = effectiveStatus(quote);
  if (status === 'aceptada') return json(409, { error: 'Quote already paid' });
  if (status === 'cancelada' || status === 'vencida') return json(410, { error: `Quote is ${status}` });

  const { total, totalCents } = computeQuoteTotal(quote);
  const base = originFromEvent(event);
  const successUrl = `${base}/cotizacion.html?id=${encodeURIComponent(quoteId)}&payment=success`;
  const failureUrl = `${base}/cotizacion.html?id=${encodeURIComponent(quoteId)}&payment=failure`;
  const pendingUrl = `${base}/cotizacion.html?id=${encodeURIComponent(quoteId)}&payment=pending`;

  const preference = {
    external_reference: quoteId,
    items: [{
      id: quoteId,
      title: `Cotizacion Hotel Estar ${quoteId}`,
      description: clean(quote.empresa || quote.contacto || 'Cotizacion Hotel Estar', 240),
      quantity: 1,
      currency_id: CURRENCY,
      unit_price: total
    }],
    payer: {
      name: clean(quote.contacto || quote.empresa, 80),
      email: clean(quote.email, 254)
    },
    back_urls: { success: successUrl, failure: failureUrl, pending: pendingUrl },
    auto_return: 'approved',
    notification_url: `${base}/api/mercadopago-webhook`,
    metadata: { quote_id: quoteId, expected_amount_cents: totalCents, source: 'quote' }
  };

  const mp = await createPreference(preference);
  return json(200, {
    provider: 'mercadopago',
    id: mp.id,
    init_point: mp.init_point,
    sandbox_init_point: mp.sandbox_init_point,
    reference: quoteId,
    amountCents: totalCents
  });
}

async function preferenceForDirectBooking(body, event) {
  const bookingCode = clean(body.bookingCode, 40);
  const amountCents = Math.max(0, parseInt(body.amountCents, 10) || 0);
  if (!bookingCode || amountCents <= 0) return json(400, { error: 'Missing bookingCode or amountCents' });
  if (!body.checkin || !body.checkout || !body.roomTypeId || !body.firstName || !body.lastName || !body.email || !body.phone) {
    return json(400, { error: 'Missing reservation fields' });
  }

  const reference = createDirectReference({
    checkin: body.checkin,
    checkout: body.checkout,
    guestsCount: body.guestsCount,
    roomTypeId: body.roomTypeId,
    firstName: body.firstName,
    lastName: body.lastName,
    email: body.email,
    phone: body.phone,
    extrasMask: body.extrasMask,
    bookingCode,
    isColombian: !!body.isColombian,
    isBusiness: !!body.isBusiness,
    amountCents
  });

  const base = originFromEvent(event);
  const successUrl = process.env.MERCADOPAGO_SUCCESS_URL || `${base}/reservar.html?payment=success`;
  const failureUrl = process.env.MERCADOPAGO_FAILURE_URL || `${base}/reservar.html?payment=failure`;
  const pendingUrl = process.env.MERCADOPAGO_PENDING_URL || `${base}/reservar.html?payment=pending`;

  const preference = {
    external_reference: reference,
    items: [{
      id: bookingCode,
      title: `Reserva Hotel Estar ${bookingCode}`,
      description: clean(body.roomName || 'Reserva Hotel Estar', 240),
      quantity: 1,
      currency_id: CURRENCY,
      unit_price: amountCents / 100
    }],
    payer: {
      name: `${clean(body.firstName, 80)} ${clean(body.lastName, 80)}`.trim(),
      email: clean(body.email, 254),
      phone: { number: clean(body.phone, 50) }
    },
    back_urls: { success: successUrl, failure: failureUrl, pending: pendingUrl },
    auto_return: 'approved',
    notification_url: `${base}/api/mercadopago-webhook`,
    metadata: { booking_code: bookingCode, expected_amount_cents: amountCents, source: 'direct' }
  };

  const mp = await createPreference(preference);
  return json(200, {
    provider: 'mercadopago',
    id: mp.id,
    init_point: mp.init_point,
    sandbox_init_point: mp.sandbox_init_point,
    reference,
    bookingCode,
    amountCents
  });
}

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed. Use POST.' });
  if (event.body && event.body.length > 15000) return json(413, { error: 'Payload too large' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return json(400, { error: 'Invalid JSON request body' }); }

  try {
    if (body.type === 'quote' || body.quoteId || body.id) return await preferenceForQuote(body, event);
    return await preferenceForDirectBooking(body, event);
  } catch (e) {
    console.error('[create-mercadopago-preference]', e.message);
    return json(500, { error: 'Failed to create Mercado Pago preference' });
  }
};
