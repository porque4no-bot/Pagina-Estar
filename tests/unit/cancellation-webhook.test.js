/* Tema 2 — OTASync cancellation events. When a reservation is cancelled the
 * webhook emails the guest (ONLY for our own web reservations — OTA guests get
 * the channel's own email) and always alerts the team, idempotently. Email is
 * injected so these run with no network and no Blobs. */

const test = require('node:test');
const assert = require('node:assert/strict');

const { _test: hook } = require('../../netlify/functions/otasync-webhook');

const WEB_CHANNEL = process.env.OTASYNC_CHANNEL_ID || '66483';

function mailbox() {
  const sent = [];
  return { sent, sendEmail: async (m) => { sent.push(m); return { sent: true }; } };
}

function webCancelEvent(over = {}) {
  return {
    data_type: 'reservation', action: 'cancel',
    data: {
      id_reservations: over.id || 'R-1', reference: over.reference || 'EST-WEB01',
      guests: [{ first_name: 'Ana', last_name: 'Pérez', email: over.email || 'ana@example.com' }],
      id_channels: over.channelId || WEB_CHANNEL,
      date_arrival: '2026-07-01', date_departure: '2026-07-05'
    }
  };
}

test('isCancellationEvent detects cancel action and cancelled status, ignores inserts', () => {
  assert.equal(hook.isCancellationEvent({ data_type: 'reservation', action: 'cancel' }), true);
  assert.equal(hook.isCancellationEvent({ data_type: 'reservation', action: 'canceled' }), true);
  assert.equal(hook.isCancellationEvent({ data_type: 'reservation', data: { status: 'cancelled' } }), true);
  assert.equal(hook.isCancellationEvent({ data_type: 'reservation', action: 'insert' }), false);
  assert.equal(hook.isCancellationEvent({ data_type: 'avail', action: 'edit' }), false);
});

test('a web reservation cancellation emails the guest AND the team', async () => {
  const box = mailbox();
  const res = await hook.handleCancellations([webCancelEvent()], { sendEmail: box.sendEmail, store: false });
  assert.equal(res.handled, 1);
  assert.deepEqual(res.canceledIds, ['R-1']);
  assert.equal(box.sent.length, 2);
  const guest = box.sent.find(m => m.to === 'ana@example.com');
  assert.ok(guest, 'guest email sent');
  assert.match(guest.subject, /cancelada|cancelled/i);
  assert.match(guest.html, /EST-WEB01/);
});

test('an OTA cancellation alerts the team but does NOT email the guest', async () => {
  const box = mailbox();
  const ev = webCancelEvent({ channelId: '999', email: 'booking-guest@example.com' });
  const res = await hook.handleCancellations([ev], { sendEmail: box.sendEmail, store: false });
  assert.equal(res.handled, 1);
  // Only the team alert — nothing addressed to the guest.
  assert.equal(box.sent.some(m => m.to === 'booking-guest@example.com'), false);
  assert.ok(box.sent.length >= 1);
});

test('a tentative hold (BLOQUEO / COT- reference) is skipped entirely', async () => {
  const box = mailbox();
  const holdEvent = {
    data_type: 'reservation', action: 'cancel',
    data: { id_reservations: 'H-1', reference: 'COT-2026-AB12C', guests: [{ first_name: 'BLOQUEO', last_name: 'Acme' }], id_channels: WEB_CHANNEL }
  };
  const res = await hook.handleCancellations([holdEvent], { sendEmail: box.sendEmail, store: false });
  assert.equal(res.handled, 0);
  assert.equal(box.sent.length, 0);
});

test('the same reservation is only notified once (idempotent via store)', async () => {
  const box = mailbox();
  const mem = new Map();
  const store = { get: async (k) => mem.get(k) || null, set: async (k, v) => { mem.set(k, v); } };
  await hook.handleCancellations([webCancelEvent()], { sendEmail: box.sendEmail, store });
  await hook.handleCancellations([webCancelEvent()], { sendEmail: box.sendEmail, store });
  assert.equal(box.sent.length, 2); // guest + team, once — not four
});

test('no cancellation events → nothing sent', async () => {
  const box = mailbox();
  const res = await hook.handleCancellations(
    [{ data_type: 'reservation', action: 'insert', data: {} }, { data_type: 'avail', action: 'edit', data: {} }],
    { sendEmail: box.sendEmail, store: false }
  );
  assert.equal(res.handled, 0);
  assert.equal(box.sent.length, 0);
});
