'use strict';

/* Frente "stay": correos de pre-llegada / post-estadía con reservas de TODOS los
   canales de OTASync (web, Booking.com, Expedia, Airbnb, privadas…), correos
   relay de OTA, agrupación por huésped, dedupe y plantillas sin promesas falsas.
   Todo con dependencias inyectadas: cero red, cero Blobs, cero Resend. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const stay = require('../../netlify/functions/send-stay-emails');
const {
  runStayEmails, targetDates, shiftDate, eligiblePreArrival, eligiblePostStay, processBatch,
  mergeReservations, classifyEmail, channelFamily, contactPolicy, stayLang, staySubject, safeHttpsUrl,
  POST_LOOKBACK_DAYS, DEFAULT_GOOGLE_REVIEW_URL, DEFAULT_BOOKING_REVIEW_URL
} = stay._test;
const { normalizeReservation } = require('../../netlify/functions/_otasync');
const { preArrivalHtml, postStayHtml, guestCheckinUrl } = require('../../netlify/functions/_email');

/* Store en memoria con la misma interfaz que Netlify Blobs (get/set). */
function memStore(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    async get(k) { return data.has(k) ? data.get(k) : null; },
    async set(k, v) { data.set(k, v); }
  };
}

function resv(overrides = {}) {
  return {
    idReservations: '5001', status: 'confirmed', email: 'ana@gmail.com', firstName: 'Ana', lastName: 'Ruiz',
    dateArrival: '2026-10-10', dateDeparture: '2026-10-12', country: 'CO', channel: 'Pagina web',
    hasBreakfast: false, reference: '', ...overrides
  };
}

const FALSE_PROMISES = /c[oó]digos de acceso|access codes|sin llaves|no keys|no physical keys|smart access/i;

/* ── Clasificación del correo ── */

test('classifyEmail: relay de OTA, marcadores, propio, inválido y varios correos', () => {
  assert.deepEqual(classifyEmail('jdoe.123456@guest.booking.com'), { kind: 'relay', address: 'jdoe.123456@guest.booking.com', relayChannel: 'booking' });
  assert.equal(classifyEmail('abc@m.expediapartnercentral.com').relayChannel, 'expedia');
  assert.equal(classifyEmail('x1@guest.airbnb.com').relayChannel, 'airbnb');
  assert.equal(classifyEmail('x1@agoda-messaging.com').relayChannel, 'agoda');
  assert.equal(classifyEmail('noreply@gmail.com').kind, 'placeholder');
  assert.equal(classifyEmail('huesped@example.com').kind, 'placeholder');
  assert.equal(classifyEmail('reservas@estar.com.co').kind, 'own');
  assert.equal(classifyEmail('').kind, 'invalid');
  assert.equal(classifyEmail('sin correo').kind, 'invalid');
  /* varios correos en el campo → el primero válido, en minúsculas */
  const multi = classifyEmail(' Ana@Gmail.com , otro@x.co ');
  assert.equal(multi.kind, 'personal');
  assert.equal(multi.address, 'ana@gmail.com');
});

test('channelFamily: "Booking engine" de OTASync es venta DIRECTA, no Booking.com', () => {
  assert.equal(channelFamily('Booking.com'), 'booking');
  assert.equal(channelFamily('Booking engine'), 'direct');
  assert.equal(channelFamily('Pagina web', null, 'Pagina web'), 'direct');
  assert.equal(channelFamily('Estar Web', null, 'Estar Web'), 'direct');
  assert.equal(channelFamily('Private reservation'), 'direct');
  assert.equal(channelFamily('Expedia'), 'expedia');
  assert.equal(channelFamily('Hotels.com'), 'expedia');
  assert.equal(channelFamily('Airbnb'), 'airbnb');
  assert.equal(channelFamily('Despegar'), 'ota');
  assert.equal(channelFamily(''), 'unknown');
  assert.equal(channelFamily('Canal raro'), 'unknown');
  /* el dominio relay manda sobre el nombre del canal */
  assert.equal(channelFamily('Pagina web', 'booking'), 'booking');
});

