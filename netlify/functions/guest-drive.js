const crypto = require('crypto');
const { corsHeaders, json, parseJsonBody } = require('./_guest-app');
const driveSA = require('./_google-drive');
const { renderContractPDF } = require('./_pdf-render');
const { getSessionKey, otasyncCreds, hasOtasyncCreds } = require('./_otasync');

function bearerToken(event) {
  const headers = event.headers || {};
  const auth = headers.authorization || headers.Authorization || '';
  const match = String(auth).match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

function timingSafeMatch(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sanitizeName(value) {
  return String(value || 'sin-nombre')
    .replace(/[\\/:*?"<>|#% -]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'sin-nombre';
}

function stripLargePayloadForMetadata(payload) {
  const copy = JSON.parse(JSON.stringify(payload || {}));
  if (copy.file && copy.file.dataBase64) {
    copy.file.dataBase64 = `[omitted ${copy.file.dataBase64.length} base64 chars]`;
  }
  return copy;
}

/* Maps payload.kind to the subfolder where its file belongs. Matches the
   folder structure the legacy Apps Script created so manual review of older
   reservations and new ones stays consistent. */
function fileSubfolderForKind(kind) {
  switch (kind) {
    case 'guest-checkin': return '01_documentos';
    case 'guest-invoice': return '03_facturas';
    case 'guest-contract': return '02_contratos';
    default: return '04_otros';
  }
}

function guestDocumentFolderName(payload) {
  if (!payload || payload.kind !== 'guest-checkin') return '';
  if (payload.guestIndex === undefined && !payload.guestName) return '';
  const number = String(Number(payload.guestIndex || 0) + 1).padStart(2, '0');
  return `${number}_${sanitizeName(payload.guestName || 'huesped')}`;
}

/* Fetches the reservation from OTASync and merges its fields into the
   contract record. Guest-app-provided values (name, documentType, signedAt,
   etc.) are never overwritten — OTASync only fills in what is empty/missing.
   Failures are swallowed so a PMS outage never blocks the contract upload. */
async function enrichContractRecord(record) {
  const bookingCode = String(record.bookingCode || '').trim();
  if (!bookingCode || !hasOtasyncCreds()) return record;

  try {
    const creds = otasyncCreds();
    const pkey = await getSessionKey();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let raw;
    try {
      const res = await fetch('https://app.otasync.me/api/reservation/data/reservation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: pkey, token: creds.token, id_properties: creds.propertyId, id_reservations: bookingCode }),
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!res.ok) return record;
      raw = await res.json();
    } catch (e) { clearTimeout(timer); return record; }

    if (!raw || !raw.id_reservations) return record;

    const room = Array.isArray(raw.rooms) && raw.rooms.length > 0 ? raw.rooms[0] : {};
    const guest = Array.isArray(raw.guests) && raw.guests.length > 0 ? raw.guests[0] : {};

    const fill = (key, value) => {
      if (record[key] === undefined || record[key] === null || record[key] === '') {
        if (value !== undefined && value !== null && value !== '') record[key] = value;
      }
    };

    fill('checkIn',         raw.date_arrival  || raw.checkin  || '');
    fill('checkOut',        raw.date_departure || raw.checkout || '');
    fill('roomName',        room.room_type || room.name || '');
    fill('capacity',        raw.total_guests || raw.adults || '');
    fill('totalAmount',     parseFloat(raw.total_price || raw.rooms_price || 0) || '');
    fill('paymentProvider', raw.payment_method || raw.channel || '');
    fill('transactionId',   raw.id_payment || raw.payment_reference || '');
    fill('guestName',       `${guest.first_name || ''} ${guest.last_name || ''}`.trim());
    fill('documentNumber',  guest.document_id || guest.id_document || guest.passport || '');
    fill('phone',           guest.phone || guest.mobile || '');
    fill('email',           guest.email || '');

    return record;
  } catch (e) {
    console.warn('[guest-drive] enrichContractRecord failed (non-blocking):', e.message);
    return record;
  }
}

async function uploadViaServiceAccount(payload) {
  const record = (payload && payload.record) || {};
  const kind = (payload && payload.kind) || 'evento';
  const bookingCode = sanitizeName(record.bookingCode || 'sin-reserva');
  const rootId = driveSA.rootFolderId();
  if (!rootId) throw new Error('GOOGLE_DRIVE_FOLDER_ID is not configured');

  const reservationFolderId = await driveSA.findOrCreateFolder({ parentId: rootId, name: bookingCode });
  const metadataFolderId = await driveSA.findOrCreateFolder({ parentId: reservationFolderId, name: '00_metadata' });

  /* Always persist a metadata JSON entry per event so the operations team can
     trace what happened even when the payload had no file attached. */
  const metadataName = `${new Date().toISOString().replace(/[:.]/g, '-')}-${sanitizeName(kind)}.json`;
  const metadataBody = Buffer.from(
    JSON.stringify(stripLargePayloadForMetadata(payload), null, 2),
    'utf8'
  );
  const metadataFile = await driveSA.uploadFile({
    folderId: metadataFolderId,
    name: metadataName,
    mimeType: 'application/json',
    body: metadataBody
  });

  /* If the payload carries a binary file (check-in document, invoice, etc.),
     decode and upload into the matching sub-folder. */
  let documentFile = null;
  const file = payload && payload.file;
  if (file && file.dataBase64) {
    let subFolderId = await driveSA.findOrCreateFolder({
      parentId: reservationFolderId,
      name: fileSubfolderForKind(kind)
    });
    const guestFolder = guestDocumentFolderName(payload);
    if (guestFolder) {
      subFolderId = await driveSA.findOrCreateFolder({
        parentId: subFolderId,
        name: guestFolder
      });
    }
    const docName = sanitizeName(file.name || `${kind}-${new Date().toISOString()}`);
    const buffer = Buffer.from(file.dataBase64, 'base64');
    documentFile = await driveSA.uploadFile({
      folderId: subFolderId,
      name: docName,
      mimeType: file.contentType || 'application/octet-stream',
      body: buffer
    });
  } else if (kind === 'guest-contract') {
    /* guest-contract no trae archivo binario: enriquecemos el record con datos
       de OTASync (fechas, habitación, monto, pago) y generamos el PDF con
       pdfkit. El resultado se sube al subfolder 02_contratos. Si falla, el
       error se propaga al handler para que el fallback a Apps Script entre en
       juego. */
    const subFolderId = await driveSA.findOrCreateFolder({
      parentId: reservationFolderId,
      name: fileSubfolderForKind(kind)
    });
    const enrichedRecord = await enrichContractRecord(record);
    const pdfBuffer = await renderContractPDF(enrichedRecord);
    const docName = sanitizeName(`contrato-${bookingCode}-${new Date().toISOString()}.pdf`);
    documentFile = await driveSA.uploadFile({
      folderId: subFolderId,
      name: docName,
      mimeType: 'application/pdf',
      body: pdfBuffer
    });
  }

  return {
    ok: true,
    via: 'service-account',
    kind,
    bookingCode,
    metadata: { id: metadataFile.id, name: metadataFile.name, url: metadataFile.webViewLink || null },
    document: documentFile ? { id: documentFile.id, name: documentFile.name, url: documentFile.webViewLink || null } : null
  };
}

async function forwardToAppsScript(payload) {
  const url = process.env.GOOGLE_DRIVE_APPS_SCRIPT_URL || '';
  const secret = process.env.GOOGLE_DRIVE_APPS_SCRIPT_SECRET || '';
  if (!url || !secret) {
    const error = new Error('Google Drive Apps Script is not configured');
    error.statusCode = 503;
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret, payload }),
      signal: controller.signal
    });
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; }
    catch (error) { body = { raw: text.slice(0, 500) }; }
    if (!response.ok || body.ok !== true) {
      const detail = body.error ||
        (body.raw ? 'Apps Script did not return a valid JSON response' : `Apps Script returned ${response.status}`);
      const error = new Error(detail);
      error.statusCode = 502;
      throw error;
    }
    return { ...body, via: 'apps-script' };
  } finally {
    clearTimeout(timeout);
  }
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const expected = process.env.GUEST_APP_DRIVE_WEBHOOK_SECRET || '';
    if (!expected || !timingSafeMatch(bearerToken(event), expected)) {
      return json(401, { error: 'Invalid Drive webhook secret' });
    }

    const payload = parseJsonBody(event, 7 * 1024 * 1024);

    /* Routing strategy:
       - Try service account first (preferred — credentials live in Blobs, not
         in a personal Google account). For guest-contract payloads the SA path
         renders the contract HTML to PDF locally with puppeteer-core +
         @sparticuz/chromium, removing the dependency on the legacy Apps Script
         that previously generated the PDF from a Google Docs template.
       - Any failure of the service-account path (transient Drive errors, PDF
         render failures, missing credentials, etc.) falls back to Apps Script
         so a problem in the new pipeline never blocks the guest-app workflow.
         Apps Script remains intentionally available as a last-resort safety
         net — see forwardToAppsScript below. */
    const saConfigured = await driveSA.isConfigured();

    if (saConfigured) {
      try {
        const result = await uploadViaServiceAccount(payload);
        return json(201, { ok: true, delivered: true, drive: result });
      } catch (saErr) {
        console.error('[guest-drive] service-account upload failed, falling back to Apps Script:', saErr.message);
      }
    }

    const result = await forwardToAppsScript(payload);
    return json(201, { ok: true, delivered: true, drive: result });
  } catch (error) {
    console.error('[guest-drive]', error.message);
    return json(error.statusCode || 500, {
      error: error.statusCode ? error.message : 'No fue posible archivar en Google Drive.'
    });
  }
};
