const fs = require('fs');
const path = require('path');
require('./_env');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limit');
const { signPassToken } = require('./_breakfast-pass');
const { BREAKFAST_SCHEDULE } = require('./_breakfast');
const email = require('./_email');
const { getStore } = require('@netlify/blobs');

/**
 * Formats a COP amount as "$ 660.000"
 */
function formatCOP(amount) {
  if (!amount && amount !== 0) return '$ 0';
  return '$ ' + Math.round(amount).toLocaleString('es-CO');
}

/**
 * Formats a date string "YYYY-MM-DD" to a human-readable Spanish format
 * e.g. "10 de junio de 2024"
 */
function formatDateES(dateStr) {
  if (!dateStr) return dateStr;
  const months = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
  ];
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const day = parseInt(parts[2], 10);
  const month = parseInt(parts[1], 10) - 1;
  const year = parts[0];
  return `${day} de ${months[month]} de ${year}`;
}

/**
 * Obfuscates an email address for logging purposes.
 */
function obfuscateEmail(email) {
  if (!email || typeof email !== 'string') return '';
  const parts = email.split('@');
  if (parts.length !== 2) return '***';
  const name = parts[0];
  const domain = parts[1];
  return name.length > 2 ? `${name[0]}***${name[name.length - 1]}@${domain}` : `***@${domain}`;
}

/**
 * Builds the HTML email template for a booking confirmation.
 * All CSS is inline for maximum email client compatibility (Gmail, Apple Mail, Outlook).
 */
