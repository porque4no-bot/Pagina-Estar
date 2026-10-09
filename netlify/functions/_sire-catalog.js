require('./_env');

/*
 * _sire-catalog.js — tablas de códigos para el archivo plano de SIRE.
 *
 * El check-in en línea guarda texto libre ("España", "Lima, Perú", "Pasaporte");
 * el portal de Migración Colombia pide CÓDIGOS. Este módulo traduce:
 *   - tipo de documento (CC/TI/CE/Pasaporte del check-in) → código SIRE
 *   - país (nacionalidad, procedencia, destino)          → código de país
 *   - ciudad colombiana (procedencia/destino nacional)    → código de ciudad
 *   - el código de ciudad del hotel (Manizales)
 * y normaliza nombres y números de documento para el archivo.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠️  TODO(SIRE): NINGÚN código de este archivo está confirmado contra el   │
 * │ portal. Los de país son la codificación DANE/DIAN (la que usan casi todos │
 * │ los formatos oficiales colombianos), los de ciudad son DIVIPOLA (DANE) y   │
 * │ los de tipo de documento salen de guías de proveedores. Antes de la        │
 * │ primera subida real hay que cotejarlos con la guía/tablas que muestra el   │
 * │ portal (el ensayo del subidor del VPS las captura). Todos se pueden        │
 * │ corregir SIN tocar código con las variables de abajo.                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Config (env; nada aquí es secreto):
 *   SIRE_CITY_CODE             código de la ciudad del hotel (default 17001 =
 *                              Manizales, DIVIPOLA). TODO(SIRE): confirmar.
 *   SIRE_DOC_TYPE_CODES_JSON   p.ej. {"Pasaporte":"3","CE":"5"} — se mezcla
 *                              sobre DOC_TYPES.
 *   SIRE_COUNTRY_CODES_JSON    p.ej. {"españa":"245","kenia":"355"} — clave =
 *                              nombre o alias del país; corrige o agrega.
 *   SIRE_CITY_CODES_JSON       p.ej. {"chinchina":"17174"} — corrige o agrega.
 *   SIRE_TEXT_ASCII            'false' para conservar tildes/minúsculas en
 *                              nombres (default: MAYÚSCULAS sin tildes, como la
 *                              zona legible del pasaporte). TODO(SIRE): confirmar.
 *
 * Puro: no llama a ninguna red ni lanza. Un JSON inválido se ignora y se
 * reporta en `errors` para que la exportación lo muestre.
 */

/* Código de ciudad por defecto del hotel: Manizales (DIVIPOLA 17001).
   TODO(SIRE): confirmar que el portal usa DIVIPOLA. */
const DEFAULT_CITY_CODE = '17001';

/* Tipo de documento canónico del check-in (guest-checkin VALID_DOCUMENT_TYPES)
   → código SIRE. TODO(SIRE): confirmar contra la lista del portal.
   Para un EXTRANJERO, "CC"/"TI" en nuestro check-in significa su documento de
   identidad nacional (lo que Azure lee como "national identity card"), que SIRE
   suele llamar "documento extranjero". */
const DOC_TYPES = {
  Pasaporte: '3',
  CE: '5',
  CC: '10',
  TI: '10'
};

/* Países: código DANE/DIAN + alias (español, inglés, gentilicios, ISO).
   Cubre la lista del check-in (guest.html, datalist nationalityOptions).
   TODO(SIRE): confirmar cada código contra la tabla de países del portal. */
