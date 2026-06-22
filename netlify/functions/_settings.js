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
  // Odoo (CRM / operación)
  HELPDESK_ENABLED:              { type: 'bool', group: 'Odoo', label: 'Tickets de PQR en Odoo Helpdesk',
                                   desc: 'Las solicitudes de servicio y las cancelaciones del huésped crean un ticket en Odoo Helpdesk para hacerles seguimiento.' },
  NPS_ENABLED:                   { type: 'bool', group: 'Odoo', label: 'Encuesta NPS en el correo post-estadía',
                                   desc: 'Agrega el enlace a la encuesta de satisfacción en el correo de post-estadía. Necesita que los correos post-estadía estén activos.' }
};

function isManageable(key) { return Object.prototype.hasOwnProperty.call(MANAGEABLE, String(key || '')); }

function settingsStore() {
  const { getStore } = require('@netlify/blobs');
  const opts = { name: STORE, consistency: 'strong' };
  if (process.env.BLOBS_TOKEN && process.env.NETLIFY_SITE_ID) {
    opts.token = process.env.BLOBS_TOKEN;
    opts.siteID = process.env.NETLIFY_SITE_ID;
  }
  return getStore(opts);
}

let _cache = { data: null, at: 0 };

/* Lee el blob de overrides (cacheado por proceso ~30s). Nunca lanza. */
async function loadOverrides(deps = {}) {
  if (deps.store === false) return {}; /* tests: sin store */
  const now = (deps.now || (() => 0))(); /* now inyectable; sin él, sin expiración por reloj */
  if (_cache.data && deps.now && now - _cache.at < CACHE_TTL_MS) return _cache.data;
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

module.exports = { MANAGEABLE, isManageable, get, flag, setSetting, getAllEffective, loadOverrides };