test('contactPolicy: relay de Booking/Expedia SÍ, relay de Airbnb NO, marcadores y propio NO', () => {
  assert.deepEqual(
    { send: contactPolicy(resv({ email: 'a.1@guest.booking.com', channel: 'Booking.com' })).send, family: contactPolicy(resv({ email: 'a.1@guest.booking.com', channel: 'Booking.com' })).family },
    { send: true, family: 'booking' }
  );
  assert.equal(contactPolicy(resv({ email: 'a@m.expediapartnercentral.com', channel: 'Expedia' })).send, true);
  const airbnb = contactPolicy(resv({ email: 'a@guest.airbnb.com', channel: 'Airbnb' }));
  assert.equal(airbnb.send, false);
  assert.equal(airbnb.reason, 'relay_in_app_only');
  /* Airbnb con un correo real (recepción lo actualizó) → sí, es operativo */
  assert.equal(contactPolicy(resv({ email: 'real@gmail.com', channel: 'Airbnb' })).send, true);
  assert.equal(contactPolicy(resv({ email: 'reservas@estar.com.co' })).reason, 'own_address');
  assert.equal(contactPolicy(resv({ email: 'no-reply@hotmail.com' })).reason, 'placeholder');
  assert.equal(contactPolicy(resv({ email: 'nada' })).reason, 'no_email');
  assert.equal(contactPolicy(resv({}), { webChannelName: 'Pagina web' }).isDirect, true);
});

test('stayLang: español para Colombia/hispanohablantes o sin país; inglés para el resto', () => {
  assert.equal(stayLang({ country: 'CO' }), 'es');
  assert.equal(stayLang({ country: 'mx' }), 'es');
  assert.equal(stayLang({ country: 'España' }), 'es');
  assert.equal(stayLang({ country: '' }), 'es');
  assert.equal(stayLang({ country: 'US' }), 'en');
  assert.equal(stayLang({ country: 'Germany' }), 'en');
});

/* ── Fechas y elegibilidad ── */

test('targetDates usa el día de Colombia (UTC-5): a las 02:00 UTC aún es el día anterior', () => {
  const { preDate, postDate } = targetDates(new Date('2026-10-09T02:00:00Z'), 2, 1);
  assert.equal(preDate, '2026-10-10'); /* hoy en Bogotá = 8-oct → +2 */
  assert.equal(postDate, '2026-10-07'); /* 8-oct − 1 */
  const noon = targetDates(new Date('2026-10-08T12:00:00Z'), 2, 1);
  assert.deepEqual(noon, { preDate: '2026-10-10', postDate: '2026-10-07' });
});

test('elegibilidad: excluye tentativas, pendientes, holds BLOQUEO y COT- tentativas', () => {
  assert.equal(eligiblePreArrival(resv(), '2026-10-10'), true);
  assert.equal(eligiblePreArrival(resv({ status: 'tentative' }), '2026-10-10'), false);
  assert.equal(eligiblePreArrival(resv({ status: 'pending' }), '2026-10-10'), false);
  assert.equal(eligiblePreArrival(resv({ status: 'canceled' }), '2026-10-10'), false);
  assert.equal(eligiblePreArrival(resv({ firstName: 'BLOQUEO', lastName: 'Empresa' }), '2026-10-10'), false);
  /* una cotización PAGADA (confirmed, COT-) sí es un huésped real */
  assert.equal(eligiblePreArrival(resv({ reference: 'COT-123' }), '2026-10-10'), true);
  assert.equal(eligiblePostStay(resv(), '2026-10-12'), true);
  assert.equal(eligiblePostStay(resv({ status: 'no_show' }), '2026-10-12'), false);
});

test('normalizeReservation expone el canal de OTASync (channel_name)', () => {
  const r = normalizeReservation({ id_reservations: '9', channel_name: ' Booking.com ', email: 'x@guest.booking.com' });
  assert.equal(r.channel, 'Booking.com');
  assert.equal(normalizeReservation({}).channel, '');
});

test('mergeReservations une sin repetir id; shiftDate resta días en UTC', () => {
  const merged = mergeReservations([{ idReservations: '1' }, { idReservations: '2' }], [{ idReservations: '2' }, { idReservations: '3' }], null);
  assert.deepEqual(merged.map(r => r.idReservations), ['1', '2', '3']);
  assert.equal(shiftDate('2026-10-07', -62), '2026-08-06');
});

test('safeHttpsUrl solo deja pasar https sin comillas ni espacios', () => {
  assert.equal(safeHttpsUrl('https://g.page/r/x/review'), 'https://g.page/r/x/review');
  assert.equal(safeHttpsUrl('http://inseguro.com'), '');
  assert.equal(safeHttpsUrl('javascript:alert(1)'), '');
  assert.equal(safeHttpsUrl('https://x.com/"><script>'), '');
});

