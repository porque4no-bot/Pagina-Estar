/* Single source of truth for additional-service pricing across the surfaces
 * that sell extras:
 *   - booking engine  (reservas)   → _pricing.js EXTRAS_PRICES / reservar.html
 *   - corporate quotes (cotización) → cotizar-admin.html SERVICE_DEFS
 *   - guest app        (guest app)  → guest-action.js SERVICE_CATALOG
 *   - portal residente (estadía larga) → portal-resident.js (aseo extra al folio)
 *
 * Historically each surface declared its own price and they DRIFTED
 * (desayuno was $20k / $25k / $28k at the same time). This table is the
 * canonical value; `tests/unit/services-catalog.test.js` parses each surface
 * and fails the build if any diverges from here, so they can't silently split
 * again. The guest app now READS from this module (guest-action.js builds its
 * SERVICE_CATALOG from here, filtering surfaces.includes('guest')); the booking
 * engine (_pricing.js) and quote admin (cotizar-admin.html) still keep their own
 * copies, kept in lockstep by the guard test until they read from here too.
 *
 * Pricing model per service:
 *   multiplier: 'perGuestPerNight' | 'perNight' | 'pctOfNight' | 'flat' | 'perUnit'
 *   tax:        'iva' (19%) | 'inc' (8%) | 'none' | 'included' (price already has IVA)
 *   surfaces:   where the service is offered today
 *               ('booking' | 'quote' | 'guest' | 'portal')
 *
 * Owner decisions baked in (2026-06-18): desayuno = $20.000 (era 20/25/28k);
 * late check-out = 15% de la noche; early check-in = 25% de la noche (plano,
 * decisión dueño 2026-06-24, antes 35%); the booking engine was already
 * canonical, quotes + guest app were aligned to it.
 * Guest-app surface (owner decision 2026-06-18): offers desayuno, lavandería,
 * late check-out (15%), early check-in (25%), traslado, experiencia y mascota;
 * el parqueadero quedó retirado (no figura en este catálogo).
 */

const SERVICES = {
  /* Sold across all surfaces */
  desayuno: { es: 'Desayuno', en: 'Breakfast', price: 20000, tax: 'inc', multiplier: 'perGuestPerNight', surfaces: ['booking', 'quote', 'guest'] },

  /* Booking-engine extras (mask-encoded; see _pricing.js EXTRAS_KEYS).
     late is offered in the booking engine + guest app. early check-in se compra
     SOLO en el check-in (guest) — decisión firme; su % se REDONDEA a $5.000
     (round5k). mascota es un recargo plano en ambas superficies. */
  late:    { es: 'Late check-out', en: 'Late check-out', pct: 0.15, tax: 'iva', multiplier: 'pctOfNight', surfaces: ['booking', 'guest'] },
  early:   { es: 'Early check-in',  en: 'Early check-in',  pct: 0.25, tax: 'iva', multiplier: 'pctOfNight', round5k: true, surfaces: ['guest'] },
  mascota: { es: 'Mascota', en: 'Pet', price: 200000, tax: 'included', multiplier: 'flat', surfaces: ['booking', 'guest'] },

  /* Corporate-quote services */
  almuerzo:         { es: 'Almuerzo', en: 'Lunch', price: 35000, tax: 'inc', multiplier: 'perUnit', surfaces: ['quote'] },
  cena:             { es: 'Cena', en: 'Dinner', price: 35000, tax: 'inc', multiplier: 'perUnit', surfaces: ['quote'] },
  personaAdicional: { es: 'Persona adicional', en: 'Extra guest', price: 50000, tax: 'iva', multiplier: 'perUnit', surfaces: ['quote'] },

  /* Guest-app post-stay services */
  laundry:          { es: 'Lavandería express', en: 'Express laundry', price: 35000, tax: 'none', multiplier: 'perUnit', surfaces: ['guest'] },
  airport_transfer: { es: 'Traslado aeropuerto', en: 'Airport transfer', price: 120000, tax: 'iva', multiplier: 'perUnit', surfaces: ['guest'] },
  city_experience:  { es: 'Experiencia cafetera', en: 'Coffee experience', price: 95000, tax: 'iva', multiplier: 'perUnit', surfaces: ['guest'] },

  /* Portal RESIDENTE (estadía larga) — también ofrecidos en la guest app.
     Fuente única del precio del aseo extra: portal-resident.js debe LEER
     SERVICES.aseoExtra.price en lugar del número mágico ASEO_PRICE_COP=50000.
     · aseoExtra: $50.000 cobrado por unidad (1..5) al folio de Kunas/OTASync.
       tax:'included' porque portal-resident documenta el monto como IVA-inclusive
       (el $50.000 es el cargo final, no un neto al que se le suma IVA).
     · mantenimiento: solicitud SIN cargo — solo notifica al equipo (price 0). */
  aseoExtra:        { es: 'Aseo extra', en: 'Extra cleaning', price: 50000, tax: 'included', multiplier: 'perUnit', surfaces: ['guest', 'portal'] },
  mantenimiento:    { es: 'Mantenimiento', en: 'Maintenance', price: 0, tax: 'none', multiplier: 'flat', surfaces: ['guest', 'portal'] }
};

module.exports = { SERVICES };
