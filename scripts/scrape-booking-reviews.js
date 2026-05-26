/**
 * Scraper de reseñas Booking.com — Hotel Estar Apartaestudios (Manizales, CO)
 * Extrae todas las reseñas con puntaje >= 9.0
 *
 * Prerrequisitos (una sola vez):
 *   npm install -g playwright
 *   npx playwright install chromium
 *
 * Uso:
 *   node scripts/scrape-booking-reviews.js
 *
 * Salida: scripts/booking_reviews_9plus.json
 */

let playwright;
try {
  playwright = require('playwright');
} catch {
  try {
    playwright = require('/opt/node22/lib/node_modules/playwright');
  } catch {
    console.error('No se encontró playwright. Instálalo con:\n  npm install -g playwright && npx playwright install chromium');
    process.exit(1);
  }
}
const { chromium } = playwright;

const fs   = require('fs');
const path = require('path');

const HOTEL_PAGENAME = 'estar-apartaestudios';
const HOTEL_COUNTRY  = 'co';
const MIN_SCORE      = 9.0;
const ROWS_PER_PAGE  = 25;
const OUTPUT_FILE    = path.join(__dirname, 'booking_reviews_9plus.json');
const DEBUG_SHOT     = path.join(__dirname, 'debug_screenshot.png');

const REVIEW_LIST_BASE = `https://www.booking.com/reviewlist/hotel/${HOTEL_COUNTRY}/${HOTEL_PAGENAME}.html`;

async function scrapeAllReviews() {
  console.log('Iniciando navegador…');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'es-419',
    extraHTTPHeaders: { 'Accept-Language': 'es-419,es;q=0.9,en;q=0.8' }
  });

  const page = await context.newPage();

  // Primera carga: detectar estructura real y total de reseñas
  const firstUrl = buildUrl(0, 'f_recent_desc');
  console.log(`Cargando primera página…`);
  await page.goto(firstUrl, { waitUntil: 'networkidle', timeout: 90000 });

  // Screenshot de diagnóstico
  await page.screenshot({ path: DEBUG_SHOT, fullPage: false });
  console.log(`Screenshot guardado en: ${DEBUG_SHOT}`);

  // Detectar si Booking.com mostró un desafío
  const title = await page.title();
  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 200));
  console.log(`Título de página: "${title}"`);
  console.log(`Inicio del body: "${bodyText}"`);

  if (bodyText.toLowerCase().includes('captcha') || bodyText.toLowerCase().includes('robot') || bodyText.toLowerCase().includes('access denied')) {
    console.error('\nBooking.com detectó un bot (CAPTCHA/bloqueo). Prueba:\n  1. Ejecutar en headless: false para ver el navegador\n  2. Añadir cookies de sesión de tu navegador real');
    await browser.close();
    process.exit(1);
  }

  // Detectar total de reseñas
  const totalReviews = await getTotalReviews(page);
  console.log(`Total reseñas en la propiedad: ${totalReviews}`);

  // Detectar selectores reales (ayuda a adaptar el scraper)
  await detectSelectors(page);

  const allReviews = [];
  let offset = 0;
  let pageNum = 1;
  let consecutiveEmpty = 0;

  while (offset === 0 || (offset < totalReviews && consecutiveEmpty < 3)) {
    if (offset > 0) {
      const url = buildUrl(offset, 'f_recent_desc');
      process.stdout.write(`  Página ${pageNum} (offset ${offset})… `);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
      await page.waitForTimeout(1500);
    } else {
      process.stdout.write(`  Página 1 (offset 0)… `);
    }

    const reviews = await extractReviewsFromPage(page);
    console.log(`${reviews.length} reseñas`);

    if (reviews.length === 0) {
      consecutiveEmpty++;
    } else {
      consecutiveEmpty = 0;
      for (const r of reviews) allReviews.push(r);
    }

    offset += ROWS_PER_PAGE;
    pageNum++;

    if (offset < totalReviews && consecutiveEmpty < 3) {
      await page.waitForTimeout(1000 + Math.random() * 1000);
    }
  }

  if (consecutiveEmpty >= 3) {
    console.log(`\nDetuvo la paginación: 3 páginas consecutivas vacías.`);
  }

  await browser.close();

  // Filtrar puntaje >= MIN_SCORE
  const highScoreReviews = allReviews.filter(r => r.score >= MIN_SCORE);

  // Ordenar: mayor puntaje primero, luego más reciente primero
  highScoreReviews.sort((a, b) => b.score - a.score || b.date.localeCompare(a.date));

  console.log(`\n============================================`);
  console.log(`Total reseñas extraídas:          ${allReviews.length}`);
  console.log(`Reseñas con puntaje >= ${MIN_SCORE}:   ${highScoreReviews.length}`);
  console.log(`============================================\n`);

  if (allReviews.length === 0) {
    console.warn('ADVERTENCIA: No se extrajeron reseñas. Los selectores CSS de Booking.com pueden haber cambiado.');
    console.warn('Revisa el screenshot en:', DEBUG_SHOT);
    console.warn('Ajusta la función extractReviewsFromPage() con los selectores correctos.');
  }

  const output = {
    generatedAt: new Date().toISOString(),
    hotel: 'Hotel Estar Apartaestudios',
    source: 'Booking.com',
    minScore: MIN_SCORE,
    totalScraped: allReviews.length,
    count: highScoreReviews.length,
    reviews: highScoreReviews
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8');
  console.log(`Archivo guardado en: ${OUTPUT_FILE}`);

  return output;
}

