/* guest-action → Odoo Helpdesk (PQR, Fase 4): las solicitudes de servicio
   (order) y las cancelaciones/modificaciones (reservation_change) abren un
   ticket en Atención al cliente cuando HELPDESK_ENABLED está activo. Best-effort:
   un fallo del ticket NUNCA tumba la solicitud del huésped. Sin el flag, no se
   crea ticket. upsertPartner/createHelpdeskTicket se inyectan por _test.setDeps. */

const assert = require('node:assert/strict');
const test = require('node:test');

process.env.GUEST_APP_TOKEN_SECRET = 'unit-test-token-secret';
process.env.GUEST_APP_DATA_ENCRYPTION_KEY = 'unit-test-encryption-secret';
process.env.GUEST_APP_DEMO_MODE = 'true';
delete process.env.GUEST_APP_SYNC_WEBHOOK_URL;
delete process.env.GUEST_APP_DRIVE_WEBHOOK_URL;

const guestHelpers = require('../../netlify/functions/_guest-app');
const guestActionModule = require('../../netlify/functions/guest-action');
const guestAction = guestActionModule.handler;

function body(response) { return JSON.parse(response.body); }

function makeEvent(payload, token) {
  return {
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1', authorization: token ? `Bearer ${token}` : '' },
    body: JSON.stringify(payload)
  };
}

function validToken() {
  return guestHelpers.signGuestToken(
    { bookingCode: 'EST-TEST-42', guestName: 'María López', nights: 4, totalAmount: 1280000 },
    300
  );
}

/* Inyecta stubs base (store/sync/archive no-op) + los de Helpdesk. */
function setHelpdeskDeps({ onTicket, onPartner } = {}) {
  guestActionModule._test.setDeps({
    protectRecord: record => record,
    guestStore: () => ({ setJSON: async () => {} }),
    archiveGuestPayload: async () => ({ delivered: false, configured: false }),
    syncGuestEvent: async () => ({ delivered: false }),
    notifyOrderTeam: async () => {},
    createHelpdeskTicket: onTicket || (async () => ({ id: 900, isMock: false })),
    upsertPartner: onPartner || (async () => ({ id: 77, created: true, isMock: false }))
  });
}

test('buildHelpdeskTicket arma asunto/descripción de una solicitud de servicio (ES)', () => {
  const ticket = guestActionModule._test.buildHelpdeskTicket({
    type: 'order',
    bookingCode: 'EST-1',
    guestName: 'Ana',
    eventId: 'GST-1',
    items: [{ name: 'Desayuno', quantity: 2, subtotal: 40000 }],
    total: 40000,
    paymentPreference: 'account'
  });
  assert.match(ticket.name, /^Solicitud de servicio — EST-1$/);
  assert.match(ticket.description, /Reserva: EST-1/);
  assert.match(ticket.description, /Desayuno × 2/);
  assert.match(ticket.description, /Cargar a la cuenta/);
});

test('buildHelpdeskTicket: cancelación vs modificación según requestKind', () => {
  const cancel = guestActionModule._test.buildHelpdeskTicket({
    type: 'reservation_change', bookingCode: 'EST-2', requestKind: 'cancel', eventId: 'GST-2'
  });
  assert.match(cancel.name, /^Cancelación — EST-2$/);

  const mod = guestActionModule._test.buildHelpdeskTicket({
    type: 'reservation_change', bookingCode: 'EST-3', requestKind: 'dates',
    requestedCheckIn: '2026-07-01', eventId: 'GST-3'
  });
  assert.match(mod.name, /^Solicitud de modificación — EST-3$/);
  assert.match(mod.description, /Cambio de fechas/);
  assert.match(mod.description, /Nueva entrada: 2026-07-01/);
});

test('buildHelpdeskTicket honra el idioma EN (paridad i18n, tono tú)', () => {
  const ticket = guestActionModule._test.buildHelpdeskTicket({
    type: 'order', lang: 'en', bookingCode: 'EST-9', eventId: 'GST-9',
    items: [{ name: 'Breakfast', quantity: 1, subtotal: 20000 }], total: 20000,
    paymentPreference: 'online'
  });
  assert.match(ticket.name, /^Service request — EST-9$/);
  assert.match(ticket.description, /Booking: EST-9/);
  assert.match(ticket.description, /Pay online/);
});

test('buildHelpdeskTicket devuelve null para tipos no-PQR (contract/support)', () => {
  assert.equal(guestActionModule._test.buildHelpdeskTicket({ type: 'support', message: 'x' }), null);
  assert.equal(guestActionModule._test.buildHelpdeskTicket({ type: 'contract' }), null);
  assert.equal(guestActionModule._test.buildHelpdeskTicket(null), null);
});

test('order: con HELPDESK_ENABLED abre un ticket de PQR', async () => {
  const token = validToken();
  const tickets = [];
  setHelpdeskDeps({ onTicket: async (t) => { tickets.push(t); return { id: 901, isMock: false }; } });
  process.env.HELPDESK_ENABLED = 'true';
  try {
    const res = await guestAction(makeEvent({
      type: 'order', items: [{ id: 'breakfast', quantity: 2 }], paymentPreference: 'account'
    }, token));
    assert.equal(res.statusCode, 201);
    assert.equal(tickets.length, 1, 'se crea un ticket');
    assert.match(tickets[0].name, /Solicitud de servicio — EST-TEST-42/);
    assert.match(tickets[0].description, /Desayuno × 2/);
    assert.equal(body(res).helpdesk.created, true);
    assert.equal(body(res).helpdesk.id, 901);
  } finally {
    delete process.env.HELPDESK_ENABLED;
    guestActionModule._test.resetDeps();
  }
});

