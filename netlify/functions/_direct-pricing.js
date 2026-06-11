/* Server-side price recomputation for direct (non-quote) Wompi bookings.
   The Wompi reference encodes roomTypeId, dates, extras mask and IVA flags;
   the actual price MUST come from OTASync, not the client, so a malicious
   client cannot pay $1 for a $300k room. Quote payments (COT-...) take a
   different path via _quotes-store.computeQuoteTotal. */

const { getDynamicPricing } = require('./_otasync');

/* URL-safe base64 decode of the Wompi reservation reference. Mirrors the
   encoding in motor-app.jsx (PaymentPanel.handlePayment) and matches the
   decodeReference in wompi-webhook.js so we have a single source-of-truth
   for the pipe-delimited layout:
     1|YYMMDD|YYMMDD|guests|roomTypeId|firstName|lastName|email|phone|extrasMask|code|colombian|business
   Returns null when the reference is malformed (caller treats as opaque). */
function decodeDirectReference(ref) {
  try {
    if (!ref || !/^[a-zA-Z0-9\-_]+$/.test(ref)) return null;
    let base64 = ref.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    const decoded = Buffer.from(base64, 'base64').toString('utf8');
    if (!decoded.startsWith('1|')) return null;
    const parts = decoded.split('|');
    if (parts.length < 11) return null;
    const [, checkinYYMMDD, checkoutYYMMDD, guestsCount, roomTypeId, , , , , extrasMask, bookingCode] = parts;
    if (!/^\d{6}$/.test(checkinYYMMDD) || !/^\d{6}$/.test(checkoutYYMMDD)) return null;
    return {
      bookingCode,
      checkin: `20${checkinYYMMDD.substring(0, 2)}-${checkinYYMMDD.substring(2, 4)}-${checkinYYMMDD.substring(4, 6)}`,
      checkout: `20${checkoutYYMMDD.substring(0, 2)}-${checkoutYYMMDD.substring(2, 4)}-${checkoutYYMMDD.substring(4, 6)}`,
      guestsCount: parseInt(guestsCount) || 1,
      roomTypeId,
      extrasMask: extrasMask || '000000',
      isColombian: parts[11] === '1' ? true : parts[11] === '0' ? false : undefined,
      isBusiness:  parts[12] === '1' ? true : parts[12] === '0' ? false : undefined
    };
  } catch (e) {
    return null;
  }
}

/* Front-end calcTotal (reservar.html) extras and rate math, mirrored here.
   Keep these in sync with the values in reservar.html / motor-app.jsx. */
const EXTRAS_PRICES = {
  desayuno:    { price: 20000, multiplier: 'perGuestPerNight' },
  parqueadero: { price: 25000, multiplier: 'perNight' },
  late:        { price: 60000, multiplier: 'flat' },
  early:       { price: 50000, multiplier: 'flat' },
  /* Positions 4, 5 in the extras mask (traslado, tour) are reserved but
     currently not surfaced in the UI; treated as flat per-booking if ever
     re-enabled so the recompute does not break. */
  traslado:    { price: 0,     multiplier: 'flat' },
  tour:        { price: 0,     multiplier: 'flat' }
};
const EXTRAS_KEYS = ['desayuno', 'parqueadero', 'late', 'early', 'traslado', 'tour'];

/* Accept up to 0.5% drift to absorb int rounding when the front-end derives
   the flexible rate via `Math.round(best / 0.9)`. */
const PRICE_TOLERANCE_RATIO = 0.005;

function computeExtrasTotal(extrasMask, guests, nights) {
  if (!extrasMask) return 0;
  let total = 0;
  for (let i = 0; i < EXTRAS_KEYS.length; i++) {
    if (extrasMask[i] !== '1') continue;
    const ex = EXTRAS_PRICES[EXTRAS_KEYS[i]];
    if (!ex) continue;
    if (ex.multiplier === 'perGuestPerNight') total += ex.price * guests * nights;
    else if (ex.multiplier === 'perNight') total += ex.price * nights;
    else total += ex.price;
  }
  return total;
}

