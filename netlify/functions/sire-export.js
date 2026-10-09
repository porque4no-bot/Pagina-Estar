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
 *        `excluidos` = reservas que NO se exportan porque OTASync dice que no
 *        están vigentes (cancelada / no-show / no encontrada) o no se pudo
 *        comprobar; las fechas que se reportan son las de OTASync.
 *        `atrasados` = movimientos SIN reportar anteriores a `desde` (desde
 *        SIRE_REPORT_START): el subidor pide un rango que empiece en el más
 *        antiguo, así un bloqueo de más de 7 días no deja nada por fuera.
 *        Estadías largas: el índice `sire-pending-exits` mantiene a la vista el
 *        check-in de un extranjero hasta reportar su salida, aunque salga del
 *        lookback.
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
/* Índice de check-ins de extranjeros con SALIDA aún sin reportar (clave del
   check-in → { checkOut }). Sin datos personales. Existe para que una estadía
   larga cuyo check-in ya salió del lookback siga leyéndose hasta reportar la S. */
const PENDING_EXITS_STORE = 'sire-pending-exits';
const DAY_MS = 24 * 60 * 60 * 1000;
const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000; /* UTC-5 fijo (Colombia no tiene horario de verano) */
const DEFAULT_WINDOW_DAYS = 7;
const MAX_RANGE_DAYS = 62;
const DEFAULT_LOOKBACK_DAYS = 190;
const MIN_TOKEN_LENGTH = 32;
const MAX_ACK_IDS = 1000;
const MAX_VERIFY = 100;      /* reservas a comprobar en OTASync por pasada */
const VERIFY_BATCH = 5;
const MAX_ATRASADOS = 1000;
const PENDING_EXIT_MAX_AGE_DAYS = 400;
/* Estados de reserva de OTASync que cuentan como vigentes (igual que
   canCancel en _guest-app). Cualquier otro (cancelada, no-show, hold…) ⇒ no se
   reporta nada y se avisa. */
