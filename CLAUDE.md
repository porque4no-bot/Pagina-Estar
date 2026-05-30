# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Static multi-page website and direct booking engine for **Hotel Estar**, a boutique apartaestudio property in Manizales, Colombia. Deployed on Netlify. No framework — vanilla HTML/CSS with one compiled React component and Netlify serverless functions.

## Commands

```bash
# Build: copies static assets to dist/ and compiles motor-app.jsx → dist/motor-app.js
npm run build

# Dev: watch mode for motor-app.jsx only (recompiles to motor-app.js on save)
npm run dev

# Local static server: serves the ROOT directory on port 3400
node server.js

# Local Netlify functions (requires Netlify CLI and a .env file at root)
netlify dev
```

There are no tests or linters configured.

## Architecture

### Frontend layers

Three JavaScript files load on most pages:

| File | Role |
|---|---|
| `shell.js` | Site-wide behaviors: header scroll state, mobile menu, scroll reveal (`[data-reveal]`), star cursor on hero, WhatsApp button |
| `kunas.js` | Booking bar date picker, room-link triggers (`.book-room-trigger[data-room="<slug>"]`), and the legacy bridge to the Kunas/OTASync engine URL |
| `motor-app.jsx` | Full booking engine as a React app (compiled by esbuild; React loaded via UMD CDN at runtime) |

`motor-app.jsx` is only loaded on `reservar.html`. All other pages load `kunas.js` (and `shell.js`). The booking bar on content pages navigates to `reservar.html`, where `motor-app.js` mounts and runs the four-step flow: room selection → extras → guest data → payment.

### Language switching

Pages use `.lang-es` / `.lang-en` HTML elements toggled by `shell.js`. `motor-app.jsx` has a full `i18nEngine` dictionary for both languages.

**Any text change must be mirrored in both languages.** In HTML pages, update both the `.lang-es` and `.lang-en` elements. In `motor-app.jsx`, update both the `es` and `en` keys inside `i18nEngine`.

### Room data

`rooms_db.json` is the canonical source of room metadata. Keys are OTASync room type IDs:

| ID | Slug | Name |
|---|---|---|
| 31348 | clasica | Clásica |
| 31349 | seleccion | Selección |
| 31350 | reserva | Reserva |
| 31351 | origen | Origen |
| 31352 | especial | Especial |

This file is used both by the frontend (copied to `dist/`) and by the Netlify functions at runtime (via `included_files` in `netlify.toml`).

### Netlify functions (`netlify/functions/`)

All functions authenticate against OTASync via a cached session key (`pkey`, valid 30 min). When credentials are absent, every function falls back to mock/hardcoded responses so the site works locally without credentials.

| Function | Purpose |
|---|---|
| `check-availability` | Queries OTASync for available rooms and daily prices; merges with `rooms_db.json` metadata |
| `create-booking` | Creates reservation in OTASync; **pricing is always computed server-side from `rooms_db.json`** — client-provided price is ignored |
| `send-confirmation` | Sends email confirmation to guest |
| `get-booking` | Retrieves a booking by reference code for guest self-service |
| `get-booking-rating` | Fetches Booking.com rating via `PROXY_URL`; returns hardcoded fallback if unconfigured |
| `create-mercadopago-preference` | Creates Mercado Pago Checkout Pro preferences for direct bookings and quotes |
| `mercadopago-webhook` | Validates Mercado Pago webhook signatures, verifies the real payment with Mercado Pago, then creates/updates the OTASync reservation through shared payment logic |
| `wompi-webhook` | Kept as rollback payment confirmation handler; not used by the active checkout flow unless Wompi is reactivated |
| `create-quote` / `get-quote` / `list-quotes` / `update-quote` | Corporate quote CRUD, persisted in Netlify Blobs (`quotes` store). Create/edit block when rooms lack availability |
| `quote-availability` | Public re-check of a stored quote's room availability (called before opening Wompi) |
| `revalidate-quotes` | Scheduled (every 6h) re-check of active quotes; flags lost availability and releases holds on expired/cancelled quotes |
| `otasync-webhook` | Receives OTASync webhooks; on `avail` changes re-validates affected active quotes |
| `_quotes-store` / `_otasync` | Shared modules: quote persistence + tax math; OTASync auth, availability lookup and room holds |

API routes are rewritten: `/api/*` → `/.netlify/functions/:splat` (see `netlify.toml`).

OTASync/Kunas API reference: `docs/kunas-api.md`. Note OTASync supports native webhooks (`reservation` insert/edit/cancel, `avail` edit, `prices`, `restrictions`) and a `reservation/delete/reservation` endpoint used to release quote holds.

**Quote availability & holds:** quotes can optionally place a tentative hold in Kunas (`bloquearHabitaciones`) via `_otasync.createHold`; held rooms are guaranteed so availability checks are skipped. Holds are released on cancel, on expiry (cron) and converted to a confirmed reservation on payment. Hold status is configurable via `OTASYNC_HOLD_STATUS` (default `tentative`).

### Build process

`build.js` (Node, no framework):
1. Copies `assets/`, `fonts/`, `uploads/` to `dist/`
2. Copies specific files: `styles.css`, `colors_and_type.css`, `shell.js`, `kunas.js`, `rooms_db.json`, `favicon.png`, `datos_habitaciones_estar.csv`
3. Copies all `.html` files from root to `dist/`
4. Runs esbuild on `motor-app.jsx` → `dist/motor-app.js` (minified)

**Edit source files in the root, never in `dist/`.** The `dist/` directory is generated on every build.

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

For local development, create a `.env` file at the project root (gitignored):

```
OTASYNC_TOKEN=
OTASYNC_USERNAME=
OTASYNC_PASSWORD=
OTASYNC_PROPERTY_ID=9889
PAYMENT_PROVIDER=mercadopago
MERCADOPAGO_PUBLIC_KEY=
MERCADOPAGO_ACCESS_TOKEN=
MERCADOPAGO_WEBHOOK_SECRET=
MERCADOPAGO_SUCCESS_URL=https://estar.com.co/reservar.html?payment=success
MERCADOPAGO_FAILURE_URL=https://estar.com.co/reservar.html?payment=failure
MERCADOPAGO_PENDING_URL=https://estar.com.co/reservar.html?payment=pending
ALLOWED_ORIGIN=http://localhost:8888
PROXY_URL=
```

Mercado Pago Checkout Pro is the active payment provider. Wompi remains available as rollback code (`wompi-webhook.js`); to reactivate it, restore the Wompi widget/public key in the booking pages and set `PAYMENT_PROVIDER=wompi` plus `WOMPI_WEBHOOK_SECRET` in Netlify.
Register Mercado Pago notifications against `/api/mercadopago-webhook` and use `MERCADOPAGO_WEBHOOK_SECRET` as the webhook secret.
