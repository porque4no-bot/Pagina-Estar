/* Shared transactional email via Resend.

   Brand system (2026-06, "Correos de estar" redesign): sand page, cream+logo
   header, editorial serif (Libre Baskerville → Georgia fallback), olive /
   terracotta / tan status bands, leaf-mark footer. All senders (this file +
   send-confirmation.js) share emailShell() + the component helpers below so
   every email looks the same. Edit the tokens/shell here, not per-template. */

const FROM = 'Estar Manizales <reservas@estar.com.co>';
const { LOGO_CID, logoAttachment } = require('./_logo');

/* ── Brand tokens ───────────────────────────────────────────────────────── */
const SITE = 'https://estar.com.co';
const LOGO_URL = `${SITE}/assets/logo-wordmark-charcoal-onwhite.png`; // charcoal wordmark on the cream header
const MARK_URL = `${SITE}/assets/icon-star-taupe.png`;                // small footer mark
const WA_LINK = 'https://api.whatsapp.com/send/?phone=573102490414';
const MAPS_LINK = 'https://maps.app.goo.gl/QwDXDmpE7NwV4m1ZA';
const WAZE_LINK = 'https://ul.waze.com/ul?place=ChIJT2vbCbBlR44Rbq4GbLKZIeU&ll=5.05957470%2C-75.48809350&navigate=yes';
const GUEST_APP_LINK = `${SITE}/guest.html`;
const ADDRESS = 'Cl. 61 #23-36, La Estrella · Manizales';

const C = {
  page: '#e7e1d4', card: '#ffffff', cream: '#faf6ef',
  olive: '#9b9065', terra: '#af6d3b', tan: '#c4ab8f', dark: '#28292b',
  ink: '#28292b', body: '#4a4636', muted: '#9b9482',
  border: '#ebe4d5', footBorder: '#ece5d6'
};
const SERIF = "'Libre Baskerville',Georgia,'Times New Roman',serif";
const SANS = 'Arial,Helvetica,sans-serif';

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

function formatDateEN(isoStr) {
  if (!isoStr) return '—';
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* Derive a readable plain-text version from our table-based HTML. Every email
   goes out multipart (text + html): better deliverability (esp. Outlook/365,
   which distrusts HTML-only mail), better text/HTML ratio, and accessible in
   text-only clients. Auto-used by sendEmail when no explicit `text` is passed. */
function htmlToText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<(script|noscript)[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (m, href, txt) => {
      const t = txt.replace(/<[^>]+>/g, '').trim();
      return t && !/^https?:/i.test(t) ? `${t} (${href})` : href;
    })
    .replace(/<\/(p|div|tr|h[1-6]|li|table)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function sendEmail({ to, cc, subject, html, text, attachments }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (process.env.DEBUG) console.log('[email] RESEND_API_KEY missing; skipping send');
    return { sent: false, reason: 'no-key' };
  }
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 10000);
  /* Attach the inline logo automatically when the HTML references it (cid). */
  const atts = attachments || ((html && html.indexOf('cid:' + LOGO_CID) !== -1) ? [logoAttachment()] : undefined);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to, cc, subject, html, text: text || htmlToText(html), ...(atts ? { attachments: atts } : {}) }),
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

/* ── Shell + components (shared by every client-facing email) ───────────── */

/* The logo renders from an INLINE (CID) attachment — `<img src="cid:estarlogo">`
   resolves to the PNG embedded in the message itself, so it shows without a
   remote fetch (no "images not shown for your security" block, the Outlook
   problem). `sendEmail` attaches it automatically when the HTML references it.
   Decorative star marks use a Unicode glyph (✦) — also always-renders, no image. */
const STAR = `<span style="color:${C.olive};font-size:15px;line-height:1;">&#10022;</span>`;

