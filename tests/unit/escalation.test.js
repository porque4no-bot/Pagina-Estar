/* Escalamiento: prioridad llamada → fallback alerta. deps inyectados (flag,
 * twilioVoice, alert, targets). Best-effort, nunca lanza. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { escalate, escalationTargets, parseTargets } = require('../../netlify/functions/_escalation');

function fakeAlert() {
  const calls = [];
  return { calls, mod: { reportAlert: async (a) => { calls.push(a); } } };
}
function fakeVoice(seq) {
  /* seq: array de resultados por llamada (en orden de destino) */
  const calls = [];
  let i = 0;
  return { calls, mod: { placeCall: async ({ to }) => { calls.push(to); return seq[i++] || { ok: false }; } } };
}

test('llamada habilitada y exitosa → callOk, sin fallback', async () => {
  const alert = fakeAlert();
  const voice = fakeVoice([{ ok: true, sid: 'CA1' }]);
  const r = await escalate({ reason: 'door_access', guestNumber: '57300' }, {
    flag: async () => 'true', twilioVoice: voice.mod, alert: alert.mod, targets: ['+57300111']
  });
  assert.equal(r.callOk, true);
  assert.equal(r.fallback, null);
  assert.equal(voice.calls.length, 1);
  assert.equal(alert.calls.length, 0, 'no alerta si la llamada salió');
});

test('intenta destinos en orden: primero falla, segundo contesta', async () => {
  const alert = fakeAlert();
  const voice = fakeVoice([{ ok: false }, { ok: true, sid: 'CA2' }]);
  const r = await escalate({ reason: 'x' }, {
    flag: async () => 'true', twilioVoice: voice.mod, alert: alert.mod, targets: ['+57300111', '+57300222']
  });
  assert.equal(r.callOk, true);
  assert.deepEqual(voice.calls, ['+57300111', '+57300222']);
  assert.equal(alert.calls.length, 0);
});

test('llamada habilitada pero todas fallan → fallback a alerta', async () => {
  const alert = fakeAlert();
  const voice = fakeVoice([{ ok: false }, { ok: false }]);
  const r = await escalate({ reason: 'x', summary: 's', guestNumber: '57300' }, {
    flag: async () => 'true', twilioVoice: voice.mod, alert: alert.mod, targets: ['+1', '+2']
  });
  assert.equal(r.callOk, false);
  assert.equal(r.fallback, 'alert');
  assert.equal(alert.calls.length, 1);
  assert.equal(alert.calls[0].kind, 'guest_escalation');
  assert.equal(alert.calls[0].severity, 'critical');
});

test('llamada deshabilitada → no llama, fallback a alerta', async () => {
  const alert = fakeAlert();
  const voice = fakeVoice([{ ok: true }]);
  const r = await escalate({ reason: 'x' }, {
    flag: async () => 'false', twilioVoice: voice.mod, alert: alert.mod, targets: ['+1']
  });
  assert.equal(voice.calls.length, 0, 'no intenta llamar si está apagado');
  assert.equal(r.callOk, false);
  assert.equal(r.fallback, 'alert');
});

test('parseTargets: coma-separados, recorta y descarta vacíos', () => {
  assert.deepEqual(parseTargets(' +57300111 , +57300222 ,, '), ['+57300111', '+57300222']);
  assert.deepEqual(parseTargets(''), []);
  assert.deepEqual(parseTargets(null), []);
});

test('escalationTargets: override del panel gana; si no, ESCALATION_PHONE_NUMBERS', async () => {
  /* override del panel (get inyectado) */
  let r = await escalationTargets({ get: async () => ' +57300999 , +57300888 ' });
  assert.deepEqual(r, ['+57300999', '+57300888']);

  /* fallback a la variable de entorno cuando el panel no tiene valor */
  const prev = process.env.ESCALATION_PHONE_NUMBERS;
  process.env.ESCALATION_PHONE_NUMBERS = '+57300111,+57300222';
  try {
    r = await escalationTargets({ get: async (k, fb) => process.env[k] || fb });
    assert.deepEqual(r, ['+57300111', '+57300222']);
  } finally {
    if (prev === undefined) delete process.env.ESCALATION_PHONE_NUMBERS; else process.env.ESCALATION_PHONE_NUMBERS = prev;
  }
});

test('escalationTargets: nunca lanza; si get falla, cae a env', async () => {
  const prev = process.env.ESCALATION_PHONE_NUMBERS;
  process.env.ESCALATION_PHONE_NUMBERS = '+57300abc';
  try {
    const r = await escalationTargets({ get: async () => { throw new Error('store down'); } });
    assert.deepEqual(r, ['+57300abc']);
  } finally {
    if (prev === undefined) delete process.env.ESCALATION_PHONE_NUMBERS; else process.env.ESCALATION_PHONE_NUMBERS = prev;
  }
});

test('best-effort: si reportAlert lanza, escalate no propaga', async () => {
  const voice = fakeVoice([{ ok: false }]);
  const r = await escalate({ reason: 'x' }, {
    flag: async () => 'true', twilioVoice: voice.mod,
    alert: { reportAlert: async () => { throw new Error('boom'); } }, targets: ['+1']
  });
  assert.equal(r.callOk, false); /* no lanzó */
});
