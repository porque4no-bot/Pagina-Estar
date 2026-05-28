const { getQuoteStore, listAllQuotes, saveQuote, effectiveStatus } = require('./_quotes-store');
const { getAvailabilityByType, findUnavailable, hasOtasyncCreds, releaseHold } = require('./_otasync');

/* Scheduled job: re-checks availability for every active/viewed quote and
   flags the ones that lost availability (availabilityOk:false + unavailable[]).
   Schedule is configured in netlify.toml. */
exports.handler = async () => {
  if (!hasOtasyncCreds()) {
    console.log('[revalidate-quotes] OTASync credentials missing; skipping.');
    return { statusCode: 200, body: 'skipped: no credentials' };
  }

  let store, quotes;
  try {
    store = getQuoteStore();
    quotes = await listAllQuotes(store);
  } catch (e) {
    console.error('[revalidate-quotes] store unavailable:', e.message);
    return { statusCode: 503, body: 'store unavailable' };
  }

  // Only quotes a client could still act on
  const active = quotes.filter(q => {
    const st = effectiveStatus(q);
    return (st === 'activa' || st === 'vista') && q.checkin && q.checkout && Array.isArray(q.items) && q.items.length;
  });

  // Cache availability per date range to avoid duplicate PMS calls
  const cache = new Map();
  let changed = 0, lost = 0;

  for (const q of active) {
    const cacheKey = q.checkin + '|' + q.checkout;
    try {
      let avail = cache.get(cacheKey);
      if (!avail) {
        avail = await getAvailabilityByType(q.checkin, q.checkout);
        cache.set(cacheKey, avail);
      }
      if (avail.isMock) continue;

      const shortfalls = findUnavailable(q.items, avail.availByType);
      const nowOk = shortfalls.length === 0;
      const prevOk = q.availabilityOk !== false;

      if (nowOk !== prevOk || (!nowOk && JSON.stringify(q.unavailable) !== JSON.stringify(shortfalls))) {
        q.availabilityOk = nowOk;
        q.availabilityCheckedAt = new Date().toISOString();
        if (nowOk) delete q.unavailable; else q.unavailable = shortfalls;
        await saveQuote(store, q);
        changed++;
        if (!nowOk) lost++;
      }
    } catch (e) {
      console.error(`[revalidate-quotes] check failed for ${q.quoteId}:`, e.message);
    }
  }

  // Release holds left on expired/cancelled quotes
  let released = 0;
  for (const q of quotes) {
    if (!Array.isArray(q.holdReservationIds) || !q.holdReservationIds.length) continue;
    const st = effectiveStatus(q);
    if (st === 'vencida' || st === 'cancelada') {
      for (const holdId of q.holdReservationIds) {
        try { await releaseHold(holdId); released++; } catch (e) { console.error(`[revalidate-quotes] releaseHold failed for ${q.quoteId}:`, e.message); }
      }
      q.holdReservationIds = [];
      try { await saveQuote(store, q); } catch (e) { /* non-fatal */ }
    }
  }

  console.log(`[revalidate-quotes] checked ${active.length}, updated ${changed}, lost availability ${lost}, holds released ${released}`);
  return { statusCode: 200, body: `checked ${active.length}, updated ${changed}, lost ${lost}, released ${released}` };
};
