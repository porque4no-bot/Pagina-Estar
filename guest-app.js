(function () {
  'use strict';

  const API = {
    session: '/api/guest-session',
    checkin: '/api/guest-checkin',
    action: '/api/guest-action'
  };
  const guestI18n = {
    es: /*__GUEST_I18N_ES_START__*/{
      "expirationDateOptionalHint": "(opcional, solo pasaportes)",
      "nationalityPlaceholder": "Ej. Colombia",
      "cameraButton": "Tomar foto",
      "cameraInstruction": "Encuadrá el documento dentro del marco",
      "captureBtn": "Capturar",
      "retakeBtn": "Reintentar",
      "photoTooDark": "Foto muy oscura o con demasiada luz, probá de nuevo",
      "photoBlurry": "Foto borrosa, probá de nuevo",
      "cameraUnavailable": "No fue posible abrir la cámara. Podés subir una imagen.",
      "photoReady": "Foto lista para analizar.",
      "occupantCountLabel": "¿Cuántas personas se hospedan?",
      "guestSlotEmpty": "Vacía",
      "guestSlotOcrOk": "OCR ok",
      "guestSlotPendingSignature": "Pendiente firma",
      "primaryGuestLabel": "Principal"
    }/*__GUEST_I18N_ES_END__*/,
    en: /*__GUEST_I18N_EN_START__*/{
      "expirationDateOptionalHint": "(optional, passports only)",
      "nationalityPlaceholder": "E.g. Colombia",
      "cameraButton": "Take photo",
      "cameraInstruction": "Frame the document inside the guide",
      "captureBtn": "Capture",
      "retakeBtn": "Retake",
      "photoTooDark": "Photo too dark or too bright, try again",
      "photoBlurry": "Photo is blurry, try again",
      "cameraUnavailable": "We could not open the camera. You can upload an image.",
      "photoReady": "Photo ready to analyze.",
      "occupantCountLabel": "How many people are staying?",
      "guestSlotEmpty": "Empty",
      "guestSlotOcrOk": "OCR ok",
      "guestSlotPendingSignature": "Pending signature",
      "primaryGuestLabel": "Primary"
    }/*__GUEST_I18N_EN_END__*/
  };
  const CAMERA_WIDTH = 1600;
  const CAMERA_HEIGHT = 1006;
  const CAMERA_QUALITY = 0.9;
  const SESSION_KEY = 'estar-guest-session';
  const state = {
    token: '',
    booking: null,
    document: null,
    guestSlots: [],
    activeGuestIndex: 0,
    cart: {},
    cameraStream: null
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

  function currentLang() {
    return document.documentElement.lang === 'en' || window.location.pathname.startsWith('/en/')
      ? 'en'
      : 'es';
  }

  function t(key) {
    const dict = guestI18n[currentLang()] || guestI18n.es;
    return dict[key] || guestI18n.es[key] || key;
  }

  function applyGuestI18n() {
    $$('[data-guest-i18n]').forEach(element => {
      const key = element.dataset.guestI18n;
      element.textContent = t(key);
    });
    $$('[data-guest-i18n-placeholder]').forEach(element => {
      const key = element.dataset.guestI18nPlaceholder;
      element.setAttribute('placeholder', t(key));
    });
  }

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
    state.guestSlots = [];
    state.activeGuestIndex = 0;
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
      capacity: 2,
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

  function emptyGuest() {
    return {
      firstName: '',
      lastName: '',
      documentType: '',
      documentNumber: '',
      birthDate: '',
      expirationDate: '',
      nationality: '',
      arrivalTime: '',
      email: '',
      phone: '',
      address: '',
      notes: '',
      privacyAccepted: false
    };
  }

  function createGuestSlot(index) {
    return {
      guest: emptyGuest(),
      document: null,
      analysisSource: '',
      confidence: 0,
      isPrimary: index === 0,
      status: 'empty'
    };
  }

  function bookingCapacity() {
    const capacity = Number(state.booking && state.booking.capacity);
    return Math.min(5, Math.max(1, Number.isFinite(capacity) && capacity > 0 ? capacity : 1));
  }

  function updateOccupantCountOptions() {
    const select = $('#occupantCount');
    if (!select) return;
    const max = bookingCapacity();
    Array.from(select.options).forEach(option => {
      option.disabled = Number(option.value) > max;
    });
  }

  function splitBookingName() {
    const parts = String((state.booking && state.booking.guestName) || '').trim().split(/\s+/).filter(Boolean);
    return { firstName: parts.shift() || '', lastName: parts.join(' ') };
  }

  function activeSlot() {
    return state.guestSlots[state.activeGuestIndex] || null;
  }

  function formFields() {
    return [
      'firstName', 'lastName', 'documentType', 'documentNumber', 'birthDate',
      'expirationDate', 'nationality', 'arrivalTime', 'email', 'phone', 'address', 'notes'
    ];
  }

  function saveActiveGuestFromForm() {
    const slot = activeSlot();
    if (!slot) return;
    formFields().forEach(name => {
      const field = $(`[name="${name}"]`);
      if (field) slot.guest[name] = field.value || '';
    });
    const privacy = $('[name="privacyAccepted"]');
    if (privacy) slot.guest.privacyAccepted = privacy.checked;
    slot.status = slot.document
      ? (slot.analysisSource === 'azure' ? 'ocr' : 'pending')
      : 'empty';
  }

  function loadActiveGuestIntoForm() {
    const slot = activeSlot();
    if (!slot) return;
    formFields().forEach(name => {
      const field = $(`[name="${name}"]`);
      if (field) field.value = slot.guest[name] || '';
    });
    const privacy = $('[name="privacyAccepted"]');
    if (privacy) privacy.checked = Boolean(slot.guest.privacyAccepted);
    state.document = slot.document;
    if (slot.document) {
      $('#uploadTitle').textContent = slot.document.name;
      $('#uploadMeta').textContent = `${(slot.document.size / 1024 / 1024).toFixed(2)} MB · listo para analizar`;
      $('#analyzeDocument').disabled = false;
    } else {
      $('#uploadTitle').textContent = 'Subir archivo';
      $('#uploadMeta').textContent = 'JPG, PNG o PDF. Máximo 4.5 MB.';
      $('#analyzeDocument').disabled = true;
    }
    setStatus($('#ocrStatus'), '', '');
    updateExpirationRequirement();
  }

  function slotLabel(slot, index) {
    const name = `${slot.guest.firstName || ''} ${slot.guest.lastName || ''}`.trim();
    return name || `Huésped ${index + 1}`;
  }

  function slotStatusLabel(slot) {
    if (slot.status === 'ocr') return t('guestSlotOcrOk');
    if (slot.document) return t('guestSlotPendingSignature');
    return t('guestSlotEmpty');
  }

  function renderGuestCards() {
    const container = $('#guestCards');
    if (!container) return;
    container.innerHTML = state.guestSlots.map((slot, index) => `
      <article class="guest-occupant-card${index === state.activeGuestIndex ? ' is-active' : ''}" data-guest-slot="${index}">
        <button type="button" class="guest-occupant-main" data-select-guest="${index}">
          <strong>${slotLabel(slot, index)}</strong>
          <small>${slotStatusLabel(slot)}</small>
        </button>
        <label class="guest-primary-choice">
          <input type="radio" name="primaryGuest" value="${index}" ${slot.isPrimary ? 'checked' : ''}>
          <span>${t('primaryGuestLabel')}</span>
        </label>
      </article>
    `).join('');
    $$('[data-select-guest]').forEach(button => {
      button.addEventListener('click', () => selectGuestSlot(Number(button.dataset.selectGuest)));
    });
    $$('[name="primaryGuest"]').forEach(input => {
      input.addEventListener('change', event => setPrimaryGuest(Number(event.target.value)));
    });
  }

  function selectGuestSlot(index) {
    saveActiveGuestFromForm();
    state.activeGuestIndex = Math.max(0, Math.min(index, state.guestSlots.length - 1));
    loadActiveGuestIntoForm();
    renderGuestCards();
  }

  function setPrimaryGuest(index) {
    state.guestSlots.forEach((slot, slotIndex) => {
      slot.isPrimary = slotIndex === index;
    });
    renderGuestCards();
  }

  function setGuestSlotCount(count) {
    saveActiveGuestFromForm();
    const nextCount = Math.min(bookingCapacity(), Math.max(1, Number(count) || 1));
    while (state.guestSlots.length < nextCount) {
      state.guestSlots.push(createGuestSlot(state.guestSlots.length));
    }
    state.guestSlots = state.guestSlots.slice(0, nextCount);
    if (!state.guestSlots.some(slot => slot.isPrimary)) state.guestSlots[0].isPrimary = true;
    state.activeGuestIndex = Math.min(state.activeGuestIndex, state.guestSlots.length - 1);
    $('#occupantCount').value = String(nextCount);
    loadActiveGuestIntoForm();
    renderGuestCards();
  }

  function initializeGuestSlots() {
    if (state.guestSlots.length) return;
    const count = bookingCapacity();
    updateOccupantCountOptions();
    state.guestSlots = Array.from({ length: count }, (_, index) => createGuestSlot(index));
    const bookingName = splitBookingName();
    state.guestSlots[0].guest.firstName = bookingName.firstName;
    state.guestSlots[0].guest.lastName = bookingName.lastName;
    state.guestSlots[0].guest.email = (state.booking && state.booking.guestEmail) || '';
    $('#occupantCount').value = String(count);
    loadActiveGuestIntoForm();
    renderGuestCards();
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
    initializeGuestSlots();
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

  function dataUrlToImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('No fue posible leer la imagen.'));
      image.src = dataUrl;
    });
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('No fue posible preparar la foto.'));
      }, 'image/jpeg', CAMERA_QUALITY);
    });
  }

  function drawCover(source, canvas) {
    const context = canvas.getContext('2d');
    const sourceWidth = source.videoWidth || source.naturalWidth || source.width;
    const sourceHeight = source.videoHeight || source.naturalHeight || source.height;
    const targetRatio = CAMERA_WIDTH / CAMERA_HEIGHT;
    const sourceRatio = sourceWidth / sourceHeight;
    let sx = 0;
    let sy = 0;
    let sw = sourceWidth;
    let sh = sourceHeight;
    if (sourceRatio > targetRatio) {
      sw = sourceHeight * targetRatio;
      sx = (sourceWidth - sw) / 2;
    } else {
      sh = sourceWidth / targetRatio;
      sy = (sourceHeight - sh) / 2;
    }
    context.drawImage(source, sx, sy, sw, sh, 0, 0, CAMERA_WIDTH, CAMERA_HEIGHT);
  }

  function photoMetrics(canvas) {
    const sample = document.createElement('canvas');
    sample.width = 320;
    sample.height = 201;
    const sampleContext = sample.getContext('2d', { willReadFrequently: true });
    sampleContext.drawImage(canvas, 0, 0, sample.width, sample.height);
    const { data } = sampleContext.getImageData(0, 0, sample.width, sample.height);
    const gray = new Float32Array(sample.width * sample.height);
    let brightness = 0;
    for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
      const value = (data[i] * 0.299) + (data[i + 1] * 0.587) + (data[i + 2] * 0.114);
      gray[p] = value;
      brightness += value;
    }
    brightness /= gray.length;

    let count = 0;
    let mean = 0;
    let m2 = 0;
    for (let y = 1; y < sample.height - 1; y += 1) {
      for (let x = 1; x < sample.width - 1; x += 1) {
        const idx = (y * sample.width) + x;
        const laplacian = (-4 * gray[idx]) + gray[idx - 1] + gray[idx + 1] + gray[idx - sample.width] + gray[idx + sample.width];
        count += 1;
        const delta = laplacian - mean;
        mean += delta / count;
        m2 += delta * (laplacian - mean);
      }
    }
    return { brightness, laplacianVariance: count > 1 ? m2 / (count - 1) : 0 };
  }

  function validateCameraCanvas(canvas) {
    const metrics = photoMetrics(canvas);
    if (metrics.brightness < 30 || metrics.brightness > 220) {
      throw Object.assign(new Error(t('photoTooDark')), { code: 'photo-too-dark' });
    }
    if (metrics.laplacianVariance < 100) {
      throw Object.assign(new Error(t('photoBlurry')), { code: 'photo-blurry' });
    }
  }

  async function documentFromCanvas(canvas) {
    validateCameraCanvas(canvas);
    const blob = await canvasToBlob(canvas);
    const dataUrl = canvas.toDataURL('image/jpeg', CAMERA_QUALITY);
    return {
      name: `documento-${Date.now()}.jpg`,
      type: 'image/jpeg',
      size: blob.size,
      dataUrl
    };
  }

  async function imageFileToCameraDocument(file) {
    const dataUrl = await fileToDataUrl(file);
    const image = await dataUrlToImage(dataUrl);
    const canvas = $('#cameraCanvas');
    canvas.width = CAMERA_WIDTH;
    canvas.height = CAMERA_HEIGHT;
    drawCover(image, canvas);
    return documentFromCanvas(canvas);
  }

  function setDocument(documentPayload, message) {
    const slot = activeSlot();
    state.document = documentPayload;
    if (slot) {
      slot.document = documentPayload;
      slot.status = 'pending';
    }
    $('#uploadTitle').textContent = documentPayload.name;
    $('#uploadMeta').textContent = `${(documentPayload.size / 1024 / 1024).toFixed(2)} MB · listo para analizar`;
    $('#analyzeDocument').disabled = false;
    setStatus($('#ocrStatus'), message || 'Documento cargado.', 'success');
    renderGuestCards();
  }

  async function handleDocumentSelection(event) {
    const file = event.target.files && event.target.files[0];
    const slot = activeSlot();
    state.document = null;
    if (slot) {
      slot.document = null;
      slot.status = 'empty';
      slot.analysisSource = '';
      slot.confidence = 0;
    }
    $('#analyzeDocument').disabled = true;
    if (!file) return;
    if (file.size > 4.5 * 1024 * 1024) {
      setStatus($('#ocrStatus'), 'El archivo supera 4.5 MB.', 'error');
      event.target.value = '';
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      setDocument({ name: file.name, type: file.type, size: file.size, dataUrl });
    } catch (error) {
      setStatus($('#ocrStatus'), error.message, 'error');
    }
  }

  async function handleNativeCameraSelection(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      const documentPayload = await imageFileToCameraDocument(file);
      setDocument(documentPayload, t('photoReady'));
    } catch (error) {
      setStatus($('#ocrStatus'), error.message, 'error');
    }
  }

  function isCoarsePointer() {
    return window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  }

  function setCameraStatus(message, type) {
    setStatus($('#cameraStatus'), message, type);
    $('#retakePhoto').hidden = type !== 'error';
  }

  function stopCamera() {
    if (state.cameraStream) {
      state.cameraStream.getTracks().forEach(track => track.stop());
      state.cameraStream = null;
    }
    const preview = $('#cameraPreview');
    if (preview) preview.srcObject = null;
  }

  function closeCamera() {
    stopCamera();
    $('#cameraModal').hidden = true;
    document.body.classList.remove('guest-camera-open');
    setCameraStatus('', '');
  }

  async function requestCamera(facingMode) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error(t('cameraUnavailable'));
    }
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: CAMERA_WIDTH },
        height: { ideal: CAMERA_HEIGHT }
      }
    });
  }

  async function startCamera() {
    let stream;
    try {
      stream = await requestCamera('environment');
    } catch (error) {
      stream = await requestCamera('user');
    }
    state.cameraStream = stream;
    const preview = $('#cameraPreview');
    preview.srcObject = stream;
    await preview.play();
  }

  async function openCamera() {
    setStatus($('#ocrStatus'), '', '');
    $('#retakePhoto').hidden = true;
    $('#cameraModal').hidden = false;
    document.body.classList.add('guest-camera-open');
    setCameraStatus('', '');
    try {
      await startCamera();
    } catch (error) {
      closeCamera();
      if (isCoarsePointer()) {
        $('#cameraFileCapture').click();
      } else {
        setStatus($('#ocrStatus'), t('cameraUnavailable'), 'error');
      }
    }
  }

  async function capturePhoto() {
    const preview = $('#cameraPreview');
    const canvas = $('#cameraCanvas');
    if (!preview.videoWidth || !preview.videoHeight) return;
    try {
      canvas.width = CAMERA_WIDTH;
      canvas.height = CAMERA_HEIGHT;
      drawCover(preview, canvas);
      const documentPayload = await documentFromCanvas(canvas);
      setDocument(documentPayload, t('photoReady'));
      closeCamera();
    } catch (error) {
      setCameraStatus(error.message, 'error');
    }
  }

  function normalizeDocumentTypeOption(value) {
    const normalizeOption = input => String(input || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    const documentAliases = {
      cc: 'cc',
      'cedula': 'cc',
      'cedula ciudadania': 'cc',
      'cedula de ciudadania': 'cc',
      'cedula colombiana': 'cc',
      'documento nacional': 'cc',
      'id': 'cc',
      'id card': 'cc',
      'identity card': 'cc',
      'national id': 'cc',
      'national identity card': 'cc',
      'iddocument nationalidentitycard': 'cc',
      ce: 'ce',
      'cedula extranjeria': 'ce',
      'cedula de extranjeria': 'ce',
      'residence permit': 'ce',
      'iddocument residencepermit': 'ce',
      passport: 'pasaporte',
      'iddocument passport': 'pasaporte',
      'driver license': 'licencia',
      'drivers license': 'licencia',
      'licencia de conduccion': 'licencia',
      'iddocument driverlicense': 'licencia'
    };
    const normalized = normalizeOption(value);
    const comparable = documentAliases[normalized] || normalized;
    const field = $('[name="documentType"]');
    const options = field ? Array.from(field.options) : [];
    const option = options.find(item => {
      const candidate = normalizeOption(item.value);
      if (!candidate) return false;
      return candidate === comparable ||
        comparable.includes(candidate) ||
        candidate.includes(comparable);
    });
    return option ? option.value : '';
  }

  function applyExtractedToGuest(guest, extracted) {
    Object.entries(extracted || {}).forEach(([name, value]) => {
      if (!value) return;
      if (name === 'documentType') {
        const normalized = normalizeDocumentTypeOption(value);
        if (normalized) guest.documentType = normalized;
      } else if (!guest[name]) {
        guest[name] = value;
      }
    });
  }

  function fillExtractedFields(extracted) {
    Object.entries(extracted || {}).forEach(([name, value]) => {
      if (!value) return;
      const field = $(`[name="${name}"]`);
      if (!field) return;
      if (field.tagName === 'SELECT') {
        const normalized = normalizeDocumentTypeOption(value);
        if (normalized) field.value = normalized;
      } else if (!field.value) {
        field.value = value;
      }
    });
    updateExpirationRequirement();
  }

  function updateExpirationRequirement() {
    const documentType = $('[name="documentType"]');
    const expirationDate = $('[name="expirationDate"]');
    if (!documentType || !expirationDate) return;
    expirationDate.required = documentType.value === 'Pasaporte';
  }

  async function analyzeDocument() {
    if (!state.document) return;
    const button = $('#analyzeDocument');
    const analysisGuestIndex = state.activeGuestIndex;
    const analysisSlot = state.guestSlots[analysisGuestIndex];
    const analysisDocument = analysisSlot && analysisSlot.document;
    if (!analysisSlot || !analysisDocument) return;
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
          body: JSON.stringify({
            mode: 'analyze',
            file: analysisDocument,
            guest: {},
            slotIndex: analysisGuestIndex
          })
        });
      }
      const targetSlot = state.guestSlots[analysisGuestIndex];
      if (targetSlot) {
        applyExtractedToGuest(targetSlot.guest, data.extracted);
        targetSlot.analysisSource = data.source || '';
        targetSlot.confidence = Number(data.confidence || 0);
        targetSlot.status = data.source === 'azure' ? 'ocr' : 'pending';
      }
      if (state.activeGuestIndex === analysisGuestIndex) {
        loadActiveGuestIntoForm();
      }
      renderGuestCards();
      const azureFailed = data.source === 'azure-error';
      const text = data.source === 'azure'
        ? `Documento leído con ${data.confidence || 0}% de confianza. Confirma los datos.`
        : azureFailed
          ? 'No fue posible leer el documento automáticamente. Completa los datos manualmente.'
          : 'OCR no configurado en este entorno. Completa los datos manualmente.';
      setStatus($('#ocrStatus'), text, data.source === 'azure' ? 'success' : azureFailed ? 'error' : '');
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

  function guestNeedsReview(slot) {
    const guest = slot && slot.guest ? slot.guest : {};
    const requiredFields = [
      'firstName',
      'lastName',
      'documentType',
      'documentNumber',
      'birthDate',
      'nationality',
      'email',
      'phone'
    ];
    const missingRequired = requiredFields.some(field => !String(guest[field] || '').trim());
    const missingPassportExpiry = guest.documentType === 'Pasaporte' && !guest.expirationDate;
    const invalidEmail = guest.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest.email);
    return missingRequired || missingPassportExpiry || invalidEmail || !guest.privacyAccepted;
  }

  async function submitCheckin(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    saveActiveGuestFromForm();
    const missingDocumentIndex = state.guestSlots.findIndex(slot => !slot.document);
    if (missingDocumentIndex >= 0) {
      selectGuestSlot(missingDocumentIndex);
      setStatus($('#checkinStatus'), 'Primero sube el documento de identidad de cada huésped.', 'error');
      return;
    }
    const incompleteGuestIndex = state.guestSlots.findIndex(guestNeedsReview);
    if (incompleteGuestIndex >= 0) {
      selectGuestSlot(incompleteGuestIndex);
      updateExpirationRequirement();
      form.reportValidity();
      setStatus($('#checkinStatus'), 'Completa los datos requeridos de cada huésped.', 'error');
      return;
    }
    updateExpirationRequirement();
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
            guests: state.guestSlots.map(slot => ({
              guest: { ...slot.guest },
              file: slot.document,
              isPrimary: slot.isPrimary,
              analysisSource: slot.analysisSource || 'manual',
              confidence: slot.confidence || 0
            }))
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
    saveActiveGuestFromForm();
    const data = await submitAction({
      type: 'contract',
      signedName,
      acceptedTerms,
      guests: state.guestSlots.map(slot => ({ guest: slot.guest, isPrimary: slot.isPrimary })),
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
    $('#cameraFileCapture').addEventListener('change', handleNativeCameraSelection);
    $('#openCamera').addEventListener('click', openCamera);
    $('#closeCamera').addEventListener('click', closeCamera);
    $('#capturePhoto').addEventListener('click', capturePhoto);
    $('#retakePhoto').addEventListener('click', () => setCameraStatus('', ''));
    $('#cameraModal').addEventListener('click', event => {
      if (event.target.id === 'cameraModal') closeCamera();
    });
    $('[name="documentType"]').addEventListener('change', updateExpirationRequirement);
    $('#analyzeDocument').addEventListener('click', analyzeDocument);
    $('#checkinForm').addEventListener('submit', submitCheckin);
    formFields().forEach(name => {
      const field = $(`[name="${name}"]`);
      if (field) field.addEventListener('input', () => {
        saveActiveGuestFromForm();
        renderGuestCards();
      });
    });
    $('[name="privacyAccepted"]').addEventListener('change', () => {
      saveActiveGuestFromForm();
      renderGuestCards();
    });
    $('#occupantCount').addEventListener('change', event => setGuestSlotCount(event.target.value));
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
    applyGuestI18n();
    renderCart();
    updateExpirationRequirement();
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
