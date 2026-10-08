const assert = require('node:assert/strict');
const test = require('node:test');

/* Sin red ni Blobs reales: stores en memoria inyectados vía _test.setDeps. La
   bóveda usa una clave de prueba para ejercitar el descifrado real. */
process.env.GUEST_APP_TOKEN_SECRET = 'unit-test-token-secret';
process.env.GUEST_APP_DATA_ENCRYPTION_KEY = 'unit-test-encryption-secret-sire-export';
for (const k of ['SIRE_EXPORT_TOKEN', 'SIRE_ENABLED', 'SIRE_HOTEL_CODE', 'SIRE_CITY_CODE', 'SIRE_DELIMITER',
  'SIRE_DATE_FORMAT', 'SIRE_COLUMNS', 'SIRE_TEXT_ASCII', 'SIRE_COUNTRY_CODES_JSON', 'SIRE_DOC_TYPE_CODES_JSON',
  'SIRE_CITY_CODES_JSON', 'SIRE_EXPORT_LOOKBACK_DAYS']) {
  delete process.env[k];
}

const sire = require('../../netlify/functions/_sire');
const catalog = require('../../netlify/functions/_sire-catalog');
const sireExport = require('../../netlify/functions/sire-export');
const guestApp = require('../../netlify/functions/_guest-app');
const { _test } = sireExport;

const TOKEN = 'tok_' + 'a1b2c3d4e5f6'.repeat(4); /* 52 caracteres */

function withEnv(vars, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  const restore = () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  };
  try {
    const out = fn();
    if (out && typeof out.then === 'function') return out.finally(restore);
    restore();
    return out;
  } catch (e) {
    restore();
    throw e;
  }
}

function memStore(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    failList: false,
    async list() {
      if (this.failList) throw new Error('blobs down');
      return { blobs: [...data.keys()].map(key => ({ key })) };
    },
    async get(key, opts) {
      if (!data.has(key)) return null;
      const v = data.get(key);
      if (opts && opts.type === 'json') return typeof v === 'string' ? JSON.parse(v) : v;
      return typeof v === 'string' ? v : JSON.stringify(v);
    },
    async set(key, value) { data.set(key, value); },
    async delete(key) { data.delete(key); }
  };
}

/* ---- datos de prueba (inventados) ---- */

const GUEST_ES = {
  firstName: 'Lucía', lastName: 'Muñoz Pérez', documentType: 'Pasaporte', documentNumber: 'pa-12 345',
  nationality: 'España', birthDate: '1990-02-03', originCountry: 'España', originCity: 'Madrid',
  destination: 'Lima, Perú'
};
const GUEST_CO = {
  firstName: 'Andrea', lastName: 'Restrepo', documentType: 'CC', documentNumber: '1234567890',
  nationality: 'Colombia', birthDate: '1992-05-16'
};
const GUEST_US = {
  firstName: 'John', lastName: 'Smith', documentType: 'Pasaporte', documentNumber: 'X998877',
  nationality: 'United States', birthDate: '1985-11-30', residenceCountry: 'Estados Unidos',
  destination: 'Bogotá, Colombia'
};

function checkinRecord(bookingCode, guests, reservation, createdAt) {
  return {
    type: 'guest_checkin',
    checkinId: `CHK-${Date.parse(createdAt)}-AAAAAA`,
    bookingCode,
    guest: guests[0],
    reservation,
    guests: guests.map((g, i) => ({ guest: g, guestIndex: i, isPrimary: i === 0 })),
    status: 'received',
    createdAt
  };
}

const CONFIG = {
  hotelCode: 'H777', cityCode: '17001', hotelAddress: '', delimiter: '\t',
  dateFormat: 'YYYY-MM-DD', columns: null, enabled: true
};

function exportOpts(extra = {}) {
  return {
    desde: '2026-10-01', hasta: '2026-10-07', hoy: '2026-10-08',
    config: CONFIG, catalog: catalog.loadCatalog(), faltante: [], errores: [], ...extra
  };
}

/* ================= _sire-catalog ================= */