const COUNTRIES = [
  { iso2: 'CO', code: '169', names: ['colombia', 'colombiano', 'colombiana', 'colombian', 'co', 'col'] },
  { iso2: 'VE', code: '850', names: ['venezuela', 'venezolano', 'venezolana', 'venezuelan', 've', 'ven'] },
  { iso2: 'EC', code: '239', names: ['ecuador', 'ecuatoriano', 'ecuatoriana', 'ecuadorian', 'ec', 'ecu'] },
  { iso2: 'PE', code: '589', names: ['peru', 'peruano', 'peruana', 'peruvian', 'pe', 'per'] },
  { iso2: 'CL', code: '211', names: ['chile', 'chileno', 'chilena', 'chilean', 'cl', 'chl'] },
  { iso2: 'AR', code: '063', names: ['argentina', 'argentino', 'argentinian', 'argentine', 'ar', 'arg'] },
  { iso2: 'BR', code: '105', names: ['brasil', 'brazil', 'brasileno', 'brasilena', 'brasileiro', 'brazilian', 'br', 'bra'] },
  { iso2: 'MX', code: '493', names: ['mexico', 'mexicano', 'mexicana', 'mexican', 'mx', 'mex'] },
  { iso2: 'US', code: '249', names: ['estados unidos', 'estados unidos de america', 'eeuu', 'ee uu', 'usa', 'us', 'united states', 'united states of america', 'estadounidense', 'norteamericano', 'norteamericana', 'american'] },
  { iso2: 'CA', code: '149', names: ['canada', 'canadiense', 'canadian', 'ca', 'can'] },
  { iso2: 'ES', code: '245', names: ['espana', 'spain', 'espanol', 'espanola', 'spanish', 'es', 'esp'] },
  { iso2: 'FR', code: '275', names: ['francia', 'france', 'frances', 'francesa', 'french', 'fr', 'fra'] },
  { iso2: 'DE', code: '023', names: ['alemania', 'germany', 'deutschland', 'aleman', 'alemana', 'german', 'de', 'deu'] },
  { iso2: 'IT', code: '386', names: ['italia', 'italy', 'italiano', 'italiana', 'italian', 'it', 'ita'] },
  { iso2: 'GB', code: '628', names: ['reino unido', 'united kingdom', 'uk', 'gran bretana', 'great britain', 'inglaterra', 'england', 'escocia', 'scotland', 'gales', 'wales', 'britanico', 'britanica', 'british', 'ingles', 'inglesa', 'gb', 'gbr'] },
  { iso2: 'NL', code: '573', names: ['paises bajos', 'holanda', 'netherlands', 'the netherlands', 'holland', 'neerlandes', 'neerlandesa', 'holandes', 'holandesa', 'dutch', 'nl', 'nld'] },
  { iso2: 'CH', code: '767', names: ['suiza', 'switzerland', 'suizo', 'swiss', 'ch', 'che'] },
  { iso2: 'PT', code: '607', names: ['portugal', 'portugues', 'portuguesa', 'portuguese', 'pt', 'prt'] },
  { iso2: 'UY', code: '845', names: ['uruguay', 'uruguayo', 'uruguaya', 'uruguayan', 'uy', 'ury'] },
  { iso2: 'PY', code: '586', names: ['paraguay', 'paraguayo', 'paraguaya', 'paraguayan', 'py', 'pry'] },
  { iso2: 'BO', code: '097', names: ['bolivia', 'boliviano', 'boliviana', 'bolivian', 'bo', 'bol'] },
  { iso2: 'PA', code: '580', names: ['panama', 'panameno', 'panamena', 'panamanian', 'pa', 'pan'] },
  { iso2: 'CR', code: '196', names: ['costa rica', 'costarricense', 'costa rican', 'cr', 'cri'] },
  { iso2: 'DO', code: '647', names: ['republica dominicana', 'dominican republic', 'dominicano', 'dominicana', 'dominican', 'do', 'dom'] },
  { iso2: 'GT', code: '317', names: ['guatemala', 'guatemalteco', 'guatemalteca', 'guatemalan', 'gt', 'gtm'] },
  { iso2: 'HN', code: '345', names: ['honduras', 'hondureno', 'hondurena', 'honduran', 'hn', 'hnd'] },
  { iso2: 'SV', code: '242', names: ['el salvador', 'salvador', 'salvadoreno', 'salvadorena', 'salvadoran', 'sv', 'slv'] },
  { iso2: 'NI', code: '521', names: ['nicaragua', 'nicaraguense', 'nicaraguan', 'ni', 'nic'] },
  { iso2: 'CU', code: '199', names: ['cuba', 'cubano', 'cubana', 'cuban', 'cu', 'cub'] },
  { iso2: 'CN', code: '215', names: ['china', 'chino', 'chinese', 'cn', 'chn'] }
];

