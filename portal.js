/* portal.js — cliente del Portal de clientes (empresas / residentes).
   - Sesión propia firmada emitida por /api/portal-session (magic-link o Google).
   - No expone credenciales: sólo guarda el token de sesión del portal.
   - Router de pestañas según el perfil (empresa | residente).
   - CSP-safe: sin eval, sin handlers inline; todo por addEventListener.
   El leg de Google/Firebase vive en un <script type="module"> de la página que
   comparte el objeto window.PortalSession (bridge). */
(function () {
  'use strict';

  var TOKEN_KEY = 'portal_token';
  var PROFILE_KEY = 'portal_profile';

  var LANG = (document.documentElement.getAttribute('lang') || 'es').toLowerCase() === 'en' ? 'en' : 'es';

  var I18N = {
    es: {
      sending: 'Enviando…',
      sent: 'Te enviamos un enlace de acceso. Revisa tu correo (y el spam).',
      requestError: 'No fue posible enviar el enlace. Intenta de nuevo.',
      invalidEmail: 'Ingresa un correo válido.',
      verifying: 'Verificando tu acceso…',
      linkInvalid: 'El enlace es inválido o expiró. Solicita uno nuevo.',
      googleError: 'No se pudo iniciar sesión con Google.',
      disabled: 'El portal no está disponible por ahora.',
      expired: 'Tu sesión expiró. Ingresa de nuevo.',
      soon: 'Esta sección estará disponible muy pronto.',
      empty: 'No hay registros por ahora.',
      loadError: 'No pudimos cargar esta sección. Intenta más tarde.',
      loading: 'Cargando…',
      greetEmpresa: 'Portal empresarial',
      greetResidente: 'Tu portal',
      tabs: {
        cotizaciones: 'Cotizaciones',
        cartera: 'Cartera',
        facturas: 'Facturas',
        pedidos: 'Pedidos',
        estadia: 'Mi estadía',
        servicios: 'Servicios',
        credito: 'Financiación',
        pagare: 'Pagaré',
        documentos: 'Documentos'
      },
      forms: {
        send: 'Enviar solicitud',
        sending: 'Enviando…',
        disabled: 'Esta sección no está disponible por ahora.',
        error: 'No fue posible completar la solicitud. Intenta de nuevo.',
        required: 'Completa los campos obligatorios.',
        servicios: {
          intro: 'Solicita un servicio para tu estadía. Nuestro equipo lo gestiona y te confirma.',
          type: 'Tipo de solicitud',
          aseo: 'Aseo extra',
          mantenimiento: 'Mantenimiento',
          pqr: 'Petición, queja o reclamo',
          cantidad: 'Cantidad de aseos',
          cuando: '¿Cuándo lo prefieres? (opcional)',
          notas: 'Notas (opcional)',
          categoria: 'Categoría (opcional)',
          ubicacion: 'Ubicación (opcional)',
          urgente: 'Es urgente',
          mensaje: 'Cuéntanos los detalles',
          okReceived: 'Solicitud recibida. Te confirmaremos pronto.',
          okAseoCharge: 'Aseo extra registrado. Se cargará a tu cuenta.',
          total: 'Total'
        },
        credito: {
          intro: 'Solicita financiación para tu estadía. Un asesor autorizado revisará tu solicitud; la decisión la toma una persona, nunca un sistema automático.',
          disclosure: 'Autorizo de forma libre, previa, expresa e informada el tratamiento de mis datos financieros y la consulta y reporte en centrales de riesgo (Habeas Data, Ley 1266 de 2008), para evaluar esta solicitud de crédito. Puedo conocer, actualizar y rectificar mis datos.',
          external: 'Para leer y extraer datos de tus documentos usamos un proveedor tecnológico ubicado fuera de Colombia (EE. UU.). Esta autorización es opcional; si no la marcas, un asesor procesará tus documentos manualmente.',
          externalConsent: 'Autorizo este procesamiento en el exterior (opcional).',
          nombre: 'Nombre completo',
          email: 'Correo electrónico',
          telefono: 'Teléfono',
          tipoDoc: 'Tipo de documento',
          numeroDoc: 'Número de documento',
          monto: 'Monto solicitado (COP)',
          plazo: 'Plazo (meses)',
          extracto: 'Extracto bancario (PDF)',
          datacredito: 'Reporte DataCrédito (PDF)',
          consent: 'He leído y acepto la autorización de tratamiento de datos financieros (Ley 1266).',
          submit: 'Enviar solicitud de crédito',
          ok: 'Recibimos tu solicitud y tus documentos de forma segura. Un asesor autorizado la revisará y te contactará.',
          needConsent: 'Debes aceptar la autorización de datos financieros para continuar.',
          needDoc: 'Adjunta al menos un documento (extracto o DataCrédito).',
          fileTooBig: 'Un archivo supera el tamaño permitido (4 MB).'
        },
        pagare: {
          intro: 'Firma electrónica de tu pagaré. Quedará registrado con evidencia (Ley 527).',
          monto: 'Monto del pagaré (COP)',
          vencimiento: 'Fecha de vencimiento',
          deudorNombre: 'Nombre del deudor',
          deudorTipoDoc: 'Tipo de documento',
          deudorDoc: 'Número de documento',
          deudorDireccion: 'Dirección',
          deudorEmail: 'Correo electrónico',
          interesCorriente: 'Interés corriente (% anual, opcional)',
          interesMora: 'Interés de mora (% anual, opcional)',
          usuraNote: 'El interés de mora nunca superará la tasa de usura vigente.',
          clause: 'Declaro que pagaré incondicionalmente a la orden de Hotel Estar la suma indicada en la fecha de vencimiento, junto con los intereses pactados sin exceder la tasa de usura.',
          consent: 'He leído y acepto firmar este pagaré.',
          submit: 'Firmar pagaré',
          ok: 'Pagaré firmado y registrado de forma segura.',
          needConsent: 'Debes aceptar y firmar el pagaré para continuar.',
          needMonto: 'Indica un monto mayor a cero.',
          needVenc: 'Indica la fecha de vencimiento.'
        }
      }
    },
    en: {
      sending: 'Sending…',
      sent: 'We sent you a sign-in link. Check your inbox (and spam).',
      requestError: 'We could not send the link. Please try again.',
      invalidEmail: 'Enter a valid email.',
      verifying: 'Verifying your access…',
      linkInvalid: 'This link is invalid or expired. Request a new one.',
      googleError: 'Google sign-in failed.',
      disabled: 'The portal is not available right now.',
      expired: 'Your session expired. Please sign in again.',
      soon: 'This section will be available very soon.',
      empty: 'Nothing to show yet.',
      loadError: 'We could not load this section. Try again later.',
      loading: 'Loading…',
      greetEmpresa: 'Business portal',
      greetResidente: 'Your portal',
      tabs: {
        cotizaciones: 'Quotes',
        cartera: 'Balance',
        facturas: 'Invoices',
        pedidos: 'Orders',
        estadia: 'My stay',
        servicios: 'Services',
        credito: 'Financing',
        pagare: 'Promissory note',
        documentos: 'Documents'
      },
      forms: {
        send: 'Send request',
        sending: 'Sending…',
        disabled: 'This section is not available right now.',
        error: 'We could not complete the request. Please try again.',
        required: 'Please fill in the required fields.',
        servicios: {
          intro: 'Request a service for your stay. Our team handles it and confirms with you.',
          type: 'Request type',
          aseo: 'Extra cleaning',
          mantenimiento: 'Maintenance',
          pqr: 'Request, complaint or claim',
          cantidad: 'Number of cleanings',
          cuando: 'When would you prefer it? (optional)',
          notas: 'Notes (optional)',
          categoria: 'Category (optional)',
          ubicacion: 'Location (optional)',
          urgente: 'It is urgent',
          mensaje: 'Tell us the details',
          okReceived: 'Request received. We will confirm shortly.',
          okAseoCharge: 'Extra cleaning registered. It will be charged to your account.',
          total: 'Total'
        },
        credito: {
          intro: 'Apply for financing for your stay. An authorized advisor will review your request; a person makes the decision, never an automated system.',
          disclosure: 'I freely, previously, expressly and informedly authorize the processing of my financial data and the query and reporting to credit bureaus (Habeas Data, Law 1266 of 2008) to assess this credit request. I may access, update and rectify my data.',
          external: 'To read and extract data from your documents we use a technology provider located outside Colombia (USA). This authorization is optional; if you do not check it, an advisor will process your documents manually.',
          externalConsent: 'I authorize this processing abroad (optional).',
          nombre: 'Full name',
          email: 'Email address',
          telefono: 'Phone',
          tipoDoc: 'Document type',
          numeroDoc: 'Document number',
          monto: 'Requested amount (COP)',
          plazo: 'Term (months)',
          extracto: 'Bank statement (PDF)',
          datacredito: 'DataCrédito report (PDF)',
          consent: 'I have read and accept the authorization to process financial data (Law 1266).',
          submit: 'Send credit request',
          ok: 'We received your request and documents securely. An authorized advisor will review it and contact you.',
          needConsent: 'You must accept the financial data authorization to continue.',
          needDoc: 'Attach at least one document (statement or DataCrédito).',
          fileTooBig: 'A file exceeds the allowed size (4 MB).'
        },
        pagare: {
          intro: 'Electronic signature of your promissory note. It will be recorded with evidence (Law 527).',
          monto: 'Promissory note amount (COP)',
          vencimiento: 'Due date',
          deudorNombre: 'Debtor name',
          deudorTipoDoc: 'Document type',
          deudorDoc: 'Document number',
          deudorDireccion: 'Address',
          deudorEmail: 'Email address',
          interesCorriente: 'Ordinary interest (% annual, optional)',
          interesMora: 'Default interest (% annual, optional)',
          usuraNote: 'Default interest will never exceed the current usury rate.',
          clause: 'I declare that I will unconditionally pay to the order of Hotel Estar the stated sum on the due date, together with the agreed interest without exceeding the usury rate.',
          consent: 'I have read and accept signing this promissory note.',
          submit: 'Sign promissory note',
          ok: 'Promissory note signed and securely recorded.',
          needConsent: 'You must accept and sign the promissory note to continue.',
          needMonto: 'Enter an amount greater than zero.',
          needVenc: 'Enter the due date.'
        }
      }
    }
  };

  /* Pestañas por perfil. El backend se consolidó en DOS funciones agregadas:
     /api/portal-company (perfil empresa) y /api/portal-resident (perfil residente).
     Cada pestaña apunta a una de ellas y extrae su sección de la respuesta:
       · empresa   → /api/portal-company?section=… ({ ok, <section>: {…} }).
       · residente → /api/portal-resident (GET agregado: { ok, cartera, invoices }).
     `pick` es la ruta punteada al array de registros dentro de la respuesta; el
     loader es tolerante (respuesta inerte/gated ⇒ estado "próximamente"). */
  var TABS = {
    empresa: [
      { id: 'cotizaciones', endpoint: '/api/portal-company?section=quotes', pick: 'quotes.quotes' },
      { id: 'cartera', endpoint: '/api/portal-company?section=cartera', pick: 'cartera.documentos' },
      { id: 'facturas', endpoint: '/api/portal-company?section=invoices', pick: 'invoices.invoices' },
      { id: 'pedidos', endpoint: '/api/portal-company?section=orders', pick: 'orders.orders' }
    ],
    residente: [
      { id: 'cartera', endpoint: '/api/portal-resident', pick: 'cartera.documentos' },
      { id: 'facturas', endpoint: '/api/portal-resident', pick: 'invoices.invoices' },
      /* Pestañas ACCIONABLES (POST): renderizan un formulario en vez de un loader GET.
         Cada backend está GATED OFF por defecto (PORTAL_ENABLED / CREDIT_ENABLED /
         PAGARE_ESIGN_ENABLED); si responde inerte, el submit muestra "no disponible". */
      { id: 'servicios', render: renderServicios },
      { id: 'credito', render: renderCredito },
      { id: 'pagare', render: renderPagare }
    ]
  };

  var t = I18N[LANG];

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function getToken() { try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function getProfile() {
    try { return JSON.parse(sessionStorage.getItem(PROFILE_KEY) || 'null'); } catch (e) { return null; }
  }
  function saveSession(token, profile) {
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
      sessionStorage.setItem(PROFILE_KEY, JSON.stringify(profile || {}));
    } catch (e) { /* almacenamiento no disponible */ }
  }
  function clearSession() {
    try { sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(PROFILE_KEY); } catch (e) {}
  }

  function show(section) {
    ['portalDisabled', 'portalVerifying', 'portalLogin', 'portalApp'].forEach(function (id) {
      var el = $(id);
      if (el) el.hidden = (id !== section);
    });
  }

  function setMsg(el, text, kind) {
    if (!el) return;
    el.textContent = text || '';
    el.className = 'portal-msg' + (kind ? ' ' + kind : '');
    el.hidden = !text;
  }

  /* Request autenticado con el token de sesión del portal. Un 401 cierra sesión.
     Soporta GET (loaders de solo-lectura) y POST (formularios accionables). NUNCA
     expone credenciales OTASync/Odoo: solo viaja el token de sesión del portal. */
  function authedRequest(endpoint, options) {
    options = options || {};
    var headers = {};
    var src = options.headers || {};
    for (var k in src) { if (Object.prototype.hasOwnProperty.call(src, k)) headers[k] = src[k]; }
    headers['Authorization'] = 'Bearer ' + getToken();
    return fetch(endpoint, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body
    }).then(function (res) {
      if (res.status === 401) { onExpired(); throw new Error('expired'); }
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { ok: res.ok, status: res.status, data: data };
      });
    });
  }

  function authedFetch(endpoint) { return authedRequest(endpoint, { method: 'GET' }); }

  function onExpired() {
    clearSession();
    renderLogin();
    setMsg($('portalRequestMsg'), t.expired, 'err');
  }

  /* ── Login ────────────────────────────────────────────────────────────── */
  function renderLogin() {
    show('portalLogin');
  }

  function requestMagicLink(emailValue) {
    var msg = $('portalRequestMsg');
    var btn = $('portalRequestBtn');
    var email = String(emailValue || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setMsg(msg, t.invalidEmail, 'err');
      return;
    }
    if (btn) btn.disabled = true;
    setMsg(msg, t.sending, '');
    fetch('/api/portal-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'request', email: email, lang: LANG })
    }).then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (data) {
        if (data && data.enabled === false) { setMsg(msg, t.disabled, 'err'); return; }
        if (data && data.ok) { setMsg(msg, t.sent, 'ok'); }
        else { setMsg(msg, (data && data.error) || t.requestError, 'err'); }
      })
      .catch(function () { setMsg(msg, t.requestError, 'err'); })
      .then(function () { if (btn) btn.disabled = false; });
  }

  function verify(payload, onError) {
    show('portalVerifying');
    var body = { action: 'verify' };
    if (payload.token) body.token = payload.token;
    if (payload.firebaseToken) body.firebaseToken = payload.firebaseToken;
    fetch('/api/portal-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (data) {
        if (data && data.enabled === false) { renderLogin(); setMsg($('portalRequestMsg'), t.disabled, 'err'); return; }
        if (data && data.ok && data.token) {
          saveSession(data.token, data.profile);
          launchApp(data.profile);
        } else {
          renderLogin();
          if (onError) onError();
        }
      })
      .catch(function () { renderLogin(); if (onError) onError(); });
  }

  /* ── App: router de pestañas ──────────────────────────────────────────── */
  function launchApp(profile) {
    profile = profile || getProfile() || { profile: 'residente' };
    var kind = profile.profile === 'empresa' ? 'empresa' : 'residente';

    var emailEl = $('portalUserEmail');
    if (emailEl) emailEl.textContent = profile.email || '';
    var greetEl = $('portalGreeting');
    if (greetEl) greetEl.textContent = kind === 'empresa' ? t.greetEmpresa : t.greetResidente;

    var tabs = TABS[kind] || [];
    var nav = $('portalTabs');
    if (nav) {
      nav.innerHTML = '';
      tabs.forEach(function (tab, i) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'portal-tab';
        btn.setAttribute('role', 'tab');
        btn.dataset.tab = tab.id;
        btn.textContent = (t.tabs[tab.id] || tab.id);
        btn.addEventListener('click', function () { selectTab(tabs, tab.id); });
        nav.appendChild(btn);
      });
    }
    show('portalApp');
    if (tabs.length) selectTab(tabs, tabs[0].id);
  }

  function selectTab(tabs, id) {
    var nav = $('portalTabs');
    if (nav) {
      Array.prototype.forEach.call(nav.querySelectorAll('.portal-tab'), function (b) {
        var active = b.dataset.tab === id;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    }
    var tab = tabs.filter(function (x) { return x.id === id; })[0];
    if (!tab) return;
    /* Pestaña accionable (POST): renderiza un formulario. Pestaña de datos (GET):
       loader de solo-lectura tolerante a respuesta inerte. */
    if (typeof tab.render === 'function') {
      var panel = $('portalPanel');
      if (panel) tab.render(panel);
    } else {
      loadPanel(tab);
    }
  }

  function loadPanel(tab) {
    var panel = $('portalPanel');
    if (!panel) return;
    panel.innerHTML = '<p class="portal-note">' + esc(t.loading) + '</p>';
    authedFetch(tab.endpoint).then(function (res) {
      /* Respuesta inerte: HTTP != 2xx, cuerpo ausente, o el backend gated devolvió
         { ok:false, enabled:false } (PORTAL_ENABLED apagado) ⇒ "próximamente". */
      if (!res.ok || !res.data || res.data.ok === false) {
        panel.innerHTML = '<p class="portal-note">' + esc(t.soon) + '</p>';
        return;
      }
      renderRecords(panel, pickItems(res.data, tab.pick));
    }).catch(function (err) {
      if (err && err.message === 'expired') return;
      panel.innerHTML = '<p class="portal-note">' + esc(t.loadError) + '</p>';
    });
  }

  /* Extrae el array de registros de la respuesta agregada. `path` es una ruta
     punteada (p.ej. 'cartera.documentos'); si falta, cae al esquema genérico
     items/records/rows. Siempre devuelve un array (nunca lanza). */
  function pickItems(data, path) {
    if (!path) return (data && (data.items || data.records || data.rows)) || [];
    var cur = data;
    var parts = path.split('.');
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return [];
      cur = cur[parts[i]];
    }
    return Array.isArray(cur) ? cur : [];
  }

  /* Render genérico y tolerante al esquema: si hay registros mostramos filas
     legibles; si viene vacío, un estado vacío amable. */
  function renderRecords(panel, items) {
    if (!Array.isArray(items) || !items.length) {
      panel.innerHTML = '<p class="portal-note">' + esc(t.empty) + '</p>';
      return;
    }
    var html = '<ul class="portal-list">';
    items.slice(0, 100).forEach(function (item) {
      var title = item && (item.title || item.name || item.numero || item.reference || item.id || '');
      var meta = item && (item.status || item.estado || item.date || item.fecha || item.amount || item.total || '');
      html += '<li class="portal-list-item"><span class="portal-list-title">' + esc(title) +
        '</span><span class="portal-list-meta">' + esc(meta) + '</span></li>';
    });
    html += '</ul>';
    panel.innerHTML = html;
  }

  /* ── Superficies accionables (POST) ───────────────────────────────────────
     Cablean formularios que hacen llegar al navegador las tres capacidades cuyo
     backend ya existe pero era inalcanzable: solicitudes de servicio del residente
     (portal-resident), enrolamiento de crédito con consentimiento Ley 1266
     (credit-enroll) y firma de pagaré (pagare-sign). Bilingüe por I18N (mismo
     portal.js para /portal.html y /en/portal.html). Ningún dato financiero se
     persiste en el cliente; el cifrado en reposo lo hace el backend (_crypto-vault).
     Toda la lógica de gating vive en el backend: si un flag está OFF la respuesta
     es inerte y el formulario muestra "no disponible". La DECISIÓN de crédito la
     toma un humano con `credito.aprobar`; aquí solo se emite la solicitud. */

  function formatMoney(n) {
    var v = Number(n) || 0;
    try { return 'COP ' + v.toLocaleString(LANG === 'en' ? 'en-US' : 'es-CO'); }
    catch (e) { return 'COP ' + v; }
  }

  function randomKey() {
    try {
      if (window.crypto && window.crypto.getRandomValues) {
        var a = new Uint8Array(16);
        window.crypto.getRandomValues(a);
        return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      }
    } catch (e) {}
    return 'k' + Date.now() + Math.random().toString(16).slice(2);
  }

  /* Builders de campos (markup estático desde I18N, valores escapados). */
  function fieldText(id, label, type) {
    return '<div class="portal-field"><label for="' + id + '">' + esc(label) + '</label>' +
      '<input id="' + id + '" type="' + (type || 'text') + '"></div>';
  }
  function fieldTextarea(id, label) {
    return '<div class="portal-field"><label for="' + id + '">' + esc(label) + '</label>' +
      '<textarea id="' + id + '" rows="3"></textarea></div>';
  }
  function fieldSelect(id, label, opts) {
    var o = '';
    for (var i = 0; i < opts.length; i++) {
      o += '<option value="' + esc(opts[i][0]) + '">' + esc(opts[i][1]) + '</option>';
    }
    return '<div class="portal-field"><label for="' + id + '">' + esc(label) + '</label>' +
      '<select id="' + id + '">' + o + '</select></div>';
  }
  function fieldCheckbox(id, label) {
    return '<div class="portal-field"><label><input id="' + id + '" type="checkbox"> ' + esc(label) + '</label></div>';
  }
  function fieldFile(id, label, accept) {
    return '<div class="portal-field"><label for="' + id + '">' + esc(label) + '</label>' +
      '<input id="' + id + '" type="file"' + (accept ? ' accept="' + esc(accept) + '"' : '') + '></div>';
  }
  function fine(text) {
    return '<p class="portal-fine" style="text-align:left;">' + esc(text) + '</p>';
  }

  /* POST autenticado + manejo uniforme de respuesta inerte/gated. `okFn(data)` da
     el texto de éxito; `resetForm` (opcional) limpia el formulario tras éxito —
     usado en crédito/pagaré para no dejar PII en el DOM. */
  function submitForm(btn, msg, endpoint, body, okFn, resetForm) {
    if (btn) btn.disabled = true;
    setMsg(msg, t.forms.sending, '');
    authedRequest(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      var data = res.data || {};
      /* Inerte: HTTP != 2xx, o el backend gated devolvió { ok:false } /
         { enabled:false } / { disabled:true } (flag apagado) ⇒ "no disponible". */
      if (!res.ok || data.enabled === false || data.disabled === true || data.ok === false) {
        setMsg(msg, (data && data.error) || t.forms.disabled, 'err');
        return;
      }
      setMsg(msg, okFn ? okFn(data) : t.forms.send, 'ok');
      if (resetForm && typeof resetForm.reset === 'function') { try { resetForm.reset(); } catch (e) {} }
    }).catch(function (err) {
      if (err && err.message === 'expired') return;
      setMsg(msg, t.forms.error, 'err');
    }).then(function () { if (btn) btn.disabled = false; });
  }

  /* Lee un File → base64 (sin el prefijo data:). */
  function fileToBase64(file, cb) {
    try {
      var reader = new FileReader();
      reader.onload = function () {
        var s = String(reader.result || '');
        var i = s.indexOf(',');
        cb(i >= 0 ? s.slice(i + 1) : '');
      };
      reader.onerror = function () { cb(''); };
      reader.readAsDataURL(file);
    } catch (e) { cb(''); }
  }

  /* Colecciona [kind, File] → [{ kind, base64, mediaType }] (omite los vacíos). */
  function collectDocs(pairs, cb) {
    var out = [], pending = 0, done = false;
    function finish() { if (!done && pending === 0) { done = true; cb(out); } }
    for (var i = 0; i < pairs.length; i++) {
      var kind = pairs[i][0], file = pairs[i][1];
      if (!file) continue;
      pending++;
      (function (kind, file) {
        fileToBase64(file, function (b64) {
          if (b64) out.push({ kind: kind, base64: b64, mediaType: file.type || 'application/pdf' });
          pending--; finish();
        });
      })(kind, file);
    }
    finish();
  }

  /* (a) Servicios del residente → POST /api/portal-resident (type aseo|mantenimiento|pqr). */
  function renderServicios(panel) {
    if (!panel) return;
    var f = t.forms, s = f.servicios;
    var html = '';
    html += '<p class="portal-note">' + esc(s.intro) + '</p>';
    html += '<form id="svcForm" class="portal-form" novalidate>';
    html += fieldSelect('svcType', s.type, [['aseo', s.aseo], ['mantenimiento', s.mantenimiento], ['pqr', s.pqr]]);
    html += '<div id="svcAseo">';
    html += fieldSelect('svcCantidad', s.cantidad, [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5']]);
    html += fieldText('svcCuando', s.cuando, 'text');
    html += fieldTextarea('svcNotas', s.notas);
    html += '</div>';
    html += '<div id="svcMant" hidden>';
    html += fieldText('svcCategoria', s.categoria, 'text');
    html += fieldText('svcUbicacion', s.ubicacion, 'text');
    html += fieldTextarea('svcMensajeM', s.mensaje);
    html += fieldCheckbox('svcUrgente', s.urgente);
    html += '</div>';
    html += '<div id="svcPqr" hidden>';
    html += fieldTextarea('svcMensajeP', s.mensaje);
    html += '</div>';
    html += '<button id="svcSubmit" class="portal-btn" type="submit">' + esc(f.send) + '</button>';
    html += '<div id="svcMsg" class="portal-msg" role="status" aria-live="polite" hidden></div>';
    html += '</form>';
    panel.innerHTML = html;

    var form = $('svcForm'), sel = $('svcType');
    function toggle() {
      var v = sel.value;
      $('svcAseo').hidden = v !== 'aseo';
      $('svcMant').hidden = v !== 'mantenimiento';
      $('svcPqr').hidden = v !== 'pqr';
    }
    sel.addEventListener('change', toggle);
    toggle();

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = $('svcMsg'), btn = $('svcSubmit');
      var type = sel.value;
      var body = { type: type, lang: LANG };
      if (type === 'aseo') {
        body.quantity = parseInt($('svcCantidad').value, 10) || 1;
        body.deliveryTime = $('svcCuando').value;
        body.notes = $('svcNotas').value;
        /* Idempotency-Key del cliente: un doble-click/reintento NO recarga el aseo. */
        body.idempotencyKey = randomKey();
      } else if (type === 'mantenimiento') {
        body.message = String($('svcMensajeM').value || '').trim();
        body.category = $('svcCategoria').value;
        body.location = $('svcUbicacion').value;
        body.urgency = $('svcUrgente').checked ? 'urgent' : 'normal';
        if (!body.message) { setMsg(msg, f.required, 'err'); return; }
      } else {
        body.message = String($('svcMensajeP').value || '').trim();
        if (!body.message) { setMsg(msg, f.required, 'err'); return; }
      }
      submitForm(btn, msg, '/api/portal-resident', body, function (data) {
        if (type === 'aseo') {
          var m = (data.folio && data.folio.posted) ? s.okAseoCharge : s.okReceived;
          if (typeof data.total === 'number') m += ' ' + s.total + ': ' + formatMoney(data.total) + '.';
          return m;
        }
        return s.okReceived;
      });
    });
  }

  /* (b) Enrolamiento de crédito → POST /api/credit-enroll. Consentimiento Ley 1266
     explícito (checkbox obligatorio) + autorización SEPARADA de procesamiento en el
     exterior. La PII financiera NO se guarda en el cliente; el cifrado en reposo lo
     hace el backend. La recomendación jamás se muestra: la decisión es humana. */
  function renderCredito(panel) {
    if (!panel) return;
    var f = t.forms, c = f.credito;
    var html = '';
    html += '<p class="portal-note">' + esc(c.intro) + '</p>';
    html += '<form id="crForm" class="portal-form" novalidate>';
    html += fieldText('crNombre', c.nombre, 'text');
    html += fieldText('crEmail', c.email, 'email');
    html += fieldText('crTelefono', c.telefono, 'tel');
    html += fieldText('crTipoDoc', c.tipoDoc, 'text');
    html += fieldText('crNumeroDoc', c.numeroDoc, 'text');
    html += fieldText('crMonto', c.monto, 'number');
    html += fieldText('crPlazo', c.plazo, 'number');
    html += fieldFile('crExtracto', c.extracto, 'application/pdf');
    html += fieldFile('crDatacredito', c.datacredito, 'application/pdf');
    html += fine(c.disclosure);
    html += fieldCheckbox('crConsent', c.consent);
    html += fine(c.external);
    html += fieldCheckbox('crExternal', c.externalConsent);
    html += '<button id="crSubmit" class="portal-btn" type="submit">' + esc(c.submit) + '</button>';
    html += '<div id="crMsg" class="portal-msg" role="status" aria-live="polite" hidden></div>';
    html += '</form>';
    panel.innerHTML = html;

    var form = $('crForm');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = $('crMsg'), btn = $('crSubmit');
      if (!$('crConsent').checked) { setMsg(msg, c.needConsent, 'err'); return; }
      var extractoFile = ($('crExtracto').files || [])[0];
      var dcFile = ($('crDatacredito').files || [])[0];
      if (!extractoFile && !dcFile) { setMsg(msg, c.needDoc, 'err'); return; }
      var MAX = 4 * 1024 * 1024;
      if ((extractoFile && extractoFile.size > MAX) || (dcFile && dcFile.size > MAX)) {
        setMsg(msg, c.fileTooBig, 'err'); return;
      }
      if (btn) btn.disabled = true;
      setMsg(msg, f.sending, '');
      collectDocs([['extracto', extractoFile], ['datacredito', dcFile]], function (documentos) {
        var body = {
          solicitante: {
            nombre: $('crNombre').value,
            email: $('crEmail').value,
            telefono: $('crTelefono').value,
            tipoDoc: $('crTipoDoc').value,
            numeroDoc: $('crNumeroDoc').value
          },
          montoSolicitado: Number($('crMonto').value) || 0,
          plazoMeses: Number($('crPlazo').value) || 0,
          consentimiento: {
            aceptado: true,
            canal: 'web',
            version: 'ley-1266-v1',
            titular: $('crNombre').value,
            documentoTitular: $('crNumeroDoc').value,
            procesamientoExterno: $('crExternal').checked,
            timestamp: new Date().toISOString()
          },
          documentos: documentos
        };
        /* submitForm re-arma su propio estado; limpia el formulario tras éxito para
           no dejar PII financiera en el DOM (minimización, Ley 1266). */
        submitForm(btn, msg, '/api/credit-enroll', body, function () { return c.ok; }, form);
      });
    });
  }

  /* (c) Firma de pagaré → POST /api/pagare-sign. Exige suma > 0 y vencimiento (título
     valor). El interés de mora se topa en usura del lado del backend (config); aquí
     solo se avisa. Limpia el formulario tras éxito (dato financiero, Ley 1266). */
  function renderPagare(panel) {
    if (!panel) return;
    var f = t.forms, p = f.pagare;
    var html = '';
    html += '<p class="portal-note">' + esc(p.intro) + '</p>';
    html += '<form id="pgForm" class="portal-form" novalidate>';
    html += fieldText('pgMonto', p.monto, 'number');
    html += fieldText('pgVenc', p.vencimiento, 'date');
    html += fieldText('pgDeudorNombre', p.deudorNombre, 'text');
    html += fieldText('pgDeudorTipoDoc', p.deudorTipoDoc, 'text');
    html += fieldText('pgDeudorDoc', p.deudorDoc, 'text');
    html += fieldText('pgDeudorDir', p.deudorDireccion, 'text');
    html += fieldText('pgDeudorEmail', p.deudorEmail, 'email');
    html += fieldText('pgInteresCorriente', p.interesCorriente, 'number');
    html += fieldText('pgInteresMora', p.interesMora, 'number');
    html += fine(p.usuraNote);
    html += fine(p.clause);
    html += fieldCheckbox('pgConsent', p.consent);
    html += '<button id="pgSubmit" class="portal-btn" type="submit">' + esc(p.submit) + '</button>';
    html += '<div id="pgMsg" class="portal-msg" role="status" aria-live="polite" hidden></div>';
    html += '</form>';
    panel.innerHTML = html;

    var form = $('pgForm');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = $('pgMsg'), btn = $('pgSubmit');
      if (!$('pgConsent').checked) { setMsg(msg, p.needConsent, 'err'); return; }
      var monto = Number($('pgMonto').value) || 0;
      if (monto <= 0) { setMsg(msg, p.needMonto, 'err'); return; }
      var venc = String($('pgVenc').value || '').trim();
      if (!venc) { setMsg(msg, p.needVenc, 'err'); return; }
      var body = {
        monto: monto,
        moneda: 'COP',
        fechaVencimiento: venc,
        deudorNombre: $('pgDeudorNombre').value,
        deudorTipoDocumento: $('pgDeudorTipoDoc').value,
        deudorDocumento: $('pgDeudorDoc').value,
        deudorDireccion: $('pgDeudorDir').value,
        deudorEmail: $('pgDeudorEmail').value,
        channel: 'web',
        consent: { accepted: true, text: p.clause, acceptedAt: new Date().toISOString() }
      };
      var ic = $('pgInteresCorriente').value;
      if (ic !== '') body.interesCorriente = Number(ic);
      var im = $('pgInteresMora').value;
      if (im !== '') body.interesMora = Number(im);
      submitForm(btn, msg, '/api/pagare-sign', body, function () { return p.ok; }, form);
    });
  }

  function logout() {
    clearSession();
    if (window.PortalSession && typeof window.PortalSession.firebaseSignOut === 'function') {
      try { window.PortalSession.firebaseSignOut(); } catch (e) {}
    }
    renderLogin();
    setMsg($('portalRequestMsg'), '', '');
  }

  /* ── Bridge con el leg Google/Firebase (script type=module de la página) ── */
  window.PortalSession = window.PortalSession || {};
  window.PortalSession.completeFirebase = function (idToken) {
    verify({ firebaseToken: idToken }, function () {
      setMsg($('portalRequestMsg'), t.googleError, 'err');
    });
  };

  /* ── Arranque ─────────────────────────────────────────────────────────── */
  function init() {
    var form = $('portalLoginForm');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        requestMagicLink(($('portalEmail') || {}).value);
      });
    }
    var googleBtn = $('portalGoogleBtn');
    if (googleBtn) {
      googleBtn.addEventListener('click', function () {
        setMsg($('portalRequestMsg'), '', '');
        if (!(window.PortalSession && typeof window.PortalSession.firebaseSignIn === 'function')) {
          setMsg($('portalRequestMsg'), t.googleError, 'err');
          return;
        }
        window.PortalSession.firebaseSignIn().then(function (idToken) {
          if (idToken) window.PortalSession.completeFirebase(idToken);
        }).catch(function (err) {
          if (err && err.code === 'auth/popup-closed-by-user') return;
          setMsg($('portalRequestMsg'), t.googleError, 'err');
        });
      });
    }
    var logoutBtn = $('portalLogout');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    /* 1) ¿Enlace mágico en la URL? Canjéalo por sesión. */
    var params = new URLSearchParams(window.location.search);
    var magic = params.get('token');
    if (magic) {
      /* Limpia el token de la URL (evita reenvío/replay accidental). */
      try {
        var clean = window.location.pathname + window.location.hash;
        window.history.replaceState({}, document.title, clean);
      } catch (e) {}
      verify({ token: magic }, function () {
        setMsg($('portalRequestMsg'), t.linkInvalid, 'err');
      });
      return;
    }

    /* 2) ¿Sesión guardada? Entra directo (la API valida el token en cada llamada). */
    if (getToken()) { launchApp(getProfile()); return; }

    /* 3) Login. */
    renderLogin();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
