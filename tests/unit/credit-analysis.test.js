/* Núcleo de crédito: la DECISIÓN vive en código (pura y determinista) y la IA
 * solo aporta señales. Verifica gating de la política, degradación mock-safe sin
 * API key, y que jamás se apruebe con señales no verificadas. NO toca red ni
 * Blobs (convención #4). */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateCreditRecommendation,
  extractCreditSignals,
  capacityRatio,
  normalizeSignals
} = require('../../netlify/functions/_credit-analysis');

/* Perfil sólido, señales verificadas (isMock:false). */
function strongSignals(extra) {
  return {
    scoreCentral: 780,
    moraActualDias: 0,
    moraMaxHistoricaDias: 5,
    castigos: 0,
    reportesNegativos: 0,
    ingresoPromedioMensual: 5000000,
    antiguedadBancariaMeses: 36,
    montoSolicitado: 3000000,
    plazoMeses: 12,
    isMock: false,
    ...(extra || {})
  };
}

/* ── DECISIÓN pura y determinista ─────────────────────────────────────── */

test('perfil sólido verificado → aprobar', () => {
  const r = evaluateCreditRecommendation(strongSignals());
  assert.equal(r.recomendacion, 'aprobar');
  assert.equal(r.esRecomendacion, true); // nunca decisión automática
  assert.ok(r.justificacion.es && r.justificacion.en); // justificación bilingüe
});

test('score por debajo del piso → rechazar', () => {
  const r = evaluateCreditRecommendation(strongSignals({ scoreCentral: 500 }));
  assert.equal(r.recomendacion, 'rechazar');
  assert.ok(r.motivos.includes('score_muy_bajo'));
});

test('score intermedio → requiere_codeudor', () => {
  const r = evaluateCreditRecommendation(strongSignals({ scoreCentral: 620 }));
  assert.equal(r.recomendacion, 'requiere_codeudor');
  assert.ok(r.motivos.includes('score_intermedio'));
});

test('mora actual grave → rechazar', () => {
  const r = evaluateCreditRecommendation(strongSignals({ moraActualDias: 45 }));
  assert.equal(r.recomendacion, 'rechazar');
  assert.ok(r.motivos.includes('mora_actual_grave'));
});

test('mora actual leve → requiere_codeudor', () => {
  const r = evaluateCreditRecommendation(strongSignals({ moraActualDias: 10 }));
  assert.equal(r.recomendacion, 'requiere_codeudor');
  assert.ok(r.motivos.includes('mora_actual_leve'));
});

test('cartera castigada → rechazar (aunque el score sea alto)', () => {
  const r = evaluateCreditRecommendation(strongSignals({ castigos: 1 }));
  assert.equal(r.recomendacion, 'rechazar');
  assert.ok(r.motivos.includes('cartera_castigada'));
});

test('cuota que supera la capacidad de pago → rechazar', () => {
  const r = evaluateCreditRecommendation(strongSignals({
    ingresoPromedioMensual: 1000000,
    montoSolicitado: 12000000,
    plazoMeses: 12 // cuota 1.000.000 → ratio 1.0 > 0.5
  }));
  assert.equal(r.recomendacion, 'rechazar');
  assert.ok(r.motivos.includes('capacidad_insuficiente'));
});

test('capacidad ajustada (entre umbrales) → requiere_codeudor', () => {
  const r = evaluateCreditRecommendation(strongSignals({
    ingresoPromedioMensual: 2000000,
    montoSolicitado: 10000000,
    plazoMeses: 12 // cuota ~833k → ratio ~0.42 (>0.35, <=0.5)
  }));
  assert.equal(r.recomendacion, 'requiere_codeudor');
  assert.ok(r.motivos.includes('capacidad_ajustada'));
});

test('el rechazo manda sobre el codeudor (nivel más alto gana)', () => {
  const r = evaluateCreditRecommendation(strongSignals({ scoreCentral: 620, moraActualDias: 60 }));
  assert.equal(r.recomendacion, 'rechazar');
});

test('información insuficiente (sin score ni capacidad) → requiere_codeudor', () => {
  const r = evaluateCreditRecommendation({
    scoreCentral: null,
    ingresoPromedioMensual: 0,
    montoSolicitado: 0,
    plazoMeses: 0,
    isMock: false
  });
  assert.equal(r.recomendacion, 'requiere_codeudor');
  assert.ok(r.motivos.includes('informacion_insuficiente'));
});

test('señales mock nunca aprueban solas (degradación conservadora)', () => {
  const r = evaluateCreditRecommendation(strongSignals({ isMock: true }));
  assert.equal(r.recomendacion, 'requiere_codeudor');
  assert.ok(r.motivos.includes('senales_mock'));
});

test('umbrales configurables vía opts.thresholds', () => {
  const base = strongSignals({ scoreCentral: 720 });
  assert.equal(evaluateCreditRecommendation(base).recomendacion, 'aprobar');
  const stricter = evaluateCreditRecommendation(base, { thresholds: { scoreAprobar: 750 } });
  assert.equal(stricter.recomendacion, 'requiere_codeudor');
});

test('historial bancario corto → requiere_codeudor (rama antiguedadMinMeses)', () => {
  // Perfil por lo demás sólido: solo la antigüedad (<6 meses) debe exigir codeudor.
  const r = evaluateCreditRecommendation(strongSignals({ antiguedadBancariaMeses: 3 }));
  assert.equal(r.recomendacion, 'requiere_codeudor');
  assert.ok(r.motivos.includes('historial_corto'));
});

