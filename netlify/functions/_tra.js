require('./_env');

/*
 * _tra.js — cliente del reporte TRA (Tarjeta de Registro de Alojamiento, MinCIT /
 * SIAT). Reporta cada estadía al Registro Nacional de Turismo: TODOS los
 * huéspedes (nacionales y extranjeros), a diferencia del SIRE (solo extranjeros).
 *
 * Por qué existe (decisión del dueño 30-jun-2026): NUESTRO check-in (guest.html)
 * es el oficial y captura los campos que SIRE/TRA exigen; la API pública de
 * OTASync NO acepta esos campos, así que su reporte automático no puede usar
 * nuestros datos → lo reportamos nosotros. TRA sí tiene API REST/JSON oficial
 * (Grupo 1, Resolución 700/2021); SIRE no (eso va por archivo plano aparte).
 *
 * Cómo funciona la API (traapi.mincit.gov.co):
 *   - Token: se solicita en <base>/token/ y llega al correo del RNT; se envía en
 *     el header Authorization en cada request.
 *   - Titular: POST <base>/ → devuelve { id }.
 *   - Cada acompañante: POST a la base "two" (apitwo) con ese id del titular en
 *     el campo 'padre'.
 *
 * ⚠️ RESPETA la grafía LITERAL de la API (viene así del MinCIT, con la errata
 * incluida): cuidad_residencia, cuidad_procedencia, check_in, check_out,
 * numero_acompanantes (sí, 'cuidad' en vez de 'ciudad').
 *
 * Mock-safe: si TRA_ENABLED está apagado o falta el token, es un no-op logueado
 * ({ ok:false, isMock:true }) — NO toca la red. Best-effort: NUNCA lanza.
 *
 * TODO(TRA): confirmar los nombres y la obligatoriedad EXACTOS de cada campo
 * contra la documentación oficial (soportesiat@mincit.gov.co) ANTES de producción.
 * El mapeo de abajo es la mejor interpretación de la investigación; algunos
 * campos (tipo de documento, códigos de ciudad/país, número de personas) pueden
 * requerir catálogos o una grafía distinta que el MinCIT debe confirmar.
 *
 * Config (env; cargar en pre-producción):
 *   TRA_ENABLED   'true' para activar (default OFF → mock no-op)
 *   TRA_TOKEN     token del RNT (SECRETO) — se pide en <base>/token/, llega al correo del RNT
 *   TRA_RNT       número de RNT del establecimiento (default '276306' = MIRADA SAS)
 *   TRA_NIT       NIT del establecimiento (opcional; algunos endpoints lo piden)
 *   TRA_API_BASE  opcional, default https://traapi.mincit.gov.co/api
 *                 (la base "two" para acompañantes se deriva: /api → /apitwo)
 *   TRA_TIMEOUT_MS opcional, default 10000
 */

function traConfig() {
  return {
    enabled: String(process.env.TRA_ENABLED || '').toLowerCase() === 'true',
    token: process.env.TRA_TOKEN || '',
    rnt: process.env.TRA_RNT || '276306',
    nit: process.env.TRA_NIT || '',
    apiBase: (process.env.TRA_API_BASE || 'https://traapi.mincit.gov.co/api').replace(/\/+$/, ''),
    timeoutMs: parseInt(process.env.TRA_TIMEOUT_MS, 10) || 10000
  };
}

/* La API de acompañantes vive en una base "two" (apitwo). Se deriva de la base
   del titular reemplazando el último segmento /api por /apitwo, para que un
   override de TRA_API_BASE mantenga ambas coherentes. */
function companionBase(apiBase) {
  const base = String(apiBase || '').replace(/\/+$/, '');
  if (/\/api$/.test(base)) return base.replace(/\/api$/, '/apitwo');
  return base + '/two';
}

function isConfigured() {
  const c = traConfig();
  return Boolean(c.enabled && c.token);
}

function str(v) { return v == null ? '' : String(v).trim(); }

/* Construye el cuerpo del reporte del TITULAR a partir de la reserva + su huésped.
   Grafía LITERAL de la API (cuidad_*, check_in/out, numero_acompanantes). */
function buildTitularPayload(reserva, titular, numeroAcompanantes, cfg) {
  reserva = reserva || {};
  titular = titular || {};
  return {
    rnt: cfg.rnt,
    nit: cfg.nit || undefined,
    tipo_identificacion: str(titular.documentType),
    numero_identificacion: str(titular.documentNumber),
    nombres: str(titular.firstName),
    apellidos: str(titular.lastName),
    nacionalidad: str(titular.nationality),
    genero: str(titular.sex),
    ocupacion: str(titular.occupation),
    fecha_nacimiento: str(titular.birthDate),
    /* grafía LITERAL de la API: 'cuidad' (errata oficial), no 'ciudad' */
    cuidad_residencia: str(titular.residenceCity),
    pais_residencia: str(titular.residenceCountry),
    cuidad_procedencia: str(titular.originCity),
    pais_procedencia: str(titular.originCountry),
    cuidad_destino: str(titular.destination),
    check_in: str(reserva.checkIn || reserva.check_in),
    check_out: str(reserva.checkOut || reserva.check_out),
    numero_acompanantes: Number.isFinite(numeroAcompanantes) ? numeroAcompanantes : 0
  };
}

