/* Frente confirm (oct-2026): correo de confirmación SOLO del servidor.
 *
 * Cubre el hueco de seguridad:
 *  - /api/send-confirmation queda retirado (410) y nunca envía, sin importar
 *    el cuerpo (destinatario/código/breakfast/dedupeKey del cliente).
 *  - sendConfirmationEmail deriva la clave anti-duplicados en el servidor
 *    (ignora params.dedupeKey) y valida email/código.
 *  - Plantilla: enlace a la app del huésped con ?code=, sin la promesa falsa
 *    de "códigos de acceso", soporte ES/EN.
 *  - Pase de desayuno: token v2 (solo servidor) vs v1 legado → breakfast-passes
 *    no devuelve PII con un v1.
 *  - El motor (motor-app.jsx) ya no llama a send-confirmation desde el navegador,
 *    y guest-app.js prellena ?code=.
 *
 * Se mockea @netlify/blobs (memoria) y _rate-limit; sin red ni Blobs reales. */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

process.env.GUEST_APP_TOKEN_SECRET = 'confirm-security-test-secret';
delete process.env.OTASYNC_TOKEN;
delete process.env.OTASYNC_USERNAME;
delete process.env.OTASYNC_PASSWORD;
delete process.env.NETLIFY;

// ── Mock de @netlify/blobs ──
const blobsPath = require.resolve('@netlify/blobs');
const mem = new Map();
const memStore = {
  async set(key, val, opts) {
    if (opts && opts.onlyIfNew && mem.has(key)) return { modified: false };
    mem.set(key, val);
    return { modified: true };
  },
  async get(key) { return mem.has(key) ? mem.get(key) : null; },
  async delete(key) { mem.delete(key); },
  async list(opts) {
    const prefix = (opts && opts.prefix) || '';
    return { blobs: [...mem.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) };
  }
};
require.cache[blobsPath] = { id: blobsPath, filename: blobsPath, loaded: true, exports: { getStore: () => memStore } };

// ── Mock de _rate-limit ──
const rlPath = require.resolve('../../netlify/functions/_rate-limit');
require.cache[rlPath] = {
  id: rlPath, filename: rlPath, loaded: true,
  exports: { checkRateLimit: async () => ({ ok: true }), rateLimitResponse: () => ({ statusCode: 429, body: '{}' }) }
};

const sendConfirmation = require('../../netlify/functions/send-confirmation');
const { sendConfirmationEmail, confirmationDedupeKey } = sendConfirmation;
const { buildEmailHtml, guestAppUrl, formatDate } = sendConfirmation._test;
const { signPassToken, verifyPassToken } = require('../../netlify/functions/_breakfast-pass');
const passesHandler = require('../../netlify/functions/breakfast-passes').handler;

const ROOT = path.join(__dirname, '../..');

test.beforeEach(() => { mem.clear(); });

function fakeStore() {
  const map = new Map();
  return {
    map,
    get: async (k) => (map.has(k) ? map.get(k) : null),
    set: async (k, v, opts) => {
      if (opts && opts.onlyIfNew && map.has(k)) return { modified: false };
      map.set(k, v);
      return { modified: true };
    },
    delete: async (k) => { map.delete(k); }
  };
}

function okFetch(captured) {
  captured.calls = 0;
  return async (url, opts) => {
    captured.calls += 1;
    captured.body = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({ id: 're_sec_1' }) };
  };
}

async function withEnv(vars, run) {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === null) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await run();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function params(overrides = {}) {
  return {
    guestEmail: 'ana@example.com',
    guestName: 'Ana Pérez',
    bookingCode: 'RES-100',
    roomName: 'Clásica',
    checkIn: '2026-07-01',
    checkOut: '2026-07-03',
    nights: 2,
    paidAmount: 200000,
    totalAmount: 200000,
    via: 'webhook',
    ...overrides
  };
}

