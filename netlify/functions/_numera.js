require('./_env');

/*
 * _numera.js — cliente de facturación electrónica DIAN vía Numera + armador de
 * payload en DRY-RUN.
 *
 * ⚠️ IMPORTANTE: hoy esto NO emite de verdad en producción. `sendInvoice` está
 * gated por NUMERA_INVOICING_ENABLED (OFF por defecto) — con el flag apagado (o
 * sin credenciales) es un no-op logueado ({ ok:false, isMock:true }) y NO toca la
 * red. Sirve para armar y validar el payload (buildInvoicePayload + validate)
 * antes de conectar la emisión real contra la respuesta del proveedor.
 *
 * Mock-safe + best-effort: sin credenciales / flag OFF no llama a la red y NUNCA
 * lanza (salvo validate(), que sí reporta errores de armado del payload —
 * queremos enterarnos si las cuentas no cuadran ANTES de intentar emitir).
 *
 * API de Numera (según lo que nos pasaron):
 *   1) Login:  POST {NUMERA_API_BASE}/login/
 *      Content-Type: application/x-www-form-urlencoded, campos username y password
 *      → { access_token }
 *   2) Emitir: POST {NUMERA_API_BASE}/electronic-documents/send-electronic-invoice/
 *      header 'Auth: <access_token>'
 *      body { company_id, data: { encabezado, lineas, impuestos, cliente } }
 *      tipo_factura: InvoiceType | CreditNoteType (requiere ref_factura) | DebitNoteType
 *
 * Config (env; cargar en pre-producción):
 *   NUMERA_USERNAME           usuario Numera
 *   NUMERA_PASSWORD           contraseña Numera (SECRETO)
 *   NUMERA_COMPANY_ID         id de la empresa/emisor en Numera
 *   NUMERA_API_BASE           opcional, default https://esnumera.com/api/v1
 *   NUMERA_INVOICING_ENABLED  'true' para emitir de verdad (default OFF → mock)
 */

const TIPOS_FACTURA = ['InvoiceType', 'CreditNoteType', 'DebitNoteType'];

function numeraConfig() {
  return {
    username: process.env.NUMERA_USERNAME || '',
    password: process.env.NUMERA_PASSWORD || '',
    companyId: process.env.NUMERA_COMPANY_ID || '',
    apiBase: (process.env.NUMERA_API_BASE || 'https://esnumera.com/api/v1').replace(/\/+$/, ''),
    timeoutMs: parseInt(process.env.NUMERA_TIMEOUT_MS, 10) || 15000
  };
}

/* ¿Hay credenciales cargadas? (el flag NUMERA_INVOICING_ENABLED se revisa aparte,
   en sendInvoice, porque puede gestionarse desde /admin sin redeploy). */
function isConfigured(deps = {}) {
  const c = deps.config || numeraConfig();
  return Boolean(c.username && c.password && c.companyId);
}

/* Redondeo a 2 decimales, tolerante a strings/undefined/NaN. */
function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}
function round2(n) { return Math.round((num(n) + Number.EPSILON) * 100) / 100; }

/* ── Login ──────────────────────────────────────────────────────────────────
   POST {base}/login/ (form-urlencoded username/password) → { access_token }.
   deps.fetch / deps.config inyectables para tests. Best-effort: nunca lanza. */
async function login(deps = {}) {
  const cfg = deps.config || numeraConfig();
  if (!(cfg.username && cfg.password)) return { ok: false, isMock: true };
  const fetchFn = deps.fetch || (typeof fetch !== 'undefined' ? fetch : null);
  if (!fetchFn) return { ok: false, error: 'no-fetch' };

  const url = `${cfg.apiBase}/login/`;
  const body = new URLSearchParams({ username: cfg.username, password: cfg.password });
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: ctrl.signal
    });
    clearTimeout(tid);
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).message || ''; } catch (e) { /* sin cuerpo */ }
      return { ok: false, status: res.status, error: detail || `Numera login returned ${res.status}` };
    }
    const data = await res.json().catch(() => ({}));
    const token = data.access_token || null;
    if (!token) return { ok: false, error: 'login sin access_token' };
    return { ok: true, accessToken: token };
  } catch (err) {
    clearTimeout(tid);
    return { ok: false, error: err && err.name === 'AbortError' ? 'timeout' : (err && err.message) || 'error' };
  }
}

/* ── Armado del payload (DRY-RUN) ─────────────────────────────────────────────
   buildInvoicePayload({ reserva, huesped, lineas, impuestos, tipo }) arma el
   objeto { company_id, data:{ encabezado, lineas, impuestos, cliente } } que
   espera Numera, calcula los totales del encabezado y corre validate().

   - lineas: [{ descripcion, cantidad, precio_unitario_documento, ... }]
       por cada una se calcula precio_total_documento = cantidad * precio_unitario.
   - impuestos: [{ nombre, valor, es_retencion? }]  (valor = monto en pesos)
       IVA/INC → es_retencion falso (suman a valor_impuesto_documento).
       ReteFuente/ReteICA → es_retencion true (suman a retenciones_documento).
   - tipo: InvoiceType (default) | CreditNoteType | DebitNoteType.

   TODO(NUMERA): ¿el consecutivo/numeración legal lo asigna la API al emitir o lo
   enviamos nosotros en el encabezado? Hasta confirmarlo NO inventamos un número:
   dejamos el hook `numero_documento` intacto si viene en reserva, y no lo
   fabricamos. */
