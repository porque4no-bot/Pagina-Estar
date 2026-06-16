/* Conversational engine for the Estar WhatsApp bot.

   whatsapp-webhook.js feeds it one normalized inbound message at a time;
   this module owns the conversation state machine, the copy (ES/EN) and the
   calls into the existing business modules:
     - availability/prices  → _otasync.getDynamicPricing (live OTASync rates)
     - booking lookup       → request-cancellation.fetchReservation +
                              get-booking.helpers.identityMatches (same
                              second-factor / anti-enumeration contract)
     - cancellation request → request-cancellation.submitCancellationRequest
     - human handoff        → _email.sendEmail to ADMIN_NOTIFY_EMAIL

   Session state lives in Netlify Blobs ('whatsapp-sessions', 30-min TTL) with
   an in-memory fallback so the flow also works locally without Blobs.

   All side effects go through an injectable `deps` object so the whole flow
   is unit-testable without network access (tests/unit/whatsapp-bot.test.js). */

const path = require('path');
const fs = require('fs');

const SITE_URL = process.env.URL || 'https://estar.com.co';
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_GUESTS = 6;

/* ── Copy (ES primary, EN fallback) ─────────────────── */
const STRINGS = {
  es: {
    greeting: (name) => `Hola${name ? ' ' + name : ''} ✶ Soy el asistente de Estar (apartaestudios en Manizales). ¿En qué te ayudo?`,
    menuBody: 'Elige una opción:',
    menuBook: 'Reservar',
    menuManage: 'Mi reserva',
    menuMore: 'Más opciones',
    moreButton: 'Ver opciones',
    moreBody: '¿Qué necesitas?',
    moreRows: {
      vivir: { title: 'Estadías largas', description: 'Vivir en Estar: 1 a 12 meses, todo incluido' },
      empresas: { title: 'Empresas y grupos', description: 'Tarifas corporativas y cotizaciones' },
      checkin: { title: 'Check-in y horarios', description: 'Llegada 3:00 pm · salida 11:00 am' },
      ubicacion: { title: 'Ubicación', description: 'Cómo llegar a Estar, Manizales' },
      human: { title: 'Hablar con el equipo', description: 'Te conectamos con una persona' }
    },
    askDates: '¿Para qué fechas? Escríbelas así: *15/08 al 18/08* (día/mes).',
    badDates: 'No entendí las fechas 😅 Escríbelas así: *15/08 al 18/08* (día/mes), o escribe *menú* para volver.',
    askGuests: `¿Para cuántas personas? (1 a ${MAX_GUESTS})`,
    badGuests: `Indícame un número de personas entre 1 y ${MAX_GUESTS}, o escribe *menú* para volver.`,
    availHeader: (nights, checkin, checkout) => `Disponibilidad ${checkin} → ${checkout} (${nights} noche${nights === 1 ? '' : 's'}):`,
    availRoom: (name, price, cap) => `• *${name}* — ${price}/noche (hasta ${cap} pers.)`,
    availFooter: (link) => `Reserva en línea con pago seguro aquí:\n${link}`,
    availNone: 'No veo disponibilidad para esas fechas 😔 Prueba con otras fechas o escribe *agente* y el equipo buscará opciones contigo.',
    availError: 'No pude consultar la disponibilidad en este momento. Intenta de nuevo en unos minutos o escribe *agente*.',
    askCode: 'Dime tu código de reserva (ej: EST-XXXXX o el número que recibiste por correo).',
    askFactor: 'Por seguridad, dime el *apellido* del titular o el *email* con el que reservaste.',
    badCode: 'Ese código no parece válido. Revísalo e inténtalo de nuevo, o escribe *menú*.',
    bookingNotFound: 'No encontré ninguna reserva con esos datos. Verifica el código y el apellido/email, o escribe *agente* para ayuda.',
    bookingSummary: (b) => `Reserva *${b.bookingCode}* — ${b.status}\n${b.roomName || 'Apartaestudio'}\n${b.checkIn} → ${b.checkOut} (${b.nights} noche${b.nights === 1 ? '' : 's'})`,
    btnCancel: 'Solicitar cancelación',
    btnMenu: 'Menú',
    cancelSubmitted: 'Listo ✶ Registré tu solicitud de cancelación. El equipo la procesará según la política de tu tarifa y te confirmará por correo en menos de 24 horas.',
    cancelAlready: 'Ya tenemos una solicitud de cancelación registrada para esa reserva. El equipo te confirmará por correo.',
    cancelNotPossible: 'Esa reserva no se puede cancelar por este medio (puede que ya esté cancelada o finalizada). Escribe *agente* y el equipo te ayuda.',
    cancelFailed: 'No pude registrar la solicitud ahora mismo. Escribe *agente* y el equipo la toma manualmente.',
    vivirInfo: `Vivir en Estar ✶ apartaestudios por meses, todo incluido (servicios, internet de fibra, aseo semanal), sin fiadores y 100% digital. Tarifas con IVA incluido.\n\nMira tipologías y precios:\n${SITE_URL}/vivir.html\n\n¿Quieres que el equipo te haga una cotización? Escribe *agente*.`,
    empresasInfo: `Para empresas y grupos manejamos tarifas pre-negociadas, bloqueos de inventario y cotizaciones formales.\n\nInfo: ${SITE_URL}/empresas.html\nGrupos: ${SITE_URL}/grupos.html\n\nEscribe *agente* para que el equipo comercial te contacte.`,
    checkinInfo: `Check-in: desde las 3:00 pm · Check-out: hasta las 11:00 am.\nEl check-in es 100% digital: un día antes te llega el enlace con tus códigos de acceso (sin llaves físicas ni recepción).\n\nMás detalles: ${SITE_URL}/faq.html`,
    ubicacionInfo: `Estamos en Manizales, Colombia. Encuentra el mapa, cómo llegar y recomendaciones locales aquí:\n${SITE_URL}/explora.html`,
    humanAck: 'Listo ✶ Avisé al equipo: una persona te escribirá por este mismo chat en horario de atención. Si es urgente, llama al +57 310 249 0414.',
    fallback: 'No estoy seguro de haber entendido 🤔 Escribe *menú* para ver las opciones o *agente* para hablar con una persona.'
  },
  en: {
    greeting: (name) => `Hi${name ? ' ' + name : ''} ✶ I'm the Estar assistant (studio apartments in Manizales). How can I help?`,
    menuBody: 'Pick an option:',
    menuBook: 'Book',
    menuManage: 'My booking',
    menuMore: 'More options',
    moreButton: 'See options',
    moreBody: 'What do you need?',
    moreRows: {
      vivir: { title: 'Extended stays', description: 'Live at Estar: 1 to 12 months, all inclusive' },
      empresas: { title: 'Corporate & groups', description: 'Negotiated rates and quotes' },
      checkin: { title: 'Check-in & times', description: 'Arrival 3:00 pm · departure 11:00 am' },
      ubicacion: { title: 'Location', description: 'How to reach Estar, Manizales' },
      human: { title: 'Talk to the team', description: 'We connect you with a person' }
    },
    askDates: 'Which dates? Write them like this: *15/08 to 18/08* (day/month).',
    badDates: 'I could not parse those dates 😅 Write them like *15/08 to 18/08* (day/month), or type *menu* to go back.',
    askGuests: `For how many guests? (1 to ${MAX_GUESTS})`,
    badGuests: `Give me a number of guests between 1 and ${MAX_GUESTS}, or type *menu* to go back.`,
    availHeader: (nights, checkin, checkout) => `Availability ${checkin} → ${checkout} (${nights} night${nights === 1 ? '' : 's'}):`,
    availRoom: (name, price, cap) => `• *${name}* — ${price}/night (up to ${cap} guests)`,
    availFooter: (link) => `Book online with secure payment here:\n${link}`,
    availNone: 'I see no availability for those dates 😔 Try different dates or type *agent* and the team will help you.',
    availError: 'I could not check availability right now. Try again in a few minutes or type *agent*.',
    askCode: 'Tell me your booking code (e.g. EST-XXXXX or the number you got by email).',
    askFactor: 'For security, tell me the holder *last name* or the *email* used to book.',
    badCode: 'That code does not look valid. Check it and try again, or type *menu*.',
    bookingNotFound: 'I could not find a booking with those details. Check the code and last name/email, or type *agent* for help.',
    bookingSummary: (b) => `Booking *${b.bookingCode}* — ${b.status}\n${b.roomName || 'Studio'}\n${b.checkIn} → ${b.checkOut} (${b.nights} night${b.nights === 1 ? '' : 's'})`,
    btnCancel: 'Request cancellation',
    btnMenu: 'Menu',
    cancelSubmitted: 'Done ✶ I registered your cancellation request. The team will process it according to your rate policy and confirm by email within 24 hours.',
    cancelAlready: 'We already have a cancellation request registered for that booking. The team will confirm by email.',
    cancelNotPossible: 'That booking cannot be cancelled through this channel (it may already be cancelled or completed). Type *agent* and the team will help.',
    cancelFailed: 'I could not register the request right now. Type *agent* and the team will take it manually.',
    vivirInfo: `Live at Estar ✶ studio apartments by the month, all inclusive (utilities, fiber internet, weekly housekeeping), no co-signers, 100% digital. Rates include VAT.\n\nSee typologies and prices:\n${SITE_URL}/en/vivir.html\n\nWant a quote from the team? Type *agent*.`,
    empresasInfo: `For companies and groups we offer pre-negotiated rates, inventory blocks and formal quotes.\n\nInfo: ${SITE_URL}/en/empresas.html\nGroups: ${SITE_URL}/en/grupos.html\n\nType *agent* and our sales team will contact you.`,
    checkinInfo: `Check-in: from 3:00 pm · Check-out: by 11:00 am.\nCheck-in is 100% digital: one day before arrival you receive a link with your access codes (no physical keys or front desk).\n\nMore: ${SITE_URL}/en/faq.html`,
    ubicacionInfo: `We are in Manizales, Colombia. Map, directions and local tips here:\n${SITE_URL}/en/explora.html`,
    humanAck: 'Done ✶ I notified the team: a person will reply in this same chat during business hours. If urgent, call +57 310 249 0414.',
    fallback: 'I am not sure I understood 🤔 Type *menu* to see the options or *agent* to talk to a person.'
  }
};

