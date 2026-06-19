require('./_env');
const { authenticateAdmin } = require('./_firebase-auth');
const { getRefund, transitionStatus, STATUS, ROUTE } = require('./_refunds-store');

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
   The amount is decided by the admin SEGÚN LA POLÍTICA de la tarifa (Flexible
   48 h / Best Price no reembolsable) — never auto-computed. */
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

  const auth = await authenticateAdmin(event);
  if (!auth.ok) return { statusCode: auth.statusCode, headers, body: JSON.stringify({ error: auth.error }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON inválido' }) }; }

  const bookingCode = String(body.bookingCode || '').trim();
  const action = String(body.action || '').trim();
  const notes = String(body.notes || '').slice(0, 1000);
  const payoutRef = String(body.payoutRef || '').slice(0, 200);
  if (!bookingCode || !['approve', 'deny', 'set-amount', 'mark-processing', 'mark-done'].includes(action)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Faltan bookingCode o action válido (approve|deny|set-amount|mark-processing|mark-done)' }) };
  }

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
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, refund: res.refund }) };
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
    if (target === STATUS.NEEDS_BANK_DETAILS && process.env.REFUND_BANK_FORM_ENABLED === 'true') {
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
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, refund: res.refund, bankFormUrl }) };
  } catch (e) {
    console.error('[refund-admin-action]', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'No se pudo actualizar el reembolso' }) };
  }
};
