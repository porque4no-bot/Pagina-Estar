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
| `cotizar-admin.html` | Admin panel — served at **`/admin`** (rewrite). Tabs: **Hoy** (day board, `staff-today`), quotes, refunds, and **breakfast** (embeds `desayuno-admin.html` in an iframe), códigos, usuarios, configuración. noindex |
| `desayuno.html` | Staff: breakfast-pass verifier — scan/lookup a reservation, mark breakfast served, + cycle/day served counts (noindex) |
| `desayuno-admin.html` | Admin: breakfast money analytics + day board ("día de desayunos") + per-reservation lookup with courtesy action (noindex). Embedded as the **Desayunos** tab of `/admin`; `/desayuno-admin` redirects there |
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
| 1 — Room selection | `GET /api/check-availability` | 5 rooms, dual-rate picker (Estricta = base, free cancel 7 days before · Flexible = +10%, free cancel 24h before), image carousel, no-availability fallback |
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
| `request-cancellation` | Records a guest cancellation request (same second-factor gate as `get-booking`), alerts the hotel team and acknowledges the guest by email. Does not auto-cancel at request time — the cancellation loop closes at the admin gate (`refund-admin-action` approve/deny → `_otasync.cancelReservation`, gated `OTASYNC_AUTO_CANCEL_ENABLED`) |
| `staff-today` | **Staff App v1 (read-only):** day board for reception — arrivals/departures/in-house roster (via `_otasync.getReservationsByDate`) + pending-refunds queue (only if the caller has `refunds.view`). Auth `guests.checkin.view`. Backs the **Hoy** tab in `/admin` |
| `staff-ops` | **Staff App v2:** actionable ops-task queue (replaces the email inbox as the operational mechanism). GET lists open tasks (`guests.checkin.view`); POST `resolve`; POST `retry-folio` (reloads the encrypted guest-event, re-posts to the Kunas folio via `postOrderExtrasToFolio`, marks it `posted`, resolves the task — gated `GUEST_SERVICE_FOLIO_ENABLED` + `guests.register`). Backs the **Tareas pendientes** section of the Hoy tab |
| `get-booking-rating` | Fetches Booking.com rating via `PROXY_URL`; returns hardcoded fallback if unconfigured |
| `get-reviews` | Fetches property reviews |

**Payments:**

| Function | Purpose |
|---|---|
| `create-wompi-signature` | Generates HMAC integrity signature server-side for Wompi checkout; applies a validated discount code server-side when `DISCOUNT_CODES_ENABLED` |
| `wompi-webhook` | **Active** payment handler: validates signature, creates OTASync reservation; for `COT-...` references loads the quote, verifies amount, marks it `aceptada`. Derives the rate plan (Estricta/Flexible) **server-side from the amount actually paid** (not the client-controlled reference field), records it on the reservation, and snapshots refund fields via `_payment-details` |
| `reconcile-payments` | **Scheduled (every 30 min):** reconciles paid-but-no-reservation orphans for **both Wompi and Mercado Pago** (MP block gated by `PAYMENT_PROVIDER=mercadopago`/`MERCADOPAGO_ACCESS_TOKEN`; independent try/catch per provider). Crosses `booking-results` **even when the tx is already `processed`** so a mark-before-work insert failure (`reservationPending`) is still caught. Alert-only |
| `validate-discount-code` | Public read-only validation of a discount code for the Step-4 UI; uniform `{valid:false}` on any failure (no enumeration). Gated by `DISCOUNT_CODES_ENABLED`. The authoritative amount check stays in `create-wompi-signature`/`wompi-webhook` |
| `create-mercadopago-preference` | **Rollback** Mercado Pago Checkout Pro preference creator |
| `mercadopago-webhook` | **Rollback** MP handler: validates signatures (with an **API-verification fallback** when `MERCADOPAGO_WEBHOOK_SECRET` is absent — re-fetches the payment from the MP API), creates/updates OTASync reservation via shared payment logic (`_payments`). With `MP_DIRECT_RESILIENT_ENABLED` the direct path matches Wompi: single-writer lock + per-stay idempotency + `insertReservation` (retry/backoff/alert) + mark-before-work + `recordPending`-always so a paid booking is never lost |

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
| `otasync-webhook` | Receives OTASync webhooks; on `avail` changes re-validates affected active quotes. On **cancellation** events (`handleCancellations`): emails the (web-origin) guest a cancellation confirmation, alerts the team, releases any quote hold — deduped via a `cancellation-notified` blob |

