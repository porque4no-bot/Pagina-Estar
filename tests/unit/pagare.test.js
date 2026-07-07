/* Pruebas de lógica PURA del módulo PAGARÉ (_pagare.js) — sin I/O real (Blobs,
 * red ni proveedor externo). Cubre:
 *   - hash del documento determinista (huella de los términos legales),
 *   - evidencia Ley 527 completa (hash + timestamp + consentimiento + firmante),
 *   - acuse HMAC verificable y sensible a manipulación,
 *   - proveedor por defecto 'own' (sin credenciales externas, sin lanzar),
 *   - proveedor 'external' sin credenciales → mock, sin lanzar,
 *   - número a letras y techo de usura para el interés de mora,
 *   - interfaz DataCredito gated (nunca envía). */

const test = require('node:test');
const assert = require('node:assert/strict');

const pagare = require('../../netlify/functions/_pagare');

const BASE_INPUT = {
  pagareId: 'PAG-20260707-ABCD1234',
  bookingCode: 'EST-001',
  deudorNombre: 'Juan Pérez',
  deudorTipoDocumento: 'C.C.',
  deudorDocumento: '123456789',
  deudorEmail: 'juan@example.com',
  monto: 1234567,
  moneda: 'COP',
  interesMora: 40,
  tasaUsura: 25,
  fechaCreacion: '2026-07-07T12:00:00.000Z',
  fechaVencimiento: '2026-08-07'
};

/* ── contenido / hash ──────────────────────────────────────────────────────── */

test('buildPagareData incorpora la mención del derecho y datos del título valor', () => {
  const d = pagare.buildPagareData(BASE_INPUT);
  assert.equal(d.tipo, 'PAGARE');
  assert.equal(d.monto, 1234567);
  assert.equal(d.beneficiario.nombre, 'Hotel Estar');
  assert.match(d.clausula, /INCONDICIONALMENTE/);
  assert.match(d.montoEnLetras, /pesos moneda corriente/);
});

