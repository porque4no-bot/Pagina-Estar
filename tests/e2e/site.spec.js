const { test, expect } = require('@playwright/test');

async function mockSharedDependencies(page) {
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
    body: JSON.stringify({ rooms: [] })
  }));
}

test.beforeEach(async ({ page }) => {
  await mockSharedDependencies(page);
});

test('home page exposes the main booking and guest journeys', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page).toHaveTitle(/Estar/i);
  await expect(page.locator('.site-header')).toBeVisible();
  await expect(page.locator('#reservar')).toBeAttached();
  await expect(page.locator('a[href="guest.html"]').first()).toBeAttached();
  expect(pageErrors).toEqual([]);
});

test('booking bar carries dates and guests into the booking engine', async ({ page }) => {
  await page.goto('/');
  await page.locator('#checkin-input').evaluate(element => {
    element.value = '2026-08-10';
  });
  await page.locator('#checkout-input').evaluate(element => {
    element.value = '2026-08-13';
  });
  await page.locator('#guests-input').evaluate(element => {
    element.value = '2';
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.locator('#reservar').evaluate(form => form.requestSubmit());

  await expect(page).toHaveURL(/reservar\.html\?checkin=2026-08-10&checkout=2026-08-13&guests=2/);
});

const publicPages = [
  ['home', '/', /Estar/i],
  ['booking engine', '/reservar.html', /reserv/i],
  ['local guide', '/explora.html', /explor|Manizales/i],
  ['privacy policy', '/privacidad.html', /privacidad/i],
  ['guest app', '/guest.html', /estad[ií]a|guest/i],
  ['English home', '/en/index.html', /Estar/i]
];

for (const [name, url, title] of publicPages) {
  test(`${name} page renders successfully`, async ({ page }) => {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
    expect(response.status(), url).toBe(200);
    await expect(page).toHaveTitle(title);
  });
}

test('mobile navigation can be opened', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile-only behavior');
  await page.goto('/');
  await page.locator('.menu-btn').click();
  await expect(page.locator('.site-header')).toHaveClass(/menu-open/);
  await expect(page.locator('.nav-list')).toBeVisible();
});