test('mora histórica relevante → requiere_codeudor (rama moraHistoricaCodeudorDias)', () => {
  // Al día hoy, pero peor mora histórica >60 días: exige codeudor, no rechazo.
  const r = evaluateCreditRecommendation(strongSignals({ moraMaxHistoricaDias: 90 }));
  assert.equal(r.recomendacion, 'requiere_codeudor');
  assert.ok(r.motivos.includes('mora_historica'));
});

/* ── Bordes exactos de los umbrales (comparaciones >=, <): un off-by-one debe
   fallar aquí, no filtrarse a producción. ─────────────────────────────────── */

test('score borde: 700 aprueba, 550 exige codeudor, 549 rechaza', () => {
  // scoreAprobar=700 (>=), scoreRechazar=550 (<).
  const aprueba = evaluateCreditRecommendation(strongSignals({ scoreCentral: 700 }));
  assert.equal(aprueba.recomendacion, 'aprobar');

  const codeudor = evaluateCreditRecommendation(strongSignals({ scoreCentral: 550 }));
  assert.equal(codeudor.recomendacion, 'requiere_codeudor');
  assert.ok(codeudor.motivos.includes('score_intermedio'));

  const rechaza = evaluateCreditRecommendation(strongSignals({ scoreCentral: 549 }));
  assert.equal(rechaza.recomendacion, 'rechazar');
  assert.ok(rechaza.motivos.includes('score_muy_bajo'));
});

test('mora actual borde: 30 días rechaza, 29 días exige codeudor', () => {
  // moraActualRechazarDias=30 (>=).
  const rechaza = evaluateCreditRecommendation(strongSignals({ moraActualDias: 30 }));
  assert.equal(rechaza.recomendacion, 'rechazar');
  assert.ok(rechaza.motivos.includes('mora_actual_grave'));

  const codeudor = evaluateCreditRecommendation(strongSignals({ moraActualDias: 29 }));
  assert.equal(codeudor.recomendacion, 'requiere_codeudor');
  assert.ok(codeudor.motivos.includes('mora_actual_leve'));
});

test('reportesNegativos y obligacionesEnMora se extraen pero NO alteran la recomendación', () => {
  // El esquema captura estas señales, pero el motor de decisión no las lee hoy:
  // un perfil sólido con ambas > 0 sigue siendo 'aprobar'. Documenta el contrato
  // vigente para que un cambio de política que empiece a usarlas rompa este test.
  const r = evaluateCreditRecommendation(strongSignals({ reportesNegativos: 5, obligacionesEnMora: 3 }));
  assert.equal(r.recomendacion, 'aprobar');
  assert.ok(!r.motivos.includes('reportes_negativos'));
});

/* ── Helpers puros ─────────────────────────────────────────────────────── */

test('capacityRatio devuelve null sin ingreso o sin cuota estimable', () => {
  assert.equal(capacityRatio(normalizeSignals({ ingresoPromedioMensual: 0 })), null);
  assert.equal(capacityRatio(normalizeSignals({ ingresoPromedioMensual: 1000000, montoSolicitado: 0, plazoMeses: 0 })), null);
  const ratio = capacityRatio(normalizeSignals({ ingresoPromedioMensual: 1000000, cuotaEstimadaMensual: 300000 }));
  assert.equal(ratio, 0.3);
});

test('normalizeSignals aplica pisos no-negativos y conserva score null', () => {
  const s = normalizeSignals({ scoreCentral: undefined, moraActualDias: -5, ingresoPromedioMensual: '2000000' });
  assert.equal(s.scoreCentral, null);
  assert.equal(s.moraActualDias, 0);
  assert.equal(s.ingresoPromedioMensual, 2000000);
});

/* ── Extracción IA: mock-safe ──────────────────────────────────────────── */

test('sin ANTHROPIC_API_KEY, extractCreditSignals degrada a mock sin lanzar', async () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const signals = await extractCreditSignals({ documents: [{ kind: 'datacredito', base64: 'AAAA' }] });
    assert.equal(signals.isMock, true);
    // Y la decisión sobre señales mock nunca aprueba sola:
    assert.equal(evaluateCreditRecommendation(signals).recomendacion, 'requiere_codeudor');
  } finally {
    if (prev === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prev;
  }
});

test('con API key + cliente inyectado, extrae señales reales (isMock:false)', async () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  const fakeClient = {
    messages: {
      create: async () => ({
        content: [{ type: 'tool_use', name: 'report_credit_signals', input: { scoreCentral: 810, moraActualDias: 0 } }]
      })
    }
  };
  try {
    const signals = await extractCreditSignals(
      { documents: [{ kind: 'extracto', base64: 'AAAA' }] },
      { anthropicClient: fakeClient }
    );
    assert.equal(signals.isMock, false);
    assert.equal(signals.scoreCentral, 810);
  } finally {
    if (prev === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prev;
  }
});

test('con API key pero cliente que falla, degrada a mock sin lanzar', async () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  const boom = { messages: { create: async () => { throw new Error('network'); } } };
  try {
    const signals = await extractCreditSignals(
      { documents: [{ kind: 'extracto', base64: 'AAAA' }] },
      { anthropicClient: boom }
    );
    assert.equal(signals.isMock, true);
  } finally {
    if (prev === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prev;
  }
});