/* ── Lotes: agrupación, dedupe, fallas ── */

test('processBatch: varias reservas del mismo correo → UN correo con todos los códigos; marca cada una', async () => {
  const store = memStore();
  const sent = [];
  const rows = [
    resv({ idReservations: '7001', email: 'grupo@empresa.co' }),
    resv({ idReservations: '7002', email: 'GRUPO@empresa.co' }),
    resv({ idReservations: '7003', email: 'otro@gmail.com' })
  ];
  const res = await processBatch(store, rows, 'pre', eligiblePreArrival, '2026-10-10', {
    sendEmail: async (m) => { sent.push(m); return { sent: true, id: 'x' }; }
  });
  assert.equal(res.checked, 3);
  assert.equal(res.sent, 2);
  assert.equal(sent.length, 2);
  const group = sent.find(m => m.to === 'grupo@empresa.co');
  assert.ok(group.html.includes('7001') && group.html.includes('7002'));
  assert.ok(store.data.has('7001:pre') && store.data.has('7002:pre') && store.data.has('7003:pre'));

  /* segunda corrida: nada se reenvía */
  const again = await processBatch(store, rows, 'pre', eligiblePreArrival, '2026-10-10', {
    sendEmail: async () => { throw new Error('no debería enviar'); }
  });
  assert.equal(again.sent, 0);
  assert.equal(again.already, 3);
});

test('processBatch: si Resend NO confirma el envío no se marca (queda para reintento) y cuenta como falla', async () => {
  const store = memStore();
  const res = await processBatch(store, [resv()], 'pre', eligiblePreArrival, '2026-10-10', {
    sendEmail: async () => ({ sent: false })
  });
  assert.equal(res.failed, 1);
  assert.equal(res.sent, 0);
  assert.equal(store.data.size, 0);
  const thrown = await processBatch(store, [resv()], 'pre', eligiblePreArrival, '2026-10-10', {
    sendEmail: async () => { throw new Error('boom'); }
  });
  assert.equal(thrown.failed, 1);
  assert.equal(store.data.size, 0);
});

test('processBatch: relay de Airbnb y correos marcador se saltan con su razón', async () => {
  const sent = [];
  const res = await processBatch(memStore(), [
    resv({ idReservations: '1', email: 'h@guest.airbnb.com', channel: 'Airbnb' }),
    resv({ idReservations: '2', email: 'noreply@booking.com' }),
    resv({ idReservations: '3', email: 'reservas@estar.com.co' }),
    resv({ idReservations: '4', email: 'p.4@guest.booking.com', channel: 'Booking.com', country: 'US' })
  ], 'pre', eligiblePreArrival, '2026-10-10', { sendEmail: async (m) => { sent.push(m); return { sent: true }; } });
  assert.equal(res.sent, 1);
  assert.equal(res.skipped, 3);
  assert.deepEqual(res.reasons, { relay_in_app_only: 1, placeholder: 1, own_address: 1 });
  assert.equal(sent[0].to, 'p.4@guest.booking.com');
  assert.match(sent[0].subject, /online check-in/); /* huésped de EE. UU. → inglés */
});

test('post-estadía: huésped de Booking.com ve el botón de Booking y NUNCA el descuento', async () => {
  const sent = [];
  await processBatch(memStore(), [resv({ email: 'b.1@guest.booking.com', channel: 'Booking.com' })], 'post', eligiblePostStay, '2026-10-12', {
    reviews: { googleUrl: DEFAULT_GOOGLE_REVIEW_URL, bookingUrl: DEFAULT_BOOKING_REVIEW_URL },
    discountEnabled: true,
    sendEmail: async (m) => { sent.push(m); return { sent: true }; }
  });
  const html = sent[0].html;
  assert.ok(html.includes(DEFAULT_GOOGLE_REVIEW_URL));
  assert.ok(html.includes('booking.com/hotel/co/estar-apartaestudios'));
  assert.doesNotMatch(html, /c[oó]digo de descuento|discount code/i);
});

