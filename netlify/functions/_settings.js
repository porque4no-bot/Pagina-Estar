/* Configuración gestionable desde /admin (toggles + valores NO secretos).
 *
 * Cada función lee sus flags vía `flag(key)` / `get(key, fallback)`: primero el
 * override guardado en el panel (Blobs store 'app-settings'), y si no hay, cae a
 * `process.env[key]` (lo de Netlify). Migración gradual y sin romper nada.
 *
 * 🔒 LÍMITE DE SEGURIDAD: SOLO las claves de MANAGEABLE pueden gestionarse desde
 * el panel. Es una LISTA BLANCA que EXCLUYE deliberadamente TODO secreto (tokens,
 * API keys, contraseñas, credenciales, secretos de firma, allowlists de auth).
 * Los secretos viven solo en Netlify y se leen con process.env, nunca por aquí.
 * `setSetting` rechaza cualquier clave fuera de la lista, así un secreto jamás
 * puede entrar al store ni exponerse por la web.
 */

const STORE = 'app-settings';
const CACHE_TTL_MS = 30000; /* override surte efecto en <=30s sin redeploy */

/* Catálogo editable. type: bool | enum | number | text. group para la UI.
   NUNCA agregar aquí secretos/llaves/credenciales. */
const MANAGEABLE = {
  // Operación / correos
  ALERT_ENABLED:                 { type: 'bool', group: 'Operación', label: 'Alertas operativas',
                                   desc: 'Envía un correo al equipo cuando algo falla en el sistema (un pago que no cuadra, un correo que no salió, etc.). Recomendado dejarlo activo.' },
  ADMIN_NOTIFY_EMAIL:            { type: 'text', group: 'Operación', label: 'Correo de avisos del equipo',
                                   desc: 'Dirección donde llegan los correos operativos y de escalamiento (alertas, pedidos del huésped, cancelaciones, etc.). NO es un correo de acceso al panel — eso se gestiona en Usuarios.' },
  STAY_EMAILS_ENABLED:           { type: 'bool', group: 'Operación', label: 'Correos pre-llegada / post-estadía',
                                   desc: 'Envía automáticamente el correo de bienvenida antes del check-in y el de agradecimiento después del checkout.' },
  STAY_EMAILS_PRE_DAYS:          { type: 'number', group: 'Operación', label: 'Días antes (pre-llegada)',
                                   desc: 'Cuántos días ANTES del check-in se manda el correo de pre-llegada.' },
  STAY_EMAILS_POST_DAYS:         { type: 'number', group: 'Operación', label: 'Días después (post-estadía)',
                                   desc: 'Cuántos días DESPUÉS del checkout se manda el correo de post-estadía (donde va la encuesta NPS).' },
  QUOTE_EXPIRY_REMINDER_ENABLED: { type: 'bool', group: 'Operación', label: 'Recordatorio "tu cotización vence"',
                                   desc: 'Le envía un recordatorio al cliente corporativo cuando su cotización está por vencer.' },
  GUEST_NOTES_TO_PMS_ENABLED:    { type: 'bool', group: 'Operación', label: 'Nota del huésped → OTASync',
                                   desc: 'La nota que el huésped escribe al reservar se copia a la reserva dentro de OTASync, para que recepción la vea.' },
  BACKUP_ENABLED:                { type: 'bool', group: 'Operación', label: 'Respaldo diario de datos',
                                   desc: 'Hace una copia de seguridad diaria de los datos (cotizaciones, reembolsos, check-ins).' },
  ESCALATION_CALL_ENABLED:       { type: 'bool', group: 'Operación', label: 'Llamada de escalamiento del bot (Twilio)',
                                   desc: 'Cuando el bot marca un caso como urgente, llama por teléfono al responsable (vía Twilio, número de voz aparte). Si está apagado o falla, cae a una alerta por correo. Requiere cargar las credenciales de Twilio.' },
  ESCALATION_PHONE_NUMBERS:      { type: 'text', group: 'Operación', label: 'Números a llamar en escalamiento (en orden)',
                                   desc: 'Teléfonos que el bot llama cuando un caso es urgente, en formato internacional y separados por coma. Ej: +573218598686,+573057465544,+573163292157. Recepción primero, luego dueños. (Los números NO son secretos; las credenciales de Twilio sí, y esas viven solo en Netlify.)' },
  // Pagos / reembolsos
  REFUND_GATEWAY_AUTO_ENABLED:   { type: 'bool', group: 'Pagos', label: 'Auto-reembolso Mercado Pago al aprobar',
                                   desc: 'Cuando apruebas un reembolso de Mercado Pago en el panel, se ejecuta solo. Wompi NO tiene API → sigue siendo ticket manual.' },
  REFUND_BANK_FORM_ENABLED:      { type: 'bool', group: 'Pagos', label: 'Formulario de cuenta para reembolso manual',
                                   desc: 'Habilita el formulario donde el huésped indica su cuenta bancaria para reembolsos por transferencia.' },
  DISCOUNT_CODES_ENABLED:        { type: 'bool', group: 'Pagos', label: 'Motor de códigos de descuento',
                                   desc: 'Muestra el campo "código de descuento" en el motor de reservas y activa la validación de los cupones.' },
  OTASYNC_AUTO_CANCEL_ENABLED:   { type: 'bool', group: 'Pagos', label: 'Cancelar la reserva en OTASync al procesar el reembolso',
                                   desc: 'Cuando apruebas o deniegas la cancelación en el panel, la reserva se marca como cancelada en OTASync (libera el inventario). Sin esto, hay que cancelarla a mano. Probar con una reserva real antes de encender.' },
  MP_DIRECT_RESILIENT_ENABLED:   { type: 'bool', group: 'Pagos', label: 'Ruta directa de Mercado Pago resiliente (igual que Wompi)',
                                   desc: 'Activa lock anti-doble-reserva, idempotencia por estadía, reintentos y "pago sin reserva" recuperable en la ruta directa de Mercado Pago. Solo aplica si cobras con Mercado Pago (rollback). Probar en sandbox MP antes de encender.' },
  // Guest app
  GUEST_SERVICE_PAYMENT_MODE:    { type: 'enum', group: 'Guest app', label: 'Pago de servicios en línea',
                                   options: ['room_charge', 'payment_link', 'wompi', 'mercadopago', 'both'],
                                   desc: 'Cómo paga el huésped sus pedidos desde la app: room_charge = solo se registra · payment_link = link genérico · wompi / mercadopago = cobro en línea · both = el huésped elige.' },
  GUEST_SERVICE_FOLIO_ENABLED:   { type: 'bool', group: 'Guest app', label: 'Cargar pedidos al folio Kunas',
                                   desc: 'Los pedidos "cargar a mi cuenta" se suman al folio de la reserva en OTASync/Kunas para cobrarse al checkout.' },
  GUEST_APP_STORE_DOCUMENTS:     { type: 'bool', group: 'Guest app', label: 'Guardar imagen del documento',
                                   desc: 'Guarda la foto del documento de identidad del huésped. Déjalo apagado salvo que se apruebe (dato sensible).' },
  // Desayuno / chapas
  BREAKFAST_UPGRADE_ENABLED:     { type: 'bool', group: 'Desayuno / chapas', label: 'Agregar desayuno desde el comedor',
                                   desc: 'Permite al comedor AGREGAR desayuno a una reserva que no lo tenía; se cobra al folio de la reserva.' },
  TTLOCK_ENABLED:                { type: 'bool', group: 'Desayuno / chapas', label: 'Emitir códigos de chapa (TTLock)',
                                   desc: 'Genera y envía al huésped los códigos temporales de las chapas por reserva. Requiere cargar las credenciales de TTLock.' },
  // WhatsApp
  WHATSAPP_BOT_ENABLED:          { type: 'bool', group: 'WhatsApp', label: 'Bot de WhatsApp responde',
                                   desc: 'El bot contesta automáticamente los mensajes de WhatsApp. Apágalo para que nadie reciba respuestas automáticas.' },
  WHATSAPP_GUARD_ENABLED:        { type: 'bool', group: 'WhatsApp', label: 'Guardián de seguridad del bot',
                                   desc: 'Filtro que revisa cada mensaje antes de que el bot responda, para bloquear intentos de fraude o de engañar al bot.' },
  WHATSAPP_AI_MODEL:             { type: 'enum', group: 'WhatsApp', label: 'Modelo de IA del bot',
                                   options: ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-8'],
                                   desc: 'Modelo que usa el bot: haiku = más rápido y económico (recomendado para chat) · sonnet = equilibrio · opus = máxima calidad (más lento y caro). El bot está afinado para haiku.' },
  // Odoo (CRM / operación)
  HELPDESK_ENABLED:              { type: 'bool', group: 'Odoo', label: 'Tickets de PQR en Odoo Helpdesk',
                                   desc: 'Las solicitudes de servicio y las cancelaciones del huésped crean un ticket en Odoo Helpdesk para hacerles seguimiento.' },
  NPS_ENABLED:                   { type: 'bool', group: 'Odoo', label: 'Encuesta NPS en el correo post-estadía',
                                   desc: 'Agrega el enlace a la encuesta de satisfacción en el correo de post-estadía. Necesita que los correos post-estadía estén activos.' },
  NPS_SURVEY_URL:                { type: 'text', group: 'Odoo', label: 'URL de la encuesta NPS',
                                   desc: 'Enlace de la encuesta de satisfacción que va en el correo post-estadía (cuando la NPS está activa). Si se deja vacío, se usa la encuesta por defecto.' },
  HELPDESK_TEAM_ID:              { type: 'number', group: 'Odoo', label: 'Equipo de Helpdesk (Odoo)',
                                   desc: 'Id del equipo de Odoo Helpdesk donde se abren los tickets de PQR. Por defecto 3 (Atención al cliente).' },
  // Facturación
  NUMERA_INVOICING_ENABLED:      { type: 'bool', group: 'Facturación', label: 'Emitir facturas electrónicas (Numera/DIAN)',
                                   desc: 'Activa la emisión REAL de facturas electrónicas ante la DIAN vía Numera. Con esto apagado, todo queda en borrador (no se emite nada). Requiere cargar las credenciales de Numera en Netlify. Probar contra la respuesta del proveedor antes de encender.' },
  // Recepción / Legal
  TRA_ENABLED:                   { type: 'bool', group: 'Recepción/Legal', label: 'Reportar estadías al TRA (MinCIT)',
                                   desc: 'Reporta cada estadía (todos los huéspedes) al Registro Nacional de Turismo vía la API del TRA. Requiere cargar el token del RNT en Netlify. Confirmar los campos con el MinCIT antes de encender.' },
  SIRE_ENABLED:                  { type: 'bool', group: 'Recepción/Legal', label: 'Generar archivo SIRE (extranjeros)',
                                   desc: 'Habilita la generación del archivo plano de SIRE (Migración Colombia) para huéspedes extranjeros. SIRE no tiene API: el archivo se sube a mano al portal. Confirmar el formato con el portal antes de encender.' },
  LEGAL_DOCS_ENABLED:            { type: 'bool', group: 'Recepción/Legal', label: 'Registro de documentos legales',
                                   desc: 'Muestra el registro de documentos legales de la empresa (RUT, RNT, Cámara de Comercio, certificaciones bancarias) con alertas de vigencia. Lee la carpeta de Google Drive configurada.' },
  LEGAL_DOCS_REQUEST_CONTACT:    { type: 'text', group: 'Recepción/Legal', label: 'Contacto para solicitar documentos',
                                   desc: 'Número o correo que aparece en la alerta cuando un documento está vencido o por vencer ("solicítalo a …"). Por ahora, el número de gerencia (primer número de escalamiento).' }
};

