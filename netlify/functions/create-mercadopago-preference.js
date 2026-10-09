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
const { verifyDirectBookingAmount } = require('./_direct-pricing');
const { normalizeCode } = require('./_discount-store');
const { GUEST_ORDER_REF_RE } = require('./_guest-payments');
const crypto = require('crypto');

/* Comparación de tokens en tiempo constante (evita timing oracle sobre publicToken). */
function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
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

function originFromEvent(event) {
  const proto = event.headers['x-forwarded-proto'] || 'https';
  const host = event.headers.host || 'estar.com.co';
  return `${proto}://${host}`;
}

function clean(value, max) {
  return String(value || '').trim().slice(0, max || 200);
}

/* URL de notificación del webhook. `source_news=webhooks` le pide a Mercado Pago
   que mande SOLO el formato Webhooks (no además el IPN legado con
   topic=merchant_order/payment): una sola notificación por evento de pago. */
function notificationUrl(base) {
  return `${base}/api/mercadopago-webhook?source_news=webhooks`;
}

/* back_urls de la reserva directa. El huésped que reservó en /en/ vuelve a
   /en/reservar.html (antes volvía siempre a la versión en español). Las
   variables MERCADOPAGO_*_URL siguen mandando para el español; para inglés se
   deriva la misma URL con el prefijo /en/. */
function directBackUrls(base, lang, env = process.env) {
  const isEn = String(lang || '').toLowerCase() === 'en';
  const page = isEn ? '/en/reservar.html' : '/reservar.html';
  const pick = (envUrl, status) => {
    const fallback = `${base}${page}?payment=${status}`;
    if (!envUrl) return fallback;
    if (!isEn) return envUrl;
    if (/\/en\/reservar\.html/.test(envUrl)) return envUrl;
    return /\/reservar\.html/.test(envUrl) ? envUrl.replace('/reservar.html', '/en/reservar.html') : fallback;
  };
  return {
    success: pick(env.MERCADOPAGO_SUCCESS_URL, 'success'),
    failure: pick(env.MERCADOPAGO_FAILURE_URL, 'failure'),
    pending: pick(env.MERCADOPAGO_PENDING_URL, 'pending')
  };
}

