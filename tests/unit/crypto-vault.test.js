/* Mesa Redonda — bloqueante SecOps: el cifrado de PII debe ser REVERSIBLE,
 * con clave versionada y rotable, y debe seguir leyendo el formato viejo.
 * Estos tests son el "round-trip obligatorio que revienta el build" si el
 * cifrado dejara de poder descifrarse. Sin red ni Blobs. */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const VAULT = require.resolve('../../netlify/functions/_crypto-vault');
const GAPP = require.resolve('../../netlify/functions/_guest-app');

/* Corre `fn` con un entorno de claves dado y los módulos recargados en limpio. */
function withEnv(env, fn) {
  const keys = ['GUEST_APP_DATA_ENCRYPTION_KEY', 'GUEST_APP_KEY_RING', 'GUEST_APP_ACTIVE_KEY_ID', 'GUEST_APP_DEMO_MODE', 'NODE_ENV', 'NETLIFY'];
  const saved = {};
  for (const k of keys) saved[k] = process.env[k];
  for (const k of keys) delete process.env[k];
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  delete require.cache[VAULT];
  delete require.cache[GAPP];
  try {
    return fn();
  } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    delete require.cache[VAULT];
    delete require.cache[GAPP];
  }
}

test('seal/open round-trip (v2) con AAD', () => {
  withEnv({ GUEST_APP_DATA_ENCRYPTION_KEY: 'super-secret-key-12345' }, () => {
    const vault = require('../../netlify/functions/_crypto-vault');
    const env = vault.seal(Buffer.from('cédula 1.234.567', 'utf8'), 'EST-1|guest-document');
    assert.equal(env.v, 2);
    assert.equal(env.kid, 'k1');
    assert.equal(env.alg, 'aes-256-gcm');
    const back = vault.open(env, 'EST-1|guest-document').toString('utf8');
    assert.equal(back, 'cédula 1.234.567');
  });
});

test('open con AAD equivocada FALLA (el sobre no se puede mover de contexto)', () => {
  withEnv({ GUEST_APP_DATA_ENCRYPTION_KEY: 'super-secret-key-12345' }, () => {
    const vault = require('../../netlify/functions/_crypto-vault');
    const env = vault.seal(Buffer.from('secreto'), 'EST-1|guest-document');
    assert.throws(() => vault.open(env, 'EST-2|guest-document'));
  });
});

test('open con ciphertext alterado FALLA (authTag)', () => {
  withEnv({ GUEST_APP_DATA_ENCRYPTION_KEY: 'super-secret-key-12345' }, () => {
    const vault = require('../../netlify/functions/_crypto-vault');
    const env = vault.seal(Buffer.from('secreto'), 'aad');
    const tampered = { ...env, ct: Buffer.from('00000000', 'hex').toString('base64url') };
    assert.throws(() => vault.open(tampered, 'aad'));
  });
});

test('compat: descifra un sobre LEGADO v1 (sha256 directo, campo data, sin AAD)', () => {
  withEnv({ GUEST_APP_DATA_ENCRYPTION_KEY: 'super-secret-key-12345' }, () => {
    const vault = require('../../netlify/functions/_crypto-vault');
    /* Reproduce el formato del protectRecord ORIGINAL. */
    const key = crypto.createHash('sha256').update('super-secret-key-12345').digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(Buffer.from('dato viejo', 'utf8')), cipher.final()]);
    const tag = cipher.getAuthTag();
    const legacy = { version: 1, algorithm: 'aes-256-gcm', iv: iv.toString('base64url'), tag: tag.toString('base64url'), data: ct.toString('base64url') };
    assert.equal(vault.open(legacy).toString('utf8'), 'dato viejo');
  });
});

test('protectRecord -> unprotectRecord round-trip de un expediente completo', () => {
  withEnv({ GUEST_APP_DATA_ENCRYPTION_KEY: 'super-secret-key-12345' }, () => {
    const { protectRecord, unprotectRecord } = require('../../netlify/functions/_guest-app');
    const record = {
      bookingCode: 'EST-42', type: 'checkin', checkinId: 'chk_1', createdAt: '2026-06-22T00:00:00Z',
      guests: [{ first_name: 'Ana', last_name: 'Ríos', document: '12345', sire: { gender: 'F' } }]
    };
    const sealed = protectRecord(record);
    assert.equal(sealed.encrypted, true);
    assert.equal(sealed.v, 2);
    assert.equal(sealed.bookingCode, 'EST-42'); // metadato en claro para indexar
    assert.ok(!sealed.guests, 'la PII no debe quedar en claro en el sobre');
    const back = unprotectRecord(sealed);
    assert.deepEqual(back, record);
  });
});

