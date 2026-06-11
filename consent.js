/* Cookie consent banner + Google Consent Mode v2 (A-7, auditoría 360°).
 *
 * The GA4 bootstrap (injected by build.js) sets consent DEFAULT = denied for
 * analytics/ads before any tag fires, so nothing is collected until the visitor
 * opts in here. On accept we call gtag('consent','update', granted...) and any
 * ad pixels (Meta / Google Ads, injected only when their IDs are configured)
 * are activated. Choice is remembered in localStorage. Strictest model: the
 * banner is shown to every visitor regardless of region until they choose.
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
      more: 'Más información',
      moreHref: '/cookies.html'
    },
    en: {
      text: 'We use cookies to analyze traffic and improve your experience. You can accept or reject them.',
      accept: 'Accept',
      reject: 'Reject',
      more: 'Learn more',
      moreHref: '/en/cookies.html'
    }
  };
  var t = COPY[lang];

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

  function buildBanner() {
    var banner = document.createElement('div');
    banner.className = 'cookie-consent';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-live', 'polite');
    banner.setAttribute('aria-label', lang === 'en' ? 'Cookie consent' : 'Consentimiento de cookies');

    var msg = document.createElement('p');
    msg.className = 'cookie-consent__text';
    msg.textContent = t.text + ' ';
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
      applyConsent(false); store('denied'); removeBanner(banner);
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

  function init() {
    var prior = readChoice();
    if (prior === 'granted') { applyConsent(true); return; }
    if (prior === 'denied') { applyConsent(false); return; }
    // No prior choice — keep consent denied (default) and show the banner.
    var banner = buildBanner();
    document.body.appendChild(banner);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