test('post-estadía: huésped DIRECTO recibe el descuento solo con el interruptor encendido; sin Booking', async () => {
  const run = async (discountEnabled, channel) => {
    const sent = [];
    await processBatch(memStore(), [resv({ channel })], 'post', eligiblePostStay, '2026-10-12', {
      reviews: { googleUrl: DEFAULT_GOOGLE_REVIEW_URL, bookingUrl: DEFAULT_BOOKING_REVIEW_URL },
      discountEnabled, webChannelName: 'Pagina web',
      sendEmail: async (m) => { sent.push(m); return { sent: true }; }
    });
    return sent[0].html;
  };
  const on = await run(true, 'Pagina web');
  assert.match(on, /código de descuento/);
  assert.match(on, /sea cual sea tu opinión/);
  assert.ok(on.includes('api.whatsapp.com/send/?phone=573102490414&amp;text='));
  assert.ok(!on.includes('booking.com/hotel'), 'un huésped directo no puede reseñar en Booking');
  assert.doesNotMatch(await run(false, 'Pagina web'), /código de descuento/);
  /* canal desconocido → no se asume directo → sin descuento */
  assert.doesNotMatch(await run(true, ''), /código de descuento/);
});

/* ── Corrida completa con OTASync falso ── */

function fakeOtasync(byFilter) {
  const calls = [];
  const fn = async (q) => {
    calls.push(q);
    const v = byFilter(q);
    if (v instanceof Error) throw v;
    return { reservations: v || [], isMock: false };
  };
  fn.calls = calls;
  return fn;
}

const SETTINGS = {
  preDays: 2, postDays: 1, npsUrl: null,
  reviews: { googleUrl: DEFAULT_GOOGLE_REVIEW_URL, bookingUrl: DEFAULT_BOOKING_REVIEW_URL },
  discountEnabled: false, webChannelName: 'Pagina web'
};
const NOW = new Date('2026-10-08T12:00:00Z'); /* pre = 10-oct, post = 07-oct */

test('runStayEmails: pre 2 días antes y post 1 día después, todos los canales, un correo por huésped', async () => {
  const sent = [];
  const otasync = fakeOtasync(q => {
    if (q.filterBy === 'date_arrival' && q.dto === '2026-10-10') {
      return [
        resv({ idReservations: '1', email: 'ana@gmail.com', channel: 'Pagina web' }),
        resv({ idReservations: '2', email: 'b.2@guest.booking.com', channel: 'Booking.com', country: 'DE' }),
        resv({ idReservations: '3', email: 'e@m.expediapartnercentral.com', channel: 'Expedia', country: 'US' }),
        resv({ idReservations: '4', email: 'a@guest.airbnb.com', channel: 'Airbnb' }),
        resv({ idReservations: '5', status: 'canceled' })
      ];
    }
    if (q.filterBy === 'date_departure') return [resv({ idReservations: '9', dateArrival: '2026-10-05', dateDeparture: '2026-10-07' })];
    return [];
  });
  const r = await runStayEmails(SETTINGS, {
    now: NOW, fetchReservations: otasync, store: memStore(), reportAlert: async () => {},
    sendEmail: async (m) => { sent.push(m); return { sent: true }; }
  });
  assert.equal(r.preDate, '2026-10-10');
  assert.equal(r.postDate, '2026-10-07');
  /* ventanas: llegadas hoy..+2, salidas -3..-1 */
  assert.deepEqual(r.preWindow, { from: '2026-10-08', to: '2026-10-10' });
  assert.deepEqual(r.postWindow, { from: '2026-10-05', to: '2026-10-07' });
  const preCall = otasync.calls.find(c => c.filterBy === 'date_arrival' && c.dto === '2026-10-10');
  assert.equal(preCall.dfrom, '2026-10-08');
  assert.equal(r.preSent, 3);
  assert.equal(r.preSkipped, 1); /* Airbnb relay */
  assert.equal(r.postSent, 1);
  /* respaldo del post-estadía: también lee las llegadas de la ventana */
  const windowCall = otasync.calls.find(c => c.filterBy === 'date_arrival' && c.dto === '2026-10-07');
  assert.ok(windowCall);
  assert.equal(windowCall.dfrom, shiftDate('2026-10-05', -POST_LOOKBACK_DAYS));
  for (const m of sent) assert.doesNotMatch(m.html, FALSE_PROMISES);
});

