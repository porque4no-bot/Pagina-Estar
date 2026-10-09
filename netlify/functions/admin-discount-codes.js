require('./_env');
const { authorize } = require('./_authz');
const { flag } = require('./_settings');
const {
  loadCode, saveCode, listCodes, buildDefinition, getUsageCount, normalizeCode, listCodeBookings, mapLimit
} = require('./_discount-store');
const rules = require('./_discount-rules');
const reviews = require('./_discount-reviews');

/* Panel admin de códigos de descuento (Frente A + Frente codes).
 *
 * Acciones (POST { action, ... }):
 *   Códigos
 *     list       → todos los códigos + conteo de usos (+ reservas que usaron
 *                  los códigos emitidos) + estado del flag público.   (quotes.view)
 *     get        → un código por su id.                               (quotes.view)
 *     create     → crea un código nuevo (manual).                     (quotes.edit)
 *     update     → edita un código existente.                         (quotes.edit)
 *     deactivate → apaga un código (active=false) sin borrarlo.       (quotes.edit)
 *     activate   → enciende un código.                                (quotes.edit)
 *   Reglas / plantillas (Frente codes)
 *     rule-list / rule-get                                            (quotes.view)
 *     rule-create / rule-update / rule-activate / rule-deactivate     (quotes.edit)
 *   Códigos personales (Frente codes)
 *     issue      → genera un código único desde una regla, ligado al
 *                  email del huésped (opcional: enviarlo por correo).  (quotes.edit)
 *   Reseñas (Frente codes)
 *     review-list                                                     (quotes.view)
 *     review-create  (approve:true ⇒ registra y aprueba de una vez)   (quotes.edit)
 *     review-approve → emite el código de la regla de reseña y lo
 *                      envía por correo. Idempotente.                 (quotes.edit)
 *     review-reject / review-resend                                   (quotes.edit)
 *
 * Reusa el catálogo de permisos existente (quotes.view / quotes.edit) — no
 * añade permisos nuevos para no tocar _permissions.js. La parte admin funciona
 * SIEMPRE; que el huésped pueda usar un código en el motor depende de
 * DISCOUNT_CODES_ENABLED (se informa en `list` como discountEnabled para que el
 * panel avise).
 *
 * Identidad 100% Firebase vía _authz.authorize. Mock-safe: sin Blobs, las
 * lecturas devuelven vacío y las escrituras propagan el error como 503. */

const READ_ACTIONS = new Set(['list', 'get', 'rule-list', 'rule-get', 'review-list']);
const WRITE_ACTIONS = new Set([
  'create', 'update', 'deactivate', 'activate',
  'rule-create', 'rule-update', 'rule-activate', 'rule-deactivate',
  'issue',
  'review-create', 'review-approve', 'review-reject', 'review-resend'
]);

function corsHeaders() {
  const headers = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;
  return headers;
}

