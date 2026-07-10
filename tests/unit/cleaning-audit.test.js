/* Control de aseo con IA: decisión híbrida, modo mock y persistencia.
 *
 * evaluateDecision es pura (se prueba directo). Para el store se reemplaza
 * @netlify/blobs por un store en memoria que respeta set/get/list({prefix}),
 * igual patrón que breakfast.test.js. auditPhoto sin ANTHROPIC_API_KEY debe
 * degradar a un veredicto mock (aprobada) sin llamar a la red. */

const test = require('node:test');
const assert = require('node:assert/strict');

// ── Mock de @netlify/blobs (store en memoria) ──
const blobsPath = require.resolve('@netlify/blobs');
const mem = new Map();
const memStore = {
  async set(key, val) { mem.set(key, val); return { modified: true }; },
  async get(key) { return mem.has(key) ? mem.get(key) : null; },
  async list(opts) {
    const prefix = (opts && opts.prefix) || '';
    return { blobs: [...mem.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) };
  }
};
require.cache[blobsPath] = { id: blobsPath, filename: blobsPath, loaded: true, exports: { getStore: () => memStore } };

const audit = require('../../netlify/functions/_cleaning-audit');
const store = require('../../netlify/functions/_cleaning-store');

test.beforeEach(() => { mem.clear(); });

// ── Decisión híbrida ──
test('foto mal tomada → rechazada (bloqueo duro)', () => {
  assert.equal(audit.evaluateDecision(
    { calidad_foto: 'mala', es_el_objeto: true, aseo_correcto: true, problemas: [], confianza: 0.9 }
  ), 'rechazada');
});

test('claramente no es el objeto (con confianza) → rechazada', () => {
  assert.equal(audit.evaluateDecision(
    { calidad_foto: 'buena', es_el_objeto: false, aseo_correcto: true, problemas: [], confianza: 0.8 }
  ), 'rechazada');
});

test('duda de que sea el objeto (baja confianza) → advertida, no bloquea', () => {
  assert.equal(audit.evaluateDecision(
    { calidad_foto: 'buena', es_el_objeto: false, aseo_correcto: true, problemas: [], confianza: 0.3 }
  ), 'advertida');
});

test('problemas de aseo → advertida (híbrido: no bloquea)', () => {
  assert.equal(audit.evaluateDecision(
    { calidad_foto: 'buena', es_el_objeto: true, aseo_correcto: false, problemas: ['almohada arrugada'], confianza: 0.9 }
  ), 'advertida');
});

test('todo en orden → aprobada', () => {
  assert.equal(audit.evaluateDecision(
    { calidad_foto: 'buena', es_el_objeto: true, aseo_correcto: true, problemas: [], confianza: 0.9 }
  ), 'aprobada');
});

// ── Modo mock sin credenciales ──
test('auditPhoto sin ANTHROPIC_API_KEY devuelve veredicto mock aprobado', async () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    assert.equal(audit.isEnabled(), false);
    const v = await audit.auditPhoto(audit.CHECKLIST[0], { mediaType: 'image/jpeg', base64: 'AAAA' });
    assert.equal(v.mock, true);
    assert.equal(audit.evaluateDecision(v), 'aprobada');
  } finally {
    if (prev) process.env.ANTHROPIC_API_KEY = prev;
  }
});

// ── Checklist ──
test('la lista de chequeo expone ítems con id/label/hint únicos', () => {
  const ids = audit.CHECKLIST.map(i => i.id);
  assert.ok(ids.includes('cama'));
  assert.equal(new Set(ids).size, ids.length, 'ids duplicados');
  for (const i of audit.CHECKLIST) {
    assert.ok(i.label && i.subject && Array.isArray(i.criteria) && i.criteria.length);
  }
});

test('getChecklistItem resuelve por id y devuelve null si no existe', () => {
  assert.equal(audit.getChecklistItem('cama').label, 'Cama tendida');
  assert.equal(audit.getChecklistItem('inexistente'), null);
});

// ── Persistencia ──
test('apartmentSlug normaliza tildes, espacios y símbolos', () => {
  assert.equal(store.apartmentSlug('Clásica 2'), 'clasica-2');
  assert.equal(store.apartmentSlug('  #101 '), '101');
  assert.equal(store.apartmentSlug(''), 'apto');
});

test('saveAudit persiste y getApartmentAudits recupera por apartamento/día', async () => {
  const date = '2026-07-07';
  const slug = store.apartmentSlug('101');
  await store.saveAudit({ apartment: '101', apartmentSlug: slug, item: 'cama', itemLabel: 'Cama tendida', date, decision: 'aprobada', verdict: { problemas: [] } });
  await store.saveAudit({ apartment: '101', apartmentSlug: slug, item: 'bano', itemLabel: 'Baño', date, decision: 'advertida', verdict: { problemas: ['espejo con marcas'] } });
  // Otro día no debe aparecer.
  await store.saveAudit({ apartment: '101', apartmentSlug: slug, item: 'cama', itemLabel: 'Cama tendida', date: '2026-07-06', decision: 'aprobada', verdict: {} });

  const today = await store.getApartmentAudits(slug, date);
  assert.equal(today.length, 2);
  const byItem = Object.fromEntries(today.map(r => [r.item, r]));
  assert.equal(byItem.cama.decision, 'aprobada');
  assert.equal(byItem.bano.decision, 'advertida');
  assert.ok(byItem.cama.auditedAt, 'debe sellar auditedAt');
});

test('saveAudit sobrescribe la misma (apartamento, ítem, día)', async () => {
  const date = '2026-07-07';
  const slug = store.apartmentSlug('202');
  await store.saveAudit({ apartment: '202', apartmentSlug: slug, item: 'cama', date, decision: 'advertida', verdict: {} });
  await store.saveAudit({ apartment: '202', apartmentSlug: slug, item: 'cama', date, decision: 'aprobada', verdict: {} });
  const rows = await store.getApartmentAudits(slug, date);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].decision, 'aprobada');
});
