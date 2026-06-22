const crypto = require('crypto');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limit');
const {
  archiveGuestPayload,
  cleanText,
  corsHeaders,
  guestStore,
  json,
  parseJsonBody,
  protectRecord,
  requireGuest,
  sealBinaryForStore,
  syncGuestEvent
} = require('./_guest-app');
const { flag } = require('./_settings');

const MAX_RAW_FILE_BYTES = 4.5 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/bmp',
  'image/heif'
]);
const MAX_GUESTS = 5;
/* How many OCR (Azure) attempts a guest may make before we stop blocking the
   check-in. After MAX_OCR_ATTEMPTS unsuccessful reads we accept the manually
   typed data and flag the record for manual verification by reception, rather
   than rejecting hard. The client tracks and sends the attempt count. */
const MAX_OCR_ATTEMPTS = 3;
/* Canonical document types the record must persist (SIRE/TRA admits a fixed
   list). Anything Azure or the guest provides is mapped onto these. */
const VALID_DOCUMENT_TYPES = ['CC', 'TI', 'CE', 'Pasaporte'];
const defaultDeps = {
  archiveGuestPayload,
  guestStore,
  protectRecord,
  requireGuest,
  sealBinaryForStore,
  syncGuestEvent
};
const deps = { ...defaultDeps };

function normalizeAccentless(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeDocumentType(value) {
  /* Maps any free-text / Azure document-type label onto one of
     VALID_DOCUMENT_TYPES. Returns '' when there is no confident match so the
     caller can surface it as a missing required field (SIRE/TRA needs a valid
     type). Mirrors the alias table the client uses in guest-app.js. */
  const raw = String(value || '').trim();
  if (!raw) return '';
  /* Exact canonical value passes straight through (case-insensitive). */
  const exact = VALID_DOCUMENT_TYPES.find(t => t.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  const aliases = {
    cc: 'CC',
    'cedula': 'CC',
    'cedula ciudadania': 'CC',
    'cedula de ciudadania': 'CC',
    'cedula colombiana': 'CC',
    'documento nacional': 'CC',
    id: 'CC',
    'id card': 'CC',
    'identity card': 'CC',
    'national id': 'CC',
    'national identity card': 'CC',
    'iddocument nationalidentitycard': 'CC',
    ti: 'TI',
    'tarjeta de identidad': 'TI',
    'tarjeta identidad': 'TI',
    ce: 'CE',
    'cedula extranjeria': 'CE',
    'cedula de extranjeria': 'CE',
    'residence permit': 'CE',
    'iddocument residencepermit': 'CE',
    pasaporte: 'Pasaporte',
    passport: 'Pasaporte',
    'iddocument passport': 'Pasaporte'
  };
  const key = normalizeAccentless(raw);
  if (aliases[key]) return aliases[key];
  /* Fuzzy token match for noisy labels (e.g. "tipo de documento: pasaporte").
     We match an alias only when it appears as a whole space-delimited token /
     phrase, and we skip aliases shorter than 4 chars (cc, ti, ce, id) so a
     stray substring like "cc" inside "conduccion" never triggers a false hit. */
  const keyTokens = ` ${key} `;
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (alias.length < 4) continue;
    if (keyTokens.includes(` ${alias} `)) return canonical;
  }
  return '';
}

function normalizeSex(value) {
  /* SIRE/TRA wants a single-letter gender. Maps common labels to M / F and
     returns '' when unknown so the field stays optional but clean. */
  const key = normalizeAccentless(value);
  if (!key) return '';
  if (['m', 'masculino', 'male', 'hombre', 'h'].includes(key)) return 'M';
  if (['f', 'femenino', 'female', 'mujer'].includes(key)) return 'F';
  return '';
}

function extensionForContentType(contentType) {
  /* Returns the canonical file extension (including the leading dot) for the
     content types accepted by decodeFile. Falls back to empty string so the
     persistence key is still unique via the guestIndex prefix. */
  const map = {
    'application/pdf': '.pdf',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/tiff': '.tif',
    'image/bmp': '.bmp',
    'image/heif': '.heif'
  };
  return map[String(contentType || '').toLowerCase()] || '';
}

function minorDocumentFileName(guestIndex, docKind, contentType) {
  /* Stable filename for Drive uploads of minor documents — guest index +
     kind keeps things sortable inside 01_documentos/menores/ even when the
     guest's own name folder already exists for their identity document. */
  const ext = extensionForContentType(contentType) || '.bin';
  return `${guestIndex + 1}_menor_${docKind}${ext}`;
}

function decodeFile(file) {
  if (!file || !file.dataUrl) return null;
  const match = String(file.dataUrl).match(/^data:([^;,]+);base64,([a-zA-Z0-9+/=\s]+)$/);
  if (!match) throw Object.assign(new Error('El archivo no tiene un formato válido.'), { statusCode: 400 });
  const contentType = String(file.type || match[1]).toLowerCase();
  if (!ALLOWED_TYPES.has(contentType)) {
    throw Object.assign(new Error('Usa una imagen JPG, PNG o un archivo PDF.'), { statusCode: 400 });
  }
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!buffer.length || buffer.length > MAX_RAW_FILE_BYTES) {
    throw Object.assign(new Error('El documento debe pesar menos de 4.5 MB.'), { statusCode: 413 });
  }
  return {
    buffer,
    contentType,
    name: cleanText(file.name || 'documento', 120),
    size: buffer.length
  };
}

