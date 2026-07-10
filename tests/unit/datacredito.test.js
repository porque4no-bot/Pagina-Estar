/* _datacredito.js — Integración DataCrédito v1 MANUAL (gated OFF por defecto).
 *
 * Se prueba SOLO lógica pura/determinista con dependencias inyectadas (flag,
 * enqueue, store, vault). Nada de red ni Blobs reales (convención #4). Cubre:
 *   - GATING: con DATACREDITO_ENABLED OFF ninguna función ejecuta su efecto.
 *   - reportObligation: v1 NUNCA reporta sola; solo deja tarea de cargue manual.
 *   - ingestManualReport: registro de metadatos + cifrado en reposo de la PII.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const dc = require('../../netlify/functions/_datacredito');
const vault = require('../../netlify/functions/_crypto-vault');

/* Store Blobs falso en memoria (mismo contrato get/set que Netlify Blobs). */
function makeStore() {
  const m = new Map();
  return {
    store: {
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async set(k, v) { m.set(k, v); return { modified: true }; }
    },
    map: m
  };
}

const flagOn = async () => true;
const flagOff = async () => false;

/* ── GATING ─────────────────────────────────────────────────────────────── */

test('GATING: reportObligation con flag OFF no reporta ni encola', async () => {
  let enqueued = 0;
  const enqueue = async () => { enqueued += 1; return { queued: true, id: 'x' }; };

  const res = await dc.reportObligation('PAGARE-1', { tipo: 'mora', monto: 500000 }, { flag: flagOff, enqueue });

  assert.equal(res.reported, false);
  assert.equal(res.enabled, false);
  assert.equal(res.queued, false);
  assert.equal(res.reason, 'disabled');
  assert.equal(enqueued, 0, 'no debe encolar ninguna tarea con el flag OFF');
});

test('GATING: ingestManualReport con flag OFF no persiste nada', async () => {
  const s = makeStore();
  const res = await dc.ingestManualReport(Buffer.from('%PDF-1.4 fake'), { pagareRef: 'PAGARE-1' }, {
    flag: flagOff,
    getStore: () => s.store
  });

  assert.equal(res.stored, false);
  assert.equal(res.enabled, false);
  assert.equal(res.reason, 'disabled');
  assert.equal(s.map.size, 0, 'no debe escribir en el store con el flag OFF');
});

/* ── reportObligation: v1 manual (nunca reporta sola) ───────────────────── */

test('reportObligation encendido deja tarea de cargue MANUAL y nunca reporta', async () => {
  const captured = [];
  const enqueue = async (task) => { captured.push(task); return { queued: true, id: 'ops-1' }; };

  const res = await dc.reportObligation('PAGARE-9', { tipo: 'mora', monto: 750000, titular: 'Ana' }, {
    flag: flagOn,
    enqueue
  });

  assert.equal(res.reported, false, 'v1 nunca reporta sola (lo hace un humano)');
  assert.equal(res.enabled, true);
  assert.equal(res.manual, true);
  assert.equal(res.queued, true);
  assert.equal(res.taskId, 'ops-1');

  assert.equal(captured.length, 1);
  const task = captured[0];
  assert.equal(task.kind, 'datacredito_manual_report');
  assert.equal(task.dedupeKey, 'datacredito:PAGARE-9:mora');
  assert.equal(task.context.avisoPrevioRequerido, true, 'Ley 1266: aviso previo marcado');
  assert.equal(task.context.pagareRef, 'PAGARE-9');
  assert.equal(task.context.canal, 'manual');
});

test('reportObligation nunca lanza aunque enqueue falle', async () => {
  const enqueue = async () => { throw new Error('boom'); };
  const res = await dc.reportObligation('PAGARE-X', {}, { flag: flagOn, enqueue });
  assert.equal(res.reported, false);
  assert.equal(res.queued, false);
  assert.equal(res.reason, 'error');
});

/* ── ingestManualReport: metadatos + cifrado en reposo ──────────────────── */

