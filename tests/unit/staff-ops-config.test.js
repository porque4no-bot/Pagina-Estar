/* Frente staff — operación:
 *   - respaldos: ops-queue y guest-service-payments entran al backup diario;
 *   - Configuración muestra el valor EFECTIVO (ALERT_ENABLED sin definir = activo);
 *   - TTLOCK_LOCKS_JSON es gestionable (no es secreto) y lo lee _ttlock;
 *   - send-quote-email sin correo configurado ya no responde 200 "ok";
 *   - CI corre con la misma versión de Node que Netlify (22). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/* Blobs en memoria: una cotización guardada + settings vacíos. */
const QUOTE = {
  quoteId: 'COT-2026-ABCDE', empresa: 'Empresa Prueba', contacto: 'Ana', email: 'ana@empresa.test',
  checkin: '2026-11-10', checkout: '2026-11-12', numPersonas: 1,
  items: [{ habitacion: 'Clásica', roomTypeId: 31348, cantidad: 1, noches: 2, precioNoche: 165000, subtotal: 330000 }],
  servicios: {}, descuento: { tipo: 'porcentaje', valor: 0 }, impuestos: { ivaRate: 0.19, incRate: 0.08 },
  expiresAt: '2026-12-31', status: 'activa'
};
const blobsPath = require.resolve('@netlify/blobs');
require.cache[blobsPath] = {
  id: blobsPath, filename: blobsPath, loaded: true,
  exports: {
    getStore: (opts) => ({
      async get(key) { return (opts && opts.name === 'quotes' && key === QUOTE.quoteId) ? JSON.stringify(QUOTE) : null; },
      async set() { return { modified: true }; }
    })
  }
};

const authzPath = require.resolve('../../netlify/functions/_authz');
const authzCalls = [];
require.cache[authzPath] = {
  id: authzPath, filename: authzPath, loaded: true,
  exports: {
    async authorize(event, permission) {
      authzCalls.push(permission);
      return { ok: true, email: 'front@estar.com', permissions: [permission], roles: ['recepcion'] };
    }
  }
};

const ROOT = path.resolve(__dirname, '../..');

test('backup: ops-queue y guest-service-payments van en el grupo de negocio (no PII)', () => {
  const { BACKUP_STORE_GROUPS } = require('../../netlify/functions/_backup');
  const business = BACKUP_STORE_GROUPS.find(g => g.id === 'business');
  const pii = BACKUP_STORE_GROUPS.find(g => g.id === 'pii');
  for (const s of ['ops-queue', 'guest-service-payments']) {
    assert.ok(business.stores.includes(s), `${s} debe respaldarse siempre`);
    assert.equal(pii.stores.includes(s), false);
  }
  /* sin duplicados entre grupos */
  const all = BACKUP_STORE_GROUPS.flatMap(g => g.stores);
  assert.equal(new Set(all).size, all.length);
});

test('Configuración: ALERT_ENABLED sin definir se muestra ACTIVO (valor efectivo, "por defecto")', async () => {
  const settings = require('../../netlify/functions/_settings');
  const prev = process.env.ALERT_ENABLED;
  delete process.env.ALERT_ENABLED;
  try {
    const eff = await settings.getAllEffective({ store: { async get() { return null; } } });
    assert.equal(eff.ALERT_ENABLED.value, 'true');
    assert.equal(eff.ALERT_ENABLED.source, 'por defecto');
    /* el valor por defecto del catálogo = el fallback real de _alert */
    assert.equal(String(await settings.get('ALERT_ENABLED', 'true', { store: false })), 'true');

    process.env.ALERT_ENABLED = 'false';
    const eff2 = await settings.getAllEffective({ store: { async get() { return null; } } });
    assert.equal(eff2.ALERT_ENABLED.value, 'false');
    assert.equal(eff2.ALERT_ENABLED.source, 'netlify');

    const eff3 = await settings.getAllEffective({ store: { async get() { return JSON.stringify({ ALERT_ENABLED: 'true' }); } } });
    assert.equal(eff3.ALERT_ENABLED.source, 'panel');
  } finally {
    if (prev === undefined) delete process.env.ALERT_ENABLED; else process.env.ALERT_ENABLED = prev;
  }
});

