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
function getQuoteStore() {
  return getStore({ name: STORE_NAME, consistency: 'strong' });
}

async function loadQuote(store, id) {
  const raw = await store.get(id);
  return raw ? JSON.parse(raw) : null;
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

  const sv = body.servicios || {};
  const servicios = {
    desayuno: sanitizeService(sv.desayuno),
    almuerzo: sanitizeService(sv.almuerzo),
    cena: sanitizeService(sv.cena),
    parqueadero: sanitizeService(sv.parqueadero),
    personaAdicional: sanitizeService(sv.personaAdicional),
    otros: Array.isArray(sv.otros) ? sv.otros.slice(0, 20).map(o => {
      const imp = ['ninguno', 'iva', 'inc'].includes(o && o.impuesto) ? o.impuesto : 'ninguno';
      const b = sanitizeService(o);
      return { descripcion: String((o && o.descripcion) || '').slice(0, 120), cantidad: b.cantidad, precioUnitario: b.precioUnitario, impuesto: imp };
    }).filter(o => o.descripcion && o.cantidad > 0) : []
  };

  const now = new Date();
  const parsedExpiry = body.validaHasta ? new Date(body.validaHasta) : null;
  const expiresAt = (parsedExpiry && !isNaN(parsedExpiry.getTime()))
    ? parsedExpiry.toISOString()
    : new Date(now.getTime() + 30 * 86400000).toISOString();

  return {
    empresa: String(body.empresa).slice(0, 200),
    contacto: String(body.contacto || '').slice(0, 200),
    email: String(body.email).slice(0, 254),
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

/* Strip internal-only fields before sending to the client/public link. */
function toPublic(quote) {
  if (!quote) return quote;
  const {
    createdBy, comision, status, views, firstViewedAt, lastViewedAt,
    cancelledAt, cancelledBy, updatedAt, ...rest
  } = quote;
  rest.items = (rest.items || []).map(it => {
    const { tarifaBase, ...pub } = it;
    return pub;
  });
  return rest;
}

module.exports = {
  IVA_RATE, INC_RATE, ROOM_NAME_TO_ID, VALID_ROOM_IDS,
  getQuoteStore, loadQuote, saveQuote, listAllQuotes,
  effectiveStatus, sanitizeQuoteInput, toPublic, nightsBetween
};