function buildInvoicePayload({ reserva = {}, huesped = {}, lineas = [], impuestos = [], tipo = 'InvoiceType' } = {}) {
  if (!TIPOS_FACTURA.includes(tipo)) {
    throw new Error(`tipo de factura inválido: ${tipo} (esperado ${TIPOS_FACTURA.join(' | ')})`);
  }

  /* Líneas: normaliza cantidad/precio y calcula el total por línea. */
  const lineasOut = (Array.isArray(lineas) ? lineas : []).map((l, i) => {
    const cantidad = num(l.cantidad);
    const precioUnit = num(l.precio_unitario_documento);
    return {
      ...l,
      descripcion: l.descripcion || l.descripcion === '' ? l.descripcion : `Ítem ${i + 1}`,
      cantidad,
      precio_unitario_documento: round2(precioUnit),
      precio_total_documento: round2(cantidad * precioUnit)
    };
  });

  /* Impuestos: normaliza es_retencion a booleano y el valor a número. */
  const impuestosOut = (Array.isArray(impuestos) ? impuestos : []).map((t) => ({
    ...t,
    valor: round2(t.valor),
    es_retencion: Boolean(t.es_retencion)
  }));

  const subtotal = round2(lineasOut.reduce((s, l) => s + num(l.precio_total_documento), 0));
  const valorImpuesto = round2(impuestosOut.filter(t => !t.es_retencion).reduce((s, t) => s + num(t.valor), 0));
  const retenciones = round2(impuestosOut.filter(t => t.es_retencion).reduce((s, t) => s + num(t.valor), 0));
  const total = round2(subtotal + valorImpuesto - retenciones);

  const encabezado = {
    tipo_factura: tipo,
    /* Hook para el consecutivo: solo se propaga si viene dado; NO lo inventamos. */
    ...(reserva.numero_documento ? { numero_documento: reserva.numero_documento } : {}),
    /* Referencia interna trazable (nuestro código de reserva), no es el número legal. */
    referencia_interna: reserva.referencia || reserva.codigo || reserva.bookingCode || null,
    subtotal_documento: subtotal,
    valor_impuesto_documento: valorImpuesto,
    retenciones_documento: retenciones,
    total_documento: total,
    /* TODO(NUMERA): la nota crédito (CreditNoteType) requiere ref_factura (la
       factura que corrige) y el CONCEPTO DIAN de la corrección (devolución,
       anulación, descuento, ajuste de precio…). No inventamos el concepto: si el
       proveedor confirma el catálogo de conceptos, se agrega aquí. Por ahora solo
       propagamos ref_factura cuando viene. */
    ...(reserva.ref_factura ? { ref_factura: reserva.ref_factura } : {})
  };

  /* Cliente/adquiriente. TODO(NUMERA): representación de la EXENCIÓN de IVA a
     turista extranjero (Art. 481 lit. h / hospedaje a no residentes). No sabemos
     aún si Numera la modela como una tarifa 0%, un impuesto con % 0, un flag en
     el cliente o simplemente omitiendo el IVA de las líneas. NO lo inventamos:
     dejamos pasar `exento_iva`/`es_turista_extranjero` si vienen, para conectarlo
     cuando el proveedor confirme el campo exacto. */
  const cliente = {
    ...huesped,
    ...(huesped.exento_iva !== undefined ? { exento_iva: Boolean(huesped.exento_iva) } : {})
  };

  const payload = {
    company_id: reserva.company_id || null,
    data: { encabezado, lineas: lineasOut, impuestos: impuestosOut, cliente }
  };

  validate(payload);
  return payload;
}

/* ── Validación de sumas (reglas del proveedor) ───────────────────────────────
   Lanza Error con el detalle si algo no cuadra (queremos fallar ruidoso ANTES de
   emitir). Devuelve true si todo está bien. */