function isManageable(key) { return Object.prototype.hasOwnProperty.call(MANAGEABLE, String(key || '')); }

function settingsStore() {
  const { getStore } = require('@netlify/blobs');
  const opts = { name: STORE, consistency: 'strong' };
  const siteID = process.env.BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) {
    opts.siteID = siteID;
    opts.token = token;
  }
  return getStore(opts);
}

let _cache = { data: null, at: 0 };

/* Lee el blob de overrides (cacheado por proceso ~30s). Nunca lanza. */
async function loadOverrides(deps = {}) {
  if (deps.store === false) return {}; /* tests: sin store */
  const now = (deps.now || Date.now)(); /* reloj inyectable; por defecto el real */
  /* Con el store real (producción) cachea ~30s por proceso; con un store
     inyectado (tests) siempre relee, para no arrastrar snapshots entre casos. */
  if (!deps.store && _cache.data && now - _cache.at < CACHE_TTL_MS) return _cache.data;
  try {
    const store = deps.store || settingsStore();
    const raw = await store.get(STORE);
    const data = raw ? JSON.parse(raw) : {};
    _cache = { data, at: now };
    return data;
  } catch (e) {
    return _cache.data || {};
  }
}

/* Valor efectivo de una clave: override del panel → env → fallback.
   Para claves NO gestionables, solo env → fallback (jamás del store). */
