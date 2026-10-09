/* Frente codes — REGLAS (plantillas) de códigos de descuento + emisión de
 * códigos PERSONALES desde una regla.
 *
 * Una regla NO es un código: es la plantilla con la que se emiten códigos
 * únicos (aleatorios o escritos por el admin) ligados al email de un huésped.
 * El código emitido es una definición normal de _discount-store (store
 * 'discount-codes') que COPIA las condiciones de la regla en el momento de
 * emitirse (snapshot): cambiar la regla después no altera lo ya prometido a un
 * huésped. La validación/aplicación del código sigue 100% en el camino
 * autoritativo de _discount-store.verifyDiscountCode (email ligado, vigencia,
 * mínimo de noches, fechas bloqueadas, cupo atómico).
 *
 * Store en Netlify Blobs: 'discount-rules' (clave = id de la regla, minúsculas).
 *
 * Campos de una regla:
 *   id, name, purpose ('general' | 'review'), prefix (prefijo del código),
 *   type ('percent' | 'fixed'), value,
 *   validityMode ('days' | 'fixed'), validityDays (días desde la emisión) o
 *   validFrom/validTo (fechas fijas), minNights, roomTypeIds, blackoutDates,
 *   singleUse (→ maxUses 1), maxUses, bindEmail (el código queda ligado al
 *   email del huésped), onePerEmail, active, description, audit.
 *
 * La parte admin funciona siempre (no depende de DISCOUNT_CODES_ENABLED); que
 * el huésped pueda USAR el código en el motor sí depende de ese flag.
 *
 * Mock-safe: sin Blobs las lecturas devuelven vacío; las escrituras propagan
 * el error (el handler lo traduce a 503). Inyección de dependencias
 * (deps.getStore, deps.randomInt, deps.now) para tests sin red. */

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');
const discountStore = require('./_discount-store');

const RULES_STORE = 'discount-rules';
const PURPOSES = new Set(['general', 'review']);
const MAX_VALIDITY_DAYS = 730;
/* Alfabeto sin caracteres ambiguos (0/O, 1/I/L) para dictar el código. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const RANDOM_LEN = 8;

function getRulesStore(deps = {}) {
  const get = deps.getStore || getStore;
  const opts = { name: RULES_STORE, consistency: 'strong' };
  const siteID = process.env.BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) { opts.siteID = siteID; opts.token = token; }
  return get(opts);
}

/* id de regla: minúsculas a-z 0-9 - _ (clave de blob), 2-40 chars. */
function normalizeRuleId(raw) {
  return String(raw || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '').slice(0, 40);
}