async function stageDraftDocument(session, file, slotIndex, docKind) {
  /* docKind segments the draft namespace so identity uploads and minor docs
     (registro civil, autorización) never collide on key. The TTL stays at 24h. */
  const safeKind = docKind ? String(docKind).replace(/[^a-z0-9-]+/gi, '').slice(0, 40) : '';
  const prefix = safeKind ? `${safeKind}/` : '';
  const key = `${session.sub}/${prefix}${Date.now()}-${crypto.randomBytes(8).toString('hex')}.json`;
  const payload = {
    name: file.name,
    contentType: file.contentType,
    size: file.size,
    dataBase64: file.buffer.toString('base64'),
    slotIndex: Number.isInteger(slotIndex) ? slotIndex : null,
    docKind: safeKind || null,
    createdAt: new Date().toISOString()
  };
  const store = deps.guestStore('guest-checkin-drafts');
  if (typeof store.setJSON === 'function') {
    await store.setJSON(key, payload, { ttl: 24 * 60 * 60 });
  } else {
    await store.set(key, JSON.stringify(payload), { ttl: 24 * 60 * 60 });
  }
  return {
    key,
    name: file.name,
    contentType: file.contentType,
    size: file.size
  };
}

async function fileFromDraftRef(session, documentRef) {
  const key = cleanText(documentRef && documentRef.key, 220);
  if (!key || !key.startsWith(`${session.sub}/`)) return null;
  const store = deps.guestStore('guest-checkin-drafts');
  let draft;
  if (typeof store.get === 'function') {
    draft = await store.get(key, { type: 'json' });
  }
  if (!draft) return null;
  return {
    buffer: Buffer.from(String(draft.dataBase64 || ''), 'base64'),
    contentType: cleanText(draft.contentType, 80),
    name: cleanText(draft.name || 'documento', 120),
    size: Number(draft.size || 0)
  };
}

function fieldValue(field) {
  if (!field) return '';
  return field.valueString ||
    field.valueDate ||
    field.valueCountryRegion ||
    field.valuePhoneNumber ||
    field.valueNumber ||
    field.content ||
    '';
}

function pickField(fields, names) {
  for (const name of names) {
    if (fields[name]) {
      return {
        value: String(fieldValue(fields[name]) || '').trim(),
        confidence: Number(fields[name].confidence || 0)
      };
    }
  }
  return { value: '', confidence: 0 };
}

function documentTypeFromDocType(docType) {
  const normalized = String(docType || '').trim();
  const map = {
    'idDocument.nationalIdentityCard': 'CC',
    'idDocument.passport': 'Pasaporte',
    'idDocument.driverLicense': 'Licencia',
    'idDocument.residencePermit': 'CE'
  };
  return map[normalized] || '';
}

function machineReadableZoneText(field) {
  if (!field) return '';
  if (typeof field === 'string') return field;
  const direct = field.valueString || field.content;
  if (direct) return String(direct);
  if (field.valueObject && typeof field.valueObject === 'object') {
    return Object.values(field.valueObject)
      .map(value => fieldValue(value))
      .filter(Boolean)
      .join('\n');
  }
  if (Array.isArray(field.valueArray)) {
    return field.valueArray
      .map(value => fieldValue(value))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function firstNameFromMrz(mrzValue) {
  const lines = String(mrzValue || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const passportLine = lines.find(line => /^P[A-Z<][A-Z0-9<]{3}/i.test(line) && line.includes('<<'));
  if (!passportLine) return '';
  const [, names = ''] = passportLine.match(/^P[A-Z<][A-Z0-9<]{3}([A-Z<]+)$/i) || [];
  const [, givenNames = ''] = names.split('<<');
  return givenNames
    .split('<')
    .filter(Boolean)
    .join(' ')
    .trim();
}

function parseAzureResult(result) {
  const document = result &&
    result.analyzeResult &&
    Array.isArray(result.analyzeResult.documents)
    ? result.analyzeResult.documents[0]
    : null;
  const fields = (document && document.fields) || {};
  const firstName = pickField(fields, ['FirstName', 'GivenName', 'GivenNames']);
  const lastName = pickField(fields, ['LastName', 'Surname']);
  const documentNumber = pickField(fields, ['DocumentNumber', 'PersonalNumber']);
  const documentType = pickField(fields, ['DocumentType']);
  const birthDate = pickField(fields, ['DateOfBirth', 'BirthDate']);
  const expirationDate = pickField(fields, ['DateOfExpiration', 'ExpirationDate']);
  const nationality = pickField(fields, ['CountryRegion', 'Nationality']);
  const sex = pickField(fields, ['Sex', 'Gender']);
  const address = pickField(fields, ['Address']);
  const birthPlace = pickField(fields, ['PlaceOfBirth', 'BirthPlace']);
  const inferredDocumentType = documentType.value || documentTypeFromDocType(document && document.docType);
  const inferredNationality = nationality.value ||
    (inferredDocumentType === 'CC' ? 'Colombia' : '');
  const inferredFirstName = firstName.value ||
    firstNameFromMrz(machineReadableZoneText(fields.MachineReadableZone));
  const values = [
    inferredFirstName ? { value: inferredFirstName, confidence: firstName.confidence } : firstName,
    lastName,
    documentNumber,
    birthDate,
    expirationDate,
    inferredNationality ? { value: inferredNationality, confidence: nationality.confidence } : nationality
  ].filter(item => item.value);

  return {
    fields: {
      firstName: inferredFirstName,
      lastName: lastName.value,
      documentNumber: documentNumber.value,
      documentType: normalizeDocumentType(inferredDocumentType) || inferredDocumentType,
      birthDate: birthDate.value,
      expirationDate: expirationDate.value,
      nationality: inferredNationality,
      sex: normalizeSex(sex.value) || sex.value,
      birthPlace: birthPlace.value,
      address: address.value
    },
    confidence: values.length
      ? Math.round((values.reduce((sum, item) => sum + item.confidence, 0) / values.length) * 100)
      : 0
  };
}

exports._test = {
  parseAzureResult,
  calculateAge: birthDate => calculateAge(birthDate),
  matchProgenitor: (name, adults) => matchProgenitor(name, adults),
  parseRegistroCivilResult,
  normalizeGuest,
  normalizeDocumentType,
  normalizeSex,
  validateGuest,
  isForeignGuest,
  normalizeMarketingConsent,
  normalizeGuestEntry,
  maybeIssueDoorCodes,
  MAX_OCR_ATTEMPTS,
  VALID_DOCUMENT_TYPES,
  handler: event => exports.handler(event),
  setDeps(overrides = {}) {
    Object.assign(deps, overrides);
  },
  resetDeps() {
    Object.assign(deps, defaultDeps);
  }
};

async function analyzeWithAzure(file) {
  const endpoint = String(process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT || '').replace(/\/+$/, '');
  const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY || '';
  if (!endpoint || !key) {
    return { configured: false, fields: {}, confidence: 0 };
  }

  const modelId = process.env.AZURE_DOCUMENT_INTELLIGENCE_MODEL_ID || 'prebuilt-idDocument';
  const apiVersion = process.env.AZURE_DOCUMENT_INTELLIGENCE_API_VERSION || '2024-11-30';
  const analyzeUrl =
    `${endpoint}/documentintelligence/documentModels/${encodeURIComponent(modelId)}` +
    `:analyze?api-version=${encodeURIComponent(apiVersion)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(analyzeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': file.contentType,
        'Ocp-Apim-Subscription-Key': key
      },
      body: file.buffer,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Azure Document Intelligence returned ${response.status}: ${detail.slice(0, 240)}`);
  }

  const operationLocation = response.headers.get('operation-location');
  if (!operationLocation) throw new Error('Azure did not return an operation-location header');

  for (let attempt = 0; attempt < 15; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 700 + attempt * 100));
    const poll = await fetch(operationLocation, {
      headers: { 'Ocp-Apim-Subscription-Key': key }
    });
    if (!poll.ok) throw new Error(`Azure analysis polling returned ${poll.status}`);
    const result = await poll.json();
    if (result.status === 'succeeded') {
      return { configured: true, ...parseAzureResult(result) };
    }
    if (result.status === 'failed') {
      throw new Error('Azure could not analyze the identity document');
    }
  }
  throw new Error('Azure document analysis timed out');
}

