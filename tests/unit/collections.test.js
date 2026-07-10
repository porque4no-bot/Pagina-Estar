/* Motor de cobranza — lógica PURA de _collections.js (convención #4: solo
 * determinismo, sin I/O). Verifica los invariantes de cumplimiento (conv. #13):
 *   - la mora NUNCA supera la usura (techo duro),
 *   - costos=0 ⇒ gastos 0,
 *   - los gastos ACUMULAN por número/tipo de gestiones efectuadas (no % del saldo),
 *   - el escalado respeta el tope de intentos, opt-out y horario. */

const test = require('node:test');
const assert = require('node:assert/strict');

const C = require('../../netlify/functions/_collections');

/* ─────────────────── Interés de mora: techo duro en usura ─────────────────── */

test('mora: la tasa pactada NUNCA se aplica por encima de la usura', () => {
  const usura = 0.026;      /* 2.6% mensual */
  const pactada = 0.05;     /* 5% mensual — por encima de la usura */
  const r = C.computeMoraInterest({ saldoVencido: 1000000, diasMora: 30, tasaUsuraMensual: usura, tasaPactadaMensual: pactada });
  assert.equal(r.tasaAplicadaMensual, usura, 'debe recortar a la usura');
  assert.equal(r.cappedAtUsura, true);

  /* El interés cobrado equivale al calculado con la usura, no con la pactada. */
  const conUsura = C.computeMoraInterest({ saldoVencido: 1000000, diasMora: 30, tasaUsuraMensual: usura, tasaPactadaMensual: usura });
  assert.equal(r.interes, conUsura.interes);

  /* Y es estrictamente menor que si se hubiera aplicado la pactada sin techo. */
  const sinTecho = Math.round(1000000 * (pactada / 30) * 30);
  assert.ok(r.interes < sinTecho);
});

test('mora: si la pactada es menor que la usura, se aplica la pactada', () => {
  const r = C.computeMoraInterest({ saldoVencido: 500000, diasMora: 15, tasaUsuraMensual: 0.03, tasaPactadaMensual: 0.02 });
  assert.equal(r.tasaAplicadaMensual, 0.02);
  assert.equal(r.cappedAtUsura, false);
  assert.equal(r.interes, Math.round(500000 * (0.02 / 30) * 15));
});

test('mora: sin techo de usura válido no cobra (política segura)', () => {
  const r = C.computeMoraInterest({ saldoVencido: 1000000, diasMora: 30, tasaPactadaMensual: 0.05 });
  assert.equal(r.tasaAplicadaMensual, 0);
  assert.equal(r.interes, 0);
});

test('mora: entradas inválidas devuelven 0 sin lanzar', () => {
  assert.equal(C.computeMoraInterest({ saldoVencido: 0, diasMora: 10, tasaUsuraMensual: 0.02, tasaPactadaMensual: 0.02 }).interes, 0);
  assert.equal(C.computeMoraInterest({ saldoVencido: 1000, diasMora: 0, tasaUsuraMensual: 0.02, tasaPactadaMensual: 0.02 }).interes, 0);
  assert.equal(C.computeMoraInterest({}).interes, 0);
});

test('effectiveMoraRate: min(pactada, usura) con techo duro', () => {
  assert.equal(C.effectiveMoraRate(0.05, 0.026), 0.026);
  assert.equal(C.effectiveMoraRate(0.01, 0.026), 0.01);
  assert.equal(C.effectiveMoraRate(-1, 0.026), 0);
  assert.equal(C.effectiveMoraRate(0.02, NaN), 0);
});

/* ─────────────────── Gastos de cobranza: acumulativo itemizado ─────────────────── */

test('gastos: costos=0 (default) ⇒ total 0 aunque haya muchas gestiones', () => {
  const gestiones = [{ tipo: 'whatsapp' }, { tipo: 'llamada' }, { tipo: 'carta' }];
  const r = C.computeCollectionFees(gestiones); /* sin costos → DEFAULT 0 */
  assert.equal(r.total, 0);
  assert.equal(r.count, 3);
});

