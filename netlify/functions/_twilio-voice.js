require('./_env');

/*
 * _twilio-voice.js — llamada de voz de ALERTA INTERNA (escalamiento del bot).
 *
 * Por qué (decisión 2026-06-25): el escalamiento prioritario es una LLAMADA que
 * suene. Se usa un número de VOZ (PSTN) de Twilio APARTE, dedicado solo a alertas
 * internas, para NO migrar el WhatsApp del hotel (que sigue en la Cloud API
 * directa). Encaja con el stack serverless: esta función solo dispara una llamada
 * a la API REST de Twilio y Twilio se encarga de TODO el audio (no montamos
 * ningún servidor de voz/WebRTC).
 *
 * Mock-safe: sin credenciales es un no-op logueado ({ ok:false, isMock:true }),
 * igual que el resto de integraciones. NUNCA lanza.
 *
 * Config (env; cargar en pre-producción — ver .env.example):
 *   TWILIO_ACCOUNT_SID   SID de la cuenta Twilio
 *   TWILIO_AUTH_TOKEN    Auth Token (SECRETO)
 *   TWILIO_VOICE_NUMBER  número de voz comprado en Twilio (E.164, ej. +1XXXXXXXXXX)
 *   TWILIO_API_BASE      opcional, default https://api.twilio.com
 *   TWILIO_TIMEOUT_MS    opcional, default 10000
 */

function twilioConfig() {
  return {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    from: process.env.TWILIO_VOICE_NUMBER || '',
    apiBase: (process.env.TWILIO_API_BASE || 'https://api.twilio.com').replace(/\/+$/, ''),
    timeoutMs: parseInt(process.env.TWILIO_TIMEOUT_MS, 10) || 10000
  };
}

function isConfigured() {
  const c = twilioConfig();
  return Boolean(c.accountSid && c.authToken && c.from);
}

function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/* TwiML que se ejecuta cuando contestan: dice el mensaje dos veces (es-MX/en-US).
   Inline en el request (param Twiml) → no requiere un endpoint TwiML hospedado. */
function buildTwiml(message, lang) {
  const voiceLang = lang === 'en' ? 'en-US' : 'es-MX';
  const fallback = lang === 'en'
    ? 'A guest needs attention. Please check the hotel WhatsApp chat.'
    : 'Un huésped requiere atención. Por favor revisa el chat de WhatsApp del hotel.';
  const text = xmlEscape(message || fallback);
  const say = `<Say language="${voiceLang}">${text}</Say>`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Pause length="1"/>${say}<Pause length="1"/>${say}</Response>`;
}

/* Coloca una llamada de voz a `to` (E.164). Devuelve
   { ok, sid?, status?, isMock?, error?, reason? }. Best-effort: nunca lanza. */
async function placeCall({ to, message, lang } = {}, deps = {}) {
  const cfg = deps.config || twilioConfig();
  if (!to) return { ok: false, reason: 'no-destination' };
  if (!(cfg.accountSid && cfg.authToken && cfg.from)) {
    if (process.env.DEBUG) console.log('[twilio-voice] mock call (sin credenciales) →', to);
    return { ok: false, isMock: true };
  }
  const url = `${cfg.apiBase}/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid)}/Calls.json`;
  const body = new URLSearchParams({ To: to, From: cfg.from, Twiml: buildTwiml(message, lang) });
  const auth = Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64');
  const fetchFn = deps.fetch || (typeof fetch !== 'undefined' ? fetch : null);
  if (!fetchFn) return { ok: false, error: 'no-fetch' };

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: ctrl.signal
    });
    clearTimeout(tid);
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).message || ''; } catch (e) { /* sin cuerpo */ }
      return { ok: false, status: res.status, error: detail || `Twilio returned ${res.status}` };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, sid: data.sid || null, status: data.status || null };
  } catch (err) {
    clearTimeout(tid);
    return { ok: false, error: err && err.name === 'AbortError' ? 'timeout' : (err && err.message) || 'error' };
  }
}

module.exports = { isConfigured, placeCall, buildTwiml, twilioConfig };
