require('./_env');
const { authenticateAdmin } = require('./_firebase-auth');
const { getRefund, transitionStatus, STATUS, ROUTE } = require('./_refunds-store');

/* Admin-only refund actions (the human GATE). Fase 1 moves NO money: it only
   advances state. `approve` routes a record to APPROVED (gateway refunds, to be
   executed later behind a second gate / dry-run) or to NEEDS_BANK_DETAILS
   (manual transfers, which then collect the guest's bank info via the form).
   `deny` closes it. `set-amount` records a (possibly partial) refund amount. */
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
  if (!bookingCode || !['approve', 'deny', 'set-amount'].includes(action)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Faltan bookingCode o action válido (approve|deny|set-amount)' }) };
  }

  let refund;
  try { refund = await getRefund(bookingCode); }
  catch (e) { return { statusCode: 503, headers, body: JSON.stringify({ error: 'Almacenamiento no disponible' }) }; }
  if (!refund) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Reembolso no encontrado' }) };

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

    /* approve */
    if (amountCents == null) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Define el monto a reembolsar antes de aprobar' }) };
    }
    /* Manual transfers still need the guest's bank details (collected by the
       form in Fase 2); gateway refunds go straight to APPROVED for later
       execution behind the dry-run/second gate. No money moves here. */
    const target = refund.route === ROUTE.MANUAL_BANK ? STATUS.NEEDS_BANK_DETAILS : STATUS.APPROVED;
    const res = await transitionStatus(bookingCode, target, actor,
      notes || `Aprobado por ${actor} (${refund.route})`,
      { refundAmountCents: amountCents, approvedAt: new Date().toISOString(), approvedBy: actor, approvalNotes: notes || null });
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, refund: res.refund }) };
  } catch (e) {
    console.error('[refund-admin-action]', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'No se pudo actualizar el reembolso' }) };
  }
};
