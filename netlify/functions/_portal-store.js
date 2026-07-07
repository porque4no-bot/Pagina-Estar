/* ── Store maestro de cuentas del portal — `portal-accounts` (Netlify Blobs) ───
   Puente email → identidad del portal, resuelto SIEMPRE server-side (el cliente
   nunca declara su perfil/NIT/reserva en el body). Es la superficie que faltaba:
   sin este store `resolvePortalIdentity` sólo podía operar por allowlist de env
   (demo). Con él, `PORTAL_ENABLED` puede provisionar cuentas reales.

   Clave  = email (lowercased).
   Valor  = {
     email,
     role: 'empresa' | 'residente',
     name?,
     nit?, empresa?,                 // empresa
     driveFolderId?,                 // empresa: carpeta Drive de documentación
     reservationCodes?: string[],    // residente: reservas asociadas (folio)
     odooPartnerKey?: { vat } | { email } | number,  // cartera/facturas/pedidos
     creditStatus?: 'none'|'enrolled'|'analyzing'|'recommended'|'approved'|'rejected',
     createdAt, updatedAt
   }

   NO guarda PII financiera (extractos, DataCrédito, pagaré) — eso va cifrado con
   `_crypto-vault` en su propio store. Aquí sólo el enrutamiento de identidad.

   Mock-safe: sin Blobs (dev) las LECTURAS devuelven null/[] y nunca lanzan; el
   caller cae a su fallback. Las ESCRITURAS (provisión) sí propagan el error para
   que el panel /admin sepa que no se guardó. Aditivo: si el store está vacío, el
   caller puede seguir cayendo a la allowlist de env.

   La provisión de cuentas es responsabilidad de una función HTTP `iam`-style del
   panel /admin (autorizada con `authorize()`), o del flujo de aceptación de
   cotización empresa — ver integrationNotes. Este módulo sólo expone la
   persistencia; no es HTTP-callable. */

const STORE = 'portal-accounts';

const PROFILES = ['empresa', 'residente'];
const CREDIT_STATES = ['none', 'enrolled', 'analyzing', 'recommended', 'approved', 'rejected'];