test('contentHash es determinista (mismos términos → mismo hash sha256 de 64 hex)', () => {
  const a = pagare.contentHash(pagare.buildPagareData(BASE_INPUT));
  const b = pagare.contentHash(pagare.buildPagareData(BASE_INPUT));
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('contentHash cambia si cambia un término (monto)', () => {
  const a = pagare.contentHash(pagare.buildPagareData(BASE_INPUT));
  const b = pagare.contentHash(pagare.buildPagareData({ ...BASE_INPUT, monto: 999 }));
  assert.notEqual(a, b);
});

/* ── número a letras ───────────────────────────────────────────────────────── */

test('montoEnLetras convierte enteros COP correctamente', () => {
  assert.equal(pagare.montoEnLetras(0), 'cero');
  assert.equal(pagare.montoEnLetras(1), 'uno');
  assert.equal(pagare.montoEnLetras(100), 'cien');
  assert.equal(pagare.montoEnLetras(1000000), 'un millón');
  assert.equal(pagare.montoEnLetras(1234567), 'un millón doscientos treinta y cuatro mil quinientos sesenta y siete');
  /* apócope de 'uno' en los grupos mil/millones (obligatoria ante el sustantivo). */
  assert.equal(pagare.montoEnLetras(21000), 'veintiún mil');
  assert.equal(pagare.montoEnLetras(101000), 'ciento un mil');
  assert.equal(pagare.montoEnLetras(21000000), 'veintiún millones');
});

test('apocopar aplica la forma apocopada ante sustantivo (pesos/mil/millones)', () => {
  assert.equal(pagare.apocopar('uno'), 'un');                       /* un peso */
  assert.equal(pagare.apocopar('veintiuno'), 'veintiún');          /* veintiún pesos */
  assert.equal(pagare.apocopar('treinta y uno'), 'treinta y un');  /* treinta y un pesos */
  assert.equal(pagare.apocopar('ciento uno'), 'ciento un');        /* ciento un pesos */
  assert.equal(pagare.apocopar('dos'), 'dos');                      /* sin cambio */
});

/* ── techo de usura (interés de mora) ──────────────────────────────────────── */

test('capMoraRate nunca supera la tasa de usura', () => {
  assert.equal(pagare.capMoraRate(40, 25), 25);   /* solicitada > usura → usura */
  assert.equal(pagare.capMoraRate(20, 25), 20);   /* solicitada < usura → solicitada */
  assert.equal(pagare.capMoraRate(40, 0), 0);     /* sin usura válida → 0 */
  assert.equal(pagare.capMoraRate(0, 25), 0);
});

test('buildPagareData aplica el techo de usura al interés de mora', () => {
  const d = pagare.buildPagareData(BASE_INPUT); /* mora 40, usura 25 */
  assert.equal(d.interesMora, 25);
});

/* ── evidencia Ley 527 + acuse ─────────────────────────────────────────────── */

function fullEvidence() {
  return pagare.buildEvidence({
    documentHash: 'a'.repeat(64),
    at: '2026-07-07T12:00:00.000Z',
    consent: { accepted: true, text: 'Acepto y firmo el pagaré.' },
    channel: 'web',
    ip: '190.0.0.1',
    userAgent: 'jest',
    signer: { nombre: 'Juan Pérez', documento: '123456789', email: 'juan@example.com' }
  });
}

test('buildEvidence captura hash, timestamp, consentimiento, canal/IP y firmante', () => {
  const e = fullEvidence();
  assert.equal(e.documentHash, 'a'.repeat(64));
  assert.equal(e.timestamp, '2026-07-07T12:00:00.000Z');
  assert.equal(e.consent.accepted, true);
  assert.ok(e.consent.text);
  assert.equal(e.channel, 'web');
  assert.equal(e.ip, '190.0.0.1');
  assert.equal(e.signer.nombre, 'Juan Pérez');
  assert.equal(pagare.evidenceIsComplete(e), true);
});

test('evidenceIsComplete falla si falta consentimiento o firmante', () => {
  const noConsent = pagare.buildEvidence({ documentHash: 'a'.repeat(64), consent: { accepted: false, text: 'x' }, signer: { nombre: 'X' } });
  assert.equal(pagare.evidenceIsComplete(noConsent), false);
  const noSigner = pagare.buildEvidence({ documentHash: 'a'.repeat(64), consent: { accepted: true, text: 'x' } });
  assert.equal(pagare.evidenceIsComplete(noSigner), false);
});

test('signEvidence/verifyEvidence: acuse verificable y sensible a manipulación', () => {
  const e = fullEvidence();
  const secret = 'unit-test-secret';
  const sealed = pagare.signEvidence(e, { secret });
  assert.equal(sealed.sealed, true);
  assert.match(sealed.acuse, /^[0-9a-f]{64}$/);
  assert.equal(pagare.verifyEvidence(e, sealed.acuse, { secret }), true);

  /* manipular la evidencia invalida el acuse */
  const tampered = { ...e, documentHash: 'b'.repeat(64) };
  assert.equal(pagare.verifyEvidence(tampered, sealed.acuse, { secret }), false);
  /* secreto distinto no verifica */
  assert.equal(pagare.verifyEvidence(e, sealed.acuse, { secret: 'otro' }), false);
});

test('signEvidence sin secreto no sella pero NO lanza', () => {
  const e = fullEvidence();
  const sealed = pagare.signEvidence(e, { secret: '' });
  assert.equal(sealed.sealed, false);
  assert.equal(sealed.acuse, null);
});

/* ── proveedores intercambiables ───────────────────────────────────────────── */

test('getProvider por defecto devuelve "own" y funciona sin credenciales', () => {
  assert.equal(pagare.getProvider().name, 'own');
  assert.equal(pagare.getProvider('desconocido').name, 'own');
  assert.equal(pagare.getProvider('external').name, 'external');
  assert.equal(pagare.ownProvider.isConfigured(), true);
});

test('own.createDocument genera hash del documento sin lanzar', async () => {
  const doc = await pagare.ownProvider.createDocument(BASE_INPUT);
  assert.equal(doc.provider, 'own');
  assert.equal(doc.isMock, false);
  assert.match(doc.documentHash, /^[0-9a-f]{64}$/);
  assert.ok(Buffer.isBuffer(doc.pdf));
  assert.match(doc.pdfHash, /^[0-9a-f]{64}$/);
});

test('own.captureSignature firma con evidencia completa y acuse (demo)', async () => {
  const doc = await pagare.ownProvider.createDocument(BASE_INPUT);
  const sig = await pagare.ownProvider.captureSignature({
    document: doc,
    consent: { accepted: true, text: 'Acepto y firmo.' },
    channel: 'web',
    ip: '190.0.0.1',
    userAgent: 'jest',
    signer: { nombre: 'Juan Pérez', documento: '123456789' }
  });
  assert.equal(sig.signed, true);
  assert.equal(sig.provider, 'own');
  assert.ok(sig.signatureId.startsWith('sig_'));
  assert.equal(pagare.evidenceIsComplete(sig.evidence), true);
  /* en demo (sin PAGARE_SIGN_SECRET) el acuse se sella con el secreto de dev */
  assert.equal(sig.acuseSealed, true);
  assert.equal(pagare.verifyEvidence(sig.evidence, sig.acuse), true);
});

test('own.captureSignature sin consentimiento NO firma y NO lanza', async () => {
  const doc = await pagare.ownProvider.createDocument(BASE_INPUT);
  const sig = await pagare.ownProvider.captureSignature({
    document: doc,
    consent: { accepted: false, text: '' },
    signer: { nombre: 'Juan Pérez', documento: '123456789' }
  });
  assert.equal(sig.signed, false);
  assert.equal(sig.reason, 'no-consent');
});

test('proveedor "external" sin credenciales devuelve mock, sin lanzar', async () => {
  delete process.env.PAGARE_PROVIDER_API_KEY;
  delete process.env.PAGARE_PROVIDER_URL;
  assert.equal(pagare.externalProvider.isConfigured(), false);
  const doc = await pagare.externalProvider.createDocument(BASE_INPUT);
  assert.equal(doc.isMock, true);
  const sig = await pagare.externalProvider.captureSignature({});
  assert.equal(sig.signed, false);
  assert.equal(sig.isMock, true);
});

/* ── flujo completo 'own' end-to-end (sin proveedor externo configurado) ───── */

test('flujo own end-to-end: crear → firmar → evidencia completa y acuse válido', async () => {
  const provider = pagare.getProvider(); /* 'own' por defecto */
  const doc = await provider.createDocument(BASE_INPUT);
  const sig = await provider.captureSignature({
    document: doc,
    consent: { accepted: true, text: 'Acepto y firmo el pagaré ante Hotel Estar.' },
    channel: 'web', ip: '190.0.0.1', userAgent: 'jest',
    signer: { nombre: 'Juan Pérez', documento: '123456789', email: 'juan@example.com' }
  });
  assert.equal(sig.signed, true);
  assert.equal(sig.evidence.documentHash, doc.documentHash);
  assert.ok(sig.evidence.consent.accepted);
  assert.ok(sig.evidence.timestamp);
  assert.equal(pagare.verifyEvidence(sig.evidence, sig.acuse), true);
});

/* ── DataCredito: interfaz gated (nunca envía) ─────────────────────────────── */

test('reportToDataCredito respeta el gate y nunca envía', async () => {
  const { _internal } = require('../../netlify/functions/pagare-sign');
  const off = await _internal.reportToDataCredito({ pagareId: 'X' }, { flag: async () => false });
  assert.equal(off.reported, false);
  assert.equal(off.reason, 'disabled');

  /* flag ON pero sin credenciales → mock, nunca reporta */
  delete process.env.DATACREDITO_API_URL;
  delete process.env.DATACREDITO_API_KEY;
  const on = await _internal.reportToDataCredito({ pagareId: 'X' }, { flag: async () => true });
  assert.equal(on.reported, false);
  assert.equal(on.isMock, true);
});
