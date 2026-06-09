# Sandbox vs Production payment setup

This document explains how Hotel Estar separates **production** payment
credentials (real money) from **sandbox** credentials (used in deploy previews
and branch deploys) so that the team can safely test the booking flow without
touching the live merchant accounts.

The mechanism is Netlify's per-context environment variables: the same variable
name (`WOMPI_PUBLIC_KEY`, `MERCADOPAGO_ACCESS_TOKEN`, etc.) holds different
values depending on whether the deploy is `production`, a `deploy-preview`
(every pull request) or a `branch-deploy` (e.g. a `staging` branch).

> The contract is documented at the top of `netlify.toml`. The booking engine
> (`motor-app.jsx`) detects sandbox keys at runtime and shows a yellow
> **MODO PRUEBA / TEST MODE** banner on the payment step. If you ever see that
> banner on `www.hotelestar.co` something is wrong — stop and check the
> production env vars.

---

## 1. Configure per-context variables in the Netlify UI

1. Open Netlify → **Site overview** for the Pagina Estar site.
2. Go to **Site configuration → Environment variables**.
3. For each variable below, click **Add a variable → Add a single variable**.
4. Set the **Key** (e.g. `WOMPI_PUBLIC_KEY`).
5. Click **Different value for each deploy context** and fill in:
   - **Production** → the live key (`pub_prod_…`, `APP_USR-…`).
   - **Deploy previews** → the sandbox key (`pub_test_…`, `TEST-…`).
   - **Branch deploys** → the sandbox key (same as deploy previews).
6. Save. Repeat for every credential listed below.

```
[screenshot placeholder: Netlify "Environment variables" tab with the
 "Different value for each deploy context" toggle visible]
```

### Variables to scope per context

| Key | Production | Sandbox (preview + branch) |
|---|---|---|
| `PAYMENT_PROVIDER` | `wompi` or `mercadopago` | match what you want to test |
| `WOMPI_PUBLIC_KEY` | `pub_prod_…` | `pub_test_…` |
| `WOMPI_INTEGRITY_SECRET` | live | sandbox |
| `WOMPI_WEBHOOK_SECRET` | live events secret | sandbox events secret |
| `MERCADOPAGO_PUBLIC_KEY` | `APP_USR-…` | `TEST-…` |
| `MERCADOPAGO_ACCESS_TOKEN` | `APP_USR-…` | `TEST-…` |
| `MERCADOPAGO_WEBHOOK_SECRET` | live | sandbox |

`OTASYNC_*`, `RESEND_*`, `FIREBASE_*`, `DRIVE_*` and similar back-office
credentials can stay as **All deploy contexts** unless you have a separate
sandbox property in OTASync — in that case scope `OTASYNC_PROPERTY_ID` /
`OTASYNC_USERNAME` / `OTASYNC_PASSWORD` the same way.

> The values must be set **in the Netlify UI only** — do not put them in
> `netlify.toml`, that file is committed to git.

---

## 2. Where to obtain sandbox credentials

### Wompi (active provider)

- Dashboard: <https://comercios.wompi.co/> (real account) and
  <https://comercios-sandbox.wompi.co/> (sandbox account).
- Sign up for a sandbox merchant at <https://docs.wompi.co/docs/colombia/ambientes/>.
- In the sandbox dashboard, go to **Desarrolladores → Llaves de API** to copy
  the `pub_test_…` public key.
- **Desarrolladores → Secretos para integración técnica** holds the
  `WOMPI_INTEGRITY_SECRET` (used server-side by `create-wompi-signature`).
- **Desarrolladores → Eventos** is where you register the sandbox webhook URL
  (see section 4) and obtain the `WOMPI_WEBHOOK_SECRET`.
- Test cards: <https://docs.wompi.co/docs/colombia/tarjetas-de-prueba/>.

### Mercado Pago (rollback provider)

- Dashboard: <https://www.mercadopago.com.co/developers/panel>.
- Switch to the **Credenciales de prueba** tab (top right). You get a public
  key starting with `TEST-…` and an access token starting with `TEST-…`.
- For webhooks, go to **Tus integraciones → Webhooks** and add the sandbox
  endpoint.
- Test cards: <https://www.mercadopago.com.co/developers/es/docs/checkout-pro/additional-content/test-cards>.