function validate(payload = {}) {
  const data = payload && payload.data;
  if (!data) throw new Error('payload sin data');
  const enc = data.encabezado || {};
  const lineas = Array.isArray(data.lineas) ? data.lineas : [];
  const impuestos = Array.isArray(data.impuestos) ? data.impuestos : [];

  if (!TIPOS_FACTURA.includes(enc.tipo_factura)) {
    throw new Error(`encabezado.tipo_factura inválido: ${enc.tipo_factura}`);
  }
  /* La nota crédito exige la factura de referencia. */
  if (enc.tipo_factura === 'CreditNoteType' && !enc.ref_factura) {
    throw new Error('CreditNoteType requiere encabezado.ref_factura (factura que corrige)');
  }
  if (!lineas.length) throw new Error('la factura no tiene líneas');

  /* Regla por línea: precio_total_documento = cantidad * precio_unitario_documento */
  lineas.forEach((l, i) => {
    const esperado = round2(num(l.cantidad) * num(l.precio_unitario_documento));
    if (round2(l.precio_total_documento) !== esperado) {
      throw new Error(
        `línea ${i}: precio_total_documento (${l.precio_total_documento}) != cantidad*precio_unitario (${esperado})`
      );
    }
  });

  /* encabezado.subtotal_documento = suma(lineas.precio_total_documento) */
  const subtotal = round2(lineas.reduce((s, l) => s + num(l.precio_total_documento), 0));
  if (round2(enc.subtotal_documento) !== subtotal) {
    throw new Error(`encabezado.subtotal_documento (${enc.subtotal_documento}) != suma de líneas (${subtotal})`);
  }

  /* encabezado.valor_impuesto_documento = suma(impuestos con es_retencion falso) */
  const valorImpuesto = round2(impuestos.filter(t => !t.es_retencion).reduce((s, t) => s + num(t.valor), 0));
  if (round2(enc.valor_impuesto_documento) !== valorImpuesto) {
    throw new Error(`encabezado.valor_impuesto_documento (${enc.valor_impuesto_documento}) != suma de impuestos (${valorImpuesto})`);
  }

  /* retenciones_documento = suma(impuestos con es_retencion true) */
  const retenciones = round2(impuestos.filter(t => t.es_retencion).reduce((s, t) => s + num(t.valor), 0));
  if (round2(enc.retenciones_documento) !== retenciones) {
    throw new Error(`encabezado.retenciones_documento (${enc.retenciones_documento}) != suma de retenciones (${retenciones})`);
  }

  return true;
}

/* ── Emisión ──────────────────────────────────────────────────────────────────
   sendInvoice(payload, deps) — gated por NUMERA_INVOICING_ENABLED. Con el flag
   OFF o sin credenciales devuelve { ok:false, isMock:true } SIN tocar la red.
   Best-effort: nunca lanza (excepto que validate() reviente sobre un payload
   malformado; eso es intencional — no queremos emitir cuentas que no cuadran).

   deps inyectables para tests: { fetch, config, flag, login, settings }. */
async function sendInvoice(payload, deps = {}) {
  /* Flag gestionable desde /admin (override panel → env). SECRETOS nunca del panel. */
  let enabled = false;
  try {
    const flagFn = deps.flag || require('./_settings').flag;
    enabled = String(await flagFn('NUMERA_INVOICING_ENABLED')).toLowerCase() === 'true';
  } catch (e) { enabled = false; }

  const cfg = deps.config || numeraConfig();
  if (!enabled || !isConfigured({ config: cfg })) {
    if (process.env.DEBUG) {
      console.log('[numera] mock sendInvoice (flag off o sin credenciales) — DRY-RUN, no se emitió');
    }
    return { ok: false, isMock: true };
  }

  /* Revalida el payload antes de emitir (fallar ruidoso si las cuentas no cuadran). */
  validate(payload);

  const fetchFn = deps.fetch || (typeof fetch !== 'undefined' ? fetch : null);
  if (!fetchFn) return { ok: false, error: 'no-fetch' };

  /* Autenticación: login inyectable para tests. */
  const loginFn = deps.login || login;
  const auth = await loginFn({ fetch: fetchFn, config: cfg });
  if (!auth || !auth.ok || !auth.accessToken) {
    return { ok: false, error: (auth && auth.error) || 'login fallido' };
  }

  const url = `${cfg.apiBase}/electronic-documents/send-electronic-invoice/`;
  const body = {
    company_id: (payload && payload.company_id) || cfg.companyId,
    data: (payload && payload.data) || {}
  };

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Auth': auth.accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    clearTimeout(tid);
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).message || ''; } catch (e) { /* sin cuerpo */ }
      return { ok: false, status: res.status, error: detail || `Numera returned ${res.status}` };
    }
    const data = await res.json().catch(() => ({}));
    /* TODO(NUMERA): mapear la respuesta real del proveedor a nuestros campos —
       AÚN sin confirmar cómo viene:
         · número legal / consecutivo asignado por la DIAN
         · CUFE (código único de factura electrónica)
         · URL o base64 del PDF (representación gráfica) y del XML DIAN
       Por ahora devolvemos `raw` intacto para no inventar el mapeo; cuando el
       proveedor confirme los nombres exactos se extraen aquí. */
    return {
      ok: true,
      raw: data,
      numeroLegal: null, // TODO(NUMERA): data.??? — número/consecutivo DIAN
      cufe: null,        // TODO(NUMERA): data.??? — CUFE
      pdfUrl: null       // TODO(NUMERA): data.??? — PDF/representación gráfica
    };
  } catch (err) {
    clearTimeout(tid);
    return { ok: false, error: err && err.name === 'AbortError' ? 'timeout' : (err && err.message) || 'error' };
  }
}

module.exports = { isConfigured, login, buildInvoicePayload, validate, sendInvoice, numeraConfig, round2 };
