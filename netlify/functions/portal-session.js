require('./_env');
const crypto = require('crypto');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limit');
const { flag } = require('./_settings');
const { verifyFirebaseToken } = require('./_firebase-auth');
const email = require('./_email');
const portalStore = require('./_portal-store');

/* ── Portal cliente (empresas / residentes) ──────────────────────────────────
   Sesión propia FIRMADA (patrón guest-session / _guest-app): NO expone
   credenciales OTASync/Odoo al cliente. Dos legs de identidad:
     1) magic-link por correo  → token corto (purpose 'magiclink', 15 min) que se
        canjea por un token de sesión (purpose 'session', 24 h).
     2) Google/Firebase        → se verifica el ID token de Firebase server-side y
        se emite el MISMO token de sesión propio.
   El token es un compacto de 2 partes base64url(payload).hmac (NO un JWT de 3
   segmentos), firmado con PORTAL_SESSION_SECRET — audiencia separada del guest
   token para que un token de huésped no verifique aquí ni viceversa.
   Gated OFF por defecto vía flag('PORTAL_ENABLED'); mock-safe (nunca lanza). */

const MAGIC_TTL_SECONDS = 15 * 60;
const SESSION_TTL_SECONDS = 24 * 60 * 60;
const PURPOSE_MAGIC = 'magiclink';
const PURPOSE_SESSION = 'session';

function corsHeaders() {
  const headers = {
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8'
  };
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin && allowedOrigin !== '*') {
    headers['Access-Control-Allow-Origin'] = allowedOrigin;
  }
  return headers;
}

function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { ...corsHeaders(), ...headers },
    body: JSON.stringify(body)
  };
}

function parseJsonBody(event, maxBytes = 5000) {
  const body = event.body || '';
  const size = Buffer.byteLength(body, event.isBase64Encoded ? 'base64' : 'utf8');
  if (size > maxBytes) {
    const error = new Error('Payload too large');
    error.statusCode = 413;
    throw error;
  }
  const decoded = event.isBase64Encoded
    ? Buffer.from(body, 'base64').toString('utf8')
    : body;
  try {
    return JSON.parse(decoded || '{}');
  } catch (error) {
    const invalid = new Error('Invalid JSON request body');
    invalid.statusCode = 400;
    throw invalid;
  }
}

function isDemoMode() {
  return process.env.NETLIFY !== 'true' && process.env.NODE_ENV !== 'production';
}

/* Secreto PROPIO del portal — nunca reutilizar GUEST_APP_TOKEN_SECRET para
   mantener audiencias de token aisladas. En demo cae a un valor fijo de
   desarrollo; en producción sin definir lanza 503 (el handler lo captura). */
function sessionSecret() {
  const configured = process.env.PORTAL_SESSION_SECRET || '';
  if (configured) return configured;
  if (isDemoMode()) return 'estar-portal-local-development-secret';
  const error = new Error('PORTAL_SESSION_SECRET is not configured');
  error.statusCode = 503;
  throw error;
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function signToken(claims, ttlSeconds) {
  const payload = {
    ...claims,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds
  };
  const encoded = base64url(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', sessionSecret())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;
  const expected = crypto
    .createHmac('sha256', sessionSecret())
    .update(encoded)
    .digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload.sub || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (error) {
    return null;
  }
}

/* ── Single-use del magic-link (anti-replay) ──────────────────────────────────
   El token de magic-link es un HMAC stateless: sin un registro de consumo sería
   canjeable N veces durante sus 15 min (reenvío de correo, Referer, logs…). Para
   cumplir la promesa de "un solo uso" del correo/portal.html persistimos un `jti`
   aleatorio en un store Blobs y lo marcamos consumido con compare-and-set. Mock-
   safe: sin Blobs no lanza. En producción, si no podemos garantizar el un-solo-
   uso, fallamos CERRADO (rechazamos); en demo local sin Blobs fallamos abierto
   para no bloquear el desarrollo. */
const MAGIC_STORE = 'portal-magic-links';

function getMagicStore() {
  const { getStore } = require('@netlify/blobs');
  const opts = { name: MAGIC_STORE, consistency: 'strong' };
  const siteID = process.env.BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) {
    opts.siteID = siteID;
    opts.token = token;
  }
  return getStore(opts);
}

/* Registra el jti recién emitido como el "vigente" para ese correo. Al emitir un
   enlace nuevo, los anteriores quedan invalidados (ver consumeMagicLink). Best-
   effort: si falla, el control principal (single-use por jti) sigue vigente. */
async function recordMagicIssued(jti, mail) {
  if (!jti || !mail) return;
  try {
    const store = getMagicStore();
    await store.set(`email/${mail}`, JSON.stringify({ jti, at: Date.now() }));
  } catch (err) { /* best-effort: no bloquea la emisión */ }
}

/* Consume el magic-link una sola vez. Devuelve { ok, reason }:
   - reason 'replayed'   → el jti ya se canjeó antes (compare-and-set).
   - reason 'superseded' → se emitió un enlace más nuevo para ese correo.
   - reason 'unavailable'→ Blobs no disponible (no pudimos garantizar single-use).
   - reason 'invalid'    → token sin jti (emitido antes de este control).
   Nunca lanza. */
async function consumeMagicLink(jti, mail) {
  if (!jti) return { ok: false, reason: 'invalid' };
  let store;
  try {
    store = getMagicStore();
  } catch (err) {
    return { ok: false, reason: 'unavailable' };
  }

  /* Invalidación de enlaces previos: si existe un jti vigente distinto para el
     correo, este enlace quedó superado. La AUSENCIA de registro no bloquea (el
     write de emisión es best-effort). */
  try {
    const raw = await store.get(`email/${mail}`);
    if (raw) {
      const latest = JSON.parse(raw);
      if (latest && latest.jti && latest.jti !== jti) {
        return { ok: false, reason: 'superseded' };
      }
    }
  } catch (err) { /* lectura fallida → no bloqueamos por este check */ }

  /* Un solo uso: marcamos consumido con compare-and-set. Si ya existía, es un
     replay. */
  try {
    const res = await store.set(
      `jti/${jti}`,
      JSON.stringify({ at: Date.now(), email: mail }),
      { onlyIfNew: true }
    );
    if (res && res.modified === false) return { ok: false, reason: 'replayed' };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'unavailable' };
  }
}

