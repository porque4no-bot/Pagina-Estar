require('./_env');
const crypto = require('crypto');

/*
 * _crypto-vault.js — REVERSIBLE, versioned envelope encryption for guest PII.
 *
 * Why this exists (Mesa Redonda, hallazgo SecOps crítico):
 *   The previous `protectRecord` cifraba con AES-256-GCM pero NO existía ninguna
 *   función de descifrado en todo el repo, y la clave se derivaba con sha256
 *   directo del secreto (sin sal, sin KDF, sin keyId), por lo que rotar el
 *   secreto dejaba todo el histórico ilegible. Esto convertía el cifrado en
 *   "teatro de seguridad" e impedía cumplir SIRE/TRA y Ley 1581.
 *
 * What this fixes:
 *   - seal()/open() son inversos verificables (test round-trip obligatorio).
 *   - Derivación con HKDF-SHA256 (no sha256 directo), con separación de dominio
 *     por keyId.
 *   - Anillo de claves versionado: una clave activa para escribir + claves
 *     retiradas para leer => rotación real sin perder el histórico.
 *   - AAD (Additional Authenticated Data) ata cada ciphertext a su contexto
 *     (bookingCode|tipo), de modo que un sobre no puede "moverse" a otro registro.
 *   - Compatibilidad hacia atrás: open() lee los sobres viejos (`version:1`,
 *     campo `data`, derivación sha256 directa, SIN aad) además de los nuevos
 *     (`v:2`, campo `ct`, HKDF, con aad).
 *
 * Configuración (env, NUNCA en el panel — son secretos):
 *   GUEST_APP_DATA_ENCRYPTION_KEY  — secreto único (modo simple, ya en uso).
 *   GUEST_APP_KEY_RING             — opcional, JSON {"kid":"secreto", ...} para
 *                                    rotación con varias claves activas a la vez.
 *   GUEST_APP_ACTIVE_KEY_ID        — opcional, kid con el que se ESCRIBE hoy.
 *
 * Sin frameworks: solo node:crypto.
 */

const ALG = 'aes-256-gcm';
/* HKDF salt: estático a propósito. El secreto de entrada es de alta entropía,
   así que la sal solo aporta separación de dominio entre versiones/usos. */
const HKDF_SALT = Buffer.from('estar-guest-app/hkdf/v2');
const DEFAULT_KID = 'k1';

function rawSecret() {
  return process.env.GUEST_APP_DATA_ENCRYPTION_KEY || '';
}

/* Resolves the key ring: {kid -> secret}. Prefers the explicit JSON ring; always
   keeps the single GUEST_APP_DATA_ENCRYPTION_KEY available under DEFAULT_KID so
   simple single-key setups (and the legacy v1 data) keep working. */
function keyRing() {
  const ring = {};
  const explicit = process.env.GUEST_APP_KEY_RING;
  if (explicit) {
    try {
      const parsed = JSON.parse(explicit);
      if (parsed && typeof parsed === 'object') {
        for (const [kid, secret] of Object.entries(parsed)) {
          if (secret) ring[String(kid)] = String(secret);
        }
      }
    } catch (e) {
      /* malformed ring -> fall back to the single secret below */
    }
  }
  const single = rawSecret();
  if (single && !ring[DEFAULT_KID]) ring[DEFAULT_KID] = single;
  return ring;
}

function activeKeyId() {
  const configured = process.env.GUEST_APP_ACTIVE_KEY_ID;
  if (configured) return String(configured);
  const ring = keyRing();
  return Object.keys(ring)[0] || DEFAULT_KID;
}

function isConfigured() {
  return Object.keys(keyRing()).length > 0;
}

/* v2 derivation: HKDF-SHA256 -> 32 bytes, domain-separated per kid. */
function deriveV2(secret, kid) {
  const out = crypto.hkdfSync('sha256', Buffer.from(String(secret), 'utf8'), HKDF_SALT, Buffer.from('key:' + kid), 32);
  return Buffer.from(out);
}

/* v1 (legacy) derivation: sha256 directo del secreto — lo que usaba el
   protectRecord original. Solo se usa para LEER sobres viejos. */
function deriveV1(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest();
}

function requireActiveKey() {
  const ring = keyRing();
  const kid = activeKeyId();
  const secret = ring[kid];
  if (!secret) {
    const error = new Error('GUEST_APP_DATA_ENCRYPTION_KEY is not configured');
    error.statusCode = 503;
    throw error;
  }
  return { kid, secret };
}

/* seal(Buffer|string, aad?) -> envelope {v,kid,alg,iv,tag,ct} (base64url). */
function seal(plaintext, aad) {
  const { kid, secret } = requireActiveKey();
  const key = deriveV2(secret, kid);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  if (aad != null && aad !== '') cipher.setAAD(Buffer.from(String(aad), 'utf8'));
  const buf = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(String(plaintext), 'utf8');
  const ct = Buffer.concat([cipher.update(buf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 2,
    kid,
    alg: ALG,
    iv: iv.toString('base64url'),
    tag: tag.toString('base64url'),
    ct: ct.toString('base64url')
  };
}

/* open(envelope, aad?) -> Buffer. Reads BOTH v2 (HKDF + aad) and legacy v1
   (`version:1` / unversioned, sha256-direct, no aad) envelopes. Throws if the
   key is unknown or the authentication tag does not verify (tamper / wrong key /
   wrong aad). */
function open(envelope, aad) {
  if (!envelope || typeof envelope !== 'object') throw new Error('crypto-vault: invalid envelope');
  const version = Number(envelope.v || envelope.version || 1);
  const iv = Buffer.from(String(envelope.iv || ''), 'base64url');
  const tag = Buffer.from(String(envelope.tag || ''), 'base64url');
  const ctField = envelope.ct != null ? envelope.ct : envelope.data; /* v1 used `data` */
  const ct = Buffer.from(String(ctField || ''), 'base64url');

  let key;
  if (version >= 2) {
    const ring = keyRing();
    const secret = ring[envelope.kid];
    if (!secret) throw new Error('crypto-vault: unknown keyId "' + envelope.kid + '" (rotated out of the ring?)');
    key = deriveV2(secret, envelope.kid);
  } else {
    /* legacy v1: single secret, sha256 directo, sin aad. La v1 SIEMPRE se
       escribió con el secreto único, que keyRing() conserva bajo DEFAULT_KID.
       Usar DEFAULT_KID (no la clave ACTIVA) para que, tras rotar
       (GUEST_APP_ACTIVE_KEY_ID=k2), los sobres viejos sigan derivando de k1. */
    const secret = keyRing()[DEFAULT_KID] || rawSecret();
    if (!secret) throw new Error('crypto-vault: no key available for legacy envelope');
    key = deriveV1(secret);
  }

  const decipher = crypto.createDecipheriv(ALG, key, iv);
  /* v1 nunca usó AAD; solo se aplica para v2. */
  if (version >= 2 && aad != null && aad !== '') decipher.setAAD(Buffer.from(String(aad), 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

function sealJSON(obj, aad) {
  return seal(Buffer.from(JSON.stringify(obj), 'utf8'), aad);
}

function openJSON(envelope, aad) {
  return JSON.parse(open(envelope, aad).toString('utf8'));
}

module.exports = {
  isConfigured,
  activeKeyId,
  seal,
  open,
  sealJSON,
  openJSON,
  /* exported for tests */
  _test: { keyRing, deriveV1, deriveV2, DEFAULT_KID }
};