test('gastos: ACUMULAN por número y por tipo de gestiones (no % del saldo)', () => {
  const costos = { whatsapp: 1000, llamada: 5000, carta: 8000 };
  const gestiones = [
    { tipo: 'whatsapp' }, { tipo: 'whatsapp' },  /* 2 × 1000 */
    { tipo: 'llamada' },                          /* 1 × 5000 */
    { tipo: 'carta' }                             /* 1 × 8000 */
  ];
  const r = C.computeCollectionFees(gestiones, costos);
  assert.equal(r.total, 1000 + 1000 + 5000 + 8000);
  assert.equal(r.count, 4);
  assert.equal(r.byTipo.whatsapp.count, 2);
  assert.equal(r.byTipo.whatsapp.subtotal, 2000);
  assert.equal(r.byTipo.llamada.subtotal, 5000);
  assert.equal(r.byTipo.carta.subtotal, 8000);

  /* Una gestión MÁS del mismo tipo suma otro costo fijo (monto acumulativo). */
  const r2 = C.computeCollectionFees([...gestiones, { tipo: 'whatsapp' }], costos);
  assert.equal(r2.total, r.total + 1000);
});

test('gastos: una gestión NO efectuada no se cobra', () => {
  const costos = { whatsapp: 1000, llamada: 5000 };
  const gestiones = [
    { tipo: 'whatsapp', efectuada: true },
    { tipo: 'llamada', efectuada: false }  /* no efectuada → no cobra */
  ];
  const r = C.computeCollectionFees(gestiones, costos);
  assert.equal(r.total, 1000);
  assert.equal(r.count, 1);
});

/* ─────────────────── Escalado por edad de mora + frenos ─────────────────── */

test('plan: deriva canal por edad de mora', () => {
  assert.equal(C.planForMora(0).canal, 'none');
  assert.equal(C.planForMora(5).canal, 'whatsapp');
  assert.equal(C.planForMora(20).canal, 'whatsapp');
  assert.equal(C.planForMora(45).canal, 'llamada');
  assert.equal(C.planForMora(75).canal, 'llamada');
  assert.equal(C.planForMora(120).canal, 'juridico');
});

test('escalado: respeta el TOPE de intentos', () => {
  const gestiones = [{ tipo: 'whatsapp' }, { tipo: 'whatsapp' }];
  const bajoTope = C.nextAction({ diasMora: 10, gestiones, maxIntentos: 3 });
  assert.equal(bajoTope.action, 'whatsapp');
  assert.equal(bajoTope.blocked, false);

  const enTope = C.nextAction({ diasMora: 10, gestiones, maxIntentos: 2 });
  assert.equal(enTope.action, 'none');
  assert.equal(enTope.blocked, true);
  assert.equal(enTope.reason, 'max-intentos');
});

test('escalado: opt-out bloquea toda gestión', () => {
  const r = C.nextAction({ diasMora: 45, gestiones: [], optOut: true });
  assert.equal(r.action, 'none');
  assert.equal(r.reason, 'opt-out');
});

test('escalado: fuera de horario bloquea el contacto', () => {
  const r = C.nextAction({ diasMora: 10, gestiones: [], withinHours: false });
  assert.equal(r.action, 'none');
  assert.equal(r.reason, 'fuera-horario');
});

test('escalado: al día no dispara ninguna gestión', () => {
  const r = C.nextAction({ diasMora: 0, gestiones: [] });
  assert.equal(r.action, 'none');
  assert.equal(r.reason, 'al-dia');
});

test('horario: dentro y fuera de la franja permitida (UTC-5)', () => {
  /* 2026-07-07 15:00Z = 10:00 hora Colombia (martes) → dentro (07–19). */
  assert.equal(C.withinAllowedHours(new Date('2026-07-07T15:00:00Z'), {}), true);
  /* 2026-07-07 01:00Z = 20:00 del lunes hora Colombia → fuera. */
  assert.equal(C.withinAllowedHours(new Date('2026-07-07T01:00:00Z'), {}), false);
  /* Domingo excluido por defecto: 2026-07-05 es domingo. */
  assert.equal(C.withinAllowedHours(new Date('2026-07-05T15:00:00Z'), {}), false);
});