function normalizeKeyValueLabel(value) {
  /* Lowercases, removes accents, collapses non-alphanumerics. Used to match
     key labels from the prebuilt-document model against our progenitor
     keywords ("padre", "madre", etc.). */
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function matchProgenitorLabel(label) {
  /* Returns 'father', 'mother' or null based on the normalized key label.
     Patterns cover variants found on Colombian registro civil: "Nombre del
     padre", "Padre del inscrito", "Padre", "Madre", "Nombre de la madre",
     etc. The check is intentionally permissive — the user always confirms
     the values on the client before submitting. */
  const normalized = normalizeKeyValueLabel(label);
  if (!normalized) return null;
  if (/(^|\s)madre(\s|$)/.test(normalized)) return 'mother';
  if (/(^|\s)padre(\s|$)/.test(normalized)) return 'father';
  if (normalized.includes('nombre de la madre')) return 'mother';
  if (normalized.includes('nombre del padre')) return 'father';
  return null;
}

function parseRegistroCivilResult(result) {
  const analyze = result && result.analyzeResult;
  const pairs = (analyze && Array.isArray(analyze.keyValuePairs))
    ? analyze.keyValuePairs
    : [];
  let fatherName = '';
  let motherName = '';
  const confidences = [];
  for (const pair of pairs) {
    if (!pair || !pair.key || !pair.value) continue;
    const role = matchProgenitorLabel(pair.key.content);
    if (!role) continue;
    const value = String(pair.value.content || '').trim();
    if (!value) continue;
    const confidence = Number(pair.confidence || 0);
    if (role === 'father' && !fatherName) {
      fatherName = value;
      confidences.push(confidence);
    } else if (role === 'mother' && !motherName) {
      motherName = value;
      confidences.push(confidence);
    }
  }
  const confidence = confidences.length
    ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100)
    : 0;
  return {
    fields: { fatherName, motherName },
    confidence
  };
}