const ACTIVE_RESERVATION_STATUSES = new Set(['confirmed', 'pending', '']);
const READ_BATCH = 10;
const EOL = '\r\n'; /* TODO(SIRE): confirmar fin de línea esperado por el portal */
const ID_RE = /^[a-f0-9]{24}$/;
const REF_RE = /^[A-Za-z0-9._-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const defaultDeps = {
  guestStore: (name, consistency) => require('./_guest-app').guestStore(name, consistency),
  unprotectRecord: stored => require('./_guest-app').unprotectRecord(stored),
  checkRateLimit,
  hasOtasyncCreds: () => require('./_otasync').hasOtasyncCreds(),
  fetchReservation: ref => require('./_guest-app').fetchOtasyncReservation(ref),
  flag: key => settings.flag(key),
  getSetting: (key, fallback) => settings.get(key, fallback),
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

/* Id opaco y estable de un movimiento: misma reserva + mismo número de
   documento (normalizado) + mismo tipo de movimiento ⇒ mismo id (aunque el
   huésped re-envíe el check-in o cambie el orden de los acompañantes). NO
   depende de nada configurable: ni del código SIRE del tipo de documento
   (SIRE_DOC_TYPE_CODES_JSON se corrige tras el ensayo) ni del tipo elegido en el
   check-in (un huésped puede corregirlo al re-enviar). Si cambiara, los acks de
   `sire-reports` dejarían de coincidir y se reportaría dos veces. Sin datos
   personales en claro. */
function movementId(bookingCode, docNumber, movement) {
  return crypto.createHash('sha256')
    .update(['sire-v2', bookingCode, catalogMod.normalizeDocNumber(docNumber), movement].join('|'), 'utf8')
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

/* Movimientos posibles de los huéspedes EXTRANJEROS de un check-in, con su id
   estable y las fechas del token (sin verificar). Base común del índice de
   salidas pendientes, de la verificación en OTASync y de la exportación. */
function foreignGuestsOf(rec, catalog) {
  const out = [];
  for (const { guest, index } of guestsOf(rec)) {
    if (!catalogMod.isForeignNationality(guest.nationality, catalog)) continue;
    const ref = String(rec.bookingCode || '').trim();
    out.push({
      guest,
      index,
      ids: {
        E: movementId(ref, guest.documentNumber, 'E'),
        S: movementId(ref, guest.documentNumber, 'S')
      }
    });
  }
  return out;
}

/* Estado de una reserva en OTASync → { ok, checkIn, checkOut, motivo }.
   raw null = no existe; undefined/throw se trata fuera (sin_verificar). */
function verifiedStay(raw) {
  if (!raw) return { ok: false, motivo: 'reserva_no_encontrada' };
  const status = String(raw.status || '').trim().toLowerCase();
  if (!ACTIVE_RESERVATION_STATUSES.has(status)) return { ok: false, motivo: 'reserva_no_vigente', status };
  const { checkIn, checkOut } = sire.reservationDates(raw);
  return { ok: true, checkIn, checkOut };
}

/* Reservas que hay que comprobar en OTASync antes de exportar: las que tienen
   algún extranjero con un movimiento SIN reportar y cuyo huésped, según el
   token, ya llegó (E ≤ upper). Las más antiguas primero; tope MAX_VERIFY. */
function verificationTargets(records, opts) {
  const catalog = opts.catalog || catalogMod.loadCatalog();
  const reported = opts.reported || new Set();
  const upper = opts.hasta < opts.hoy ? opts.hasta : opts.hoy;
  const floor = opts.reportStart || '';
  const latest = latestPerBooking(records, { sin_reserva: 0, reenvios_ignorados: 0 });
  const targets = [];
  for (const [ref, rec] of latest) {
    const { checkIn, checkOut } = sire.reservationDates(rec.reservation || {});
    if (!checkIn || checkIn > upper) continue;
    if (floor && (checkOut || checkIn) < floor) continue;
    const pending = foreignGuestsOf(rec, catalog).some(g => !reported.has(g.ids.E) || !reported.has(g.ids.S));
    if (pending) targets.push({ ref, checkIn });
  }
  targets.sort((a, b) => (a.checkIn < b.checkIn ? -1 : a.checkIn > b.checkIn ? 1 : 0));
  return targets.map(t => t.ref);
}

/**
 * Arma la exportación a partir de registros de check-in YA descifrados.
 * opts: { desde, hasta, hoy, reported:Set, includeReported, config, catalog,
 *         faltante, errores, advertencias, reportStart, verified:Map|undefined,
 *         ilegibles }
 *   reportStart: fecha (YYYY-MM-DD) desde la que se reporta con este sistema;
 *     antes de ella no se emite nada (se reportó a mano) y no hay atrasados.
 *   verified: ref → verifiedStay(...) de OTASync. Si se pasa, una reserva sin
 *     verificar, cancelada o no encontrada NO se exporta (se avisa en
 *     `excluidos`) y se usan las fechas de OTASync (salida anticipada /
 *     extensión), no las del token del check-in.
 */
function buildExport(records, opts) {
  const { desde, hasta, hoy } = opts;
  const catalog = opts.catalog || catalogMod.loadCatalog();
  const config = opts.config;
  const reported = opts.reported || new Set();
  const faltante = opts.faltante || [];
  const errores = opts.errores || [];
  const advertencias = opts.advertencias || [];
  const reportStart = opts.reportStart || '';
  const verified = opts.verified instanceof Map ? opts.verified : null;
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
    antes_de_inicio: 0,
    no_vigentes: 0,
    sin_verificar: 0,
    atrasados: 0,
    ilegibles: opts.ilegibles || 0
  };

  const latest = latestPerBooking(records, conteos);
  conteos.reservas = latest.size;

  /* Columnas de nivel config (código del hotel) se reportan una sola vez en
     `configuracion.faltante`, no en cada aviso. */
  const configLevel = new Set(faltante.includes('SIRE_HOTEL_CODE') ? ['codigo_establecimiento'] : []);

  const candidates = [];
  const atrasados = [];
  const avisosMap = new Map();
  const excluidosMap = new Map();
  const addAviso = (ref, huesped, movimiento, faltan) => {
    const key = `${ref}#${huesped}`;
    const a = avisosMap.get(key) || { ref, huesped, movimientos: [], faltan: [] };
    if (movimiento && !a.movimientos.includes(movimiento)) a.movimientos.push(movimiento);
    faltan.forEach(f => { if (!a.faltan.includes(f)) a.faltan.push(f); });
    avisosMap.set(key, a);
  };
  const addExcluido = (ref, motivo, movimiento) => {
    const e = excluidosMap.get(ref) || { ref, motivo, movimientos: [] };
    if (movimiento && !e.movimientos.includes(movimiento)) e.movimientos.push(movimiento);
    excluidosMap.set(ref, e);
  };

  for (const [ref, rec] of latest) {
    const tokenDates = sire.reservationDates(rec.reservation || {});
    const v = verified ? (verified.get(ref) || { ok: false, motivo: 'reserva_sin_verificar' }) : null;
    const checkIn = v && v.ok ? (v.checkIn || tokenDates.checkIn) : tokenDates.checkIn;
    const checkOut = v && v.ok ? (v.checkOut || tokenDates.checkOut) : tokenDates.checkOut;
    const reserva = { ...(rec.reservation || {}), checkIn, checkOut };
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
        if (fecha > hasta) continue;
        if (fecha > upper) { conteos.futuros += 1; continue; }
        const inRange = fecha >= desde;
        if (reportStart && fecha < reportStart) {
          if (inRange) conteos.antes_de_inicio += 1;
          continue;
        }
        /* Id con el número de documento CRUDO del check-in (normalizado), nunca
           con un código de catálogo configurable. */
        const id = movementId(ref, guest.documentNumber, movimiento);
        const yaReportado = reported.has(id);
        if (!inRange) {
          /* Fuera de la ventana pedida: no va en el archivo, pero si sigue SIN
             reportar se devuelve en `atrasados` para que el subidor vuelva por
             él (nunca se pierde en silencio). */
          if (yaReportado || (v && !v.ok)) continue;
          const { missing } = sire.movementRow(h, reserva, movimiento, { config });
          if (missing.filter(k => !configLevel.has(k)).length) continue;
          atrasados.push({ id, fecha });
          continue;
        }
        if (yaReportado && !opts.includeReported) { conteos.ya_reportados += 1; continue; }
        if (v && !v.ok) {
          /* Cancelada, no-show, no encontrada o sin poder comprobarla: nada de
             reportar a Migración a alguien que quizá nunca se hospedó. */
          addExcluido(ref, v.motivo, movimiento);
          if (v.motivo === 'reserva_sin_verificar') conteos.sin_verificar += 1;
          else conteos.no_vigentes += 1;
          continue;
        }
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

  const atrasadosUnicos = [];
  const seenAtr = new Set();
  atrasados
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0))
    .forEach(a => { if (!seenAtr.has(a.id)) { seenAtr.add(a.id); atrasadosUnicos.push(a); } });
  conteos.atrasados = atrasadosUnicos.length;

  const listo = faltante.length === 0 && errores.length === 0;
  const avisos = [...avisosMap.values()].sort((a, b) =>
    (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0) || a.huesped - b.huesped);
  const excluidos = [...excluidosMap.values()].sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));

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
    /* Movimientos SIN reportar anteriores a `desde` (desde reportStart): el
       subidor pide un rango que empiece en el más antiguo. Solo ids + fecha. */
    atrasados: {
      cantidad: listo ? atrasadosUnicos.length : 0,
      masAntiguo: listo && atrasadosUnicos.length ? atrasadosUnicos[0].fecha : null,
      filas: listo ? atrasadosUnicos.slice(0, MAX_ATRASADOS) : []
    },
    avisos,
    excluidos,
    advertencias,
    configuracion: { faltante, errores, inicioReporte: reportStart || null }
  };
}

