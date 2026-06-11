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

function validateGuest(guest) {
  const required = [
    'firstName',
    'lastName',
    'documentType',
    'documentNumber',
    'birthDate',
    'nationality',
    'email',
    'phone'
  ];
  const missing = required.filter(key => !guest[key]);
  const warnings = [];
  if (guest.expirationDate) {
    const expiry = new Date(`${guest.expirationDate}T23:59:59`);
    if (!Number.isNaN(expiry.getTime()) && expiry < new Date()) {
      warnings.push('El documento aparece vencido.');
    }
  }
  if (guest.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest.email)) {
    warnings.push('El correo electrónico no tiene un formato válido.');
  }
  if (!guest.privacyAccepted) missing.push('privacyAccepted');
  return { valid: missing.length === 0 && warnings.length === 0, missing, warnings };
}

function normalizeGuestEntry(entry, index) {
  const file = decodeFile(entry && entry.file);
  if (!file) {
    throw Object.assign(new Error(`Selecciona una foto o PDF del documento para el huésped ${index + 1}.`), { statusCode: 400 });
  }
  const guest = normalizeGuest({ guest: (entry && entry.guest) || {} }, {});
  return {
    guest,
    file,
    isPrimary: Boolean(entry && entry.isPrimary),
    analysisSource: cleanText(
      (entry && (entry.analysisSource || entry.documentAnalysis)) ||
      (entry && entry.file && entry.file.analysisSource) ||
      'manual',
      40
    ),
    confidence: Number((entry && entry.confidence) || 0)
  };
}

function guestArchiveName(guest) {
  return cleanText(`${guest.firstName || ''} ${guest.lastName || ''}`.trim() || 'huesped', 120);
}

function normalizeSubmitGuests(body) {
  const rawGuests = Array.isArray(body.guests) ? body.guests : [];
  if (!rawGuests.length) {
    throw Object.assign(new Error('Registra al menos un huésped para completar el check-in.'), { statusCode: 400 });
  }
  if (rawGuests.length > MAX_GUESTS) {
    throw Object.assign(new Error('Puedes registrar máximo 5 huéspedes por reserva.'), { statusCode: 400 });
  }
  const entries = rawGuests.map((entry, index) => normalizeGuestEntry(entry, index));
  if (!entries.some(entry => entry.isPrimary)) entries[0].isPrimary = true;
  return entries.map((entry, index) => ({
    ...entry,
    isPrimary: index === entries.findIndex(item => item.isPrimary)
  }));
}

function validateGuests(entries) {
  const perGuest = entries.map((entry, index) => ({
    index,
    ...validateGuest(entry.guest)
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
    const body = parseJsonBody(event, 32 * 1024 * 1024);
    const mode = body.mode === 'submit' ? 'submit' : 'analyze';

    if (mode === 'submit') {
      const entries = normalizeSubmitGuests(body);
      const validation = validateGuests(entries);

      if (!validation.valid) {
        return json(422, {
          error: 'Revisa los campos requeridos antes de completar el check-in.',
          validation
        });
      }

      const checkinId = `CHK-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const createdAt = new Date().toISOString();
      const record = {
        type: 'guest_checkin',
        checkinId,
        bookingCode: session.sub,
        guests: entries.map((entry, index) => ({
          guest: entry.guest,
          document: {
            name: entry.file.name,
            contentType: entry.file.contentType,
            size: entry.file.size,
            analysisSource: entry.analysisSource,
            confidence: entry.confidence
          },
          isPrimary: entry.isPrimary,
          guestIndex: index
        })),
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
      const sync = await deps.syncGuestEvent(record);

      return json(201, {
        ok: true,
        checkinId,
        status: 'received',
        validation,
        archive: archiveResults,
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

    const guest = normalizeGuest(body, analysis.fields);
    const validation = validateGuest(guest);

    if (mode === 'analyze') {
      return json(200, {
        ok: true,
        source: analysisSource,
        slotIndex: Number.isInteger(body.slotIndex) ? body.slotIndex : null,
        extracted: analysis.fields,
        confidence: analysis.confidence,
        validation
      });
    }
  } catch (error) {
    console.error('[guest-checkin]', error.message);
    return json(error.statusCode || 500, {
      error: error.statusCode ? error.message : 'No fue posible procesar el check-in.'
    });
  }
};
