require('./_env');

/*
 * _collections.js — MATEMÁTICAS PURAS del motor de cobranza (Ley 1266 + reglas del repo).
 *
 * Este módulo NO hace I/O ni envía nada: solo cálculo determinista y testeable
 * con node:test. La orquestación (envíos, Blobs, autorización, gating) vive en
 * collections-run.js. La feature completa está GATED OFF por COLLECTIONS_ENABLED.
 *
 * Principios de cumplimiento cableados aquí (convención #13 del repo):
 *   1. INTERÉS DE MORA con TECHO DURO en la tasa de usura vigente. La tasa pactada
 *      NUNCA se aplica por encima de la usura; si la supera, se recorta a usura.
 *      La usura se lee de config y se pasa como parámetro; este módulo solo la
 *      respeta, jamás la inventa.
 *   2. GASTOS DE COBRANZA = MONTO ACUMULATIVO por gestión REALMENTE efectuada.
 *      Cada WhatsApp / llamada / carta suma su COSTO FIJO configurado (default 0),
 *      itemizado. NO es un porcentaje del saldo. Una gestión no efectuada no cobra.
 *   3. Plan de escalado derivado por EDAD DE MORA (días), con tope de intentos y
 *      opt-out respetados antes de habilitar cualquier acción.
 */

/* ─────────────────────────── Interés de mora ─────────────────────────── */

/* Tasa mensual EFECTIVA a aplicar: min(pactada, usura). Techo duro en usura.
   - Si la usura no es un número finito >= 0, NO hay techo confiable → se devuelve 0
     (política segura: nunca cobrar mora sin un techo de usura válido).
   - Si la pactada es inválida/negativa → 0.
   Tasas expresadas como fracción mensual decimal (ej. 0.0234 = 2.34% mensual). */
function effectiveMoraRate(tasaPactadaMensual, tasaUsuraMensual) {
  const usura = Number(tasaUsuraMensual);
  const pactada = Number(tasaPactadaMensual);
  const validUsura = Number.isFinite(usura) && usura >= 0;
  if (!validUsura) return 0;
  if (!Number.isFinite(pactada) || pactada < 0) return 0;
  return Math.min(pactada, usura);
}

/* computeMoraInterest({ saldoVencido, diasMora, tasaUsuraMensual, tasaPactadaMensual })
   → { interes, saldoVencido, diasMora, tasaAplicadaMensual, tasaPactadaMensual,
       tasaUsuraMensual, cappedAtUsura }
   El interés es proporcional a los días de mora (tasa mensual / 30 por día).
   Devuelve 0 sin lanzar ante entradas inválidas (saldo/días <= 0). */
function computeMoraInterest({ saldoVencido, diasMora, tasaUsuraMensual, tasaPactadaMensual } = {}) {
  const saldo = Number(saldoVencido);
  const dias = Number(diasMora);
  const usura = Number(tasaUsuraMensual);
  const pactada = Number(tasaPactadaMensual);

  const rate = effectiveMoraRate(tasaPactadaMensual, tasaUsuraMensual);
  const cappedAtUsura =
    Number.isFinite(usura) && usura >= 0 &&
    Number.isFinite(pactada) && pactada > usura;

  const base = {
    saldoVencido: saldo > 0 ? saldo : 0,
    diasMora: dias > 0 ? dias : 0,
    tasaAplicadaMensual: rate,
    tasaPactadaMensual: Number.isFinite(pactada) ? pactada : 0,
    tasaUsuraMensual: Number.isFinite(usura) ? usura : 0,
    cappedAtUsura
  };

  if (!(saldo > 0) || !(dias > 0) || !(rate > 0)) {
    return { ...base, interes: 0 };
  }

  const dailyRate = rate / 30;
  const interes = Math.round(saldo * dailyRate * dias);
  return { ...base, interes };
}

/* ─────────────────────────── Gastos de cobranza ─────────────────────────── */

/* Costos fijos por tipo de gestión (COP). DEFAULT 0 en TODO (convención #13:
   el costo por defecto es 0; solo cobra lo que esté explícitamente configurado). */
const DEFAULT_COSTOS = { whatsapp: 0, llamada: 0, carta: 0 };

function costoDeGestion(tipo, costos) {
  const c = costos && Object.prototype.hasOwnProperty.call(costos, tipo) ? Number(costos[tipo]) : 0;
  return Number.isFinite(c) && c > 0 ? c : 0;
}

/* computeCollectionFees(gestiones, costos)
   gestiones: Array<{ tipo:'whatsapp'|'llamada'|'carta', efectuada?:boolean, at?, ref? }>
   costos:    { whatsapp?, llamada?, carta? } costo fijo COP por tipo (DEFAULT 0).

   Devuelve el MONTO ACUMULADO sumando el costo fijo de CADA gestión efectuada,
   itemizado y agrupado por tipo. NO es un % del saldo. Una gestión con
   efectuada===false NO se cobra (solo se cobra la gestión realmente realizada).

   → { total, count, items:[{tipo,costo,at?,ref?}], byTipo:{ tipo:{count,subtotal} } } */