/* ---------- E/S con Blobs ---------- */

/* Lee los check-ins con clave dentro del lookback MÁS los del índice de
   salidas pendientes (estadías largas). Devuelve entradas { key, record }. */
async function loadCheckinRecords(minMs, forcedKeys = new Set()) {
  const store = deps.guestStore(CHECKIN_STORE);
  const listing = await store.list();
  const allKeys = ((listing && listing.blobs) || []).map(b => b.key);
  const present = new Set(allKeys);
  const keys = allKeys.filter(k => {
    if (forcedKeys.has(k)) return true;
    const ms = timestampFromKey(k);
    return ms === null || ms >= minMs; /* sin fecha en la clave: se lee (no perder a nadie) */
  });
  const entries = [];
  const unreadable = new Set();
  for (let i = 0; i < keys.length; i += READ_BATCH) {
    const batch = keys.slice(i, i + READ_BATCH);
    const results = await Promise.all(batch.map(async key => {
      try {
        const stored = await store.get(key, { type: 'json' });
        if (!stored) return null;
        return { key, record: deps.unprotectRecord(stored) };
      } catch (e) {
        unreadable.add(key);
        return null;
      }
    }));
    results.forEach(r => { if (r && r.record) entries.push(r); });
  }
  const missingForced = [...forcedKeys].filter(k => !present.has(k));
  return { entries, ilegibles: unreadable.size, unreadable, missingForced };
}

