/**
 * Room page generator.
 *
 * Reads `_room-template.es.html` and `_room-template.en.html`, drives
 * substitution from the per-room `page` block in `rooms_db.json`, and writes
 * 10 fully-formed HTML files (5 ES + 5 EN) into the target directory.
 *
 * Substitution syntax (intentionally minimal — no template engine):
 *   {{key.path}}                 — direct text substitution from the room data
 *   {{slidesEs|slidesEn|...}}    — pre-rendered HTML chunks supplied by the
 *                                  renderer (slider slides, indicators,
 *                                  amenity <li>s, pricing tiers, etc.)
 *
 * Why this is hand-rolled: per project conventions, no template-engine
 * dependency is allowed and the placeholder syntax stays grep-friendly.
 */

const fs = require('fs');
const path = require('path');

/** URL-encode a room display name for WhatsApp deep links, preserving
 * the same encoding the hand-written source files used (`%20`, `%C3%A1`, …). */
function whatsappRoomToken(name) {
  // Strip trailing period (hero name has it for headline only).
  const clean = String(name || '').replace(/\.$/, '');
  return encodeURIComponent(clean).replace(/'/g, '%27');
}

/** Resolve a dotted key (`seo.title.es`) against a nested object. */
function pick(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

/** Replace every `{{key.path}}` token in `tpl` using `data`. Tokens whose
 * value is `undefined`/`null` are replaced with the empty string so the
 * output stays clean.  HTML-allowed strings (descriptions, h2s) pass through
 * verbatim — the data already contains the markup we want. */
function substitute(tpl, data) {
  return tpl.replace(/\{\{([a-zA-Z0-9_.]+)\}\}/g, (_, key) => {
    const v = pick(data, key);
    return v == null ? '' : String(v);
  });
}

/** Build slider <div class="slider-slide">… images and matching indicators
 * for ES (uses srcset/sizes, ES alt text) or EN (simpler alt + no srcset). */
function renderSlides(images, roomName, lang) {
  const isEs = lang === 'es';
  const indent = '              ';
  const slides = images.map((src, i) => {
    const fullSrc = isEs ? src : `../${src}`;
    const alt = isEs
      ? `${roomName} - Vista ${i + 1}`
      : `${roomName} - View ${i + 1}`;
    if (isEs) {
      return `${indent}<div class="slider-slide"><img src="${fullSrc}" srcset="${fullSrc} 800w" sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 700px" alt="${alt}" loading="lazy" width="800" height="600"></div>`;
    }
    return `${indent}<div class="slider-slide"><img src="${fullSrc}" alt="${alt}" loading="lazy" width="800" height="600"></div>`;
  });

  const indIndent = '            ';
  const indicators = images.map((_, i) =>
    `${indIndent}<span class="indicator${i === 0 ? ' active' : ''}" data-slide="${i}"></span>`
  );

  return { slides: slides.join('\n'), indicators: indicators.join('\n') };
}

/** Render the amenity <li>s.
 *  - ES file inlines both languages via `<span class="lang-es">…</span><span class="lang-en">…</span>`.
 *  - EN file lists English text only.
 *  The `TV Cable` row is special-cased to use a single bare `<span>` (no
 *  language toggles) because that label is identical in both languages —
 *  this matches the original source format exactly.
 */
function renderAmenitiesEs(items) {
  const indent = '            ';
  return items.map(a => {
    const liOpen = `${indent}<li style="display: flex; align-items: center; gap: 8px;"><i data-lucide="${a.icon}" style="width: 16px; color: var(--terracotta);"></i> `;
    if (a.l_es === a.l_en) {
      return `${liOpen}<span>${a.l_es}</span></li>`;
    }
    return `${liOpen}<span class="lang-es" lang="es">${a.l_es}</span><span class="lang-en" lang="en">${a.l_en}</span></li>`;
  }).join('\n');
}

function renderAmenitiesEn(items) {
  const indent = '            ';
  return items.map(a =>
    `${indent}<li style="display: flex; align-items: center; gap: 8px;"><i data-lucide="${a.icon}" style="width: 16px; color: var(--terracotta);"></i> ${a.l}</li>`
  ).join('\n');
}

const TIER_LABELS = [
  { es: '1 — 2 meses', en: '1 — 2 months' },
  { es: '3 — 5 meses', en: '3 — 5 months' },
  { es: '6 — 11 meses', en: '6 — 11 months' },
  { es: '12 meses o más', en: '12 months or more' },
];

function renderTiersEs(tiers) {
  const parts = [];
  tiers.forEach((t, i) => {
    const cls = t.featured ? 'tier featured' : 'tier';
    const dur = TIER_LABELS[i] || { es: '', en: '' };
    parts.push(
`      <!-- Tier ${i + 1} -->
      <div class="${cls}">
        <span class="dur">
          <span class="lang-es" lang="es">${dur.es}</span>
          <span class="lang-en" lang="en">${dur.en}</span>
        </span>
        <span class="amount">
          <span>${t.amount}</span>
        </span>
        <span class="per">
          <span class="lang-es" lang="es">/ mes, todo incluido</span>
          <span class="lang-en" lang="en">/ month, all inclusive</span>
        </span>
        <span class="save">
          <span class="lang-es" lang="es">${t.save.es}</span>
          <span class="lang-en" lang="en">${t.save.en}</span>
        </span>
      </div>`
    );
  });
  // Source files separate tiers with a single blank line; preserve that.
  return parts.join('\n      \n');
}

function renderTiersEn(tiers) {
  const parts = [];
  tiers.forEach((t, i) => {
    const cls = t.featured ? 'tier featured' : 'tier';
    const dur = TIER_LABELS[i] || { es: '', en: '' };
    parts.push(
`      <!-- Tier ${i + 1} -->
      <div class="${cls}">
        <span class="dur">${dur.en}</span>
        <span class="amount"><span>${t.amount}</span></span>
        <span class="per">/ month, all inclusive</span>
        <span class="save">${t.save.en}</span>
      </div>`
    );
  });
  return parts.join('\n\n');
}

/** Render one room page (lang = 'es' or 'en'). Returns the final HTML. */
function renderRoomPage(template, room, lang) {
  const page = room.page;
  if (!page) {
    throw new Error(`Room ${room.id} is missing the required \`page\` block in rooms_db.json`);
  }

  const slides = renderSlides(page.sliderImages || room.gallery || [], room.name, lang);
  const amenitiesList = lang === 'es'
    ? renderAmenitiesEs(page.detail.amenities.es)
    : renderAmenitiesEn(page.detail.amenities.en);
  const tiersHtml = lang === 'es'
    ? renderTiersEs(page.pricing.tiers)
    : renderTiersEn(page.pricing.tiers);

  // The pricing tier rendering passes through ES placeholders that the
  // language file expects.  The EN template uses {{tiersEn}}, the ES template
  // uses {{tiersEs}}; we pass both keys so the substitution engine picks the
  // one referenced by the template.
  const data = {
    ...page,
    slug: room.id,
    roomTypeId: room.roomTypeId || '',
    num: room.num,
    name: room.name,
    nameUrlEncoded: whatsappRoomToken(room.name),
    bodyExtraAttrsSpaced: page.bodyExtraAttrs ? ' ' + page.bodyExtraAttrs : '',
    slidesEs: slides.slides,
    slidesEn: slides.slides,
    indicatorsEs: slides.indicators,
    indicatorsEn: slides.indicators,
    amenitiesEs: amenitiesList,
    amenitiesEn: amenitiesList,
    tiersEs: tiersHtml,
    tiersEn: tiersHtml,
  };

  return substitute(template, data);
}

/** Generate all 10 room HTML files into the given directory tree.
 * Writes ES files at `<targetDir>/<slug>.html` and EN files at
 * `<targetDir>/en/<slug>.html`. Creates `en/` if missing.
 */
function generateRoomPages({ rootDir, targetDir }) {
  const dbPath = path.join(rootDir, 'rooms_db.json');
  const tplEsPath = path.join(rootDir, '_room-template.es.html');
  const tplEnPath = path.join(rootDir, '_room-template.en.html');

  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const tplEs = fs.readFileSync(tplEsPath, 'utf8');
  const tplEn = fs.readFileSync(tplEnPath, 'utf8');

  const enDir = path.join(targetDir, 'en');
  if (!fs.existsSync(enDir)) fs.mkdirSync(enDir, { recursive: true });

  const slugs = [];
  for (const [id, room] of Object.entries(db)) {
    if (!room.page) continue;
    const slug = room.id;
    slugs.push(slug);
    // Pass roomTypeId so the template can reference {{roomTypeId}} (used by
    // the sold-out check script to match the OTASync id_room_types field).
    const roomWithTypeId = { ...room, roomTypeId: id };
    const htmlEs = renderRoomPage(tplEs, roomWithTypeId, 'es');
    const htmlEn = renderRoomPage(tplEn, roomWithTypeId, 'en');
    fs.writeFileSync(path.join(targetDir, `${slug}.html`), htmlEs);
    fs.writeFileSync(path.join(enDir, `${slug}.html`), htmlEn);
  }
  return slugs;
}

module.exports = { generateRoomPages, renderRoomPage };

// Allow running as a standalone script for development: writes back into
// the source tree alongside the live HTMLs (handy for manual inspection).
if (require.main === module) {
  const rootDir = __dirname;
  const targetDir = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(rootDir, 'dist');
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
  const slugs = generateRoomPages({ rootDir, targetDir });
  console.log(`Generated ${slugs.length * 2} room pages into ${targetDir}: ${slugs.join(', ')}`);
}
