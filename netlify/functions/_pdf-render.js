/* Contract PDF renderer using pdfkit (pure JS, no binary deps).
 *
 * pdfkit ships as ~3 MB of JS with no native code, so Netlify deploys stay
 * fast regardless of how often the function bundle changes.
 *
 * API: renderContractPDF(record) → Promise<Buffer>
 *   record — the payload.record object from a guest-contract event.
 */

const PDFDocument = require('pdfkit');

const OLIVE  = '#9b9065';
const INK    = '#1f1f1f';
const MUTED  = '#555555';
const BORDER = '#e1ddca';
const STAMP_BG = '#f6f3e7';

/* ── helpers ─────────────────────────────────────────────────────────────── */

function str(v) { return (v === null || v === undefined) ? '—' : String(v); }

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return str(value);
  try {
    return d.toLocaleString('es-CO', {
      timeZone: 'America/Bogota',
      year: 'numeric', month: 'long', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  } catch { return d.toISOString(); }
}

function formatDateOnly(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return str(value);
  try {
    return d.toLocaleDateString('es-CO', {
      timeZone: 'America/Bogota',
      year: 'numeric', month: 'long', day: '2-digit'
    });
  } catch { return d.toISOString().slice(0, 10); }
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

/* ── main renderer ───────────────────────────────────────────────────────── */

function renderContractPDF(record = {}) {
  return new Promise((resolve, reject) => {
    const bookingCode     = pick(record, 'bookingCode') || 'SIN-RESERVA';
    const guestName       = pick(record, 'signedName', 'guestName') || 'Huésped';
    const documentType    = pick(record, 'documentType') || 'Documento de identidad';
    const documentNumber  = pick(record, 'documentNumber', 'documentId');
    const phone           = pick(record, 'phone');
    const email           = pick(record, 'email');
    const checkIn         = pick(record, 'checkIn', 'requestedCheckIn');
    const checkOut        = pick(record, 'checkOut', 'requestedCheckOut');
    const roomName        = pick(record, 'roomName', 'room');
    const capacity        = pick(record, 'capacity', 'guests');
    const totalAmount     = pick(record, 'total', 'totalAmount', 'amount');
    const paymentProvider = pick(record, 'paymentProvider', 'paymentMethod');
    const transactionId   = pick(record, 'transactionId', 'paymentReference');
    const contractVersion = pick(record, 'contractVersion') || 'ESTAR-HOSPEDAJE-2026-01';
    const signedAt        = pick(record, 'signedAt') || new Date().toISOString();
    const consentText     = pick(record, 'consentText') ||
      'Firma electrónica simple aceptada desde la guest app de Hotel Estar.';
    const eventId         = pick(record, 'eventId');

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      info: {
        Title: `Contrato de Hospedaje — ${bookingCode}`,
        Author: 'Hotel Estar',
        Subject: 'Contrato de Hospedaje'
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
      .text('APARTAESTUDIOS — MANIZALES', MARGIN);

    const metaX = doc.page.width - MARGIN - 160;
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
      .text(`Contrato N.º`, metaX, MARGIN, { width: 160, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK)
      .text(bookingCode, metaX, doc.y, { width: 160, align: 'right' });
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text(`Versión: ${contractVersion}`, metaX, doc.y, { width: 160, align: 'right' });
    doc.text(`Emitido: ${formatDate(signedAt)}`, metaX, doc.y, { width: 160, align: 'right' });

    const headerLineY = Math.max(doc.y, 100) + 6;
    doc.moveTo(MARGIN, headerLineY)
      .lineTo(doc.page.width - MARGIN, headerLineY)
      .strokeColor(OLIVE).lineWidth(1.5).stroke();
    doc.y = headerLineY + 14;

    /* ── TITLE ──────────────────────────────────────────────────────────── */
    doc.font('Helvetica-Bold').fontSize(16).fillColor(INK)
      .text('Contrato de Hospedaje', MARGIN, doc.y, { width: contentW, align: 'center' });
    doc.y += 14;

    /* ── DATOS DE LA RESERVA ─────────────────────────────────────────────── */
    sectionHeading(doc, 'Datos de la reserva');
    kvRow(doc, 'Código de reserva', bookingCode);
    kvRow(doc, 'Fecha de ingreso (check-in)', formatDateOnly(checkIn));
    kvRow(doc, 'Fecha de salida (check-out)', formatDateOnly(checkOut));
    kvRow(doc, 'Apartaestudio', roomName);
    kvRow(doc, 'Capacidad de huéspedes', capacity);

    /* ── DATOS DEL HUÉSPED ───────────────────────────────────────────────── */
    sectionHeading(doc, 'Datos del huésped');
    kvRow(doc, 'Nombre completo', guestName);
    kvRow(doc, 'Tipo de documento', documentType);
    kvRow(doc, 'Número de documento', documentNumber);
    kvRow(doc, 'Teléfono', phone);
    kvRow(doc, 'Correo electrónico', email);

    /* ── INFORMACIÓN DE PAGO ─────────────────────────────────────────────── */
    sectionHeading(doc, 'Información de pago');
    kvRow(doc, 'Valor total del hospedaje', formatMoney(totalAmount));
    kvRow(doc, 'Medio de pago', paymentProvider);
    kvRow(doc, 'Identificador de transacción', transactionId);

    /* ── CLÁUSULAS ───────────────────────────────────────────────────────── */
    sectionHeading(doc, 'Cláusulas del contrato');
    clause(doc, 'PRIMERA', 'Objeto',
      `Hotel Estar, identificado con RNT 276306, otorga al huésped el uso temporal del apartaestudio identificado en este contrato, en calidad de hospedaje turístico, durante las fechas señaladas. El huésped declara conocer y aceptar las características del inmueble y las condiciones del servicio.`);
    clause(doc, 'SEGUNDA', 'Uso del inmueble',
      `El huésped utilizará el apartaestudio exclusivamente para fines de alojamiento personal y no podrá destinarlo a actividades comerciales, industriales, ilícitas o distintas a la naturaleza del servicio contratado. Queda prohibido subarrendar o ceder, total o parcialmente, el derecho de uso a terceros.`);
    clause(doc, 'TERCERA', 'Convivencia y silencio',
      `Por tratarse de un edificio residencial, el huésped se obliga a respetar el reglamento de propiedad horizontal, mantener un comportamiento respetuoso con los demás residentes y guardar silencio entre las 10:00 p.m. y las 7:00 a.m. No se permiten fiestas, reuniones que excedan la capacidad declarada ni el ingreso de personas no registradas.`);
    clause(doc, 'CUARTA', 'Cuidado y daños',
      `El huésped es responsable del cuidado del apartaestudio, su mobiliario, enseres y dotación. Cualquier daño, pérdida o deterioro distinto al desgaste normal por uso será reportado al huésped y su valor podrá ser cobrado al momento del check-out o a través del medio de pago registrado.`);
    clause(doc, 'QUINTA', 'Horarios y entrega',
      `El check-in se realiza a partir de las 3:00 p.m. y el check-out hasta las 12:00 m. del día de salida. Toda permanencia posterior sin acuerdo previo causará un cargo adicional. Hotel Estar podrá retener objetos olvidados hasta por 30 días, transcurridos los cuales se dispondrá de ellos según política interna.`);

    /* ── CONSENTIMIENTO ──────────────────────────────────────────────────── */
    sectionHeading(doc, 'Consentimiento y firma electrónica');
    doc.font('Helvetica').fontSize(9.5).fillColor(INK)
      .text(consentText, MARGIN, doc.y, { width: contentW, align: 'justify' });
    doc.y += 6;

    const stampY = doc.y;
    const stampH = 36;
    doc.rect(MARGIN, stampY, contentW, stampH).fill(STAMP_BG);
    doc.moveTo(MARGIN, stampY).lineTo(MARGIN, stampY + stampH)
      .strokeColor(OLIVE).lineWidth(2.5).stroke();
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
      .text(
        `ID de evento: ${str(eventId)}  ·  Aceptación: ${record.acceptedTerms ? 'Sí' : 'No'}  ·  Firmado: ${formatDate(signedAt)}`,
        MARGIN + 10, stampY + 8, { width: contentW - 16 }
      );
    doc.y = stampY + stampH + 20;

    /* ── FIRMAS ──────────────────────────────────────────────────────────── */
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
      .text('RNT 276306 — Manizales, Colombia', MARGIN + sigW + 40, doc.y, { width: sigW, align: 'center' });

    /* ── FOOTER ──────────────────────────────────────────────────────────── */
    const footerY = doc.page.height - MARGIN - 24;
    doc.moveTo(MARGIN, footerY).lineTo(doc.page.width - MARGIN, footerY)
      .strokeColor(BORDER).lineWidth(0.5).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
      .text(
        'Hotel Estar · RNT 276306 · Manizales, Caldas — Colombia\nDocumento generado automáticamente. Conserve esta copia junto con su comprobante de pago.',
        MARGIN, footerY + 5, { width: contentW, align: 'center' }
      );

    doc.end();
  });
}

module.exports = { renderContractPDF };
