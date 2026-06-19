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

/* Client reminder: an active quote is about to expire (sent by the cron once
   per quote). Brand-consistent with the confirmation email; CTA to the quote. */
function quoteExpiringHtml({ quote, quoteUrl }) {
  const stay = `${formatDateES(quote.checkin)} → ${formatDateES(quote.checkout)}`;
  return `<!DOCTYPE html><html lang="es"><body style="margin:0;padding:0;background:#F5F3EE;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3EE;padding:32px 0;"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;">
      <tr><td style="background:#2C2C2C;padding:32px 40px;text-align:center;">
        <h1 style="margin:0;font-family:Georgia,serif;font-size:28px;color:#fff;letter-spacing:0.06em;">ESTAR</h1>
        <p style="margin:6px 0 0;font-family:Arial,sans-serif;font-size:11px;letter-spacing:0.12em;color:#9A9A8A;text-transform:uppercase;">Manizales, Colombia</p>
      </td></tr>
      <tr><td style="background:#9A6A2E;padding:24px 40px;text-align:center;">
        <p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#fff;opacity:.9;">Tu cotización vence pronto</p>
        <p style="margin:0;font-family:'Courier New',monospace;font-size:22px;font-weight:700;color:#fff;">${esc(quote.quoteId)}</p>
      </td></tr>
      <tr><td style="padding:30px 40px;">
        <p style="margin:0 0 14px;font-family:Georgia,serif;font-size:16px;color:#2C2C2C;">Estimado/a <strong>${esc(quote.contacto || quote.empresa)}</strong>,</p>
        <p style="margin:0 0 18px;font-family:Georgia,serif;font-size:14px;color:#555;line-height:1.7;">
          Tu cotización <strong>${esc(quote.quoteId)}</strong> para la estadía <strong>${stay}</strong> está por vencer
          el <strong>${formatDateES(quote.expiresAt)}</strong>. Si deseas asegurar la tarifa y la disponibilidad,
          revísala y completa tu reserva antes de esa fecha.
        </p>
        <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:6px 0 4px;">
          <a href="${esc(quoteUrl)}" style="display:inline-block;padding:16px 36px;background:#9B9065;border-radius:8px;font-family:Arial,sans-serif;font-size:13px;font-weight:700;color:#fff;text-decoration:none;letter-spacing:0.08em;text-transform:uppercase;">Ver mi cotización →</a>
        </td></tr></table>
        <p style="margin:18px 0 0;font-family:Arial,sans-serif;font-size:12px;color:#9A9A8A;line-height:1.6;">
          Si ya completaste tu reserva o no necesitas esta cotización, puedes ignorar este mensaje.
        </p>
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

const WA_LINK = 'https://api.whatsapp.com/send/?phone=573102490414';

function emailShell(bandColor, eyebrow, code, bodyHtml) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#F5F3EE;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3EE;padding:32px 0;"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;">
      <tr><td style="background:#2C2C2C;padding:32px 40px;text-align:center;">
        <h1 style="margin:0;font-family:Georgia,serif;font-size:28px;color:#fff;letter-spacing:0.06em;">ESTAR</h1>
        <p style="margin:6px 0 0;font-family:Arial,sans-serif;font-size:11px;letter-spacing:0.12em;color:#9A9A8A;text-transform:uppercase;">Manizales, Colombia</p>
      </td></tr>
      <tr><td style="background:${bandColor};padding:22px 40px;text-align:center;">
        <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#fff;opacity:.95;">${esc(eyebrow)}</p>
        ${code ? `<p style="margin:6px 0 0;font-family:'Courier New',monospace;font-size:20px;font-weight:700;color:#fff;">${esc(code)}</p>` : ''}
      </td></tr>
      <tr><td style="padding:30px 40px;">${bodyHtml}</td></tr>
      <tr><td style="padding:0 40px 30px;text-align:center;font-family:Arial,sans-serif;font-size:11px;color:#9A9A8A;">
        Hotel Estar · Cl. 61 #23-36, La Estrella · Manizales · reservas@estar.com.co · +57 310 249 0414
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

function ctaButton(href, label) {
  return `<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:6px 0 4px;">
    <a href="${esc(href)}" style="display:inline-block;padding:14px 32px;background:#9B9065;border-radius:8px;font-family:Arial,sans-serif;font-size:13px;font-weight:700;color:#fff;text-decoration:none;letter-spacing:0.06em;text-transform:uppercase;">${esc(label)}</a>
  </td></tr></table>`;
}

/* A10 — pre-arrival reminder (sent by the send-stay-emails cron). Bilingual. */
function preArrivalHtml({ resv, lang }) {
  const r = resv || {};
  const stay = `${formatDateES(r.dateArrival)} → ${formatDateES(r.dateDeparture)}`;
  if (lang === 'en') {
    const bf = r.hasBreakfast ? `<p style="margin:0 0 12px;font-family:Georgia,serif;font-size:14px;color:#555;">Your booking includes breakfast — we'll have it ready each morning.</p>` : '';
    return emailShell('#B5713B', 'We look forward to your stay', '', `
      <p style="margin:0 0 14px;font-family:Georgia,serif;font-size:16px;color:#2C2C2C;">Hi <strong>${esc(r.firstName || 'there')}</strong>,</p>
      <p style="margin:0 0 14px;font-family:Georgia,serif;font-size:14px;color:#555;line-height:1.7;">Your stay at Estar is coming up: <strong>${stay}</strong>. Check-in is from <strong>3:00 pm</strong> and check-out until <strong>11:00 am</strong>. Check-in is 100% digital — the day before arrival you'll get a link with your access codes (no keys, no front desk).</p>
      ${bf}
      <p style="margin:0 0 16px;font-family:Georgia,serif;font-size:14px;color:#555;line-height:1.7;">We're at Cl. 61 #23-36, La Estrella, Manizales. Need anything before you arrive?</p>
      ${ctaButton(WA_LINK, 'Message us on WhatsApp')}`);
  }
  const bf = r.hasBreakfast ? `<p style="margin:0 0 12px;font-family:Georgia,serif;font-size:14px;color:#555;">Tu reserva incluye desayuno — lo tendremos listo cada mañana.</p>` : '';
  return emailShell('#B5713B', 'Te esperamos pronto', '', `
    <p style="margin:0 0 14px;font-family:Georgia,serif;font-size:16px;color:#2C2C2C;">Hola <strong>${esc(r.firstName || '')}</strong>,</p>
    <p style="margin:0 0 14px;font-family:Georgia,serif;font-size:14px;color:#555;line-height:1.7;">Tu estadía en Estar está cerca: <strong>${stay}</strong>. El check-in es desde las <strong>3:00 p. m.</strong> y el check-out hasta las <strong>11:00 a. m.</strong> El check-in es 100% digital — un día antes de tu llegada recibirás un enlace con tus códigos de acceso (sin llaves ni recepción).</p>
    ${bf}
    <p style="margin:0 0 16px;font-family:Georgia,serif;font-size:14px;color:#555;line-height:1.7;">Estamos en Cl. 61 #23-36, La Estrella, Manizales. ¿Necesitas algo antes de llegar?</p>
    ${ctaButton(WA_LINK, 'Escríbenos por WhatsApp')}`);
}