async function loadReportedIds() {
  const store = deps.guestStore(REPORTS_STORE);
  const listing = await store.list();
  return new Set(((listing && listing.blobs) || []).map(b => b.key));
}

async function loadPendingExitKeys() {
  const store = deps.guestStore(PENDING_EXITS_STORE);
  const listing = await store.list();
  return new Set(((listing && listing.blobs) || []).map(b => b.key));
}

/* Mantiene el índice de salidas pendientes: un check-in (el más reciente de su
   reserva) entra si tiene algún extranjero con la S sin reportar; sale cuando
   ya se reportaron todas, la reserva no está vigente, fue reemplazado por un
   re-envío o su salida es muy vieja. Best-effort: un fallo se reintenta en la
   próxima pasada (el check-in sigue dentro del lookback mucho tiempo). */
async function syncPendingExits({ entries, indexKeys, unreadable, missingForced, reported, verified, catalog, reportStart, hoy }) {
  const latestKeys = new Map();
  for (const { key, record } of entries) {
    const ref = String((record && record.bookingCode) || '').trim();
    if (!ref || (record.type && record.type !== 'guest_checkin')) continue;
    const prev = latestKeys.get(ref);
    if (!prev || String(record.createdAt || '') > String(prev.record.createdAt || '')) latestKeys.set(ref, { key, record });
  }
  const tooOld = addDays(hoy, -PENDING_EXIT_MAX_AGE_DAYS);
  const desired = new Map();
  for (const [ref, { key, record }] of latestKeys) {
    const v = verified && verified.get(ref);
    if (v && !v.ok && v.motivo !== 'reserva_sin_verificar') continue;
    const tokenOut = sire.reservationDates(record.reservation || {}).checkOut;
    const checkOut = (v && v.ok && v.checkOut) || tokenOut;
    if (!checkOut || checkOut < tooOld) continue;
    if (reportStart && checkOut < reportStart) continue;
    const pendingExit = foreignGuestsOf(record, catalog).some(g => !reported.has(g.ids.S));
    if (pendingExit) desired.set(key, checkOut);
  }
  const store = deps.guestStore(PENDING_EXITS_STORE);
  let escritos = 0;
  let borrados = 0;
  let fallos = 0;
  const ops = [];
  for (const [key, checkOut] of desired) {
    if (!indexKeys.has(key)) ops.push(() => store.set(key, JSON.stringify({ v: 1, checkOut })).then(() => { escritos += 1; }));
  }
  const loadedKeys = new Set(entries.map(e => e.key));
  for (const key of indexKeys) {
    if (desired.has(key)) continue;
    /* Solo se borra lo que se pudo leer (o ya no existe): un check-in ilegible
       NO se suelta del índice. */
    if (unreadable.has(key)) continue;
    if (!loadedKeys.has(key) && !missingForced.includes(key)) continue;
    ops.push(() => store.delete(key).then(() => { borrados += 1; }));
  }
  for (let i = 0; i < ops.length; i += READ_BATCH) {
    await Promise.all(ops.slice(i, i + READ_BATCH).map(op => op().catch(() => { fallos += 1; })));
  }
  return { escritos, borrados, fallos };
}

/* Comprueba en OTASync que las reservas sigan vigentes y trae sus fechas
   reales. Un fallo de red deja la reserva "sin verificar" (no se exporta; se
   reintenta en la próxima pasada y, si se sale de la ventana, vuelve como
   atrasado). */
async function verifyReservations(refs) {
  const verified = new Map();
  for (let i = 0; i < refs.length; i += VERIFY_BATCH) {
    const batch = refs.slice(i, i + VERIFY_BATCH);
    await Promise.all(batch.map(async ref => {
      try {
        verified.set(ref, verifiedStay(await deps.fetchReservation(ref)));
      } catch (e) {
        verified.set(ref, { ok: false, motivo: 'reserva_sin_verificar' });
      }
    }));
  }
  return verified;
}

async function reportStartSetting() {
  const raw = String((await deps.getSetting('SIRE_REPORT_START', '')) || '').trim();
  if (!raw) return { value: '', missing: true };
  if (!isIsoDate(raw)) return { value: '', error: 'SIRE_REPORT_START debe ser una fecha YYYY-MM-DD.' };
  return { value: raw };
}

