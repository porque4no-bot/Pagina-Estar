/* Frente "Mercado Pago igual de sólido que Wompi" (producción oct-2026).
 *
 * Hoy TODOS los pagos web entran por Mercado Pago. Evidencia de producción:
 *   - re-entregas del webhook crearon reservas DUPLICADAS días/semanas después
 *     (EST-V8M3U, EST-M1641) y booking-results quedó apuntando a la cancelada;
 *   - el pago quedó DOS veces en el folio de Kunas (3083706, 3273564);
 *   - avisos merchant_order (IPN) → 404 → 502 → reintentos sin fin;
 *   - la ruta MP no mandaba correo, ni email/teléfono a OTASync, ni Odoo, ni
 *     snapshot para reembolsos, ni plan tarifario, ni descuento.
 *
 * Todo con dependencias inyectadas: sin red, sin Blobs reales, sin OTASync,
 * sin Resend, sin Odoo. */

const test = require('node:test');
const assert = require('node:assert/strict');

const payments = require('../../netlify/functions/_payments');
const { processApprovedPayment, createDirectReference, decodeDirectReference, normalizeTransaction } = payments;
const { buildDirectReservationPayload, writeBookingResult } = payments._test;

/* ── helpers ─────────────────────────────────────────────────────────── */

function memBlobs(seed = {}) {
  const buckets = new Map();
  const bucket = (n) => { if (!buckets.has(n)) buckets.set(n, new Map()); return buckets.get(n); };
  for (const [n, e] of Object.entries(seed)) {
    const b = bucket(n);
    for (const [k, v] of Object.entries(e)) b.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  const getStore = (name) => {
    const b = bucket(typeof name === 'string' ? name : name.name);
    return {
      async get(k) { return b.has(k) ? b.get(k) : null; },
      async set(k, v) { b.set(k, v); return { modified: true }; },
      async delete(k) { b.delete(k); }
    };
  };
  const read = (n, k) => { const b = buckets.get(n); return b && b.has(k) ? JSON.parse(b.get(k)) : null; };
  return { getStore, buckets, read };
}

let txSeq = 0;
function nextTx(prefix = 'MP') { txSeq += 1; return `${prefix}-${Date.now()}-${txSeq}`; }

function refFor(bookingCode, amountCents, over = {}) {
  return createDirectReference({
    checkin: '2026-11-10', checkout: '2026-11-12', guestsCount: 1, roomTypeId: '31348',
    firstName: 'Ana', lastName: 'Ríos', email: 'ana@example.com', phone: '+57 300 111 2233',
    extrasMask: '1000000', bookingCode, amountCents, ...over
  });
}

function mpTx(ref, id, amountCents, over = {}) {
  return {
    id, provider: 'mercadopago', status: 'approved', currency: 'COP', reference: ref,
    amountCents, amount: amountCents / 100, paymentMethod: 'visa', paymentType: 'credit_card',
    cardLast4: '4242', cardBrand: 'visa', authorizationCode: 'A1B2', paymentDate: '2026-10-08T12:00:00Z',
    approved: true, ...over
  };
}

/* Deps por defecto: todo falso/in-memory. `calls` registra cada efecto. */
function makeDeps({ blobs = memBlobs(), insertImpl, avail = { '31348': 3 }, found = null, matchedPlan = null, flags = {}, resilient = 'true', lock = { acquired: true } } = {}) {
  const calls = { insert: [], alerts: [], emails: [], details: [], partners: [], mailing: [], discounts: [], lock: 0, release: 0, legacy: [] };
  const deps = {
    getStore: blobs.getStore,
    hasOtasyncCreds: () => true,
    getAvailabilityByType: async () => ({ availByType: avail, isMock: false }),
    insertReservation: async (p) => { calls.insert.push(p); return insertImpl ? insertImpl(p) : { id_reservations: 3300001 }; },
    legacyInsert: async (p) => { calls.legacy.push(p); return { id_reservations: 3300999 }; },
    acquireQuoteLock: async () => { calls.lock++; return lock; },
    releaseQuoteLock: async () => { calls.release++; },
    otasyncCreds: () => ({ token: 't', propertyId: '9889', channelId: '66483', channelName: 'Pagina web' }),
    getSessionKey: async () => 'pkey',
    findReservationByReference: async () => found,
    verifyDirectBookingAmount: async () => (matchedPlan ? { ok: true, matchedPlan } : { ok: false, reason: 'price_mismatch' }),
    sendConfirmationEmail: async (p) => { calls.emails.push(p); return { sent: true }; },
    savePaymentDetails: async (code, tx, extra) => { calls.details.push({ code, tx, extra }); return { saved: true }; },
    consumeDiscountUse: async (code, opts) => { calls.discounts.push({ code, opts }); return { ok: true }; },
    upsertPartner: async (d) => { calls.partners.push(d); return { id: 1 }; },
    addToMailingList: async (d) => { calls.mailing.push(d); return { ok: true }; },
    reportAlert: async (a) => { calls.alerts.push(a); return { alerted: true }; },
    settingsGet: async (k, fb) => (k === 'MP_DIRECT_RESILIENT_ENABLED' ? (resilient === undefined ? fb : resilient) : fb),
    flag: async (k) => Boolean(flags[k]),
    trackPurchase: async () => {}
  };
  return { deps, calls, blobs };
}

const H = { 'Content-Type': 'application/json' };
const body = (res) => JSON.parse(res.body);

/* ── (1) ruta resiliente = DEFAULT, leída vía _settings (panel) ─────────── */

test('ruta resiliente: sin definir ⇒ ON; el override del panel "false" ⇒ legacy', async () => {
  assert.equal(await payments.mpDirectResilient({ settingsGet: async (k, fb) => fb }), true, 'sin definir = encendida');
  assert.equal(await payments.mpDirectResilient({ settingsGet: async () => 'false' }), false, "'false' la apaga");
  assert.equal(await payments.mpDirectResilient({ settingsGet: async () => 'FALSE' }), false);
  assert.equal(await payments.mpDirectResilient({ settingsGet: async () => 'true' }), true);
  assert.equal(await payments.mpDirectResilient({ settingsGet: async () => { throw new Error('x'); } }), true, 'ante error, segura (ON)');

  const { deps, calls } = makeDeps({ resilient: 'false' });
  const res = await processApprovedPayment(mpTx(refFor('EST-LEG1', 30000000), nextTx(), 30000000), H, deps);
  assert.equal(body(res).success, true);
  assert.equal(calls.legacy.length, 1, 'con el panel en false usa la inserción legacy');
  assert.equal(calls.insert.length, 0);
  assert.equal(calls.lock, 0);
});

/* ── (4)(6)(9) payload: pago UNA vez, email/teléfono, plan ─────────────── */

test('FOLIO DOBLE: el pago va SOLO en el nivel superior (rooms[].payments vacío)', () => {
  const decoded = decodeDirectReference(refFor('EST-PAY1', 30000000));
  const { payload } = buildDirectReservationPayload({
    decoded, transaction: mpTx('x', 'MP-PAY1', 30000000), pkey: 'k',
    creds: { token: 't', propertyId: '9889' }, roomDetails: {}, ratePlan: 'flexible', guestNote: ''
  });
  assert.deepEqual(payload.rooms[0].payments, [], 'nada de pagos a nivel de habitación');
  assert.equal(payload.payments.length, 1, 'un único registro de pago');
  assert.equal(payload.payments[0].amount, 300000);
  const totalPayments = payload.payments.length + payload.rooms.reduce((s, r) => s + r.payments.length, 0);
  assert.equal(totalPayments, 1, 'el folio recibe el pago exactamente una vez');
});

test('la reserva lleva email y teléfono del huésped (get-booking / cancelación la encuentran)', () => {
  const decoded = decodeDirectReference(refFor('EST-PAY2', 30000000));
  const { payload } = buildDirectReservationPayload({
    decoded, transaction: mpTx('x', 'MP-PAY2', 30000000), pkey: 'k',
    creds: { token: 't', propertyId: '9889' }, roomDetails: {}, ratePlan: 'best', guestNote: 'Llego tarde'
  });
  assert.equal(payload.guests[0].email, 'ana@example.com');
  assert.equal(payload.guests[0].phone, '+57 300 111 2233');
  assert.equal(payload.guest_email, 'ana@example.com');
  assert.match(payload.note, /Plan: Estricta/);
  assert.match(payload.note, /Nota del huésped: Llego tarde/);
  assert.equal(payload.reference, 'EST-PAY2');
});

/* ── éxito: correo, snapshot, Odoo, plan, descuento ─────────────────────── */

test('éxito: correo de confirmación desde el servidor, snapshot del pago, Odoo y plan derivado del monto', async () => {
  const blobs = memBlobs({
    'booking-marketing': { 'mkt-EST-OK1': { accepted: true, email: 'ana@example.com' } },
    'booking-discounts': { 'disc-EST-OK1': { code: 'RESENA10', email: 'ana@example.com', signedAmountCents: 27000000 } }
  });
  const { deps, calls } = makeDeps({ blobs, matchedPlan: 'flexible' });
  const tx = mpTx(refFor('EST-OK1', 27000000, { ratePlan: 'best' }), nextTx(), 27000000);
  const res = await processApprovedPayment(tx, H, deps);
  assert.equal(body(res).success, true);
  assert.equal(body(res).bookingCode, 3300001);
  assert.equal(calls.insert.length, 1);

  // (5) correo desde el servidor, con el código de OTASync (mismo dedupe que el navegador)
  assert.equal(calls.emails.length, 1);
  assert.equal(calls.emails[0].guestEmail, 'ana@example.com');
  assert.equal(calls.emails[0].bookingCode, '3300001');
  assert.equal(calls.emails[0].breakfast, true, 'el extra desayuno (pos. 0) activa el pase QR');

  // (9) plan derivado del MONTO (flexible) aunque la referencia diga Estricta
  assert.match(calls.insert[0].note, /Plan: Flexible/);
  const br = blobs.read('booking-results', 'direct-EST-OK1');
  assert.equal(br.ratePlan, 'flexible');
  assert.equal(br.transactionId, tx.id);

  // (8) snapshot de pago para reembolsos (código OTASync y código EST-)
  assert.deepEqual(calls.details.map(d => String(d.code)).sort(), ['3300001', 'EST-OK1'].sort());
  assert.equal(calls.details[0].extra.ratePlan, 'flexible');

  // (7) Odoo con opt-in de marketing
  assert.equal(calls.partners.length, 1);
  assert.ok(calls.partners[0].tags.includes('Opt-in marketing'));
  assert.equal(calls.mailing.length, 1);

  // (11) consumo del descuento tras crear la reserva, idempotente por código
  assert.equal(calls.discounts.length, 1);
  assert.equal(calls.discounts[0].code, 'RESENA10');
  assert.equal(calls.discounts[0].opts.bookingCode, 'EST-OK1');
  assert.equal(calls.alerts.length, 0, 'un pago normal no alerta');
});

test('sin opt-in de marketing: solo el partner en Odoo, sin lista de correo; sin descuento no se consume nada', async () => {
  const { deps, calls } = makeDeps({});
  await processApprovedPayment(mpTx(refFor('EST-OK2', 30000000), nextTx(), 30000000), H, deps);
  assert.equal(calls.partners.length, 1);
  assert.ok(!calls.partners[0].tags.includes('Opt-in marketing'));
  assert.equal(calls.mailing.length, 0);
  assert.equal(calls.discounts.length, 0);
});

test('plan: si no se puede recomputar, cae al plan codificado en la referencia', async () => {
  const { deps, calls } = makeDeps({ matchedPlan: null });
  await processApprovedPayment(mpTx(refFor('EST-OK3', 30000000, { ratePlan: 'flexible' }), nextTx(), 30000000), H, deps);
  assert.match(calls.insert[0].note, /Plan: Flexible/);
});

test('nota del huésped → OTASync solo con GUEST_NOTES_TO_PMS_ENABLED', async () => {
  const seed = { 'booking-notes': { 'note-EST-N1': { notes: 'Alergia al <maní>' }, 'note-EST-N2': { notes: 'Otra nota' } } };
  const on = makeDeps({ blobs: memBlobs(seed), flags: { GUEST_NOTES_TO_PMS_ENABLED: true } });
  await processApprovedPayment(mpTx(refFor('EST-N1', 30000000), nextTx(), 30000000), H, on.deps);
  assert.match(on.calls.insert[0].note, /Nota del huésped: Alergia al &lt;maní&gt;/, 'escapada');
  const off = makeDeps({ blobs: memBlobs(seed) });
  await processApprovedPayment(mpTx(refFor('EST-N2', 30000000), nextTx(), 30000000), H, off.deps);
  assert.doesNotMatch(off.calls.insert[0].note, /Nota del huésped/);
});

/* ── (3) idempotencia: re-entregas días después JAMÁS crean otra reserva ── */

test('re-entrega semanas después (se perdió la marca por tx) con booking-results confirmado → NO inserta y no lo pisa', async () => {
  const txId = nextTx();
  const blobs = memBlobs({
    'booking-results': { 'direct-EST-RE1': { bookingCode: 3083706, otasyncId: 3083706, transactionId: txId, provider: 'mercadopago' } }
  });
  const { deps, calls } = makeDeps({ blobs });
  const res = await processApprovedPayment(mpTx(refFor('EST-RE1', 30000000), txId, 30000000), H, deps);
  assert.equal(body(res).duplicate, true);
  assert.equal(body(res).bookingCode, 3083706);
  assert.equal(calls.insert.length, 0, 'no se crea otra reserva');
  assert.equal(blobs.read('booking-results', 'direct-EST-RE1').bookingCode, 3083706, 'booking-results intacto');
  assert.equal(calls.alerts.length, 0, 'misma transacción → sin alerta de doble pago');
  assert.equal(calls.emails.length, 0, 'no reenvía el correo');
});

test('re-entrega del MISMO tx con registro por estadía de hace semanas → duplicado (la edad no importa para el mismo tx)', async () => {
  const txId = nextTx();
  const key = 'booking_31348_2026-11-10_2026-11-12_ana@example.com';
  const blobs = memBlobs({
    'booking-idempotency': { [key]: { bookingCode: 3273564, transactionId: txId, createdAt: Date.now() - 30 * 86400000 } }
  });
  const { deps, calls } = makeDeps({ blobs });
  const res = await processApprovedPayment(mpTx(refFor('EST-RE2', 30000000), txId, 30000000), H, deps);
  assert.equal(body(res).duplicate, true);
  assert.equal(body(res).bookingCode, 3273564);
  assert.equal(calls.insert.length, 0);
});

test('última defensa: si OTASync ya tiene una reserva con esa reference, NO inserta y repara booking-results', async () => {
  const blobs = memBlobs();
  const { deps, calls } = makeDeps({ blobs, found: { idReservations: '3083706', reference: 'EST-RE3', status: 'confirmed' } });
  const res = await processApprovedPayment(mpTx(refFor('EST-RE3', 30000000), nextTx(), 30000000), H, deps);
  assert.equal(body(res).duplicate, true);
  assert.equal(body(res).bookingCode, '3083706');
  assert.equal(calls.insert.length, 0);
  const br = blobs.read('booking-results', 'direct-EST-RE3');
  assert.equal(br.bookingCode, '3083706');
  assert.ok(!br.reservationPending);
});

test('otro pago (otro tx) para un código que ya tiene reserva → alerta de doble pago, NO inserta', async () => {
  const blobs = memBlobs({
    'booking-results': { 'direct-EST-RE4': { bookingCode: 3300100, transactionId: 'MP-FIRST' } }
  });
  const { deps, calls } = makeDeps({ blobs });
  const tx = nextTx();
  const res = await processApprovedPayment(mpTx(refFor('EST-RE4', 30000000), tx, 30000000), H, deps);
  assert.equal(body(res).duplicate, true);
  assert.equal(calls.insert.length, 0);
  assert.equal(calls.alerts.length, 1);
  assert.equal(calls.alerts[0].kind, 'payment_double_charge');
  assert.equal(calls.alerts[0].dedupeKey, `pay-double-${tx}`);
});

test('un falso "agotada" ya no pisa el resultado bueno: con reserva confirmada no se mira disponibilidad', async () => {
  const txId = nextTx();
  const blobs = memBlobs({
    'booking-results': { 'direct-EST-SO1': { bookingCode: 3300200, transactionId: txId } }
  });
  const { deps, calls } = makeDeps({ blobs, avail: { '31348': 0 } });
  await processApprovedPayment(mpTx(refFor('EST-SO1', 30000000), txId, 30000000), H, deps);
  const br = blobs.read('booking-results', 'direct-EST-SO1');
  assert.equal(br.bookingCode, 3300200);
  assert.ok(!br.reservationPending, 'no se escribió un sold_out encima');
  assert.equal(calls.alerts.length, 0);
});

test('writeBookingResult: un pendiente o una segunda reserva NUNCA pisan un confirmado; un pendiente sí se actualiza', async () => {
  const blobs = memBlobs({ 'booking-results': { 'direct-EST-W1': { bookingCode: 111, transactionId: 'T1' } } });
  const store = blobs.getStore('booking-results');
  let r = await writeBookingResult(store, 'EST-W1', { bookingCode: 'EST-W1', reservationPending: true, reason: 'sold_out' });
  assert.equal(r.written, false);
  r = await writeBookingResult(store, 'EST-W1', { bookingCode: 222, transactionId: 'T2' });
  assert.equal(r.written, false);
  assert.equal(blobs.read('booking-results', 'direct-EST-W1').bookingCode, 111);
  await writeBookingResult(store, 'EST-W2', { bookingCode: 'EST-W2', reservationPending: true });
  r = await writeBookingResult(store, 'EST-W2', { bookingCode: 333 });
  assert.equal(r.written, true, 'un pendiente puede pasar a confirmado');
});

/* ── (10) alertas de dinero vía reportAlert (correo + tarea) ─────────────── */

test('agotada de verdad → booking-results pendiente + alerta "pago sin reserva" vía reportAlert', async () => {
  const blobs = memBlobs();
  const { deps, calls } = makeDeps({ blobs, avail: { '31348': 0 } });
  const tx = nextTx();
  const res = await processApprovedPayment(mpTx(refFor('EST-SO2', 30000000), tx, 30000000), H, deps);
  assert.equal(body(res).reservationPending, true);
  assert.equal(blobs.read('booking-results', 'direct-EST-SO2').reason, 'sold_out');
  assert.equal(calls.alerts.length, 1);
  assert.equal(calls.alerts[0].kind, 'payment_without_reservation');
  assert.equal(calls.alerts[0].severity, 'critical');
  assert.equal(calls.alerts[0].dedupeKey, `pay-noreservation-${tx}`);
  assert.equal(calls.insert.length, 0);
});

test('insert fallido → pendiente + alerta vía reportAlert (no sendEmail suelto)', async () => {
  const { deps, calls, blobs } = makeDeps({ insertImpl: async () => { throw new Error('OTASync 500'); } });
  const res = await processApprovedPayment(mpTx(refFor('EST-IF1', 30000000), nextTx(), 30000000), H, deps);
  assert.equal(body(res).reservationPending, true);
  assert.equal(blobs.read('booking-results', 'direct-EST-IF1').reason, 'insert_failed');
  assert.equal(calls.alerts.length, 1);
  assert.equal(calls.alerts[0].kind, 'payment_without_reservation');
  assert.equal(calls.emails.length, 0, 'sin reserva no hay correo de confirmación');
  assert.equal(calls.release, 1, 'libera el lock');
});

test('monto incorrecto → alerta "monto incorrecto" vía reportAlert y NO inserta', async () => {
  const { deps, calls } = makeDeps({});
  const res = await processApprovedPayment(mpTx(refFor('EST-AM1', 30000000), nextTx(), 100000), H, deps);
  assert.match(body(res).message, /mismatch/i);
  assert.equal(calls.insert.length, 0);
  assert.equal(calls.alerts[0].kind, 'payment_amount_mismatch');
});

test('doble pago de la misma estadía (otro tx, < 7 días) → alerta vía reportAlert', async () => {
  const key = 'booking_31348_2026-11-10_2026-11-12_ana@example.com';
  const blobs = memBlobs({ 'booking-idempotency': { [key]: { bookingCode: 3300300, transactionId: 'MP-OTHER', createdAt: Date.now() } } });
  const { deps, calls } = makeDeps({ blobs });
  const res = await processApprovedPayment(mpTx(refFor('EST-DS1', 30000000), nextTx(), 30000000), H, deps);
  assert.equal(body(res).duplicate, true);
  assert.equal(calls.alerts[0].kind, 'payment_double_charge');
  assert.match(calls.alerts[0].message, /misma estadía/);
});

/* ── referencia: plan nuevo, compatibilidad hacia atrás ─────────────────── */

test('referencia MPDIR: plan en la posición 14 y compatibilidad con referencias viejas', () => {
  const withPlan = decodeDirectReference(refFor('EST-R1', 1000, { ratePlan: 'flexible' }));
  assert.equal(withPlan.ratePlan, 'flexible');
  assert.equal(decodeDirectReference(refFor('EST-R2', 1000, { ratePlan: 'best' })).ratePlan, 'best');
  const old = decodeDirectReference(refFor('EST-R3', 1000)); // sin plan (formato anterior)
  assert.equal(old.ratePlan, undefined);
  assert.equal(old.amountCents, 1000);
  assert.equal(old.bookingCode, 'EST-R3');
});

/* ── (8) normalización + snapshot de Mercado Pago ───────────────────────── */

test('normalizeTransaction(MP) conserva los datos que pide un reembolso y el snapshot los mapea', () => {
  const tx = normalizeTransaction('mercadopago', {
    id: 183120683902, status: 'approved', transaction_amount: 132246, currency_id: 'COP',
    external_reference: 'MPDIR-x', payment_method_id: 'master', payment_type_id: 'credit_card',
    card: { last_four_digits: '1234' }, authorization_code: '654321', installments: 1,
    date_approved: '2026-10-08T15:00:00.000-05:00'
  });
  assert.equal(tx.cardLast4, '1234');
  assert.equal(tx.authorizationCode, '654321');
  assert.equal(tx.paymentType, 'credit_card');
  const { extractMercadoPagoPaymentDetails } = require('../../netlify/functions/_payment-details');
  const d = extractMercadoPagoPaymentDetails(tx);
  assert.equal(d.provider, 'mercadopago');
  assert.equal(d.transactionId, '183120683902');
  assert.equal(d.method, 'master');
  assert.equal(d.cardLast4, '1234');
  assert.equal(d.authCode, '654321');
  assert.equal(d.amountInCents, 13224600);
  assert.equal(d.paymentDate, '2026-10-08T15:00:00.000-05:00');
  assert.equal(d.reference, null, 'no guarda la referencia larga (PII)');
});