/* Prefijo de los códigos emitidos: A-Z 0-9, 2-12 chars. */
function normalizePrefix(raw) {
  return String(raw || '').trim().toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

function isoDateOnly(v) {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function addDays(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function nowIso(deps) {
  if (deps && typeof deps.now === 'function') return deps.now();
  return new Date().toISOString();
}

/* ── Construcción/normalización de una regla (pura) ──
   Devuelve { rule } o { error } (mensaje en español para el panel). */
function buildRule(input, opts = {}) {
  const src = input || {};
  const id = opts.existing ? opts.existing.id : normalizeRuleId(src.id || src.name);
  if (!id || id.length < 2) return { error: 'La regla necesita un nombre (o id) de al menos 2 caracteres.' };

  const name = String(src.name || '').trim().slice(0, 80);
  if (!name) return { error: 'La regla necesita un nombre.' };

  const purpose = PURPOSES.has(src.purpose) ? src.purpose : 'general';

  const prefix = normalizePrefix(src.prefix || name);
  if (prefix.length < 2) return { error: 'El prefijo del código debe tener al menos 2 letras o números.' };

  const type = src.type === 'fixed' ? 'fixed' : src.type === 'percent' ? 'percent' : null;
  if (!type) return { error: 'Tipo inválido: usa "percent" (porcentaje) o "fixed" (valor fijo).' };

  const value = Number(src.value);
  if (!Number.isFinite(value) || value <= 0) return { error: 'El valor del descuento debe ser mayor que cero.' };
  if (type === 'percent' && value > 100) return { error: 'Un descuento porcentual no puede superar 100%.' };

  const validityMode = src.validityMode === 'fixed' ? 'fixed' : 'days';
  let validityDays = null;
  let validFrom = null;
  let validTo = null;
  if (validityMode === 'days') {
    validityDays = parseInt(src.validityDays, 10);
    if (!Number.isFinite(validityDays) || validityDays <= 0 || validityDays > MAX_VALIDITY_DAYS) {
      return { error: `La vigencia en días debe ser un entero entre 1 y ${MAX_VALIDITY_DAYS}.` };
    }
  } else {
    validFrom = isoDateOnly(src.validFrom);
    validTo = isoDateOnly(src.validTo);
    if (src.validFrom && !validFrom) return { error: 'La fecha "desde" debe ser YYYY-MM-DD.' };
    if (src.validTo && !validTo) return { error: 'La fecha "hasta" debe ser YYYY-MM-DD.' };
    if (!validTo) return { error: 'Con vigencia de fechas fijas, la fecha "hasta" es obligatoria.' };
    if (validFrom && validFrom > validTo) return { error: 'La fecha "desde" no puede ser posterior a la fecha "hasta".' };
  }

  let minNights = null;
  if (src.minNights !== undefined && src.minNights !== null && src.minNights !== '') {
    minNights = parseInt(src.minNights, 10);
    if (!Number.isFinite(minNights) || minNights <= 0) return { error: 'El mínimo de noches debe ser un entero positivo.' };
  }

  const singleUse = src.singleUse === true || src.singleUse === 'true';
  let maxUses = null;
  if (singleUse) {
    maxUses = 1;
  } else if (src.maxUses !== undefined && src.maxUses !== null && src.maxUses !== '') {
    maxUses = parseInt(src.maxUses, 10);
    if (!Number.isFinite(maxUses) || maxUses <= 0) return { error: 'Los usos máximos deben ser un entero positivo (o vacío para ilimitado).' };
  }

  let roomTypeIds = [];
  if (Array.isArray(src.roomTypeIds)) roomTypeIds = src.roomTypeIds.map(r => String(r).trim()).filter(Boolean).slice(0, 20);

  const blackoutDates = [];
  if (Array.isArray(src.blackoutDates)) {
    for (const b of src.blackoutDates.slice(0, 60)) {
      if (typeof b === 'string') {
        const d = isoDateOnly(b);
        if (d) blackoutDates.push({ from: d, to: d });
      } else if (b && typeof b === 'object') {
        const from = isoDateOnly(b.from);
        const to = isoDateOnly(b.to) || from;
        if (from) {
          if (to < from) return { error: 'Un rango de fechas bloqueadas termina antes de empezar.' };
          blackoutDates.push({ from, to });
        }
      }
    }
  }

  const now = opts.now || new Date().toISOString();
  const actor = opts.actor || 'system';
  const rule = {
    id,
    name,
    purpose,
    prefix,
    type,
    value,
    validityMode,
    validityDays,
    validFrom,
    validTo,
    minNights,
    roomTypeIds,
    blackoutDates,
    singleUse,
    maxUses,
    bindEmail: src.bindEmail !== false && src.bindEmail !== 'false', /* por defecto: ligado al email */
    onePerEmail: src.onePerEmail !== false && src.onePerEmail !== 'false',
    active: src.active === true || src.active === 'true',
    description: String(src.description || '').slice(0, 200),
    createdAt: opts.existing ? opts.existing.createdAt : now,
    createdBy: opts.existing ? opts.existing.createdBy : actor,
    updatedAt: now,
    updatedBy: actor,
    audit: Array.isArray(opts.existing && opts.existing.audit) ? opts.existing.audit.slice(-50) : []
  };
  rule.audit.push({ at: now, by: actor, action: opts.existing ? 'update' : 'create', active: rule.active });
  return { rule };
}

/* ── CRUD ── */
async function loadRule(id, deps = {}) {
  const key = normalizeRuleId(id);
  if (!key) return null;
  let raw;
  try { raw = await getRulesStore(deps).get(key); }
  catch (e) { return null; }
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

async function saveRule(rule, deps = {}) {
  const key = normalizeRuleId(rule && rule.id);
  if (!key) throw new Error('regla inválida');
  rule.id = key;
  await getRulesStore(deps).set(key, JSON.stringify(rule));
  return rule;
}

async function listRules(deps = {}) {
  const store = getRulesStore(deps);
  let listing;
  try { listing = await store.list(); }
  catch (e) { return []; }
  const rows = await discountStore.mapLimit(listing.blobs || [], 8, async (b) => {
    try {
      const raw = await store.get(b.key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; /* salta ilegibles */ }
  });
  const out = rows.filter(Boolean);
  out.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return out;
}

/* La regla de reseña vigente: la regla ACTIVA con purpose 'review' editada más
   recientemente. null si no hay ninguna. */
function pickReviewRule(rules) {
  const active = (rules || []).filter(r => r && r.active && r.purpose === 'review');
  active.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return active[0] || null;
}

/* ── Generación de códigos ── */
function randomChunk(len, deps = {}) {
  const rnd = deps.randomInt || ((max) => crypto.randomInt(max));
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[rnd(CODE_ALPHABET.length)];
  return out;
}

function generateCode(prefix, deps = {}) {
  const p = normalizePrefix(prefix) || 'ESTAR';
  return `${p}-${randomChunk(RANDOM_LEN, deps)}`;
}

/* Entrada para _discount-store.buildDefinition a partir de una regla (pura).
   Calcula la vigencia: modo 'days' ⇒ desde hoy (Colombia) hasta hoy+N días;
   modo 'fixed' ⇒ copia las fechas de la regla. */
function codeInputFromRule(rule, { code, email, note, today } = {}) {
  const day = isoDateOnly(today) || discountStore.todayBogota();
  let validFrom = null;
  let validTo = null;
  if (rule.validityMode === 'fixed') {
    validFrom = rule.validFrom || null;
    validTo = rule.validTo || null;
  } else {
    validFrom = day;
    validTo = addDays(day, Number(rule.validityDays) || 30);
  }
  return {
    code,
    type: rule.type,
    value: rule.value,
    validFrom,
    validTo,
    maxUses: rule.singleUse ? 1 : (rule.maxUses || null),
    onePerEmail: rule.onePerEmail !== false,
    minNights: rule.minNights || null,
    roomTypeIds: Array.isArray(rule.roomTypeIds) ? rule.roomTypeIds.slice() : [],
    notCombinable: true,
    blackoutDates: Array.isArray(rule.blackoutDates) ? rule.blackoutDates.map(b => ({ from: b.from, to: b.to || b.from })) : [],
    active: true,
    boundEmail: rule.bindEmail !== false ? (email || '') : '',
    description: String(note || '').slice(0, 200) || `Regla: ${rule.name}`
  };
}

/* Emite un código personal desde una regla. Valida que la regla exista y esté
   activa, que el email sea válido, que la vigencia fija no haya vencido, y crea
   el código con alta atómica (onlyIfNew) — si el admin escribió el código y ya
   existe ⇒ error 409; si es aleatorio y colisiona, reintenta.
   Devuelve { ok:true, def } o { ok:false, status, error }. */
async function issueCodeFromRule(ruleOrId, params = {}, deps = {}) {
  const rule = (ruleOrId && typeof ruleOrId === 'object') ? ruleOrId : await loadRule(ruleOrId, deps);
  if (!rule) return { ok: false, status: 404, error: 'Regla no encontrada.' };
  if (!rule.active) return { ok: false, status: 409, error: 'La regla está inactiva: actívala para emitir códigos.' };

  const email = discountStore.normalizeEmail(params.email);
  if (!discountStore.isValidEmail(email)) return { ok: false, status: 400, error: 'Ingresa un email válido del huésped.' };

  const today = isoDateOnly(params.today) || discountStore.todayBogota();
  if (rule.validityMode === 'fixed' && rule.validTo && rule.validTo < today) {
    return { ok: false, status: 409, error: 'La vigencia de la regla ya terminó: ajusta las fechas antes de emitir.' };
  }

  const custom = discountStore.normalizeCode(params.code);
  if (params.code && custom.length < 3) {
    return { ok: false, status: 400, error: 'El código personalizado debe tener al menos 3 caracteres (A-Z, 0-9, - o _).' };
  }

  const at = nowIso(deps);
  const meta = {
    origin: params.origin === 'review' ? 'review' : 'personal',
    ruleId: rule.id,
    reviewId: params.reviewId || null,
    issuedAt: at,
    issuedToName: params.name || null,
    issuedToEmail: email,
    lang: params.lang === 'en' ? 'en' : 'es'
  };

  const attempts = custom ? 1 : 6;
  for (let i = 0; i < attempts; i++) {
    const code = custom || generateCode(rule.prefix, deps);
    const input = codeInputFromRule(rule, { code, email, note: params.note, today });
    const built = discountStore.buildDefinition(input, { actor: params.actor || 'system', now: at, meta });
    if (built.error) return { ok: false, status: 400, error: built.error };
    const res = await discountStore.createCodeIfNew(built.def, deps);
    if (res.ok) return { ok: true, def: res.def, rule };
    if (custom) return { ok: false, status: 409, error: 'Ese código ya existe. Escribe otro o déjalo vacío para generar uno aleatorio.' };
  }
  return { ok: false, status: 503, error: 'No se pudo generar un código único. Intenta de nuevo.' };
}

/* Texto humano del descuento (para el correo y el panel). */
function describeDiscount(def, lang) {
  const en = lang === 'en';
  if (!def) return '';
  if (def.type === 'fixed') {
    const cop = '$' + Math.round(Number(def.value) || 0).toLocaleString('es-CO');
    return en ? `${cop} COP off` : `${cop} de descuento`;
  }
  return en ? `${def.value}% off` : `${def.value}% de descuento`;
}

/* Envía al huésped el correo con su código (plantilla ES/EN en _email.js).
   kind: 'review' | 'personal'. Destinatario: `to` o, si no, el email al que se
   emitió. Best-effort: devuelve { sent, reason? } y nunca lanza. deps.sendEmail
   permite inyectar el envío en tests. */
async function sendIssuedCodeEmail(def, { kind, name, lang, to } = {}, deps = {}) {
  try {
    const recipient = to || (def && (def.boundEmail || def.issuedToEmail));
    if (!def || !recipient) return { sent: false, reason: 'no-recipient' };
    const email = require('./_email');
    const l = lang === 'en' ? 'en' : 'es';
    const html = email.discountCodeEmailHtml({
      kind: kind === 'review' ? 'review' : 'personal',
      lang: l,
      guestName: name || '',
      code: def.code,
      discountText: describeDiscount(def, l),
      validTo: def.validTo || null,
      minNights: def.minNights || null,
      blackoutDates: def.blackoutDates || [],
      boundEmail: def.boundEmail || null,
      singleUse: def.maxUses === 1
    });
    const subject = email.discountCodeEmailSubject({ kind: kind === 'review' ? 'review' : 'personal', lang: l });
    const send = deps.sendEmail || email.sendEmail;
    const res = await send({ to: recipient, subject, html });
    return { sent: !!(res && res.sent), reason: res && res.reason };
  } catch (e) {
    console.error('[discount-rules] code email failed:', e.message);
    return { sent: false, reason: 'error' };
  }
}

module.exports = {
  RULES_STORE, CODE_ALPHABET,
  getRulesStore, normalizeRuleId, normalizePrefix, addDays,
  buildRule, loadRule, saveRule, listRules, pickReviewRule,
  generateCode, codeInputFromRule, issueCodeFromRule,
  describeDiscount, sendIssuedCodeEmail
};
