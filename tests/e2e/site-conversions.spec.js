const { test, expect } = require('@playwright/test');

/* Frente site — conversiones GA4 y preferencias de cookies.
   gtag.js real se reemplaza por un script vacío: el `gtag()` inline del build
   empuja cada llamada a window.dataLayer, que es lo que se inspecciona. */

/* Flujos de varios pasos (llenar, enviar, esperar): margen extra para máquinas
   cargadas; las aserciones no dependen del tiempo. */
test.describe.configure({ timeout: 60000 });

async function setup(page, { consent = 'denied' } = {}) {
  /* Imágenes, video, fuentes y el mapa embebido no importan aquí: se cortan para
     que la página cargue y se cierre rápido. */
  await page.route(/\.(?:webp|png|jpe?g|gif|svg|mp4|woff2?)(?:\?.*)?$/i, route => route.abort());
  await page.route('https://www.google.com/maps/**', route => route.abort());
  await page.context().route('https://www.googletagmanager.com/**', route => route.fulfill({
    contentType: 'application/javascript',
    body: ''
  }));
  await page.route('https://unpkg.com/lucide@*/**', route => route.fulfill({
    contentType: 'application/javascript',
    body: 'window.lucide={createIcons:function(){}};'
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
  /* Elección de cookies previa (el banner no tapa la UI). */
  await page.addInitScript((choice) => {
    try {
      if (sessionStorage.getItem('e2e-keep-consent')) return;
      localStorage.setItem('estar-cookie-consent-v1', JSON.stringify({ choice, at: Date.now() }));
    } catch (e) {}
  }, consent);
}

/* Llamadas gtag('event', name, params) registradas en dataLayer. */
function gaEvents(page, name) {
  return page.evaluate((n) => (window.dataLayer || [])
    .map((entry) => { try { return Array.from(entry); } catch (e) { return []; } })
    .filter((a) => a[0] === 'event' && a[1] === n), name);
}

/* Netlify Forms: el POST a "/" se responde aquí (no hay backend en e2e). */
async function mockNetlifyForms(page, status) {
  const posts = [];
  // Solo la raíz: interceptar todas las rutas frenaba cada imagen de la página.
  await page.route((url) => url.pathname === '/', (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      posts.push(req.postData() || '');
      return route.fulfill({ status, contentType: 'text/plain', body: status === 200 ? 'ok' : 'error' });
    }
    return route.fallback();
  });
  return posts;
}

/* Marca un checkbox sin depender de coordenadas (el aviso flotante "¿Te podemos
   ayudar?" aparece a los 4 s y puede tapar el clic). */
async function tick(locator) {
  await locator.evaluate((el) => {
    el.checked = true;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function fillConvenio(page) {
  const form = page.locator('form[name="convenios-empresas"]');
  await form.locator('input[name="empresa"]').fill('ACME SAS');
  await form.locator('input[name="contacto"]').fill('Ana Gómez');
  await form.locator('input[name="email"]').fill('ana@acme.co');
  await form.locator('input[name="whatsapp"]').fill('+57 300 111 2233');
  await tick(form.locator('input[name="aceptar_politica"]'));
  return form;
}

test('convenio empresarial: generate_lead solo tras el envío exitoso y sin datos personales', async ({ page }) => {
  await setup(page);
  const posts = await mockNetlifyForms(page, 200);
  await page.goto('/empresas.html', { waitUntil: 'domcontentloaded' });

  const form = await fillConvenio(page);
  expect(await gaEvents(page, 'generate_lead')).toHaveLength(0);
  await form.evaluate((f) => f.requestSubmit());
  await expect(form.locator('button[type="submit"]')).toContainText(/Recibido/);

  expect(posts).toHaveLength(1);
  expect(posts[0]).toContain('form-name=convenios-empresas');
  const events = await gaEvents(page, 'generate_lead');
  expect(events).toHaveLength(1);
  expect(events[0][2]).toMatchObject({ form_name: 'convenios-empresas', lead_type: 'convenio_empresarial', page_language: 'es' });
  const serialized = JSON.stringify(events);
  for (const pii of ['ACME', 'Ana', 'ana@acme.co', '300 111']) expect(serialized).not.toContain(pii);
});

test('si el envío del formulario falla no se registra la conversión', async ({ page }) => {
  await setup(page);
  await mockNetlifyForms(page, 500);
  page.on('dialog', (dialog) => dialog.dismiss());
  await page.goto('/empresas.html', { waitUntil: 'domcontentloaded' });

  const form = await fillConvenio(page);
  await form.evaluate((f) => f.requestSubmit());
  await expect(form.locator('button[type="submit"]')).toBeEnabled();
  expect(await gaEvents(page, 'generate_lead')).toHaveLength(0);
});

test('larga estadía en inglés también cuenta como lead (form estancias-largas-en)', async ({ page }) => {
  await setup(page);
  await mockNetlifyForms(page, 200);
  await page.goto('/en/vivir.html', { waitUntil: 'domcontentloaded' });

  const form = page.locator('form[name="estancias-largas-en"]');
  await form.locator('input[name="nombre"]').fill('Alex Johnson');
  await form.locator('input[name="correo"]').fill('alex@mail.com');
  await form.locator('input[name="fecha_mudanza"]').fill('2027-01-15');
  await tick(form.locator('input[name="habeas_data"]'));
  await form.evaluate((f) => f.requestSubmit());
  await expect(form.locator('button[type="submit"]')).toContainText(/Request sent/);

  const events = await gaEvents(page, 'generate_lead');
  expect(events).toHaveLength(1);
  expect(events[0][2]).toMatchObject({ form_name: 'estancias-largas-en', lead_type: 'larga_estadia', page_language: 'en' });
});

test('cotización corporativa: exige la política, envía el opt-in y registra generate_lead', async ({ page }) => {
  await setup(page);
  let body = null;
  await page.route('**/api/request-quote', async (route) => {
    body = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"received":true}' });
  });
  await page.goto('/empresas.html', { waitUntil: 'domcontentloaded' });

  const form = page.locator('#requestQuoteForm');
  await form.locator('#rqEmpresa').fill('Hospital de Caldas');
  await form.locator('#rqContacto').fill('María Restrepo');
  await form.locator('#rqEmail').fill('m.restrepo@hc.co');
  await tick(form.locator('input[name="marketingOptIn"]'));

  /* Sin aceptar la política el formulario no es válido y no se envía. */
  expect(await form.evaluate((f) => f.checkValidity())).toBe(false);
  await form.evaluate((f) => f.requestSubmit());
  expect(body).toBeNull();

  await tick(form.locator('#rqPolitica'));
  await form.evaluate((f) => f.requestSubmit());
  await expect(page.locator('#requestQuoteSuccess')).toBeVisible();

  expect(body).toMatchObject({ empresa: 'Hospital de Caldas', email: 'm.restrepo@hc.co', marketingOptIn: true });
  const events = await gaEvents(page, 'generate_lead');
  expect(events).toHaveLength(1);
  expect(events[0][2]).toMatchObject({ form_name: 'cotizacion-corporativa', lead_type: 'cotizacion_corporativa' });
});

test('clic en WhatsApp del botón flotante registra el evento contact', async ({ page }) => {
  await setup(page);
  await page.goto('/empresas.html', { waitUntil: 'domcontentloaded' });
  /* Que el clic no abra WhatsApp de verdad. */
  await page.evaluate(() => document.addEventListener('click', (e) => e.preventDefault()));

  await page.locator('#contactFloat .ci-whatsapp').evaluate((a) => a.click());
  const events = await gaEvents(page, 'contact');
  expect(events).toHaveLength(1);
  expect(events[0][2]).toMatchObject({ method: 'whatsapp', link_location: 'boton_flotante' });
});

test('"Configurar cookies" del footer reabre el banner y rechazar borra las cookies de Analytics', async ({ page }) => {
  await setup(page, { consent: 'granted' });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    sessionStorage.setItem('e2e-keep-consent', '1');
    document.cookie = '_ga=GA1.1.123.456; path=/';
    document.cookie = '_ga_9PB0Z2KQJK=GS1.1.1; path=/';
    document.cookie = 'otra=1; path=/';
  });
  await expect(page.locator('.cookie-consent')).toHaveCount(0);

  const settings = page.locator('footer .cookie-settings-link');
  await expect(settings).toHaveCount(1);
  await expect(settings).toHaveText('Configurar cookies');
  await settings.evaluate((b) => b.click());

  const banner = page.locator('.cookie-consent');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Ahora: aceptadas.');
  await banner.getByRole('button', { name: /rechazar/i }).click();
  await expect(banner).toHaveCount(0);

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('estar-cookie-consent-v1') || 'null'));
  expect(stored && stored.choice).toBe('denied');
  const cookies = await page.evaluate(() => document.cookie);
  expect(cookies).not.toContain('_ga=');
  expect(cookies).not.toContain('_ga_9PB0Z2KQJK');
  expect(cookies).toContain('otra=1');

  /* Tras recargar se respeta la nueva elección (sin banner). */
  await page.reload();
  await expect(page.locator('.cookie-consent')).toHaveCount(0);
});

test('la política de cookies en inglés tiene su botón "Cookie settings" que abre el banner', async ({ page }) => {
  await setup(page);
  await page.goto('/en/cookies.html', { waitUntil: 'domcontentloaded' });
  const inPage = page.locator('main [data-cookie-settings]');
  await expect(inPage).toHaveText('Cookie settings');
  await expect(page.locator('footer .cookie-settings-link')).toHaveText('Cookie settings');
  await inPage.click();
  const banner = page.locator('.cookie-consent');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Currently: rejected.');
  await banner.getByRole('button', { name: /accept/i }).click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('estar-cookie-consent-v1') || 'null'));
  expect(stored && stored.choice).toBe('granted');
});
