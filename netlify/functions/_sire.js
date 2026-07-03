require('./_env');
const { getSync } = require('./_settings'); // SIRE_ENABLED gestionable desde /admin

/*
 * _sire.js — generador del ARCHIVO PLANO de SIRE (Sistema de Información y
 * Registro de Extranjeros, Migración Colombia).
 *
 * Por qué existe (y qué NO hace):
 *   SIRE **NO tiene API pública**. El reporte se hace subiendo un archivo de
 *   texto (.txt) al portal de Migración Colombia. Este módulo SOLO arma ese
 *   texto a partir de las reservas y sus huéspedes — NO sube nada, NO llama a
 *   ninguna red. La subida al portal la hace una persona a mano (o, en el
 *   futuro, un job aparte). Por eso es una utilidad "pura": la generación del
 *   texto se puede probar siempre, con o sin credenciales.
 *
 * Qué genera:
 *   Por CADA huésped de una reserva, dos filas:
 *     - una de movimiento "E" (Entrada)  con la fecha de check-in
 *     - una de movimiento "S" (Salida)   con la fecha de check-out
 *   Cada fila lleva: código de establecimiento, código de ciudad, tipo de
 *   documento, número de documento, código de nacionalidad, apellidos, nombres,
 *   tipo de movimiento (E/S), fecha del movimiento, código de lugar de
 *   procedencia, código de lugar de destino, y fecha de nacimiento.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠️  TODO(SIRE): CONFIRMAR el FORMATO, el ORDEN y las COLUMNAS EXACTAS con  │
 * │ el portal de Migración Colombia ANTES de usar esto en producción. El      │
 * │ delimitador y el orden de las columnas de abajo son la mejor referencia   │
 * │ conocida hoy, PERO NO están confirmados contra el portal real. Ambos son  │
 * │ configurables (SIRE_DELIMITER + la lista COLUMNS) justo para poder        │
 * │ ajustarlos sin reescribir la lógica. Verificar también: formato de fecha  │
 * │ (¿YYYY-MM-DD o AAAAMMDD o DD/MM/AAAA?), catálogos de códigos de ciudad /  │
 * │ nacionalidad / lugar, y si el archivo lleva encabezado o pie.             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Mock-safe / best-effort: nada aquí lanza en la generación pura. isConfigured()
 * solo dice si el módulo está habilitado y con los códigos mínimos cargados.
 *
 * Config (env; NINGUNO es secreto — pueden vivir en Netlify o en el panel):
 *   SIRE_HOTEL_CODE     código de establecimiento asignado por Migración
 *   SIRE_CITY_CODE      código DANE/Migración de la ciudad del hotel (Manizales)
 *   SIRE_HOTEL_ADDRESS  dirección del establecimiento (por si el portal la pide)
 *   SIRE_DELIMITER      separador de columnas (default TAB '\t')
 *   SIRE_ENABLED        'true' para habilitar (isConfigured); la generación pura
 *                       funciona igual con esto apagado (para pruebas/preview)
 */

const flagOn = v => String(v == null ? '' : v).trim().toLowerCase() === 'true';

function sireConfig() {
  return {
    hotelCode: (process.env.SIRE_HOTEL_CODE || '').trim(),
    cityCode: (process.env.SIRE_CITY_CODE || '').trim(),
    hotelAddress: (process.env.SIRE_HOTEL_ADDRESS || '').trim(),
    /* Default TAB. Se lee crudo para poder aceptar '\t' escrito literalmente en
       una env var (Netlify guarda "\t" como texto, no como tabulación real). */
    delimiter: normalizeDelimiter(process.env.SIRE_DELIMITER),
    enabled: flagOn(getSync('SIRE_ENABLED', ''))
  };
}

/* Convierte un delimitador de env en el carácter real. Acepta la secuencia
   literal "\t" (2 caracteres) y la traduce a una tabulación. Default: TAB. */