test('runStayEmails: si date_departure no filtra, el respaldo por llegadas encuentra la salida (filtrada en cliente)', async () => {
  const sent = [];
  const otasync = fakeOtasync(q => {
    if (q.filterBy === 'date_departure') return [resv({ idReservations: '20', dateDeparture: '2026-11-30' })]; /* basura */
    if (q.filterBy === 'date_arrival' && q.dto === '2026-10-07') {
      return [
        resv({ idReservations: '21', dateArrival: '2026-09-30', dateDeparture: '2026-10-07' }),
        resv({ idReservations: '22', dateArrival: '2026-10-06', dateDeparture: '2026-10-09' })
      ];
    }
    return [];
  });
  const r = await runStayEmails(SETTINGS, {
    now: NOW, fetchReservations: otasync, store: memStore(), reportAlert: async () => {},
    sendEmail: async (m) => { sent.push(m); return { sent: true }; }
  });
  assert.equal(r.postSent, 1);
  assert.equal(r.postChecked, 1);
});

test('runStayEmails: una lectura del post-estadía falla → sigue con la otra; ambas fallan → alerta', async () => {
  const alerts = [];
  const partial = fakeOtasync(q => (q.filterBy === 'date_departure' ? new Error('timeout') : (q.dto === '2026-10-07' ? [resv({ dateDeparture: '2026-10-07' })] : [])));
  const ok = await runStayEmails(SETTINGS, {
    now: NOW, fetchReservations: partial, store: memStore(), reportAlert: async (a) => { alerts.push(a); },
    sendEmail: async () => ({ sent: true })
  });
  assert.equal(ok.postSent, 1);
  assert.equal(alerts.length, 0);

  const down = fakeOtasync(() => new Error('OTASync caído'));
  await runStayEmails(SETTINGS, {
    now: NOW, fetchReservations: down, store: memStore(), reportAlert: async (a) => { alerts.push(a); },
    sendEmail: async () => ({ sent: true })
  });
  assert.deepEqual(alerts.map(a => a.dedupeKey).sort(), ['stay-emails-post', 'stay-emails-pre']);
});

test('runStayEmails: correos que Resend rechaza → alerta "email_failed" con los códigos y si se reintentan', async () => {
  const alerts = [];
  const otasync = fakeOtasync(q => (q.filterBy === 'date_arrival' && q.dto === '2026-10-10' ? [resv()] : []));
  const r = await runStayEmails(SETTINGS, {
    now: NOW, fetchReservations: otasync, store: memStore(), reportAlert: async (a) => { alerts.push(a); },
    sendEmail: async () => ({ sent: false })
  });
  assert.equal(r.preFailed, 1);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, 'email_failed');
  assert.equal(alerts[0].dedupeKey, 'stay-emails-send-failed-2026-10-08');
  assert.match(alerts[0].message, /Se reintentan solos mañana: 5001 \(pre-llegada\)/);
  assert.doesNotMatch(alerts[0].message, /ENVIAR A MANO/);
});

/* Simula el cron diario: misma OTASync, mismo store, días consecutivos. */
async function dailyRuns(days, rows, sendFor) {
  const store = memStore();
  const sentLog = [];
  const alerts = [];
  const otasync = fakeOtasync(q => rows.filter(x => {
    const d = q.filterBy === 'date_departure' ? x.dateDeparture : x.dateArrival;
    return d >= q.dfrom && d <= q.dto;
  }));
  const results = [];
  for (const day of days) {
    results.push(await runStayEmails(SETTINGS, {
      now: new Date(`${day}T12:00:00Z`), fetchReservations: otasync, store,
      reportAlert: async (a) => { alerts.push({ day, ...a }); },
      sendEmail: async (m) => {
        const ok = sendFor(day, m);
        if (ok) sentLog.push({ day, to: m.to, subject: m.subject });
        return { sent: ok };
      }
    }));
  }
  return { store, sentLog, alerts, results };
}

test('reintento real: Resend falla el día D → el pre-llegada sale el día D+1 (una sola vez)', async () => {
  const rows = [resv({ idReservations: '123', dateArrival: '2026-10-10', dateDeparture: '2026-10-12' })];
  const { sentLog, alerts } = await dailyRuns(
    ['2026-10-08', '2026-10-09', '2026-10-10'], rows,
    (day, m) => !(day === '2026-10-08' && /llegada|stay at/i.test(m.subject))
  );
  const pre = sentLog.filter(x => /llegada/.test(x.subject));
  assert.deepEqual(pre.map(x => x.day), ['2026-10-09']);
  assert.equal(alerts.filter(a => a.kind === 'email_failed').length, 1);
});

