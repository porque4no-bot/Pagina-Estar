// Dependency-free Firebase ID token verification + admin allowlist.
// Firebase ID tokens are RS256 JWTs signed by Google's securetoken service.
// We verify the signature against Google's published X.509 certs and validate
// the standard claims, then enforce an email allowlist (ADMIN_EMAILS).

const crypto = require('crypto');

const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

let certCache = { certs: null, expiresAt: 0 };

async function getGoogleCerts() {
  const now = Date.now();
  if (certCache.certs && now < certCache.expiresAt) return certCache.certs;

  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new Error('No se pudieron obtener las claves de Google');
  const certs = await res.json();

  // Respect Cache-Control max-age so we refresh when Google rotates keys.
  let maxAge = 3600;
  const cacheControl = res.headers.get('cache-control');
  if (cacheControl) {
    const m = cacheControl.match(/max-age=(\d+)/);
    if (m) maxAge = parseInt(m[1], 10);
  }
  certCache = { certs, expiresAt: now + maxAge * 1000 };
  return certs;
}

function decodeSegment(seg) {
  return JSON.parse(Buffer.from(seg, 'base64url').toString('utf8'));
}

// Verifies a Firebase ID token. Returns the decoded payload, or throws.
async function verifyFirebaseToken(idToken, projectId) {
  if (!idToken || typeof idToken !== 'string') throw new Error('Token ausente');
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID no configurado');

  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Token malformado');

  const [headerB64, payloadB64, signatureB64] = parts;
  const header = decodeSegment(headerB64);
  const payload = decodeSegment(payloadB64);

  if (header.alg !== 'RS256') throw new Error('Algoritmo inválido');
  if (!header.kid) throw new Error('Token sin kid');

  const certs = await getGoogleCerts();
  const cert = certs[header.kid];
  if (!cert) throw new Error('Clave de firma desconocida');

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const signature = Buffer.from(signatureB64, 'base64url');
  if (!verifier.verify(cert, signature)) throw new Error('Firma inválida');

  const now = Math.floor(Date.now() / 1000);
  const skew = 60;
  const expectedIss = `https://securetoken.google.com/${projectId}`;

  if (payload.aud !== projectId) throw new Error('Audiencia inválida');
  if (payload.iss !== expectedIss) throw new Error('Emisor inválido');
  if (typeof payload.exp !== 'number' || payload.exp < now - skew) throw new Error('Token expirado');
  if (typeof payload.iat !== 'number' || payload.iat > now + skew) throw new Error('Token emitido en el futuro');
  if (!payload.sub) throw new Error('Token sin sujeto');

  return payload;
}

function getAllowlist() {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
}

// Verifies the Authorization header and enforces the admin allowlist.
// Returns { ok: true, email } or { ok: false, statusCode, error }.
async function authenticateAdmin(event) {
  const authHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return { ok: false, statusCode: 401, error: 'Autenticación requerida' };

  let payload;
  try {
    payload = await verifyFirebaseToken(match[1], process.env.FIREBASE_PROJECT_ID);
  } catch (err) {
    return { ok: false, statusCode: 401, error: `Token inválido: ${err.message}` };
  }

  const email = (payload.email || '').toLowerCase();
  if (!payload.email_verified) return { ok: false, statusCode: 403, error: 'Correo no verificado' };

  const allowlist = getAllowlist();
  if (allowlist.length === 0) return { ok: false, statusCode: 403, error: 'ADMIN_EMAILS no configurado' };
  if (!allowlist.includes(email)) return { ok: false, statusCode: 403, error: 'Acceso no autorizado' };

  return { ok: true, email };
}

module.exports = { verifyFirebaseToken, authenticateAdmin };
