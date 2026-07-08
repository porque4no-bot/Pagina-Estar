const test = require('node:test');
const assert = require('node:assert/strict');

/* Pruebas de lógica pura/determinista del portal-session (sin red):
   - guard verifyPortalSession sobre el token de sesión firmado (HMAC).
   - resolución de perfil empresa/residente. */

// Aislar entorno: modo demo (secreto fijo de desarrollo), sin credenciales.
const savedEnv = {};
for (const k of ['NETLIFY', 'NODE_ENV', 'PORTAL_SESSION_SECRET', 'PORTAL_EMPRESA_EMAILS']) {
  savedEnv[k] = process.env[k];
}
delete process.env.NETLIFY;
delete process.env.NODE_ENV;
delete process.env.PORTAL_SESSION_SECRET;
process.env.PORTAL_EMPRESA_EMAILS = 'ventas@acme.com, Otra@Empresa.co';

const portal = require('../../netlify/functions/portal-session');

function bearer(token) {
  return { headers: { authorization: 'Bearer ' + token } };
}

test('un token de sesión firmado verifica y devuelve el sub', () => {
  const token = portal.signSessionToken({ sub: 'cliente@correo.com', profile: 'residente' });
  const payload = portal.verifyPortalSession(bearer(token));
  assert.ok(payload, 'debe verificar');
  assert.equal(payload.sub, 'cliente@correo.com');
  assert.equal(payload.purpose, 'session');
});

test('rechaza un token manipulado', () => {
  const token = portal.signSessionToken({ sub: 'cliente@correo.com' });
  const tampered = token.slice(0, -2) + (token.slice(-2) === 'aa' ? 'bb' : 'aa');
  assert.equal(portal.verifyPortalSession(bearer(tampered)), null);
});

test('rechaza cuando no hay header Authorization', () => {
  assert.equal(portal.verifyPortalSession({ headers: {} }), null);
});

test('rechaza un token de sesión expirado', () => {
  const token = portal.signSessionToken({ sub: 'x@y.com' }, -10);
  assert.equal(portal.verifyPortalSession(bearer(token)), null);
});

test('requirePortalSession lanza 401 con token inválido', () => {
  assert.throws(
    () => portal.requirePortalSession(bearer('no.valido')),
    err => err.statusCode === 401
  );
});

test('resolvePortalIdentity mapea empresa/residente por allowlist (case-insensitive)', () => {
  const prevRes = process.env.PORTAL_RESIDENTE_EMAILS;
  process.env.PORTAL_RESIDENTE_EMAILS = 'residente@correo.com';
  assert.equal(portal.resolvePortalIdentity('VENTAS@ACME.COM').profile, 'empresa');
  assert.equal(portal.resolvePortalIdentity('otra@empresa.co').profile, 'empresa');
  assert.equal(portal.resolvePortalIdentity('RESIDENTE@Correo.com').profile, 'residente');
  if (prevRes === undefined) delete process.env.PORTAL_RESIDENTE_EMAILS; else process.env.PORTAL_RESIDENTE_EMAILS = prevRes;
});

test('resolvePortalIdentity: default-DENY (profile null) para correo desconocido con allowlist activa', () => {
  // PORTAL_EMPRESA_EMAILS está seteado ⇒ lockdown activo ⇒ un correo cualquiera NO
  // obtiene sesión de 'residente' por defecto (endurecimiento de acceso).
  assert.equal(portal.resolvePortalIdentity('persona@gmail.com').profile, null);
});

test('resolvePortalIdentity: SIN allowlist (demo/rollout) conserva el fallback a residente', () => {
  const prevEmp = process.env.PORTAL_EMPRESA_EMAILS;
  const prevRes = process.env.PORTAL_RESIDENTE_EMAILS;
  delete process.env.PORTAL_EMPRESA_EMAILS;
  delete process.env.PORTAL_RESIDENTE_EMAILS;
  assert.equal(portal.resolvePortalIdentity('persona@gmail.com').profile, 'residente');
  if (prevEmp === undefined) delete process.env.PORTAL_EMPRESA_EMAILS; else process.env.PORTAL_EMPRESA_EMAILS = prevEmp;
  if (prevRes === undefined) delete process.env.PORTAL_RESIDENTE_EMAILS; else process.env.PORTAL_RESIDENTE_EMAILS = prevRes;
});

test('resolvePortalIdentity normaliza el correo', () => {
  const id = portal.resolvePortalIdentity('  Cliente@Correo.Com  ');
  assert.equal(id.email, 'cliente@correo.com');
});

test.after(() => {
  for (const k of Object.keys(savedEnv)) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});