test('reintento real del post-estadía: falla 2 días seguidos y sale al tercero; si falla el último día → "ENVIAR A MANO"', async () => {
  const rows = [resv({ idReservations: '777', dateArrival: '2026-10-03', dateDeparture: '2026-10-07' })];
  const ok = await dailyRuns(['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'], rows,
    (day) => day === '2026-10-10');
  assert.deepEqual(ok.sentLog.filter(x => /Gracias/.test(x.subject)).map(x => x.day), ['2026-10-10']);

  const lost = await dailyRuns(['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'], rows, () => false);
  const fails = lost.alerts.filter(a => a.kind === 'email_failed');
  assert.equal(fails.length, 3, 'tres días de ventana → tres intentos');
  assert.match(fails[0].message, /Se reintentan solos mañana: 777/);
  assert.match(fails[2].message, /ENVIAR A MANO \(ya no se reintentan\): 777 \(post-estadía\)/);
  assert.equal(fails[2].severity, 'error');
  assert.equal(lost.results[3].postChecked, 0, 'fuera de ventana ya no se evalúa');
});

test('reserva de última hora (llega mañana) recibe el pre-llegada en la corrida siguiente', async () => {
  /* reservada el 8 después del cron, llega el 9 */
  const rows = [resv({ idReservations: '900', dateArrival: '2026-10-09', dateDeparture: '2026-10-10', channel: 'Booking.com', email: 'z.9@guest.booking.com' })];
  const { sentLog } = await dailyRuns(['2026-10-09'], rows, () => true);
  assert.equal(sentLog.filter(x => /llegada/.test(x.subject)).length, 1);
  /* y quien llega HOY aún lo recibe en la corrida de las 7 a. m. (check-in 3 p. m.) */
  const today = await dailyRuns(['2026-10-09'], [resv({ idReservations: '901', dateArrival: '2026-10-09' })], () => true);
  assert.equal(today.sentLog.length, 1);
  /* reserva con tiempo: sale exactamente 2 días antes y no se repite */
  const normal = await dailyRuns(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'],
    [resv({ idReservations: '902', dateArrival: '2026-10-10', dateDeparture: '2026-10-11' })], () => true);
  assert.deepEqual(normal.sentLog.filter(x => /llegada/.test(x.subject)).map(x => x.day), ['2026-10-08']);
  assert.deepEqual(normal.sentLog.filter(x => /Gracias/.test(x.subject)).map(x => x.day), []);
});

test('sin store de dedupe la ventana se reduce a la fecha exacta (nunca repite a diario)', async () => {
  const otasync = fakeOtasync(() => [resv({ dateArrival: '2026-10-09' })]);
  const r = await runStayEmails(SETTINGS, {
    now: NOW, fetchReservations: otasync, store: null, reportAlert: async () => {},
    sendEmail: async () => ({ sent: true })
  });
  assert.deepEqual(r.preWindow, { from: '2026-10-10', to: '2026-10-10' });
  assert.equal(r.preSent, 0);
});

test('si leer el dedupe falla, la reserva se salta (no duplicar) y cuenta como fallida', async () => {
  const broken = { async get() { throw new Error('blobs 503'); }, async set() {} };
  const sent = [];
  const res = await processBatch(broken, [resv()], 'pre', eligiblePreArrival, { from: '2026-10-08', to: '2026-10-10' }, {
    sendEmail: async (m) => { sent.push(m); return { sent: true }; }
  });
  assert.equal(sent.length, 0);
  assert.equal(res.failed, 1);
  assert.equal(res.failedItems[0].reason, 'dedupe_unavailable');
});

/* ── Plantillas ── */

test('preArrivalHtml: enlace al check-in con el código prellenado, recepción y sin promesas de códigos (ES/EN)', () => {
  const es = preArrivalHtml({ resv: resv({ idReservations: '45821', hasBreakfast: true }), lang: 'es' });
  assert.ok(es.includes('https://estar.com.co/guest.html?code=45821&amp;tab=checkin'));
  assert.match(es, /45821/);
  assert.match(es, /apellido del titular/);
  assert.match(es, /de 6:00 a 10:00 a\. m\. y de 4:00 a 10:00 p\. m\./);
  assert.match(es, /desayuno/i);
  assert.doesNotMatch(es, FALSE_PROMISES);
  const en = preArrivalHtml({ resv: resv({ idReservations: '45821' }), lang: 'en' });
  assert.ok(en.includes('https://estar.com.co/en/guest.html?code=45821&amp;tab=checkin'), 'el correo en inglés lleva a la app en inglés');
  assert.match(en, /last name/);
  assert.match(en, /6:00–10:00 am and 4:00–10:00 pm/);
  assert.doesNotMatch(en, FALSE_PROMISES);
  assert.equal(guestCheckinUrl('A B'), 'https://estar.com.co/guest.html?code=A%20B&tab=checkin');
  assert.equal(guestCheckinUrl('A B', 'en'), 'https://estar.com.co/en/guest.html?code=A%20B&tab=checkin');
});

