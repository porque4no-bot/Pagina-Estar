require('./_env');
const crypto = require('crypto');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limit');
const settings = require('./_settings');
const sire = require('./_sire');
const catalogMod = require('./_sire-catalog');

/*
 * sire-export — exportación del archivo plano de SIRE (Migración Colombia) para
 * el subidor automático que corre en el VPS del grupo (tools/sire-uploader/).
 *
 * Fuente: NUESTRO check-in en línea (store `guest-checkins`, cifrado con la
 * bóveda; la API de Kunas no trae documento ni nacionalidad). Solo huéspedes
 * EXTRANJEROS. Por cada uno: fila E (entrada) en la fecha de check-in y fila S
 * (salida) en la de check-out, cuando esa fecha cae en el rango pedido y ya
 * ocurrió (nunca se reporta un movimiento futuro).
 *
 *   GET  /api/sire-export?desde=YYYY-MM-DD&hasta=YYYY-MM-DD[&incluir_reportados=1]
 *        → { listo, rango, formato, conteos, filas, txt, avisos, configuracion }
 *        Fechas en hora de Bogotá. Default: los 7 días que terminan AYER.
 *        `filas[i]` describe la línea i del `txt` (mismo orden) con un id opaco,
 *        el código de reserva, el índice del huésped (1 = primero), el
 *        movimiento y su fecha — sin datos personales.
 *        `avisos` = huéspedes extranjeros con campos faltantes, identificados
 *        SOLO por código de reserva e índice de huésped.
 *   POST { accion: 'ack', ids | filas, lote }   → marca movimientos reportados
 *        (store `sire-reports`) para no reportarlos dos veces.
 *   POST { accion: 'desmarcar', ids }           → deshace un ack equivocado.
 *
 * Seguridad:
 *   - Bearer comparado en tiempo constante contra SIRE_EXPORT_TOKEN (SECRETO,
 *     solo en Netlify, NO gestionable desde el panel). Sin token configurado (o
 *     con uno corto) la función está APAGADA (503). Nunca por query string.
 *   - Rate-limit por IP. Respeta SIRE_ENABLED (gestionable vía _settings).
 *   - Ley 1581: los logs llevan SOLO conteos; el txt solo viaja en la respuesta
 *     autenticada; `sire-reports` guarda ids opacos + código de reserva.
 */

const CHECKIN_STORE = 'guest-checkins';
const REPORTS_STORE = 'sire-reports';
const DAY_MS = 24 * 60 * 60 * 1000;
const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000; /* UTC-5 fijo (Colombia no tiene horario de verano) */
const DEFAULT_WINDOW_DAYS = 7;
const MAX_RANGE_DAYS = 62;
const DEFAULT_LOOKBACK_DAYS = 190;
const MIN_TOKEN_LENGTH = 32;
const MAX_ACK_IDS = 1000;
const READ_BATCH = 10;
const EOL = '\r\n'; /* TODO(SIRE): confirmar fin de línea esperado por el portal */
const ID_RE = /^[a-f0-9]{24}$/;
const REF_RE = /^[A-Za-z0-9._-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const defaultDeps = {
  guestStore: (name, consistency) => require('./_guest-app').guestStore(name, consistency),
  unprotectRecord: stored => require('./_guest-app').unprotectRecord(stored),
  checkRateLimit,
  flag: key => settings.flag(key),
  preload: () => settings.preload(),
  now: () => Date.now()
};
let deps = { ...defaultDeps };

/* ---------- respuestas ---------- */

function respond(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders
    },
    body: JSON.stringify(body)
  };
}

/* ---------- auth ---------- */

function bearerFromEvent(event) {
  const headers = (event && event.headers) || {};
  const raw = headers.authorization || headers.Authorization || '';
  const m = /^Bearer\s+(\S+)\s*$/i.exec(String(raw).trim());
  return m ? m[1] : '';
}

/* Comparación en tiempo constante: se comparan los SHA-256 (misma longitud
   siempre), así ni la longitud ni el contenido del token se filtran por tiempo. */