test('catálogo: países por nombre, alias en inglés, gentilicio e ISO', () => {
  assert.equal(catalog.resolveCountry('España').code, '245');
  assert.equal(catalog.resolveCountry('spain').iso2, 'ES');
  assert.equal(catalog.resolveCountry('ESPAÑOLA').iso2, 'ES');
  assert.equal(catalog.resolveCountry('United States').code, '249');
  assert.equal(catalog.resolveCountry('EE.UU.').iso2, 'US');
  assert.equal(catalog.resolveCountry('Perú').code, '589');
  assert.equal(catalog.resolveCountry('Narnia'), null);
  assert.equal(catalog.resolveCountry(''), null);
});

test('catálogo: extranjero = cualquier nacionalidad que no sea Colombia (vacío = no se sabe)', () => {
  assert.equal(catalog.isForeignNationality('Colombia'), false);
  assert.equal(catalog.isForeignNationality('colombiana'), false);
  assert.equal(catalog.isForeignNationality(''), false);
  assert.equal(catalog.isForeignNationality('España'), true);
  /* Desconocida: se trata como extranjera para que nadie se escape del reporte. */
  assert.equal(catalog.isForeignNationality('Narnia'), true);
});

test('catálogo: lugares en texto libre → código de país o de ciudad colombiana', () => {
  assert.equal(catalog.resolvePlaceText('Lima, Perú'), '589');
  assert.equal(catalog.resolvePlaceText('Bogotá, Colombia'), '11001');
  assert.equal(catalog.resolvePlaceText('Bogotá D.C.'), '11001');
  assert.equal(catalog.resolvePlaceText('Medellín'), '05001');
  assert.equal(catalog.resolvePlaceText('Madrid, España'), '245');
  assert.equal(catalog.resolvePlaceText('Atlantis'), '');
  assert.equal(catalog.resolvePlaceText(''), '');
  assert.equal(catalog.resolvePlace({ city: 'Manizales', country: 'Colombia' }), '17001');
  assert.equal(catalog.resolvePlace({ city: 'Madrid', country: 'España' }), '245');
  assert.equal(catalog.resolvePlace({ city: 'Pueblito', country: 'Colombia' }), '');
  assert.equal(catalog.resolvePlace({ country: 'Narnia' }), '');
});

test('catálogo: tipos de documento del check-in → código SIRE', () => {
  assert.equal(catalog.docTypeCode('Pasaporte'), '3');
  assert.equal(catalog.docTypeCode('pasaporte'), '3');
  assert.equal(catalog.docTypeCode('CE'), '5');
  assert.equal(catalog.docTypeCode('Licencia'), '');
});

test('catálogo: correcciones por env (JSON) y JSON inválido reportado sin lanzar', () => {
  withEnv({
    SIRE_COUNTRY_CODES_JSON: '{"España":"999","Kenia":"355"}',
    SIRE_DOC_TYPE_CODES_JSON: '{"Pasaporte":"P"}',
    SIRE_CITY_CODES_JSON: '{"Neira":"17486"}',
    SIRE_CITY_CODE: '17999'
  }, () => {
    const cat = catalog.loadCatalog();
    assert.equal(catalog.resolveCountry('españa', cat).code, '999');
    assert.equal(catalog.resolveCountry('Kenia', cat).code, '355');
    assert.equal(catalog.isForeignNationality('Kenia', cat), true);
    assert.equal(catalog.docTypeCode('Pasaporte', cat), 'P');
    assert.equal(catalog.resolvePlaceText('Neira, Colombia', cat), '17486');
    assert.equal(cat.hotelCity, '17999');
    assert.deepEqual(cat.errors, []);
  });
  withEnv({ SIRE_COUNTRY_CODES_JSON: '{no es json' }, () => {
    const cat = catalog.loadCatalog();
    assert.equal(cat.errors.length, 1);
    assert.match(cat.errors[0], /SIRE_COUNTRY_CODES_JSON/);
    assert.equal(catalog.resolveCountry('España', cat).code, '245'); /* sigue el default */
  });
});

test('catálogo: ciudad del hotel por defecto = Manizales (17001)', () => {
  assert.equal(catalog.loadCatalog().hotelCity, '17001');
});