function buildUrl(offset, sort) {
  const params = new URLSearchParams({
    aid:      '304142',
    type:     'total',
    pagename: HOTEL_PAGENAME,
    rows:     String(ROWS_PER_PAGE),
    offset:   String(offset),
    sort:     sort,
    lang:     'es'
  });
  return `${REVIEW_LIST_BASE}?${params.toString()}`;
}

async function getTotalReviews(page) {
  const num = await page.evaluate(() => {
    const candidates = [
      ...document.querySelectorAll('[data-testid="reviews-count"], .review-score-count, [class*="review_count"], [class*="reviewCount"], [class*="ReviewCount"]')
    ].map(el => el.textContent.trim());

    // Buscar en todo el texto visible
    const bodyText = document.body.innerText;
    const match = bodyText.match(/(\d[\d,.]+)\s*(reseñas?|opiniones?|reviews?)/i);
    if (match) {
      const n = parseInt(match[1].replace(/[^\d]/g, ''), 10);
      if (!isNaN(n) && n > 0) return n;
    }

    for (const t of candidates) {
      const n = parseInt(t.replace(/[^\d]/g, ''), 10);
      if (!isNaN(n) && n > 0) return n;
    }
    return 0;
  });

  return num > 0 ? num : 300; // fallback conservador
}

async function detectSelectors(page) {
  const found = await page.evaluate(() => {
    const results = {};
    const toTry = {
      reviewCards: [
        '[data-testid="review-card"]',
        '.c-review-block',
        '.review_list_new_item_block',
        '[class*="ReviewListItem"]',
        '[class*="review-item"]',
        '[class*="review_item"]',
        'article[class*="review"]'
      ],
      score: [
        '[data-testid="review-score"]',
        '.bui-review-score__badge',
        '[class*="score"]',
        '.c-score'
      ]
    };

    for (const [key, selectors] of Object.entries(toTry)) {
      for (const sel of selectors) {
        const count = document.querySelectorAll(sel).length;
        if (count > 0) {
          results[key] = { selector: sel, count };
          break;
        }
      }
    }
    return results;
  });

  if (Object.keys(found).length > 0) {
    console.log('Selectores detectados:', JSON.stringify(found, null, 2));
  } else {
    console.log('No se detectaron selectores conocidos. Puede ser que la página no cargó reseñas.');
    // Dump clases únicas para ayudar a ajustar
    const classes = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('[class]'));
      const set = new Set();
      all.forEach(el => el.className.toString().split(/\s+/).forEach(c => { if (c && c.toLowerCase().includes('review')) set.add(c); }));
      return Array.from(set).slice(0, 30);
    });
    console.log('Clases que contienen "review":', classes);
  }
}

