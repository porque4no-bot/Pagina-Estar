const crypto = require('crypto');
const { corsHeaders, json, parseJsonBody } = require('./_guest-app');

function bearerToken(event) {
  const headers = event.headers || {};
  const auth = headers.authorization || headers.Authorization || '';
  const match = String(auth).match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

function timingSafeMatch(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function forwardToAppsScript(payload) {
  const url = process.env.GOOGLE_DRIVE_APPS_SCRIPT_URL || '';
  const secret = process.env.GOOGLE_DRIVE_APPS_SCRIPT_SECRET || '';
  if (!url || !secret) {
    const error = new Error('Google Drive Apps Script is not configured');
    error.statusCode = 503;
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret, payload }),
      signal: controller.signal
    });
    const text = await response.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch (error) {
      body = { raw: text.slice(0, 500) };
    }
    if (!response.ok || body.ok !== true) {
      const detail = body.error ||
        (body.raw ? 'Apps Script did not return a valid JSON response' : `Apps Script returned ${response.status}`);
      const error = new Error(detail);
      error.statusCode = 502;
      throw error;
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const expected = process.env.GUEST_APP_DRIVE_WEBHOOK_SECRET || '';
    if (!expected || !timingSafeMatch(bearerToken(event), expected)) {
      return json(401, { error: 'Invalid Drive webhook secret' });
    }

    const payload = parseJsonBody(event, 7 * 1024 * 1024);
    const result = await forwardToAppsScript(payload);
    return json(201, {
      ok: true,
      delivered: true,
      drive: result
    });
  } catch (error) {
    console.error('[guest-drive]', error.message);
    return json(error.statusCode || 500, {
      error: error.statusCode ? error.message : 'No fue posible archivar en Google Drive.'
    });
  }
};