/* Mismas reglas que create-wompi-signature (nota A8 y opt-in Ley 1581). */
function sanitizeIncomingNotes(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw.replace(/[<>\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
}
function parseMarketingOptIn(raw) {
  return raw === true || raw === 'true' || raw === 1 || raw === '1';
}

/* Persiste los datos laterales de la reserva (mismos stores y claves que la ruta
   Wompi) para que mercadopago-webhook los use al crear la reserva: código de
   descuento aplicado (para consumir el uso), nota del huésped y opt-in de
   marketing. Best-effort: nunca bloquea la preferencia. */
async function persistDirectSideData({ bookingCode, email, discountCode, amountCents, notes, marketingOptIn, lang }, deps = {}) {
  const getStoreImpl = deps.getStore || ((name) => require('@netlify/blobs').getStore({ name, consistency: 'strong' }));
  const flagImpl = deps.flag || require('./_settings').flag;
  const saved = { discount: false, notes: false, marketing: false, lang: false };
  if (!bookingCode) return saved;
  /* Idioma del huésped: el webhook manda la confirmación en ese idioma. */
  if (String(lang || '').toLowerCase() === 'en') {
    saved.lang = await require('./_booking-lang').saveBookingLang(bookingCode, 'en', { getStore: getStoreImpl });
  }
  if (discountCode) {
    try {
      await getStoreImpl('booking-discounts').set(`disc-${bookingCode}`, JSON.stringify({
        code: discountCode, email: email || '', signedAmountCents: amountCents,
        provider: 'mercadopago', createdAt: new Date().toISOString()
      }));
      saved.discount = true;
    } catch (e) { console.warn('[create-mercadopago-preference] discount persist failed (non-fatal):', e.message); }
  }
  if (notes) {
    let on = false;
    try { on = await flagImpl('GUEST_NOTES_TO_PMS_ENABLED'); } catch (e) { on = false; }
    if (on) {
      try {
        await getStoreImpl('booking-notes').set(`note-${bookingCode}`, JSON.stringify({ notes, createdAt: new Date().toISOString() }));
        saved.notes = true;
      } catch (e) { console.warn('[create-mercadopago-preference] note persist failed (non-fatal):', e.message); }
    }
  }
  if (marketingOptIn) {
    try {
      await getStoreImpl('booking-marketing').set(`mkt-${bookingCode}`, JSON.stringify({
        accepted: true, email: email || '', channel: 'motor-reserva-directa', createdAt: new Date().toISOString()
      }));
      saved.marketing = true;
    } catch (e) { console.warn('[create-mercadopago-preference] marketing opt-in persist failed (non-fatal):', e.message); }
  }
  return saved;
}

function shouldUseSandboxCheckout(event) {
  const mode = String(process.env.MERCADOPAGO_CHECKOUT_MODE || '').toLowerCase();
  if (mode === 'sandbox' || mode === 'test') return true;
  if (mode === 'production' || mode === 'prod') return false;
  const host = String((event && event.headers && event.headers.host) || '').toLowerCase();
  if (host.includes('deploy-preview-') || host.includes('--')) return true;
  return process.env.CONTEXT && process.env.CONTEXT !== 'production';
}

function selectedCheckoutPoint(mp, event) {
  const useSandbox = shouldUseSandboxCheckout(event);
  return {
    checkoutMode: useSandbox ? 'sandbox' : 'production',
    initPoint: useSandbox && mp.sandbox_init_point ? mp.sandbox_init_point : mp.init_point
  };
}

function paymentError(message, statusCode, code) {
  const err = new Error(message);
  err.statusCode = statusCode || 500;
  err.code = code || 'mercadopago_preference_error';
  return err;
}

async function createPreference(preference) {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!accessToken) {
    throw paymentError('MERCADOPAGO_ACCESS_TOKEN is not configured', 503, 'mercadopago_access_token_missing');
  }

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
    const message = data.message || data.error || 'Mercado Pago rejected the preference';
    throw paymentError(`Mercado Pago preference failed with status ${res.status}: ${message}`, 502, 'mercadopago_preference_rejected');
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

  /* Mismo gate que la ruta Wompi: sin el publicToken correcto no se abre checkout.
     Antes MP no lo exigía, así que enumerar COT-YYYY-XXXXX devolvía amountCents y
     una página de pago con el nombre de la empresa (fuga de datos B2B). */
  const publicToken = clean(body.publicToken || body.t, 80);
  if (quote.publicToken && !timingSafeEqual(publicToken, quote.publicToken)) {
    return json(403, { error: 'Invalid access token' });
  }

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
    notification_url: notificationUrl(base),
    metadata: { quote_id: quoteId, expected_amount_cents: totalCents, source: 'quote' }
  };

  const mp = await createPreference(preference);
  const checkout = selectedCheckoutPoint(mp, event);
  return json(200, {
    provider: 'mercadopago',
    checkout_mode: checkout.checkoutMode,
    id: mp.id,
    init_point: checkout.initPoint,
    production_init_point: mp.init_point,
    sandbox_init_point: mp.sandbox_init_point,
    reference: quoteId,
    amountCents: totalCents
  });
}