**Guest app:**

| Function | Purpose |
|---|---|
| `guest-session` | Issues signed JWT session token (no OTASync credentials exposed to client) |
| `guest-checkin` | Document upload handler; optional Azure Document Intelligence OCR; multi-occupant support |
| `guest-action` | Guest requests: service orders (priced from `_services-catalog.js`), modifications, cancellations. Service orders can charge the reservation folio in OTASync/Kunas — `add_extra` on **"cargar a la cuenta"** (gated by `GUEST_SERVICE_FOLIO_ENABLED`), or a signed Wompi checkout on **"pagar en línea"** (`GUEST_SERVICE_PAYMENT_MODE=wompi`) settled by `wompi-webhook` (`add_extra`+`add_payment`). Both off by default. Emails the team a summary of every order via Resend (`notifyOrderTeam`). |
| `breakfast-status` / `breakfast-redeem` / `breakfast-upgrade` | Breakfast pass: staff scans a guest QR (`bookingCode:guestIndex`) to check entitlement, mark a breakfast served, or (Fase 3) **add** breakfast to a no-breakfast reservation — charges the Kunas folio (reuses `_otasync.postOrderExtrasToFolio`, gated by `BREAKFAST_UPGRADE_ENABLED`) and records it as an `upgrade`. Auth via `_staff-auth` (Firebase + `STAFF_EMAILS`). Redemptions in Blobs (`breakfast-redemptions`), idempotent 1/person/day. Staff panel: `desayuno.html`; guest passes: `pase-desayuno.html` (Fase 2) |
| `breakfast-analytics` | Breakfast pass (Fase 4): aggregates redemptions for the admin dashboard (`desayuno-admin.html`) — served (= base to settle the provider), included vs upgrades vs **courtesies**, amount, by-day and by-hour. **Admin-only** (`authenticateAdmin` / `ADMIN_EMAILS`): the kitchen does not see the money panel. |
| `breakfast-day` | Breakfast pass (Fase 4): day board ("día de desayunos") — what was served on a date grouped by reservation + cycle/day counts by source (no money). Staff auth (kitchen + admin). The full "expected today" roster is not included (OTASync doesn't cleanly list in-house reservations by date). |
| `breakfast-courtesy` | Breakfast pass (Fase 4): admin comps a free breakfast — records a redemption with `source: 'courtesy'` (no folio charge, but **counts** toward provider settlement). Admin-only. |
| `guest-sync` | Receives guest events, stores AES-256-GCM encrypted in Blobs |
| `guest-drive` | Forwards documents/data to Google Drive via Apps Script |
| `upload-drive-credentials` | Service account credential upload (admin) |
| `drive-probe` | Health check for Google Drive integration |

**WhatsApp chatbot (Meta Cloud API):**

| Function | Purpose |
|---|---|
| `whatsapp-webhook` | Receives Cloud API events: GET handshake (`hub.challenge`), POST signature validation (`X-Hub-Signature-256`, raw body), per-message dedupe, routes to `_whatsapp-bot`. Kill switch: `WHATSAPP_BOT_ENABLED` |
| `whatsapp-probe` | Admin health check (Firebase auth): reports config booleans and verifies token + phone number id against the Graph API |

See `docs/whatsapp-bot.md` for setup (credentials checklist, sandbox, flows, 24h window/templates).

**Admin panel — roles, settings, discounts:**

| Function | Purpose |
|---|---|
| `whoami` | Returns the authenticated user's **own** effective permissions + role labels so the `/admin` UI shows only the tabs/actions they may use. Read-only |
| `iam-admin` | CRUD for users and roles (`users.manage` / `roles.manage`) with anti-escalation guards: an actor can't grant a permission it lacks, only env-superusers/full admins can mint admins, no self-lockout, the system never ends with zero admins; every mutation is appended to an audit. Backs the **Usuarios** tab |
| `admin-settings` | Reads/writes the panel-managed toggles (`settings.manage`) — a whitelist that **deliberately excludes every secret**. Backs the **Configuración** tab |
| `admin-discount-codes` | CRUD + activate/deactivate for discount codes (reuses `quotes.view`/`quotes.edit`). Backs the **Códigos** tab |

Panel functions migrated to the new `authorize` layer (per-permission gate, env-vars = superuser): `list-quotes`, `create-quote`, `update-quote`, `send-quote-email`, `read-quote-audit`, `retry-quote-booking`, `get-pending-refunds`, `refund-admin-action`, the `breakfast-*` staff/admin functions, `upload-drive-credentials`, and the `*-probe` health checks.

**Shared modules (prefixed `_`, not HTTP-callable):**

| Module | Purpose |
|---|---|
| `_otasync` | OTASync auth + session caching, availability lookup, room holds (`createHold`/`releaseHold`), reservation CRUD (`insertReservation`, `cancelReservation` = soft-cancel via `delete/delete`, retry+alert), `getReservationsByDate` |
| `_quotes-store` | Quote persistence, tax math (IVA 19%, INC 8%), hold management |
| `_payments` | Payment status tracking, webhook event logging |
| `_email` | Email template rendering (Resend) — shared brand shell; includes `cancellationConfirmedHtml`/`adminCancellationHtml` (cancellations), `accessCodesHtml` (lock codes), `preArrivalHtml`/`postStayHtml` (with optional NPS link) |
| `_permissions` | Authorization catalogue: 22 atomic `recurso.accion` permissions + default roles (`admin`/`recepcion`/`cocina`/`tesoreria`). Pure module (no I/O); single source of truth for what can be done |
| `_iam-store` | Users/roles persistence in Netlify Blobs (`iam` store: `user/<email>`, `role/<id>`). Additive to env vars; empty (falls back to env) without Blobs |
| `_authz` | `authorize(event, permission)` drop-in guard. Identity stays 100% Firebase; resolves email → effective permissions across env vars (`ADMIN_EMAILS`/`STAFF_EMAILS` = break-glass superusers) + the iam store. Demo grant only locally (never on a Netlify deploy) |
| `_settings` | `flag(key)`/`get(key, fallback)` for panel-managed config: Blobs override (`app-settings` store) → `process.env` fallback, ~30s cache. **Whitelist (`MANAGEABLE`) that never admits secrets**; 17+ manageable toggles |
| `_discount-store` | Discount-code definitions + atomic usage counting in Blobs (`discount-codes`/`discount-usage`); compare-and-set so concurrent payments never exceed the cap, one-use-per-email + idempotent per-reservation dedup. Server-side only |
| `_mp-refund` | Mercado Pago refund executor (`POST /v1/payments/{id}/refunds`, idempotency key). Runs only after an admin approves a `GATEWAY_AUTO` refund **and** `REFUND_GATEWAY_AUTO_ENABLED` is set. Never throws |
| `_payment-details` | Snapshots the fields a refund needs (auth code, date, card last-4, amount) into a durable Blobs store (`payment-details`, ~13-month TTL) at payment-confirmation time, since `booking-results` expires in 7 days. Best-effort |
| `_ttlock` | TTLock Open Platform client (keyboard-PIN locks): generates per-reservation temporary codes via `keyboardPwd/get`. Mock-safe; gated by `TTLOCK_ENABLED` + `TTLOCK_*`. Never breaks check-in |
| `_guest-app` | Guest app utilities: token verification, reservation lookup, and PII protection (`protectRecord`/`unprotectRecord` for records, `sealBinaryForStore`/`openBinaryFromStore` for raw document buffers) — all delegating to `_crypto-vault` |
| `_ops-queue` | Append-only **operational task queue** (Blobs `ops-queue`): `enqueue`/`listOpen`/`resolve`/`getItem`. Idempotent by dedupeKey (an open task isn't duplicated; a resolved key re-opens on recurrence). `_alert.reportAlert` enqueues every alert as a task → the Staff App replaces the email inbox. Best-effort, never throws |
| `_crypto-vault` | **Reversible** envelope encryption for guest PII (AES-256-GCM): `seal()`/`open()` with HKDF-derived, **versioned** keys (key ring → real rotation + crypto-shredding) and AAD binding ciphertext to `bookingCode\|type`. Reads legacy `version:1` envelopes for backward compat. Round-trip test gates the build. Config: `GUEST_APP_DATA_ENCRYPTION_KEY` (single key) + optional `GUEST_APP_KEY_RING`/`GUEST_APP_ACTIVE_KEY_ID` for rotation |
| `_contract-template` | PDF contract template for guest check-in |
| `_pdf-render` | PDFKit server-side PDF rendering |
| `_quote-audit` | Audit log storage and retrieval |
| `_google-drive` | Google Drive API integration (service account) |
| `_firebase-auth` | Firebase authentication for admin pages |
| `_rate-limit` | Request rate limiting |
| `_odoo` | Odoo connector (ERP/CRM) — JSON-RPC, mock no-op sin credenciales. **Fase 1** *maestro de clientes*: `upsertPartner` crea/encuentra un `res.partner` deduplicado por NIT/email y lo enriquece (`country_id`/`lang`/`comment` + campos `x_estar_*`: canal, ultimo_checkout, noches_total, presupuesto, motivo_viaje, perfil, escritos solo si existen en la instancia) + `markLeadWonByQuote`/`markLeadLost` (desde `revalidate-quotes`). **Fase 2** captación: `addToMailingList` (Email Marketing) y leads de newsletter/contacto (vía `submission-created`). **Fase 4** PQR: `createHelpdeskTicket` (desde `guest-action`, team id 3). NPS post-estadía (Fase 3) va en el correo. Plan: `docs/plan-integracion-odoo-otasync.md` |
| `_whatsapp` | WhatsApp Cloud API client: sendText/sendButtons/sendList/sendTemplate/markRead, webhook signature validation; mock no-op without credentials |
| `_whatsapp-bot` | Bot conversation engine: state machine (Blobs sessions, 30-min TTL), ES/EN copy, date/guest parsers; calls `_otasync` for live availability and `request-cancellation` for cancellations. Routes to `_whatsapp-ai` first when `ANTHROPIC_API_KEY` is set |
| `_whatsapp-ai` | AI mode: Claude (`@anthropic-ai/sdk`, Messages API, manual tool-use loop) drives the conversation with tools `check_availability` / `lookup_booking` / `request_cancellation` / `notify_team`; text-only history in the session blob; falls back to the state machine on error. The system prompt loads the **editable knowledge base** `docs/bot-conocimiento.md` at runtime (bundled via `included_files`; only the `BOT-KNOWLEDGE:START/END` block, `⚠️` lines filtered out; minimal hardcoded fallback). **Authorization is code, not prompt**: cancellation requires a second-factor-verified lookup in the same conversation (`verifiedBookings`), and the WhatsApp number is correlated against the booking phone for audit |
| `_whatsapp-guard` | Security pre-filter (dual-model pipeline): a fast classifier screens every message for prompt injection / impersonation / data extraction BEFORE the concierge model; `malicious` ⇒ blocked with neutral reply, never enters AI history; 3 strikes ⇒ admin alert; fail-open on classifier errors |

**OTASync/Kunas API reference:** `docs/kunas-api.md` (project notes) and `docs/OTASync-Public-API.md` (the **complete** vendor API reference — auth, availability, prices, reservations, extras, invoices, webhooks, statistics, etc.). OTASync supports native webhooks (`reservation` insert/edit/cancel, `avail` edit, `prices`, `restrictions`) and a `reservation/delete/reservation` endpoint to release quote holds. Reservation folio endpoints (`reservation/edit/add_extra`, `add_payment`) back the guest-app service-order → folio integration (`_otasync.postOrderExtrasToFolio`, gated by `GUEST_SERVICE_FOLIO_ENABLED`).

**Quote availability & holds:** Quotes can optionally place a tentative hold in OTASync (`bloquearHabitaciones`) via `_otasync.createHold`; held rooms are guaranteed so availability checks are skipped. Holds are released on cancel, on expiry (cron), and converted to a confirmed reservation on payment. Hold status is configurable via `OTASYNC_HOLD_STATUS` (default `tentative`).

### Guest app (`guest.html`)

Multi-phase check-in system with document upload, OCR, and service requests:

- **Session:** Signed JWT from `guest-session`, no OTASync credentials exposed
- **Document upload:** Optional Azure Document Intelligence OCR (`prebuilt-idDocument` model); graceful fallback when OCR is unavailable
- **Multi-guest:** Supports N occupants per reservation, each with their own document
- **SIRE/TRA capture:** Records the raw material the Colombian tourism registries need (gender, occupation, residence, origin/`procedencia`, destination for foreigners) alongside the document; foreign guests must declare `destino`
- **Hardened check-in:** Guided live-camera capture; after `MAX_OCR_ATTEMPTS` failed OCR reads it accepts the manually typed data and flags the record for manual verification by reception (rather than blocking the guest)
- **Marketing consent:** Separate, opt-in (Ley 1581) consent stored distinctly from the operational privacy acceptance, with timestamp/channel for proof; default OFF. Wired site-wide into `upsertPartner`/`addToMailingList`
- **Online service payment:** Service-order online checkout supports Wompi **and** Mercado Pago (see `GUEST_SERVICE_PAYMENT_MODE`)
- **Persistence:** Guest data stored AES-256-GCM encrypted in Netlify Blobs
- **Archival:** Documents forwarded to Google Drive via Apps Script (`GOOGLE_DRIVE_APPS_SCRIPT_URL`)
- **Demo mode:** Works without OTASync credentials when `GUEST_APP_DEMO_MODE` is unset in non-production

See `docs/guest-app.md` for implementation details.

### Access control & admin panel (`/admin`)

The `/admin` panel adds an **authorization** layer on top of the existing Firebase **identity**:

- **Roles/IAM:** `_permissions` defines 22 atomic permissions and four default roles (`admin`, `recepcion`, `cocina`, `tesoreria`); `_iam-store` persists users/roles in Blobs; `_authz.authorize(event, permission)` resolves an email → effective permissions. `ADMIN_EMAILS`/`STAFF_EMAILS` remain break-glass superusers (a permission granted by env vars can never be revoked, so the owner can't lock himself out). The **Usuarios** tab (`iam-admin`) does CRUD with anti-escalation guards; `whoami` drives which tabs the UI shows.
- **Settings:** the **Configuración** tab (`admin-settings`, permission `settings.manage`) toggles 17+ manageable flags. `_settings.flag()`/`get()` read a Blobs override (`app-settings`) first and fall back to `process.env`. The whitelist **never** admits secrets — they live only in Netlify env. Carril-A flags are now manageable from here without a redeploy.
- **Discount codes:** the **Códigos** tab (`admin-discount-codes`) manages server-side discount codes (`_discount-store`); applied in `_direct-pricing`/`create-wompi-signature`/`wompi-webhook` (Wompi path), gated by `DISCOUNT_CODES_ENABLED`.

### Guest cancellations (OTASync)

`request-cancellation` records the guest request and alerts the team. The cancellation loop **closes at the admin gate**: when an admin approves or denies the refund in `refund-admin-action`, the reservation is soft-cancelled in OTASync (`_otasync.cancelReservation`), **gated by `OTASYNC_AUTO_CANCEL_ENABLED`** (OFF until validated against a real reservation), idempotent per reservation, direct bookings only (COT- quotes use hold/release), best-effort + alert. When the cancellation is performed in OTASync, `otasync-webhook.handleCancellations` emails the (web-origin) guest a confirmation, alerts the team, and releases any quote hold (deduped via `cancellation-notified`). Templates: `cancellationConfirmedHtml`/`adminCancellationHtml` in `_email`.

### Door locks (TTLock)

`_ttlock` is a mock-safe TTLock Open Platform client (`TTLOCK_ENABLED` + `TTLOCK_*`) that can mint per-reservation temporary keyboard PINs; the email template (`accessCodesHtml`) already exists. Off by default; never breaks check-in.

### Scheduled functions

| Function | Schedule | Purpose |
|---|---|---|
| `revalidate-quotes` | `0 */6 * * *` | Re-checks all active quote availability every 6 hours |
| `reconcile-payments` | `*/30 * * * *` | Reconciles paid-but-no-reservation orphans every 30 minutes — **both Wompi and Mercado Pago**, corporate quotes and direct bookings (missing or `reservationPending` `booking-results` entry ⇒ alert) |
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
MERCADOPAGO_WEBHOOK_SECRET=   # OPTIONAL: if unset, the webhook re-verifies each event against the MP API
MERCADOPAGO_CHECKOUT_MODE=
MERCADOPAGO_SUCCESS_URL=
MERCADOPAGO_PENDING_URL=
MERCADOPAGO_FAILURE_URL=
```

**Discounts & refunds:**
```
DISCOUNT_CODES_ENABLED=        # 'true' to show the discount field in the engine + validate codes
REFUND_GATEWAY_AUTO_ENABLED=   # 'true' to execute the Mercado Pago refund when an admin approves it (Wompi stays manual)
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
GUEST_SERVICE_PAYMENT_MODE=        # room_charge | payment_link | wompi (online charge → folio)
GUEST_SERVICE_PAYMENT_URL=        # used when mode = payment_link
GUEST_APP_BASE_URL=               # optional: site origin for the Wompi redirect-url
GUEST_SERVICE_FOLIO_ENABLED=      # 'true' to post "cargar a la cuenta" orders to the Kunas folio
OTASYNC_GUEST_SERVICE_EXTRA_ID=   # optional: id_extras for folio lines (else a generic one is auto-created)
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

**WhatsApp chatbot (Meta Cloud API):**
```
WHATSAPP_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_APP_SECRET=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_GRAPH_VERSION=
WHATSAPP_BOT_ENABLED=
ANTHROPIC_API_KEY=        # AI mode (Claude); unset = deterministic menu flows
WHATSAPP_AI_MODEL=        # default claude-haiku-4-5 (claude-opus-4-8 for max quality)
WHATSAPP_AI_EFFORT=       # default low
WHATSAPP_AI_MAX_TOKENS=   # default 8000
WHATSAPP_AI_TIMEOUT_MS=   # default 50000
WHATSAPP_GUARD_ENABLED=   # security pre-filter; 'false' to disable
WHATSAPP_GUARD_MODEL=     # default claude-haiku-4-5
```
Without token/phone-number-id every send is a logged no-op (mock mode); the
webhook rejects POSTs when `WHATSAPP_APP_SECRET` is unset. Setup guide:
`docs/whatsapp-bot.md`.

**TTLock (door locks — rollback/off by default; not in `.env.example`):**
```
TTLOCK_ENABLED=          # 'true' to activate (default OFF → mock no-op)
TTLOCK_CLIENT_ID=        # Open Platform application id
TTLOCK_CLIENT_SECRET=    # Open Platform application secret
TTLOCK_USERNAME=         # TTLock user account (not the developer account)
TTLOCK_PASSWORD_MD5=     # user password as MD5 (32 lowercase hex); TTLOCK_PASSWORD (plain) also accepted
TTLOCK_LOCKS_JSON=       # apartment→lockId map, e.g. {"101":1234567,"main":7654321}
TTLOCK_API_BASE=         # optional, default https://api.sciener.com
TTLOCK_TIMEOUT_MS=       # optional, default 10000
TTLOCK_PASSCODE_TYPE=    # optional keyboardPwd type, default 3 (period)
```

**Odoo (CRM — Helpdesk / NPS; the connector itself uses the existing OTASYNC/Odoo creds):**
```
HELPDESK_ENABLED=        # 'true' to open an Odoo Helpdesk ticket from guest service requests/cancellations
HELPDESK_TEAM_ID=        # Helpdesk team id (default 3)
NPS_ENABLED=             # 'true' to link the NPS survey in the post-stay email
NPS_SURVEY_URL=          # optional override for the survey URL
```

**Misc:**
```
ALLOWED_ORIGIN=http://localhost:8888
PROXY_URL=
DEBUG=
```

Most Carril-A toggles above (e.g. `DISCOUNT_CODES_ENABLED`, `REFUND_GATEWAY_AUTO_ENABLED`, `STAY_EMAILS_*`, `HELPDESK_ENABLED`, `NPS_ENABLED`, `TTLOCK_ENABLED`, `WHATSAPP_BOT_ENABLED`) are also manageable from the **Configuración** tab in `/admin`, which overrides the env var at runtime (~30s, no redeploy). Secrets are never manageable from the panel.

**Wompi configuration notes:**
- Register Wompi events against `/api/wompi-webhook`; use the Wompi events secret as `WOMPI_WEBHOOK_SECRET`
- Set `WOMPI_INTEGRITY_SECRET` from "Desarrolladores > Secretos para integración técnica"; used server-side by `create-wompi-signature`
- Sandbox keys have a `pub_test_` prefix — the booking engine shows a "TEST MODE" banner when detected
