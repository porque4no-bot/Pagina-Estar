/* Frente A — Motor de códigos de descuento (camino Wompi / reserva directa).
 *
 * Dos stores en Netlify Blobs:
 *   - 'discount-codes' : la DEFINICIÓN de cada código (tipo, valor, vigencia,
 *                        usoMaximo, estadía mínima, habitaciones, fechas
 *                        excluidas, activo, audit). Clave = código en MAYÚSCULAS.
 *   - 'discount-usage' : el CONTEO de usos por código (incremento ATÓMICO con
 *                        compare-and-set, reusando el patrón de _rate-limit.js
 *                        para que dos pagos simultáneos nunca excedan el cupo)
 *                        + un registro por (código,email) para el límite de
 *                        un-uso-por-email, + dedup idempotente por reserva.
 *
 * TODO es server-side: el cliente nunca fija el precio ni el descuento. La
 * verificación del monto vive en _direct-pricing.computeDirectBookingTotals /
 * verifyDirectBookingAmount; este módulo solo dice si el código es válido y
 * cuántos centavos descuenta sobre un subtotal dado.
 *
 * Mock-safe: sin Blobs (local sin credenciales) las lecturas devuelven null y
 * el motor sigue funcionando — un código simplemente "no existe". Las funciones
 * aceptan inyección de dependencias (deps.getStore / deps.now) para tests sin
 * red ni Blobs reales.
 */

const { getStore } = require('@netlify/blobs');

const CODES_STORE = 'discount-codes';
const USAGE_STORE = 'discount-usage';

/* ── Store accessors (mismo fallback de credenciales que _quotes-store) ── */
function storeFor(name, deps = {}) {
  const get = deps.getStore || getStore;
  const opts = { name, consistency: 'strong' };
  const siteID = process.env.BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) { opts.siteID = siteID; opts.token = token; }
  return get(opts);
}
function getCodesStore(deps) { return storeFor(CODES_STORE, deps); }
function getUsageStore(deps) { return storeFor(USAGE_STORE, deps); }

/* ── Normalización ── */
/* El código es case-insensitive y solo A-Z 0-9 - _ (lo que cabe en una clave de
   blob y en un parámetro de URL/JSON sin escapar). Tope 40 chars. */
function normalizeCode(raw) {
  return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40);
}
/* email normalizado para el límite un-uso-por-email y su clave de blob. */
function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase().slice(0, 160);
}
function emailKeyPart(email) {
  /* Las claves de blob no aceptan cualquier carácter; usamos un hash corto. */
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(normalizeEmail(email)).digest('hex').slice(0, 24);
}

