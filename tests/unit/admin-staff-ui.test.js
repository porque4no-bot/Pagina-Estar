/* Panel /admin (cotizar-admin.html) — frente staff. La lógica vive en el
 * <script> del HTML: se extraen funciones puras y se corren en un sandbox `vm`
 * (sin DOM ni red), igual que admin-settings-ui.test.js.
 *
 *   - quoteRowActions: cada botón de la lista de cotizaciones aparece SOLO si
 *     el usuario tiene el permiso que exige su endpoint (+ "Reenviar").
 *   - renderSettingRow: un bool "por defecto" activo se pinta ENCENDIDO
 *     (ALERT_ENABLED sin definir = activo).
 *   - renderTtlockProbe: pinta chapas/mapa/sugerido, escapa todo y no inventa
 *     datos cuando faltan credenciales. */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.resolve(__dirname, '../../cotizar-admin.html'), 'utf8');

function extractFunction(src, header) {
  const start = src.indexOf(header);
  assert.notEqual(start, -1, `No se encontró ${header} en el HTML`);
  const braceStart = src.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`No se cerró ${header}`);
}
function extractConst(src, name) {
  const re = new RegExp('const ' + name + ' = \\{[\\s\\S]*?\\};');
  const m = src.match(re);
  assert.ok(m, `No se encontró const ${name}`);
  return m[0];
}

function sandbox(extra) {
  const ctx = Object.assign({ window: { MY: { perms: [], isEnvAdmin: false } } }, extra || {});
  vm.createContext(ctx);
  vm.runInContext([
    extractFunction(html, 'function escHtml('),
    extractFunction(html, 'function hasPerm('),
    extractConst(html, 'QUOTE_ACTION_LABEL'),
    extractFunction(html, 'function quoteRowActions('),
    extractConst(html, 'CFG_SOURCE_LABEL'),
    extractConst(html, 'CFG_SOURCE_CLASS'),
    extractFunction(html, 'function renderSettingRow('),
    extractFunction(html, 'function renderTtlockProbe('),
    'this.quoteRowActions = quoteRowActions; this.renderSettingRow = renderSettingRow; this.renderTtlockProbe = renderTtlockProbe; this.QUOTE_ACTION_LABEL = QUOTE_ACTION_LABEL;'
  ].join('\n'), ctx);
  return ctx;
}

const ACTIVE = { quoteId: 'COT-2026-AAAAA', statusEfectivo: 'activa', status: 'activa' };

test('recepción (quotes.view + quotes.send): Ver, Enlace y Reenviar — nada de editar/cancelar/historial', () => {
  const ctx = sandbox();
  ctx.window.MY = { perms: ['quotes.view', 'quotes.send'], isEnvAdmin: false };
  assert.deepEqual([...ctx.quoteRowActions(ACTIVE)], ['view', 'copy', 'resend']);
});

test('tesorería (quotes.view + quotes.audit.read): ve el historial pero no reenvía ni edita', () => {
  const ctx = sandbox();
  ctx.window.MY = { perms: ['quotes.view', 'quotes.audit.read'], isEnvAdmin: false };
  assert.deepEqual([...ctx.quoteRowActions(ACTIVE)], ['view', 'copy', 'history']);
});

test('admin: todas las acciones que aplican al estado', () => {
  const ctx = sandbox();
  ctx.window.MY = { perms: [], isEnvAdmin: true };
  assert.deepEqual([...ctx.quoteRowActions(ACTIVE)], ['view', 'copy', 'resend', 'history', 'edit', 'cancel']);
  assert.deepEqual([...ctx.quoteRowActions({ quoteId: 'X', statusEfectivo: 'aceptada', status: 'aceptada', reservationPending: true })],
    ['view', 'copy', 'history', 'retry']);
  assert.deepEqual([...ctx.quoteRowActions({ quoteId: 'X', statusEfectivo: 'cancelada', status: 'cancelada' })],
    ['view', 'copy', 'history', 'edit', 'reactivate']);
});

test('Reenviar solo para cotizaciones vigentes (activa / vista)', () => {
  const ctx = sandbox();
  ctx.window.MY = { perms: ['quotes.view', 'quotes.send'], isEnvAdmin: false };
  assert.ok(ctx.quoteRowActions({ statusEfectivo: 'vista', status: 'activa' }).includes('resend'));
  for (const st of ['vencida', 'cancelada', 'aceptada']) {
    assert.equal(ctx.quoteRowActions({ statusEfectivo: st, status: st }).includes('resend'), false, st);
  }
});