---

## 3. Verify the wiring on a deploy preview

1. Open any pull request and wait for the Netlify deploy preview link
   (`https://deploy-preview-NN--<site>.netlify.app/`).
2. Navigate to `/reservar.html`, pick any dates and a room and reach the
   **Payment** step.
3. The yellow **MODO PRUEBA / TEST MODE** pill must be visible at the top of
   the panel. If it is not, the deploy preview is still wired to the
   production key — **do not click pay**.
4. Use a test card and complete the flow. Confirm that:
   - The Wompi/MP checkout pops on the corresponding sandbox host
     (`sandbox.wompi.co` or `mercadopago.com.co` with TEST card).
   - The webhook resolves (see Netlify Function logs for
     `wompi-webhook` / `mercadopago-webhook`).
   - The reservation appears in the **sandbox** OTASync property (or
     production OTASync if you decided not to scope OTASync vars per context;
     in that case verify and then cancel manually).

---

## 4. Webhook URLs for sandbox

Deploy preview URLs are **dynamic** (one per PR), so Wompi/MP cannot keep a
permanent webhook entry pointing at them. Two recommended options:

**Option A — dedicated `staging` branch (recommended)**

1. Create a long-lived `staging` branch in GitHub.
2. In Netlify → **Branches and deploy contexts**, mark `staging` as a
   "Branch deploy" target. Its URL stays stable
   (`https://staging--<site>.netlify.app/`).
3. Register the sandbox webhooks against that URL:
   - Wompi: `https://staging--<site>.netlify.app/api/wompi-webhook`
   - Mercado Pago: `https://staging--<site>.netlify.app/api/mercadopago-webhook`
4. Merge feature branches into `staging` for full end-to-end sandbox testing,
   then into `master` for production.

**Option B — Netlify CLI tunnel**

For one-off local testing, run `netlify dev` with `--live` and register the
generated `https://<random>.netlify.live/api/wompi-webhook` URL in Wompi for
the duration of the session. Less convenient but useful for debugging.

---

## 5. Pre-launch: single small real transaction

Before flipping the switch to production traffic, do **one** real-money
transaction against production credentials to validate the full chain:

- [ ] Pick the lowest-priced room (Clásica) for **1 night**.
- [ ] Use a real customer email you control.
- [ ] Walk the four steps: room → extras → guest data → payment.
- [ ] On the payment step, **confirm no yellow banner is shown** (production
      keys must be detected).
- [ ] Pay with a real card on Wompi.
- [ ] Verify in this order:
  - [ ] Wompi dashboard shows the transaction as **APPROVED**.
  - [ ] Netlify Function logs show `wompi-webhook` returned 200.
  - [ ] OTASync shows the new reservation in property `9889`.
  - [ ] Google Drive has the booking PDF/log in the configured folder.
  - [ ] Guest email arrived with the confirmation and reference code.
- [ ] Cancel the reservation in OTASync and refund the charge in Wompi.

Document the timestamp, reference code and reviewer in `docs/testing.md`
release log.

---

## 6. Rollback if production webhook starts failing

Symptoms: Wompi shows APPROVED but no reservation in OTASync, or
`wompi-webhook` returns 5xx in Netlify logs.

1. **Stop the bleeding.** In Netlify → **Environment variables** flip
   `PAYMENT_PROVIDER` (production context) to `mercadopago`. Trigger a
   redeploy. The booking engine now routes to Mercado Pago Checkout Pro.
2. **Reconcile in-flight payments.** The scheduled
   `reconcile-payments` function runs every 30 minutes and replays approved
   Wompi transactions whose webhook never landed. You can also invoke it
   manually from the Netlify Functions UI.
3. **Investigate.** Common causes:
   - `WOMPI_WEBHOOK_SECRET` rotated and not updated in Netlify.
   - CSP or redirect rule blocking the webhook host.
   - OTASync down or returning errors (check `_otasync` logs).
4. **Re-enable Wompi.** Once fixed, set `PAYMENT_PROVIDER=wompi` again,
   redeploy, run section 3 verification on a deploy preview first, then
   monitor production for the next few transactions.

If the issue persists, the fallback "Pago al hacer check-in" option in the
booking engine still confirms reservations without payment, so the guest is
not blocked.
