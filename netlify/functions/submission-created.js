require('./_env');

/* Función disparada por evento de Netlify: se invoca automáticamente en CADA
   envío de un formulario nativo de Netlify (evento `submission-created`). No la
   llama el navegador — la llama Netlify del lado servidor tras capturar el form,
   así que no necesita CORS ni validación de método.

   Maestro de clientes (Fase 1): el formulario de larga estadía de `vivir.html`
   (`estancias-largas`) crea/actualiza al solicitante como partner (persona) en
   Odoo, deduplicado por email. El form sigue siendo nativo de Netlify: esto solo
   AÑADE la sincronización, no cambia la captura existente.

   Tapar fugas de captura (Fase 2): el Newsletter del footer (`newsletter`) y el
   form de Contacto (`contacto.html`, `contacto`) hoy se quedan en Netlify y no
   llegan a Odoo. Ahora:
   - `newsletter` → upsertPartner (con opt-in) + Email Marketing (mailing.list).
     Es la ÚNICA fuente con consentimiento de marketing legalmente limpio (su
     checkbox dice "Acepto recibir comunicaciones por correo"). Sin ese
     consentimiento no se sincroniza (Ley 1581).
   - `contacto` → upsertPartner + oportunidad CRM ('Web-Contacto'). Es
     TRANSACCIONAL: NO entra a la lista de marketing salvo opt-in explícito.

   Frente site (oct-2026) — formularios que quedaban solo en Netlify:
   - `convenios-empresas` (empresas.html, ES/EN) → partner EMPRESA + oportunidad
     CRM "Convenio empresarial" (con el contacto y si pide crédito a 30 días).
   - `estancias-largas-en` (en/vivir.html) → alias del handler de larga estadía
     (el form inglés se llama distinto y antes se ignoraba).
   - `vacantes-empleo` (trabaja.html, ES/EN) → NO va al maestro de clientes (un
     postulante no es cliente y su dato tiene otra finalidad: selección de
     personal). Se avisa al equipo por correo (adminEmail()).

   No fatal y siempre responde 200: un error de Odoo nunca debe hacer que Netlify
   reintente ni que se pierda el lead. Sin credenciales de Odoo es un no-op mock. */

/* Un checkbox marcado de Netlify Forms llega como un valor truthy (típicamente
   "on", o el `value` del input); desmarcado llega ausente o vacío. Tratamos
   cualquier valor no vacío como aceptación. */
function isChecked(v) {
  if (v === true) return true;
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return s !== '' && s !== 'false' && s !== 'no' && s !== 'off' && s !== '0';
}

/* Opt-in de marketing (Ley 1581): consentimiento SEPARADO de la aceptación de la
   política de privacidad (`habeas_data`, que es obligatoria y NO implica
   marketing). El frente público usa el checkbox canónico `marketingOptIn`; se
   aceptan alias antiguos (`marketing`, `acepto_marketing`) por compatibilidad.
   Sin marcar = NO marketing. */
function hasMarketingOptIn(data) {
  return isChecked(data && (data.marketingOptIn || data.marketing || data.acepto_marketing));
}

/* Nota de auditoría del consentimiento: deja constancia de aceptación + fecha +
   canal en la ficha del partner (campo estándar `comment`), para tener evidencia
   del opt-in donde haya registro (Ley 1581). */
function optInNote(channel) {
  return `Opt-in marketing aceptado (${channel}) el ${new Date().toISOString().slice(0, 10)}.`;
}

/* Texto de un campo del form: recortado y acotado (los datos vienen del público). */
function field(data, ...keys) {
  for (const k of keys) {
    const v = data && data[k];
    if (v != null && String(v).trim() !== '') return String(v).trim().slice(0, 2000);
  }
  return '';
}

/* Larga estadía (vivir.html y en/vivir.html). `page` solo cambia la etiqueta de
   origen en la nota; el form inglés además marca el idioma del partner. */
function longStayHandler(page, lang) {
  return (data) => {
    const email = (data.correo || '').trim();
    const name = (data.nombre || '').trim() || email;
    const optInMarketing = hasMarketingOptIn(data);
    const values = {
      name,
      email,
      isCompany: false,
      tags: optInMarketing ? ['Larga estadía', 'Opt-in marketing'] : ['Larga estadía'],
      /* El motivo, tiempo, tipología y mudanza ya van en la nota (`comment`); no se
         duplican como campos estándar sueltos para no repetir "Motivo: …" cuando
         _odoo.js enriquece el comentario. */
      comment: `Solicitud de larga estadía (${page}). ` + [
        data.motivo_viaje ? `Motivo: ${data.motivo_viaje}` : '',
        data.tiempo_estimado ? `Tiempo: ${data.tiempo_estimado}` : '',
        data.tipologia ? `Tipología: ${data.tipologia}` : '',
        data.fecha_mudanza ? `Mudanza: ${data.fecha_mudanza}` : '',
        data.mensaje ? `Nota: ${data.mensaje}` : '',
        optInMarketing ? optInNote(page) : ''
      ].filter(Boolean).join('. '),
      lead: (v) => `Larga estadía — ${v.name}`
    };
    /* `en_US` siempre existe en Odoo; al form español NO se le fuerza idioma
       (es_CO podría no estar activo en la instancia). */
    if (lang) values.lang = lang;
    /* Marketing SOLO con opt-in explícito (el form trae su propio checkbox de
       privacidad obligatorio, que NO es consentimiento de marketing). */
    if (optInMarketing && email) values.marketing = { listName: 'Newsletter', name };
    return values;
  };
}