test('ingestManualReport registra metadatos y CIFRA la PII y el PDF en reposo', async () => {
  process.env.GUEST_APP_DATA_ENCRYPTION_KEY = 'clave-de-prueba-datacredito-1234567890';
  const s = makeStore();
  const pdf = Buffer.from('%PDF-1.4 reporte datacredito de prueba');

  const res = await dc.ingestManualReport(pdf, {
    pagareRef: 'PAGARE-77',
    bookingCode: 'BK-77',
    titular: 'Juan Pérez',
    documentoTitular: 'CC 123',
    tipoReporte: 'positivo',
    consentimiento: { aceptado: true, canal: 'web' }
  }, { flag: flagOn, getStore: () => s.store });

  try {
    assert.equal(res.stored, true);
    assert.equal(res.enabled, true);
    assert.equal(res.encrypted, true);
    assert.ok(res.reportId && res.reportId.startsWith('DC-'));

    // Se persistió una clave report/<id>
    const raw = s.map.get(`report/${res.reportId}`);
    assert.ok(raw, 'debe existir el blob persistido');
    const record = JSON.parse(raw);

    // Metadatos no sensibles en claro:
    assert.equal(record.pagareRef, 'PAGARE-77');
    assert.equal(record.bookingCode, 'BK-77');
    assert.equal(record.tipoReporte, 'positivo');
    assert.equal(record.origen, 'manual');
    assert.equal(record.estado, 'registrado_para_analisis');
    assert.equal(record.resumen.encrypted, true);

    // PII NO en claro: no aparece el nombre del titular en el JSON serializado.
    assert.ok(!raw.includes('Juan Pérez'), 'la PII no debe quedar en claro');

    // El PDF quedó como sobre cifrado (ct/tag/iv), no como bytes en claro.
    assert.ok(record.document && record.document.envelope, 'el PDF debe guardarse cifrado');
    assert.ok(!record.document.base64, 'el PDF no debe guardarse en claro');
    assert.equal(record.document.size, pdf.length);

    // Round-trip: el sobre confidencial se puede abrir con la misma AAD.
    const meta = vault.openJSON(record.confidential, `${res.reportId}|datacredito-meta`);
    assert.equal(meta.titular, 'Juan Pérez');
    assert.equal(meta.documentoTitular, 'CC 123');

    // Y el PDF cifrado se recupera intacto con su AAD.
    const back = vault.open(record.document.envelope, `${res.reportId}|datacredito-report`);
    assert.equal(back.toString('utf8'), pdf.toString('utf8'));
  } finally {
    delete process.env.GUEST_APP_DATA_ENCRYPTION_KEY;
  }
});

test('ingestManualReport SIN cifrado no guarda PII ni el PDF en claro (mock-safe)', async () => {
  const prev = process.env.GUEST_APP_DATA_ENCRYPTION_KEY;
  delete process.env.GUEST_APP_DATA_ENCRYPTION_KEY;
  const s = makeStore();

  const res = await dc.ingestManualReport(Buffer.from('%PDF datos'), {
    pagareRef: 'PAGARE-2',
    titular: 'Confidencial',
    tipoReporte: 'mora'
  }, { flag: flagOn, getStore: () => s.store });

  try {
    assert.equal(res.stored, true);
    assert.equal(res.encrypted, false);
    const record = JSON.parse(s.map.get(`report/${res.reportId}`));
    // Metadatos no sensibles sí quedan; el bloque confidencial NO.
    assert.equal(record.pagareRef, 'PAGARE-2');
    assert.equal(record.tipoReporte, 'mora');
    assert.equal(record.confidential, null);
    assert.equal(record.document.omitted, true);
    assert.equal(record.document.reason, 'no-encryption');
    assert.ok(!s.map.get(`report/${res.reportId}`).includes('Confidencial'));
  } finally {
    if (prev !== undefined) process.env.GUEST_APP_DATA_ENCRYPTION_KEY = prev;
  }
});

test('ingestManualReport nunca lanza y degrada sin store', async () => {
  const res = await dc.ingestManualReport(null, { pagareRef: 'P' }, { flag: flagOn, getStore: () => null });
  assert.equal(res.stored, false);
  assert.equal(res.reason, 'no-store');
  assert.equal(res.enabled, true);
});
