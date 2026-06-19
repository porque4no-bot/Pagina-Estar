'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const stay = require('../../netlify/functions/send-stay-emails');
const { ymd, targetDates, eligiblePreArrival, eligiblePostStay, PRE_ARRIVAL_DAYS, POST_DEPARTURE_LAG_DAYS } = stay._test;
const { inferLang, reservaTieneDesayuno, normalizeReservation, getReservationsByDate } = require('../../netlify/functions/_otasync');
const { preArrivalHtml, postStayHtml } = require('../../netlify/functions/_email');

test('targetDates: pre = now + PRE_DAYS, post = now - POST_LAG (UTC YYYY-MM-DD)', () => {
  const now = new Date('2026-06-19T12:00:00Z');
  const { preDate, postDate } = targetDates(now);
  const expPre = new Date(now); expPre.setUTCDate(expPre.getUTCDate() + PRE_ARRIVAL_DAYS);
  const expPost = new Date(now); expPost.setUTCDate(expPost.getUTCDate() - POST_DEPARTURE_LAG_DAYS);
  assert.equal(preDate, ymd(expPre));
  assert.equal(postDate, ymd(expPost));
});

test('eligiblePreArrival: matches arrival date + email, rejects otherwise', () => {
  const base = { email: 'a@b.co', dateArrival: '2026-06-21', status: 'confirmed' };
  assert.equal(eligiblePreArrival(base, '2026-06-21'), true);
  assert.equal(eligiblePreArrival({ ...base, email: '' }, '2026-06-21'), false);
  assert.equal(eligiblePreArrival({ ...base, dateArrival: '2026-06-22' }, '2026-06-21'), false);
  assert.equal(eligiblePreArrival({ ...base, status: 'cancelled' }, '2026-06-21'), false);
});

test('eligiblePostStay: matches departure date + email, rejects otherwise', () => {
  const base = { email: 'a@b.co', dateDeparture: '2026-06-18', status: 'confirmed' };
  assert.equal(eligiblePostStay(base, '2026-06-18'), true);
  assert.equal(eligiblePostStay({ ...base, email: '' }, '2026-06-18'), false);
  assert.equal(eligiblePostStay({ ...base, dateDeparture: '2026-06-17' }, '2026-06-18'), false);
  assert.equal(eligiblePostStay({ ...base, status: 'no_show' }, '2026-06-18'), false);
});

test('_otasync.inferLang: es for Colombia/empty, en otherwise', () => {
  assert.equal(inferLang(''), 'es');
  assert.equal(inferLang('CO'), 'es');
  assert.equal(inferLang(' colombia '), 'es');
  assert.equal(inferLang('US'), 'en');
  assert.equal(inferLang('España'), 'en');
});

test('_otasync.reservaTieneDesayuno: true if any night has breakfast (string or number)', () => {
  assert.equal(reservaTieneDesayuno({ rooms: [{ nights: [{ breakfast: '0' }, { breakfast: '1' }] }] }), true);
  assert.equal(reservaTieneDesayuno({ rooms: [{ nights: [{ breakfast_adults: 2 }] }] }), true);
  assert.equal(reservaTieneDesayuno({ rooms: [{ nights: [{ breakfast: '0' }] }] }), false);
  assert.equal(reservaTieneDesayuno({}), false);
  assert.equal(reservaTieneDesayuno({ rooms: [{}] }), false);
});

test('_otasync.normalizeReservation: maps doc fields, never throws on missing', () => {
  const r = normalizeReservation({
    id_reservations: '358766', status: 'confirmed', guest_status: 'waiting_arrival',
    date_arrival: '2026-07-01', date_departure: '2026-07-03',
    first_name: 'Ana', last_name: 'Ruiz', email: ' ana@x.co ', country: 'US', nights: '2',
    rooms: [{ name: 'Clásica', nights: [{ breakfast: '1' }] }]
  });
  assert.equal(r.idReservations, '358766');
  assert.equal(r.email, 'ana@x.co');
  assert.equal(r.roomName, 'Clásica');
  assert.equal(r.hasBreakfast, true);
  assert.equal(r.lang, 'en');
  assert.equal(r.nights, 2);
  // missing input must not throw
  const empty = normalizeReservation(undefined);
  assert.equal(empty.idReservations, '');
  assert.equal(empty.lang, 'es');
});