async function handleExport(event) {
  const q = event.queryStringParameters || {};
  const range = resolveRange(q, deps.now());
  if (range.error) return respond(400, { error: range.error });
  const includeReported = ['1', 'true', 'si', 'sí'].includes(String(q.incluir_reportados || '').toLowerCase());

  const catalog = catalogMod.loadCatalog();
  const { config, faltante, errores } = exportConfig(catalog);
  const start = await reportStartSetting();
  if (start.missing) faltante.push('SIRE_REPORT_START');
  if (start.error) errores.push(start.error);
  const reportStart = start.value;
  const minMs = Date.parse(`${range.desde}T00:00:00Z`) + BOGOTA_OFFSET_MS - lookbackDays() * DAY_MS;

  let reported;
  let indexKeys;
  try {
    reported = await loadReportedIds();
    indexKeys = await loadPendingExitKeys();
  } catch (e) {
    /* Sin el registro de lo ya reportado se arriesga reportar dos veces; sin
       el índice, perder salidas de estadías largas: cerrar. */
    console.error('[sire-export] no se pudo leer sire-reports / sire-pending-exits');
    return respond(503, { error: 'No se pudo leer el registro de movimientos ya reportados. Intenta más tarde.' });
  }

  let loaded;
  try {
    loaded = await loadCheckinRecords(minMs, indexKeys);
  } catch (e) {
    console.error('[sire-export] no se pudo listar guest-checkins');
    return respond(503, { error: 'No se pudieron leer los check-ins. Intenta más tarde.' });
  }
  const records = loaded.entries.map(e => e.record);

  const advertencias = [];
  if (loaded.ilegibles > 0) {
    advertencias.push(`${loaded.ilegibles} check-in(s) no se pudieron descifrar: sus huéspedes extranjeros NO están en esta exportación. Revisar GUEST_APP_KEY_RING / GUEST_APP_ACTIVE_KEY_ID.`);
    if (!records.length) errores.push('Ningún check-in se pudo descifrar (¿clave de cifrado rotada o incompleta?): no se exporta nada para no dar por vacío lo que no se pudo leer.');
  }

  /* Verificación en OTASync (cancelaciones / no-show / fechas reales). Sin
     credenciales no se puede comprobar: no se entrega archivo. */
  let verified = new Map();
  const readyBeforeVerify = faltante.length === 0 && errores.length === 0;
  if (!deps.hasOtasyncCreds()) {
    errores.push('Sin credenciales de OTASync: no se puede comprobar que las reservas sigan vigentes (canceladas / no-show).');
  } else if (readyBeforeVerify) {
    const targets = verificationTargets(records, { ...range, reported, catalog, reportStart });
    verified = await verifyReservations(targets.slice(0, MAX_VERIFY));
    if (targets.length > MAX_VERIFY) {
      advertencias.push(`${targets.length - MAX_VERIFY} reserva(s) quedan sin comprobar en esta pasada (tope ${MAX_VERIFY}); se comprueban en las siguientes.`);
    }
  }

  const result = buildExport(records, {
    ...range, reported, includeReported, config, catalog, faltante, errores, advertencias,
    reportStart, verified: readyBeforeVerify && deps.hasOtasyncCreds() ? verified : undefined, ilegibles: loaded.ilegibles
  });
  result.generadoEn = new Date(deps.now()).toISOString();

  const idx = await syncPendingExits({
    entries: loaded.entries, indexKeys, unreadable: loaded.unreadable, missingForced: loaded.missingForced,
    reported, verified: readyBeforeVerify ? verified : null, catalog, reportStart, hoy: range.hoy
  }).catch(() => ({ escritos: 0, borrados: 0, fallos: 1 }));

  const c = result.conteos;
  /* Ley 1581: SOLO conteos en el log. */
  console.log(`[sire-export] rango=${range.desde}..${range.hasta} listo=${result.listo} checkins=${c.checkins} extranjeros=${c.extranjeros} movimientos=${c.movimientos_listos} ya_reportados=${c.ya_reportados} incompletos=${c.incompletos} no_vigentes=${c.no_vigentes} sin_verificar=${c.sin_verificar} atrasados=${c.atrasados} ilegibles=${c.ilegibles} indice=+${idx.escritos}/-${idx.borrados}${idx.fallos ? ` fallos=${idx.fallos}` : ''}`);
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
  verifiedStay,
  verificationTargets,
  foreignGuestsOf,
  setDeps(overrides) { deps = { ...defaultDeps, ...overrides }; },
  resetDeps() { deps = { ...defaultDeps }; },
  MIN_TOKEN_LENGTH,
  MAX_RANGE_DAYS,
  DEFAULT_WINDOW_DAYS
};
