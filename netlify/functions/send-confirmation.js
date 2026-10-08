/* Correo de confirmación de reserva — SOLO SERVIDOR (Frente confirm, 2026-10).
 *
 * HUECO CERRADO: `/api/send-confirmation` era público y aceptaba del navegador
 * el destinatario, el código y todo el contenido. Cualquiera podía:
 *   - mandar un "Reserva confirmada" con la marca del hotel a cualquier correo;
 *   - con `breakfast:true`, obtener un pase de desayuno FIRMADO para cualquier
 *     código → breakfast-passes devolvía nombre, apartamento y fechas del
 *     huésped real (saltándose el 2º factor de get-booking);
 *   - elegir la clave anti-duplicados y "reservar" un código para suprimir la
 *     confirmación legítima.
 * Además el motor (motor-app.jsx) mandaba "Reserva confirmada" aunque la
 * reserva NO se hubiera creado (timeout de 60 s / pendiente), con el código
 * EST-, y luego el webhook mandaba un segundo correo con el id de OTASync.
 *
 * AHORA:
 *   - `sendConfirmationEmail(params, deps)` es la ÚNICA vía. La llaman
 *     in-process los webhooks de pago (wompi-webhook ya; mercadopago lo agrega
 *     su frente) DESPUÉS de crear la reserva en OTASync, con datos que el
 *     servidor ya verificó (referencia firmada + pago aprobado).
 *   - El endpoint HTTP queda RETIRADO (410 Gone), igual que create-booking:
 *     el único que lo llamaba era el navegador (motor-app), que ya no lo hace.
 *   - La clave anti-duplicados se DERIVA en el servidor del código de reserva;
 *     `params.dedupeKey` se ignora a propósito.
 *   - El pase de desayuno solo se firma aquí (token v2, _breakfast-pass), es
 *     decir, solo para reservas que el webhook ya creó.
 *
 * Firma compatible: sendConfirmationEmail({ guestEmail, guestName, bookingCode,
 * roomName, checkIn, checkOut, nights, totalAmount, paidAmount, phone,
 * breakfast, via, lang? }, deps?) → { sent, reason?, resendId?, to?, duplicate? }.
 * `lang` ('es' | 'en', opcional, default 'es') elige el idioma del correo. */

require('./_env');
const { signPassToken } = require('./_breakfast-pass');
const { BREAKFAST_SCHEDULE } = require('./_breakfast');
const email = require('./_email');
const { getStore } = require('@netlify/blobs');

/* Mismo horario que _breakfast.BREAKFAST_SCHEDULE (7:00 a 10:00 a. m.), en inglés. */
const BREAKFAST_SCHEDULE_EN = '7:00 to 10:00 am';

const SITE_FALLBACK = 'https://estar.com.co';

/**
 * Formats a COP amount as "$ 660.000"
 */
function formatCOP(amount) {
  if (!amount && amount !== 0) return '$ 0';
  return '$ ' + Math.round(amount).toLocaleString('es-CO');
}

const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Formats "YYYY-MM-DD" → "10 de junio de 2024" (es) / "June 10, 2024" (en).
 */
function formatDate(dateStr, lang) {
  if (!dateStr) return dateStr;
  const parts = String(dateStr).split('-');
  if (parts.length !== 3) return dateStr;
  const day = parseInt(parts[2], 10);
  const month = parseInt(parts[1], 10) - 1;
  const year = parts[0];
  if (!(month >= 0 && month < 12) || !day) return dateStr;
  return lang === 'en'
    ? `${MONTHS_EN[month]} ${day}, ${year}`
    : `${day} de ${MONTHS_ES[month]} de ${year}`;
}

/* Compat: algunos llamadores/tests usaban el formateador en español. */
function formatDateES(dateStr) {
  return formatDate(dateStr, 'es');
}

/**
 * Obfuscates an email address for logging purposes.
 */