test('catálogo: nombres en MAYÚSCULAS sin tildes (configurable) y documento limpio', () => {
  assert.equal(catalog.sireText('Muñoz  Pérez'), 'MUNOZ PEREZ');
  assert.equal(catalog.sireText("O'Brien-Smith"), "O'BRIEN-SMITH");
  withEnv({ SIRE_TEXT_ASCII: 'false' }, () => {
    assert.equal(catalog.sireText('Muñoz  Pérez', catalog.loadCatalog()), 'Muñoz Pérez');
  });
  assert.equal(catalog.normalizeDocNumber(' pa-12 345. '), 'PA12345');
});

/* ================= _sire (extensiones) ================= */

test('_sire.formatDate: formatos configurables, ISO por defecto', () => {
  assert.equal(sire.formatDate('2026-07-01', 'DD/MM/YYYY'), '01/07/2026');
  assert.equal(sire.formatDate('2026-07-01', 'YYYYMMDD'), '20260701');
  assert.equal(sire.formatDate('2026-07-01', 'DD-MM-YYYY'), '01-07-2026');
  assert.equal(sire.formatDate('2026-07-01T10:00:00Z', undefined), '2026-07-01');
  assert.equal(sire.formatDate('2026-07-01', 'raro'), '2026-07-01');
  assert.equal(sire.formatDate('', 'DD/MM/YYYY'), '');
  assert.equal(sire.normalizeDateFormat('dd/mm/aaaa'), 'DD/MM/YYYY');
});

test('_sire.parseColumns: valida claves y rechaza desconocidas/repetidas', () => {
  assert.deepEqual(sire.parseColumns(''), { ok: true, keys: null });
  assert.equal(sire.parseColumns('primer_apellido, nombres').ok, true);
  assert.equal(sire.parseColumns('foo,nombres').ok, false);
  assert.equal(sire.parseColumns('nombres,nombres').ok, false);
});

test('_sire.movementRow: una fila por movimiento con fecha formateada y columnas faltantes', () => {
  const cfg = { ...CONFIG, dateFormat: 'DD/MM/YYYY' };
  const h = { documentType: '3', documentNumber: 'X1', nationalityCode: '245', lastName: 'DOE', firstName: 'JOHN',
    originCode: '245', destinationCode: '', birthDate: '1990-01-31' };
  const reserva = { checkIn: '2026-10-03', checkOut: '2026-10-06' };
  const e = sire.movementRow(h, reserva, 'E', { config: cfg });
  const s = sire.movementRow(h, reserva, 'S', { config: cfg });
  const cols = sire.columnNames(cfg);
  assert.equal(e.row.split('\t')[cols.indexOf('fecha_movimiento')], '03/10/2026');
  assert.equal(s.row.split('\t')[cols.indexOf('fecha_movimiento')], '06/10/2026');
  assert.equal(e.row.split('\t')[cols.indexOf('fecha_nacimiento')], '31/01/1990');
  assert.deepEqual(e.missing, ['codigo_destino']);
});

test('_sire: SIRE_COLUMNS permite primer/segundo apellido por separado', () => {
  const cfg = { ...CONFIG, columns: ['primer_apellido', 'segundo_apellido', 'nombres', 'tipo_movimiento'] };
  const { row, missing } = sire.movementRow({ lastName: 'SMITH JONES', firstName: 'ANN' }, { checkIn: '2026-10-03' }, 'E', { config: cfg });
  assert.equal(row, 'SMITH\tJONES\tANN\tE');
  assert.deepEqual(missing, []);
  const solo = sire.movementRow({ lastName: 'SMITH', firstName: 'ANN' }, { checkIn: '2026-10-03' }, 'E', { config: cfg });
  assert.deepEqual(solo.missing, []); /* el segundo apellido es opcional */
});

test('_sire.sireConfig lee formato/separador/columnas del entorno (o del panel)', () => {
  withEnv({ SIRE_DATE_FORMAT: 'DD/MM/YYYY', SIRE_DELIMITER: '|', SIRE_COLUMNS: 'nombres,tipo_movimiento' }, () => {
    const cfg = sire.sireConfig();
    assert.equal(cfg.dateFormat, 'DD/MM/YYYY');
    assert.equal(cfg.delimiter, '|');
    assert.deepEqual(cfg.columns, ['nombres', 'tipo_movimiento']);
    assert.equal(cfg.columnsError, '');
  });
  withEnv({ SIRE_COLUMNS: 'inventada' }, () => {
    const cfg = sire.sireConfig();
    assert.equal(cfg.columns, null);
    assert.match(cfg.columnsError, /desconocidas/);
  });
});

