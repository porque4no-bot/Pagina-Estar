const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseDocName,
  freshness,
  alertMessage,
  listDocs,
  yymmddToIso
} = require('../../netlify/functions/_legal-docs');

/* ---------- parseDocName sobre los 5 ejemplos reales ---------- */

test('parseDocName — RNT con número y fecha', () => {
  const d = parseDocName('260216 - RNT 276306 - MIRADA SAS.pdf');
  assert.equal(d.tipo, 'RNT');
  assert.equal(d.numero, '276306');
  assert.equal(d.empresa, 'MIRADA SAS');
  assert.equal(d.fechaEmision, '2026-02-16');
});

test('parseDocName — RUT sin número, con fecha', () => {
  const d = parseDocName('260216 - RUT - MIRADA SAS.pdf');
  assert.equal(d.tipo, 'RUT');
  assert.equal(d.numero, null);
  assert.equal(d.empresa, 'MIRADA SAS');
  assert.equal(d.fechaEmision, '2026-02-16');
});

test('parseDocName — CCM (Cámara de Comercio) con fecha', () => {
  const d = parseDocName('260701 - CCM - MIRADA SAS.pdf');
  assert.equal(d.tipo, 'CCM');
  assert.equal(d.numero, null);
  assert.equal(d.empresa, 'MIRADA SAS');
  assert.equal(d.fechaEmision, '2026-07-01');
});

test('parseDocName — CB Bancolombia sin fecha, con banco y cuenta', () => {
  const d = parseDocName('CB - CA 3504 BANCOLOMBIA - MIRADA SAS.pdf');
  assert.equal(d.tipo, 'CB');
  assert.equal(d.numero, 'CA 3504 BANCOLOMBIA');
  assert.equal(d.empresa, 'MIRADA SAS');
  assert.equal(d.fechaEmision, null);
});

test('parseDocName — CB Davivienda sin fecha, con banco y cuenta', () => {
  const d = parseDocName('CB - CA 1726 DAVIVIENDA - MIRADA SAS.pdf');
  assert.equal(d.tipo, 'CB');
  assert.equal(d.numero, 'CA 1726 DAVIVIENDA');
  assert.equal(d.empresa, 'MIRADA SAS');
  assert.equal(d.fechaEmision, null);
});

test('parseDocName — entrada vacía / basura no lanza', () => {
  const d = parseDocName('');
  assert.equal(d.tipo, null);
  assert.equal(d.fechaEmision, null);
  assert.equal(d.raw, '');
  assert.equal(parseDocName(null).tipo, null);
});

test('yymmddToIso rechaza fechas imposibles', () => {
  assert.equal(yymmddToIso('260216'), '2026-02-16');
  assert.equal(yymmddToIso('260230'), null); // 30 de febrero no existe
  assert.equal(yymmddToIso('261301'), null); // mes 13
  assert.equal(yymmddToIso('abc'), null);
});

/* ---------- freshness con today inyectado ---------- */

test('freshness — RUT siempre sin-vencimiento', () => {
  const f = freshness('RUT', '2020-01-01', '2026-07-01');
  assert.equal(f.estado, 'sin-vencimiento');
  assert.equal(f.umbralDias, null);
});

test('freshness — un RNT viejo (más de un año) queda vencido', () => {
  const f = freshness('RNT', '2024-01-01', '2026-07-01');
  assert.equal(f.estado, 'vencido');
  assert.equal(f.umbralDias, 365);
  assert.ok(f.diasDesdeEmision >= 365);
});

test('freshness — un RNT cercano al año queda por-vencer (>=330 y <365)', () => {
  const f = freshness('RNT', '2025-07-01', '2026-06-15'); // ~349 días
  assert.equal(f.estado, 'por-vencer');
  assert.ok(f.diasDesdeEmision >= 330 && f.diasDesdeEmision < 365);
});

test('freshness — un CCM reciente queda ok', () => {
  const f = freshness('CCM', '2026-06-25', '2026-07-01'); // 6 días
  assert.equal(f.estado, 'ok');
  assert.equal(f.umbralDias, 30);
  assert.equal(f.diasDesdeEmision, 6);
});

test('freshness — un CCM viejo (>30 días) queda vencido', () => {
  const f = freshness('CCM', '2026-05-01', '2026-07-01'); // 61 días
  assert.equal(f.estado, 'vencido');
});

test('freshness — CB sin fecha de emisión → sin-vencimiento (no se puede fechar)', () => {
  const f = freshness('CB', null, '2026-07-01');
  assert.equal(f.estado, 'sin-vencimiento');
  assert.equal(f.diasDesdeEmision, null);
  assert.equal(f.umbralDias, 30);
});

