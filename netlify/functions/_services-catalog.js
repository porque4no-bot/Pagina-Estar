/* Single source of truth for additional-service pricing across the three
 * surfaces that sell extras:
 *   - booking engine  (reservas)  → _pricing.js EXTRAS_PRICES / reservar.html
 *   - corporate quotes (cotización) → cotizar-admin.html SERVICE_DEFS
 *   - guest app        (guest app) → guest-action.js SERVICE_CATALOG
 *
 * Historically each surface declared its own price and they DRIFTED
 * (desayuno was $20k / $25k / $28k at the same time). This table is the
 * canonical value; `tests/unit/services-catalog.test.js` parses each surface
 * and fails the build if any diverges from here, so they can't silently split
 * again. The surfaces still declare their own copies for now — the next step
 * is to have them READ from this module (build.js can inject it like i18n).
 *
 * Pricing model per service:
 *   multiplier: 'perGuestPerNight' | 'perNight' | 'pctOfNight' | 'flat' | 'perUnit'
 *   tax:        'iva' (19%) | 'inc' (8%) | 'none' | 'included' (price already has IVA)
 *   surfaces:   where the service is offered today
 *
 * Owner decisions baked in (2026-06-18): desayuno = $20.000 (era 20/25/28k);
 * late check-out = 15% de la noche; early check-in = 25% de la noche; the
 * booking engine was already canonical, quotes + guest app were aligned to it.
 */

const SERVICES = {
  /* Sold across all surfaces */
  desayuno: { es: 'Desayuno', en: 'Breakfast', price: 20000, tax: 'inc', multiplier: 'perGuestPerNight', surfaces: ['booking', 'quote', 'guest'] },

  /* Booking-engine extras (mask-encoded; see _pricing.js EXTRAS_KEYS) */
  late:    { es: 'Late check-out', en: 'Late check-out', pct: 0.15, tax: 'iva', multiplier: 'pctOfNight', surfaces: ['booking', 'guest'] },
  early:   { es: 'Early check-in',  en: 'Early check-in',  pct: 0.25, tax: 'iva', multiplier: 'pctOfNight', surfaces: ['booking'] },
  mascota: { es: 'Mascota', en: 'Pet', price: 200000, tax: 'included', multiplier: 'flat', surfaces: ['booking'] },

  /* Corporate-quote services */
  almuerzo:         { es: 'Almuerzo', en: 'Lunch', price: 35000, tax: 'inc', multiplier: 'perUnit', surfaces: ['quote'] },
  cena:             { es: 'Cena', en: 'Dinner', price: 35000, tax: 'inc', multiplier: 'perUnit', surfaces: ['quote'] },
  personaAdicional: { es: 'Persona adicional', en: 'Extra guest', price: 50000, tax: 'iva', multiplier: 'perUnit', surfaces: ['quote'] },

  /* Guest-app post-stay services */
  laundry:          { es: 'Lavandería express', en: 'Express laundry', price: 35000, tax: 'none', multiplier: 'perUnit', surfaces: ['guest'] },
  airport_transfer: { es: 'Traslado aeropuerto', en: 'Airport transfer', price: 120000, tax: 'iva', multiplier: 'perUnit', surfaces: ['guest'] },
  city_experience:  { es: 'Experiencia cafetera', en: 'Coffee experience', price: 95000, tax: 'iva', multiplier: 'perUnit', surfaces: ['guest'] }
};

module.exports = { SERVICES };
