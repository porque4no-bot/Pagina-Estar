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
  /* Seed a consent choice so the cookie banner doesn't overlay the UI in
     unrelated tests. The dedicated banner test below removes this seed. */
  await page.addInitScript(() => {
    /* try/catch: init scripts also run inside third-party iframes where
       localStorage access can be denied and would surface as a pageerror.
       The dedicated banner test opts out via the sessionStorage flag. */
    try {
      if (sessionStorage.getItem('e2e-no-consent-seed')) return;
      localStorage.setItem('estar-cookie-consent-v1', JSON.stringify({ choice: 'denied', at: Date.now() }));
    } catch (e) {}
  });
});

test('cookie consent banner appears on first visit and accept persists', async ({ page }) => {
  /* Init scripts run in registration order: this one runs after the shared
     seed. On the first navigation it wipes the seed (first-visit state) and
     sets the opt-out flag (sessionStorage survives reload), so the reload
     below keeps whatever choice the banner stored. */
  await page.addInitScript(() => {
    try {
      if (!sessionStorage.getItem('e2e-no-consent-seed')) {
        localStorage.removeItem('estar-cookie-consent-v1');
        sessionStorage.setItem('e2e-no-consent-seed', '1');
      }
    } catch (e) {}
  });
  await page.goto('/index.html');

  const banner = page.locator('.cookie-consent');
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: /aceptar|accept/i }).click();
  await expect(banner).toHaveCount(0);

  /* The choice is persisted: on reload the banner must not come back. */
  await page.reload();
  await expect(page.locator('.cookie-consent')).toHaveCount(0);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('estar-cookie-consent-v1') || 'null'));
  expect(stored && stored.choice).toBe('granted');
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