/* Mapea los formularios nativos del sitio a cómo se crean en Odoo. Cada handler
   devuelve los valores de partner; opcionalmente, `lead` (asunto de la
   oportunidad CRM), `leadContact` (nombre de la persona de contacto del lead,
   cuando el partner es una empresa) y `marketing` (si el envío trae opt-in de
   marketing y, por tanto, debe entrar a la lista de Email Marketing). */
const FORM_HANDLERS = {
  'estancias-largas': longStayHandler('vivir.html'),

  /* El form de en/vivir.html se llama `estancias-largas-en` (Netlify registra
     cada nombre por separado). Antes no tenía handler y esos leads no llegaban
     a Odoo: es el mismo formulario, así que se reutiliza el handler. */
  'estancias-largas-en': longStayHandler('en/vivir.html', 'en'),

  /* Convenios empresariales (empresas.html / en/empresas.html, sección
     "Solicita tu convenio empresarial"). El partner es la EMPRESA; el contacto
     va como persona de contacto del lead y en la nota. `credito_30_dias` viene
     marcado por defecto en el form: se registra tal cual para que el comercial
     lo vea (no aprueba nada — el crédito es siempre decisión humana). */
  'convenios-empresas': (data) => {
    const email = field(data, 'email', 'correo');
    const empresa = field(data, 'empresa');
    const contacto = field(data, 'contacto', 'nombre');
    const phone = field(data, 'whatsapp', 'telefono', 'phone');
    const credito = isChecked(data.credito_30_dias);
    const optInMarketing = hasMarketingOptIn(data);
    const name = (empresa || contacto || email).slice(0, 200);
    /* El correo y el WhatsApp son de la PERSONA de contacto, no de la empresa:
       NO se le pasan al partner empresa (upsertPartner deduplica por correo y
       sobrescribiría la ficha de esa persona si ya existe como huésped o
       suscriptora, o la de un tercero cuyo correo alguien escriba en el form
       público). La empresa se deduplica por nombre; el contacto va al lead. */
    const values = {
      name,
      isCompany: true,
      dedupeByCompanyName: true,
      tags: optInMarketing
        ? ['Corporativo', 'Convenio empresarial', 'Opt-in marketing']
        : ['Corporativo', 'Convenio empresarial'],
      comment: 'Solicitud de convenio empresarial (empresas.html). ' + [
        contacto ? `Contacto: ${contacto}` : '',
        phone ? `WhatsApp: ${phone}` : '',
        `Solicita crédito a 30 días: ${credito ? 'sí' : 'no'}`,
        optInMarketing ? optInNote('empresas.html') : ''
      ].filter(Boolean).join('. '),
      lead: (v) => `Convenio empresarial — ${v.name}`,
      leadContact: contacto,
      leadEmail: email,
      leadPhone: phone
    };
    if (optInMarketing && email) values.marketing = { listName: 'Newsletter', name: contacto || name, email };
    return values;
  },

  /* Newsletter (footer): la única fuente con opt-in de marketing limpio. Sin el
     checkbox `habeas_data` ("Acepto recibir comunicaciones por correo") NO se
     sincroniza nada (Ley 1581). No tiene campo de nombre → el nombre cae al
     correo. Se etiqueta y se agrega a la lista de Email Marketing. */
  'newsletter': (data) => {
    const email = (data.email || data.correo || '').trim();
    /* El checkbox del newsletter ES el consentimiento de marketing. Se acepta
       tanto `habeas_data` (campo histórico de este form) como el canónico
       `marketingOptIn`. Sin opt-in: no se sincroniza (Ley 1581). */
    if (!isChecked(data.habeas_data) && !hasMarketingOptIn(data)) return null;
    return {
      name: email,
      email,
      isCompany: false,
      tags: ['Newsletter', 'Opt-in marketing'],
      comment: 'Suscripción al newsletter (footer del sitio). Opt-in de marketing por correo.',
      marketing: { listName: 'Newsletter', name: '' }
    };
  },

  /* Contacto (contacto.html): transaccional. Crea/actualiza el contacto y abre
     una oportunidad CRM ('Web-Contacto'). NO entra a la lista de marketing salvo
     opt-in explícito de marketing (el `habeas_data` de este form es aceptación
     de la política de privacidad, no consentimiento de marketing). */
  'contacto': (data) => {
    const email = (data.email || data.correo || '').trim();
    const name = (data.nombre || data.name || '').trim() || email;
    const optInMarketing = hasMarketingOptIn(data);
    const values = {
      name,
      email,
      phone: (data.telefono || data.phone || '').trim(),
      isCompany: false,
      tags: optInMarketing ? ['Web-Contacto', 'Opt-in marketing'] : ['Web-Contacto'],
      comment: 'Contacto desde el sitio (contacto.html). ' + [
        data.mensaje ? `Mensaje: ${data.mensaje}` : '',
        (data.telefono || data.phone) ? `Tel: ${(data.telefono || data.phone)}` : '',
        optInMarketing ? optInNote('contacto.html') : ''
      ].filter(Boolean).join('. '),
      lead: (v) => `Contacto web — ${v.name}`
    };
    /* Solo va a marketing si el envío trae opt-in de marketing aparte. */
    if (optInMarketing) values.marketing = { listName: 'Newsletter', name };
    return values;
  },

  /* Grupos y eventos (grupos.html): el organizador del grupo. Transaccional —
     crea/actualiza el contacto y abre una oportunidad CRM ('Grupos'). El form
     tiene su checkbox de privacidad obligatorio (`habeas_data`), que NO es
     consentimiento de marketing; este solo entra a la lista si el envío trae el
     opt-in de marketing aparte (`marketingOptIn`). */
  'cotizacion-grupos': (data) => {
    const email = (data.email || data.correo || '').trim();
    const name = (data.organizador || data.nombre || data.name || '').trim() || email;
    const phone = (data.whatsapp || data.telefono || data.phone || '').trim();
    const optInMarketing = hasMarketingOptIn(data);
    const values = {
      name,
      email,
      phone,
      isCompany: false,
      tags: optInMarketing ? ['Grupos', 'Opt-in marketing'] : ['Grupos'],
      comment: 'Solicitud de grupos/eventos (grupos.html). ' + [
        data.motivo ? `Motivo: ${data.motivo}` : '',
        data.huespedes ? `Huéspedes: ${data.huespedes}` : '',
        data.apartaestudios ? `Apartaestudios: ${data.apartaestudios}` : '',
        (data.llegada || data.salida) ? `Fechas: ${data.llegada || '—'} → ${data.salida || '—'}` : '',
        data.requerimientos ? `Requerimientos: ${data.requerimientos}` : '',
        optInMarketing ? optInNote('grupos.html') : ''
      ].filter(Boolean).join('. '),
      lead: (v) => `Grupos — ${v.name}`
    };
    if (optInMarketing && email) values.marketing = { listName: 'Newsletter', name };
    return values;
  }
};

