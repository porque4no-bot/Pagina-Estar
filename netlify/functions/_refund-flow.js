/* Frente cancel — piezas compartidas del flujo de cancelación + reembolso.
 *
 * "Aprobar" en /admin → Reembolsos hace TODO lo que toca, y lo que no puede
 * hacer solo lo deja como TAREA en la cola operativa (_ops-queue, pestaña Hoy):
 *   - cancelar la reserva en Kunas (auto con OTASYNC_AUTO_CANCEL_ENABLED; si no,
 *     tarea "Cancelar en Kunas la reserva X");
 *   - devolver la plata: Mercado Pago automático con REFUND_GATEWAY_AUTO_ENABLED;
 *     si no (o Wompi, que no tiene API de reembolso, o transferencia) → tarea con
 *     las instrucciones exactas;
 *   - avisar al huésped por correo (aprobado / denegado / realizado, ES/EN).
 *
 * Este módulo solo arma las tareas y envía los correos. Nunca lanza: todo es
 * best-effort (una tarea o un correo que falle no puede tumbar la decisión del
 * admin, que ya quedó registrada con auditoría).
 */

const TASK_KEYS = {
  pmsCancel: (code) => `refund-pms-cancel-${code}`,
  pay: (code) => `refund-pay-${code}`,
  gatewayFail: (code) => `refund-fail-${code}`
};

function copFromCents(cents) {
  return '$ ' + Math.round((Number(cents) || 0) / 100).toLocaleString('es-CO');
}

/* Instrucciones paso a paso por medio de pago (se muestran en la tarea y en el
   panel). Wompi: su API pública NO permite reembolsar; la anulación en línea
   solo existe desde su dashboard y el MISMO día (respuesta del ejecutivo de
   Wompi, 2026-06-19, docs/mensajes-terceros.md §2). */
const ROUTE_INSTRUCTIONS = {
  GATEWAY_AUTO: 'Mercado Pago → Tu negocio → Ventas / Actividad → busca el pago por su número → "Devolver dinero" (parcial si el monto es menor). Luego marca "Reembolsado" en /admin → Reembolsos con el número de la devolución.',
  GATEWAY_ASSISTED: 'Wompi no permite reembolsar por API. Si el pago es de HOY: dashboard de Wompi → Transacciones → abre la transacción → "Anular transacción". Si ya pasó el día: abre un ticket en soporte de Wompi con el código de autorización, la fecha, los últimos 4 dígitos y el valor (están en el detalle del reembolso). Luego marca "Reembolsado".',
  MANUAL_BANK: 'Transferencia bancaria: cuando el huésped envíe su cuenta (o pídesela por WhatsApp/correo), haz la transferencia desde la cuenta del hotel y marca "Reembolsado" con el número del comprobante.'
};

/* Tarea para devolver la plata a mano. reason explica por qué no fue automático. */
function payTask(refund, amountCents, reason) {
  const r = refund || {};
  const code = String(r.bookingCode || '');
  const amount = copFromCents(amountCents != null ? amountCents : r.refundAmountCents);
  const base = { bookingCode: code, amountCents: amountCents != null ? amountCents : r.refundAmountCents, route: r.route, reason: reason || null };
  if (r.route === 'GATEWAY_AUTO') {
    return {
      kind: 'refund_mercadopago', severity: 'warn', dedupeKey: TASK_KEYS.pay(code),
      title: `Reembolsar ${amount} en Mercado Pago — reserva ${code}${r.transactionId ? ` (pago ${r.transactionId})` : ''}`,
      context: { ...base, transactionId: r.transactionId || null, instructions: ROUTE_INSTRUCTIONS.GATEWAY_AUTO }
    };
  }
  if (r.route === 'GATEWAY_ASSISTED') {
    return {
      kind: 'refund_wompi', severity: 'warn', dedupeKey: TASK_KEYS.pay(code),
      title: `Reembolsar ${amount} por Wompi (dashboard o soporte) — reserva ${code}`,
      context: {
        ...base, transactionId: r.transactionId || null, authCode: r.authCode || null,
        cardLast4: r.cardLast4 || null, paymentDate: r.paymentDate || null,
        instructions: ROUTE_INSTRUCTIONS.GATEWAY_ASSISTED
      }
    };
  }
  return {
    kind: 'refund_transfer', severity: 'warn', dedupeKey: TASK_KEYS.pay(code),
    title: `Transferir ${amount} al huésped — reserva ${code}${reason === 'bank_details_ready' ? ' (ya envió su cuenta)' : ''}`,
    context: { ...base, instructions: ROUTE_INSTRUCTIONS.MANUAL_BANK }
  };
}

