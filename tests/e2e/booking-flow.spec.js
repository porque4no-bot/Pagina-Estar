const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  /* Seed a consent choice so the cookie banner doesn't overlay the booking UI
     (it intercepts taps on mobile). The banner itself is tested in site.spec. */
  await page.addInitScript(() => {
    /* try/catch: init scripts also run inside third-party iframes where
       localStorage access can be denied and would surface as a pageerror. */
    try {
      localStorage.setItem('estar-cookie-consent-v1', JSON.stringify({ choice: 'denied', at: Date.now() }));
    } catch (e) {}
  });
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

test('extras: late check-out (%), an early-check-in tier and a pet update the summary', async ({ page }) => {
  // Mock room avgPrice = 250.000 → late 15% = 37.500, early tier 2 35% = 87.500, pet = 200.000 (flat).
  await page.goto('/reservar.html?checkin=2026-08-10&checkout=2026-08-13&guests=2');
  await expect(page.locator('.be-room-card')).toBeVisible();
  await page.locator('.be-room-select-btn').first().click();
  await expect(page.locator('.be-step-active .be-step-title')).toHaveText('Extras y servicios');

  // Inputs are visually hidden (the ✶ is the visible control), so click the labels.
  // Late check-out (percentage-of-night checkbox)
  await page.locator('.be-extra-row', { hasText: 'Late check-out' }).click();
  // Early check-in: tier 2 (radio, "Desde las 10:00 am")
  await page.locator('.be-extra-tier').nth(1).click();
  // Mascota (flat, IVA included)
  await page.locator('.be-extra-row', { hasText: 'Mascota' }).click();

  const summary = page.locator('.be-summary-breakdown');
  await expect(summary).toContainText('Late check-out');
  await expect(summary).toContainText('Early check-in');
  await expect(summary).toContainText('Mascota');
  await expect(summary).toContainText('$ 37.500');   // late = 15% of 250.000
  await expect(summary).toContainText('$ 87.500');   // early tier 2 = 35% of 250.000
  await expect(summary).toContainText('$ 200.000');  // pet flat charge
});
