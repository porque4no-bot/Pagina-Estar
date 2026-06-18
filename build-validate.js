/**
 * Build-time guard: enforce that the hand-written marketing pages keep their
 * apartment PRICES, AREA and CAPACITY in lockstep with the single source of
 * truth, `rooms_db.json`. The build FAILS on any drift, so stale/wrong
 * apartment data can never ship.
 *
 * Background: the 5 room DETAIL pages (clasica.html, …) are already generated
 * from rooms_db.json by build-rooms.js, so they cannot drift. But vivir.html
 * (and its English twin) embed the same prices/specs by hand — historically
 * marked "KEEP IN SYNC WITH rooms_db.json", i.e. synced manually. This guard
 * turns that manual promise into an enforced check.
 *
 * No template engine, pure string scanning — same convention as build-rooms.js.
 */
const fs = require('fs');
const path = require('path');

const onlyDigits = (s) => String(s).replace(/[^0-9]/g, '');

function roomsBySlug(db) {
  const out = {};
  for (const id of Object.keys(db)) out[db[id].id] = db[id];
  return out;
}

/** Map slug -> inner HTML of its <article ... data-typology="slug"> … </article>. */
function articlesByTypology(html) {
  const out = {};
  const re = /data-typology="([a-z]+)"([\s\S]*?)<\/article>/g;
  let m;
  while ((m = re.exec(html))) out[m[1]] = m[2];
  return out;
}

/** Extract the prices declared per slug inside the TYPOLOGY_DATA JS object
 *  (drives the dynamic tier table). Returns slug -> { es:[…], en:[…] } digits. */
function typologyDataPrices(html) {
  const out = {};
  const start = html.indexOf('TYPOLOGY_DATA');
  if (start < 0) return out;
  const region = html.slice(start);
  const re = /([a-z]+)\s*:\s*\{\s*prices\s*:\s*\{\s*es\s*:\s*\[([^\]]*)\][\s\S]*?en\s*:\s*\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(region))) {
    out[m[1]] = {
      es: (m[2].match(/[\d.,]+/g) || []).map(onlyDigits).filter(Boolean),
      en: (m[3].match(/[\d.,]+/g) || []).map(onlyDigits).filter(Boolean),
    };
  }
  return out;
}

function checkFile(filePath, label, bySlug, errors) {
  if (!fs.existsSync(filePath)) return;
  const html = fs.readFileSync(filePath, 'utf8');
  const articles = articlesByTypology(html);
  const tdPrices = typologyDataPrices(html);

  for (const slug of Object.keys(bySlug)) {
    const room = bySlug[slug];
    const dbAmts = room.page.pricing.tiers.map((t) => onlyDigits(t.amount));

    const block = articles[slug];
    if (!block) {
      errors.push(`${label}: missing room card for "${slug}" (data-typology)`);
    } else {
      // Card price grid: the 4 .rpg-amt values, in tier order.
      const amts = [...block.matchAll(/class="rpg-amt">([^<]+)</g)].map((x) => onlyDigits(x[1]));
      if (amts.length !== dbAmts.length || !dbAmts.every((d, i) => d === amts[i])) {
        errors.push(`${label}: "${slug}" card prices [${amts.join(', ')}] != rooms_db.json [${dbAmts.join(', ')}]`);
      }
      // Area (m²).
      const area = (block.match(/(\d+)\s*m²/) || [])[1];
      if (area && Number(area) !== room.area) {
        errors.push(`${label}: "${slug}" area ${area} m² != rooms_db.json ${room.area} m²`);
      }
      // Capacity (personas / people / guests).
      const cap = (block.match(/(\d+)\s*(?:personas|people|guests)/) || [])[1];
      if (cap && Number(cap) !== room.capacity) {
        errors.push(`${label}: "${slug}" capacity ${cap} != rooms_db.json ${room.capacity}`);
      }
    }

    // TYPOLOGY_DATA (dynamic tier table) prices, ES + EN, must match too.
    const td = tdPrices[slug];
    if (td) {
      for (const lang of ['es', 'en']) {
        const got = td[lang];
        if (got.length !== dbAmts.length || !dbAmts.every((d, i) => d === got[i])) {
          errors.push(`${label}: "${slug}" TYPOLOGY_DATA.${lang} [${got.join(', ')}] != rooms_db.json [${dbAmts.join(', ')}]`);
        }
      }
    }
  }
}

function validateMarketingData({ rootDir }) {
  const db = JSON.parse(fs.readFileSync(path.join(rootDir, 'rooms_db.json'), 'utf8'));
  const bySlug = roomsBySlug(db);
  const errors = [];
  checkFile(path.join(rootDir, 'vivir.html'), 'vivir.html', bySlug, errors);
  checkFile(path.join(rootDir, 'en', 'vivir.html'), 'en/vivir.html', bySlug, errors);
  if (errors.length) {
    throw new Error(
      'Apartment data drift vs rooms_db.json (the central source of truth):\n  - ' +
        errors.join('\n  - ') +
        '\nUpdate the page to match rooms_db.json, or update rooms_db.json itself.'
    );
  }
  console.log(`Validated marketing-page apartment data against rooms_db.json (${Object.keys(bySlug).length} rooms × 2 pages).`);
}

module.exports = { validateMarketingData };
