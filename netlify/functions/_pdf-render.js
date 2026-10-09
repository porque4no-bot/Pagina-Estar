/* Contract PDF renderer using pdfkit (pure JS, no binary deps).
 *
 * pdfkit ships as ~3 MB of JS with no native code, so Netlify deploys stay
 * fast regardless of how often the function bundle changes.
 *
 * API: renderContractPDF(record) → Promise<Buffer>
 *   record — the payload.record object from a guest-contract event (or the
 *   unsigned contract document for a draft: no signedAt / draft:true).
 *
 * Clauses and the consent wording come from _contract-template.js (single
 * source), in the record's language (lang 'es' | 'en'). When the record carries
 * the signature evidence (signedAt, eventId, contractHash…) the PDF prints it so
 * the guest's copy references the SHA-256 of the exact contract text they read.
 */

const PDFDocument = require('pdfkit');
const { CONTRACT_CLAUSES, CONSENT_TEXT, roomLabel } = require('./_contract-template');

const OLIVE  = '#9b9065';
const INK    = '#1f1f1f';
const MUTED  = '#555555';
const BORDER = '#e1ddca';
const STAMP_BG = '#f6f3e7';
const TERRA = '#af6d3b';

/* ── helpers ─────────────────────────────────────────────────────────────── */

function str(v) { return (v === null || v === undefined) ? '—' : String(v); }

function localeFor(lang) { return lang === 'en' ? 'en-US' : 'es-CO'; }

function formatDate(value, lang) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return str(value);
  try {
    return d.toLocaleString(localeFor(lang), {
      timeZone: 'America/Bogota',
      year: 'numeric', month: 'long', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  } catch { return d.toISOString(); }
}

function formatDateOnly(value, lang) {
  if (!value) return '—';
  /* YYYY-MM-DD → mediodía en Bogotá para que nunca se corra un día. */
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
    ? new Date(`${value}T12:00:00-05:00`)
    : new Date(value);
  if (Number.isNaN(d.getTime())) return str(value);
  try {
    return d.toLocaleDateString(localeFor(lang), {
      timeZone: 'America/Bogota',
      year: 'numeric', month: 'long', day: '2-digit'
    });
  } catch { return d.toISOString().slice(0, 10); }
}

/* DD/MM/AAAA para la tabla de huéspedes (la fecha larga no cabe en la columna). */
function formatDateShort(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : str(value || '—');
}

function formatMoney(amount) {
  if (amount === null || amount === undefined || amount === '') return '—';
  const num = Number(amount);
  if (Number.isNaN(num)) return str(amount);
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency', currency: 'COP', maximumFractionDigits: 0
    }).format(num);
  } catch { return `COP ${num.toLocaleString('es-CO')}`; }
}

function pick(record, ...keys) {
  for (const key of keys) {
    if (record && record[key] !== undefined && record[key] !== null && record[key] !== '') {
      return record[key];
    }
  }
  return '';
}

function normalizeGuestName(guest) {
  return `${pick(guest, 'firstName')} ${pick(guest, 'lastName')}`.trim();
}

function contractGuests(record, fallback) {
  const guests = Array.isArray(record.guests) ? record.guests : [];
  const normalized = guests.map(entry => {
    const guest = entry && entry.guest ? entry.guest : entry;
    return {
      name: normalizeGuestName(guest) || pick(guest, 'guestName', 'signedName') || '—',
      documentType: pick(guest, 'documentType') || '—',
      documentNumber: pick(guest, 'documentNumber', 'documentId') || '—',
      nationality: pick(guest, 'nationality') || '—',
      birthDate: pick(guest, 'birthDate') || '—',
      isPrimary: Boolean(entry && entry.isPrimary)
    };
  }).filter(guest => guest.name !== '—' || guest.documentNumber !== '—');
  return normalized.length ? normalized : [fallback];
}

function primaryContractGuest(record) {
  const guests = Array.isArray(record && record.guests) ? record.guests : [];
  const entry = guests.find(item => item && item.isPrimary) || guests[0];
  return entry && entry.guest ? entry.guest : (entry || {});
}

