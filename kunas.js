/**
 * ============================================================
 * Hotel Estar — Kunas PMS API & Booking Engine Integration
 * ============================================================
 * Este script gestiona la integración de tarifas dinámicas y disponibilidad
 * en tiempo real con Kunas PMS.
 * 
 * Arquitectura de integración:
 * 1. Redirección Inteligente (Producción): Para un sitio estático, las consultas
 *    se envían al Motor de Reservas de Kunas de forma parametrizada. Kunas procesa
 *    las tarifas dinámicas y disponibilidad en su servidor seguro.
 * 2. API de Lectura Pública (Opcional): Si Kunas provee un endpoint público de 
 *    tarifas mínimas ("desde $X"), se incluye una función plantilla para consultarlo
 *    vía Fetch sin arriesgar credenciales privadas en el navegador.
 */

// Configuración de Kunas PMS
const KUNAS_CONFIG = {
  // URL base de tu motor de reservas en Kunas.
  // Se reemplaza {lang} en tiempo de ejecución por 'es' o 'en'.
  engineUrl: "https://app.hotelsync.com/engine/{lang}/OTg4OQ", 

  // Mapeo de categorías. Vincula el atributo 'data-room' del HTML con el ID de Kunas
  roomMappings: {
    "clasic": "31348",       // Clásica -> 31348
    "seleccion": "31349",    // Selección -> 31349
    "reserva": "31350",      // Reserva -> 31350
    "origen": "31351",       // Origen -> 31351
    "especial": "31352"      // Especial -> 31352
  },

  // Parámetros de consulta en la URL para el motor de Kunas (Hotelsync)
  queryParams: {
    propertyCode: "property_code",
    propertyCodeValue: "OTg4OQ",
    checkin: "dfrom",
    checkout: "dto",
    adults: "adults",
    children: "children",
    currency: "currency",
    currencyValue: "COP",
    roomTypeId: "room_type_id",
    idRoomTypes: "id_room_types"
  }
};

