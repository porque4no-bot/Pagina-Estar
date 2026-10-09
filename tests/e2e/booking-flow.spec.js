const { test, expect } = require('@playwright/test');

/* Fechas siempre en el futuro: las fijas (ago-2026) quedaron en el pasado y el
   motor las rechaza con razón. */
const futureDate = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const D1 = futureDate(30), D2 = futureDate(31), D4 = futureDate(33), D5 = futureDate(34);
const bogotaToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

/* external_reference de Mercado Pago (espejo de _payments.createDirectReference). */
function mpReference(parts) {
  return 'MPDIR-' + Buffer.from(parts.join('|'), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

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
  await page.route('**/api/send-confirmation**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"sent":true}' }));
});

/* Elige la tarifa de la primera tarjeta y la selecciona (la tarifa ya no viene
   preseleccionada: la elección es explícita). */
async function chooseFirstRoom(page, rate = 'Flexible') {
  const card = page.locator('.be-room-card').first();
  await card.locator('.be-rate-opt', { hasText: rate }).click();
  await card.locator('.be-room-select-btn').click();
}

async function fillGuestAndContinue(page) {
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
}

/* Widget de Wompi falso: devuelve la transacción con el estado pedido. */
async function mockWompiCheckout(page, status) {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'WOMPI_PUBLIC_KEY', { get() { return 'pub_test_e2e'; }, set() {}, configurable: false });
  });
  await page.route('https://checkout.wompi.co/**', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.WidgetCheckout = function (cfg) {
      window.__wompiCfg = cfg;
      this.open = function (cb) {
        setTimeout(function () {
          cb({ transaction: { id: 'tx-e2e-1', status: ${JSON.stringify(status)}, payment_method_type: 'PSE', reference: cfg.reference } });
        }, 50);
      };
    };`
  }));
  await page.route('**/api/create-wompi-signature', async route => {
    const body = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ signature: { integrity: 'sig-e2e' }, amountInCents: body.amountInCents, reference: body.reference })
    });
  });
}

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

  await chooseFirstRoom(page);
  await expect(page.locator('.be-step-active .be-step-title')).toHaveText('Extras y servicios');
  await page.locator('.be-step-active .be-btn-primary').click();

  await fillGuestAndContinue(page);
  await expect(page.locator('.be-step-active .be-payment-opt.active')).toContainText('Wompi');
  await expect(page.locator('.be-step-active')).toContainText('Paga de manera segura');
  await expect(page.locator('.be-step-active .be-step-footer .be-btn-primary')).toBeEnabled();
});

test('the rate must be chosen explicitly (no hidden Flexible default)', async ({ page }) => {
  await page.goto(`/reservar.html?checkin=${D1}&checkout=${D4}&guests=2`);
  const card = page.locator('.be-room-card').first();
  await expect(card.locator('.be-rate-heading')).toHaveText('Elige tu tarifa');
  await expect(card.locator('.be-rate-opt[aria-checked="true"]')).toHaveCount(0);
  await expect(card.locator('.be-room-total')).toContainText('Desde');

  await card.locator('.be-room-select-btn').click();
  await expect(card.locator('.be-rate-hint')).toBeVisible();
  await expect(page.locator('.be-step-active .be-step-title')).toHaveText('Elige tu apartaestudio');

  await card.locator('.be-rate-opt', { hasText: 'Estricta' }).click();
  await expect(card.locator('.be-rate-opt[aria-checked="true"]')).toContainText('Estricta');
  await card.locator('.be-room-select-btn').click();
  await expect(page.locator('.be-step-active .be-step-title')).toHaveText('Extras y servicios');
  await expect(page.locator('.be-step-complete .be-step-summary').first()).toContainText('Estricta');
});

test('extras: late check-out and a pet update the summary', async ({ page }) => {
  // Mock room avgPrice = 250.000 → late 15% = 37.500, pet = 200.000 (flat).
  // Early check-in ya NO se vende en el motor (solo en el check-in) → no aparece aquí.
  await page.goto(`/reservar.html?checkin=${D1}&checkout=${D4}&guests=2`);
  await expect(page.locator('.be-room-card')).toBeVisible();
  await chooseFirstRoom(page);
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

test('a room preselected from its page cannot be booked over capacity', async ({ page }) => {
  /* Antes: ?room=clasica&guests=4 saltaba al paso 2 y se pagaba una Clásica (2
     personas) para 4. Ahora se queda en el paso 1, avisa y no deja elegirla. */
  await page.goto(`/reservar.html?checkin=${D1}&checkout=${D4}&guests=4&room=clasica`);
  await expect(page.locator('.be-step-active .be-step-title')).toHaveText('Elige tu apartaestudio');
  await expect(page.locator('.be-capacity-notice')).toContainText('admite hasta 2 personas');
  const card = page.locator('.be-room-card[data-room="clasica"]');
  await expect(card).toHaveClass(/be-room-unavailable/);
  await expect(card.locator('.be-room-unavailable-msg')).toContainText('hasta 2 personas');
  await expect(card.locator('.be-room-select-btn')).toHaveCount(0);

  /* El selector de huéspedes llega a 5 (Selección admite 5). */
  await page.locator('.be-searchbar-edit').click();
  await expect(page.locator('.be-searchform-fields select option')).toHaveCount(5);
  await expect(page.locator('.be-searchform-fields select option').last()).toHaveText('5 personas');
});

test('a room preselected from its page is highlighted and waits for an explicit rate', async ({ page }) => {
  await page.goto(`/reservar.html?checkin=${D1}&checkout=${D4}&guests=2&room=clasica`);
  await expect(page.locator('.be-step-active .be-step-title')).toHaveText('Elige tu apartaestudio');
  const card = page.locator('.be-room-card').first();
  await expect(card).toHaveClass(/be-room-card-preselected/);
  await expect(card.locator('.be-rate-opt[aria-checked="true"]')).toHaveCount(0);
});

test('English engine: "Modify search" works and dates use Colombia time', async ({ page }) => {
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto(`/en/reservar.html?checkin=${D1}&checkout=${D4}&guests=2`);
  await expect(page.locator('.be-room-card')).toBeVisible();

  await page.locator('.be-searchbar-edit').click();
  const dateInputs = page.locator('.be-searchform-fields input[type="date"]');
  await expect(dateInputs.nth(0)).toHaveAttribute('min', bogotaToday());
  await dateInputs.nth(0).fill(D2);
  await dateInputs.nth(1).fill(D5);
  const refreshed = page.waitForRequest(r => r.url().includes('/api/check-availability') && r.url().includes(`checkin=${D2}`));
  await page.locator('.be-searchform-fields button[type="submit"]').click();
  await refreshed;
  await expect(page.locator('.be-room-card')).toBeVisible();
  await expect(page.locator('.be-searchbar-dates')).toBeVisible();
  expect(errors).toEqual([]);
});

test('guest step links the cancellation and privacy policies', async ({ page }) => {
  await page.goto(`/reservar.html?checkin=${D1}&checkout=${D4}&guests=2`);
  await chooseFirstRoom(page);
  await page.locator('.be-step-active .be-btn-primary').click();
  const label = page.locator('label[for="guest-privacy"]');
  await expect(label.locator('a[href="cancelacion.html"]')).toHaveText('política de cancelación');
  await expect(label.locator('a[href="privacidad.html"]')).toHaveText('política de privacidad');
});

test('manage booking asks for the booking number with a generic example', async ({ page }) => {
  await page.goto('/reservar.html');
  await page.waitForFunction(() => typeof window.enterManageMode === 'function');
  await page.evaluate(() => window.enterManageMode());
  await expect(page.locator('#manage-code')).toHaveAttribute('placeholder', 'Ej. 1234567');
});

test('Wompi pending payment (PSE) shows "payment in process" and keeps checking until confirmed', async ({ page }) => {
  await mockWompiCheckout(page, 'PENDING');
  let statusCalls = 0;
  await page.route('**/api/booking-status**', route => {
    statusCalls += 1;
    const body = statusCalls >= 3
      ? { status: 'confirmed', ref: 'x', bookingCode: '3273999', otasyncId: 3273999, reservationPending: false }
      : { status: 'pending', ref: 'x' };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('https://sandbox.wompi.co/**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ data: { id: 'tx-e2e-1', status: 'PENDING' } })
  }));

  await page.goto(`/reservar.html?checkin=${D1}&checkout=${D4}&guests=2`);
  await chooseFirstRoom(page);
  await page.locator('.be-step-active .be-btn-primary').click();
  await fillGuestAndContinue(page);
  await page.locator('.be-step-active .be-step-footer .be-btn-primary').click();

  const wait = page.locator('.be-pay-wait-processing');
  await expect(wait).toBeVisible();
  await expect(wait).toContainText('Tu pago está en proceso');
  await expect(wait).not.toContainText('fue aprobado');
  await expect(page.getByRole('button', { name: 'Intentar de nuevo' })).toHaveCount(0);

  await expect(page.locator('.be-confirm-hero h2')).toHaveText('¡Reserva confirmada!', { timeout: 15000 });
  await expect(page.locator('.be-confirm-hero')).toContainText('3273999');
  await expect(page.locator('a.be-checkin-link')).toHaveAttribute('href', '/guest.html?code=3273999');
  /* Indicativo según el país (Colombia) y número sin el +57 duplicado. */
  const cfg = await page.evaluate(() => window.__wompiCfg.customerData);
  expect(cfg.phoneNumberPrefix).toBe('+57');
  expect(cfg.phoneNumber).toBe('3001112233');
});

test('Wompi pending payment that gets declined returns to the payment step', async ({ page }) => {
  await mockWompiCheckout(page, 'PENDING');
  await page.route('**/api/booking-status**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'pending', ref: 'x' })
  }));
  await page.route('https://sandbox.wompi.co/**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ data: { id: 'tx-e2e-1', status: 'DECLINED' } })
  }));

  await page.goto(`/reservar.html?checkin=${D1}&checkout=${D4}&guests=2`);
  await chooseFirstRoom(page);
  await page.locator('.be-step-active .be-btn-primary').click();
  await fillGuestAndContinue(page);
  await page.locator('.be-step-active .be-step-footer .be-btn-primary').click();

  await expect(page.locator('.be-step-active .be-info-error')).toContainText('declinada', { timeout: 15000 });
  await expect(page.locator('.be-step-active .be-step-title')).toHaveText('Resumen y pago');
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
  await expect(page.locator('a.be-checkin-link')).toHaveAttribute('href', '/guest.html?code=EST-TEST1');
});

test('returning from Mercado Pago without the draft still checks the status and confirms', async ({ page }) => {
  /* Otro navegador / borrador vencido: el código sale de external_reference. */
  const ref = mpReference(['2', D1, D4, '2', '31349', 'Ana', 'Peña', 'ana@example.com', '3000000000',
    '0000000', 'EST-NODR1', '1', '0', '79500000']);
  let asked = null;
  await page.route('**/api/booking-status**', route => {
    asked = new URL(route.request().url()).searchParams.get('ref');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'confirmed', ref: 'EST-NODR1', bookingCode: '3273564', otasyncId: 3273564, reservationPending: false })
    });
  });

  await page.goto(`/reservar.html?payment=success&payment_id=555&external_reference=${encodeURIComponent(ref)}`);
  await expect(page.locator('.be-confirm-hero h2')).toHaveText('¡Reserva confirmada!');
  expect(asked).toBe('EST-NODR1');
  await expect(page.locator('.be-confirm-hero')).toContainText('3273564');
  await expect(page.locator('.be-confirm-card')).toContainText('Selección');
  await expect(page.locator('.be-confirm-card')).toContainText('$ 795.000');
  await expect(page.locator('body')).not.toContainText('reportó tu pago');
  /* Sin borrador nadie envía el correo de confirmación: no se promete. */
  await expect(page.locator('body')).not.toContainText('Confirmación enviada');
});

test('returning from Mercado Pago with a pending payment says "in process", not "approved"', async ({ page }) => {
  await page.addInitScript(([ci, co]) => {
    try {
      sessionStorage.setItem('estar-booking-draft', JSON.stringify({
        savedAt: Date.now(),
        search: { checkin: ci, checkout: co, guests: 2 },
        selectedRoom: { id: 'clasica', roomTypeId: '31348', name: 'Clásica', priceFlexible: 250000, num: '01', area: 29, capacity: 2 },
        selectedRate: 'flexible',
        currentStep: 'payment',
        extras: {},
        guestData: { nombre: 'Ana', apellido: 'Prueba', email: 'ana@example.com', tel: '3000000000', pais: 'Colombia' },
        paymentMethod: 'mercadopago'
      }));
      sessionStorage.setItem('estar-mp-pending', JSON.stringify({ code: 'EST-PEND1', savedAt: Date.now() }));
    } catch (e) {}
  }, [D1, D4]);
  await page.route('**/api/booking-status**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'pending', ref: 'EST-PEND1' })
  }));

  await page.goto('/reservar.html?payment=pending&collection_id=777');
  const wait = page.locator('.be-pay-wait-processing');
  await expect(wait).toContainText('Tu pago está en proceso');
  await expect(wait).not.toContainText('aprobado');
  /* Si recarga, sigue esperando el pago (no vuelve al paso de pago). */
  await page.reload();
  await expect(page.locator('.be-pay-wait-processing')).toBeVisible();
});

test('payment received but booking still registering: friendly copy, no PMS jargon', async ({ page }) => {
  await page.addInitScript(([ci, co]) => {
    try {
      sessionStorage.setItem('estar-booking-draft', JSON.stringify({
        savedAt: Date.now(),
        search: { checkin: ci, checkout: co, guests: 2 },
        selectedRoom: { id: 'clasica', roomTypeId: '31348', name: 'Clásica', priceFlexible: 250000, num: '01', area: 29, capacity: 2 },
        selectedRate: 'best',
        currentStep: 'payment',
        extras: {},
        guestData: { nombre: 'Ana', apellido: 'Prueba', email: 'ana@example.com', tel: '3000000000', pais: 'Colombia' },
        paymentMethod: 'mercadopago'
      }));
      sessionStorage.setItem('estar-mp-pending', JSON.stringify({ code: 'EST-REV01', savedAt: Date.now() }));
    } catch (e) {}
  }, [D1, D4]);
  await page.route('**/api/booking-status**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ status: 'confirmed', ref: 'EST-REV01', bookingCode: 'EST-REV01', reservationPending: true })
  }));

  await page.goto('/reservar.html?payment=success&payment_id=999');
  await expect(page.locator('.be-confirm-hero h2')).toHaveText('Pago recibido');
  const status = page.locator('.be-confirm-status');
  await expect(status).toContainText('Estamos terminando de confirmar tu reserva');
  await expect(status).toContainText('correo');
  await expect(page.locator('body')).not.toContainText('Kunas');
  await expect(page.locator('body')).not.toContainText('manualmente');
  await expect(page.locator('a.be-checkin-link')).toHaveCount(0);
});

function seedDraftWithMpPending(page, code) {
  return page.addInitScript(([ci, co, c]) => {
    try {
      if (sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      sessionStorage.setItem('estar-booking-draft', JSON.stringify({
        savedAt: Date.now(),
        search: { checkin: ci, checkout: co, guests: 2 },
        selectedRoom: { id: 'clasica', roomTypeId: '31348', name: 'Clásica', priceFlexible: 250000, num: '01', area: 29, capacity: 2 },
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

test('payment still registering offers a way out, and a reload does not trap the guest', async ({ page }) => {
  await seedDraftWithMpPending(page, 'EST-OUT01');
  await page.route('**/api/booking-status**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'confirmed', ref: 'EST-OUT01', bookingCode: 'EST-OUT01', reservationPending: true })
  }));
  await page.goto('/reservar.html?payment=success&payment_id=1001');
  await expect(page.locator('.be-confirm-hero h2')).toHaveText('Pago recibido');
  const again = page.locator('.be-confirm-actions button', { hasText: 'Nueva reserva' });
  await expect(again).toBeVisible();
  await again.click();
  await expect(page.locator('.be-confirm-hero')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.be-confirm-hero')).toHaveCount(0);
  await expect(page.locator('.be-pay-wait')).toHaveCount(0);
});

test('payment received but sold out: no "arrives by email" and no confirmation email', async ({ page }) => {
  await seedDraftWithMpPending(page, 'EST-SOLD1');
  let emails = 0;
  await page.route('**/api/send-confirmation**', route => { emails += 1; return route.fulfill({ status: 200, contentType: 'application/json', body: '{"sent":true}' }); });
  await page.route('**/api/booking-status**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'confirmed', ref: 'EST-SOLD1', bookingCode: 'EST-SOLD1', reservationPending: true, reason: 'sold_out' })
  }));
  await page.goto('/reservar.html?payment=success&payment_id=1002');
  await expect(page.locator('.be-confirm-hero h2')).toHaveText('Pago recibido');
  const status = page.locator('.be-confirm-status');
  await expect(status).toContainText('Ya no había disponibilidad');
  await expect(status).toContainText('devolución');
  await expect(status).not.toContainText('te llegará la confirmación');
  await expect(page.locator('.be-confirm-polling')).toHaveCount(0);
  await expect(page.locator('a.be-checkin-link')).toHaveCount(0);
  await expect(page.locator('.be-confirm-actions button', { hasText: 'Nueva reserva' })).toBeVisible();
  await page.waitForTimeout(500);
  expect(emails).toBe(0);
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
  await expect(page.locator('.be-room-card').first()).toBeVisible();
  /* Frente motor: la tarifa ya no viene preseleccionada. */
  await chooseFirstRoom(page, 'Estricta');
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
