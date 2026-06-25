/* Single source of truth for booking pricing constants (M-2, auditoría 360°).
 *
 * Before this module the extra-guest surcharge, the price fallback and the
 * booking-engine extras prices were duplicated across _otasync.js,
 * check-availability.js and _direct-pricing.js. A change in one place but not
 * the others silently broke the server-side price verification (legitimate
 * payments rejected as price_mismatch) or mispriced reservations.
 *
 * The FRONT-END mirror lives in reservar.html (calcTotal / BE_EXTRAS). The unit
 * test tests/unit/pricing-constants.test.js parses reservar.html and asserts it
 * matches these values, so any divergence fails CI. */

/* Extra guest surcharge: COP per night for each guest beyond the first. */
const EXTRA_GUEST_SURCHARGE = 31000;

/* Nightly fallback when OTASync returns no price for a room. */
const PRICE_FALLBACK = 195000;

/* Booking-engine extras. `multiplier` controls how the total is computed:
   perGuestPerNight | perNight | flat | pctOfNight (pct of the base nightly rate).
   parqueadero (pos 1) and traslado/tour (pos 4-5) are RESERVED in the mask but
   not surfaced in the UI. NEVER reindex existing positions — new flags APPEND at
   the END so in-flight payment references keep decoding correctly. */
const EXTRAS_PRICES = {
  desayuno:    { price: 20000,  multiplier: 'perGuestPerNight' },
  parqueadero: { price: 25000,  multiplier: 'perNight' },   /* reservado (fuera de UI) */
  late:        { pct: 0.15,     multiplier: 'pctOfNight' },  /* check-out hasta 2pm = 15% */
  early:       { pct: 0.25,     multiplier: 'pctOfNight' },  /* early check-in desde 6am = 25% (plano, decisión dueño 2026-06-24) */
  traslado:    { price: 0,      multiplier: 'flat' },        /* reservado */
  tour:        { price: 0,      multiplier: 'flat' },        /* reservado */
  mascota:     { price: 200000, multiplier: 'flat' }         /* $200k por reserva (IVA incluido) */
};

/* Order matters: index == position in the extras mask string. APPEND ONLY. */
const EXTRAS_KEYS = ['desayuno', 'parqueadero', 'late', 'early', 'traslado', 'tour', 'mascota'];

/* ── Códigos de descuento (Frente A) ──────────────────────────────────────
 * verifyDiscountCode es la puerta de entrada usada por validate-discount-code,
 * create-wompi-signature y wompi-webhook. Delega en _discount-store (Blobs +
 * conteo atómico). Se expone aquí para que el motor de precio tenga una sola
 * superficie. SIEMPRE server-side: el cliente nunca fija el descuento.
 *
 * Firma: verifyDiscountCode({ code, email, nights, roomTypeId, checkin,
 *   checkout, subtotalCents, now }, deps?) → { valid, reason, discountCents, def }
 * (deps se inyecta en tests para evitar Blobs reales).
 */
function verifyDiscountCode(input, deps) {
  const { verifyDiscountCode: impl } = require('./_discount-store');
  return impl(input, deps);
}

module.exports = {
  EXTRA_GUEST_SURCHARGE,
  PRICE_FALLBACK,
  EXTRAS_PRICES,
  EXTRAS_KEYS,
  verifyDiscountCode
};
