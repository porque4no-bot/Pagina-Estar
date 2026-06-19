/* Shared persistence + sanitization for corporate quotes (cotizaciones).
   Quotes are stored in Netlify Blobs keyed by quoteId. The internal
   commission and base rates never leave the server — toPublic() strips them. */

const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'quotes';

const IVA_RATE = 0.19; // habitaciones y servicios gravados
const INC_RATE = 0.08; // alimentación

const ROOM_NAME_TO_ID = {
  'Clásica': '31348',
  'Selección': '31349',
  'Reserva': '31350',
  'Origen': '31351',
  'Especial': '31352'
};
const VALID_ROOM_IDS = new Set(Object.values(ROOM_NAME_TO_ID));

/* ── Blob store accessors (graceful when unavailable locally) ── */
/* ── Blob store accessors ──
   Netlify normally injects the Blobs context automatically. When it doesn't
   (some deploy previews / older sites), fall back to explicit credentials
   from env: NETLIFY_SITE_ID + NETLIFY_API_TOKEN (a personal access token). */
function getQuoteStore() {
  const opts = { name: STORE_NAME, consistency: 'strong' };
  /* Netlify reserves the NETLIFY_ prefix and won't expose those vars to
     functions, so prefer neutral names (BLOBS_*) and fall back to the rest. */
  const siteID = process.env.BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) {
    opts.siteID = siteID;
    opts.token = token;
  }
  return getStore(opts);
}

async function loadQuote(store, id) {
  const raw = await store.get(id);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw Object.assign(new Error(`Quote ${id} is corrupt: ${e.message}`), { statusCode: 500 });
  }
}

async function saveQuote(store, quote) {
  await store.set(quote.quoteId, JSON.stringify(quote));
}

async function listAllQuotes(store) {
  const { blobs } = await store.list();
  const out = [];
  for (const b of blobs) {
    try {
      const raw = await store.get(b.key);
      if (raw) out.push(JSON.parse(raw));
    } catch (e) { /* skip unreadable */ }
  }
  return out;
}

/* ── Status ── */
function effectiveStatus(quote) {
  if (!quote) return 'desconocida';
  if (quote.status === 'cancelada' || quote.status === 'aceptada') return quote.status;
  if (quote.expiresAt && new Date(quote.expiresAt) < new Date()) return 'vencida';
  return quote.status || 'activa';
}

/* Decide whether to send a "quote expiring soon" reminder. Pure + testable.
   True only for an actionable quote (activa/vista) with a client email, an
   expiry in the future but within `windowMs`, availability not lost, and no
   reminder already sent (one nudge per quote). */
function shouldRemindExpiry(quote, nowMs, windowMs) {
  if (!quote || !quote.expiresAt || !quote.email) return false;
  if (quote.reminderSentAt) return false;
  if (quote.availabilityOk === false) return false;
  const st = effectiveStatus(quote);
  if (st !== 'activa' && st !== 'vista') return false;
  const exp = new Date(quote.expiresAt).getTime();
  if (isNaN(exp) || exp <= nowMs) return false;
  return (exp - nowMs) <= windowMs;
}

/* ── Helpers ── */
function isoDateOrNull(v) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

function nightsBetween(checkin, checkout) {
  if (!checkin || !checkout) return 0;
  const d1 = new Date(checkin), d2 = new Date(checkout);
  if (isNaN(d1) || isNaN(d2)) return 0;
  const n = Math.round((d2 - d1) / 86400000);
  return n > 0 ? n : 0;
}

function effectiveTarifa(base, comisionPct) {
  return Math.round((base || 0) * (1 + (comisionPct || 0) / 100));
}

function sanitizeService(s) {
  s = s || {};
  return {
    cantidad: Math.max(0, Math.min(100000, parseInt(s.cantidad) || 0)),
    precioUnitario: Math.max(0, parseFloat(s.precioUnitario) || 0)
  };
}

