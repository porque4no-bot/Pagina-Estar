/* Genera la versión en inglés de la guest app (dist/en/guest.html) a partir del
   guest.html bilingüe (pares .lang-es / .lang-en) ya copiado a dist con GA4 y el
   skip-link inyectados. Función pura (string → string) para poder probarla.

   - <html lang="en">: guest-app.js elige el diccionario inglés por este atributo.
   - <title> y meta description en inglés.
   - Rutas relativas de assets/CSS/JS suben un nivel (la página vive en /en/).
     Los enlaces a páginas (index.html, privacidad.html, explora.html) quedan
     relativos a propósito: resuelven a sus gemelas /en/.
   - El skip-link inyectado en español se traduce (no se re-inyecta).
   La eliminación de los .lang-es la hace el paso de strip de build.js. */

const EN_TITLE = 'My stay · estar';
const EN_DESCRIPTION = 'Estar guest app to manage your booking, complete the check-in and request services during your stay.';

function buildEnglishGuestHtml(html) {
  let out = String(html || '');
  out = out.replace(/<html lang="es">/, '<html lang="en">');
  out = out.replace(/<title>[^<]*<\/title>/, `<title>${EN_TITLE}</title>`);
  out = out.replace(
    /<meta name="description" content="[^"]*">/,
    `<meta name="description" content="${EN_DESCRIPTION}">`
  );
  out = out.replace(/\b(href|src)="assets\//g, '$1="../assets/');
  out = out.replace(/\bhref="(colors_and_type\.css|styles\.css|guest-app\.css)/g, 'href="../$1');
  out = out.replace(/\bsrc="guest-app\.js/g, 'src="../guest-app.js');
  out = out.replace('>Saltar al contenido principal<', '>Skip to main content<');
  return out;
}

module.exports = { buildEnglishGuestHtml, EN_TITLE, EN_DESCRIPTION };