test('unprotectRecord lee un registro LEGADO version:1', () => {
  withEnv({ GUEST_APP_DATA_ENCRYPTION_KEY: 'super-secret-key-12345' }, () => {
    const { unprotectRecord } = require('../../netlify/functions/_guest-app');
    const record = { bookingCode: 'EST-9', type: 'checkin', secret: 'cédula' };
    const key = crypto.createHash('sha256').update('super-secret-key-12345').digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(record), 'utf8')), cipher.final()]);
    const tag = cipher.getAuthTag();
    const stored = {
      encrypted: true, version: 1, algorithm: 'aes-256-gcm',
      createdAt: undefined, bookingCode: 'EST-9', type: 'checkin',
      iv: iv.toString('base64url'), tag: tag.toString('base64url'), data: ct.toString('base64url')
    };
    assert.deepEqual(unprotectRecord(stored), record);
  });
});

test('rotación de clave: lo escrito con k1 se sigue leyendo tras activar k2', () => {
  const ring = JSON.stringify({ k1: 'secret-one-aaaa', k2: 'secret-two-bbbb' });
  let envK1;
  withEnv({ GUEST_APP_KEY_RING: ring, GUEST_APP_ACTIVE_KEY_ID: 'k1' }, () => {
    const vault = require('../../netlify/functions/_crypto-vault');
    envK1 = vault.seal(Buffer.from('histórico'), 'aad');
    assert.equal(envK1.kid, 'k1');
  });
  withEnv({ GUEST_APP_KEY_RING: ring, GUEST_APP_ACTIVE_KEY_ID: 'k2' }, () => {
    const vault = require('../../netlify/functions/_crypto-vault');
    const fresh = vault.seal(Buffer.from('nuevo'), 'aad');
    assert.equal(fresh.kid, 'k2', 'lo nuevo se escribe con la clave activa');
    assert.equal(vault.open(envK1, 'aad').toString('utf8'), 'histórico', 'lo viejo se sigue leyendo');
  });
});

test('retirar una clave del anillo deja ilegible lo que cifró (derecho al olvido criptográfico)', () => {
  let envK1;
  withEnv({ GUEST_APP_KEY_RING: JSON.stringify({ k1: 'secret-one-aaaa', k2: 'secret-two-bbbb' }), GUEST_APP_ACTIVE_KEY_ID: 'k1' }, () => {
    envK1 = require('../../netlify/functions/_crypto-vault').seal(Buffer.from('dato'), 'aad');
  });
  withEnv({ GUEST_APP_KEY_RING: JSON.stringify({ k2: 'secret-two-bbbb' }), GUEST_APP_ACTIVE_KEY_ID: 'k2' }, () => {
    const vault = require('../../netlify/functions/_crypto-vault');
    assert.throws(() => vault.open(envK1, 'aad'), /unknown keyId/);
  });
});

test('sin clave configurada: isConfigured=false y protectRecord no cifra en demo', () => {
  withEnv({ GUEST_APP_DEMO_MODE: 'true' }, () => {
    const vault = require('../../netlify/functions/_crypto-vault');
    assert.equal(vault.isConfigured(), false);
    const { protectRecord, unprotectRecord } = require('../../netlify/functions/_guest-app');
    const rec = { bookingCode: 'X', type: 'checkin', a: 1 };
    const out = protectRecord(rec);
    assert.equal(out.encrypted, false);
    assert.deepEqual(unprotectRecord(out), rec);
  });
});

test('sellar/abrir un BUFFER binario de documento (round-trip)', () => {
  withEnv({ GUEST_APP_DATA_ENCRYPTION_KEY: 'super-secret-key-12345' }, () => {
    const { sealBinaryForStore, openBinaryFromStore } = require('../../netlify/functions/_guest-app');
    const original = crypto.randomBytes(2048); // simula una imagen/PDF
    const sealed = sealBinaryForStore(original, 'EST-1|minor-rcn');
    assert.equal(sealed.encrypted, true);
    assert.equal(typeof sealed.value, 'string'); // sobre JSON, no buffer en claro
    assert.ok(!sealed.value.includes(original.toString('latin1').slice(0, 8)));
    const back = openBinaryFromStore(sealed.value, 'EST-1|minor-rcn');
    assert.ok(Buffer.isBuffer(back));
    assert.ok(back.equals(original));
  });
});
