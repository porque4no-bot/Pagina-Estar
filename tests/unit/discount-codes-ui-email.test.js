/* Frente codes — (1) la plantilla de correo ES/EN del código (_email.js) y
 * (2) los renderizadores puros de la pestaña Códigos del panel /admin
 * (cotizar-admin.html), ejecutados en un sandbox `vm` sin DOM ni red. */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const email = require('../../netlify/functions/_email');

/* ── Correo ── */
const SAMPLE = {
  code: 'GRACIAS-AB23CD45', guestName: 'Ana', discountText: '10% de descuento',
  validTo: '2027-01-06', minNights: 2, blackoutDates: [{ from: '2026-12-20', to: '2027-01-10' }],
  boundEmail: 'ana@correo.co', singleUse: true
};

test('correo de reseña ES: código, condiciones y enlace que prellena el motor', () => {
  const html = email.discountCodeEmailHtml(Object.assign({ kind: 'review', lang: 'es' }, SAMPLE));
  const text = email.htmlToText(html);
  assert.match(text, /Gracias por tu reseña/);
  assert.match(text, /GRACIAS-AB23CD45/);
  assert.match(text, /10% de descuento/);
  assert.match(text, /Válido hasta el 6 de enero de 2027/);
  assert.match(text, /Estadía mínima: 2 noches/);
  assert.match(text, /Un solo uso/);
  assert.match(text, /ana@correo\.co/);
  assert.match(text, /No aplica en: 20 de diciembre de 2026 → 10 de enero de 2027/);
  assert.ok(html.includes('https://estar.com.co/reservar.html?codigo=GRACIAS-AB23CD45'));
  assert.ok(html.includes('lang="es"'));
  assert.equal(email.discountCodeEmailSubject({ kind: 'review', lang: 'es' }), 'Gracias por tu reseña: tu código de descuento en estar');
});

test('correo personal EN: textos en inglés y enlace a /en/reservar.html', () => {
  const html = email.discountCodeEmailHtml(Object.assign({ kind: 'personal', lang: 'en' }, SAMPLE, { discountText: '$50.000 COP off', minNights: 1 }));
  const text = email.htmlToText(html);
  assert.match(text, /A gift for you/);
  assert.match(text, /Valid until January 6, 2027/);
  assert.match(text, /Minimum stay: 1 night\./);
  assert.match(text, /Linked to your email/);
  assert.ok(!/Válido|Estadía/.test(text), 'sin restos en español');
  assert.ok(html.includes('https://estar.com.co/en/reservar.html?codigo=GRACIAS-AB23CD45'));
  assert.equal(email.discountCodeEmailSubject({ kind: 'personal', lang: 'en' }), 'Your personal estar discount code');
});

test('correo: escapa datos del huésped y omite condiciones vacías', () => {
  const html = email.discountCodeEmailHtml({ kind: 'personal', lang: 'es', guestName: '<script>x</script>', code: 'ABC-123', discountText: '5% de descuento' });
  assert.ok(!html.includes('<script>x</script>'));
  const text = email.htmlToText(html);
  assert.ok(!/Válido hasta|Estadía mínima|No aplica en|Un solo uso/.test(text));
});

/* ── Panel /admin: renderizadores puros ── */
const html = fs.readFileSync(path.resolve(__dirname, '../../cotizar-admin.html'), 'utf8');

function extractFunction(src, header) {
  const start = src.indexOf(header);
  assert.notEqual(start, -1, `No se encontró ${header} en el HTML`);
  const braceStart = src.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`No se cerró ${header}`);
}
function extractConst(src, name) {
  const m = src.match(new RegExp('const ' + name + ' = \\{[^;]*\\};'));
  assert.ok(m, `No se encontró const ${name}`);
  return m[0];
}

function sandbox() {
  const fns = ['escHtml', 'fmtShortDate', 'codTd', 'codFmtDiscount', 'codFmtVigencia', 'codOriginLabel', 'codUsedLabel',
    'renderCodeRow', 'renderIssuedRow', 'ruleFmtValidity', 'ruleConditions', 'renderRuleRow',
    'reviewRuleInfoText', 'renderReviewPendingRow', 'renderReviewDoneRow'];
  const src = fns.map(f => extractFunction(html, 'function ' + f + '(')).join('\n') + '\n' + extractConst(html, 'REV_PLATFORM_LABEL').replace('const ', 'var ');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx;
}

test('la pestaña Códigos tiene las 4 sub-secciones y los formularios nuevos', () => {
  for (const id of ['codSubnav', 'codSubCodigos', 'codSubReglas', 'codSubPersonal', 'codSubResenas', 'codFlagWarn',
    'cBoundEmail', 'rName', 'rPurpose', 'rValidityMode', 'rValidityDays', 'rSingleUse', 'rBindEmail', 'rBlackoutList',
    'pRule', 'pEmail', 'pIssueBtn', 'vEmail', 'vPlatform', 'vApproveNowBtn', 'reviewsPendingTbody', 'reviewsDoneTbody', 'issuedTbody']) {
    assert.ok(html.includes('id="' + id + '"'), 'falta #' + id);
  }
  assert.match(html, /data-view="codigos" data-perm="quotes\.edit"/, 'la pestaña sigue gateada con quotes.edit');
});

