/* Subidor SIRE del VPS (tools/sire-uploader/): estructura de las unidades
 * systemd y del envoltorio, y las pruebas de formato en Python cuando hay
 * Python 3 disponible (en CI, ubuntu-latest lo trae). El flujo completo contra
 * un portal simulado necesita Chromium y se corre aparte (ver README). */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const DIR = path.resolve(__dirname, '../../tools/sire-uploader');
const read = rel => fs.readFileSync(path.join(DIR, rel), 'utf8');

test('vault-sire.timer: diario a las 10:00 hora Colombia, persistente', () => {
  const timer = read('vps/vault-sire.timer');
  assert.match(timer, /^OnCalendar=\*-\*-\* 10:00:00 America\/Bogota$/m);
  assert.match(timer, /^Persistent=true$/m);
  assert.match(timer, /^WantedBy=timers\.target$/m);
});

test('vault-sire.service: usuario vault, umask 077, lanza el envoltorio en modo --subir', () => {
  const svc = read('vps/vault-sire.service');
  assert.match(svc, /^User=vault$/m);
  assert.match(svc, /^Group=vault$/m);
  assert.match(svc, /^UMask=0077$/m);
  assert.match(svc, /^Type=oneshot$/m);
  assert.match(svc, /^Environment=TZ=America\/Bogota$/m);
  assert.match(svc, /^ExecStart=\/bin\/bash "\/opt\/vault\/99 - Herramientas\/vps\/sire_vps\.sh" --subir$/m);
  assert.match(svc, /^NoNewPrivileges=true$/m);
});

test('sire_vps.sh: umask 077, registro con marca de fin y solo VAULT_SMTP del entorno de la ingesta', () => {
  const sh = read('vps/sire_vps.sh');
  assert.match(sh, /^#!\/usr\/bin\/env bash/);
  assert.match(sh, /^umask 077$/m);
  assert.match(sh, /90 - Datos\/sire\.log/);
  assert.match(sh, /---- fin, codigo \$RC ----/);
  assert.match(sh, /\.venv-ingesta\/bin\/python/);
  /* El entorno de la ingesta se lee en una subcapa: no se heredan sus credenciales. */
  assert.match(sh, /VAULT_SMTP=\$\( set -a; \. "\$ENVF"/);
  assert.doesNotMatch(sh, /^set -a; \. "\$V/m);
});

test('los ficheros que van al VPS usan finales de línea Unix (.gitattributes)', () => {
  const attrs = read('.gitattributes');
  for (const ext of ['sh', 'py', 'service', 'timer']) {
    assert.match(attrs, new RegExp(`^\\*\\.${ext}\\s+text eol=lf$`, 'm'));
  }
});

test('ejemplos de secretos sin valores reales y requirements con versión fija', () => {
  const sire = JSON.parse(read('ejemplos/sire.json.ejemplo'));
  assert.deepEqual(Object.keys(sire).sort(), ['numero_documento', 'password', 'tipo_documento']);
  assert.match(sire.password, /^<.*>$/);
  const exp = JSON.parse(read('ejemplos/sire_export.json.ejemplo'));
  assert.match(exp.url, /^https:\/\/estar\.com\.co\/api\/sire-export$/);
  assert.match(exp.token, /^<.*>$/);
  assert.match(read('requirements.txt'), /^playwright==\d+\.\d+\.\d+$/m);
});

test('portal.json: apunta al portal SIRE oficial y sigue la ruta de carga', () => {
  const conf = JSON.parse(read('portal.json'));
  assert.equal(conf.url_login, 'https://apps.migracioncolombia.gov.co/sire/public/login.jsf');
  assert.deepEqual(conf.navegacion.pasos.map(p => p.texto), ['Cargar información', 'Alojamiento y hospedaje', 'Cargar archivo']);
  assert.ok(conf.login.numero_documento.some(s => s.includes('formLogin:numeroDocumento')));
  assert.ok(conf.login.password.some(s => s.includes('formLogin:password')));
});

function findPython() {
  for (const cmd of ['python3', 'python']) {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    if (r.status === 0 && /Python 3\.(\d+)/.test(`${r.stdout}${r.stderr}`)) return cmd;
  }
  return null;
}

const PY = findPython();

test('subidor SIRE (Python): pruebas de formato, resultado del portal, tachado y secretos', { skip: PY ? false : 'sin Python 3' }, () => {
  const r = spawnSync(PY, ['-m', 'unittest', 'discover', '-s', path.join(DIR, 'tests'), '-p', 'test_sire_comun.py'], {
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' },
    timeout: 120000
  });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /OK/);
});
