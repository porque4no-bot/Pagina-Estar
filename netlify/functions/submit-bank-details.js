/* A9 — public endpoint where a guest submits the bank account for a manual
 * refund, reached via a signed link emailed on approval. Gated by
 * REFUND_BANK_FORM_ENABLED (404 when off). Anti-enumeration: an invalid/expired
 * token, a code mismatch, or a refund not awaiting bank details all return the
 * SAME uniform negative response, so the endpoint never confirms a code exists.
 */

require('./_env');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limit');
const { verifyBankDetailsToken, sanitizeBankDetails, saveBankDetails, getRefund } = require('./_refunds-store');

function cors() {
  const h = {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  if (process.env.ALLOWED_ORIGIN) h['Access-Control-Allow-Origin'] = process.env.ALLOWED_ORIGIN;
  return h;
}

/* Same shape for every "can't accept" case so a code is never confirmed. */
const UNIFORM = { ok: false, error: 'invalid_or_expired' };

exports.handler = async (event) => {
  const headers = cors();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  if (process.env.REFUND_BANK_FORM_ENABLED !== 'true') return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) };

  const rl = await checkRateLimit(event, { name: 'submit-bank-details', limit: 10, windowMs: 10 * 60 * 1000 });
  if (!rl.ok) return rateLimitResponse(headers, rl.retryAfter);

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'bad_json' }) }; }

  const code = String(body.code || '').trim();
  const payload = verifyBankDetailsToken(body.token);
  if (!payload || payload.sub !== code || !code) {
    return { statusCode: 200, headers, body: JSON.stringify(UNIFORM) };
  }

  /* Only a MANUAL_BANK refund currently awaiting details can be filled. Any
     other state maps to the uniform response (no code disclosure). */
  let refund;
  try { refund = await getRefund(code); } catch (e) { return { statusCode: 503, headers, body: JSON.stringify({ ok: false, error: 'unavailable' }) }; }
  if (!refund) return { statusCode: 200, headers, body: JSON.stringify(UNIFORM) };

  const { valid, details } = sanitizeBankDetails(body);
  if (!valid) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'invalid_fields' }) };

  let result;
  try { result = await saveBankDetails(code, details, 'guest'); }
  catch (e) { console.error('[submit-bank-details]', e.message); return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: 'server_error' }) }; }

  if (!result.ok) {
    if (result.reason === 'already') return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: 'already' }) };
    return { statusCode: 200, headers, body: JSON.stringify(UNIFORM) };
  }

  /* Notify treasury (best-effort; never blocks the guest's confirmation). */
  try {
    const { sendEmail, adminEmail, treasuryBankDetailsHtml } = require('./_email');
    await sendEmail({
      to: adminEmail(),
      subject: `Datos bancarios para reembolso — ${code}`,
      html: treasuryBankDetailsHtml({ refund: result.refund })
    });
  } catch (e) { console.error('[submit-bank-details] treasury email failed (non-fatal):', e.message); }

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
};
