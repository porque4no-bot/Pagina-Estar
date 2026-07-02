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

/* Mapea los formularios nativos del sitio a cómo se crean en Odoo. Cada handler
   devuelve los valores de partner; opcionalmente, `lead` (asunto de la
   oportunidad CRM) y `marketing` (si el envío trae opt-in de marketing y, por
   tanto, debe entrar a la lista de Email Marketing). Añadir aquí otros forms
   (p. ej. el de convenios de empresas.html) es trivial. */
const FORM_HANDLERS = {
  'estancias-largas': (data) => {
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
      comment: 'Solicitud de larga estadía (vivir.html). ' + [
        data.motivo_viaje ? `Motivo: ${data.motivo_viaje}` : '',
        data.tiempo_estimado ? `Tiempo: ${data.tiempo_estimado}` : '',
        data.tipologia ? `Tipología: ${data.tipologia}` : '',
        data.fecha_mudanza ? `Mudanza: ${data.fecha_mudanza}` : '',
        data.mensaje ? `Nota: ${data.mensaje}` : '',
        optInMarketing ? optInNote('vivir.html') : ''
      ].filter(Boolean).join('. '),
      lead: (v) => `Larga estadía — ${v.name}`
    };
    /* Marketing SOLO con opt-in explícito (el form trae su propio checkbox de
       privacidad obligatorio, que NO es consentimiento de marketing). */
    if (optInMarketing && email) values.marketing = { listName: 'Newsletter', name };
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

exports.handler = async (event) => {
  let payload;
  try {
    payload = JSON.parse(event.body || '{}').payload;
  } catch (e) {
    return { statusCode: 200, body: 'ignored (cuerpo inválido)' };
  }
  if (!payload) return { statusCode: 200, body: 'ignored (sin payload)' };

  const formName = payload.form_name || (payload.data && payload.data['form-name']) || '';
  const data = payload.data || {};

  const buildValues = FORM_HANDLERS[formName];
  if (!buildValues) return { statusCode: 200, body: `ignored (form ${formName})` };

  const values = buildValues(data);
  /* `null` = el handler decidió no sincronizar (p. ej. newsletter sin opt-in de
     marketing). Respuesta 200 igual: no es un error, es la decisión legal. */
  if (!values) return { statusCode: 200, body: `ignored (sin opt-in / no sincronizable: ${formName})` };
  if (!values.name && !values.email) {
    return { statusCode: 200, body: 'ignored (sin nombre ni correo)' };
  }

  /* `lead` (asunto de la oportunidad) y `marketing` (datos de la lista de Email
     Marketing) son metadatos de enrutado, no campos de res.partner: se sacan de
     los valores antes de llamar a upsertPartner. */
  const { lead: leadSubject, marketing, ...partnerValues } = values;

  try {
    const { upsertPartner, createLead, addToMailingList } = require('./_odoo');
    const partner = await upsertPartner(partnerValues);
    if (process.env.DEBUG) console.log(`[submission-created] Odoo upsert (${formName}):`, partner && (partner.id || (partner.isMock ? 'mock' : '')));
    if (partner && partner.id && leadSubject) {
      await createLead({ subject: leadSubject(partnerValues), partnerId: partner.id, email: partnerValues.email, description: partnerValues.comment });
    }
    /* Email Marketing: SOLO con opt-in de marketing (Ley 1581). Se intenta aun en
       modo mock (no-op) para que el flujo sea idéntico con y sin credenciales. */
    if (marketing && partnerValues.email) {
      await addToMailingList({
        email: partnerValues.email,
        name: marketing.name || partnerValues.name,
        listName: marketing.listName
      });
      if (process.env.DEBUG) console.log(`[submission-created] Email Marketing (${formName}): ${partnerValues.email} → ${marketing.listName}`);
    }
  } catch (err) {
    console.error(`[submission-created] Odoo (${formName}) no fatal:`, err.message);
  }

  return { statusCode: 200, body: 'ok' };
};

exports._test = { FORM_HANDLERS, isChecked, hasMarketingOptIn };
