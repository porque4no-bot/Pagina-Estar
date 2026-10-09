require('./_env');
const { authorize } = require('./_authz');
const { getRefund, transitionStatus, STATUS, ROUTE } = require('./_refunds-store');
const { flag } = require('./_settings');

/* A-14: cuando el reembolso se COMPLETA (mark-done → plata devuelta, la estadía no
   ocurrió), devolver el uso del cupón al pool para que el candado un-uso-por-email
   y el cupo no queden consumidos por una reserva cancelada. Idempotente por booking
   (restoreDiscountUse borra la marca booking:<code>:<bookingCode>). Best-effort. */
async function maybeRestoreDiscount(bookingCode) {
  if (!bookingCode) return;
  try {
    const { getStore } = require('@netlify/blobs');
    const siteID = process.env.BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
    const token = process.env.BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
    const opts = { name: 'booking-discounts', consistency: 'strong' };
    if (siteID && token) { opts.siteID = siteID; opts.token = token; }
    const store = getStore(opts);
    const raw = await store.get(`disc-${bookingCode}`);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (!d || !d.code) return;
    const { restoreDiscountUse } = require('./_discount-store');
    await restoreDiscountUse(d.code, { email: d.email || '', bookingCode });
  } catch (e) {
    console.error('[refund-admin-action] restore discount failed (non-fatal):', e.message);
  }
}

/* Cada acción exige su propio permiso atómico (mapa de _permissions.js):
   approve → refunds.approve · deny → refunds.deny · set-amount → refunds.set_amount
   mark-processing / mark-done → refunds.mark_done · create-special (caso especial)
   y retry-gateway → refunds.approve · pms-cancel → refunds.approve (reintento
   automático) o refunds.mark_done (confirmar que se canceló a mano en Kunas). */
const ACTION_PERMISSION = {
  'approve': 'refunds.approve',
  'deny': 'refunds.deny',
  'set-amount': 'refunds.set_amount',
  'mark-processing': 'refunds.mark_done',
  'mark-done': 'refunds.mark_done',
  'create-special': 'refunds.approve',
  'retry-gateway': 'refunds.approve',
  'pms-cancel': 'refunds.approve'
};

function permissionFor(action, body) {
  if (action === 'pms-cancel' && body && body.manual === true) return 'refunds.mark_done';
  return ACTION_PERMISSION[action];
}

/* ¿El id de transacción viene de la pasarela/nota del webhook (confiable) o lo
   escribió un admin? Un id mal digitado podría reembolsar el pago de OTRO cliente,
   así que con un id ingresado a mano NO se ejecuta el reembolso automático: queda
   como tarea para hacerlo desde el panel de Mercado Pago. */
function trustedTransaction(refund) {
  return !!(refund && refund.transactionId && refund.transactionIdSource !== 'admin');
}

/* Auto-execute a GATEWAY_AUTO refund (Mercado Pago — the only provider with a
   refund API). Runs only after an admin approved the amount, and only when
   REFUND_GATEWAY_AUTO_ENABLED is set, so no money moves until the owner enables
   it. Never throws: returns { summary, refund } or null. */