/* ── Formularios que van al EQUIPO (correo), no al maestro de clientes ── */

/* Etiquetas legibles del <select name="area"> de trabaja.html (mismos value en
   ES y EN). */
const AREA_LABELS = {
  operations: 'Operaciones / Huéspedes',
  housekeeping: 'Limpieza / Mantenimiento',
  admin: 'Administración / Marketing',
  other: 'Otro'
};

/* Solo http(s): un `javascript:`/`data:` pegado en el campo de la hoja de vida
   nunca se convierte en enlace del correo. */
function safeHttpUrl(value) {
  try {
    const u = new URL(String(value || '').trim());
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '';
  } catch (e) {
    return '';
  }
}

/* Netlify añade `referrer` (URL de la página) a los datos del envío: sirve para
   saber si la persona usó la versión en inglés. */
function langFromReferrer(data) {
  return /\/en\//.test(field(data, 'referrer')) ? 'en' : 'es';
}

/* Postulación de "Trabaja con nosotros". Devuelve null si no hay con qué
   identificar a la persona (ni nombre ni correo). */
function buildJobApplication(data) {
  const nombre = field(data, 'nombre', 'name').slice(0, 200);
  const email = field(data, 'email', 'correo').slice(0, 254);
  if (!nombre && !email) return null;
  const areaKey = field(data, 'area');
  const hojaVida = field(data, 'hoja_vida', 'cv').slice(0, 500);
  return {
    nombre,
    email,
    area: AREA_LABELS[areaKey] || areaKey || '—',
    hojaVida,
    hojaVidaUrl: safeHttpUrl(hojaVida),
    mensaje: field(data, 'mensaje'),
    lang: langFromReferrer(data),
    aceptaPolitica: isChecked(data.habeas_data)
  };
}