function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildEmailHtml({
  guestName,
  bookingCode,
  roomName,
  checkIn,
  checkOut,
  nights,
  totalAmount,
  paidAmount,
  phone,
  passUrl
}) {
  guestName  = esc(guestName);
  bookingCode = esc(bookingCode);
  roomName   = esc(roomName);
  const nightsLabel = nights === 1 ? 'noche' : 'noches';
  const checkInFormatted = esc(formatDateES(checkIn));
  const checkOutFormatted = esc(formatDateES(checkOut));
  const totalFormatted = formatCOP(totalAmount);
  const paidFormatted = formatCOP(paidAmount);

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light only" />
  <meta name="supported-color-schemes" content="light only" />
  <title>Confirmación de reserva — Estar Manizales</title>
  <style>@media only screen and (max-width:600px){.em-pwrap{padding:14px 0!important;}.em-card{border-radius:0!important;}.em-px{padding-left:20px!important;padding-right:20px!important;}}</style>
</head>
<body style="margin:0;padding:0;background-color:#e7e1d4;font-family:'Libre Baskerville',Georgia,'Times New Roman',serif;">

  <!-- Outer wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" class="em-pwrap" style="background-color:#e7e1d4;padding:40px 16px;">
    <tr>
      <td align="center">

        <!-- Email card -->
        <table width="600" cellpadding="0" cellspacing="0" border="0" class="em-card" style="max-width:600px;width:100%;background-color:#FFFFFF;border-radius:14px;overflow:hidden;box-shadow:0 1px 2px rgba(40,41,43,.06),0 12px 32px rgba(40,41,43,.07);">

          <!-- Header -->
          <tr>
            <td class="em-px" style="background-color:#faf6ef;padding:32px 40px 24px;text-align:center;">
              <img src="cid:estarlogo" alt="estar Apartaestudios" width="150" style="display:block;margin:0 auto;width:150px;max-width:62%;height:auto;" />
              <p style="margin:14px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.24em;color:#9b9065;text-transform:uppercase;">Manizales · Colombia</p>
            </td>
          </tr>

          <!-- Confirmation hero -->
          <tr>
            <td class="em-px" style="background-color:#9b9065;padding:22px 40px;text-align:center;">
              <p style="margin:0 0 9px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#FFFFFF;opacity:0.92;">Reserva confirmada</p>
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:23px;font-weight:700;letter-spacing:0.16em;color:#FFFFFF;">${bookingCode}</p>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td class="em-px" style="padding:32px 40px 0 40px;">
              <p style="margin:0;font-family:Georgia,serif;font-size:16px;color:#2C2C2C;line-height:1.6;">
                Hola <strong>${guestName}</strong>,
              </p>
              <p style="margin:12px 0 0 0;font-family:Georgia,serif;font-size:14px;color:#555550;line-height:1.7;">
                Tu reserva en <strong>Estar Manizales</strong> ha sido confirmada con éxito. A continuación encuentras todos los detalles de tu estadía.
              </p>
            </td>
          </tr>

          <!-- Booking details -->
          <tr>
            <td class="em-px" style="padding:28px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E8E4DC;border-radius:8px;overflow:hidden;">

                <!-- Row: Habitación -->
                <tr>
                  <td style="padding:16px 20px;background-color:#FAF8F4;border-bottom:1px solid #E8E4DC;">
                    <p style="margin:0 0 4px 0;font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#9A9A8A;">Tipología</p>
                    <p style="margin:0;font-family:Georgia,serif;font-size:15px;color:#2C2C2C;font-weight:700;">${roomName}</p>
                  </td>
                </tr>

                <!-- Row: Fechas -->
                <tr>
                  <td style="padding:0;border-bottom:1px solid #E8E4DC;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="padding:16px 20px;width:50%;border-right:1px solid #E8E4DC;">
                          <p style="margin:0 0 4px 0;font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#9A9A8A;">Llegada</p>
                          <p style="margin:0;font-family:Georgia,serif;font-size:14px;color:#2C2C2C;">${checkInFormatted}</p>
                          <p style="margin:4px 0 0 0;font-family:Arial,sans-serif;font-size:11px;color:#9A9A8A;">Check-in desde las 3:00 pm</p>
                        </td>
                        <td style="padding:16px 20px;width:50%;">
                          <p style="margin:0 0 4px 0;font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#9A9A8A;">Salida</p>
                          <p style="margin:0;font-family:Georgia,serif;font-size:14px;color:#2C2C2C;">${checkOutFormatted}</p>
                          <p style="margin:4px 0 0 0;font-family:Arial,sans-serif;font-size:11px;color:#9A9A8A;">Check-out antes de las 11:00 a. m.</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Row: Noches -->
                <tr>
                  <td style="padding:16px 20px;border-bottom:1px solid #E8E4DC;background-color:#FAF8F4;">
                    <p style="margin:0 0 4px 0;font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#9A9A8A;">Duración de la estadía</p>
                    <p style="margin:0;font-family:Georgia,serif;font-size:14px;color:#2C2C2C;">${nights} ${nightsLabel}</p>
                  </td>
                </tr>

                <!-- Row: Monto pagado -->
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="margin:0 0 4px 0;font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#9A9A8A;">Total pagado (online)</p>
                    <p style="margin:0;font-family:Georgia,serif;font-size:22px;font-weight:700;color:#9b9065;">${paidFormatted} COP</p>
                    ${totalAmount !== paidAmount ? `<p style="margin:4px 0 0 0;font-family:Arial,sans-serif;font-size:11px;color:#9A9A8A;">Total reserva: ${totalFormatted} COP</p>` : ''}
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- Check-in digital instructions -->
          <tr>
            <td class="em-px" style="padding:0 40px 28px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#faf6ef;border-radius:8px;padding:20px 24px;">
                <tr>
                  <td>
                    <p style="margin:0 0 12px 0;font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#7A7A6A;">Antes de llegar</p>
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="padding:8px 0;vertical-align:top;">
                          <table cellpadding="0" cellspacing="0" border="0">
                            <tr>
                              <td style="padding-right:12px;vertical-align:top;">
                                <span style="display:inline-block;width:20px;height:20px;background-color:#9b9065;border-radius:50%;text-align:center;line-height:20px;font-family:Arial,sans-serif;font-size:10px;font-weight:700;color:#FFFFFF;">1</span>
                              </td>
                              <td>
                                <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#2C2C2C;line-height:1.5;"><strong>Haz tu check-in digital</strong><br/><span style="color:#555550;">Un día antes de tu llegada. Al completarlo recibirás los códigos de acceso (edificio y apartaestudio) — sin llaves ni recepción.</span></p>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;vertical-align:top;">
                          <table cellpadding="0" cellspacing="0" border="0">
                            <tr>
                              <td style="padding-right:12px;vertical-align:top;">
                                <span style="display:inline-block;width:20px;height:20px;background-color:#9b9065;border-radius:50%;text-align:center;line-height:20px;font-family:Arial,sans-serif;font-size:10px;font-weight:700;color:#FFFFFF;">2</span>
                              </td>
                              <td>
                                <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#2C2C2C;line-height:1.5;"><strong>Ten tu documento a la mano</strong><br/><span style="color:#555550;">Requerido por la normatividad hotelera colombiana para el registro.</span></p>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;vertical-align:top;">
                          <table cellpadding="0" cellspacing="0" border="0">
                            <tr>
                              <td style="padding-right:12px;vertical-align:top;">
                                <span style="display:inline-block;width:20px;height:20px;background-color:#9b9065;border-radius:50%;text-align:center;line-height:20px;font-family:Arial,sans-serif;font-size:10px;font-weight:700;color:#FFFFFF;">3</span>
                              </td>
                              <td>
                                <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#2C2C2C;line-height:1.5;"><strong>Cómo llegar</strong><br/><span style="color:#555550;">Cl. 61 #23-36, La Estrella, Manizales.</span><br/><a href="${email.WAZE_LINK}" style="color:#9b9065;font-weight:700;text-decoration:none;">Abrir en Waze</a> &nbsp;·&nbsp; <a href="${email.MAPS_LINK}" style="color:#9b9065;font-weight:700;text-decoration:none;">Google Maps</a></p>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Breakfast passes (only when the reservation includes breakfast) -->
          ${passUrl ? `<tr>
            <td class="em-px" style="padding:0 40px 28px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#faf6ef;border-radius:8px;padding:20px 24px;">
                <tr><td style="text-align:center;">
                  <p style="margin:0 0 6px 0;font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#7A7A6A;">Desayuno incluido</p>
                  <p style="margin:0 0 16px 0;font-family:Georgia,serif;font-size:14px;color:#555550;line-height:1.6;">Muestra tu pase en el comedor (${BREAKFAST_SCHEDULE}; o antes, si lo solicitas con antelación). Ábrelo desde aquí — sin apps ni claves.</p>
                  <a href="${passUrl}" style="display:inline-block;padding:12px 28px;background-color:#2C2C2C;border-radius:6px;font-family:Arial,sans-serif;font-size:13px;font-weight:700;color:#FFFFFF;text-decoration:none;letter-spacing:0.04em;">Ver mis pases de desayuno</a>
                </td></tr>
              </table>
            </td>
          </tr>` : ''}

          <!-- WhatsApp contact -->
          <tr>
            <td class="em-px" style="padding:0 40px 32px 40px;text-align:center;">
              <p style="margin:0 0 16px 0;font-family:Arial,sans-serif;font-size:13px;color:#555550;line-height:1.6;">
                ¿Tienes alguna pregunta o petición especial? Escríbenos directamente por WhatsApp.
              </p>
              <a href="https://api.whatsapp.com/send/?phone=573102490414&text=${encodeURIComponent('Hola, tengo una reserva con código ' + bookingCode + ' y quisiera hacer una consulta.')}"
                style="display:inline-block;padding:12px 28px;background-color:#25D366;border-radius:6px;font-family:Arial,sans-serif;font-size:13px;font-weight:700;color:#FFFFFF;text-decoration:none;letter-spacing:0.04em;">
                Contactar por WhatsApp
              </a>
              <p style="margin:12px 0 0 0;font-family:Arial,sans-serif;font-size:12px;color:#9A9A8A;">+57 310 249 0414 · reservas@estar.com.co</p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td class="em-px" style="background-color:#faf6ef;padding:22px 40px 26px;text-align:center;border-top:1px solid #ece5d6;">
              <div style="margin-bottom:10px;"><span style="color:#9b9065;font-size:15px;line-height:1;">&#10022;</span></div>
              <p style="margin:0 0 8px 0;font-family:Arial,sans-serif;font-size:11px;line-height:1.7;color:#9b9482;">Hotel estar · Cl. 61 #23-36, La Estrella · Manizales<br/>reservas@estar.com.co · +57 310 249 0414</p>
              <p style="margin:0;font-family:Arial,sans-serif;font-size:10px;color:#b6ad97;line-height:1.5;">Guarda este correo como comprobante de tu reserva. La política de cancelación depende de tu tarifa (Estricta / Flexible) — consúltala en estar.com.co/cancelacion.html</p>
            </td>
          </tr>

        </table>
        <!-- End email card -->

      </td>
    </tr>
  </table>

</body>
</html>`;
}

/* ── Idempotent confirmation sender ─────────────────────────────────────
   Both the client (the HTTP handler below, after polling) and wompi-webhook
   (server-side, right after the reservation is created) trigger the booking
   confirmation. The webhook is the reliable path — it still fires when the
   guest closes the tab after paying or the Wompi redirect never returns. To
   keep the guest from getting two emails, the first successful send marks the
   booking code in a Blobs store and any later trigger for the same booking is
   a no-op. The key is marked AFTER a successful send, so a failed send stays
   retryable by the other trigger (the client remains a fallback). Non-fatal:
   if Blobs is unavailable we just send (a rare double beats no email). */
function getConfirmationStore() {
  try {
    const opts = { name: 'confirmation-emails', consistency: 'strong' };
    const siteID = process.env.BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
    const token = process.env.BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
    if (siteID && token) {
      opts.siteID = siteID;
      opts.token = token;
    }
    return getStore(opts);
  } catch (e) {
    if (process.env.DEBUG) console.warn('[send-confirmation] dedup store unavailable:', e.message);
    return null;
  }
}

/* Build + send the confirmation email, idempotently. Returns a structured
   result ({ sent, reason?, resendId?, to? }) — not an HTTP response — so it can
   be called both from the HTTP handler and in-process from wompi-webhook.
   Deps (fetch, signPassToken, getStore, dedupe) are injectable for tests. */
async function sendConfirmationEmail(params, deps = {}) {
  const d = {
    fetch,
    signPassToken,
    getStore: getConfirmationStore,
    dedupe: true,
    ...deps
  };
  const {
    guestEmail, guestName, bookingCode, roomName,
    checkIn, checkOut, nights, totalAmount, paidAmount, phone, breakfast
  } = params;
  const dedupeKey = String(params.dedupeKey || bookingCode || '').trim();

  if (!guestEmail || !bookingCode) {
    return { sent: false, reason: 'missing-fields' };
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    if (process.env.DEBUG) console.log('[send-confirmation] RESEND_API_KEY not configured. Skipping email send.');
    return { sent: false, reason: 'no-key' };
  }

  // Idempotency: if a confirmation for this booking already went out, skip.
  const store = d.dedupe ? d.getStore() : null;
  if (store && dedupeKey) {
    try {
      if (await store.get(dedupeKey)) {
        if (process.env.DEBUG) console.log(`[send-confirmation] duplicate suppressed for booking ${dedupeKey}`);
        return { sent: false, reason: 'duplicate', duplicate: true };
      }
    } catch (e) {
      if (process.env.DEBUG) console.warn('[send-confirmation] dedup read failed; sending anyway:', e.message);
    }
  }

  // Pase de desayuno (Fase 2): si la reserva incluye desayuno, añade un link
  // firmado a la página de pases (QR por persona). Sin el flag `breakfast`, el
  // correo sale igual que antes.
  let passUrl = '';
  if (breakfast) {
    try {
      const base = (process.env.GUEST_APP_BASE_URL || process.env.URL || process.env.DEPLOY_URL || 'https://estar.com.co').replace(/\/$/, '');
      passUrl = `${base}/pase-desayuno?t=${d.signPassToken(bookingCode)}`;
    } catch (e) {
      if (process.env.DEBUG) console.warn('[send-confirmation] no se pudo firmar el pase:', e.message);
    }
  }

  const emailHtml = buildEmailHtml({
    guestName: guestName || 'Huésped',
    bookingCode: bookingCode || 'N/A',
    roomName: roomName || 'Apartaestudio',
    checkIn: checkIn || '',
    checkOut: checkOut || '',
    nights: parseInt(nights) || 1,
    totalAmount: parseFloat(totalAmount) || 0,
    paidAmount: parseFloat(paidAmount) || parseFloat(totalAmount) || 0,
    phone: phone || '',
    passUrl
  });

  const resendController = new AbortController();
  const resendTimeoutId = setTimeout(() => resendController.abort(), 10000);
  let resendResponse;
  try {
    resendResponse = await d.fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Estar Manizales <reservas@estar.com.co>',
        to: guestEmail,
        subject: `Confirmación de reserva ${bookingCode} — Estar Manizales`,
        html: emailHtml,
        text: email.htmlToText(emailHtml),
        attachments: [require('./_logo').logoAttachment()]
      }),
      signal: resendController.signal
    });
    clearTimeout(resendTimeoutId);
  } catch (err) {
    clearTimeout(resendTimeoutId);
    if (err.name === 'AbortError') return { sent: false, reason: 'timeout' };
    throw err;
  }

  const resendData = await resendResponse.json().catch(() => ({}));
  if (!resendResponse.ok) {
    console.error('[send-confirmation] Resend API error status:', resendResponse.status, (resendData && resendData.message) || '');
    try {
      await require('./_alert').reportAlert({
        kind: 'confirmation_email_failed', severity: 'error',
        message: 'No se pudo enviar el correo de confirmación de reserva al huésped (Resend rechazó el envío).',
        context: { bookingCode: dedupeKey || bookingCode, status: resendResponse.status, detail: String((resendData && resendData.message) || '').slice(0, 200) },
        dedupeKey: 'send-confirmation-resend'
      });
    } catch (_) { /* alert best-effort */ }
    return { sent: false, reason: 'resend-error', status: resendResponse.status };
  }

  // Mark sent only AFTER success, so a failed send stays retryable.
  if (store && dedupeKey) {
    try {
      await store.set(dedupeKey, JSON.stringify({
        bookingCode, resendId: resendData.id, via: params.via || 'unknown', at: new Date().toISOString()
      }), { ttl: 86400 * 30 });
    } catch (e) {
      if (process.env.DEBUG) console.warn('[send-confirmation] dedup mark failed:', e.message);
    }
  }

  if (process.env.DEBUG) console.log(`[send-confirmation] Email sent to ${obfuscateEmail(guestEmail)} for booking ${bookingCode}. Resend ID: ${resendData.id}`);
  return { sent: true, resendId: resendData.id, to: obfuscateEmail(guestEmail), bookingCode };
}

exports.handler = async (event, context) => {
  // CORS Headers
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  const corsHeaders = {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  if (allowedOrigin) {
    corsHeaders['Access-Control-Allow-Origin'] = allowedOrigin;
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method Not Allowed. Use POST.' })
    };
  }

  const limited = await checkRateLimit(event, { name: 'send-confirmation', limit: 10, windowMs: 60 * 60 * 1000 });
  if (!limited.ok) return rateLimitResponse(corsHeaders, limited.retryAfter);

  const MAX_BODY_SIZE = 10000; // 10 KB
  if (event.body && event.body.length > MAX_BODY_SIZE) {
    return { statusCode: 413, body: JSON.stringify({ error: 'Payload too large' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Invalid JSON request body' })
    };
  }

  const {
    guestEmail,
    guestName,
    bookingCode,
    roomName,
    checkIn,
    checkOut,
    nights,
    totalAmount,
    paidAmount,
    phone
  } = body;

  // Basic validation
  if (!guestEmail || !guestName || !bookingCode) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing required fields: guestEmail, guestName, bookingCode' })
    };
  }

  if (!/^[A-Z0-9][A-Z0-9\-]{1,49}$/.test(String(bookingCode).trim().toUpperCase())) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'bookingCode inválido' })
    };
  }

  // Delegate to the shared, idempotent sender. wompi-webhook calls this very
  // same function in-process right after creating the reservation, so the dedup
  // store (keyed by booking code) guarantees the guest gets exactly one email
  // even when both the client (this endpoint) and the webhook fire.
  let result;
  try {
    result = await sendConfirmationEmail({
      guestEmail,
      guestName,
      bookingCode,
      roomName,
      checkIn,
      checkOut,
      nights,
      totalAmount,
      paidAmount,
      phone,
      breakfast: body.breakfast,
      dedupeKey: body.dedupeKey,
      via: 'client'
    });
  } catch (err) {
    console.error('[send-confirmation] Unexpected error:', err.message);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ sent: false, error: 'Internal server error while sending email' })
    };
  }

  if (result.sent) {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ sent: true, resendId: result.resendId, to: result.to, bookingCode })
    };
  }
  if (result.reason === 'timeout') {
    return { statusCode: 504, body: JSON.stringify({ error: 'Request timeout' }) };
  }
  if (result.reason === 'resend-error') {
    return {
      statusCode: 502,
      headers: corsHeaders,
      body: JSON.stringify({ sent: false, error: 'Failed to send email' })
    };
  }
  // no-key / duplicate / missing-fields → 200 with sent:false (the client only logs this)
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({ sent: false, reason: result.reason, duplicate: result.duplicate })
  };
};

exports.sendConfirmationEmail = sendConfirmationEmail;
exports._test = { buildEmailHtml, sendConfirmationEmail, getConfirmationStore };
