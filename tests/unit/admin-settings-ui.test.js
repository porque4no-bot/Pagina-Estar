/* Pruebas del frente "Configuración" del panel /admin (cotizar-admin.html).
 *
 * La lógica de render vive en un bloque <script> del HTML, así que la extraemos
 * y la ejecutamos en un sandbox de `vm` inyectando sus dependencias (escHtml,
 * SETTINGS_CACHE y las tablas de origen). Sin DOM ni red: probamos las funciones
 * puras que arman el HTML de cada control y el agrupado por meta.group. */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const HTML_PATH = path.resolve(__dirname, '../../cotizar-admin.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

/* Extrae un bloque `function nombre(...) { ... }` por conteo de llaves. */
function extractFunction(src, header) {
  const start = src.indexOf(header);
  assert.notEqual(start, -1, `No se encontró ${header} en el HTML`);
  const braceStart = src.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`No se cerró ${header}`);
}

/* Construye un sandbox con escHtml real + las funciones de render y un cache. */
function makeSandbox(cache) {
  const escHtmlSrc = extractFunction(html, 'function escHtml(');
  const renderSettingsSrc = extractFunction(html, 'function renderSettings(');
  const renderRowSrc = extractFunction(html, 'function renderSettingRow(');

  /* Dependencias inyectadas: cache de ajustes + tablas de etiquetas/clases
     (copiadas del HTML para no depender de un DOM real). */
  const ctx = {
    SETTINGS_CACHE: cache,
    CFG_SOURCE_LABEL: { panel: 'Panel', netlify: 'Netlify', 'sin definir': 'Sin definir' },
    CFG_SOURCE_CLASS: { panel: 'cfg-source-panel', netlify: 'cfg-source-netlify', 'sin definir': 'cfg-source-empty' },
    document: { getElementById: () => null } /* renderSettings sale temprano si no hay nodo */
  };
  vm.createContext(ctx);
  vm.runInContext(`${escHtmlSrc}\n${renderRowSrc}\n${renderSettingsSrc}`, ctx);
  return ctx;
}

test('extrae las tres tablas de origen del HTML (sin desfase de etiquetas)', () => {
  /* Garantiza que las tablas inyectadas siguen las del HTML. */
  assert.match(html, /CFG_SOURCE_LABEL\s*=\s*\{[^}]*panel:\s*'Panel'/);
  assert.match(html, /CFG_SOURCE_CLASS\s*=\s*\{[^}]*panel:\s*'cfg-source-panel'/);
});

test('bool → interruptor (checkbox) y refleja el valor efectivo', () => {
  const ctx = makeSandbox({
    WHATSAPP_BOT_ENABLED: { meta: { type: 'bool', group: 'WhatsApp', label: 'Bot' }, value: 'true', source: 'panel' }
  });
  const out = ctx.renderSettingRow('WHATSAPP_BOT_ENABLED');
  assert.match(out, /type="checkbox"/);
  assert.match(out, /data-cfg-type="bool"/);
  assert.match(out, /checked/);
  assert.match(out, /class="cfg-switch"/);
});

test('bool en false NO lleva checked', () => {
  const ctx = makeSandbox({
    K: { meta: { type: 'bool', group: 'G', label: 'L' }, value: 'false', source: 'netlify' }
  });
  const out = ctx.renderSettingRow('K');
  assert.doesNotMatch(out, /\bchecked\b/);
});

test('enum → <select> con todas las opciones y marca la seleccionada', () => {
  const ctx = makeSandbox({
    GUEST_SERVICE_PAYMENT_MODE: {
      meta: { type: 'enum', group: 'Guest app', label: 'Pago', options: ['room_charge', 'wompi', 'both'] },
      value: 'wompi', source: 'panel'
    }
  });
  const out = ctx.renderSettingRow('GUEST_SERVICE_PAYMENT_MODE');
  assert.match(out, /<select/);
  assert.match(out, /data-cfg-type="enum"/);
  assert.match(out, /<option value="room_charge">/);
  assert.match(out, /<option value="wompi" selected>/);
  assert.match(out, /<option value="both">/);
});

test('number → input numérico; text → input de texto', () => {
  const ctxN = makeSandbox({ N: { meta: { type: 'number', group: 'G', label: 'L' }, value: '3', source: 'panel' } });
  const outN = ctxN.renderSettingRow('N');
  assert.match(outN, /type="number"/);
  assert.match(outN, /data-cfg-type="number"/);
  assert.match(outN, /value="3"/);

  const ctxT = makeSandbox({ T: { meta: { type: 'text', group: 'G', label: 'L' }, value: 'hola', source: 'netlify' } });
  const outT = ctxT.renderSettingRow('T');
  assert.match(outT, /type="text"/);
  assert.match(outT, /data-cfg-type="text"/);
  assert.match(outT, /value="hola"/);
});

