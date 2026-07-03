require('./_env');
const { authorize } = require('./_authz');
const { getRefund, transitionStatus, STATUS, ROUTE } = require('./_refunds-store');
const { flag } = require('./_settings');

/* Cada acción exige su propio permiso atómico (mapa de _permissions.js):
   approve → refunds.approve · deny → refunds.deny · set-amount → refunds.set_amount
   mark-processing / mark-done → refunds.mark_done. */
const ACTION_PERMISSION = {
  'approve': 'refunds.approve',
  'deny': 'refunds.deny',
  'set-amount': 'refunds.set_amount',
  'mark-processing': 'refunds.mark_done',
  'mark-done': 'refunds.mark_done'
};

/* Auto-execute a GATEWAY_AUTO refund (Mercado Pago — the only provider with a
   refund API). Runs only after an admin approved the amount, and only when
   REFUND_GATEWAY_AUTO_ENABLED is set, so no money moves until the owner enables
   it. Never throws: returns { summary, refund } or null. Wompi card refunds
   have no API → those stay APPROVED and the team files the pre-filled support
   ticket from the panel. */
async function executeGatewayRefund(refund, actor, amountCents) {
  const { refundMercadoPago } = require('./_mp-refund');
  if (!refund || !refund.transactionId) {
    return { summary: { ok: false, error: 'missing_transaction_id' }, refund };
  }
  const result = await refundMercadoPago({
    paymentId: refund.transactionId,
    amountCents,
    originalAmountCents: refund.originalAmountCents,
    idempotencyKey: `${refund.refundId || refund.bookingCode}-${amountCents}`
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
  const res = await transitionStatus(refund.bookingCode, STATUS.FAILED, 'system',
    `Fallo al reembolsar en Mercado Pago: ${execRecord.error}`, { refundExecution: execRecord });
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

/* Sprint 1 (Mesa Redonda C3 — cerrar el lazo de cancelación). Hasta ahora una
   cancelación se aprobaba/denegaba en el panel pero la reserva seguía CONFIRMED
   en OTASync ocupando inventario hasta que alguien la borrara a mano (riesgo de
   re-venta perdida / overbooking). Al tomar la decisión TERMINAL (approve o deny:
   en ambos casos el huésped ya no llega), cancelamos la reserva en OTASync
   (soft-cancel: status→canceled, preserva el registro).
   - Gated OFF por defecto (OTASYNC_AUTO_CANCEL_ENABLED) → hoy no cambia nada; se
     enciende tras validar contra una reserva real.
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
    await transitionStatus(refund.bookingCode, refund.status, 'system',
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
        message: `No se pudo cancelar la reserva ${refund.bookingCode} en OTASync al ${'procesar el reembolso'}: ${e.message}`,
        context: { bookingCode: refund.bookingCode, by: actor },
        dedupeKey: `otasync-cancel-${refund.bookingCode}`
      });
    } catch (_) { /* alerta best-effort */ }
    return null;
  }
}

