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

  // ── Range picker state ───────────────────────────────────────────────────
  // Phase 1 = selecting check-in, Phase 2 = selecting check-out.
  // A single calendar handles both dates sequentially.
  let rpPhase = 1;
  let rpHover = null;   // ISO date string currently hovered (range preview)
  let rpYear  = null;
  let rpMonth = null;

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
            renderRangePicker(calendarContainer);
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

  // ── Open range picker ────────────────────────────────────────────────────
  function openRangePicker(startPhase) {
    rpHover = null;

    // Determine starting phase
    const hasCheckin  = checkinInput  && checkinInput.value;
    const hasCheckout = checkoutInput && checkoutInput.value;

    if (startPhase != null) {
      rpPhase = startPhase;
    } else if (!hasCheckin) {
      rpPhase = 1;
    } else if (!hasCheckout || checkoutInput.value <= checkinInput.value) {
      rpPhase = 2;
    } else {
      rpPhase = 1; // Both set — restart to pick new dates
    }

    // Position calendar at check-in month (phase 1) or check-in month (phase 2)
    const anchorDate = (rpPhase === 2 && hasCheckin) ? checkinInput.value : null;
    if (anchorDate) {
      const p = anchorDate.split('-');
      rpYear  = parseInt(p[0]);
      rpMonth = parseInt(p[1]) - 1;
    } else {
      const today = new Date();
      rpYear  = today.getFullYear();
      rpMonth = today.getMonth();
    }

    // Activate the checkin-field calendar container
    document.querySelectorAll('.custom-select-field').forEach(f => f.classList.remove('active'));
    const checkinField    = document.getElementById('checkin-field');
    const checkinCalendar = document.getElementById('checkin-calendar');
    if (checkinField && checkinCalendar) {
      checkinField.classList.add('active');
      renderRangePicker(checkinCalendar);
    }
    updateOverlayState();
  }

  // ── Render unified range picker ──────────────────────────────────────────
  function renderRangePicker(container) {
    const lang     = document.documentElement.lang || 'es';
    const months   = lang === 'es' ? MONTHS_ES : MONTHS_EN;
    const weekdays = lang === 'es' ? WEEKDAYS_ES : WEEKDAYS_EN;
    const todayStr = getLocalDateString(0);

    const checkinVal  = checkinInput  ? checkinInput.value  : '';
    const checkoutVal = checkoutInput ? checkoutInput.value : '';

    // Sync container attributes so fetchMonthRates can re-render correctly
    container.setAttribute('data-year',  rpYear);
    container.setAttribute('data-month', rpMonth);

    // Pre-fetch prices for this month
    fetchMonthRates(rpYear, rpMonth, container, checkinInput, rpPhase === 2);

    container.innerHTML = '';

    // ── Phase indicator (Llegada → Salida) ─────────────────────────────────
    const indicator = document.createElement('div');
    indicator.className = 'rp-indicator';

    function makeStep(labelEs, labelEn, dateVal, isActive) {
      const step = document.createElement('div');
      step.className = 'rp-step' +
        (isActive  ? ' rp-step--active' : '') +
        (dateVal   ? ' rp-step--done'   : '');
      step.innerHTML =
        `<span class="rp-step-label">${lang === 'es' ? labelEs : labelEn}</span>` +
        `<span class="rp-step-value">${dateVal ? formatDate(dateVal, lang) : (lang === 'es' ? 'Elige' : 'Select')}</span>`;
      return step;
    }

    // In phase 2, show current checkin and blank checkout (user is picking it)
    const indicatorCheckin  = rpPhase === 1 ? '' : checkinVal;
    const indicatorCheckout = rpPhase === 2 ? '' : checkoutVal;

    indicator.appendChild(makeStep('Llegada', 'Check-in',  indicatorCheckin,  rpPhase === 1));
    const arrow = document.createElement('span');
    arrow.className = 'rp-arrow';
    arrow.textContent = '→';
    indicator.appendChild(arrow);
    indicator.appendChild(makeStep('Salida', 'Check-out', indicatorCheckout, rpPhase === 2));

    container.appendChild(indicator);

    // ── Month navigation header ────────────────────────────────────────────
    const headerDiv = document.createElement('div');
    headerDiv.className = 'calendar-header';

    // minDate: phase 1 = today; phase 2 = checkin + 1 day
    let minDateStr = todayStr;
    if (rpPhase === 2 && checkinVal) {
      const p        = checkinVal.split('-');
      const nextDay  = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
      nextDay.setDate(nextDay.getDate() + 1);
      minDateStr = `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2,'0')}-${String(nextDay.getDate()).padStart(2,'0')}`;
    }

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'calendar-nav-btn';
    prevBtn.innerHTML = '←';

    const limitMonthStart = new Date(
      new Date(minDateStr).getFullYear(),
      new Date(minDateStr).getMonth(), 1
    );
    let pm = rpMonth - 1, py = rpYear;
    if (pm < 0) { pm = 11; py -= 1; }
    if (new Date(py, pm + 1, 0) < limitMonthStart) prevBtn.disabled = true;

    prevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      let pm = rpMonth - 1, py = rpYear;
      if (pm < 0) { pm = 11; py -= 1; }
      if (new Date(py, pm + 1, 0) >= limitMonthStart) {
        rpMonth = pm; rpYear = py;
        renderRangePicker(container);
      }
    });

    const titleSpan = document.createElement('span');
    titleSpan.textContent = `${months[rpMonth]} ${rpYear}`;

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'calendar-nav-btn';
    nextBtn.innerHTML = '→';
    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      let nm = rpMonth + 1, ny = rpYear;
      if (nm > 11) { nm = 0; ny += 1; }
      rpMonth = nm; rpYear = ny;
      renderRangePicker(container);
    });

    headerDiv.appendChild(prevBtn);
    headerDiv.appendChild(titleSpan);
    headerDiv.appendChild(nextBtn);
    container.appendChild(headerDiv);

    // ── Day grid ───────────────────────────────────────────────────────────
    const gridDiv = document.createElement('div');
    gridDiv.className = 'calendar-grid';

    weekdays.forEach(wd => {
      const d = document.createElement('div');
      d.className = 'calendar-weekday';
      d.textContent = wd;
      gridDiv.appendChild(d);
    });

    const firstDay    = new Date(rpYear, rpMonth, 1).getDay();
    const daysInMonth = new Date(rpYear, rpMonth + 1, 0).getDate();
    for (let i = 0; i < firstDay; i++) gridDiv.appendChild(document.createElement('div'));

    const cacheKey   = `${rpYear}-${rpMonth}`;
    const cached     = window.estarRatesCache[cacheKey];
    const ratesReady = cached && typeof cached === 'object';

    for (let d = 1; d <= daysInMonth; d++) {
      const dateVal = `${rpYear}-${String(rpMonth + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const dayDiv  = document.createElement('div');
      dayDiv.className = 'calendar-day';
      dayDiv.setAttribute('data-date', dateVal);

      const dayNumSpan = document.createElement('span');
      dayNumSpan.className = 'day-number';
      dayNumSpan.textContent = d;
      dayDiv.appendChild(dayNumSpan);

      if (ratesReady && cached[dateVal]) {
        const price = cached[dateVal];
        const fp    = price >= 1000 ? `${Math.round(price / 1000)}K` : price;
        const ps    = document.createElement('span');
        ps.className = 'calendar-day-price';
        ps.textContent = `$${fp}`;
        dayDiv.appendChild(ps);
      }

      if (dateVal === todayStr) dayDiv.classList.add('is-today');

      // Static range highlighting (visible between phases or after selection)
      if (dateVal === checkinVal) {
        dayDiv.classList.add('range-start', 'active');
      } else if (rpPhase !== 1 && dateVal === checkoutVal) {
        dayDiv.classList.add('range-end', 'active');
      } else if (rpPhase !== 1 && checkinVal && checkoutVal && dateVal > checkinVal && dateVal < checkoutVal) {
        dayDiv.classList.add('range-between');
      }

      // Hover preview overrides (phase 2 only, applied inline via updateRangeClasses)
      if (rpPhase === 2 && rpHover && rpHover > checkinVal) {
        dayDiv.classList.remove('range-end', 'range-between', 'range-hover-end', 'range-hover-between');
        if (dateVal === rpHover) dayDiv.classList.add('range-hover-end');
        else if (dateVal > checkinVal && dateVal < rpHover) dayDiv.classList.add('range-hover-between');
      }

      if (dateVal < minDateStr) {
        dayDiv.classList.add('disabled');
      } else {
        dayDiv.addEventListener('click', (e) => {
          e.stopPropagation();

          if (rpPhase === 1) {
            // First tap: set check-in, stay open in phase 2
            checkinInput.value = dateVal;
            checkinInput.dispatchEvent(new Event('change')); // auto-adjusts checkout min
            rpPhase = 2;
            rpHover = null;
            renderRangePicker(container);
          } else {
            // Second tap: set check-out, close calendar
            checkoutInput.value = dateVal;
            checkoutInput.dispatchEvent(new Event('change'));
            const field = document.getElementById('checkin-field');
            if (field) field.classList.remove('active');
            updateOverlayState();
          }
        });

        // Hover range preview in phase 2
        if (rpPhase === 2 && checkinVal) {
          dayDiv.addEventListener('mouseenter', () => {
            rpHover = dateVal;
            updateRangeClasses(gridDiv, checkinVal, dateVal);
          });
        }
      }

      gridDiv.appendChild(dayDiv);
    }

    if (rpPhase === 2 && checkinVal) {
      gridDiv.addEventListener('mouseleave', () => {
        rpHover = null;
        updateRangeClasses(gridDiv, checkinVal, null);
      });
    }

    container.appendChild(gridDiv);
  }

  // ── Live range-class update (hover preview without full re-render) ────────
  function updateRangeClasses(gridDiv, checkinVal, hoverDate) {
    gridDiv.querySelectorAll('.calendar-day').forEach(dDiv => {
      const dVal = dDiv.getAttribute('data-date');
      if (!dVal || dDiv.classList.contains('disabled')) return;
      dDiv.classList.remove('range-hover-between', 'range-hover-end', 'range-between', 'range-end');
      if (hoverDate && hoverDate > checkinVal) {
        if (dVal === hoverDate)                              dDiv.classList.add('range-hover-end');
        else if (dVal > checkinVal && dVal < hoverDate)     dDiv.classList.add('range-hover-between');
      }
    });
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
        // Ignore clicks inside the calendar UI — those are handled by the calendar itself
        if (
          e.target.tagName === 'SELECT'  ||
          e.target.tagName === 'INPUT'   ||
          e.target.closest('.calendar-header') ||
          e.target.closest('.calendar-grid')   ||
          e.target.closest('.rp-indicator')
        ) return;

        if (inputDateEl) {
          // ── Date fields: unified range picker ─────────────────────────────
          // Both checkin-field and checkout-field open the same calendar.
          const checkinField = document.getElementById('checkin-field');
          const isOpen = checkinField && checkinField.classList.contains('active');

          if (isOpen) {
            // Clicking the field header again closes the picker
            checkinField.classList.remove('active');
            updateOverlayState();
          } else {
            // Start in phase 2 if clicking Salida when check-in is already set
            const startPhase = (field.id === 'checkout-field' && checkinInput && checkinInput.value) ? 2 : 1;
            openRangePicker(startPhase);
          }
        } else {
          // ── Non-date fields (Huéspedes): original toggle logic ─────────────
          const isActive = field.classList.contains('active');
          selectFields.forEach(otherField => {
            if (otherField !== field) otherField.classList.remove('active');
          });
          if (isActive) {
            field.classList.remove('active');
          } else {
            field.classList.add('active');
          }
          updateOverlayState();
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
