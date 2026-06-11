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
  syncGuestEvent
} = require('./_guest-app');

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
const defaultDeps = {
  archiveGuestPayload,
  guestStore,
  protectRecord,
  requireGuest,
  syncGuestEvent
};
const deps = { ...defaultDeps };

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
      documentType: inferredDocumentType,
      birthDate: birthDate.value,
      expirationDate: expirationDate.value,
      nationality: inferredNationality,
      sex: sex.value,
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
  return {
    firstName: cleanText(source.firstName, 100),
    lastName: cleanText(source.lastName, 100),
    documentType: cleanText(source.documentType, 60),
    documentNumber: cleanText(source.documentNumber, 80),
    birthDate: cleanText(source.birthDate, 20),
    expirationDate: cleanText(source.expirationDate, 20),
    nationality: cleanText(source.nationality, 80),
    sex: cleanText(source.sex, 30),
    address: cleanText(source.address, 220),
    email: cleanText(source.email, 254),
    phone: cleanText(source.phone, 50),
    arrivalTime: cleanText(source.arrivalTime, 20),
    notes: cleanText(source.notes, 1000),
    privacyAccepted: Boolean(source.privacyAccepted)
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
  return {
    guest,
    file,
    isMinor: guest.birthDate ? calculateAge(guest.birthDate) < 18 : false,
    isPrimary: Boolean(entry && entry.isPrimary),
    analysisSource: cleanText(
      (entry && (entry.analysisSource || entry.documentAnalysis)) ||
      (entry && entry.file && entry.file.analysisSource) ||
      'manual',
      40
    ),
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
      const record = {
        type: 'guest_checkin',
        checkinId,
        bookingCode: session.sub,
        guestName: guestArchiveName(primaryEntry.guest),
        guest: primaryEntry.guest,
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
              confidence: entry.confidence
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
      if (process.env.GUEST_APP_STORE_DOCUMENTS === 'true') {
        await Promise.all(entries.map((entry, index) => {
          const safeName = entry.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
          return deps.guestStore('guest-documents').set(`${checkinId}/${index + 1}-${safeName}`, entry.file.buffer, {
            metadata: {
              bookingCode: session.sub,
              contentType: entry.file.contentType,
              uploadedAt: record.createdAt,
              guestIndex: String(index)
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
          await minorStore.set(`${checkinId}/${index}/registro-civil${rcnExt}`, rcnFile.buffer, {
            metadata: {
              bookingCode: session.sub,
              contentType: rcnFile.contentType,
              uploadedAt: createdAt,
              guestIndex: String(index)
            }
          });
          if (authFile) {
            const authExt = extensionForContentType(authFile.contentType);
            await minorStore.set(`${checkinId}/${index}/autorizacion${authExt}`, authFile.buffer, {
              metadata: {
                bookingCode: session.sub,
                contentType: authFile.contentType,
                uploadedAt: createdAt,
                guestIndex: String(index)
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

      return json(201, {
        ok: true,
        checkinId,
        status: 'received',
        validation,
        archive: archiveResults,
        minorArchive: minorArchiveResults,
        sync,
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
    return json(error.statusCode || 500, {
      error: error.statusCode ? error.message : 'No fue posible procesar el check-in.'
    });
  }
};
