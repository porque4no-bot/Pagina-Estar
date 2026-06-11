# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Static multi-page website and direct booking engine for **Hotel Estar**, a boutique apartaestudio property in Manizales, Colombia. Deployed on Netlify. No framework — vanilla HTML/CSS with one compiled React component and Netlify serverless functions.

## Commands

```bash
# Build: copies static assets to dist/, inlines i18n, compiles motor-app.jsx → dist/motor-app.js
npm run build

# Dev: watch mode for motor-app.jsx only (recompiles to motor-app.js on save)
npm run dev

# Full validation: structural/backend tests plus Playwright desktop/mobile flows
npm test

# Individual test layers
npm run test:unit
npm run test:e2e
npm run test:smoke

# Local static server: serves the ROOT directory on port 3400
node server.js

# Local Netlify functions + static site on port 8888 (mock OTASync without .env)
npx netlify-cli dev --offline
```

Tests use Node's built-in test runner for structural/backend checks and Playwright for browser flows. The same suite runs in `.github/workflows/tests.yml` on pushes and pull requests. See `docs/testing.md` for the manual production matrix and release criteria.

There is no separate lint script; `npm run build` validates i18n key parity and structural checks run in unit tests.

## Architecture

### Pages

Root HTML pages (Spanish, canonical):

| Page | Purpose |
|---|---|
| `index.html` | Homepage |
| `reservar.html` | Booking engine (motor-app.jsx) |
| `guest.html` | Guest app (check-in, document upload, service requests) |
| `clasica.html` / `seleccion.html` / `reserva.html` / `origen.html` / `especial.html` | Room detail pages |
| `nosotros.html` / `contacto.html` / `explora.html` | Marketing pages |
| `vivir.html` | Extended stay |
| `empresas.html` | Corporate / cotizaciones |
| `grupos.html` | Group bookings |
| `trabaja.html` | Jobs |
| `faq.html` | FAQ |
| `cotizacion.html` | Corporate quote viewer |
| `cotizar-admin.html` | Admin: quote management (noindex) |
| `privacidad.html` / `aviso-legal.html` / `cancelacion.html` / `cookies.html` / `escnna.html` | Legal |
| `404.html` | Error page |

English versions live under `/en/` and mirror the Spanish structure.

### Frontend layers

Three JavaScript files load on most pages:

| File | Role |
|---|---|
| `shell.js` | Site-wide behaviors: header scroll state, mobile menu, scroll reveal (`[data-reveal]`), star cursor on hero, WhatsApp button |
| `kunas.js` | Booking bar date picker, room-link triggers (`.book-room-trigger[data-room="<slug>"]`), and the legacy bridge to the Kunas/OTASync engine URL |
| `motor-app.jsx` | Full booking engine as a React app (compiled by esbuild; React loaded via UMD CDN at runtime) |

`motor-app.jsx` is only loaded on `reservar.html`. All other pages load `kunas.js` (and `shell.js`). The booking bar on content pages navigates to `reservar.html`, where `motor-app.js` mounts and runs the four-step flow: room selection → extras → guest data → payment.

### Language switching

Pages use `.lang-es` / `.lang-en` HTML elements. At **build time**, `build.js` strips the opposite-language elements from each language variant (Spanish pages drop `.lang-en`, English pages drop `.lang-es`). `shell.js` handles runtime toggling only for pages served from root (not the `/en/` variants).

**Any text change must be mirrored in both languages:**
- HTML pages: update both the `.lang-es` and `.lang-en` elements
- `motor-app.jsx`: update both `es` and `en` keys inside `i18nEngine` (or the corresponding `/i18n/motor.*.json` files)
- `/i18n/` JSON files: update both `*.es.json` and `*.en.json` counterparts

### i18n files

Translation strings live in `/i18n/` and are **inlined at build time** into HTML (no runtime fetch):

| File pair | Scope |
|---|---|
| `i18n/motor.es.json` / `motor.en.json` | Booking engine (`motor-app.jsx`) |
| `i18n/shell.es.json` / `shell.en.json` | Site-wide nav, footer, booking bar |
| `i18n/guest.es.json` / `guest.en.json` | Guest app (check-in, contract, service requests) |

### Room data

`rooms_db.json` is the canonical source of room metadata. Keys are OTASync room type IDs:

| ID | Slug | Name |
|---|---|---|
| 31348 | clasica | Clásica |
| 31349 | seleccion | Selección |
| 31350 | reserva | Reserva |
| 31351 | origen | Origen |
| 31352 | especial | Especial |

This file is used both by the frontend (copied to `dist/`) and by the Netlify functions at runtime (via `included_files` in `netlify.toml`). Pricing and amenity changes go here first.

