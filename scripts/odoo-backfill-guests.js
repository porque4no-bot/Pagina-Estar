#!/usr/bin/env node
/* Backfill de huéspedes de OTASync/Kunas → maestro de clientes de Odoo (Fase 1).

   Recorre `guests/data/guests` (paginado), filtra los reales (email válido, no
   borrados, no fusionados) y los crea/actualiza como partner (persona) en Odoo
   vía el mismo `upsertPartner` de la web (dedup por email, empresa = Mirada por
   ODOO_COMPANY_ID, etiqueta "Huésped histórico").

   SEGURO POR DEFECTO: corre en DRY RUN (no escribe nada). Para importar de verdad
   hay que pasar --commit explícitamente.

   Uso (Node 18+):
     node --env-file=.env scripts/odoo-backfill-guests.js            # dry run
     node --env-file=.env scripts/odoo-backfill-guests.js --commit   # importa
*/

const otasync = require('../netlify/functions/_otasync');
const odoo = require('../netlify/functions/_odoo');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COMMIT = process.argv.includes('--commit');
const DFROM = '2015-01-01';
const DTO = '2027-12-31';

function isImportable(g) {
  if (String(g.is_deleted) === '1') return false;
  if (g.merged_to_guest != null && g.merged_to_guest !== '') return false;
  return EMAIL_RE.test(String(g.email || '').trim());
}

async function fetchGuestsPage(creds, pkey, page) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch('https://app.otasync.me/api/guests/data/guests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: creds.token, key: pkey, id_properties: parseInt(creds.propertyId, 10),
        page, dfrom: DFROM, dto: DTO
      }),
      signal: ctrl.signal
    });
    clearTimeout(tid);
    if (!r.ok) throw new Error('guests/data/guests HTTP ' + r.status);
    return await r.json();
  } catch (e) {
    clearTimeout(tid);
    throw e;
  }
}

async function main() {
  console.log('─'.repeat(60));
  console.log('Backfill huéspedes OTASync → Odoo —', COMMIT ? 'MODO COMMIT (ESCRIBE en Odoo)' : 'DRY RUN (no escribe)');
  console.log('─'.repeat(60));

  if (!otasync.hasOtasyncCreds()) { console.error('❌ Faltan credenciales OTASync.'); process.exit(1); }
  if (COMMIT && !odoo.isConfigured()) { console.error('❌ Faltan credenciales Odoo (no se puede commitear).'); process.exit(1); }

  const creds = otasync.otasyncCreds();
  const pkey = await otasync.getSessionKey();

  let page = 1, totalPages = 1;
  let seen = 0, importable = 0, created = 0, updated = 0, skipped = 0, errors = 0;

  do {
    const j = await fetchGuestsPage(creds, pkey, page);
    totalPages = parseInt(j.total_pages_number, 10) || totalPages;
    for (const g of (j.guests || [])) {
      seen++;
      if (!isImportable(g)) { skipped++; continue; }
      importable++;
      if (!COMMIT) continue;
      try {
        const name = `${g.first_name || ''} ${g.last_name || ''}`.trim() || g.email;
        const r = await odoo.upsertPartner({
          name, email: g.email, phone: g.phone, isCompany: false,
          tags: ['Huésped histórico'],
          comment: `Importado de Kunas/OTASync (id_guests ${g.id_guests}, canal ${g.id_channels || '-'}, país ${g.country || '-'}).`
        });
        if (r.created) created++; else updated++;
      } catch (e) {
        errors++;
        console.error('  ❌ error upsert id_guests', g.id_guests, '-', e.message);
      }
    }
    console.log(`  página ${page}/${totalPages} procesada (acumulado: ${importable} importables)`);
    page++;
  } while (page <= totalPages);

  console.log('─'.repeat(60));
  console.log('Vistos:', seen, '| importables:', importable, '| omitidos (sin email/borrados/fusionados):', skipped);
  if (COMMIT) console.log('Creados:', created, '| actualizados:', updated, '| errores:', errors);
  else console.log(`(DRY RUN — nada escrito. Corre con --commit para importar los ${importable} importables.)`);
  console.log('─'.repeat(60));
}

main().catch(e => { console.error('Error inesperado:', e.message); process.exit(1); });
