require('./_env');

/* Función disparada por evento de Netlify: se invoca automáticamente en CADA
   envío de un formulario nativo de Netlify (evento `submission-created`). No la
   llama el navegador — la llama Netlify del lado servidor tras capturar el form,
   así que no necesita CORS ni validación de método.

   Maestro de clientes (Fase 1): el formulario de larga estadía de `vivir.html`
   (`estancias-largas`) crea/actualiza al solicitante como partner (persona) en
   Odoo, deduplicado por email. El form sigue siendo nativo de Netlify: esto solo
   AÑADE la sincronización, no cambia la captura existente.

   No fatal y siempre responde 200: un error de Odoo nunca debe hacer que Netlify
   reintente ni que se pierda el lead. Sin credenciales de Odoo es un no-op mock. */

/* Mapea los formularios nativos del sitio a cómo se crean en Odoo. Añadir aquí
   otros forms (p. ej. el de convenios de empresas.html) es trivial. */
const FORM_HANDLERS = {
  'estancias-largas': (data) => ({
    name: (data.nombre || '').trim() || (data.correo || '').trim(),
    email: (data.correo || '').trim(),
    isCompany: false,
    tags: ['Larga estadía'],
    comment: 'Solicitud de larga estadía (vivir.html). ' + [
      data.motivo_viaje ? `Motivo: ${data.motivo_viaje}` : '',
      data.tiempo_estimado ? `Tiempo: ${data.tiempo_estimado}` : '',
      data.tipologia ? `Tipología: ${data.tipologia}` : '',
      data.fecha_mudanza ? `Mudanza: ${data.fecha_mudanza}` : '',
      data.mensaje ? `Nota: ${data.mensaje}` : ''
    ].filter(Boolean).join('. ')
  })
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
  if (!values.name && !values.email) {
    return { statusCode: 200, body: 'ignored (sin nombre ni correo)' };
  }

  try {
    const { upsertPartner } = require('./_odoo');
    const r = await upsertPartner(values);
    if (process.env.DEBUG) console.log(`[submission-created] Odoo upsert (${formName}):`, r && (r.id || (r.isMock ? 'mock' : '')));
  } catch (err) {
    console.error(`[submission-created] Odoo upsert (${formName}) no fatal:`, err.message);
  }

  return { statusCode: 200, body: 'ok' };
};

exports._test = { FORM_HANDLERS };
