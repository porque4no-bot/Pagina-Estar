const { getQuoteStore, listAllQuotes, saveQuote, effectiveStatus } = require('./_quotes-store');
const { getAvailabilityByType, findUnavailable, hasOtasyncCreds } = require('./_otasync');
const { sendEmail, adminEmail, adminAvailabilityLostHtml } = require('./_email');
const crypto = require('crypto');

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

/* Extrae los datos de contacto del huésped del objeto `reservation` que envía el
   webhook de OTASync (`data_type="reservation"`, `data = objeto reservation`).
   Sigue el modelo de OTASync (array `guests`, más `guest_email`/`channel`/
   `id_channels`). Devuelve null si no hay datos útiles. Defensivo ante variantes
   de nombres de campo (OTAs distintas pueden poblar el huésped distinto). */
function extractGuest(resv) {
  if (!resv || typeof resv !== 'object') return null;
  const g = (Array.isArray(resv.guests) && resv.guests[0]) ? resv.guests[0] : resv;
  const name = `${g.first_name || g.firstName || ''} ${g.last_name || g.lastName || ''}`.trim();
  const email = String(g.email || resv.guest_email || resv.email || '').trim();
  const phone = String(g.phone || resv.phone || resv.guest_phone || '').trim();
  if (!name && !email) return null;
  return {
    name: name || email,
    email,
    phone,
    channel: resv.channel || resv.channel_name || 'OTA',
    channelId: String(resv.id_channels || ''),
    /* Enriquecimiento de la ficha (campos estándar de res.partner). País e
       idioma vienen del huésped o de la reserva según el canal; las fechas dan
       el último checkout y las noches estimadas. Defensivo ante nombres de
       campo distintos por OTA. */
    country: String(g.country || g.country_name || g.country_code || resv.country || '').trim(),
    lang: String(g.language || g.lang || resv.language || resv.lang || '').trim(),
    checkin: String(resv.date_arrival || resv.checkin || '').trim(),
    checkout: String(resv.date_departure || resv.checkout || '').trim()
  };
}

/* Noches entre dos fechas ISO (yyyy-mm-dd). 0 si faltan o son inválidas. */
function nightsBetween(checkin, checkout) {
  if (!checkin || !checkout) return 0;
  const d1 = new Date(checkin), d2 = new Date(checkout);
  if (isNaN(d1) || isNaN(d2)) return 0;
  const n = Math.round((d2 - d1) / 86400000);
  return n > 0 ? n : 0;
}

/* Para cada evento de reserva (insert/edit), crea/actualiza el huésped en Odoo,
   etiquetado por canal (Booking.com, Airbnb, …). Omite reservas de nuestro
   propio canal web (las maneja wompi-webhook, para no duplicar el origen). No
   fatal por huésped. En DEBUG registra el payload para verificar/afinar la forma
   real con la primera reserva entrante. */
async function syncReservationGuests(events) {
  const { upsertPartner } = require('./_odoo');
  const webChannelId = String(process.env.OTASYNC_CHANNEL_ID || '66483');
  let n = 0;
  for (const ev of events) {
    if (ev.data_type !== 'reservation') continue;
    if (ev.action && !['insert', 'edit'].includes(ev.action)) continue;
    if (process.env.DEBUG && ev.data) console.log('[otasync-webhook] reservation payload:', JSON.stringify(ev.data).slice(0, 1500));
    const guest = extractGuest(ev.data);
    if (!guest) continue;
    if (webChannelId && guest.channelId && guest.channelId === webChannelId) continue; // nuestra web
    try {
      await upsertPartner({
        name: guest.name,
        email: guest.email,
        phone: guest.phone,
        isCompany: false,
        tags: [String(guest.channel).slice(0, 40)],
        country: guest.country || undefined,
        lang: guest.lang || undefined,
        lastCheckout: guest.checkout || undefined,
        nights: nightsBetween(guest.checkin, guest.checkout) || undefined,
        comment: `Huésped de reserva OTASync (canal: ${guest.channel}).`
      });
      n++;
    } catch (e) {
      console.error('[otasync-webhook] Odoo upsert (huésped) no fatal:', e.message);
    }
  }
  return n;
}

/* Blobs store helper (dedupe of cancellation notifications). */
function cancelDedupeStore() {
  const { getStore } = require('@netlify/blobs');
  const opts = { name: 'cancellation-notified', consistency: 'strong' };
  const siteID = process.env.BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) {
    opts.siteID = siteID;
    opts.token = token;
  }
  return getStore(opts);
}

/* True when a reservation event represents a cancellation. OTASync sends
   data_type="reservation" with a cancel action; we also accept a cancelled
   status on the reservation object as a fallback (field names vary by channel). */
function isCancellationEvent(ev) {
  if (!ev || ev.data_type !== 'reservation') return false;
  if (/cancel/i.test(String(ev.action || ''))) return true;
  const st = (ev.data && (ev.data.status || ev.data.reservation_status)) || '';
  return /cancel/i.test(String(st));
}

/* Handles cancellation events: emails the guest a confirmation (ONLY for our own
   web reservations — OTA guests already get the channel's email), alerts the
   team, and is idempotent per reservation id. Skips holds (BLOQUEO). Best-effort:
   a failure here never breaks the webhook. Returns the count handled. */
