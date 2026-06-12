require('./_env');

/* Webhook receiver for the WhatsApp Business Cloud API (Meta).
   Register in App Dashboard → WhatsApp → Configuration:
     Callback URL : https://estar.com.co/api/whatsapp-webhook
     Verify token : WHATSAPP_VERIFY_TOKEN
     Subscription : `messages` field
   Full setup guide (credentials, sandbox, pitfalls): docs/whatsapp-bot.md

   Contract with Meta:
   - GET  = subscription handshake: echo hub.challenge as PLAIN TEXT when
     hub.mode === 'subscribe' and hub.verify_token matches; 403 otherwise.
   - POST = events. Signature header `X-Hub-Signature-256` is the HMAC-SHA256
     of the RAW body with the app secret — validate over the raw bytes,
     never over re-serialized JSON. Always answer 200 fast (Meta retries on
     non-200 and can disable the subscription after repeated failures); the
     bot reply itself is awaited but its errors never bubble to the status. */

const { verifySignature, markRead, waConfig } = require('./_whatsapp');
const bot = require('./_whatsapp-bot');

/* Per-message dedupe: Meta retries webhooks, and a Netlify cold start may
   process a retry after the original succeeded. Blobs when available,
   in-memory fallback otherwise. */
const memoryProcessed = new Map();
const DEDUP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

async function alreadyProcessed(messageId) {
  if (!messageId) return false;
  try {
    const { getStore } = require('@netlify/blobs');
    const store = getStore({ name: 'whatsapp-processed', consistency: 'strong' });
    const existing = await store.get(messageId);
    if (existing && Date.now() - parseInt(existing, 10) < DEDUP_MAX_AGE_MS) return true;
    await store.set(messageId, String(Date.now()));
    return false;
  } catch (e) {
    const ts = memoryProcessed.get(messageId);
    if (ts && Date.now() - ts < DEDUP_MAX_AGE_MS) return true;
    memoryProcessed.set(messageId, Date.now());
    if (memoryProcessed.size > 5000) {
      for (const [id, t] of memoryProcessed) {
        if (Date.now() - t > DEDUP_MAX_AGE_MS) memoryProcessed.delete(id);
      }
    }
    return false;
  }
}

/* Flatten Meta's entry/changes envelope into normalized bot messages.
   `value` may carry `messages` (inbound) or `statuses` (delivery receipts —
   ignored here). */
function extractMessages(payload) {
  const out = [];
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const profileName = value.contacts && value.contacts[0] && value.contacts[0].profile
        ? value.contacts[0].profile.name : '';
      for (const m of value.messages || []) {
        const normalized = {
          from: m.from,
          id: m.id,
          type: m.type,
          profileName,
          text: '',
          replyId: ''
        };
        if (m.type === 'text') normalized.text = m.text && m.text.body || '';
        else if (m.type === 'interactive' && m.interactive) {
          if (m.interactive.type === 'button_reply' && m.interactive.button_reply) {
            normalized.replyId = m.interactive.button_reply.id;
            normalized.text = m.interactive.button_reply.title || '';
          } else if (m.interactive.type === 'list_reply' && m.interactive.list_reply) {
            normalized.replyId = m.interactive.list_reply.id;
            normalized.text = m.interactive.list_reply.title || '';
          }
        } else if (m.type === 'button' && m.button) {
          /* Template quick-reply */
          normalized.text = m.button.text || '';
          normalized.replyId = m.button.payload || '';
        }
        out.push(normalized);
      }
    }
  }
  return out;
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };

  /* ── GET: Meta subscription handshake ── */
  if (event.httpMethod === 'GET') {
    const params = event.queryStringParameters || {};
    const { verifyToken } = waConfig();
    if (
      verifyToken &&
      params['hub.mode'] === 'subscribe' &&
      params['hub.verify_token'] === verifyToken
    ) {
      return { statusCode: 200, headers: { 'Content-Type': 'text/plain' }, body: params['hub.challenge'] || '' };
    }
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Verification failed' }) };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  /* ── Signature gate (fail-safe: reject when the secret is not set,
        matching otasync-webhook's posture) ── */
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');
  const signature = event.headers['x-hub-signature-256'] || event.headers['X-Hub-Signature-256'];
  if (!verifySignature(rawBody, signature)) {
    console.error('[whatsapp-webhook] invalid or missing signature');
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid signature' }) };
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }
  if (payload.object !== 'whatsapp_business_account') {
    return { statusCode: 200, headers, body: JSON.stringify({ ignored: true }) };
  }

  /* Kill switch while onboarding: webhook stays subscribed and returns 200,
     but the bot does not answer until WHATSAPP_BOT_ENABLED=true. */
  const botEnabled = process.env.WHATSAPP_BOT_ENABLED === 'true';

  const messages = extractMessages(payload);
  for (const msg of messages) {
    try {
      if (!msg.from || await alreadyProcessed(msg.id)) continue;
      if (!botEnabled) {
        console.log(`[whatsapp-webhook] bot disabled; message from +${msg.from} logged only.`);
        continue;
      }
      /* Blue checks first — guests read "seen" as "being handled". */
      markRead(msg.id).catch(() => {});
      await bot.handleIncoming(msg);
    } catch (e) {
      /* Never bubble: a bot bug must not make Meta retry (duplicate replies)
         or disable the subscription. */
      console.error('[whatsapp-webhook] handler error:', e.message);
    }
  }

  return { statusCode: 200, headers, body: JSON.stringify({ received: true }) };
};

exports._test = { extractMessages, alreadyProcessed };