### Build process

`build.js` (Node, no framework):
1. Copies `assets/`, `fonts/`, `uploads/` to `dist/`
2. Copies specific files: `styles.css`, `colors_and_type.css`, `shell.js`, `kunas.js`, `rooms_db.json`, `favicon.png`, `datos_habitaciones_estar.csv`
3. Copies all `.html` files from root to `dist/`, **stripping bilingual elements** for each language variant
4. **Inlines i18n JSON** from `/i18n/` into HTML pages at build time (avoids extra HTTP requests)
5. **Generates CSP headers** with SHA-256 hashes for inline scripts (removes `unsafe-inline`)
6. Runs esbuild on `motor-app.jsx` → `dist/motor-app.js` (minified)

**Edit source files in the root, never in `dist/`.** The `dist/` directory is generated on every build and is gitignored.

### Booking engine (`motor-app.jsx`)

Four-step flow on `reservar.html`:

| Step | Key API calls | Notes |
|---|---|---|
| 1 — Room selection | `GET /api/check-availability` | 5 rooms, dual-rate picker (Flexible 10% refund vs Best Price 10% cheaper), image carousel, no-availability fallback |
| 2 — Extras | None | Breakfast ($20k/person/night), parking ($25k/night), late checkout ($60k), early check-in ($50k) |
| 3 — Guest data | None | Name, email, phone, country, travel motive, notes, privacy & ESCNNA checkboxes |
| 4 — Payment | `POST /api/create-wompi-signature`, `POST /api/booking-status` | IVA logic, Wompi widget, confirmation polling (up to 60s, 30 polls at 2s) |

Supporting components: `SearchBar`, `StepProgress`, `StepWrapper`, `BookingSummary`, `Confirmation`, `ManageBooking`, `PaymentReturnNotice`.

**IVA (19% VAT) logic:**
- Colombian residents or business travelers → charged at check-in
- Foreign tourists → preliminary exemption (validated on arrival)
- Functions: `isColombianGuest()`, `isBusinessGuest()`, `mustChargeIva()`

**Wompi reference encoding:** `1|YYMMDD|YYMMDD|guests|roomTypeId|firstName|lastName|email|phone|extrasMask|code|colombian|business` (pipe-delimited, base64).

**State persistence:** `sessionStorage` draft with 30-min TTL, cleared on booking success.

### Netlify functions (`netlify/functions/`)

All functions authenticate against OTASync via a cached session key (`pkey`, valid 30 min). When credentials are absent, functions fall back to mock/hardcoded responses so the site works locally without credentials.

API routes are rewritten: `/api/*` → `/.netlify/functions/:splat` (see `netlify.toml`).

**Core booking:**

| Function | Purpose |
|---|---|
| `check-availability` | Queries OTASync for available rooms and daily prices; merges with `rooms_db.json` metadata |
| `create-booking` | **RETIRED — returns 410.** Previously created the reservation from the client trusting client-supplied payment status (could create confirmed reservations without payment). The payment webhook is now the only reservation creator; kept as a 410 stub so any old integration fails loudly. |
| `booking-status` | Polls webhook confirmation status after payment (used by motor-app polling loop) |
| `send-confirmation` | Sends email confirmation to guest via Resend |
| `get-booking` | Retrieves a booking by reference code — **requires a second factor (email or surname)**; returns a uniform not-found on mismatch so an enumerated code alone discloses no PII |
| `get-booking-rating` | Fetches Booking.com rating via `PROXY_URL`; returns hardcoded fallback if unconfigured |
| `get-reviews` | Fetches property reviews |

**Payments:**

| Function | Purpose |
|---|---|
| `create-wompi-signature` | Generates HMAC integrity signature server-side for Wompi checkout |
| `wompi-webhook` | **Active** payment handler: validates signature, creates OTASync reservation; for `COT-...` references loads the quote, verifies amount, marks it `aceptada` |
| `reconcile-payments` | **Scheduled (every 30 min):** reconciles pending Wompi transactions, resolves stuck bookings |
| `create-mercadopago-preference` | **Rollback** Mercado Pago Checkout Pro preference creator |
| `mercadopago-webhook` | **Rollback** MP handler: validates signatures, creates/updates OTASync reservation via shared payment logic |

**Corporate quotes (cotizaciones):**

