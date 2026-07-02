require('./_env');
const { flag, get } = require('./_settings');

/*
 * _escalation.js — escalamiento urgente del bot a un humano.
 *
 * Protocolo (decisión dueño 2026-06-25):
 *   PRIORIDAD → LLAMADA de voz (Twilio, número aparte) al/los responsable(s).
 *   FALLBACK  → si la llamada está deshabilitada, no hay destinos o falla,
 *               levanta una alerta (correo + tarea en la cola de /admin vía
 *               _alert.reportAlert, que ya existe y es confiable).
 *
 * Gated por ESCALATION_CALL_ENABLED (OFF por defecto). Best-effort: NUNCA lanza;
 * el bot lo invoca sin riesgo de tumbar la conversación.
 *
 * Destinos (E.164, coma-separados): ESCALATION_PHONE_NUMBERS. Se lee con
 * _settings.get → primero el override del panel (/admin → Configuración) y, si no
 * hay, la variable de entorno de Netlify. Así los números se editan desde la web
 * sin redeploy. Pensado para llamar primero al responsable de turno y, si se
 * configuran varios, intentar en orden.
 * (La cascada "si no contesta en 10 min, llamar a los dueños" requiere callbacks
 * de estado de Twilio + un reintento diferido → fase siguiente.)
 */

function parseTargets(raw) {
  return String(raw || '').split(',').map(s => s.trim()).filter(Boolean);
}

/* Lista efectiva de destinos: override del panel → env. Async (lee _settings).
   deps.get inyectable para tests. Nunca lanza. */
async function escalationTargets(deps = {}) {
  const getFn = deps.get || get;
  let raw = '';
  try { raw = await getFn('ESCALATION_PHONE_NUMBERS', ''); }
  catch (e) { raw = process.env.ESCALATION_PHONE_NUMBERS || ''; }
  return parseTargets(raw);
}

function spokenMessage(reason, lang) {
  if (lang === 'en') return 'A guest needs attention now. Please check the hotel WhatsApp chat.';
  return 'Un huésped requiere atención. Por favor revisa el chat de WhatsApp del hotel.';
}

/* escalate({ reason, summary, lang, guestNumber }, deps?) → resultado best-effort.
   deps inyectables para tests: { flag, get, twilioVoice, alert, targets, voiceDeps }. */
async function escalate({ reason, summary, lang, guestNumber } = {}, deps = {}) {
  const result = { calls: [], callOk: false, fallback: null };

  let enabled = false;
  try {
    const flagFn = deps.flag || flag;
    enabled = String(await flagFn('ESCALATION_CALL_ENABLED')).toLowerCase() === 'true';
  } catch (e) { enabled = false; }

  if (enabled) {
    const voice = deps.twilioVoice || require('./_twilio-voice');
    const targets = deps.targets || await escalationTargets(deps);
    const message = spokenMessage(reason, lang);
    for (const to of targets) {
      let r;
      try { r = await voice.placeCall({ to, message, lang }, deps.voiceDeps); }
      catch (e) { r = { ok: false, error: (e && e.message) || 'error' }; }
      result.calls.push({ to, ok: !!(r && r.ok), isMock: !!(r && r.isMock) });
      if (r && r.ok) { result.callOk = true; break; } /* primer destino aceptado */
    }
  }

  /* Fallback: si no se logró ninguna llamada, alerta confiable (correo + tarea). */
  if (!result.callOk) {
    try {
      const reportAlert = (deps.alert && deps.alert.reportAlert) || require('./_alert').reportAlert;
      await reportAlert({
        kind: 'guest_escalation',
        severity: 'critical',
        message: `Escalamiento de huésped${reason ? ' (' + reason + ')' : ''} — sin llamada (revisar)`,
        context: { reason: reason || null, summary: summary || null, guestNumber: guestNumber || null },
        dedupeKey: `escalation:${guestNumber || 'anon'}:${reason || 'urgent'}`
      });
      result.fallback = 'alert';
    } catch (e) { /* best-effort: nunca lanza */ }
  }

  return result;
}

module.exports = { escalate, escalationTargets, parseTargets, spokenMessage };
