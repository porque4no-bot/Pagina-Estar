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
   perGuestPerNight | perNight | flat. Positions 4-5 (traslado, tour) are
   reserved in the extras mask but not surfaced in the UI. */
const EXTRAS_PRICES = {
  desayuno:    { price: 20000, multiplier: 'perGuestPerNight' },
  parqueadero: { price: 25000, multiplier: 'perNight' },
  late:        { price: 60000, multiplier: 'flat' },
  early:       { price: 50000, multiplier: 'flat' },
  traslado:    { price: 0,     multiplier: 'flat' },
  tour:        { price: 0,     multiplier: 'flat' }
};

/* Order matters: index == position in the extras mask string. */
const EXTRAS_KEYS = ['desayuno', 'parqueadero', 'late', 'early', 'traslado', 'tour'];

module.exports = {
  EXTRA_GUEST_SURCHARGE,
  PRICE_FALLBACK,
  EXTRAS_PRICES,
  EXTRAS_KEYS
};