test('codOriginLabel / codUsedLabel', () => {
  const ctx = sandbox();
  assert.equal(ctx.codOriginLabel({ origin: 'review', boundEmail: 'a@b.co' }), 'Reseña · a@b.co');
  assert.equal(ctx.codOriginLabel({ origin: 'personal', issuedToEmail: 'c@d.co' }), 'Personal · c@d.co');
  assert.equal(ctx.codOriginLabel({}), 'Manual');
  assert.match(ctx.codUsedLabel({ usedCount: 0 }), /No usado/);
  const used = ctx.codUsedLabel({ usedCount: 1, usedBy: ['EST-1<x>'] });
  assert.match(used, /Usado 1 vez/);
  assert.ok(used.includes('EST-1&lt;x&gt;'), 'escapa las reservas');
});

test('renderRuleRow: resume vigencia y condiciones; escapa el nombre', () => {
  const ctx = sandbox();
  const row = ctx.renderRuleRow({ id: 'r1', name: '<b>Reseña</b>', prefix: 'RESENA', purpose: 'review', type: 'percent', value: 10,
    validityMode: 'days', validityDays: 90, singleUse: true, maxUses: 1, bindEmail: true, minNights: 2,
    blackoutDates: [{ from: '2026-12-20', to: '2027-01-10' }], active: true });
  assert.ok(row.includes('&lt;b&gt;Reseña&lt;/b&gt;'));
  assert.match(row, /90 días desde la emisión/);
  assert.match(row, /Un solo uso · Ligado a email · Mín\. 2 noches · 1 rango bloqueado/);
  assert.match(row, /data-label="Propósito"><div class="cod-cell">Reseña</);
  assert.match(row, /Desactivar/);
  const fixed = ctx.renderRuleRow({ id: 'r2', name: 'Navidad', prefix: 'NAV', purpose: 'general', type: 'fixed', value: 30000,
    validityMode: 'fixed', validFrom: '2026-12-01', validTo: '2026-12-31', bindEmail: false, maxUses: 5, active: false });
  assert.match(fixed, /1\/12\/26 → 31\/12\/26/);
  assert.match(fixed, /5 usos máx\./);
  assert.match(fixed, /Activar/);
});

test('reviewRuleInfoText avisa cuando no hay regla de reseña activa', () => {
  const ctx = sandbox();
  assert.equal(ctx.reviewRuleInfoText([]).missing, true);
  const info = ctx.reviewRuleInfoText([{ name: 'Gracias', purpose: 'review', active: true, type: 'percent', value: 12, validityMode: 'days', validityDays: 60, bindEmail: true, singleUse: true }]);
  assert.equal(info.missing, false);
  assert.match(info.text, /Gracias — 12%, 60 días desde la emisión/);
});

test('renderReviewPendingRow / renderReviewDoneRow', () => {
  const ctx = sandbox();
  const pending = ctx.renderReviewPendingRow({ id: 'REV-1', name: 'Ana', email: 'ana@x.co', bookingCode: 'EST-9', platform: 'booking', link: 'https://booking.com/r?a=1&b="2"', createdAt: '2026-10-08T00:00:00Z' });
  assert.match(pending, /Aprobar reseña/);
  assert.match(pending, /Booking/);
  assert.ok(pending.includes('href="https://booking.com/r?a=1&amp;b=&quot;2&quot;"'), 'el enlace va escapado en el atributo');
  assert.match(pending, /rel="noopener noreferrer"/);
  const codes = { 'GR-1': { code: 'GR-1', usedCount: 1, usedBy: ['EST-5'] } };
  const done = ctx.renderReviewDoneRow({ id: 'REV-2', name: 'Ana', email: 'ana@x.co', platform: 'google', status: 'approved', issuedCode: 'GR-1', emailSent: true, emailSentAt: '2026-10-08T00:00:00Z' }, codes);
  assert.match(done, /aprobada/);
  assert.match(done, /Usado 1 vez/);
  assert.match(done, /Reenviar correo/);
  const rejected = ctx.renderReviewDoneRow({ id: 'REV-3', email: 'x@x.co', platform: 'otra', status: 'rejected' }, codes);
  assert.match(rejected, /descartada/);
  assert.ok(!/Reenviar correo/.test(rejected));
});

test('cada celda con etiqueta envuelve su contenido en un solo bloque (tarjetas en móvil)', () => {
  const ctx = sandbox();
  const row = ctx.renderReviewPendingRow({ id: 'REV-1', name: 'Ana', email: 'ana@x.co', note: 'nota', platform: 'google', createdAt: '2026-10-08T00:00:00Z' });
  const cells = row.match(/<td data-label="[^"]+">/g) || [];
  assert.ok(cells.length >= 5);
  for (const label of cells) {
    const idx = row.indexOf(label) + label.length;
    assert.ok(row.startsWith('<div class="cod-cell">', idx), 'celda sin envoltorio: ' + label);
  }
});

test('renderIssuedRow muestra huésped, vencimiento y uso', () => {
  const ctx = sandbox();
  const row = ctx.renderIssuedRow({ code: 'ESTAR-AB', origin: 'personal', ruleId: 'compensacion', issuedToName: 'Clara', boundEmail: 'clara@x.co', type: 'fixed', value: 50000, validTo: '2026-12-07', usedCount: 0, active: true });
  assert.match(row, /ESTAR-AB/);
  assert.match(row, /Clara/);
  assert.match(row, /clara@x\.co/);
  assert.match(row, /\$50\.000/);
  assert.match(row, /7\/12\/26/);
  assert.match(row, /No usado/);
});
