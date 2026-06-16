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
    channelId: String(resv.id_channels || '')
  };
}

/* Para cada evento de reserva (insert/edit), crea/actualiza el huésped en Odoo,
   etiquetado por canal (Booking.com, Airbnb, …). Omite reservas de nuestro
   propio canal web (las maneja wompi-webhook, para no duplicar el origen). No
   fatal por huésped. En DEBUG registra el payload para verificar/afinar la forma
   real con la primera reserva entrante. */
async function syncReservationGuests(events) {
  const { upsertPartner } = require('./_odoo');
  const webChannelId = String(process.env.OTASYNC_CHANNEL_ID || '');
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
        comment: `Huésped de reserva OTASync (canal: ${guest.channel}).`
      });
      n++;
    } catch (e) {
      console.error('[otasync-webhook] Odoo upsert (huésped) no fatal:', e.message);
    }
  }
  return n;
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

exports._test = { extractGuest, syncReservationGuests };
