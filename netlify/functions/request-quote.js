require('./_env');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limit');
const { nightsBetween } = require('./_quotes-store');

/* Etiqueta de motivo de viaje (para enriquecer la ficha del cliente en Odoo)
   derivada del tipo de estadía del formulario corporativo. */
const TIPO_MOTIVO = {
  corta: 'Estadía corta corporativa',
  larga: 'Larga estadía corporativa',
  rotativa: 'Estadía rotativa corporativa'
};

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildNotificationEmailHtml(data) {
  const tipoLabels = {
    corta: 'Corta (1–29 días)',
    larga: 'Larga (+30 días)',
    rotativa: 'Rotativa'
  };
  const tipoLabel = tipoLabels[data.tipoEstadia] || esc(data.tipoEstadia);

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>Nueva solicitud de cotización — ${esc(data.empresa)}</title>
</head>
<body style="margin:0;padding:0;background-color:#F5F3EE;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F5F3EE;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.07);">

        <!-- Header -->
        <tr>
          <td style="background-color:#2C2C2C;padding:28px 40px;text-align:center;">
            <p style="margin:0 0 4px 0;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#C4956A;">Hotel Estar — Portal B2B</p>
            <p style="margin:0;font-size:18px;font-weight:700;letter-spacing:0.06em;color:#FFFFFF;">Nueva solicitud de cotización</p>
          </td>
        </tr>

        <!-- Alert band -->
        <tr>
          <td style="background-color:#9B9065;padding:16px 40px;">
            <p style="margin:0;font-size:13px;color:#FFFFFF;font-weight:700;">
              📋 ${esc(data.empresa)} — requiere cotización
            </p>
          </td>
        </tr>

        <!-- Data table -->
        <tr>
          <td style="padding:28px 40px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E8E4DC;border-radius:8px;overflow:hidden;">

              <tr>
                <td style="padding:12px 16px;background:#FAF8F4;border-bottom:1px solid #E8E4DC;width:40%;">
                  <p style="margin:0;font-size:10px;text-transform:uppercase;letter-spacing:0.12em;color:#9A9A8A;">Empresa</p>
                </td>
                <td style="padding:12px 16px;background:#FAF8F4;border-bottom:1px solid #E8E4DC;">
                  <p style="margin:0;font-size:14px;color:#2C2C2C;font-weight:700;">${esc(data.empresa)}</p>
                </td>
              </tr>

              <tr>
                <td style="padding:12px 16px;border-bottom:1px solid #E8E4DC;">
                  <p style="margin:0;font-size:10px;text-transform:uppercase;letter-spacing:0.12em;color:#9A9A8A;">Contacto</p>
                </td>
                <td style="padding:12px 16px;border-bottom:1px solid #E8E4DC;">
                  <p style="margin:0;font-size:14px;color:#2C2C2C;">${esc(data.contacto)}</p>
                </td>
              </tr>

              <tr>
                <td style="padding:12px 16px;background:#FAF8F4;border-bottom:1px solid #E8E4DC;">
                  <p style="margin:0;font-size:10px;text-transform:uppercase;letter-spacing:0.12em;color:#9A9A8A;">Email</p>
                </td>
                <td style="padding:12px 16px;background:#FAF8F4;border-bottom:1px solid #E8E4DC;">
                  <p style="margin:0;font-size:13px;color:#2C2C2C;">${esc(data.email)}</p>
                </td>
              </tr>

              <tr>
                <td style="padding:12px 16px;border-bottom:1px solid #E8E4DC;">
                  <p style="margin:0;font-size:10px;text-transform:uppercase;letter-spacing:0.12em;color:#9A9A8A;">WhatsApp</p>
                </td>
                <td style="padding:12px 16px;border-bottom:1px solid #E8E4DC;">
                  <p style="margin:0;font-size:13px;color:#2C2C2C;">${esc(data.whatsapp || '—')}</p>
                </td>
              </tr>

              <tr>
                <td style="padding:12px 16px;background:#FAF8F4;border-bottom:1px solid #E8E4DC;">
                  <p style="margin:0;font-size:10px;text-transform:uppercase;letter-spacing:0.12em;color:#9A9A8A;">Check-in</p>
                </td>
                <td style="padding:12px 16px;background:#FAF8F4;border-bottom:1px solid #E8E4DC;">
                  <p style="margin:0;font-size:13px;color:#2C2C2C;">${esc(data.fechaCheckin || '—')}</p>
                </td>
              </tr>

              <tr>
                <td style="padding:12px 16px;border-bottom:1px solid #E8E4DC;">
                  <p style="margin:0;font-size:10px;text-transform:uppercase;letter-spacing:0.12em;color:#9A9A8A;">Check-out</p>
                </td>
                <td style="padding:12px 16px;border-bottom:1px solid #E8E4DC;">
                  <p style="margin:0;font-size:13px;color:#2C2C2C;">${esc(data.fechaCheckout || '—')}</p>
                </td>
              </tr>

              <tr>
                <td style="padding:12px 16px;background:#FAF8F4;border-bottom:1px solid #E8E4DC;">
                  <p style="margin:0;font-size:10px;text-transform:uppercase;letter-spacing:0.12em;color:#9A9A8A;">Habitaciones</p>
                </td>
                <td style="padding:12px 16px;background:#FAF8F4;border-bottom:1px solid #E8E4DC;">
                  <p style="margin:0;font-size:14px;color:#2C2C2C;font-weight:700;">${esc(data.numHabitaciones || '—')}</p>
                </td>
              </tr>

              <tr>
                <td style="padding:12px 16px;border-bottom:1px solid #E8E4DC;">
                  <p style="margin:0;font-size:10px;text-transform:uppercase;letter-spacing:0.12em;color:#9A9A8A;">Tipo de estadía</p>
                </td>
                <td style="padding:12px 16px;border-bottom:1px solid #E8E4DC;">
                  <p style="margin:0;font-size:13px;color:#2C2C2C;">${tipoLabel}</p>
                </td>
              </tr>

              ${data.comentarios ? `
              <tr>
                <td style="padding:12px 16px;background:#FAF8F4;">
                  <p style="margin:0;font-size:10px;text-transform:uppercase;letter-spacing:0.12em;color:#9A9A8A;">Comentarios</p>
                </td>
                <td style="padding:12px 16px;background:#FAF8F4;">
                  <p style="margin:0;font-size:13px;color:#555550;line-height:1.6;">${esc(data.comentarios)}</p>
                </td>
              </tr>` : ''}

            </table>
          </td>
        </tr>

        <!-- CTA to admin -->
        <tr>
          <td style="padding:0 40px 32px 40px;text-align:center;">
            <a href="https://estar.com.co/admin" style="display:inline-block;padding:14px 28px;background-color:#28292B;border-radius:8px;font-size:12px;font-weight:700;color:#FFFFFF;text-decoration:none;letter-spacing:0.1em;text-transform:uppercase;">
              Crear cotización en el portal →
            </a>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #E8E4DC;margin:0;"/></td>
        </tr>
        <tr>
          <td style="padding:20px 40px;text-align:center;">
            <p style="margin:0;font-size:10px;color:#BCBCB0;">Solicitud recibida desde estar.com.co/empresas.html · Portal B2B Hotel Estar</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

exports.handler = async (event, context) => {
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  const corsHeaders = {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  if (allowedOrigin) corsHeaders['Access-Control-Allow-Origin'] = allowedOrigin;

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  const limited = await checkRateLimit(event, { name: 'request-quote', limit: 8, windowMs: 15 * 60 * 1000 });
  if (!limited.ok) return rateLimitResponse(corsHeaders, limited.retryAfter);

  if (event.body && event.body.length > 5000) return { statusCode: 413, headers: corsHeaders, body: JSON.stringify({ error: 'Payload demasiado grande' }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'JSON inválido' }) }; }

  // Honeypot check
  if (body.website) {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ received: true }) };
  }

  const { empresa, contacto, email } = body;
  if (!empresa || !contacto || !email) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Faltan campos requeridos: empresa, contacto, email' }) };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Email inválido' }) };
  }

  /* Opt-in de marketing (Ley 1581): consentimiento SEPARADO de la aceptación de
     la política de privacidad (que es obligatoria y NO implica marketing). El
     checkbox público canónico es `marketingOptIn`; sin marcar = NO marketing. */
  const marketingOptIn = (() => {
    const v = body.marketingOptIn;
    if (v === true) return true;
    const s = String(v == null ? '' : v).trim().toLowerCase();
    return s !== '' && s !== 'false' && s !== 'no' && s !== 'off' && s !== '0';
  })();

  const sanitized = {
    empresa: String(empresa).slice(0, 200),
    contacto: String(contacto).slice(0, 200),
    email: String(email).slice(0, 254),
    whatsapp: String(body.whatsapp || '').slice(0, 50),
    fechaCheckin: String(body.fechaCheckin || '').slice(0, 20),
    fechaCheckout: String(body.fechaCheckout || '').slice(0, 20),
    numHabitaciones: parseInt(body.numHabitaciones) || 1,
    tipoEstadia: ['corta', 'larga', 'rotativa'].includes(body.tipoEstadia) ? body.tipoEstadia : 'corta',
    comentarios: String(body.comentarios || '').slice(0, 1000),
    marketingOptIn
  };

  /* Maestro de clientes (Fase 1): empresa como partner en Odoo + oportunidad
     CRM. Va ANTES del envío de email para que la sincronización NO dependa de
     RESEND (si falta la key, igual entra el cliente). No fatal — nunca bloquea
     la solicitud. Mock sin credenciales de Odoo. */
  let leadId = null;
  try {
    const { upsertPartner, createLead, addToMailingList } = require('./_odoo');
    /* Etiquetas: 'Corporativo' siempre; 'Opt-in marketing' solo con opt-in
       explícito. La nota deja constancia del consentimiento (aceptación + fecha
       + canal) para evidencia (Ley 1581). */
    const tags = sanitized.marketingOptIn ? ['Corporativo', 'Opt-in marketing'] : ['Corporativo'];
    const optInNote = sanitized.marketingOptIn
      ? ` Opt-in marketing aceptado (empresas.html) el ${new Date().toISOString().slice(0, 10)}.`
      : '';
    const partner = await upsertPartner({
      name: sanitized.empresa,
      email: sanitized.email,
      phone: sanitized.whatsapp,
      isCompany: true,
      tags,
      comment: `Contacto: ${sanitized.contacto}. Origen: formulario corporativo (empresas.html).${optInNote}`,
      /* Datos de estadía para enriquecer la ficha (campos estándar, sin x_). */
      lastCheckout: sanitized.fechaCheckout || undefined,
      nights: nightsBetween(sanitized.fechaCheckin, sanitized.fechaCheckout) || undefined,
      motive: TIPO_MOTIVO[sanitized.tipoEstadia]
    });
    /* Email Marketing: SOLO con opt-in (Ley 1581). Se intenta aun en modo mock
       (no-op) para que el flujo sea idéntico con y sin credenciales. La empresa
       no tiene "nombre de persona" propio: usamos el contacto como nombre. */
    if (sanitized.marketingOptIn) {
      await addToMailingList({ email: sanitized.email, name: sanitized.contacto, listName: 'Newsletter' });
      if (process.env.DEBUG) console.log('[request-quote] Email Marketing opt-in:', sanitized.email, '→ Newsletter');
    }
    if (partner && partner.id) {
      const lead = await createLead({
        subject: `Cotización corporativa — ${sanitized.empresa}`,
        partnerId: partner.id,
        contactName: sanitized.contacto,
        email: sanitized.email,
        phone: sanitized.whatsapp,
        description: `Tipo de estadía: ${sanitized.tipoEstadia}. Habitaciones: ${sanitized.numHabitaciones}. Fechas: ${sanitized.fechaCheckin || '—'} → ${sanitized.fechaCheckout || '—'}. ${sanitized.comentarios || ''}`.trim()
      });
      /* Guardamos el leadId para correlacionar el cierre del embudo más tarde.
         La solicitud pública NO persiste una cotización (la crea el admin en
         create-quote), así que el cron la correlaciona por correo; aquí solo lo
         dejamos trazado. NO se devuelve al cliente: es un id interno de CRM y
         este endpoint es público sin autenticación. */
      if (lead && lead.id) {
        leadId = lead.id;
        if (process.env.DEBUG) console.log('[request-quote] lead CRM creado:', leadId, 'para', sanitized.email);
      }
    }
  } catch (odooErr) {
    console.error('[request-quote] Odoo (cliente/lead) no fatal:', odooErr.message);
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    if (process.env.DEBUG) console.log('[request-quote] RESEND_API_KEY no configurada. Solicitud recibida:', sanitized.empresa);
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ received: true }) };
  }

  const emailHtml = buildNotificationEmailHtml(sanitized);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    let res;
    try {
      res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Portal B2B Estar <reservas@estar.com.co>',
          to: 'reservas@estar.com.co',
          reply_to: sanitized.email,
          subject: `Nueva solicitud de cotización — ${sanitized.empresa}`,
          html: emailHtml
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') return { statusCode: 504, headers: corsHeaders, body: JSON.stringify({ error: 'Timeout' }) };
      throw err;
    }

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      console.error('[request-quote] Resend error:', res.status, errData?.message || '');
    }
  } catch (err) {
    console.error('[request-quote] Error enviando notificación:', err.message);
  }

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({ received: true })
  };
};
