const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');
const {
  getQuoteStore, loadQuote, saveQuote, effectiveStatus, computeQuoteTotal
} = require('./_quotes-store');
const {
  hasOtasyncCreds, getAvailabilityByType, findUnavailable,
  releaseHold, createConfirmedReservation
} = require('./_otasync');
const { sendEmail, adminEmail, paymentConfirmationHtml, adminPendingHtml } = require('./_email');

const QUOTE_ID_RE = /^COT-\d{4}-[A-Z0-9]{5}$/;
const DIRECT_REF_RE = /^MPDIR-[A-Za-z0-9_-]+$/;
const CURRENCY = 'COP';

const processedTransactionIds = new Set();
let txStore;
try {
  txStore = getStore({ name: 'processed-transactions', consistency: 'strong' });
} catch (e) {
  txStore = null;
}

function normalizeStatus(provider, status) {
  const s = String(status || '').toLowerCase();
  if (provider === 'mercadopago') {
    if (s === 'approved') return 'approved';
    if (s === 'pending' || s === 'in_process' || s === 'authorized') return 'pending';
    if (s === 'rejected' || s === 'cancelled') return 'rejected';
    return 'failed';
  }
  if (s === 'approved') return 'approved';
  if (s === 'pending') return 'pending';
  if (s === 'declined' || s === 'voided') return 'rejected';
  return 'failed';
}

function normalizeTransaction(provider, raw) {
  if (provider === 'mercadopago') {
    const status = normalizeStatus(provider, raw.status);
    const amount = Number(raw.transaction_amount || raw.total_paid_amount || 0);
    return {
      id: String(raw.id || ''),
      provider,
      status,
      rawStatus: raw.status,
      reference: String(raw.external_reference || ''),
      amountCents: Math.round(amount * 100),
      amount: amount,
      currency: raw.currency_id || CURRENCY,
      paymentMethod: raw.payment_method_id || raw.payment_type_id || 'mercadopago',
      approved: status === 'approved'
    };
  }
  return {
    id: String(raw.id || ''),
    provider,
    status: normalizeStatus(provider, raw.status),
    rawStatus: raw.status,
    reference: String(raw.reference || ''),
    amountCents: Number(raw.amount_in_cents || 0),
    amount: Number(raw.amount_in_cents || 0) / 100,
    currency: raw.currency || CURRENCY,
    paymentMethod: raw.payment_method_type || 'card',
    approved: String(raw.status || '').toUpperCase() === 'APPROVED'
  };
}

async function alreadyProcessed(transactionId) {
  if (!transactionId) return false;
  if (processedTransactionIds.has(transactionId)) return true;
  if (!txStore) return false;
  try {
    return !!(await txStore.get(String(transactionId)));
  } catch (e) {
    return false;
  }
}

async function markProcessed(transactionId) {
  if (!transactionId) return;
  processedTransactionIds.add(transactionId);
  if (txStore) {
    try { await txStore.set(String(transactionId), '1', { ttl: 86400 }); } catch (e) { /* non-fatal */ }
  }
}

