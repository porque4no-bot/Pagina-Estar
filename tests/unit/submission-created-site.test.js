/* Frente site — formularios que antes quedaban solo en Netlify Forms:
   - `convenios-empresas` (empresas.html) → partner empresa + lead "Convenio empresarial".
   - `estancias-largas-en` (en/vivir.html) → alias del handler de larga estadía.
   - `vacantes-empleo` (trabaja.html) → correo al equipo, NUNCA al maestro de clientes.
   Odoo y el correo se inyectan (deps) para verificar qué se llama sin red. */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

for (const k of ['ODOO_URL', 'ODOO_DB', 'ODOO_USERNAME', 'ODOO_API_KEY', 'ODOO_COMPANY_ID', 'RESEND_API_KEY']) delete process.env[k];

const { handler, _test } = require(path.join(__dirname, '../../netlify/functions/submission-created.js'));
const emailMod = require(path.join(__dirname, '../../netlify/functions/_email.js'));

function ev(payload) { return { body: JSON.stringify({ payload }) }; }

/* Odoo falso que registra las llamadas. */
function fakeOdoo({ partnerId = 77 } = {}) {
  const calls = { upsert: [], lead: [], mailing: [] };
  return {
    calls,
    mod: {
      upsertPartner: async (v) => { calls.upsert.push(v); return { id: partnerId, created: true }; },
      createLead: async (v) => { calls.lead.push(v); return { id: 501 }; },
      addToMailingList: async (v) => { calls.mailing.push(v); return { listId: 1 }; }
    }
  };
}

/* Correo falso: usa las plantillas reales de _email.js pero no envía nada. */
function fakeEmail({ sent = true, throws = false } = {}) {
  const sentMail = [];
  return {
    sentMail,
    mod: {
      ...emailMod,
      adminEmail: () => 'equipo@estar.test',
      sendEmail: async (m) => {
        if (throws) throw new Error('resend caído');
        sentMail.push(m);
        return sent ? { sent: true, id: 'x' } : { sent: false, reason: 'no-key' };
      }
    }
  };
}

function deps(odoo, email) {
  return {
    odoo: () => (odoo ? odoo.mod : fakeOdoo().mod),
    email: () => (email ? email.mod : fakeEmail().mod)
  };
}

/* ── convenios-empresas ── */
test('convenios-empresas: partner EMPRESA con contacto, WhatsApp y crédito en la nota', () => {
  const v = _test.FORM_HANDLERS['convenios-empresas']({
    empresa: 'Hospital de Caldas', contacto: 'María Restrepo', email: 'm.restrepo@hc.co',
    whatsapp: '+57 300 111 2233', credito_30_dias: 'on', aceptar_politica: 'on'
  });
  assert.equal(v.name, 'Hospital de Caldas');
  /* El correo y el WhatsApp son del CONTACTO: van al lead, nunca al partner
     empresa (evita sobrescribir la ficha de una persona que ya existe). */
  assert.equal(v.email, undefined);
  assert.equal(v.phone, undefined);
  assert.equal(v.leadEmail, 'm.restrepo@hc.co');
  assert.equal(v.leadPhone, '+57 300 111 2233');
  assert.equal(v.isCompany, true);
  assert.equal(v.dedupeByCompanyName, true);
  assert.deepEqual(v.tags, ['Corporativo', 'Convenio empresarial']);
  assert.match(v.comment, /Contacto: María Restrepo/);
  assert.match(v.comment, /Solicita crédito a 30 días: sí/);
  assert.equal(v.leadContact, 'María Restrepo');
  assert.equal(v.lead(v), 'Convenio empresarial — Hospital de Caldas');
  assert.equal(v.marketing, undefined, 'aceptar_politica NO es opt-in de marketing');
});

test('convenios-empresas: crédito desmarcado queda como "no"', () => {
  const v = _test.FORM_HANDLERS['convenios-empresas']({ empresa: 'ACME', contacto: 'Ana', email: 'a@acme.co' });
  assert.match(v.comment, /Solicita crédito a 30 días: no/);
});

test('convenios-empresas con marketingOptIn: tag + nota de consentimiento + lista', () => {
  const v = _test.FORM_HANDLERS['convenios-empresas']({ empresa: 'ACME', contacto: 'Ana', email: 'a@acme.co', marketingOptIn: 'on' });
  assert.deepEqual(v.tags, ['Corporativo', 'Convenio empresarial', 'Opt-in marketing']);
  assert.match(v.comment, /Opt-in marketing aceptado \(empresas\.html\) el \d{4}-\d{2}-\d{2}/);
  assert.deepEqual(v.marketing, { listName: 'Newsletter', name: 'Ana', email: 'a@acme.co' });
});

