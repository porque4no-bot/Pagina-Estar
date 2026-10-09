const { test, expect } = require('@playwright/test');

/* Paneles del personal (frente staff): permisos por rol en la UI.
 *   - desayuno.html: el tercero de desayunos no ve "Agregar desayuno" (cobro) ni
 *     el conteo del día; quien puede hacer upgrade sí lo ve.
 *   - aseo.html: sin el permiso cleaning.audit se muestra "Sin acceso" en vez
 *     de un formulario que va a fallar; con el permiso carga la lista.
 *   - /admin: un usuario sin permisos ve un aviso (no el formulario de
 *     cotización); las acciones de la lista dependen del permiso; un reenvío
 *     que no salió se reporta como fallo; Configuración muestra el valor
 *     efectivo y el probe de TTLock.
 * Todo con /api/* simulado: ninguna llamada sale a sistemas reales. En
 * 127.0.0.1 desayuno/aseo corren en modo demo (sin Firebase); /admin usa
 * Firebase, así que sus módulos se reemplazan por un stub con sesión iniciada. */

const FIREBASE_APP_STUB = 'export function initializeApp(){ return {}; }';
const FIREBASE_AUTH_STUB = [
  "const user = { email: 'tester@estar.com', getIdToken: async () => 'test-token' };",
  'export function getAuth(){ return { currentUser: user }; }',
  'export class GoogleAuthProvider { setCustomParameters(){} }',
  'export async function signInWithPopup(){}',
  'export async function signOut(){}',
  'export function onAuthStateChanged(auth, cb){ setTimeout(() => cb(user), 0); return () => {}; }',
  'export async function setPersistence(){}',
  'export const browserLocalPersistence = {};'
].join('\n');

test.beforeEach(async ({ page }) => {
  await page.route('https://www.googletagmanager.com/**', route => route.abort());
  await page.route('https://www.gstatic.com/firebasejs/**/firebase-app.js', route => route.fulfill({
    status: 200, contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: FIREBASE_APP_STUB
  }));
  await page.route('https://www.gstatic.com/firebasejs/**/firebase-auth.js', route => route.fulfill({
    status: 200, contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: FIREBASE_AUTH_STUB
  }));
  await page.addInitScript(() => {
    try { localStorage.setItem('estar-cookie-consent-v1', JSON.stringify({ choice: 'denied', at: Date.now() })); } catch (e) {}
  });
});

function whoami(page, permissions, extra) {
  return page.route('**/api/whoami', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify(Object.assign({ email: 'tester@estar.com', permissions, roles: [], isEnvAdmin: false }, extra || {}))
  }));
}

const NO_BREAKFAST = { bookingCode: 'EST-AIR-1', hasBreakfast: false, guestName: 'Ana Ruiz', roomNumber: '101', roomName: 'Clásica' };

test('desayuno: el tercero (status+redeem) no ve "Agregar desayuno" ni el conteo del día', async ({ page }) => {
  let dayCalls = 0;
  await whoami(page, ['breakfast.status', 'breakfast.redeem']);
  await page.route('**/api/breakfast-day', route => { dayCalls++; route.fulfill({ status: 200, contentType: 'application/json', body: '{"servedToday":1,"servedThisCycle":9}' }); });
  await page.route('**/api/breakfast-status', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, canUpgrade: false, status: NO_BREAKFAST })
  }));

  await page.goto('/desayuno.html');
  await page.fill('#manualCode', 'EST-AIR-1');
  await page.click('#lookupBtn');
  await expect(page.getByText('Sin desayuno incluido')).toBeVisible();
  await expect(page.locator('#upgradeBtn')).toHaveCount(0);
  await expect(page.getByText(/avísale al administrador del hotel/)).toBeVisible();
  await expect(page.locator('#countsPanel')).toBeHidden();
  expect(dayCalls).toBe(0);
});

test('desayuno: con permiso de upgrade y el flag encendido sí aparece "Agregar desayuno"', async ({ page }) => {
  await whoami(page, ['breakfast.status', 'breakfast.redeem', 'breakfast.day', 'breakfast.upgrade']);
  await page.route('**/api/breakfast-day', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"servedToday":2,"servedThisCycle":30}' }));
  await page.route('**/api/breakfast-status', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, canUpgrade: true, status: NO_BREAKFAST })
  }));

  await page.goto('/desayuno.html');
  await expect(page.locator('#cntToday')).toHaveText('2');
  await page.fill('#manualCode', 'EST-AIR-1');
  await page.click('#lookupBtn');
  await expect(page.locator('#upgradeBtn')).toBeVisible();
});

test('desayuno: un usuario sin permisos de desayuno ve "Sin acceso"', async ({ page }) => {
  await whoami(page, ['cleaning.audit']);
  await page.goto('/desayuno.html');
  await expect(page.locator('#noAccess')).toBeVisible();
  await expect(page.locator('#scanPanel')).toBeHidden();
});