function contractCapacity(record) {
  const capacity = pick(record, 'capacity');
  if (capacity !== '') return capacity;
  const guests = pick(record, 'guests');
  if (Array.isArray(guests)) return guests.length || '';
  return guests;
}

const PDF_LABELS = {
  es: {
    title: 'Contrato de Hospedaje',
    contractNo: 'Contrato N.º',
    version: 'Versión',
    issued: 'Emitido',
    booking: 'Datos de la reserva',
    bookingCode: 'Código de reserva',
    checkIn: 'Fecha de ingreso (check-in)',
    checkOut: 'Fecha de salida (check-out)',
    room: 'Apartaestudio',
    capacity: 'Capacidad de huéspedes',
    occupants: 'Huéspedes registrados',
    phone: 'Teléfono de contacto',
    email: 'Correo electrónico',
    payment: 'Información de pago',
    total: 'Valor total del hospedaje',
    payMethod: 'Medio de pago',
    txId: 'Identificador de transacción',
    clauses: 'Cláusulas del contrato',
    consent: 'Consentimiento y firma electrónica',
    evidence: 'Evidencia de la firma electrónica',
    eventId: 'ID de evento',
    signer: 'Firmante',
    signedAt: 'Firmado',
    readAt: 'Lectura confirmada',
    ip: 'IP del dispositivo',
    hash: 'Huella SHA-256 del contrato leído',
    acceptance: 'Aceptación',
    yes: 'Sí',
    no: 'No',
    pending: 'Pendiente de firma',
    draft: 'BORRADOR — PENDIENTE DE FIRMA. Este documento no tiene validez hasta que lo firmes en la app.',
    tableHeaders: ['#', 'Nombre', 'Documento', 'Nacionalidad', 'Nacimiento', 'Rol'],
    primary: 'Principal',
    companion: 'Acompañante',
    docFallback: 'Documento de identidad',
    guestFallback: 'Huésped',
    roleHotel: 'RNT 276306 — Manizales, Colombia',
    footer: 'Hotel Estar · RNT 276306 · Manizales, Caldas — Colombia\nDocumento generado automáticamente. Conserve esta copia junto con su comprobante de pago.'
  },
  en: {
    title: 'Hospitality Agreement',
    contractNo: 'Agreement No.',
    version: 'Version',
    issued: 'Issued',
    booking: 'Booking details',
    bookingCode: 'Reservation code',
    checkIn: 'Check-in date',
    checkOut: 'Check-out date',
    room: 'Studio',
    capacity: 'Guest capacity',
    occupants: 'Registered guests',
    phone: 'Contact phone',
    email: 'Email',
    payment: 'Payment information',
    total: 'Total stay value',
    payMethod: 'Payment method',
    txId: 'Transaction ID',
    clauses: 'Contract clauses',
    consent: 'Consent and electronic signature',
    evidence: 'Electronic signature evidence',
    eventId: 'Event ID',
    signer: 'Signer',
    signedAt: 'Signed',
    readAt: 'Reading confirmed',
    ip: 'Device IP',
    hash: 'SHA-256 fingerprint of the contract read',
    acceptance: 'Acceptance',
    yes: 'Yes',
    no: 'No',
    pending: 'Pending signature',
    draft: 'DRAFT — PENDING SIGNATURE. This document is not valid until you sign it in the app.',
    tableHeaders: ['#', 'Name', 'Document', 'Nationality', 'Date of birth', 'Role'],
    primary: 'Primary',
    companion: 'Companion',
    docFallback: 'Identity document',
    guestFallback: 'Guest',
    roleHotel: 'RNT 276306 — Manizales, Colombia',
    footer: 'Hotel Estar · RNT 276306 · Manizales, Caldas — Colombia\nDocument generated automatically. Keep this copy along with your payment receipt.'
  }
};

/* ── layout helpers ──────────────────────────────────────────────────────── */

const MARGIN = 50;

