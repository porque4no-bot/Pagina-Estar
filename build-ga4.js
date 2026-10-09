/* GA4 en el build (Frente site, oct-2026): qué páginas NO llevan analítica y
   cómo se limpia la URL que se le reporta a Google.

   1. Páginas excluidas: las que abren con un token o un código en la URL
      (cotización, datos de cuenta para reembolso, pase de desayuno), las del
      huésped/portal y los paneles internos del personal. Ninguna es una página
      de marketing y en todas la URL o el contenido puede llevar datos
      personales: no se les inyecta gtag.js, ni Consent Mode, ni el banner.

   2. URL limpia: Google Analytics recibe por defecto la URL completa
      (page_location) y la página anterior (page_referrer). Al volver de Mercado
      Pago, reservar.html trae `external_reference=MPDIR-…` (nombre, correo y
      teléfono en base64) y otros ids de pago; y el referrer interno puede traer
      el token de una página privada. Antes de configurar GA4 se reemplazan por
      una versión con SOLO los parámetros de la lista blanca (atribución de
      campañas + la búsqueda del motor, sin datos personales) y sin #hash.

   `cleanAnalyticsUrl` se inyecta en la página con Function#toString, así que
   debe quedarse en ES5 puro y sin dependencias (lo prueba
   tests/unit/ga4-build.test.js). */

const path = require('path');

const GA4_EXCLUDED_PAGES = new Set([
  'cotizacion.html',     // cotización corporativa (?id=…&token=…)
  'datos-cuenta.html',   // datos bancarios para reembolso (token) — ES y EN
  'pase-desayuno.html',  // pase de desayuno del huésped (código de reserva)
  'guest.html',          // app del huésped (check-in, documentos)
  'cotizar-admin.html',  // /admin
  'aseo.html',           // control de aseo (personal)
  'portal.html'          // Portal Estar (empresas / residentes) — ES y EN
]);

/* desayuno.html, desayuno-admin.html y cualquier variante futura del panel. */
const GA4_EXCLUDED_PATTERN = /^desayuno.*\.html$/;

function isGa4Excluded(fileName) {
  const base = path.basename(String(fileName || '')).toLowerCase();
  return GA4_EXCLUDED_PAGES.has(base) || GA4_EXCLUDED_PATTERN.test(base);
}

/* Parámetros que pueden llegar a GA4: UTM/ids de clic de campañas y la búsqueda
   del motor (fechas, huéspedes, tipología, estado del pago). Nada más. */
const ANALYTICS_QUERY_ALLOWLIST_SOURCE =
  '^(utm_[a-z0-9_]+|gclid|gbraid|wbraid|dclid|fbclid|msclkid|checkin|checkout|guests|room|payment)$';

function cleanAnalyticsUrl(href, base, keep) {
  try {
    var u = new URL(href, base);
    var out = [];
    u.searchParams.forEach(function (value, key) {
      if (keep.test(key)) out.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
    });
    return u.origin + u.pathname + (out.length ? '?' + out.join('&') : '');
  } catch (e) {
    try { return location.origin + location.pathname; } catch (e2) { return ''; }
  }
}

/* Bloque inline que fija page_location/page_referrer limpios y luego configura
   GA4 (y Google Ads si hay ID). Va DESPUÉS del consent default y de gtag('js'). */
function ga4ConfigScript(ga4Id, googleAdsId) {
  return (
    `  (function(){var keep=new RegExp(${JSON.stringify(ANALYTICS_QUERY_ALLOWLIST_SOURCE)},'i');` +
    `var clean=${cleanAnalyticsUrl.toString().replace(/\s*\n\s*/g, ' ')};` +
    `var p={page_location:clean(location.href,location.href,keep)};` +
    `if(document.referrer){p.page_referrer=clean(document.referrer,location.href,keep);}` +
    `gtag('set',p);var c={anonymize_ip:true};for(var k in p){c[k]=p[k];}` +
    `gtag('config','${ga4Id}',c);` +
    (googleAdsId ? `gtag('config','${googleAdsId}');` : '') +
    `})();\n`
  );
}

/* Meta Pixel: fbq no deja reemplazar la URL que reporta (dl = location.href,
   rl = document.referrer). Si la URL o el referrer traen algún parámetro
   fuera de la lista blanca (p. ej. external_reference=MPDIR-… al volver de
   Mercado Pago, o el token de una página privada) o un #hash con datos, el
   píxel NO se carga en esa vista: se pierde un PageView, nunca se le envía un
   dato personal a Meta. ES5 puro (se inyecta con Function#toString). */
function analyticsUrlIsClean(href, base, keep) {
  try {
    var u = new URL(href, base);
    var ok = true;
    u.searchParams.forEach(function (value, key) {
      if (!keep.test(key)) ok = false;
    });
    if (u.hash && u.hash.indexOf('=') !== -1) ok = false;
    return ok;
  } catch (e) {
    return false;
  }
}

function metaPixelScript(pixelId) {
  return (
    `<script>\n` +
    `(function(){var keep=new RegExp(${JSON.stringify(ANALYTICS_QUERY_ALLOWLIST_SOURCE)},'i');` +
    `var isClean=${analyticsUrlIsClean.toString().replace(/\s*\n\s*/g, ' ')};` +
    `if(!isClean(location.href,location.href,keep))return;` +
    `if(document.referrer&&!isClean(document.referrer,location.href,keep))return;\n` +
    `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?` +
    `n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;` +
    `n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;` +
    `t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}` +
    `(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');\n` +
    `fbq('consent','revoke');\n` +
    `fbq('init','${pixelId}');\n` +
    `fbq('track','PageView');\n` +
    `})();\n` +
    `</script>`
  );
}

module.exports = {
  GA4_EXCLUDED_PAGES,
  isGa4Excluded,
  ANALYTICS_QUERY_ALLOWLIST_SOURCE,
  cleanAnalyticsUrl,
  analyticsUrlIsClean,
  ga4ConfigScript,
  metaPixelScript
};