/* Normalize and price an incoming quote body (used by create + update).
   Rooms carry both tarifaBase (internal) and tarifaPorNoche (inflated). */
function sanitizeQuoteInput(body) {
  body = body || {};
  const comision = Math.max(0, Math.min(100, parseFloat(body.comision) || 0));
  const checkin = isoDateOrNull(body.checkin);
  const checkout = isoDateOrNull(body.checkout);
  const nights = Math.max(1, Math.min(365, nightsBetween(checkin, checkout) || 1));

  const items = (Array.isArray(body.items) ? body.items : []).map(item => {
    const u = Math.max(1, Math.min(100, parseInt(item.unidades) || 1));
    const base = Math.max(0, parseFloat(item.tarifaBase != null ? item.tarifaBase : item.tarifaPorNoche) || 0);
    const habitacion = String(item.habitacion || 'Clásica').slice(0, 100);
    let roomTypeId = String(item.roomTypeId || '').trim();
    if (!VALID_ROOM_IDS.has(roomTypeId)) roomTypeId = ROOM_NAME_TO_ID[habitacion] || '';
    const tarifa = effectiveTarifa(base, comision);
    return {
      habitacion,
      roomTypeId,
      unidades: u,
      noches: nights,
      tarifaBase: base,
      tarifaPorNoche: tarifa,
      subtotal: u * nights * tarifa
    };
  });

  /* Adicionales: the admin enters a BASE unit price; the commission inflates it
     exactly like room rates (precioBase internal, precioUnitario = inflated,
     client-facing). computeQuoteTotal sums precioUnitario, so the markup flows
     into the charged total. */
  const sv = body.servicios || {};
  const mkSvc = (raw) => {
    const b = sanitizeService(raw);
    return { cantidad: b.cantidad, precioBase: b.precioUnitario, precioUnitario: effectiveTarifa(b.precioUnitario, comision) };
  };
  const servicios = {
    desayuno: mkSvc(sv.desayuno),
    almuerzo: mkSvc(sv.almuerzo),
    cena: mkSvc(sv.cena),
    personaAdicional: mkSvc(sv.personaAdicional),
    otros: Array.isArray(sv.otros) ? sv.otros.slice(0, 20).map(o => {
      const imp = ['ninguno', 'iva', 'inc'].includes(o && o.impuesto) ? o.impuesto : 'ninguno';
      const b = sanitizeService(o);
      return { descripcion: String((o && o.descripcion) || '').slice(0, 120), cantidad: b.cantidad, precioBase: b.precioUnitario, precioUnitario: effectiveTarifa(b.precioUnitario, comision), impuesto: imp };
    }).filter(o => o.descripcion && o.cantidad > 0) : []
  };

  const now = new Date();
  const parsedExpiry = body.validaHasta ? new Date(body.validaHasta) : null;
  const expiresAt = (parsedExpiry && !isNaN(parsedExpiry.getTime()))
    ? parsedExpiry.toISOString()
    : new Date(now.getTime() + 30 * 86400000).toISOString();

  return {
    empresa: String(body.empresa || '').slice(0, 200),
    contacto: String(body.contacto || '').slice(0, 200),
    email: String(body.email || '').slice(0, 254),
    telefono: String(body.telefono || '').slice(0, 50),
    nit: String(body.nit || '').slice(0, 50),
    referencia: String(body.referencia || '').slice(0, 300),
    expiresAt,
    checkin,
    checkout,
    numPersonas: Math.max(1, Math.min(200, parseInt(body.numPersonas) || 1)),
    comision,
    impuestos: { ivaRate: IVA_RATE, incRate: INC_RATE },
    items,
    servicios,
    descuento: {
      tipo: (body.descuento && body.descuento.tipo === 'fijo') ? 'fijo' : 'porcentaje',
      valor: Math.max(0, parseFloat((body.descuento && body.descuento.valor) || 0))
    },
    condiciones: String(body.condiciones || '').slice(0, 2000)
  };
}