function isoDateOnly(v) {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/* ── CRUD de definiciones ── */
async function loadCode(code, deps = {}) {
  const key = normalizeCode(code);
  if (!key) return null;
  let raw;
  try { raw = await getCodesStore(deps).get(key); }
  catch (e) { return null; } /* mock-safe: sin Blobs → "no existe" */
  if (!raw) return null;
  try { return JSON.parse(raw); }
  catch (e) { return null; }
}

async function saveCode(def, deps = {}) {
  const key = normalizeCode(def.code);
  if (!key) throw new Error('código inválido');
  def.code = key;
  await getCodesStore(deps).set(key, JSON.stringify(def));
  return def;
}

async function listCodes(deps = {}) {
  const store = getCodesStore(deps);
  let listing;
  try { listing = await store.list(); }
  catch (e) { return []; }
  const out = [];
  for (const b of (listing.blobs || [])) {
    try {
      const raw = await store.get(b.key);
      if (raw) out.push(JSON.parse(raw));
    } catch (e) { /* salta ilegibles */ }
  }
  return out;
}

/* Construye/normaliza una definición a partir de la entrada del admin. Pura:
   no toca Blobs. Devuelve { def } o { error } (mensaje en español). */
function buildDefinition(input, opts = {}) {
  const code = normalizeCode(input.code);
  if (!code || code.length < 3) return { error: 'El código debe tener al menos 3 caracteres (A-Z, 0-9, - o _).' };

  const type = input.type === 'fixed' ? 'fixed' : input.type === 'percent' ? 'percent' : null;
  if (!type) return { error: 'Tipo inválido: usa "percent" o "fixed".' };

  const value = Number(input.value);
  if (!Number.isFinite(value) || value <= 0) return { error: 'El valor del descuento debe ser mayor que cero.' };
  if (type === 'percent' && value > 100) return { error: 'Un descuento porcentual no puede superar 100%.' };

  const validFrom = isoDateOnly(input.validFrom);
  const validTo = isoDateOnly(input.validTo);
  if (input.validFrom && !validFrom) return { error: 'validFrom debe ser una fecha YYYY-MM-DD.' };
  if (input.validTo && !validTo) return { error: 'validTo debe ser una fecha YYYY-MM-DD.' };
  if (validFrom && validTo && validFrom > validTo) return { error: 'validFrom no puede ser posterior a validTo.' };

  let maxUses = null;
  if (input.maxUses !== undefined && input.maxUses !== null && input.maxUses !== '') {
    maxUses = parseInt(input.maxUses, 10);
    if (!Number.isFinite(maxUses) || maxUses <= 0) return { error: 'usoMaximo debe ser un entero positivo (o vacío para ilimitado).' };
  }

  let minNights = null;
  if (input.minNights !== undefined && input.minNights !== null && input.minNights !== '') {
    minNights = parseInt(input.minNights, 10);
    if (!Number.isFinite(minNights) || minNights <= 0) return { error: 'La estadía mínima debe ser un entero positivo.' };
  }

  /* habitaciones: lista de roomTypeId (string). Vacío = todas. */
  let roomTypeIds = [];
  if (Array.isArray(input.roomTypeIds)) {
    roomTypeIds = input.roomTypeIds.map(r => String(r).trim()).filter(Boolean);
  }

  /* fechas excluidas (blackout temporada alta): cada elemento es un día
     YYYY-MM-DD o un rango { from, to }. El descuento se bloquea si CUALQUIER
     noche de la estadía cae en una fecha excluida. */
  let blackoutDates = [];
  if (Array.isArray(input.blackoutDates)) {
    for (const b of input.blackoutDates) {
      if (typeof b === 'string') {
        const d = isoDateOnly(b);
        if (d) blackoutDates.push(d);
      } else if (b && typeof b === 'object') {
        const from = isoDateOnly(b.from);
        const to = isoDateOnly(b.to) || from;
        if (from) blackoutDates.push({ from, to });
      }
    }
  }

  const def = {
    code,
    type,
    value,
    validFrom: validFrom || null,
    validTo: validTo || null,
    maxUses,
    onePerEmail: input.onePerEmail !== false, /* por defecto: un uso por email */
    minNights,
    roomTypeIds,
    notCombinable: input.notCombinable !== false, /* no acumulable por defecto */
    blackoutDates,
    active: input.active === true || input.active === 'true',
    description: String(input.description || '').slice(0, 200),
    /* audit */
    createdAt: opts.existing ? opts.existing.createdAt : (opts.now || new Date().toISOString()),
    createdBy: opts.existing ? opts.existing.createdBy : (opts.actor || 'system'),
    updatedAt: opts.now || new Date().toISOString(),
    updatedBy: opts.actor || 'system',
    audit: Array.isArray(opts.existing && opts.existing.audit) ? opts.existing.audit.slice(-50) : []
  };
  def.audit.push({
    at: def.updatedAt,
    by: def.updatedBy,
    action: opts.existing ? 'update' : 'create',
    active: def.active
  });
  return { def };
}

/* ── Cálculo del descuento sobre un subtotal (en centavos) ── */
/* Devuelve los centavos a restar (nunca deja el total por debajo de 0). */
function discountCentsFor(def, subtotalCents) {
  if (!def || !Number.isFinite(subtotalCents) || subtotalCents <= 0) return 0;
  let cents;
  if (def.type === 'percent') cents = Math.round(subtotalCents * (def.value / 100));
  else cents = Math.round(def.value * 100); /* fixed: value en COP → centavos */
  if (cents < 0) cents = 0;
  if (cents > subtotalCents) cents = subtotalCents;
  return cents;
}

/* ── Reglas de validez (puras, sin red): vigencia, activo, estadía, habitación,
   blackout. NO incluye conteo de usos ni un-uso-por-email (esos requieren leer
   el store de usage). Devuelve { valid, reason } con reason genérico (la UI no
   debe revelar por qué falla un código que no existe vs uno expirado). */
function checkRules(def, { nights, roomTypeId, checkin, checkout, now } = {}) {
  if (!def) return { valid: false, reason: 'not_found' };
  if (!def.active) return { valid: false, reason: 'inactive' };

  const today = isoDateOnly(now) || new Date().toISOString().slice(0, 10);
  if (def.validFrom && today < def.validFrom) return { valid: false, reason: 'not_yet_valid' };
  if (def.validTo && today > def.validTo) return { valid: false, reason: 'expired' };

  if (def.minNights && Number.isFinite(nights) && nights < def.minNights) {
    return { valid: false, reason: 'min_nights' };
  }

  if (Array.isArray(def.roomTypeIds) && def.roomTypeIds.length > 0) {
    if (!roomTypeId || !def.roomTypeIds.map(String).includes(String(roomTypeId))) {
      return { valid: false, reason: 'room_not_eligible' };
    }
  }

  if (Array.isArray(def.blackoutDates) && def.blackoutDates.length > 0 && checkin && checkout) {
    if (stayHitsBlackout(def.blackoutDates, checkin, checkout)) {
      return { valid: false, reason: 'blackout' };
    }
  }

  return { valid: true, reason: 'ok' };
}

/* Una estadía toca un blackout si alguna NOCHE [checkin, checkout) cae en una
   fecha/rango excluido. */
function stayHitsBlackout(blackoutDates, checkin, checkout) {
  const start = isoDateOnly(checkin);
  const end = isoDateOnly(checkout);
  if (!start || !end) return false;
  const nights = enumerateNights(start, end);
  for (const night of nights) {
    for (const b of blackoutDates) {
      if (typeof b === 'string') {
        if (night === b) return true;
      } else if (b && b.from) {
        const to = b.to || b.from;
        if (night >= b.from && night <= to) return true;
      }
    }
  }
  return false;
}

/* Devuelve las noches ocupadas: [checkin, checkout) como YYYY-MM-DD. */
function enumerateNights(checkin, checkout) {
  const out = [];
  const start = new Date(checkin + 'T00:00:00Z');
  const end = new Date(checkout + 'T00:00:00Z');
  for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/* ── Conteo de usos ── */
async function getUsageCount(code, deps = {}) {
  const key = `count:${normalizeCode(code)}`;
  try {
    const raw = await getUsageStore(deps).get(key);
    if (!raw) return 0;
    const obj = JSON.parse(raw);
    return Number(obj.count) || 0;
  } catch (e) { return 0; }
}

async function emailHasUsed(code, email, deps = {}) {
  const e = normalizeEmail(email);
  if (!e) return false;
  const key = `email:${normalizeCode(code)}:${emailKeyPart(e)}`;
  try {
    const raw = await getUsageStore(deps).get(key);
    return !!raw;
  } catch (err) { return false; }
}

/* Verificación COMPLETA (reglas + usos + un-uso-por-email). Esta es la que usan
   validate-discount-code, create-wompi-signature y wompi-webhook.
   Devuelve { valid, reason, discountCents, def } — discountCents solo es > 0
   cuando valid=true y se pasó subtotalCents. */
async function verifyDiscountCode(input, deps = {}) {
  const { code, email, nights, roomTypeId, checkin, checkout, subtotalCents, now } = input || {};
  const def = await loadCode(code, deps);
  const ruled = checkRules(def, { nights, roomTypeId, checkin, checkout, now });
  if (!ruled.valid) return { valid: false, reason: ruled.reason, discountCents: 0, def: null };

  /* cupo global */
  if (def.maxUses) {
    const used = await getUsageCount(code, deps);
    if (used >= def.maxUses) return { valid: false, reason: 'exhausted', discountCents: 0, def: null };
  }

  /* un uso por email */
  if (def.onePerEmail && email) {
    if (await emailHasUsed(code, email, deps)) {
      return { valid: false, reason: 'already_used', discountCents: 0, def: null };
    }
  }

  const discountCents = Number.isFinite(subtotalCents) ? discountCentsFor(def, subtotalCents) : 0;
  return { valid: true, reason: 'ok', discountCents, def };
}

/* ── Incremento ATÓMICO del uso (CAS, patrón _rate-limit.js) ──
   Reusa compare-and-set con onlyIfMatch/onlyIfNew para que dos webhooks
   simultáneos (mismo código, reservas distintas) nunca excedan maxUses. Es
   también IDEMPOTENTE por bookingCode: si la misma reserva ya consumió el
   código (reintento de webhook), no vuelve a contar.
   Devuelve { ok, alreadyCounted, count, reason }. */
async function consumeDiscountUse(code, { email, bookingCode, maxUses } = {}, deps = {}) {
  const norm = normalizeCode(code);
  if (!norm) return { ok: false, reason: 'invalid_code' };
  const store = getUsageStore(deps);
  const countKey = `count:${norm}`;
  const dedupKey = bookingCode ? `booking:${norm}:${String(bookingCode).slice(0, 80)}` : null;

  /* Si no nos pasaron el cupo, léelo de la definición para que el incremento
     atómico respete maxUses incluso bajo concurrencia (defensa en profundidad
     sobre la validación previa). */
  if (!Number.isFinite(maxUses)) {
    try {
      const def = await loadCode(norm, deps);
      if (def && Number.isFinite(def.maxUses)) maxUses = def.maxUses;
    } catch (e) { /* sin def → sin cap, mejor contar que perder */ }
  }

  /* Idempotencia por reserva: si ya marcamos esta reserva, no recontar. */
  if (dedupKey) {
    try {
      const seen = await store.get(dedupKey);
      if (seen) return { ok: true, alreadyCounted: true, count: await getUsageCount(norm, deps) };
    } catch (e) { /* sin Blobs: seguimos best-effort */ }
  }

  const ATTEMPTS = 5;
  let finalCount = 0;
  if (typeof store.getWithMetadata === 'function') {
    let done = false;
    for (let i = 0; i < ATTEMPTS && !done; i++) {
      let current;
      try { current = await store.getWithMetadata(countKey, { type: 'text' }); }
      catch (e) { current = null; }
      let obj;
      try { obj = current && current.data ? JSON.parse(current.data) : null; }
      catch (e) { obj = null; }
      if (!obj || typeof obj.count !== 'number') obj = { count: 0 };

      if (Number.isFinite(maxUses) && maxUses > 0 && obj.count >= maxUses) {
        return { ok: false, reason: 'exhausted', count: obj.count };
      }
      obj.count += 1;

      const opts = (current && current.etag) ? { onlyIfMatch: current.etag } : { onlyIfNew: true };
      try {
        const res = await store.set(countKey, JSON.stringify(obj), opts);
        if (res && res.modified === false) continue; /* perdió la carrera, reintenta */
        finalCount = obj.count;
        done = true;
      } catch (e) {
        if (i === ATTEMPTS - 1) {
          /* CAS no soportado → fallback no atómico (mejor contar que perder). */
          return await fallbackIncrement(store, countKey, maxUses, dedupKey, email, norm, deps);
        }
      }
    }
    if (!done) return { ok: false, reason: 'contention', count: finalCount };
  } else {
    return await fallbackIncrement(store, countKey, maxUses, dedupKey, email, norm, deps);
  }

  await markConsumed(store, dedupKey, email, norm, deps);
  return { ok: true, alreadyCounted: false, count: finalCount };
}

async function fallbackIncrement(store, countKey, maxUses, dedupKey, email, norm, deps) {
  let obj;
  try { const raw = await store.get(countKey); obj = raw ? JSON.parse(raw) : null; }
  catch (e) { obj = null; }
  if (!obj || typeof obj.count !== 'number') obj = { count: 0 };
  if (Number.isFinite(maxUses) && maxUses > 0 && obj.count >= maxUses) {
    return { ok: false, reason: 'exhausted', count: obj.count };
  }
  obj.count += 1;
  try { await store.set(countKey, JSON.stringify(obj)); } catch (e) { /* best-effort */ }
  await markConsumed(store, dedupKey, email, norm, deps);
  return { ok: true, alreadyCounted: false, count: obj.count, nonAtomic: true };
}

async function markConsumed(store, dedupKey, email, norm, deps) {
  if (dedupKey) {
    try { await store.set(dedupKey, JSON.stringify({ at: new Date().toISOString() })); } catch (e) { /* non-fatal */ }
  }
  const e = normalizeEmail(email);
  if (e) {
    try {
      await store.set(`email:${norm}:${emailKeyPart(e)}`, JSON.stringify({ at: new Date().toISOString() }));
    } catch (err) { /* non-fatal */ }
  }
}

/* Restaurar un uso (cancelación de reserva con código): admin/follow-up.
   Decrementa el conteo (sin bajar de 0), borra el dedup por reserva y, si se
   pasa email, libera el un-uso-por-email. Best-effort. */
async function restoreDiscountUse(code, { email, bookingCode } = {}, deps = {}) {
  const norm = normalizeCode(code);
  if (!norm) return { ok: false, reason: 'invalid_code' };
  const store = getUsageStore(deps);
  const countKey = `count:${norm}`;
  try {
    const raw = await store.get(countKey);
    let obj = raw ? JSON.parse(raw) : { count: 0 };
    obj.count = Math.max(0, (Number(obj.count) || 0) - 1);
    await store.set(countKey, JSON.stringify(obj));
  } catch (e) { /* best-effort */ }
  if (bookingCode) {
    try { await store.delete(`booking:${norm}:${String(bookingCode).slice(0, 80)}`); } catch (e) { /* non-fatal */ }
  }
  const em = normalizeEmail(email);
  if (em) {
    try { await store.delete(`email:${norm}:${emailKeyPart(em)}`); } catch (e) { /* non-fatal */ }
  }
  return { ok: true };
}

module.exports = {
  CODES_STORE, USAGE_STORE,
  getCodesStore, getUsageStore,
  normalizeCode, normalizeEmail,
  loadCode, saveCode, listCodes, buildDefinition,
  discountCentsFor, checkRules, stayHitsBlackout, enumerateNights,
  getUsageCount, emailHasUsed,
  verifyDiscountCode, consumeDiscountUse, restoreDiscountUse
};