function normalizeDelimiter(raw) {
  if (raw === undefined || raw === null || raw === '') return '\t';
  const s = String(raw);
  if (s === '\\t') return '\t';
  if (s === '\\n') return '\n';
  return s;
}

/* Habilitado = flag encendido + los códigos mínimos cargados. La GENERACIÓN
   pura NO depende de esto (se puede probar/previsualizar siempre). */
function isConfigured() {
  const c = sireConfig();
  return Boolean(c.enabled && c.hotelCode && c.cityCode);
}

/* ---- helpers de formato de campos ---- */

/* Limpia un valor para una celda del archivo plano: sin el delimitador ni
   saltos de línea (que romperían columnas/filas), recortado. */
function cell(value, delimiter) {
  let s = value == null ? '' : String(value);
  s = s.replace(/[\r\n]+/g, ' ');
  if (delimiter) s = s.split(delimiter).join(' ');
  return s.trim();
}

/* Fecha → YYYY-MM-DD (recorta cualquier componente de hora). Acepta string ISO
   o Date. Devuelve '' si no se puede parsear.
   TODO(SIRE): confirmar si el portal quiere este formato u otro. */
function fmtDate(value) {
  if (!value) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/* Toma la primera clave presente de una lista de alias (tolera distintas formas
   de nombrar el mismo campo en reservas/huéspedes de distintas fuentes). */
function pick(obj, keys, fallback = '') {
  if (!obj) return fallback;
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && String(v) !== '') return v;
  }
  return fallback;
}

/* Fechas de la reserva, tolerando los distintos nombres que usan las fuentes
   (guest-checkin: checkIn/checkOut · OTASync crudo: date_arrival/date_departure
   · OTASync normalizado: dateArrival/dateDeparture · quotes: checkin/checkout). */
function reservationDates(reserva) {
  return {
    checkIn: fmtDate(pick(reserva, ['checkIn', 'checkin', 'dateArrival', 'date_arrival', 'arrival'])),
    checkOut: fmtDate(pick(reserva, ['checkOut', 'checkout', 'dateDeparture', 'date_departure', 'departure']))
  };
}

/* ORDEN EXACTO de columnas por fila. Cada entrada resuelve su valor a partir del
   huésped (h), la reserva (r) y la config (cfg).
   ⚠️ TODO(SIRE): confirmar este orden/estas columnas contra el portal real. */
const COLUMNS = [
  { key: 'codigo_establecimiento', get: (h, r, cfg) => cfg.hotelCode },
  { key: 'codigo_ciudad',          get: (h, r, cfg) => cfg.cityCode },
  { key: 'tipo_documento',         get: h => pick(h, ['documentType', 'tipoDocumento', 'tipo_documento']) },
  { key: 'numero_documento',       get: h => pick(h, ['documentNumber', 'numeroDocumento', 'numero_documento', 'document']) },
  { key: 'codigo_nacionalidad',    get: h => pick(h, ['nationalityCode', 'codigoNacionalidad', 'codigo_nacionalidad', 'nationality', 'nacionalidad']) },
  { key: 'apellidos',              get: h => pick(h, ['lastName', 'apellidos', 'last_name', 'surname']) },
  { key: 'nombres',                get: h => pick(h, ['firstName', 'nombres', 'first_name', 'name']) },
  { key: 'tipo_movimiento',        get: (h, r, cfg, ctx) => ctx.movement },
  { key: 'fecha_movimiento',       get: (h, r, cfg, ctx) => ctx.movementDate },
  { key: 'codigo_procedencia',     get: h => pick(h, ['originCode', 'codigoProcedencia', 'codigo_procedencia', 'originCity', 'originCountry', 'procedencia']) },
  { key: 'codigo_destino',         get: h => pick(h, ['destinationCode', 'codigoDestino', 'codigo_destino', 'destination', 'destino']) },
  { key: 'fecha_nacimiento',       get: h => fmtDate(pick(h, ['birthDate', 'fechaNacimiento', 'fecha_nacimiento', 'dateOfBirth'])) }
];

