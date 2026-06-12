/* Shared transactional email via Resend, plus the templates used after a
   quote is paid (client confirmation) and for admin alerts. */

const FROM = 'Estar Manizales <reservas@estar.com.co>';

function adminEmail() {
  return process.env.ADMIN_NOTIFY_EMAIL || 'reservas@estar.com.co';
}

function formatCOP(n) {
  return '$ ' + Math.round(n || 0).toLocaleString('es-CO');
}

function formatDateES(isoStr) {
  if (!isoStr) return '—';
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  return `${d.getUTCDate()} de ${months[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendEmail({ to, cc, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (process.env.DEBUG) console.log('[email] RESEND_API_KEY missing; skipping send');
    return { sent: false, reason: 'no-key' };
  }
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to, cc, subject, html }),
      signal: ctrl.signal
    });
    clearTimeout(tid);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[email] Resend error:', res.status, data && data.message);
      return { sent: false };
    }
    return { sent: true, id: data.id };
  } catch (e) {
    clearTimeout(tid);
    console.error('[email] send failed:', e.message);
    return { sent: false };
  }
}

/* Client confirmation after a quote is paid and the reservation is created. */
function paymentConfirmationHtml({ quote, bookingCode, total }) {
  const stay = `${formatDateES(quote.checkin)} → ${formatDateES(quote.checkout)}`;
  const rooms = (quote.items || []).map(it =>
    `<tr><td style="padding:8px 0;font-family:Arial,sans-serif;font-size:13px;color:#555;">${esc(it.habitacion)} · ${it.unidades} u. × ${it.noches} noche(s)</td></tr>`
  ).join('');
  return `<!DOCTYPE html><html lang="es"><body style="margin:0;padding:0;background:#F5F3EE;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3EE;padding:32px 0;"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;">
      <tr><td style="background:#2C2C2C;padding:32px 40px;text-align:center;">
        <h1 style="margin:0;font-family:Georgia,serif;font-size:28px;color:#fff;letter-spacing:0.06em;">ESTAR</h1>
        <p style="margin:6px 0 0;font-family:Arial,sans-serif;font-size:11px;letter-spacing:0.12em;color:#9A9A8A;text-transform:uppercase;">Manizales, Colombia</p>
      </td></tr>
      <tr><td style="background:#2E6B3A;padding:24px 40px;text-align:center;">
        <p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#fff;opacity:.9;">Reserva confirmada</p>
        <p style="margin:0;font-family:'Courier New',monospace;font-size:22px;font-weight:700;color:#fff;">${esc(bookingCode)}</p>
      </td></tr>
      <tr><td style="padding:30px 40px;">
        <p style="margin:0 0 14px;font-family:Georgia,serif;font-size:16px;color:#2C2C2C;">Estimado/a <strong>${esc(quote.contacto || quote.empresa)}</strong>,</p>
        <p style="margin:0 0 18px;font-family:Georgia,serif;font-size:14px;color:#555;line-height:1.7;">
          Confirmamos el pago y la reserva de la cotización <strong>${esc(quote.quoteId)}</strong>. ¡Te esperamos!
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E8E4DC;border-radius:8px;padding:16px 18px;">
          <tr><td style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#9A9A8A;padding-bottom:4px;">Estadía</td></tr>
          <tr><td style="font-family:Georgia,serif;font-size:15px;color:#2C2C2C;padding-bottom:12px;">${stay} · ${quote.numPersonas || 1} huésped(es)</td></tr>
          ${rooms}
          <tr><td style="padding-top:12px;border-top:1px solid #E8E4DC;font-family:Georgia,serif;font-size:18px;font-weight:700;color:#2C2C2C;">Total pagado: ${formatCOP(total)}</td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:0 40px 30px;text-align:center;font-family:Arial,sans-serif;font-size:11px;color:#9A9A8A;">
        Hotel Estar · Cl. 61 #23-36, La Estrella · Manizales · reservas@estar.com.co · +57 310 249 0414
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

/* Admin alert: payment received but the reservation could not be created. */
function adminPendingHtml({ quote, transactionId, shortfalls }) {
  const lines = (shortfalls || []).map(s => `<li>${esc(s.habitacion)}: pedidas ${s.requested}, disponibles ${s.available}</li>`).join('');
  return `<!DOCTYPE html><html lang="es"><body style="font-family:Arial,sans-serif;color:#2C2C2C;">
    <h2 style="color:#9A3B12;">⚠ Pago recibido SIN reserva creada</h2>
    <p>La cotización <strong>${esc(quote.quoteId)}</strong> (${esc(quote.empresa)}) fue <strong>pagada</strong> pero la reserva no pudo crearse automáticamente en Kunas. Requiere acción manual.</p>
    <ul>
      <li>Transacción Wompi: ${esc(transactionId)}</li>
      <li>Estadía: ${formatDateES(quote.checkin)} → ${formatDateES(quote.checkout)}</li>
      <li>Contacto: ${esc(quote.contacto || '—')} · ${esc(quote.email || '')} · ${esc(quote.telefono || '')}</li>
    </ul>
    ${lines ? `<p>Habitaciones sin disponibilidad:</p><ul>${lines}</ul>` : ''}
    <p>Entra al portal B2B y usa <strong>"Reintentar reserva"</strong> en esa cotización una vez liberes cupo.</p>
  </body></html>`;
}

/* Admin alert: an active quote lost availability (detected by the cron). */
function adminAvailabilityLostHtml({ quote, shortfalls }) {
  const lines = (shortfalls || []).map(s => `<li>${esc(s.habitacion)}: cotizadas ${s.requested}, disponibles ${s.available}</li>`).join('');
  return `<!DOCTYPE html><html lang="es"><body style="font-family:Arial,sans-serif;color:#2C2C2C;">
    <h2 style="color:#9A6A2E;">Cotización sin disponibilidad</h2>
    <p>La cotización <strong>${esc(quote.quoteId)}</strong> (${esc(quote.empresa)}) perdió disponibilidad para ${formatDateES(quote.checkin)} → ${formatDateES(quote.checkout)}.</p>
    <ul>${lines}</ul>
    <p>El cliente no podrá completar el pago hasta que se ajusten las fechas o se libere cupo.</p>
  </body></html>`;
}

module.exports = {
  sendEmail, adminEmail, esc, formatCOP, formatDateES,
  paymentConfirmationHtml, adminPendingHtml, adminAvailabilityLostHtml
};