/* ================= sire-export: núcleo puro ================= */

test('resolveRange: por defecto los 7 días que terminan AYER, en hora de Bogotá', () => {
  /* 2026-10-08 10:00 Bogotá = 15:00 UTC */
  const r = _test.resolveRange({}, Date.parse('2026-10-08T15:00:00Z'));
  assert.deepEqual(r, { desde: '2026-10-01', hasta: '2026-10-07', hoy: '2026-10-08' });
  /* 22:00 del 8 en Bogotá = 03:00 UTC del 9: sigue siendo el 8 en Colombia */
  assert.equal(_test.resolveRange({}, Date.parse('2026-10-09T03:00:00Z')).hoy, '2026-10-08');
});

test('resolveRange: valida formato, orden y tamaño máximo', () => {
  const now = Date.parse('2026-10-08T15:00:00Z');
  assert.ok(_test.resolveRange({ desde: '2026-13-01', hasta: '2026-10-01' }, now).error);
  assert.ok(_test.resolveRange({ desde: '2026-10-05', hasta: '2026-10-01' }, now).error);
  assert.ok(_test.resolveRange({ desde: '2026-01-01', hasta: '2026-10-01' }, now).error);
  assert.deepEqual(_test.resolveRange({ desde: '2026-09-01', hasta: '2026-09-30' }, now),
    { desde: '2026-09-01', hasta: '2026-09-30', hoy: '2026-10-08' });
});

test('movementId: estable y opaco; distinto por movimiento y por reserva', () => {
  const a = _test.movementId('R1', '3', 'X1', 'E');
  assert.match(a, /^[a-f0-9]{24}$/);
  assert.equal(a, _test.movementId('R1', '3', 'X1', 'E'));
  assert.notEqual(a, _test.movementId('R1', '3', 'X1', 'S'));
  assert.notEqual(a, _test.movementId('R2', '3', 'X1', 'E'));
  assert.ok(!a.includes('X1'));
});

test('buildExport: solo extranjeros, E en check-in y S en check-out, en orden', () => {
  const records = [
    checkinRecord('R1', [GUEST_CO, GUEST_ES], { checkIn: '2026-10-03', checkOut: '2026-10-06' }, '2026-10-02T12:00:00Z'),
    checkinRecord('R2', [GUEST_CO], { checkIn: '2026-10-02', checkOut: '2026-10-04' }, '2026-10-01T12:00:00Z')
  ];
  const out = _test.buildExport(records, exportOpts());
  assert.equal(out.listo, true);
  assert.equal(out.conteos.extranjeros, 1);
  assert.equal(out.conteos.nacionales, 2);
  assert.equal(out.filas.length, 2);
  assert.deepEqual(out.filas.map(f => [f.ref, f.huesped, f.movimiento, f.fecha]),
    [['R1', 2, 'E', '2026-10-03'], ['R1', 2, 'S', '2026-10-06']]);

  const lines = out.txt.split('\r\n');
  assert.equal(lines.length, 2);
  const cols = out.formato.columnas;
  const e = lines[0].split('\t');
  assert.equal(e.length, cols.length);
  assert.equal(e[cols.indexOf('codigo_establecimiento')], 'H777');
  assert.equal(e[cols.indexOf('codigo_ciudad')], '17001');
  assert.equal(e[cols.indexOf('tipo_documento')], '3');
  assert.equal(e[cols.indexOf('numero_documento')], 'PA12345');
  assert.equal(e[cols.indexOf('codigo_nacionalidad')], '245');
  assert.equal(e[cols.indexOf('apellidos')], 'MUNOZ PEREZ');
  assert.equal(e[cols.indexOf('nombres')], 'LUCIA');
  assert.equal(e[cols.indexOf('tipo_movimiento')], 'E');
  assert.equal(e[cols.indexOf('codigo_procedencia')], '245');
  assert.equal(e[cols.indexOf('codigo_destino')], '589');
  assert.equal(e[cols.indexOf('fecha_nacimiento')], '1990-02-03');
  assert.equal(lines[1].split('\t')[cols.indexOf('tipo_movimiento')], 'S');
  assert.equal(out.formato.delimitador, 'TAB');
});