| Function | Purpose |
|---|---|
| `create-quote` / `update-quote` / `get-quote` / `list-quotes` | CRUD persisted in Netlify Blobs (`quotes` store). Create/edit blocked when rooms lack availability |
| `quote-availability` | Public re-check of a stored quote's room availability (called before opening Wompi) |
| `revalidate-quotes` | **Scheduled (every 6h):** re-checks active quotes, flags lost availability, releases holds on expired/cancelled quotes |
| `retry-quote-booking` | Manual retry mechanism for failed quote bookings |
| `request-quote` | Creates a quote from the public contact form |
| `send-quote-email` | Sends quote email with payment link |
| `read-quote-audit` | Audit log viewer for quote history |
| `otasync-webhook` | Receives OTASync webhooks; on `avail` changes re-validates affected active quotes |

**Guest app:**

| Function | Purpose |
|---|---|
| `guest-session` | Issues signed JWT session token (no OTASync credentials exposed to client) |
| `guest-checkin` | Document upload handler; optional Azure Document Intelligence OCR; multi-occupant support |
| `guest-action` | Guest requests: extras, modifications, cancellations |
| `guest-sync` | Receives guest events, stores AES-256-GCM encrypted in Blobs |
| `guest-drive` | Forwards documents/data to Google Drive via Apps Script |
| `upload-drive-credentials` | Service account credential upload (admin) |
| `drive-probe` | Health check for Google Drive integration |

**Shared modules (prefixed `_`, not HTTP-callable):**

| Module | Purpose |
|---|---|
| `_otasync` | OTASync auth + session caching, availability lookup, room holds (`createHold`), reservation CRUD |
| `_quotes-store` | Quote persistence, tax math (IVA 19%, INC 8%), hold management |
| `_payments` | Payment status tracking, webhook event logging |
| `_email` | Email template rendering (Resend) |
| `_guest-app` | Guest app utilities: token verification, data encryption/decryption |
| `_contract-template` | PDF contract template for guest check-in |
| `_pdf-render` | PDFKit server-side PDF rendering |
| `_quote-audit` | Audit log storage and retrieval |
| `_google-drive` | Google Drive API integration (service account) |
| `_firebase-auth` | Firebase authentication for admin pages |
| `_rate-limit` | Request rate limiting |

**OTASync/Kunas API reference:** `docs/kunas-api.md`. OTASync supports native webhooks (`reservation` insert/edit/cancel, `avail` edit, `prices`, `restrictions`) and a `reservation/delete/reservation` endpoint to release quote holds.

**Quote availability & holds:** Quotes can optionally place a tentative hold in OTASync (`bloquearHabitaciones`) via `_otasync.createHold`; held rooms are guaranteed so availability checks are skipped. Holds are released on cancel, on expiry (cron), and converted to a confirmed reservation on payment. Hold status is configurable via `OTASYNC_HOLD_STATUS` (default `tentative`).

### Guest app (`guest.html`)

Multi-phase check-in system with document upload, OCR, and service requests:

- **Session:** Signed JWT from `guest-session`, no OTASync credentials exposed
- **Document upload:** Optional Azure Document Intelligence OCR (`prebuilt-idDocument` model); graceful fallback when OCR is unavailable
- **Multi-guest:** Supports N occupants per reservation, each with their own document
- **Persistence:** Guest data stored AES-256-GCM encrypted in Netlify Blobs
- **Archival:** Documents forwarded to Google Drive via Apps Script (`GOOGLE_DRIVE_APPS_SCRIPT_URL`)
- **Demo mode:** Works without OTASync credentials when `GUEST_APP_DEMO_MODE` is unset in non-production

See `docs/guest-app.md` for implementation details.

### Scheduled functions

| Function | Schedule | Purpose |
|---|---|---|
| `revalidate-quotes` | `0 */6 * * *` | Re-checks all active quote availability every 6 hours |
| `reconcile-payments` | `*/30 * * * *` | Reconciles pending Wompi transactions every 30 minutes — covers **both** corporate quotes and direct bookings (missing `booking-results` entry ⇒ paid-but-no-reservation alert) |
| `purge-guest-data` | `30 3 * * *` | Data-retention purge (Ley 1581): deletes guest PII (check-ins, documents, events) older than **5 years**, dated from the timestamp embedded in the blob key |

## CSS conventions

Design tokens live in `colors_and_type.css` and are consumed by `styles.css`. Never use raw color values — always reference tokens.

**Key token groups:**
- Colors: `--olive`, `--sand`, `--terracotta`, `--ink`, `--paper`, `--white` (each with `-700`/`-300`/`-100` variants)
- Semantic surfaces: `--bg`, `--fg`, `--border`, `--bg-brand`, `--fg-muted`, etc.
- Spacing: `--space-1` (4px) through `--space-10` (128px) on a 4-pt grid
- Type families: `--font-display`, `--font-heading`, `--font-body`, `--font-label`