/* Token v1 legado, construido igual que lo firmaba el antiguo endpoint público. */
function legacyV1Token(code, ttl = 3600) {
  const key = crypto.createHmac('sha256', process.env.GUEST_APP_TOKEN_SECRET).update('breakfast-pass-v1').digest();
  const enc = Buffer.from(JSON.stringify({
    bc: code, scope: 'breakfast-pass', exp: Math.floor(Date.now() / 1000) + ttl
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', key).update(enc).digest('base64url');
  return `${enc}.${sig}`;
}

/* ── 1. Endpoint HTTP retirado ─────────────────────────────────────────── */

test('send-confirmation HTTP: POST con cualquier cuerpo → 410 y NUNCA envía', async () => {
  const realFetch = global.fetch;
  let fetched = 0;
  global.fetch = async () => { fetched += 1; return { ok: true, json: async () => ({}) }; };
  try {
    await withEnv({ RESEND_API_KEY: 're_live_like' }, async () => {
      const res = await sendConfirmation.handler({
        httpMethod: 'POST',
        headers: {},
        body: JSON.stringify({
          guestEmail: 'victima@example.com',
          guestName: 'Atacante',
          bookingCode: '123456',
          breakfast: true,
          dedupeKey: '123456'
        })
      });
      assert.equal(res.statusCode, 410);
      const body = JSON.parse(res.body);
      assert.equal(body.error, 'gone');
      assert.equal(body.sent, undefined);
      assert.doesNotMatch(res.body, /pase-desayuno|t=/);
    });
  } finally {
    global.fetch = realFetch;
  }
  assert.equal(fetched, 0, 'el endpoint público no debe tocar Resend');
  assert.equal(mem.size, 0, 'el endpoint público no debe reclamar claves de dedupe');
});

test('send-confirmation HTTP: GET → 410, OPTIONS → 200', async () => {
  const get = await sendConfirmation.handler({ httpMethod: 'GET', headers: {} });
  assert.equal(get.statusCode, 410);
  const opt = await sendConfirmation.handler({ httpMethod: 'OPTIONS', headers: {} });
  assert.equal(opt.statusCode, 200);
});

/* ── 2. Clave anti-duplicados derivada en el servidor ─────────────────── */

test('dedupe: la clave sale del código de reserva; params.dedupeKey se ignora', async () => {
  const store = fakeStore();
  store.map.set('ATACANTE', '1'); // un "reclamo" sembrado con una clave elegida por el cliente
  const captured = {};
  await withEnv({ RESEND_API_KEY: 're_key' }, async () => {
    const r = await sendConfirmationEmail(
      params({ dedupeKey: 'ATACANTE' }),
      { fetch: okFetch(captured), getStore: () => store }
    );
    assert.equal(r.sent, true);
  });
  assert.equal(captured.calls, 1, 'una clave sembrada por el cliente no suprime el correo legítimo');
  assert.ok(store.map.has('srv:RES-100'));
  assert.equal(confirmationDedupeKey(' RES-100 '), 'RES-100');
  assert.equal(confirmationDedupeKey(98765), '98765');
});

test('dedupe: dos disparos del servidor para la misma reserva → un solo correo', async () => {
  const store = fakeStore();
  const captured = {};
  const spy = okFetch(captured);
  await withEnv({ RESEND_API_KEY: 're_key' }, async () => {
    const a = await sendConfirmationEmail(params({ bookingCode: '4455' }), { fetch: spy, getStore: () => store });
    const b = await sendConfirmationEmail(params({ bookingCode: ' 4455 ' }), { fetch: spy, getStore: () => store });
    assert.equal(a.sent, true);
    assert.equal(b.duplicate, true);
  });
  assert.equal(captured.calls, 1);
});

/* ── 3. Validación de destinatario y código ───────────────────────────── */

test('valida el destinatario: lista con comas, sin @ o con espacios → no envía', async () => {
  for (const bad of ['a@x.com,b@y.com', 'no-es-correo', 'a b@x.com', 'a@x.com;b@y.com', '<a@x.com>']) {
    const captured = {};
    await withEnv({ RESEND_API_KEY: 're_key' }, async () => {
      const r = await sendConfirmationEmail(params({ guestEmail: bad }), { fetch: okFetch(captured), getStore: () => fakeStore() });
      assert.equal(r.sent, false, bad);
      assert.equal(r.reason, 'invalid-email', bad);
    });
    assert.equal(captured.calls, 0, bad);
  }
});

test('valida el código de reserva (no HTML ni separadores)', async () => {
  const captured = {};
  await withEnv({ RESEND_API_KEY: 're_key' }, async () => {
    const r = await sendConfirmationEmail(params({ bookingCode: '<b>1</b>' }), { fetch: okFetch(captured), getStore: () => fakeStore() });
    assert.equal(r.reason, 'invalid-booking-code');
    const missing = await sendConfirmationEmail(params({ bookingCode: '' }), { fetch: okFetch(captured), getStore: () => fakeStore() });
    assert.equal(missing.reason, 'missing-fields');
  });
  assert.equal(captured.calls, 0);
});

/* ── 4. Plantilla ─────────────────────────────────────────────────────── */

test('plantilla ES: enlace a la app del huésped con ?code= y sin la promesa de códigos de acceso', async () => {
  const captured = {};
  await withEnv({ RESEND_API_KEY: 're_key', GUEST_APP_BASE_URL: 'https://estar.com.co/' }, async () => {
    await sendConfirmationEmail(params({ bookingCode: '31415' }), { fetch: okFetch(captured), getStore: () => fakeStore() });
  });
  const html = captured.body.html;
  assert.match(html, /<html lang="es">/);
  assert.match(html, /href="https:\/\/estar\.com\.co\/guest\.html\?code=31415"/);
  assert.match(html, /Hacer mi check-in digital/);
  assert.match(html, /instrucciones de llegada/);
  assert.doesNotMatch(html, /recibirás los códigos/i);
  assert.doesNotMatch(html, /códigos de acceso/i);
  assert.match(html, /Reserva confirmada/);
  assert.match(captured.body.subject, /^Confirmación de reserva 31415/);
  assert.match(captured.body.text, /instrucciones de llegada/);
});

test('plantilla EN (lang:"en"): textos, fechas y asunto en inglés', async () => {
  const captured = {};
  await withEnv({ RESEND_API_KEY: 're_key' }, async () => {
    await sendConfirmationEmail(
      params({ bookingCode: '27182', lang: 'en', breakfast: true }),
      { fetch: okFetch(captured), getStore: () => fakeStore(), signPassToken: () => 'PASSEN' }
    );
  });
  const html = captured.body.html;
  assert.match(html, /<html lang="en">/);
  assert.match(html, /Booking confirmed/);
  assert.match(html, /Start my digital check-in/);
  assert.match(html, /arrival instructions/);
  assert.match(html, /July 1, 2026/);
  assert.match(html, /View my breakfast passes/);
  assert.match(html, /pase-desayuno\?t=PASSEN/);
  assert.match(html, /guest\.html\?code=27182/);
  assert.doesNotMatch(html, /Reserva confirmada/);
  assert.doesNotMatch(html, /access codes/i);
  assert.match(captured.body.subject, /^Booking confirmation 27182/);
});

test('plantilla: idioma desconocido cae a español; nombre con HTML se escapa', () => {
  const html = buildEmailHtml({
    guestName: '<script>alert(1)</script>', bookingCode: 'RES-1', roomName: 'Clásica',
    checkIn: '2026-07-01', checkOut: '2026-07-02', nights: 1, totalAmount: 1, paidAmount: 1, lang: 'fr'
  });
  assert.match(html, /<html lang="es">/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /guest\.html\?code=RES-1/);
});

test('guestAppUrl codifica el código y respeta la base configurada', () => {
  assert.equal(guestAppUrl('EST-1', 'https://x.test/'), 'https://x.test/guest.html?code=EST-1');
  assert.equal(guestAppUrl('a b', 'https://x.test'), 'https://x.test/guest.html?code=a%20b');
  assert.equal(guestAppUrl('', 'https://x.test'), 'https://x.test/guest.html');
  assert.equal(formatDate('2026-12-24', 'es'), '24 de diciembre de 2026');
  assert.equal(formatDate('2026-12-24', 'en'), 'December 24, 2026');
});

/* ── 5. Pase de desayuno: v2 (servidor) vs v1 legado ─────────────────── */

test('pase: signPassToken emite v2; un v1 legado se acepta marcado como legacy', () => {
  const v2 = verifyPassToken(signPassToken('EST-DEMO-2026'));
  assert.equal(v2.version, 2);
  assert.equal(v2.legacy, false);
  const v1 = verifyPassToken(legacyV1Token('EST-DEMO-2026'));
  assert.equal(v1.version, 1);
  assert.equal(v1.legacy, true);
  assert.equal(v1.bookingCode, 'EST-DEMO-2026');
});

test('pase: un payload v2 firmado con la clave v1 no vale; un v1 expirado tampoco', () => {
  const key1 = crypto.createHmac('sha256', process.env.GUEST_APP_TOKEN_SECRET).update('breakfast-pass-v1').digest();
  const enc = Buffer.from(JSON.stringify({ bc: 'X', scope: 'breakfast-pass', v: 2, exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url');
  const forged = `${enc}.${crypto.createHmac('sha256', key1).update(enc).digest('base64url')}`;
  assert.equal(verifyPassToken(forged), null);
  assert.equal(verifyPassToken(legacyV1Token('X', -10)), null);
});

test('breakfast-passes: token v2 devuelve los datos del huésped', async () => {
  const res = await passesHandler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ token: signPassToken('EST-DEMO-2026') }) });
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.limited, false);
  assert.ok(data.booking.guestName);
  assert.ok(data.booking.checkIn);
  assert.ok(data.passes.length >= 1);
});

test('breakfast-passes: token v1 legado → pases sí, PII no (nombre, apartamento, fechas)', async () => {
  const res = await passesHandler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ token: legacyV1Token('EST-DEMO-2026') }) });
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.limited, true);
  assert.deepEqual(Object.keys(data.booking), ['bookingCode']);
  assert.doesNotMatch(res.body, /Andrea|Restrepo|402|Selecci/);
  assert.ok(data.passes.length >= 1);
  assert.equal(data.passes[0].code, 'EST-DEMO-2026:0');
});