function obfuscateEmail(addr) {
  if (!addr || typeof addr !== 'string') return '';
  const parts = addr.split('@');
  if (parts.length !== 2) return '***';
  const name = parts[0];
  const domain = parts[1];
  return name.length > 2 ? `${name[0]}***${name[name.length - 1]}@${domain}` : `***@${domain}`;
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function normalizeLang(lang) {
  return String(lang || '').toLowerCase().slice(0, 2) === 'en' ? 'en' : 'es';
}

/* Origen público del sitio para los enlaces del correo (pases, guest app). */
function siteBaseUrl() {
  return (process.env.GUEST_APP_BASE_URL || process.env.URL || process.env.DEPLOY_URL || SITE_FALLBACK).replace(/\/$/, '');
}

/* Enlace a la app del huésped con el código de reserva prellenado
   (guest-app.js lee ?code= y lo pone en el formulario de ingreso; el apellido
   sigue siendo obligatorio como 2º factor). */
function guestAppUrl(bookingCode, base) {
  const origin = (base || siteBaseUrl()).replace(/\/$/, '');
  const code = String(bookingCode || '').trim();
  return code ? `${origin}/guest.html?code=${encodeURIComponent(code)}` : `${origin}/guest.html`;
}

/* Clave anti-duplicados DERIVADA EN EL SERVIDOR del código de reserva (el id
   de OTASync que crea el webhook). Ningún dato del cliente participa: antes un
   atacante podía mandar `dedupeKey` y "reservar" un código para suprimir la
   confirmación legítima. Mismo formato que las claves ya guardadas (código
   recortado), así un reintento del webhook sigue deduplicando. */
function confirmationDedupeKey(bookingCode) {
  return String(bookingCode == null ? '' : bookingCode).trim();
}

/* Clave de ALMACENAMIENTO en el store de dedupe: espacio de nombres propio
   del servidor ('srv:'). Las claves sin prefijo pudieron ser sembradas por el
   antiguo endpoint público (el atacante elegía el código) y Netlify Blobs no
   las caduca; con el prefijo, esas claves viejas ya no suprimen nada. */
function confirmationStoreKey(bookingCode) {
  const code = confirmationDedupeKey(bookingCode);
  return code ? `srv:${code}` : '';
}

/* Alerta por reserva (dedupeKey por código) para que cada fallo tenga su
   propia tarea en el ops-queue. Best-effort, nunca lanza. */
async function alertConfirmationFailure(bookingCode, reason, detail) {
  try {
    await require('./_alert').reportAlert({
      kind: 'confirmation_email_failed', severity: 'error',
      message: 'No se pudo enviar el correo de confirmación de reserva al huésped. Reenviarlo a mano.',
      context: { bookingCode, reason, detail: String(detail || '').slice(0, 200) },
      dedupeKey: `confirmation-email-failed:${bookingCode}`
    });
  } catch (_) { /* alert best-effort */ }
}

const BOOKING_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

/* Textos del correo en ES/EN. Lo variable (nombre, código, fechas, montos,
   enlaces) se interpola ya escapado en buildEmailHtml. */
const COPY = {
  es: {
    htmlLang: 'es',
    title: 'Confirmación de reserva — Estar Manizales',
    subject: code => `Confirmación de reserva ${code} — Estar Manizales`,
    hero: 'Reserva confirmada',
    hi: 'Hola',
    intro: 'Tu reserva en <strong>Estar Manizales</strong> ha sido confirmada con éxito. A continuación encuentras todos los detalles de tu estadía.',
    roomLabel: 'Tipología',
    checkInLabel: 'Llegada',
    checkInHint: 'Check-in desde las 3:00 pm',
    checkOutLabel: 'Salida',
    checkOutHint: 'Check-out antes de las 11:00 a. m.',
    nightsLabel: 'Duración de la estadía',
    night: 'noche',
    nights: 'noches',
    paidLabel: 'Total pagado (online)',
    totalLabel: 'Total reserva:',
    beforeLabel: 'Antes de llegar',
    step1Title: 'Haz tu check-in digital',
    step1Text: 'Complétalo un día antes de tu llegada desde la app del huésped (entras con tu código de reserva y tu apellido). Al completarlo te enviaremos las instrucciones de llegada.',
    step1Cta: 'Hacer mi check-in digital',
    step2Title: 'Ten tu documento a la mano',
    step2Text: 'Requerido por la normatividad hotelera colombiana para el registro.',
    step3Title: 'Cómo llegar',
    waze: 'Abrir en Waze',
    maps: 'Google Maps',
    breakfastLabel: 'Desayuno incluido',
    breakfastText: schedule => `Muestra tu pase en el comedor (${schedule}; o antes, si lo solicitas con antelación). Ábrelo desde aquí — sin apps ni claves.`,
    breakfastCta: 'Ver mis pases de desayuno',
    waQuestion: '¿Tienes alguna pregunta o petición especial? Escríbenos directamente por WhatsApp.',
    waCta: 'Contactar por WhatsApp',
    waText: code => `Hola, tengo una reserva con código ${code} y quisiera hacer una consulta.`,
    footerNote: 'Guarda este correo como comprobante de tu reserva. La política de cancelación depende de tu tarifa (Estricta / Flexible) — consúltala en estar.com.co/cancelacion.html'
  },
  en: {
    htmlLang: 'en',
    title: 'Booking confirmation — Estar Manizales',
    subject: code => `Booking confirmation ${code} — Estar Manizales`,
    hero: 'Booking confirmed',
    hi: 'Hi',
    intro: 'Your booking at <strong>Estar Manizales</strong> is confirmed. Below you will find all the details of your stay.',
    roomLabel: 'Room type',
    checkInLabel: 'Check-in',
    checkInHint: 'Check-in from 3:00 pm',
    checkOutLabel: 'Check-out',
    checkOutHint: 'Check-out by 11:00 am',
    nightsLabel: 'Length of stay',
    night: 'night',
    nights: 'nights',
    paidLabel: 'Total paid (online)',
    totalLabel: 'Booking total:',
    beforeLabel: 'Before you arrive',
    step1Title: 'Complete your digital check-in',
    step1Text: 'Do it the day before you arrive in the guest app (sign in with your booking code and last name). Once it is done we will send you the arrival instructions.',
    step1Cta: 'Start my digital check-in',
    step2Title: 'Have your ID document at hand',
    step2Text: 'Required by Colombian hotel regulations for guest registration.',
    step3Title: 'Getting here',
    waze: 'Open in Waze',
    maps: 'Google Maps',
    breakfastLabel: 'Breakfast included',
    breakfastText: schedule => `Show your pass in the dining room (${schedule}; or earlier if you request it in advance). Open it from here — no apps or passwords.`,
    breakfastCta: 'View my breakfast passes',
    waQuestion: 'Any questions or special requests? Message us directly on WhatsApp.',
    waCta: 'Contact us on WhatsApp',
    waText: code => `Hi, I have a booking with code ${code} and I have a question.`,
    footerNote: 'Keep this email as proof of your booking. The cancellation policy depends on your rate (Strict / Flexible) — see estar.com.co/en/cancelacion.html'
  }
};

/**
 * Builds the HTML email template for a booking confirmation.
 * All CSS is inline for maximum email client compatibility (Gmail, Apple Mail, Outlook).
 */
function buildEmailHtml({
  guestName,
  bookingCode,
  roomName,
  checkIn,
  checkOut,
  nights,
  totalAmount,
  paidAmount,
  phone, // eslint-disable-line no-unused-vars -- kept for signature compatibility
  passUrl,
  guestAppUrl: appUrl,
  lang
}) {
  const L = normalizeLang(lang);
  const c = COPY[L];
  const rawCode = String(bookingCode || '');
  guestName  = esc(guestName);
  bookingCode = esc(bookingCode);
  roomName   = esc(roomName);
  const nightsLabel = nights === 1 ? c.night : c.nights;
  const checkInFormatted = esc(formatDate(checkIn, L));
  const checkOutFormatted = esc(formatDate(checkOut, L));
  const totalFormatted = formatCOP(totalAmount);
  const paidFormatted = formatCOP(paidAmount);
  const schedule = L === 'en' ? BREAKFAST_SCHEDULE_EN : BREAKFAST_SCHEDULE;
  const appHref = esc(appUrl || guestAppUrl(rawCode));
  const waHref = `https://api.whatsapp.com/send/?phone=573102490414&text=${encodeURIComponent(c.waText(rawCode))}`;

  return `<!DOCTYPE html>
<html lang="${c.htmlLang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light only" />
  <meta name="supported-color-schemes" content="light only" />
  <title>${c.title}</title>
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
              <p style="margin:0 0 9px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#FFFFFF;opacity:0.92;">${c.hero}</p>
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:23px;font-weight:700;letter-spacing:0.16em;color:#FFFFFF;">${bookingCode}</p>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td class="em-px" style="padding:32px 40px 0 40px;">
              <p style="margin:0;font-family:Georgia,serif;font-size:16px;color:#2C2C2C;line-height:1.6;">
                ${c.hi} <strong>${guestName}</strong>,
              </p>
              <p style="margin:12px 0 0 0;font-family:Georgia,serif;font-size:14px;color:#555550;line-height:1.7;">
                ${c.intro}
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
                    <p style="margin:0 0 4px 0;font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#9A9A8A;">${c.roomLabel}</p>
                    <p style="margin:0;font-family:Georgia,serif;font-size:15px;color:#2C2C2C;font-weight:700;">${roomName}</p>
                  </td>
                </tr>

                <!-- Row: Fechas -->
                <tr>
                  <td style="padding:0;border-bottom:1px solid #E8E4DC;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="padding:16px 20px;width:50%;border-right:1px solid #E8E4DC;">
                          <p style="margin:0 0 4px 0;font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#9A9A8A;">${c.checkInLabel}</p>
                          <p style="margin:0;font-family:Georgia,serif;font-size:14px;color:#2C2C2C;">${checkInFormatted}</p>
                          <p style="margin:4px 0 0 0;font-family:Arial,sans-serif;font-size:11px;color:#9A9A8A;">${c.checkInHint}</p>
                        </td>
                        <td style="padding:16px 20px;width:50%;">
                          <p style="margin:0 0 4px 0;font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#9A9A8A;">${c.checkOutLabel}</p>
                          <p style="margin:0;font-family:Georgia,serif;font-size:14px;color:#2C2C2C;">${checkOutFormatted}</p>
                          <p style="margin:4px 0 0 0;font-family:Arial,sans-serif;font-size:11px;color:#9A9A8A;">${c.checkOutHint}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Row: Noches -->
                <tr>
                  <td style="padding:16px 20px;border-bottom:1px solid #E8E4DC;background-color:#FAF8F4;">
                    <p style="margin:0 0 4px 0;font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#9A9A8A;">${c.nightsLabel}</p>
                    <p style="margin:0;font-family:Georgia,serif;font-size:14px;color:#2C2C2C;">${nights} ${nightsLabel}</p>
                  </td>
                </tr>

                <!-- Row: Monto pagado -->
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="margin:0 0 4px 0;font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#9A9A8A;">${c.paidLabel}</p>
                    <p style="margin:0;font-family:Georgia,serif;font-size:22px;font-weight:700;color:#9b9065;">${paidFormatted} COP</p>
                    ${totalAmount !== paidAmount ? `<p style="margin:4px 0 0 0;font-family:Arial,sans-serif;font-size:11px;color:#9A9A8A;">${c.totalLabel} ${totalFormatted} COP</p>` : ''}
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
                    <p style="margin:0 0 12px 0;font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#7A7A6A;">${c.beforeLabel}</p>
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="padding:8px 0;vertical-align:top;">
                          <table cellpadding="0" cellspacing="0" border="0">
                            <tr>
                              <td style="padding-right:12px;vertical-align:top;">
                                <span style="display:inline-block;width:20px;height:20px;background-color:#9b9065;border-radius:50%;text-align:center;line-height:20px;font-family:Arial,sans-serif;font-size:10px;font-weight:700;color:#FFFFFF;">1</span>
                              </td>
                              <td>
                                <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#2C2C2C;line-height:1.5;"><strong>${c.step1Title}</strong><br/><span style="color:#555550;">${c.step1Text}</span></p>
                                <p style="margin:10px 0 0 0;"><a href="${appHref}" style="display:inline-block;padding:10px 20px;background-color:#9b9065;border-radius:6px;font-family:Arial,sans-serif;font-size:12px;font-weight:700;color:#FFFFFF;text-decoration:none;letter-spacing:0.04em;">${c.step1Cta}</a></p>
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
                                <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#2C2C2C;line-height:1.5;"><strong>${c.step2Title}</strong><br/><span style="color:#555550;">${c.step2Text}</span></p>
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
                                <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#2C2C2C;line-height:1.5;"><strong>${c.step3Title}</strong><br/><span style="color:#555550;">Cl. 61 #23-36, La Estrella, Manizales.</span><br/><a href="${email.WAZE_LINK}" style="color:#9b9065;font-weight:700;text-decoration:none;">${c.waze}</a> &nbsp;·&nbsp; <a href="${email.MAPS_LINK}" style="color:#9b9065;font-weight:700;text-decoration:none;">${c.maps}</a></p>
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
                  <p style="margin:0 0 6px 0;font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#7A7A6A;">${c.breakfastLabel}</p>
                  <p style="margin:0 0 16px 0;font-family:Georgia,serif;font-size:14px;color:#555550;line-height:1.6;">${c.breakfastText(schedule)}</p>
                  <a href="${esc(passUrl)}" style="display:inline-block;padding:12px 28px;background-color:#2C2C2C;border-radius:6px;font-family:Arial,sans-serif;font-size:13px;font-weight:700;color:#FFFFFF;text-decoration:none;letter-spacing:0.04em;">${c.breakfastCta}</a>
                </td></tr>
              </table>
            </td>
          </tr>` : ''}

          <!-- WhatsApp contact -->
          <tr>
            <td class="em-px" style="padding:0 40px 32px 40px;text-align:center;">
              <p style="margin:0 0 16px 0;font-family:Arial,sans-serif;font-size:13px;color:#555550;line-height:1.6;">
                ${c.waQuestion}
              </p>
              <a href="${esc(waHref)}"
                style="display:inline-block;padding:12px 28px;background-color:#25D366;border-radius:6px;font-family:Arial,sans-serif;font-size:13px;font-weight:700;color:#FFFFFF;text-decoration:none;letter-spacing:0.04em;">
                ${c.waCta}
              </a>
              <p style="margin:12px 0 0 0;font-family:Arial,sans-serif;font-size:12px;color:#9A9A8A;">+57 310 249 0414 · reservas@estar.com.co</p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td class="em-px" style="background-color:#faf6ef;padding:22px 40px 26px;text-align:center;border-top:1px solid #ece5d6;">
              <div style="margin-bottom:10px;"><span style="color:#9b9065;font-size:15px;line-height:1;">&#10022;</span></div>
              <p style="margin:0 0 8px 0;font-family:Arial,sans-serif;font-size:11px;line-height:1.7;color:#9b9482;">Hotel estar · Cl. 61 #23-36, La Estrella · Manizales<br/>reservas@estar.com.co · +57 310 249 0414</p>
              <p style="margin:0;font-family:Arial,sans-serif;font-size:10px;color:#b6ad97;line-height:1.5;">${c.footerNote}</p>
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

/* ── Idempotent confirmation sender (server-only) ───────────────────────
   Solo los webhooks de pago llaman esto, tras crear la reserva. Un reintento
   del webhook (o dos proveedores para la misma reserva) no debe duplicar el
   correo: el primer envío RECLAMA la clave (onlyIfNew) y la marca tras el
   éxito; cualquier disparo posterior para la misma reserva es no-op. Si el
   envío falla, el reclamo se libera para que siga siendo reintentable.
   No fatal: si Blobs no está disponible se envía igual (un duplicado raro es
   mejor que ningún correo). */
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
   result ({ sent, reason?, resendId?, to? }) — not an HTTP response. SOLO para
   llamadores del servidor que ya verificaron el pago y crearon la reserva
   (wompi-webhook, mercadopago-webhook/_payments). Deps (fetch, signPassToken,
   getStore, dedupe) are injectable for tests. */
async function sendConfirmationEmail(params, deps = {}) {
  const d = {
    fetch,
    signPassToken,
    getStore: getConfirmationStore,
    dedupe: true,
    ...deps
  };
  const p = params || {};
  const {
    guestEmail, guestName, bookingCode, roomName,
    checkIn, checkOut, nights, totalAmount, paidAmount, phone, breakfast
  } = p;
  const lang = normalizeLang(p.lang);
  const c = COPY[lang];
  /* La clave SIEMPRE se deriva del código de reserva (servidor). Un
     `p.dedupeKey` heredado se ignora a propósito. */
  const dedupeKey = confirmationDedupeKey(bookingCode);
  const to = String(guestEmail || '').trim();

  if (!to || !dedupeKey) {
    return { sent: false, reason: 'missing-fields' };
  }
  if (!EMAIL_RE.test(to) || to.length > 254) {
    return { sent: false, reason: 'invalid-email' };
  }
  if (!BOOKING_CODE_RE.test(dedupeKey)) {
    return { sent: false, reason: 'invalid-booking-code' };
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    if (process.env.DEBUG) console.log('[send-confirmation] RESEND_API_KEY not configured. Skipping email send.');
    return { sent: false, reason: 'no-key' };
  }

  // Idempotency: RECLAMAR la clave atómicamente ANTES de enviar (onlyIfNew), para
  // que dos ejecuciones concurrentes no envíen ambas. Si el envío falla, se libera
  // el reclamo (releaseDedupe) para que siga siendo reintentable.
  const store = d.dedupe ? d.getStore() : null;
  const storeKey = confirmationStoreKey(dedupeKey);
  let claimedDedupe = false;
  const releaseDedupe = async () => {
    if (claimedDedupe && store && dedupeKey) {
      try { await store.delete(storeKey); } catch (_) { /* best-effort */ }
    }
  };
  if (store && dedupeKey) {
    try {
      const claim = await store.set(storeKey, JSON.stringify({ claimedAt: new Date().toISOString() }), { onlyIfNew: true });
      if (claim && claim.modified === false) {
        console.log(`[send-confirmation] duplicate suppressed for booking ${dedupeKey}`);
        return { sent: false, reason: 'duplicate', duplicate: true };
      }
      claimedDedupe = true;
    } catch (e) {
      if (process.env.DEBUG) console.warn('[send-confirmation] dedup claim failed; sending anyway:', e.message);
    }
  }

  const base = siteBaseUrl();

  // Pase de desayuno (Fase 2): si la reserva incluye desayuno, añade un link
  // firmado (token v2, emitido SOLO aquí, en el servidor) a la página de pases.
  let passUrl = '';
  if (breakfast) {
    try {
      passUrl = `${base}/pase-desayuno?t=${d.signPassToken(dedupeKey)}`;
    } catch (e) {
      if (process.env.DEBUG) console.warn('[send-confirmation] no se pudo firmar el pase:', e.message);
    }
  }

  let emailHtml;
  try {
    emailHtml = buildEmailHtml({
      guestName: guestName || (lang === 'en' ? 'Guest' : 'Huésped'),
      bookingCode: dedupeKey,
      roomName: roomName || (lang === 'en' ? 'Studio apartment' : 'Apartaestudio'),
      checkIn: checkIn || '',
      checkOut: checkOut || '',
      nights: parseInt(nights) || 1,
      totalAmount: parseFloat(totalAmount) || 0,
      paidAmount: parseFloat(paidAmount) || parseFloat(totalAmount) || 0,
      phone: phone || '',
      passUrl,
      guestAppUrl: guestAppUrl(dedupeKey, base),
      lang
    });
  } catch (e) {
    /* Si armar el correo lanza, liberar el claim de dedupe para no suprimir
       permanentemente un correo legítimo (quedaría reintentable). */
    await releaseDedupe();
    throw e;
  }

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
        to,
        subject: c.subject(dedupeKey),
        html: emailHtml,
        text: email.htmlToText(emailHtml),
        attachments: [require('./_logo').logoAttachment()]
      }),
      signal: resendController.signal
    });
    clearTimeout(resendTimeoutId);
  } catch (err) {
    clearTimeout(resendTimeoutId);
    await releaseDedupe();
    if (err && err.name === 'AbortError') {
      await alertConfirmationFailure(dedupeKey, 'timeout', 'Resend no respondió en 10 s');
      return { sent: false, reason: 'timeout' };
    }
    console.error('[send-confirmation] network error calling Resend:', err && err.message);
    await alertConfirmationFailure(dedupeKey, 'network-error', err && err.message);
    return { sent: false, reason: 'network-error' };
  }

  const resendData = await resendResponse.json().catch(() => ({}));
  if (!resendResponse.ok) {
    console.error('[send-confirmation] Resend API error status:', resendResponse.status, (resendData && resendData.message) || '');
    await alertConfirmationFailure(dedupeKey, `resend-error-${resendResponse.status}`, (resendData && resendData.message) || '');
    await releaseDedupe();
    return { sent: false, reason: 'resend-error', status: resendResponse.status };
  }

  // Mark sent only AFTER success, so a failed send stays retryable.
  if (store && dedupeKey) {
    try {
      await store.set(storeKey, JSON.stringify({
        bookingCode: dedupeKey, resendId: resendData.id, via: p.via || 'unknown', lang, at: new Date().toISOString()
      }));
    } catch (e) {
      if (process.env.DEBUG) console.warn('[send-confirmation] dedup mark failed:', e.message);
    }
  }

  if (process.env.DEBUG) console.log(`[send-confirmation] Email sent to ${obfuscateEmail(to)} for booking ${dedupeKey}. Resend ID: ${resendData.id}`);
  return { sent: true, resendId: resendData.id, to: obfuscateEmail(to), bookingCode: dedupeKey };
}

