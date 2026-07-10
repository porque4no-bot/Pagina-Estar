// _env.js: la suite unitaria debe ser inmune al .env local del dev.
// node --test define NODE_TEST_CONTEXT en cada proceso de test; con esa marca
// presente, loadEnv es un no-op aunque exista un .env con credenciales reales.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadEnv } = require('../../netlify/functions/_env');

function writeTempEnv(lines) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'estar-env-')), '.env');
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  return file;
}

test('en contexto de test (NODE_TEST_CONTEXT) loadEnv no carga el .env', () => {
  assert.ok(process.env.NODE_TEST_CONTEXT, 'node --test debe definir NODE_TEST_CONTEXT');
  const file = writeTempEnv(['ESTAR_TEST_SENTINEL=leaked']);
  delete process.env.ESTAR_TEST_SENTINEL;
  loadEnv(file);
  assert.equal(process.env.ESTAR_TEST_SENTINEL, undefined);
});

test('fuera de contexto de test loadEnv sí carga el .env (sin pisar vars ya definidas)', () => {
  const saved = process.env.NODE_TEST_CONTEXT;
  delete process.env.NODE_TEST_CONTEXT;
  try {
    const file = writeTempEnv([
      'ESTAR_TEST_SENTINEL="con comillas"',
      'ESTAR_TEST_PRESET=nuevo-valor',
      '# comentario',
    ]);
    delete process.env.ESTAR_TEST_SENTINEL;
    process.env.ESTAR_TEST_PRESET = 'ya-definida';
    loadEnv(file);
    assert.equal(process.env.ESTAR_TEST_SENTINEL, 'con comillas');
    assert.equal(process.env.ESTAR_TEST_PRESET, 'ya-definida');
  } finally {
    process.env.NODE_TEST_CONTEXT = saved;
    delete process.env.ESTAR_TEST_SENTINEL;
    delete process.env.ESTAR_TEST_PRESET;
  }
});