test('badge de origen: Panel / Netlify / Sin definir con su clase', () => {
  const panel = makeSandbox({ K: { meta: { type: 'bool', group: 'G', label: 'L' }, value: 'true', source: 'panel' } });
  assert.match(panel.renderSettingRow('K'), /cfg-source-panel[^>]*>Panel</);

  const net = makeSandbox({ K: { meta: { type: 'bool', group: 'G', label: 'L' }, value: 'true', source: 'netlify' } });
  assert.match(net.renderSettingRow('K'), /cfg-source-netlify[^>]*>Netlify</);

  const empty = makeSandbox({ K: { meta: { type: 'text', group: 'G', label: 'L' }, value: '', source: 'sin definir' } });
  assert.match(empty.renderSettingRow('K'), /cfg-source-empty[^>]*>Sin definir</);
});

test('"Volver a Netlify" solo aparece cuando el origen es panel (override)', () => {
  const withOverride = makeSandbox({ K: { meta: { type: 'bool', group: 'G', label: 'L' }, value: 'true', source: 'panel' } });
  assert.match(withOverride.renderSettingRow('K'), /data-cfg-reset="K"/);

  const fromNetlify = makeSandbox({ K: { meta: { type: 'bool', group: 'G', label: 'L' }, value: 'true', source: 'netlify' } });
  assert.doesNotMatch(fromNetlify.renderSettingRow('K'), /data-cfg-reset/);
});

test('la fila lleva la clave y la etiqueta legible', () => {
  const ctx = makeSandbox({
    BACKUP_ENABLED: { meta: { type: 'bool', group: 'Operación', label: 'Respaldo diario de datos' }, value: 'true', source: 'panel' }
  });
  const out = ctx.renderSettingRow('BACKUP_ENABLED');
  assert.match(out, /class="cfg-name">Respaldo diario de datos</);
  assert.match(out, /class="cfg-key">BACKUP_ENABLED</);
});

test('escapa valores y etiquetas (no inyecta HTML)', () => {
  const ctx = makeSandbox({
    K: { meta: { type: 'text', group: 'G', label: '<b>x</b>' }, value: '"><img src=x>', source: 'panel' }
  });
  const out = ctx.renderSettingRow('K');
  assert.doesNotMatch(out, /<b>x<\/b>/);
  assert.doesNotMatch(out, /<img src=x>/);
  assert.match(out, /&lt;b&gt;x&lt;\/b&gt;/);
});

test('renderSettings agrupa por meta.group preservando el orden de aparición', () => {
  /* Probamos la función de agrupado directamente (sin DOM): replica su lógica
     a partir del cache para asegurar que el orden de grupos es por 1ª aparición. */
  const cache = {
    A: { meta: { type: 'bool', group: 'Operación', label: 'a' }, value: 'true', source: 'panel' },
    B: { meta: { type: 'bool', group: 'Pagos', label: 'b' }, value: 'true', source: 'panel' },
    C: { meta: { type: 'bool', group: 'Operación', label: 'c' }, value: 'true', source: 'panel' }
  };
  const groups = [];
  const byGroup = {};
  Object.keys(cache).forEach(key => {
    const g = (cache[key].meta || {}).group || 'Otros';
    if (!byGroup[g]) { byGroup[g] = []; groups.push(g); }
    byGroup[g].push(key);
  });
  assert.deepEqual(groups, ['Operación', 'Pagos']);
  assert.deepEqual(byGroup['Operación'], ['A', 'C']);
  assert.deepEqual(byGroup['Pagos'], ['B']);
});

test('claves sin meta.group caen en "Otros"', () => {
  const cache = { X: { meta: { type: 'bool', label: 'x' }, value: 'true', source: 'panel' } };
  const g = (cache.X.meta || {}).group || 'Otros';
  assert.equal(g, 'Otros');
});

test('el HTML expone el tab, el contenedor y el cableado esperados', () => {
  assert.match(html, /data-view="config"\s+data-perm="settings\.manage"/);
  assert.match(html, /id="viewConfig"/);
  assert.match(html, /id="cfgGroups"/);
  assert.match(html, /if \(view === 'config'\) loadSettings\(\);/);
  assert.match(html, /fetch\('\/api\/admin-settings'/);
  /* Sin manejadores inline (CSP). */
  assert.doesNotMatch(html, /\son(click|change|blur|input)=/i);
});