async function executeGatewayRefund(refund, actor, amountCents) {
  const { refundMercadoPago } = require('./_mp-refund');
  if (!refund || !refund.transactionId) {
    return { summary: { ok: false, error: 'missing_transaction_id' }, refund };
  }
  /* Reembolso TOTAL (sin monto) solo si el monto pagado salió de la pasarela. Si
     lo ingresó el admin o es el total de Kunas, se manda el monto explícito para
     que un dato mal digitado nunca devuelva de más. */
  const verifiedOriginal = refund.originalAmountSource === 'payment' ? refund.originalAmountCents : null;
  const result = await refundMercadoPago({
    paymentId: refund.transactionId,
    amountCents,
    originalAmountCents: verifiedOriginal,
    /* Clave estable por intento: un reintento tras un TIMEOUT o error de red
       reusa la misma clave (MP pudo haber procesado la devolución → no se
       duplica); tras un rechazo definitivo de MP (respuesta HTTP) el intento
       sube, para que MP no devuelva en caché el mismo error al reintentar. */
    idempotencyKey: `${refund.refundId || refund.bookingCode}-refund-${Number(refund.gatewayAttempt) || 0}`
  });

  const execRecord = {
    ok: !!result.ok,
    provider: 'mercadopago',
    refundId: result.refundId || null,
    providerStatus: result.status || null,
    error: result.ok ? null : (result.detail || result.error || 'unknown'),
    at: new Date().toISOString(),
    by: actor
  };

  if (result.ok) {
    /* MP 'approved' = settled; 'in_process' = accepted, settling at the bank. */
    const done = result.status === 'approved';
    const target = done ? STATUS.DONE : STATUS.PENDING_PROVIDER;
    const patch = { refundExecution: execRecord, payoutRef: result.refundId || null };
    if (done) { patch.completedAt = execRecord.at; patch.completedBy = `${actor} (Mercado Pago auto)`; }
    const res = await transitionStatus(refund.bookingCode, target, 'system',
      `Reembolso Mercado Pago ${result.status} (refund ${result.refundId || 'N/D'})`, patch);
    return { summary: execRecord, refund: res.refund };
  }

  /* Failed: record it, flag the request, and alert the team — a human finishes
     it manually within the SLA. */
  /* Rechazo definitivo = MP respondió (HTTP de error o status 'rejected'). */
  const definitive = result.status != null && result.error !== 'timeout';
  const failPatch = { refundExecution: execRecord };
  if (definitive) failPatch.gatewayAttempt = (Number(refund.gatewayAttempt) || 0) + 1;
  const res = await transitionStatus(refund.bookingCode, STATUS.FAILED, 'system',
    `Fallo al reembolsar en Mercado Pago: ${execRecord.error}`, failPatch);
  try {
    const { reportAlert } = require('./_alert');
    await reportAlert({
      kind: 'refund_gateway_failed', severity: 'error',
      message: `Reembolso automático Mercado Pago falló para ${refund.bookingCode}: ${execRecord.error}`,
      context: { bookingCode: refund.bookingCode, transactionId: refund.transactionId, amountCents },
      dedupeKey: `refund-fail-${refund.bookingCode}`
    });
  } catch (_) { /* alert best-effort */ }
  return { summary: execRecord, refund: res.refund };
}

/* Sprint 1 (Mesa Redonda C3 — cerrar el lazo de cancelación). Al tomar la decisión
   TERMINAL (approve o deny: en ambos casos el huésped ya no llega), cancelamos la
   reserva en OTASync (soft-cancel: status→canceled, preserva el registro).
   - Gated OFF por defecto (OTASYNC_AUTO_CANCEL_ENABLED, leído con _settings.flag
     → el panel /admin lo controla).
   - Idempotente: una sola vez por reserva (marca reservationCanceled en el refund).
   - Solo reservas DIRECTAS: el bookingCode ES el id_reservations de OTASync; las
     cotizaciones (COT-...) tienen su propio camino de hold/release.
   - Best-effort + alerta: nunca rompe el flujo de reembolso. */
async function maybeCancelReservationInPms(refund, actor) {
  if (!refund || refund.reservationCanceled) return null;
  if (!(await flag('OTASYNC_AUTO_CANCEL_ENABLED'))) return null;
  const id = String(refund.bookingCode || '');
  if (!id || /^COT-/i.test(id)) return null;
  try {
    const { cancelReservation } = require('./_otasync');
    const result = await cancelReservation(id);
    /* null = sin cambio de estado (se conserva el ACTUAL: la llamada a Kunas
       puede tardar y en medio alguien pudo marcar "Reembolsado"). */
    await transitionStatus(refund.bookingCode, null, 'system',
      `Reserva cancelada en OTASync (${(result && result.status) || (result && result.alreadyGone ? 'no existía' : 'canceled')})`,
      {
        reservationCanceled: true,
        reservationCanceledAt: new Date().toISOString(),
        reservationCancelResult: { ok: !!(result && result.ok), status: (result && result.status) || null, alreadyGone: !!(result && result.alreadyGone) }
      });
    return result;
  } catch (e) {
    console.error('[refund-admin-action] OTASync cancel failed (non-fatal):', e.message);
    try {
      const { reportAlert } = require('./_alert');
      await reportAlert({
        kind: 'otasync_cancel_failed', severity: 'error',
        message: `No se pudo cancelar la reserva ${refund.bookingCode} en OTASync al procesar el reembolso: ${e.message}`,
        context: { bookingCode: refund.bookingCode, by: actor },
        dedupeKey: `otasync-cancel-${refund.bookingCode}`
      });
    } catch (_) { /* alerta best-effort */ }
    return null;
  }
}