/* Admin-only refund actions (the human GATE). Moves NO money automatically —
   today every refund is processed by hand (Wompi y Mercado Pago no permiten
   reembolso automático en esta cuenta), so this endpoint only advances state and
   records who did what (append-only audit), within the 15-business-day SLA.
   Actions:
     approve         → sets the amount and routes to NEEDS_BANK_DETAILS (manual
                       transfer; bank form is Fase 2) or APPROVED (gateway refund
                       done manually in the provider panel / support ticket).
     deny            → closes the request (DENIED).
     set-amount      → records a (possibly partial) refund amount per the policy.
     mark-processing → the team started the manual refund (PROCESSING).
     mark-done       → the refund was paid; records payoutRef and closes it (DONE).
   The amount is decided by the admin SEGÚN LA POLÍTICA de la tarifa (Estricta
   100% hasta 7 días / Flexible 100% hasta 24 h) — never auto-computed. */
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON inválido' }) }; }

  const bookingCode = String(body.bookingCode || '').trim();
  const action = String(body.action || '').trim();
  const notes = String(body.notes || '').slice(0, 1000);
  const payoutRef = String(body.payoutRef || '').slice(0, 200);
  if (!bookingCode || !ACTION_PERMISSION[action]) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Faltan bookingCode o action válido (approve|deny|set-amount|mark-processing|mark-done)' }) };
  }

  /* Autoriza según la acción: cada una exige su permiso atómico. */
  const auth = await authorize(event, ACTION_PERMISSION[action]);
  if (!auth.ok) return { statusCode: auth.statusCode, headers, body: JSON.stringify({ error: auth.error }) };

  let refund;
  try { refund = await getRefund(bookingCode); }
  catch (e) { return { statusCode: 503, headers, body: JSON.stringify({ error: 'Almacenamiento no disponible' }) }; }
  if (!refund) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Reembolso no encontrado' }) };

  /* Terminal states are closed — no further transitions. */
  if (refund.status === STATUS.DONE || refund.status === STATUS.DENIED) {
    return { statusCode: 409, headers, body: JSON.stringify({ error: `El reembolso ya está cerrado (${refund.status}).` }) };
  }

  /* Amount guard: never approve more than what was paid. */
  let amountCents = refund.refundAmountCents;
  if (body.amountCents !== undefined && body.amountCents !== null) {
    amountCents = parseInt(body.amountCents, 10);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'amountCents inválido' }) };
    }
    if (refund.originalAmountCents && amountCents > refund.originalAmountCents) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'El reembolso no puede superar el monto pagado' }) };
    }
  }

  const actor = auth.email || 'admin';
  try {
    if (action === 'deny') {
      const res = await transitionStatus(bookingCode, STATUS.DENIED, actor, notes || 'Reembolso denegado', { deniedAt: new Date().toISOString(), deniedBy: actor, deniedReason: notes || null });
      const cancel = await maybeCancelReservationInPms(res.refund || refund, actor);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, refund: res.refund, reservationCancel: cancel ? { ok: !!cancel.ok, status: cancel.status || null } : null }) };
    }

    if (action === 'set-amount') {
      if (amountCents == null) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Falta amountCents' }) };
      const res = await transitionStatus(bookingCode, refund.status, actor, `Monto de reembolso fijado: ${amountCents} centavos`, { refundAmountCents: amountCents });
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, refund: res.refund }) };
    }

    if (action === 'mark-processing') {
      const res = await transitionStatus(bookingCode, STATUS.PROCESSING, actor,
        notes || `Reembolso en proceso (${actor})`,
        { processingAt: new Date().toISOString(), processingBy: actor });
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, refund: res.refund }) };
    }

    if (action === 'mark-done') {
      const res = await transitionStatus(bookingCode, STATUS.DONE, actor,
        notes || `Reembolso completado por ${actor}${payoutRef ? ` · ref ${payoutRef}` : ''}`,
        { completedAt: new Date().toISOString(), completedBy: actor, payoutRef: payoutRef || null });
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, refund: res.refund }) };
    }

    /* approve */
    if (amountCents == null) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Define el monto a reembolsar antes de aprobar' }) };
    }
    /* Manual transfers still need the guest's bank details (collected by the
       form in Fase 2); gateway refunds go straight to APPROVED for later
       execution behind the dry-run/second gate. No money moves here. */
    const target = refund.route === ROUTE.MANUAL_BANK ? STATUS.NEEDS_BANK_DETAILS : STATUS.APPROVED;
    const patch = { refundAmountCents: amountCents, approvedAt: new Date().toISOString(), approvedBy: actor, approvalNotes: notes || null };

    /* A9: for manual transfers, mint a signed link so the guest can submit the
       account. Gated by REFUND_BANK_FORM_ENABLED. Best-effort (a sign/email
       failure never blocks the approval). */
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
      notes || `Aprobado por ${actor} (${refund.route})`, patch);

    /* Auto-execute Mercado Pago refunds right after approval (off by default;
       enable with REFUND_GATEWAY_AUTO_ENABLED at launch). Wompi has no refund
       API → GATEWAY_ASSISTED stays APPROVED for the manual support ticket. */
    let gateway = null;
    if (target === STATUS.APPROVED
        && refund.route === ROUTE.GATEWAY_AUTO
        && (await flag('REFUND_GATEWAY_AUTO_ENABLED'))
        && !(refund.refundExecution && refund.refundExecution.ok)) {
      try {
        gateway = await executeGatewayRefund(res.refund || refund, actor, amountCents);
      } catch (e) {
        console.error('[refund-admin-action] gateway refund error (non-fatal):', e.message);
      }
    }

    if (bankFormUrl && refund.guestEmail) {
      try {
        const { sendEmail, bankDetailsRequestHtml } = require('./_email');
        const { REFUND_SLA_BUSINESS_DAYS } = require('./_refunds-store');
        const lang = (res.refund && res.refund.lang) === 'en' ? 'en' : 'es';
        const subject = lang === 'en'
          ? `Refund ${bookingCode} — tell us your bank account`
          : `Reembolso ${bookingCode} — indícanos tu cuenta bancaria`;
        await sendEmail({
          to: refund.guestEmail,
          subject,
          html: bankDetailsRequestHtml({ refund: res.refund, formUrl: bankFormUrl, slaDays: REFUND_SLA_BUSINESS_DAYS, lang })
        });
      } catch (e) {
        console.error('[refund-admin-action] bank form email failed (non-fatal):', e.message);
      }
    }
    /* C3: cerrar el lazo de cancelación tras la aprobación (gated/idempotente). */
    const cancel = await maybeCancelReservationInPms((gateway && gateway.refund) || res.refund, actor);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, refund: (gateway && gateway.refund) || res.refund, bankFormUrl, gateway: gateway ? gateway.summary : null, reservationCancel: cancel ? { ok: !!cancel.ok, status: cancel.status || null } : null }) };
  } catch (e) {
    console.error('[refund-admin-action]', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'No se pudo actualizar el reembolso' }) };
  }
};

exports._test = { maybeCancelReservationInPms };
