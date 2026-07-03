/* Server-side price recomputation for direct (non-quote) Wompi bookings.
   The Wompi reference encodes roomTypeId, dates, extras mask and IVA flags;
   the actual price MUST come from OTASync, not the client, so a malicious
   client cannot pay $1 for a $300k room. Quote payments (COT-...) take a
   different path via _quotes-store.computeQuoteTotal. */

const { getDynamicPricing } = require('./_otasync');
const { EXTRAS_PRICES, EXTRAS_KEYS } = require('./_pricing');
const { verifyDiscountCode } = require('./_discount-store');

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
    const [, checkinYYMMDD, checkoutYYMMDD, guestsCount, roomTypeId, , , email, , extrasMask, bookingCode] = parts;
    if (!/^\d{6}$/.test(checkinYYMMDD) || !/^\d{6}$/.test(checkoutYYMMDD)) return null;
    const result = {
      bookingCode,
      /* Email (parts[7]) — mirrors wompi-webhook.decodeReference so the
         one-use-per-email discount gate validates with the SAME email at
         signing time and at webhook time (else a onePerEmail code passes at
         signing but is rejected at the webhook, stranding a captured payment). */
      email: email || '',
      checkin: `20${checkinYYMMDD.substring(0, 2)}-${checkinYYMMDD.substring(2, 4)}-${checkinYYMMDD.substring(4, 6)}`,
      checkout: `20${checkoutYYMMDD.substring(0, 2)}-${checkoutYYMMDD.substring(2, 4)}-${checkoutYYMMDD.substring(4, 6)}`,
      guestsCount: parseInt(guestsCount) || 1,
      roomTypeId,
      extrasMask: extrasMask || '000000',
      isColombian: parts[11] === '1' ? true : parts[11] === '0' ? false : undefined,
      isBusiness:  parts[12] === '1' ? true : parts[12] === '0' ? false : undefined
    };
    if (parts[13]) {
      result.amountCents = parseInt(parts[13], 10) || 0;
    }
    return result;
  } catch (e) {
    return null;
  }
}

/* Extras prices and the mask order live in ./_pricing (single source of truth,
   mirrored by reservar.html). */

/* Accept up to 0.5% drift to absorb int rounding when the front-end derives
   the flexible rate via `Math.round(best * 1.10)` (+10% exacto). */
const PRICE_TOLERANCE_RATIO = 0.005;

function computeExtrasTotal(extrasMask, guests, nights, baseNightly) {
  if (!extrasMask) return 0;
  let total = 0;
  for (let i = 0; i < EXTRAS_KEYS.length; i++) {
    if (extrasMask[i] !== '1') continue;
    const ex = EXTRAS_PRICES[EXTRAS_KEYS[i]];
    if (!ex) continue;
    if (ex.multiplier === 'perGuestPerNight') total += ex.price * guests * nights;
    else if (ex.multiplier === 'perNight') total += ex.price * nights;
    else if (ex.multiplier === 'pctOfNight') total += Math.round((baseNightly || 0) * ex.pct);
    else total += ex.price;
  }
  return total;
}

/* Given the decoded reference, returns the set of valid subtotals (in COP,
   excluding IVA — matching the front-end `calc.subtotal`). The reference
   does NOT encode the rate plan (Best Price vs Flexible), so we accept
   either as a valid total.

   Frente A: `opts.discountCode` (+ opts.email) applies a server-validated
   discount on top of each candidate subtotal. The discount code travels OUT of
   the Wompi reference (length/255 limit) — the caller (create-wompi-signature /
   wompi-webhook) passes it separately and we re-validate it here. `finalSubtotals`
   is what the client must actually pay; `expectedSubtotals` stays the pre-discount
   value for diagnostics. When the code is invalid, finalSubtotals === expectedSubtotals
   (no discount) and discount.applied=false.

   Returns { isMock, nights, available, expectedSubtotals, finalSubtotals,
   extrasTotal, discount } or { isMock: true, ... } when OTASync credentials
   are absent. `opts.deps` is injected in tests so the discount store needs no
   real Blobs. */