/* Frente cancel: cerrar la reserva en Kunas tras la decisión. Con el flag
   encendido la cancela sola; apagado deja la TAREA "Cancelar en Kunas la reserva
   X" en la cola (pestaña Hoy). Casos especiales solo si el admin lo pidió. */
async function closeReservationInPms(refund, actor) {
  if (!refund) return { mode: 'skipped' };
  if (refund.reservationCanceled) return { mode: 'already' };
  if (refund.cancelReservation === false) return { mode: 'skipped' };
  const id = String(refund.bookingCode || '');
  if (!id || /^COT-/i.test(id)) return { mode: 'skipped' };
  if (await flag('OTASYNC_AUTO_CANCEL_ENABLED')) {
    const r = await maybeCancelReservationInPms(refund, actor);
    return { mode: 'auto', ok: !!(r && r.ok), status: (r && r.status) || null };
  }
  const flow = require('./_refund-flow');
  const q = await flow.enqueueTask(flow.pmsCancelTask(refund));
  return { mode: 'task', queued: !!(q && q.queued) };
}

/* Datos del pago que el admin completa cuando faltan (reserva vieja,
   booking-results vencido…). Solo LLENA huecos: nunca pisa datos de la pasarela.
   Si cambia el medio, se recalcula la ruta del reembolso. */