/* Full-page brand shell. band = {color, textColor, eyebrow, code?}. */
function emailShell({ lang = 'es', band, bodyHtml }) {
  const b = band || {};
  const bandColor = b.color || C.olive;
  const bandText = b.textColor || '#ffffff';
  const bandHtml = b.eyebrow ? `
      <tr><td class="em-px" style="background:${bandColor};padding:${b.code ? '22px' : '18px'} 40px;text-align:center;">
        <div style="font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:${bandText};opacity:.92;">${esc(b.eyebrow)}</div>
        ${b.code ? `<div style="margin-top:9px;font-family:${SANS};font-size:23px;font-weight:700;letter-spacing:.16em;color:${bandText};">${esc(b.code)}</div>` : ''}
      </td></tr>` : '';
  return `<!DOCTYPE html><html lang="${lang}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
<style>@media only screen and (max-width:600px){.em-pwrap{padding:14px 0!important;}.em-card{border-radius:0!important;}.em-px{padding-left:20px!important;padding-right:20px!important;}}</style>
</head><body style="margin:0;padding:0;background:${C.page};-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="em-pwrap" style="background:${C.page};padding:40px 16px;"><tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="em-card" style="max-width:600px;width:100%;background:${C.card};border-radius:14px;overflow:hidden;box-shadow:0 1px 2px rgba(40,41,43,.06),0 12px 32px rgba(40,41,43,.07);font-family:${SERIF};">
      <tr><td class="em-px" style="background:${C.cream};padding:32px 40px 24px;text-align:center;">
        <img src="cid:${LOGO_CID}" alt="estar Apartaestudios" width="150" style="display:block;margin:0 auto;width:150px;max-width:62%;height:auto;">
        <div style="margin-top:14px;font-family:${SANS};font-size:10px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:${C.olive};">Manizales · Colombia</div>
      </td></tr>
      ${bandHtml}
      <tr><td class="em-px" style="padding:32px 40px 30px;">${bodyHtml}</td></tr>
      <tr><td class="em-px" style="background:${C.cream};padding:22px 40px 26px;text-align:center;border-top:1px solid ${C.footBorder};">
        <div style="margin-bottom:10px;">${STAR}</div>
        <div style="font-family:${SANS};font-size:11px;line-height:1.7;color:${C.muted};">Hotel estar · ${ADDRESS}<br>reservas@estar.com.co · +57 310 249 0414</div>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

function greeting(name, lang) {
  const hi = lang === 'en' ? 'Hi' : 'Hola';
  return `<p style="margin:0 0 16px;font-family:${SERIF};font-size:16px;line-height:1.6;color:${C.ink};">${hi} <strong>${esc(name || (lang === 'en' ? 'there' : ''))}</strong>,</p>`;
}

function para(html) {
  return `<p style="margin:0 0 18px;font-family:${SERIF};font-size:15px;line-height:1.75;color:${C.body};">${html}</p>`;
}

function fineprint(html) {
  return `<p style="margin:22px 0 0;font-family:${SANS};font-size:12px;line-height:1.65;color:${C.muted};">${html}</p>`;
}

/* variant: 'primary' (olive) | 'secondary' (tan, dark text) | 'dark' (ink). */
function ctaButton(href, label, variant = 'primary') {
  const map = {
    primary: [C.olive, '#ffffff'],
    secondary: [C.tan, C.ink],
    dark: [C.dark, '#ffffff']
  };
  const [bg, fg] = map[variant] || map.primary;
  return `<a href="${esc(href)}" style="display:inline-block;padding:15px 32px;background:${bg};border-radius:8px;font-family:${SANS};font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${fg};text-decoration:none;">${esc(label)}</a>`;
}

function ctaCenter(buttonHtml) {
  return `<div style="text-align:center;margin:4px 0 2px;">${buttonHtml}</div>`;
}

/* A bordered box with an olive uppercase label and free-form rows. */
function box(label, innerHtml, extraStyle = '') {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;border:1px solid ${C.border};border-radius:10px;border-collapse:separate;${extraStyle}">
    <tbody>
      <tr><td style="padding:15px 18px 2px;font-family:${SANS};font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:${C.olive};">${esc(label)}</td></tr>
      ${innerHtml}
    </tbody></table>`;
}

/* "Cómo llegar / Getting here" card with the real Waze + Maps links. */
function mapCard(lang) {
  const t = lang === 'en'
    ? { label: 'Getting here', waze: 'Open in Waze', maps: 'Directions' }
    : { label: 'Cómo llegar', waze: 'Abrir en Waze', maps: 'Cómo llegar' };
  return box(t.label, `
    <tr><td style="padding:0 18px 12px;font-family:${SERIF};font-size:14px;line-height:1.5;color:${C.ink};">${ADDRESS.replace(' · ', ', ')}</td></tr>
    <tr><td style="padding:0 18px 16px;"><table cellpadding="0" cellspacing="0" border="0"><tbody><tr>
      <td style="padding-right:8px;">${ctaButton(WAZE_LINK, t.waze, 'primary')}</td>
      <td>${ctaButton(MAPS_LINK, t.maps, 'secondary')}</td>
    </tr></tbody></table></td></tr>`);
}

