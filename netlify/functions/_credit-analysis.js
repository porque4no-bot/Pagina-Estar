/* _credit-analysis.js — Núcleo de análisis de crédito para el portal Estar.
 *
 * DOS RESPONSABILIDADES ESTRICTAMENTE SEPARADAS (convención #12):
 *
 *   1) extractCreditSignals(input, deps)  — I/O: llama a Claude (Anthropic SDK,
 *      tool_choice forzado) para EXTRAER señales de PDFs (extractos bancarios
 *      multi-banco + PDF DataCredito). La IA SOLO aporta señales; jamás decide.
 *      MOCK-SAFE: sin ANTHROPIC_API_KEY (o ante cualquier error) devuelve
 *      señales mock con { isMock:true } y NUNCA lanza.
 *
 *   2) evaluateCreditRecommendation(signals, opts) — PURA y determinista: la
 *      DECISIÓN (recomendación) vive EN CÓDIGO, no en el prompt. Devuelve una
 *      RECOMENDACIÓN ('aprobar' | 'requiere_codeudor' | 'rechazar') con
 *      justificación bilingüe y las señales normalizadas. La aprobación real la
 *      toma SIEMPRE un humano con permiso `credito.aprobar` — esto es solo un
 *      insumo, nunca una decisión automática (convención #12).
 *
 * Sin frameworks: node:crypto no hace falta aquí; el SDK se carga perezosamente
 * para que el módulo se pueda requerir en tests sin credenciales.
 */

const { getSync } = require('./_settings'); // modelo gestionable desde /admin → env → default

/* ── Configuración del extractor IA ─────────────────────────────────────── */

/* Extracción documental de estados financieros: tarea de alta exigencia, se
   privilegia calidad sobre latencia (no es un chat en tiempo real). Cambia el
   modelo desde /admin con CREDIT_AI_MODEL. */
const DEFAULT_MODEL = 'claude-opus-4-8';
const DEFAULT_MAX_TOKENS = 4000;
const DEFAULT_TIMEOUT_MS = 60000;

function aiConfig() {
  return {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: getSync('CREDIT_AI_MODEL', DEFAULT_MODEL),
    maxTokens: parseInt(process.env.CREDIT_AI_MAX_TOKENS, 10) || DEFAULT_MAX_TOKENS,
    requestTimeoutMs: parseInt(process.env.CREDIT_AI_TIMEOUT_MS, 10) || DEFAULT_TIMEOUT_MS
  };
}

function isEnabled() {
  return Boolean(aiConfig().apiKey);
}

let cachedClient = null;
function getClient() {
  if (cachedClient) return cachedClient;
  const Anthropic = require('@anthropic-ai/sdk');
  const { requestTimeoutMs } = aiConfig();
  cachedClient = new Anthropic({ timeout: requestTimeoutMs, maxRetries: 1 });
  return cachedClient;
}

/* La única herramienta: Claude DEBE reportar las señales por aquí (tool_choice
   forzado). El esquema es descriptivo pero la validación/normalización real la
   hace normalizeSignals — nunca confiamos ciegamente en la salida del modelo. */
