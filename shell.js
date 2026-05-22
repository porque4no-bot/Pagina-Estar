/* ============================================================
   Hotel Estar — Shell behaviors
   - Header scroll state
   - Tweaks panel (brand color, language, density, video on/off, variant)
   - Custom star cursor on hero
   - Scroll reveal
   ============================================================ */

(function () {
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
  const cursorEls = document.querySelectorAll('.has-star-cursor');
  if (cursorEls.length && window.matchMedia('(pointer:fine)').matches) {
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

    cursorEls.forEach((el) => {
      el.addEventListener('mouseenter', () => {
        if (!visible) { cursor.classList.add('show'); visible = true; }
      });
      el.addEventListener('mouseleave', () => {
        if (visible) { cursor.classList.remove('show'); visible = false; }
      });
    });
  }

  /* ============================================================
     TWEAKS — Three expressive axes
     · Atmósfera   (Amanecer / Mediodía / Crepúsculo / Bruma)
     · Voz         (Susurro / Conversación / Manifiesto)
     · Textura     (Lisa / Grano / Sello)
     · Idioma      (ES / EN) — supporting toggle
     ============================================================ */

  const STORE_KEY = 'estar-tweaks';
  const defaults = (typeof TWEAK_DEFAULTS !== 'undefined') ? TWEAK_DEFAULTS : {
    atmosphere: 'mediodia',
    voice: 'conversacion',
    texture: 'lisa',
    language: 'es'
  };
  let tweaks = { ...defaults };
  try {
    const stored = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    tweaks = { ...defaults, ...stored };
  } catch (e) {}

  const ATMOSPHERE_LABEL = {
    amanecer: 'Amanecer',
    mediodia: 'Mediodía',
    crepusculo: 'Crepúsculo',
    bruma: 'Bruma'
  };
  const VOICE_LABEL = {
    susurro: 'Susurro',
    conversacion: 'Conversación',
    manifiesto: 'Manifiesto'
  };
  const TEXTURE_LABEL = {
    lisa: 'Lisa',
    grano: 'Grano',
    sello: 'Sello'
  };

  const i18n = {
    es: {
      nav_estadias: 'Estadías',
      nav_vivir: 'Vivir en estar',
      nav_explorar: 'Explorar Manizales',
      nav_empresas: 'Empresas',
      nav_grupos: 'Grupos',
      hero_eyebrow: 'Manizales · Caldas · Colombia',
      hero_meta_1: '14 apartaestudios',
      hero_meta_2: 'Reserva directa',
      hero_meta_3: 'Desde 2019',
      book_btn: 'Reservar',
      book_check_in: 'Llegada',
      book_check_out: 'Salida',
      book_guests: 'Huéspedes',
      book_rooms: 'Habitación',
      book_search: 'Buscar disponibilidad',
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
      fact_4_lbl: 'Valoración huéspedes'
    },
    en: {
      nav_estadias: 'Stays',
      nav_vivir: 'Live at estar',
      nav_explorar: 'Explore Manizales',
      nav_empresas: 'Companies',
      nav_grupos: 'Groups',
      hero_eyebrow: 'Manizales · Caldas · Colombia',
      hero_meta_1: '14 studio apartments',
      hero_meta_2: 'Direct booking',
      hero_meta_3: 'Since 2019',
      book_btn: 'Book',
      book_check_in: 'Check in',
      book_check_out: 'Check out',
      book_guests: 'Guests',
      book_rooms: 'Room',
      book_search: 'Check availability',
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
      fact_4_lbl: 'Guest rating'
    }
  };

  function applyTweaks() {
    document.body.dataset.atmosphere = tweaks.atmosphere;
    document.body.dataset.voice = tweaks.voice;
    document.body.dataset.texture = tweaks.texture;

    // Language
    const lang = tweaks.language;
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const k = el.getAttribute('data-i18n');
      if (i18n[lang] && i18n[lang][k]) el.textContent = i18n[lang][k];
    });
    document.querySelectorAll('[data-i18n-html]').forEach((el) => {
      const k = el.getAttribute('data-i18n-html');
      if (i18n[lang] && i18n[lang][k]) el.innerHTML = i18n[lang][k];
    });
  }

  function persist() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(tweaks)); } catch (e) {}
    if (window.parent !== window) {
      window.parent.postMessage({ type: '__edit_mode_set_keys', edits: tweaks }, '*');
    }
  }

  /* ----- TWEAKS PANEL UI ----- */
  function setupPanel() {
    if (document.querySelector('.tweaks-panel-x')) return;

    // Floating action button (reuse existing styling)
    let fab = document.createElement('button');
    fab.className = 'tweaks-fab';
    fab.setAttribute('aria-label', 'Abrir panel de Tweaks');
    fab.innerHTML = '<svg width="22" height="22" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true"><path d="M50 4 L60 38 L96 38 L66 60 L78 96 L50 74 L22 96 L34 60 L4 38 L40 38 Z"/></svg>';
    document.body.appendChild(fab);

    const panel = document.createElement('div');
    panel.className = 'tweaks-panel-x';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Tweaks');
    panel.innerHTML = `
      <div class="px-head">
        <span class="px-title">Tweaks</span>
        <button class="px-close" aria-label="Cerrar">✕</button>
      </div>

      <div class="px-section with-labels">
        <div class="px-section-label">
          <span>Atmósfera</span>
          <span class="now" data-now="atmosphere"></span>
        </div>
        <div class="px-tiles" data-key="atmosphere">
          <button class="px-tile atm-amanecer"   data-value="amanecer"  aria-label="Amanecer"><span class="px-tile-name">Amanecer</span></button>
          <button class="px-tile atm-mediodia"   data-value="mediodia"  aria-label="Mediodía"><span class="px-tile-name">Mediodía</span></button>
          <button class="px-tile atm-crepusculo" data-value="crepusculo" aria-label="Crepúsculo"><span class="px-tile-name">Crepúsculo</span></button>
          <button class="px-tile atm-bruma"      data-value="bruma"     aria-label="Bruma"><span class="px-tile-name">Bruma</span></button>
        </div>
      </div>

      <div class="px-section with-labels">
        <div class="px-section-label">
          <span>Voz</span>
          <span class="now" data-now="voice"></span>
        </div>
        <div class="px-tiles cols-3" data-key="voice">
          <button class="px-tile voz voz-susurro"      data-value="susurro"      aria-label="Susurro"><span class="glyph">Aa</span><span class="px-tile-name">Susurro</span></button>
          <button class="px-tile voz voz-conversacion" data-value="conversacion" aria-label="Conversación"><span class="glyph">Aa</span><span class="px-tile-name">Conversación</span></button>
          <button class="px-tile voz voz-manifiesto"   data-value="manifiesto"   aria-label="Manifiesto"><span class="glyph">Aa</span><span class="px-tile-name">Manifiesto</span></button>
        </div>
      </div>

      <div class="px-section with-labels">
        <div class="px-section-label">
          <span>Textura</span>
          <span class="now" data-now="texture"></span>
        </div>
        <div class="px-tiles cols-3" data-key="texture">
          <button class="px-tile tex tex-lisa"  data-value="lisa"  aria-label="Lisa"><span class="px-tile-name">Lisa</span></button>
          <button class="px-tile tex tex-grano" data-value="grano" aria-label="Grano"><span class="px-tile-name">Grano</span></button>
          <button class="px-tile tex tex-sello" data-value="sello" aria-label="Sello"><span class="px-tile-name">Sello</span></button>
        </div>
      </div>

      <div class="px-lang">
        <span class="lbl">Idioma</span>
        <div class="seg" data-key="language">
          <button data-value="es">ES</button>
          <button data-value="en">EN</button>
        </div>
      </div>

      <button class="px-reset" type="button">Restablecer</button>
    `;
    document.body.appendChild(panel);

    fab.addEventListener('click', () => panel.classList.add('open'));
    panel.querySelector('.px-close').addEventListener('click', () => {
      panel.classList.remove('open');
      if (window.parent !== window) {
        window.parent.postMessage({ type: '__edit_mode_dismissed' }, '*');
      }
    });

    function refreshPanel() {
      panel.querySelectorAll('[data-key]').forEach((group) => {
        const k = group.getAttribute('data-key');
        group.querySelectorAll('button').forEach((b) => {
          b.classList.toggle('active', b.getAttribute('data-value') === tweaks[k]);
        });
      });
      const nowAtm = panel.querySelector('[data-now="atmosphere"]');
      const nowVoz = panel.querySelector('[data-now="voice"]');
      const nowTex = panel.querySelector('[data-now="texture"]');
      if (nowAtm) nowAtm.textContent = ATMOSPHERE_LABEL[tweaks.atmosphere] || '';
      if (nowVoz) nowVoz.textContent = VOICE_LABEL[tweaks.voice] || '';
      if (nowTex) nowTex.textContent = TEXTURE_LABEL[tweaks.texture] || '';
    }
    refreshPanel();

    panel.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-key] button');
      if (btn) {
        const k = btn.parentElement.getAttribute('data-key');
        tweaks[k] = btn.getAttribute('data-value');
        applyTweaks();
        persist();
        refreshPanel();
        return;
      }
      if (e.target.closest('.px-reset')) {
        tweaks = { ...defaults };
        applyTweaks();
        persist();
        refreshPanel();
      }
    });

    // Edit mode protocol
    window.addEventListener('message', (e) => {
      const d = e.data || {};
      if (d.type === '__activate_edit_mode') {
        fab.classList.add('show');
      } else if (d.type === '__deactivate_edit_mode') {
        fab.classList.remove('show');
        panel.classList.remove('open');
      }
    });
    if (window.parent !== window) {
      window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    }
  }

  /* ----- HEADER LANG TOGGLE ----- */
  function setupHeaderLangToggle() {
    const toggles = document.querySelectorAll('.lang-toggle');
    toggles.forEach((toggle) => {
      toggle.addEventListener('click', () => {
        const nextLang = tweaks.language === 'es' ? 'en' : 'es';
        tweaks.language = nextLang;
        applyTweaks();
        persist();
        
        // Refresh panel if it exists
        const panel = document.querySelector('.tweaks-panel-x');
        if (panel) {
          panel.querySelectorAll('[data-key="language"] button').forEach((b) => {
            b.classList.toggle('active', b.getAttribute('data-value') === nextLang);
          });
        }
        
        // Dispatch custom event for decoupling with kunas.js or other custom scripts
        document.dispatchEvent(new CustomEvent('estar-lang-change', { detail: { lang: nextLang } }));
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
        if (data && data.rating) {
          const score = data.rating;
          i18n.es.fact_2_num = score;
          i18n.en.fact_2_num = score;
          applyTweaks();
        }
      })
      .catch(err => {
        console.warn('Could not fetch dynamic rating, using fallback:', err);
      });
  }

  /* ---------- INIT ---------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { 
      applyTweaks(); 
      setupPanel(); 
      setupHeaderLangToggle(); 
      setupMobileBookingScroll(); 
      setupRoomSliders();
      fetchDynamicRating();
    });
  } else {
    applyTweaks();
    setupPanel();
    setupHeaderLangToggle();
    setupMobileBookingScroll();
    setupRoomSliders();
    fetchDynamicRating();
  }
})();