const TEAM_NOTIFY_FORMS = {
  'vacantes-empleo': {
    build: buildJobApplication,
    subject: (a) => `Nueva postulación — ${a.nombre || a.email} (${a.area})`,
    html: (a, email) => email.jobApplicationHtml({ application: a })
  }
};

function defaultDeps() {
  return {
    odoo: () => require('./_odoo'),
    email: () => require('./_email')
  };
}

async function notifyTeam(formName, data, deps) {
  const spec = TEAM_NOTIFY_FORMS[formName];
  const item = spec.build(data);
  if (!item) return { statusCode: 200, body: 'ignored (sin nombre ni correo)' };
  try {
    const email = deps.email();
    const res = await email.sendEmail({
      to: email.adminEmail(),
      subject: spec.subject(item),
      html: spec.html(item, email)
    });
    if (res && res.sent) return { statusCode: 200, body: 'ok' };
    /* Sin RESEND_API_KEY o con Resend caído el envío queda igual en Netlify
       Forms: se registra y se responde 200 (un reintento no ayudaría). */
    console.error(`[submission-created] aviso al equipo (${formName}) no enviado:`, (res && res.reason) || 'error de envío');
    return { statusCode: 200, body: 'ok (correo no enviado)' };
  } catch (err) {
    console.error(`[submission-created] aviso al equipo (${formName}) no fatal:`, err.message);
    return { statusCode: 200, body: 'ok (correo no enviado)' };
  }
}

async function handle(event, deps) {
  let payload;
  try {
    payload = JSON.parse(event.body || '{}').payload;
  } catch (e) {
    return { statusCode: 200, body: 'ignored (cuerpo inválido)' };
  }
  if (!payload) return { statusCode: 200, body: 'ignored (sin payload)' };

  const formName = payload.form_name || (payload.data && payload.data['form-name']) || '';
  const data = payload.data || {};

  if (TEAM_NOTIFY_FORMS[formName]) return notifyTeam(formName, data, deps);

  const buildValues = FORM_HANDLERS[formName];
  if (!buildValues) return { statusCode: 200, body: `ignored (form ${formName})` };

  const values = buildValues(data);
  /* `null` = el handler decidió no sincronizar (p. ej. newsletter sin opt-in de
     marketing). Respuesta 200 igual: no es un error, es la decisión legal. */
  if (!values) return { statusCode: 200, body: `ignored (sin opt-in / no sincronizable: ${formName})` };
  if (!values.name && !values.email) {
    return { statusCode: 200, body: 'ignored (sin nombre ni correo)' };
  }

  /* `lead` (asunto de la oportunidad), `leadContact` (persona de contacto del
     lead) y `marketing` (datos de la lista de Email Marketing) son metadatos de
     enrutado, no campos de res.partner: se sacan de los valores antes de llamar
     a upsertPartner. */
  const { lead: leadSubject, leadContact, leadEmail, leadPhone, marketing, ...partnerValues } = values;

  try {
    const { upsertPartner, createLead, addToMailingList } = deps.odoo();
    const partner = await upsertPartner(partnerValues);
    if (process.env.DEBUG) console.log(`[submission-created] Odoo upsert (${formName}):`, partner && (partner.id || (partner.isMock ? 'mock' : '')));
    if (partner && partner.id && leadSubject) {
      const leadData = { subject: leadSubject(partnerValues), partnerId: partner.id, email: leadEmail || partnerValues.email, description: partnerValues.comment };
      if (leadContact) leadData.contactName = leadContact;
      if (leadPhone || partnerValues.phone) leadData.phone = leadPhone || partnerValues.phone;
      await createLead(leadData);
    }
    /* Email Marketing: SOLO con opt-in de marketing (Ley 1581). Se intenta aun en
       modo mock (no-op) para que el flujo sea idéntico con y sin credenciales. */
    const marketingEmail = (marketing && (marketing.email || partnerValues.email)) || '';
    if (marketing && marketingEmail) {
      await addToMailingList({
        email: marketingEmail,
        name: marketing.name || partnerValues.name,
        listName: marketing.listName
      });
      if (process.env.DEBUG) console.log(`[submission-created] Email Marketing (${formName}): ${marketingEmail} → ${marketing.listName}`);
    }
  } catch (err) {
    console.error(`[submission-created] Odoo (${formName}) no fatal:`, err.message);
  }

  return { statusCode: 200, body: 'ok' };
}

exports.handler = (event) => handle(event, defaultDeps());

exports._test = {
  FORM_HANDLERS, TEAM_NOTIFY_FORMS, isChecked, hasMarketingOptIn,
  buildJobApplication, safeHttpUrl, langFromReferrer, handle
};
