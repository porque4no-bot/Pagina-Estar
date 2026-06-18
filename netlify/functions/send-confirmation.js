const fs = require('fs');
const path = require('path');
require('./_env');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limit');
const { signPassToken } = require('./_breakfast-pass');

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
  <title>Confirmación de reserva — Estar Manizales</title>
</head>
<body style="margin:0;padding:0;background-color:#F5F3EE;font-family:Georgia,'Times New Roman',serif;">

  <!-- Outer wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F5F3EE;padding:32px 0;">
    <tr>
      <td align="center">

        <!-- Email card -->
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.07);">

          <!-- Header -->
          <tr>
            <td style="background-color:#2C2C2C;padding:36px 40px;text-align:center;">
              <p style="margin:0 0 4px 0;font-family:Georgia,serif;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#C4956A;">Hotel Apartamento</p>
              <h1 style="margin:0;font-family:Georgia,serif;font-size:32px;font-weight:400;letter-spacing:0.06em;color:#FFFFFF;">ESTAR</h1>
              <p style="margin:6px 0 0 0;font-family:Georgia,serif;font-size:11px;letter-spacing:0.12em;color:#9A9A8A;text-transform:uppercase;">Manizales, Colombia</p>
            </td>
          </tr>

          <!-- Confirmation hero -->
          <tr>
            <td style="background-color:#C4956A;padding:28px 40px;text-align:center;">
              <p style="margin:0 0 8px 0;font-family:Georgia,serif;font-size:13px;letter-spacing:0.14em;text-transform:uppercase;color:#FFFFFF;opacity:0.85;">Reserva Confirmada</p>
              <p style="margin:0;font-family:'Courier New',Courier,monospace;font-size:28px;font-weight:700;letter-spacing:0.08em;color:#FFFFFF;">${bookingCode}</p>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding:32px 40px 0 40px;">
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
            <td style="padding:28px 40px;">
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
                    <p style="margin:0;font-family:Georgia,serif;font-size:22px;font-weight:700;color:#C4956A;">${paidFormatted} COP</p>
                    ${totalAmount !== paidAmount ? `<p style="margin:4px 0 0 0;font-family:Arial,sans-serif;font-size:11px;color:#9A9A8A;">Total reserva: ${totalFormatted} COP</p>` : ''}
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- Check-in digital instructions -->
          <tr>
            <td style="padding:0 40px 28px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F0EDE6;border-radius:8px;padding:20px 24px;">
                <tr>
                  <td>
                    <p style="margin:0 0 12px 0;font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#7A7A6A;">Antes de llegar</p>
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="padding:8px 0;vertical-align:top;">
                          <table cellpadding="0" cellspacing="0" border="0">
                            <tr>
                              <td style="padding-right:12px;vertical-align:top;">
                                <span style="display:inline-block;width:20px;height:20px;background-color:#C4956A;border-radius:50%;text-align:center;line-height:20px;font-family:Arial,sans-serif;font-size:10px;font-weight:700;color:#FFFFFF;">1</span>
                              </td>
                              <td>
                                <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#2C2C2C;line-height:1.5;"><strong>Guarda tu código de reserva</strong><br/><span style="color:#555550;">${bookingCode} — lo necesitarás en la recepción.</span></p>
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
                                <span style="display:inline-block;width:20px;height:20px;background-color:#C4956A;border-radius:50%;text-align:center;line-height:20px;font-family:Arial,sans-serif;font-size:10px;font-weight:700;color:#FFFFFF;">2</span>
                              </td>
                              <td>
                                <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#2C2C2C;line-height:1.5;"><strong>Cómo llegar</strong><br/><span style="color:#555550;">Cl. 61 #23-36, La Estrella, Manizales.</span></p>
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
                                <span style="display:inline-block;width:20px;height:20px;background-color:#C4956A;border-radius:50%;text-align:center;line-height:20px;font-family:Arial,sans-serif;font-size:10px;font-weight:700;color:#FFFFFF;">3</span>
                              </td>
                              <td>
                                <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#2C2C2C;line-height:1.5;"><strong>Trae tu documento de identidad</strong><br/><span style="color:#555550;">Requerido por normatividad hotelera colombiana para el registro.</span></p>
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
            <td style="padding:0 40px 28px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F0EDE6;border-radius:8px;padding:20px 24px;">
                <tr><td style="text-align:center;">
                  <p style="margin:0 0 6px 0;font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#7A7A6A;">Desayuno incluido</p>
                  <p style="margin:0 0 16px 0;font-family:Georgia,serif;font-size:14px;color:#555550;line-height:1.6;">Muestra tu pase en el comedor. Ábrelo desde aquí — sin apps ni claves.</p>
                  <a href="${passUrl}" style="display:inline-block;padding:12px 28px;background-color:#2C2C2C;border-radius:6px;font-family:Arial,sans-serif;font-size:13px;font-weight:700;color:#FFFFFF;text-decoration:none;letter-spacing:0.04em;">Ver mis pases de desayuno</a>
                </td></tr>
              </table>
            </td>
          </tr>` : ''}

          <!-- WhatsApp contact -->
          <tr>
            <td style="padding:0 40px 32px 40px;text-align:center;">
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

          <!-- Divider -->
          <tr>
            <td style="padding:0 40px;">
              <hr style="border:none;border-top:1px solid #E8E4DC;margin:0;" />
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;text-align:center;">
              <p style="margin:0 0 6px 0;font-family:Arial,sans-serif;font-size:11px;color:#9A9A8A;">
                <strong style="color:#555550;">Hotel Estar</strong> · Cl. 61 #23-36, La Estrella, Manizales, Caldas, Colombia
              </p>
              <p style="margin:0;font-family:Arial,sans-serif;font-size:10px;color:#BCBCB0;line-height:1.5;">
                Este correo es una confirmación automática de tu reserva. Guárdalo como comprobante.<br/>
                Para cancelaciones o modificaciones comunícate con nosotros antes de 48h del check-in.
              </p>
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

  // Check for Resend API key
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    if (process.env.DEBUG) console.log('[send-confirmation] RESEND_API_KEY not configured. Skipping email send.');
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        sent: false,
        reason: 'RESEND_API_KEY not configured'
      })
    };
  }

  // Build email HTML
  // Pase de desayuno (Fase 2): si la reserva incluye desayuno, añade un link
  // firmado a la página de pases (QR por persona). Retrocompatible: sin el flag
  // `breakfast` en el body, el correo sale igual que antes.
  let passUrl = '';
  if (body.breakfast) {
    try {
      const base = (process.env.GUEST_APP_BASE_URL || process.env.URL || process.env.DEPLOY_URL || 'https://estar.com.co').replace(/\/$/, '');
      passUrl = `${base}/pase-desayuno?t=${signPassToken(bookingCode)}`;
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

  // Send via Resend API
  try {
    const resendController = new AbortController();
    const resendTimeoutId = setTimeout(() => resendController.abort(), 10000);
    let resendResponse;
    try {
      resendResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          // TODO: Replace 'reservas@estar.com.co' with the verified sender domain in Resend
          from: 'Estar Manizales <reservas@estar.com.co>',
          to: guestEmail,
          subject: `Confirmación de reserva ${bookingCode} — Estar Manizales`,
          html: emailHtml
        }),
        signal: resendController.signal
      });
      clearTimeout(resendTimeoutId);
    } catch (err) {
      clearTimeout(resendTimeoutId);
      if (err.name === 'AbortError') {
        return { statusCode: 504, body: JSON.stringify({ error: 'Request timeout' }) };
      }
      throw err;
    }

    const resendData = await resendResponse.json();

    if (!resendResponse.ok) {
      console.error('[send-confirmation] Resend API error status:', resendResponse.status, resendData?.message || '');
      return {
        statusCode: 502,
        headers: corsHeaders,
        body: JSON.stringify({
          sent: false,
          error: 'Failed to send email'
        })
      };
    }

    if (process.env.DEBUG) console.log(`[send-confirmation] Email sent to ${obfuscateEmail(guestEmail)} for booking ${bookingCode}. Resend ID: ${resendData.id}`);
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        sent: true,
        resendId: resendData.id,
        to: obfuscateEmail(guestEmail),
        bookingCode
      })
    };

  } catch (err) {
    console.error('[send-confirmation] Unexpected error:', err.message);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        sent: false,
        error: 'Internal server error while sending email'
      })
    };
  }
};