function pmsCancelTask(refund) {
  const r = refund || {};
  const code = String(r.bookingCode || '');
  return {
    kind: 'refund_cancel_pms', severity: 'warn', dedupeKey: TASK_KEYS.pmsCancel(code),
    title: `Cancelar en Kunas la reserva ${code}${r.guestName ? ` (${r.guestName})` : ''}`,
    context: {
      bookingCode: code, checkIn: r.checkIn || null, checkOut: r.checkOut || null,
      instructions: 'La cancelación automática en Kunas está apagada. Cancela la reserva a mano en Kunas para liberar el inventario y luego marca "Ya la cancelé en Kunas" en /admin → Reembolsos.'
    }
  };
}

async function enqueueTask(task, deps = {}) {
  try {
    const q = deps.opsQueue || require('./_ops-queue');
    return await q.enqueue(task);
  } catch (e) {
    return { queued: false, reason: 'error' };
  }
}

async function resolveTask(id, by, deps = {}) {
  try {
    const q = deps.opsQueue || require('./_ops-queue');
    return await q.resolve(id, by);
  } catch (e) {
    return { ok: false, reason: 'error' };
  }
}

/* Asunto del correo al huésped, ES/EN. */
function noticeSubject(type, refund, lang) {
  const r = refund || {};
  const code = r.bookingCode || '';
  const en = lang === 'en';
  if (type === 'approved') return en ? `Refund approved — ${code}` : `Reembolso aprobado — ${code}`;
  if (type === 'done') return en ? `Refund sent — ${code}` : `Reembolso realizado — ${code}`;
  if (r.kind === 'special') return en ? `Your refund request — ${code}` : `Tu solicitud de reembolso — ${code}`;
  return en ? `Your cancellation is registered — ${code}` : `Tu cancelación quedó registrada — ${code}`;
}

/* Arma { subject, html } del aviso al huésped. Puro salvo por _email (plantillas). */
function buildGuestNotice(type, refund, opts = {}) {
  const email = require('./_email');
  const r = refund || {};
  const lang = (opts.lang || r.lang) === 'en' ? 'en' : 'es';
  let html;
  if (type === 'approved') {
    html = email.refundApprovedHtml({ refund: r, lang, formUrl: opts.formUrl || null, slaDays: opts.slaDays });
  } else if (type === 'denied') {
    html = email.refundDeniedHtml({ refund: r, lang, reason: opts.reason || '' });
  } else if (type === 'done') {
    html = email.refundDoneHtml({ refund: r, lang });
  } else {
    throw new Error(`unknown notice type ${type}`);
  }
  return { subject: noticeSubject(type, r, lang), html, lang };
}

/* Envía el aviso. Devuelve el registro a guardar en refund.guestNotices.
   Sin correo del huésped (p. ej. reserva de OTA) no envía nada. Nunca lanza. */
async function notifyGuest(type, refund, opts = {}) {
  const r = refund || {};
  const at = new Date().toISOString();
  if (!r.guestEmail) return { type, at, sent: false, reason: 'no_email' };
  try {
    const { subject, html } = buildGuestNotice(type, r, opts);
    const { sendEmail } = require('./_email');
    const res = await sendEmail({ to: r.guestEmail, subject, html });
    return { type, at, sent: !!(res && res.sent), reason: res && res.sent ? null : ((res && res.reason) || 'send_failed') };
  } catch (e) {
    console.error('[refund-flow] guest notice failed (non-fatal):', e.message);
    return { type, at, sent: false, reason: 'error' };
  }
}

function alreadyNotified(refund, type) {
  const list = (refund && Array.isArray(refund.guestNotices)) ? refund.guestNotices : [];
  return list.some(n => n && n.type === type && n.sent);
}

module.exports = {
  TASK_KEYS, ROUTE_INSTRUCTIONS,
  payTask, pmsCancelTask, enqueueTask, resolveTask,
  noticeSubject, buildGuestNotice, notifyGuest, alreadyNotified, copFromCents
};