const SIGNAL_TOOL = {
  name: 'report_credit_signals',
  description:
    'Reporta las señales numéricas extraídas de los documentos financieros del solicitante ' +
    '(extractos bancarios y reporte DataCredito). Extrae solo lo que puedas leer con confianza; ' +
    'deja en null cualquier campo que no aparezca en los documentos. NO tomes decisiones de crédito, ' +
    'solo reporta datos observados.',
  input_schema: {
    type: 'object',
    properties: {
      scoreCentral: { type: ['number', 'null'], description: 'Puntaje DataCredito/central de riesgo (rango típico 150–950). null si no aparece.' },
      moraActualDias: { type: ['number', 'null'], description: 'Máximo de días de mora ACTUAL entre las obligaciones vigentes. 0 si está al día.' },
      moraMaxHistoricaDias: { type: ['number', 'null'], description: 'Peor mora histórica reportada, en días.' },
      obligacionesEnMora: { type: ['number', 'null'], description: 'Cantidad de obligaciones actualmente en mora.' },
      castigos: { type: ['number', 'null'], description: 'Número de cuentas en cartera castigada / castigos reportados.' },
      reportesNegativos: { type: ['number', 'null'], description: 'Cantidad de reportes negativos vigentes.' },
      ingresoPromedioMensual: { type: ['number', 'null'], description: 'Ingreso/abono promedio mensual observado en los extractos (COP).' },
      egresoPromedioMensual: { type: ['number', 'null'], description: 'Egreso/débito promedio mensual observado (COP).' },
      saldoPromedioMensual: { type: ['number', 'null'], description: 'Saldo promedio mensual en las cuentas (COP).' },
      antiguedadBancariaMeses: { type: ['number', 'null'], description: 'Antigüedad de la relación bancaria en meses, si se puede inferir.' },
      cuotaEstimadaMensual: { type: ['number', 'null'], description: 'Suma de cuotas mensuales de obligaciones vigentes (COP), si aparece.' },
      observaciones: { type: ['string', 'null'], description: 'Notas breves de contexto (máx 500 caracteres). No es una decisión.' }
    },
    required: []
  }
};

const EXTRACTION_INSTRUCTION =
  'Eres un extractor de datos financieros. Analiza los documentos adjuntos (extractos bancarios ' +
  'de uno o varios bancos y/o un reporte DataCredito) y reporta ÚNICAMENTE las señales numéricas ' +
  'observadas mediante la herramienta report_credit_signals. No emitas juicios ni recomendaciones ' +
  'de crédito: solo datos. Si un dato no aparece con claridad, déjalo en null.';

/* Señales mock deterministas: perfil intermedio "razonable pero no verificado".
   Con isMock:true la evaluación pura degrada de forma conservadora a
   'requiere_codeudor' (nunca aprueba sola con datos no verificados). */
function mockSignals(extra) {
  return {
    scoreCentral: 680,
    moraActualDias: 0,
    moraMaxHistoricaDias: 20,
    obligacionesEnMora: 0,
    castigos: 0,
    reportesNegativos: 0,
    ingresoPromedioMensual: 3500000,
    egresoPromedioMensual: 2300000,
    saldoPromedioMensual: 900000,
    antiguedadBancariaMeses: 24,
    cuotaEstimadaMensual: null,
    observaciones: 'Señales simuladas (sin credenciales de IA).',
    isMock: true,
    ...(extra || {})
  };
}

/* extractCreditSignals({ documents, ... }, deps) -> señales (objeto plano).
   documents: [{ kind, base64, mediaType }]. NUNCA lanza: ante cualquier fallo
   (sin API key, error de red, respuesta inesperada) devuelve mockSignals. */
async function extractCreditSignals(input, deps = {}) {
  const documents = (input && input.documents) || [];
  if (!isEnabled()) {
    return mockSignals();
  }
  try {
    const cfg = aiConfig();
    const client = deps.anthropicClient || getClient();

    const content = [];
    for (const doc of documents) {
      if (!doc || !doc.base64) continue;
      content.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: doc.mediaType || 'application/pdf',
          data: String(doc.base64)
        }
      });
    }
    content.push({ type: 'text', text: EXTRACTION_INSTRUCTION });

    const response = await client.messages.create({
      model: cfg.model,
      max_tokens: cfg.maxTokens,
      tools: [SIGNAL_TOOL],
      tool_choice: { type: 'tool', name: SIGNAL_TOOL.name },
      messages: [{ role: 'user', content }]
    });

    const toolUse = (response.content || []).find(b => b.type === 'tool_use' && b.name === SIGNAL_TOOL.name);
    if (!toolUse || !toolUse.input || typeof toolUse.input !== 'object') {
      return mockSignals({ observaciones: 'La IA no devolvió señales; se usó respaldo.', extractionError: 'no_tool_use' });
    }
    return { ...toolUse.input, isMock: false };
  } catch (e) {
    console.error('[credit-analysis] extracción degradó a mock:', e.message);
    return mockSignals({ observaciones: 'Fallo de extracción; se usó respaldo.', extractionError: e.message });
  }
}

/* ── Motor de DECISIÓN (puro, determinista, en código) ──────────────────── */

