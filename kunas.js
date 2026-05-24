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
  // Rates cache and overlay helpers
  window.estarRatesCache = window.estarRatesCache || {};

  function updateOverlayState() {
    let overlay = document.querySelector('.calendar-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'calendar-overlay';
      document.body.appendChild(overlay);
      
      overlay.addEventListener('click', () => {
        const selectFields = document.querySelectorAll('.custom-select-field');
        selectFields.forEach(f => f.classList.remove('active'));
        updateOverlayState();
      });
    }

    const selectFields = document.querySelectorAll('.custom-select-field');
    const anyActiveCalendar = Array.from(selectFields).some(f => f.classList.contains('active') && f.querySelector('.calendar-dropdown'));
    
    if (anyActiveCalendar && !isDesktop()) {
      overlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    } else {
      overlay.classList.remove('active');
      document.body.style.overflow = '';
    }
  }

  function fetchMonthRates(year, month, calendarContainer, inputEl, isCheckOut) {
    const cacheKey = `${year}-${month}`;
    if (window.estarRatesCache[cacheKey]) {
      return;
    }
    window.estarRatesCache[cacheKey] = 'loading';

    const pad = (n) => String(n).padStart(2, '0');
    const checkin = `${year}-${pad(month + 1)}-01`;
    
    let nextMonth = month + 2;
    let nextYear = year;
    if (nextMonth > 12) {
      nextMonth = 1;
      nextYear += 1;
    }
    const checkout = `${nextYear}-${pad(nextMonth)}-01`;

    fetch(`/api/check-availability?checkin=${checkin}&checkout=${checkout}&guests=2`)
      .then(res => {
        if (!res.ok) throw new Error("Status " + res.status);
        return res.json();
      })
      .then(data => {
        if (data && Array.isArray(data.rooms)) {
          const pricesMap = {};
          data.rooms.forEach(room => {
            if (Array.isArray(room.dailyPrices)) {
              room.dailyPrices.forEach(dp => {
                const dateStr = dp.date;
                const price = parseFloat(dp.price);
                if (!isNaN(price) && price > 0) {
                  if (!pricesMap[dateStr] || price < pricesMap[dateStr]) {
                    pricesMap[dateStr] = price;
                  }
                }
              });
            }
          });
          window.estarRatesCache[cacheKey] = pricesMap;

          // Re-render only if the calendar container is still showing the same month
          const currentYear = parseInt(calendarContainer.getAttribute('data-year'));
          const currentMonth = parseInt(calendarContainer.getAttribute('data-month'));
          if (currentYear === year && currentMonth === month) {
            renderCalendar(calendarContainer, inputEl, isCheckOut);
          }
        }
      })
      .catch(err => {
        console.warn("Error fetching rates for calendar:", err);
        window.estarRatesCache[cacheKey] = {}; // Fallback empty object
      });
  }

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

    // Trigger fetching rates for this month
    fetchMonthRates(year, month, calendarContainer, inputEl, isCheckOut);

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

    const cacheKey = `${year}-${month}`;
    const cachedRates = window.estarRatesCache[cacheKey];
    const ratesLoaded = cachedRates && typeof cachedRates === 'object';

    for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
      const dayDiv = document.createElement('div');
      dayDiv.className = 'calendar-day';

      const dateVal = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      dayDiv.setAttribute('data-date', dateVal);

      // Structure day inner content to support styling day-number and price
      const dayNumSpan = document.createElement('span');
      dayNumSpan.className = 'day-number';
      dayNumSpan.textContent = dayNum;
      dayDiv.appendChild(dayNumSpan);

      // Append dynamic price if available in cache
      if (ratesLoaded && cachedRates[dateVal]) {
        const price = cachedRates[dateVal];
        const formattedPrice = price >= 1000 ? `${Math.round(price / 1000)}K` : price;
        const priceSpan = document.createElement('span');
        priceSpan.className = 'calendar-day-price';
        priceSpan.textContent = `$${formattedPrice}`;
        dayDiv.appendChild(priceSpan);
      }

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
          updateOverlayState();

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
        updateOverlayState();
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
        updateOverlayState();
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

    // No necesitamos listeners adicionales en móvil para abrir selectores nativos,
    // ya que utilizaremos el selector de calendario personalizado también en dispositivos móviles.

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

  function openBookingEngine(checkin, checkout, guests, preselectedRoomType = '') {
    let url = `reservar.html?checkin=${checkin}&checkout=${checkout}&guests=${guests}`;
    if (preselectedRoomType) {
      url += `&room=${preselectedRoomType}`;
    }
    window.location.href = url;
  }

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

        openBookingEngine(checkin, checkout, guests);
      });
    }

    // Intercept clicks on individual room "Reservar" buttons
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

  function init() {
    initDates();
    setupCustomDropdowns();
    updateDisplayValues();
    setupBookingBar();

    // Listen for global language changes (from shell.js) to update display values
    document.addEventListener('estar-lang-change', () => {
      setTimeout(updateDisplayValues, 50);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