function sectionHeading(doc, title) {
  const y = doc.y + 12;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(OLIVE)
    .text(title, MARGIN, y);
  const lineY = doc.y + 2;
  doc.moveTo(MARGIN, lineY)
    .lineTo(doc.page.width - MARGIN, lineY)
    .strokeColor(BORDER).lineWidth(0.5).stroke();
  doc.y = lineY + 6;
}

function kvRow(doc, label, value) {
  const labelW = 165;
  const valueX = MARGIN + labelW + 8;
  const valueW = doc.page.width - MARGIN - valueX;
  const startY = doc.y;
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(MUTED)
    .text(label, MARGIN, startY, { width: labelW });
  const labelEndY = doc.y;
  doc.font('Helvetica').fontSize(9.5).fillColor(INK)
    .text(str(value), valueX, startY, { width: valueW });
  const valueEndY = doc.y;
  doc.y = Math.max(labelEndY, valueEndY) + 2;
}

function clause(doc, num, title, body) {
  doc.y += 6;
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(OLIVE)
    .text(`${num} — ${title}  `, MARGIN, doc.y, { continued: true });
  doc.font('Helvetica').fillColor(INK)
    .text(body, { align: 'justify', width: doc.page.width - MARGIN * 2 });
  doc.y += 2;
}

