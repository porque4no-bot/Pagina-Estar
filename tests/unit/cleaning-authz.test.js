/* Control de aseo — migración a `_authz.authorize(event, 'cleaning.audit')` y
 * seguimiento operativo de las fotos con observaciones.
 *
 * Antes: cleaning-checklist / validate-cleaning-photo usaban _staff-auth
 * (solo STAFF_EMAILS ∪ ADMIN_EMAILS) e ignoraban los usuarios del panel, así que
 * el personal de aseo creado en /admin no podía entrar. Ahora piden el permiso
 * cleaning.audit (rol 'aseo').
 *
 * Además: 'advertida' abre una tarea en la cola operativa (vía reportAlert, con
 * dedupe por apartamento+ítem+día) y 'aprobada' cierra la que hubiera quedado.
 * Sin red ni Blobs: _authz se stubbea por require.cache y el resto por deps. */

const test = require('node:test');
const assert = require('node:assert/strict');

const authzPath = require.resolve('../../netlify/functions/_authz');
let authzState;
function allow(email = 'aseo@estar.com') { authzState = { allow: true, email, calls: [] }; }
function deny(statusCode = 403) { authzState = { allow: false, statusCode, calls: [] }; }
allow();
require.cache[authzPath] = {
  id: authzPath, filename: authzPath, loaded: true,
  exports: {
    async authorize(event, permission) {
      authzState.calls.push(permission);
      if (!authzState.allow) return { ok: false, statusCode: authzState.statusCode, error: 'No tienes permiso para esta acción' };
      return { ok: true, email: authzState.email, permissions: [permission], roles: ['aseo'] };
    }
  }
};

const checklist = require('../../netlify/functions/cleaning-checklist').handler;
const photoMod = require('../../netlify/functions/validate-cleaning-photo');
const { deps, cleaningTaskKey } = photoMod._test;
const { todayBogota } = require('../../netlify/functions/_cleaning-store');

const IMG = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg-bytes').toString('base64');

/* Deps falsas: registran llamadas; nada sale a la red ni a Blobs. */
let calls;
function fakeDeps(verdict) {
  calls = { alerts: [], resolved: [], saved: [] };
  deps.auditPhoto = async () => verdict;
  deps.uploadToDrive = async () => ({ id: 'drv1', link: 'https://drive.example/drv1' });
  deps.savePhoto = async () => {};
  deps.saveAudit = async (rec) => { calls.saved.push(rec); return rec; };
  deps.reportAlert = async (args) => { calls.alerts.push(args); return { alerted: true }; };
  deps.resolveTask = async (id, by) => { calls.resolved.push({ id, by }); return { ok: true }; };
}

function post(body) {
  return photoMod.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify(body) });
}

const VERDICT_WARN = { es_el_objeto: true, calidad_foto: 'buena', aseo_correcto: false, problemas: ['Polvo en la mesa de noche'], sugerencia: 'Limpia la mesa', confianza: 0.9 };
const VERDICT_OK = { es_el_objeto: true, calidad_foto: 'buena', aseo_correcto: true, problemas: [], sugerencia: '', confianza: 0.95 };
const VERDICT_BAD = { es_el_objeto: true, calidad_foto: 'mala', aseo_correcto: false, problemas: ['Foto borrosa'], confianza: 0.9 };

test.beforeEach(() => allow());

test('cleaning-checklist pide cleaning.audit y devuelve la lista', async () => {
  const res = await checklist({ httpMethod: 'GET', headers: { authorization: 'Bearer t' } });
  assert.deepEqual(authzState.calls, ['cleaning.audit']);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.ok(Array.isArray(body.items) && body.items.length >= 5);
});

test('cleaning-checklist sin permiso → 403 (ya no depende de STAFF_EMAILS)', async () => {
  deny(403);
  const res = await checklist({ httpMethod: 'GET', headers: { authorization: 'Bearer t' } });
  assert.equal(res.statusCode, 403);
});

test('validate-cleaning-photo sin permiso → 403 y no audita', async () => {
  fakeDeps(VERDICT_OK);
  let audited = false;
  deps.auditPhoto = async () => { audited = true; return VERDICT_OK; };
  deny(401);
  const res = await post({ apartment: '101', item: 'cama', image: IMG });
  assert.equal(res.statusCode, 401);
  assert.equal(audited, false);
});

test('advertida → se guarda y abre UNA tarea en la cola (reportAlert) con dedupe por apto+ítem+día', async () => {
  fakeDeps(VERDICT_WARN);
  const res = await post({ apartment: '101', item: 'cama', image: IMG });
  assert.deepEqual(authzState.calls, ['cleaning.audit']);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.decision, 'advertida');
  assert.equal(body.stored, true);
  assert.equal(body.followUp, true);
  assert.equal(calls.saved.length, 1);
  assert.equal(calls.saved[0].staffEmail, 'aseo@estar.com');

  assert.equal(calls.alerts.length, 1);
  const a = calls.alerts[0];
  assert.equal(a.kind, 'cleaning_warning');
  assert.equal(a.severity, 'warn');
  assert.equal(a.dedupeKey, cleaningTaskKey('101', 'cama', todayBogota()));
  assert.match(a.message, /101/);
  assert.match(a.context.problemas, /Polvo/);
  assert.equal(a.context.foto, 'https://drive.example/drv1');
  assert.equal(calls.resolved.length, 0);
});

test('aprobada → se guarda y cierra la tarea pendiente del mismo apto+ítem+día (sin alertar)', async () => {
  fakeDeps(VERDICT_OK);
  const res = await post({ apartment: '101', item: 'cama', image: IMG });
  const body = JSON.parse(res.body);
  assert.equal(body.decision, 'aprobada');
  assert.equal(body.followUp, false);
  assert.equal(calls.alerts.length, 0);
  assert.deepEqual(calls.resolved, [{ id: cleaningTaskKey('101', 'cama', todayBogota()), by: 'aseo@estar.com' }]);
});

test('rechazada → no se guarda, ni tarea ni cierre', async () => {
  fakeDeps(VERDICT_BAD);
  const res = await post({ apartment: '101', item: 'cama', image: IMG });
  const body = JSON.parse(res.body);
  assert.equal(body.decision, 'rechazada');
  assert.equal(body.stored, false);
  assert.equal(calls.saved.length, 0);
  assert.equal(calls.alerts.length, 0);
  assert.equal(calls.resolved.length, 0);
});

test('si la cola/alerta falla, la foto igual queda registrada (best-effort)', async () => {
  fakeDeps(VERDICT_WARN);
  deps.reportAlert = async () => { throw new Error('blobs caído'); };
  const res = await post({ apartment: 'Clásica 2', item: 'bano', image: IMG });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.stored, true);
  assert.equal(body.followUp, false);
});

test('la clave de la tarea usa el slug del apartamento (estable entre fotos)', () => {
  assert.equal(cleaningTaskKey('clasica-2', 'bano', '2026-10-08'), 'cleaning:clasica-2:bano:2026-10-08');
});
