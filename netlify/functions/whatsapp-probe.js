/* Admin-only health probe for the WhatsApp Cloud API integration.
   GET /api/whatsapp-probe
   Reports which env vars are set (booleans only — never echoes secrets) and,
   when token + phone number id are present, calls the Graph API to confirm
   they resolve to a live phone number. Use during setup, before flipping
   WHATSAPP_BOT_ENABLED=true. See docs/whatsapp-bot.md. */

const { authorize } = require('./_authz');
const { waConfig, isConfigured } = require('./_whatsapp');

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) corsHeaders['Access-Control-Allow-Origin'] = allowedOrigin;

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  const auth = await authorize(event, 'integrations.probe');
  if (!auth.ok) return { statusCode: auth.statusCode, headers: corsHeaders, body: JSON.stringify({ error: auth.error }) };

  const c = waConfig();
  const result = {
    ok: false,
    config: {
      token: Boolean(c.token),
      phoneNumberId: Boolean(c.phoneNumberId),
      appSecret: Boolean(c.appSecret),
      verifyToken: Boolean(c.verifyToken),
      graphVersion: c.graphVersion,
      botEnabled: process.env.WHATSAPP_BOT_ENABLED === 'true'
    }
  };

  if (!isConfigured()) {
    result.note = 'Missing WHATSAPP_TOKEN and/or WHATSAPP_PHONE_NUMBER_ID — bot runs in mock mode.';
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(result) };
  }

  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(
      `https://graph.facebook.com/${c.graphVersion}/${c.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
      { headers: { Authorization: `Bearer ${c.token}` }, signal: ctrl.signal }
    );
    clearTimeout(tid);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      result.graph = { status: res.status, error: data.error && data.error.message };
      return { statusCode: 503, headers: corsHeaders, body: JSON.stringify(result) };
    }
    result.ok = true;
    result.graph = {
      displayPhoneNumber: data.display_phone_number,
      verifiedName: data.verified_name,
      qualityRating: data.quality_rating
    };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(result) };
  } catch (e) {
    result.graph = { error: e.message };
    return { statusCode: 503, headers: corsHeaders, body: JSON.stringify(result) };
  }
};