test('aseo: sin cleaning.audit muestra "Sin acceso" y no pide la lista', async ({ page }) => {
  let checklistCalls = 0;
  await whoami(page, ['breakfast.status', 'breakfast.redeem']);
  await page.route('**/api/cleaning-checklist', route => { checklistCalls++; route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"No tienes permiso"}' }); });
  await page.goto('/aseo.html');
  await expect(page.locator('#noAccess')).toBeVisible();
  await expect(page.locator('#aptPanel')).toBeHidden();
  expect(checklistCalls).toBe(0);
});

test('aseo: con el rol aseo carga la lista de chequeo', async ({ page }) => {
  await whoami(page, ['cleaning.audit'], { roles: ['aseo'] });
  await page.route('**/api/cleaning-checklist', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ aiEnabled: true, items: [{ id: 'cama', label: 'Cama', hint: 'Tendida' }, { id: 'bano', label: 'Baño', hint: 'Limpio' }] })
  }));
  await page.goto('/aseo.html');
  await expect(page.locator('.item[data-item="cama"]')).toBeVisible();
  await expect(page.locator('.item[data-item="bano"]')).toBeVisible();
  await expect(page.locator('#noAccess')).toBeHidden();
});

test('/admin: un usuario sin permisos ve el aviso, no el formulario de cotización', async ({ page }) => {
  await whoami(page, ['cleaning.audit']);
  await page.goto('/cotizar-admin.html');
  await expect(page.getByText('No tienes permisos en este panel')).toBeVisible();
  await expect(page.locator('#viewNueva')).toBeHidden();
  await expect(page.locator('.admin-tab:visible')).toHaveCount(0);
});

test('/admin: recepción ve Ver/Enlace/Reenviar y un reenvío que no salió se reporta como fallo', async ({ page }) => {
  await whoami(page, ['quotes.view', 'quotes.send']);
  await page.route('**/api/list-quotes', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ quotes: [{ quoteId: 'COT-2026-ABCDE', empresa: 'Empresa Prueba', email: 'ana@empresa.test', status: 'activa', statusEfectivo: 'activa', checkin: '2026-11-10', checkout: '2026-11-12', items: [], views: 0, publicToken: 'pt' }] })
  }));
  let sendBody = null;
  await page.route('**/api/send-quote-email', route => {
    sendBody = JSON.parse(route.request().postData() || '{}');
    route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ sent: false, error: 'El correo no está configurado: la cotización NO se envió.' }) });
  });

  await page.goto('/cotizar-admin.html');
  await expect(page.locator('#pageTitle')).toHaveText('Cotizaciones');
  const row = page.locator('tr[data-id="COT-2026-ABCDE"]');
  await expect(row.locator('button[data-act="view"]')).toBeVisible();
  await expect(row.locator('button[data-act="resend"]')).toBeVisible();
  await expect(row.locator('button[data-act="edit"]')).toHaveCount(0);
  await expect(row.locator('button[data-act="cancel"]')).toHaveCount(0);
  await expect(row.locator('button[data-act="history"]')).toHaveCount(0);

  const dialogs = [];
  page.on('dialog', async d => {
    dialogs.push({ type: d.type(), message: d.message() });
    if (d.type() === 'prompt') await d.accept('ana@empresa.test');
    else await d.accept();
  });
  await row.locator('button[data-act="resend"]').click();
  await expect.poll(() => dialogs.length).toBe(2);
  expect(dialogs[0].type).toBe('prompt');
  expect(dialogs[1].message).toContain('No se reenvió');
  expect(sendBody.quoteId).toBe('COT-2026-ABCDE');
  expect(sendBody.clientEmail).toBe('ana@empresa.test');
});

test('/admin Configuración: alertas "por defecto" encendidas y probe de TTLock', async ({ page }) => {
  await whoami(page, ['settings.manage']);
  await page.route('**/api/admin-settings', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, settings: {
      ALERT_ENABLED: { meta: { type: 'bool', group: 'Operación', label: 'Alertas operativas', default: 'true' }, value: 'true', source: 'por defecto' },
      TTLOCK_ENABLED: { meta: { type: 'bool', group: 'Desayuno / chapas', label: 'Emitir códigos de chapa (TTLock)' }, value: '', source: 'sin definir' }
    } })
  }));
  await page.route('**/api/ttlock-probe', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      ok: true, config: { enabled: false, clientId: true, clientSecret: true, username: true, password: true },
      mapping: { defined: false, valid: true, entries: [] },
      locks: [{ lockId: 1001, name: 'S31', alias: 'Apto 101', battery: 87, hasGateway: true }],
      check: { entries: [], unmapped: [1001], suggested: { 101: 1001 }, pendingWithoutKey: [] }
    })
  }));

  await page.goto('/cotizar-admin.html');
  await expect(page.locator('#pageTitle')).toHaveText('Configuración');
  await expect(page.locator('input[data-cfg-key="ALERT_ENABLED"]')).toBeChecked();
  await expect(page.locator('input[data-cfg-key="TTLOCK_ENABLED"]')).not.toBeChecked();

  await page.click('#ttlockProbeBtn');
  await expect(page.getByText(/Conexión correcta · 1 chapa/)).toBeVisible();
  await expect(page.locator('#ttlockResult')).toContainText('Apto 101');
  await expect(page.locator('#ttlockSuggested')).toHaveValue('{"101":1001}');
});
