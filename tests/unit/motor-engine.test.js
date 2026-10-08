/* Motor de reservas (frente "motor"): lógica pura de motor-logic.js + paridad
 * de las páginas ES/EN del motor y de sus textos.
 *
 * - Capacidad: el selector llega a 5 (Selección) y un apartaestudio no se puede
 *   elegir para más huéspedes de los que admite.
 * - Estados del pago: aprobado ≠ en proceso; plan de consultas a booking-status
 *   dentro del límite de 60 consultas / 5 min por IP.
 * - Retorno de Mercado Pago: el código sale de external_reference (también sin
 *   borrador) y es compatible con _payments.createDirectReference.
 * - Teléfono para Wompi según el país (antes siempre +57).
 * - en/reservar.html define los mismos helpers de fecha que reservar.html
 *   ("Modificar búsqueda" tumbaba el motor en inglés por falta de addDays).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const logic = require('../../motor-logic.js');
const roomsDb = require('../../rooms_db.json');
const motorEs = require('../../i18n/motor.es.json');
const motorEn = require('../../i18n/motor.en.json');
const { createDirectReference } = require('../../netlify/functions/_payments');

const reservarEs = fs.readFileSync(path.join(root, 'reservar.html'), 'utf8');
const reservarEn = fs.readFileSync(path.join(root, 'en/reservar.html'), 'utf8');
const motorSrc = fs.readFileSync(path.join(root, 'motor-app.jsx'), 'utf8');

/* ── Capacidad ─────────────────────────────────────────────────────────── */

test('MAX_GUESTS coincide con la capacidad máxima de rooms_db.json', () => {
  const maxCap = Math.max(...Object.values(roomsDb).map(r => Number(r.capacity)));
  assert.equal(logic.MAX_GUESTS, maxCap);
});

test('clampGuests: entero entre 1 y MAX_GUESTS, con default para basura', () => {
  assert.equal(logic.clampGuests('4', 2), 4);
  assert.equal(logic.clampGuests('5', 2), 5);
  assert.equal(logic.clampGuests('9', 2), logic.MAX_GUESTS);
  assert.equal(logic.clampGuests('0', 2), 2);
  assert.equal(logic.clampGuests('abc', 2), 2);
  assert.equal(logic.clampGuests(null, 3), 3);
});

test('roomFitsGuests usa la capacidad del apartaestudio (desconocida = no bloquea)', () => {
  const clasica = { id: 'clasica', capacity: 2 };
  const seleccion = { id: 'seleccion', capacity: 5 };
  assert.equal(logic.roomFitsGuests(clasica, 2), true);
  assert.equal(logic.roomFitsGuests(clasica, 4), false);
  assert.equal(logic.roomFitsGuests(seleccion, 5), true);
  assert.equal(logic.roomFitsGuests(seleccion, 6), false);
  assert.equal(logic.roomFitsGuests({ id: 'x' }, 9), true);
  assert.equal(logic.roomFitsGuests(null, 3), true);
  assert.equal(logic.roomCapacity({ capacity: '3' }), 3);
  assert.equal(logic.roomCapacity({}), null);
});

test('fill reemplaza {claves} y deja las desconocidas', () => {
  assert.equal(logic.fill('Hasta {capacity} pers. para {guests}', { capacity: 2, guests: 4 }), 'Hasta 2 pers. para 4');
  assert.equal(logic.fill('{x} y {y}', { x: 1 }), '1 y {y}');
});

test('BE_ROOMS de reservar.html y en/reservar.html tienen la capacidad de rooms_db.json', () => {
  for (const [label, html] of [['es', reservarEs], ['en', reservarEn]]) {
    for (const [id, room] of Object.entries(roomsDb)) {
      const m = html.match(new RegExp(`roomTypeId:'${id}'[^}]*?capacity:(\\d+)`));
      assert.ok(m, `${label}: falta ${id} en BE_ROOMS`);
      assert.equal(Number(m[1]), Number(room.capacity), `${label}: capacidad de ${id}`);
    }
  }
});