function guestTable(doc, guests, labels, lang) {
  const headers = labels.tableHeaders;
  const widths = [22, 124, 108, 78, 78, 68];
  const rowH = 24;
  const drawRow = (cells, y, header = false) => {
    let x = MARGIN;
    cells.forEach((cell, index) => {
      doc.rect(x, y, widths[index], rowH)
        .strokeColor(BORDER)
        .lineWidth(0.5)
        .stroke();
      doc.font(header ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(header ? 8 : 7.8)
        .fillColor(header ? OLIVE : INK)
        .text(str(cell), x + 4, y + 7, { width: widths[index] - 8, height: rowH - 8 });
      x += widths[index];
    });
  };

  let y = doc.y + 2;
  drawRow(headers, y, true);
  y += rowH;
  guests.forEach((guest, index) => {
    if (y + rowH > doc.page.height - MARGIN) {
      doc.addPage();
      y = MARGIN;
      drawRow(headers, y, true);
      y += rowH;
    }
    drawRow([
      index + 1,
      guest.name,
      `${guest.documentType} ${guest.documentNumber}`.trim(),
      guest.nationality,
      formatDateShort(guest.birthDate),
      guest.isPrimary ? labels.primary : labels.companion
    ], y);
    y += rowH;
  });
  doc.y = y + 4;
}

/* ── main renderer ───────────────────────────────────────────────────────── */

function renderContractPDF(record = {}) {
  return new Promise((resolve, reject) => {
    const lang            = pick(record, 'lang') === 'en' ? 'en' : 'es';
    const L               = PDF_LABELS[lang];
    const bookingCode     = pick(record, 'bookingCode') || 'SIN-RESERVA';
    const primaryGuest    = primaryContractGuest(record);
    const primaryName     = normalizeGuestName(primaryGuest);
    const guestName       = pick(record, 'signedName', 'guestName') || primaryName || L.guestFallback;
    const documentType    = pick(record, 'documentType') || pick(primaryGuest, 'documentType') || L.docFallback;
    const documentNumber  = pick(record, 'documentNumber', 'documentId') || pick(primaryGuest, 'documentNumber');
    const phone           = pick(record, 'phone') || pick(primaryGuest, 'phone');
    const email           = pick(record, 'email') || pick(primaryGuest, 'email');
    const checkIn         = pick(record, 'checkIn', 'requestedCheckIn');
    const checkOut        = pick(record, 'checkOut', 'requestedCheckOut');
    const roomName        = roomLabel(record, '');
    const capacity        = contractCapacity(record);
    const totalAmount     = pick(record, 'total', 'totalAmount', 'amount');
    const paymentProvider = pick(record, 'paymentProvider', 'paymentMethod');
    const transactionId   = pick(record, 'transactionId', 'paymentReference');
    const contractVersion = pick(record, 'contractVersion') || 'ESTAR-HOSPEDAJE-2026-01';
    const signedAt        = pick(record, 'signedAt');
    const isDraft         = Boolean(record.draft) || !signedAt;
    const consentText     = pick(record, 'consentText') || CONSENT_TEXT[lang];
    const eventId         = pick(record, 'eventId');
    const guests          = contractGuests(record, {
      name: guestName,
      documentType,
      documentNumber: documentNumber || '—',
      nationality: pick(record, 'nationality') || '—',
      birthDate: pick(record, 'birthDate') || '—',
      isPrimary: true
    });

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      info: {
        Title: `${L.title} — ${bookingCode}`,
        Author: 'Hotel Estar',
        Subject: L.title
      }
    });

    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const contentW = doc.page.width - MARGIN * 2;

    /* ── HEADER ─────────────────────────────────────────────────────────── */
    doc.font('Helvetica-Bold').fontSize(20).fillColor(OLIVE)
      .text('Hotel Estar', MARGIN, MARGIN, { continued: false });
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text(lang === 'en' ? 'STUDIOS — MANIZALES' : 'APARTAESTUDIOS — MANIZALES', MARGIN);

    const metaX = doc.page.width - MARGIN - 160;
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
      .text(L.contractNo, metaX, MARGIN, { width: 160, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK)
      .text(bookingCode, metaX, doc.y, { width: 160, align: 'right' });
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text(`${L.version}: ${contractVersion}`, metaX, doc.y, { width: 160, align: 'right' });
    doc.text(`${L.issued}: ${signedAt ? formatDate(signedAt, lang) : L.pending}`, metaX, doc.y, { width: 160, align: 'right' });

    const headerLineY = Math.max(doc.y, 100) + 6;
    doc.moveTo(MARGIN, headerLineY)
      .lineTo(doc.page.width - MARGIN, headerLineY)
      .strokeColor(OLIVE).lineWidth(1.5).stroke();
    doc.y = headerLineY + 14;

    /* ── TITLE ──────────────────────────────────────────────────────────── */
    doc.font('Helvetica-Bold').fontSize(16).fillColor(INK)
      .text(L.title, MARGIN, doc.y, { width: contentW, align: 'center' });
    doc.y += 8;
    if (isDraft) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(TERRA)
        .text(L.draft, MARGIN, doc.y, { width: contentW, align: 'center' });
    }
    doc.y += 6;

    /* ── DATOS DE LA RESERVA ─────────────────────────────────────────────── */
    sectionHeading(doc, L.booking);
    kvRow(doc, L.bookingCode, bookingCode);
    kvRow(doc, L.checkIn, formatDateOnly(checkIn, lang));
    kvRow(doc, L.checkOut, formatDateOnly(checkOut, lang));
    kvRow(doc, L.room, roomName);
    kvRow(doc, L.capacity, capacity);

    /* ── HUÉSPEDES ───────────────────────────────────────────────────────── */
    sectionHeading(doc, L.occupants);
    guestTable(doc, guests, L, lang);
    kvRow(doc, L.phone, phone);
    kvRow(doc, L.email, email);

    /* ── INFORMACIÓN DE PAGO (solo filas con dato) ───────────────────────── */
    if (totalAmount !== '' || paymentProvider || transactionId) {
      sectionHeading(doc, L.payment);
      if (totalAmount !== '') kvRow(doc, L.total, formatMoney(totalAmount));
      if (paymentProvider) kvRow(doc, L.payMethod, paymentProvider);
      if (transactionId) kvRow(doc, L.txId, transactionId);
    }

    /* ── CLÁUSULAS ───────────────────────────────────────────────────────── */
    sectionHeading(doc, L.clauses);
    CONTRACT_CLAUSES.forEach(c => clause(doc, c.num, c.title[lang], c[lang]));

    /* ── CONSENTIMIENTO ──────────────────────────────────────────────────── */
    sectionHeading(doc, L.consent);
    doc.font('Helvetica').fontSize(9.5).fillColor(INK)
      .text(consentText, MARGIN, doc.y, { width: contentW, align: 'justify' });
    doc.y += 6;

    /* ── EVIDENCIA (firma electrónica, Ley 527) ──────────────────────────── */
    const evidence = isDraft
      ? [`${L.acceptance}: ${L.pending}`]
      : [
        `${L.eventId}: ${str(eventId)}  ·  ${L.acceptance}: ${record.acceptedTerms ? L.yes : L.no}`,
        `${L.signer}: ${guestName}  ·  ${L.signedAt}: ${formatDate(signedAt, lang)}`,
        record.acknowledgedAt ? `${L.readAt}: ${formatDate(record.acknowledgedAt, lang)}` : '',
        record.clientIp && record.clientIp !== 'unknown' ? `${L.ip}: ${record.clientIp}` : '',
        record.contractHash ? `${L.hash}: ${record.contractHash}` : ''
      ].filter(Boolean);
    if (doc.y + 30 + evidence.length * 12 > doc.page.height - MARGIN - 40) doc.addPage();
    sectionHeading(doc, L.evidence);
    const stampY = doc.y;
    const stampH = 12 + evidence.length * 12;
    doc.rect(MARGIN, stampY, contentW, stampH).fill(STAMP_BG);
    doc.moveTo(MARGIN, stampY).lineTo(MARGIN, stampY + stampH)
      .strokeColor(OLIVE).lineWidth(2.5).stroke();
    doc.font('Helvetica').fontSize(8).fillColor(MUTED);
    evidence.forEach((line, index) => {
      doc.text(line, MARGIN + 10, stampY + 6 + index * 12, { width: contentW - 16, lineBreak: false, ellipsis: true });
    });
    doc.y = stampY + stampH + 20;

    /* ── FIRMAS ──────────────────────────────────────────────────────────── */
    if (doc.y + 80 > doc.page.height - MARGIN - 40) doc.addPage();
    const sigW = (contentW - 40) / 2;
    const sigLineY = doc.y + 40;

    doc.moveTo(MARGIN, sigLineY).lineTo(MARGIN + sigW, sigLineY)
      .strokeColor(INK).lineWidth(0.5).stroke();
    doc.moveTo(MARGIN + sigW + 40, sigLineY).lineTo(MARGIN + contentW, sigLineY)
      .strokeColor(INK).lineWidth(0.5).stroke();

    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK)
      .text(guestName, MARGIN, sigLineY + 5, { width: sigW, align: 'center' });
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text(`${documentType} ${str(documentNumber)}`, MARGIN, doc.y, { width: sigW, align: 'center' });

    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK)
      .text('Hotel Estar', MARGIN + sigW + 40, sigLineY + 5, { width: sigW, align: 'center' });
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text(L.roleHotel, MARGIN + sigW + 40, doc.y, { width: sigW, align: 'center' });

    /* ── FOOTER ──────────────────────────────────────────────────────────── */
    const footerY = doc.page.height - MARGIN - 24;
    doc.moveTo(MARGIN, footerY).lineTo(doc.page.width - MARGIN, footerY)
      .strokeColor(BORDER).lineWidth(0.5).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
      .text(L.footer, MARGIN, footerY + 5, { width: contentW, align: 'center', lineBreak: true });

    doc.end();
  });
}