test('freshness — acepta Date inyectado como today', () => {
  const f = freshness('CCM', '2026-06-25', new Date('2026-07-01T12:00:00Z'));
  assert.equal(f.diasDesdeEmision, 6);
  assert.equal(f.estado, 'ok');
});

/* ---------- alertMessage: incluye días y contacto ---------- */

test('alertMessage incluye los días y el contacto inyectado', () => {
  const msg = alertMessage(
    { tipo: 'RNT', diasDesdeEmision: 400 },
    { contact: 'administracion@mirada.co' }
  );
  assert.match(msg, /400 días/);
  assert.match(msg, /administracion@mirada\.co/);
  assert.match(msg, /RNT/);
});

test('alertMessage cae al contacto por defecto sin config', () => {
  const prev = process.env.LEGAL_DOCS_REQUEST_CONTACT;
  delete process.env.LEGAL_DOCS_REQUEST_CONTACT;
  try {
    const msg = alertMessage({ tipo: 'CCM', diasDesdeEmision: 45 });
    assert.match(msg, /45 días/);
    assert.match(msg, /el área administrativa/);
  } finally {
    if (prev !== undefined) process.env.LEGAL_DOCS_REQUEST_CONTACT = prev;
  }
});

/* ---------- listDocs mock-safe (sin red) ---------- */

test('listDocs — flag apagado → mock, sin tocar Drive', async () => {
  let touched = false;
  const drive = { isConfigured: async () => { touched = true; return true; } };
  const r = await listDocs({
    flag: async () => false,
    get: async (k, fb) => fb,
    drive,
    today: '2026-07-01'
  });
  assert.equal(r.isMock, true);
  assert.deepEqual(r.docs, []);
  assert.equal(touched, false);
});

test('listDocs — flag on pero Drive no configurado → mock', async () => {
  const drive = { isConfigured: async () => false };
  const r = await listDocs({
    flag: async () => true,
    get: async (k, fb) => fb,
    drive
  });
  assert.equal(r.isMock, true);
  assert.deepEqual(r.docs, []);
});

test('listDocs — combina parse + freshness por documento (drive.listFiles inyectado)', async () => {
  const drive = {
    isConfigured: async () => true,
    listFiles: async (folderId) => {
      assert.equal(folderId, '1uo3ozZVsQN5xXqnziA4PXW7tr5ZNwcMQ'); // default
      return [
        { id: 'a', name: '260216 - RUT - MIRADA SAS.pdf' },
        { id: 'b', name: '240101 - RNT 276306 - MIRADA SAS.pdf' },
        { id: 'c', name: '260625 - CCM - MIRADA SAS.pdf' },
        { id: 'd', name: 'CB - CA 3504 BANCOLOMBIA - MIRADA SAS.pdf' }
      ];
    }
  };
  const r = await listDocs({
    flag: async () => true,
    get: async (k, fb) => fb,
    drive,
    today: '2026-07-01',
    contact: 'admin@mirada.co'
  });
  assert.equal(r.isMock, undefined);
  assert.equal(r.docs.length, 4);

  const byTipo = Object.fromEntries(r.docs.map(d => [d.tipo, d]));

  assert.equal(byTipo.RUT.estado, 'sin-vencimiento');
  assert.equal(byTipo.RUT.necesitaAviso, false);
  assert.equal(byTipo.RUT.alerta, null);

  assert.equal(byTipo.RNT.estado, 'vencido');
  assert.equal(byTipo.RNT.necesitaAviso, true);
  assert.match(byTipo.RNT.alerta, /admin@mirada\.co/);
  assert.match(byTipo.RNT.alerta, /días/);

  assert.equal(byTipo.CCM.estado, 'ok');
  assert.equal(byTipo.CCM.diasDesdeEmision, 6);

  assert.equal(byTipo.CB.estado, 'sin-vencimiento');
  assert.equal(byTipo.CB.numero, 'CA 3504 BANCOLOMBIA');
  assert.equal(byTipo.CB.fileId, 'd');
});

test('listDocs — un error del listado se traga y devuelve mock', async () => {
  const drive = {
    isConfigured: async () => true,
    listFiles: async () => { throw new Error('boom'); }
  };
  const r = await listDocs({ flag: async () => true, get: async (k, fb) => fb, drive });
  assert.equal(r.isMock, true);
  assert.deepEqual(r.docs, []);
});
