/* Catálogo de permisos atómicos + roles por defecto del panel /admin.
 *
 * Es la fuente única de verdad de QUÉ puede hacerse en el sistema. La capa de
 * autorización (`_authz.js`) traduce un email → permisos efectivos cruzando las
 * env vars (ADMIN_EMAILS/STAFF_EMAILS, superusuarios de respaldo) con el store
 * de usuarios/roles (`_iam-store.js`). Módulo PURO (sin red ni Blobs): fácil de
 * testear y de importar desde el front para etiquetar.
 *
 * NUNCA reordenar para borrar: agregar permisos al final. Quitar un permiso del
 * catálogo deja huérfanos los roles que lo referencien (se ignoran en runtime).
 */

/* Cada permiso es `recurso.accion`. Mantener en sync con los guards de cada
   función al migrarlas al nuevo sistema. */
const ALL_PERMISSIONS = [
  'users.manage',                  // crear/editar/suspender usuarios y asignar roles
  'roles.manage',                  // editar la matriz rol → permisos
  'quotes.view',                   // ver cotizaciones
  'quotes.edit',                   // crear/editar cotizaciones
  'quotes.send',                   // enviar la cotización por correo al cliente
  'quotes.audit.read',             // leer el historial/auditoría de cotizaciones
  'refunds.view',                  // ver el panel de reembolsos
  'refunds.approve',               // aprobar un reembolso
  'refunds.deny',                  // denegar un reembolso
  'refunds.set_amount',            // fijar el monto a reembolsar
  'refunds.mark_done',             // marcar en proceso / reembolsado
  'breakfast.status',              // consultar el pase de desayuno
  'breakfast.redeem',              // marcar un desayuno servido
  'breakfast.upgrade',             // agregar desayuno a una reserva sin desayuno (cobra folio)
  'breakfast.day',                 // tablero "día de desayunos"
  'breakfast.analytics',           // panel de dinero de desayunos (solo admin/tesorería)
  'breakfast.courtesy',            // cortesía (desayuno gratis)
  'guests.register',              // registrar/empujar el check-in del huésped al PMS
  'guests.checkin.view',           // ver los datos de check-in de los huéspedes
  'invoices.request',              // solicitar factura de una reserva
  'integrations.probe',            // health checks (odoo/drive/whatsapp probe)
  'integrations.credentials.upload', // subir credenciales (drive service account)
  'settings.manage'                // gestionar toggles/configuración no secreta del panel
];

const PERMISSION_SET = new Set(ALL_PERMISSIONS);

function isValidPermission(p) {
  return PERMISSION_SET.has(String(p || ''));
}

/* Roles integrados (no borrables desde la UI). Sus permisos son un default
   editable: `roles.manage` puede ajustar la matriz, persistida en el store. */
const DEFAULT_ROLES = {
  admin: ALL_PERMISSIONS.slice(),
  recepcion: [
    'quotes.view', 'quotes.send',
    'refunds.view',
    'breakfast.status', 'breakfast.redeem', 'breakfast.day',
    'guests.register', 'guests.checkin.view',
    'invoices.request'
  ],
  cocina: ['breakfast.status', 'breakfast.redeem', 'breakfast.day'],
  tesoreria: [
    'quotes.view', 'quotes.audit.read',
    'refunds.view', 'refunds.approve', 'refunds.deny', 'refunds.set_amount', 'refunds.mark_done',
    'breakfast.analytics',
    'invoices.request'
  ]
};

const BUILTIN_ROLE_IDS = Object.keys(DEFAULT_ROLES);

/* Etiquetas ES/EN para la UI (rol y permiso). */
const ROLE_LABELS = {
  admin: { es: 'Administrador', en: 'Administrator' },
  recepcion: { es: 'Recepción', en: 'Front desk' },
  cocina: { es: 'Cocina', en: 'Kitchen' },
  tesoreria: { es: 'Tesorería', en: 'Treasury' }
};

/* Permisos que otorga estar en STAFF_EMAILS (comportamiento actual del panel de
   desayunos), para que la migración no le quite acceso a la cocina. */
const STAFF_ENV_PERMISSIONS = ['breakfast.status', 'breakfast.redeem', 'breakfast.day', 'breakfast.upgrade'];

/* Une los permisos de una lista de roles. `customRoles` = mapa opcional
   id → { permissions:[] } proveniente del store (sobrescribe/añade builtins).
   Ignora permisos fuera del catálogo (huérfanos). */
function permissionsForRoles(roleIds, customRoles) {
  const out = new Set();
  const map = Object.assign({}, DEFAULT_ROLES);
  if (customRoles && typeof customRoles === 'object') {
    for (const [id, def] of Object.entries(customRoles)) {
      if (def && Array.isArray(def.permissions)) map[id] = def.permissions;
    }
  }
  for (const id of (roleIds || [])) {
    const perms = map[id];
    if (!perms) continue;
    for (const p of perms) if (PERMISSION_SET.has(p)) out.add(p);
  }
  return out;
}

module.exports = {
  ALL_PERMISSIONS, PERMISSION_SET, isValidPermission,
  DEFAULT_ROLES, BUILTIN_ROLE_IDS, ROLE_LABELS,
  STAFF_ENV_PERMISSIONS, permissionsForRoles
};
