const { test, expect } = require('@playwright/test');

/* Frente "stay": el enlace del correo de pre-llegada (guest.html?code=…&tab=checkin)
   prellena el código y abre el check-in; "Mi estadía" se descubre desde el home
   (ES/EN), el menú móvil y el pie; y la app ya no promete códigos de acceso. */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('estar-cookie-consent-v1', JSON.stringify({ choice: 'denied', at: Date.now() }));
    } catch (e) {}
  });
  await page.route('https://unpkg.com/lucide@*/**', route => route.fulfill({
    contentType: 'application/javascript',
    body: 'window.lucide={createIcons:function(){}};'
  }));
  await page.route('**/api/get-booking-rating', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ rating: 9.1, reviewsCount: 126, locationRating: 9.4 })
  }));
  await page.route('**/api/check-availability**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ rooms: [] })
  }));
});

const booking = {
  bookingCode: '45821', status: 'confirmed', guestName: 'Andrea Restrepo', guestEmail: 'andrea@example.com',
  roomName: 'Apartaestudio Seleccion', roomNumber: '402', capacity: 2,
  checkIn: '2026-10-10', checkOut: '2026-10-12', nights: 2, totalAmount: 530000, canCancel: true, canModify: true
};

test('el enlace del correo de pre-llegada prellena el código y, al entrar, abre el check-in', async ({ page }) => {
  const captured = [];
  await page.route('**/api/guest-session', async route => {
    captured.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, token: 't', booking }) });
  });
  await page.goto('/guest.html?code=45821&tab=checkin');
  await expect(page.locator('#bookingCode')).toHaveValue('45821');
  /* el apellido sigue siendo obligatorio (segundo factor) */
  await expect(page.locator('#accessKey')).toHaveValue('');
  await page.locator('#accessKey').fill('Restrepo');
  await page.locator('#guestLoginForm button[type="submit"]').click();
  await expect(page.locator('#guestShell')).toBeVisible();
  await expect(page.locator('[data-guest-panel="checkin"]')).toHaveClass(/is-active/);
  expect(captured[0]).toEqual({ bookingCode: '45821', accessKey: 'Restrepo' });
});

test('un código con caracteres raros en el enlace no se prellena', async ({ page }) => {
  await page.goto('/guest.html?code=%3Cscript%3E&tab=nada');
  await expect(page.locator('#bookingCode')).toHaveValue('');
  await expect(page.locator('#guestAccess')).toBeVisible();
});

test('la app del huésped ya no promete códigos de acceso: instrucciones por correo y recepción', async ({ page }) => {
  await page.goto('/guest.html');
  const html = await page.content();
  expect(html).not.toMatch(/te mostraremos las instrucciones de llegada y acceso/);
  expect(html).toContain('Completa el registro antes de llegar desde aquí');
  expect(html).not.toMatch(/te enviamos (por correo )?las instrucciones de llegada/i);
  expect(html).toContain('¿Cómo ingreso a mi apartaestudio?');
});

test('"Mi estadía" / "My stay" en el encabezado del home ES y EN (escritorio)', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'En móvil el enlace va dentro del menú');
  await page.goto('/');
  await expect(page.locator('.header-actions .guest-entry-link')).toBeVisible();
  await expect(page.locator('.header-actions .guest-entry-link')).toHaveText('Mi estadía');
  await page.goto('/en/index.html');
  const en = page.locator('.header-actions .guest-entry-link');
  await expect(en).toBeVisible();
  await expect(en).toHaveText('My stay');
  await expect(en).toHaveAttribute('href', 'guest.html');
  /* en escritorio el ítem del menú queda oculto (no se duplica) */
  await expect(page.locator('.nav-list .nav-guest-item')).toBeHidden();
});

test('"My stay" aparece en el menú móvil del sitio en inglés y lleva a la app', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Solo móvil');
  await page.goto('/en/faq.html');
  await page.locator('.menu-btn').click();
  const item = page.locator('.nav-list .nav-guest-item a');
  await expect(item).toBeVisible();
  await expect(item).toHaveText('My stay');
  await item.click();
  /* La versión en inglés de la app (/en/guest.html), no la española. */
  await expect(page).toHaveURL(/\/en\/guest\.html$/);
});

test('el pie de página enlaza a "Mi estadía" (ES) y "My stay" (EN)', async ({ page }) => {
  await page.goto('/faq.html');
  const es = page.locator('.site-footer a[data-i18n="footer_mi_estadia"]');
  await expect(es).toHaveText('Mi estadía (check-in en línea)');
  await expect(es).toHaveAttribute('href', 'guest.html');
  await page.goto('/en/faq.html');
  const en = page.locator('.site-footer a[data-i18n="footer_mi_estadia"]');
  await expect(en).toHaveText('My stay (online check-in)');
  await expect(en).toHaveAttribute('href', 'guest.html');
});
