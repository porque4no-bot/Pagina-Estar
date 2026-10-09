/* Lógica pura del motor de reservas (sin React ni DOM).
 *
 * motor-app.jsx la importa (esbuild la empaqueta dentro de motor-app.js) y las
 * pruebas unitarias la cargan con require() — por eso es CommonJS y no toca
 * window/document: todo lo que depende del navegador entra por parámetro.
 *
 * Cubre: capacidad por apartaestudio, estados del pago (aprobado / en proceso /
 * rechazado) y el plan de consultas a booking-status, el retorno de Mercado
 * Pago (código desde external_reference), el teléfono para Wompi según el país
 * y la traducción de los códigos de error del servidor a claves de i18n. */

/* Tope de huéspedes del motor = capacidad máxima de rooms_db.json (Selección: 5).
   motor-engine.test.js verifica que no se desalinee. */
const MAX_GUESTS = 5;

function clampGuests(value, fallback) {
  const n = parseInt(value, 10);
  if (isNaN(n) || n < 1) return fallback == null ? 2 : fallback;
  return Math.min(n, MAX_GUESTS);
}

/* Capacidad declarada del apartaestudio (null si no se conoce). */
function roomCapacity(room) {
  const cap = Number(room && room.capacity);
  return cap > 0 ? cap : null;
}

/* ¿Caben `guests` huéspedes? Sin capacidad conocida no bloquea (el servidor
   vuelve a validar con rooms_db.json al firmar el pago). */
function roomFitsGuests(room, guests) {
  const cap = roomCapacity(room);
  if (!cap) return true;
  return (parseInt(guests, 10) || 1) <= cap;
}

/* Reemplaza {clave} en un texto de i18n. */
function fill(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (m, key) =>
    (vars && vars[key] != null) ? String(vars[key]) : m);
}

/* ── Estados del pago ──────────────────────────────────────────────────────
   'confirming' = el pago está aprobado y esperamos que el webhook cree la
                  reserva (normalmente segundos).
   'processing' = el pago sigue en proceso en el banco / la pasarela (PSE,
                  Nequi, efectivo, Mercado Pago "pending"): NO es un error y el
                  huésped no debe volver a pagar. */
function phaseForPaymentStatus(status) {
  const s = String(status || '').toUpperCase();
  if (s === 'APPROVED') return 'confirming';
  if (s === 'PENDING') return 'processing';
  return null;
}

/* Respuesta de /api/booking-status → 'confirmed' | 'reservationPending' |
   'soldOut' | 'pending'.
   'soldOut' = el pago entró pero el apartaestudio ya estaba agotado
   (_payments escribe reservationPending con reason 'sold_out'): la reserva NO
   se va a crear, así que no se le puede decir al huésped que llegará por correo. */
function interpretBookingStatus(data) {
  if (!data || data.status !== 'confirmed') return 'pending';
  if (!data.reservationPending) return 'confirmed';
  return data.reason === 'sold_out' ? 'soldOut' : 'reservationPending';
}

/* Estado de una transacción Wompi → 'approved' | 'declined' | 'pending'. */
function interpretWompiStatus(status) {
  const s = String(status || '').toUpperCase();
  if (s === 'APPROVED') return 'approved';
  if (s === 'DECLINED' || s === 'VOIDED' || s === 'ERROR') return 'declined';
  return 'pending';
}

/* API pública de Wompi (lectura de una transacción, sin llaves privadas). */
function wompiApiBase(publicKey) {
  return String(publicKey || '').startsWith('pub_test_')
    ? 'https://sandbox.wompi.co/v1'
    : 'https://production.wompi.co/v1';
}

/* Plan de consultas a booking-status. `fast` consultas cada `fastMs` mientras se
   muestra la pantalla de espera; luego `slow` consultas más espaciadas en segundo
   plano (la pantalla ya muestra el estado y se actualiza sola si se confirma).
   booking-status limita a 60 consultas por IP cada 5 minutos: ningún plan se
   acerca a ese tope (motor-engine.test.js lo verifica). */
const POLL_PLAN = {
  confirming: { fast: 30, fastMs: 2000, slow: 16, slowMs: 15000 }, /* ~1 min + ~4 min */
  processing: { fast: 15, fastMs: 2000, slow: 54, slowMs: 10000 }  /* ~30 s + ~9 min  */
};

function pollPlan(phase) {
  return POLL_PLAN[phase] || POLL_PLAN.confirming;
}

/* Espera antes de la siguiente consulta, tras `attempt` consultas hechas (>= 1).
   null = no consultar más. */
function nextPollDelay(attempt, phase) {
  const plan = pollPlan(phase);
  if (attempt < plan.fast) return plan.fastMs;
  if (attempt < plan.fast + plan.slow) return plan.slowMs;
  return null;
}

/* ¿Ya pasó la etapa de espera "en pantalla"? */
function fastPollsDone(attempt, phase) {
  return attempt >= pollPlan(phase).fast;
}

/* ── Retorno de Mercado Pago ───────────────────────────────────────────────
   external_reference = `MPDIR-` + base64url de
   `2|checkin|checkout|guests|roomTypeId|nombre|apellido|email|tel|extras|CODIGO|col|neg|centavos`
   (_payments.createDirectReference). */