/* Ciudades colombianas → DIVIPOLA (DANE), para procedencia/destino nacional.
   Las principales + el Eje Cafetero. TODO(SIRE): confirmar que el portal usa
   DIVIPOLA para los lugares; si usa otra tabla, corregir con SIRE_CITY_CODES_JSON. */
const CO_CITIES = {
  manizales: '17001', villamaria: '17873', chinchina: '17174',
  pereira: '66001', dosquebradas: '66170', 'santa rosa de cabal': '66682',
  armenia: '63001', salento: '63690', filandia: '63272', calarca: '63130',
  bogota: '11001', 'bogota dc': '11001', 'bogota d c': '11001', 'santa fe de bogota': '11001',
  medellin: '05001', rionegro: '05615', guatape: '05321', jardin: '05364',
  envigado: '05266', itagui: '05360', bello: '05088',
  cali: '76001', 'santiago de cali': '76001',
  barranquilla: '08001',
  cartagena: '13001', 'cartagena de indias': '13001',
  'santa marta': '47001',
  bucaramanga: '68001',
  cucuta: '54001', 'san jose de cucuta': '54001',
  ibague: '73001',
  villavicencio: '50001',
  pasto: '52001', 'san juan de pasto': '52001',
  neiva: '41001',
  popayan: '19001',
  monteria: '23001',
  valledupar: '20001',
  tunja: '15001', 'villa de leyva': '15407',
  sincelejo: '70001',
  riohacha: '44001',
  quibdo: '27001',
  leticia: '91001',
  'san andres': '88001',
  yopal: '85001',
  florencia: '18001',
  mocoa: '86001',
  arauca: '81001'
};