async function extractReviewsFromPage(page) {
  return page.evaluate(() => {
    const reviews = [];

    // Intentar múltiples selectores de tarjeta de reseña
    const cardSelectors = [
      '[data-testid="review-card"]',
      '.c-review-block',
      '.review_list_new_item_block',
      '[class*="ReviewListItem"]',
      '[class*="review-item"]:not([class*="score"])',
      'article[class*="review"]',
      '[itemprop="review"]'
    ];

    let cards = [];
    for (const sel of cardSelectors) {
      cards = Array.from(document.querySelectorAll(sel));
      if (cards.length > 0) break;
    }

    cards.forEach(card => {
      try {
        // --- Puntaje ---
        let score = null;
        const scoreSelectors = [
          '[data-testid="review-score"]',
          '.bui-review-score__badge',
          '.review-score-badge',
          '[class*="score_badge"]',
          '[class*="ScoreBadge"]',
          '[class*="ReviewScore"]',
          '.c-score',
          '[itemprop="ratingValue"]'
        ];
        for (const sel of scoreSelectors) {
          const el = card.querySelector(sel);
          if (el) {
            const raw = el.getAttribute('content') || el.textContent;
            const val = parseFloat(raw.replace(',', '.').trim());
            if (!isNaN(val) && val > 0 && val <= 10) { score = val; break; }
          }
        }
        if (score === null) return;

        // --- Nombre ---
        let reviewer = '';
        for (const sel of [
          '[data-testid="review-author"]',
          '.bui-avatar-block__title',
          '[class*="reviewer_name"]',
          '[class*="ReviewerName"]',
          '[itemprop="author"]'
        ]) {
          const el = card.querySelector(sel);
          if (el) { reviewer = el.textContent.trim(); break; }
        }

        // --- País ---
        let country = '';
        for (const sel of [
          '[data-testid="review-author-country"]',
          '.bui-avatar-block__subtitle',
          '[class*="reviewer_country"]',
          '[class*="country"]'
        ]) {
          const el = card.querySelector(sel);
          if (el) { country = el.textContent.trim(); break; }
        }

        // --- Fecha ---
        let date = '';
        for (const sel of [
          '[data-testid="review-date"]',
          '.c-review-block__date',
          '[class*="review_date"]',
          '[class*="ReviewDate"]',
          'time'
        ]) {
          const el = card.querySelector(sel);
          if (el) { date = el.getAttribute('datetime') || el.textContent.trim(); break; }
        }

        // --- Título ---
        let title = '';
        for (const sel of [
          '[data-testid="review-title"]',
          '.c-review-block__title',
          '[class*="review_title"]',
          '[class*="ReviewTitle"]',
          '[itemprop="name"]'
        ]) {
          const el = card.querySelector(sel);
          if (el) { title = el.textContent.trim(); break; }
        }

        // --- Texto positivo ---
        let positive = '';
        for (const sel of [
          '[data-testid="review-positive-text"]',
          '.c-review__body--positive',
          '.review_pos .review_item_review_content',
          '[class*="review_pos"]',
          '[class*="positive"]'
        ]) {
          const el = card.querySelector(sel);
          if (el) { positive = el.textContent.trim().replace(/^Le\s+gustó:\s*/i, ''); break; }
        }

        // --- Texto negativo ---
        let negative = '';
        for (const sel of [
          '[data-testid="review-negative-text"]',
          '.c-review__body--negative',
          '.review_neg .review_item_review_content',
          '[class*="review_neg"]',
          '[class*="negative"]'
        ]) {
          const el = card.querySelector(sel);
          if (el) { negative = el.textContent.trim().replace(/^No\s+le\s+gustó:\s*/i, ''); break; }
        }

        // --- Habitación ---
        let roomType = '';
        for (const sel of [
          '[data-testid="review-room-type"]',
          '.review_list_new_item_room_name',
          '[class*="room_type"]',
          '[class*="RoomType"]'
        ]) {
          const el = card.querySelector(sel);
          if (el) { roomType = el.textContent.trim(); break; }
        }

        reviews.push({ score, reviewer, country, date, title, positive, negative, roomType });
      } catch (_) { /* ignorar */ }
    });

    return reviews;
  });
}

// --- Ejecutar ---
scrapeAllReviews().catch(err => {
  console.error('Error fatal:', err.message);
  process.exit(1);
});
