require('./_env');
const crypto = require('crypto');
const { authorize } = require('./_authz');
const { getQuoteStore, loadQuote, saveQuote, sanitizeQuoteInput, effectiveStatus } = require('./_quotes-store');
const { getAvailabilityByType, findUnavailable, releaseHold, createHold } = require('./_otasync');
const { appendAuditEntry } = require('./_quote-audit');

exports.handler = async (event, context) => {
  const corsHeaders = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) corsHeaders['Access-Control-Allow-Origin'] = allowedOrigin;

  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method Not Allowed' }) };

    const auth = await authorize(event, 'quotes.edit');
    if (!auth.ok) return { statusCode: auth.statusCode, headers: corsHeaders, body: JSON.stringify({ error: auth.error }) };

    if (event.body && event.body.length > 20000) return { statusCode: 413, headers: corsHeaders, body: JSON.stringify({ error: 'Payload demasiado grande' }) };

    let body;
    try { body = JSON.parse(event.body); }
    catch (e) { return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'JSON inválido' }) }; }

    const quoteId = String(body.quoteId || '').trim();
    if (!/^COT-\d{4}-[A-Z0-9]{5}$/.test(quoteId)) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'quoteId inválido' }) };
    }

    let store, existing;
    try {
      store = getQuoteStore();
      existing = await loadQuote(store, quoteId);
    } catch (e) {
      return { statusCode: 503, headers: corsHeaders, body: JSON.stringify({ error: 'Almacenamiento no disponible' }) };
    }
    if (!existing) {
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Cotización no encontrada' }) };
    }

    const now = new Date().toISOString();

    /* ── Status-only actions ── */
    if (body.action === 'cancel') {
      if (effectiveStatus(existing) === 'aceptada') {
        return { statusCode: 409, headers: corsHeaders, body: JSON.stringify({ error: 'No se puede cancelar una cotización ya pagada. Gestiona la reserva directamente en Kunas.' }) };
      }
      // Release any Kunas hold so the rooms free up
      for (const holdId of (existing.holdReservationIds || [])) {
        try { await releaseHold(holdId); } catch (e) { console.error('[update-quote] releaseHold failed for', quoteId, holdId, e.message); }
      }
      const beforeCancel = { ...existing };
      existing.holdReservationIds = [];
      existing.status = 'cancelada';
      existing.cancelledAt = now;
      existing.cancelledBy = auth.email || 'admin';
      existing.updatedAt = now;
      await saveQuote(store, existing);
      await appendAuditEntry({
        quoteId, by: auth.email || 'admin', action: 'cancel',
        before: beforeCancel, after: existing
      });
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ quoteId, status: 'cancelada' }) };
    }
    if (body.action === 'reactivate') {
      const beforeReact = { ...existing };
      existing.status = (existing.firstViewedAt) ? 'vista' : 'activa';
      delete existing.cancelledAt;
      delete existing.cancelledBy;
      existing.updatedAt = now;
      await saveQuote(store, existing);
      await appendAuditEntry({
        quoteId, by: auth.email || 'admin', action: 'reactivate',
        before: beforeReact, after: existing
      });
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ quoteId, status: effectiveStatus(existing) }) };
    }

    /* ── Full edit ── */
    if (effectiveStatus(existing) === 'aceptada') {
      return { statusCode: 409, headers: corsHeaders, body: JSON.stringify({ error: 'No se puede editar una cotización que ya fue pagada.' }) };
    }
    if (!body.empresa || !body.email || !Array.isArray(body.items) || body.items.length === 0) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Faltan campos: empresa, email, items' }) };
    }

    const sanitized = sanitizeQuoteInput(body);
    const wantsHold = body.bloquearHabitaciones === true;

    /* Release existing hold first so the edited quote's own units don't count
       against its availability (and the old hold may no longer match).
       Persist the cleared hold list immediately: otherwise an early return
       below (409/502) would leave the quote referencing a hold that no longer
       exists in Kunas, which quote-availability/wompi-webhook would treat as
       "rooms guaranteed" → overbooking. */
    if ((existing.holdReservationIds || []).length) {
      for (const holdId of existing.holdReservationIds) {
        try { await releaseHold(holdId); } catch (e) { console.error('[update-quote] releaseHold failed for', quoteId, holdId, e.message); }
      }
      existing.holdReservationIds = [];
      try { await saveQuote(store, existing); } catch (e) { /* non-fatal */ }
    }

    /* Availability gate (same as create): block edits that can't be booked,
       UNLESS the admin forces it (allowOverbooking). */
    let availabilityOk = true;
    let overbooking = false;
    let unavailableRooms = [];
    if (sanitized.checkin && sanitized.checkout) {
      try {
        const { availByType, isMock } = await getAvailabilityByType(sanitized.checkin, sanitized.checkout);
        if (!isMock) {
          const shortfalls = findUnavailable(sanitized.items, availByType);
          if (shortfalls.length > 0) {
            if (body.allowOverbooking === true) {
              availabilityOk = false;
              overbooking = true;
              unavailableRooms = shortfalls;
            } else {
              return { statusCode: 409, headers: corsHeaders, body: JSON.stringify({ error: 'Sin disponibilidad para las fechas seleccionadas', unavailable: shortfalls }) };
            }
          }
        }
      } catch (e) {
        console.error('[update-quote] availability check failed:', e.message);
        return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: 'No se pudo verificar la disponibilidad. Intenta de nuevo.' }) };
      }
    }

    const updated = {
      ...existing,
      ...sanitized,
      quoteId,
      createdAt: existing.createdAt,
      createdBy: existing.createdBy,
      views: existing.views || 0,
      firstViewedAt: existing.firstViewedAt || null,
      lastViewedAt: existing.lastViewedAt || null,
      status: (existing.firstViewedAt) ? 'vista' : 'activa',
      availabilityOk,
      availabilityCheckedAt: now,
      overbooking,
      unavailable: unavailableRooms,
      publicToken: existing.publicToken || crypto.randomBytes(24).toString('base64url'),
      bloquearHabitaciones: wantsHold,
      holdReservationIds: [],
      updatedAt: now
    };
    delete updated.cancelledAt;
    delete updated.cancelledBy;

    await saveQuote(store, updated);
    await appendAuditEntry({
      quoteId, by: auth.email || 'admin', action: 'edit',
      before: existing, after: updated
    });

    /* Recreate the hold if requested (never for overbooking — nothing to hold) */
    if (wantsHold && !overbooking && updated.checkin && updated.checkout) {
      try {
        const holdId = await createHold(updated);
        if (holdId) { updated.holdReservationIds = [holdId]; await saveQuote(store, updated); }
      } catch (e) {
        console.error('[update-quote] hold creation failed for', quoteId, ':', e.message);
      }
    }

    const base = (process.env.URL || process.env.DEPLOY_URL || 'https://estar.com.co').replace(/\/$/, '');
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ quoteId, shareUrl: `${base}/cotizacion.html?id=${quoteId}&t=${updated.publicToken}` }) };
  } catch (err) {
    console.error('[update-quote] error:', err);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Error interno del servidor', details: err.message }) };
  }
};