function tokenMatches(provided, expected) {
  const a = crypto.createHash('sha256').update(String(provided || ''), 'utf8').digest();
  const b = crypto.createHash('sha256').update(String(expected || ''), 'utf8').digest();
  return crypto.timingSafeEqual(a, b) && Boolean(provided);
}

function configuredToken() {
  /* SECRETO: process.env directo, jamás _settings (no es gestionable). */
  const t = String(process.env.SIRE_EXPORT_TOKEN || '').trim();
  return t.length >= MIN_TOKEN_LENGTH ? t : '';
}

/* ---------- fechas (hora Bogotá) ---------- */

function bogotaDate(ms) {
  return new Date(ms - BOGOTA_OFFSET_MS).toISOString().slice(0, 10);
}

function isIsoDate(s) {
  if (!DATE_RE.test(String(s || ''))) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Date(d.getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/* Rango pedido → { desde, hasta, hoy } validado, o { error }. */
function resolveRange(query, nowMs) {
  const hoy = bogotaDate(nowMs);
  const q = query || {};
  let hasta = q.hasta ? String(q.hasta).trim() : addDays(hoy, -1);
  let desde = q.desde ? String(q.desde).trim() : addDays(hasta, -(DEFAULT_WINDOW_DAYS - 1));
  if (!isIsoDate(desde) || !isIsoDate(hasta)) return { error: 'Fechas inválidas: usa desde/hasta en formato YYYY-MM-DD.' };
  if (desde > hasta) return { error: '"desde" no puede ser posterior a "hasta".' };
  if (daysBetween(desde, hasta) + 1 > MAX_RANGE_DAYS) return { error: `El rango máximo es de ${MAX_RANGE_DAYS} días.` };
  return { desde, hasta, hoy };
}

function lookbackDays() {
  const n = Number.parseInt(process.env.SIRE_EXPORT_LOOKBACK_DAYS || '', 10);
  if (!Number.isFinite(n)) return DEFAULT_LOOKBACK_DAYS;
  return Math.min(730, Math.max(7, n));
}

/* CHK-<ms>-XXXX → ms (como purge-guest-data). null = no fechable. */
function timestampFromKey(key) {
  const m = String(key || '').match(/^[A-Z]+-(\d{13})/);
  if (!m) return null;
  const ms = Number.parseInt(m[1], 10);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

/* ---------- ids de movimiento ---------- */

/* Id opaco y estable de un movimiento: misma reserva + mismo documento + mismo
   tipo de movimiento ⇒ mismo id (aunque el huésped re-envíe el check-in o
   cambie el orden de los acompañantes). No contiene datos personales en claro. */
function movementId(bookingCode, docType, docNumber, movement) {
  return crypto.createHash('sha256')
    .update(['sire-v1', bookingCode, docType, docNumber, movement].join('|'), 'utf8')
    .digest('hex')
    .slice(0, 24);
}

/* ---------- núcleo puro: registros de check-in → archivo ---------- */

function delimiterLabel(d) {
  if (d === '\t') return 'TAB';
  return d;
}

/* El check-in más reciente por reserva (un huésped puede re-enviarlo). */
function latestPerBooking(records, conteos) {
  const latest = new Map();
  for (const rec of records) {
    if (!rec || typeof rec !== 'object') continue;
    if (rec.type && rec.type !== 'guest_checkin') continue;
    const ref = String(rec.bookingCode || '').trim();
    if (!ref) { conteos.sin_reserva += 1; continue; }
    const prev = latest.get(ref);
    if (!prev) latest.set(ref, rec);
    else {
      conteos.reenvios_ignorados += 1;
      if (String(rec.createdAt || '') > String(prev.createdAt || '')) latest.set(ref, rec);
    }
  }
  return latest;
}

function guestsOf(rec) {
  if (Array.isArray(rec.guests) && rec.guests.length) {
    return rec.guests.map((g, i) => ({
      guest: (g && g.guest) || {},
      index: Number.isInteger(g && g.guestIndex) ? g.guestIndex : i
    }));
  }
  return rec.guest ? [{ guest: rec.guest, index: 0 }] : [];
}

/* Huésped del check-in → objeto que entiende _sire (solo CÓDIGOS, nunca el
   texto libre: así un país desconocido queda VACÍO y sale como aviso en vez de
   colarse como texto en una columna de código). */
function toSireGuest(g, catalog) {
  const country = catalogMod.resolveCountry(g.nationality, catalog);
  const origin = catalogMod.resolvePlace({ city: g.originCity, country: g.originCountry }, catalog) ||
    catalogMod.resolvePlace({ city: g.residenceCity, country: g.residenceCountry }, catalog);
  return {
    documentType: catalogMod.docTypeCode(g.documentType, catalog),
    documentNumber: catalogMod.normalizeDocNumber(g.documentNumber),
    nationalityCode: country ? country.code : '',
    lastName: catalogMod.sireText(g.lastName, catalog),
    firstName: catalogMod.sireText(g.firstName, catalog),
    originCode: origin,
    destinationCode: catalogMod.resolvePlaceText(g.destination, catalog),
    birthDate: sire.fmtDate(g.birthDate)
  };
}

/* Config efectiva del archivo: _sire (env/panel) + ciudad por defecto del
   catálogo. Devuelve también lo que falta/está mal para no subir a ciegas. */
function exportConfig(catalog) {
  const base = sire.sireConfig();
  const config = { ...base, cityCode: base.cityCode || catalog.hotelCity };
  const faltante = [];
  if (!config.hotelCode) faltante.push('SIRE_HOTEL_CODE');
  const errores = [...catalog.errors];
  if (base.columnsError) errores.push(base.columnsError);
  return { config, faltante, errores };
}

/**
 * Arma la exportación a partir de registros de check-in YA descifrados.
 * opts: { desde, hasta, hoy, reported:Set, includeReported, config, catalog,
 *         faltante, errores }
 */
function buildExport(records, opts) {
  const { desde, hasta, hoy } = opts;
  const catalog = opts.catalog || catalogMod.loadCatalog();
  const config = opts.config;
  const reported = opts.reported || new Set();
  const faltante = opts.faltante || [];
  const errores = opts.errores || [];
  const upper = hasta < hoy ? hasta : hoy;
  const conteos = {
    checkins: records.length,
    reservas: 0,
    reenvios_ignorados: 0,
    sin_reserva: 0,
    huespedes: 0,
    nacionales: 0,
    extranjeros: 0,
    movimientos_listos: 0,
    entradas: 0,
    salidas: 0,
    ya_reportados: 0,
    incompletos: 0,
    futuros: 0,
    duplicados: 0,
    ilegibles: opts.ilegibles || 0
  };

  const latest = latestPerBooking(records, conteos);
  conteos.reservas = latest.size;

  /* Columnas de nivel config (código del hotel) se reportan una sola vez en
     `configuracion.faltante`, no en cada aviso. */
  const configLevel = new Set(faltante.includes('SIRE_HOTEL_CODE') ? ['codigo_establecimiento'] : []);

  const candidates = [];
  const avisosMap = new Map();
  const addAviso = (ref, huesped, movimiento, faltan) => {
    const key = `${ref}#${huesped}`;
    const a = avisosMap.get(key) || { ref, huesped, movimientos: [], faltan: [] };
    if (movimiento && !a.movimientos.includes(movimiento)) a.movimientos.push(movimiento);
    faltan.forEach(f => { if (!a.faltan.includes(f)) a.faltan.push(f); });
    avisosMap.set(key, a);
  };

  for (const [ref, rec] of latest) {
    const reserva = rec.reservation || {};
    const { checkIn, checkOut } = sire.reservationDates(reserva);
    const createdDay = rec.createdAt ? bogotaDate(Date.parse(rec.createdAt) || 0) : '';
    for (const { guest, index } of guestsOf(rec)) {
      conteos.huespedes += 1;
      if (!catalogMod.isForeignNationality(guest.nationality, catalog)) {
        conteos.nacionales += 1;
        continue;
      }
      conteos.extranjeros += 1;
      const huesped = index + 1;
      if (!checkIn && !checkOut) {
        /* Check-in de antes de que el token llevara fechas: no se puede ubicar
           en el calendario. Se avisa solo si se hizo dentro del rango. */
        if (createdDay && createdDay >= desde && createdDay <= upper) {
          addAviso(ref, huesped, '', ['fechas_reserva']);
          conteos.incompletos += 1;
        }
        continue;
      }
      const h = toSireGuest(guest, catalog);
      for (const movimiento of ['E', 'S']) {
        const fecha = movimiento === 'E' ? checkIn : checkOut;
        if (!fecha) {
          if ((movimiento === 'E' ? checkOut : checkIn) >= desde) {
            addAviso(ref, huesped, movimiento, ['fecha_movimiento']);
            conteos.incompletos += 1;
          }
          continue;
        }
        if (fecha < desde || fecha > hasta) continue;
        if (fecha > upper) { conteos.futuros += 1; continue; }
        const id = movementId(ref, h.documentType, h.documentNumber, movimiento);
        const yaReportado = reported.has(id);
        if (yaReportado && !opts.includeReported) { conteos.ya_reportados += 1; continue; }
        const { row, missing } = sire.movementRow(h, reserva, movimiento, { config });
        const faltan = missing.filter(k => !configLevel.has(k));
        if (faltan.length) {
          addAviso(ref, huesped, movimiento, faltan);
          conteos.incompletos += 1;
          continue;
        }
        candidates.push({ id, ref, huesped, movimiento, fecha, row, reportado: yaReportado });
      }
    }
  }

  /* Orden estable: fecha, reserva, huésped, E antes que S. */
  candidates.sort((a, b) =>
    (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0) ||
    (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0) ||
    (a.huesped - b.huesped) ||
    (a.movimiento < b.movimiento ? -1 : a.movimiento > b.movimiento ? 1 : 0));

  const seen = new Set();
  const filas = [];
  const lines = [];
  for (const c of candidates) {
    if (seen.has(c.id)) { conteos.duplicados += 1; continue; }
    seen.add(c.id);
    const fila = { id: c.id, ref: c.ref, huesped: c.huesped, movimiento: c.movimiento, fecha: c.fecha };
    if (c.reportado) fila.reportado = true;
    filas.push(fila);
    lines.push(c.row);
    if (c.movimiento === 'E') conteos.entradas += 1; else conteos.salidas += 1;
  }
  conteos.movimientos_listos = filas.length;

  const listo = faltante.length === 0 && errores.length === 0;
  const avisos = [...avisosMap.values()].sort((a, b) =>
    (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0) || a.huesped - b.huesped);

  return {
    ok: true,
    listo,
    rango: { desde, hasta, hoy },
    formato: {
      columnas: sire.columnNames(config),
      delimitador: delimiterLabel(config.delimiter),
      fecha: config.dateFormat,
      finDeLinea: 'CRLF',
      encabezado: false
    },
    conteos,
    /* Sin config completa NO se entrega archivo (nunca subir a medias). */
    filas: listo ? filas : [],
    txt: listo ? lines.join(EOL) : '',
    avisos,
    configuracion: { faltante, errores }
  };
}

/* ---------- E/S con Blobs ---------- */

async function loadCheckinRecords(minMs) {
  const store = deps.guestStore(CHECKIN_STORE);
  const listing = await store.list();
  const keys = ((listing && listing.blobs) || [])
    .map(b => b.key)
    .filter(k => {
      const ms = timestampFromKey(k);
      return ms === null || ms >= minMs; /* sin fecha en la clave: se lee (no perder a nadie) */
    });
  const records = [];
  let ilegibles = 0;
  for (let i = 0; i < keys.length; i += READ_BATCH) {
    const batch = keys.slice(i, i + READ_BATCH);
    const results = await Promise.all(batch.map(async key => {
      try {
        const stored = await store.get(key, { type: 'json' });
        if (!stored) return null;
        return deps.unprotectRecord(stored);
      } catch (e) {
        ilegibles += 1;
        return null;
      }
    }));
    results.forEach(r => { if (r) records.push(r); });
  }
  return { records, ilegibles };
}

async function loadReportedIds() {
  const store = deps.guestStore(REPORTS_STORE);
  const listing = await store.list();
  return new Set(((listing && listing.blobs) || []).map(b => b.key));
}

async function handleExport(event) {
  const q = event.queryStringParameters || {};
  const range = resolveRange(q, deps.now());
  if (range.error) return respond(400, { error: range.error });
  const includeReported = ['1', 'true', 'si', 'sí'].includes(String(q.incluir_reportados || '').toLowerCase());

  const catalog = catalogMod.loadCatalog();
  const { config, faltante, errores } = exportConfig(catalog);
  const minMs = Date.parse(`${range.desde}T00:00:00Z`) + BOGOTA_OFFSET_MS - lookbackDays() * DAY_MS;

  let reported;
  try {
    reported = await loadReportedIds();
  } catch (e) {
    /* Sin el registro de lo ya reportado se arriesga reportar dos veces: cerrar. */
    console.error('[sire-export] no se pudo leer sire-reports');
    return respond(503, { error: 'No se pudo leer el registro de movimientos ya reportados. Intenta más tarde.' });
  }

  let loaded;
  try {
    loaded = await loadCheckinRecords(minMs);
  } catch (e) {
    console.error('[sire-export] no se pudo listar guest-checkins');
    return respond(503, { error: 'No se pudieron leer los check-ins. Intenta más tarde.' });
  }

  const result = buildExport(loaded.records, {
    ...range, reported, includeReported, config, catalog, faltante, errores, ilegibles: loaded.ilegibles
  });
  result.generadoEn = new Date(deps.now()).toISOString();
  const c = result.conteos;
  /* Ley 1581: SOLO conteos en el log. */
  console.log(`[sire-export] rango=${range.desde}..${range.hasta} listo=${result.listo} checkins=${c.checkins} extranjeros=${c.extranjeros} movimientos=${c.movimientos_listos} ya_reportados=${c.ya_reportados} incompletos=${c.incompletos} ilegibles=${c.ilegibles}`);
  return respond(200, result);
}

/* ---------- ack ---------- */

function cleanLote(value) {
  return String(value == null ? '' : value).replace(/[^A-Za-z0-9 :._-]/g, '').trim().slice(0, 80);
}

function parseBody(event) {
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
  if (Buffer.byteLength(raw, 'utf8') > 256 * 1024) return { error: 'Cuerpo demasiado grande.', status: 413 };
  try {
    const body = JSON.parse(raw || '{}');
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'JSON inválido.', status: 400 };
    return { body };
  } catch (e) {
    return { error: 'JSON inválido.', status: 400 };
  }
}

/* Normaliza la lista de movimientos a marcar: acepta `ids` (strings) o `filas`
   ({id, ref, movimiento, fecha}). Lo que no cumple el formato se cuenta como
   inválido y se ignora (nunca se guarda texto arbitrario). */
function normalizeAckEntries(body) {
  const source = Array.isArray(body.filas) ? body.filas : Array.isArray(body.ids) ? body.ids : [];
  const entries = [];
  let invalidos = 0;
  const seen = new Set();
  for (const item of source) {
    const obj = typeof item === 'string' ? { id: item } : (item && typeof item === 'object' ? item : {});
    const id = String(obj.id || '').trim().toLowerCase();
    if (!ID_RE.test(id)) { invalidos += 1; continue; }
    if (seen.has(id)) continue;
    seen.add(id);
    const entry = { id };
    if (obj.ref && REF_RE.test(String(obj.ref))) entry.ref = String(obj.ref);
    if (obj.movimiento === 'E' || obj.movimiento === 'S') entry.movimiento = obj.movimiento;
    if (obj.fecha && isIsoDate(String(obj.fecha))) entry.fecha = String(obj.fecha);
    entries.push(entry);
  }
  return { entries, invalidos, total: source.length };
}

async function handleAck(event) {
  const parsed = parseBody(event);
  if (parsed.error) return respond(parsed.status, { error: parsed.error });
  const body = parsed.body;
  const accion = String(body.accion || body.action || '').trim().toLowerCase();
  if (!['ack', 'desmarcar'].includes(accion)) {
    return respond(400, { error: 'accion debe ser "ack" o "desmarcar".' });
  }
  const { entries, invalidos, total } = normalizeAckEntries(body);
  if (total > MAX_ACK_IDS) return respond(413, { error: `Máximo ${MAX_ACK_IDS} movimientos por solicitud.` });
  if (!entries.length) return respond(400, { error: 'No llegó ningún id válido.', invalidos });

  const store = deps.guestStore(REPORTS_STORE);
  const lote = cleanLote(body.lote);
  const nowIso = new Date(deps.now()).toISOString();
  let marcados = 0;
  let yaEstaban = 0;
  let desmarcados = 0;
  let errores = 0;

  for (let i = 0; i < entries.length; i += READ_BATCH) {
    const batch = entries.slice(i, i + READ_BATCH);
    await Promise.all(batch.map(async entry => {
      try {
        if (accion === 'desmarcar') {
          await store.delete(entry.id);
          desmarcados += 1;
          return;
        }
        const existing = await store.get(entry.id);
        if (existing) { yaEstaban += 1; return; }
        await store.set(entry.id, JSON.stringify({
          v: 1,
          reportadoEn: nowIso,
          lote: lote || null,
          ref: entry.ref || null,
          movimiento: entry.movimiento || null,
          fecha: entry.fecha || null
        }));
        marcados += 1;
      } catch (e) {
        errores += 1;
      }
    }));
  }

  console.log(`[sire-export] ${accion}: marcados=${marcados} ya_estaban=${yaEstaban} desmarcados=${desmarcados} invalidos=${invalidos} errores=${errores}`);
  const status = errores ? 502 : 200;
  return respond(status, { ok: errores === 0, accion, marcados, yaEstaban, desmarcados, invalidos, errores });
}

/* ---------- handler ---------- */

exports.handler = async event => {
  const method = String((event && event.httpMethod) || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    return respond(405, { error: 'Método no permitido.' }, { Allow: 'GET, POST' });
  }

  /* Apagada si no hay token (o es demasiado corto para ser seguro). */
  const expected = configuredToken();
  if (!expected) return respond(503, { error: 'La exportación SIRE no está configurada.' });

  const limit = await deps.checkRateLimit(event, { name: 'sire-export', limit: 20, windowMs: 15 * 60 * 1000 });
  if (!limit.ok) return rateLimitResponse({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, limit.retryAfter);

  if (!tokenMatches(bearerFromEvent(event), expected)) {
    return respond(401, { error: 'No autorizado.' }, { 'WWW-Authenticate': 'Bearer' });
  }

  await deps.preload();
  if (!(await deps.flag('SIRE_ENABLED'))) {
    return respond(503, { error: 'SIRE está apagado (SIRE_ENABLED).' });
  }

  try {
    return method === 'GET' ? await handleExport(event) : await handleAck(event);
  } catch (e) {
    /* Nunca el mensaje crudo: podría arrastrar datos de un registro. */
    console.error('[sire-export] error inesperado:', e && e.name ? e.name : 'Error');
    return respond(500, { error: 'Error interno.' });
  }
};

exports._test = {
  buildExport,
  exportConfig,
  resolveRange,
  movementId,
  tokenMatches,
  bearerFromEvent,
  timestampFromKey,
  normalizeAckEntries,
  toSireGuest,
  bogotaDate,
  setDeps(overrides) { deps = { ...defaultDeps, ...overrides }; },
  resetDeps() { deps = { ...defaultDeps }; },
  MIN_TOKEN_LENGTH,
  MAX_RANGE_DAYS
};
