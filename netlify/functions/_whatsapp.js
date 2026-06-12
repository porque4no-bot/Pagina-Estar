/* WhatsApp Business Cloud API client (Meta Graph API).
   Shared by whatsapp-webhook (inbound) and _whatsapp-bot (outbound replies).

   Credentials (see .env.example / docs/whatsapp-bot.md):
     WHATSAPP_TOKEN            permanent system-user access token
     WHATSAPP_PHONE_NUMBER_ID  the Cloud API phone number id (NOT the phone number)
     WHATSAPP_APP_SECRET       Meta app secret — validates X-Hub-Signature-256
     WHATSAPP_VERIFY_TOKEN     arbitrary string echoed during webhook GET handshake
     WHATSAPP_GRAPH_VERSION    optional, defaults below

   Without WHATSAPP_TOKEN/PHONE_NUMBER_ID every send becomes a logged no-op
   ({ sent:false, isMock:true }) so the bot flow is fully testable locally,
   matching the mock-without-credentials convention used across functions. */

const crypto = require('crypto');

const DEFAULT_GRAPH_VERSION = 'v25.0';

function waConfig() {
  return {
    token: process.env.WHATSAPP_TOKEN || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    appSecret: process.env.WHATSAPP_APP_SECRET || '',
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || '',
    graphVersion: process.env.WHATSAPP_GRAPH_VERSION || DEFAULT_GRAPH_VERSION
  };
}

function isConfigured() {
  const c = waConfig();
  return Boolean(c.token && c.phoneNumberId);
}

/* Validate Meta's webhook signature: HMAC-SHA256 of the RAW request body with
   the app secret, sent as `X-Hub-Signature-256: sha256=<hex>`. Timing-safe. */
function verifySignature(rawBody, signatureHeader) {
  const { appSecret } = waConfig();
  if (!appSecret) return false;
  const header = String(signatureHeader || '');
  if (!header.startsWith('sha256=')) return false;
  const theirs = header.slice('sha256='.length);
  const ours = crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(ours, 'utf8');
  const b = Buffer.from(theirs, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/* Low-level POST to /<version>/<phone_number_id>/messages. */
async function postMessage(payload) {
  const c = waConfig();
  if (!isConfigured()) {
    if (process.env.DEBUG) console.log('[whatsapp] mock send (no credentials):', JSON.stringify(payload));
    return { sent: false, isMock: true };
  }
  const url = `https://graph.facebook.com/${c.graphVersion}/${c.phoneNumberId}/messages`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 10000);
  try {
    /* recipient_type only applies to outbound messages; status updates
       (mark-as-read) must not carry it. */
    const base = payload.to
      ? { messaging_product: 'whatsapp', recipient_type: 'individual' }
      : { messaging_product: 'whatsapp' };
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...base, ...payload }),
      signal: ctrl.signal
    });
    clearTimeout(tid);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[whatsapp] Graph API error:', res.status, JSON.stringify(data.error || data));
      return { sent: false, status: res.status, error: data.error };
    }
    return { sent: true, id: data.messages && data.messages[0] && data.messages[0].id };
  } catch (e) {
    clearTimeout(tid);
    console.error('[whatsapp] send failed:', e.message);
    return { sent: false, error: { message: e.message } };
  }
}

function sendText(to, body, opts) {
  return postMessage({
    to,
    type: 'text',
    text: { body: String(body).slice(0, 4096), preview_url: Boolean(opts && opts.previewUrl) }
  });
}

/* Interactive reply buttons: Cloud API allows max 3 buttons, titles ≤ 20 chars. */
function sendButtons(to, bodyText, buttons, opts) {
  const action = {
    buttons: (buttons || []).slice(0, 3).map(b => ({
      type: 'reply',
      reply: { id: String(b.id).slice(0, 256), title: String(b.title).slice(0, 20) }
    }))
  };
  const interactive = { type: 'button', body: { text: String(bodyText).slice(0, 1024) }, action };
  if (opts && opts.footer) interactive.footer = { text: String(opts.footer).slice(0, 60) };
  if (opts && opts.header) interactive.header = { type: 'text', text: String(opts.header).slice(0, 60) };
  return postMessage({ to, type: 'interactive', interactive });
}

/* Interactive list: max 10 rows total across sections; row titles ≤ 24 chars. */
function sendList(to, bodyText, buttonText, sections, opts) {
  const interactive = {
    type: 'list',
    body: { text: String(bodyText).slice(0, 4096) },
    action: {
      button: String(buttonText).slice(0, 20),
      sections: (sections || []).map(s => ({
        title: s.title ? String(s.title).slice(0, 24) : undefined,
        rows: (s.rows || []).slice(0, 10).map(r => ({
          id: String(r.id).slice(0, 200),
          title: String(r.title).slice(0, 24),
          description: r.description ? String(r.description).slice(0, 72) : undefined
        }))
      }))
    }
  };
  if (opts && opts.footer) interactive.footer = { text: String(opts.footer).slice(0, 60) };
  return postMessage({ to, type: 'interactive', interactive });
}

/* Template messages — required to message a guest OUTSIDE the 24-hour
   customer-service window (e.g. pre-arrival reminders). Templates must be
   pre-approved in Meta Business Manager. */
function sendTemplate(to, name, languageCode, components) {
  return postMessage({
    to,
    type: 'template',
    template: { name, language: { code: languageCode || 'es' }, ...(components ? { components } : {}) }
  });
}

/* Mark an incoming message as read (double blue check). Fire-and-forget. */
function markRead(messageId) {
  return postMessage({ status: 'read', message_id: messageId });
}

module.exports = {
  waConfig, isConfigured, verifySignature, postMessage,
  sendText, sendButtons, sendList, sendTemplate, markRead,
  DEFAULT_GRAPH_VERSION
};
