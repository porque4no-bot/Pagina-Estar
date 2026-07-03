const test = require('node:test');
const assert = require('node:assert/strict');
const tra = require('../../netlify/functions/_tra');

/* Config activa inyectable para los tests (no toca process.env ni la red). */
function liveConfig(overrides = {}) {
  return {
    enabled: true,
    token: 'RNT-TOKEN-123',
    rnt: '276306',
    nit: '',
    apiBase: 'https://traapi.mincit.gov.co/api',
    timeoutMs: 10000,
    ...overrides
  };
}

const reserva = { checkIn: '2026-08-01', checkOut: '2026-08-05' };
const titular = {
  firstName: 'Ana', lastName: 'Pérez', documentType: 'C.C', documentNumber: '123',
  nationality: 'Colombia', sex: 'F', occupation: 'Ingeniera', birthDate: '1990-01-01',
  residenceCity: 'Bogotá', residenceCountry: 'Colombia',
  originCity: 'Medellín', originCountry: 'Colombia'
};
const acompanante = {
  firstName: 'Luis', lastName: 'Gómez', documentType: 'Pasaporte', documentNumber: 'X9',
  nationality: 'España', sex: 'M', destination: 'Cartagena'
};

test('mock-safe: sin token devuelve { ok:false, isMock:true } y NO llama a la red', async () => {
  let called = false;
  const res = await tra.reportReservation(
    { reserva, huespedes: [titular] },
    { config: liveConfig({ token: '' }), fetch: async () => { called = true; } }
  );
  assert.equal(res.ok, false);
  assert.equal(res.isMock, true);
  assert.equal(called, false);
});

test('mock-safe: TRA_ENABLED apagado devuelve isMock y NO llama a la red', async () => {
  let called = false;
  const res = await tra.reportReservation(
    { reserva, huespedes: [titular] },
    { config: liveConfig({ enabled: false }), fetch: async () => { called = true; } }
  );
  assert.equal(res.ok, false);
  assert.equal(res.isMock, true);
  assert.equal(called, false);
});

test('reporta titular + 1 acompañante con "padre" y usa Authorization', async () => {
  const calls = [];
  const fetchFn = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url, headers: opts.headers, body });
    /* El titular (base /api/) devuelve un id; los acompañantes van a /apitwo/. */
    if (/\/api\/$/.test(url)) return { ok: true, json: async () => ({ id: 4242 }) };
    return { ok: true, json: async () => ({ ok: true }) };
  };

  const res = await tra.reportReservation(
    { reserva, huespedes: [titular, acompanante] },
    { config: liveConfig(), fetch: fetchFn }
  );

  assert.equal(res.ok, true);
  assert.equal(res.id, 4242);
  assert.equal(res.acompanantes.length, 1);
  assert.equal(res.acompanantes[0].ok, true);

  /* Dos llamadas: titular a /api/, acompañante a /apitwo/. */
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/api\/$/);
  assert.match(calls[1].url, /\/apitwo\/$/);

  /* Ambas envían el token en Authorization. */
  assert.equal(calls[0].headers.Authorization, 'RNT-TOKEN-123');
  assert.equal(calls[1].headers.Authorization, 'RNT-TOKEN-123');

  /* Titular: grafía LITERAL de la API + conteo de acompañantes. */
  assert.equal(calls[0].body.numero_acompanantes, 1);
  assert.equal(calls[0].body.check_in, '2026-08-01');
  assert.equal(calls[0].body.check_out, '2026-08-05');
  assert.equal(calls[0].body.cuidad_residencia, 'Bogotá');
  assert.equal(calls[0].body.cuidad_procedencia, 'Medellín');
  assert.equal(calls[0].body.rnt, '276306');

  /* Acompañante: lleva el id del titular en 'padre'. */
  assert.equal(calls[1].body.padre, 4242);
  assert.equal(calls[1].body.nombres, 'Luis');
  assert.equal(calls[1].body.cuidad_destino, 'Cartagena');
});

test('no lanza si el fetch falla; devuelve { ok:false } con error', async () => {
  const fetchFn = async () => { throw new Error('network down'); };
  const res = await tra.reportReservation(
    { reserva, huespedes: [titular, acompanante] },
    { config: liveConfig(), fetch: fetchFn }
  );
  assert.equal(res.ok, false);
  assert.equal(res.error, 'network down');
});

test('no lanza si el fetch de un acompañante falla; el titular quedó reportado', async () => {
  let n = 0;
  const fetchFn = async (url) => {
    n++;
    if (/\/api\/$/.test(url)) return { ok: true, json: async () => ({ id: 7 }) };
    throw new Error('boom en acompañante');
  };
  const res = await tra.reportReservation(
    { reserva, huespedes: [titular, acompanante] },
    { config: liveConfig(), fetch: fetchFn }
  );
  assert.equal(res.ok, false);          /* algún acompañante falló */
  assert.equal(res.id, 7);              /* pero el titular sí se reportó */
  assert.equal(res.acompanantes[0].ok, false);
});

test('sin huéspedes devuelve reason:no-guests sin llamar a la red', async () => {
  let called = false;
  const res = await tra.reportReservation(
    { reserva, huespedes: [] },
    { config: liveConfig(), fetch: async () => { called = true; } }
  );
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'no-guests');
  assert.equal(called, false);
});

test('respuesta no-ok del TRA para el titular corta y devuelve el error', async () => {
  const fetchFn = async () => ({ ok: false, status: 422, json: async () => ({ message: 'documento inválido' }) });
  const res = await tra.reportReservation(
    { reserva, huespedes: [titular] },
    { config: liveConfig(), fetch: fetchFn }
  );
  assert.equal(res.ok, false);
  assert.equal(res.status, 422);
  assert.equal(res.error, 'documento inválido');
});

test('companionBase deriva /apitwo desde /api y usa /two como fallback', () => {
  assert.equal(tra.companionBase('https://traapi.mincit.gov.co/api'), 'https://traapi.mincit.gov.co/apitwo');
  assert.equal(tra.companionBase('https://example.com/api/'), 'https://example.com/apitwo');
  assert.equal(tra.companionBase('https://example.com/base'), 'https://example.com/base/two');
});

test('isConfigured refleja enabled + token vía process.env', () => {
  const prevEnabled = process.env.TRA_ENABLED;
  const prevToken = process.env.TRA_TOKEN;
  try {
    process.env.TRA_ENABLED = 'true';
    process.env.TRA_TOKEN = 'tok';
    assert.equal(tra.isConfigured(), true);
    delete process.env.TRA_TOKEN;
    assert.equal(tra.isConfigured(), false);
    process.env.TRA_TOKEN = 'tok';
    process.env.TRA_ENABLED = 'false';
    assert.equal(tra.isConfigured(), false);
  } finally {
    if (prevEnabled === undefined) delete process.env.TRA_ENABLED; else process.env.TRA_ENABLED = prevEnabled;
    if (prevToken === undefined) delete process.env.TRA_TOKEN; else process.env.TRA_TOKEN = prevToken;
  }
});

test('traConfig aplica el RNT por defecto de MIRADA SAS (276306)', () => {
  const prev = process.env.TRA_RNT;
  try {
    delete process.env.TRA_RNT;
    assert.equal(tra.traConfig().rnt, '276306');
  } finally {
    if (prev === undefined) delete process.env.TRA_RNT; else process.env.TRA_RNT = prev;
  }
});
