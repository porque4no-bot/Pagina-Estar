require('./_env');
const { authorize } = require('./_authz');
const { getQuoteStore, loadQuote } = require('./_quotes-store');

function formatCOP(amount) {
  if (!amount && amount !== 0) return '$ 0';
  return '$ ' + Math.round(amount).toLocaleString('es-CO');
}

function formatDateES(isoStr) {
  if (!isoStr) return '';
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  return `${d.getUTCDate()} de ${months[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}

function obfuscateEmail(email) {
  if (!email || typeof email !== 'string') return '';
  const [name, domain] = email.split('@');
  if (!domain) return '***';
  return name.length > 2 ? `${name[0]}***${name[name.length - 1]}@${domain}` : `***@${domain}`;
}

const SVC_LABELS = { desayuno: 'Desayuno', almuerzo: 'Almuerzo', cena: 'Cena', personaAdicional: 'Persona adicional' };
const SVC_TAX = { desayuno: 'inc', almuerzo: 'inc', cena: 'inc', personaAdicional: 'iva' };

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildQuoteEmailHtml({ quote, quoteUrl }) {
  const subtotalItems = quote.items.reduce((sum, item) => sum + item.subtotal, 0);

  /* Services and tax bases */
  const sv = quote.servicios || {};
  let baseIvaSvc = 0, baseInc = 0, baseNone = 0;
  const svcRows = [];
  ['desayuno', 'almuerzo', 'cena', 'personaAdicional'].forEach(k => {
    const s = sv[k];
    if (!s || !s.cantidad || !s.precioUnitario) return;
    const sub = s.cantidad * s.precioUnitario;
    if (SVC_TAX[k] === 'iva') baseIvaSvc += sub; else baseInc += sub;
    svcRows.push({ label: SVC_LABELS[k], cantidad: s.cantidad, precio: s.precioUnitario, sub });
  });
  (sv.otros || []).forEach(o => {
    if (!o.cantidad || !o.precioUnitario) return;
    const sub = o.cantidad * o.precioUnitario;
    if (o.impuesto === 'iva') baseIvaSvc += sub;
    else if (o.impuesto === 'inc') baseInc += sub;
    else baseNone += sub;
    svcRows.push({ label: o.descripcion, cantidad: o.cantidad, precio: o.precioUnitario, sub });
  });

  const subtotal = subtotalItems + baseIvaSvc + baseInc + baseNone;
  let descuentoAmt = 0;
  if (quote.descuento && quote.descuento.valor > 0) {
    descuentoAmt = quote.descuento.tipo === 'porcentaje'
      ? subtotal * (quote.descuento.valor / 100)
      : quote.descuento.valor;
  }
  descuentoAmt = Math.min(descuentoAmt, subtotal);

  const ivaRate = (quote.impuestos && quote.impuestos.ivaRate) || 0.19;
  const incRate = (quote.impuestos && quote.impuestos.incRate) || 0.08;
  const factor = subtotal > 0 ? (subtotal - descuentoAmt) / subtotal : 0;
  const iva = (subtotalItems + baseIvaSvc) * factor * ivaRate;
  const inc = baseInc * factor * incRate;
  const total = (subtotal - descuentoAmt) + iva + inc;

  const svcRowsHtml = svcRows.map(r => `
    <tr>
      <td colspan="3" style="padding:10px 16px;border-bottom:1px solid #E8E4DC;font-family:Arial,sans-serif;font-size:13px;color:#555550;">${escHtml(r.label)} <span style="color:#9A9A8A;">(${r.cantidad} × ${formatCOP(r.precio)})</span></td>
      <td style="padding:10px 16px;border-bottom:1px solid #E8E4DC;font-family:Georgia,serif;font-size:14px;color:#2C2C2C;text-align:right;" colspan="2">${formatCOP(r.sub)}</td>
    </tr>
  `).join('');

  const subtotalRow = `
    <tr>
      <td colspan="4" style="padding:10px 16px;font-family:Arial,sans-serif;font-size:13px;color:#555550;text-align:right;">Subtotal</td>
      <td style="padding:10px 16px;font-family:Arial,sans-serif;font-size:13px;color:#2C2C2C;text-align:right;">${formatCOP(subtotal)}</td>
    </tr>`;

  const taxRows = `
    ${iva > 0 ? `<tr><td colspan="4" style="padding:8px 16px;font-family:Arial,sans-serif;font-size:12px;color:#9A9A8A;text-align:right;">IVA 19%</td><td style="padding:8px 16px;font-family:Arial,sans-serif;font-size:12px;color:#555550;text-align:right;">${formatCOP(iva)}</td></tr>` : ''}
    ${inc > 0 ? `<tr><td colspan="4" style="padding:8px 16px;font-family:Arial,sans-serif;font-size:12px;color:#9A9A8A;text-align:right;">INC 8%</td><td style="padding:8px 16px;font-family:Arial,sans-serif;font-size:12px;color:#555550;text-align:right;">${formatCOP(inc)}</td></tr>` : ''}
  `;

  const itemRows = quote.items.map(item => `
    <tr>
      <td style="padding:12px 16px;border-bottom:1px solid #E8E4DC;font-family:Georgia,serif;font-size:14px;color:#2C2C2C;">${item.habitacion}</td>
      <td style="padding:12px 16px;border-bottom:1px solid #E8E4DC;font-family:Arial,sans-serif;font-size:13px;color:#555550;text-align:center;">${item.unidades}</td>
      <td style="padding:12px 16px;border-bottom:1px solid #E8E4DC;font-family:Arial,sans-serif;font-size:13px;color:#555550;text-align:center;">${item.noches}</td>
      <td style="padding:12px 16px;border-bottom:1px solid #E8E4DC;font-family:Arial,sans-serif;font-size:13px;color:#555550;text-align:right;">${formatCOP(item.tarifaPorNoche)}</td>
      <td style="padding:12px 16px;border-bottom:1px solid #E8E4DC;font-family:Georgia,serif;font-size:14px;color:#2C2C2C;font-weight:700;text-align:right;">${formatCOP(item.subtotal)}</td>
    </tr>
  `).join('');

  const discountRow = descuentoAmt > 0 ? `
    <tr>
      <td colspan="4" style="padding:10px 16px;font-family:Arial,sans-serif;font-size:13px;color:#555550;text-align:right;">
        Descuento (${quote.descuento.tipo === 'porcentaje' ? quote.descuento.valor + '%' : 'valor fijo'})
      </td>
      <td style="padding:10px 16px;font-family:Arial,sans-serif;font-size:13px;color:#AF6D3B;text-align:right;">-${formatCOP(descuentoAmt)}</td>
    </tr>
  ` : '';

  const condicionesSection = quote.condiciones ? `
    <tr>
      <td style="padding:0 40px 28px 40px;">
        <p style="margin:0 0 8px 0;font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#9A9A8A;">Condiciones especiales</p>
        <p style="margin:0;font-family:Georgia,serif;font-size:13px;color:#555550;line-height:1.65;">${quote.condiciones.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br/>')}</p>
      </td>
    </tr>
  ` : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Cotización ${quote.quoteId} — Estar Manizales</title>
</head>
<body style="margin:0;padding:0;background-color:#F5F3EE;font-family:Georgia,'Times New Roman',serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F5F3EE;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.07);">

        <!-- Header -->
        <tr>
          <td style="background-color:#2C2C2C;padding:36px 40px;text-align:center;">
            <p style="margin:0 0 4px 0;font-family:Georgia,serif;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#C4956A;">Hotel Apartamento</p>
            <h1 style="margin:0;font-family:Georgia,serif;font-size:32px;font-weight:400;letter-spacing:0.06em;color:#FFFFFF;">ESTAR</h1>
            <p style="margin:6px 0 0 0;font-family:Arial,sans-serif;font-size:11px;letter-spacing:0.12em;color:#9A9A8A;text-transform:uppercase;">Manizales, Colombia</p>
          </td>
        </tr>

        <!-- Quote hero -->
        <tr>
          <td style="background-color:#9B9065;padding:28px 40px;text-align:center;">
            <p style="margin:0 0 8px 0;font-family:Arial,sans-serif;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#FFFFFF;opacity:0.85;">Cotización Comercial</p>
            <p style="margin:0;font-family:'Courier New',Courier,monospace;font-size:24px;font-weight:700;letter-spacing:0.08em;color:#FFFFFF;">${quote.quoteId}</p>
          </td>
        </tr>

        <!-- Greeting -->
        <tr>
          <td style="padding:32px 40px 20px 40px;">
            <p style="margin:0;font-family:Georgia,serif;font-size:16px;color:#2C2C2C;line-height:1.6;">
              Estimado/a <strong>${(quote.contacto || quote.empresa).replace(/&/g,'&amp;').replace(/</g,'&lt;')}</strong>,
            </p>
            <p style="margin:12px 0 0 0;font-family:Georgia,serif;font-size:14px;color:#555550;line-height:1.7;">
              A continuación encontrará la cotización comercial preparada por el equipo de <strong>Hotel Estar</strong>.
              Esta cotización es válida hasta el <strong>${formatDateES(quote.expiresAt)}</strong>.
            </p>
          </td>
        </tr>

        <!-- Client info -->
        <tr>
          <td style="padding:0 40px 20px 40px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E8E4DC;border-radius:8px;overflow:hidden;">
              <tr>
                <td style="padding:14px 18px;background:#FAF8F4;border-bottom:1px solid #E8E4DC;width:50%;">
                  <p style="margin:0 0 3px 0;font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#9A9A8A;">Empresa</p>
                  <p style="margin:0;font-family:Georgia,serif;font-size:14px;color:#2C2C2C;font-weight:700;">${quote.empresa.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</p>
                </td>
                <td style="padding:14px 18px;background:#FAF8F4;border-bottom:1px solid #E8E4DC;border-left:1px solid #E8E4DC;">
                  <p style="margin:0 0 3px 0;font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#9A9A8A;">Contacto</p>
                  <p style="margin:0;font-family:Georgia,serif;font-size:14px;color:#2C2C2C;">${(quote.contacto || '—').replace(/&/g,'&amp;').replace(/</g,'&lt;')}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:14px 18px;">
                  <p style="margin:0 0 3px 0;font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#9A9A8A;">Email</p>
                  <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#2C2C2C;">${quote.email}</p>
                </td>
                <td style="padding:14px 18px;border-left:1px solid #E8E4DC;">
                  <p style="margin:0 0 3px 0;font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#9A9A8A;">Válida hasta</p>
                  <p style="margin:0;font-family:Georgia,serif;font-size:13px;color:#2C2C2C;">${formatDateES(quote.expiresAt)}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Items table -->
        <tr>
          <td style="padding:0 40px 8px 40px;">
            <p style="margin:0 0 10px 0;font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#9A9A8A;">Detalle de la cotización</p>
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E8E4DC;border-radius:8px;overflow:hidden;">
              <thead>
                <tr style="background:#FAF8F4;">
                  <th style="padding:10px 16px;text-align:left;font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#9A9A8A;border-bottom:2px solid #E8E4DC;">Tipología</th>
                  <th style="padding:10px 16px;text-align:center;font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#9A9A8A;border-bottom:2px solid #E8E4DC;">Und.</th>
                  <th style="padding:10px 16px;text-align:center;font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#9A9A8A;border-bottom:2px solid #E8E4DC;">Noches</th>
                  <th style="padding:10px 16px;text-align:right;font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#9A9A8A;border-bottom:2px solid #E8E4DC;">Tarifa/noche</th>
                  <th style="padding:10px 16px;text-align:right;font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#9A9A8A;border-bottom:2px solid #E8E4DC;">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                ${itemRows}
                ${svcRowsHtml}
                ${subtotalRow}
                ${discountRow}
                ${taxRows}
                <tr style="background:#FAF8F4;">
                  <td colspan="4" style="padding:14px 16px;font-family:Arial,sans-serif;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#2C2C2C;text-align:right;border-top:2px solid #E8E4DC;">Total</td>
                  <td style="padding:14px 16px;font-family:Georgia,serif;font-size:20px;font-weight:700;color:#C4956A;text-align:right;border-top:2px solid #E8E4DC;">${formatCOP(total)}</td>
                </tr>
              </tbody>
            </table>
          </td>
        </tr>

        ${condicionesSection}

        <!-- CTA -->
        <tr>
          <td style="padding:24px 40px 32px 40px;text-align:center;">
            <p style="margin:0 0 20px 0;font-family:Georgia,serif;font-size:14px;color:#555550;line-height:1.7;">
              Para ver la cotización completa, aceptarla o realizar su reserva, haga clic en el botón de abajo.
            </p>
            <a href="${quoteUrl}" style="display:inline-block;padding:16px 36px;background-color:#9B9065;border-radius:8px;font-family:Arial,sans-serif;font-size:13px;font-weight:700;color:#FFFFFF;text-decoration:none;letter-spacing:0.08em;text-transform:uppercase;">
              Ver cotización completa →
            </a>
          </td>
        </tr>

        <!-- Policies -->
        <tr>
          <td style="padding:0 40px 28px 40px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F0EDE6;border-radius:8px;padding:18px 22px;">
              <tr><td>
                <p style="margin:0 0 10px 0;font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#7A7A6A;">Políticas</p>
                <p style="margin:0 0 6px 0;font-family:Arial,sans-serif;font-size:12px;color:#555550;line-height:1.6;">✓ Cancelación gratuita con 48 horas de anticipación.</p>
                <p style="margin:0 0 6px 0;font-family:Arial,sans-serif;font-size:12px;color:#555550;line-height:1.6;">✓ Pago a crédito sujeto a aprobación de la empresa.</p>
                <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#555550;line-height:1.6;">✓ Impuestos (IVA 19% / INC 8%) detallados en el total.</p>
              </td></tr>
            </table>
          </td>
        </tr>

        <!-- Divider -->
        <tr><td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #E8E4DC;margin:0;"/></td></tr>

        <!-- Footer -->
        <tr>
          <td style="padding:22px 40px;text-align:center;">
            <p style="margin:0 0 6px 0;font-family:Arial,sans-serif;font-size:11px;color:#9A9A8A;">
              <strong style="color:#555550;">Hotel Estar</strong> · Cl. 61 #23-36, La Estrella · Manizales, Caldas, Colombia
            </p>
            <p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:#9A9A8A;">
              reservas@estar.com.co · +57 310 249 0414 · RNT 276306
            </p>
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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  if (allowedOrigin) corsHeaders['Access-Control-Allow-Origin'] = allowedOrigin;

  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method Not Allowed' }) };

    const auth = await authorize(event, 'quotes.send');
    if (!auth.ok) return { statusCode: auth.statusCode, headers: corsHeaders, body: JSON.stringify({ error: auth.error }) };

    let body;
    try { body = JSON.parse(event.body); }
    catch (e) { return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'JSON inválido' }) }; }

    const { quoteId, clientEmail, clientName, quoteUrl } = body;

    if (!quoteId || !clientEmail || !quoteUrl) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Faltan campos: quoteId, clientEmail, quoteUrl' }) };
    }

    if (!/^COT-\d{4}-[A-Z0-9]{5}$/.test(quoteId)) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'quoteId inválido' }) };
    }

    /* Load the quote: prefer the stored copy (id-based links); fall back to legacy ?d= */
    let quoteData = null;
    try {
      const store = getQuoteStore();
      quoteData = await loadQuote(store, quoteId);
    } catch (e) {
      quoteData = null;
    }

    if (!quoteData) {
      try {
        const urlObj = new URL(quoteUrl);
        const encoded = urlObj.searchParams.get('d');
        if (encoded) {
          const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
          const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
          quoteData = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
        }
      } catch (err) {
        console.error('[send-quote-email] decode error:', err.message);
      }
    }

    if (!quoteData) {
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Cotización no encontrada' }) };
    }
    if (quoteData.quoteId !== quoteId) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'quoteId no coincide con los datos de la cotización' }) };
    }

    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      if (process.env.DEBUG) console.log('[send-quote-email] RESEND_API_KEY no configurada. Omitiendo envío.');
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ sent: false, reason: 'RESEND_API_KEY not configured' }) };
    }

    const resolvedUrl = quoteUrl;
    const emailHtml = buildQuoteEmailHtml({ quote: quoteData, quoteUrl: resolvedUrl });
    const toEmail = clientEmail || quoteData.email;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    let res;
    try {
      res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Estar Manizales <reservas@estar.com.co>',
          to: toEmail,
          cc: 'reservas@estar.com.co',
          subject: `Cotización ${quoteId} — Hotel Estar Manizales`,
          html: emailHtml
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') return { statusCode: 504, headers: corsHeaders, body: JSON.stringify({ error: 'Timeout al enviar email' }) };
      throw err;
    }

    const resendData = await res.json();
    if (!res.ok) {
      console.error('[send-quote-email] Resend error:', res.status, resendData?.message || '');
      return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ sent: false, error: 'Error al enviar email' }) };
    }

    if (process.env.DEBUG) console.log(`[send-quote-email] Enviado a ${obfuscateEmail(toEmail)} para ${quoteId}`);
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ sent: true, resendId: resendData.id, to: obfuscateEmail(toEmail) })
    };
  } catch (err) {
    console.error('[send-quote-email] Error:', err.message);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ sent: false, error: 'Error interno del servidor', details: err.message }) };
  }
};