/* ── Estados del pago y plan de consultas ──────────────────────────────── */

test('phaseForPaymentStatus: APPROVED = confirmando, PENDING = en proceso', () => {
  assert.equal(logic.phaseForPaymentStatus('APPROVED'), 'confirming');
  assert.equal(logic.phaseForPaymentStatus('approved'), 'confirming');
  assert.equal(logic.phaseForPaymentStatus('PENDING'), 'processing');
  assert.equal(logic.phaseForPaymentStatus('DECLINED'), null);
  assert.equal(logic.phaseForPaymentStatus(undefined), null);
});

test('interpretBookingStatus distingue confirmada / pago recibido en revisión / pendiente', () => {
  assert.equal(logic.interpretBookingStatus({ status: 'confirmed', reservationPending: false }), 'confirmed');
  assert.equal(logic.interpretBookingStatus({ status: 'confirmed', reservationPending: true }), 'reservationPending');
  assert.equal(logic.interpretBookingStatus({ status: 'pending' }), 'pending');
  assert.equal(logic.interpretBookingStatus(null), 'pending');
  assert.equal(logic.interpretBookingStatus({ error: 'Too many requests' }), 'pending');
});

test('interpretWompiStatus y wompiApiBase', () => {
  assert.equal(logic.interpretWompiStatus('APPROVED'), 'approved');
  for (const s of ['DECLINED', 'VOIDED', 'ERROR']) assert.equal(logic.interpretWompiStatus(s), 'declined');
  assert.equal(logic.interpretWompiStatus('PENDING'), 'pending');
  assert.equal(logic.interpretWompiStatus(undefined), 'pending');
  assert.equal(logic.wompiApiBase('pub_test_abc'), 'https://sandbox.wompi.co/v1');
  assert.equal(logic.wompiApiBase('pub_prod_abc'), 'https://production.wompi.co/v1');
  assert.equal(logic.wompiApiBase(''), 'https://production.wompi.co/v1');
});

/* Simula la línea de tiempo de consultas (la primera es inmediata) y cuenta el
   máximo de consultas en cualquier ventana de 5 minutos. */
function pollTimeline(phaseAt) {
  const times = [0];
  let t = 0;
  for (let attempt = 1; ; attempt++) {
    const delay = logic.nextPollDelay(attempt, phaseAt(attempt));
    if (delay == null) break;
    t += delay;
    times.push(t);
  }
  return times;
}
function maxInWindow(times, windowMs) {
  let max = 0;
  for (let i = 0; i < times.length; i++) {
    let n = 0;
    for (let j = i; j < times.length && times[j] - times[i] < windowMs; j++) n++;
    max = Math.max(max, n);
  }
  return max;
}

test('plan de consultas: pago aprobado ~1 min en pantalla y luego segundo plano', () => {
  const plan = logic.pollPlan('confirming');
  assert.equal(logic.nextPollDelay(1, 'confirming'), 2000);
  assert.equal(logic.fastPollsDone(plan.fast - 1, 'confirming'), false);
  assert.equal(logic.fastPollsDone(plan.fast, 'confirming'), true);
  const times = pollTimeline(() => 'confirming');
  assert.ok(times[plan.fast - 1] <= 60000, 'la espera en pantalla no pasa de ~1 minuto');
  assert.ok(times[times.length - 1] >= 4 * 60000, 'sigue consultando al menos ~4 min en segundo plano');
  assert.equal(logic.nextPollDelay(plan.fast + plan.slow, 'confirming'), null);
});

test('plan de consultas: pago en proceso sigue consultando varios minutos', () => {
  const times = pollTimeline(() => 'processing');
  assert.ok(times[times.length - 1] >= 8 * 60000, 'consulta al menos ~8 minutos');
  assert.equal(logic.nextPollDelay(1, 'processing'), 2000);
});

