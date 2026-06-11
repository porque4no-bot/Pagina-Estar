const { test, expect } = require('@playwright/test');

const booking = {
  bookingCode: 'EST-TEST-100',
  status: 'confirmed',
  guestName: 'Andrea Restrepo',
  roomName: 'Apartaestudio Seleccion',
  roomNumber: '402',
  checkIn: '2026-08-10',
  checkOut: '2026-08-13',
  nights: 3,
  totalAmount: 795000,
  canCancel: true,
  canModify: true
};

async function mockGuestApis(page, captured = []) {
  await page.route('https://unpkg.com/lucide@*/**', route => route.fulfill({
    contentType: 'application/javascript',
    body: 'window.lucide={createIcons:function(){}};'
  }));

  await page.route('**/api/guest-session', async route => {
    const request = route.request();
    const payload = request.postDataJSON();
    captured.push({ endpoint: 'session', payload });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, token: 'test-guest-token', booking })
    });
  });

  await page.route('**/api/guest-checkin', async route => {
    const request = route.request();
    const payload = request.postDataJSON();
    captured.push({
      endpoint: 'checkin',
      payload,
      authorization: request.headers().authorization
    });
    const response = payload.mode === 'analyze'
      ? {
          ok: true,
          source: 'azure',
          confidence: 97,
          extracted: {
            firstName: 'Andrea',
            lastName: 'Restrepo',
            documentType: 'Pasaporte',
            documentNumber: 'PA123456',
            birthDate: '1992-05-16',
            expirationDate: '2030-05-16',
            nationality: 'Colombiana'
          },
          validation: { valid: false, missing: ['email', 'phone'], warnings: [] }
        }
      : {
          ok: true,
          checkinId: 'CHK-TEST-100',
          validation: { valid: true, missing: [], warnings: [] },
          documentAnalysis: 'azure'
        };
    await route.fulfill({
      status: payload.mode === 'analyze' ? 200 : 201,
      contentType: 'application/json',
      body: JSON.stringify(response)
    });
  });

  await page.route('**/api/guest-action', async route => {
    const request = route.request();
    const payload = request.postDataJSON();
    captured.push({
      endpoint: 'action',
      payload,
      authorization: request.headers().authorization
    });
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        eventId: `GST-${payload.type.toUpperCase()}-100`,
        total: payload.type === 'order' ? 28000 : undefined
      })
    });
  });
}

async function login(page) {
  await page.goto('/guest.html');
  await page.locator('#bookingCode').fill('EST-TEST-100');
  await page.locator('#accessKey').fill('Restrepo');
  await page.locator('#guestLoginForm button[type="submit"]').click();
  await expect(page.locator('#guestShell')).toBeVisible();
  await expect(page.locator('#homeBookingCode')).toContainText('EST-TEST-100');
}

test('guest can authenticate and restore the session after reload', async ({ page }) => {
  const captured = [];
  await mockGuestApis(page, captured);
  await login(page);
  expect(captured[0].payload).toEqual({
    bookingCode: 'EST-TEST-100',
    accessKey: 'Restrepo'
  });

  await page.reload();
  await expect(page.locator('#guestShell')).toBeVisible();
  await expect(page.locator('#manageGuestName')).toHaveText('Andrea Restrepo');
});

test('invalid reservation displays the API error without opening the app', async ({ page }) => {
  await page.route('https://unpkg.com/lucide@*/**', route => route.fulfill({
    contentType: 'application/javascript',
    body: 'window.lucide={createIcons:function(){}};'
  }));
  await page.route('**/api/guest-session', route => route.fulfill({
    status: 404,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'No encontramos una reserva que coincida con esos datos.' })
  }));

  await page.goto('/guest.html');
  await page.locator('#bookingCode').fill('NO-EXISTE');
  await page.locator('#accessKey').fill('Nadie');
  await page.locator('#guestLoginForm button[type="submit"]').click();
  await expect(page.locator('#loginStatus')).toContainText('No encontramos');
  await expect(page.locator('#guestShell')).toBeHidden();
});

test('guest completes document analysis, check-in and contract signature', async ({ page }) => {
  const captured = [];
  await mockGuestApis(page, captured);
  await login(page);
  await page.locator('[data-guest-tab="checkin"]:visible').first().click();

  await page.locator('#identityDocument').setInputFiles({
    name: 'pasaporte.png',
    mimeType: 'image/png',
    buffer: Buffer.from('89504e470d0a1a0a', 'hex')
  });
  await expect(page.locator('#ocrStatus')).toContainText('Documento cargado');
  await page.locator('#analyzeDocument').click();
  await expect(page.locator('[name="documentNumber"]')).toHaveValue('PA123456');
  await expect(page.locator('[name="documentType"]')).toHaveValue('Pasaporte');
  await expect(page.locator('[name="expirationDate"]')).toHaveJSProperty('required', true);
  await page.locator('[name="documentType"]').selectOption('CC');
  await expect(page.locator('[name="expirationDate"]')).toHaveJSProperty('required', false);
  await page.locator('[name="documentType"]').selectOption('Pasaporte');
  await expect(page.locator('#ocrStatus')).toContainText('97%');

  await page.locator('[name="email"]').fill('andrea@example.com');
  await page.locator('[name="phone"]').fill('+57 300 123 4567');
  await page.locator('[name="privacyAccepted"]').check();
  await page.locator('#checkinForm button[type="submit"]').click();
  await expect(page.locator('#checkinStatus')).toContainText('CHK-TEST-100');
  await expect(page.locator('#checkinProgress')).toHaveText('Check-in completado');

  await page.locator('#contractAccepted').check();
  await page.locator('#signContract').click();
  await expect(page.locator('#contractStatus')).toContainText('Contrato firmado');

  const checkinRequests = captured.filter(item => item.endpoint === 'checkin');
  expect(checkinRequests).toHaveLength(2);
  expect(checkinRequests[1].authorization).toBe('Bearer test-guest-token');
  const contract = captured.find(item => item.endpoint === 'action' && item.payload.type === 'contract');
  expect(contract.payload.acceptedTerms).toBe(true);
});

test('guest orders an additional service and contacts concierge', async ({ page }) => {
  const captured = [];
  await mockGuestApis(page, captured);
  await login(page);

  await page.locator('[data-guest-tab="services"]:visible').first().click();
  await page.locator('[data-service-id="breakfast"] .guest-add-service').click();
  await expect(page.locator('#cartCount')).toHaveText('1');
  await expect(page.locator('#cartTotal')).toContainText('28');
  await page.locator('#deliveryTime').fill('Al llegar');
  await page.locator('#submitOrder').click();
  await expect(page.locator('#orderStatus')).toContainText('Pedido recibido');

  await page.locator('[data-guest-tab="concierge"]:visible').first().click();
  await page.locator('#supportForm textarea[name="message"]').fill('Necesito transporte al aeropuerto.');
  await page.locator('#supportForm button[type="submit"]').click();
  await expect(page.locator('#supportStatus')).toContainText('Mensaje enviado');

  const order = captured.find(item => item.endpoint === 'action' && item.payload.type === 'order');
  expect(order.authorization).toBe('Bearer test-guest-token');
  expect(order.payload.items).toEqual([{ id: 'breakfast', quantity: 1 }]);
  const support = captured.find(item => item.endpoint === 'action' && item.payload.type === 'support');
  expect(support.payload.message).toContain('aeropuerto');
});