async function preferenceForDirectBooking(body, event, overrides = {}) {
  const deps = {
    verifyDirectBookingAmount,
    createPreference,
    flag: require('./_settings').flag,
    persistDirectSideData,
    ...overrides
  };
  const bookingCode = clean(body.bookingCode, 40);
  const amountCents = Math.max(0, parseInt(body.amountCents, 10) || 0);
  if (!bookingCode || amountCents <= 0) return json(400, { error: 'Missing bookingCode or amountCents' });
  if (!body.checkin || !body.checkout || !body.roomTypeId || !body.firstName || !body.lastName || !body.email || !body.phone) {
    return json(400, { error: 'Missing reservation fields' });
  }

  /* Código de descuento (Frente A), igual que la ruta Wompi: solo con
     DISCOUNT_CODES_ENABLED; se revalida aquí y el monto a cobrar es el YA
     descontado (verificado contra OTASync). Antes MP ignoraba el código: el motor
     mandaba el monto completo y el huésped pagaba sin descuento. */
  let discountCode = '';
  let discountOn = false;
  try { discountOn = await deps.flag('DISCOUNT_CODES_ENABLED'); } catch (e) { discountOn = false; }
  if (discountOn) discountCode = normalizeCode(body.discountCode);

  /* SERVER-SIDE PRICE VERIFICATION (C-2). The client cannot be trusted to set
     amountCents: recompute the authoritative subtotal from OTASync and refuse
     to create a preference for a tampered amount. Mirrors the Wompi path in
     create-wompi-signature.js so both providers have the same protection. */
  const decodedLike = {
    checkin: clean(body.checkin, 10),
    checkout: clean(body.checkout, 10),
    guestsCount: Math.max(1, parseInt(body.guestsCount, 10) || 1),
    roomTypeId: clean(body.roomTypeId, 20),
    extrasMask: clean(body.extrasMask, 20) || '000000',
    email: clean(body.email, 254)
  };
  let verdict;
  try {
    verdict = await deps.verifyDirectBookingAmount(decodedLike, amountCents,
      discountCode ? { discountCode, email: decodedLike.email } : {});
  } catch (e) {
    console.error('[create-mercadopago-preference] price recompute failed:', e.message);
    return json(503, { error: 'price_check_unavailable' });
  }
  if (!verdict.ok) {
    console.error(`[create-mercadopago-preference] price verification failed: bookingCode=${bookingCode}, roomType=${decodedLike.roomTypeId}, client=${amountCents}, reason=${verdict.reason}`);
    return json(400, { error: verdict.reason || 'price_mismatch' });
  }
  if (verdict.isMock && (process.env.NODE_ENV === 'production' || process.env.NETLIFY === 'true')) {
    console.error('[create-mercadopago-preference] OTASync credentials missing in production. Refusing to create preference.');
    return json(503, { error: 'OTASync credentials missing' });
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
    amountCents,
    /* Plan elegido (respaldo): el webhook lo deriva del MONTO pagado; este
       campo solo se usa si no puede recomputarlo. */
    ratePlan: verdict.matchedPlan || (String(body.ratePlan || '').toLowerCase() === 'flexible' ? 'flexible' : 'best')
  });

  /* Datos laterales para el webhook (mismos stores que Wompi): descuento
     aplicado (para consumir el uso tras crear la reserva), nota y opt-in. */
  const discountApplied = !!(discountCode && verdict.discount && verdict.discount.applied);
  await deps.persistDirectSideData({
    bookingCode,
    email: clean(body.email, 254),
    discountCode: discountApplied ? discountCode : '',
    amountCents,
    notes: sanitizeIncomingNotes(body.notes),
    marketingOptIn: parseMarketingOptIn(body.marketingOptIn),
    lang: body.lang
  });

  const base = originFromEvent(event);
  const backUrls = directBackUrls(base, body.lang);

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
    back_urls: backUrls,
    auto_return: 'approved',
    notification_url: notificationUrl(base),
    metadata: {
      booking_code: bookingCode, expected_amount_cents: amountCents, source: 'direct',
      ...(discountApplied ? { discount_code: discountCode } : {})
    }
  };

  const mp = await deps.createPreference(preference);
  const checkout = selectedCheckoutPoint(mp, event);
  return json(200, {
    provider: 'mercadopago',
    checkout_mode: checkout.checkoutMode,
    id: mp.id,
    init_point: checkout.initPoint,
    production_init_point: mp.init_point,
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

  /* Lambda-compat de Netlify: conectar Blobs con el contexto del evento (los
     datos laterales de la reserva se guardan en Blobs). Best-effort. */
  if (event.blobs) {
    try {
      const blobs = require('@netlify/blobs');
      if (typeof blobs.connectLambda === 'function') blobs.connectLambda(event);
    } catch (e) { /* best-effort */ }
  }

  /* Guest-app service orders (GST-...) are NOT created here. Their amount is the
     server-computed catalogue total of an authenticated guest order, so the
     preference is built inside the authenticated guest-action flow
     (_guest-payments.createGuestMercadoPagoCheckout). Reject any attempt to mint
     one from this public, unauthenticated endpoint so a tampered request can't
     charge a folio it never authorised. */
  if (body.source === 'guest' || GUEST_ORDER_REF_RE.test(String(body.reference || body.quoteId || body.id || ''))) {
    return json(400, { error: 'guest_orders_not_supported_here', message: 'Los pagos de servicios del huésped se generan desde la app del huésped.' });
  }

  try {
    if (body.type === 'quote' || body.quoteId || body.id) return await preferenceForQuote(body, event);
    return await preferenceForDirectBooking(body, event);
  } catch (e) {
    console.error('[create-mercadopago-preference]', e.message);
    return json(e.statusCode || 500, {
      error: 'Failed to create Mercado Pago preference',
      code: e.code || 'mercadopago_preference_error',
      message: e.code === 'mercadopago_access_token_missing'
        ? 'Mercado Pago access token is not configured in Netlify.'
        : e.message.replace(/^Mercado Pago preference failed with status \d+:\s*/, '')
    });
  }
};

exports._test = {
  preferenceForDirectBooking, directBackUrls, notificationUrl, persistDirectSideData,
  sanitizeIncomingNotes, parseMarketingOptIn
};