/* Enmascara un correo para logs de depuración — nunca registramos el token que
   concede acceso (contendría PII financiera si se filtra). */
function maskEmail(mail) {
  const s = String(mail || '');
  const at = s.indexOf('@');
  if (at <= 0) return '***';
  return `${s[0]}***${s.slice(at)}`;
}

/* Guard reutilizable por las funciones portal-* de datos (calca requireGuest).
   Sólo acepta tokens con purpose 'session'; lanza Error .statusCode=401. */
function verifyPortalSession(event) {
  const headers = (event && event.headers) || {};
  const auth = headers.authorization || headers.Authorization || '';
  const match = String(auth).match(/^Bearer\s+(.+)$/i);
  const payload = match ? verifyToken(match[1]) : null;
  if (!payload || payload.purpose !== PURPOSE_SESSION) return null;
  return payload;
}

function requirePortalSession(event) {
  const payload = verifyPortalSession(event);
  if (!payload) {
    const error = new Error('Portal session is invalid or expired');
    error.statusCode = 401;
    throw error;
  }
  return payload;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase().slice(0, 160);
}

function isValidEmail(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

/* Resolución de perfil (empresa | residente) — FALLBACK PURO, sin red.
   Lee la allowlist PORTAL_EMPRESA_EMAILS (coma-separada) y por defecto trata al
   usuario como 'residente'. Se usa sólo cuando el store maestro `portal-accounts`
   no tiene la cuenta (o Blobs no está disponible en demo). El resolvedor
   autoritativo es `resolvePortalAccount` (store-backed). PURO. */
function resolvePortalIdentity(rawEmail, name) {
  const mail = normalizeEmail(rawEmail);
  const empresaList = (process.env.PORTAL_EMPRESA_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  const profile = empresaList.includes(mail) ? 'empresa' : 'residente';
  return { email: mail, profile, name: String(name || '').trim().slice(0, 120) };
}

/* Resolución AUTORITATIVA de identidad del portal (server-side). Consulta el
   store maestro `portal-accounts` (`_portal-store`) por email verificado y
   deriva los claims de enrutamiento que se firman en el token de sesión:
     · empresa   → nit / empresa / odooPartnerKey
     · residente → reservation (+ reservationCodes) / odooPartnerKey
   El cliente NUNCA declara estos valores en el body: salen del store y quedan
   firmados en la sesión. Si el store no tiene la cuenta (o Blobs no está
   disponible), cae al fallback puro por allowlist de env — así la migración es
   aditiva y el modo demo sigue funcionando sin Blobs. Nunca lanza.

   Devuelve la MISMA forma base que `resolvePortalIdentity` ({ email, profile,
   name }) más los claims de enrutamiento opcionales, para no cambiar el contrato
   con el resto del handler. */
async function resolvePortalAccount(rawEmail, name) {
  const base = resolvePortalIdentity(rawEmail, name);
  let account = null;
  try {
    account = await portalStore.getAccount(base.email);
  } catch (err) {
    account = null; // best-effort: el fallback puro cubre el caso
  }
  if (!account) return base;
  const claims = portalStore.accountToClaims(account) || {};
  const identity = {
    email: base.email,
    profile: claims.profile || base.profile,
    name: claims.name || base.name
  };
  if (claims.nit) identity.nit = claims.nit;
  if (claims.empresa) identity.empresa = claims.empresa;
  if (claims.reservation) identity.reservation = claims.reservation;
  if (claims.reservationCodes) identity.reservationCodes = claims.reservationCodes;
  if (claims.odooPartnerKey != null) identity.odooPartnerKey = claims.odooPartnerKey;
  return identity;
}

/* Recoge los claims de enrutamiento (no-identidad-base) de una identidad para
   firmarlos en el token. Excluye email/profile/name (que van aparte). PURO. */
function routingClaims(identity) {
  const out = {};
  if (!identity) return out;
  if (identity.nit) out.nit = identity.nit;
  if (identity.empresa) out.empresa = identity.empresa;
  if (identity.reservation) out.reservation = identity.reservation;
  if (identity.reservationCodes) out.reservationCodes = identity.reservationCodes;
  if (identity.odooPartnerKey != null) out.odooPartnerKey = identity.odooPartnerKey;
  return out;
}

function lang(value) {
  return String(value || '').toLowerCase() === 'en' ? 'en' : 'es';
}

function siteBase(event) {
  const configured = process.env.PORTAL_BASE_URL || process.env.GUEST_APP_BASE_URL || '';
  if (configured) return configured.replace(/\/+$/, '');
  const headers = (event && event.headers) || {};
  const host = headers.host || headers.Host || 'localhost:8888';
  const proto = /^localhost|127\.0\.0\.1/.test(host) ? 'http' : 'https';
  return `${proto}://${host}`;
}

function magicLinkUrl(event, token, l) {
  const base = siteBase(event);
  const path = l === 'en' ? '/en/portal.html' : '/portal.html';
  return `${base}${path}?token=${encodeURIComponent(token)}`;
}

function magicEmailHtml(l, link) {
  const t = l === 'en'
    ? {
        eyebrow: 'Client portal',
        intro: 'Use the button below to sign in to your Estar portal. This secure link expires in 15 minutes and can be used once.',
        cta: 'Sign in to the portal',
        fine: 'If you did not request this link, you can safely ignore this email.'
      }
    : {
        eyebrow: 'Portal de clientes',
        intro: 'Usa el botón para ingresar a tu portal de Estar. Este enlace seguro expira en 15 minutos y es de un solo uso.',
        cta: 'Ingresar al portal',
        fine: 'Si no solicitaste este acceso, puedes ignorar este correo con tranquilidad.'
      };
  const bodyHtml =
    email.greeting('', l) +
    email.para(t.intro) +
    email.ctaCenter(email.ctaButton(link, t.cta)) +
    email.fineprint(t.fine);
  return email.emailShell({ lang: l, band: { eyebrow: t.eyebrow }, bodyHtml });
}

async function handleRequest(event, body) {
  const limited = await checkRateLimit(event, {
    name: 'portal-session-request',
    limit: 10,
    windowMs: 10 * 60 * 1000
  });
  if (!limited.ok) return rateLimitResponse(corsHeaders(), limited.retryAfter);

  const l = lang(body.lang);
  const mail = normalizeEmail(body.email);
  if (!isValidEmail(mail)) {
    return json(400, {
      error: l === 'en' ? 'Enter a valid email address.' : 'Ingresa un correo electrónico válido.'
    });
  }

  /* Respuesta UNIFORME: enviemos o no (no revelamos si el correo "existe").
     El correo es best-effort y nunca lanza. */
  try {
    const identity = await resolvePortalAccount(mail);
    const jti = crypto.randomBytes(16).toString('hex');
    const token = signToken(
      { sub: identity.email, profile: identity.profile, purpose: PURPOSE_MAGIC, jti },
      MAGIC_TTL_SECONDS
    );
    /* Registra el jti como vigente (single-use + invalida enlaces previos). */
    await recordMagicIssued(jti, identity.email);
    const link = magicLinkUrl(event, token, l);
    /* NUNCA registrar el enlace/token completo (concede sesión con PII financiera
       y es replayable durante 15 min). Sólo destinatario enmascarado + jti corto. */
    if (process.env.DEBUG) {
      console.log('[portal-session] magic link issued for', maskEmail(identity.email), 'jti', jti.slice(0, 8));
    }
    await email.sendEmail({
      to: mail,
      subject: l === 'en' ? 'Your Estar portal sign-in link' : 'Tu enlace de acceso al portal Estar',
      html: magicEmailHtml(l, link)
    });
  } catch (err) {
    console.error('[portal-session] request', err.message);
  }

  return json(200, { ok: true });
}

async function handleVerify(event, body) {
  const limited = await checkRateLimit(event, {
    name: 'portal-session-verify',
    limit: 20,
    windowMs: 10 * 60 * 1000
  });
  if (!limited.ok) return rateLimitResponse(corsHeaders(), limited.retryAfter);

  let identity = null;

  const firebaseToken = String(body.firebaseToken || '').trim();
  const magicToken = String(body.token || '').trim();

  if (firebaseToken) {
    /* Leg Google/Firebase: verificamos el ID token de Firebase server-side y
       emitimos NUESTRO propio token de sesión (nunca devolvemos el de Firebase). */
    let payload;
    try {
      payload = await verifyFirebaseToken(firebaseToken, process.env.FIREBASE_PROJECT_ID);
    } catch (err) {
      return json(401, { error: 'invalid_identity' });
    }
    if (!payload.email_verified || !payload.email) {
      return json(403, { error: 'email_unverified' });
    }
    identity = await resolvePortalAccount(payload.email, payload.name);
  } else if (magicToken) {
    const payload = verifyToken(magicToken);
    if (!payload || payload.purpose !== PURPOSE_MAGIC) {
      return json(401, { error: 'invalid_link' });
    }
    /* Un solo uso: consumimos el jti antes de emitir la sesión. Un replay
       (mismo enlace canjeado 2 veces) o un enlace superado por otro más nuevo se
       rechaza. Si Blobs no está disponible fallamos CERRADO en producción (no
       podemos garantizar el single-use) y sólo abierto en demo local. */
    const mail = normalizeEmail(payload.sub);
    const consumed = await consumeMagicLink(payload.jti, mail);
    if (!consumed.ok && !(consumed.reason === 'unavailable' && isDemoMode())) {
      return json(401, { error: 'invalid_link' });
    }
    /* Re-resolvemos la identidad desde el store maestro (autoritativo) en el
       canje — el claim `profile` del magic-link es sólo un hint y puede haber
       quedado obsoleto desde que se emitió el enlace. */
    identity = await resolvePortalAccount(payload.sub, payload.name);
  } else {
    return json(400, { error: 'missing_identity' });
  }

  /* El token de sesión lleva, además de la identidad base, los claims de
     enrutamiento (nit/reserva/odooPartnerKey) resueltos server-side desde el
     store — así portal-company/portal-resident no dependen de mapas de env. */
  const sessionToken = signToken(
    {
      sub: identity.email,
      profile: identity.profile,
      ...routingClaims(identity),
      purpose: PURPOSE_SESSION
    },
    SESSION_TTL_SECONDS
  );
  return json(200, {
    ok: true,
    token: sessionToken,
    profile: { email: identity.email, profile: identity.profile, name: identity.name }
  });
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  /* GATE: apagado por defecto. Inerte, sin efecto, sin filtrar nada. */
  if (!(await flag('PORTAL_ENABLED'))) {
    return json(200, { ok: false, enabled: false });
  }

  try {
    const body = parseJsonBody(event, 5000);
    const action = String(body.action || '').trim();
    if (action === 'request') return await handleRequest(event, body);
    if (action === 'verify') return await handleVerify(event, body);
    return json(400, { error: 'Unknown action' });
  } catch (error) {
    console.error('[portal-session]', error.message);
    return json(error.statusCode || 500, {
      error: error.statusCode ? error.message : 'No fue posible procesar la solicitud.'
    });
  }
};

/* Firma un token de SESIÓN del portal (purpose 'session'). Server-side; lo usa
   el handler y, si hace falta, las funciones portal-* para re-emitir. */
function signSessionToken(claims, ttlSeconds) {
  return signToken(
    { ...claims, purpose: PURPOSE_SESSION },
    ttlSeconds || SESSION_TTL_SECONDS
  );
}

/* Exportado para que las funciones portal-* de datos reutilicen el guard y la
   firma/verificación del token de sesión sin duplicar la lógica. */
exports.verifyPortalSession = verifyPortalSession;
exports.requirePortalSession = requirePortalSession;
exports.signSessionToken = signSessionToken;
exports.resolvePortalIdentity = resolvePortalIdentity;
exports.resolvePortalAccount = resolvePortalAccount;
exports.routingClaims = routingClaims;
exports.PORTAL_SESSION_TTL_SECONDS = SESSION_TTL_SECONDS;