async function get(key, fallback, deps = {}) {
  if (isManageable(key)) {
    const ov = await loadOverrides(deps);
    if (ov && ov[key] !== undefined && ov[key] !== null && String(ov[key]) !== '') return ov[key];
  }
  const env = process.env[key];
  return (env !== undefined && env !== '') ? env : fallback;
}

async function flag(key, deps = {}) {
  return String(await get(key, '', deps)).toLowerCase() === 'true';
}

/* Lectura SÍNCRONA del valor efectivo, para call sites que NO pueden ser async
   (helpers compartidos ya usados en contexto sync, p.ej. adminEmail() de _email).
   Usa el snapshot de overrides en memoria (_cache, si ya se cargó) → env → fallback.
   "Eventualmente consistente": el snapshot se calienta con cualquier get()/flag()/
   preload() async previo del MISMO proceso. En un cold start sin lectura async
   previa, cae a env (nunca rompe). Claves NO gestionables: solo env → fallback. */
function getSync(key, fallback) {
  if (isManageable(key) && _cache.data) {
    const ov = _cache.data[key];
    if (ov !== undefined && ov !== null && String(ov) !== '') return ov;
  }
  const env = process.env[key];
  return (env !== undefined && env !== '') ? env : fallback;
}

/* Calienta el snapshot de overrides (best-effort). Úsalo al inicio de un handler
   cuyo call site síncrono downstream deba respetar el override del panel. */
