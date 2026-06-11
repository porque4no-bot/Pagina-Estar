/* HTML template for the Hotel Estar guest contract (Contrato de Hospedaje).
 *
 * Renders a Spanish or English A4 contract from a guest-contract `record` payload coming
 * out of guest-action.js.
 *
 * Exports:
 *   renderContractHTML(record) -> string (HTML)
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

function formatDate(value, lang = 'es', fallback = '—') {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  try {
    return date.toLocaleString(lang === 'en' ? 'en-US' : 'es-CO', {
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

function formatDateOnly(value, lang = 'es', fallback = '—') {
  if (!value) return fallback;
  // Use local time matching client date parsing
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  try {
    return date.toLocaleDateString(lang === 'en' ? 'en-US' : 'es-CO', {
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

function contractGuests(record, fallback) {
  const guests = Array.isArray(record.guests) ? record.guests : [];
  const normalized = guests.map(entry => {
    const guest = entry && entry.guest ? entry.guest : entry;
    const firstName = pick(guest, 'firstName') || '';
    const lastName = pick(guest, 'lastName') || '';
    return {
      name: `${firstName} ${lastName}`.trim() || pick(guest, 'guestName', 'signedName') || '—',
      documentType: pick(guest, 'documentType') || '—',
      documentNumber: pick(guest, 'documentNumber', 'documentId') || '—',
      isPrimary: Boolean(entry && entry.isPrimary)
    };
  }).filter(guest => guest.name !== '—' || guest.documentNumber !== '—');
  return normalized.length ? normalized : [fallback];
}

const CONTRACT_CLAUSES = [
  {
    num: 'PRIMERA', title: { es: 'Objeto', en: 'Subject Matter' },
    es: 'Hotel Estar, identificado con RNT 276306, otorga al huésped el uso temporal del apartaestudio identificado en este contrato, en calidad de hospedaje turístico, durante las fechas señaladas. El huésped declara conocer y aceptar las características del inmueble y las condiciones del servicio.',
    en: 'Hotel Estar, holder of RNT 276306, grants the guest the temporary use of the studio identified in this agreement, as tourist accommodation, during the stated dates. The guest declares to know and accept the property characteristics and service conditions.'
  },
  {
    num: 'SEGUNDA', title: { es: 'Uso del inmueble', en: 'Property Use' },
    es: 'El huésped utilizará el apartaestudio exclusivamente para fines de alojamiento personal y no podrá destinarlo a actividades comerciales, industriales, ilícitas o distintas a la naturaleza del servicio contratado. Queda prohibido subarrendar o ceder, total o parcialmente, el derecho de uso a terceros.',
    en: 'The guest shall use the studio exclusively for personal lodging and may not allocate it to commercial, industrial, unlawful or any other activity outside the contracted service. Subletting or assigning the right of use to third parties, in whole or in part, is prohibited.'
  },
  {
    num: 'TERCERA', title: { es: 'Convivencia y silencio', en: 'Coexistence and Quiet Hours' },
    es: 'Por tratarse de un edificio residencial, el huésped se obliga a respetar el reglamento de propiedad horizontal, mantener un comportamiento respetuoso con los demás residentes y guardar silencio entre las 10:00 p. m. y las 7:00 a. m. No se permiten fiestas, reuniones que excedan la capacidad declarada ni el ingreso de personas no registradas.',
    en: 'As this is a residential building, the guest must respect the condominium rules, behave respectfully toward other residents, and observe quiet hours between 10:00 p.m. and 7:00 a.m. Parties, gatherings exceeding the declared capacity, and unregistered visitors are not permitted.'
  },
  {
    num: 'CUARTA', title: { es: 'Cuidado y daños', en: 'Care of Property and Damages' },
    es: 'El huésped es responsable del cuidado del apartaestudio, su mobiliario, enseres y dotación. Cualquier daño, pérdida o deterioro distinto al desgaste normal por uso será reportado al huésped y su valor podrá ser cobrado al momento del check-out o a través del medio de pago registrado.',
    en: 'The guest is responsible for the care of the studio, its furniture, fixtures, and supplies. Any damage, loss, or deterioration beyond normal wear will be reported to the guest and may be charged at check-out or via the registered payment method.'
  },
  {
    num: 'QUINTA', title: { es: 'Horarios y entrega', en: 'Schedules and Checkout' },
    es: 'El check-in se realiza a partir de las 3:00 p. m. y el check-out hasta las 12:00 m. del día de salida. Toda permanencia posterior sin acuerdo previo causará un cargo adicional. Hotel Estar podrá retener objetos olvidados hasta por 30 días, transcurridos los cuales se dispondrá de ellos según política interna.',
    en: 'Check-in is from 3:00 p.m. and check-out by 12:00 noon on the departure day. Any extended stay without prior agreement will incur an additional charge. Hotel Estar may retain forgotten items for up to 30 days; afterwards they will be disposed of per internal policy.'
  }
];

function renderContractHTML(record = {}) {
  const lang = pick(record, 'lang') === 'en' ? 'en' : 'es';

  const bookingCode = pick(record, 'bookingCode') || 'SIN-RESERVA';
  const guestName = pick(record, 'signedName', 'guestName') || 'Huésped';
  const documentType = pick(record, 'documentType') || (lang === 'en' ? 'Identity Document' : 'Documento de identidad');
  const documentNumber = pick(record, 'documentNumber', 'documentId') || '—';
  const phone = pick(record, 'phone') || '—';
  const email = pick(record, 'email') || '—';
  const checkIn = pick(record, 'checkIn', 'requestedCheckIn');
  const checkOut = pick(record, 'checkOut', 'requestedCheckOut');
  const roomName = pick(record, 'roomName', 'room') || '—';
  const capacity = pick(record, 'capacity') || (record.guests ? String(record.guests.length) : '—');
  const totalAmount = pick(record, 'total', 'totalAmount', 'amount');
  const paymentProvider = pick(record, 'paymentProvider', 'paymentMethod') || '—';
  const transactionId = pick(record, 'transactionId', 'paymentReference') || '—';
  const contractVersion = pick(record, 'contractVersion') || 'ESTAR-HOSPEDAJE-2026-01';
  const signedAt = pick(record, 'signedAt') || new Date().toISOString();
  const consentText = pick(record, 'consentText') || (
    lang === 'en' 
      ? 'I declare that I have read, understand, and fully accept this hospitality agreement, its clauses, and policies, and I electronically sign it with full legal effect under Colombian Law 527 of 1999 and Decree 2364 of 2012.'
      : 'Declaro que he leído, entiendo y acepto íntegramente este contrato de hospedaje, sus cláusulas y políticas, y firmo electrónicamente con plenos efectos legales conforme a la Ley 527 de 1999 y el Decreto 2364 de 2012 de Colombia.'
  );
  const eventId = pick(record, 'eventId') || '—';

  const normalizedGuests = contractGuests(record, {
    name: guestName,
    documentType,
    documentNumber: documentNumber || '—',
    isPrimary: true
  });

  const labels = lang === 'en' ? {
    title: 'Hospitality Agreement',
    contractNo: 'Agreement No.',
    version: 'Version',
    issued: 'Issued',
    booking: 'Booking Details',
    bookingCode: 'Reservation code',
    checkIn: 'Check-in date',
    checkOut: 'Check-out date',
    room: 'Studio',
    capacity: 'Guest capacity',
    occupants: 'Registered guests',
    guest: 'Primary Guest Data',
    name: 'Full name',
    docType: 'Document type',
    docNumber: 'Document number',
    phone: 'Phone',
    email: 'Email',
    payment: 'Payment Information',
    total: 'Total stay value',
    payMethod: 'Payment method',
    txId: 'Transaction ID',
    consent: 'Consent and Electronic Signature',
    technicalEvidence: 'Technical Evidence',
    eventId: 'Event ID',
    acceptance: 'Acceptance',
    signedAt: 'Signed at',
    yes: 'Yes',
    no: 'No',
    roleGuest: 'Guest',
    roleHotel: 'RNT 276306 — Manizales, Colombia',
    footer: 'Hotel Estar · RNT 276306 · Manizales, Caldas — Colombia<br/>Document generated automatically. Keep this copy along with your payment receipt.',
    clausesTitle: 'Contract Clauses',
    endOfContract: 'End of contract'
  } : {
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
    guest: 'Datos del huésped principal',
    name: 'Nombre completo',
    docType: 'Tipo de documento',
    docNumber: 'Número de documento',
    phone: 'Teléfono',
    email: 'Correo electrónico',
    payment: 'Información de pago',
    total: 'Valor total del hospedaje',
    payMethod: 'Medio de pago',
    txId: 'Identificador de transacción',
    consent: 'Consentimiento y firma electrónica',
    technicalEvidence: 'Evidencia técnica',
    eventId: 'ID de evento',
    acceptance: 'Aceptación',
    signedAt: 'Firmado en',
    yes: 'Sí',
    no: 'No',
    roleGuest: 'Huésped',
    roleHotel: 'RNT 276306 — Manizales, Colombia',
    footer: 'Hotel Estar · RNT 276306 · Manizales, Caldas — Colombia<br/>Documento generado automáticamente. Conserve esta copia junto con su comprobante de pago.',
    clausesTitle: 'Cláusulas del contrato',
    endOfContract: 'Fin del contrato'
  };

  const occupantsHtml = normalizedGuests.map(g => {
    const role = g.isPrimary ? (lang === 'en' ? 'Primary' : 'Principal') : (lang === 'en' ? 'Companion' : 'Acompañante');
    return `<li><strong>${escapeHtml(g.name)}</strong> — ${escapeHtml(g.documentType)} ${escapeHtml(g.documentNumber)} (${escapeHtml(role)})</li>`;
  }).join('');

  const clausesHtml = CONTRACT_CLAUSES.map(c => `
    <p class="clause"><span class="clause-num">${escapeHtml(c.num)} — ${escapeHtml(c.title[lang])}.</span>
    ${escapeHtml(c[lang])}</p>
  `).join('');

  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(labels.title)} — ${escapeHtml(bookingCode)}</title>
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
  .doc { width: 100%; max-width: 174mm; margin: 0 auto; padding: 10px; }
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
    line-height: 1;
  }
  .brand small {
    display: block;
    font-size: 9pt;
    color: #555;
    letter-spacing: 2px;
    margin-top: 4px;
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
  .guest-contract-list {
    margin: 4px 0 0;
    padding-left: 20px;
    font-size: 10.5pt;
  }
  .guest-contract-list li {
    margin: 2px 0;
  }
  p.clause {
    margin: 6px 0 8px;
    text-align: justify;
    font-size: 10.5pt;
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
    padding-top: 40px;
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
  .guest-contract-end {
    margin: 22px 0 4px;
    text-align: center;
    color: #555;
    font-size: 9pt;
    font-weight: bold;
    letter-spacing: 0.12em;
    text-transform: uppercase;
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
        ${escapeHtml(labels.contractNo)} <strong>${escapeHtml(bookingCode)}</strong><br/>
        ${escapeHtml(labels.version)}: ${escapeHtml(contractVersion)}<br/>
        ${escapeHtml(labels.issued)}: ${escapeHtml(formatDate(signedAt, lang))}
      </div>
    </header>

    <h1>${escapeHtml(labels.title)}</h1>

    <h2>${escapeHtml(labels.booking)}</h2>
    <table class="kv">
      <tr><td class="k">${escapeHtml(labels.bookingCode)}</td><td>${escapeHtml(bookingCode)}</td></tr>
      <tr><td class="k">${escapeHtml(labels.checkIn)}</td><td>${escapeHtml(formatDateOnly(checkIn, lang))}</td></tr>
      <tr><td class="k">${escapeHtml(labels.checkOut)}</td><td>${escapeHtml(formatDateOnly(checkOut, lang))}</td></tr>
      <tr><td class="k">${escapeHtml(labels.room)}</td><td>${escapeHtml(roomName)}</td></tr>
      <tr><td class="k">${escapeHtml(labels.capacity)}</td><td>${escapeHtml(capacity)}</td></tr>
    </table>

    <h2>${escapeHtml(labels.occupants)}</h2>
    <ul class="guest-contract-list">
      ${occupantsHtml || '<li>—</li>'}
    </ul>

    <h2>${escapeHtml(labels.guest)}</h2>
    <table class="kv">
      <tr><td class="k">${escapeHtml(labels.name)}</td><td>${escapeHtml(guestName)}</td></tr>
      <tr><td class="k">${escapeHtml(labels.docType)}</td><td>${escapeHtml(documentType)}</td></tr>
      <tr><td class="k">${escapeHtml(labels.docNumber)}</td><td>${escapeHtml(documentNumber)}</td></tr>
      <tr><td class="k">${escapeHtml(labels.phone)}</td><td>${escapeHtml(phone)}</td></tr>
      <tr><td class="k">${escapeHtml(labels.email)}</td><td>${escapeHtml(email)}</td></tr>
    </table>

    <h2>${escapeHtml(labels.payment)}</h2>
    <table class="kv">
      <tr><td class="k">${escapeHtml(labels.total)}</td><td>${escapeHtml(formatMoney(totalAmount))}</td></tr>
      <tr><td class="k">${escapeHtml(labels.payMethod)}</td><td>${escapeHtml(paymentProvider)}</td></tr>
      <tr><td class="k">${escapeHtml(labels.txId)}</td><td>${escapeHtml(transactionId)}</td></tr>
    </table>

    <h2>${escapeHtml(labels.clausesTitle)}</h2>
    ${clausesHtml}

    <h2>${escapeHtml(labels.consent)}</h2>
    <p class="clause">${escapeHtml(consentText)}</p>
    <div class="stamp">
      ${escapeHtml(labels.technicalEvidence)} — ${escapeHtml(labels.eventId)}: <strong>${escapeHtml(eventId)}</strong> ·
      ${escapeHtml(labels.acceptance)}: ${record.acceptedTerms ? escapeHtml(labels.yes) : escapeHtml(labels.no)} ·
      ${escapeHtml(labels.signedAt)}: ${escapeHtml(formatDate(signedAt, lang))}
    </div>

    <div class="signatures">
      <div class="sig">
        <div class="line"></div>
        <div class="name">${escapeHtml(guestName)}</div>
        <div class="role">${escapeHtml(labels.roleGuest)} — ${escapeHtml(documentType)} ${escapeHtml(documentNumber)}</div>
      </div>
      <div class="sig">
        <div class="line"></div>
        <div class="name">Hotel Estar</div>
        <div class="role">${escapeHtml(labels.roleHotel)}</div>
      </div>
    </div>

    <p class="guest-contract-end" id="contractEnd">— ${escapeHtml(labels.endOfContract)} —</p>

    <footer>
      ${labels.footer}
    </footer>
  </div>
</body>
</html>`;
}

module.exports = { renderContractHTML, escapeHtml };