/* ── Parsers ────────────────────────────────────────── */
const ES_MONTHS = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12
};

function pad2(n) { return String(n).padStart(2, '0'); }

function toIso(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  /* Reject impossible dates like 31/02 (Date would roll them over). */
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/* If the parsed date already passed, the guest almost certainly means next
   year (people write "15/01" in December). */
function rollForward(iso, now) {
  if (!iso) return null;
  const today = now.toISOString().split('T')[0];
  if (iso >= today) return iso;
  const y = parseInt(iso.slice(0, 4), 10) + 1;
  return `${y}${iso.slice(4)}`;
}

/* Accepts: "15/08 al 18/08", "15/8 a 18/8/2026", "15-08 — 18-08",
   "del 15 al 18 de agosto", "2026-08-15 a 2026-08-18".
   Returns { checkin, checkout } (ISO) or null. */
function parseDateRange(text, nowDate) {
  const now = nowDate || new Date();
  const t = String(text || '').toLowerCase().trim();
  const year = now.getUTCFullYear();

  /* ISO pair — validar fechas reales (rechaza 2026-02-31) y checkout>checkin,
     igual que las otras ramas, en vez de solo comparar strings. */
  let m = t.match(/(\d{4})-(\d{2})-(\d{2})\s*(?:al?|a|hasta|to|-|—|→)\s*(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const checkin = toIso(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
    const checkout = toIso(parseInt(m[4], 10), parseInt(m[5], 10), parseInt(m[6], 10));
    if (!checkin || !checkout || checkout <= checkin) return null;
    return { checkin, checkout };
  }

  /* dd/mm [/yyyy] pair, separators / or - inside the date */
  m = t.match(/(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\s*(?:al?|a|hasta|to|-|—|→)\s*(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/);
  if (m) {
    const y1 = m[3] ? (m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10)) : year;
    const y2 = m[6] ? (m[6].length === 2 ? 2000 + parseInt(m[6], 10) : parseInt(m[6], 10)) : y1;
    let checkin = toIso(y1, parseInt(m[2], 10), parseInt(m[1], 10));
    let checkout = toIso(y2, parseInt(m[5], 10), parseInt(m[4], 10));
    if (!checkin || !checkout) return null;
    if (!m[3]) checkin = rollForward(checkin, now);
    if (!m[6]) checkout = rollForward(checkout, now);
    if (checkout <= checkin) {
      /* "28/12 al 02/01" — checkout rolls into the next year. */
      const y = parseInt(checkout.slice(0, 4), 10) + 1;
      checkout = `${y}${checkout.slice(4)}`;
    }
    if (checkout <= checkin) return null;
    return { checkin, checkout };
  }

  /* "del 15 al 18 de agosto [de 2026]" / "15 al 18 de agosto" */
  m = t.match(/(\d{1,2})\s*(?:al?|a|hasta|to|-|—)\s*(\d{1,2})\s*de\s+([a-záé]+)(?:\s*(?:de\s*)?(\d{4}))?/);
  if (m) {
    const month = ES_MONTHS[m[3].normalize('NFD').replace(/[̀-ͯ]/g, '')];
    if (!month) return null;
    const y = m[4] ? parseInt(m[4], 10) : year;
    let checkin = toIso(y, month, parseInt(m[1], 10));
    let checkout = toIso(y, month, parseInt(m[2], 10));
    if (!checkin || !checkout || checkout <= checkin) return null;
    if (!m[4]) { checkin = rollForward(checkin, now); checkout = rollForward(checkout, now); }
    if (checkout <= checkin) return null;
    return { checkin, checkout };
  }

  return null;
}

const GUEST_WORDS = {
  un: 1, una: 1, uno: 1, one: 1, dos: 2, two: 2, tres: 3, three: 3,
  cuatro: 4, four: 4, cinco: 5, five: 5, seis: 6, six: 6
};

function parseGuests(text) {
  const t = String(text || '').toLowerCase();
  const num = t.match(/\d+/);
  if (num) {
    const n = parseInt(num[0], 10);
    return n >= 1 && n <= MAX_GUESTS ? n : null;
  }
  for (const [word, n] of Object.entries(GUEST_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(t)) return n;
  }
  return null;
}

function detectLang(text, current) {
  const t = String(text || '').toLowerCase();
  if (/\b(español|espanol|spanish)\b/.test(t)) return 'es';
  if (/\b(english|ingles|inglés)\b/.test(t)) return 'en';
  if (/\b(hello|hi|book|booking|availability|cancel|nights?|guests?|please|thanks)\b/.test(t)) return 'en';
  if (/\b(hola|reserva|reservar|disponibilidad|cancelar|noches?|personas?|gracias)\b/.test(t)) return 'es';
  return current || 'es';
}

function formatCOP(n) {
  return '$ ' + Math.round(n || 0).toLocaleString('es-CO');
}

/* ── Sessions (Blobs with in-memory fallback) ───────── */
const memorySessions = new Map();

async function loadSession(waId) {
  try {
    const { getStore } = require('@netlify/blobs');
    const store = getStore({ name: 'whatsapp-sessions', consistency: 'strong' });
    const raw = await store.get(waId);
    if (raw) {
      const s = JSON.parse(raw);
      if (s.updatedAt && Date.now() - s.updatedAt < SESSION_TTL_MS) return s;
    }
  } catch (e) {
    const s = memorySessions.get(waId);
    if (s && Date.now() - s.updatedAt < SESSION_TTL_MS) return s;
  }
  return { state: 'MAIN', data: {}, lang: null, updatedAt: Date.now() };
}

async function saveSession(waId, session) {
  session.updatedAt = Date.now();
  try {
    const { getStore } = require('@netlify/blobs');
    const store = getStore({ name: 'whatsapp-sessions', consistency: 'strong' });
    await store.set(waId, JSON.stringify(session));
  } catch (e) {
    memorySessions.set(waId, session);
  }
}

/* ── Room metadata (names + capacity for the availability reply) ── */
function loadRoomMeta() {
  try {
    const dbPath = path.join(__dirname, '../../rooms_db.json');
    const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const meta = {};
    for (const [id, room] of Object.entries(db)) {
      meta[id] = { name: room.name, capacity: room.capacity || 2 };
    }
    return meta;
  } catch (e) {
    return {};
  }
}

/* ── Default dependencies (real implementations) ────── */
function createDefaultDeps() {
  const wa = require('./_whatsapp');
  const { getDynamicPricing } = require('./_otasync');
  const { sendEmail, adminEmail } = require('./_email');
  const { helpers: bookingHelpers } = require('./get-booking');
  const { submitCancellationRequest, fetchReservation } = require('./request-cancellation');

  return {
    wa,
    getDynamicPricing,
    sendEmail,
    adminEmail,
    roomMeta: loadRoomMeta(),
    loadSession,
    saveSession,
    lookupBooking: async (code, factor) => {
      const booking = await fetchReservation(code);
      if (!booking || !bookingHelpers.identityMatches(booking, factor)) return null;
      return booking;
    },
    submitCancellation: (args) => submitCancellationRequest(args)
  };
}

/* ── Reply helpers ──────────────────────────────────── */
async function sendMainMenu(deps, to, t, name) {
  await deps.wa.sendButtons(to, t.greeting(name), [
    { id: 'bot_book', title: t.menuBook },
    { id: 'bot_manage', title: t.menuManage },
    { id: 'bot_more', title: t.menuMore }
  ], { footer: 'Estar · Manizales' });
}

async function sendMoreList(deps, to, t) {
  await deps.wa.sendList(to, t.moreBody, t.moreButton, [{
    rows: [
      { id: 'bot_vivir', ...t.moreRows.vivir },
      { id: 'bot_empresas', ...t.moreRows.empresas },
      { id: 'bot_checkin', ...t.moreRows.checkin },
      { id: 'bot_ubicacion', ...t.moreRows.ubicacion },
      { id: 'bot_human', ...t.moreRows.human }
    ]
  }]);
}

async function handleHuman(deps, msg, session, t) {
  try {
    await deps.sendEmail({
      to: deps.adminEmail(),
      subject: `WhatsApp: huésped pide hablar con el equipo (+${msg.from})`,
      html: `<p>Un huésped pidió atención humana en el chat del bot de WhatsApp.</p>
             <ul><li><strong>Número:</strong> +${msg.from}</li>
             <li><strong>Nombre (perfil):</strong> ${String(msg.profileName || '—').replace(/</g, '&lt;')}</li>
             <li><strong>Último mensaje:</strong> ${String(msg.text || '—').replace(/</g, '&lt;')}</li></ul>
             <p>Respóndele directamente desde la app de WhatsApp Business / inbox.</p>`
    });
  } catch (e) {
    console.error('[whatsapp-bot] human handoff email failed:', e.message);
  }
  session.state = 'MAIN';
  await deps.wa.sendText(msg.from, t.humanAck);
}

async function handleAvailability(deps, msg, session, t) {
  const { checkin, checkout, guests } = session.data;
  let pricing;
  try {
    pricing = await deps.getDynamicPricing(checkin, checkout, guests);
  } catch (e) {
    console.error('[whatsapp-bot] availability lookup failed:', e.message);
    session.state = 'MAIN';
    await deps.wa.sendText(msg.from, t.availError);
    return;
  }

  const link = `${SITE_URL}/reservar.html?checkin=${checkin}&checkout=${checkout}&guests=${guests}`;
  const rows = [];
  for (const [id, room] of Object.entries(pricing.byRoomType || {})) {
    const meta = deps.roomMeta[id] || {};
    if (meta.capacity && meta.capacity < guests) continue;
    if (room.available === false) continue;
    rows.push(t.availRoom(meta.name || `Tipo ${id}`, formatCOP(room.avgPrice), meta.capacity || guests));
  }

  session.state = 'MAIN';
  session.data = {};
  if (!rows.length) {
    await deps.wa.sendText(msg.from, t.availNone);
    return;
  }
  const body = [
    t.availHeader(pricing.nights, checkin, checkout),
    '',
    ...rows,
    '',
    t.availFooter(link)
  ].join('\n');
  await deps.wa.sendText(msg.from, body, { previewUrl: false });
}

/* ── Main entry point ───────────────────────────────── */
/* msg: { from, id, type, text, replyId, profileName } */
async function handleIncoming(msg, deps) {
  deps = deps || createDefaultDeps();
  const session = await deps.loadSession(msg.from);
  session.lang = detectLang(msg.text, session.lang);
  const t = STRINGS[session.lang] || STRINGS.es;
  const text = String(msg.text || '').trim();
  const lower = text.toLowerCase();
  const replyId = msg.replyId || '';

  try {
    /* Human handoff first — a deterministic escape hatch that behaves the
       same whether the AI is enabled or not. */
    if (replyId === 'bot_human' || /\b(agente|asesor|humano|persona|agent|human)\b/.test(lower)) {
      await handleHuman(deps, msg, session, t);
      return session;
    }

    /* ── AI mode (Claude) ──────────────────────────────
       With ANTHROPIC_API_KEY configured, Claude runs the whole conversation
       through _whatsapp-ai (live availability, booking lookup, cancellation
       and human handoff as tools). The keyword/state machine below stays as
       the fallback for unconfigured environments and AI failures. The
       'agente' shortcut above remains deterministic on purpose — guests can
       always escape to a human even if the AI misbehaves. */
    const aiMod = deps.aiModule || require('./_whatsapp-ai');
    if (aiMod.isEnabled()) {
      try {
        /* Dual-model pipeline: a fast guard model screens the message for
           prompt injection / impersonation / data-extraction BEFORE the
           concierge model sees it. Blocked messages get a neutral reply and
           never enter the AI history (no conversation poisoning). The guard
           classifies; authorization (e.g. who may cancel which booking) is
           enforced in code inside _whatsapp-ai's tools. */
        const guardMod = deps.guardModule || require('./_whatsapp-guard');
        if (guardMod.isEnabled() && msg.text) {
          const verdict = await guardMod.screenMessage(msg, session, deps);
          if (verdict.blocked) {
            session.guardStrikes = (session.guardStrikes || 0) + 1;
            if (session.guardStrikes === 3) {
              try {
                await deps.sendEmail({
                  to: deps.adminEmail(),
                  subject: `WhatsApp bot: intentos de manipulación repetidos (+${msg.from})`,
                  html: `<p>El filtro de seguridad bloqueó 3 mensajes de este número en la misma sesión.</p>
                         <ul><li><strong>Número:</strong> +${msg.from}</li>
                         <li><strong>Último motivo:</strong> ${String(verdict.reason || '').replace(/</g, '&lt;')}</li>
                         <li><strong>Categorías:</strong> ${String((verdict.categories || []).join(', ')).replace(/</g, '&lt;')}</li></ul>`
                });
              } catch (e) { console.error('[whatsapp-bot] guard alert failed:', e.message); }
            }
            await deps.wa.sendText(msg.from, guardMod.blockReply(session.lang));
            return session;
          }
        }

        const aiMsg = { ...msg };
        if (!aiMsg.text && replyId) {
          /* A tap on a legacy button arrives with no free text — translate
             the intent so the model can pick the conversation up. */
          const replyText = {
            bot_book: 'Quiero reservar / ver disponibilidad',
            bot_manage: 'Quiero consultar mi reserva',
            bot_more: 'Ver más opciones',
            bot_vivir: 'Información de estadías largas',
            bot_empresas: 'Información para empresas y grupos',
            bot_checkin: 'Información de check-in y horarios',
            bot_ubicacion: '¿Dónde están ubicados?',
            bot_cancel: 'Quiero cancelar mi reserva',
            bot_menu: 'Hola'
          };
          aiMsg.text = replyText[replyId] || 'Hola';
        }
        const reply = await aiMod.handleWithAI(aiMsg, session, deps);
        session.state = 'MAIN';
        session.data = {};
        await deps.wa.sendText(msg.from, reply);
        return session;
      } catch (e) {
        console.error('[whatsapp-bot] AI path failed, falling back to state machine:', e.message);
        /* fall through to the deterministic flow below */
      }
    }

    /* Global commands — they cut through any state. */
    if (replyId === 'bot_menu' || /^(menu|menú|inicio|start|hola|hello|hi|buenas)\b/.test(lower)) {
      session.state = 'MAIN';
      session.data = {};
      await sendMainMenu(deps, msg.from, t, msg.profileName);
      return session;
    }

    /* Menu selections (interactive replies or typed keywords). */
    if (replyId === 'bot_book' || /\b(reservar|disponibilidad|book|availability)\b/.test(lower)) {
      /* The message itself may already contain the dates ("disponibilidad
         15/08 al 18/08") — try before asking. */
      const range = parseDateRange(text);
      if (range) {
        session.data = { ...range };
        session.state = 'BOOK_GUESTS';
        await deps.wa.sendText(msg.from, t.askGuests);
      } else {
        session.state = 'BOOK_DATES';
        session.data = {};
        await deps.wa.sendText(msg.from, t.askDates);
      }
      return session;
    }
    if (replyId === 'bot_manage' || /\b(mi reserva|my booking|gestionar)\b/.test(lower)) {
      session.state = 'MANAGE_CODE';
      session.data = {};
      await deps.wa.sendText(msg.from, t.askCode);
      return session;
    }
    if (replyId === 'bot_more') { await sendMoreList(deps, msg.from, t); return session; }
    if (replyId === 'bot_vivir') { session.state = 'MAIN'; await deps.wa.sendText(msg.from, t.vivirInfo); return session; }
    if (replyId === 'bot_empresas') { session.state = 'MAIN'; await deps.wa.sendText(msg.from, t.empresasInfo); return session; }
    if (replyId === 'bot_checkin') { session.state = 'MAIN'; await deps.wa.sendText(msg.from, t.checkinInfo); return session; }
    if (replyId === 'bot_ubicacion') { session.state = 'MAIN'; await deps.wa.sendText(msg.from, t.ubicacionInfo); return session; }

    if (replyId === 'bot_cancel' && session.data.bookingCode) {
      let result;
      try {
        result = await deps.submitCancellation({
          bookingCode: session.data.bookingCode,
          providedFactor: session.data.factor,
          clientIp: 'whatsapp',
          source: 'whatsapp'
        });
      } catch (e) {
        console.error('[whatsapp-bot] cancellation failed:', e.message);
        result = { ok: false, code: 'error' };
      }
      session.state = 'MAIN';
      session.data = {};
      const reply = result.code === 'submitted' ? t.cancelSubmitted
        : result.code === 'already_requested' ? t.cancelAlready
        : result.code === 'not_cancellable' ? t.cancelNotPossible
        : result.code === 'not_found' ? t.bookingNotFound
        : t.cancelFailed;
      await deps.wa.sendText(msg.from, reply);
      return session;
    }

    /* Stateful steps. */
    switch (session.state) {
      case 'BOOK_DATES': {
        const range = parseDateRange(text);
        if (!range) { await deps.wa.sendText(msg.from, t.badDates); return session; }
        session.data = { ...range };
        session.state = 'BOOK_GUESTS';
        await deps.wa.sendText(msg.from, t.askGuests);
        return session;
      }
      case 'BOOK_GUESTS': {
        const guests = parseGuests(text);
        if (!guests) { await deps.wa.sendText(msg.from, t.badGuests); return session; }
        session.data.guests = guests;
        await handleAvailability(deps, msg, session, t);
        return session;
      }
      case 'MANAGE_CODE': {
        const code = text.replace(/\s+/g, '');
        if (!/^[A-Za-z0-9-]{3,40}$/.test(code)) { await deps.wa.sendText(msg.from, t.badCode); return session; }
        session.data.bookingCode = code;
        session.state = 'MANAGE_FACTOR';
        await deps.wa.sendText(msg.from, t.askFactor);
        return session;
      }
      case 'MANAGE_FACTOR': {
        session.data.factor = text;
        let booking = null;
        try {
          booking = await deps.lookupBooking(session.data.bookingCode, session.data.factor);
        } catch (e) {
          console.error('[whatsapp-bot] booking lookup failed:', e.message);
        }
        if (!booking) {
          session.state = 'MANAGE_CODE';
          session.data = {};
          await deps.wa.sendText(msg.from, t.bookingNotFound);
          return session;
        }
        session.state = 'MANAGE_ACTIONS';
        session.data.bookingCode = booking.bookingCode;
        const buttons = [{ id: 'bot_menu', title: t.btnMenu }];
        if (booking.canCancel) buttons.unshift({ id: 'bot_cancel', title: t.btnCancel });
        await deps.wa.sendButtons(msg.from, t.bookingSummary(booking), buttons);
        return session;
      }
      default: {
        /* Free text with no active flow: try dates, then fallback. */
        const range = parseDateRange(text);
        if (range) {
          session.data = { ...range };
          session.state = 'BOOK_GUESTS';
          await deps.wa.sendText(msg.from, t.askGuests);
          return session;
        }
        await deps.wa.sendText(msg.from, t.fallback);
        return session;
      }
    }
  } finally {
    await deps.saveSession(msg.from, session);
  }
}

module.exports = {
  handleIncoming, createDefaultDeps,
  parseDateRange, parseGuests, detectLang,
  loadSession, saveSession,
  STRINGS, SESSION_TTL_MS, MAX_GUESTS
};