async function preload(deps = {}) { try { await loadOverrides(deps); } catch (e) { /* best-effort */ } }

/* Escribe/limpia un override. SOLO claves de la lista blanca. value=null/'' borra
   el override (vuelve a regir Netlify). Nunca acepta secretos. */
async function setSetting(key, value, deps = {}) {
  if (!isManageable(key)) throw new Error('Clave no gestionable desde el panel');
  const store = deps.store || settingsStore();
  const current = await (async () => { try { return JSON.parse(await store.get(STORE)) || {}; } catch (e) { return {}; } })();
  if (value === null || value === undefined || String(value) === '') delete current[key];
  else current[key] = String(value);
  await store.set(STORE, JSON.stringify(current));
  _cache = { data: null, at: 0 }; /* invalida cache */
  return current;
}

/* Para la UI: valor efectivo + de dónde viene + metadata, por clave gestionable. */
async function getAllEffective(deps = {}) {
  const ov = await loadOverrides(deps);
  const out = {};
  for (const [key, meta] of Object.entries(MANAGEABLE)) {
    const hasOverride = ov && ov[key] !== undefined && ov[key] !== null && String(ov[key]) !== '';
    const envVal = process.env[key];
    out[key] = {
      meta,
      value: hasOverride ? ov[key] : (envVal !== undefined ? envVal : ''),
      source: hasOverride ? 'panel' : (envVal !== undefined && envVal !== '' ? 'netlify' : 'sin definir')
    };
  }
  return out;
}

module.exports = { MANAGEABLE, isManageable, get, flag, getSync, preload, setSetting, getAllEffective, loadOverrides };
