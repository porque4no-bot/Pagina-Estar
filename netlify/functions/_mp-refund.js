/* Mercado Pago refund executor — Mercado Pago is the ONLY payment provider on
 * this account with a refund API (Wompi card refunds are filed by support
 * ticket; PSE/Nequi/bank are manual transfers). This runs ONLY after an admin
 * approves a GATEWAY_AUTO refund in the panel (the human gate), and only when
 * REFUND_GATEWAY_AUTO_ENABLED is set — so no money moves until the owner flips
 * the switch at launch. `fetchImpl` is injectable for tests; the function never
 * throws: it returns a structured result the caller turns into a status
 * transition + audit entry.
 *
 * MP API: POST /v1/payments/{payment_id}/refunds
 *   - body { amount } in MAJOR units (pesos) for a partial refund
 *   - no body  → full refund
 *   - X-Idempotency-Key makes a retry safe (MP won't refund twice).
 */

const MP_API = 'https://api.mercadopago.com';

async function refundMercadoPago({
  paymentId, amountCents, originalAmountCents,
  idempotencyKey, accessToken, fetchImpl, timeoutMs
}) {
  const token = accessToken || process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) return { ok: false, error: 'missing_access_token' };
  if (!paymentId) return { ok: false, error: 'missing_payment_id' };

  const cents = parseInt(amountCents, 10);
  if (!Number.isFinite(cents) || cents <= 0) return { ok: false, error: 'invalid_amount' };

  const doFetch = fetchImpl || fetch;
  /* Full refund when the approved amount matches what was paid → omit the body
     so MP refunds the whole payment; otherwise send a partial amount in pesos. */
  const isFull = originalAmountCents != null && cents >= parseInt(originalAmountCents, 10);
  const body = isFull ? undefined : JSON.stringify({ amount: Math.round(cents) / 100 });

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs || 15000);
  try {
    const res = await doFetch(`${MP_API}/v1/payments/${encodeURIComponent(paymentId)}/refunds`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': String(idempotencyKey || `refund-${paymentId}-${cents}`)
      },
      ...(body ? { body } : {}),
      signal: ctrl.signal
    });
    clearTimeout(tid);

    let data = null;
    try { data = await res.json(); } catch (_) { /* non-JSON error body */ }

    if (!res.ok) {
      const detail = (data && (data.message || data.error)) || `HTTP ${res.status}`;
      return { ok: false, error: `mp_error_${res.status}`, detail, status: res.status, raw: data };
    }

    const status = data && data.status; // 'approved' | 'in_process' | 'rejected'
    return {
      ok: status !== 'rejected',
      refundId: data && data.id != null ? String(data.id) : null,
      status: status || 'unknown',
      amount: data && data.amount != null ? data.amount : null,
      raw: data
    };
  } catch (err) {
    clearTimeout(tid);
    return { ok: false, error: err.name === 'AbortError' ? 'timeout' : (err.message || 'fetch_failed') };
  }
}

module.exports = { refundMercadoPago, MP_API };