/* ── Endpoint HTTP RETIRADO ─────────────────────────────────────────────
   Nada legítimo lo llama: el motor dejó de pedir la confirmación desde el
   navegador y los webhooks usan sendConfirmationEmail in-process. Responde
   410 Gone (como create-booking) y NUNCA envía nada, sin importar el cuerpo,
   para que una versión cacheada del motor o un atacante no puedan mandar
   correos con la marca del hotel ni obtener pases de desayuno firmados. */
const GONE_MESSAGE =
  'Este endpoint fue retirado. La confirmación de la reserva se envía automáticamente ' +
  'por correo cuando el pago queda registrado.';

exports.handler = async (event) => {
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  const corsHeaders = {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'OPTIONS',
    'Content-Type': 'application/json'
  };
  if (allowedOrigin && allowedOrigin !== '*') {
    corsHeaders['Access-Control-Allow-Origin'] = allowedOrigin;
  }

  if (event && event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  return {
    statusCode: 410,
    headers: corsHeaders,
    body: JSON.stringify({ error: 'gone', message: GONE_MESSAGE })
  };
};

exports.sendConfirmationEmail = sendConfirmationEmail;
exports.confirmationDedupeKey = confirmationDedupeKey;
exports.confirmationStoreKey = confirmationStoreKey;
exports._test = {
  buildEmailHtml, sendConfirmationEmail, getConfirmationStore,
  confirmationDedupeKey, guestAppUrl, formatDate, formatDateES, normalizeLang, COPY
};