/* Minúsculas, sin tildes, sin signos: la forma con la que se comparan alias. */
function normalizeKey(value) {
  return String(value == null ? '' : value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseJsonEnv(name, errors) {
  const raw = process.env[name];
  if (!raw || !String(raw).trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('no es un objeto');
    return parsed;
  } catch (e) {
    errors.push(`${name} no es un JSON de objeto válido (se ignora)`);
    return null;
  }
}

/* Arma el catálogo efectivo: defaults + correcciones por env. Nunca lanza. */
function loadCatalog() {
  const errors = [];
  const docTypes = { ...DOC_TYPES };
  const docOverride = parseJsonEnv('SIRE_DOC_TYPE_CODES_JSON', errors);
  if (docOverride) {
    for (const [k, v] of Object.entries(docOverride)) {
      if (v !== null && v !== undefined && String(v).trim()) docTypes[String(k).trim()] = String(v).trim();
    }
  }

  /* índice alias → país */
  const countries = COUNTRIES.map(c => ({ ...c, names: [...c.names] }));
  const byAlias = new Map();
  countries.forEach(c => c.names.forEach(n => byAlias.set(normalizeKey(n), c)));
  const countryOverride = parseJsonEnv('SIRE_COUNTRY_CODES_JSON', errors);
  if (countryOverride) {
    for (const [k, v] of Object.entries(countryOverride)) {
      const key = normalizeKey(k);
      const code = v == null ? '' : String(v).trim();
      if (!key || !code) continue;
      const existing = byAlias.get(key);
      if (existing) existing.code = code;
      else {
        /* País nuevo: extranjero (no es Colombia) salvo que el alias sea de CO. */
        const added = { iso2: '', code, names: [key] };
        countries.push(added);
        byAlias.set(key, added);
      }
    }
  }

  const cities = {};
  Object.entries(CO_CITIES).forEach(([k, v]) => { cities[normalizeKey(k)] = v; });
  const cityOverride = parseJsonEnv('SIRE_CITY_CODES_JSON', errors);
  if (cityOverride) {
    for (const [k, v] of Object.entries(cityOverride)) {
      const key = normalizeKey(k);
      if (key && v != null && String(v).trim()) cities[key] = String(v).trim();
    }
  }

  const hotelCity = String(process.env.SIRE_CITY_CODE || '').trim() || DEFAULT_CITY_CODE;
  const asciiRaw = String(process.env.SIRE_TEXT_ASCII == null ? '' : process.env.SIRE_TEXT_ASCII).trim().toLowerCase();
  const ascii = asciiRaw !== 'false';

  return { docTypes, byAlias, cities, hotelCity, ascii, errors };
}

/* País por texto libre → { iso2, code, colombia } o null si no se reconoce. */
function resolveCountry(value, catalog = loadCatalog()) {
  const key = normalizeKey(value);
  if (!key) return null;
  const c = catalog.byAlias.get(key);
  if (!c) return null;
  return { iso2: c.iso2, code: c.code, colombia: c.iso2 === 'CO' };
}

/* ¿Es colombiano? Misma regla que guest-checkin.isForeignGuest: vacío = no se
   sabe (no se trata como extranjero); cualquier texto que no sea Colombia =
   extranjero (aunque el país no esté en el catálogo: así no se escapa nadie
   del reporte; su código faltará y saldrá como aviso). */
function isForeignNationality(value, catalog = loadCatalog()) {
  const key = normalizeKey(value);
  if (!key) return false;
  const c = resolveCountry(value, catalog);
  if (c) return !c.colombia;
  return true;
}

function resolveCityCode(value, catalog = loadCatalog()) {
  const key = normalizeKey(value);
  if (!key) return '';
  return catalog.cities[key] || '';
}

/* Lugar estructurado (ciudad + país) → código. Extranjero: código de país.
   Colombia (o país vacío): código de la ciudad, si se conoce. */
function resolvePlace({ city, country } = {}, catalog = loadCatalog()) {
  const countryInfo = country ? resolveCountry(country, catalog) : null;
  if (country && !countryInfo) return '';            /* país escrito pero desconocido */
  if (countryInfo && !countryInfo.colombia) return countryInfo.code;
  return resolveCityCode(city, catalog);
}

/* Lugar en texto libre ("Lima, Perú", "Bogotá", "Madrid, España") → código. */
function resolvePlaceText(value, catalog = loadCatalog()) {
  const parts = String(value == null ? '' : value)
    .split(/[,;/()\n]+/)
    .map(p => p.trim())
    .filter(Boolean);
  if (!parts.length) return '';
  /* El país suele ir al final. */
  const last = resolveCountry(parts[parts.length - 1], catalog);
  if (last && !last.colombia) return last.code;
  if (last && last.colombia) {
    for (const p of parts.slice(0, -1)) {
      const code = resolveCityCode(p, catalog);
      if (code) return code;
    }
    return '';
  }
  for (const p of parts) {
    const code = resolveCityCode(p, catalog);
    if (code) return code;
  }
  for (const p of parts) {
    const c = resolveCountry(p, catalog);
    if (c && !c.colombia) return c.code;
  }
  return '';
}

function docTypeCode(value, catalog = loadCatalog()) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return '';
  if (catalog.docTypes[v]) return catalog.docTypes[v];
  const found = Object.keys(catalog.docTypes).find(k => k.toLowerCase() === v.toLowerCase());
  return found ? catalog.docTypes[found] : '';
}

/* Número de documento: solo letras y dígitos, en mayúscula (sin espacios,
   puntos ni guiones que el huésped haya tecleado). */
function normalizeDocNumber(value) {
  return String(value == null ? '' : value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/* Nombres/apellidos para el archivo. Con ascii (default): MAYÚSCULAS sin tildes
   (Ñ→N), solo letras, dígitos, espacio, guion y apóstrofo. */
function sireText(value, catalog = loadCatalog()) {
  let s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  if (!catalog.ascii) return s;
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  return s.replace(/[^A-Z0-9 '\-]/g, ' ').replace(/\s+/g, ' ').trim();
}

module.exports = {
  DEFAULT_CITY_CODE,
  DOC_TYPES,
  COUNTRIES,
  CO_CITIES,
  loadCatalog,
  normalizeKey,
  resolveCountry,
  isForeignNationality,
  resolveCityCode,
  resolvePlace,
  resolvePlaceText,
  docTypeCode,
  normalizeDocNumber,
  sireText
};