test('ningún plan supera el límite de booking-status (60 consultas / 5 min por IP)', () => {
  const FIVE_MIN = 5 * 60 * 1000;
  assert.ok(maxInWindow(pollTimeline(() => 'confirming'), FIVE_MIN) <= 55);
  assert.ok(maxInWindow(pollTimeline(() => 'processing'), FIVE_MIN) <= 55);
  /* PSE en proceso que se aprueba a mitad de camino (cambia de plan). */
  for (const switchAt of [5, 15, 20, 40]) {
    const times = pollTimeline(a => (a < switchAt ? 'processing' : 'confirming'));
    assert.ok(maxInWindow(times, FIVE_MIN) <= 55, `cambio en la consulta ${switchAt}`);
  }
});

/* ── Retorno de Mercado Pago ───────────────────────────────────────────── */

const MP_PAYLOAD = {
  checkin: '2026-11-20',
  checkout: '2026-11-23',
  guestsCount: 2,
  roomTypeId: '31349',
  firstName: 'Ana María',
  lastName: 'Peña',
  email: 'ana@example.com',
  phone: '+57 300 111 2233',
  extrasMask: '1000000',
  bookingCode: 'EST-AB12C',
  isColombian: true,
  isBusiness: false,
  amountCents: 79500000
};

test('decodeMpReference lee la referencia de _payments.createDirectReference (con tildes)', () => {
  const ref = createDirectReference(MP_PAYLOAD);
  const d = logic.decodeMpReference(ref);
  assert.equal(d.code, 'EST-AB12C');
  assert.equal(d.checkin, '2026-11-20');
  assert.equal(d.checkout, '2026-11-23');
  assert.equal(d.guests, 2);
  assert.equal(d.roomTypeId, '31349');
  assert.equal(d.firstName, 'Ana María');
  assert.equal(d.lastName, 'Peña');
  assert.equal(d.email, 'ana@example.com');
  assert.equal(d.amountCents, 79500000);
  assert.equal(logic.decodeMpReference('COT-123'), null);
  assert.equal(logic.decodeMpReference('MPDIR-%%%'), null);
  assert.equal(logic.decodeMpReference(''), null);
});

test('readMpReturn: el código sale de external_reference aunque no haya borrador', () => {
  const ref = createDirectReference(MP_PAYLOAD);
  const r = logic.readMpReturn(`?payment=success&payment_id=999&external_reference=${encodeURIComponent(ref)}`, null, Date.now());
  assert.equal(r.code, 'EST-AB12C');
  assert.equal(r.status, 'APPROVED');
  assert.equal(r.paymentId, '999');
  assert.equal(r.reference.roomTypeId, '31349');

  const pending = logic.readMpReturn(`?payment=pending&collection_id=55&external_reference=${encodeURIComponent(ref)}`, null, Date.now());
  assert.equal(pending.status, 'PENDING');
  assert.equal(pending.paymentId, '55');
});

test('readMpReturn: sin referencia usa el código guardado (si no venció) y nunca en failure', () => {
  const now = Date.now();
  const stored = JSON.stringify({ code: 'EST-ZZ999', savedAt: now - 60 * 1000 });
  assert.equal(logic.readMpReturn('?payment=success', stored, now).code, 'EST-ZZ999');
  const old = JSON.stringify({ code: 'EST-ZZ999', savedAt: now - 3 * 60 * 60 * 1000 });
  assert.equal(logic.readMpReturn('?payment=success', old, now), null);
  assert.equal(logic.readMpReturn('?payment=success', null, now), null);
  assert.equal(logic.readMpReturn('?payment=failure', stored, now), null);
  assert.equal(logic.readMpReturn('', stored, now), null);
  assert.equal(logic.readMpReturn('?payment=success', '{malformado', now), null);
});