async function handleCancellations(events, deps = {}) {
  const cancels = events.filter(isCancellationEvent);
  if (!cancels.length) return { handled: 0, canceledIds: [] };

  const email = require('./_email');
  const sendEmail = deps.sendEmail || email.sendEmail;
  const adminEmail = deps.adminEmail || email.adminEmail;
  const { cancellationConfirmedHtml, adminCancellationHtml } = email;
  const webChannelId = String(process.env.OTASYNC_CHANNEL_ID || '66483');
  let store = deps.store || null;
  if (!store && deps.store !== false) { try { store = cancelDedupeStore(); } catch (_) { /* dev: no blobs */ } }

  const canceledIds = [];
  let handled = 0;
  for (const ev of cancels) {
    const resv = ev.data || {};
    const resId = String(resv.id_reservations || resv.id || '');
    if (resId) canceledIds.push(resId);

    const guest = extractGuest(resv);
    /* Skip our own tentative holds (BLOQUEO) — those are released elsewhere. */
    const looksLikeHold = guest && /^bloqueo/i.test(String(guest.name || '')) ||
      /^COT-/i.test(String(resv.reference || ''));
    if (looksLikeHold) continue;

    /* Idempotency: don't notify twice for the same reservation. */
    if (resId && store) {
      try { if (await store.get(resId)) continue; } catch (_) { /* ignore */ }
    }

    const lang = /^en/i.test(String(resv.language || resv.lang || '')) ? 'en' : 'es';
    const booking = {
      bookingCode: resv.reference || resId || 's/código',
      guestName: (guest && guest.name) || '',
      guestEmail: (guest && guest.email) || '',
      checkIn: resv.date_arrival || resv.checkin || '',
      checkOut: resv.date_departure || resv.checkout || '',
      lang
    };
    const isWeb = !!(guest && guest.channelId && guest.channelId === webChannelId);

    /* 1) Guest confirmation — only for our web reservations with a real email. */
    if (isWeb && booking.guestEmail) {
      try {
        await sendEmail({
          to: booking.guestEmail,
          subject: lang === 'en' ? `Reservation cancelled — ${booking.bookingCode}` : `Reserva cancelada — ${booking.bookingCode}`,
          html: cancellationConfirmedHtml({ booking, lang })
        });
      } catch (e) { console.error('[otasync-webhook] guest cancellation email failed:', e.message); }
    }

    /* 2) Team alert — always (awareness + refund follow-up). */
    try {
      await sendEmail({
        to: adminEmail(),
        subject: `Reserva cancelada — ${booking.bookingCode}`,
        html: adminCancellationHtml({ booking, channel: (guest && guest.channel) || 'OTA', isWeb })
      });
    } catch (e) { console.error('[otasync-webhook] team cancellation alert failed:', e.message); }

    if (resId && store) { try { await store.set(resId, '1', { ttl: 86400 * 30 }); } catch (_) { /* ignore */ } }
    handled++;
  }
  return { handled, canceledIds };
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  const expected = process.env.OTASYNC_WEBHOOK_SECRET;
  if (!expected) {
    console.error('[otasync-webhook] OTASYNC_WEBHOOK_SECRET is not configured. Rejecting webhook.');
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'Webhook secret not configured' }) };
  }
  const got = (event.headers && (event.headers['x-otasync-secret'] || event.headers['X-OTASYNC-Secret'])) ||
    (event.queryStringParameters || {}).secret ||
    '';
  const gotBuf = Buffer.from(String(got));
  const expectedBuf = Buffer.from(String(expected));
  if (gotBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(gotBuf, expectedBuf)) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
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

  /* Maestro de clientes (Fase 1): sincroniza a Odoo el huésped de cada reserva
     entrante (incl. Booking/OTAs). No fatal, independiente de la lógica de
     cotizaciones de abajo. */
  try {
    await syncReservationGuests(events);
  } catch (e) {
    console.error('[otasync-webhook] guest sync no fatal:', e.message);
  }

  /* Cancellation events: notify the guest (web reservations only) + the team.
     Independent of the quote logic below; never breaks the webhook. */
  let canceledIds = [];
  try {
    const res = await handleCancellations(events);
    canceledIds = res.canceledIds || [];
    if (res.handled) console.log(`[otasync-webhook] cancellations handled: ${res.handled}`);
  } catch (e) {
    console.error('[otasync-webhook] cancellation handling no fatal:', e.message);
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

  /* Free dead holds: if a cancelled reservation id matches a quote's hold, drop
     it so the quote re-enters availability re-validation (a stuck hold would
     otherwise keep it flagged "guaranteed" forever). Best-effort. */
  if (canceledIds.length) {
    const canceledSet = new Set(canceledIds.map(String));
    for (const q of quotes) {
      if (!Array.isArray(q.holdReservationIds) || !q.holdReservationIds.length) continue;
      const kept = q.holdReservationIds.filter(id => !canceledSet.has(String(id)));
      if (kept.length !== q.holdReservationIds.length) {
        q.holdReservationIds = kept;
        q.availabilityCheckedAt = null;
        try { await saveQuote(store, q); } catch (e) { console.error('[otasync-webhook] hold cleanup save failed:', e.message); }
      }
    }
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
        const justLost = !nowOk && prevOk;
        q.availabilityOk = nowOk;
        q.availabilityCheckedAt = new Date().toISOString();
        if (nowOk) delete q.unavailable; else q.unavailable = shortfalls;
        await saveQuote(store, q);
        updated++;
        if (!nowOk) lost++;
        if (justLost) {
          try {
            await sendEmail({ to: adminEmail(), subject: `Cotización sin disponibilidad — ${q.quoteId}`, html: adminAvailabilityLostHtml({ quote: q, shortfalls }) });
          } catch (e) { console.error('[otasync-webhook] availability email failed:', e.message); }
        }
      }
    } catch (e) {
      console.error(`[otasync-webhook] re-check failed for ${q.quoteId}:`, e.message);
    }
  }

  console.log(`[otasync-webhook] candidates ${candidates.length}, updated ${updated}, lost ${lost}`);
  return { statusCode: 200, headers, body: JSON.stringify({ received: true, updated, lost }) };
};

exports._test = { extractGuest, syncReservationGuests, isCancellationEvent, handleCancellations };