/* Umbrales por defecto. Se pueden sobreescribir vía opts.thresholds (útil en
   tests y para ajuste de política sin tocar la lógica). Rango de score alineado
   con DataCredito (150–950). */
const DEFAULT_THRESHOLDS = {
  scoreAprobar: 700,             // score >= => elegible para aprobar
  scoreRechazar: 550,            // score <  => rechazo directo
  moraActualRechazarDias: 30,    // mora actual >= => rechazo
  moraHistoricaCodeudorDias: 60, // peor mora histórica > => exige codeudor
  capacidadMaxRatio: 0.5,        // cuota/ingreso > => rechazo (sobreendeudamiento)
  capacidadCodeudorRatio: 0.35,  // cuota/ingreso > (y <= max) => exige codeudor
  antiguedadMinMeses: 6          // antigüedad bancaria < => exige codeudor
};

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/* Normaliza señales crudas (de la IA o del formulario) a números seguros.
   scoreCentral se conserva como null cuando no hay dato (afecta la política). */
function normalizeSignals(raw) {
  const s = raw || {};
  const nonNeg = v => { const n = num(v); return n == null ? 0 : Math.max(0, n); };
  return {
    scoreCentral: num(s.scoreCentral),
    moraActualDias: nonNeg(s.moraActualDias),
    moraMaxHistoricaDias: nonNeg(s.moraMaxHistoricaDias),
    obligacionesEnMora: nonNeg(s.obligacionesEnMora),
    castigos: nonNeg(s.castigos),
    reportesNegativos: nonNeg(s.reportesNegativos),
    ingresoPromedioMensual: nonNeg(s.ingresoPromedioMensual),
    egresoPromedioMensual: nonNeg(s.egresoPromedioMensual),
    saldoPromedioMensual: nonNeg(s.saldoPromedioMensual),
    antiguedadBancariaMeses: num(s.antiguedadBancariaMeses),
    cuotaEstimadaMensual: num(s.cuotaEstimadaMensual),
    montoSolicitado: nonNeg(s.montoSolicitado),
    plazoMeses: nonNeg(s.plazoMeses),
    isMock: Boolean(s.isMock)
  };
}

/* Relación cuota/ingreso (capacidad de pago). Devuelve null si no hay datos
   suficientes para estimarla (ingreso desconocido o sin cuota/monto+plazo). */
function capacityRatio(s) {
  const ingreso = s.ingresoPromedioMensual;
  if (!(ingreso > 0)) return null;
  let cuota = s.cuotaEstimadaMensual;
  if (!(cuota > 0) && s.montoSolicitado > 0 && s.plazoMeses > 0) {
    cuota = s.montoSolicitado / s.plazoMeses; // estimación simple sin interés (piso)
  }
  if (!(cuota > 0)) return null;
  return cuota / ingreso;
}

const MOTIVO_LABELS = {
  cartera_castigada:    { es: 'reporta cartera castigada', en: 'has charged-off debt' },
  score_muy_bajo:       { es: 'puntaje de central por debajo del mínimo', en: 'credit score below minimum' },
  mora_actual_grave:    { es: 'mora actual significativa', en: 'significant current delinquency' },
  capacidad_insuficiente:{ es: 'la cuota supera la capacidad de pago', en: 'installment exceeds payment capacity' },
  score_intermedio:     { es: 'puntaje intermedio', en: 'mid-range credit score' },
  mora_actual_leve:     { es: 'mora actual leve', en: 'minor current delinquency' },
  mora_historica:       { es: 'mora histórica relevante', en: 'relevant historical delinquency' },
  capacidad_ajustada:   { es: 'capacidad de pago ajustada', en: 'tight payment capacity' },
  historial_corto:      { es: 'historial bancario corto', en: 'short banking history' },
  informacion_insuficiente:{ es: 'información insuficiente para verificar', en: 'insufficient data to verify' },
  senales_mock:         { es: 'señales sin verificación real (modo simulado)', en: 'unverified (mock) signals' },
  perfil_favorable:     { es: 'perfil crediticio favorable', en: 'favorable credit profile' }
};