/* Guest-app card (Wifi, recommendations, support during the stay). */
function guestAppCard(lang, url) {
  const t = lang === 'en'
    ? { label: 'Guest app', desc: 'Wifi, recommendations and support during your stay.', cta: 'Open app' }
    : { label: 'Guest app', desc: 'Wifi, recomendaciones y soporte durante tu estadía.', cta: 'Abrir app' };
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 4px;border:1px solid ${C.border};border-radius:10px;border-collapse:separate;">
    <tbody><tr><td style="padding:15px 16px;"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr>
      <td style="vertical-align:middle;">
        <div style="font-family:${SANS};font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:${C.olive};margin-bottom:4px;">${t.label}</div>
        <div style="font-family:${SERIF};font-size:13px;line-height:1.45;color:${C.body};">${t.desc}</div>
      </td>
      <td align="right" style="vertical-align:middle;padding-left:12px;"><a href="${esc(url || GUEST_APP_LINK)}" style="display:inline-block;padding:11px 18px;background:${C.dark};border-radius:8px;font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#ffffff;text-decoration:none;white-space:nowrap;">${t.cta}</a></td>
    </tr></tbody></table></td></tr></tbody></table>`;
}

function whatsappLine(lang, question) {
  const q = question || (lang === 'en' ? 'Need anything before you arrive?' : '¿Necesitas algo antes de llegar?');
  const cta = lang === 'en' ? 'Message us on WhatsApp' : 'Escríbenos por WhatsApp';
  return `<p style="margin:18px 0 0;text-align:center;font-family:${SANS};font-size:12px;color:${C.muted};">${esc(q)} <a href="${esc(WA_LINK)}" style="color:${C.olive};font-weight:700;text-decoration:none;">${cta}</a></p>`;
}

/* ── Internal/team shell (Arial, accent bar, "Uso interno") ─────────────── */
function internalShell({ accent = C.olive, kicker, title, bodyHtml }) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${C.page};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page};padding:40px 16px;"><tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:${C.card};border-radius:14px;overflow:hidden;box-shadow:0 1px 2px rgba(40,41,43,.06),0 12px 32px rgba(40,41,43,.07);font-family:${SANS};">
      <tr><td style="background:${C.cream};padding:22px 32px;border-bottom:1px solid ${C.footBorder};">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr>
          <td style="vertical-align:middle;"><img src="cid:${LOGO_CID}" alt="estar" width="96" style="width:96px;height:auto;display:block;"></td>
          <td align="right" style="vertical-align:middle;font-family:${SANS};font-size:9px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:${C.olive};">Uso interno · Equipo</td>
        </tr></tbody></table>
      </td></tr>
      <tr><td style="height:4px;background:${accent};font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td style="padding:28px 32px 30px;">
        ${kicker ? `<div style="font-family:${SANS};font-size:10px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:${accent};margin-bottom:8px;">${esc(kicker)}</div>` : ''}
        ${title ? `<h2 style="margin:0 0 14px;font-family:${SANS};font-size:20px;font-weight:700;line-height:1.3;color:${C.ink};">${esc(title)}</h2>` : ''}
        ${bodyHtml}
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

/* Key/value rows for internal data tables. rows = [[label, value], ...]. */
function dataRows(rows) {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tbody>${
    rows.map(([k, v], i) => {
      const last = i === rows.length - 1;
      const border = `border-top:1px solid ${C.footBorder};${last ? `border-bottom:1px solid ${C.footBorder};` : ''}`;
      return `<tr>
        <td style="padding:11px 0;${border}font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${C.muted};width:44%;vertical-align:top;">${esc(k)}</td>
        <td style="padding:11px 0;${border}font-size:14px;color:${C.ink};text-align:right;">${v}</td>
      </tr>`;
    }).join('')
  }</tbody></table>`;
}

function calloutBox(accent, label, html) {
  return `<div style="margin-top:18px;background:${C.cream};border-radius:8px;padding:14px 16px;">
    ${label ? `<div style="font-family:${SANS};font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${accent};margin-bottom:6px;">${esc(label)}</div>` : ''}
    <div style="font-size:14px;line-height:1.55;color:${C.ink};">${html}</div>
  </div>`;
}

/* ── Client templates ───────────────────────────────────────────────────── */

/* Client confirmation after a quote is paid and the reservation is created. */
function paymentConfirmationHtml({ quote, bookingCode, total }) {
  const stay = `${formatDateES(quote.checkin)} → ${formatDateES(quote.checkout)}`;
  const rooms = (quote.items || []).map(it =>
    `<tr><td style="padding:0 18px;"><div style="border-top:1px solid ${C.border};height:1px;font-size:0;line-height:0;">&nbsp;</div></td></tr>
     <tr><td style="padding:13px 18px;font-family:${SANS};font-size:13px;color:${C.body};">${esc(it.habitacion)} · ${it.unidades} u. × ${it.noches} noche(s)</td></tr>`
  ).join('');
  const body = `
    ${greeting(quote.contacto || quote.empresa, 'es')}
    ${para(`Confirmamos el pago y la reserva de la cotización <strong>${esc(quote.quoteId)}</strong>. Quédate con nosotros — te esperamos.`)}
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.border};border-radius:10px;border-collapse:separate;">
      <tbody>
        <tr><td style="padding:16px 18px 2px;font-family:${SANS};font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:${C.olive};">Estadía</td></tr>
        <tr><td style="padding:0 18px 14px;font-family:${SERIF};font-size:15px;line-height:1.5;color:${C.ink};">${stay} · ${quote.numPersonas || 1} huésped(es)</td></tr>
        ${rooms}
        <tr><td style="padding:0 18px;"><div style="border-top:1px solid ${C.border};height:1px;font-size:0;line-height:0;">&nbsp;</div></td></tr>
        <tr><td style="padding:14px 18px 16px;"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr>
          <td style="font-family:${SERIF};font-size:15px;font-weight:700;color:${C.ink};">Total pagado</td>
          <td align="right" style="font-family:${SANS};font-size:18px;font-weight:700;color:${C.ink};">${formatCOP(total)}</td>
        </tr></tbody></table></td></tr>
      </tbody>
    </table>`;
  return emailShell({ lang: 'es', band: { color: C.olive, eyebrow: 'Reserva confirmada', code: bookingCode }, bodyHtml: body });
}

