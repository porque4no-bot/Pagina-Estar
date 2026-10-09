/* Centralised operational alerting (A3 — observabilidad).
 *
 * Hoy el único cubrimiento real de fallas en producción es reconcile-payments
 * (pagos) y correos admin dispersos. Las caídas de OTASync, los fallos de envío
 * de correo y los errores de webhook/guest-checkin no avisan a nadie.
 *
 * `reportAlert()` (1) loguea estructurado a stdout (queda en los logs de Netlify
 * / drains) y (2) manda UN correo al equipo, deduplicado y rate-limited por
 * fingerprint en Netlify Blobs. Es 100% best-effort: NUNCA lanza, así que se
 * puede llamar desde cualquier handler sin riesgo de tumbar el flujo principal.
 *
 * Cero dependencias nuevas (reúsa _email.sendEmail, ya no-op sin RESEND_API_KEY)
 * y cero env obligatorio. Kill-switch: ALERT_ENABLED='false'.
 */

const crypto = require('crypto');

const DEFAULT_TTL_SEC = 3600; /* 1 alerta por fingerprint por hora */

function stableHash(str) {
  return crypto.createHash('sha256').update(String(str)).digest('hex').slice(0, 16);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function severityMark(severity) {
  if (severity === 'critical') return '🔴';
  if (severity === 'warn') return '🟡';
  return '🟠';
}

function alertHtml({ kind, severity, message, context, at }) {
  const rows = Object.keys(context || {}).map(k =>
    `<li><strong>${esc(k)}:</strong> ${esc(typeof context[k] === 'object' ? JSON.stringify(context[k]) : context[k])}</li>`
  ).join('');
  return `<!DOCTYPE html><html lang="es"><body style="font-family:Arial,sans-serif;color:#2C2C2C;">
    <h2 style="margin:0 0 8px;">${severityMark(severity)} Alerta de sistema — ${esc(kind)}</h2>
    <p style="margin:0 0 4px;font-size:13px;color:#555;">Severidad: <strong>${esc(severity)}</strong> · ${esc(at)}</p>
    <p style="font-size:14px;">${esc(message)}</p>
    ${rows ? `<ul style="font-size:13px;color:#444;">${rows}</ul>` : ''}
    <p style="font-size:11px;color:#9A9A8A;">Estar · alerta automática. Revisa los logs de la función en Netlify para el detalle completo.</p>
  </body></html>`;
}

function dedupStore(getStore) {
  try { return getStore({ name: 'alert-dedup', consistency: 'strong' }); }
  catch (e) { return null; }
}

/* Returns true if this fingerprint was SUCCESSFULLY alerted within ttlMs (so we
   should NOT send again). READ-ONLY: nothing is marked here. The mark is written
   only after the email actually went out (markAlerted) — before, the key was
   claimed BEFORE sending, so a failed send (Resend down, no key) silenced the
   same alert for the whole TTL. Fail-OPEN: any Blobs error returns false
   (prefer a duplicate alert over a missed one). */
async function recentlyAlerted(getStore, key, ttlMs, now) {
  const store = dedupStore(getStore);
  if (!store) return false; /* no Blobs — don't suppress */
  try {
    const cur = await store.getWithMetadata(key, { type: 'json' });
    const at = (cur && cur.data && cur.data.at) || 0;
    return Boolean(at) && now - at <= ttlMs;
  } catch (e) {
    return false;
  }
}

/* Marks the fingerprint as alerted at `now` (helper/compat; reportAlert usa
   claimAlert, que reclama atómicamente y libera si el envío falla). Best-effort: a Blobs failure just means the next alert isn't deduped. */
async function markAlerted(getStore, key, now) {
  const store = dedupStore(getStore);
  if (!store) return false;
  try {
    await store.set(key, JSON.stringify({ at: now }));
    return true;
  } catch (e) {
    return false;
  }
}

/* Reclamo ATÓMICO del fingerprint ANTES de enviar (set onlyIfNew, o re-armado
   con onlyIfMatch/etag si el sello anterior ya venció). Así dos invocaciones
   concurrentes con el mismo fingerprint no envían las dos (ráfagas de webhooks).
   Devuelve { claimed, release }: si el envío falla, release() libera la clave
   (sello at:0) para que el siguiente intento sí avise — se conserva el arreglo de
   "no silenciar una alerta que no salió". Fail-OPEN: un error de Blobs => claimed
   true con release no-op (preferimos un duplicado a una alerta perdida). */
async function claimAlert(getStore, key, ttlMs, now) {
  const noop = async () => {};
  const store = dedupStore(getStore);
  if (!store) return { claimed: true, release: noop };
  const value = JSON.stringify({ at: now });
  const release = async () => {
    try {
      const cur = await store.getWithMetadata(key, { type: 'json' });
      /* Solo liberamos NUESTRO sello (otro proceso pudo re-armar después). */
      if (!cur || !cur.data || cur.data.at !== now) return;
      const opts = cur.etag ? { onlyIfMatch: cur.etag } : {};
      await store.set(key, JSON.stringify({ at: 0 }), opts);
    } catch (e) { /* best-effort */ }
  };
  try {
    const created = await store.set(key, value, { onlyIfNew: true });
    if (!created || created.modified !== false) return { claimed: true, release };
  } catch (e) {
    return { claimed: true, release: noop };
  }
  /* La clave existe: suprimir si el sello es reciente; si venció (o fue liberado
     con at:0), re-armar de forma condicional para ganar el reclamo. */
  try {
    const cur = await store.getWithMetadata(key, { type: 'json' });
    const at = (cur && cur.data && cur.data.at) || 0;
    if (at && now - at <= ttlMs) return { claimed: false, release: noop };
    const opts = cur && cur.etag ? { onlyIfMatch: cur.etag } : { onlyIfNew: true };
    const rearmed = await store.set(key, value, opts);
    if (!rearmed || rearmed.modified !== false) return { claimed: true, release };
    return { claimed: false, release: noop }; /* otro proceso ganó el re-armado */
  } catch (e) {
    return { claimed: true, release: noop };
  }
}

/* Compat (tests/consumidores antiguos): "¿debo enviar?" = no alertado hace poco. */
async function shouldSend(getStore, key, ttlMs, now) {
  return !(await recentlyAlerted(getStore, key, ttlMs, now));
}

async function reportAlert({ kind, severity = 'error', message, context = {}, dedupeKey, ttlSec, deps = {} } = {}) {
  const logger = deps.logger || console;
  const now = (deps.now || Date.now)();

  /* 1. Always log first — this never depends on email/Blobs. */
  try {
    const line = `[alert] kind=${kind} severity=${severity} ${message}`;
    (severity === 'warn' ? logger.warn : logger.error).call(logger, line, context);
  } catch (e) { /* logging must never throw */ }

  /* 1b. Cola de tareas (Staff App v2): toda alerta es también una TAREA accionable,
     no solo un correo. Best-effort e INDEPENDIENTE de ALERT_ENABLED (queremos la
     tarea aunque el correo esté apagado). Dedup por el mismo fingerprint. */
  try {
    const fp = dedupeKey || `${kind}:${stableHash(message + '|' + JSON.stringify(context))}`;
    await require('./_ops-queue').enqueue({ kind, severity, title: message, context, dedupeKey: fp }, deps.opsDeps || {});
  } catch (e) { /* la cola nunca debe tumbar la alerta */ }

  try {
    /* Gestionable desde /admin (override del panel → env). Por defecto activo:
       solo se apaga con un 'false' explícito (igual que antes). */
    const { get } = require('./_settings');
    if (String(await get('ALERT_ENABLED', 'true')).toLowerCase() === 'false') {
      return { alerted: false, reason: 'disabled' };
    }

    const sendEmail = deps.sendEmail || require('./_email').sendEmail;
    const adminEmail = deps.adminEmail || require('./_email').adminEmail;
    const getStore = deps.getStore || ((opts) => require('@netlify/blobs').getStore(opts));

    const ttlMs = 1000 * (ttlSec || parseInt(process.env.ALERT_DEDUPE_TTL_SEC, 10) || DEFAULT_TTL_SEC);
    const fp = dedupeKey || `${kind}:${stableHash(message + '|' + JSON.stringify(context))}`;

    const claim = await claimAlert(getStore, fp, ttlMs, now);
    if (!claim.claimed) return { alerted: false, reason: 'deduped' };

    const to = process.env.ALERT_EMAIL || adminEmail();
    const at = new Date(now).toISOString();
    const subject = `${severityMark(severity)} [Estar alerta] ${kind} — ${String(message || '').slice(0, 80)}`;
    let sent;
    try {
      sent = await sendEmail({ to, subject, html: alertHtml({ kind, severity, message, context, at }) });
    } catch (e) {
      await claim.release(); /* no salió: no silenciar la siguiente */
      throw e;
    }
    /* sendEmail no lanza: devuelve { sent:false } si Resend falla o no hay
       llave. En ese caso se LIBERA el reclamo, para que el siguiente intento
       sí avise (antes quedaba silenciado una hora sin haber salido nada). */
    if (sent && sent.sent === false) {
      await claim.release();
      return { alerted: false, reason: 'send_failed' };
    }
    return { alerted: true };
  } catch (e) {
    try { logger.error('[alert] reportAlert threw (swallowed):', e.message); } catch (_) {}
    return { alerted: false, reason: 'error' };
  }
}

module.exports = { reportAlert };
module.exports._test = { stableHash, alertHtml, shouldSend, claimAlert, recentlyAlerted, markAlerted, DEFAULT_TTL_SEC };
