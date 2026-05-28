const fs = require('fs');
const path = require('path');
const { authenticateAdmin } = require('./_firebase-auth');
const { getQuoteStore, loadQuote, saveQuote, sanitizeQuoteInput, effectiveStatus } = require('./_quotes-store');
const { getAvailabilityByType, findUnavailable, releaseHold, createHold } = require('./_otasync');

function loadEnv() {
  if (process.env.NODE_ENV === 'production' || process.env.NETLIFY === 'true') return;
  try {
    const envPath = path.join(__dirname, '../../.env');
    if (!fs.existsSync(envPath)) return;
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (!m) return;
      let v = m[2] || '';
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!process.env[m[1]]) process.env[m[1]] = v.trim();
    });
  } catch (e) {}
}

loadEnv();

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

    const auth = await authenticateAdmin(event);
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
      // Release any Kunas hold so the rooms free up
      for (const holdId of (existing.holdReservationIds || [])) {
        try { await releaseHold(holdId); } catch (e) { console.error('[update-quote] releaseHold failed for', quoteId, holdId, e.message); }
      }
      existing.holdReservationIds = [];
      existing.status = 'cancelada';
      existing.cancelledAt = now;
      existing.cancelledBy = auth.email || 'admin';
      existing.updatedAt = now;
      await saveQuote(store, existing);
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ quoteId, status: 'cancelada' }) };
    }
    if (body.action === 'reactivate') {
      existing.status = (existing.firstViewedAt) ? 'vista' : 'activa';
      delete existing.cancelledAt;
      delete existing.cancelledBy;
      existing.updatedAt = now;
      await saveQuote(store, existing);
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ quoteId, status: effectiveStatus(existing) }) };
    }

    /* ── Full edit ── */
    if (!body.empresa || !body.email || !Array.isArray(body.items) || body.items.length === 0) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Faltan campos: empresa, email, items' }) };
    }

    const sanitized = sanitizeQuoteInput(body);
    const wantsHold = body.bloquearHabitaciones === true;

    /* Release existing hold first so the edited quote's own units don't count
       against its availability (and the old hold may no longer match). */
    for (const holdId of (existing.holdReservationIds || [])) {
      try { await releaseHold(holdId); } catch (e) { console.error('[update-quote] releaseHold failed for', quoteId, holdId, e.message); }
    }

    /* Availability gate (same as create): block edits that can't be booked. */
    if (sanitized.checkin && sanitized.checkout) {
      try {
        const { availByType, isMock } = await getAvailabilityByType(sanitized.checkin, sanitized.checkout);
        if (!isMock) {
          const shortfalls = findUnavailable(sanitized.items, availByType);
          if (shortfalls.length > 0) {
            return { statusCode: 409, headers: corsHeaders, body: JSON.stringify({ error: 'Sin disponibilidad para las fechas seleccionadas', unavailable: shortfalls }) };
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
      availabilityOk: true,
      availabilityCheckedAt: now,
      bloquearHabitaciones: wantsHold,
      holdReservationIds: [],
      updatedAt: now
    };
    delete updated.cancelledAt;
    delete updated.cancelledBy;

    await saveQuote(store, updated);

    /* Recreate the hold if requested */
    if (wantsHold && updated.checkin && updated.checkout) {
      try {
        const holdId = await createHold(updated);
        if (holdId) { updated.holdReservationIds = [holdId]; await saveQuote(store, updated); }
      } catch (e) {
        console.error('[update-quote] hold creation failed for', quoteId, ':', e.message);
      }
    }

    const base = (process.env.URL || process.env.DEPLOY_URL || 'https://estar.com.co').replace(/\/$/, '');
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ quoteId, shareUrl: `${base}/cotizacion.html?id=${quoteId}` }) };
  } catch (err) {
    console.error('[update-quote] error:', err);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Error interno del servidor', details: err.message }) };
  }
};
