/* Escalamiento por llamada (Twilio voz). Cliente mock-safe, nunca lanza. fetch y
 * config inyectados → sin red ni env. */

const test = require('node:test');
const assert = require('node:assert/strict');
const voice = require('../../netlify/functions/_twilio-voice');

const CFG = { accountSid: 'AC123', authToken: 'tok', from: '+15550001111', apiBase: 'https://api.twilio.com', timeoutMs: 5000 };

test('buildTwiml: <Say> con idioma y texto escapado', () => {
  const es = voice.buildTwiml('Atención & "ya"', 'es');
  assert.match(es, /<Say language="es-MX">/);
  assert.match(es, /Atención &amp; &quot;ya&quot;/);
  const en = voice.buildTwiml('hi', 'en');
  assert.match(en, /<Say language="en-US">/);
});

test('placeCall: sin credenciales → mock no-op (no lanza)', async () => {
  const r = await voice.placeCall({ to: '+573001112233', message: 'x' }, { config: { accountSid: '', authToken: '', from: '' } });
  assert.equal(r.ok, false);
  assert.equal(r.isMock, true);
});

test('placeCall: sin destino → no-destination', async () => {
  const r = await voice.placeCall({ to: '', message: 'x' }, { config: CFG });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-destination');
});

test('placeCall: éxito → ok + sid, y arma bien el request (auth, To/From/Twiml)', async () => {
  let captured = null;
  const fetchMock = async (url, opts) => {
    captured = { url, opts };
    return new Response(JSON.stringify({ sid: 'CA999', status: 'queued' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  };
  const r = await voice.placeCall({ to: '+573057465544', message: 'Huésped requiere atención', lang: 'es' }, { config: CFG, fetch: fetchMock });
  assert.equal(r.ok, true);
  assert.equal(r.sid, 'CA999');
  assert.match(captured.url, /\/2010-04-01\/Accounts\/AC123\/Calls\.json$/);
  assert.equal(captured.opts.headers.Authorization, 'Basic ' + Buffer.from('AC123:tok').toString('base64'));
  assert.match(captured.opts.body, /To=%2B573057465544/);
  assert.match(captured.opts.body, /From=%2B15550001111/);
  assert.match(captured.opts.body, /Twiml=/);
});

test('placeCall: error 4xx de Twilio → ok:false con el mensaje', async () => {
  const fetchMock = async () => new Response(JSON.stringify({ message: 'Invalid To number' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  const r = await voice.placeCall({ to: '+1', message: 'x' }, { config: CFG, fetch: fetchMock });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.match(r.error, /Invalid To number/);
});

test('placeCall: excepción de red → ok:false, no lanza', async () => {
  const fetchMock = async () => { throw new Error('network down'); };
  const r = await voice.placeCall({ to: '+573001112233', message: 'x' }, { config: CFG, fetch: fetchMock });
  assert.equal(r.ok, false);
  assert.match(r.error, /network down/);
});