/* Compute the quote total server-side. Mirrors the math in cotizacion.html:
   IVA 19% on rooms + IVA-tagged services, INC 8% on food, discount pro-rated
   across taxable bases. Returns peso amounts plus totalCents for Wompi checks. */
function computeQuoteTotal(quote) {
  const q = quote || {};
  const subtotalItems = (q.items || []).reduce((s, it) => s + (it.subtotal || 0), 0);

  const SVC_TAX = { desayuno: 'inc', almuerzo: 'inc', cena: 'inc', personaAdicional: 'iva' };
  const sv = q.servicios || {};
  let baseIvaSvc = 0, baseInc = 0, baseNone = 0;

  ['desayuno', 'almuerzo', 'cena', 'personaAdicional'].forEach(k => {
    const s = sv[k];
    if (!s || !s.cantidad || !s.precioUnitario) return;
    const sub = s.cantidad * s.precioUnitario;
    if (SVC_TAX[k] === 'iva') baseIvaSvc += sub; else baseInc += sub;
  });
  (sv.otros || []).forEach(o => {
    if (!o || !o.cantidad || !o.precioUnitario) return;
    const sub = o.cantidad * o.precioUnitario;
    if (o.impuesto === 'iva') baseIvaSvc += sub;
    else if (o.impuesto === 'inc') baseInc += sub;
    else baseNone += sub;
  });

  const subtotal = subtotalItems + baseIvaSvc + baseInc + baseNone;

  let descuentoAmt = 0;
  if (q.descuento && q.descuento.valor > 0) {
    descuentoAmt = q.descuento.tipo === 'porcentaje'
      ? subtotal * (q.descuento.valor / 100)
      : q.descuento.valor;
  }
  descuentoAmt = Math.min(descuentoAmt, subtotal);

  const ivaRate = (q.impuestos && q.impuestos.ivaRate) || IVA_RATE;
  const incRate = (q.impuestos && q.impuestos.incRate) || INC_RATE;
  const factor = subtotal > 0 ? (subtotal - descuentoAmt) / subtotal : 0;
  const iva = (subtotalItems + baseIvaSvc) * factor * ivaRate;
  const inc = baseInc * factor * incRate;
  const total = (subtotal - descuentoAmt) + iva + inc;

  return {
    subtotal, descuentoAmt, iva, inc,
    total: Math.round(total),
    totalCents: Math.round(total * 100)
  };
}

/* Strip internal-only fields before sending to the client/public link. */
function toPublic(quote) {
  if (!quote) return quote;
  const {
    createdBy, comision, status, views, firstViewedAt, lastViewedAt,
    cancelledAt, cancelledBy, updatedAt, paidAt, transactionId, bookingCodes,
    availabilityOk, availabilityCheckedAt, unavailable, reservationPending, overbooking,
    bloquearHabitaciones, holdReservationIds, publicToken, ...rest
  } = quote;
  rest.items = (rest.items || []).map(it => {
    const { tarifaBase, ...pub } = it;
    return pub;
  });
  if (rest.servicios) {
    const sv = rest.servicios;
    const strip = (s) => { if (!s || typeof s !== 'object') return s; const { precioBase, ...pub } = s; return pub; };
    rest.servicios = {
      ...sv,
      desayuno: strip(sv.desayuno),
      almuerzo: strip(sv.almuerzo),
      cena: strip(sv.cena),
      personaAdicional: strip(sv.personaAdicional),
      otros: Array.isArray(sv.otros) ? sv.otros.map(strip) : sv.otros
    };
  }
  return rest;
}

module.exports = {
  IVA_RATE, INC_RATE, ROOM_NAME_TO_ID, VALID_ROOM_IDS,
  getQuoteStore, loadQuote, saveQuote, listAllQuotes,
  effectiveStatus, shouldRemindExpiry, sanitizeQuoteInput, toPublic, nightsBetween, effectiveTarifa,
  sanitizeService, computeQuoteTotal
};
