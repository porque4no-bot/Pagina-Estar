const { getQuoteStore, listAllQuotes, saveQuote, effectiveStatus, shouldRemindExpiry } = require('./_quotes-store');
const { getAvailabilityByType, findUnavailable, hasOtasyncCreds, releaseHold } = require('./_otasync');
const { sendEmail, adminEmail, adminAvailabilityLostHtml, quoteExpiringHtml } = require('./_email');
const { flag } = require('./_settings');

/* Send the "expiring soon" reminder this many ms before a quote's expiry. */
const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;

/* ── Sincroniza el ciclo de vida del lead CRM (Odoo) con el estado de las
   cotizaciones ──
   aceptada → lead "ganado"; cancelada/vencida → lead "perdido". Idempotente
   (marca `leadLifecycle` en la cotización para no re-escribir cada corrida) y no
   fatal (Odoo nunca debe tumbar el cron). Mock no-op sin credenciales de Odoo.
   Inyectable (`deps.odoo`) para pruebas sin red. */
async function syncLeadLifecycle(store, quotes, deps = {}) {
  const odoo = deps.odoo || require('./_odoo');
  if (!odoo.isConfigured()) return { won: 0, lost: 0 };
  let won = 0, lost = 0;
  for (const q of quotes) {
    const st = effectiveStatus(q);
    let target = null;        // 'won' | 'lost'
    let reason = '';
    if (st === 'aceptada') { target = 'won'; }
    else if (st === 'cancelada') { target = 'lost'; reason = 'Cotización cancelada'; }
    else if (st === 'vencida') { target = 'lost'; reason = 'Cotización vencida'; }
    if (!target) continue;
    /* Idempotencia: no re-sincronizar si ya quedó en el mismo desenlace. */
    if (q.leadLifecycle === target) continue;
    try {
      const res = target === 'won'
        ? await odoo.markLeadWonByQuote(q)
        : await odoo.markLeadLost(q, reason);
      if (res && res.isMock) continue;            // sin credenciales: no marcar
      q.leadLifecycle = target;
      q.leadLifecycleAt = new Date().toISOString();
      if (res && res.id) q.leadId = res.id;
      try { await saveQuote(store, q); } catch (e) { /* persistencia no fatal */ }
      if (target === 'won') won++; else lost++;
    } catch (e) {
      console.error(`[revalidate-quotes] lead lifecycle (${target}) falló para ${q.quoteId}:`, e.message);
    }
  }
  return { won, lost };
}

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

  // Only quotes a client could still act on (skip held quotes — the hold guarantees availability)
  const active = quotes.filter(q => {
    const st = effectiveStatus(q);
    if (st !== 'activa' && st !== 'vista') return false;
    if (!q.checkin || !q.checkout || !Array.isArray(q.items) || !q.items.length) return false;
    if (Array.isArray(q.holdReservationIds) && q.holdReservationIds.length) return false;
    return true;
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
        const justLost = !nowOk && prevOk;
        q.availabilityOk = nowOk;
        q.availabilityCheckedAt = new Date().toISOString();
        if (nowOk) delete q.unavailable; else q.unavailable = shortfalls;
        await saveQuote(store, q);
        changed++;
        if (!nowOk) lost++;
        if (justLost) {
          try {
            await sendEmail({
              to: adminEmail(),
              subject: `Cotización sin disponibilidad — ${q.quoteId}`,
              html: adminAvailabilityLostHtml({ quote: q, shortfalls })
            });
          } catch (e) { console.error('[revalidate-quotes] availability email failed:', e.message); }
        }
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
      const remaining = [];
      for (const holdId of q.holdReservationIds) {
        try { await releaseHold(holdId); released++; }
        catch (e) {
          console.error(`[revalidate-quotes] releaseHold failed for ${q.quoteId}/${holdId}:`, e.message);
          remaining.push(holdId);
        }
      }
      q.holdReservationIds = remaining;
      try { await saveQuote(store, q); } catch (e) { /* non-fatal */ }
    }
  }

  // Sync CRM lead lifecycle with quote status (Odoo). Non-fatal, mock-safe.
  let leadWon = 0, leadLost = 0;
  try {
    const r = await syncLeadLifecycle(store, quotes);
    leadWon = r.won; leadLost = r.lost;
  } catch (e) {
    console.error('[revalidate-quotes] lead lifecycle sync no fatal:', e.message);
  }

  // Remind clients whose active quote is about to expire (once per quote).
  // Client-facing email → opt-in by flag (OFF by default), consistent with the
  // other new email features in this branch.
  const baseUrl = (process.env.URL || process.env.GUEST_APP_BASE_URL || '').replace(/\/$/, '');
  const nowMs = Date.now();
  let reminded = 0;
  if (!(await flag('QUOTE_EXPIRY_REMINDER_ENABLED'))) {
    /* disabled: skip reminders */
  } else if (!baseUrl) {
    console.warn('[revalidate-quotes] no base URL (URL/GUEST_APP_BASE_URL); skipping expiry reminders');
  } else {
    for (const q of quotes) {
      if (!shouldRemindExpiry(q, nowMs, REMINDER_WINDOW_MS)) continue;
      const quoteUrl = `${baseUrl}/cotizacion.html?id=${encodeURIComponent(q.quoteId)}`;
      try {
        await sendEmail({
          to: q.email,
          subject: `Tu cotización ${q.quoteId} vence pronto — Hotel Estar`,
          html: quoteExpiringHtml({ quote: q, quoteUrl })
        });
        q.reminderSentAt = new Date().toISOString();
        await saveQuote(store, q);
        reminded++;
      } catch (e) {
        console.error(`[revalidate-quotes] reminder failed for ${q.quoteId}:`, e.message);
      }
    }
  }

  console.log(`[revalidate-quotes] checked ${active.length}, updated ${changed}, lost availability ${lost}, holds released ${released}, reminders ${reminded}, leads won ${leadWon}, leads lost ${leadLost}`);
  return { statusCode: 200, body: `checked ${active.length}, updated ${changed}, lost ${lost}, released ${released}, reminded ${reminded}, leadsWon ${leadWon}, leadsLost ${leadLost}` };
};

exports._test = { syncLeadLifecycle };