/* A10 — post-stay thank you + review ask (sent by the send-stay-emails cron). */
function postStayHtml({ resv, lang }) {
  const r = resv || {};
  const reviewUrl = process.env.REVIEW_LINK_URL || WA_LINK;
  const hasReview = !!process.env.REVIEW_LINK_URL;
  if (lang === 'en') {
    return emailShell('#6E6A42', 'Thank you for staying with us', '', `
      <p style="margin:0 0 14px;font-family:Georgia,serif;font-size:16px;color:#2C2C2C;">Hi <strong>${esc(r.firstName || 'there')}</strong>,</p>
      <p style="margin:0 0 16px;font-family:Georgia,serif;font-size:14px;color:#555;line-height:1.7;">Thank you for choosing Estar. We hope Manizales treated you well and that your studio felt like home. ${hasReview ? 'If you have a minute, a short review helps other travelers find us.' : 'We\'d love to hear how it went.'}</p>
      ${ctaButton(reviewUrl, hasReview ? 'Leave a review' : 'Send us feedback')}`);
  }
  return emailShell('#6E6A42', 'Gracias por tu estadía', '', `
    <p style="margin:0 0 14px;font-family:Georgia,serif;font-size:16px;color:#2C2C2C;">Hola <strong>${esc(r.firstName || '')}</strong>,</p>
    <p style="margin:0 0 16px;font-family:Georgia,serif;font-size:14px;color:#555;line-height:1.7;">Gracias por elegir Estar. Esperamos que Manizales te haya tratado bien y que tu apartaestudio se sintiera como en casa. ${hasReview ? 'Si tienes un minuto, una reseña corta nos ayuda a que otros viajeros nos encuentren.' : 'Nos encantaría saber cómo te fue.'}</p>
    ${ctaButton(reviewUrl, hasReview ? 'Dejar una reseña' : 'Enviarnos tu opinión')}`);
}