test('Configuración: el guardián del bot (default activo) también se reporta activo sin definir', async () => {
  const settings = require('../../netlify/functions/_settings');
  delete process.env.WHATSAPP_GUARD_ENABLED;
  delete process.env.TTLOCK_ENABLED;
  const eff = await settings.getAllEffective({ store: { async get() { return null; } } });
  assert.equal(eff.WHATSAPP_GUARD_ENABLED.value, 'true');
  assert.equal(eff.WHATSAPP_GUARD_ENABLED.source, 'por defecto');
  /* Una clave sin default sigue "sin definir" y vacía. */
  assert.equal(eff.TTLOCK_ENABLED.source, 'sin definir');
  assert.equal(eff.TTLOCK_ENABLED.value, '');
});

test('TTLOCK_LOCKS_JSON es gestionable (texto) y no parece un secreto', () => {
  const { MANAGEABLE, isManageable } = require('../../netlify/functions/_settings');
  assert.ok(isManageable('TTLOCK_LOCKS_JSON'));
  assert.equal(MANAGEABLE.TTLOCK_LOCKS_JSON.type, 'text');
  assert.doesNotMatch('TTLOCK_LOCKS_JSON', /SECRET|TOKEN|PASSWORD|API_KEY|CLIENT_ID/);
  /* Las credenciales de TTLock jamás son gestionables. */
  for (const k of ['TTLOCK_CLIENT_ID', 'TTLOCK_CLIENT_SECRET', 'TTLOCK_USERNAME', 'TTLOCK_PASSWORD', 'TTLOCK_PASSWORD_MD5']) {
    assert.equal(isManageable(k), false, `${k} no debe ser gestionable`);
  }
});

test('send-quote-email sin RESEND_API_KEY → 503 con sent:false y un motivo legible (antes 200)', async () => {
  const prev = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  try {
    const { handler } = require('../../netlify/functions/send-quote-email');
    const res = await handler({
      httpMethod: 'POST', headers: { authorization: 'Bearer t' },
      body: JSON.stringify({ quoteId: QUOTE.quoteId, clientEmail: 'ana@empresa.test', quoteUrl: 'https://estar.com.co/cotizacion.html?id=' + QUOTE.quoteId })
    });
    assert.equal(authzCalls.at(-1), 'quotes.send');
    assert.equal(res.statusCode, 503);
    const body = JSON.parse(res.body);
    assert.equal(body.sent, false);
    assert.match(body.error, /NO se envió/);
  } finally {
    if (prev !== undefined) process.env.RESEND_API_KEY = prev;
  }
});

test('send-quote-email con Resend OK → 200 sent:true (contrato que la UI exige para decir "enviado")', async () => {
  const prevKey = process.env.RESEND_API_KEY;
  const realFetch = globalThis.fetch;
  process.env.RESEND_API_KEY = 're_test_dummy';
  const sentTo = [];
  globalThis.fetch = async (url, init) => {
    sentTo.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ id: 'email_123' }) };
  };
  try {
    const { handler } = require('../../netlify/functions/send-quote-email');
    const res = await handler({
      httpMethod: 'POST', headers: { authorization: 'Bearer t' },
      body: JSON.stringify({ quoteId: QUOTE.quoteId, clientEmail: 'ana@empresa.test', quoteUrl: 'https://estar.com.co/cotizacion.html?id=' + QUOTE.quoteId })
    });
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).sent, true);
    assert.equal(sentTo.length, 1);
    assert.match(sentTo[0].url, /api\.resend\.com/);
  } finally {
    globalThis.fetch = realFetch;
    if (prevKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = prevKey;
  }
});

test('CI usa Node 22, igual que Netlify (netlify.toml NODE_VERSION)', () => {
  const toml = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/tests.yml'), 'utf8');
  const netlifyNode = (toml.match(/NODE_VERSION\s*=\s*"(\d+)"/) || [])[1];
  const ciNode = (wf.match(/node-version:\s*(\d+)/) || [])[1];
  assert.equal(netlifyNode, '22');
  assert.equal(ciNode, netlifyNode);
});