test('getReservationsByDate short-circuits to mock without OTASync creds (no network)', async () => {
  const saved = { t: process.env.OTASYNC_TOKEN, u: process.env.OTASYNC_USERNAME, p: process.env.OTASYNC_PASSWORD };
  delete process.env.OTASYNC_TOKEN; delete process.env.OTASYNC_USERNAME; delete process.env.OTASYNC_PASSWORD;
  try {
    const res = await getReservationsByDate({ filterBy: 'date_arrival', dfrom: '2026-07-01', dto: '2026-07-01' });
    assert.equal(res.isMock, true);
    assert.deepEqual(res.reservations, []);
  } finally {
    if (saved.t !== undefined) process.env.OTASYNC_TOKEN = saved.t;
    if (saved.u !== undefined) process.env.OTASYNC_USERNAME = saved.u;
    if (saved.p !== undefined) process.env.OTASYNC_PASSWORD = saved.p;
  }
});

test('preArrivalHtml renders ES/EN with stay dates, WhatsApp CTA, breakfast line', () => {
  const resv = { firstName: 'Ana', dateArrival: '2026-07-01', dateDeparture: '2026-07-03', hasBreakfast: true };
  const es = preArrivalHtml({ resv, lang: 'es' });
  assert.match(es, /Ana/);
  assert.match(es, /wa\.me|whatsapp/i);
  assert.match(es, /desayuno/i);
  const en = preArrivalHtml({ resv: { ...resv, hasBreakfast: false }, lang: 'en' });
  assert.match(en, /look forward|your stay/i);
  assert.ok(!/desayuno/i.test(en));
});

test('postStayHtml uses REVIEW_LINK_URL when set, WhatsApp fallback otherwise', () => {
  const resv = { firstName: 'Ana' };
  const prev = process.env.REVIEW_LINK_URL;
  delete process.env.REVIEW_LINK_URL;
  try {
    const noUrl = postStayHtml({ resv, lang: 'es' });
    assert.match(noUrl, /whatsapp/i);
    process.env.REVIEW_LINK_URL = 'https://g.page/estar/review';
    const withUrl = postStayHtml({ resv, lang: 'en' });
    assert.ok(withUrl.includes('https://g.page/estar/review'));
    assert.match(withUrl, /review/i);
  } finally {
    if (prev === undefined) delete process.env.REVIEW_LINK_URL; else process.env.REVIEW_LINK_URL = prev;
  }
});

test('handler is a no-op when STAY_EMAILS_ENABLED is not true', async () => {
  const prev = process.env.STAY_EMAILS_ENABLED;
  delete process.env.STAY_EMAILS_ENABLED;
  try {
    const r = await stay.handler();
    assert.equal(r.body, 'disabled');
  } finally {
    if (prev !== undefined) process.env.STAY_EMAILS_ENABLED = prev;
  }
});

test('handler skips when enabled but OTASync creds are missing', async () => {
  const prevEnabled = process.env.STAY_EMAILS_ENABLED;
  const saved = { t: process.env.OTASYNC_TOKEN, u: process.env.OTASYNC_USERNAME, p: process.env.OTASYNC_PASSWORD };
  process.env.STAY_EMAILS_ENABLED = 'true';
  delete process.env.OTASYNC_TOKEN; delete process.env.OTASYNC_USERNAME; delete process.env.OTASYNC_PASSWORD;
  try {
    const r = await stay.handler();
    assert.match(r.body, /skipped: no otasync creds/);
  } finally {
    if (prevEnabled === undefined) delete process.env.STAY_EMAILS_ENABLED; else process.env.STAY_EMAILS_ENABLED = prevEnabled;
    if (saved.t !== undefined) process.env.OTASYNC_TOKEN = saved.t;
    if (saved.u !== undefined) process.env.OTASYNC_USERNAME = saved.u;
    if (saved.p !== undefined) process.env.OTASYNC_PASSWORD = saved.p;
  }
});