/* ── 6. Frontend: el navegador ya no pide el correo; guest app prellena ── */

test('motor-app.jsx ya no llama a /api/send-confirmation ni dice "Kunas" al huésped', () => {
  const src = fs.readFileSync(path.join(ROOT, 'motor-app.jsx'), 'utf8');
  assert.doesNotMatch(src, /\/api\/send-confirmation/);
  assert.doesNotMatch(src, /sendConfirmationEmailIfPossible/);
  assert.doesNotMatch(src, /Kunas no creo/);
  assert.doesNotMatch(src, /Tu reserva está confirmada\. En unos minutos/);
  assert.match(src, /Estamos verificando tu pago/);
  assert.match(src, /We are verifying your payment/);
  /* El bundle solo se revisa si está al día con la fuente (npm run test:unit
     compila antes; un dist viejo no debe dar un falso rojo). */
  const built = path.join(ROOT, 'dist', 'motor-app.js');
  if (fs.existsSync(built) && fs.statSync(built).mtimeMs >= fs.statSync(path.join(ROOT, 'motor-app.jsx')).mtimeMs) {
    assert.ok(!fs.readFileSync(built, 'utf8').includes('send-confirmation'), 'dist/motor-app.js no debe llamar a send-confirmation');
  }
});

test('guest-app.js prellena el código de reserva desde ?code=', () => {
  const src = fs.readFileSync(path.join(ROOT, 'guest-app.js'), 'utf8');
  assert.match(src, /function prefillBookingCodeFromUrl/);
  assert.match(src, /params\.get\('code'\)/);
});