function reply(headers, statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

/* Adjunta usos (y, para los emitidos a un huésped, las reservas que lo usaron). */
async function withUsage(def) {
  try { def.usedCount = await getUsageCount(def.code); } catch (e) { def.usedCount = 0; }
  if (def.usedCount > 0 && (def.origin === 'personal' || def.origin === 'review' || def.boundEmail)) {
    try { def.usedBy = await listCodeBookings(def.code); } catch (e) { def.usedBy = []; }
  }
  return def;
}

async function discountEnabled() {
  try { return await flag('DISCOUNT_CODES_ENABLED'); } catch (e) { return false; }
}

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return reply(headers, 405, { error: 'Method Not Allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return reply(headers, 400, { error: 'JSON inválido' }); }

  const action = String(body.action || '').trim();
  const isRead = READ_ACTIONS.has(action);
  const isWrite = WRITE_ACTIONS.has(action);
  if (!isRead && !isWrite) {
    return reply(headers, 400, { error: 'Acción inválida' });
  }

  const auth = await authorize(event, isWrite ? 'quotes.edit' : 'quotes.view');
  if (!auth.ok) return reply(headers, auth.statusCode, { error: auth.error });
  const actor = auth.email || 'admin';

  try {
    /* ── Códigos ── */
    if (action === 'list') {
      const codes = await listCodes();
      await mapLimit(codes, 8, withUsage);
      codes.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
      return reply(headers, 200, { codes, discountEnabled: await discountEnabled() });
    }

    if (action === 'get') {
      const code = normalizeCode(body.code);
      const def = await loadCode(code);
      if (!def) return reply(headers, 404, { error: 'Código no encontrado' });
      await withUsage(def);
      return reply(headers, 200, { code: def });
    }

    if (action === 'create') {
      const code = normalizeCode(body.code);
      const existing = await loadCode(code);
      if (existing) return reply(headers, 409, { error: 'Ya existe un código con ese nombre. Usa "update" para editarlo.' });
      const { def, error } = buildDefinition(body, { actor });
      if (error) return reply(headers, 400, { error });
      await saveCode(def);
      return reply(headers, 200, { ok: true, code: def });
    }

    if (action === 'update') {
      const code = normalizeCode(body.code);
      const existing = await loadCode(code);
      if (!existing) return reply(headers, 404, { error: 'Código no encontrado' });
      const { def, error } = buildDefinition(body, { actor, existing });
      if (error) return reply(headers, 400, { error });
      await saveCode(def);
      return reply(headers, 200, { ok: true, code: def });
    }

    if (action === 'deactivate' || action === 'activate') {
      const code = normalizeCode(body.code);
      const existing = await loadCode(code);
      if (!existing) return reply(headers, 404, { error: 'Código no encontrado' });
      const wantActive = action === 'activate';
      const { def, error } = buildDefinition(
        Object.assign({}, existing, { active: wantActive }),
        { actor, existing }
      );
      if (error) return reply(headers, 400, { error });
      await saveCode(def);
      return reply(headers, 200, { ok: true, code: def });
    }

    /* ── Reglas ── */
    if (action === 'rule-list') {
      return reply(headers, 200, { rules: await rules.listRules() });
    }

    if (action === 'rule-get') {
      const rule = await rules.loadRule(body.id);
      if (!rule) return reply(headers, 404, { error: 'Regla no encontrada' });
      return reply(headers, 200, { rule });
    }

    if (action === 'rule-create') {
      const { rule, error } = rules.buildRule(body, { actor });
      if (error) return reply(headers, 400, { error });
      if (await rules.loadRule(rule.id)) {
        return reply(headers, 409, { error: 'Ya existe una regla con ese nombre/id. Edítala o usa otro nombre.' });
      }
      await rules.saveRule(rule);
      return reply(headers, 200, { ok: true, rule });
    }

    if (action === 'rule-update') {
      const existing = await rules.loadRule(body.id);
      if (!existing) return reply(headers, 404, { error: 'Regla no encontrada' });
      const { rule, error } = rules.buildRule(body, { actor, existing });
      if (error) return reply(headers, 400, { error });
      await rules.saveRule(rule);
      return reply(headers, 200, { ok: true, rule });
    }

    if (action === 'rule-activate' || action === 'rule-deactivate') {
      const existing = await rules.loadRule(body.id);
      if (!existing) return reply(headers, 404, { error: 'Regla no encontrada' });
      const { rule, error } = rules.buildRule(
        Object.assign({}, existing, { active: action === 'rule-activate' }),
        { actor, existing }
      );
      if (error) return reply(headers, 400, { error });
      await rules.saveRule(rule);
      return reply(headers, 200, { ok: true, rule });
    }

    /* ── Código personal ── */
    if (action === 'issue') {
      const issued = await rules.issueCodeFromRule(body.ruleId, {
        email: body.email,
        name: body.name,
        note: body.note,
        code: body.code,
        lang: body.lang,
        origin: 'personal',
        actor
      });
      if (!issued.ok) return reply(headers, issued.status || 400, { error: issued.error });
      let email = null;
      if (body.sendEmail === true || body.sendEmail === 'true') {
        email = await rules.sendIssuedCodeEmail(issued.def, { kind: 'personal', name: body.name, lang: body.lang, to: issued.def.issuedToEmail });
      }
      return reply(headers, 200, { ok: true, code: issued.def, email, discountEnabled: await discountEnabled() });
    }

    /* ── Reseñas ── */
    if (action === 'review-list') {
      return reply(headers, 200, { reviews: await reviews.listReviews(), discountEnabled: await discountEnabled() });
    }

    if (action === 'review-create') {
      const created = await reviews.createReview(body, { actor });
      if (!created.ok) return reply(headers, created.status || 400, { error: created.error, duplicate: created.duplicate || null });
      if (body.approve === true || body.approve === 'true') {
        const approved = await reviews.approveReview(created.review.id, { actor, ruleId: body.ruleId || null, sendEmail: body.sendEmail !== false });
        if (!approved.ok) {
          /* La reseña quedó registrada como pendiente; el error explica por qué no se aprobó. */
          return reply(headers, approved.status || 400, { error: approved.error, review: created.review, pending: true });
        }
        return reply(headers, 200, Object.assign({ ok: true, discountEnabled: await discountEnabled() }, approved));
      }
      return reply(headers, 200, { ok: true, review: created.review });
    }

    if (action === 'review-approve') {
      const approved = await reviews.approveReview(body.id, { actor, ruleId: body.ruleId || null, sendEmail: body.sendEmail !== false });
      if (!approved.ok) return reply(headers, approved.status || 400, { error: approved.error });
      return reply(headers, 200, Object.assign({ discountEnabled: await discountEnabled() }, approved));
    }

    if (action === 'review-reject') {
      const res = await reviews.rejectReview(body.id, { actor, reason: body.reason });
      if (!res.ok) return reply(headers, res.status || 400, { error: res.error });
      return reply(headers, 200, res);
    }

    if (action === 'review-resend') {
      const res = await reviews.resendReviewEmail(body.id, { actor });
      if (!res.ok) return reply(headers, res.status || 400, { error: res.error });
      return reply(headers, 200, res);
    }

    return reply(headers, 400, { error: 'Acción inválida' });
  } catch (e) {
    console.error('[admin-discount-codes]', action, e.message);
    return reply(headers, 503, { error: 'Almacenamiento no disponible' });
  }
};

exports._test = { READ_ACTIONS, WRITE_ACTIONS, withUsage };
