/* Configuración gestionable desde /admin. Verifica la lógica override→env y el
 * LÍMITE DE SEGURIDAD: el store solo afecta claves de la lista blanca; los
 * secretos jamás se leen ni se escriben por aquí. Store inyectado (sin Blobs). */

const test = require('node:test');
const assert = require('node:assert/strict');

const settings = require('../../netlify/functions/_settings');

function storeWith(obj) {
  let saved = JSON.stringify(obj || {});
  return {
    get: async () => saved,
    set: async (_k, v) => { saved = v; },
    _read: () => JSON.parse(saved)
  };
}

test('get devuelve el override del panel cuando existe (clave gestionable)', async () => {
  const store = storeWith({ DISCOUNT_CODES_ENABLED: 'true' });
  assert.equal(await settings.get('DISCOUNT_CODES_ENABLED', '', { store }), 'true');
  assert.equal(await settings.flag('DISCOUNT_CODES_ENABLED', { store }), true);
});

test('get cae a la variable de entorno si no hay override', async () => {
  const store = storeWith({});
  process.env.STAY_EMAILS_PRE_DAYS = '3';
  assert.equal(await settings.get('STAY_EMAILS_PRE_DAYS', '1', { store }), '3');
  delete process.env.STAY_EMAILS_PRE_DAYS;
  assert.equal(await settings.get('STAY_EMAILS_PRE_DAYS', '1', { store }), '1');
});

test('SEGURIDAD: una clave NO gestionable (secreto) IGNORA el store, solo env', async () => {
  // Aunque el store tuviera un valor para un secreto, get NO lo usa.
  const store = storeWith({ OTASYNC_TOKEN: 'valor-malicioso-del-store' });
  process.env.OTASYNC_TOKEN = 'el-de-netlify';
  assert.equal(await settings.get('OTASYNC_TOKEN', '', { store }), 'el-de-netlify');
  delete process.env.OTASYNC_TOKEN;
  assert.equal(settings.isManageable('OTASYNC_TOKEN'), false);
  assert.equal(settings.isManageable('WOMPI_PRIVATE_KEY'), false);
  assert.equal(settings.isManageable('GUEST_APP_DATA_ENCRYPTION_KEY'), false);
});

test('setSetting RECHAZA claves no gestionables (no se puede colar un secreto)', async () => {
  const store = storeWith({});
  await assert.rejects(() => settings.setSetting('RESEND_API_KEY', 'x', { store }), /no gestionable/i);
  await assert.rejects(() => settings.setSetting('ADMIN_EMAILS', 'x@x.com', { store }), /no gestionable/i);
});

test('setSetting escribe una clave gestionable y la limpia con vacío', async () => {
  const store = storeWith({});
  await settings.setSetting('BREAKFAST_UPGRADE_ENABLED', 'true', { store });
  assert.equal(store._read().BREAKFAST_UPGRADE_ENABLED, 'true');
  await settings.setSetting('BREAKFAST_UPGRADE_ENABLED', '', { store });
  assert.equal(store._read().BREAKFAST_UPGRADE_ENABLED, undefined);
});

test('getAllEffective reporta el origen (panel vs netlify) y solo claves gestionables', async () => {
  const store = storeWith({ TTLOCK_ENABLED: 'true' });
  process.env.WHATSAPP_BOT_ENABLED = 'true';
  const eff = await settings.getAllEffective({ store });
  assert.equal(eff.TTLOCK_ENABLED.source, 'panel');
  assert.equal(eff.TTLOCK_ENABLED.value, 'true');
  assert.equal(eff.WHATSAPP_BOT_ENABLED.source, 'netlify');
  assert.equal(eff.OTASYNC_TOKEN, undefined); // los secretos NO aparecen
  delete process.env.WHATSAPP_BOT_ENABLED;
});

test('getSync: override del panel (cache caliente) gana para clave gestionable', async () => {
  await settings.loadOverrides({ store: storeWith({ ADMIN_NOTIFY_EMAIL: 'panel@estar.co' }) });
  assert.equal(settings.getSync('ADMIN_NOTIFY_EMAIL', 'def@estar.co'), 'panel@estar.co');
});

test('getSync: clave gestionable sin override cae a env y luego a default', async () => {
  await settings.loadOverrides({ store: storeWith({}) }); // cache caliente pero vacío
  const prev = process.env.ADMIN_NOTIFY_EMAIL;
  process.env.ADMIN_NOTIFY_EMAIL = 'env@estar.co';
  try {
    assert.equal(settings.getSync('ADMIN_NOTIFY_EMAIL', 'def@estar.co'), 'env@estar.co');
    delete process.env.ADMIN_NOTIFY_EMAIL;
    assert.equal(settings.getSync('ADMIN_NOTIFY_EMAIL', 'def@estar.co'), 'def@estar.co');
  } finally {
    if (prev === undefined) delete process.env.ADMIN_NOTIFY_EMAIL; else process.env.ADMIN_NOTIFY_EMAIL = prev;
  }
});

test('getSync SEGURIDAD: una clave NO gestionable (secreto) IGNORA el cache, solo env', async () => {
  await settings.loadOverrides({ store: storeWith({ OTASYNC_TOKEN: 'leak-del-store' }) });
  const prev = process.env.OTASYNC_TOKEN;
  delete process.env.OTASYNC_TOKEN;
  try {
    assert.equal(settings.getSync('OTASYNC_TOKEN', ''), ''); // jamás el valor del store
  } finally {
    if (prev === undefined) delete process.env.OTASYNC_TOKEN; else process.env.OTASYNC_TOKEN = prev;
  }
});