test('reservation_change cancel: con HELPDESK_ENABLED abre un ticket de cancelación', async () => {
  const token = validToken();
  const tickets = [];
  setHelpdeskDeps({ onTicket: async (t) => { tickets.push(t); return { id: 902, isMock: false }; } });
  process.env.HELPDESK_ENABLED = 'true';
  try {
    const res = await guestAction(makeEvent({
      type: 'reservation_change', requestKind: 'cancel', message: 'Ya no viajo'
    }, token));
    assert.equal(res.statusCode, 201);
    assert.equal(tickets.length, 1);
    assert.match(tickets[0].name, /Cancelación — EST-TEST-42/);
    assert.match(tickets[0].description, /Ya no viajo/);
  } finally {
    delete process.env.HELPDESK_ENABLED;
    guestActionModule._test.resetDeps();
  }
});

test('SIN HELPDESK_ENABLED no se crea ticket', async () => {
  const token = validToken();
  let calls = 0;
  setHelpdeskDeps({ onTicket: async () => { calls++; return { id: 1 }; } });
  delete process.env.HELPDESK_ENABLED;
  try {
    const res = await guestAction(makeEvent({
      type: 'order', items: [{ id: 'breakfast', quantity: 1 }], paymentPreference: 'account'
    }, token));
    assert.equal(res.statusCode, 201);
    assert.equal(calls, 0, 'no debe crear ticket sin el flag');
    assert.equal(body(res).helpdesk, undefined);
  } finally {
    guestActionModule._test.resetDeps();
  }
});

test('un fallo del ticket NO tumba la solicitud del huésped', async () => {
  const token = validToken();
  setHelpdeskDeps({ onTicket: async () => { throw new Error('Odoo Helpdesk caído'); } });
  process.env.HELPDESK_ENABLED = 'true';
  try {
    const res = await guestAction(makeEvent({
      type: 'order', items: [{ id: 'breakfast', quantity: 1 }], paymentPreference: 'account'
    }, token));
    assert.equal(res.statusCode, 201, 'la solicitud igual se registra');
    assert.equal(body(res).helpdesk.created, false);
    assert.match(body(res).helpdesk.error, /Helpdesk caído/);
  } finally {
    delete process.env.HELPDESK_ENABLED;
    guestActionModule._test.resetDeps();
  }
});

test('reusa upsertPartner cuando el record trae email; sin email no lo llama', async () => {
  const token = validToken();

  // Con email: se resuelve el partner y se pasa partner_id al ticket.
  let partnerCalls = 0, ticketArg = null;
  setHelpdeskDeps({
    onPartner: async () => { partnerCalls++; return { id: 333, created: false, isMock: false }; },
    onTicket: async (t) => { ticketArg = t; return { id: 1, isMock: false }; }
  });
  process.env.HELPDESK_ENABLED = 'true';
  try {
    await guestAction(makeEvent({
      type: 'reservation_change', requestKind: 'invoice', message: 'Necesito factura',
      // reservation_change no captura email en el record, así que probamos por contrato:
    }, token));
    assert.equal(partnerCalls, 0, 'sin email en el record NO se llama upsertPartner');
    assert.equal(ticketArg.partnerId, undefined);
  } finally {
    delete process.env.HELPDESK_ENABLED;
    guestActionModule._test.resetDeps();
  }
});

test('openHelpdeskTicket liga el partner cuando el record trae email', async () => {
  let partnerArg = null, ticketArg = null;
  guestActionModule._test.setDeps({
    upsertPartner: async (d) => { partnerArg = d; return { id: 444, created: true, isMock: false }; },
    createHelpdeskTicket: async (t) => { ticketArg = t; return { id: 1, isMock: false }; }
  });
  try {
    const out = await guestActionModule._test.openHelpdeskTicket({
      type: 'order', bookingCode: 'EST-5', guestName: 'Ana', email: 'ana@guest.co',
      eventId: 'GST-5', items: [{ name: 'Desayuno', quantity: 1, subtotal: 20000 }],
      total: 20000, paymentPreference: 'account'
    });
    assert.equal(out.created, true);
    assert.equal(partnerArg.email, 'ana@guest.co');
    assert.equal(ticketArg.partnerId, 444, 'el ticket queda ligado al partner');
    assert.equal(ticketArg.email, 'ana@guest.co');
  } finally {
    guestActionModule._test.resetDeps();
  }
});

test('openHelpdeskTicket: un fallo de upsertPartner NO impide crear el ticket (sin partner_id)', async () => {
  let ticketArg = null;
  guestActionModule._test.setDeps({
    upsertPartner: async () => { throw new Error('partner caído'); },
    createHelpdeskTicket: async (t) => { ticketArg = t; return { id: 1, isMock: false }; }
  });
  try {
    const out = await guestActionModule._test.openHelpdeskTicket({
      type: 'order', bookingCode: 'EST-6', guestName: 'Ana', email: 'ana@guest.co',
      eventId: 'GST-6', items: [{ name: 'Desayuno', quantity: 1, subtotal: 20000 }],
      total: 20000, paymentPreference: 'account'
    });
    assert.equal(out.created, true, 'el ticket se crea igual');
    assert.equal(ticketArg.partnerId, undefined);
  } finally {
    guestActionModule._test.resetDeps();
  }
});
