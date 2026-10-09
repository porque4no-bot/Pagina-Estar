const { test, expect } = require('@playwright/test');

/* Fechas siempre en el futuro: las fijas (ago-2026) quedaron en el pasado y el
   motor las rechaza con razón. */
const futureDate = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const D1 = futureDate(30), D2 = futureDate(31), D4 = futureDate(33), D5 = futureDate(34);

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
  await page.goto(`/reservar.html?checkin=${D1}&checkout=${D4}&guests=2`);
  await expect(page.locator('.be-room-card')).toBeVisible();

  await page.locator('.be-searchbar-edit').click();
  const dateInputs = page.locator('.be-searchform-fields input[type="date"]');
  await dateInputs.nth(0).fill(D2);
  await dateInputs.nth(1).fill(D5);
  await page.locator('.be-searchform-fields select').selectOption('2');

  const refreshedAvailability = page.waitForRequest(request => {
    const url = request.url();
    return url.includes('/api/check-availability')
      && url.includes(`checkin=${D2}`)
      && url.includes(`checkout=${D5}`)
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

test('extras: late check-out and a pet update the summary', async ({ page }) => {
  // Mock room avgPrice = 250.000 → late 15% = 37.500, pet = 200.000 (flat).
  // Early check-in ya NO se vende en el motor (solo en el check-in) → no aparece aquí.
  await page.goto(`/reservar.html?checkin=${D1}&checkout=${D4}&guests=2`);
  await expect(page.locator('.be-room-card')).toBeVisible();
  await page.locator('.be-room-select-btn').first().click();
  await expect(page.locator('.be-step-active .be-step-title')).toHaveText('Extras y servicios');

  // Inputs are visually hidden (the ✶ is the visible control), so click the labels.
  await page.locator('.be-extra-row', { hasText: 'Late check-out' }).click();
  await page.locator('.be-extra-row', { hasText: 'Mascota' }).click();

  // Early check-in fue removido del motor: no debe ofrecerse.
  await expect(page.locator('.be-extra-row', { hasText: 'Early check-in' })).toHaveCount(0);

  const summary = page.locator('.be-summary-breakdown');
  await expect(summary).toContainText('Late check-out');
  await expect(summary).toContainText('Mascota');
  await expect(summary).toContainText('$ 37.500');   // late = 15% of 250.000
  await expect(summary).toContainText('$ 200.000');  // pet flat charge
});

/* Producción oct-2026: al volver de Mercado Pago el huésped quedaba en el motor
   con un aviso técnico ("…con Kunas… webhook…"). Debe ver la confirmación. */
test('returning from Mercado Pago shows the booking confirmation', async ({ page }) => {
  await page.addInitScript(([ci, co]) => {
    try {
      sessionStorage.setItem('estar-booking-draft', JSON.stringify({
        savedAt: Date.now(),
        search: { checkin: ci, checkout: co, guests: 2 },
        selectedRoom: { id: 'clasica', roomTypeId: '31348', name: 'Clásica', priceFlexible: 250000, num: '01', area: 32, capacity: 2 },
        selectedRate: 'best',
        currentStep: 'payment',
        extras: {},
        guestData: { nombre: 'Ana', apellido: 'Prueba', email: 'ana@example.com', tel: '3000000000', pais: 'Colombia' },
        paymentMethod: 'mercadopago'
      }));
      sessionStorage.setItem('estar-mp-pending', JSON.stringify({ code: 'EST-TEST1', savedAt: Date.now() }));
    } catch (e) {}
  }, [D1, D4]);
  await page.route('**/api/booking-status**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ status: 'confirmed', ref: 'EST-TEST1', bookingCode: 'EST-TEST1', otasyncId: 123, reservationPending: false })
  }));
  /* Frente confirm: el correo de confirmación lo manda SOLO el servidor; el
     navegador no debe llamar al endpoint (retirado). */
  const confirmationCalls = [];
  page.on('request', req => { if (req.url().includes('/api/send-confirmation')) confirmationCalls.push(req.url()); });

  await page.goto('/reservar.html?payment=success&payment_id=999&status=approved');
  await expect(page.locator('.be-confirmation')).toBeVisible();
  await expect(page.locator('.be-confirm-hero h2')).toHaveText('¡Reserva confirmada!');
  expect(confirmationCalls).toEqual([]);
  await expect(page.locator('body')).not.toContainText('webhook');
  await expect(page.locator('body')).not.toContainText('Kunas');
  await expect(page).not.toHaveURL(/payment=success/);
});

/* Frente MP (oct-2026): Mercado Pago ignoraba el descuento (cobraba el monto
   completo) y no mandaba la nota, el opt-in de marketing, el plan ni el idioma.
   La preferencia ahora recibe lo mismo que la firma de Wompi. */
