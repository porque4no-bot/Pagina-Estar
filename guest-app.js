(function () {
  'use strict';

  const API = {
    session: '/api/guest-session',
    checkin: '/api/guest-checkin',
    action: '/api/guest-action'
  };
  const SESSION_KEY = 'estar-guest-session';
  const state = {
    token: '',
    booking: null,
    document: null,
    cart: {}
  };

  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  const money = value => new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(Number(value || 0));
  const dateLabel = value => {
    if (!value) return '—';
    const date = new Date(`${value}T12:00:00`);
    return new Intl.DateTimeFormat('es-CO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    }).format(date);
  };

  function setStatus(element, message, type) {
    if (!element) return;
    element.textContent = message || '';
    element.classList.remove('is-error', 'is-success', 'is-loading');
    if (type) element.classList.add(`is-${type}`);
  }

  function setButtonLoading(button, loading, label) {
    if (!button) return;
    if (loading) {
      button.dataset.originalLabel = button.innerHTML;
      button.disabled = true;
      button.innerHTML = `<span class="guest-spinner" aria-hidden="true"></span>${label || 'Procesando'}`;
    } else {
      button.disabled = false;
      if (button.dataset.originalLabel) button.innerHTML = button.dataset.originalLabel;
      if (window.lucide) window.lucide.createIcons();
    }
  }

  async function request(url, options) {
    const headers = { 'Content-Type': 'application/json', ...((options && options.headers) || {}) };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const response = await fetch(url, { ...options, headers });
    let data = {};
    try {
      data = await response.json();
    } catch (error) {
      data = { error: 'El servicio respondió en un formato inesperado.' };
    }
    if (!response.ok) {
      const failure = new Error(data.error || 'No fue posible completar la solicitud.');
      failure.data = data;
      failure.status = response.status;
      throw failure;
    }
    return data;
  }

  function saveSession() {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      token: state.token,
      booking: state.booking
    }));
  }

  function clearSession() {
    state.token = '';
    state.booking = null;
    state.document = null;
    state.cart = {};
    sessionStorage.removeItem(SESSION_KEY);
  }

  function restoreSession() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
      if (saved && saved.token && saved.booking) {
        state.token = saved.token;
        state.booking = saved.booking;
        return true;
      }
    } catch (error) {
      clearSession();
    }
    return false;
  }

  function localDemoSession() {
    const checkIn = new Date();
    checkIn.setDate(checkIn.getDate() + 12);
    const checkOut = new Date(checkIn);
    checkOut.setDate(checkOut.getDate() + 4);
    state.token = 'local-demo-token';
    state.booking = {
      bookingCode: 'EST-DEMO-2026',
      status: 'confirmed',
      guestName: 'Andrea Restrepo',
      roomName: 'Apartaestudio Selección',
      roomNumber: '402',
      checkIn: checkIn.toISOString().slice(0, 10),
      checkOut: checkOut.toISOString().slice(0, 10),
      nights: 4,
      totalAmount: 1280000,
      canCancel: true,
      canModify: true,
      demo: true
    };
  }

  function daysUntil(value) {
    if (!value) return null;
    const target = new Date(`${value}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.ceil((target - today) / 86400000);
  }

  function renderBooking() {
    const booking = state.booking;
    if (!booking) return;
    const firstName = (booking.guestName || 'huésped').split(/\s+/)[0];
    $('#guestFirstName').textContent = `${firstName}.`;
    $('#guestStayDates').textContent = `${dateLabel(booking.checkIn)} · ${dateLabel(booking.checkOut)}`;
    const remaining = daysUntil(booking.checkIn);
    $('#guestStayCountdown').textContent = remaining > 1
      ? `Faltan ${remaining} días`
      : remaining === 1
        ? 'Llegas mañana'
        : remaining === 0
          ? 'Llegas hoy'
          : 'Estadía en curso';
    $('#guestWelcomeCopy').textContent = booking.demo
      ? 'Estás viendo el flujo de demostración de la guest app.'
      : 'Todo está listo para tu próxima estadía.';

    const statusLabel = {
      confirmed: 'Confirmada',
      pending: 'Pendiente',
      checked_in: 'Check-in completado',
      checked_out: 'Finalizada',
      cancelled: 'Cancelada'
    }[booking.status] || booking.status;
    $('#bookingStatusBadge').textContent = statusLabel;

    $('#homeRoomName').textContent = booking.roomName || 'Apartaestudio';
    $('#homeBookingCode').textContent = `Reserva ${booking.bookingCode}`;
    $('#homeCheckIn').textContent = dateLabel(booking.checkIn);
    $('#homeCheckOut').textContent = dateLabel(booking.checkOut);
    $('#homeNights').textContent = String(booking.nights || '—');
    $('#manageBookingCode').textContent = booking.bookingCode;
    $('#manageGuestName').textContent = booking.guestName || '—';
    $('#manageRoomName').textContent = booking.roomNumber
      ? `${booking.roomName} · ${booking.roomNumber}`
      : booking.roomName;
    $('#manageDates').textContent = `${dateLabel(booking.checkIn)} — ${dateLabel(booking.checkOut)}`;
    $('#manageTotal').textContent = money(booking.totalAmount);

    const firstNameInput = $('[name="firstName"]');
    const lastNameInput = $('[name="lastName"]');
    const parts = String(booking.guestName || '').trim().split(/\s+/);
    if (firstNameInput && !firstNameInput.value) firstNameInput.value = parts.shift() || '';
    if (lastNameInput && !lastNameInput.value) lastNameInput.value = parts.join(' ');
    if ($('#signedName') && !$('#signedName').value) $('#signedName').value = booking.guestName || '';
  }

  function showApp() {
    $('#guestAccess').hidden = true;
    $('#guestShell').hidden = false;
    $('#guestLogout').hidden = false;
    document.body.classList.add('guest-is-authenticated');
    renderBooking();
    if (window.lucide) window.lucide.createIcons();
  }

  function showLogin() {
    $('#guestAccess').hidden = false;
    $('#guestShell').hidden = true;
    $('#guestLogout').hidden = true;
    document.body.classList.remove('guest-is-authenticated');
  }

  function openTab(tabName) {
    $$('[data-guest-panel]').forEach(panel => {
      panel.classList.toggle('is-active', panel.dataset.guestPanel === tabName);
    });
    $$('[data-guest-tab]').forEach(button => {
      button.classList.toggle('is-active', button.dataset.guestTab === tabName);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('No fue posible leer el archivo.'));
      reader.readAsDataURL(file);
    });
  }

  async function handleDocumentSelection(event) {
    const file = event.target.files && event.target.files[0];
    state.document = null;
    $('#analyzeDocument').disabled = true;
    if (!file) return;
    if (file.size > 4.5 * 1024 * 1024) {
      setStatus($('#ocrStatus'), 'El archivo supera 4.5 MB.', 'error');
      event.target.value = '';
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      state.document = { name: file.name, type: file.type, size: file.size, dataUrl };
      $('#uploadTitle').textContent = file.name;
      $('#uploadMeta').textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB · listo para analizar`;
      $('#analyzeDocument').disabled = false;
      setStatus($('#ocrStatus'), 'Documento cargado.', 'success');
    } catch (error) {
      setStatus($('#ocrStatus'), error.message, 'error');
    }
  }

  function fillExtractedFields(extracted) {
    Object.entries(extracted || {}).forEach(([name, value]) => {
      if (!value) return;
      const field = $(`[name="${name}"]`);
      if (!field) return;
      if (field.tagName === 'SELECT') {
        const normalizeOption = input => String(input || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .trim();
        const documentAliases = {
          passport: 'pasaporte',
          id: 'documento nacional',
          'id card': 'documento nacional',
          'identity card': 'documento nacional',
          'national id': 'documento nacional'
        };
        const normalized = normalizeOption(value);
        const comparable = documentAliases[normalized] || normalized;
        const option = Array.from(field.options).find(item => {
          const candidate = normalizeOption(item.value);
          if (!candidate) return false;
          return candidate === comparable ||
            comparable.includes(candidate) ||
            candidate.includes(comparable);
        });
        if (option) field.value = option.value;
      } else if (!field.value) {
        field.value = value;
      }
    });
  }

  async function analyzeDocument() {
    if (!state.document) return;
    const button = $('#analyzeDocument');
    setButtonLoading(button, true, 'Leyendo');
    setStatus($('#ocrStatus'), 'Validando con reconocimiento de documento…', 'loading');
    try {
      let data;
      if (state.token === 'local-demo-token') {
        await new Promise(resolve => setTimeout(resolve, 700));
        data = {
          source: 'manual',
          extracted: {},
          confidence: 0,
          validation: { missing: [] }
        };
      } else {
        data = await request(API.checkin, {
          method: 'POST',
          body: JSON.stringify({ mode: 'analyze', file: state.document, guest: {} })
        });
      }
      fillExtractedFields(data.extracted);
      const text = data.source === 'azure'
        ? `Documento leído con ${data.confidence || 0}% de confianza. Confirma los datos.`
        : 'OCR no configurado en este entorno. Completa los datos manualmente.';
      setStatus($('#ocrStatus'), text, data.source === 'azure' ? 'success' : '');
      $('#checkinProgress').textContent = 'Paso 2 de 3';
    } catch (error) {
      setStatus($('#ocrStatus'), error.message, 'error');
    } finally {
      setButtonLoading(button, false);
    }
  }

  function guestPayloadFromForm(form) {
    const data = new FormData(form);
    return {
      firstName: data.get('firstName'),
      lastName: data.get('lastName'),
      documentType: data.get('documentType'),
      documentNumber: data.get('documentNumber'),
      birthDate: data.get('birthDate'),
      expirationDate: data.get('expirationDate'),
      nationality: data.get('nationality'),
      arrivalTime: data.get('arrivalTime'),
      email: data.get('email'),
      phone: data.get('phone'),
      address: data.get('address'),
      notes: data.get('notes'),
      privacyAccepted: data.get('privacyAccepted') === 'on'
    };
  }

  async function submitCheckin(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    if (!state.document) {
      setStatus($('#checkinStatus'), 'Primero sube el documento de identidad.', 'error');
      return;
    }
    if (!form.reportValidity()) return;

    setButtonLoading(button, true, 'Completando check-in');
    setStatus($('#checkinStatus'), 'Estamos validando tus datos…', 'loading');
    try {
      let data;
      if (state.token === 'local-demo-token') {
        await new Promise(resolve => setTimeout(resolve, 850));
        data = { checkinId: 'CHK-DEMO-2026', documentAnalysis: 'manual' };
      } else {
        data = await request(API.checkin, {
          method: 'POST',
          body: JSON.stringify({
            mode: 'submit',
            file: state.document,
            guest: guestPayloadFromForm(form)
          })
        });
      }
      setStatus($('#checkinStatus'), `Check-in recibido. Código ${data.checkinId}.`, 'success');
      $('#checkinProgress').textContent = 'Check-in completado';
      $('#bookingStatusBadge').textContent = 'Pre check-in listo';
    } catch (error) {
      const missing = error.data && error.data.validation && error.data.validation.missing;
      const suffix = missing && missing.length ? ` Faltan: ${missing.join(', ')}.` : '';
      setStatus($('#checkinStatus'), `${error.message}${suffix}`, 'error');
    } finally {
      setButtonLoading(button, false);
    }
  }

  async function submitAction(payload, statusElement, button, successMessage) {
    setButtonLoading(button, true, 'Enviando');
    setStatus(statusElement, 'Registrando solicitud…', 'loading');
    try {
      let data;
      if (state.token === 'local-demo-token') {
        await new Promise(resolve => setTimeout(resolve, 550));
        data = { eventId: `GST-DEMO-${Date.now()}`, total: cartTotal() };
      } else {
        data = await request(API.action, {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }
      setStatus(statusElement, `${successMessage} Código ${data.eventId}.`, 'success');
      return data;
    } catch (error) {
      setStatus(statusElement, error.message, 'error');
      return null;
    } finally {
      setButtonLoading(button, false);
    }
  }

  async function signContract() {
    const button = $('#signContract');
    const signedName = $('#signedName').value.trim();
    const acceptedTerms = $('#contractAccepted').checked;
    const data = await submitAction({
      type: 'contract',
      signedName,
      acceptedTerms,
      contractVersion: 'ESTAR-HOSPEDAJE-2026-01'
    }, $('#contractStatus'), button, 'Contrato firmado.');
    if (data) {
      $('#checkinProgress').textContent = 'Proceso completo';
      button.textContent = 'Contrato firmado';
      button.disabled = true;
    }
  }

  function cartTotal() {
    return Object.values(state.cart).reduce((sum, item) => sum + item.price * item.quantity, 0);
  }

  function renderCart() {
    const items = Object.values(state.cart);
    $('#cartCount').textContent = items.reduce((sum, item) => sum + item.quantity, 0);
    $('#cartTotal').textContent = money(cartTotal());
    const container = $('#cartItems');
    if (!items.length) {
      container.innerHTML = '<p class="guest-cart-empty">Aún no has agregado servicios.</p>';
      return;
    }
    container.innerHTML = items.map(item => `
      <div class="guest-cart-item">
        <div><strong>${item.name}</strong><small>${money(item.price)} c/u</small></div>
        <div class="guest-quantity">
          <button type="button" data-cart-change="${item.id}" data-delta="-1" aria-label="Quitar uno">−</button>
          <span>${item.quantity}</span>
          <button type="button" data-cart-change="${item.id}" data-delta="1" aria-label="Agregar uno">+</button>
        </div>
      </div>
    `).join('');
    $$('[data-cart-change]').forEach(button => {
      button.addEventListener('click', () => {
        const item = state.cart[button.dataset.cartChange];
        item.quantity += Number(button.dataset.delta);
        if (item.quantity <= 0) delete state.cart[item.id];
        renderCart();
      });
    });
  }

  function addService(card) {
    const id = card.dataset.serviceId;
    const price = Number(card.dataset.servicePrice);
    const name = card.querySelector('h3').textContent.trim();
    if (!state.cart[id]) state.cart[id] = { id, price, name, quantity: 0 };
    state.cart[id].quantity += 1;
    renderCart();
    $('#guestCart').hidden = false;
  }

  async function submitOrder() {
    const items = Object.values(state.cart).map(item => ({ id: item.id, quantity: item.quantity }));
    const button = $('#submitOrder');
    const data = await submitAction({
      type: 'order',
      items,
      deliveryTime: $('#deliveryTime').value,
      notes: $('#orderNotes').value,
      paymentPreference: $('#paymentPreference').value
    }, $('#orderStatus'), button, 'Pedido recibido.');
    if (data) {
      state.cart = {};
      renderCart();
      $('#guestCart').hidden = true;
      if (data.paymentUrl) window.location.href = data.paymentUrl;
    }
  }

  async function submitSupport(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const result = await submitAction({
      type: 'support',
      category: data.get('category'),
      message: data.get('message')
    }, $('#supportStatus'), form.querySelector('button[type="submit"]'), 'Mensaje enviado.');
    if (result) form.reset();
  }

  async function submitChange(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const result = await submitAction({
      type: 'reservation_change',
      requestKind: data.get('requestKind'),
      requestedCheckIn: data.get('requestedCheckIn'),
      requestedCheckOut: data.get('requestedCheckOut'),
      message: data.get('message')
    }, $('#changeStatus'), form.querySelector('button[type="submit"]'), 'Solicitud recibida.');
    if (result) form.reset();
  }

  async function login(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const bookingCode = $('#bookingCode').value.trim();
    const accessKey = $('#accessKey').value.trim();
    setButtonLoading(button, true, 'Consultando');
    setStatus($('#loginStatus'), 'Buscando tu reserva…', 'loading');
    try {
      const data = await request(API.session, {
        method: 'POST',
        body: JSON.stringify({ bookingCode, accessKey })
      });
      state.token = data.token;
      state.booking = data.booking;
      saveSession();
      setStatus($('#loginStatus'), '', '');
      showApp();
    } catch (error) {
      setStatus($('#loginStatus'), error.message, 'error');
    } finally {
      setButtonLoading(button, false);
    }
  }

  function bindEvents() {
    $('#guestLoginForm').addEventListener('submit', login);
    $('#guestLogout').addEventListener('click', () => {
      clearSession();
      showLogin();
    });
    $$('[data-guest-tab]').forEach(button => {
      button.addEventListener('click', () => openTab(button.dataset.guestTab));
    });
    $$('[data-open-tab]').forEach(button => {
      button.addEventListener('click', () => openTab(button.dataset.openTab));
    });
    $('#identityDocument').addEventListener('change', handleDocumentSelection);
    $('#analyzeDocument').addEventListener('click', analyzeDocument);
    $('#checkinForm').addEventListener('submit', submitCheckin);
    $('#signContract').addEventListener('click', signContract);
    $$('.guest-add-service').forEach(button => {
      button.addEventListener('click', () => addService(button.closest('.guest-service-card')));
    });
    $('#openCart').addEventListener('click', () => {
      $('#guestCart').hidden = false;
      renderCart();
    });
    $('#closeCart').addEventListener('click', () => {
      $('#guestCart').hidden = true;
    });
    $('#submitOrder').addEventListener('click', submitOrder);
    $('#supportForm').addEventListener('submit', submitSupport);
    $('#changeForm').addEventListener('submit', submitChange);
    $('#requestKind').addEventListener('change', event => {
      $('#requestedDates').hidden = event.target.value !== 'dates';
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    renderCart();
    if (restoreSession()) {
      showApp();
    } else if (
      new URLSearchParams(window.location.search).get('demo') === '1' &&
      ['localhost', '127.0.0.1'].includes(window.location.hostname)
    ) {
      localDemoSession();
      showApp();
    } else {
      showLogin();
    }
    if (window.lucide) window.lucide.createIcons();
    window.addEventListener('load', () => {
      if (window.lucide) window.lucide.createIcons();
    });
  });
})();