test('sin permisos de cotizaciones: ninguna acción', () => {
  const ctx = sandbox();
  ctx.window.MY = { perms: ['cleaning.audit'], isEnvAdmin: false };
  assert.deepEqual([...ctx.quoteRowActions(ACTIVE)], []);
});

test('cada acción tiene etiqueta visible', () => {
  const ctx = sandbox();
  for (const a of ['view', 'copy', 'resend', 'history', 'edit', 'retry', 'reactivate', 'cancel']) {
    assert.ok(ctx.QUOTE_ACTION_LABEL[a], a);
  }
});

test('Configuración: bool "por defecto" activo se pinta ENCENDIDO con su etiqueta', () => {
  const ctx = sandbox({
    SETTINGS_CACHE: {
      ALERT_ENABLED: { meta: { type: 'bool', group: 'Operación', label: 'Alertas operativas', default: 'true' }, value: 'true', source: 'por defecto' }
    }
  });
  const out = ctx.renderSettingRow('ALERT_ENABLED');
  assert.match(out, /\bchecked\b/);
  assert.match(out, /Por defecto/);
  assert.match(out, /cfg-source-default/);
  assert.doesNotMatch(out, /Volver a Netlify/);
});

test('TTLock: sin credenciales muestra ✗ y la nota, sin tablas inventadas', () => {
  const ctx = sandbox();
  const out = ctx.renderTtlockProbe({
    ok: false, config: { enabled: false, clientId: false, clientSecret: false, username: false, password: false },
    mapping: { defined: false, valid: true, entries: [] }, locks: [], note: 'Faltan credenciales de TTLock'
  });
  assert.match(out, /✗ Client ID/);
  assert.match(out, /Emisión de códigos: apagada/);
  assert.match(out, /Faltan credenciales/);
  assert.match(out, /Aún no está definido/);
  assert.doesNotMatch(out, /Chapas en la cuenta/);
  assert.doesNotMatch(out, /Mapa sugerido/);
});

test('TTLock: con chapas pinta batería, gateway, asignación, mapa y sugerido (escapado)', () => {
  const ctx = sandbox();
  const out = ctx.renderTtlockProbe({
    ok: true, config: { enabled: false, clientId: true, clientSecret: true, username: true, password: true },
    locks: [
      { lockId: 1001, alias: 'Apto 101', battery: 87, hasGateway: true },
      { lockId: 1002, alias: '<img src=x onerror=alert(1)>', battery: null, hasGateway: false }
    ],
    mapping: { defined: true, valid: true, entries: [{ key: '101', lockId: 1001 }, { key: '999', lockId: 5 }] },
    check: {
      entries: [{ key: '101', lockId: 1001, foundInAccount: true }, { key: '999', lockId: 5, foundInAccount: false }],
      unmapped: [1002], suggested: { 101: 1001 }, pendingWithoutKey: [1002]
    }
  });
  assert.match(out, /Conexión correcta · 2 chapa/);
  assert.match(out, /87%/);
  assert.match(out, /sin wifi/);
  assert.match(out, /✗ no existe/);
  assert.match(out, /complétalas a mano/);
  assert.match(out, /data-tt-act="save"/);
  assert.ok(out.includes('{&quot;101&quot;:1001}'), 'el JSON sugerido va escapado dentro del textarea');
  assert.equal(out.includes('<img src=x'), false, 'el alias se escapa');
});

test('TTLock: mapa con JSON inválido se señala en rojo', () => {
  const ctx = sandbox();
  const out = ctx.renderTtlockProbe({ ok: false, config: {}, mapping: { defined: true, valid: false, error: 'JSON inválido: x' }, locks: [] });
  assert.match(out, /is-error[^>]*>✗ JSON inválido/);
});

test('la vista Nueva cotización ya no arranca visible (la muestra applyGating según permisos)', () => {
  assert.match(html, /<div id="viewNueva" style="display:none">/);
  assert.match(html, /id="viewNoPerms"/);
  assert.match(html, /function showNoPerms\(/);
});