test('convenios-empresas de punta a punta: upsert empresa + lead con contacto y teléfono', async () => {
  const odoo = fakeOdoo();
  const res = await _test.handle(ev({
    form_name: 'convenios-empresas',
    data: { empresa: 'ACME SAS', contacto: 'Ana Gómez', email: 'ana@acme.co', whatsapp: '3001234567', credito_30_dias: 'on' }
  }), deps(odoo));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'ok');
  assert.equal(odoo.calls.upsert.length, 1);
  const partner = odoo.calls.upsert[0];
  assert.equal(partner.isCompany, true);
  assert.equal(partner.email, undefined, 'el correo del contacto no llega al partner empresa');
  assert.equal(partner.phone, undefined);
  assert.equal(odoo.calls.lead[0].email, 'ana@acme.co', 'el correo del contacto va al lead');
  assert.ok(!('lead' in partner) && !('leadContact' in partner) && !('leadEmail' in partner) && !('leadPhone' in partner) && !('marketing' in partner),
    'los metadatos de enrutado no llegan a res.partner');
  assert.equal(odoo.calls.lead.length, 1);
  assert.deepEqual(
    { subject: odoo.calls.lead[0].subject, partnerId: odoo.calls.lead[0].partnerId, contactName: odoo.calls.lead[0].contactName, phone: odoo.calls.lead[0].phone },
    { subject: 'Convenio empresarial — ACME SAS', partnerId: 77, contactName: 'Ana Gómez', phone: '3001234567' }
  );
  assert.equal(odoo.calls.mailing.length, 0, 'sin opt-in no entra a marketing');
});

test('convenios-empresas en modo mock (sin credenciales de Odoo) responde 200 ok', async () => {
  const res = await handler(ev({ form_name: 'convenios-empresas', data: { empresa: 'ACME', contacto: 'Ana', email: 'a@acme.co' } }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'ok');
});

test('un error de Odoo no rompe el envío (200)', async () => {
  const res = await _test.handle(ev({ form_name: 'convenios-empresas', data: { empresa: 'ACME', email: 'a@acme.co' } }), {
    odoo: () => ({ upsertPartner: async () => { throw new Error('Odoo caído'); } }),
    email: () => fakeEmail().mod
  });
  assert.equal(res.statusCode, 200);
});

/* ── estancias-largas-en (alias) ── */
test('estancias-largas-en usa el mismo mapeo que larga estadía, marcado en inglés', async () => {
  const data = { nombre: 'Alex Johnson', correo: 'alex@mail.com', motivo_viaje: 'Remote work / Digital nomad', tiempo_estimado: '6 — 11 months', tipologia: 'seleccion', marketingOptIn: 'on' };
  const v = _test.FORM_HANDLERS['estancias-largas-en'](data);
  assert.equal(v.name, 'Alex Johnson');
  assert.equal(v.email, 'alex@mail.com');
  assert.equal(v.lang, 'en');
  assert.deepEqual(v.tags, ['Larga estadía', 'Opt-in marketing']);
  assert.match(v.comment, /Solicitud de larga estadía \(en\/vivir\.html\)/);
  assert.match(v.comment, /Opt-in marketing aceptado \(en\/vivir\.html\)/);
  assert.equal(v.lead(v), 'Larga estadía — Alex Johnson');

  const odoo = fakeOdoo();
  const res = await _test.handle(ev({ form_name: 'estancias-largas-en', data }), deps(odoo));
  assert.equal(res.body, 'ok');
  assert.equal(odoo.calls.upsert.length, 1);
  assert.equal(odoo.calls.lead.length, 1);
  assert.equal(odoo.calls.mailing.length, 1);
});

test('el form español de larga estadía NO fuerza idioma (es_CO puede no estar activo en Odoo)', () => {
  const v = _test.FORM_HANDLERS['estancias-largas']({ nombre: 'Ana', correo: 'a@b.co' });
  assert.equal(v.lang, undefined);
});

/* ── vacantes-empleo → correo al equipo ── */
test('buildJobApplication normaliza área, idioma y la URL de la hoja de vida', () => {
  const a = _test.buildJobApplication({
    nombre: 'Carlos Giraldo', email: 'carlos@mail.co', area: 'housekeeping',
    hoja_vida: 'https://drive.google.com/file/d/abc', mensaje: 'Hola', habeas_data: 'on',
    referrer: 'https://estar.com.co/en/trabaja.html'
  });
  assert.equal(a.area, 'Limpieza / Mantenimiento');
  assert.equal(a.hojaVidaUrl, 'https://drive.google.com/file/d/abc');
  assert.equal(a.lang, 'en');
  assert.equal(a.aceptaPolitica, true);
  assert.equal(_test.buildJobApplication({ area: 'admin' }), null, 'sin nombre ni correo no hay aviso');
});

test('safeHttpUrl solo acepta http(s)', () => {
  assert.equal(_test.safeHttpUrl('https://linkedin.com/in/x'), 'https://linkedin.com/in/x');
  assert.equal(_test.safeHttpUrl('javascript:alert(1)'), '');
  assert.equal(_test.safeHttpUrl('data:text/html,hi'), '');
  assert.equal(_test.safeHttpUrl('no es url'), '');
});

test('vacantes-empleo envía correo al equipo y NO toca Odoo', async () => {
  const odoo = fakeOdoo();
  const email = fakeEmail();
  const res = await _test.handle(ev({
    form_name: 'vacantes-empleo',
    data: { nombre: 'Carlos Giraldo', email: 'carlos@mail.co', area: 'operations', hoja_vida: 'https://linkedin.com/in/carlos', mensaje: 'Tengo experiencia\nen recepción', habeas_data: 'on' }
  }), deps(odoo, email));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'ok');
  assert.equal(odoo.calls.upsert.length, 0, 'un postulante no entra al maestro de clientes');
  assert.equal(odoo.calls.lead.length, 0);
  assert.equal(email.sentMail.length, 1);
  const m = email.sentMail[0];
  assert.equal(m.to, 'equipo@estar.test');
  assert.equal(m.subject, 'Nueva postulación — Carlos Giraldo (Operaciones / Huéspedes)');
  assert.match(m.html, /Carlos Giraldo/);
  assert.match(m.html, /href="https:\/\/linkedin\.com\/in\/carlos"/);
  assert.match(m.html, /Tengo experiencia<br>en recepción/);
});

