const test = require('node:test');
const assert = require('node:assert');
const { normalizeRecipients } = require('../../netlify/functions/_email');

/* Producción oct-2026: ADMIN_NOTIFY_EMAIL con varios correos separados por coma
   llegaba a Resend como un solo texto → 422 y ninguna alerta salía. */
test('normalizeRecipients separa una lista con comas en un arreglo', () => {
  assert.deepEqual(
    normalizeRecipients('reservas@estar.com.co, porque4no@gmail.com,rafael.castano@grupopinao.com'),
    ['reservas@estar.com.co', 'porque4no@gmail.com', 'rafael.castano@grupopinao.com']
  );
});

test('normalizeRecipients deja intacta una sola dirección y limpia vacíos', () => {
  assert.equal(normalizeRecipients('reservas@estar.com.co'), 'reservas@estar.com.co');
  assert.equal(normalizeRecipients(' a@b.co , '), 'a@b.co');
  assert.equal(normalizeRecipients(''), undefined);
  assert.equal(normalizeRecipients(undefined), undefined);
  assert.deepEqual(normalizeRecipients(['a@b.co', 'c@d.co;e@f.co']), ['a@b.co', 'c@d.co', 'e@f.co']);
});

test('sendEmail manda a Resend un arreglo cuando la variable trae comas', async () => {
  const email = require('../../netlify/functions/_email');
  const prevKey = process.env.RESEND_API_KEY;
  const prevFetch = global.fetch;
  process.env.RESEND_API_KEY = 're_test';
  let sentBody;
  global.fetch = async (url, opts) => { sentBody = JSON.parse(opts.body); return { ok: true, json: async () => ({ id: 'x' }) }; };
  try {
    const r = await email.sendEmail({ to: 'a@b.co,c@d.co', subject: 's', html: '<p>h</p>' });
    assert.equal(r.sent, true);
    assert.deepEqual(sentBody.to, ['a@b.co', 'c@d.co']);
  } finally {
    global.fetch = prevFetch;
    if (prevKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = prevKey;
  }
});