/* Construye el cuerpo de un ACOMPAÑANTE. Va a la base "two" con el id del
   titular en el campo 'padre'. */
function buildAcompanantePayload(reserva, acompanante, padreId, cfg) {
  reserva = reserva || {};
  acompanante = acompanante || {};
  return {
    padre: padreId,
    rnt: cfg.rnt,
    tipo_identificacion: str(acompanante.documentType),
    numero_identificacion: str(acompanante.documentNumber),
    nombres: str(acompanante.firstName),
    apellidos: str(acompanante.lastName),
    nacionalidad: str(acompanante.nationality),
    genero: str(acompanante.sex),
    ocupacion: str(acompanante.occupation),
    fecha_nacimiento: str(acompanante.birthDate),
    cuidad_residencia: str(acompanante.residenceCity),
    pais_residencia: str(acompanante.residenceCountry),
    cuidad_procedencia: str(acompanante.originCity),
    pais_procedencia: str(acompanante.originCountry),
    cuidad_destino: str(acompanante.destination),
    check_in: str(reserva.checkIn || reserva.check_in),
    check_out: str(reserva.checkOut || reserva.check_out)
  };
}

/* POST helper: envía el token en Authorization, respeta el timeout, y NUNCA
   lanza — devuelve { ok, status?, data?, id?, error? }. */
async function postTra(url, payload, cfg, fetchFn) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Authorization': cfg.token,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
    clearTimeout(tid);
    let data = null;
    try { data = await res.json(); } catch (e) { /* respuesta sin cuerpo JSON */ }
    if (!res.ok) {
      const detail = (data && (data.message || data.error)) || `TRA returned ${res.status}`;
      return { ok: false, status: res.status, error: detail, data };
    }
    /* El id del titular puede llegar como id / Id / ID según el endpoint. */
    const id = data ? (data.id != null ? data.id : (data.Id != null ? data.Id : data.ID)) : undefined;
    return { ok: true, status: res.status, data, id };
  } catch (err) {
    clearTimeout(tid);
    return { ok: false, error: err && err.name === 'AbortError' ? 'timeout' : (err && err.message) || 'error' };
  }
}

/*
 * Reporta una estadía completa al TRA: primero el titular (POST a la base),
 * luego cada acompañante en orden (POST a la base "two" con el id del titular
 * en 'padre'). Devuelve un resumen; best-effort, NUNCA lanza.
 *
 *   reportReservation({ reserva, huespedes }, deps)
 *
 *   reserva   { checkIn, checkOut, ... } de la estadía
 *   huespedes [titular, ...acompañantes] — el PRIMERO es el titular
 *
 * Retorno: { ok, isMock?, id?, titular:{...}, acompanantes:[...], error?, reason? }
 */
async function reportReservation({ reserva, huespedes } = {}, deps = {}) {
  const cfg = deps.config || traConfig();

  if (!cfg.enabled || !cfg.token) {
    if (process.env.DEBUG) console.log('[tra] mock report (apagado o sin token)');
    return { ok: false, isMock: true };
  }

  const guests = Array.isArray(huespedes) ? huespedes.filter(Boolean) : [];
  if (guests.length === 0) return { ok: false, reason: 'no-guests' };

  const fetchFn = deps.fetch || (typeof fetch !== 'undefined' ? fetch : null);
  if (!fetchFn) return { ok: false, error: 'no-fetch' };

  const titular = guests[0];
  const acompanantes = guests.slice(1);

  /* 1) Titular */
  const titularPayload = buildTitularPayload(reserva, titular, acompanantes.length, cfg);
  const titularRes = await postTra(`${cfg.apiBase}/`, titularPayload, cfg, fetchFn);
  if (!titularRes.ok) {
    return { ok: false, error: titularRes.error, status: titularRes.status, titular: titularRes };
  }
  const padreId = titularRes.id;

  /* 2) Acompañantes, en orden, a la base "two" con el id del titular en 'padre'. */
  const twoBase = companionBase(cfg.apiBase);
  const acompRes = [];
  for (const acomp of acompanantes) {
    const payload = buildAcompanantePayload(reserva, acomp, padreId, cfg);
    const r = await postTra(`${twoBase}/`, payload, cfg, fetchFn);
    acompRes.push(r);
  }

  const allOk = acompRes.every(r => r.ok);
  return {
    ok: allOk,
    id: padreId,
    titular: { ok: true, id: padreId, status: titularRes.status },
    acompanantes: acompRes
  };
}

module.exports = {
  isConfigured,
  reportReservation,
  traConfig,
  companionBase,
  buildTitularPayload,
  buildAcompanantePayload
};
