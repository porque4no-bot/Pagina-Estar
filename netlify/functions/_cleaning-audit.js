/* Auditoría de fotos de aseo con IA (visión de Claude).
 *
 * El personal de aseo toma una foto por cada ítem de la lista de chequeo
 * (cama, baño, cocina...) y este módulo la audita ANTES de aceptarla:
 *
 *   1. ¿La foto muestra realmente lo pedido? (una cama, no el techo)
 *   2. ¿Está bien tomada? (nítida, con luz, encuadre completo, sin recortes)
 *   3. ¿El aseo cumple los criterios de calidad del ítem?
 *
 * El modelo SOLO observa y reporta; la DECISIÓN (aprobar / advertir / rechazar)
 * la toma código, no el prompt — mismo principio que _whatsapp-ai (la lógica de
 * negocio vive en el código, no en el modelo). Modo "híbrido":
 *
 *   - rechazada  → bloqueo duro: la foto está mal tomada o no es lo pedido.
 *                  Hay que repetirla; no se registra.
 *   - advertida  → hay observaciones de calidad del aseo, pero NO bloquea:
 *                  se registra con la observación para que el supervisor la vea.
 *   - aprobada   → todo bien.
 *
 * Sin ANTHROPIC_API_KEY el módulo responde en modo mock (aprobada) para poder
 * probar la UI localmente — misma convención que el resto de integraciones
 * dependientes de credenciales en este repo. */

require('./_env');

/* Sonnet 5 por defecto: buena visión, más rápido/barato que Opus para una
   tarea de clasificación acotada. Sube a claude-opus-4-8 vía env para el
   máximo rigor en el detalle fino. */
const DEFAULT_MODEL = 'claude-sonnet-5';
const DEFAULT_TIMEOUT_MS = 30000;

/* Lista de chequeo de aseo. Cada ítem define:
 *   - subject:  qué DEBE mostrar la foto (para validar que no sea otra cosa)
 *   - criteria: los criterios de calidad del aseo que se auditan
 * La página de staff (aseo.html) renderiza los ítems desde /api/cleaning-checklist,
 * así que esta es la fuente única de la lista. */
const CHECKLIST = [
  {
    id: 'cama',
    label: 'Cama tendida',
    hint: 'De frente, con toda la cama visible y buena luz.',
    subject: 'una cama tendida de un apartamento (colchón, sábanas, cubrecama y almohadas)',
    criteria: [
      'la cama está bien tendida, estirada, sin arrugas ni pliegues marcados',
      'el cubrecama o edredón está centrado y cae parejo a ambos lados',
      'las almohadas están completas, mullidas y alineadas',
      'no hay ropa, objetos personales, basura ni manchas visibles sobre la cama'
    ]
  },
  {
    id: 'bano',
    label: 'Baño',
    hint: 'Muestra lavamanos, sanitario o ducha con el espejo si se puede.',
    subject: 'el baño de un apartamento (lavamanos, sanitario, ducha o espejo)',
    criteria: [
      'sanitario, lavamanos y ducha se ven limpios, sin manchas ni residuos',
      'el espejo y las superficies están sin salpicaduras ni marcas de agua',
      'no hay basura, cabellos ni objetos fuera de lugar',
      'las toallas (si aparecen) están limpias y bien colgadas o dobladas'
    ]
  },
  {
    id: 'cocina',
    label: 'Cocina',
    hint: 'Mesón, estufa y lavaplatos en el encuadre.',
    subject: 'la cocina o cocineta de un apartamento (mesón, estufa, lavaplatos)',
    criteria: [
      'el mesón está despejado y limpio, sin migas, grasa ni manchas',
      'la estufa y el lavaplatos se ven limpios y secos',
      'no hay loza sucia, basura ni residuos de comida',
      'los enseres visibles están ordenados en su lugar'
    ]
  },
  {
    id: 'sala',
    label: 'Sala / zona social',
    hint: 'Encuadre general de la sala o zona de estar.',
    subject: 'la sala o zona social de un apartamento (sofá, mesa, zona de estar)',
    criteria: [
      'los muebles están ordenados y en su posición',
      'cojines y superficies limpios y organizados',
      'pisos despejados, sin basura ni objetos de huéspedes anteriores',
      'la zona luce lista para recibir a un nuevo huésped'
    ]
  },
  {
    id: 'toallas',
    label: 'Toallas y amenidades',
    hint: 'Toallas dobladas y amenidades dispuestas.',
    subject: 'toallas dobladas y/o amenidades de cortesía dispuestas para el huésped',
    criteria: [
      'las toallas están limpias, dobladas de forma uniforme y bien presentadas',
      'las amenidades (jabón, shampoo, etc.) están completas y ordenadas',
      'la presentación luce cuidada y homogénea',
      'no hay toallas usadas, manchadas ni desordenadas'
    ]
  }
];

function getChecklistItem(id) {
  return CHECKLIST.find(i => i.id === id) || null;
}

function config() {
  return {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.CLEANING_AI_MODEL || DEFAULT_MODEL,
    timeoutMs: parseInt(process.env.CLEANING_AI_TIMEOUT_MS, 10) || DEFAULT_TIMEOUT_MS
  };
}