test('buildExport: procedencia cae a la residencia cuando falta el lugar de procedencia', () => {
  const out = _test.buildExport([
    checkinRecord('R9', [GUEST_US], { checkIn: '2026-10-03', checkOut: '2026-10-04' }, '2026-10-02T12:00:00Z')
  ], exportOpts());
  const cols = out.formato.columnas;
  const e = out.txt.split('\r\n')[0].split('\t');
  assert.equal(e[cols.indexOf('codigo_procedencia')], '249');
  assert.equal(e[cols.indexOf('codigo_destino')], '11001');
});

test('buildExport: nunca reporta movimientos futuros ni fuera del rango', () => {
  const out = _test.buildExport([
    checkinRecord('R3', [GUEST_ES], { checkIn: '2026-10-06', checkOut: '2026-10-12' }, '2026-10-05T12:00:00Z'),
    checkinRecord('R4', [GUEST_ES], { checkIn: '2026-09-20', checkOut: '2026-09-25' }, '2026-09-19T12:00:00Z')
  ], exportOpts({ hasta: '2026-10-15' }));
  assert.deepEqual(out.filas.map(f => `${f.ref}:${f.movimiento}`), ['R3:E']);
  assert.equal(out.conteos.futuros, 1);
});

test('buildExport: usa el check-in MÁS RECIENTE de cada reserva', () => {
  const older = checkinRecord('R1', [{ ...GUEST_ES, documentNumber: 'VIEJO1' }], { checkIn: '2026-10-03', checkOut: '2026-10-05' }, '2026-10-01T12:00:00Z');
  const newer = checkinRecord('R1', [GUEST_ES], { checkIn: '2026-10-03', checkOut: '2026-10-05' }, '2026-10-02T12:00:00Z');
  const out = _test.buildExport([newer, older], exportOpts());
  assert.equal(out.conteos.reenvios_ignorados, 1);
  assert.equal(out.filas.length, 2);
  assert.ok(!out.txt.includes('VIEJO1'));
});

test('buildExport: los ya reportados no se repiten (salvo incluir_reportados)', () => {
  const records = [checkinRecord('R1', [GUEST_ES], { checkIn: '2026-10-03', checkOut: '2026-10-06' }, '2026-10-02T12:00:00Z')];
  const first = _test.buildExport(records, exportOpts());
  const entradaId = first.filas.find(f => f.movimiento === 'E').id;
  const second = _test.buildExport(records, exportOpts({ reported: new Set([entradaId]) }));
  assert.deepEqual(second.filas.map(f => f.movimiento), ['S']);
  assert.equal(second.conteos.ya_reportados, 1);
  const again = _test.buildExport(records, exportOpts({ reported: new Set([entradaId]), includeReported: true }));
  assert.equal(again.filas.length, 2);
  assert.equal(again.filas.find(f => f.id === entradaId).reportado, true);
});

test('buildExport: campos faltantes → aviso por reserva e índice, sin datos personales', () => {
  const incompleto = { ...GUEST_ES, nationality: 'Narnia', destination: '', originCountry: '', originCity: '' };
  const out = _test.buildExport([
    checkinRecord('R5', [GUEST_CO, incompleto], { checkIn: '2026-10-03', checkOut: '2026-10-06' }, '2026-10-02T12:00:00Z')
  ], exportOpts());
  assert.equal(out.filas.length, 0);
  assert.equal(out.txt, '');
  assert.equal(out.avisos.length, 1);
  const a = out.avisos[0];
  assert.equal(a.ref, 'R5');
  assert.equal(a.huesped, 2);
  assert.deepEqual(a.movimientos, ['E', 'S']);
  assert.deepEqual(a.faltan.sort(), ['codigo_destino', 'codigo_nacionalidad', 'codigo_procedencia']);
  const dump = JSON.stringify(out.avisos);
  for (const pii of ['Lucía', 'LUCIA', 'Muñoz', 'MUNOZ', 'PA12345', 'pa-12 345', '1990-02-03', 'Narnia']) {
    assert.ok(!dump.includes(pii), `el aviso no debe llevar ${pii}`);
  }
});