async function computeDirectBookingTotals(decoded, opts = {}) {
  const guests = Math.max(1, parseInt(decoded.guestsCount) || 1);
  const pricing = await getDynamicPricing(decoded.checkin, decoded.checkout, guests);
  const nights = pricing.nights;

  if (pricing.isMock) {
    /* Without OTASync credentials we cannot recompute authoritatively. The
       caller decides whether to accept (dev) or reject (production). */
    return { isMock: true, nights, available: undefined, expectedSubtotals: [], finalSubtotals: [], extrasTotal: 0, discount: { applied: false } };
  }

  const roomData = pricing.byRoomType[String(decoded.roomTypeId)];
  if (!roomData) {
    return { isMock: false, nights, available: false, expectedSubtotals: [], finalSubtotals: [], extrasTotal: 0, missing: true, discount: { applied: false } };
  }

  /* Front-end: priceFlexible = apiRoom.avgPrice (the value returned by OTA
     after the extra-guest surcharge is added). Best Price = priceFlexible,
     Flexible rate = round(priceFlexible * 1.10) (+10% exacto). Percentage
     extras (late/early) use the BASE nightly (avgPrice = Best Price). */
  const bestNightly = roomData.avgPrice;
  const flexibleNightly = Math.round(roomData.avgPrice * 1.10);
  const extrasTotal = computeExtrasTotal(decoded.extrasMask, guests, nights, bestNightly);

  const bestSubtotal = bestNightly * nights + extrasTotal;
  const flexibleSubtotal = flexibleNightly * nights + extrasTotal;
  const expectedSubtotals = [bestSubtotal, flexibleSubtotal];

  /* Apply a validated discount (Frente A). The discount is computed per
     candidate subtotal (percent → proportional; fixed → same cents capped at
     the subtotal). finalSubtotals === expectedSubtotals when no/invalid code. */
  let discount = { applied: false };
  let finalSubtotals = expectedSubtotals;
  if (opts.discountCode) {
    const verify = opts.verifyDiscountCode || verifyDiscountCode;
    /* Validate against the LOWER subtotal (best) for the gate (eligibility is
       price-independent; the discountCents we report below is per-candidate). */
    let verdict;
    try {
      verdict = await verify({
        code: opts.discountCode,
        email: opts.email || decoded.email || '',
        nights,
        roomTypeId: decoded.roomTypeId,
        checkin: decoded.checkin,
        checkout: decoded.checkout,
        subtotalCents: Math.round(bestSubtotal * 100)
      }, opts.deps);
    } catch (e) {
      verdict = { valid: false, reason: 'unavailable' };
    }
    if (verdict && verdict.valid && verdict.def) {
      finalSubtotals = expectedSubtotals.map(sub => {
        const cents = Math.round(sub * 100);
        const dc = require('./_discount-store').discountCentsFor(verdict.def, cents);
        return Math.max(0, Math.round((cents - dc) / 100));
      });
      discount = {
        applied: true,
        code: opts.discountCode,
        type: verdict.def.type,
        value: verdict.def.value
      };
    } else {
      discount = { applied: false, reason: (verdict && verdict.reason) || 'invalid' };
    }
  }

  return {
    isMock: false,
    nights,
    available: roomData.available,
    expectedSubtotals,
    finalSubtotals,
    extrasTotal,
    discount
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

/* Returns { ok, isMock, reason, expectedCents, actualCents, discount } where
   ok=true means the client amount matches one of the valid subtotals.

   Frente A: when `opts.discountCode` is supplied AND it validates server-side,
   the authoritative expected amounts are the DISCOUNTED subtotals — a tampered
   client amount that paid the full price (or any other amount) is rejected. If
   the code does not validate, we fall back to the undiscounted subtotals so a
   stale/expired code never grants a discount but also never blocks a correct
   full-price payment. `opts` is forwarded to computeDirectBookingTotals
   (discountCode, email, deps, verifyDiscountCode). */
async function verifyDirectBookingAmount(decoded, clientAmountInCents, opts = {}) {
  const totals = await computeDirectBookingTotals(decoded, opts);
  if (totals.isMock) {
    return { ok: true, isMock: true, reason: 'mock_fallback', expectedCents: null, actualCents: clientAmountInCents, discount: totals.discount };
  }
  if (totals.missing) {
    return { ok: false, isMock: false, reason: 'room_not_found', expectedCents: null, actualCents: clientAmountInCents, discount: totals.discount };
  }
  if (totals.available !== undefined && totals.available <= 0) {
    return { ok: false, isMock: false, reason: 'sold_out', expectedCents: null, actualCents: clientAmountInCents, discount: totals.discount };
  }

  /* When a valid discount applied, the expected set is the discounted subtotals.
     Otherwise it is the undiscounted set. */
  const sourceSubtotals = (totals.discount && totals.discount.applied)
    ? totals.finalSubtotals
    : totals.expectedSubtotals;
  const expectedCentsList = sourceSubtotals.map(s => Math.round(s * 100));
  /* índice 0 = Best/Estricta (100% hasta 7 días) · índice 1 = Flexible (+10%, 100% hasta 24 h).
     El plan AUTORITATIVO se deriva de cuál subtotal coincidió, NO del campo de la
     referencia (controlado por el cliente) — así nadie paga Estricta y se registra
     Flexible. Si ambos colisionan (caso borde), se prefiere Best (conservador). */
  const matchedIdx = expectedCentsList.findIndex(ec => withinTolerance(clientAmountInCents, ec));
  if (matchedIdx !== -1) {
    const matched = expectedCentsList[matchedIdx];
    const matchedPlan = matchedIdx === 1 ? 'flexible' : 'best';
    return { ok: true, isMock: false, reason: 'match', expectedCents: matched, matchedPlan, actualCents: clientAmountInCents, discount: totals.discount };
  }
  return {
    ok: false,
    isMock: false,
    reason: 'price_mismatch',
    expectedCents: expectedCentsList[0],
    expectedCentsAll: expectedCentsList,
    actualCents: clientAmountInCents,
    discount: totals.discount
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
