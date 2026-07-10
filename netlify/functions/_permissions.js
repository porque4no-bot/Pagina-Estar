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
  'settings.manage',               // gestionar toggles/configuración no secreta del panel
  'invoices.view',                 // ver los borradores de factura pendientes de emitir
  'invoices.issue',                // emitir / anular / nota crédito (facturación electrónica DIAN)
  'docs.view',                     // ver el registro de documentos legales de la empresa
  'portal.view',                   // supervisar el Portal Estar (empresas / residentes) desde /admin
  'credito.ver',                   // ver solicitudes de crédito y su recomendación (la IA solo sugiere)
  'credito.aprobar',               // DECISIÓN humana de crédito (aprobar/rechazar/codeudor) — nunca la IA
  'cobranza.gestionar',            // ejecutar gestiones de cobranza (recordatorios, escalamiento)
  'portal.accounts.manage',        // provisionar/dar de alta cuentas del Portal Estar (solo admin)
  'cartera.view',                  // ver la cartera (saldos/mora) del staff — visor de tesorería
  'cobranza.ver',                  // ver el estado de gestiones de cobranza (sin ejecutarlas)
  'pagare.ver'                     // ver el visor de pagarés en /admin (PII financiera cifrada en reposo)
];

const PERMISSION_SET = new Set(ALL_PERMISSIONS);

/* Permisos RESERVADOS: existen en el catálogo (para que `authorize` funcione en
   cuanto aterrice su superficie y para que la matriz rol→permiso ya los
   contemple), pero HOY ninguna función/vista los consume todavía. Se listan aquí
   para que `whoami` y la UI de /admin los oculten/deshabiliten y no den falsa
   señal de capacidad (una pestaña o acción que no existe). Al crear la función
   que hace `authorize(event, '<permiso>')` correspondiente, quitarlo de este set.

   Pendientes de superficie (plan-portal-estar §3/§10):
     - portal.accounts.manage → función iam-style de alta/edición de cuentas del
       Portal (CRUD sobre el store `portal-accounts`).
     - pagare.ver             → visor de pagarés (store `pagares`; PII financiera
       cifrada en reposo, se muestra desellada solo a quien tenga el permiso).
     - cobranza.ver           → visor de estado de gestiones (store
       `collections-log`), de solo lectura (no ejecuta cobranza). */
const RESERVED_PERMISSIONS = new Set([
  'portal.accounts.manage',
  'pagare.ver',
  'cobranza.ver'
]);

function isValidPermission(p) {
  return PERMISSION_SET.has(String(p || ''));
}

/* True si el permiso está en el catálogo pero aún no tiene función que lo
   consuma. La UI debe ocultar/deshabilitar estos para no prometer capacidad. */
function isReservedPermission(p) {
  return RESERVED_PERMISSIONS.has(String(p || ''));
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
    'invoices.request',
    'docs.view',
    'portal.view'
  ],
  cocina: ['breakfast.status', 'breakfast.redeem', 'breakfast.day'],
  tesoreria: [
    'quotes.view', 'quotes.audit.read',
    'refunds.view', 'refunds.approve', 'refunds.deny', 'refunds.set_amount', 'refunds.mark_done',
    'breakfast.analytics',
    'invoices.request',
    'invoices.view', 'invoices.issue',
    'docs.view',
    'portal.view', 'credito.ver', 'credito.aprobar', 'cobranza.gestionar',
    'cartera.view', 'cobranza.ver', 'pagare.ver'
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

/* Etiquetas ES/EN de PERMISOS para la UI. Hasta ahora los permisos solo tenían
   el comentario en línea; este mapa expone el nombre legible en ambos idiomas.
   Es opcional para la UI (puede caer al id si un permiso no está aquí) y por eso
   solo cubrimos los permisos nuevos de facturación/documentos legales. */
const PERMISSION_LABELS = {
  'invoices.view':  { es: 'Ver facturas pendientes', en: 'View pending invoices' },
  'invoices.issue': { es: 'Emitir / anular / nota crédito', en: 'Issue / void / credit note' },
  'docs.view':      { es: 'Ver documentos legales', en: 'View legal documents' },
  'portal.view':        { es: 'Supervisar el Portal Estar', en: 'Oversee the Estar Portal' },
  'credito.ver':        { es: 'Ver solicitudes de crédito', en: 'View credit applications' },
  'credito.aprobar':    { es: 'Aprobar crédito (decisión humana)', en: 'Approve credit (human decision)' },
  'cobranza.gestionar': { es: 'Gestionar cobranza', en: 'Manage collections' },
  'portal.accounts.manage': { es: 'Provisionar cuentas del Portal', en: 'Provision Portal accounts' },
  'cartera.view':       { es: 'Ver cartera', en: 'View accounts receivable' },
  'cobranza.ver':       { es: 'Ver estado de cobranza', en: 'View collections status' },
  'pagare.ver':         { es: 'Ver pagarés', en: 'View promissory notes' }
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
  RESERVED_PERMISSIONS, isReservedPermission,
  DEFAULT_ROLES, BUILTIN_ROLE_IDS, ROLE_LABELS, PERMISSION_LABELS,
  STAFF_ENV_PERMISSIONS, permissionsForRoles
};
