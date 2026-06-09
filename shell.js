/* ============================================================
   Hotel Estar — Shell behaviors
   - Header scroll state
   - Mobile menu
   - Scroll reveal
   - Star cursor on hero
   - i18n (URL-derived language)
   - Header language toggle
   - Contact float, booking bar scroll, room sliders, etc.
   ============================================================ */

(function () {
  /* ----- SITE-WIDE CONSTANTS ----- */
  const WHATSAPP_NUMBER = '573102490414'; // Change here to update all floating WhatsApp buttons

  /* ----- HEADER SCROLL ----- */
  const header = document.querySelector('.site-header');
  if (header) {
    const onScroll = () => {
      header.classList.toggle('is-scrolled', window.scrollY > 40);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ----- MOBILE MENU ----- */
  const menuBtn = document.querySelector('.menu-btn');
  if (menuBtn && header) {
    menuBtn.addEventListener('click', () => {
      header.classList.toggle('menu-open');
    });
    const navLinks = header.querySelectorAll('.nav-list a');
    navLinks.forEach((link) => {
      link.addEventListener('click', () => {
        header.classList.remove('menu-open');
      });
    });
  }

  /* ----- SCROLL REVEAL ----- */
  const reveals = document.querySelectorAll('[data-reveal]');
  if (reveals.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('is-visible');
            io.unobserve(e.target);
          }
        });
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.05 }
    );
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add('is-visible'));
  }

  /* ----- STAR CURSOR (only on .has-star-cursor) ----- */
  const hasStarCursor = document.querySelector('.has-star-cursor, #poiGrid') !== null;
  if (hasStarCursor && window.matchMedia('(pointer:fine)').matches) {
    const cursor = document.createElement('div');
    cursor.className = 'star-cursor';
    cursor.innerHTML = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M50 0 L57 35 L92 35 L62 56 L78 92 L50 70 L22 92 L38 56 L8 35 L43 35 Z" fill="currentColor"/></svg>';
    document.body.appendChild(cursor);

    let x = -100, y = -100, tx = -100, ty = -100, visible = false;
    const lerp = (a, b, t) => a + (b - a) * t;
    const tick = () => {
      x = lerp(x, tx, 0.22);
      y = lerp(y, ty, 0.22);
      cursor.style.transform = `translate(${x}px, ${y}px) rotate(${(x + y) * 0.08}deg)`;
      requestAnimationFrame(tick);
    };
    tick();

    window.addEventListener('mousemove', (e) => { tx = e.clientX; ty = e.clientY; });

    document.addEventListener('mouseover', (e) => {
      const el = e.target.closest('.has-star-cursor');
      if (el) {
        if (!visible) { cursor.classList.add('show'); visible = true; }
      }
    });

    document.addEventListener('mouseout', (e) => {
      const el = e.target.closest('.has-star-cursor');
      const related = e.relatedTarget;
      if (el && (!related || !el.contains(related))) {
        if (visible) { cursor.classList.remove('show'); visible = false; }
      }
    });
  }

  /* ============================================================
     i18n — Language is derived from the URL.
     Root pages (/) are Spanish; pages under /en/ are English.
     ============================================================ */

  const pageLang = window.location.pathname.startsWith('/en/') ? 'en' : 'es';

  // The two language dictionaries below are the source of truth at dev time
  // (when shell.js is served unbuilt via `node server.js`).
  // At build time, build.js replaces each block between the START/END markers
  // with the parsed contents of `i18n/shell.{es,en}.json` to keep dist/shell.js
  // in sync with the canonical JSON files.
  const i18n = {
    es: /*__I18N_ES_START__*/{
      nav_estadias: 'Estadías',
      nav_vivir: 'Estadía larga',
      nav_explorar: 'Explorar',
      nav_empresas: 'Empresas',
      nav_grupos: 'Grupos',
      map_eyebrow: 'Explora Manizales',
      map_title: 'Guía de Manizales: <span class="serif-italic">nuestro mapa curado.</span>',
      map_desc: 'Hemos mapeado nuestros lugares favoritos de la ciudad. Filtra por categorías y planifica tu día desde La Estrella y El Cable.',
      cat_todo: 'Todo',
      cat_escapadas: 'Escapadas',
      cat_birding: 'Birding',
      cat_restaurantes: 'Restaurantes',
      cat_cafes: 'Cafés',
      cat_universidades: 'Universidades',
      cat_deportivo: 'Deportivo',
      cat_turismo: 'Turismo',
      hero_eyebrow: 'Manizales · Caldas · Colombia',
      hero_meta_1: '14 apartaestudios',
      hero_meta_2: 'Reserva directa',
      hero_meta_3: 'Desde 2019',
      book_btn: 'Reservar',
      manage_btn: 'Gestionar',
      book_check_in: 'Llegada',
      book_check_out: 'Salida',
      book_guests: 'Huéspedes',
      book_rooms: 'Habitación',
      book_search: 'Ver precios y disponibilidad',
      book_pick_dates: 'Elige una fecha',
      book_one_guest: '1 huésped',
      book_two_guests: '2 huéspedes',
      book_three_guests: '3 huéspedes',
      book_four_guests_more: '4 huéspedes o más',
      room_option_all: 'Todos',
      book_one_room: '1 apartaestudio',
      lang_btn: 'EN',
      fact_1_num: '2025',
      fact_1_lbl: 'Año de fundación',
      fact_2_num: '9.6',
      fact_2_lbl: 'Calificación OTAs',
      fact_3_num: '100%',
      fact_3_lbl: 'Check-in digital',
      fact_4_num: '4.8',
      fact_4_lbl: 'Valoración huéspedes',
      loc_eyebrow: 'Ubicación estratégica',
      loc_title: 'Hotel boutique en Manizales: La Estrella y El Cable, <span class="serif-italic">alojamiento con criterio propio</span>',
      loc_booking_lbl: 'Calificación Booking',
      loc_booking_score: '9.0',
      loc_booking_reviews: '126 reseñas de huéspedes',
      loc_location_lbl: 'Excelente ubicación',
      loc_location_score: '9.4',
      loc_location_desc_short: 'Puntaje destacado por su cercanía y accesibilidad.',
      loc_location_desc: 'No solo lo decimos nosotros, nuestros huéspedes también valoran de forma excelente nuestra cercanía a puntos clave de la ciudad.',
      loc_places_title: 'Distancias a pie',
      map_btn_illustrated: 'Mapa Ilustrado',
      map_btn_interactive: 'Mapa Interactivo',
      contact_title: 'Escríbenos',
      contact_subtitle: 'Hospedaje contemporáneo',
      contact_wa_desc: 'Chatea con nosotros',
      contact_email_title: 'Correo',
      contact_maps_desc: 'Cómo llegar',
      contact_waze_desc: 'Navegar con Waze',
      footer_desc: 'Hospedaje en el corazón de Manizales pensado para <span class="serif-italic">estar</span> en casa.',
      footer_hospedaje: 'Hospedaje',
      footer_estadias: 'Estadías',
      footer_apartaestudios: 'Apartaestudios',
      footer_vivir: 'Extended Stay',
      footer_grupos: 'Grupos y eventos',
      footer_empresas: 'Empresas',
      footer_portal: 'Portal corporativo',
      footer_convenio: 'Solicitar convenio',
      footer_cotizar: 'Cotizar grupos',
      footer_trabaja: 'Trabaja con nosotros',
      footer_descubre: 'Descubre',
      footer_nosotros: 'Sobre Nosotros',
      footer_explorar: 'Explorar Manizales',
      footer_preguntas: 'Preguntas Frecuentes',
      footer_contacto: 'Contáctanos',
      footer_copyright: '© 2026 estar · Manizales, Colombia',
      footer_rnt: 'RNT 276306',
      footer_aviso: 'Aviso Legal',
      footer_cancelacion: 'Política de cancelación',
      footer_privacidad: 'Privacidad',
      footer_cookies: 'Política de Cookies',
      footer_escnna: 'Protección de Menores (ESCNNA)',
      duration_label: 'Duración de la estadía',
      duration_1_3: '1 a 3 meses',
      duration_3_6: '3 a 6 meses',
      duration_6_11: '6 a 11 meses',
      duration_12_plus: '12 o más meses',
      unit_label: 'Unidad de interés',
      unit_select_placeholder: 'Selecciona una unidad',
      typology_label: 'Tipología de habitación',
      typology_clasica: 'Clásica',
      typology_seleccion: 'Selección',
      typology_reserva: 'Reserva',
      typology_origen: 'Origen',
      typology_especial: 'Especial',
      special_rates_label: '✶ Tarifas especiales:',
      special_rates_text: 'Ofrecemos descuentos preferenciales en estancias mensuales o reservas de más de 4 unidades.',
      privacy_agreement: 'Acepto el tratamiento de mis datos personales para cotización según la <a href="privacidad.html" target="_blank">Política de Privacidad</a>.',
      form_empresa: 'Empresa',
      form_empresa_placeholder: 'Ej. Hospital de Caldas',
      form_contacto: 'Nombre del contacto',
      form_contacto_placeholder: 'María Restrepo',
      form_correo: 'Correo corporativo',
      form_correo_placeholder: 'm.restrepo@empresa.co',
      form_whatsapp: 'WhatsApp',
      form_whatsapp_placeholder: '+57 300 000 0000',
      form_credito: 'Solicitar crédito a 30 días (sujeto a aprobación)',
      form_politica: 'Acepto la <a href="privacidad.html" target="_blank">Política de Privacidad</a> e información de Habeas Data corporativo.',
      form_enviar: 'Enviar solicitud <span aria-hidden="true">→</span>',
      cookie_title: 'Control de Cookies',
      cookie_desc: 'Utilizamos cookies esenciales para recordar tus preferencias y analíticas para optimizar el sitio. Puedes aceptar o rechazar las de análisis.',
      cookie_accept: 'Aceptar',
      cookie_reject: 'Rechazar',
      cookie_policy: 'Política de Cookies'
    }/*__I18N_ES_END__*/,
    en: /*__I18N_EN_START__*/{
      nav_estadias: 'Stays',
      nav_vivir: 'Extended Stay',
      nav_explorar: 'Explore',
      nav_empresas: 'Companies',
      nav_grupos: 'Groups',
      map_eyebrow: 'Explore Manizales',
      map_title: 'Manizales guide: <span class="serif-italic">our curated map.</span>',
      map_desc: 'We\'ve mapped out our favorite spots in the city. Filter by category and plan your day starting from La Estrella and El Cable.',
      cat_todo: 'All',
      cat_escapadas: 'Escapadas',
      cat_birding: 'Birding',
      cat_restaurantes: 'Restaurants',
      cat_cafes: 'Cafés',
      cat_universidades: 'Universities',
      cat_deportivo: 'Sports',
      cat_turismo: 'Tourism',
      hero_eyebrow: 'Manizales · Caldas · Colombia',
      hero_meta_1: '14 studio apartments',
      hero_meta_2: 'Direct booking',
      hero_meta_3: 'Since 2019',
      book_btn: 'Book',
      manage_btn: 'Manage',
      book_check_in: 'Check in',
      book_check_out: 'Check out',
      book_guests: 'Guests',
      book_rooms: 'Room',
      book_search: 'See prices and availability',
      book_pick_dates: 'Pick a date',
      book_one_guest: '1 guest',
      book_two_guests: '2 guests',
      book_three_guests: '3 guests',
      book_four_guests_more: '4 guests or more',
      room_option_all: 'All',
      book_one_room: '1 studio',
      lang_btn: 'ES',
      fact_1_num: '2025',
      fact_1_lbl: 'Year founded',
      fact_2_num: '9.6',
      fact_2_lbl: 'OTAs rating',
      fact_3_num: '100%',
      fact_3_lbl: 'Digital check-in',
      fact_4_num: '4.8',
      fact_4_lbl: 'Guest rating',
      loc_eyebrow: 'Strategic location',
      loc_title: 'Boutique hotel in Manizales: La Estrella and El Cable, <span class="serif-italic">lodging with its own character</span>',
      loc_booking_lbl: 'Booking rating',
      loc_booking_score: '9.0',
      loc_booking_reviews: '126 guest reviews',
      loc_location_lbl: 'Excellent location',
      loc_location_score: '9.4',
      loc_location_desc_short: 'Outstanding score for its proximity and accessibility.',
      loc_location_desc: 'It\'s not just us saying it, our guests also rate our proximity to key city spots outstandingly.',
      loc_places_title: 'Walking distances',
      map_btn_illustrated: 'Illustrated Map',
      map_btn_interactive: 'Interactive Map',
      contact_title: 'Contact Us',
      contact_subtitle: 'Contemporary lodging',
      contact_wa_desc: 'Chat with us',
      contact_email_title: 'Email',
      contact_maps_desc: 'Get directions',
      contact_waze_desc: 'Navigate with Waze',
      footer_desc: 'Lodging in the heart of Manizales, designed to <span class="serif-italic">estar</span> at home.',
      footer_hospedaje: 'Lodging',
      footer_estadias: 'Stays',
      footer_apartaestudios: 'Studio apartments',
      footer_vivir: 'Extended Stay',
      footer_grupos: 'Groups & events',
      footer_empresas: 'Companies',
      footer_portal: 'Corporate portal',
      footer_convenio: 'Request agreement',
      footer_cotizar: 'Quote groups',
      footer_trabaja: 'Work with us',
      footer_descubre: 'Discover',
      footer_nosotros: 'About Us',
      footer_explorar: 'Explore Manizales',
      footer_preguntas: 'FAQ',
      footer_contacto: 'Contact Us',
      footer_copyright: '© 2026 estar · Manizales, Colombia',
      footer_rnt: 'RNT 276306',
      footer_aviso: 'Legal Notice',
      footer_cancelacion: 'Cancellation Policy',
      footer_privacidad: 'Privacy Policy',
      footer_cookies: 'Cookies Policy',
      footer_escnna: 'Child Protection (ESCNNA)',
      duration_label: 'Stay duration',
      duration_1_3: '1 to 3 months',
      duration_3_6: '3 to 6 months',
      duration_6_11: '6 to 11 months',
      duration_12_plus: '12 or more months',
      unit_label: 'Unit of interest',
      unit_select_placeholder: 'Select a unit',
      typology_label: 'Room typology',
      typology_clasica: 'Clásica',
      typology_seleccion: 'Selección',
      typology_reserva: 'Reserva',
      typology_origen: 'Origen',
      typology_especial: 'Especial',
      special_rates_label: '✶ Special rates:',
      special_rates_text: 'We offer preferential discounts for monthly stays or bookings of more than 4 units.',
      privacy_agreement: 'I accept the processing of my personal data for quoting per the <a href="privacidad.html" target="_blank">Privacy Policy</a>.',
      form_empresa: 'Company',
      form_empresa_placeholder: 'e.g. Hospital de Caldas',
      form_contacto: 'Contact name',
      form_contacto_placeholder: 'Maria Restrepo',
      form_correo: 'Corporate email',
      form_correo_placeholder: 'm.restrepo@empresa.co',
      form_whatsapp: 'WhatsApp',
      form_whatsapp_placeholder: '+57 300 000 0000',
      form_credito: 'Request 30-day credit (subject to approval)',
      form_politica: 'I accept the <a href="privacidad.html" target="_blank">Privacy Policy</a> and corporate Habeas Data terms.',
      form_enviar: 'Send request <span aria-hidden="true">→</span>',
      cookie_title: 'Cookie Preferences',
      cookie_desc: 'We use essential cookies to remember your preferences and analytics to optimize our site. You can accept or reject analytics.',
      cookie_accept: 'Accept',
      cookie_reject: 'Reject',
      cookie_policy: 'Cookies Policy'
    }/*__I18N_EN_END__*/
  };

  function applyI18n() {
    const lang = pageLang;
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const k = el.getAttribute('data-i18n');
      if (i18n[lang] && i18n[lang][k]) el.textContent = i18n[lang][k];
    });
    // [data-i18n-html] uses innerHTML only for keys whose values are trusted static HTML
    // defined in this file — never user-supplied content. Safe keys:
    //   footer_desc   — contains <span class="serif-italic">
    //   map_title     — contains <span class="serif-italic">
    //   loc_title     — contains <span class="serif-italic">
    //   form_politica — contains <a href="privacidad.html"> (internal link)
    //   form_enviar   — contains <span aria-hidden="true">
    //   privacy_agreement — contains <a href="privacidad.html"> (internal link)
    // Keys that contain plain text must use [data-i18n] (textContent) instead.
    const SAFE_HTML_KEYS = new Set([
      'footer_desc', 'map_title', 'loc_title',
      'form_politica', 'form_enviar', 'privacy_agreement'
    ]);
    document.querySelectorAll('[data-i18n-html]').forEach((el) => {
      const k = el.getAttribute('data-i18n-html');
      if (i18n[lang] && i18n[lang][k]) {
        if (SAFE_HTML_KEYS.has(k)) {
          el.innerHTML = i18n[lang][k];
        } else {
          // Key not in safe list — fall back to textContent to avoid XSS
          el.textContent = i18n[lang][k];
        }
      }
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const k = el.getAttribute('data-i18n-placeholder');
      if (i18n[lang] && i18n[lang][k]) el.setAttribute('placeholder', i18n[lang][k]);
    });

    // Accesibilidad: aria-hidden en elementos de idioma
    document.querySelectorAll('.lang-es').forEach(function(el) {
      el.setAttribute('aria-hidden', lang !== 'es' ? 'true' : 'false');
    });
    document.querySelectorAll('.lang-en').forEach(function(el) {
      el.setAttribute('aria-hidden', lang !== 'en' ? 'true' : 'false');
    });
  }


  /* ----- HEADER LANG TOGGLE ----- */
  function setupHeaderLangToggle() {
    const toggles = document.querySelectorAll('.lang-toggle');
    toggles.forEach((toggle) => {
      toggle.addEventListener('click', () => {
        const path = window.location.pathname;
        let target;
        if (path.startsWith('/en/')) {
          target = path.slice(3) || '/';
        } else {
          target = '/en' + (path === '/' ? '/' : path);
        }
        window.location.href = target;
      });
    });
  }

  /* ----- MOBILE BOOKING SCROLL ----- */
  function setupMobileBookingScroll() {
    const bookBtns = document.querySelectorAll('.book-btn');
    bookBtns.forEach((btn) => {
      const href = btn.getAttribute('href');
      if (href === '#reservar' || href.endsWith('#reservar')) {
        btn.addEventListener('click', (e) => {
          if (window.innerWidth <= 900) {
            const bookingBar = document.getElementById('reservar');
            if (bookingBar) {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }
        });
      }
    });

    if (window.location.hash === '#reservar' && window.innerWidth <= 900) {
      window.addEventListener('load', () => {
        setTimeout(() => {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }, 150);
      });
    }
  }

  /* ----- ROOM SLIDERS ----- */
  function setupRoomSliders() {
    const sliders = document.querySelectorAll('.room-media.slider-active');
    sliders.forEach((slider) => {
      const track = slider.querySelector('.slider-track');
      const slides = slider.querySelectorAll('.slider-slide');
      const prevBtn = slider.querySelector('.slider-arrow.prev');
      const nextBtn = slider.querySelector('.slider-arrow.next');
      const indicators = slider.querySelectorAll('.slider-indicators .indicator');
      
      if (!track || slides.length === 0) return;
      
      let currentIndex = 0;
      const totalSlides = slides.length;
      
      function goToSlide(index) {
        if (index < 0) {
          currentIndex = totalSlides - 1;
        } else if (index >= totalSlides) {
          currentIndex = 0;
        } else {
          currentIndex = index;
        }
        
        // Translate track
        track.style.transform = `translateX(-${currentIndex * 100}%)`;

        // Load deferred image on demand
        const dImg = slides[currentIndex].querySelector('img[data-src]');
        if (dImg) {
          dImg.src = dImg.dataset.src;
          if (dImg.dataset.srcset) dImg.srcset = dImg.dataset.srcset;
          dImg.removeAttribute('data-src');
          dImg.removeAttribute('data-srcset');
        }

        // Update indicators
        indicators.forEach((ind, i) => {
          ind.classList.toggle('active', i === currentIndex);
        });
      }
      
      // Event listeners for navigation buttons
      if (prevBtn) {
        prevBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          goToSlide(currentIndex - 1);
        });
      }
      
      if (nextBtn) {
        nextBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          goToSlide(currentIndex + 1);
        });
      }
      
      // Event listeners for dot indicators
      indicators.forEach((indicator) => {
        indicator.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const slideIndex = parseInt(indicator.getAttribute('data-slide'));
          if (!isNaN(slideIndex)) {
            goToSlide(slideIndex);
          }
        });
      });
      
      // Touch gestures for swipe support
      let touchStartX = 0;
      let touchEndX = 0;
      
      slider.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
      }, { passive: true });
      
      slider.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
      }, { passive: true });
      
      function handleSwipe() {
        const threshold = 40; // minimum distance in pixels
        if (touchStartX - touchEndX > threshold) {
          // Swipe left -> Next slide
          goToSlide(currentIndex + 1);
        } else if (touchEndX - touchStartX > threshold) {
          // Swipe right -> Previous slide
          goToSlide(currentIndex - 1);
        }
      }
    });
  }

  /* ----- DYNAMIC RATING FETCH ----- */
  function fetchDynamicRating() {
    fetch('/api/get-booking-rating')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP status ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (data) {
          if (data.rating) {
            i18n.es.fact_2_num = data.rating;
            i18n.en.fact_2_num = data.rating;
            i18n.es.loc_booking_score = data.rating;
            i18n.en.loc_booking_score = data.rating;
          }
          if (data.reviewsCount) {
            i18n.es.loc_booking_reviews = `${data.reviewsCount} reseñas`;
            i18n.en.loc_booking_reviews = `${data.reviewsCount} reviews`;
          }
          if (data.locationRating) {
            i18n.es.loc_location_score = data.locationRating;
            i18n.en.loc_location_score = data.locationRating;
          }
          applyI18n();
        }
      })
      .catch(err => {
        console.warn('Could not fetch dynamic rating, using fallback:', err);
      });
  }



  /* ----- CONTACT HUB FLOATING WIDGET ----- */
  function setupContactFloat() {
    const contactFloat = document.getElementById('contactFloat');
    if (!contactFloat) return;

    // Dynamically set WhatsApp href from the central WHATSAPP_NUMBER constant
    const waUrl = `https://api.whatsapp.com/send/?phone=${WHATSAPP_NUMBER}&text&type=phone_number&app_absent=0`;
    contactFloat.querySelectorAll('.ci-whatsapp').forEach((el) => {
      el.href = waUrl;
    });

    const trigger = contactFloat.querySelector('.contact-trigger');
    if (!trigger) return;

    // Toggle menu active state on trigger click/tap
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      contactFloat.classList.toggle('active');
    });

    // Prevent click events inside the menu from closing the menu
    const menu = contactFloat.querySelector('.contact-menu');
    if (menu) {
      menu.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    }

    // Close menu when clicking anywhere else on the document
    document.addEventListener('click', () => {
      contactFloat.classList.remove('active');
    });

    // Close menu when pressing Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        contactFloat.classList.remove('active');
      }
    });

    // ── Attention animation + tooltip (once per session) ──
    if (!sessionStorage.getItem('estar-contact-seen')) {
      const tooltip = document.createElement('div');
      tooltip.className = 'contact-tooltip';
      tooltip.innerHTML = `
        <span>${pageLang === 'en' ? 'Can we help you?' : '¿Te podemos ayudar?'}</span>
        <button class="contact-tooltip-close" aria-label="${pageLang === 'en' ? 'Close' : 'Cerrar'}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      `;
      document.body.appendChild(tooltip);

      const dismissTooltip = () => {
        tooltip.classList.remove('visible');
        setTimeout(() => { if (tooltip.parentNode) tooltip.remove(); }, 400);
      };

      tooltip.querySelector('.contact-tooltip-close').addEventListener('click', (e) => {
        e.stopPropagation();
        dismissTooltip();
      });

      setTimeout(() => {
        // Bounce the button
        trigger.classList.add('attention');
        trigger.addEventListener('animationend', () => {
          trigger.classList.remove('attention');
        }, { once: true });

        // Show tooltip
        tooltip.classList.add('visible');
        sessionStorage.setItem('estar-contact-seen', '1');

        // Auto-hide tooltip after 8 s
        setTimeout(dismissTooltip, 8000);
      }, 4000);

      // Hide tooltip immediately if user opens the menu
      trigger.addEventListener('click', dismissTooltip, { once: true });
    }
  }

  /* ----- BOOKING BAR SCROLL REVEAL ----- */
  function setupBookingBarScroll() {
    const bookingBar = document.querySelector('.booking-bar');
    if (!bookingBar) return;

    const onScroll = () => {
      bookingBar.classList.toggle('is-visible', window.scrollY > 120);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ----- COOKIE CONSENT BANNER ----- */
  function setupCookieConsent() {
    const consent = localStorage.getItem('estar-cookie-consent');
    if (consent) return; // Consent already given/refused

    const banner = document.createElement('div');
    banner.className = 'cookie-banner';
    banner.id = 'cookieBanner';
    banner.innerHTML = `
      <h4 data-i18n="cookie_title">Control de Cookies</h4>
      <p>
        <span data-i18n="cookie_desc">Utilizamos cookies esenciales para recordar tus preferencias y analíticas para optimizar el sitio. Puedes aceptar o rechazar las de análisis.</span>
        <a href="cookies.html" target="_blank" data-i18n="cookie_policy">Política de Cookies</a>.
      </p>
      <div class="cookie-banner-actions">
        <button class="btn-accept" data-i18n="cookie_accept">Aceptar</button>
        <button class="btn-reject" data-i18n="cookie_reject">Rechazar</button>
      </div>
    `;
    
    document.body.appendChild(banner);
    banner.style.display = 'flex';

    banner.querySelector('.btn-accept').addEventListener('click', () => {
      localStorage.setItem('estar-cookie-consent', 'accepted');
      banner.style.opacity = '0';
      setTimeout(() => banner.remove(), 400);
    });

    banner.querySelector('.btn-reject').addEventListener('click', () => {
      localStorage.setItem('estar-cookie-consent', 'rejected');
      banner.style.opacity = '0';
      setTimeout(() => banner.remove(), 400);
    });
  }

  /* ----- ROOM LIST CAROUSEL ----- */
  function setupRoomListCarousel() {
    if (document.querySelector('.tier-table')) return;

    const container = document.querySelector('.room-list-container');
    if (!container) return;

    const list = container.querySelector('.room-list');
    const prevBtn = container.querySelector('.room-list-btn.prev');
    const nextBtn = container.querySelector('.room-list-btn.next');

    if (!list || !prevBtn || !nextBtn) return;

    let cachedScrollStep = null;
    let cachedMaxScroll = null;
    let rafId = null;

    function computeScrollStep() {
      const firstCard = list.querySelector('.room');
      if (firstCard) {
        const style = window.getComputedStyle(list);
        const gap = parseFloat(style.columnGap || style.gap) || 32;
        return firstCard.clientWidth + gap;
      }
      return 450;
    }

    function getScrollStep() {
      if (cachedScrollStep === null) cachedScrollStep = computeScrollStep();
      return cachedScrollStep;
    }

    function updateButtonStates() {
      const scrollLeft = list.scrollLeft;
      if (cachedMaxScroll === null) cachedMaxScroll = list.scrollWidth - list.clientWidth;
      prevBtn.disabled = scrollLeft <= 10;
      nextBtn.disabled = scrollLeft >= cachedMaxScroll - 10;
    }

    function onScrollDeferred() {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        updateButtonStates();
      });
    }

    function invalidateCache() {
      cachedScrollStep = null;
      cachedMaxScroll = null;
      updateButtonStates();
    }

    prevBtn.addEventListener('click', (e) => {
      e.preventDefault();
      list.scrollBy({ left: -getScrollStep(), behavior: 'smooth' });
    });

    nextBtn.addEventListener('click', (e) => {
      e.preventDefault();
      list.scrollBy({ left: getScrollStep(), behavior: 'smooth' });
    });

    list.addEventListener('scroll', onScrollDeferred, { passive: true });
    window.addEventListener('resize', invalidateCache);

    // Initial check
    setTimeout(updateButtonStates, 100);
  }

  /* ----- NETLIFY FORMS AJAX SUBMISSION INTERCEPTOR ----- */
  function setupNetlifyForms() {
    document.querySelectorAll('form[data-netlify="true"]').forEach(form => {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const submitButton = form.querySelector('button[type="submit"]');
        let originalButtonHtml = '';
        if (submitButton) {
          submitButton.disabled = true;
          originalButtonHtml = submitButton.innerHTML;
          const lang = pageLang || 'es';
          submitButton.textContent = lang === 'en' ? 'Sending...' : 'Enviando...';
        }
        
        // Ensure form-name hidden field is set
        let hiddenFormName = form.querySelector('input[name="form-name"]');
        if (!hiddenFormName) {
          hiddenFormName = document.createElement('input');
          hiddenFormName.type = 'hidden';
          hiddenFormName.name = 'form-name';
          hiddenFormName.value = form.getAttribute('name');
          form.appendChild(hiddenFormName);
        }
        
        fetch("/", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(new FormData(form)).toString()
        })
        .then(response => {
          if (!response.ok) {
            throw new Error(`Server returned status ${response.status}`);
          }
          
          const lang = pageLang || 'es';
          
          if (form.classList.contains('contact-form')) {
            form.style.opacity = '0.6';
            form.innerHTML = '<div style="padding: 40px 0; text-align: center; font-family: var(--font-heading); font-size: 18px; color: var(--fg);">✶ Gracias. Responderemos pronto. / Thank you. We will reply shortly.</div>';
          } else if (form.classList.contains('apply-form')) {
            form.style.opacity = '0.6';
            form.innerHTML = '<div style="padding: 40px 0; text-align: center; font-family: var(--font-heading); font-size: 18px; color: var(--fg);">✶ Postulación enviada. / Application sent.</div>';
          } else if (form.getAttribute('name') === 'newsletter') {
            const emailInput = form.querySelector('input[type="email"]');
            if (emailInput) emailInput.value = '';
            if (submitButton) {
              submitButton.textContent = lang === 'en' ? 'Thank you ✶' : 'Gracias ✶';
            }
          } else if (form.getAttribute('name') === 'convenios-empresas') {
            if (submitButton) {
              submitButton.textContent = lang === 'en' ? 'Received ✶ — we will write you soon' : 'Recibido ✶ — te escribimos pronto';
            }
          } else {
            if (submitButton) {
              submitButton.textContent = lang === 'en' ? 'Request sent ✶' : 'Solicitud enviada ✶';
            }
          }
        })
        .catch(error => {
          console.error("Netlify form submission error:", error);
          if (submitButton) {
            submitButton.disabled = false;
            submitButton.innerHTML = originalButtonHtml;
          }
          alert(pageLang === 'en' 
            ? 'There was an error sending your message. Please try again or contact us via WhatsApp.' 
            : 'Ocurrió un error al enviar tu mensaje. Por favor intenta de nuevo o escríbenos por WhatsApp.'
          );
        });
      });
    });
  }

  /* ---------- ACCESSIBILITY HELPERS ---------- */

  // Accesibilidad: inyectar skip link
  function injectSkipLink() {
    if (document.getElementById('skip-to-content')) return;
    var skip = document.createElement('a');
    skip.id = 'skip-to-content';
    skip.href = '#main-content';
    skip.className = 'skip-link';
    skip.textContent = pageLang === 'en' ? 'Skip to main content' : 'Saltar al contenido principal';
    document.body.insertBefore(skip, document.body.firstChild);
  }

  /* ---------- CSP-safe share + manage buttons ----------
     Replaces former inline onclick handlers so the page can run under
     a strict CSP without 'unsafe-inline' on script-src. */
  function setupShareButtons() {
    var pageLang = (document.documentElement.lang || 'es').toLowerCase().slice(0, 2);
    var copiedMsg = pageLang === 'en' ? 'Link copied' : 'Enlace copiado';
    document.querySelectorAll('.share-btn').forEach(function (btn) {
      if (btn.dataset.shareBound === '1') return;
      btn.dataset.shareBound = '1';
      btn.addEventListener('click', function () {
        if (navigator.share) {
          navigator.share({ title: document.title, url: window.location.href }).catch(function () {});
        } else if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(window.location.href).then(function () { alert(copiedMsg); });
        }
      });
    });
  }

  function setupManageButton() {
    document.querySelectorAll('a.book-btn[data-i18n="manage_btn"]').forEach(function (a) {
      if (a.dataset.manageBound === '1') return;
      a.dataset.manageBound = '1';
      a.addEventListener('click', function (e) {
        if (window.enterManageMode) {
          e.preventDefault();
          window.enterManageMode();
        }
      });
    });
  }

  // Accesibilidad: marcar contenido principal
  function markMainContent() {
    if (document.getElementById('main-content')) return;
    var main = document.querySelector('main') ||
                document.querySelector('.hero') ||
                document.querySelector('section:not(header section)') ||
                document.querySelector('.sub-hero');
    if (main && !main.id) main.id = 'main-content';
  }


  /* ---------- INIT ---------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      injectSkipLink();
      markMainContent();
      setupCookieConsent();
      applyI18n();
      setupHeaderLangToggle();
      setupMobileBookingScroll();
      setupRoomSliders();
      setupRoomListCarousel();
      setupContactFloat();
      setupBookingBarScroll();
      fetchDynamicRating();
      setupNetlifyForms();
      setupShareButtons();
      setupManageButton();
    });
  } else {
    injectSkipLink();
    markMainContent();
    setupCookieConsent();
    applyI18n();
    setupHeaderLangToggle();
    setupMobileBookingScroll();
    setupRoomSliders();
    setupRoomListCarousel();
    setupContactFloat();
    setupBookingBarScroll();
    fetchDynamicRating();
    setupNetlifyForms();
    setupShareButtons();
    setupManageButton();
  }
})();