test('ningún HTML del sitio llama al endpoint retirado', () => {
  const htmls = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'))
    .concat(fs.readdirSync(path.join(ROOT, 'en')).filter(f => f.endsWith('.html')).map(f => path.join('en', f)));
  for (const f of htmls) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), 'utf8'), /send-confirmation/, f);
  }
});

/* ── Hallazgos de revisión: alertas por reserva y espacio de claves srv: ── */

function captureAlerts() {
  const alertPath = require.resolve('../../netlify/functions/_alert');
  const prev = require.cache[alertPath];
  const alerts = [];
  require.cache[alertPath] = { id: alertPath, filename: alertPath, loaded: true, exports: { reportAlert: async (a) => { alerts.push(a); } } };
  return { alerts, restore: () => { if (prev) require.cache[alertPath] = prev; else delete require.cache[alertPath]; } };
}

test('dedupe: una clave legada sin prefijo (sembrada por el endpoint viejo) no suprime', async () => {
  const store = fakeStore();
  store.map.set('3273650', '1');
  const captured = {};
  await withEnv({ RESEND_API_KEY: 're_key' }, async () => {
    const r = await sendConfirmationEmail(params({ bookingCode: '3273650' }), { fetch: okFetch(captured), getStore: () => store });
    assert.equal(r.sent, true);
  });
  assert.equal(captured.calls, 1);
  assert.ok(store.map.has('srv:3273650'));
  assert.equal(sendConfirmation.confirmationStoreKey(' 3273650 '), 'srv:3273650');
});

test('timeout de Resend: alerta por reserva y queda reintentable', async () => {
  const cap = captureAlerts();
  const store = fakeStore();
  try {
    await withEnv({ RESEND_API_KEY: 're_key' }, async () => {
      const abortFetch = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
      const r = await sendConfirmationEmail(params({ bookingCode: '3300001' }), { fetch: abortFetch, getStore: () => store });
      assert.equal(r.reason, 'timeout');
    });
  } finally { cap.restore(); }
  assert.equal(cap.alerts.length, 1);
  assert.equal(cap.alerts[0].kind, 'confirmation_email_failed');
  assert.equal(cap.alerts[0].dedupeKey, 'confirmation-email-failed:3300001');
  assert.ok(!store.map.has('srv:3300001'), 'el reclamo se libera');
});

test('error de red no lanza y alerta; dos reservas que fallan generan dos alertas distintas', async () => {
  const cap = captureAlerts();
  try {
    await withEnv({ RESEND_API_KEY: 're_key' }, async () => {
      const netFetch = async () => { throw new Error('ECONNRESET'); };
      const r = await sendConfirmationEmail(params({ bookingCode: '3300002' }), { fetch: netFetch, getStore: () => fakeStore() });
      assert.equal(r.sent, false);
      assert.equal(r.reason, 'network-error');
      const badFetch = async () => ({ ok: false, status: 422, json: async () => ({ message: 'x' }) });
      const r2 = await sendConfirmationEmail(params({ bookingCode: '3300003' }), { fetch: badFetch, getStore: () => fakeStore() });
      assert.equal(r2.reason, 'resend-error');
    });
  } finally { cap.restore(); }
  assert.deepEqual(cap.alerts.map(a => a.dedupeKey), ['confirmation-email-failed:3300002', 'confirmation-email-failed:3300003']);
});