test('Mercado Pago sends the discounted amount, discount code, notes, opt-in, rate plan and language', async ({ page }) => {
  let subtotalCents = null;
  await page.route('**/api/validate-discount-code**', route => {
    const u = new URL(route.request().url());
    if (u.searchParams.get('code') === '__probe__') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: true, valid: false, reason: 'invalid' }) });
    }
    subtotalCents = Number(u.searchParams.get('subtotalCents'));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: true, valid: true, code: 'RESENA10', discountCents: 5000000 }) });
  });
  let prefBody = null;
  await page.route('**/api/create-mercadopago-preference', route => {
    prefBody = JSON.parse(route.request().postData() || '{}');
    /* Respondemos un error controlado para quedarnos en la página (sin ir a MP). */
    return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'sold_out' }) });
  });

  await page.goto(`/reservar.html?checkin=${D1}&checkout=${D4}&guests=2`);
  await expect(page.locator('.be-room-card')).toBeVisible();
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
  await page.locator('#guest-notas').fill('Llegamos tarde, tipo 10 pm');
  await page.locator('#guest-privacy').check();
  await page.locator('#guest-marketing').check();
  await page.locator('.be-step-active form button[type="submit"]').click();

  await expect(page.locator('.be-step-active .be-step-title')).toHaveText('Resumen y pago');
  await page.locator('.be-step-active input[placeholder="Ingresa tu código"]').fill('resena10');
  await page.locator('.be-step-active button', { hasText: 'Aplicar' }).click();
  await expect(page.locator('.be-step-active')).toContainText('RESENA10');

  await page.locator('.be-step-active .be-payment-opt', { hasText: 'Mercado Pago' }).click();
  await page.locator('.be-step-active .be-step-footer .be-btn-primary').click();
  await expect.poll(() => prefBody).not.toBeNull();

  expect(subtotalCents).toBeGreaterThan(5000000);
  expect(prefBody.amountCents).toBe(subtotalCents - 5000000);
  expect(prefBody.discountCode).toBe('RESENA10');
  expect(prefBody.notes).toBe('Llegamos tarde, tipo 10 pm');
  expect(prefBody.marketingOptIn).toBe(true);
  expect(['best', 'flexible']).toContain(prefBody.ratePlan);
  expect(prefBody.lang).toBe('es');
  /* El error controlado se muestra sin códigos internos. */
  await expect(page.locator('.be-step-active .be-info-error')).toBeVisible();
});

/* Frente confirm: si el webhook aún no registró la reserva (pendiente / timeout),
   el huésped ve "Pago recibido" y que le confirmaremos por correo — nunca
   "Reserva confirmada" — y el navegador no pide ningún correo. */
function seedMpDraft(page, code) {
  return page.addInitScript(([ci, co, c]) => {
    try {
      sessionStorage.setItem('estar-booking-draft', JSON.stringify({
        savedAt: Date.now(),
        search: { checkin: ci, checkout: co, guests: 2 },
        selectedRoom: { id: 'clasica', roomTypeId: '31348', name: 'Clásica', priceFlexible: 250000, num: '01', area: 32, capacity: 2 },
        selectedRate: 'best',
        currentStep: 'payment',
        extras: {},
        guestData: { nombre: 'Ana', apellido: 'Prueba', email: 'ana@example.com', tel: '3000000000', pais: 'Colombia' },
        paymentMethod: 'mercadopago'
      }));
      sessionStorage.setItem('estar-mp-pending', JSON.stringify({ code: c, savedAt: Date.now() }));
    } catch (e) {}
  }, [D1, D4, code]);
}

test('pending reservation shows "payment received" and never claims it is confirmed', async ({ page }) => {
  await seedMpDraft(page, 'EST-PEND1');
  await page.route('**/api/booking-status**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ status: 'confirmed', ref: 'EST-PEND1', bookingCode: 'EST-PEND1', reservationPending: true })
  }));
  const confirmationCalls = [];
  page.on('request', req => { if (req.url().includes('/api/send-confirmation')) confirmationCalls.push(req.url()); });

  await page.goto('/reservar.html?payment=success&payment_id=998&status=approved');
  await expect(page.locator('.be-confirmation')).toBeVisible();
  await expect(page.locator('.be-confirm-hero h2')).toHaveText('Pago recibido');
  await expect(page.locator('.be-confirm-hero')).toContainText('EST-PEND1');
  await expect(page.locator('.be-confirm-hero')).toContainText('ana@example.com');
  await expect(page.locator('.be-pending-box')).toContainText('te enviaremos la confirmación por correo');
  await expect(page.locator('.be-confirmation')).not.toContainText('Reserva confirmada');
  await expect(page.locator('.be-confirmation')).not.toContainText('confirmada');
  await expect(page.locator('body')).not.toContainText('Kunas');
  expect(confirmationCalls).toEqual([]);
});

test('Mercado Pago return without a draft does not claim the booking is confirmed', async ({ page }) => {
  await page.goto(`/reservar.html?checkin=${D1}&checkout=${D4}&guests=2&payment=success`);
  const notice = page.locator('.be-info-box').first();
  await expect(notice).toContainText('Pago recibido');
  await expect(notice).toContainText('Te enviaremos la confirmación de tu reserva por correo');
  await expect(notice).not.toContainText('confirmada');
});