/* ── quote renderer ──────────────────────────────────────────────────────── */

function collectQuoteServices(q) {
  const LABELS = { desayuno: 'Desayuno', almuerzo: 'Almuerzo', cena: 'Cena', personaAdicional: 'Persona adicional' };
  const sv = (q && q.servicios) || {};
  const rows = [];
  ['desayuno', 'almuerzo', 'cena', 'personaAdicional'].forEach(k => {
    const s = sv[k];
    if (s && s.cantidad && s.precioUnitario) {
      rows.push({ label: LABELS[k], cantidad: s.cantidad, precio: s.precioUnitario, sub: s.cantidad * s.precioUnitario });
    }
  });
  (Array.isArray(sv.otros) ? sv.otros : []).forEach(o => {
    if (o && o.cantidad && o.precioUnitario) {
      rows.push({ label: o.descripcion || 'Servicio', cantidad: o.cantidad, precio: o.precioUnitario, sub: o.cantidad * o.precioUnitario });
    }
  });
  return rows;
}

function quoteTableHeader(doc, cols, widths, y) {
  let x = MARGIN;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(OLIVE);
  cols.forEach((c, i) => {
    doc.text(c, x + 3, y, { width: widths[i] - 6, align: i === 0 ? 'left' : 'right' });
    x += widths[i];
  });
  const lineY = y + 13;
  doc.moveTo(MARGIN, lineY).lineTo(doc.page.width - MARGIN, lineY).strokeColor(BORDER).lineWidth(0.5).stroke();
  return lineY + 4;
}

