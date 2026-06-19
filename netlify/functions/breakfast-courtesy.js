/* Cortesía de desayuno (panel admin) — el hotel regala un desayuno.
 *
 * A diferencia del upgrade (Fase 3), NO cobra nada al huésped ni al folio: es una
 * cortesía. Pero SÍ cuenta para la liquidación al proveedor (el proveedor lo
 * sirvió igual), así que se registra como una redención con source 'courtesy'
 * (idempotente 1/persona/día como el resto). Auth: SOLO admin (ADMIN_EMAILS) —
 * dar cortesías es una decisión de administración, no del comedor. */

const { json, corsHeaders, parseJsonBody, isDemoMode } = require('./_guest-app');
const { authenticateAdmin } = require('./_firebase-auth');
const { resolveBreakfastStatus } = require('./_breakfast');
const { recordRedemption, SOURCE } = require('./_breakfast-store');

function parseQr(input) {
  const s = String(input || '').trim();
  const m = s.match(/^(.+?):(\d+)$/);
  if (m) return { code: m[1], guestIndex: Number(m[2]) };
  return { code: s, guestIndex: undefined };
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = (isDemoMode() && !process.env.FIREBASE_PROJECT_ID)
    ? { ok: true, email: 'demo@local' }
    : await authenticateAdmin(event);
  if (!auth.ok) return json(auth.statusCode, { error: auth.error });

  try {
    const body = parseJsonBody(event, 2000);
    let code = String(body.code || '').trim().slice(0, 80);
    let guestIndex = body.guestIndex;
    if (body.qr) {
      const parsed = parseQr(body.qr);
      code = String(parsed.code).slice(0, 80);
      if (guestIndex == null || guestIndex === '') guestIndex = parsed.guestIndex;
    }
    if (!code) return json(400, { error: 'Falta el código de reserva.' });

    const status = await resolveBreakfastStatus(code, {});
    if (!status) return json(404, { error: 'No encontramos una reserva con ese código.' });

    // Una cortesía NO exige derecho previo (el punto es regalar). A una persona
    // concreta si vino guestIndex; si no, a N personas (default 1), eligiendo las
    // primeras sin servir hoy dentro de la capacidad.
    const hasIdx = guestIndex != null && guestIndex !== '';
    const maxPersons = Math.max(1, Number(status.capacity) || 1);
    let persons = Number(body.persons);
    if (!Number.isFinite(persons) || persons < 1) persons = 1;
    persons = hasIdx ? 1 : Math.min(persons, maxPersons);

    const served = new Set((status.servedIndexes || []).map(Number));
    const indexes = [];
    if (hasIdx) {
      indexes.push(Number(guestIndex));
    } else {
      for (let i = 0; indexes.length < persons && i < maxPersons; i++) {
        if (!served.has(i)) indexes.push(i);
      }
      if (indexes.length === 0) indexes.push(0); // todas servidas: cortesía a la 1ª
    }

    const results = [];
    for (const idx of indexes) {
      results.push(await recordRedemption({
        bookingCode: status.bookingCode, guestIndex: idx, guestName: status.guestName,
        staffEmail: auth.email, source: SOURCE.COURTESY
      }));
    }
    const created = results.filter(r => r.created).length;

    const fresh = await resolveBreakfastStatus(code, {});
    return json(200, {
      ok: true,
      courtesies: created,
      alreadyServed: results.length - created,
      indexes,
      status: fresh
    });
  } catch (error) {
    console.error('[breakfast-courtesy]', error.message);
    return json(error.statusCode || 500, {
      error: error.statusCode ? error.message : 'No fue posible registrar la cortesía.'
    });
  }
};