**Utility type classes** (use these instead of custom font rules):
`.t-display`, `.t-h1` – `.t-h4`, `.t-body`, `.t-body-sm`, `.t-lead`, `.t-label`, `.t-eyebrow`, `.t-price`, `.t-quote`, `.t-link`

**Scroll reveal:** add `data-reveal` attribute to any element; `shell.js` uses IntersectionObserver to add `is-visible` when it enters the viewport.

## Environment variables

For local development, create a `.env` file at the project root (gitignored). Copy `.env.example` as a starting point. Without credentials, functions return mock OTASync data (`isMock: true`), which is enough for the full booking flow through the Wompi payment step.

**OTASync / PMS:**
```
OTASYNC_TOKEN=
OTASYNC_USERNAME=
OTASYNC_PASSWORD=
OTASYNC_PROPERTY_ID=9889
OTASYNC_CHANNEL_ID=
OTASYNC_CHANNEL_NAME=
OTASYNC_HOLD_STATUS=tentative
OTASYNC_WEBHOOK_SECRET=
```

**Wompi (active payment provider):**
```
PAYMENT_PROVIDER=wompi
WOMPI_PUBLIC_KEY=
WOMPI_PRIVATE_KEY=
WOMPI_INTEGRITY_SECRET=
WOMPI_WEBHOOK_SECRET=
WOMPI_SANDBOX=
```

**Mercado Pago (rollback — activate by setting `PAYMENT_PROVIDER=mercadopago`):**
```
MERCADOPAGO_ACCESS_TOKEN=
MERCADOPAGO_WEBHOOK_SECRET=
MERCADOPAGO_CHECKOUT_MODE=
MERCADOPAGO_SUCCESS_URL=
MERCADOPAGO_PENDING_URL=
MERCADOPAGO_FAILURE_URL=
```

**Email (Resend):**
```
RESEND_API_KEY=
ADMIN_EMAILS=
ADMIN_NOTIFY_EMAIL=
```

**Guest app:**
```
GUEST_APP_TOKEN_SECRET=
GUEST_APP_DATA_ENCRYPTION_KEY=
GUEST_APP_STORE_DOCUMENTS=
GUEST_APP_DEMO_MODE=
GUEST_APP_SYNC_WEBHOOK_URL=
GUEST_APP_SYNC_WEBHOOK_SECRET=
GUEST_APP_DRIVE_WEBHOOK_URL=
GUEST_APP_DRIVE_WEBHOOK_SECRET=
GUEST_SERVICE_PAYMENT_MODE=
GUEST_SERVICE_PAYMENT_URL=
```

**Azure Document Intelligence (OCR):**
```
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=
AZURE_DOCUMENT_INTELLIGENCE_KEY=
AZURE_DOCUMENT_INTELLIGENCE_MODEL_ID=prebuilt-idDocument
AZURE_DOCUMENT_INTELLIGENCE_API_VERSION=
```

**Google Drive integration:**
```
GOOGLE_SERVICE_ACCOUNT_JSON=
GOOGLE_DRIVE_FOLDER_ID=
GOOGLE_DRIVE_APPS_SCRIPT_URL=
GOOGLE_DRIVE_APPS_SCRIPT_SECRET=
```

**Netlify Blobs (auto-set in Netlify, needed locally for quotes):**
```
NETLIFY_BLOBS_TOKEN=
NETLIFY_SITE_ID=
BLOBS_SITE_ID=
BLOBS_TOKEN=
```

**Analytics / Marketing (optional):**
```
GA4_MEASUREMENT_ID=    # enables server-side purchase tracking (Measurement Protocol)
GA4_API_SECRET=        # GA4 Admin → Data Streams → Measurement Protocol API secrets
META_PIXEL_ID=         # when set, build.js injects the consent-gated Meta Pixel
GOOGLE_ADS_ID=         # when set, build.js injects the Google Ads tag (AW-...)
```
GA4 on-page tracking and Consent Mode v2 are injected by `build.js`. `consent.js`
renders the cookie banner and flips Consent Mode to granted only on opt-in
(analytics/ads default to **denied** for every visitor). Ad pixels are emitted
into the build **only** when their IDs are configured.

**Misc:**
```
ALLOWED_ORIGIN=http://localhost:8888
PROXY_URL=
DEBUG=
```

**Wompi configuration notes:**
- Register Wompi events against `/api/wompi-webhook`; use the Wompi events secret as `WOMPI_WEBHOOK_SECRET`
- Set `WOMPI_INTEGRITY_SECRET` from "Desarrolladores > Secretos para integración técnica"; used server-side by `create-wompi-signature`
- Sandbox keys have a `pub_test_` prefix — the booking engine shows a "TEST MODE" banner when detected
