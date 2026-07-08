/* credit-decision.test.js — la DECISIÓN de crédito la toma un humano, no la IA.
   Cubre: gate CREDIT_ENABLED (inerte OFF), mapeo de decisiones válidas, y que la
   vista de cola NO filtra PII ni el sobre cifrado. */

const test = require('node:test');
const assert = require('node:assert/strict');

// Con el flag OFF el handler debe ser inerte sin tocar Blobs ni authz.
test('credit-decision: gate OFF ⇒ respuesta inerte', async () => {
  const prev = process.env.CREDIT_ENABLED;
  process.env.CREDIT_ENABLED = '';   // OFF
  delete require.cache[require.resolve('../../netlify/functions/_settings')];
  delete require.cache[require.resolve('../../netlify/functions/credit-decision')];
  const mod = require('../../netlify/functions/credit-decision');
  const res = await mod.handler({ httpMethod: 'GET', headers: {}, queryStringParameters: {} });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: false, enabled: false });
  if (prev === undefined) delete process.env.CREDIT_ENABLED; else process.env.CREDIT_ENABLED = prev;
});

test('credit-decision: método no permitido ⇒ 405', async () => {
  const mod = require('../../netlify/functions/credit-decision');
  const res = await mod.handler({ httpMethod: 'PUT', headers: {} });
  assert.equal(res.statusCode, 405);
});

test('credit-decision: solo mapea las tres decisiones humanas válidas', () => {
  const { _test } = require('../../netlify/functions/credit-decision');
  assert.deepEqual(Object.keys(_test.DECISIONS).sort(), ['aprobar', 'rechazar', 'requiere_codeudor']);
  assert.equal(_test.DECISIONS.aprobar, 'aprobada');
  assert.equal(_test.DECISIONS.rechazar, 'rechazada');
  assert.equal(_test.DECISIONS.requiere_codeudor, 'requiere_codeudor');
});

test('credit-decision: la vista de cola NO expone PII ni el sobre cifrado', () => {
  const { _test } = require('../../netlify/functions/credit-decision');
  const record = {
    applicationId: 'CRD-1-AAAA',
    estado: 'pendiente_revision',
    createdAt: '2026-07-08T00:00:00.000Z',
    recomendacion: 'requiere_codeudor',
    esRecomendacion: true,
    requiereVerificacionIdentidad: false,
    fuenteSenales: 'ia',
    confidential: 'SOBRE-CIFRADO-NO-DEBE-SALIR',
    documentos: [{ kind: 'extracto', size: 123, envelope: 'x' }],
    revision: { decision: null, revisadoPor: null, revisadoEn: null }
  };
  const item = _test.toQueueItem(record);
  const serialized = JSON.stringify(item);
  assert.ok(!serialized.includes('SOBRE-CIFRADO'), 'la cola no debe incluir el sobre cifrado');
  assert.ok(!('confidential' in item), 'la cola no debe exponer confidential');
  assert.ok(!('documentos' in item), 'la cola no debe exponer documentos');
  assert.equal(item.recomendacion, 'requiere_codeudor');
  assert.equal(item.estado, 'pendiente_revision');
});