test('preArrivalHtml con varias reservas lista un enlace de check-in por código', () => {
  const html = preArrivalHtml({ resv: resv({ bookingCodes: ['111', '222'] }), lang: 'es' });
  assert.ok(html.includes('guest.html?code=111&amp;tab=checkin'));
  assert.ok(html.includes('guest.html?code=222&amp;tab=checkin'));
  assert.match(html, /tus 2 reservas/);
});

test('postStayHtml: Google + Booking, descuento solo si se pide, NPS intacto, sin promesas falsas', () => {
  const reviews = { googleUrl: DEFAULT_GOOGLE_REVIEW_URL, bookingUrl: DEFAULT_BOOKING_REVIEW_URL };
  const es = postStayHtml({ resv: resv(), lang: 'es', reviews, discountOffer: true, npsUrl: 'https://nps.example/s' });
  assert.match(es, /Reseña en Google/);
  assert.match(es, /Reseña en Booking\.com/);
  assert.match(es, /código de descuento/);
  assert.match(es, /Cuéntanos cómo estuvo tu estadía/);
  assert.doesNotMatch(es, FALSE_PROMISES);
  const en = postStayHtml({ resv: resv(), lang: 'en', reviews: { googleUrl: DEFAULT_GOOGLE_REVIEW_URL } });
  assert.match(en, /Review on Google/);
  assert.doesNotMatch(en, /Booking\.com/);
  assert.doesNotMatch(en, /discount code/);
});

test('staySubject ES/EN', () => {
  assert.equal(staySubject('pre', 'es', { dateArrival: '2026-10-10' }), 'Tu llegada a estar — 10 de octubre de 2026 · check-in en línea');
  assert.equal(staySubject('pre', 'en', { dateArrival: '2026-10-10' }), 'Your stay at estar — October 10, 2026 · online check-in');
  assert.equal(staySubject('post', 'es'), 'Gracias por tu estadía — estar');
  assert.equal(staySubject('post', 'en'), 'Thank you for staying with us — estar');
});

/* ── Sitio: sin promesas falsas de códigos de puerta + "Mi estadía" descubrible ── */

const ROOT = path.resolve(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('las páginas públicas ya no prometen códigos de acceso automáticos (ES/EN)', () => {
  for (const f of ['faq.html', 'en/faq.html', 'guest.html', 'grupos.html', 'en/grupos.html', 'i18n/guest.es.json', 'i18n/guest.en.json']) {
    assert.doesNotMatch(read(f), FALSE_PROMISES, `${f} todavía promete códigos de acceso`);
  }
  assert.doesNotMatch(read('guest.html'), /te mostraremos las instrucciones de llegada y acceso/);
});

test('el JSON-LD del FAQ sigue siendo válido y refleja el texto nuevo', () => {
  for (const f of ['faq.html', 'en/faq.html']) {
    const html = read(f);
    const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    const ld = JSON.parse(m[1]);
    const names = ld.mainEntity.map(q => q.name);
    assert.ok(names.includes(f.startsWith('en/') ? 'How do I get into my studio?' : '¿Cómo ingreso a mi apartaestudio?'));
  }
});

test('"Mi estadía" está en el menú y el pie de todas las páginas públicas, y en el encabezado de ambos home', () => {
  const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html')).concat(
    fs.readdirSync(path.join(ROOT, 'en')).filter(f => f.endsWith('.html')).map(f => `en/${f}`)
  );
  let checked = 0;
  for (const f of pages) {
    const html = read(f);
    if (!html.includes('data-i18n="footer_grupos"')) continue; /* páginas sin el pie público */
    checked++;
    /* En /en/ el enlace es relativo (guest.html → /en/guest.html, la app en inglés). */
    const guestHref = 'guest.html';
    assert.ok(html.includes(`<li class="nav-guest-item"><a href="${guestHref}" data-i18n="nav_mi_estadia">`), `${f}: falta en el menú`);
    assert.ok(html.includes(`<a href="${guestHref}" data-i18n="footer_mi_estadia">`), `${f}: falta en el pie`);
  }
  assert.ok(checked >= 30, `solo se revisaron ${checked} páginas`);
  assert.match(read('index.html'), /href="guest\.html" class="guest-entry-link" data-i18n="nav_mi_estadia"/);
  assert.match(read('en/index.html'), /href="guest\.html" class="guest-entry-link" data-i18n="nav_mi_estadia">My stay</);
  const es = JSON.parse(read('i18n/shell.es.json'));
  const en = JSON.parse(read('i18n/shell.en.json'));
  assert.equal(es.nav_mi_estadia, 'Mi estadía');
  assert.equal(en.nav_mi_estadia, 'My stay');
  assert.ok(es.footer_mi_estadia && en.footer_mi_estadia);
});

