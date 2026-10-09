/* Cookie consent banner + Google Consent Mode v2 (A-7, auditoría 360°).
 *
 * The GA4 bootstrap (injected by build.js) sets consent DEFAULT = denied for
 * analytics/ads before any tag fires, so nothing is collected until the visitor
 * opts in here. On accept we call gtag('consent','update', granted...) and any
 * ad pixels (Meta / Google Ads, injected only when their IDs are configured)
 * are activated. Choice is remembered in localStorage. Strictest model: the
 * banner is shown to every visitor regardless of region until they choose.
 *
 * Frente site (oct-2026): the choice can be CHANGED later. A "Configurar
 * cookies" / "Cookie settings" button is added next to the cookie-policy link
 * of every footer (and any element with [data-cookie-settings], e.g. the one on
 * cookies.html) reopens the banner. Withdrawing consent also deletes the
 * analytics/ads cookies already set (_ga, _ga_*, _gid, _fbp, _gcl_*).
 * Public API (used by shell.js for consent-gated pixel events):
 *   window.EstarConsent.open()     → reopen the preferences banner
 *   window.EstarConsent.granted()  → true only after an explicit opt-in
 *   window.EstarConsent.choice()   → 'granted' | 'denied' | null
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'estar-cookie-consent-v1';
  var lang = (document.documentElement.lang || 'es').toLowerCase().indexOf('en') === 0 ? 'en' : 'es';

  var COPY = {
    es: {
      text: 'Usamos cookies para analizar el tráfico y mejorar tu experiencia. Puedes aceptarlas o rechazarlas.',
      accept: 'Aceptar',
      reject: 'Rechazar',
      more: 'Política de cookies',
      moreHref: '/cookies.html',
      settings: 'Configurar cookies',
      current: { granted: 'Ahora: aceptadas.', denied: 'Ahora: rechazadas.' }
    },
    en: {
      text: 'We use cookies to analyze traffic and improve your experience. You can accept or reject them.',
      accept: 'Accept',
      reject: 'Reject',
      more: 'Cookie policy',
      moreHref: '/en/cookies.html',
      settings: 'Cookie settings',
      current: { granted: 'Currently: accepted.', denied: 'Currently: rejected.' }
    }
  };
  var t = COPY[lang];

  /* Cookies de analítica/publicidad que se borran al retirar el consentimiento. */
  var TRACKING_COOKIE = /^(_ga|_ga_.+|_gid|_gat.*|_fbp|_fbc|_gcl_.+)$/;

  function gtagSafe() {
    if (typeof window.gtag === 'function') {
      window.gtag.apply(window, arguments);
    } else {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(arguments);
    }
  }

  function applyConsent(granted) {
    var state = granted ? 'granted' : 'denied';
    gtagSafe('consent', 'update', {
      ad_storage: state,
      ad_user_data: state,
      ad_personalization: state,
      analytics_storage: state
    });
    // Meta Pixel respects an explicit grant/revoke when present.
    if (typeof window.fbq === 'function') {
      window.fbq('consent', granted ? 'grant' : 'revoke');
    }
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: granted ? 'consent_granted' : 'consent_denied' });
  }

  /* Expira las cookies de seguimiento en el host actual y en cada dominio padre
     (GA4 las pone en el dominio raíz, p. ej. .estar.com.co). */
  function clearTrackingCookies() {
    var names = [];
    try {
      (document.cookie || '').split(';').forEach(function (part) {
        var name = part.split('=')[0].trim();
        if (name && TRACKING_COOKIE.test(name)) names.push(name);
      });
    } catch (e) { return; }
    if (!names.length) return;
    var host = location.hostname;
    var domains = [''];
    var parts = host.split('.');
    for (var i = 0; i < parts.length - 1; i++) domains.push('; domain=.' + parts.slice(i).join('.'));
    names.forEach(function (name) {
      domains.forEach(function (d) {
        try { document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + d; } catch (e) {}
      });
    });
  }

  function store(choice) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ choice: choice, at: Date.now() })); } catch (e) {}
  }

  function readChoice() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw).choice : null;
    } catch (e) { return null; }
  }

  function removeBanner(el) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function buildBanner(prior) {
    var banner = document.createElement('div');
    banner.className = 'cookie-consent';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-live', 'polite');
    banner.setAttribute('aria-label', lang === 'en' ? 'Cookie consent' : 'Consentimiento de cookies');

    var msg = document.createElement('p');
    msg.className = 'cookie-consent__text';
    msg.textContent = t.text + ' ' + (prior && t.current[prior] ? t.current[prior] + ' ' : '');
    var moreLink = document.createElement('a');
    moreLink.href = t.moreHref;
    moreLink.textContent = t.more;
    moreLink.className = 'cookie-consent__link';
    msg.appendChild(moreLink);

    var actions = document.createElement('div');
    actions.className = 'cookie-consent__actions';

    var reject = document.createElement('button');
    reject.type = 'button';
    reject.className = 'cookie-consent__btn cookie-consent__btn--ghost';
    reject.textContent = t.reject;

    var accept = document.createElement('button');
    accept.type = 'button';
    accept.className = 'cookie-consent__btn cookie-consent__btn--primary';
    accept.textContent = t.accept;

    reject.addEventListener('click', function () {
      applyConsent(false); store('denied'); clearTrackingCookies(); removeBanner(banner);
    });
    accept.addEventListener('click', function () {
      applyConsent(true); store('granted'); removeBanner(banner);
    });

    actions.appendChild(reject);
    actions.appendChild(accept);
    banner.appendChild(msg);
    banner.appendChild(actions);
    return banner;
  }

  /* Reabre el banner para cambiar la elección (desde el footer o cookies.html). */
  function openPreferences() {
    var existing = document.querySelector('.cookie-consent');
    var banner = existing || buildBanner(readChoice());
    if (!existing) document.body.appendChild(banner);
    var first = banner.querySelector('button');
    if (first) { try { first.focus(); } catch (e) {} }
    return banner;
  }

  function bindSettingsTriggers(root) {
    (root || document).querySelectorAll('[data-cookie-settings]').forEach(function (el) {
      if (el.getAttribute('data-cookie-settings-bound') === '1') return;
      el.setAttribute('data-cookie-settings-bound', '1');
      el.addEventListener('click', function (e) {
        e.preventDefault();
        openPreferences();
      });
    });
  }

  /* "Configurar cookies" junto al enlace de la política en cada footer. */
  function addFooterSettingsLink() {
    document.querySelectorAll('a[data-i18n="footer_cookies"]').forEach(function (link) {
      var next = link.nextElementSibling;
      if (next && next.classList && next.classList.contains('cookie-settings-link')) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cookie-settings-link';
      btn.setAttribute('data-cookie-settings', '');
      btn.textContent = t.settings;
      var parent = link.parentNode;
      parent.insertBefore(btn, link.nextSibling);
      parent.insertBefore(document.createTextNode(' · '), btn);
    });
  }

  window.EstarConsent = {
    open: openPreferences,
    granted: function () { return readChoice() === 'granted'; },
    choice: readChoice
  };

  function init() {
    addFooterSettingsLink();
    bindSettingsTriggers(document);
    var prior = readChoice();
    if (prior === 'granted') { applyConsent(true); return; }
    if (prior === 'denied') { applyConsent(false); return; }
    // No prior choice — keep consent denied (default) and show the banner.
    var banner = buildBanner(null);
    document.body.appendChild(banner);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