function computeCollectionFees(gestiones, costos) {
  const c = { ...DEFAULT_COSTOS, ...(costos || {}) };
  const items = [];
  const byTipo = {};
  for (const g of Array.isArray(gestiones) ? gestiones : []) {
    if (!g || !g.tipo) continue;
    if (g.efectuada === false) continue; /* solo gestiones efectuadas cobran */
    const tipo = String(g.tipo);
    const costo = costoDeGestion(tipo, c);
    const item = { tipo, costo };
    if (g.at) item.at = g.at;
    if (g.ref) item.ref = g.ref;
    items.push(item);
    if (!byTipo[tipo]) byTipo[tipo] = { count: 0, subtotal: 0 };
    byTipo[tipo].count += 1;
    byTipo[tipo].subtotal += costo;
  }
  const total = items.reduce((s, it) => s + it.costo, 0);
  return { total, count: items.length, items, byTipo };
}

/* ─────────────────────────── Plan de escalado ─────────────────────────── */

/* Tramos por edad de mora (días). canal: 'none' | 'whatsapp' | 'llamada' | 'juridico'.
   Se recorre en orden y se aplica el PRIMER tramo cuyo maxDias >= diasMora.
   Editable pasando `tiers` propio (leído de config por el orquestador). */
const DEFAULT_TIERS = [
  { maxDias: 0,        etapa: 'al-dia',              canal: 'none' },
  { maxDias: 15,       etapa: 'recordatorio',        canal: 'whatsapp' },
  { maxDias: 30,       etapa: 'aviso',               canal: 'whatsapp' },
  { maxDias: 60,       etapa: 'gestion-telefonica',  canal: 'llamada' },
  { maxDias: 90,       etapa: 'prejuridico',         canal: 'llamada' },
  { maxDias: Infinity, etapa: 'juridico',            canal: 'juridico' }
];

function planForMora(diasMora, tiers) {
  const list = Array.isArray(tiers) && tiers.length ? tiers : DEFAULT_TIERS;
  const d = Number(diasMora) > 0 ? Number(diasMora) : 0;
  for (const t of list) {
    if (d <= t.maxDias) return { etapa: t.etapa, canal: t.canal, maxDias: t.maxDias, diasMora: d };
  }
  const last = list[list.length - 1];
  return { etapa: last.etapa, canal: last.canal, maxDias: last.maxDias, diasMora: d };
}

/* Cuenta las gestiones de contacto efectuadas (para el tope de intentos). */
function countContactAttempts(gestiones) {
  return (Array.isArray(gestiones) ? gestiones : []).filter(g => g && g.efectuada !== false).length;
}

/* ¿La hora `date` cae dentro de la franja horaria permitida de cobranza?
   Colombia = UTC-5 sin horario de verano → offsetMinutes default -300.
   Por defecto lun-sáb 07:00–19:00 (hora local). Config para ajustar a norma. */
function withinAllowedHours(date, opts = {}) {
  const { startHour = 7, endHour = 19, offsetMinutes = -300, days = [1, 2, 3, 4, 5, 6] } = opts;
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return false;
  const local = new Date(d.getTime() + offsetMinutes * 60000);
  const dow = local.getUTCDay(); /* 0=domingo … 6=sábado */
  if (Array.isArray(days) && days.length && !days.includes(dow)) return false;
  const h = local.getUTCHours();
  return h >= startHour && h < endHour;
}

/* nextAction — decide la SIGUIENTE gestión respetando TODOS los frenos legales.
   { diasMora, gestiones, maxIntentos, optOut, withinHours, tiers }
   → { action, etapa, canal, blocked, reason, intentos, maxIntentos }
   action: 'none' | 'whatsapp' | 'llamada' | 'escalar-juridico'.
   Orden de frenos: opt-out → al día → tope de intentos → fuera de horario. */
function nextAction({ diasMora, gestiones = [], maxIntentos = 5, optOut = false, withinHours = true, tiers } = {}) {
  const plan = planForMora(diasMora, tiers);
  const intentos = countContactAttempts(gestiones);
  const cap = Number.isFinite(Number(maxIntentos)) ? Number(maxIntentos) : 5;
  const base = { etapa: plan.etapa, canal: plan.canal, intentos, maxIntentos: cap };

  if (optOut) return { action: 'none', blocked: true, reason: 'opt-out', ...base };
  if (plan.canal === 'none') return { action: 'none', blocked: false, reason: 'al-dia', ...base };
  if (intentos >= cap) return { action: 'none', blocked: true, reason: 'max-intentos', ...base };
  if (!withinHours) return { action: 'none', blocked: true, reason: 'fuera-horario', ...base };

  const action = plan.canal === 'juridico' ? 'escalar-juridico' : plan.canal;
  return { action, blocked: false, reason: 'listo', ...base };
}

module.exports = {
  effectiveMoraRate,
  computeMoraInterest,
  computeCollectionFees,
  costoDeGestion,
  planForMora,
  countContactAttempts,
  withinAllowedHours,
  nextAction,
  DEFAULT_COSTOS,
  DEFAULT_TIERS
};