/* Nombres de columna en orden (útil para encabezados de previsualización). */
function columnNames() {
  return COLUMNS.map(c => c.key);
}

/* Arma UNA fila (string ya delimitada) para un huésped + reserva + movimiento. */
function buildRow(huesped, reserva, movement, movementDate, cfg) {
  const ctx = { movement, movementDate };
  return COLUMNS
    .map(col => cell(col.get(huesped, reserva, cfg, ctx), cfg.delimiter))
    .join(cfg.delimiter);
}

/* Devuelve las DOS filas de un huésped: [ E (entrada/check-in), S (salida/
   check-out) ]. Cada fila es un string ya delimitado.
   opts.config permite inyectar config en tests (sin tocar process.env). */
function movementRows(huesped, reserva, opts = {}) {
  const cfg = opts.config || sireConfig();
  const { checkIn, checkOut } = reservationDates(reserva || {});
  const entrada = buildRow(huesped, reserva, 'E', checkIn, cfg);
  const salida = buildRow(huesped, reserva, 'S', checkOut, cfg);
  return [entrada, salida];
}

/* Normaliza la entrada a una lista de { reserva, huespedes }.
   Acepta:
     - { reserva, huespedes }                (una reserva)
     - { reservas: [{ reserva|..., huespedes }] }  (varias)
     - { reservas: [...], huespedes }        (huespedes global aplicado a todas
                                              las reservas que no traigan los suyos) */
function normalizeInput(input = {}) {
  const globalHuespedes = Array.isArray(input.huespedes) ? input.huespedes : null;

  if (Array.isArray(input.reservas)) {
    return input.reservas.map(item => {
      /* cada item puede ser { reserva, huespedes } o la reserva misma */
      const reserva = item && item.reserva ? item.reserva : item;
      const huespedes = Array.isArray(item && item.huespedes)
        ? item.huespedes
        : (globalHuespedes || []);
      return { reserva: reserva || {}, huespedes };
    });
  }

  const reserva = input.reserva || {};
  return [{ reserva, huespedes: globalHuespedes || [] }];
}

/* Genera el archivo plano completo.
 * Entrada: { reserva, huespedes } o { reservas: [...] } (ver normalizeInput).
 * opts:
 *   - config: inyecta config (tests / preview sin env)
 *   - header: 'true' para anteponer una fila de encabezado con columnNames()
 *             (⚠️ TODO(SIRE): el portal probablemente NO quiere encabezado;
 *              default OFF; útil solo para revisar el archivo a ojo)
 *   - eol:    fin de línea (default '\r\n', típico de archivos planos Windows)
 * Devuelve { ok, rows, count, content, isConfigured, isMock? }. Nunca lanza. */
function buildSireFile(input = {}, opts = {}) {
  const cfg = opts.config || sireConfig();
  const eol = opts.eol !== undefined ? opts.eol : '\r\n';
  try {
    const groups = normalizeInput(input);
    const rows = [];
    for (const { reserva, huespedes } of groups) {
      for (const huesped of huespedes) {
        rows.push(...movementRows(huesped, reserva, { config: cfg }));
      }
    }
    const lines = opts.header ? [columnNames().join(cfg.delimiter), ...rows] : rows;
    return {
      ok: true,
      rows,
      count: rows.length,
      content: lines.join(eol),
      configured: Boolean(cfg.enabled && cfg.hotelCode && cfg.cityCode)
    };
  } catch (err) {
    /* best-effort: nunca romper a quien llame */
    return { ok: false, rows: [], count: 0, content: '', error: (err && err.message) || 'error' };
  }
}

module.exports = {
  isConfigured,
  buildSireFile,
  movementRows,
  columnNames,
  sireConfig,
  fmtDate,
  normalizeDelimiter,
  /* expuesto para tests / usos avanzados */
  _internal: { buildRow, normalizeInput, reservationDates, cell, pick, COLUMNS }
};