test('buildExport: check-in sin fechas de reserva (token viejo) → aviso fechas_reserva si se hizo en el rango', () => {
  const out = _test.buildExport([
    checkinRecord('R6', [GUEST_ES], { checkIn: '', checkOut: '' }, '2026-10-03T12:00:00Z'),
    checkinRecord('R7', [GUEST_ES], { checkIn: '', checkOut: '' }, '2026-08-03T12:00:00Z')
  ], exportOpts());
  assert.deepEqual(out.avisos.map(a => [a.ref, a.faltan]), [['R6', ['fechas_reserva']]]);
});

test('buildExport: sin código del hotel NO entrega archivo (listo=false) y lo dice una sola vez', () => {
  const records = [checkinRecord('R1', [GUEST_ES], { checkIn: '2026-10-03', checkOut: '2026-10-06' }, '2026-10-02T12:00:00Z')];
  const out = _test.buildExport(records, exportOpts({ config: { ...CONFIG, hotelCode: '' }, faltante: ['SIRE_HOTEL_CODE'] }));
  assert.equal(out.listo, false);
  assert.equal(out.txt, '');
  assert.deepEqual(out.filas, []);
  assert.equal(out.conteos.movimientos_listos, 2);
  assert.deepEqual(out.configuracion.faltante, ['SIRE_HOTEL_CODE']);
  assert.equal(out.avisos.length, 0);
});

test('buildExport: el mismo documento repetido en una reserva sale una sola vez', () => {
  const out = _test.buildExport([
    checkinRecord('R8', [GUEST_ES, GUEST_ES], { checkIn: '2026-10-03', checkOut: '2026-10-06' }, '2026-10-02T12:00:00Z')
  ], exportOpts());
  assert.equal(out.filas.length, 2);
  assert.equal(out.conteos.duplicados, 2);
});

test('exportConfig: ciudad por defecto Manizales y errores de SIRE_COLUMNS bloquean', () => {
  withEnv({ SIRE_HOTEL_CODE: 'H1', SIRE_COLUMNS: 'nope' }, () => {
    const { config, faltante, errores } = _test.exportConfig(catalog.loadCatalog());
    assert.equal(config.cityCode, '17001');
    assert.deepEqual(faltante, []);
    assert.equal(errores.length, 1);
  });
  withEnv({ SIRE_HOTEL_CODE: undefined }, () => {
    assert.deepEqual(_test.exportConfig(catalog.loadCatalog()).faltante, ['SIRE_HOTEL_CODE']);
  });
});

/* ================= sire-export: handler ================= */

function bearer(token) { return { authorization: `Bearer ${token}` }; }

function setupHandler({ records = [], flagOn = true, rateOk = true, reports } = {}) {
  const checkins = memStore();
  for (const r of records) checkins.data.set(r.checkinId + '-' + r.bookingCode, guestApp.protectRecord(r));
  const reportsStore = reports || memStore();
  const stores = { 'guest-checkins': checkins, 'sire-reports': reportsStore };
  _test.setDeps({
    guestStore: name => stores[name],
    checkRateLimit: async () => (rateOk ? { ok: true } : { ok: false, retryAfter: 60 }),
    flag: async key => key === 'SIRE_ENABLED' && flagOn,
    preload: async () => {},
    now: () => Date.parse('2026-10-08T15:00:00Z')
  });
  return { checkins, reportsStore };
}

const baseEnv = { SIRE_EXPORT_TOKEN: TOKEN, SIRE_HOTEL_CODE: 'H777' };

test('handler: apagada (503) sin SIRE_EXPORT_TOKEN o con uno corto', async () => {
  setupHandler();
  try {
    await withEnv({ SIRE_EXPORT_TOKEN: undefined }, async () => {
      const res = await sireExport.handler({ httpMethod: 'GET', headers: bearer(TOKEN) });
      assert.equal(res.statusCode, 503);
    });
    await withEnv({ SIRE_EXPORT_TOKEN: 'corto' }, async () => {
      const res = await sireExport.handler({ httpMethod: 'GET', headers: bearer('corto') });
      assert.equal(res.statusCode, 503);
    });
  } finally { _test.resetDeps(); }
});