(function () {
  const checkinInput = document.getElementById('checkin-input');
  const checkoutInput = document.getElementById('checkout-input');
  const guestsInput = document.getElementById('guests-input');
  const roomInput = document.getElementById('room-input');

  const checkinDisplay = document.getElementById('checkin-display');
  const checkoutDisplay = document.getElementById('checkout-display');
  const guestsDisplay = document.getElementById('guests-display');
  const roomDisplay = document.getElementById('room-display');

  const isDesktop = () => window.innerWidth > 900;

  /**
   * Obtiene la fecha actual en formato ISO local (YYYY-MM-DD)
   */
  function getLocalDateString(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Da formato legible a las fechas según el idioma activo
   */
  function formatDate(dateStr, lang) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]) - 1;
    const day = parseInt(parts[2]);
    
    const shortMonthsEs = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    const shortMonthsEn = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    
    const mName = lang === 'es' ? shortMonthsEs[month] : shortMonthsEn[month];
    
    return lang === 'es' ? `${day} ${mName}` : `${mName} ${day}`;
  }

  // Nombres de los meses y días de la semana para el calendario personalizado
  const MONTHS_ES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const WEEKDAYS_ES = ["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sa"];
  const WEEKDAYS_EN = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

  function renderCalendar(calendarContainer, inputEl, isCheckOut) {
    const lang = document.documentElement.lang || 'es';
    const months = lang === 'es' ? MONTHS_ES : MONTHS_EN;
    const weekdays = lang === 'es' ? WEEKDAYS_ES : WEEKDAYS_EN;

    let year = parseInt(calendarContainer.getAttribute('data-year'));
    let month = parseInt(calendarContainer.getAttribute('data-month'));

    if (isNaN(year) || isNaN(month)) {
      const val = inputEl.value;
      let d = new Date();
      if (val) {
        const parts = val.split('-');
        d = new Date(parts[0], parts[1] - 1, parts[2]);
      }
      year = d.getFullYear();
      month = d.getMonth();
      calendarContainer.setAttribute('data-year', year);
      calendarContainer.setAttribute('data-month', month);
    }

    const currentVal = inputEl.value;
    const todayStr = getLocalDateString(0);

    let minDateStr = todayStr;
    if (isCheckOut && checkinInput && checkinInput.value) {
      const parts = checkinInput.value.split('-');
      const checkinDate = new Date(parts[0], parts[1] - 1, parts[2]);
      checkinDate.setDate(checkinDate.getDate() + 1);
      
      const y = checkinDate.getFullYear();
      const m = String(checkinDate.getMonth() + 1).padStart(2, '0');
      const d = String(checkinDate.getDate()).padStart(2, '0');
      minDateStr = `${y}-${m}-${d}`;
    }

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    calendarContainer.innerHTML = '';

    const headerDiv = document.createElement('div');
    headerDiv.className = 'calendar-header';

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'calendar-nav-btn';
    prevBtn.innerHTML = '←';

    // Determinar si el botón prev debe estar deshabilitado
    let prevMonth = month - 1;
    let prevYear = year;
    if (prevMonth < 0) {
      prevMonth = 11;
      prevYear -= 1;
    }
    const limitDate = new Date(minDateStr);
    const limitMonthStart = new Date(limitDate.getFullYear(), limitDate.getMonth(), 1);
    const prevMonthEnd = new Date(prevYear, prevMonth + 1, 0);
    if (prevMonthEnd < limitMonthStart) {
      prevBtn.disabled = true;
    }

    prevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      let prevMonth = month - 1;
      let prevYear = year;
      if (prevMonth < 0) {
        prevMonth = 11;
        prevYear -= 1;
      }
      const limitDate = new Date(minDateStr);
      if (new Date(prevYear, prevMonth + 1, 0) >= new Date(limitDate.getFullYear(), limitDate.getMonth(), 1)) {
        calendarContainer.setAttribute('data-month', prevMonth);
        calendarContainer.setAttribute('data-year', prevYear);
        renderCalendar(calendarContainer, inputEl, isCheckOut);
      }
    });

    const titleSpan = document.createElement('span');
    titleSpan.textContent = `${months[month]} ${year}`;

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'calendar-nav-btn';
    nextBtn.innerHTML = '→';
    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      let nextMonth = month + 1;
      let nextYear = year;
      if (nextMonth > 11) {
        nextMonth = 0;
        nextYear += 1;
      }
      calendarContainer.setAttribute('data-month', nextMonth);
      calendarContainer.setAttribute('data-year', nextYear);
      renderCalendar(calendarContainer, inputEl, isCheckOut);
    });

    headerDiv.appendChild(prevBtn);
    headerDiv.appendChild(titleSpan);
    headerDiv.appendChild(nextBtn);
    calendarContainer.appendChild(headerDiv);

    const gridDiv = document.createElement('div');
    gridDiv.className = 'calendar-grid';

    weekdays.forEach(day => {
      const wkDiv = document.createElement('div');
      wkDiv.className = 'calendar-weekday';
      wkDiv.textContent = day;
      gridDiv.appendChild(wkDiv);
    });

    for (let i = 0; i < firstDay; i++) {
      const emptyDiv = document.createElement('div');
      gridDiv.appendChild(emptyDiv);
    }

    const selectedCheckin = checkinInput ? checkinInput.value : '';
    const selectedCheckout = checkoutInput ? checkoutInput.value : '';

    for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
      const dayDiv = document.createElement('div');
      dayDiv.className = 'calendar-day';
      dayDiv.textContent = dayNum;

      const dateVal = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      dayDiv.setAttribute('data-date', dateVal);

      // Highlight actual ranges
      if (dateVal === todayStr) {
        dayDiv.classList.add('is-today');
      }

      if (selectedCheckin && dateVal === selectedCheckin) {
        dayDiv.classList.add('range-start');
        dayDiv.classList.add('active');
      } else if (selectedCheckout && dateVal === selectedCheckout) {
        dayDiv.classList.add('range-end');
        dayDiv.classList.add('active');
      } else if (selectedCheckin && selectedCheckout && dateVal > selectedCheckin && dateVal < selectedCheckout) {
        dayDiv.classList.add('range-between');
      }

      if (dateVal < minDateStr) {
        dayDiv.classList.add('disabled');
      } else {
        dayDiv.addEventListener('click', (e) => {
          e.stopPropagation();
          inputEl.value = dateVal;
          inputEl.dispatchEvent(new Event('change'));
          const field = calendarContainer.closest('.custom-select-field');
          if (field) field.classList.remove('active');

          // Auto-open check-out calendar if check-in was selected
          if (!isCheckOut) {
            const checkoutField = document.getElementById('checkout-field');
            if (checkoutField && isDesktop()) {
              setTimeout(() => {
                checkoutField.classList.add('active');
                const checkoutCalendar = document.getElementById('checkout-calendar');
                if (checkoutCalendar) {
                  checkoutCalendar.removeAttribute('data-year');
                  checkoutCalendar.removeAttribute('data-month');
                  renderCalendar(checkoutCalendar, checkoutInput, true);
                }
              }, 180);
            }
          }
        });

        // Hover highlight range logic in check-out calendar
        if (isCheckOut && selectedCheckin) {
          dayDiv.addEventListener('mouseenter', () => {
            const allDays = gridDiv.querySelectorAll('.calendar-day');
            allDays.forEach(dDiv => {
              const dVal = dDiv.getAttribute('data-date');
              if (!dVal || dDiv.classList.contains('disabled')) return;

              // Reset hover class
              dDiv.classList.remove('range-hover-between', 'range-hover-end');

              if (dVal > selectedCheckin && dVal < dateVal) {
                dDiv.classList.add('range-hover-between');
              } else if (dVal === dateVal && dateVal !== selectedCheckout) {
                dDiv.classList.add('range-hover-end');
              }
            });
          });
        }
      }

      gridDiv.appendChild(dayDiv);
    }

    // Reset hover highlight when leaving the grid
    if (isCheckOut && selectedCheckin) {
      gridDiv.addEventListener('mouseleave', () => {
        const allDays = gridDiv.querySelectorAll('.calendar-day');
        allDays.forEach(dDiv => {
          dDiv.classList.remove('range-hover-between', 'range-hover-end');
        });
      });
    }

    calendarContainer.appendChild(gridDiv);
  }

  /**
   * Actualiza los textos legibles sobre los inputs transparentes
   */
  function updateDisplayValues() {
    const lang = document.documentElement.lang || 'es';

    // Llegada
    if (checkinDisplay && checkinInput && checkinInput.value) {
      checkinDisplay.textContent = formatDate(checkinInput.value, lang);
    }

    // Salida
    if (checkoutDisplay && checkoutInput && checkoutInput.value) {
      checkoutDisplay.textContent = formatDate(checkoutInput.value, lang);
    }

    // Huéspedes
    if (guestsDisplay && guestsInput) {
      const val = guestsInput.value;
      if (lang === 'es') {
        guestsDisplay.textContent = val === '1' ? '1 huésped' : `${val} huéspedes`;
      } else {
        guestsDisplay.textContent = val === '1' ? '1 guest' : `${val} guests`;
      }

      // Sincronizar clase activa en el dropdown personalizado de huéspedes
      const guestsField = document.getElementById('guests-field');
      if (guestsField) {
        guestsField.querySelectorAll('.custom-dropdown-option').forEach(opt => {
          opt.classList.toggle('active', opt.getAttribute('data-value') === val);
        });
      }
    }

    // Habitación
    if (roomDisplay && roomInput) {
      const val = roomInput.value;
      if (!val) {
        roomDisplay.textContent = lang === 'es' ? 'Todos' : 'All';
      } else {
        // Encontrar opción seleccionada para respetar el texto correcto
        const option = roomInput.options[roomInput.selectedIndex];
        roomDisplay.textContent = option ? option.text : val;
      }

      // Sincronizar clase activa en el dropdown personalizado de habitación
      const roomField = document.getElementById('room-field');
      if (roomField) {
        roomField.querySelectorAll('.custom-dropdown-option').forEach(opt => {
          opt.classList.toggle('active', opt.getAttribute('data-value') === val);
        });
      }
    }
  }

  /**
   * Configura la interactividad de los dropdowns personalizados (Huéspedes y Habitación)
   */
  function setupCustomDropdowns() {
    const selectFields = document.querySelectorAll('.custom-select-field');

    selectFields.forEach(field => {
      const selectEl = field.querySelector('select');
      const inputDateEl = field.querySelector('input[type="date"]');
      const dropdownMenu = field.querySelector('.custom-dropdown-menu');

      if (!dropdownMenu) return;
      if (!selectEl && !inputDateEl) return;

      // Evento click en el contenedor (cabecera del select/datepicker)
      field.addEventListener('click', (e) => {
        // Si el click es en móvil, dejar que el comportamiento nativo tome el control
        if (!isDesktop() && inputDateEl) return;

        // Si el clic fue en el select nativo, en el input de fecha, o dentro del menú del dropdown (por ejemplo, navegando el calendario), no togglear
        if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' || e.target.closest('.calendar-header') || e.target.closest('.calendar-grid')) return;

        const isActive = field.classList.contains('active');

        // Cerrar los otros primero
        selectFields.forEach(otherField => {
          if (otherField !== field) {
            otherField.classList.remove('active');
          }
        });

        // Alternar el dropdown actual
        if (isActive) {
          field.classList.remove('active');
        } else {
          field.classList.add('active');
          // Si es un datepicker, renderizar el calendario al abrir
          if (inputDateEl) {
            const isCheckout = field.id === 'checkout-field';
            renderCalendar(dropdownMenu, inputDateEl, isCheckout);
          }
        }
      });

      // Solo si es un campo select, configurar opciones y navegación de teclado
      if (selectEl) {
        const options = field.querySelectorAll('.custom-dropdown-option');
        
        options.forEach(opt => {
          opt.addEventListener('click', (e) => {
            e.stopPropagation(); // Evitar que el clic llegue al field y vuelva a abrirlo/togglearlo
            const val = opt.getAttribute('data-value');
            
            if (selectEl.value !== val) {
              selectEl.value = val;
              // Disparar evento change en el select oculto
              selectEl.dispatchEvent(new Event('change'));
            }

            // Cerrar dropdown
            field.classList.remove('active');
          });
        });

        // Soporte para accesibilidad y navegación con teclado
        field.addEventListener('keydown', (e) => {
          const isActive = field.classList.contains('active');

          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (!isActive) {
              selectFields.forEach(otherField => {
                if (otherField !== field) otherField.classList.remove('active');
              });
              field.classList.add('active');
            } else {
              const activeOpt = field.querySelector('.custom-dropdown-option.active');
              if (activeOpt) {
                const val = activeOpt.getAttribute('data-value');
                if (selectEl.value !== val) {
                  selectEl.value = val;
                  selectEl.dispatchEvent(new Event('change'));
                }
              }
              field.classList.remove('active');
            }
          } else if (e.key === 'Escape') {
            if (isActive) {
              e.preventDefault();
              field.classList.remove('active');
            }
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!isActive) {
              selectFields.forEach(otherField => {
                if (otherField !== field) otherField.classList.remove('active');
              });
              field.classList.add('active');
              return;
            }

            // Navegar opciones
            const optsArray = Array.from(options);
            const currentActiveIdx = optsArray.findIndex(opt => opt.classList.contains('active'));
            let nextIdx = currentActiveIdx;

            if (e.key === 'ArrowDown') {
              nextIdx = (currentActiveIdx + 1) % optsArray.length;
            } else {
              nextIdx = (currentActiveIdx - 1 + optsArray.length) % optsArray.length;
            }

            const nextOpt = optsArray[nextIdx];
            if (nextOpt) {
              const val = nextOpt.getAttribute('data-value');
              if (selectEl.value !== val) {
                selectEl.value = val;
                selectEl.dispatchEvent(new Event('change'));
              }
            }
          }
        });
      }
    });

    // Cerrar dropdowns al hacer click fuera
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.custom-select-field')) {
        selectFields.forEach(field => {
          field.classList.remove('active');
        });
      }
    });
  }

  /**
   * Inicializa las fechas por defecto: Entrada hoy, Salida mañana
   */
  function initDates() {
    if (!checkinInput || !checkoutInput) return;

    const todayStr = getLocalDateString(0);
    const tomorrowStr = getLocalDateString(1);

    // Min date para entrada es hoy
    checkinInput.min = todayStr;
    checkinInput.value = todayStr;

    // Min date para salida es mañana
    checkoutInput.min = tomorrowStr;
    checkoutInput.value = tomorrowStr;

    // Abrir el selector de fecha nativo al hacer clic en el campo o en el contenedor
    const checkinField = checkinInput.closest('.booking-field');
    const checkoutField = checkoutInput.closest('.booking-field');

    const handleDatePickerOpen = (inputEl) => {
      if (typeof inputEl.showPicker === 'function') {
        try {
          inputEl.showPicker();
        } catch (err) {
          console.warn("showPicker error:", err);
        }
      }
    };

    if (checkinField) {
      checkinField.addEventListener('click', (e) => {
        if (isDesktop()) return; // No abrir selector nativo en escritorio
        checkinInput.focus();
        handleDatePickerOpen(checkinInput);
      });
    }

    if (checkoutField) {
      checkoutField.addEventListener('click', (e) => {
        if (isDesktop()) return; // No abrir selector nativo en escritorio
        checkoutInput.focus();
        handleDatePickerOpen(checkoutInput);
      });
    }

    // Control de cambio en fecha de entrada
    checkinInput.addEventListener('change', () => {
      const checkinVal = checkinInput.value;
      if (!checkinVal) return;

      const parts = checkinVal.split('-');
      const checkinDate = new Date(parts[0], parts[1] - 1, parts[2]);

      // Salida mínima es entrada + 1 día
      const nextDay = new Date(checkinDate);
      nextDay.setDate(nextDay.getDate() + 1);

      const nextYear = nextDay.getFullYear();
      const nextMonth = String(nextDay.getMonth() + 1).padStart(2, '0');
      const nextDayStr = String(nextDay.getDate()).padStart(2, '0');
      const minCheckoutStr = `${nextYear}-${nextMonth}-${nextDayStr}`;

      checkoutInput.min = minCheckoutStr;

      // Si la salida actual es igual o menor a la nueva fecha de entrada, se ajusta automáticamente
      const checkoutVal = checkoutInput.value;
      if (checkoutVal) {
        const outParts = checkoutVal.split('-');
        const checkoutDate = new Date(outParts[0], outParts[1] - 1, outParts[2]);
        if (checkoutDate <= checkinDate) {
          checkoutInput.value = minCheckoutStr;
        }
      } else {
        checkoutInput.value = minCheckoutStr;
      }

      updateDisplayValues();
    });

    checkoutInput.addEventListener('change', updateDisplayValues);
  }

  /**
   * Genera el enlace al motor de reservas de Kunas
   */
  function buildKunasUrl(checkin, checkout, guests, roomType = null) {
    const lang = document.documentElement.lang || 'es';
    const targetBaseUrl = KUNAS_CONFIG.engineUrl.replace('{lang}', lang);

    try {
      const url = new URL(targetBaseUrl);
      const params = KUNAS_CONFIG.queryParams;

      url.searchParams.set(params.propertyCode, params.propertyCodeValue);
      url.searchParams.set(params.checkin, checkin);
      url.searchParams.set(params.checkout, checkout);
      url.searchParams.set(params.adults, guests);
      url.searchParams.set(params.children, "0");
      url.searchParams.set(params.currency, params.currencyValue);

      if (roomType && KUNAS_CONFIG.roomMappings[roomType]) {
        const roomId = KUNAS_CONFIG.roomMappings[roomType];
        url.searchParams.set(params.roomTypeId, roomId);
        url.searchParams.set(params.idRoomTypes, roomId);
      }

      return url.toString();
    } catch (e) {
      console.error("Error al construir la URL de Kunas, usando fallback:", e);
      const params = KUNAS_CONFIG.queryParams;
      let urlString = `${targetBaseUrl}?${params.propertyCode}=${params.propertyCodeValue}&${params.checkin}=${checkin}&${params.checkout}=${checkout}&${params.adults}=${guests}&${params.children}=0&${params.currency}=${params.currencyValue}`;
      
      if (roomType && KUNAS_CONFIG.roomMappings[roomType]) {
        const roomId = KUNAS_CONFIG.roomMappings[roomType];
        urlString += `&${params.roomTypeId}=${roomId}&${params.idRoomTypes}=${roomId}`;
      }
      return urlString;
    }
  }

  const TRANSLATIONS = {
    es: {
      title: "Motor de Reservas",
      subtitle: "Hotel Estar — Tu espacio en Manizales",
      stepRooms: "1. Habitaciones",
      stepForm: "2. Tus Datos",
      stepConfirm: "3. Confirmación",
      searching: "Buscando habitaciones disponibles...",
      noRooms: "No encontramos habitaciones disponibles para las fechas seleccionadas.",
      capacity: "Capacidad",
      beds: "Camas",
      area: "Área",
      view: "Vista",
      select: "Seleccionar",
      soldOut: "Agotado",
      avgNight: "Promedio/noche",
      totalNights: "Total por {nights} noches",
      staySummary: "Resumen de Estancia",
      room: "Habitación",
      dates: "Fechas",
      nights: "Noches",
      guests: "Huéspedes",
      total: "Total (COP)",
      firstName: "Nombre",
      lastName: "Apellido",
      email: "Correo Electrónico",
      phone: "Teléfono",
      notes: "Notas adicionales / Peticiones especiales",
      back: "Volver",
      confirmBooking: "Confirmar Reserva",
      fillRequired: "Por favor, complete todos los campos obligatorios.",
      invalidEmail: "Por favor, introduzca un correo electrónico válido.",
      processing: "Procesando su reserva...",
      successTitle: "¡Reserva Confirmada!",
      successSubtitle: "Gracias por elegir Hotel Estar. Hemos enviado un correo con los detalles.",
      bookingReference: "Código de Reserva",
      guest: "Huésped",
      totalPaid: "Monto Total",
      close: "Cerrar",
      errorTitle: "Algo salió mal",
      errorMessage: "No pudimos cargar la disponibilidad. Por favor intente de nuevo.",
      retry: "Reintentar"
    },
    en: {
      title: "Booking Engine",
      subtitle: "Hotel Estar — Your space in Manizales",
      stepRooms: "1. Rooms",
      stepForm: "2. Your Info",
      stepConfirm: "3. Confirmation",
      searching: "Searching for available rooms...",
      noRooms: "No available rooms found for the selected dates.",
      capacity: "Capacity",
      beds: "Beds",
      area: "Area",
      view: "View",
      select: "Select",
      soldOut: "Sold Out",
      avgNight: "Avg/night",
      totalNights: "Total for {nights} nights",
      staySummary: "Stay Summary",
      room: "Room",
      dates: "Dates",
      nights: "Nights",
      guests: "Guests",
      total: "Total (COP)",
      firstName: "First Name",
      lastName: "Last Name",
      email: "Email Address",
      phone: "Phone Number",
      notes: "Additional notes / Special requests",
      back: "Back",
      confirmBooking: "Confirm Booking",
      fillRequired: "Please fill in all required fields.",
      invalidEmail: "Please enter a valid email address.",
      processing: "Processing your reservation...",
      successTitle: "Booking Confirmed!",
      successSubtitle: "Thank you for choosing Hotel Estar. We have sent an email with the details.",
      bookingReference: "Booking Reference",
      guest: "Guest",
      totalPaid: "Total Amount",
      close: "Close",
      errorTitle: "Something went wrong",
      errorMessage: "We could not load availability. Please try again.",
      retry: "Retry"
    }
  };

  function getT() {
    const lang = document.documentElement.lang || 'es';
    return TRANSLATIONS[lang] || TRANSLATIONS.es;
  }

  let overlayEl = null;

  const bookingState = {
    currentStep: 'rooms', // 'rooms', 'form', 'confirm'
    checkin: '',
    checkout: '',
    guests: '1',
    preselectedRoomType: '',
    roomsList: [],
    selectedRoom: null,
    reservation: null,
    bookingCode: '',
    formFields: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      notes: ''
    }
  };

  function initBookingOverlay() {
    if (overlayEl) return;

    overlayEl = document.createElement('div');
    overlayEl.className = 'booking-overlay';
    overlayEl.id = 'booking-overlay';
    
    const t = getT();
    overlayEl.innerHTML = `
      <div class="booking-modal">
        <div class="booking-modal-header">
          <div class="booking-modal-title">
            <h2 id="booking-modal-title-text">${t.title}</h2>
            <p id="booking-modal-subtitle-text">${t.subtitle}</p>
          </div>
          <button class="booking-close-btn" id="booking-close-btn" aria-label="${t.close}">&times;</button>
        </div>
        <div class="booking-steps">
          <div class="booking-step" id="step-rooms">${t.stepRooms}</div>
          <div class="booking-step" id="step-form">${t.stepForm}</div>
          <div class="booking-step" id="step-confirm">${t.stepConfirm}</div>
        </div>
        <div class="booking-modal-body" id="booking-modal-body"></div>
      </div>
    `;

    document.body.appendChild(overlayEl);

    // Event listeners
    const closeBtn = overlayEl.querySelector('#booking-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', closeBookingEngine);
    }

    overlayEl.addEventListener('click', (e) => {
      if (e.target === overlayEl) {
        closeBookingEngine();
      }
    });

    // Escucha cambios de idioma para actualizar cabeceras
    document.addEventListener('estar-lang-change', () => {
      const updatedT = getT();
      const titleEl = overlayEl.querySelector('#booking-modal-title-text');
      const subtitleEl = overlayEl.querySelector('#booking-modal-subtitle-text');
      const stepRoomsEl = overlayEl.querySelector('#step-rooms');
      const stepFormEl = overlayEl.querySelector('#step-form');
      const stepConfirmEl = overlayEl.querySelector('#step-confirm');
      const closeBtnElement = overlayEl.querySelector('#booking-close-btn');

      if (titleEl) titleEl.textContent = updatedT.title;
      if (subtitleEl) subtitleEl.textContent = updatedT.subtitle;
      if (stepRoomsEl) stepRoomsEl.textContent = updatedT.stepRooms;
      if (stepFormEl) stepFormEl.textContent = updatedT.stepForm;
      if (stepConfirmEl) stepConfirmEl.textContent = updatedT.stepConfirm;
      if (closeBtnElement) closeBtnElement.setAttribute('aria-label', updatedT.close);

      // Re-render the active step view with the new language
      if (overlayEl.classList.contains('active')) {
        if (bookingState.currentStep === 'rooms') {
          renderRooms(bookingState.roomsList, bookingState.checkin, bookingState.checkout, bookingState.guests, bookingState.preselectedRoomType);
        } else if (bookingState.currentStep === 'form' && bookingState.selectedRoom) {
          const fNameInput = document.getElementById('bf-first-name');
          const lNameInput = document.getElementById('bf-last-name');
          const emailInput = document.getElementById('bf-email');
          const phoneInput = document.getElementById('bf-phone');
          const notesInput = document.getElementById('bf-notes');
          if (fNameInput) bookingState.formFields.firstName = fNameInput.value;
          if (lNameInput) bookingState.formFields.lastName = lNameInput.value;
          if (emailInput) bookingState.formFields.email = emailInput.value;
          if (phoneInput) bookingState.formFields.phone = phoneInput.value;
          if (notesInput) bookingState.formFields.notes = notesInput.value;

          showGuestForm(bookingState.selectedRoom, bookingState.checkin, bookingState.checkout, bookingState.guests, bookingState.roomsList, bookingState.formFields);
        } else if (bookingState.currentStep === 'confirm' && bookingState.reservation) {
          showSuccess(bookingState.reservation, bookingState.bookingCode);
        }
      }
    });
  }

  function closeBookingEngine() {
    if (overlayEl) {
      overlayEl.classList.remove('active');
      document.body.style.overflow = '';
    }
  }

  function setStepActive(step) {
    const stepRooms = overlayEl.querySelector('#step-rooms');
    const stepForm = overlayEl.querySelector('#step-form');
    const stepConfirm = overlayEl.querySelector('#step-confirm');

    if (!stepRooms || !stepForm || !stepConfirm) return;

    stepRooms.className = 'booking-step';
    stepForm.className = 'booking-step';
    stepConfirm.className = 'booking-step';

    if (step === 'rooms') {
      stepRooms.classList.add('active');
    } else if (step === 'form') {
      stepRooms.classList.add('completed');
      stepForm.classList.add('active');
    } else if (step === 'confirm') {
      stepRooms.classList.add('completed');
      stepForm.classList.add('completed');
      stepConfirm.classList.add('active');
    }
  }

  function formatCurrency(amount) {
    const lang = document.documentElement.lang || 'es';
    const formatter = new Intl.NumberFormat(lang === 'es' ? 'es-CO' : 'en-US', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    });
    return formatter.format(amount);
  }

  function openBookingEngine(checkin, checkout, guests, preselectedRoomType = '') {
    initBookingOverlay();
    setStepActive('rooms');
    overlayEl.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Initialize/reset booking state variables
    bookingState.currentStep = 'rooms';
    bookingState.checkin = checkin;
    bookingState.checkout = checkout;
    bookingState.guests = guests;
    bookingState.preselectedRoomType = preselectedRoomType;
    bookingState.roomsList = [];
    bookingState.selectedRoom = null;
    bookingState.reservation = null;
    bookingState.bookingCode = '';
    bookingState.formFields = {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      notes: ''
    };

    fetchAvailability(checkin, checkout, guests, preselectedRoomType);
  }

  function fetchAvailability(checkin, checkout, guests, preselectedRoomType) {
    const modalBody = overlayEl.querySelector('#booking-modal-body');
    const t = getT();

    modalBody.innerHTML = `
      <div class="booking-loader">
        <div class="booking-spinner"></div>
        <p>${t.searching}</p>
      </div>
    `;

    fetch('/api/check-availability', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ checkin, checkout, guests })
    })
    .then(res => {
      if (!res.ok) {
        throw new Error('Server error');
      }
      return res.json();
    })
    .then(data => {
      bookingState.roomsList = data.rooms || [];
      renderRooms(bookingState.roomsList, checkin, checkout, guests, preselectedRoomType);
    })
    .catch(err => {
      console.error('Fetch availability error:', err);
      renderError(() => fetchAvailability(checkin, checkout, guests, preselectedRoomType));
    });
  }

  function renderError(retryCallback) {
    const modalBody = overlayEl.querySelector('#booking-modal-body');
    const t = getT();

    modalBody.innerHTML = `
      <div class="booking-loader" style="text-align: center;">
        <h3 style="font-family: var(--font-heading); color: var(--terracotta);">${t.errorTitle}</h3>
        <p>${t.errorMessage}</p>
        <button class="btn-book-submit" id="booking-retry-btn" style="margin-top: 16px;">${t.retry}</button>
      </div>
    `;

    const retryBtn = modalBody.querySelector('#booking-retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        retryCallback();
      });
    }
  }

  function renderRooms(rooms, checkin, checkout, guests, preselectedRoomType) {
    bookingState.currentStep = 'rooms';
    const modalBody = overlayEl.querySelector('#booking-modal-body');
    const t = getT();

    if (rooms.length === 0) {
      modalBody.innerHTML = `
        <div class="booking-loader">
          <p>${t.noRooms}</p>
        </div>
      `;
      return;
    }

    // Sort rooms so that the preselected room type is first if defined
    let sortedRooms = [...rooms];
    if (preselectedRoomType) {
      const preselectedId = KUNAS_CONFIG.roomMappings[preselectedRoomType];
      if (preselectedId) {
        sortedRooms.sort((a, b) => {
          if (String(a.id_room_types) === String(preselectedId)) return -1;
          if (String(b.id_room_types) === String(preselectedId)) return 1;
          return 0;
        });
      }
    }

    let roomsHtml = `<div class="booking-results">`;

    sortedRooms.forEach(room => {
      const formattedAvg = formatCurrency(room.avgPrice);
      const formattedTotal = formatCurrency(room.totalPrice);
      const isAvailable = room.available;

      const totalNightsText = t.totalNights.replace('{nights}', room.nights);

      const preselectedId = preselectedRoomType ? KUNAS_CONFIG.roomMappings[preselectedRoomType] : null;
      const isPreselected = preselectedId && String(room.id_room_types) === String(preselectedId);

      roomsHtml += `
        <div class="booking-room-card ${!isAvailable ? 'sold-out' : ''} ${isPreselected ? 'preselected' : ''}" data-room-id="${room.id_room_types}">
          <div class="booking-room-img">
            <img src="${room.image || 'assets/photos/tipo1/1.webp'}" alt="${room.name}">
          </div>
          <div class="booking-room-details">
            <div class="booking-room-meta">
              <div class="booking-room-title">
                <h3>${room.name}</h3>
                <p class="booking-room-subtitle">${room.sub || ''}</p>
              </div>
            </div>
            <p style="font-family: var(--font-body); font-size: var(--fs-body-sm); color: var(--fg-muted); margin: 0 0 var(--space-3) 0;">
              ${room.description || ''}
            </p>
            <div class="booking-room-specs">
              <div class="booking-room-spec">
                <span class="k">${t.capacity}</span>
                <span class="v">${room.capacity} ${room.capacity === 1 ? (document.documentElement.lang === 'es' ? 'persona' : 'person') : (document.documentElement.lang === 'es' ? 'personas' : 'people')}</span>
              </div>
              <div class="booking-room-spec">
                <span class="k">${t.beds}</span>
                <span class="v">${room.beds || ''}</span>
              </div>
              <div class="booking-room-spec">
                <span class="k">${t.area}</span>
                <span class="v">${room.area || ''}</span>
              </div>
              <div class="booking-room-spec">
                <span class="k">${t.view}</span>
                <span class="v">${room.view || ''}</span>
              </div>
            </div>
            <div class="booking-room-footer">
              <div class="booking-room-price">
                <span class="avg">${formattedAvg} <span style="font-size: 11px; font-weight: normal; font-family: var(--font-label); color: var(--fg-muted);">${t.avgNight}</span></span>
                <span class="total">${totalNightsText}: ${formattedTotal}</span>
              </div>
              <button class="btn-book-select ${!isAvailable ? 'disabled' : ''}" ${!isAvailable ? 'disabled' : ''} data-room-id="${room.id_room_types}">
                ${isAvailable ? t.select : t.soldOut}
              </button>
            </div>
          </div>
        </div>
      `;
    });

    roomsHtml += `</div>`;
    modalBody.innerHTML = roomsHtml;

    modalBody.querySelectorAll('.btn-book-select').forEach(btn => {
      btn.addEventListener('click', () => {
        const roomId = btn.getAttribute('data-room-id');
        const selectedRoom = rooms.find(r => String(r.id_room_types) === String(roomId));
        if (selectedRoom) {
          showGuestForm(selectedRoom, checkin, checkout, guests, rooms);
        }
      });
    });
  }

  function showGuestForm(room, checkin, checkout, guests, roomsList, prefilledData = null, errorMessage = null) {
    bookingState.currentStep = 'form';
    bookingState.selectedRoom = room;

    if (!prefilledData) {
      prefilledData = bookingState.formFields;
    } else {
      bookingState.formFields = { ...bookingState.formFields, ...prefilledData };
    }

    setStepActive('form');
    const modalBody = overlayEl.querySelector('#booking-modal-body');
    const t = getT();

    const formattedTotal = formatCurrency(room.totalPrice);
    const lang = document.documentElement.lang || 'es';

    const checkinFormatted = formatDate(checkin, lang);
    const checkoutFormatted = formatDate(checkout, lang);

    const fName = prefilledData ? prefilledData.firstName : '';
    const lName = prefilledData ? prefilledData.lastName : '';
    const mail = prefilledData ? prefilledData.email : '';
    const tel = prefilledData ? prefilledData.phone : '';
    const noteVal = prefilledData ? prefilledData.notes : '';

    modalBody.innerHTML = `
      <div class="booking-form-wrapper">
        <div class="booking-form-container">
          <form id="booking-guest-form">
            <div class="booking-inputs-grid">
              <div class="booking-input-group">
                <label for="bf-first-name">${t.firstName} *</label>
                <input type="text" id="bf-first-name" required autocomplete="given-name" value="${fName}">
              </div>
              <div class="booking-input-group">
                <label for="bf-last-name">${t.lastName} *</label>
                <input type="text" id="bf-last-name" required autocomplete="family-name" value="${lName}">
              </div>
              <div class="booking-input-group">
                <label for="bf-email">${t.email} *</label>
                <input type="email" id="bf-email" required autocomplete="email" value="${mail}">
              </div>
              <div class="booking-input-group">
                <label for="bf-phone">${t.phone} *</label>
                <input type="tel" id="bf-phone" required autocomplete="tel" value="${tel}">
              </div>
              <div class="booking-input-group full-width">
                <label for="bf-notes">${t.notes}</label>
                <textarea id="bf-notes" rows="4">${noteVal}</textarea>
              </div>
            </div>
            
            <div id="booking-form-error-banner" style="display: ${errorMessage ? 'block' : 'none'}; color: var(--terracotta); font-family: var(--font-body); font-size: 13.5px; margin-top: var(--space-3); font-weight: bold; border-left: 3px solid var(--terracotta); padding-left: 8px;">
              ${errorMessage || ''}
            </div>

            <div class="booking-form-actions">
              <button type="button" class="btn-book-back" id="btn-back-to-rooms">${t.back}</button>
              <button type="submit" class="btn-book-submit">${t.confirmBooking}</button>
            </div>
          </form>
        </div>

        <div class="booking-details-sidebar">
          <div class="booking-sidebar-section">
            <h4>${t.staySummary}</h4>
            <div style="margin-top: 12px; border-radius: var(--radius-sm); overflow: hidden; height: 120px; background: var(--paper-400);">
              <img src="${room.image || 'assets/photos/tipo1/1.webp'}" alt="${room.name}" style="width: 100%; height: 100%; object-fit: cover;">
            </div>
          </div>
          <div class="booking-sidebar-section">
            <div class="booking-sidebar-row">
              <span class="lbl">${t.room}</span>
              <span class="val">${room.name}</span>
            </div>
            <div class="booking-sidebar-row">
              <span class="lbl">${t.dates}</span>
              <span class="val" style="font-size: 12.5px;">${checkinFormatted} — ${checkoutFormatted}</span>
            </div>
            <div class="booking-sidebar-row">
              <span class="lbl">${t.nights}</span>
              <span class="val">${room.nights}</span>
            </div>
            <div class="booking-sidebar-row">
              <span class="lbl">${t.guests}</span>
              <span class="val">${guests}</span>
            </div>
          </div>
          <div class="booking-sidebar-section">
            <div class="booking-sidebar-total">
              <div style="font-size: 11px; font-family: var(--font-label); text-transform: uppercase; color: var(--fg-muted); letter-spacing: 0.05em; font-weight: bold; margin-bottom: 2px;">${t.total}</div>
              <strong>${formattedTotal}</strong>
            </div>
          </div>
        </div>
      </div>
    `;

    const backBtn = modalBody.querySelector('#btn-back-to-rooms');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        setStepActive('rooms');
        renderRooms(roomsList, checkin, checkout, guests, room.id_room_types);
      });
    }

    const form = modalBody.querySelector('#booking-guest-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      const firstName = form.querySelector('#bf-first-name').value.trim();
      const lastName = form.querySelector('#bf-last-name').value.trim();
      const email = form.querySelector('#bf-email').value.trim();
      const phone = form.querySelector('#bf-phone').value.trim();
      const notes = form.querySelector('#bf-notes').value.trim();
      const errorBanner = form.querySelector('#booking-form-error-banner');

      if (!firstName || !lastName || !email || !phone) {
        errorBanner.textContent = t.fillRequired;
        errorBanner.style.display = 'block';
        return;
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        errorBanner.textContent = t.invalidEmail;
        errorBanner.style.display = 'block';
        return;
      }

      errorBanner.style.display = 'none';

      submitBooking({
        checkin,
        checkout,
        guestsCount: guests,
        roomTypeId: room.id_room_types,
        roomName: room.name,
        roomPrice: room.totalPrice,
        firstName,
        lastName,
        email,
        phone,
        notes
      }, room, roomsList);
    });
  }

  function submitBooking(payload, room, roomsList) {
    // Save form fields to state before submitting
    bookingState.formFields = {
      firstName: payload.firstName,
      lastName: payload.lastName,
      email: payload.email,
      phone: payload.phone,
      notes: payload.notes
    };

    const modalBody = overlayEl.querySelector('#booking-modal-body');
    const t = getT();

    modalBody.innerHTML = `
      <div class="booking-loader">
        <div class="booking-spinner"></div>
        <p>${t.processing}</p>
      </div>
    `;

    fetch('/api/create-booking', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })
    .then(res => {
      if (!res.ok) {
        return res.json().then(data => {
          throw new Error(data.message || data.error || 'Booking submission failed');
        }).catch(() => {
          throw new Error('Booking submission failed');
        });
      }
      return res.json();
    })
    .then(data => {
      if (data.success) {
        showSuccess(data.reservation || {}, data.bookingCode);
      } else {
        throw new Error(data.message || 'Booking was not successful');
      }
    })
    .catch(err => {
      console.error('Booking submission error:', err);
      showGuestForm(room, payload.checkin, payload.checkout, payload.guestsCount, roomsList, payload, err.message);
    });
  }

  function showSuccess(reservation, bookingCode) {
    bookingState.currentStep = 'confirm';
    bookingState.reservation = reservation;
    bookingState.bookingCode = bookingCode;

    setStepActive('confirm');
    const modalBody = overlayEl.querySelector('#booking-modal-body');
    const t = getT();
    const lang = document.documentElement.lang || 'es';

    const formattedTotal = formatCurrency(reservation.totalPrice);
    const checkinFormatted = formatDate(reservation.checkin, lang);
    const checkoutFormatted = formatDate(reservation.checkout, lang);

    modalBody.innerHTML = `
      <div class="booking-success-view">
        <div class="booking-success-icon">✶</div>
        <h3>${t.successTitle}</h3>
        <p class="subtitle">${t.successSubtitle}</p>
        
        <div class="booking-code-card">
          <span>${t.bookingReference}</span>
          <strong>${bookingCode}</strong>
        </div>

        <div class="booking-success-details">
          <div class="booking-success-row">
            <span class="k">${t.guest}</span>
            <span class="v">${reservation.guestName}</span>
          </div>
          <div class="booking-success-row">
            <span class="k">${t.email}</span>
            <span class="v">${reservation.email}</span>
          </div>
          <div class="booking-success-row">
            <span class="k">${t.room}</span>
            <span class="v">${reservation.roomName}</span>
          </div>
          <div class="booking-success-row">
            <span class="k">${t.dates}</span>
            <span class="v">${checkinFormatted} — ${checkoutFormatted} (${reservation.nights} ${reservation.nights === 1 ? (lang === 'es' ? 'noche' : 'night') : (lang === 'es' ? 'noches' : 'nights')})</span>
          </div>
          <div class="booking-success-row">
            <span class="k">${t.totalPaid}</span>
            <span class="v">${formattedTotal}</span>
          </div>
        </div>

        <button class="btn-book-finish" id="btn-booking-finish">${t.close}</button>
      </div>
    `;

    const finishBtn = modalBody.querySelector('#btn-booking-finish');
    if (finishBtn) {
      finishBtn.addEventListener('click', closeBookingEngine);
    }
  }

  /**
   * Habilita los event listeners en los inputs y en el submit del formulario
   */
  function setupBookingBar() {
    if (guestsInput) guestsInput.addEventListener('change', updateDisplayValues);
    if (roomInput) roomInput.addEventListener('change', updateDisplayValues);

    const bookingForm = document.getElementById('reservar');
    if (bookingForm) {
      bookingForm.addEventListener('submit', (e) => {
        e.preventDefault();

        const checkin = checkinInput ? checkinInput.value : getLocalDateString(0);
        const checkout = checkoutInput ? checkoutInput.value : getLocalDateString(1);
        const guests = guestsInput ? guestsInput.value : '1';
        const roomType = roomInput ? roomInput.value : '';

        openBookingEngine(checkin, checkout, guests, roomType);
      });
    }

    // Intercepta clicks en botones "Ver disponibilidad" individuales
    document.querySelectorAll('.book-room-trigger').forEach(trigger => {
      trigger.addEventListener('click', (e) => {
        e.preventDefault();
        const roomType = trigger.getAttribute('data-room');

        const checkin = (checkinInput && checkinInput.value) || getLocalDateString(0);
        const checkout = (checkoutInput && checkoutInput.value) || getLocalDateString(1);
        const guests = (guestsInput && guestsInput.value) || '1';

        openBookingEngine(checkin, checkout, guests, roomType);
      });
    });
  }

  // Inicialización al cargar la página
  function init() {
    initDates();
    setupCustomDropdowns();
    updateDisplayValues();
    setupBookingBar();

    // Escucha cambios de idioma globales (desde shell.js) para refrescar textos
    document.addEventListener('estar-lang-change', () => {
      setTimeout(updateDisplayValues, 50); // pequeño lag para asegurar que lang ya cambió en el DOM
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