/* Client reminder: an active quote is about to expire (cron, once per quote). */
function quoteExpiringHtml({ quote, quoteUrl }) {
  const stay = `${formatDateES(quote.checkin)} → ${formatDateES(quote.checkout)}`;
  const body = `
    ${greeting(quote.contacto || quote.empresa, 'es')}
    ${para(`Tu cotización <strong>${esc(quote.quoteId)}</strong> para la estadía <strong>${stay}</strong> está por vencer el <strong>${formatDateES(quote.expiresAt)}</strong>. Si deseas asegurar la tarifa y la disponibilidad, revísala y completa tu reserva antes de esa fecha.`)}
    ${ctaCenter(ctaButton(quoteUrl, 'Ver mi cotización'))}
    ${fineprint('Si ya completaste tu reserva o no necesitas esta cotización, puedes ignorar este mensaje.')}`;
  return emailShell({ lang: 'es', band: { color: C.terra, eyebrow: 'Tu cotización vence pronto', code: quote.quoteId }, bodyHtml: body });
}

/* A10 — pre-arrival reminder (sent by the send-stay-emails cron). Bilingual.
   Carries the digital check-in CTA (FAQ: link 1 day before → codes after). */
function preArrivalHtml({ resv, lang }) {
  const r = resv || {};
  const fmt = lang === 'en' ? formatDateEN : formatDateES;
  const stay = `${fmt(r.dateArrival)} → ${fmt(r.dateDeparture)}`;
  const checkinUrl = r.checkinUrl || GUEST_APP_LINK;
  if (lang === 'en') {
    const bf = r.hasBreakfast ? para("Your booking includes breakfast — we'll have it ready every morning.") : '';
    const body = `
      ${greeting(r.firstName, 'en')}
      ${para(`Your stay at estar is coming up: <strong>${stay}</strong>. Check-in is from <strong>3:00 pm</strong> and check-out until <strong>11:00 am</strong>. Check-in is 100% digital — complete it the day before and you'll get your smart access codes (building + studio). No keys, no front desk.`)}
      ${bf}
      ${ctaCenter(ctaButton(checkinUrl, 'Start my check-in'))}
      <div style="height:14px;font-size:0;line-height:0;">&nbsp;</div>
      ${mapCard('en')}
      ${guestAppCard('en', r.guestAppUrl)}
      ${whatsappLine('en')}`;
    return emailShell({ lang: 'en', band: { color: C.tan, textColor: C.ink, eyebrow: 'We look forward to your stay' }, bodyHtml: body });
  }
  const bf = r.hasBreakfast ? para('Tu reserva incluye desayuno — lo tendremos listo cada mañana.') : '';
  const body = `
    ${greeting(r.firstName, 'es')}
    ${para(`Tu estadía en estar está cerca: <strong>${stay}</strong>. El check-in es desde las <strong>3:00 p. m.</strong> y el check-out hasta las <strong>11:00 a. m.</strong> El check-in es 100% digital — complétalo el día antes y recibirás tus códigos de acceso (edificio y apartaestudio). Sin llaves ni recepción.`)}
    ${bf}
    ${ctaCenter(ctaButton(checkinUrl, 'Hacer mi check-in'))}
    <div style="height:14px;font-size:0;line-height:0;">&nbsp;</div>
    ${mapCard('es')}
    ${guestAppCard('es', r.guestAppUrl)}
    ${whatsappLine('es')}`;
  return emailShell({ lang: 'es', band: { color: C.tan, textColor: C.ink, eyebrow: 'Te esperamos pronto' }, bodyHtml: body });
}

/* Access codes — delivered after the guest completes digital check-in (FAQ).
   codes = { building, studio, studioLabel }. passUrl optional (breakfast QRs).
   Not wired to a trigger yet — the smart-lock code source is owner-pending. */
function accessCodesHtml({ resv, codes, passUrl, lang }) {
  const r = resv || {};
  const c = codes || {};
  const en = lang === 'en';
  const fmt = en ? formatDateEN : formatDateES;
  const studioLabel = c.studioLabel || (en ? 'Studio' : 'Apartaestudio');
  const twoCodes = `
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr>
      <td width="50%" style="padding-right:6px;vertical-align:top;">
        <div style="border:1px solid ${C.border};border-radius:10px;padding:16px 12px;text-align:center;">
          <div style="font-family:${SANS};font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${C.muted};margin-bottom:8px;">${en ? 'Building' : 'Portería'}</div>
          <div style="font-family:${SANS};font-size:26px;font-weight:700;letter-spacing:.22em;color:${C.ink};">${esc(c.building || '—')}</div>
        </div>
      </td>
      <td width="50%" style="padding-left:6px;vertical-align:top;">
        <div style="border:1px solid ${C.border};border-radius:10px;padding:16px 12px;text-align:center;">
          <div style="font-family:${SANS};font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${C.muted};margin-bottom:8px;">${esc(studioLabel)}</div>
          <div style="font-family:${SANS};font-size:26px;font-weight:700;letter-spacing:.22em;color:${C.ink};">${esc(c.studio || '—')}</div>
        </div>
      </td>
    </tr></tbody></table>`;
  const bfHtml = (r.hasBreakfast || passUrl) ? `
    <div style="text-align:center;margin:26px 0;"><span style="color:${C.olive};font-size:18px;line-height:1;">&#10022;</span></div>
    <div style="background:${C.cream};border-radius:12px;padding:22px 20px;text-align:center;">
      <div style="font-family:${SANS};font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:${C.olive};margin-bottom:6px;">${en ? 'Breakfast included' : 'Desayuno incluido'}</div>
      <p style="margin:0 ${passUrl ? '0 16px' : ''};font-family:${SERIF};font-size:14px;line-height:1.6;color:${C.body};">${en ? 'Show your pass in the dining room every morning, <strong>7:00 to 10:00 am</strong>.' : 'Muestra tu pase en el comedor cada mañana, de <strong>7:00 a 10:00 a. m.</strong>'}</p>
      ${passUrl ? ctaButton(passUrl, en ? 'View my breakfast passes' : 'Ver mis pases de desayuno', 'dark') : ''}
    </div>` : '';
  const body = `
    ${greeting(r.firstName, lang)}
    ${para(en
      ? `Your arrival is <strong>${r.tomorrow ? 'tomorrow, ' : ''}${fmt(r.dateArrival)}</strong>. Check-in is 100% digital — no keys, no front desk. Here's everything you need to get in.`
      : `Tu llegada es <strong>${r.tomorrow ? 'mañana, ' : ''}${fmt(r.dateArrival)}</strong>. El check-in es 100% digital — sin llaves ni recepción. Aquí tienes todo para entrar.`)}
    <div style="font-family:${SANS};font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:${C.olive};margin-bottom:12px;">${en ? 'Your access codes' : 'Tus códigos de acceso'}</div>
    ${twoCodes}
    <p style="margin:10px 0 0;font-family:${SANS};font-size:12px;color:${C.muted};text-align:center;">${en ? 'Valid for your whole stay.' : 'Válidos durante toda tu estadía.'}</p>
    ${bfHtml}
    <div style="text-align:center;margin:26px 0;"><span style="color:${C.olive};font-size:18px;line-height:1;">&#10022;</span></div>
    ${mapCard(lang)}
    ${guestAppCard(lang, r.guestAppUrl)}
    ${whatsappLine(lang, en ? 'Trouble getting in?' : '¿Algún problema para entrar?')}`;
  return emailShell({ lang: lang || 'es', band: { color: C.olive, eyebrow: en ? 'Your check-in is ready' : 'Tu check-in está listo', code: r.bookingCode }, bodyHtml: body });
}

/* A10 — post-stay thank you + review ask (sent by the send-stay-emails cron).
   npsUrl (opt): when present, adds a "tell us about your stay" NPS survey CTA
   (Odoo Fase 3). Gated by NPS_ENABLED in send-stay-emails; nothing shown if absent. */
function postStayHtml({ resv, lang, npsUrl }) {
  const r = resv || {};
  const reviewUrl = process.env.REVIEW_LINK_URL || WA_LINK;
  const hasReview = !!process.env.REVIEW_LINK_URL;
  if (lang === 'en') {
    const npsBlock = npsUrl ? `
      <div style="height:14px;font-size:0;line-height:0;">&nbsp;</div>
      ${para('How did your stay go? A 1-minute survey helps us keep improving.')}
      ${ctaCenter(ctaButton(npsUrl, 'Tell us about your stay', 'secondary'))}` : '';
    const body = `
      ${greeting(r.firstName, 'en')}
      ${para(`Thank you for choosing estar. We hope Manizales treated you well and that your studio felt like home. ${hasReview ? 'If you have a minute, a short review helps other travelers find us.' : "We'd love to hear how it went."}`)}
      ${ctaCenter(ctaButton(reviewUrl, hasReview ? 'Leave a review' : 'Send us feedback'))}
      ${npsBlock}`;
    return emailShell({ lang: 'en', band: { color: C.olive, eyebrow: 'Thank you for staying with us' }, bodyHtml: body });
  }
  const npsBlock = npsUrl ? `
    <div style="height:14px;font-size:0;line-height:0;">&nbsp;</div>
    ${para('¿Cómo estuvo tu estadía? Una encuesta de 1 minuto nos ayuda a seguir mejorando.')}
    ${ctaCenter(ctaButton(npsUrl, 'Cuéntanos cómo estuvo tu estadía', 'secondary'))}` : '';
  const body = `
    ${greeting(r.firstName, 'es')}
    ${para(`Gracias por elegir estar. Esperamos que Manizales te haya tratado bien y que tu apartaestudio se sintiera como en casa. ${hasReview ? 'Si tienes un minuto, una reseña corta nos ayuda a que otros viajeros nos encuentren.' : 'Nos encantaría saber cómo te fue.'}`)}
    ${ctaCenter(ctaButton(reviewUrl, hasReview ? 'Dejar una reseña' : 'Enviarnos tu opinión'))}
    ${npsBlock}`;
  return emailShell({ lang: 'es', band: { color: C.olive, eyebrow: 'Gracias por tu estadía' }, bodyHtml: body });
}

/* A9 — ask the guest for the bank account to receive a manual refund. */
function bankDetailsRequestHtml({ refund, formUrl, slaDays, lang }) {
  const r = refund || {};
  const days = slaDays || 15;
  if (lang === 'en') {
    const body = `
      ${greeting(r.guestName, 'en')}
      ${para(`We approved the refund for booking <strong>${esc(r.bookingCode || '')}</strong>. As your payment method can't be refunded automatically by the gateway, we'll do it by <strong>bank transfer</strong>. Please tell us the account where you'd like to receive it:`)}
      ${ctaCenter(ctaButton(formUrl, 'Enter my bank account'))}
      ${fineprint(`The link is personal and expires. Once we receive your details, we process the refund within <strong>${days} business days</strong>. If you didn't request this, please ignore this message.`)}`;
    return emailShell({ lang: 'en', band: { color: C.terra, eyebrow: 'Refund approved' }, bodyHtml: body });
  }
  const body = `
    ${greeting(r.guestName, 'es')}
    ${para(`Aprobamos el reembolso de tu reserva <strong>${esc(r.bookingCode || '')}</strong>. Como tu pago no admite devolución automática por la pasarela, lo haremos por <strong>transferencia bancaria</strong>. Por favor indícanos la cuenta donde quieres recibirlo:`)}
    ${ctaCenter(ctaButton(formUrl, 'Indicar mi cuenta bancaria'))}
    ${fineprint(`El enlace es personal y caduca. Una vez recibamos tus datos, tramitamos el reembolso en un máximo de <strong>${days} días hábiles</strong>. Si no solicitaste esto, ignora este mensaje.`)}`;
  return emailShell({ lang: 'es', band: { color: C.terra, eyebrow: 'Reembolso aprobado' }, bodyHtml: body });
}

/* Acknowledge a guest cancellation request (branded). booking = {bookingCode,
   guestName, checkIn, checkOut, lang?}. */
function cancellationAckHtml({ booking, lang }) {
  const b = booking || {};
  const en = (lang || b.lang) === 'en';
  const fmt = en ? formatDateEN : formatDateES;
  const stay = `${fmt(b.checkIn)} → ${fmt(b.checkOut)}`;
  if (en) {
    const body = `
      ${greeting(b.guestName, 'en')}
      ${para(`We received your cancellation request for booking <strong>${esc(b.bookingCode || '')}</strong> (${stay}).`)}
      ${para(`Our team will review it under your rate's policy (Strict: free up to 7 days before check-in · Flexible: up to 24 h before) and reply here within 24 hours.`)}
      ${para(`When a refund applies, it's processed via your original payment method within <strong>15 business days</strong>.`)}
      ${whatsappLine('en', 'Need help right away?')}`;
    return emailShell({ lang: 'en', band: { color: C.terra, eyebrow: 'Cancellation request received' }, bodyHtml: body });
  }
  const body = `
    ${greeting(b.guestName, 'es')}
    ${para(`Recibimos tu solicitud de cancelación para la reserva <strong>${esc(b.bookingCode || '')}</strong> (${stay}).`)}
    ${para(`Nuestro equipo la revisará según la política de tu tarifa (Estricta: gratis hasta 7 días antes del check-in · Flexible: hasta 24 h antes) y te responderá por este medio en menos de 24 horas.`)}
    ${para(`Cuando el reembolso aplique, se procesa por el mismo medio de pago en un máximo de <strong>15 días hábiles</strong>.`)}
    ${whatsappLine('es', '¿Necesitas ayuda inmediata?')}`;
  return emailShell({ lang: 'es', band: { color: C.terra, eyebrow: 'Solicitud de cancelación recibida' }, bodyHtml: body });
}

/* Guest-facing CONFIRMATION that a reservation was cancelled (fired by the
   OTASync cancellation webhook, only for our own web reservations — OTA guests
   get the channel's own cancellation email). Distinct from cancellationAckHtml,
   which only acknowledges a *request*. */
function cancellationConfirmedHtml({ booking, lang }) {
  const b = booking || {};
  const en = (lang || b.lang) === 'en';
  const fmt = en ? formatDateEN : formatDateES;
  const stay = b.checkIn ? `${fmt(b.checkIn)} → ${fmt(b.checkOut)}` : '';
  if (en) {
    return emailShell({ lang: 'en', band: { color: C.terra, eyebrow: 'Reservation cancelled' }, bodyHtml: `
      ${greeting(b.guestName, 'en')}
      ${para(`Your reservation <strong>${esc(b.bookingCode || '')}</strong>${stay ? ` (${stay})` : ''} has been <strong>cancelled</strong>.`)}
      ${para(`If a refund applies under your rate's policy, it's processed via your original payment method within <strong>15 business days</strong>.`)}
      ${para(`If you didn't request this or have any questions, please contact us right away.`)}
      ${whatsappLine('en', 'Questions about your cancellation?')}` });
  }
  return emailShell({ lang: 'es', band: { color: C.terra, eyebrow: 'Reserva cancelada' }, bodyHtml: `
    ${greeting(b.guestName, 'es')}
    ${para(`Tu reserva <strong>${esc(b.bookingCode || '')}</strong>${stay ? ` (${stay})` : ''} fue <strong>cancelada</strong>.`)}
    ${para(`Si aplica un reembolso según la política de tu tarifa, se procesa por el mismo medio de pago en un máximo de <strong>15 días hábiles</strong>.`)}
    ${para(`Si no solicitaste esta cancelación o tienes dudas, escríbenos de inmediato.`)}
    ${whatsappLine('es', '¿Dudas con tu cancelación?')}` });
}

/* Internal team alert when a reservation is cancelled in OTASync. */
function adminCancellationHtml({ booking, channel, isWeb }) {
  const b = booking || {};
  return internalShell({
    accent: C.terra, kicker: 'Reserva cancelada', title: `Cancelación — ${b.bookingCode || 's/código'}`,
    bodyHtml: `
      ${dataRows([
        ['Código', esc(b.bookingCode || '—')],
        ['Huésped', esc(b.guestName || '—')],
        ['Correo', esc(b.guestEmail || '—')],
        ['Estadía', b.checkIn ? `${esc(b.checkIn)} → ${esc(b.checkOut || '')}` : '—'],
        ['Canal', esc(channel || '—')],
        ['Origen', isWeb ? 'Reserva web (correo enviado al huésped)' : 'OTA / otro canal (sin correo nuestro)']
      ])}
      ${calloutBox(C.terra, 'Acción', 'Si corresponde reembolso, gestiónalo en el panel /admin → Reembolsos. La cancelación NO genera reembolso automático.')}`
  });
}

/* Guest payment status — pending (branded). Warns against paying again to avoid
   a double charge. contact = {name, code, retryUrl}. */
function paymentPendingHtml({ contact, lang }) {
  const c = contact || {};
  const en = lang === 'en';
  if (en) {
    return emailShell({ lang: 'en', band: { color: C.tan, textColor: C.ink, eyebrow: 'Your payment is processing' }, bodyHtml: `
      ${greeting(c.name, 'en')}
      ${para(`Your payment${c.code ? ` for booking <strong>${esc(c.code)}</strong>` : ''} is being processed. As soon as it clears we'll confirm your reservation by email.`)}
      ${para('<strong>Important:</strong> to avoid a double charge, please <strong>do not pay again</strong> in the meantime. If you have any doubts, message us.')}
      ${whatsappLine('en', 'Questions about your payment?')}` });
  }
  return emailShell({ lang: 'es', band: { color: C.tan, textColor: C.ink, eyebrow: 'Tu pago está en proceso' }, bodyHtml: `
    ${greeting(c.name, 'es')}
    ${para(`Tu pago${c.code ? ` de la reserva <strong>${esc(c.code)}</strong>` : ''} está en proceso. Apenas se acredite te confirmamos la reserva por correo.`)}
    ${para('<strong>Importante:</strong> para evitar un <strong>cobro doble</strong>, por favor <strong>no vuelvas a pagar</strong> mientras tanto. Si tienes dudas, escríbenos.')}
    ${whatsappLine('es', '¿Dudas con tu pago?')}` });
}

/* Guest payment status — rejected/declined (branded). No charge was made; offers
   a retry and a hint about the common cause (3D Secure / funds). */
function paymentRejectedHtml({ contact, lang }) {
  const c = contact || {};
  const en = lang === 'en';
  if (en) {
    return emailShell({ lang: 'en', band: { color: C.terra, eyebrow: 'Your payment could not be processed' }, bodyHtml: `
      ${greeting(c.name, 'en')}
      ${para(`We couldn't process your payment${c.code ? ` for booking <strong>${esc(c.code)}</strong>` : ''}. <strong>No charge was made</strong> (No se realizó ningún cobro) and your reservation was not confirmed.`)}
      ${para('Banks sometimes decline due to <strong>3D Secure</strong> verification or available funds. You can try again:')}
      ${ctaCenter(ctaButton(c.retryUrl || 'https://estar.com.co/reservar.html', 'Try again'))}
      ${whatsappLine('en', 'Trouble paying?')}` });
  }
  return emailShell({ lang: 'es', band: { color: C.terra, eyebrow: 'Tu pago no pudo procesarse' }, bodyHtml: `
    ${greeting(c.name, 'es')}
    ${para(`No pudimos procesar tu pago${c.code ? ` de la reserva <strong>${esc(c.code)}</strong>` : ''}. <strong>No se realizó ningún cobro</strong> y tu reserva no quedó confirmada.`)}
    ${para('A veces el banco rechaza el pago por la validación <strong>3D Secure</strong> o por fondos disponibles. Puedes intentar de nuevo:')}
    ${ctaCenter(ctaButton(c.retryUrl || 'https://estar.com.co/reservar.html', 'Intentar de nuevo'))}
    ${whatsappLine('es', '¿Problemas para pagar?')}` });
}

/* ── Internal/team templates ────────────────────────────────────────────── */

/* A9 — notify treasury that a guest submitted bank details to process a refund. */
function treasuryBankDetailsHtml({ refund }) {
  const r = refund || {};
  const b = r.bankDetails || {};
  const amount = r.refundAmountCents != null ? formatCOP(r.refundAmountCents / 100) : '(definir)';
  const rows = [
    ['Monto aprobado', `<strong style="font-size:15px;">${esc(amount)}</strong>`],
    ['Banco', esc(b.bankName || '—')],
    ['Tipo de cuenta', esc(b.accountType || '—')],
    ['Número de cuenta', `<span style="letter-spacing:.05em;">${esc(b.accountNumber || '—')}</span>`],
    ['Titular', esc(b.holderName || '—')],
    ['Documento', `${esc(b.docType || '')} ${esc(b.docNumber || '')}`.trim() || '—'],
    ['Huésped', `${esc(r.guestName || '—')} · ${esc(r.guestEmail || '')}`]
  ];
  const body = `
    <p style="margin:0 0 22px;font-family:${SANS};font-size:14px;line-height:1.6;color:${C.body};">El huésped envió la cuenta para el reembolso. Tramitar transferencia:</p>
    ${dataRows(rows)}
    ${calloutBox(C.olive, '', 'Marca el reembolso como <strong style="color:#28292b;">procesado</strong> en el panel admin (/admin → Reembolsos) cuando completes la transferencia.')}`;
  return internalShell({ accent: C.olive, kicker: 'Reembolso · datos recibidos', title: `Reembolso ${r.bookingCode || ''}`.trim(), bodyHtml: body });
}

/* Admin alert: payment received but the reservation could not be created. */
function adminPendingHtml({ quote, transactionId, shortfalls }) {
  const rows = [
    ['Transacción Wompi', esc(transactionId || '—')],
    ['Estadía', `${formatDateES(quote.checkin)} → ${formatDateES(quote.checkout)}`],
    ['Contacto', `${esc(quote.contacto || '—')} · ${esc(quote.email || '')}`]
  ];
  const lines = (shortfalls || []).map(s => `${esc(s.habitacion)} — pedidas ${s.requested}, disponibles ${s.available}`).join('<br>');
  const body = `
    <p style="margin:0 0 22px;font-family:${SANS};font-size:14px;line-height:1.65;color:${C.body};">La cotización <strong style="color:#28292b;">${esc(quote.quoteId)}</strong> (${esc(quote.empresa || '')}) fue <strong style="color:#28292b;">pagada</strong>, pero la reserva no pudo crearse automáticamente en Kunas.</p>
    ${dataRows(rows)}
    ${lines ? calloutBox(C.terra, 'Habitaciones sin disponibilidad', lines) : ''}
    <p style="margin:20px 0 0;font-family:${SANS};font-size:13px;line-height:1.65;color:${C.body};">Entra al portal B2B y usa <strong style="color:#28292b;">"Reintentar reserva"</strong> en esa cotización una vez liberes cupo.</p>`;
  return internalShell({ accent: C.terra, kicker: 'Acción manual requerida', title: 'Pago recibido sin reserva creada', bodyHtml: body });
}

/* Admin alert: an active quote lost availability (detected by the cron). */
function adminAvailabilityLostHtml({ quote, shortfalls }) {
  const lines = (shortfalls || []).map(s => `${esc(s.habitacion)} — cotizadas ${s.requested}, disponibles ${s.available}`).join('<br>');
  const body = `
    <p style="margin:0 0 22px;font-family:${SANS};font-size:14px;line-height:1.65;color:${C.body};">La cotización <strong style="color:#28292b;">${esc(quote.quoteId)}</strong> (${esc(quote.empresa || '')}) perdió disponibilidad para <strong style="color:#28292b;">${formatDateES(quote.checkin)} → ${formatDateES(quote.checkout)}</strong>.</p>
    ${calloutBox(C.olive, 'Habitaciones', lines || '—')}
    <p style="margin:20px 0 0;font-family:${SANS};font-size:13px;line-height:1.65;color:${C.body};">El cliente no podrá completar el pago hasta que se ajusten las fechas o se libere cupo.</p>`;
  return internalShell({ accent: C.tan, kicker: 'Aviso de disponibilidad', title: 'Cotización sin disponibilidad', bodyHtml: body });
}

module.exports = {
  sendEmail, adminEmail, esc, formatCOP, formatDateES, formatDateEN, htmlToText,
  // shared shell + components (used by send-confirmation.js and others)
  emailShell, internalShell, greeting, para, fineprint, ctaButton, ctaCenter,
  box, mapCard, guestAppCard, whatsappLine, dataRows, calloutBox,
  LOGO_URL, MARK_URL, WA_LINK, MAPS_LINK, WAZE_LINK, GUEST_APP_LINK, ADDRESS, COLORS: C, SERIF, SANS,
  // templates
  paymentConfirmationHtml, adminPendingHtml, adminAvailabilityLostHtml,
  quoteExpiringHtml, preArrivalHtml, postStayHtml, accessCodesHtml,
  bankDetailsRequestHtml, treasuryBankDetailsHtml,
  cancellationAckHtml, cancellationConfirmedHtml, adminCancellationHtml,
  paymentPendingHtml, paymentRejectedHtml
};