function toUrlSafeBase64(str) {
  return Buffer.from(str, 'utf8').toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromUrlSafeBase64(str) {
  let base64 = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  return Buffer.from(base64, 'base64').toString('utf8');
}

function cleanPart(value, max) {
  return String(value || '').replace(/\|/g, ' ').trim().slice(0, max || 200);
}

function createDirectReference(payload) {
  const parts = [
    '2',
    cleanPart(payload.checkin, 10),
    cleanPart(payload.checkout, 10),
    Math.max(1, parseInt(payload.guestsCount, 10) || 1),
    cleanPart(payload.roomTypeId, 20),
    cleanPart(payload.firstName, 80),
    cleanPart(payload.lastName, 80),
    cleanPart(payload.email, 254),
    cleanPart(payload.phone, 50),
    cleanPart(payload.extrasMask, 20),
    cleanPart(payload.bookingCode, 40),
    payload.isColombian ? '1' : '0',
    payload.isBusiness ? '1' : '0',
    Math.max(0, parseInt(payload.amountCents, 10) || 0)
  ];
  return `MPDIR-${toUrlSafeBase64(parts.join('|'))}`;
}

function decodeDirectReference(ref) {
  if (!DIRECT_REF_RE.test(String(ref || ''))) return null;
  try {
    const decoded = fromUrlSafeBase64(String(ref).slice('MPDIR-'.length));
    const parts = decoded.split('|');
    if (parts[0] !== '2' || parts.length < 14) return null;
    return {
      checkin: parts[1],
      checkout: parts[2],
      guestsCount: parseInt(parts[3], 10) || 1,
      roomTypeId: parts[4],
      firstName: parts[5],
      lastName: parts[6],
      email: parts[7],
      phone: parts[8],
      extrasMask: parts[9] || '',
      bookingCode: parts[10],
      isColombian: parts[11] === '1',
      isBusiness: parts[12] === '1',
      amountCents: parseInt(parts[13], 10) || 0
    };
  } catch (e) {
    return null;
  }
}

function sanitizePhone(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw.replace(/[^\d+\s]/g, '').trim().substring(0, 20);
}

function escapeHtml(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function processQuotePayment(transaction, corsHeaders) {
  const quoteId = transaction.reference;
  let store, quote;
  try {
    store = getQuoteStore();
    quote = await loadQuote(store, quoteId);
  } catch (e) {
    console.error('[payments] quote store unavailable:', e.message);
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: 'Quote store unavailable; logged for manual follow-up' }) };
  }

  if (!quote) {
    console.error(`[payments] quote ${quoteId} not found for transaction ${transaction.id}`);
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: 'Quote not found' }) };
  }

  if (quote.status === 'aceptada') {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ received: true, duplicate: true }) };
  }

  const status = effectiveStatus(quote);
  if (status === 'cancelada' || status === 'vencida') {
    console.error(`[payments] paid transaction ${transaction.id} for ${status} quote ${quoteId}. Manual follow-up required.`);
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: `Quote is ${status}; logged for manual follow-up` }) };
  }

  const { totalCents } = computeQuoteTotal(quote);
  if (Math.abs(transaction.amountCents - totalCents) > 100) {
    console.error(`[payments] amount mismatch for quote ${quoteId}: paid=${transaction.amountCents} expected=${totalCents}, tx=${transaction.id}. Reservation NOT created.`);
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: 'Amount mismatch; logged for manual follow-up' }) };
  }

  const now = new Date().toISOString();
  const paidAmount = transaction.amountCents / 100;

  if (!hasOtasyncCreds()) {
    quote.status = 'aceptada';
    quote.paidAt = now;
    quote.transactionId = transaction.id;
    quote.paymentProvider = transaction.provider;
    quote.bookingCodes = [];
    quote.updatedAt = now;
    try { await saveQuote(store, quote); } catch (e) { /* non-fatal */ }
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, mock: true, quoteId }) };
  }

  const hasHold = Array.isArray(quote.holdReservationIds) && quote.holdReservationIds.length > 0;
  if (hasHold) {
    for (const holdId of quote.holdReservationIds) {
      try { await releaseHold(holdId); } catch (e) { console.error('[payments] releaseHold failed for', quoteId, holdId, e.message); }
    }
    quote.holdReservationIds = [];
  }

  if (!hasHold && quote.checkin && quote.checkout) {
    try {
      const { availByType, isMock } = await getAvailabilityByType(quote.checkin, quote.checkout);
      if (!isMock) {
        const shortfalls = findUnavailable(quote.items, availByType);
        if (shortfalls.length > 0) {
          console.error(`[payments] PAID but UNAVAILABLE for quote ${quoteId}, tx ${transaction.id}: ${JSON.stringify(shortfalls)}.`);
          quote.status = 'aceptada';
          quote.paidAt = now;
          quote.transactionId = transaction.id;
          quote.paymentProvider = transaction.provider;
          quote.bookingCodes = [];
          quote.reservationPending = true;
          quote.availabilityOk = false;
          quote.unavailable = shortfalls;
          quote.updatedAt = now;
          try { await saveQuote(store, quote); } catch (e) { /* non-fatal */ }
          try {
            await sendEmail({
              to: adminEmail(),
              subject: `Pago sin reserva - ${quoteId}`,
              html: adminPendingHtml({ quote, transactionId: transaction.id, shortfalls })
            });
          } catch (e) { console.error('[payments] admin alert email failed:', e.message); }
          return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, quoteId, reservationPending: true }) };
        }
      }
    } catch (e) {
      console.error('[payments] availability re-check failed (continuing to book):', e.message);
    }
  }

  const recordPending = async (reason) => {
    quote.status = 'aceptada';
    quote.paidAt = now;
    quote.transactionId = transaction.id;
    quote.paymentProvider = transaction.provider;
    quote.bookingCodes = [];
    quote.reservationPending = true;
    quote.updatedAt = now;
    try { await saveQuote(store, quote); } catch (e) { /* non-fatal */ }
    try {
      await sendEmail({
        to: adminEmail(),
        subject: `Pago sin reserva - ${quoteId}`,
        html: adminPendingHtml({ quote, transactionId: transaction.id, shortfalls: [] })
      });
    } catch (e) { console.error('[payments] admin alert email failed:', e.message); }
    console.error(`[payments] reservation ${reason} for quote ${quoteId}, tx ${transaction.id}; marked reservationPending.`);
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, quoteId, reservationPending: true }) };
  };

  let bookingCode;
  try {
    bookingCode = await createConfirmedReservation(quote, {
      paidAmount,
      transactionId: transaction.id,
      paymentProvider: transaction.provider
    });
  } catch (e) {
    return await recordPending('failed: ' + e.message);
  }

  quote.status = 'aceptada';
  quote.paidAt = now;
  quote.transactionId = transaction.id;
  quote.paymentProvider = transaction.provider;
  quote.bookingCodes = [bookingCode];
  quote.reservationPending = false;
  quote.updatedAt = now;
  try { await saveQuote(store, quote); } catch (e) { console.error('[payments] failed to mark quote accepted:', e.message); }

  try {
    if (quote.email) {
      await sendEmail({
        to: quote.email,
        cc: adminEmail(),
        subject: `Reserva confirmada ${bookingCode} - Hotel Estar`,
        html: paymentConfirmationHtml({ quote, bookingCode, total: paidAmount })
      });
    }
  } catch (e) { console.error('[payments] confirmation email failed:', e.message); }

  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, quoteId, bookingCode }) };
}