function isEnabled() {
  return Boolean(config().apiKey);
}

/* Herramienta forzada: garantiza salida estructurada sin parsear texto libre.
   El modelo SÓLO observa y reporta; la decisión la toma evaluateDecision(). */
const REPORT_TOOL = {
  name: 'reportar_auditoria',
  description: 'Reporta el resultado de la auditoría visual de la foto de aseo.',
  input_schema: {
    type: 'object',
    properties: {
      es_el_objeto: {
        type: 'boolean',
        description: 'true si la foto muestra claramente lo que se pidió; false si es otra cosa o no se distingue.'
      },
      calidad_foto: {
        type: 'string',
        enum: ['buena', 'mala'],
        description: '"mala" si está borrosa, muy oscura/quemada, recortada, con reflejos que impiden ver, o el objeto no se aprecia completo.'
      },
      aseo_correcto: {
        type: 'boolean',
        description: 'true SOLO si se cumplen todos los criterios de aseo del ítem.'
      },
      problemas: {
        type: 'array',
        items: { type: 'string' },
        description: 'Lista corta y concreta de problemas encontrados, en español. Vacía si todo está bien.'
      },
      sugerencia: {
        type: 'string',
        description: 'Una sola frase con la acción para corregir el aseo o repetir la foto. Vacía si todo está bien.'
      },
      confianza: {
        type: 'number',
        description: 'Qué tan seguro estás del veredicto, de 0 a 1.'
      }
    },
    required: ['es_el_objeto', 'calidad_foto', 'aseo_correcto', 'problemas', 'sugerencia', 'confianza']
  }
};

function buildPrompt(item) {
  const criteria = item.criteria.map(c => `- ${c}`).join('\n');
  return `Eres un supervisor de control de calidad de aseo de un hotel boutique de apartaestudios. El personal de aseo tomó esta foto como evidencia de un ítem de la lista de chequeo. Audítala con rigor pero de forma justa.

La foto DEBE mostrar: ${item.subject}.

Criterios de aseo que deben cumplirse:
${criteria}

Evalúa tres cosas:
1) ¿La foto realmente muestra lo pedido?
2) ¿Está bien tomada? Nítida, con luz suficiente, encuadre completo, sin recortes ni reflejos que impidan ver.
3) ¿El aseo cumple TODOS los criterios de arriba?

Sé concreto en los problemas (p. ej. "la almohada izquierda está arrugada", no "mejorar la cama"). Reporta tu veredicto llamando la herramienta reportar_auditoria.`;
}

let cachedClient = null;
function getClient(timeoutMs) {
  if (cachedClient) return cachedClient;
  const Anthropic = require('@anthropic-ai/sdk');
  cachedClient = new Anthropic({ timeout: timeoutMs, maxRetries: 1 });
  return cachedClient;
}

/* Veredicto neutro para modo mock (sin API key) — aprueba para no estorbar la
   prueba local de la UI. */
function mockVerdict() {
  return {
    es_el_objeto: true,
    calidad_foto: 'buena',
    aseo_correcto: true,
    problemas: [],
    sugerencia: '',
    confianza: 0.5,
    mock: true
  };
}

/* Audita una foto contra el ítem. `image` = { mediaType, base64 }.
   Devuelve el veredicto crudo del modelo (o mock). Lanza si la llamada falla. */
async function auditPhoto(item, image) {
  if (!isEnabled()) return mockVerdict();

  const cfg = config();
  const client = getClient(cfg.timeoutMs);
  const response = await client.messages.create({
    model: cfg.model,
    max_tokens: 1024,
    tools: [REPORT_TOOL],
    tool_choice: { type: 'tool', name: 'reportar_auditoria' },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
        { type: 'text', text: buildPrompt(item) }
      ]
    }]
  });

  const block = (response.content || []).find(b => b.type === 'tool_use');
  if (!block || !block.input) throw new Error('El modelo no devolvió un veredicto.');
  return { ...block.input, mock: false };
}

/* Decisión en código (no en el prompt). Modo híbrido:
   - rechazada: foto mal tomada, o claramente no es el objeto (con confianza).
   - advertida: hay observaciones de aseo, pero no bloquea.
   - aprobada:  todo en orden.
   Nota: si el modelo duda de que sea el objeto (baja confianza) NO bloquea —
   se degrada a advertencia para evitar falsos rechazos. */
function evaluateDecision(v) {
  const conf = Number(v && v.confianza) || 0;
  const problemas = Array.isArray(v && v.problemas) ? v.problemas : [];

  if (v && v.calidad_foto === 'mala') return 'rechazada';
  if (v && v.es_el_objeto === false && conf >= 0.5) return 'rechazada';

  if (v && v.aseo_correcto === false) return 'advertida';
  if (problemas.length) return 'advertida';
  if (v && v.es_el_objeto === false) return 'advertida';

  return 'aprobada';
}

module.exports = {
  CHECKLIST,
  getChecklistItem,
  isEnabled,
  auditPhoto,
  evaluateDecision,
  REPORT_TOOL
};