/* A9 — ask the guest for the bank account to receive a manual refund. */
function bankDetailsRequestHtml({ refund, formUrl, slaDays, lang }) {
  const r = refund || {};
  const days = slaDays || 15;
  if (lang === 'en') {
    return emailShell('#6E6A42', 'Refund approved', '', `
      <p style="margin:0 0 14px;font-family:Georgia,serif;font-size:16px;color:#2C2C2C;">Hi <strong>${esc(r.guestName || '')}</strong>,</p>
      <p style="margin:0 0 16px;font-family:Georgia,serif;font-size:14px;color:#555;line-height:1.7;">
        We approved the refund for booking <strong>${esc(r.bookingCode || '')}</strong>. As your payment method
        can't be refunded automatically by the gateway, we'll do it by <strong>bank transfer</strong>. Please
        tell us the account where you'd like to receive it:</p>
      ${ctaButton(formUrl, 'Enter my bank account')}
      <p style="margin:18px 0 0;font-family:Arial,sans-serif;font-size:12px;color:#9A9A8A;line-height:1.6;">
        The link is personal and expires. Once we receive your details, we process the refund within
        <strong>${days} business days</strong>. If you didn't request this, please ignore this message.</p>`);
  }
  return emailShell('#6E6A42', 'Reembolso aprobado', '', `
    <p style="margin:0 0 14px;font-family:Georgia,serif;font-size:16px;color:#2C2C2C;">Hola <strong>${esc(r.guestName || '')}</strong>,</p>
    <p style="margin:0 0 16px;font-family:Georgia,serif;font-size:14px;color:#555;line-height:1.7;">
      Aprobamos el reembolso de tu reserva <strong>${esc(r.bookingCode || '')}</strong>. Como tu pago no admite
      devolución automática por la pasarela, lo haremos por <strong>transferencia bancaria</strong>. Por favor
      indícanos la cuenta donde quieres recibirlo:</p>
    ${ctaButton(formUrl, 'Indicar mi cuenta bancaria')}
    <p style="margin:18px 0 0;font-family:Arial,sans-serif;font-size:12px;color:#9A9A8A;line-height:1.6;">
      El enlace es personal y caduca. Una vez recibamos tus datos, tramitamos el reembolso en un máximo de
      <strong>${days} días hábiles</strong>. Si no solicitaste esto, ignora este mensaje.</p>`);
}

/* A9 — notify treasury that a guest submitted bank details to process a refund. */
function treasuryBankDetailsHtml({ refund }) {
  const r = refund || {};
  const b = r.bankDetails || {};
  const amount = r.refundAmountCents != null ? formatCOP(r.refundAmountCents / 100) : '(definir)';
  return `<!DOCTYPE html><html lang="es"><body style="font-family:Arial,sans-serif;color:#2C2C2C;">
    <h2 style="color:#6E6A42;">Datos bancarios para reembolso — ${esc(r.bookingCode || '')}</h2>
    <p>El huésped envió la cuenta para el reembolso. Tramitar transferencia:</p>
    <ul style="font-size:14px;line-height:1.7;">
      <li><strong>Monto aprobado:</strong> ${esc(amount)}</li>
      <li><strong>Banco:</strong> ${esc(b.bankName || '')}</li>
      <li><strong>Tipo de cuenta:</strong> ${esc(b.accountType || '')}</li>
      <li><strong>Número de cuenta:</strong> ${esc(b.accountNumber || '')}</li>
      <li><strong>Titular:</strong> ${esc(b.holderName || '')}</li>
      <li><strong>Documento:</strong> ${esc(b.docType || '')} ${esc(b.docNumber || '')}</li>
      <li><strong>Huésped:</strong> ${esc(r.guestName || '')} · ${esc(r.guestEmail || '')}</li>
    </ul>
    <p style="font-size:12px;color:#9A9A8A;">Marca el reembolso como procesado en el panel admin cuando completes la transferencia.</p>
  </body></html>`;
}

module.exports = {
  sendEmail, adminEmail, esc, formatCOP, formatDateES,
  paymentConfirmationHtml, adminPendingHtml, adminAvailabilityLostHtml,
  quoteExpiringHtml, preArrivalHtml, postStayHtml,
  bankDetailsRequestHtml, treasuryBankDetailsHtml
};
