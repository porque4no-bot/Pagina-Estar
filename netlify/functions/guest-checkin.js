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
  const values = [
    firstName,
    lastName,
    documentNumber,
    birthDate,
    expirationDate,
    nationality
  ].filter(item => item.value);

  return {
    fields: {
      firstName: firstName.value,
      lastName: lastName.value,
      documentNumber: documentNumber.value,
      documentType: documentType.value || (document ? document.docType : ''),
      birthDate: birthDate.value,
      expirationDate: expirationDate.value,
      nationality: nationality.value,
      sex: sex.value,
      address: address.value
    },
    confidence: values.length
      ? Math.round((values.reduce((sum, item) => sum + item.confidence, 0) / values.length) * 100)
      : 0
  };
}

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
    const session = requireGuest(event);
    const body = parseJsonBody(event, 6.2 * 1024 * 1024);
    const mode = body.mode === 'submit' ? 'submit' : 'analyze';
    const file = decodeFile(body.file);
    if (!file) return json(400, { error: 'Selecciona una foto o PDF del documento.' });

    let analysis;
    try {
      analysis = await analyzeWithAzure(file);
    } catch (azureErr) {
      console.warn('[guest-checkin] Azure analysis failed, falling back to manual:', azureErr.message);
      analysis = { configured: false, fields: {}, confidence: 0 };
    }
    const guest = normalizeGuest(body, analysis.fields);
    const validation = validateGuest(guest);

    if (mode === 'analyze') {
      return json(200, {
        ok: true,
        source: analysis.configured ? 'azure' : 'manual',
        extracted: analysis.fields,
        confidence: analysis.confidence,
        validation
      });
    }

    if (!validation.valid) {
      return json(422, {
        error: 'Revisa los campos requeridos antes de completar el check-in.',
        extracted: analysis.fields,
        confidence: analysis.confidence,
        validation
      });
    }

    const checkinId = `CHK-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const record = {
      type: 'guest_checkin',
      checkinId,
      bookingCode: session.sub,
      guest,
      document: {
        name: file.name,
        contentType: file.contentType,
        size: file.size,
        analysisSource: analysis.configured ? 'azure' : 'manual',
        confidence: analysis.confidence
      },
      status: 'received',
      createdAt: new Date().toISOString()
    };

    await guestStore('guest-checkins').setJSON(checkinId, protectRecord(record));

    let stagedDocument = false;
    if (process.env.GUEST_APP_STORE_DOCUMENTS === 'true') {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      await guestStore('guest-documents').set(`${checkinId}/${safeName}`, file.buffer, {
        metadata: {
          bookingCode: session.sub,
          contentType: file.contentType,
          uploadedAt: record.createdAt
        }
      });
      stagedDocument = true;
    }

    const archive = await archiveGuestPayload({
      kind: 'guest-checkin',
      record,
      file: {
        name: file.name,
        contentType: file.contentType,
        dataBase64: file.buffer.toString('base64')
      }
    });
    const sync = await syncGuestEvent(record);

    return json(201, {
      ok: true,
      checkinId,
      status: 'received',
      validation,
      documentAnalysis: analysis.configured ? 'azure' : 'manual',
      archive,
      sync,
      stagedDocument
    });
  } catch (error) {
    console.error('[guest-checkin]', error.message);
    return json(error.statusCode || 500, {
      error: error.statusCode ? error.message : 'No fue posible procesar el check-in.'
    });
  }
};
