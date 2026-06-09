/* HTML template for the Hotel Estar guest contract (Contrato de Hospedaje).
 *
 * Replaces the legacy Google Apps Script Doc-to-PDF generation. Renders a
 * Spanish-language A4 contract from a guest-contract `record` payload coming
 * out of guest-action.js. The record reliably includes:
 *   - bookingCode, guestName, signedName, signedAt, contractVersion,
 *     consentText, acceptedTerms, eventId, status, createdAt
 * Plus any optional fields the guest app may add later (documentType,
 * documentNumber, phone, email, checkIn, checkOut, roomName, capacity, total,
 * paymentProvider, transactionId, etc.). All values are HTML-escaped to keep
 * names containing `<`, `&`, quotes, etc. safe to interpolate.
 *
 * Inline <style> only — Netlify Functions cannot serve external CSS during
 * Puppeteer rendering and the generated PDF must be fully self-contained.
 */

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(value, fallback = '—') {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  try {
    return date.toLocaleString('es-CO', {
      timeZone: 'America/Bogota',
      year: 'numeric',
      month: 'long',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (e) {
    return date.toISOString();
  }
}

function formatDateOnly(value, fallback = '—') {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  try {
    return date.toLocaleDateString('es-CO', {
      timeZone: 'America/Bogota',
      year: 'numeric',
      month: 'long',
      day: '2-digit'
    });
  } catch (e) {
    return date.toISOString().slice(0, 10);
  }
}

function formatMoney(amount) {
  if (amount === null || amount === undefined || amount === '') return '—';
  const num = Number(amount);
  if (Number.isNaN(num)) return escapeHtml(amount);
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0
    }).format(num);
  } catch (e) {
    return `COP ${num.toLocaleString('es-CO')}`;
  }
}

function pick(record, ...keys) {
  for (const key of keys) {
    if (record && record[key] !== undefined && record[key] !== null && record[key] !== '') {
      return record[key];
    }
  }
  return '';
}