async function processDirectPayment(transaction, corsHeaders) {
  const decoded = decodeDirectReference(transaction.reference);
  if (!decoded) {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: 'Reference was not an encoded direct reservation payload' }) };
  }

  if (decoded.amountCents && Math.abs(transaction.amountCents - decoded.amountCents) > 100) {
    console.error(`[payments] amount mismatch for direct booking ${decoded.bookingCode}: paid=${transaction.amountCents} expected=${decoded.amountCents}, tx=${transaction.id}.`);
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: 'Amount mismatch; logged for manual follow-up' }) };
  }

  if (!hasOtasyncCreds()) {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ success: true, mock: true, bookingCode: decoded.bookingCode })
    };
  }

  const fs = require('fs');
  const path = require('path');
  const { otasyncCreds, getSessionKey } = require('./_otasync');
  const { token, propertyId } = otasyncCreds();
  const pkey = await getSessionKey();

  let roomDetails = {};
  try {
    const dbPath = path.join(__dirname, '../../rooms_db.json');
    if (fs.existsSync(dbPath)) roomDetails = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  } catch (e) { /* fall back to default name */ }

  const checkinDate = new Date(decoded.checkin);
  const checkoutDate = new Date(decoded.checkout);
  const nights = Math.max(1, Math.ceil((checkoutDate - checkinDate) / 86400000));
  const paidAmount = transaction.amountCents / 100;
  const mustPayIva = decoded.isColombian || decoded.isBusiness;
  const roomPrice = mustPayIva ? Math.round(paidAmount * 1.19) : paidAmount;
  const avgPrice = Math.round(roomPrice / nights);
  const matchedRoom = roomDetails[decoded.roomTypeId];
  const roomName = matchedRoom ? matchedRoom.name : 'Clasica';

  const nightsArray = [];
  const nightsDates = [];
  for (let i = 0; i < nights; i++) {
    const d = new Date(checkinDate);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];
    nightsDates.push(dateStr);
    nightsArray.push({ night_date: dateStr, price: avgPrice, original_price: avgPrice, breakfast: 0, lunch: 0, dinner: 0 });
  }

  const paymentInfo = [{
    amount: paidAmount,
    date_payment: new Date().toISOString().split('T')[0],
    payment_method: 'card',
    note: `${transaction.provider} ID: ${transaction.id}, Ref: ${decoded.bookingCode}, Status: APPROVED`
  }];

  const extrasList = [];
  const extraNames = ['Desayuno', 'Parqueadero', 'Late Check-out', 'Early Check-in', 'Traslado Aeropuerto', 'Tour Manizales'];
  for (let i = 0; i < 6; i++) {
    if (decoded.extrasMask[i] === '1') extrasList.push(extraNames[i]);
  }
  const extrasText = extrasList.length > 0 ? extrasList.join(', ') : 'Ninguno';

  const payload = {
    key: pkey,
    id_properties: propertyId,
    token,
    status: 'confirmed',
    rooms: [{
      id_room_types: parseInt(decoded.roomTypeId, 10),
      id_rooms: 0,
      room_type: roomName,
      room_number: '',
      avg_price: avgPrice,
      total_price: roomPrice,
      children_1: 0, children_2: 0, children_3: 0,
      adults: decoded.guestsCount || 1,
      seniors: 0,
      extras: [],
      payments: paymentInfo,
      overbooking: 0,
      nights: nightsArray
    }],
    guests: [{
      first_name: decoded.firstName,
      last_name: decoded.lastName,
      id_guests: 0,
      guest_type: 'adults'
    }],
    extras: [],
    payments: paymentInfo,
    children_1: 0, children_2: 0, children_3: 0,
    adults: decoded.guestsCount || 1,
    seniors: 0,
    total_guests: decoded.guestsCount || 1,
    discount_type: 'percent',
    discount_amount: 0,
    discount_note: '',
    rooms_price: roomPrice,
    rooms_discounted: roomPrice,
    extras_price: 0,
    board_price: 0,
    city_tax_price: 0,
    insurance_price: 0,
    total_price: roomPrice,
    id_boards: '',
    id_reservations: 0,
    nights,
    nights_dates: nightsDates,
    reservation_type: 'web',
    active_id_room_types: String(decoded.roomTypeId),
    preselected_id_rooms: 0,
    reference: decoded.bookingCode || 'Hotel Estar Custom Booking Engine',
    id_contigents: 0,
    date_arrival: decoded.checkin,
    date_departure: decoded.checkout,
    id_channels: '392',
    channel: 'Private reservation',
    note: `Telefono del huesped: ${sanitizePhone(decoded.phone)}. Extras: ${escapeHtml(extrasText)}. IVA (19%): ${mustPayIva ? 'POR COBRAR EN HOTEL (' + Math.round(paidAmount * 0.19) + ')' : 'EXENTO'}. Creado por Webhook ${transaction.provider}. ID Transaccion: ${transaction.id}`
  };

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 10000);
  let response;
  try {
    response = await fetch('https://app.otasync.me/api/reservation/insert/reservation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
    clearTimeout(tid);
  } catch (err) {
    clearTimeout(tid);
    throw err.name === 'AbortError' ? new Error('Request timeout during reservation insert') : err;
  }
  if (!response.ok) throw new Error(`insert/reservation returned status ${response.status}`);
  const data = await response.json();
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({ success: true, bookingCode: data.id_reservations || decoded.bookingCode })
  };
}

async function processApprovedPayment(transaction, corsHeaders) {
  if (transaction.currency !== CURRENCY) {
    console.error(`[payments] invalid currency ${transaction.currency} for tx ${transaction.id}`);
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: 'Invalid currency; logged for manual follow-up' }) };
  }
  if (await alreadyProcessed(transaction.id)) {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ received: true, duplicate: true }) };
  }
  const result = QUOTE_ID_RE.test(transaction.reference || '')
    ? await processQuotePayment(transaction, corsHeaders)
    : await processDirectPayment(transaction, corsHeaders);
  if (result && result.statusCode >= 200 && result.statusCode < 300) {
    await markProcessed(transaction.id);
  }
  return result;
}

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

module.exports = {
  QUOTE_ID_RE,
  CURRENCY,
  normalizeStatus,
  normalizeTransaction,
  createDirectReference,
  decodeDirectReference,
  processApprovedPayment,
  alreadyProcessed,
  markProcessed,
  timingSafeEqualString
};
