const assert = require('node:assert/strict');
const test = require('node:test');

/* Sin red ni env real: la config se inyecta vía opts.config en cada caso, así
   la generación pura del archivo plano se prueba siempre (con SIRE apagado). */
const sire = require('../../netlify/functions/_sire');

/* Config de prueba reproducible (no toca process.env). */
const CFG = {
  hotelCode: 'HOTEL123',
  cityCode: '17001', /* Manizales (placeholder) */
  hotelAddress: 'Calle Falsa 123',
  delimiter: '\t',
  enabled: true
};

const HUESPED_CO = {
  firstName: 'Andrea',
  lastName: 'Restrepo',
  documentType: 'CC',
  documentNumber: '1234567890',
  nationality: 'Colombia',
  birthDate: '1992-05-16',
  originCity: 'Medellín',
  destination: 'Bogotá'
};

const HUESPED_EX = {
  firstName: 'John',
  lastName: 'Doe',
  documentType: 'Pasaporte',
  documentNumber: 'X1',
  nationality: 'España',
  birthDate: '1990-01-01',
  originCity: 'Madrid',
  destination: 'Lima'
};

const RESERVA = { checkIn: '2026-07-01', checkOut: '2026-07-04' };

/* ---- movementRows: dos filas (E y S) por huésped con las fechas correctas ---- */

test('movementRows genera 2 filas: E (check-in) y S (check-out)', () => {
  const rows = sire.movementRows(HUESPED_CO, RESERVA, { config: CFG });
  assert.equal(rows.length, 2);

  const cols = sire.columnNames();
  const idxMov = cols.indexOf('tipo_movimiento');
  const idxFecha = cols.indexOf('fecha_movimiento');

  const entrada = rows[0].split('\t');
  const salida = rows[1].split('\t');

  assert.equal(entrada[idxMov], 'E');
  assert.equal(entrada[idxFecha], '2026-07-01');
  assert.equal(salida[idxMov], 'S');
  assert.equal(salida[idxFecha], '2026-07-04');
});

test('movementRows coloca los campos del huésped en su columna', () => {
  const cols = sire.columnNames();
  const rows = sire.movementRows(HUESPED_CO, RESERVA, { config: CFG });
  const entrada = rows[0].split('\t');

  assert.equal(entrada[cols.indexOf('codigo_establecimiento')], 'HOTEL123');
  assert.equal(entrada[cols.indexOf('codigo_ciudad')], '17001');
  assert.equal(entrada[cols.indexOf('tipo_documento')], 'CC');
  assert.equal(entrada[cols.indexOf('numero_documento')], '1234567890');
  assert.equal(entrada[cols.indexOf('codigo_nacionalidad')], 'Colombia');
  assert.equal(entrada[cols.indexOf('apellidos')], 'Restrepo');
  assert.equal(entrada[cols.indexOf('nombres')], 'Andrea');
  assert.equal(entrada[cols.indexOf('codigo_procedencia')], 'Medellín');
  assert.equal(entrada[cols.indexOf('codigo_destino')], 'Bogotá');
  assert.equal(entrada[cols.indexOf('fecha_nacimiento')], '1992-05-16');
});

/* ---- delimitador configurable ---- */

test('respeta el delimitador configurado (pipe)', () => {
  const rows = sire.movementRows(HUESPED_CO, RESERVA, {
    config: { ...CFG, delimiter: '|' }
  });
  assert.ok(rows[0].includes('|'));
  assert.ok(!rows[0].includes('\t'));
  /* mismo número de columnas que nombres definidos */
  assert.equal(rows[0].split('|').length, sire.columnNames().length);
});

test('el delimitador se limpia de los valores de celda (no rompe columnas)', () => {
  /* un valor con el delimitador dentro no debe crear columnas extra */
  const rows = sire.movementRows(
    { ...HUESPED_CO, lastName: 'Res|trepo' },
    RESERVA,
    { config: { ...CFG, delimiter: '|' } }
  );
  assert.equal(rows[0].split('|').length, sire.columnNames().length);
});

/* ---- buildSireFile: multi-ocupante ---- */

test('buildSireFile genera 2 filas por huésped (multi-ocupante)', () => {
  const result = sire.buildSireFile(
    { reserva: RESERVA, huespedes: [HUESPED_CO, HUESPED_EX] },
    { config: CFG }
  );
  assert.equal(result.ok, true);
  assert.equal(result.count, 4); /* 2 huéspedes × (E + S) */
  assert.equal(result.rows.length, 4);

  const lines = result.content.split('\r\n');
  assert.equal(lines.length, 4);
});