/* Given the decoded reference, returns the set of valid subtotals (in COP,
   excluding IVA — matching the front-end `calc.subtotal`). The reference
   does NOT encode the rate plan (Best Price vs Flexible), so we accept
   either as a valid total.

   Returns { isMock, nights, available, expectedSubtotals: number[] } or
   { isMock: true, ... } when OTASync credentials are absent. */
async function computeDirectBookingTotals(decoded) {
  const guests = Math.max(1, parseInt(decoded.guestsCount) || 1);
  const pricing = await getDynamicPricing(decoded.checkin, decoded.checkout, guests);
  const nights = pricing.nights;
  const extrasTotal = computeExtrasTotal(decoded.extrasMask, guests, nights);

  if (pricing.isMock) {
    /* Without OTASync credentials we cannot recompute authoritatively. The
       caller decides whether to accept (dev) or reject (production). */
    return { isMock: true, nights, available: undefined, expectedSubtotals: [], extrasTotal };
  }

  const roomData = pricing.byRoomType[String(decoded.roomTypeId)];
  if (!roomData) {
    return { isMock: false, nights, available: false, expectedSubtotals: [], extrasTotal, missing: true };
  }

  /* Front-end: priceFlexible = apiRoom.avgPrice (the value returned by OTA
     after the extra-guest surcharge is added). Best Price = priceFlexible,
     Flexible rate = round(priceFlexible / 0.9). */
  const bestNightly = roomData.avgPrice;
  const flexibleNightly = Math.round(roomData.avgPrice / 0.9);

  const bestSubtotal = bestNightly * nights + extrasTotal;
  const flexibleSubtotal = flexibleNightly * nights + extrasTotal;

  return {
    isMock: false,
    nights,
    available: roomData.available,
    expectedSubtotals: [bestSubtotal, flexibleSubtotal],
    extrasTotal
  };
}

function withinTolerance(actualCents, expectedCents) {
  if (expectedCents <= 0) return false;
  const diff = Math.abs(actualCents - expectedCents);
  /* Tolerate at least 1 peso (100 cents) AND PRICE_TOLERANCE_RATIO of total
     so rounding inside `Math.round(price * 100)` never trips the gate. */
  const allowed = Math.max(100, Math.round(expectedCents * PRICE_TOLERANCE_RATIO));
  return diff <= allowed;
}

/* Returns { ok, isMock, reason, expectedCents, actualCents } where
   ok=true means the client amount matches one of the valid subtotals. */
async function verifyDirectBookingAmount(decoded, clientAmountInCents) {
  const totals = await computeDirectBookingTotals(decoded);
  if (totals.isMock) {
    return { ok: true, isMock: true, reason: 'mock_fallback', expectedCents: null, actualCents: clientAmountInCents };
  }
  if (totals.missing) {
    return { ok: false, isMock: false, reason: 'room_not_found', expectedCents: null, actualCents: clientAmountInCents };
  }

  const expectedCentsList = totals.expectedSubtotals.map(s => Math.round(s * 100));
  const matched = expectedCentsList.find(ec => withinTolerance(clientAmountInCents, ec));
  if (matched !== undefined) {
    return { ok: true, isMock: false, reason: 'match', expectedCents: matched, actualCents: clientAmountInCents };
  }
  return {
    ok: false,
    isMock: false,
    reason: 'price_mismatch',
    expectedCents: expectedCentsList[0],
    expectedCentsAll: expectedCentsList,
    actualCents: clientAmountInCents
  };
}

module.exports = {
  decodeDirectReference,
  computeExtrasTotal,
  computeDirectBookingTotals,
  verifyDirectBookingAmount,
  withinTolerance,
  EXTRAS_KEYS,
  EXTRAS_PRICES,
  PRICE_TOLERANCE_RATIO
};