function renderContractHTML(record = {}) {
  const bookingCode = pick(record, 'bookingCode') || 'SIN-RESERVA';
  const guestName = pick(record, 'signedName', 'guestName') || 'Huésped';
  const documentType = pick(record, 'documentType') || 'Documento de identidad';
  const documentNumber = pick(record, 'documentNumber', 'documentId') || '—';
  const phone = pick(record, 'phone') || '—';
  const email = pick(record, 'email') || '—';
  const checkIn = pick(record, 'checkIn', 'requestedCheckIn');
  const checkOut = pick(record, 'checkOut', 'requestedCheckOut');
  const roomName = pick(record, 'roomName', 'room') || '—';
  const capacity = pick(record, 'capacity', 'guests') || '—';
  const totalAmount = pick(record, 'total', 'totalAmount', 'amount');
  const paymentProvider = pick(record, 'paymentProvider', 'paymentMethod') || '—';
  const transactionId = pick(record, 'transactionId', 'paymentReference') || '—';
  const contractVersion = pick(record, 'contractVersion') || 'ESTAR-HOSPEDAJE-2026-01';
  const signedAt = pick(record, 'signedAt') || new Date().toISOString();
  const consentText = pick(record, 'consentText') ||
    'Firma electrónica simple aceptada desde la guest app de Hotel Estar.';
  const eventId = pick(record, 'eventId') || '—';

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Contrato de Hospedaje — ${escapeHtml(bookingCode)}</title>
<style>
  @page { size: A4; margin: 18mm 18mm 22mm 18mm; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif;
    color: #1f1f1f;
    font-size: 11pt;
    line-height: 1.45;
  }
  .doc { width: 174mm; }
  header {
    border-bottom: 2px solid #9b9065;
    padding-bottom: 12px;
    margin-bottom: 20px;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
  }
  .brand {
    font-family: Georgia, 'Times New Roman', serif;
    color: #9b9065;
    font-size: 22pt;
    letter-spacing: 1px;
    font-weight: bold;
  }
  .brand small {
    display: block;
    font-size: 9pt;
    color: #555;
    letter-spacing: 2px;
    margin-top: 2px;
    font-weight: normal;
    font-family: Arial, sans-serif;
  }
  .doc-meta {
    text-align: right;
    font-size: 9pt;
    color: #555;
  }
  h1 {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 16pt;
    text-align: center;
    margin: 8px 0 18px;
    color: #1f1f1f;
  }
  h2 {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 11.5pt;
    margin: 18px 0 6px;
    color: #9b9065;
    border-bottom: 1px solid #e1ddca;
    padding-bottom: 3px;
  }
  table.kv {
    width: 100%;
    border-collapse: collapse;
    margin: 4px 0 0;
  }
  table.kv td {
    padding: 4px 6px;
    vertical-align: top;
    font-size: 10.5pt;
  }
  table.kv td.k {
    width: 35%;
    color: #555;
    font-weight: bold;
  }
  p.clause {
    margin: 6px 0 8px;
    text-align: justify;
  }
  .clause-num {
    color: #9b9065;
    font-weight: bold;
    margin-right: 4px;
  }
  .signatures {
    margin-top: 40px;
    display: flex;
    justify-content: space-between;
    gap: 18mm;
  }
  .sig {
    width: 48%;
    text-align: center;
    font-size: 10pt;
  }
  .sig .line {
    border-top: 1px solid #1f1f1f;
    margin-bottom: 6px;
    padding-top: 50px;
  }
  .sig .name { font-weight: bold; }
  .sig .role { color: #555; font-size: 9pt; }
  footer {
    margin-top: 30px;
    border-top: 1px solid #e1ddca;
    padding-top: 8px;
    font-size: 8.5pt;
    color: #777;
    text-align: center;
  }
  .stamp {
    margin-top: 10px;
    padding: 6px 10px;
    background: #f6f3e7;
    border-left: 3px solid #9b9065;
    font-size: 9pt;
    color: #555;
  }
</style>
</head>
<body>
  <div class="doc">
    <header>
      <div class="brand">
        Hotel Estar
        <small>APARTAESTUDIOS — MANIZALES</small>
      </div>
      <div class="doc-meta">
        Contrato N.º <strong>${escapeHtml(bookingCode)}</strong><br/>
        Versión: ${escapeHtml(contractVersion)}<br/>
        Emitido: ${escapeHtml(formatDate(signedAt))}
      </div>
    </header>

    <h1>Contrato de Hospedaje</h1>

    <h2>Datos de la reserva</h2>
    <table class="kv">
      <tr><td class="k">Código de reserva</td><td>${escapeHtml(bookingCode)}</td></tr>
      <tr><td class="k">Fecha de ingreso (check-in)</td><td>${escapeHtml(formatDateOnly(checkIn))}</td></tr>
      <tr><td class="k">Fecha de salida (check-out)</td><td>${escapeHtml(formatDateOnly(checkOut))}</td></tr>
      <tr><td class="k">Apartaestudio</td><td>${escapeHtml(roomName)}</td></tr>
      <tr><td class="k">Capacidad de huéspedes</td><td>${escapeHtml(capacity)}</td></tr>
    </table>

    <h2>Datos del huésped</h2>
    <table class="kv">
      <tr><td class="k">Nombre completo</td><td>${escapeHtml(guestName)}</td></tr>
      <tr><td class="k">Tipo de documento</td><td>${escapeHtml(documentType)}</td></tr>
      <tr><td class="k">Número de documento</td><td>${escapeHtml(documentNumber)}</td></tr>
      <tr><td class="k">Teléfono</td><td>${escapeHtml(phone)}</td></tr>
      <tr><td class="k">Correo electrónico</td><td>${escapeHtml(email)}</td></tr>
    </table>

    <h2>Información de pago</h2>
    <table class="kv">
      <tr><td class="k">Valor total del hospedaje</td><td>${escapeHtml(formatMoney(totalAmount))}</td></tr>
      <tr><td class="k">Medio de pago</td><td>${escapeHtml(paymentProvider)}</td></tr>
      <tr><td class="k">Identificador de transacción</td><td>${escapeHtml(transactionId)}</td></tr>
    </table>

    <h2>Cláusulas del contrato</h2>
    <p class="clause"><span class="clause-num">PRIMERA — Objeto.</span>
      Hotel Estar, identificado con RNT 276306, otorga al huésped el uso temporal
      del apartaestudio identificado en este contrato, en calidad de hospedaje
      turístico, durante las fechas señaladas. El huésped declara conocer y
      aceptar las características del inmueble y las condiciones del servicio.</p>

    <p class="clause"><span class="clause-num">SEGUNDA — Uso del inmueble.</span>
      El huésped utilizará el apartaestudio exclusivamente para fines de
      alojamiento personal y no podrá destinarlo a actividades comerciales,
      industriales, ilícitas o distintas a la naturaleza del servicio
      contratado. Queda prohibido subarrendar o ceder, total o parcialmente,
      el derecho de uso a terceros.</p>

    <p class="clause"><span class="clause-num">TERCERA — Convivencia y silencio.</span>
      Por tratarse de un edificio residencial, el huésped se obliga a respetar
      el reglamento de propiedad horizontal, mantener un comportamiento
      respetuoso con los demás residentes y guardar silencio entre las
      10:00 p. m. y las 7:00 a. m. No se permiten fiestas, reuniones que
      excedan la capacidad declarada ni el ingreso de personas no registradas.</p>

    <p class="clause"><span class="clause-num">CUARTA — Cuidado y daños.</span>
      El huésped es responsable del cuidado del apartaestudio, su mobiliario,
      enseres y dotación. Cualquier daño, pérdida o deterioro distinto al
      desgaste normal por uso será reportado al huésped y su valor podrá ser
      cobrado al momento del check-out o a través del medio de pago registrado.</p>

    <p class="clause"><span class="clause-num">QUINTA — Horarios y entrega.</span>
      El check-in se realiza a partir de las 3:00 p. m. y el check-out hasta
      las 12:00 m. del día de salida. Toda permanencia posterior sin acuerdo
      previo causará un cargo adicional. Hotel Estar podrá retener objetos
      olvidados hasta por 30 días, transcurridos los cuales se dispondrá de
      ellos según política interna.</p>

    <h2>Consentimiento y firma electrónica</h2>
    <p class="clause">${escapeHtml(consentText)}</p>
    <div class="stamp">
      Evidencia técnica — ID de evento: <strong>${escapeHtml(eventId)}</strong> ·
      Aceptación: ${record.acceptedTerms ? 'Sí' : 'No'} ·
      Firmado en: ${escapeHtml(formatDate(signedAt))}
    </div>

    <div class="signatures">
      <div class="sig">
        <div class="line"></div>
        <div class="name">${escapeHtml(guestName)}</div>
        <div class="role">Huésped — ${escapeHtml(documentType)} ${escapeHtml(documentNumber)}</div>
      </div>
      <div class="sig">
        <div class="line"></div>
        <div class="name">Hotel Estar</div>
        <div class="role">RNT 276306 — Manizales, Colombia</div>
      </div>
    </div>

    <footer>
      Hotel Estar · RNT 276306 · Manizales, Caldas — Colombia<br/>
      Documento generado automáticamente. Conserve esta copia junto con su comprobante de pago.
    </footer>
  </div>
</body>
</html>`;
}

module.exports = { renderContractHTML, escapeHtml };
