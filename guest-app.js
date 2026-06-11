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
      "primaryGuestLabel": "Principal",
      "minorBadge": "Menor de edad",
      "minorDocsTitle": "Documentación del menor",
      "minorRcnLabel": "Registro civil de nacimiento",
      "minorRcnHelp": "Lo necesitamos para validar la autorización de un progenitor.",
      "minorFatherLabel": "Nombre del padre",
      "minorMotherLabel": "Nombre de la madre",
      "minorParentDetected": "Padre o madre detectado en el registro civil.",
      "minorParentNotPresentWarn": "Ningún padre o madre figura entre los adultos del check-in. Debes subir una carta de autorización firmada por un progenitor.",
      "minorAuthorizationLabel": "Carta de autorización",
      "minorAuthorizationHelp": "Documento firmado por padre, madre o tutor legal autorizando la estadía del menor.",
      "minorBlockingNotice": "Antes de confirmar el check-in, completa los documentos requeridos para los menores.",
      "escnnaReminder": "En cumplimiento de la Ley 679 de 2001, advertimos que la explotación y el abuso sexual de menores de edad son sancionados penal y administrativamente.",
      "viewContractLink": "Ver contrato completo",
      "contractModalTitle": "Contrato de Hospedaje",
      "contractModalEyebrow": "Antes de firmar",
      "contractModalIntro": "Lee el contrato completo. Para habilitar la firma, marca la casilla o desplázate hasta el final.",
      "contractModalScrollHint": "Desplázate hasta el final para habilitar la firma.",
      "contractModalReadyHint": "Has leído el contrato. Puedes cerrar y firmar.",
      "contractDownloadBtn": "Descargar PDF",
      "contractCloseBtn": "Cerrar",
      "contractAcknowledgeLabel": "He leído el contrato completo.",
      "contractAcknowledgeBlocked": "Lee el contrato antes de firmar.",
      "contractReadConfirmation": "Confirmación de lectura registrada.",
      "contractConsentText": "Declaro que he leído, entiendo y acepto íntegramente este contrato de hospedaje, sus cláusulas y políticas, y firmo electrónicamente con plenos efectos legales conforme a la Ley 527 de 1999 y el Decreto 2364 de 2012 de Colombia."
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
      "primaryGuestLabel": "Primary",
      "minorBadge": "Minor",
      "minorDocsTitle": "Minor documentation",
      "minorRcnLabel": "Birth certificate",
      "minorRcnHelp": "We need it to validate parental authorization.",
      "minorFatherLabel": "Father's name",
      "minorMotherLabel": "Mother's name",
      "minorParentDetected": "Parent detected from birth certificate.",
      "minorParentNotPresentWarn": "No parent listed among adult guests in this check-in. You must upload a signed authorization letter from a parent.",
      "minorAuthorizationLabel": "Authorization letter",
      "minorAuthorizationHelp": "Document signed by a parent or legal guardian authorizing the minor's stay.",
      "minorBlockingNotice": "Before confirming check-in, complete the required documents for minors.",
      "escnnaReminder": "In compliance with Colombian Law 679 of 2001, we warn that child sexual exploitation and abuse are criminally and administratively punished.",
      "viewContractLink": "View full contract",
      "contractModalTitle": "Hospitality Agreement",
      "contractModalEyebrow": "Before you sign",
      "contractModalIntro": "Read the full contract. To enable signing, tick the box or scroll to the end.",
      "contractModalScrollHint": "Scroll to the end to enable signing.",
      "contractModalReadyHint": "You have read the contract. You can close and sign.",
      "contractDownloadBtn": "Download PDF",
      "contractCloseBtn": "Close",
      "contractAcknowledgeLabel": "I have read the full contract.",
      "contractAcknowledgeBlocked": "Read the contract before signing.",
      "contractReadConfirmation": "Read confirmation recorded.",
      "contractConsentText": "I declare that I have read, understand, and fully accept this hospitality agreement, its clauses, and policies, and I electronically sign it with full legal effect under Colombian Law 527 of 1999 and Decree 2364 of 2012."
    }/*__GUEST_I18N_EN_END__*/
  };
  const CAMERA_WIDTH = 1600;
  const CAMERA_HEIGHT = 1006;
  const CAMERA_QUALITY = 0.9;
  const SESSION_KEY = 'estar-guest-session';
  /* Pinned contract version + clause body. The string is presented to the
     user via the preview modal and hashed server-side (audit trail) so any
     future edit yields a different hash. Keep clause text in lockstep with
     netlify/functions/_contract-template.js and _pdf-render.js. */
  const CONTRACT_VERSION = 'ESTAR-HOSPEDAJE-2026-01';
  const state = {
    token: '',
    booking: null,
    document: null,
    guestSlots: [],
    activeGuestIndex: 0,
    cart: {},
    cameraStream: null,
    /* Audit-trail evidence for the e-signature flow (Ley 527 / Decreto 2364):
       contractRead is set true when the user scrolls to the end of the modal
       OR explicitly ticks "I have read", and acknowledgedAt records the ISO
       timestamp. The server independently re-validates and adds IP + UA. */
    contractRead: false,
    contractAcknowledgedAt: '',
    previewHtml: ''
  };

  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  const escHtml = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
      documentRef: null,
      analysisSource: '',
      confidence: 0,
      isPrimary: index === 0,
      status: 'empty',
      isMinor: false,
      fatherName: '',
      motherName: '',
      registroCivilDocumentRef: null,
      registroCivilName: '',
      authorizationDocumentRef: null,
      authorizationName: '',
      parentPresent: false
    };
  }

  function calculateAgeClient(birthDate) {
    if (!birthDate) return 0;
    const value = String(birthDate).trim();
    if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return 0;
    const [y, mo, d] = value.slice(0, 10).split('-').map(Number);
    if (mo < 1 || mo > 12 || d < 1 || d > new Date(y, mo, 0).getDate()) return 0;
    const birth = new Date(`${value.slice(0, 10)}T00:00:00`);
    if (Number.isNaN(birth.getTime())) return 0;
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const m = now.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age -= 1;
    return Math.max(0, age);
  }

  function normalizeNameClient(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function progenitorMatchesAdult(progenitorName, adultSlots) {
    const target = normalizeNameClient(progenitorName);
    if (!target) return false;
    const targetTokens = target.split(' ').filter(Boolean);
    if (!targetTokens.length) return false;
    return adultSlots.some(slot => {
      const candidate = normalizeNameClient(`${slot.guest.firstName || ''} ${slot.guest.lastName || ''}`);
      if (!candidate) return false;
      if (target.length >= 3 && (candidate.includes(target) || target.includes(candidate))) return true;
      const candidateTokens = new Set(candidate.split(' ').filter(Boolean));
      const allPresent = targetTokens.every(token => candidateTokens.has(token));
      return allPresent && targetTokens.some(token => token.length >= 3);
    });
  }

  function recomputeMinorParentPresence() {
    const adultSlots = state.guestSlots.filter(slot => !slot.isMinor);
    state.guestSlots.forEach(slot => {
      if (!slot.isMinor) {
        slot.parentPresent = false;
        return;
      }
      slot.parentPresent = progenitorMatchesAdult(slot.fatherName, adultSlots)
        || progenitorMatchesAdult(slot.motherName, adultSlots);
    });
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
    slot.isMinor = calculateAgeClient(slot.guest.birthDate) < 18 && Boolean(slot.guest.birthDate);
    if (!slot.isMinor) {
      /* Clear any minor-only state if the guest turns out to be an adult so
         we don't accidentally send stale refs to the server. */
      slot.fatherName = '';
      slot.motherName = '';
      slot.registroCivilDocumentRef = null;
      slot.registroCivilName = '';
      slot.authorizationDocumentRef = null;
      slot.authorizationName = '';
      slot.parentPresent = false;
    }
    recomputeMinorParentPresence();
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
    renderMinorSection();
  }

  function renderMinorSection() {
    const slot = activeSlot();
    const card = $('#minorDocsCard');
    if (!card) return;
    if (!slot || !slot.isMinor) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    const fatherInput = $('#minorFatherName');
    const motherInput = $('#minorMotherName');
    if (fatherInput) fatherInput.value = slot.fatherName || '';
    if (motherInput) motherInput.value = slot.motherName || '';
    const rcnTitle = $('#minorRcnTitle');
    const rcnMeta = $('#minorRcnMeta');
    if (slot.registroCivilDocumentRef) {
      if (rcnTitle) rcnTitle.textContent = slot.registroCivilName || t('minorRcnLabel');
      if (rcnMeta) rcnMeta.textContent = (slot.fatherName || slot.motherName) ? t('minorParentDetected') : t('minorRcnHelp');
    } else {
      if (rcnTitle) rcnTitle.textContent = t('minorRcnLabel');
      if (rcnMeta) rcnMeta.textContent = 'JPG, PNG o PDF. Máximo 4.5 MB.';
    }
    const authBlock = $('#minorAuthBlock');
    const authTitle = $('#minorAuthTitle');
    const authMeta = $('#minorAuthMeta');
    const parentMessage = $('#minorParentMessage');
    const hasParentInput = Boolean(slot.fatherName || slot.motherName);
    if (hasParentInput && !slot.parentPresent) {
      if (authBlock) authBlock.hidden = false;
      if (parentMessage) setStatus(parentMessage, t('minorParentNotPresentWarn'), 'error');
    } else {
      if (authBlock) authBlock.hidden = !slot.authorizationDocumentRef ? true : false;
      if (parentMessage) {
        if (slot.parentPresent) setStatus(parentMessage, t('minorParentDetected'), 'success');
        else setStatus(parentMessage, '', '');
      }
    }
    if (slot.authorizationDocumentRef) {
      if (authTitle) authTitle.textContent = slot.authorizationName || t('minorAuthorizationLabel');
      if (authMeta) authMeta.textContent = t('minorAuthorizationHelp');
    } else {
      if (authTitle) authTitle.textContent = t('minorAuthorizationLabel');
      if (authMeta) authMeta.textContent = 'JPG, PNG o PDF. Máximo 4.5 MB.';
    }
    setStatus($('#minorRcnStatus'), slot.registroCivilDocumentRef
      ? `${slot.registroCivilName || ''} listo`.trim()
      : '', slot.registroCivilDocumentRef ? 'success' : '');
    setStatus($('#minorAuthStatus'), slot.authorizationDocumentRef
      ? `${slot.authorizationName || ''} listo`.trim()
      : '', slot.authorizationDocumentRef ? 'success' : '');
  }

  async function uploadMinorDocument(docKind, file) {
    const slot = activeSlot();
    if (!slot) return;
    if (file.size > 4.5 * 1024 * 1024) {
      setStatus($(`#${docKind === 'registro-civil' ? 'minorRcnStatus' : 'minorAuthStatus'}`), 'El archivo supera 4.5 MB.', 'error');
      return;
    }
    const dataUrl = await fileToDataUrl(file);
    const documentPayload = { name: file.name, type: file.type, size: file.size, dataUrl };
    const slotIndex = state.activeGuestIndex;
    const statusEl = docKind === 'registro-civil' ? $('#minorRcnStatus') : $('#minorAuthStatus');
    setStatus(statusEl, 'Subiendo documento…', 'loading');
    try {
      let data;
      if (state.token === 'local-demo-token') {
        await new Promise(resolve => setTimeout(resolve, 400));
        data = {
          documentRef: { key: `local-demo/${docKind}/${slotIndex}`, name: file.name },
          extracted: docKind === 'registro-civil' ? { fatherName: '', motherName: '' } : null
        };
      } else {
        data = await request(API.checkin, {
          method: 'POST',
          body: JSON.stringify({
            mode: 'analyze-minor-doc',
            file: documentPayload,
            slotIndex,
            docKind
          })
        });
      }
      const targetSlot = state.guestSlots[slotIndex];
      if (!targetSlot) return;
      if (docKind === 'registro-civil') {
        targetSlot.registroCivilDocumentRef = data.documentRef || null;
        targetSlot.registroCivilName = file.name;
        if (data.extracted) {
          if (data.extracted.fatherName && !targetSlot.fatherName) targetSlot.fatherName = data.extracted.fatherName;
          if (data.extracted.motherName && !targetSlot.motherName) targetSlot.motherName = data.extracted.motherName;
        }
      } else {
        targetSlot.authorizationDocumentRef = data.documentRef || null;
        targetSlot.authorizationName = file.name;
      }
      recomputeMinorParentPresence();
      if (state.activeGuestIndex === slotIndex) renderMinorSection();
      renderGuestCards();
      setStatus(statusEl, t('photoReady'), 'success');
    } catch (error) {
      setStatus(statusEl, error.message, 'error');
    }
  }

  async function handleMinorRcnSelection(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    await uploadMinorDocument('registro-civil', file);
    event.target.value = '';
  }

  async function handleMinorAuthSelection(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    await uploadMinorDocument('autorizacion', file);
    event.target.value = '';
  }

  async function handleMinorRcnCamera(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      const documentPayload = await imageFileToCameraDocument(file);
      await uploadMinorDocumentFromPayload('registro-civil', documentPayload);
    } catch (error) {
      setStatus($('#minorRcnStatus'), error.message, 'error');
    }
  }

  async function uploadMinorDocumentFromPayload(docKind, documentPayload) {
    /* uploadMinorDocument reads the File via fileToDataUrl. The camera path
       already produced a dataUrl, so we hand it over directly to skip a
       second decode pass. */
    const slot = activeSlot();
    if (!slot) return;
    const slotIndex = state.activeGuestIndex;
    const statusEl = docKind === 'registro-civil' ? $('#minorRcnStatus') : $('#minorAuthStatus');
    setStatus(statusEl, 'Subiendo documento…', 'loading');
    try {
      let data;
      if (state.token === 'local-demo-token') {
        await new Promise(resolve => setTimeout(resolve, 400));
        data = {
          documentRef: { key: `local-demo/${docKind}/${slotIndex}`, name: documentPayload.name },
          extracted: docKind === 'registro-civil' ? { fatherName: '', motherName: '' } : null
        };
      } else {
        data = await request(API.checkin, {
          method: 'POST',
          body: JSON.stringify({
            mode: 'analyze-minor-doc',
            file: documentPayload,
            slotIndex,
            docKind
          })
        });
      }
      const targetSlot = state.guestSlots[slotIndex];
      if (!targetSlot) return;
      if (docKind === 'registro-civil') {
        targetSlot.registroCivilDocumentRef = data.documentRef || null;
        targetSlot.registroCivilName = documentPayload.name;
        if (data.extracted) {
          if (data.extracted.fatherName && !targetSlot.fatherName) targetSlot.fatherName = data.extracted.fatherName;
          if (data.extracted.motherName && !targetSlot.motherName) targetSlot.motherName = data.extracted.motherName;
        }
      } else {
        targetSlot.authorizationDocumentRef = data.documentRef || null;
        targetSlot.authorizationName = documentPayload.name;
      }
      recomputeMinorParentPresence();
      if (state.activeGuestIndex === slotIndex) renderMinorSection();
      renderGuestCards();
      setStatus(statusEl, t('photoReady'), 'success');
    } catch (error) {
      setStatus(statusEl, error.message, 'error');
    }
  }

  function onMinorParentInput() {
    const slot = activeSlot();
    if (!slot || !slot.isMinor) return;
    slot.fatherName = $('#minorFatherName').value || '';
    slot.motherName = $('#minorMotherName').value || '';
    recomputeMinorParentPresence();
    renderMinorSection();
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
      <article class="guest-occupant-card${index === state.activeGuestIndex ? ' is-active' : ''}${slot.isMinor ? ' is-minor' : ''}" data-guest-slot="${index}">
        <button type="button" class="guest-occupant-main" data-select-guest="${index}">
          <strong>${escHtml(slotLabel(slot, index))}</strong>
          <small>${escHtml(slotStatusLabel(slot))}</small>
          ${slot.isMinor ? `<span class="guest-minor-flag">${escHtml(t('minorBadge'))}</span>` : ''}
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
      slot.documentRef = null;
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
      slot.documentRef = null;
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
          documentRef: { key: `local-demo/${analysisGuestIndex}`, name: analysisDocument.name },
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
        targetSlot.documentRef = data.documentRef || null;
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
    const missingDocumentRef = slot && slot.document && !slot.documentRef;
    const missingPassportExpiry = guest.documentType === 'Pasaporte' && !guest.expirationDate;
    const expiredDocument = hasExpiredDocument(guest);
    const invalidEmail = guest.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest.email);
    return missingRequired || missingDocumentRef || missingPassportExpiry || expiredDocument || invalidEmail || !guest.privacyAccepted;
  }

  function hasExpiredDocument(guest) {
    if (!guest || !guest.expirationDate) return false;
    const expiry = new Date(`${guest.expirationDate}T23:59:59`);
    return !Number.isNaN(expiry.getTime()) && expiry < new Date();
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
      const activeGuest = state.guestSlots[incompleteGuestIndex].guest;
      const message = hasExpiredDocument(activeGuest)
        ? 'El documento aparece vencido. Verifica la fecha de vencimiento.'
        : 'Completa los datos requeridos de cada huésped.';
      setStatus($('#checkinStatus'), message, 'error');
      return;
    }
    updateExpirationRequirement();
    recomputeMinorParentPresence();
    const minorBlockingIndex = state.guestSlots.findIndex(slot => {
      if (!slot.isMinor) return false;
      if (!slot.registroCivilDocumentRef) return true;
      if (!slot.parentPresent && !slot.authorizationDocumentRef) return true;
      return false;
    });
    if (minorBlockingIndex >= 0) {
      selectGuestSlot(minorBlockingIndex);
      setStatus($('#checkinStatus'), t('minorBlockingNotice'), 'error');
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
            guests: state.guestSlots.map(slot => ({
              guest: { ...slot.guest },
              file: slot.documentRef ? undefined : slot.document,
              documentRef: slot.documentRef || undefined,
              isPrimary: slot.isPrimary,
              analysisSource: slot.analysisSource || 'manual',
              confidence: slot.confidence || 0,
              registroCivilDocumentRef: slot.isMinor ? slot.registroCivilDocumentRef : undefined,
              authorizationDocumentRef: slot.isMinor ? slot.authorizationDocumentRef : undefined,
              fatherName: slot.isMinor ? slot.fatherName : undefined,
              motherName: slot.isMinor ? slot.motherName : undefined
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

  function primaryContractGuest() {
    return (state.guestSlots.find(slot => slot.isPrimary) || state.guestSlots[0] || { guest: emptyGuest() }).guest;
  }

  function contractMoney(amount) {
    if (!Number.isFinite(Number(amount))) return '—';
    try {
      return new Intl.NumberFormat('es-CO', {
        style: 'currency', currency: 'COP', maximumFractionDigits: 0
      }).format(Number(amount));
    } catch (_) {
      return `COP ${Number(amount).toLocaleString('es-CO')}`;
    }
  }

  function contractDateOnly(value) {
    if (!value) return '—';
    const date = new Date(`${value}T12:00:00`);
    if (Number.isNaN(date.getTime())) return String(value);
    try {
      return new Intl.DateTimeFormat(currentLang() === 'en' ? 'en-US' : 'es-CO', {
        year: 'numeric', month: 'long', day: '2-digit'
      }).format(date);
    } catch (_) {
      return date.toISOString().slice(0, 10);
    }
  }

  function setContractGate(read) {
    state.contractRead = Boolean(read);
    if (read && !state.contractAcknowledgedAt) {
      state.contractAcknowledgedAt = new Date().toISOString();
    }
    const ackInput = $('#contractAcknowledge');
    const acceptedInput = $('#contractAccepted');
    const signBtn = $('#signContract');
    const gateMsg = $('#contractGate');
    const hint = $('#contractHint');
    /* The acknowledge checkbox is the manual "I have read" control, so it
       must stay enabled at all times — it is one of the two ways to satisfy
       the gate (the other being scrolling to the end). Only the downstream
       sign controls are toggled by the gate state. */
    if (read) {
      if (ackInput) ackInput.checked = true;
      if (acceptedInput) acceptedInput.disabled = false;
      if (signBtn) signBtn.disabled = false;
      if (gateMsg) {
        gateMsg.textContent = t('contractReadConfirmation');
        gateMsg.classList.remove('is-error');
        gateMsg.classList.add('is-success');
      }
      if (hint) hint.textContent = t('contractModalReadyHint');
    } else {
      if (ackInput) ackInput.checked = false;
      if (acceptedInput) { acceptedInput.disabled = true; acceptedInput.checked = false; }
      if (signBtn) signBtn.disabled = true;
      if (gateMsg) {
        gateMsg.textContent = t('contractAcknowledgeBlocked');
        gateMsg.classList.add('is-error');
        gateMsg.classList.remove('is-success');
      }
      if (hint) hint.textContent = t('contractModalScrollHint');
    }
  }

  async function openContractModal() {
    saveActiveGuestFromForm();
    const body = $('#contractBody');
    const modal = $('#contractModal');
    if (!body || !modal) return;

    body.innerHTML = `<div class="guest-spinner-container" style="display:grid;place-items:center;min-height:220px;">
      <span class="guest-spinner" aria-hidden="true"></span>
      <p style="margin-top:12px;font-size:13px;color:var(--ink-500);text-align:center;">Cargando contrato...</p>
    </div>`;
    modal.hidden = false;
    document.body.classList.add('guest-modal-open');

    try {
      const data = await request(API.action, {
        method: 'POST',
        body: JSON.stringify({
          type: 'contract_preview',
          lang: currentLang(),
          guests: state.guestSlots.map(slot => ({ guest: slot.guest, isPrimary: slot.isPrimary })),
          contractVersion: CONTRACT_VERSION,
          consentText: t('contractConsentText')
        })
      });

      if (!data || !data.html) throw new Error('Failed to load contract HTML from server');

      state.previewHtml = data.html;

      const iframe = document.createElement('iframe');
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.border = 'none';
      iframe.style.minHeight = '420px';
      iframe.style.background = 'white';
      body.innerHTML = '';
      body.appendChild(iframe);

      const iframeDoc = iframe.contentWindow.document;
      iframeDoc.open();
      iframeDoc.write(data.html);
      iframeDoc.close();

      /* If they already acknowledged once during this session, keep the
         acknowledgement; otherwise reset visual hint. */
      if (state.contractRead) {
        setContractGate(true);
      } else {
        const hint = $('#contractHint');
        if (hint) hint.textContent = t('contractModalScrollHint');
      }

      /* Defer scroll-end detection wiring until next tick so layout settles. */
      requestAnimationFrame(() => {
        iframe.contentWindow.scrollTo(0, 0);
        attachContractScrollWatcher(iframe);
      });

    } catch (e) {
      console.error('[guest-app] failed to load contract preview:', e);
      body.innerHTML = `<div style="text-align:center;padding:40px;color:var(--terracotta);">
        <p>No fue posible cargar la vista previa del contrato.</p>
        <button class="btn btn-ghost-dark" onclick="location.reload()">Reintentar</button>
      </div>`;
    }
  }

  function closeContractModal() {
    const modal = $('#contractModal');
    if (modal) modal.hidden = true;
    document.body.classList.remove('guest-modal-open');
    /* Tear down the scroll-end observer so a hidden modal doesn't keep a
       live observer (and its sentinel reference) around between openings. */
    const body = $('#contractBody');
    const iframe = body && body.querySelector('iframe');
    if (iframe && iframe._contractObserver) {
      iframe._contractObserver.disconnect();
      iframe._contractObserver = null;
    }
  }

  function attachContractScrollWatcher(iframe) {
    if (!iframe) return;
    const iframeDoc = iframe.contentWindow.document;
    const sentinel = iframeDoc.querySelector('#contractEnd');
    if (!sentinel) return;
    if (iframe._contractObserver) iframe._contractObserver.disconnect();
    iframe._contractObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) setContractGate(true);
      });
    }, { threshold: 0.9 });
    iframe._contractObserver.observe(sentinel);
  }

  function downloadContractPDF() {
    /* Browser-driven PDF: open the rendered HTML in a new window, trigger
       the native print dialog (user picks "Save as PDF"). Avoids shipping
       a PDF library in the bundle and reuses the same content the user
       just read. */
    const html = state.previewHtml;
    if (!html) return;
    const w = window.open('', '_blank', 'noopener,noreferrer');
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { try { w.print(); } catch (_) { /* user cancelled */ } }, 250);
  }

  async function signContract() {
    const button = $('#signContract');
    const signedName = $('#signedName').value.trim();
    const acceptedTerms = $('#contractAccepted').checked;
    if (!state.contractRead) {
      setStatus($('#contractStatus'), t('contractAcknowledgeBlocked'), 'error');
      openContractModal();
      return;
    }
    if (!signedName) {
      setStatus($('#contractStatus'), 'Escribe tu nombre completo para firmar.', 'error');
      $('#signedName').focus();
      return;
    }
    if (!acceptedTerms) {
      setStatus($('#contractStatus'), 'Debes aceptar el contrato para continuar.', 'error');
      $('#contractAccepted').focus();
      return;
    }
    saveActiveGuestFromForm();
    const data = await submitAction({
      type: 'contract',
      signedName,
      acceptedTerms,
      guests: state.guestSlots.map(slot => ({ guest: slot.guest, isPrimary: slot.isPrimary })),
      contractVersion: CONTRACT_VERSION,
      /* Audit-trail evidence collected client-side; server re-stamps a
         server-side timestamp and adds IP + user-agent. */
      acknowledgedAt: state.contractAcknowledgedAt || new Date().toISOString(),
      consentText: t('contractConsentText'),
      lang: currentLang()
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
    const openContractBtn = $('#openContract');
    if (openContractBtn) openContractBtn.addEventListener('click', openContractModal);
    const closeContractBtn = $('#closeContract');
    if (closeContractBtn) closeContractBtn.addEventListener('click', closeContractModal);
    const confirmReadBtn = $('#confirmContractRead');
    if (confirmReadBtn) confirmReadBtn.addEventListener('click', closeContractModal);
    const ackInput = $('#contractAcknowledge');
    if (ackInput) ackInput.addEventListener('change', event => setContractGate(event.target.checked));
    const downloadBtn = $('#downloadContract');
    if (downloadBtn) downloadBtn.addEventListener('click', downloadContractPDF);
    const contractModal = $('#contractModal');
    if (contractModal) contractModal.addEventListener('click', event => {
      if (event.target.id === 'contractModal') closeContractModal();
    });
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
    const minorRcnFile = $('#minorRcnFile');
    if (minorRcnFile) minorRcnFile.addEventListener('change', handleMinorRcnSelection);
    const minorAuthFile = $('#minorAuthFile');
    if (minorAuthFile) minorAuthFile.addEventListener('change', handleMinorAuthSelection);
    const minorRcnCamera = $('#minorRcnCamera');
    if (minorRcnCamera) minorRcnCamera.addEventListener('change', handleMinorRcnCamera);
    const openMinorRcnCameraBtn = $('#openMinorRcnCamera');
    if (openMinorRcnCameraBtn) openMinorRcnCameraBtn.addEventListener('click', () => {
      const camera = $('#minorRcnCamera');
      if (camera) camera.click();
    });
    const minorFatherInput = $('#minorFatherName');
    if (minorFatherInput) minorFatherInput.addEventListener('input', onMinorParentInput);
    const minorMotherInput = $('#minorMotherName');
    if (minorMotherInput) minorMotherInput.addEventListener('input', onMinorParentInput);
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