test('readPendingPayment respeta el TTL y descarta basura', () => {
  const now = Date.now();
  const ok = JSON.stringify({ code: 'EST-1', provider: 'wompi', savedAt: now - 1000 });
  assert.equal(logic.readPendingPayment(ok, now).code, 'EST-1');
  const expired = JSON.stringify({ code: 'EST-1', savedAt: now - logic.PAY_PENDING_TTL_MS - 1 });
  assert.equal(logic.readPendingPayment(expired, now), null);
  assert.equal(logic.readPendingPayment('{', now), null);
  assert.equal(logic.readPendingPayment(null, now), null);
  assert.equal(logic.readPendingPayment(JSON.stringify({ savedAt: now }), now), null);
});

/* ── Teléfono para Wompi ───────────────────────────────────────────────── */

test('splitPhoneForWompi: indicativo según el país o el que escribió el huésped', () => {
  assert.deepEqual(logic.splitPhoneForWompi('300 111 2233', 'Colombia'), { prefix: '+57', number: '3001112233' });
  assert.deepEqual(logic.splitPhoneForWompi('+57 300 111 2233', 'Colombia'), { prefix: '+57', number: '3001112233' });
  assert.deepEqual(logic.splitPhoneForWompi('573001112233', 'Colombia'), { prefix: '+57', number: '3001112233' });
  assert.deepEqual(logic.splitPhoneForWompi('612 345 678', 'España'), { prefix: '+34', number: '612345678' });
  assert.deepEqual(logic.splitPhoneForWompi('612 345 678', 'Spain'), { prefix: '+34', number: '612345678' });
  assert.deepEqual(logic.splitPhoneForWompi('(305) 555-0199', 'Estados Unidos'), { prefix: '+1', number: '3055550199' });
  assert.deepEqual(logic.splitPhoneForWompi('0991234567', 'Ecuador'), { prefix: '+593', number: '0991234567' });
  assert.deepEqual(logic.splitPhoneForWompi('5512345678', 'México'), { prefix: '+52', number: '5512345678' });
  /* Indicativo escrito explícitamente gana sobre el país declarado. */
  assert.deepEqual(logic.splitPhoneForWompi('+34 612 345 678', 'Colombia'), { prefix: '+34', number: '612345678' });
  assert.deepEqual(logic.splitPhoneForWompi('0034 612 345 678', 'Otro'), { prefix: '+34', number: '612345678' });
  /* Sin forma segura de saberlo → null (el widget lo pide). */
  assert.equal(logic.splitPhoneForWompi('+44 20 7946 0958', 'Otro'), null);
  assert.equal(logic.splitPhoneForWompi('20 7946 0958', 'Otro'), null);
  assert.equal(logic.splitPhoneForWompi('', 'Colombia'), null);
  assert.equal(logic.splitPhoneForWompi('123', 'Colombia'), null);
});

/* ── Errores del servidor y textos ─────────────────────────────────────── */

test('errorKeyForServerReason traduce over_capacity / sold_out / price_mismatch a claves existentes', () => {
  for (const reason of ['over_capacity', 'sold_out', 'price_mismatch']) {
    const key = logic.errorKeyForServerReason(reason);
    assert.ok(key, reason);
    assert.ok(motorEs[key] && motorEn[key], `falta ${key} en i18n`);
    assert.ok(!motorEs[key].includes(reason), 'nunca el código interno');
  }
  assert.equal(logic.errorKeyForServerReason('price_check_unavailable'), null);
});

test('i18n del motor: selector 1-5, sin "Kunas" visible y con los textos de estados del pago', () => {
  for (const dict of [motorEs, motorEn]) {
    for (let n = 1; n <= logic.MAX_GUESTS; n++) assert.ok(dict[String(n)], `opción ${n}`);
    assert.ok(!JSON.stringify(dict).includes('Kunas'));
    for (const key of ['waitProcessingTitle', 'waitConfirmingTitle', 'processingBoxText', 'confirmingBoxText',
      'checkinOnline', 'bookingCodePlaceholder', 'privacyCancelLink', 'privacyPolicyLink', 'overCapacityMsg']) {
      assert.ok(dict[key], `falta ${key}`);
    }
  }
  assert.ok(!/o más|or more/.test(motorEs['4'] + motorEn['4']), '"4 o más" ya no aplica: el selector llega a 5');
  assert.notEqual(motorEs.bookingCodePlaceholder, 'EST-XXXXX');
  /* El texto del aviso de espera para un pago EN PROCESO no dice "aprobado". */
  assert.ok(!/aprobado/i.test(motorEs.waitProcessingTitle + motorEs.waitProcessingText));
  assert.ok(!/approved/i.test(motorEn.waitProcessingTitle + motorEn.waitProcessingText));
});

