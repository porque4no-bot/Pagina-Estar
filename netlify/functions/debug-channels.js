const fs = require('fs');
const path = require('path');

function loadEnv() {
  if (process.env.NODE_ENV === 'production' || process.env.NETLIFY === 'true') return;
  try {
    const envPath = path.join(__dirname, '../../.env');
    if (fs.existsSync(envPath)) {
      fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
        const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = (m[2] || '').trim().replace(/^["']|["']$/g, '');
      });
    }
  } catch (e) {}
}

loadEnv();

exports.handler = async (event) => {
  const token    = process.env.OTASYNC_TOKEN    || '';
  const username = process.env.OTASYNC_USERNAME || '';
  const password = process.env.OTASYNC_PASSWORD || '';
  const propertyId = process.env.OTASYNC_PROPERTY_ID || '9889';

  if (!token || !username || !password) {
    return { statusCode: 500, body: JSON.stringify({ error: 'OTASync credentials not configured' }) };
  }

  // 1. Authenticate
  const authRes = await fetch('https://app.otasync.me/api/user/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, username, password, remember: 0 })
  });
  const authData = await authRes.json();
  const pkey = authData.pkey;
  if (!pkey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Auth failed', detail: authData }) };
  }

  // 2. Try known channel endpoint patterns
  const endpoints = [
    'channel/data/channels',
    'channel/get/channels',
    'channel/data/get_channels',
    'channels/data/channels',
  ];

  const results = {};
  for (const ep of endpoints) {
    try {
      const r = await fetch(`https://app.otasync.me/api/${ep}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, key: pkey, id_properties: propertyId })
      });
      const text = await r.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch (e) { parsed = text.slice(0, 500); }
      results[ep] = { status: r.status, body: parsed };
    } catch (e) {
      results[ep] = { error: e.message };
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ propertyId, results }, null, 2)
  };
};