function quoteTableRow(doc, cells, widths, y) {
  let x = MARGIN, maxY = y;
  cells.forEach((c, i) => {
    doc.font('Helvetica').fontSize(9).fillColor(INK)
      .text(str(c), x + 3, y, { width: widths[i] - 6, align: i === 0 ? 'left' : 'right' });
    maxY = Math.max(maxY, doc.y);
    x += widths[i];
  });
  return maxY + 4;
}

/* renderQuotePDF(quote, totals) → Promise<Buffer>. Server-side PDF for the
   corporate quote viewer (text-only, so no html2canvas/image/CORS fragility).
   `totals` is the output of _quotes-store.computeQuoteTotal(quote). */
function renderQuotePDF(quote = {}, totals = {}) {
  return new Promise((resolve, reject) => {
    const q = quote || {};
    const quoteId = q.quoteId || 'COTIZACION';
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      info: { Title: `Cotización ${quoteId}`, Author: 'Hotel Estar', Subject: 'Cotización Comercial' }
    });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const contentW = doc.page.width - MARGIN * 2;

    /* HEADER */
    doc.font('Helvetica-Bold').fontSize(20).fillColor(OLIVE).text('Hotel Estar', MARGIN, MARGIN);
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('APARTAESTUDIOS — MANIZALES', MARGIN);
    const metaX = doc.page.width - MARGIN - 200;
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text('Cotización N.º', metaX, MARGIN, { width: 200, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text(quoteId, metaX, doc.y, { width: 200, align: 'right' });
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text('Emitida: ' + formatDateOnly(q.createdAt), metaX, doc.y, { width: 200, align: 'right' })
      .text('Válida hasta: ' + formatDateOnly(q.expiresAt), metaX, doc.y, { width: 200, align: 'right' });
    doc.y = Math.max(doc.y, MARGIN + 56) + 6;
    doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text('Cotización comercial', MARGIN, doc.y);

    /* CLIENT */
    sectionHeading(doc, 'Cliente');
    kvRow(doc, 'Empresa', q.empresa);
    if (q.contacto) kvRow(doc, 'Contacto', q.contacto);
    if (q.email) kvRow(doc, 'Email', q.email);
    if (q.telefono) kvRow(doc, 'Teléfono', q.telefono);
    if (q.nit) kvRow(doc, 'NIT', q.nit);
    if (q.referencia) kvRow(doc, 'Referencia', q.referencia);

    /* STAY */
    if (q.checkin || q.checkout || q.numPersonas) {
      sectionHeading(doc, 'Estadía');
      if (q.checkin) kvRow(doc, 'Check-in', formatDateOnly(q.checkin));
      if (q.checkout) kvRow(doc, 'Check-out', formatDateOnly(q.checkout));
      if (q.numPersonas) kvRow(doc, 'Personas', q.numPersonas);
    }

    /* ROOMS */
    const items = Array.isArray(q.items) ? q.items : [];
    if (items.length) {
      sectionHeading(doc, 'Alojamiento');
      const w = [contentW * 0.40, contentW * 0.12, contentW * 0.12, contentW * 0.18, contentW * 0.18];
      const hdr = ['Tipología', 'Unid.', 'Noches', 'Tarifa/noche', 'Subtotal'];
      let y = quoteTableHeader(doc, hdr, w, doc.y);
      items.forEach(it => {
        if (y + 22 > doc.page.height - MARGIN - 40) { doc.addPage(); y = quoteTableHeader(doc, hdr, w, MARGIN); }
        y = quoteTableRow(doc, [it.habitacion, it.unidades, it.noches, formatMoney(it.tarifaPorNoche), formatMoney(it.subtotal)], w, y);
      });
      doc.y = y + 2;
    }

    /* SERVICES */
    const svc = collectQuoteServices(q);
    if (svc.length) {
      sectionHeading(doc, 'Servicios adicionales');
      const w = [contentW * 0.46, contentW * 0.12, contentW * 0.20, contentW * 0.22];
      const hdr = ['Concepto', 'Cant.', 'Precio', 'Subtotal'];
      let y = quoteTableHeader(doc, hdr, w, doc.y);
      svc.forEach(s => {
        if (y + 22 > doc.page.height - MARGIN - 40) { doc.addPage(); y = quoteTableHeader(doc, hdr, w, MARGIN); }
        y = quoteTableRow(doc, [s.label, s.cantidad, formatMoney(s.precio), formatMoney(s.sub)], w, y);
      });
      doc.y = y + 2;
    }

    /* TOTALS (right column) */
    doc.y += 8;
    const tW = 240, tX = doc.page.width - MARGIN - tW;
    const totalRow = (label, value, opts = {}) => {
      const yy = doc.y;
      const fs = opts.big ? 11 : 9.5;
      doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fs).fillColor(opts.bold ? INK : MUTED)
        .text(label, tX, yy, { width: tW * 0.5 });
      doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fs).fillColor(INK)
        .text(value, tX + tW * 0.5, yy, { width: tW * 0.5, align: 'right' });
      doc.y = Math.max(doc.y, yy + fs) + 3;
    };
    totalRow('Subtotal', formatMoney(totals.subtotal));
    if (totals.descuentoAmt > 0) totalRow('Descuento', '− ' + formatMoney(totals.descuentoAmt));
    if (totals.iva > 0) totalRow('IVA (19%)', formatMoney(totals.iva));
    if (totals.inc > 0) totalRow('INC (8%)', formatMoney(totals.inc));
    doc.moveTo(tX, doc.y + 1).lineTo(doc.page.width - MARGIN, doc.y + 1).strokeColor(BORDER).lineWidth(0.5).stroke();
    doc.y += 6;
    totalRow('Total', formatMoney(totals.total), { bold: true, big: true });
    if (q.numPersonas > 0 && totals.total > 0) totalRow('Valor por persona', formatMoney(totals.total / q.numPersonas));
    doc.font('Helvetica-Oblique').fontSize(8).fillColor(MUTED)
      .text('Impuestos incluidos en el total · Valores en COP', tX, doc.y + 2, { width: tW, align: 'right' });

    /* POLICIES */
    doc.y += 16;
    sectionHeading(doc, 'Políticas');
    doc.font('Helvetica').fontSize(9).fillColor(INK);
    [
      'Check-in desde las 3:00 p. m. · Check-out hasta las 11:00 a. m. (sujeto a disponibilidad).',
      'Cancelación gratuita con al menos 48 horas de anticipación al check-in.',
      'Pago a crédito sujeto a aprobación previa de la empresa con convenio vigente.',
      'Impuestos (IVA 19% sobre alojamiento, INC 8% sobre alimentación) detallados en el total.'
    ].forEach(p => { doc.text('•  ' + p, MARGIN, doc.y, { width: contentW }); doc.y += 2; });

    if (q.condiciones) {
      doc.y += 6;
      sectionHeading(doc, 'Condiciones especiales');
      doc.font('Helvetica').fontSize(9).fillColor(INK).text(String(q.condiciones), MARGIN, doc.y, { width: contentW });
    }

    /* FOOTER */
    const footerY = doc.page.height - MARGIN - 24;
    doc.moveTo(MARGIN, footerY).lineTo(doc.page.width - MARGIN, footerY).strokeColor(BORDER).lineWidth(0.5).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
      .text('Hotel Estar · RNT 276306 · Cl. 61 #23-36, La Estrella · Manizales, Caldas — Colombia\nreservas@estar.com.co · +57 310 249 0414',
        MARGIN, footerY + 5, { width: contentW, align: 'center' });

    doc.end();
  });
}

module.exports = { renderContractPDF, renderQuotePDF };