/* ── Enlaces de reseña y canal por reference ── */

test('enlace de reseña inválido o sin https en el panel → nunca deja el correo sin Google', async () => {
  const { normalizeReviewUrl, firstReviewUrl } = stay._test;
  assert.equal(normalizeReviewUrl('g.page/r/CW6uBmyymSHlEBM/review'), 'https://g.page/r/CW6uBmyymSHlEBM/review');
  assert.equal(normalizeReviewUrl('www.google.com/maps/place/estar'), 'https://www.google.com/maps/place/estar');
  assert.equal(normalizeReviewUrl('http://g.page/x'), 'https://g.page/x');
  assert.equal(normalizeReviewUrl('javascript:alert(1)'), '');
  assert.equal(normalizeReviewUrl('dejar reseña'), '');
  assert.equal(firstReviewUrl('dejar reseña', '', DEFAULT_GOOGLE_REVIEW_URL), DEFAULT_GOOGLE_REVIEW_URL);

  const prevG = process.env.GOOGLE_REVIEW_URL;
  const prevL = process.env.REVIEW_LINK_URL;
  delete process.env.REVIEW_LINK_URL;
  try {
    process.env.GOOGLE_REVIEW_URL = 'texto que no es enlace';
    let s = await stay._test.resolveSettings();
    assert.equal(s.reviews.googleUrl, DEFAULT_GOOGLE_REVIEW_URL);
    process.env.GOOGLE_REVIEW_URL = 'g.page/r/OTRO/review';
    s = await stay._test.resolveSettings();
    assert.equal(s.reviews.googleUrl, 'https://g.page/r/OTRO/review');
    process.env.BOOKING_REVIEW_URL = 'nada';
    s = await stay._test.resolveSettings();
    assert.equal(s.reviews.bookingUrl, DEFAULT_BOOKING_REVIEW_URL);
  } finally {
    if (prevG === undefined) delete process.env.GOOGLE_REVIEW_URL; else process.env.GOOGLE_REVIEW_URL = prevG;
    if (prevL !== undefined) process.env.REVIEW_LINK_URL = prevL;
    delete process.env.BOOKING_REVIEW_URL;
  }
  /* y el correo resultante sí trae el botón de Google */
  const html = postStayHtml({ resv: resv(), lang: 'es', reviews: { googleUrl: firstReviewUrl('mal', DEFAULT_GOOGLE_REVIEW_URL), bookingUrl: '' } });
  assert.ok(html.includes(DEFAULT_GOOGLE_REVIEW_URL));
});

test('sin channel_name, la reference propia (EST-…/COT-…) identifica una reserva directa', () => {
  assert.equal(channelFamily('', null, 'Pagina web', 'EST-AB12C'), 'direct');
  assert.equal(channelFamily('', null, 'Pagina web', 'COT-2026-0012'), 'direct');
  assert.equal(channelFamily('', null, 'Pagina web', 'Hotel Estar Custom Booking Engine'), 'direct');
  assert.equal(channelFamily('', null, 'Pagina web', '4429181723'), 'unknown');
  assert.equal(channelFamily('', null, 'Pagina web', ''), 'unknown');
  /* un relay de OTA manda sobre la reference */
  assert.equal(channelFamily('', 'booking', 'Pagina web', 'EST-AB12C'), 'booking');
  assert.equal(contactPolicy(resv({ channel: '', reference: 'EST-ZZ9Q1' })).isDirect, true);
});
