/* Idioma del huésped para los correos del SERVIDOR (confirmación de reserva).
 *
 * El navegador ya no envía el correo de confirmación: lo manda el webhook de
 * pago (Wompi o Mercado Pago), que no sabe en qué idioma reservó el huésped
 * (el idioma no viaja en la referencia firmada). Al crear la firma de Wompi o
 * la preferencia de MP se guarda aquí el idioma por código de reserva, y el
 * webhook lo lee al enviar la confirmación.
 *
 * Solo se guarda 'en' (español es el predeterminado: sin registro = 'es').
 * Sin datos personales. Best-effort: nunca lanza ni bloquea el pago. */

const STORE_NAME = 'booking-lang';

function defaultGetStore(name) {
  const { getStore } = require('@netlify/blobs');
  const opts = { name, consistency: 'strong' };
  const siteID = process.env.BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) { opts.siteID = siteID; opts.token = token; }
  return getStore(opts);
}

function normalizeBookingLang(lang) {
  return String(lang || '').trim().toLowerCase() === 'en' ? 'en' : 'es';
}

async function saveBookingLang(bookingCode, lang, deps = {}) {
  const code = String(bookingCode || '').trim();
  if (!code || normalizeBookingLang(lang) !== 'en') return false;
  try {
    const store = (deps.getStore || defaultGetStore)(STORE_NAME);
    await store.set(`lang-${code}`, JSON.stringify({ lang: 'en', createdAt: new Date().toISOString() }));
    return true;
  } catch (e) {
    console.warn('[booking-lang] save failed (non-fatal):', e && e.message);
    return false;
  }
}

async function readBookingLang(bookingCode, deps = {}) {
  const code = String(bookingCode || '').trim();
  if (!code) return 'es';
  try {
    const store = (deps.getStore || defaultGetStore)(STORE_NAME);
    const raw = await store.get(`lang-${code}`);
    if (!raw) return 'es';
    const rec = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return normalizeBookingLang(rec && rec.lang);
  } catch (e) {
    return 'es';
  }
}

module.exports = { saveBookingLang, readBookingLang, normalizeBookingLang, STORE_NAME };
