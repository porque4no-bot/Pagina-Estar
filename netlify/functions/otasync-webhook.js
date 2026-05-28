const { getQuoteStore, listAllQuotes, saveQuote, effectiveStatus } = require('./_quotes-store');
const { getAvailabilityByType, findUnavailable, hasOtasyncCreds } = require('./_otasync');

/* Receives OTASync webhooks. We act on availability-change events
   (data_type="avail", action="edit", data={ id_room_types: { date: value } })
   by re-validating active quotes that touch the affected room types/dates and
   flagging the ones that lost availability. Optionally also re-validates on
   reservation events, which can change availability too. */

function overlaps(checkin, checkout, dates) {
  if (!checkin || !checkout) return false;
  const start = new Date(checkin), end = new Date(checkout);
  return dates.some(ds => {
    const d = new Date(ds);
    return d >= start && d < end;
  });
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  // Optional shared-secret check (configure webhook URL with ?secret=...)
  const expected = process.env.OTASYNC_WEBHOOK_SECRET;
  if (expected) {
    const got = (event.queryStringParameters || {}).secret;
    if (got !== expected) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  if (!hasOtasyncCreds()) return { statusCode: 200, headers, body: JSON.stringify({ message: 'no credentials; ignored' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const events = Array.isArray(body) ? body : [body];
  const affectedTypes = new Set();
  const affectedDates = new Set();
  let reservationEvent = false;

  for (const ev of events) {
    if (ev.data_type === 'avail' && ev.data && typeof ev.data === 'object') {
      Object.keys(ev.data).forEach(typeId => {
        affectedTypes.add(String(typeId));
        const byDate = ev.data[typeId];
        if (byDate && typeof byDate === 'object') Object.keys(byDate).forEach(d => affectedDates.add(d));
      });
    } else if (ev.data_type === 'reservation') {
      reservationEvent = true;
    }
  }

  if (affectedTypes.size === 0 && !reservationEvent) {
    return { statusCode: 200, headers, body: JSON.stringify({ message: 'no actionable event' }) };
  }

  let store, quotes;
  try {
    store = getQuoteStore();
    quotes = await listAllQuotes(store);
  } catch (e) {
    console.error('[otasync-webhook] store unavailable:', e.message);
    return { statusCode: 200, headers, body: JSON.stringify({ message: 'store unavailable' }) };
  }

  const datesArr = Array.from(affectedDates);
  const candidates = quotes.filter(q => {
    const st = effectiveStatus(q);
    if (st !== 'activa' && st !== 'vista') return false;
    if (!q.checkin || !q.checkout || !Array.isArray(q.items) || !q.items.length) return false;
    if (Array.isArray(q.holdReservationIds) && q.holdReservationIds.length) return false; // held = guaranteed
    // For avail events, narrow to quotes touching the affected types & dates
    if (affectedTypes.size > 0 && !reservationEvent) {
      const touchesType = q.items.some(it => affectedTypes.has(String(it.roomTypeId)));
      if (!touchesType) return false;
      if (datesArr.length && !overlaps(q.checkin, q.checkout, datesArr)) return false;
    }
    return true;
  });

  const cache = new Map();
  let updated = 0, lost = 0;
  for (const q of candidates) {
    const key = q.checkin + '|' + q.checkout;
    try {
      let avail = cache.get(key);
      if (!avail) { avail = await getAvailabilityByType(q.checkin, q.checkout); cache.set(key, avail); }
      if (avail.isMock) continue;
      const shortfalls = findUnavailable(q.items, avail.availByType);
      const nowOk = shortfalls.length === 0;
      const prevOk = q.availabilityOk !== false;
      if (nowOk !== prevOk || (!nowOk && JSON.stringify(q.unavailable) !== JSON.stringify(shortfalls))) {
        q.availabilityOk = nowOk;
        q.availabilityCheckedAt = new Date().toISOString();
        if (nowOk) delete q.unavailable; else q.unavailable = shortfalls;
        await saveQuote(store, q);
        updated++;
        if (!nowOk) lost++;
      }
    } catch (e) {
      console.error(`[otasync-webhook] re-check failed for ${q.quoteId}:`, e.message);
    }
  }

  console.log(`[otasync-webhook] candidates ${candidates.length}, updated ${updated}, lost ${lost}`);
  return { statusCode: 200, headers, body: JSON.stringify({ received: true, updated, lost }) };
};