const HEADLINE = {
  aprobar:           { es: 'Recomendación: APROBAR', en: 'Recommendation: APPROVE' },
  requiere_codeudor: { es: 'Recomendación: REQUIERE CODEUDOR', en: 'Recommendation: REQUIRES CO-SIGNER' },
  rechazar:          { es: 'Recomendación: RECHAZAR', en: 'Recommendation: DECLINE' }
};

/* evaluateCreditRecommendation(signals, opts) -> {
 *   recomendacion, justificacion:{es,en}, motivos:[codes], senales, esRecomendacion:true
 * }
 * PURA. La lógica (no la IA) decide. Nunca aprueba sola: es solo un insumo para
 * el humano con permiso credito.aprobar (convención #12).
 */
function evaluateCreditRecommendation(rawSignals, opts = {}) {
  const s = normalizeSignals(rawSignals);
  const t = { ...DEFAULT_THRESHOLDS, ...(opts.thresholds || {}) };
  const ratio = capacityRatio(s);

  const motivos = [];
  let nivel = 0; // 0 aprobar · 1 requiere_codeudor · 2 rechazar
  const bump = (target, code) => {
    if (target > nivel) nivel = target;
    if (!motivos.includes(code)) motivos.push(code);
  };

  // ── Rechazo directo (cualquiera) ──
  if (s.castigos > 0) bump(2, 'cartera_castigada');
  if (s.scoreCentral != null && s.scoreCentral < t.scoreRechazar) bump(2, 'score_muy_bajo');
  if (s.moraActualDias >= t.moraActualRechazarDias) bump(2, 'mora_actual_grave');
  if (ratio != null && ratio > t.capacidadMaxRatio) bump(2, 'capacidad_insuficiente');

  // ── Requiere codeudor (cualquiera, si no fue rechazado) ──
  if (s.scoreCentral != null && s.scoreCentral >= t.scoreRechazar && s.scoreCentral < t.scoreAprobar) {
    bump(1, 'score_intermedio');
  }
  if (s.moraActualDias > 0 && s.moraActualDias < t.moraActualRechazarDias) bump(1, 'mora_actual_leve');
  if (s.moraMaxHistoricaDias > t.moraHistoricaCodeudorDias) bump(1, 'mora_historica');
  if (ratio != null && ratio > t.capacidadCodeudorRatio && ratio <= t.capacidadMaxRatio) {
    bump(1, 'capacidad_ajustada');
  }
  if (s.antiguedadBancariaMeses != null && s.antiguedadBancariaMeses < t.antiguedadMinMeses) {
    bump(1, 'historial_corto');
  }
  // Datos insuficientes para verificar capacidad y score => conservador.
  if (s.scoreCentral == null && ratio == null) bump(1, 'informacion_insuficiente');
  // Señales simuladas (no verificadas) => nunca aprobar solo con mock.
  if (s.isMock) bump(1, 'senales_mock');

  const recomendacion = nivel === 2 ? 'rechazar' : nivel === 1 ? 'requiere_codeudor' : 'aprobar';
  if (recomendacion === 'aprobar' && motivos.length === 0) motivos.push('perfil_favorable');

  const reasonsEs = motivos.map(c => (MOTIVO_LABELS[c] || { es: c }).es);
  const reasonsEn = motivos.map(c => (MOTIVO_LABELS[c] || { en: c }).en);

  return {
    recomendacion,
    esRecomendacion: true, // NUNCA es una decisión automática (convención #12)
    justificacion: {
      es: `${HEADLINE[recomendacion].es}. Motivos: ${reasonsEs.join('; ')}. La decisión final la toma un asesor autorizado.`,
      en: `${HEADLINE[recomendacion].en}. Reasons: ${reasonsEn.join('; ')}. Final decision is made by an authorized officer.`
    },
    motivos,
    senales: { ...s, capacidadRatio: ratio }
  };
}

module.exports = {
  // decisión (pura)
  evaluateCreditRecommendation,
  normalizeSignals,
  capacityRatio,
  DEFAULT_THRESHOLDS,
  MOTIVO_LABELS,
  // extracción (I/O, mock-safe)
  extractCreditSignals,
  isEnabled,
  aiConfig,
  mockSignals,
  SIGNAL_TOOL
};
