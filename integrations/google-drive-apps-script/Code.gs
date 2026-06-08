const SCRIPT_PROPERTIES = PropertiesService.getScriptProperties();

function doGet() {
  return jsonResponse({
    ok: true,
    service: 'estar-guest-drive',
    timestamp: new Date().toISOString()
  });
}

function doPost(event) {
  try {
    const envelope = JSON.parse((event && event.postData && event.postData.contents) || '{}');
    const expectedSecret = SCRIPT_PROPERTIES.getProperty('WEBHOOK_SECRET');
    if (!expectedSecret || envelope.secret !== expectedSecret) {
      return jsonResponse({ ok: false, error: 'Unauthorized' });
    }

    const rootFolderId = SCRIPT_PROPERTIES.getProperty('ROOT_FOLDER_ID');
    if (!rootFolderId) {
      return jsonResponse({ ok: false, error: 'ROOT_FOLDER_ID is not configured' });
    }

    const payload = envelope.payload || {};
    const record = payload.record || {};
    const bookingCode = sanitizeName(record.bookingCode || 'sin-reserva');
    const root = DriveApp.getFolderById(rootFolderId);
    const reservationFolder = getOrCreateFolder(root, bookingCode);

    const metadataFolder = getOrCreateFolder(reservationFolder, '00_metadata');
    const metadataFile = metadataFolder.createFile(
      Utilities.newBlob(
        JSON.stringify(stripLargePayload(payload), null, 2),
        'application/json',
        new Date().toISOString() + '-' + sanitizeName(payload.kind || 'evento') + '.json'
      )
    );

    if (payload.kind === 'guest-checkin') {
      return jsonResponse({
        ok: true,
        kind: payload.kind,
        metadata: fileInfo(metadataFile),
        document: savePayloadFile(reservationFolder, payload, '01_documentos', 'documento')
      });
    }

    if (payload.kind === 'guest-contract') {
      return jsonResponse({
        ok: true,
        kind: payload.kind,
        metadata: fileInfo(metadataFile),
        contract: createContractPdf(reservationFolder, record)
      });
    }

    if (payload.kind === 'guest-invoice') {
      return jsonResponse({
        ok: true,
        kind: payload.kind,
        metadata: fileInfo(metadataFile),
        invoice: savePayloadFile(reservationFolder, payload, '03_facturas', 'factura')
      });
    }

    return jsonResponse({
      ok: true,
      kind: payload.kind || 'unknown',
      metadata: fileInfo(metadataFile)
    });
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message });
  }
}

function savePayloadFile(reservationFolder, payload, folderName, fallbackName) {
  const file = payload.file || {};
  if (!file.dataBase64) return null;

  const targetFolder = getOrCreateFolder(reservationFolder, folderName);
  const bytes = Utilities.base64Decode(file.dataBase64);
  const name = sanitizeName(file.name || fallbackName + '-' + new Date().toISOString());
  const blob = Utilities.newBlob(bytes, file.contentType || 'application/octet-stream', name);
  const driveFile = targetFolder.createFile(blob);
  return fileInfo(driveFile);
}

function createContractPdf(reservationFolder, record) {
  const contractsFolder = getOrCreateFolder(reservationFolder, '02_contratos');
  const bookingCode = record.bookingCode || 'sin-reserva';
  const signedAt = record.signedAt || new Date().toISOString();
  const title = 'Contrato ' + sanitizeName(bookingCode) + ' - ' +
    sanitizeName(record.signedName || 'huesped');
  const doc = DocumentApp.create(title);
  const body = doc.getBody();

  body.appendParagraph('Contrato de hospedaje Estar').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph('Reserva: ' + bookingCode);
  body.appendParagraph('Firmante: ' + (record.signedName || ''));
  body.appendParagraph('Fecha de firma: ' + signedAt);
  body.appendParagraph('Version del contrato: ' + (record.contractVersion || ''));
  body.appendParagraph('');
  body.appendParagraph(record.consentText || 'Firma electronica simple aceptada desde la guest app.');
  body.appendParagraph('');
  body.appendParagraph('Evidencia tecnica').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph(JSON.stringify({
    eventId: record.eventId,
    acceptedTerms: record.acceptedTerms,
    status: record.status,
    createdAt: record.createdAt
  }, null, 2));
  doc.saveAndClose();

  const docFile = DriveApp.getFileById(doc.getId());
  const pdfBlob = docFile.getAs(MimeType.PDF).setName(title + '.pdf');
  const pdfFile = contractsFolder.createFile(pdfBlob);
  docFile.setTrashed(true);
  return fileInfo(pdfFile);
}

function stripLargePayload(payload) {
  const copy = JSON.parse(JSON.stringify(payload || {}));
  if (copy.file && copy.file.dataBase64) {
    copy.file.dataBase64 = '[omitted ' + copy.file.dataBase64.length + ' base64 chars]';
  }
  return copy;
}

function getOrCreateFolder(parent, name) {
  const safeName = sanitizeName(name);
  const folders = parent.getFoldersByName(safeName);
  return folders.hasNext() ? folders.next() : parent.createFolder(safeName);
}

function sanitizeName(value) {
  return String(value || 'sin-nombre')
    .replace(/[\\/:*?"<>|#%\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'sin-nombre';
}

function fileInfo(file) {
  if (!file) return null;
  return {
    id: file.getId(),
    name: file.getName(),
    url: file.getUrl(),
    mimeType: file.getMimeType()
  };
}

function jsonResponse(body) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}
