require('./_env');
const { authorize } = require('./_authz');
const { flag } = require('./_settings');

/* POST — acciones de facturación electrónica desde /admin (emitir factura, anular,
   nota crédito). GATED STUB por ahora: la emisión real vía Numera está en DRY-RUN
   (ver _numera.js). Mientras NUMERA_INVOICING_ENABLED no esté en 'true', este
   endpoint NO llama a Numera ni mueve nada; responde 200 { ok:false,
   reason:'disabled' } para que la UI sepa que la facturación está apagada.

   Cuando se encienda (flag ON + credenciales Numera cargadas), aquí se enganchará
   _numera.sendInvoice con el payload correspondiente (buildInvoicePayload). El
   hook queda marcado abajo con TODO(NUMERA).

   Cada acción exige su permiso atómico:
     emit / void / credit-note → invoices.issue
   Copia el patrón de refund-admin-action.js (auth por acción, CORS, errores). */

/* Acciones válidas → permiso atómico. Hoy todas caen bajo invoices.issue
   (emitir/anular/nota crédito son la misma capacidad de "tocar" la facturación). */
const ACTION_PERMISSION = {
  'emit': 'invoices.issue',
  'void': 'invoices.issue',
  'credit-note': 'invoices.issue'
};

/* Tipo de documento Numera por acción (para cuando se conecte la emisión real). */
const ACTION_TIPO_FACTURA = {
  'emit': 'InvoiceType',
  'void': 'DebitNoteType',        /* TODO(NUMERA): confirmar cómo modela Numera la anulación */
  'credit-note': 'CreditNoteType'
};

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON inválido' }) }; }

  const action = String(body.action || '').trim();
  const bookingCode = String(body.bookingCode || body.invoiceId || '').trim();
  if (!ACTION_PERMISSION[action]) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Falta action válido (emit|void|credit-note)' }) };
  }

  /* Autoriza según la acción: cada una exige su permiso atómico. */
  const auth = await authorize(event, ACTION_PERMISSION[action]);
  if (!auth.ok) return { statusCode: auth.statusCode, headers, body: JSON.stringify({ error: auth.error }) };

  /* GATE de facturación: mientras el flag esté apagado (o sin credenciales
     Numera) NO se emite nada. Respuesta 200 explícita para que el panel muestre
     "facturación desactivada" sin tratarlo como error. */
  const enabled = await flag('NUMERA_INVOICING_ENABLED');
  if (!enabled) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: false,
        reason: 'disabled',
        message: 'La facturación electrónica está desactivada (NUMERA_INVOICING_ENABLED). No se emitió nada.'
      })
    };
  }

  /* TODO(NUMERA): a partir de aquí, con el flag encendido y las credenciales
     cargadas, conectar la emisión real:
       const { buildInvoicePayload, sendInvoice } = require('./_numera');
       const payload = buildInvoicePayload({ reserva, huesped, lineas, impuestos,
         tipo: ACTION_TIPO_FACTURA[action] });
       const result = await sendInvoice(payload);
     y persistir el resultado (número legal / CUFE / PDF) en el store 'invoices'.
     Se deja como STUB hasta validar el payload real contra la respuesta del
     proveedor (los TODO(NUMERA) de _numera.js). No inventamos el mapeo aquí. */
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      ok: false,
      reason: 'not-implemented',
      message: 'Facturación habilitada pero la emisión real aún no está conectada (pendiente validar el payload con Numera).',
      action,
      bookingCode: bookingCode || null,
      tipoFactura: ACTION_TIPO_FACTURA[action] || null
    })
  };
};