test('handler: 401 con token ausente, equivocado o en la URL', async () => {
  setupHandler();
  try {
    await withEnv(baseEnv, async () => {
      assert.equal((await sireExport.handler({ httpMethod: 'GET', headers: {} })).statusCode, 401);
      assert.equal((await sireExport.handler({ httpMethod: 'GET', headers: bearer(TOKEN + 'x') })).statusCode, 401);
      assert.equal((await sireExport.handler({ httpMethod: 'GET', headers: {}, queryStringParameters: { token: TOKEN } })).statusCode, 401);
      const res = await sireExport.handler({ httpMethod: 'GET', headers: { authorization: TOKEN } });
      assert.equal(res.statusCode, 401);
      assert.equal(res.headers['WWW-Authenticate'], 'Bearer');
    });
  } finally { _test.resetDeps(); }
});

test('handler: rate-limit (429) y método no permitido (405)', async () => {
  setupHandler({ rateOk: false });
  try {
    await withEnv(baseEnv, async () => {
      assert.equal((await sireExport.handler({ httpMethod: 'GET', headers: bearer(TOKEN) })).statusCode, 429);
      assert.equal((await sireExport.handler({ httpMethod: 'PUT', headers: bearer(TOKEN) })).statusCode, 405);
    });
  } finally { _test.resetDeps(); }
});

test('handler: respeta SIRE_ENABLED (503 si está apagado)', async () => {
  setupHandler({ flagOn: false });
  try {
    await withEnv(baseEnv, async () => {
      const res = await sireExport.handler({ httpMethod: 'GET', headers: bearer(TOKEN) });
      assert.equal(res.statusCode, 503);
      assert.match(JSON.parse(res.body).error, /SIRE_ENABLED/);
    });
  } finally { _test.resetDeps(); }
});

test('handler: GET descifra los check-ins, exporta y loguea SOLO conteos', async () => {
  const records = [
    checkinRecord('R1', [GUEST_CO, GUEST_ES], { checkIn: '2026-10-03', checkOut: '2026-10-06' }, '2026-10-02T12:00:00Z')
  ];
  setupHandler({ records });
  const logs = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a) => logs.push(a.join(' '));
  console.error = (...a) => logs.push(a.join(' '));
  try {
    await withEnv(baseEnv, async () => {
      const res = await sireExport.handler({ httpMethod: 'GET', headers: bearer(TOKEN) });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.headers['Cache-Control'], 'no-store');
      const body = JSON.parse(res.body);
      assert.equal(body.listo, true);
      assert.deepEqual(body.rango, { desde: '2026-10-01', hasta: '2026-10-07', hoy: '2026-10-08' });
      assert.equal(body.filas.length, 2);
      assert.equal(body.txt.split('\r\n').length, 2);
      assert.ok(body.txt.includes('PA12345'));
    });
  } finally {
    console.log = origLog;
    console.error = origErr;
    _test.resetDeps();
  }
  const all = logs.join('\n');
  for (const pii of ['PA12345', 'MUNOZ', 'Muñoz', 'LUCIA', 'Lucía', '1990-02-03', '1234567890', 'Restrepo']) {
    assert.ok(!all.includes(pii), `el log no debe llevar ${pii}`);
  }
  assert.match(all, /movimientos=2/);
});