const PAYMENT_PROVIDERS = ['mercadopago', 'wompi', 'otro'];
function paymentFixPatch(refund, fix) {
  const patch = {};
  if (!fix || typeof fix !== 'object') return patch;
  const provider = PAYMENT_PROVIDERS.includes(String(fix.provider || '')) ? String(fix.provider) : null;
  const method = String(fix.method || '').replace(/[^A-Za-z0-9_ -]/g, '').trim().slice(0, 40);
  const tx = String(fix.transactionId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  /* Si el proveedor ya se conoce (pasarela / nota del webhook) y el admin eligió
     OTRO, no se mezcla un método de otro proveedor. */
  const conflict = !!(refund.paymentProvider && provider && provider !== refund.paymentProvider);
  if (!refund.paymentProvider && provider) patch.paymentProvider = provider;
  if (!refund.paymentMethod && method && !conflict) patch.paymentMethod = method;
  if (!refund.transactionId && tx) { patch.transactionId = tx; patch.transactionIdSource = 'admin'; }
  if (patch.paymentProvider || patch.paymentMethod) {
    const { refundRoute } = require('./_refunds-store');
    patch.route = refundRoute(patch.paymentProvider || refund.paymentProvider, patch.paymentMethod || refund.paymentMethod);
  }
  return patch;
}

/* Cerrar en Hoy TODAS las tareas de "cancelar en Kunas" de la reserva: la de la
   decisión con el flag apagado (refund-pms-cancel-<código>) y la de la alerta
   cuando la cancelación automática falló (otasync-cancel-<código>, encolada por
   reportAlert aquí y en _otasync.cancelReservation). */
async function resolvePmsCancelTasks(flow, bookingCode, actor) {
  await flow.resolveTask(flow.TASK_KEYS.pmsCancel(bookingCode), actor);
  await flow.resolveTask(flow.TASK_KEYS.pmsCancelAlert(bookingCode), actor);
}

function canSeeBankDetails(auth) {
  return !!(auth && (auth.isEnvAdmin || (Array.isArray(auth.permissions) && auth.permissions.includes('refunds.mark_done'))));
}

function viewOf(refund, auth) {
  try {
    const { redactRefund } = require('./_refunds-store');
    return typeof redactRefund === 'function' ? redactRefund(refund, { canSeeBank: canSeeBankDetails(auth) }) : refund;
  } catch (e) { return refund; }
}

/* Registra el aviso al huésped en el registro (append) para auditoría e
   idempotencia del correo "realizado". */
async function recordNotice(bookingCode, refund, notice) {
  try {
    const label = { approved: 'aprobado', denied: 'denegado', done: 'realizado' }[notice.type] || notice.type;
    /* Sin cambio de estado y agregando sobre el registro FRESCO (no sobre el que
       se leyó al comienzo de la petición). */
    const res = await transitionStatus(bookingCode, null, 'system',
      notice.sent ? `Correo al huésped: reembolso ${label}` : `Correo al huésped (${label}) NO enviado: ${notice.reason || 'error'}`,
      (fresh) => ({ guestNotices: (Array.isArray(fresh && fresh.guestNotices) ? fresh.guestNotices : []).concat([notice]) }));
    return (res && res.refund) || refund;
  } catch (e) {
    return refund;
  }
}

function sanitizeText(v, max) {
  return String(v == null ? '' : v).replace(/[<>\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);
}

/* Caso especial creado por el admin (cobro duplicado, compensación…). Busca la
   reserva en Kunas para completar los datos (best-effort, solo lectura) y el pago
   por id de OTASync y por código EST. Una sola solicitud por reserva. */
async function createSpecial(body, actor) {
  const bookingCode = String(body.bookingCode || '').trim();
  if (!/^[A-Za-z0-9-]{3,40}$/.test(bookingCode)) return { statusCode: 400, error: 'Código de reserva inválido' };
  const reason = sanitizeText(body.reason, 500);
  if (!reason) return { statusCode: 400, error: 'Escribe el motivo del caso especial' };

  let booking = null;
  try {
    const { hasOtasyncCreds } = require('./_otasync');
    if (hasOtasyncCreds()) {
      const { fetchReservation } = require('./request-cancellation');
      booking = await fetchReservation(bookingCode);
    }
  } catch (e) {
    console.error('[refund-admin-action] special: reservation lookup failed (non-fatal):', e.message);
  }
  if (!booking) {
    booking = {
      bookingCode,
      guestName: sanitizeText(body.guestName, 120) || null,
      guestEmail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.guestEmail || '').trim()) ? String(body.guestEmail).trim().slice(0, 160) : null,
      lang: body.lang === 'en' ? 'en' : 'es'
    };
  } else {
    booking.bookingCode = bookingCode;
  }

  const { recoverPaymentInfo, createRefundRequest, KIND } = require('./_refunds-store');
  const paymentInfo = await recoverPaymentInfo(bookingCode, { reference: booking.reference, note: booking.pmsNote });
  if (!paymentInfo.originalAmountCents && body.originalAmountCents != null) {
    const oc = parseInt(body.originalAmountCents, 10);
    if (Number.isFinite(oc) && oc > 0) { paymentInfo.originalAmountCents = oc; paymentInfo.originalAmountSource = 'admin'; }
  }
  const res = await createRefundRequest({
    booking, paymentInfo, clientIp: 'admin', source: 'admin', actor, reason,
    kind: KIND ? KIND.SPECIAL : 'special', cancelReservation: body.cancelReservation === true
  });
  if (!res.created && res.refund) return { statusCode: 409, error: 'Ya existe una solicitud de reembolso para esta reserva', refund: res.refund };
  if (!res.created) return { statusCode: 503, error: 'Almacenamiento no disponible' };
  return { statusCode: 200, refund: res.refund };
}