function base64UrlToUtf8(b64url) {
  let b64 = String(b64url).replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  if (typeof atob === 'function' && typeof TextDecoder === 'function') {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }
  return Buffer.from(b64, 'base64').toString('utf8');
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function decodeMpReference(ref) {
  const value = String(ref || '');
  if (!/^MPDIR-[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const parts = base64UrlToUtf8(value.slice(6)).split('|');
    if (parts[0] !== '2' || !parts[10]) return null;
    return {
      code: parts[10],
      checkin: ISO_DATE_RE.test(parts[1]) ? parts[1] : '',
      checkout: ISO_DATE_RE.test(parts[2]) ? parts[2] : '',
      guests: parseInt(parts[3], 10) || null,
      roomTypeId: parts[4] || '',
      firstName: parts[5] || '',
      lastName: parts[6] || '',
      email: parts[7] || '',
      amountCents: parseInt(parts[13], 10) || null
    };
  } catch (e) {
    return null;
  }
}

const MP_PENDING_TTL_MS = 2 * 60 * 60 * 1000;

/* Lee el retorno de Mercado Pago (?payment=success|pending). Devuelve
   { code, status, paymentId, reference } o null si no hay cómo identificar la
   reserva. `storedRaw` = lo guardado en sessionStorage antes del redirect. */
function readMpReturn(search, storedRaw, now) {
  const params = new URLSearchParams(search || '');
  const payment = params.get('payment');
  if (payment !== 'success' && payment !== 'pending') return null;
  const reference = decodeMpReference(params.get('external_reference') || '');
  let code = reference ? reference.code : null;
  if (!code && storedRaw) {
    try {
      const stored = JSON.parse(storedRaw);
      if (stored && stored.code && (now || Date.now()) - (stored.savedAt || 0) < MP_PENDING_TTL_MS) {
        code = String(stored.code);
      }
    } catch (e) { /* noop */ }
  }
  if (!code) return null;
  return {
    code,
    status: payment === 'success' ? 'APPROVED' : 'PENDING',
    paymentId: params.get('payment_id') || params.get('collection_id') || '',
    reference
  };
}

/* ── Pago en curso (para no volver a cobrar si el huésped recarga) ─────────── */
const PAY_PENDING_KEY = 'estar-pay-pending';
const PAY_PENDING_TTL_MS = 2 * 60 * 60 * 1000;

function readPendingPayment(raw, now) {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    if (!p || !p.code || !p.savedAt) return null;
    if ((now || Date.now()) - p.savedAt > PAY_PENDING_TTL_MS) return null;
    return p;
  } catch (e) {
    return null;
  }
}

/* ── Teléfono para el widget de Wompi ──────────────────────────────────────
   Wompi pide el número y el indicativo por separado. Antes se mandaba siempre
   +57 con el teléfono tal cual (un extranjero quedaba con indicativo errado y
   "+57 300…" se duplicaba). Si no se puede deducir con seguridad, devolvemos
   null y el widget le pide el teléfono al huésped. */
const DIAL_BY_COUNTRY = {
  colombia: '+57',
  venezuela: '+58',
  ecuador: '+593',
  peru: '+51',
  mexico: '+52',
  argentina: '+54',
  espana: '+34',
  spain: '+34',
  'estados unidos': '+1',
  'united states': '+1'
};
const KNOWN_PREFIXES = Object.values(DIAL_BY_COUNTRY)
  .filter((p, i, all) => all.indexOf(p) === i)
  .sort((a, b) => b.length - a.length);

function normalizeCountry(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function dialCodeForCountry(country) {
  return DIAL_BY_COUNTRY[normalizeCountry(country)] || null;
}

function splitPhoneForWompi(tel, country) {
  let compact = String(tel || '').trim().replace(/[^\d+]/g, '');
  if (compact.startsWith('00')) compact = '+' + compact.slice(2);
  if (compact.startsWith('+')) {
    const prefix = KNOWN_PREFIXES.find(p => compact.startsWith(p));
    if (!prefix) return null;
    const number = compact.slice(prefix.length).replace(/\D/g, '');
    return number.length >= 6 ? { prefix, number } : null;
  }
  const digits = compact.replace(/\D/g, '');
  const prefix = dialCodeForCountry(country);
  if (!prefix || digits.length < 6) return null;
  /* Celular colombiano escrito con el 57 delante y sin "+": 573001112233. */
  if (prefix === '+57' && digits.length === 12 && digits.startsWith('57')) {
    return { prefix, number: digits.slice(2) };
  }
  return { prefix, number: digits };
}

/* ── Errores del servidor → clave de i18n (nunca mostrar el código interno) ── */
const SERVER_ERROR_KEYS = {
  sold_out: 'errSoldOut',
  price_mismatch: 'errPriceChanged',
  over_capacity: 'overCapacityError'
};

function errorKeyForServerReason(reason) {
  return SERVER_ERROR_KEYS[reason] || null;
}

module.exports = {
  MAX_GUESTS,
  clampGuests,
  roomCapacity,
  roomFitsGuests,
  fill,
  phaseForPaymentStatus,
  interpretBookingStatus,
  interpretWompiStatus,
  wompiApiBase,
  POLL_PLAN,
  pollPlan,
  nextPollDelay,
  fastPollsDone,
  decodeMpReference,
  readMpReturn,
  MP_PENDING_TTL_MS,
  PAY_PENDING_KEY,
  PAY_PENDING_TTL_MS,
  readPendingPayment,
  dialCodeForCountry,
  splitPhoneForWompi,
  errorKeyForServerReason
};