test('handler: POST ack marca, es idempotente, y el siguiente GET ya no los repite', async () => {
  const records = [
    checkinRecord('R1', [GUEST_ES], { checkIn: '2026-10-03', checkOut: '2026-10-06' }, '2026-10-02T12:00:00Z')
  ];
  const { reportsStore } = setupHandler({ records });
  try {
    await withEnv(baseEnv, async () => {
      const first = JSON.parse((await sireExport.handler({ httpMethod: 'GET', headers: bearer(TOKEN) })).body);
      assert.equal(first.filas.length, 2);
      const entrada = first.filas.find(f => f.movimiento === 'E');

      const ack = await sireExport.handler({
        httpMethod: 'POST', headers: bearer(TOKEN),
        body: JSON.stringify({ accion: 'ack', filas: [entrada, { id: 'no-es-un-id' }], lote: 'vps 2026-10-08T10:00' })
      });
      assert.equal(ack.statusCode, 200, ack.body);
      const ackBody = JSON.parse(ack.body);
      assert.equal(ackBody.marcados, 1);
      assert.equal(ackBody.invalidos, 1);
      const saved = JSON.parse(reportsStore.data.get(entrada.id));
      assert.equal(saved.ref, 'R1');
      assert.equal(saved.movimiento, 'E');
      assert.equal(saved.lote, 'vps 2026-10-08T10:00');

      const again = JSON.parse((await sireExport.handler({
        httpMethod: 'POST', headers: bearer(TOKEN), body: JSON.stringify({ accion: 'ack', ids: [entrada.id] })
      })).body);
      assert.equal(again.marcados, 0);
      assert.equal(again.yaEstaban, 1);

      const second = JSON.parse((await sireExport.handler({ httpMethod: 'GET', headers: bearer(TOKEN) })).body);
      assert.deepEqual(second.filas.map(f => f.movimiento), ['S']);
      assert.equal(second.conteos.ya_reportados, 1);

      const undo = JSON.parse((await sireExport.handler({
        httpMethod: 'POST', headers: bearer(TOKEN), body: JSON.stringify({ accion: 'desmarcar', ids: [entrada.id] })
      })).body);
      assert.equal(undo.desmarcados, 1);
      assert.equal(reportsStore.data.has(entrada.id), false);
    });
  } finally { _test.resetDeps(); }
});

test('handler: POST valida la acción y los ids', async () => {
  setupHandler();
  try {
    await withEnv(baseEnv, async () => {
      assert.equal((await sireExport.handler({ httpMethod: 'POST', headers: bearer(TOKEN), body: '{"accion":"borrar"}' })).statusCode, 400);
      assert.equal((await sireExport.handler({ httpMethod: 'POST', headers: bearer(TOKEN), body: '{"accion":"ack","ids":["x"]}' })).statusCode, 400);
      assert.equal((await sireExport.handler({ httpMethod: 'POST', headers: bearer(TOKEN), body: '{nojson' })).statusCode, 400);
    });
  } finally { _test.resetDeps(); }
});

test('handler: si no se puede leer sire-reports, cierra (503) en vez de arriesgar duplicados', async () => {
  const reports = memStore();
  reports.failList = true;
  setupHandler({ reports });
  try {
    await withEnv(baseEnv, async () => {
      const res = await sireExport.handler({ httpMethod: 'GET', headers: bearer(TOKEN) });
      assert.equal(res.statusCode, 503);
    });
  } finally { _test.resetDeps(); }
});

test('handler: rango inválido → 400', async () => {
  setupHandler();
  try {
    await withEnv(baseEnv, async () => {
      const res = await sireExport.handler({ httpMethod: 'GET', headers: bearer(TOKEN), queryStringParameters: { desde: 'ayer' } });
      assert.equal(res.statusCode, 400);
    });
  } finally { _test.resetDeps(); }
});

test('tokenMatches: compara en tiempo constante y nunca acepta vacío', () => {
  assert.equal(_test.tokenMatches(TOKEN, TOKEN), true);
  assert.equal(_test.tokenMatches(TOKEN + 'x', TOKEN), false);
  assert.equal(_test.tokenMatches('', TOKEN), false);
  assert.equal(_test.tokenMatches('', ''), false);
});

test('timestampFromKey: lee el ms de CHK-<ms>-… y null si no se puede fechar', () => {
  assert.equal(_test.timestampFromKey('CHK-1717000000000-AB12'), 1717000000000);
  assert.equal(_test.timestampFromKey('otra-cosa'), null);
});

test('_settings: formato de SIRE gestionable; el token de exportación NUNCA', () => {
  const { isManageable, MANAGEABLE } = require('../../netlify/functions/_settings');
  assert.equal(isManageable('SIRE_EXPORT_TOKEN'), false);
  assert.equal(isManageable('SIRE_DATE_FORMAT'), true);
  assert.equal(isManageable('SIRE_DELIMITER'), true);
  assert.ok(MANAGEABLE.SIRE_DELIMITER.options.includes('\\t'));
  assert.equal(sire.normalizeDelimiter(MANAGEABLE.SIRE_DELIMITER.options[0]), '\t');
});
