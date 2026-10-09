/* Frente "Panel Hoy para recepción" — render de la pestaña Hoy en /admin
 * (cotizar-admin.html). Igual que admin-settings-ui: se extraen las funciones
 * del <script> y se ejecutan en un sandbox `vm` (sin DOM ni red). */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.resolve(__dirname, '../../cotizar-admin.html'), 'utf8');

function extractFunction(src, header) {
  const start = src.indexOf(header);
  assert.notEqual(start, -1, `No se encontró ${header} en el HTML`);
  const braceStart = src.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`No se cerró ${header}`);
}

function sandbox() {
  const provider = html.match(/const HOY_PROVIDER = \{[^}]*\};/);
  assert.ok(provider, 'HOY_PROVIDER no está en el HTML');
  const names = ['hoyEsc', 'hoyMoney', 'hoyWhen', 'hoyPayLine', 'hoyCanResendPayment', 'hoyFlags', 'hoyRow', 'hoyWebRow', 'hoyLoc', 'hoyCheckinHtml'];
  const src = provider[0].replace('const HOY_PROVIDER', 'var HOY_PROVIDER') + '\n' +
    names.map(n => extractFunction(html, `function ${n}(`)).join('\n');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx;
}

const base = {
  bookingCode: '9001', guestName: 'Ana Ríos', roomName: 'Clásica', roomNumber: '402',
  checkIn: '2026-10-08', checkOut: '2026-10-10', nights: 2, hasBreakfast: true,
  channel: 'Web', isWeb: true, phone: '+57 300 111 2233', hasEmail: true, balance: 0,
  payment: { provider: 'mercadopago', method: 'credit_card', amountCents: 45000000, status: 'aprobado' },
  checkin: { done: true, checkinId: 'CHK-1760000000000-ABCDEF', manualReview: true, guests: 2 },
  pendingOrders: [{ total: 40000, items: 'Desayuno × 2' }], pendingOrdersCount: 1, verifyDocumentTasks: 1
};

test('la vista Hoy tiene la tarjeta de reservas web y el modal del check-in', () => {
  assert.match(html, /id="hoyWebCard"/);
  assert.match(html, /id="hoyCiBackdrop"[^>]*role="dialog"/);
  assert.match(html, /\/api\/staff-web-bookings/);
  assert.match(html, /\/api\/staff-checkin-view/);
  assert.match(html, /\/api\/staff-resend-confirmation/);
});