test('el correo de postulación escapa HTML y no enlaza URLs peligrosas', () => {
  const html = emailMod.jobApplicationHtml({ application: _test.buildJobApplication({
    nombre: '<img src=x onerror=alert(1)>', email: 'x@y.co', area: 'other',
    hoja_vida: 'javascript:alert(1)', mensaje: '<script>alert(1)</script>'
  }) });
  assert.ok(!/<img src=x/.test(html), 'el nombre se escapa');
  assert.ok(!/<script>alert/.test(html), 'el mensaje se escapa');
  assert.ok(!/href="javascript:/i.test(html), 'una URL javascript: nunca es enlace');
  assert.match(html, /javascript:alert\(1\)/, 'pero se muestra como texto para que el equipo la vea');
});

test('vacantes-empleo sin RESEND (no enviado) o con Resend caído responde 200 igual', async () => {
  const r1 = await _test.handle(ev({ form_name: 'vacantes-empleo', data: { nombre: 'Ana', email: 'a@b.co' } }), deps(null, fakeEmail({ sent: false })));
  assert.equal(r1.statusCode, 200);
  assert.equal(r1.body, 'ok (correo no enviado)');
  const r2 = await _test.handle(ev({ form_name: 'vacantes-empleo', data: { nombre: 'Ana', email: 'a@b.co' } }), deps(null, fakeEmail({ throws: true })));
  assert.equal(r2.statusCode, 200);
  assert.equal(r2.body, 'ok (correo no enviado)');
});

test('vacantes-empleo con el handler real (sin RESEND_API_KEY) no lanza y responde 200', async () => {
  const res = await handler(ev({ form_name: 'vacantes-empleo', data: { nombre: 'Ana', email: 'a@b.co', area: 'admin' } }));
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /^ok/);
});

test('vacantes-empleo sin nombre ni correo se ignora sin enviar nada', async () => {
  const email = fakeEmail();
  const res = await _test.handle(ev({ form_name: 'vacantes-empleo', data: { area: 'admin' } }), deps(null, email));
  assert.match(res.body, /ignored/);
  assert.equal(email.sentMail.length, 0);
});

/* ── Paridad: cada form nativo publicado en el sitio tiene destino ── */
test('todo formulario data-netlify del sitio (ES y EN) tiene handler en submission-created', () => {
  const fs = require('node:fs');
  const root = path.join(__dirname, '../..');
  const pages = [
    ...fs.readdirSync(root).filter(f => f.endsWith('.html')).map(f => path.join(root, f)),
    ...fs.readdirSync(path.join(root, 'en')).filter(f => f.endsWith('.html')).map(f => path.join(root, 'en', f))
  ];
  const names = new Set();
  for (const p of pages) {
    const html = fs.readFileSync(p, 'utf8');
    const re = /<form\b[^>]*\bname="([^"]+)"[^>]*\bdata-netlify="true"/g;
    let m;
    while ((m = re.exec(html))) names.add(m[1]);
  }
  assert.ok(names.size >= 6, `se esperaban varios formularios, hay ${names.size}`);
  const missing = [...names].filter(n => !_test.FORM_HANDLERS[n] && !_test.TEAM_NOTIFY_FORMS[n]);
  assert.deepEqual(missing, [], `formularios sin destino: ${missing.join(', ')}`);
});

test('convenios-empresas con opt-in: el correo del CONTACTO entra a la lista aunque el partner no lo lleve', async () => {
  const odoo = fakeOdoo();
  await _test.handle(ev({
    form_name: 'convenios-empresas',
    data: { empresa: 'ACME SAS', contacto: 'Ana Gómez', email: 'ana@acme.co', marketingOptIn: 'on' }
  }), deps(odoo));
  assert.equal(odoo.calls.mailing.length, 1);
  assert.equal(odoo.calls.mailing[0].email, 'ana@acme.co');
  assert.equal(odoo.calls.mailing[0].name, 'Ana Gómez');
});