async function analyzeRegistroCivilWithAzure(file) {
  /* Uses Azure Document Intelligence prebuilt-document (generic key-value
     extractor) to pull the parent names out of a Colombian registro civil.
     Falls back to an empty result when Azure isn't configured or the call
     fails so the user can still type the names manually. */
  const endpoint = String(process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT || '').replace(/\/+$/, '');
  const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY || '';
  if (!endpoint || !key) {
    return { configured: false, fields: { fatherName: '', motherName: '' }, confidence: 0 };
  }

  const modelId = 'prebuilt-document';
  const apiVersion = process.env.AZURE_DOCUMENT_INTELLIGENCE_API_VERSION || '2024-11-30';
  const analyzeUrl =
    `${endpoint}/documentintelligence/documentModels/${encodeURIComponent(modelId)}` +
    `:analyze?api-version=${encodeURIComponent(apiVersion)}&features=keyValuePairs`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(analyzeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': file.contentType,
        'Ocp-Apim-Subscription-Key': key
      },
      body: file.buffer,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Azure Document Intelligence returned ${response.status}: ${detail.slice(0, 240)}`);
  }

  const operationLocation = response.headers.get('operation-location');
  if (!operationLocation) throw new Error('Azure did not return an operation-location header');

  for (let attempt = 0; attempt < 15; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 700 + attempt * 100));
    const poll = await fetch(operationLocation, {
      headers: { 'Ocp-Apim-Subscription-Key': key }
    });
    if (!poll.ok) throw new Error(`Azure analysis polling returned ${poll.status}`);
    const result = await poll.json();
    if (result.status === 'succeeded') {
      return { configured: true, ...parseRegistroCivilResult(result) };
    }
    if (result.status === 'failed') {
      throw new Error('Azure could not analyze the registro civil');
    }
  }
  throw new Error('Azure registro civil analysis timed out');
}

function normalizeGuest(body, extracted) {
  const source = { ...(extracted || {}) };
  const manual = (body && body.guest) || {};
  Object.keys(manual).forEach(key => {
    if (manual[key] !== undefined && manual[key] !== null && String(manual[key]).trim() !== '') {
      source[key] = manual[key];
    }
  });
  /* documentType is normalized onto the SIRE/TRA canonical list; keep the raw
     value only when it can't be mapped so validateGuest can flag it. */
  const documentType = normalizeDocumentType(source.documentType) ||
    cleanText(source.documentType, 60);
  return {
    firstName: cleanText(source.firstName, 100),
    lastName: cleanText(source.lastName, 100),
    documentType,
    documentNumber: cleanText(source.documentNumber, 80),
    birthDate: cleanText(source.birthDate, 20),
    expirationDate: cleanText(source.expirationDate, 20),
    nationality: cleanText(source.nationality, 80),
    sex: normalizeSex(source.sex) || cleanText(source.sex, 30),
    address: cleanText(source.address, 220),
    email: cleanText(source.email, 254),
    phone: cleanText(source.phone, 50),
    arrivalTime: cleanText(source.arrivalTime, 20),
    notes: cleanText(source.notes, 1000),
    /* SIRE/TRA capture — raw material only; we do not build the SIRE/TRA
       submission yet, just persist these so it can be assembled later. */
    occupation: cleanText(source.occupation, 120),
    birthPlace: cleanText(source.birthPlace, 160),
    residenceCountry: cleanText(source.residenceCountry, 80),
    residenceState: cleanText(source.residenceState, 120),
    residenceCity: cleanText(source.residenceCity, 120),
    originCountry: cleanText(source.originCountry, 80),
    originState: cleanText(source.originState, 120),
    originCity: cleanText(source.originCity, 120),
    destination: cleanText(source.destination, 160),
    privacyAccepted: Boolean(source.privacyAccepted)
  };
}

function isForeignGuest(guest) {
  /* A guest is foreign (extranjero) for SIRE/TRA purposes when their nationality
     is anything other than Colombia. Used to gate the "destino" requirement. */
  const nat = normalizeAccentless(guest && guest.nationality);
  if (!nat) return false;
  return !['colombia', 'colombiano', 'colombiana', 'co', 'col'].includes(nat);
}

function normalizeMarketingConsent(body) {
  /* Separate, opt-in marketing consent (distinct from the operational privacy
     acceptance). We persist whether it was accepted plus the timestamp and the
     channel so we can prove the opt-in. Default OFF. */
  const raw = (body && body.marketingConsent) || {};
  const accepted = Boolean(
    (body && body.marketingAccepted) || raw.accepted || raw === true
  );
  if (!accepted) return { accepted: false };
  return {
    accepted: true,
    acceptedAt: new Date().toISOString(),
    channel: cleanText((raw && raw.channel) || (body && body.marketingChannel) || 'guest-app', 40)
  };
}

function validateGuest(guest, { isMinor = false } = {}) {
  /* For minors (age < 18), email, phone and the privacy acceptance are
     collected from the responsible adult, not from the minor themselves. */
  const required = [
    'firstName',
    'lastName',
    'documentType',
    'documentNumber',
    'birthDate',
    'nationality',
    ...(isMinor ? [] : ['email', 'phone'])
  ];
  const missing = required.filter(key => !guest[key]);
  const warnings = [];
  /* documentType must be one of the SIRE/TRA canonical types. If present but not
     recognized, treat it as missing so the guest re-selects a valid option. */
  if (guest.documentType && !VALID_DOCUMENT_TYPES.includes(guest.documentType)) {
    missing.push('documentType');
  }
  /* Foreign guests must declare their destination (destino) for TRA. */
  if (isForeignGuest(guest) && !guest.destination) {
    missing.push('destination');
  }
  if (guest.documentType === 'Pasaporte' && !guest.expirationDate) {
    missing.push('expirationDate');
  }
  if (guest.expirationDate) {
    const expiry = new Date(`${guest.expirationDate}T23:59:59`);
    if (!Number.isNaN(expiry.getTime()) && expiry < new Date()) {
      warnings.push('El documento aparece vencido.');
    }
  }
  if (guest.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest.email)) {
    warnings.push('El correo electrónico no tiene un formato válido.');
  }
  if (!isMinor && !guest.privacyAccepted) missing.push('privacyAccepted');
  return { valid: missing.length === 0 && warnings.length === 0, missing, warnings };
}

function calculateAge(birthDate) {
  /* Returns integer age in years for an ISO-style YYYY-MM-DD string. Returns
     0 when birthDate is empty or unparseable so callers never see NaN. */
  if (!birthDate) return 0;
  const value = String(birthDate).trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return 0;
  const [y, mo, d] = value.slice(0, 10).split('-').map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > new Date(y, mo, 0).getDate()) return 0;
  const birth = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return 0;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age -= 1;
  return Math.max(0, age);
}

async function normalizeGuestEntry(entry, index, session) {
  const file = decodeFile(entry && entry.file) || await fileFromDraftRef(session, entry && entry.documentRef);
  if (!file) {
    throw Object.assign(new Error(`Selecciona una foto o PDF del documento para el huésped ${index + 1}.`), { statusCode: 400 });
  }
  const guest = normalizeGuest({ guest: (entry && entry.guest) || {} }, {});
  const analysisSource = cleanText(
    (entry && (entry.analysisSource || entry.documentAnalysis)) ||
    (entry && entry.file && entry.file.analysisSource) ||
    'manual',
    40
  );
  /* OCR attempt budget: the client increments ocrAttempts on each Azure read it
     fires. When the document was never recognized by Azure ('azure' source) and
     the guest has exhausted MAX_OCR_ATTEMPTS, we do NOT hard-reject: we accept
     the typed data and flag the entry for manual verification by reception. */
  const ocrAttempts = Math.max(0, Math.floor(Number((entry && entry.ocrAttempts) || 0)) || 0);
  const ocrRecognized = analysisSource === 'azure';
  const needsManualReview = !ocrRecognized && ocrAttempts >= MAX_OCR_ATTEMPTS;
  return {
    guest,
    file,
    isMinor: guest.birthDate ? calculateAge(guest.birthDate) < 18 : false,
    isPrimary: Boolean(entry && entry.isPrimary),
    analysisSource,
    ocrAttempts,
    needsManualReview,
    confidence: Number((entry && entry.confidence) || 0),
    registroCivilDocumentRef: (entry && entry.registroCivilDocumentRef) || null,
    authorizationDocumentRef: (entry && entry.authorizationDocumentRef) || null,
    fatherName: cleanText(entry && entry.fatherName, 160),
    motherName: cleanText(entry && entry.motherName, 160)
  };
}

function guestArchiveName(guest) {
  return cleanText(`${guest.firstName || ''} ${guest.lastName || ''}`.trim() || 'huesped', 120);
}

async function normalizeSubmitGuests(body, session) {
  const rawGuests = Array.isArray(body.guests) ? body.guests : [];
  if (!rawGuests.length) {
    throw Object.assign(new Error('Registra al menos un huésped para completar el check-in.'), { statusCode: 400 });
  }
  const capacityLimit = Number(session && session.capacity);
  const maxGuests = Number.isFinite(capacityLimit) && capacityLimit > 0
    ? Math.min(MAX_GUESTS, capacityLimit)
    : 1;
  if (rawGuests.length > maxGuests) {
    throw Object.assign(new Error(`Puedes registrar máximo ${maxGuests} huéspedes para esta reserva.`), { statusCode: 400 });
  }
  const entries = await Promise.all(rawGuests.map((entry, index) => normalizeGuestEntry(entry, index, session)));
  if (!entries.some(entry => entry.isPrimary)) entries[0].isPrimary = true;
  return entries.map((entry, index) => ({
    ...entry,
    isPrimary: index === entries.findIndex(item => item.isPrimary)
  }));
}

function validateGuests(entries) {
  const perGuest = entries.map((entry, index) => ({
    index,
    ...validateGuest(entry.guest, { isMinor: entry.isMinor })
  }));
  const missing = perGuest.flatMap(result =>
    result.missing.map(field => `guests.${result.index}.${field}`)
  );
  const warnings = perGuest.flatMap(result =>
    result.warnings.map(warning => `Huésped ${result.index + 1}: ${warning}`)
  );
  return {
    valid: missing.length === 0 && warnings.length === 0,
    missing,
    warnings,
    guests: perGuest
  };
}

function normalizeNameKey(value) {
  /* Strips accents, lowercases, collapses non-alphanumerics into single
     spaces. Used on both progenitor names (from registro civil OCR) and
     adult guest names so the comparison is robust to accent/casing/spacing
     differences. */
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function matchProgenitor(progenitorName, adultEntries) {
  /* Try to find an adult guest in the same check-in whose name matches the
     father/mother declared on the minor's registro civil. We accept either:
       a) the full progenitor string appears as a substring of the adult's
          full name (or vice-versa), OR
       b) every token of the progenitor name appears in the adult name AND
          at least one shared token has length >= 3 (avoids weak matches on
          tiny tokens like "de" or "la").
     Returns { matched, matchedIndex? }. */
  const target = normalizeNameKey(progenitorName);
  if (!target || !Array.isArray(adultEntries) || !adultEntries.length) return { matched: false };
  const targetTokens = target.split(' ').filter(Boolean);
  if (!targetTokens.length) return { matched: false };
  for (let i = 0; i < adultEntries.length; i += 1) {
    const entry = adultEntries[i];
    const guest = (entry && entry.guest) || {};
    const candidate = normalizeNameKey(`${guest.firstName || ''} ${guest.lastName || ''}`);
    if (!candidate) continue;
    if (target.length >= 3 && (candidate.includes(target) || target.includes(candidate))) {
      return { matched: true, matchedIndex: entry.originalIndex !== undefined ? entry.originalIndex : i };
    }
    const candidateTokens = new Set(candidate.split(' ').filter(Boolean));
    const allPresent = targetTokens.every(token => candidateTokens.has(token));
    if (allPresent && targetTokens.some(token => token.length >= 3)) {
      return { matched: true, matchedIndex: entry.originalIndex !== undefined ? entry.originalIndex : i };
    }
  }
  return { matched: false };
}

function validateMinors(entries) {
  /* For every minor in the check-in we need:
       - registro civil de nacimiento (always)
       - at least one progenitor present as an adult guest OR an authorization
         letter signed by a parent/legal guardian. */
  const adults = entries
    .map((entry, index) => ({ ...entry, originalIndex: index }))
    .filter(entry => !entry.isMinor);
  const missing = [];
  const warnings = [];
  const minorDetails = [];
  entries.forEach((entry, index) => {
    if (!entry.isMinor) return;
    if (!entry.registroCivilDocumentRef) {
      missing.push(`guests.${index}.registroCivil`);
    }
    const fatherMatch = matchProgenitor(entry.fatherName, adults);
    const motherMatch = matchProgenitor(entry.motherName, adults);
    const parentMatch = fatherMatch.matched ? fatherMatch : motherMatch;
    const parentPresent = Boolean(parentMatch.matched);
    if (!parentPresent && !entry.authorizationDocumentRef) {
      missing.push(`guests.${index}.authorization`);
    }
    if (!parentPresent && entry.authorizationDocumentRef) {
      warnings.push(`Huésped ${index + 1}: validar firma de la carta de autorización contra los progenitores del registro civil.`);
    }
    minorDetails.push({
      index,
      parentPresent,
      parentMatchedIndex: parentPresent ? parentMatch.matchedIndex : null
    });
  });
  return {
    valid: missing.length === 0,
    missing,
    warnings,
    minors: minorDetails
  };
}

async function maybeIssueDoorCodes(record, session) {
  /* On a completed check-in, optionally issue smart-lock access codes through
     the TTLock module (created by another agent — _ttlock.js). Strictly gated:
       - OFF unless TTLOCK_ENABLED === 'true'
       - the module is required LAZILY inside the try so a missing file never
         breaks the check-in locally or in CI
       - any error is swallowed: door codes are a convenience, never a blocker.
     Returns a small status object for the response; never throws.
     Gestionable desde /admin (override del panel → env). */
  if (!(await flag('TTLOCK_ENABLED'))) {
    return { configured: false, issued: false };
  }
  try {
    // eslint-disable-next-line global-require
    const ttlock = require('./_ttlock');
    if (!ttlock || typeof ttlock.issueAccessCodes !== 'function') {
      return { configured: false, issued: false };
    }
    const result = (await ttlock.issueAccessCodes({
      bookingCode: record.bookingCode,
      checkinId: record.checkinId,
      checkIn: record.reservation && record.reservation.checkIn,
      checkOut: record.reservation && record.reservation.checkOut,
      roomNumber: record.reservation && record.reservation.roomNumber,
      guestName: record.guestName
    })) || {};
    /* The _ttlock module is mock-safe without credentials: it returns
       { isMock: true, codes: [], errors: [] }. We consider codes "issued" only
       when it is not a mock AND at least one code came back. */
    const codes = Array.isArray(result.codes) ? result.codes : [];
    const issued = !result.isMock && result.issued !== false && codes.length > 0;
    return { configured: true, issued, isMock: Boolean(result.isMock), codes: codes.length };
  } catch (error) {
    console.warn('[guest-checkin] TTLock code issuance skipped:', error.message);
    return { configured: true, issued: false, error: String(error.message || '').slice(0, 200) };
  }
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const limited = await checkRateLimit(event, {
    name: 'guest-checkin',
    limit: 12,
    windowMs: 10 * 60 * 1000
  });
  if (!limited.ok) return rateLimitResponse(corsHeaders(), limited.retryAfter);

  try {
    const session = deps.requireGuest(event);
    const body = parseJsonBody(event, 6.2 * 1024 * 1024);
    let mode;
    if (body.mode === 'submit') mode = 'submit';
    else if (body.mode === 'analyze-minor-doc') mode = 'analyze-minor-doc';
    else mode = 'analyze';

    if (mode === 'analyze-minor-doc') {
      const file = decodeFile(body.file);
      if (!file) return json(400, { error: 'Selecciona una foto o PDF del documento del menor.' });
      const docKind = body.docKind === 'autorizacion' ? 'autorizacion' : 'registro-civil';
      const documentRef = await stageDraftDocument(session, file, body.slotIndex, docKind);
      const slotIndex = Number.isInteger(body.slotIndex) ? body.slotIndex : null;

      if (docKind === 'autorizacion') {
        return json(200, {
          ok: true,
          docKind,
          slotIndex,
          documentRef
        });
      }

      let analysis;
      try {
        analysis = await analyzeRegistroCivilWithAzure(file);
      } catch (azureErr) {
        console.warn('[guest-checkin] registro civil analysis failed, falling back to manual:', azureErr.message);
        try {
          await require('./_alert').reportAlert({
            kind: 'ocr_failure', severity: 'warn',
            message: 'Falló el OCR del registro civil (el huésped puede escribir los datos a mano).',
            context: { doc: 'registro-civil', detail: String(azureErr.message || '').slice(0, 200) },
            dedupeKey: 'ocr-registro-civil'
          });
        } catch (_) { /* alert best-effort */ }
        analysis = { configured: true, azureFailed: true, fields: { fatherName: '', motherName: '' }, confidence: 0 };
      }
      const analysisSource = !analysis.configured ? 'manual' : analysis.azureFailed ? 'azure-error' : 'azure';
      return json(200, {
        ok: true,
        docKind,
        source: analysisSource,
        slotIndex,
        documentRef,
        extracted: analysis.fields,
        confidence: analysis.confidence
      });
    }

    if (mode === 'submit') {
      const entries = await normalizeSubmitGuests(body, session);
      const guestValidation = validateGuests(entries);
      const minorValidation = validateMinors(entries);
      const validation = {
        valid: guestValidation.valid && minorValidation.valid,
        missing: [...guestValidation.missing, ...minorValidation.missing],
        warnings: [...guestValidation.warnings, ...minorValidation.warnings],
        guests: guestValidation.guests,
        minors: minorValidation.minors
      };

      if (!validation.valid) {
        return json(422, {
          error: 'Revisa los campos requeridos antes de completar el check-in.',
          validation
        });
      }

      /* Load the registro civil / authorization buffers from the drafts
         store so we can persist them and forward to Drive. We do this BEFORE
         building the record so each minor entry carries its attached files. */
      const minorByIndex = new Map(minorValidation.minors.map(m => [m.index, m]));
      const minorPayloads = await Promise.all(entries.map(async (entry, index) => {
        if (!entry.isMinor) return null;
        const rcnFile = await fileFromDraftRef(session, entry.registroCivilDocumentRef);
        const authFile = entry.authorizationDocumentRef
          ? await fileFromDraftRef(session, entry.authorizationDocumentRef)
          : null;
        if (!rcnFile) {
          throw Object.assign(
            new Error(`No fue posible recuperar el registro civil del menor ${index + 1}. Vuelve a subirlo.`),
            { statusCode: 400 }
          );
        }
        return { index, rcnFile, authFile };
      }));

      const checkinId = `CHK-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const createdAt = new Date().toISOString();
      const primaryEntry = entries.find(entry => entry.isPrimary) || entries[0];
      const minorPayloadByIndex = new Map(
        minorPayloads.filter(Boolean).map(payload => [payload.index, payload])
      );
      /* Reservation context comes from the SIGNED token, not the client body, so
         the SIRE/TRA record stores values reception can trust. Pre-existing
         tokens (issued before this change) simply carry empty strings. */
      const reservation = {
        checkIn: cleanText(session.checkIn, 20),
        checkOut: cleanText(session.checkOut, 20),
        roomNumber: cleanText(session.roomNumber, 40),
        motive: cleanText(session.motive, 160)
      };
      const marketingConsent = normalizeMarketingConsent(body);
      /* Any guest whose document never passed OCR after the attempt budget needs
         a human to verify the typed data on arrival. */
      const manualReview = entries.some(entry => entry.needsManualReview);
      const record = {
        type: 'guest_checkin',
        checkinId,
        bookingCode: session.sub,
        guestName: guestArchiveName(primaryEntry.guest),
        guest: primaryEntry.guest,
        reservation,
        marketingConsent,
        manualReview,
        guests: entries.map((entry, index) => {
          const minorDetail = minorByIndex.get(index);
          const minorPayload = minorPayloadByIndex.get(index);
          const guestRecord = {
            guest: entry.guest,
            document: {
              name: entry.file.name,
              contentType: entry.file.contentType,
              size: entry.file.size,
              analysisSource: entry.analysisSource,
              confidence: entry.confidence,
              ocrAttempts: entry.ocrAttempts,
              needsManualReview: entry.needsManualReview
            },
            isPrimary: entry.isPrimary,
            guestIndex: index,
            isMinor: entry.isMinor
          };
          if (entry.isMinor && minorPayload) {
            guestRecord.minorDocuments = {
              registroCivil: {
                name: minorPayload.rcnFile.name,
                contentType: minorPayload.rcnFile.contentType,
                size: minorPayload.rcnFile.size
              },
              fatherName: entry.fatherName,
              motherName: entry.motherName,
              parentPresent: Boolean(minorDetail && minorDetail.parentPresent),
              parentMatchedIndex: minorDetail && minorDetail.parentPresent
                ? minorDetail.parentMatchedIndex
                : null
            };
            if (minorPayload.authFile) {
              guestRecord.minorDocuments.authorization = {
                name: minorPayload.authFile.name,
                contentType: minorPayload.authFile.contentType,
                size: minorPayload.authFile.size
              };
            }
          }
          return guestRecord;
        }),
        status: 'received',
        createdAt
      };

      await deps.guestStore('guest-checkins').setJSON(checkinId, deps.protectRecord(record));

      let stagedDocument = false;
      if (await flag('GUEST_APP_STORE_DOCUMENTS')) {
        await Promise.all(entries.map((entry, index) => {
          const safeName = entry.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
          /* PII en reposo: el documento de identidad se cifra con la bóveda antes
             de tocar Blobs (antes se guardaba en CLARO). */
          const sealed = deps.sealBinaryForStore(entry.file.buffer, `${session.sub}|guest-document`);
          return deps.guestStore('guest-documents').set(`${checkinId}/${index + 1}-${safeName}`, sealed.value, {
            metadata: {
              bookingCode: session.sub,
              contentType: entry.file.contentType,
              uploadedAt: record.createdAt,
              guestIndex: String(index),
              encrypted: String(sealed.encrypted)
            }
          });
        }));
        stagedDocument = true;
      }

      const archiveResults = await Promise.all(entries.map((entry, index) =>
        deps.archiveGuestPayload({
          kind: 'guest-checkin',
          record,
          guestIndex: index,
          guestName: guestArchiveName(entry.guest),
          file: {
            name: entry.file.name,
            contentType: entry.file.contentType,
            dataBase64: entry.file.buffer.toString('base64')
          }
        })
      ));

      /* Minor documents: persist a binary copy in the dedicated Blobs store
         and archive each file (RCN + optional authorization letter) to Drive
         under the menores subfolder. The shared kinds 'guest-minor-rcn' and
         'guest-minor-authorization' are routed by guest-drive.js. */
      const minorArchiveResults = [];
      if (minorPayloads.some(Boolean)) {
        const minorStore = deps.guestStore('guest-minor-documents');
        for (const payload of minorPayloads) {
          if (!payload) continue;
          const { index, rcnFile, authFile } = payload;
          const rcnExt = extensionForContentType(rcnFile.contentType);
          /* PII sensible de MENOR en reposo: registro civil cifrado con la bóveda
             (antes en CLARO). AAD distinta por tipo de documento. */
          const sealedRcn = deps.sealBinaryForStore(rcnFile.buffer, `${session.sub}|minor-rcn`);
          await minorStore.set(`${checkinId}/${index}/registro-civil${rcnExt}`, sealedRcn.value, {
            metadata: {
              bookingCode: session.sub,
              contentType: rcnFile.contentType,
              uploadedAt: createdAt,
              guestIndex: String(index),
              encrypted: String(sealedRcn.encrypted)
            }
          });
          if (authFile) {
            const authExt = extensionForContentType(authFile.contentType);
            const sealedAuth = deps.sealBinaryForStore(authFile.buffer, `${session.sub}|minor-authorization`);
            await minorStore.set(`${checkinId}/${index}/autorizacion${authExt}`, sealedAuth.value, {
              metadata: {
                bookingCode: session.sub,
                contentType: authFile.contentType,
                uploadedAt: createdAt,
                guestIndex: String(index),
                encrypted: String(sealedAuth.encrypted)
              }
            });
          }

          const rcnArchive = await deps.archiveGuestPayload({
            kind: 'guest-minor-rcn',
            record,
            guestIndex: index,
            guestName: guestArchiveName(entries[index].guest),
            file: {
              name: minorDocumentFileName(index, 'registro-civil', rcnFile.contentType),
              contentType: rcnFile.contentType,
              dataBase64: rcnFile.buffer.toString('base64')
            }
          });
          minorArchiveResults.push(rcnArchive);

          if (authFile) {
            const authArchive = await deps.archiveGuestPayload({
              kind: 'guest-minor-authorization',
              record,
              guestIndex: index,
              guestName: guestArchiveName(entries[index].guest),
              file: {
                name: minorDocumentFileName(index, 'autorizacion', authFile.contentType),
                contentType: authFile.contentType,
                dataBase64: authFile.buffer.toString('base64')
              }
            });
            minorArchiveResults.push(authArchive);
          }
        }
      }

      const sync = await deps.syncGuestEvent(record);

      /* Check-in completed: optionally emit smart-lock codes (gated + lazy). */
      const doorCodes = await maybeIssueDoorCodes(record, session);

      return json(201, {
        ok: true,
        checkinId,
        status: 'received',
        validation,
        manualReview,
        marketingConsent: { accepted: marketingConsent.accepted },
        archive: archiveResults,
        minorArchive: minorArchiveResults,
        sync,
        doorCodes,
        stagedDocument
      });
    }

    const file = decodeFile(body.file);
    if (!file) return json(400, { error: 'Selecciona una foto o PDF del documento.' });

    let analysis;
    try {
      analysis = await analyzeWithAzure(file);
    } catch (azureErr) {
      console.warn('[guest-checkin] Azure analysis failed, falling back to manual:', azureErr.message);
      try {
        await require('./_alert').reportAlert({
          kind: 'ocr_failure', severity: 'warn',
          message: 'Falló el OCR del documento de identidad (el huésped puede escribir los datos a mano).',
          context: { doc: 'id-document', detail: String(azureErr.message || '').slice(0, 200) },
          dedupeKey: 'ocr-id-document'
        });
      } catch (_) { /* alert best-effort */ }
      analysis = { configured: true, azureFailed: true, fields: {}, confidence: 0 };
    }

    const analysisSource = !analysis.configured ? 'manual' : analysis.azureFailed ? 'azure-error' : 'azure';

    const documentRef = await stageDraftDocument(session, file, body.slotIndex);
    const guest = normalizeGuest(body, analysis.fields);
    const validation = validateGuest(guest);

    if (mode === 'analyze') {
      return json(200, {
        ok: true,
        source: analysisSource,
        slotIndex: Number.isInteger(body.slotIndex) ? body.slotIndex : null,
        documentRef,
        extracted: analysis.fields,
        confidence: analysis.confidence,
        validation
      });
    }
    return json(400, { error: 'Modo no soportado.' });
  } catch (error) {
    console.error('[guest-checkin]', error.message);
    /* Alert only on unexpected server errors (no statusCode = internal, e.g.
       Blobs save / Drive archive failed). Client 4xx are expected and noisy. */
    if (!error.statusCode) {
      try {
        await require('./_alert').reportAlert({
          kind: 'guest_checkin_failed', severity: 'error',
          message: 'Falló el guardado del check-in del huésped (no se persistió/archivó el registro).',
          context: { detail: String(error.message || '').slice(0, 200) },
          dedupeKey: 'guest-checkin-save'
        });
      } catch (_) { /* alert best-effort */ }
    }
    return json(error.statusCode || 500, {
      error: error.statusCode ? error.message : 'No fue posible procesar el check-in.'
    });
  }
};