test('motor-app.jsx no muestra "Kunas" al huésped ni tiene las tildes faltantes de antes', () => {
  assert.ok(!/Kunas PMS/.test(motorSrc));
  assert.ok(!/Kunas (no creo|did not create)/.test(motorSrc));
  for (const bad of ['validacion*', 'Exencion preliminar', 'se validara', 'quedo pendiente de aprobacion', "telefono o notas e intentalo", 'segun nacionalidad']) {
    assert.ok(!motorSrc.includes(bad), `texto sin tilde: ${bad}`);
  }
  assert.ok(!motorSrc.includes("phoneNumberPrefix: '+57'"), 'el indicativo ya no es fijo');
  assert.ok(!motorSrc.includes('placeholder="EST-XXXXX"'));
});

/* ── Paridad ES/EN de los helpers globales del motor ───────────────────── */

const GLOBALS_USED_BY_MOTOR = ['BE_ROOMS', 'BE_EXTRAS', 'BE_PAYMENTS', 'buildExtrasMask', 'dateDiff', 'formatCOP', 'fmtDate',
  'bogotaToday', 'getToday', 'addDays', 'getOffset', 'genCode', 'calcTotal'];

function inlineEngineScript(html) {
  const m = html.match(/<script>\s*\/\/ Active payment provider[\s\S]*?<\/script>/);
  assert.ok(m, 'no se encontró el script de datos del motor');
  return m[0].replace(/^<script>/, '').replace(/<\/script>$/, '');
}

function functionSource(html, name) {
  const m = html.match(new RegExp(`function ${name}\\([^)]*\\)\\{[^\\n]*\\}`));
  return m ? m[0] : null;
}

test('reservar.html y en/reservar.html definen todos los globales que usa motor-app.jsx', () => {
  for (const [label, html] of [['es', reservarEs], ['en', reservarEn]]) {
    const ctx = { window: {} };
    vm.createContext(ctx);
    vm.runInContext(inlineEngineScript(html) + `;this.__g = { ${GLOBALS_USED_BY_MOTOR.map(n => `${n}: typeof ${n}`).join(', ')} };`, ctx);
    for (const name of GLOBALS_USED_BY_MOTOR) {
      assert.notEqual(ctx.__g[name], 'undefined', `${label}: falta ${name}`);
    }
  }
});

test('los helpers de fecha son idénticos en ES y EN (hora de Colombia, no UTC)', () => {
  for (const name of ['bogotaToday', 'getToday', 'addDays', 'getOffset', 'dateDiff', 'calcTotal', 'genCode']) {
    if (name === 'calcTotal') continue; /* multilínea: se valida por comportamiento abajo */
    const es = functionSource(reservarEs, name);
    const en = functionSource(reservarEn, name);
    assert.ok(es && en, `falta ${name}`);
    assert.equal(en, es, `${name} difiere entre ES y EN`);
  }
  assert.ok(/America\/Bogota/.test(functionSource(reservarEn, 'bogotaToday')));
  assert.ok(!/toISOString/.test(functionSource(reservarEn, 'getOffset')));
});

test('addDays/getOffset de la página en inglés no se corren de día', () => {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(inlineEngineScript(reservarEn) + ';this.__r = { a: addDays("2026-12-31", 1), b: addDays("2026-03-01", -1), c: getOffset(0) === bogotaToday() };', ctx);
  assert.equal(ctx.__r.a, '2027-01-01');
  assert.equal(ctx.__r.b, '2026-02-28');
  assert.equal(ctx.__r.c, true);
});