test('buildSireFile: cada huésped conserva sus propias fechas de movimiento', () => {
  const cols = sire.columnNames();
  const idxMov = cols.indexOf('tipo_movimiento');
  const idxFecha = cols.indexOf('fecha_movimiento');
  const idxDoc = cols.indexOf('numero_documento');

  const result = sire.buildSireFile(
    { reserva: RESERVA, huespedes: [HUESPED_CO, HUESPED_EX] },
    { config: CFG }
  );

  const [co_e, co_s, ex_e, ex_s] = result.rows.map(r => r.split('\t'));
  assert.equal(co_e[idxDoc], '1234567890');
  assert.equal(co_e[idxMov], 'E');
  assert.equal(co_e[idxFecha], '2026-07-01');
  assert.equal(co_s[idxMov], 'S');
  assert.equal(co_s[idxFecha], '2026-07-04');
  assert.equal(ex_e[idxDoc], 'X1');
  assert.equal(ex_e[idxMov], 'E');
  assert.equal(ex_s[idxMov], 'S');
});

/* ---- buildSireFile: multi-reserva ---- */

test('buildSireFile acepta varias reservas con sus huéspedes', () => {
  const result = sire.buildSireFile({
    reservas: [
      { reserva: { checkIn: '2026-07-01', checkOut: '2026-07-03' }, huespedes: [HUESPED_CO] },
      { reserva: { checkIn: '2026-08-10', checkOut: '2026-08-12' }, huespedes: [HUESPED_EX] }
    ]
  }, { config: CFG });

  assert.equal(result.count, 4); /* 2 reservas × 1 huésped × (E + S) */

  const cols = sire.columnNames();
  const idxFecha = cols.indexOf('fecha_movimiento');
  const rows = result.rows.map(r => r.split('\t'));
  assert.equal(rows[0][idxFecha], '2026-07-01'); /* E reserva 1 */
  assert.equal(rows[1][idxFecha], '2026-07-03'); /* S reserva 1 */
  assert.equal(rows[2][idxFecha], '2026-08-10'); /* E reserva 2 */
  assert.equal(rows[3][idxFecha], '2026-08-12'); /* S reserva 2 */
});

/* ---- tolerancia de nombres de campos de la reserva ---- */

test('reconoce fechas con nombres alternos (OTASync date_arrival/date_departure)', () => {
  const cols = sire.columnNames();
  const idxFecha = cols.indexOf('fecha_movimiento');
  const rows = sire.movementRows(
    HUESPED_CO,
    { date_arrival: '2026-09-05 14:00', date_departure: '2026-09-08' },
    { config: CFG }
  );
  assert.equal(rows[0].split('\t')[idxFecha], '2026-09-05'); /* recorta la hora */
  assert.equal(rows[1].split('\t')[idxFecha], '2026-09-08');
});

/* ---- header opcional ---- */

test('buildSireFile con header antepone los nombres de columna', () => {
  const result = sire.buildSireFile(
    { reserva: RESERVA, huespedes: [HUESPED_CO] },
    { config: CFG, header: true }
  );
  const lines = result.content.split('\r\n');
  assert.equal(lines[0], sire.columnNames().join('\t'));
  assert.equal(lines.length, 3); /* header + E + S */
});

/* ---- isConfigured / normalizeDelimiter (config real vía env) ---- */

test('isConfigured es false sin SIRE_ENABLED', () => {
  delete process.env.SIRE_ENABLED;
  delete process.env.SIRE_HOTEL_CODE;
  delete process.env.SIRE_CITY_CODE;
  assert.equal(sire.isConfigured(), false);
});

test('isConfigured requiere flag + códigos mínimos', () => {
  process.env.SIRE_ENABLED = 'true';
  process.env.SIRE_HOTEL_CODE = 'H1';
  delete process.env.SIRE_CITY_CODE;
  try {
    assert.equal(sire.isConfigured(), false); /* falta city code */
    process.env.SIRE_CITY_CODE = '17001';
    assert.equal(sire.isConfigured(), true);
  } finally {
    delete process.env.SIRE_ENABLED;
    delete process.env.SIRE_HOTEL_CODE;
    delete process.env.SIRE_CITY_CODE;
  }
});

test('la generación pura funciona aunque SIRE esté deshabilitado', () => {
  delete process.env.SIRE_ENABLED;
  const result = sire.buildSireFile(
    { reserva: RESERVA, huespedes: [HUESPED_CO] },
    { config: CFG }
  );
  assert.equal(result.ok, true);
  assert.equal(result.count, 2);
});

test('normalizeDelimiter traduce la secuencia literal \\t y default TAB', () => {
  assert.equal(sire.normalizeDelimiter('\\t'), '\t');
  assert.equal(sire.normalizeDelimiter(undefined), '\t');
  assert.equal(sire.normalizeDelimiter(''), '\t');
  assert.equal(sire.normalizeDelimiter('|'), '|');
});

test('buildSireFile nunca lanza y devuelve estructura vacía sin huéspedes', () => {
  const result = sire.buildSireFile({ reserva: RESERVA, huespedes: [] }, { config: CFG });
  assert.equal(result.ok, true);
  assert.equal(result.count, 0);
  assert.equal(result.content, '');
});
