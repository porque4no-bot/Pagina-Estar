const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.route('https://unpkg.com/lucide@*/**', route => route.fulfill({
    contentType: 'application/javascript',
    body: 'window.lucide={createIcons:function(){}};'
  }));
  await page.route('https://checkout.wompi.co/**', route => route.fulfill({
    contentType: 'application/javascript',
    body: ''
  }));
  await page.route('**/api/get-booking-rating', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ rating: 9.1, reviewsCount: 126, locationRating: 9.4 })
  }));
  await page.route('**/api/check-availability**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      rooms: [{
        id_room_types: '31348',
        name: 'Clásica',
        avgPrice: 250_000,
        available: 2,
        totalPrice: 750_000,
        capacity: 2
      }]
    })
  }));
});

test('booking flow reaches the Wompi payment step', async ({ page }) => {
  await page.goto('/reservar.html?checkin=2026-08-10&checkout=2026-08-13&guests=2');
  await expect(page.locator('.be-room-card')).toBeVisible();

  await page.locator('.be-searchbar-edit').click();
  const dateInputs = page.locator('.be-searchform-fields input[type="date"]');
  await dateInputs.nth(0).fill('2026-08-11');
  await dateInputs.nth(1).fill('2026-08-14');
  await page.locator('.be-searchform-fields select').selectOption('2');

  const refreshedAvailability = page.waitForRequest(request => {
    const url = request.url();
    return url.includes('/api/check-availability')
      && url.includes('checkin=2026-08-11')
      && url.includes('checkout=2026-08-14')
      && url.includes('guests=2');
  });
  await page.locator('.be-searchform-fields button[type="submit"]').click();
  await refreshedAvailability;

  await page.locator('.be-room-select-btn').first().click();
  await expect(page.locator('.be-step-active .be-step-title')).toHaveText('Extras y servicios');
  await page.locator('.be-step-active .be-btn-primary').click();

  await expect(page.locator('.be-step-active .be-step-title')).toHaveText('Datos del huésped');
  await page.locator('#guest-nombre').fill('Andrea');
  await page.locator('#guest-apellido').fill('Restrepo');
  await page.locator('#guest-email').fill('andrea.qa@example.com');
  await page.locator('#guest-tel').fill('+57 300 111 2233');
  await page.locator('#guest-pais').selectOption('Colombia');
  await page.locator('#guest-motivo').selectOption('Turismo / Vacaciones');
  await page.locator('#guest-privacy').check();
  await page.locator('.be-step-active form button[type="submit"]').click();

  await expect(page.locator('.be-step-active .be-step-title')).toHaveText('Resumen y pago');
  await expect(page.locator('.be-step-active .be-payment-opt.active')).toContainText('Wompi');
  await expect(page.locator('.be-step-active')).toContainText('Paga de manera segura');
  await expect(page.locator('.be-step-active .be-step-footer .be-btn-primary')).toBeEnabled();
});