/* The human GATE for cancellations/refunds. Acciones:
     approve         → fija el monto (≤ lo pagado) y "hace todo": cancela en Kunas
                       (o deja la tarea), devuelve la plata por Mercado Pago si está
                       habilitado (o deja la tarea con instrucciones: MP / Wompi /
                       transferencia) y le avisa al huésped por correo.
     deny            → cierra la solicitud (DENIED), cancela en Kunas igual (el
                       huésped ya no viene) y avisa al huésped con el motivo.
     set-amount      → registra un monto (posiblemente parcial) según la política.
     mark-processing → el equipo empezó el reembolso manual (PROCESSING).
     mark-done       → la plata se devolvió; guarda payoutRef, cierra (DONE) y avisa.
     create-special  → abre un "caso especial" (monto lo fija el admin).
     retry-gateway   → reintenta el reembolso automático de Mercado Pago.
     pms-cancel      → reintenta la cancelación en Kunas o confirma la manual.
   The amount is decided by the admin SEGÚN LA POLÍTICA de la tarifa (sugerido por
   _refunds-store.policySuggestion) — nunca se aprueba solo. */
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;
  const reply = (statusCode, obj) => ({ statusCode, headers, body: JSON.stringify(obj) });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method Not Allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return reply(400, { error: 'JSON inválido' }); }

  const bookingCode = String(body.bookingCode || '').trim();
  const action = String(body.action || '').trim();
  const notes = String(body.notes || '').slice(0, 1000);
  const payoutRef = String(body.payoutRef || '').slice(0, 200);
  if (!bookingCode || !ACTION_PERMISSION[action]) {
    return reply(400, { error: 'Faltan bookingCode o action válido (approve|deny|set-amount|mark-processing|mark-done|create-special|retry-gateway|pms-cancel)' });
  }

  /* Autoriza según la acción: cada una exige su permiso atómico. */
  const auth = await authorize(event, permissionFor(action, body));
  if (!auth.ok) return reply(auth.statusCode, { error: auth.error });
  const actor = auth.email || 'admin';

  if (action === 'create-special') {
    try {
      const out = await createSpecial(body, actor);
      if (out.error) return reply(out.statusCode, { error: out.error });
      return reply(200, { ok: true, refund: viewOf(out.refund, auth) });
    } catch (e) {
      console.error('[refund-admin-action] create-special', e.message);
      return reply(500, { error: 'No se pudo crear el caso especial' });
    }
  }

  let refund;
  try { refund = await getRefund(bookingCode); }
  catch (e) { return reply(503, { error: 'Almacenamiento no disponible' }); }
  if (!refund) return reply(404, { error: 'Reembolso no encontrado' });

  /* pms-cancel también aplica a solicitudes cerradas (denegadas/reembolsadas):
     cerrar la reserva en Kunas es independiente del dinero. */
  if (action === 'pms-cancel') {
    try {
      const flow = require('./_refund-flow');
      if (refund.reservationCanceled) return reply(200, { ok: true, refund: viewOf(refund, auth), already: true });
      if (body.manual === true) {
        const res = await transitionStatus(bookingCode, null, actor, notes || `Reserva cancelada a mano en Kunas (confirmado por ${actor})`, {
          reservationCanceled: true,
          reservationCanceledAt: new Date().toISOString(),
          reservationCancelResult: { ok: true, manual: true, by: actor }
        });
        await resolvePmsCancelTasks(flow, bookingCode, actor);
        return reply(200, { ok: true, refund: viewOf(res.refund, auth) });
      }
      if (!(await flag('OTASYNC_AUTO_CANCEL_ENABLED'))) {
        return reply(400, { error: 'La cancelación automática en Kunas está apagada: cancélala a mano en Kunas y marca "Ya la cancelé en Kunas".' });
      }
      const result = await maybeCancelReservationInPms(refund, actor);
      if (!result) return reply(502, { error: 'Kunas no confirmó la cancelación. Se creó una alerta; intenta de nuevo o cancélala a mano.' });
      await resolvePmsCancelTasks(flow, bookingCode, actor);
      return reply(200, { ok: true, refund: viewOf(await getRefund(bookingCode), auth), reservationCancel: { ok: !!result.ok, status: result.status || null } });
    } catch (e) {
      console.error('[refund-admin-action] pms-cancel', e.message);
      return reply(500, { error: 'No se pudo cancelar la reserva' });
    }
  }

  /* Terminal states are closed — no further transitions. */
  if (refund.status === STATUS.DONE || refund.status === STATUS.DENIED) {
    return reply(409, { error: `El reembolso ya está cerrado (${refund.status}).` });
  }

  /* Approve/deny son la decisión inicial: solo sobre una solicitud por revisar
     (evita re-ejecutar reembolsos o correos sobre una ya aprobada). */
  if ((action === 'approve' || action === 'deny') && refund.status !== STATUS.NEEDS_REVIEW) {
    return reply(409, { error: 'Solo se puede aprobar o denegar una solicitud que está por revisar.' });
  }

  /* Amount guard: never approve more than what was paid. */
  let amountCents = refund.refundAmountCents == null ? refund.refundAmountCents : parseInt(refund.refundAmountCents, 10);
  /* Monto pagado original = TOPE del reembolso. Del registro o, si falta (reserva
     vieja / booking-results vencido / payment-details ausente), el que APORTE el
     admin en body.originalAmountCents (verificado por él desde Wompi/MP). Se
     persiste con auditoría para no bloquear el flujo por completo. */
  let knownOriginal = (refund.originalAmountCents && refund.originalAmountCents > 0) ? refund.originalAmountCents : 0;
  let backfilledOriginal = false;
  if (!knownOriginal && body.originalAmountCents != null) {
    const oc = parseInt(body.originalAmountCents, 10);
    if (Number.isFinite(oc) && oc > 0) { knownOriginal = oc; backfilledOriginal = true; }
  }
  if (body.amountCents !== undefined && body.amountCents !== null) {
    amountCents = parseInt(body.amountCents, 10);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return reply(400, { error: 'amountCents inválido' });
    }
    /* Sin tope conocido no se aprueba a ciegas (evita transferir de más), pero se
       ofrece la vía: enviar originalAmountCents para fijarlo. */
    if (!knownOriginal) {
      return reply(400, { error: 'No se conoce el monto pagado original; envíalo en originalAmountCents (verificado en Wompi/MP) para fijar el tope del reembolso.' });
    }
    if (amountCents > knownOriginal) {
      return reply(400, { error: 'El reembolso no puede superar el monto pagado' });
    }
  }
  const originalPatch = backfilledOriginal ? { originalAmountCents: knownOriginal, originalAmountSource: 'admin' } : {};

  const flow = require('./_refund-flow');
  try {
    if (action === 'deny') {
      const guestReason = sanitizeText(body.reason, 600);
      const res = await transitionStatus(bookingCode, STATUS.DENIED, actor, notes || 'Reembolso denegado', {
        deniedAt: new Date().toISOString(), deniedBy: actor, deniedReason: guestReason || notes || null
      }, { expectStatus: STATUS.NEEDS_REVIEW });
      if (!res.ok) return reply(409, { error: 'La solicitud cambió mientras la revisabas; recarga.' });
      let current = res.refund || refund;
      const pms = await closeReservationInPms(current, actor);
      if (pms.mode === 'auto') current = (await getRefund(bookingCode)) || current;
      const notice = await flow.notifyGuest('denied', current, { reason: guestReason });
      current = await recordNotice(bookingCode, current, notice);
      return reply(200, {
        ok: true, refund: viewOf(current, auth), guestNotice: notice, pms,
        reservationCancel: pms.mode === 'auto' ? { ok: !!pms.ok, status: pms.status || null } : null
      });
    }

    if (action === 'set-amount') {
      if (amountCents == null) return reply(400, { error: 'Falta amountCents' });
      const res = await transitionStatus(bookingCode, null, actor, `Monto de reembolso fijado: ${amountCents} centavos${backfilledOriginal ? ` · monto pagado ${knownOriginal} (ingresado)` : ''}`, { refundAmountCents: amountCents, ...originalPatch });
      return reply(200, { ok: true, refund: viewOf(res.refund, auth) });
    }

    /* mark-processing / mark-done solo después de una aprobación (nunca sobre una
       solicitud por revisar: cerraría sin decisión ni monto y avisaría al huésped). */
    const MARKABLE = [STATUS.APPROVED, STATUS.NEEDS_BANK_DETAILS, STATUS.BANK_DETAILS_READY, STATUS.PROCESSING, STATUS.PENDING_PROVIDER, STATUS.FAILED].filter(Boolean);
    if ((action === 'mark-processing' || action === 'mark-done') && !MARKABLE.includes(refund.status)) {
      return reply(409, { error: 'Primero hay que aprobar el reembolso.' });
    }

    if (action === 'mark-processing') {
      const res = await transitionStatus(bookingCode, STATUS.PROCESSING, actor,
        notes || `Reembolso en proceso (${actor})`,
        { processingAt: new Date().toISOString(), processingBy: actor }, { expectStatus: MARKABLE });
      if (!res.ok) return reply(409, { error: 'La solicitud cambió; recarga.' });
      return reply(200, { ok: true, refund: viewOf(res.refund, auth) });
    }

    if (action === 'mark-done') {
      const res = await transitionStatus(bookingCode, STATUS.DONE, actor,
        notes || `Reembolso completado por ${actor}${payoutRef ? ` · ref ${payoutRef}` : ''}`,
        { completedAt: new Date().toISOString(), completedBy: actor, payoutRef: payoutRef || null }, { expectStatus: MARKABLE });
      if (!res.ok) return reply(409, { error: 'La solicitud cambió; recarga.' });
      await maybeRestoreDiscount(bookingCode); /* A-14: devolver el cupón al pool */
      await flow.resolveTask(flow.TASK_KEYS.pay(bookingCode), actor);
      await flow.resolveTask(flow.TASK_KEYS.gatewayFail(bookingCode), actor);
      let current = res.refund || refund;
      let notice = null;
      if (current.refundAmountCents != null && !flow.alreadyNotified(current, 'done')) {
        notice = await flow.notifyGuest('done', current);
        current = await recordNotice(bookingCode, current, notice);
      }
      return reply(200, { ok: true, refund: viewOf(current, auth), guestNotice: notice });
    }

    if (action === 'retry-gateway') {
      if (refund.route !== ROUTE.GATEWAY_AUTO) return reply(400, { error: 'Solo los pagos de Mercado Pago se reembolsan automáticamente.' });
      if (!(refund.status === STATUS.FAILED || refund.status === STATUS.APPROVED)) return reply(409, { error: 'El reembolso no está pendiente de ejecutar.' });
      if (!(await flag('REFUND_GATEWAY_AUTO_ENABLED'))) return reply(400, { error: 'El auto-reembolso de Mercado Pago está apagado (Configuración). Hazlo desde el panel de Mercado Pago.' });
      if (!trustedTransaction(refund)) return reply(400, { error: 'El número de pago no viene de Mercado Pago (se ingresó a mano): haz la devolución desde el panel de Mercado Pago.' });
      const amt = parseInt(refund.refundAmountCents, 10);
      if (!Number.isFinite(amt) || amt <= 0) return reply(400, { error: 'El reembolso no tiene monto aprobado.' });
      const gateway = await executeGatewayRefund(refund, actor, amt);
      let current = (gateway && gateway.refund) || refund;
      let notice = null;
      if (current.status === STATUS.DONE || current.status === STATUS.PENDING_PROVIDER) {
        await flow.resolveTask(flow.TASK_KEYS.gatewayFail(bookingCode), actor);
        await flow.resolveTask(flow.TASK_KEYS.pay(bookingCode), actor);
      }
      if (current.status === STATUS.DONE && !flow.alreadyNotified(current, 'done')) {
        notice = await flow.notifyGuest('done', current);
        current = await recordNotice(bookingCode, current, notice);
      }
      return reply(200, { ok: true, refund: viewOf(current, auth), gateway: gateway ? gateway.summary : null, guestNotice: notice });
    }

    /* ── approve ─────────────────────────────────────────────────────────── */
    if (amountCents == null) {
      return reply(400, { error: 'Define el monto a reembolsar antes de aprobar' });
    }
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return reply(400, { error: 'amountCents inválido' });
    }
    if (!knownOriginal) {
      return reply(400, { error: 'No se conoce el monto pagado original; envíalo en originalAmountCents (verificado en Wompi/MP) para fijar el tope del reembolso.' });
    }
    if (amountCents > knownOriginal) {
      return reply(400, { error: 'El reembolso no puede superar el monto pagado' });
    }

    /* Datos del pago que completa el admin (solo huecos) + tipo de solicitud. */
    const fix = paymentFixPatch(refund, body.payment);
    const effective = { ...refund, ...fix };
    const kindPatch = {};
    if (body.kind === 'special' || body.kind === 'cancellation') {
      kindPatch.kind = body.kind;
      kindPatch.cancelReservation = body.kind === 'cancellation' ? true : body.cancelReservation === true;
    }
    const route = effective.route;
    const target = route === ROUTE.MANUAL_BANK ? STATUS.NEEDS_BANK_DETAILS : STATUS.APPROVED;
    const patch = {
      ...fix, ...kindPatch, ...originalPatch,
      refundAmountCents: amountCents, approvedAt: new Date().toISOString(), approvedBy: actor, approvalNotes: notes || null
    };

    /* A9: for manual transfers, mint a signed link so the guest can submit the
       account. Gated by REFUND_BANK_FORM_ENABLED. Best-effort. */
    let bankFormUrl = null;
    if (target === STATUS.NEEDS_BANK_DETAILS && (await flag('REFUND_BANK_FORM_ENABLED'))) {
      try {
        const { signBankDetailsToken } = require('./_refunds-store');
        const base = (process.env.GUEST_APP_BASE_URL || process.env.URL || '').replace(/\/$/, '');
        const token = signBankDetailsToken(bookingCode);
        bankFormUrl = `${base}/datos-cuenta.html?c=${encodeURIComponent(bookingCode)}&t=${encodeURIComponent(token)}`;
        patch.bankFormUrl = bankFormUrl;
      } catch (e) {
        console.error('[refund-admin-action] bank link sign failed (non-fatal):', e.message);
      }
    }

    const res = await transitionStatus(bookingCode, target, actor,
      notes || `Aprobado por ${actor} (${route})`, patch, { expectStatus: STATUS.NEEDS_REVIEW });
    if (!res.ok) return reply(409, { error: 'La solicitud ya fue aprobada o cambió mientras la revisabas; recarga.' });
    let current = res.refund || { ...refund, ...patch, status: target };

    /* (b) La plata. Mercado Pago: automático con REFUND_GATEWAY_AUTO_ENABLED y un
       número de pago confiable; si no, tarea. Wompi: sin API → tarea con
       instrucciones (dashboard el mismo día o soporte). Transferencia: tarea
       ahora si no hay formulario; con formulario, cuando el huésped envía la cuenta. */
    let gateway = null;
    let payTask = null;
    if (route === ROUTE.GATEWAY_AUTO) {
      const autoOn = await flag('REFUND_GATEWAY_AUTO_ENABLED');
      if (autoOn && trustedTransaction(current) && !(current.refundExecution && current.refundExecution.ok)) {
        try {
          gateway = await executeGatewayRefund(current, actor, amountCents);
          if (gateway && gateway.refund) current = gateway.refund;
        } catch (e) {
          console.error('[refund-admin-action] gateway refund error (non-fatal):', e.message);
        }
      } else {
        const why = !autoOn ? 'auto_refund_off' : (!current.transactionId ? 'missing_transaction_id' : 'transaction_id_entered_by_admin');
        payTask = await flow.enqueueTask(flow.payTask(current, amountCents, why));
      }
    } else if (route === ROUTE.GATEWAY_ASSISTED) {
      payTask = await flow.enqueueTask(flow.payTask(current, amountCents, 'wompi_no_api'));
    } else if (!bankFormUrl) {
      payTask = await flow.enqueueTask(flow.payTask(current, amountCents, 'ask_bank_details'));
    }

    /* (a) Kunas: cancelar la reserva (auto con el flag; si no, tarea). */
    const pms = await closeReservationInPms(current, actor);
    if (pms.mode === 'auto') current = (await getRefund(bookingCode)) || current;

    /* (c) Aviso al huésped: si Mercado Pago ya lo dejó hecho, un solo correo de
       "realizado"; si no, "aprobado" (con el enlace de la cuenta si aplica). */
    const noticeType = current.status === STATUS.DONE ? 'done' : 'approved';
    const notice = await flow.notifyGuest(noticeType, current, { formUrl: bankFormUrl, slaDays: require('./_refunds-store').REFUND_SLA_BUSINESS_DAYS });
    current = await recordNotice(bookingCode, current, notice);

    return reply(200, {
      ok: true,
      refund: viewOf(current, auth),
      bankFormUrl,
      gateway: gateway ? gateway.summary : null,
      payTask: payTask ? { queued: !!payTask.queued } : null,
      pms,
      guestNotice: notice,
      reservationCancel: pms.mode === 'auto' ? { ok: !!pms.ok, status: pms.status || null } : null
    });
  } catch (e) {
    console.error('[refund-admin-action]', e.message);
    return reply(500, { error: 'No se pudo actualizar el reembolso' });
  }
};

exports._test = { maybeCancelReservationInPms, closeReservationInPms, paymentFixPatch, trustedTransaction, permissionFor, executeGatewayRefund, recordNotice, resolvePmsCancelTasks };