test('hoyRow: canal, apto, teléfono, pago en línea, check-in, pedidos y acciones', () => {
  const ctx = sandbox();
  const out = ctx.hoyRow(base);
  assert.match(out, /apto 402/);
  assert.match(out, /hoy-tag-ch">Web</);
  assert.match(out, /href="tel:\+573001112233"/);
  assert.match(out, /Pagado en línea: <strong>\$ 450\.000<\/strong> · Mercado Pago/);
  assert.match(out, /Check-in hecho · 2 huésped/);
  assert.match(out, /Revisión manual: verificar documento/);
  assert.match(out, /1 pedido\(s\) por cobrar/);
  assert.match(out, /Por cobrar: \$ 40\.000 · Desayuno × 2/);
  assert.match(out, /class="btn btn-ghost-dark hoy-ci-view" data-checkin="CHK-1760000000000-ABCDEF" data-code="9001"/);
  assert.match(out, /hoy-resend" data-code="9001"/);
});

test('hoyRow: sin check-in, sin correo y con saldo → etiquetas y acciones acordes', () => {
  const ctx = sandbox();
  const out = ctx.hoyRow({ ...base, channel: 'Booking.com', isWeb: false, payment: null, hasEmail: false, balance: 380000,
    checkin: { done: false }, pendingOrders: [], pendingOrdersCount: 0, verifyDocumentTasks: 0 });
  assert.match(out, /Sin check-in en línea/);
  assert.match(out, /Saldo en Kunas: <strong>\$ 380\.000/);
  assert.doesNotMatch(out, /hoy-ci-view/);
  assert.doesNotMatch(out, /hoy-resend/);
  /* Reserva de OTA con correo: no se ofrece reenviar (no es nuestra confirmación). */
  const ota = ctx.hoyRow({ ...base, channel: 'Booking.com', isWeb: false, payment: null, hasEmail: true });
  assert.doesNotMatch(ota, /hoy-resend/);
});

test('hoyRow/hoyPayLine escapan datos del PMS (sin XSS) y marcan "pago sin reserva"', () => {
  const ctx = sandbox();
  const out = ctx.hoyRow({ ...base, guestName: '<img src=x onerror=alert(1)>', phone: '"><script>', channel: '<b>x</b>' });
  assert.doesNotMatch(out, /<img src=x/);
  assert.doesNotMatch(out, /<script>/);
  assert.doesNotMatch(out, /<b>x<\/b>/);
  const pend = ctx.hoyPayLine({ provider: 'wompi', amountCents: 100000, status: 'pago_sin_reserva', reason: 'sold_out' });
  assert.match(pend, /hoy-tag-bad">Pago sin reserva/);
  assert.match(pend, /motivo: sold_out/);
});

test('hoyWebRow: pago sin reserva resaltado y sin botón; confirmada con reenvío', () => {
  const ctx = sandbox();
  const bad = ctx.hoyWebRow({ webCode: 'EST-AGOTA', bookingCode: null, needsAttention: true, createdAt: '2026-10-07T15:00:00Z',
    payment: { provider: 'mercadopago', amountCents: 45000000, status: 'pago_sin_reserva', reason: 'sold_out' } });
  assert.match(bad, /hoy-tag-bad">Pago sin reserva/);
  assert.match(bad, /no aparece en Kunas/);
  assert.doesNotMatch(bad, /hoy-resend/);
  const ok = ctx.hoyWebRow({ webCode: 'EST-MPOK1', bookingCode: '9001', guestName: 'Ana Ríos', checkIn: '2026-10-20', checkOut: '2026-10-22',
    hasEmail: true, pmsStatus: 'confirmed', payment: { provider: 'mercadopago', amountCents: 45000000, status: 'aprobado' } });
  assert.match(ok, /EST-MPOK1 · Kunas 9001/);
  assert.match(ok, /hoy-resend" data-code="9001"/);
  const canceled = ctx.hoyWebRow({ webCode: 'EST-X', bookingCode: '9', guestName: 'A', hasEmail: true, pmsStatus: 'canceled', payment: { provider: 'wompi', amountCents: 1, status: 'aprobado' } });
  assert.match(canceled, /Cancelada en Kunas/);
  assert.doesNotMatch(canceled, /hoy-resend/);
});

test('hoyCheckinHtml: muestra datos del registro, destino de extranjeros y documentos que existen', () => {
  const ctx = sandbox();
  const out = ctx.hoyCheckinHtml({
    checkins: [{
      checkinId: 'CHK-1760000000000-ABCDEF', createdAt: '2026-10-07T20:00:00Z', manualReview: true,
      reservation: { checkIn: '2026-10-08', checkOut: '2026-10-10', roomNumber: '402', motive: 'Turismo' },
      guests: [
        { firstName: 'John', lastName: 'Doe', isPrimary: true, documentType: 'Pasaporte', documentNumber: 'P999', nationality: 'Canadá',
          birthDate: '1985-02-02', foreign: true, destination: '', origin: { country: 'Canadá', city: 'Toronto' }, residence: {}, needsManualReview: true },
        { firstName: 'Mia', lastName: 'Doe', isMinor: true, documentType: 'TI', documentNumber: 'M1', minor: { parentPresent: true, fatherName: 'John Doe' } }
      ],
      documents: [{ store: 'minor', key: 'CHK-1760000000000-ABCDEF/1/registro-civil.jpg', kind: 'registro-civil', guestIndex: 1 }]
    }]
  });
  assert.match(out, /Pasaporte P999/);
  assert.match(out, /Toronto, Canadá/);
  assert.match(out, /— \(falta, es extranjero\)/);
  assert.match(out, /Verificar documento físico/);
  assert.match(out, /viaja con padre\/madre/);
  assert.match(out, /Registro civil \(menor\) · huésped 2/);
  assert.match(out, /data-store="minor"/);
  assert.match(out, /quedó registrado \(auditoría\)/);
  const none = ctx.hoyCheckinHtml({ checkins: [{ checkinId: 'C', guests: [], documents: [] }] });
  assert.match(none, /guardado de documentos de adultos está apagado/);
});

/* ── Correcciones de revisión ── */

test('hoyRow: web SIN pago registrado no ofrece "Reenviar confirmación"; con Blobs caído no dice "sin registro"', () => {
  const ctx = sandbox();
  const noPay = ctx.hoyRow({ ...base, payment: null });
  assert.match(noPay, /Web sin registro de pago/);
  assert.doesNotMatch(noPay, /hoy-resend/, 'sin pago el correo diría "Total pagado" con el total');
  const unknown = ctx.hoyRow({ ...base, payment: null, paymentUnknown: true, tasksUnknown: true, pendingOrders: [], pendingOrdersCount: 0 });
  assert.doesNotMatch(unknown, /Web sin registro de pago/);
  assert.match(unknown, /Pago: no se pudo leer el registro/);
  assert.match(unknown, /Pedidos: no se pudo leer la cola/);
  const pend = ctx.hoyRow({ ...base, payment: { provider: 'wompi', amountCents: 1000, status: 'pago_sin_reserva' } });
  assert.doesNotMatch(pend, /hoy-resend/);
});

test('hoyPayLine: "reserva ya creada" y "resuelto" no salen en rojo', () => {
  const ctx = sandbox();
  const created = ctx.hoyPayLine({ provider: 'wompi', amountCents: 100000, status: 'reserva_creada', reason: 'insert_failed' });
  assert.doesNotMatch(created, /hoy-tag-bad/);
  assert.match(created, /Reserva ya creada en Kunas/);
  const resolved = ctx.hoyPayLine({ provider: 'wompi', amountCents: 100000, status: 'resuelto', resolution: { how: 'devuelto', by: 'rec@estar.co' } });
  assert.doesNotMatch(resolved, /hoy-tag-bad/);
  assert.match(resolved, /Resuelto: dinero devuelto/);
});

test('hoyWebRow: pago sin reserva ofrece marcar resuelto; huérfana sin pago no reenvía; lectura parcial no acusa', () => {
  const ctx = sandbox();
  const bad = ctx.hoyWebRow({ webCode: 'EST-XYZ12', needsAttention: true,
    payment: { provider: 'wompi', amountCents: 100, status: 'pago_sin_reserva', reason: 'insert_failed' } });
  assert.match(bad, /hoy-web-resolve" data-web="EST-XYZ12" data-resolution="reserva_creada"/);
  assert.match(bad, /data-resolution="devuelto"/);
  const orphan = { webCode: 'EST-ORPH1', bookingCode: '77', guestName: 'B', hasEmail: true, pmsStatus: 'confirmed', payment: null, needsAttention: false, source: 'otasync' };
  const o1 = ctx.hoyWebRow(orphan, false);
  assert.match(o1, /Sin registro de pago/);
  assert.doesNotMatch(o1, /hoy-resend/);
  const o2 = ctx.hoyWebRow(orphan, true);
  assert.doesNotMatch(o2, /Sin registro de pago/);
});