function getPortalStore() {
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

function normEmail(email) {
  return String(email || '').trim().toLowerCase().slice(0, 160);
}

function nowIso() { return new Date().toISOString(); }

/* Perfil válido; por defecto 'residente' (el perfil de menor privilegio: no ve
   cartera/facturas de empresa). PURO. */
function normProfile(value) {
  const v = String(value || '').trim().toLowerCase();
  return PROFILES.includes(v) ? v : 'residente';
}

/* Normaliza el arreglo de códigos de reserva del residente: strings recortados,
   sin vacíos ni duplicados, tope defensivo. PURO. */
function normReservationCodes(value) {
  const arr = Array.isArray(value) ? value : (value != null ? [value] : []);
  const out = [];
  for (const item of arr) {
    const code = String(item || '').trim().slice(0, 80);
    if (code && !out.includes(code)) out.push(code);
    if (out.length >= 50) break;
  }
  return out;
}

/* odooPartnerKey aceptado: número (>0), { vat }, o { email }. Se descarta
   cualquier otra forma (evita inyectar objetos arbitrarios en el token). PURO. */
function normOdooPartnerKey(value) {
  if (typeof value === 'number') return (Number.isFinite(value) && value > 0) ? value : null;
  if (value && typeof value === 'object') {
    const vat = String(value.vat || value.nit || '').trim().slice(0, 50);
    if (vat) return { vat };
    const mail = normEmail(value.email);
    if (mail) return { email: mail };
  }
  return null;
}

/* Normaliza un registro de cuenta a su forma canónica y server-authoritative.
   PURO (sin I/O). Lanza si falta el email. */
function normalizeAccount(input) {
  const email = normEmail(input && input.email);
  if (!email) throw Object.assign(new Error('email de cuenta requerido'), { statusCode: 400 });
  const profile = normProfile(input && (input.role || input.profile));
  const record = {
    email,
    role: profile,
    name: String((input && input.name) || '').trim().slice(0, 120)
  };
  if (profile === 'empresa') {
    const nit = String((input && input.nit) || '').trim().slice(0, 50);
    if (nit) record.nit = nit;
    const empresa = String((input && input.empresa) || '').trim().slice(0, 160);
    if (empresa) record.empresa = empresa;
    const driveFolderId = String((input && input.driveFolderId) || '').trim().slice(0, 120);
    if (driveFolderId) record.driveFolderId = driveFolderId;
  } else {
    const codes = normReservationCodes(input && input.reservationCodes);
    if (codes.length) record.reservationCodes = codes;
  }
  const partnerKey = normOdooPartnerKey(input && input.odooPartnerKey);
  if (partnerKey != null) record.odooPartnerKey = partnerKey;
  const credit = String((input && input.creditStatus) || '').trim().toLowerCase();
  if (CREDIT_STATES.includes(credit) && credit !== 'none') record.creditStatus = credit;
  return record;
}

/* Deriva los claims que se firmarán en el token de sesión a partir de la cuenta.
   SÓLO enrutamiento de identidad — sin PII financiera. `reservation` es el
   primer código (lo que consume `resolveReservationId` de portal-resident);
   `reservationCodes` viaja completo para usos futuros. PURO. */
function accountToClaims(account) {
  if (!account) return null;
  const profile = normProfile(account.role || account.profile);
  const claims = {
    sub: normEmail(account.email),
    profile,
    name: String(account.name || '').trim().slice(0, 120)
  };
  if (profile === 'empresa') {
    if (account.nit) claims.nit = String(account.nit).trim().slice(0, 50);
    if (account.empresa) claims.empresa = String(account.empresa).trim().slice(0, 160);
  } else {
    const codes = normReservationCodes(account.reservationCodes);
    if (codes.length) {
      claims.reservation = codes[0];
      claims.reservationCodes = codes;
    }
  }
  const partnerKey = normOdooPartnerKey(account.odooPartnerKey);
  if (partnerKey != null) claims.odooPartnerKey = partnerKey;
  return claims;
}

/* ---- Persistencia (Blobs) ---- */

/* Lee la cuenta de un email. Best-effort: null si no existe o si Blobs no está
   disponible (nunca lanza) → el caller cae a su fallback (allowlist env/Odoo). */
async function getAccount(email, deps = {}) {
  const e = normEmail(email);
  if (!e) return null;
  try {
    const store = deps.store || getPortalStore();
    const raw = await store.get(`account/${e}`);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

async function listAccounts(deps = {}) {
  const out = [];
  try {
    const store = deps.store || getPortalStore();
    const listing = await store.list({ prefix: 'account/' });
    for (const entry of (listing.blobs || [])) {
      try {
        const raw = await store.get(entry.key);
        if (raw) out.push(JSON.parse(raw));
      } catch (e) { /* omite ilegibles */ }
    }
  } catch (err) { /* sin blobs → lista vacía */ }
  out.sort((a, b) => String(a.email).localeCompare(String(b.email)));
  return out;
}

/* Provisiona/actualiza una cuenta. A diferencia de las lecturas, propaga el error
   (la provisión debe fallar ruidosamente en el panel). Conserva createdAt. */
async function upsertAccount(input, deps = {}) {
  const record = normalizeAccount(input);
  const store = deps.store || getPortalStore();
  let createdAt = null;
  try {
    const raw = await store.get(`account/${record.email}`);
    if (raw) { const prev = JSON.parse(raw); createdAt = prev && prev.createdAt; }
  } catch (e) { /* sin previo */ }
  record.createdAt = createdAt || nowIso();
  record.updatedAt = nowIso();
  await store.set(`account/${record.email}`, JSON.stringify(record));
  return record;
}

async function deleteAccount(email, deps = {}) {
  const e = normEmail(email);
  if (!e) return;
  const store = deps.store || getPortalStore();
  await store.delete(`account/${e}`);
}

module.exports = {
  STORE, PROFILES,
  getPortalStore, normEmail, normProfile, normReservationCodes, normOdooPartnerKey,
  normalizeAccount, accountToClaims,
  getAccount, listAccounts, upsertAccount, deleteAccount
};
