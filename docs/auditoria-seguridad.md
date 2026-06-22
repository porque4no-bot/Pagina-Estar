# Auditoría de seguridad (A11)

Revisión del sitio + funciones Netlify de Hotel Estar contra el código real
(2026-06-19). **Estado general: SÓLIDO.** Ningún hallazgo crítico. Abajo, el
checklist de lo verificado y 3 gaps menores con su estado.

## Checklist verificado (✅)

| Área | Estado |
|---|---|
| **CSP por hash** | `build.js` hashea cada `<script>` inline (SHA-256) → `dist/_headers`; `script-src` sin `unsafe-inline`. `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'self'`, `form-action` allowlist, `upgrade-insecure-requests`. (`style-src` conserva `unsafe-inline` por los cientos de `style="..."` — tradeoff documentado; el vector alto de XSS es `script-src`, ya endurecido.) |
| **Headers** | `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `Permissions-Policy` restrictiva; `/api/*` `no-store`. |
| **Webhook Wompi** | Firma OBLIGATORIA; 500 fail-closed si falta `WOMPI_WEBHOOK_SECRET`; valida hex-64 antes de `timingSafeEqual`; dedupe + idempotencia por estadía; **monto verificado server-side**. |
| **Webhook OTASync** | 503 fail-closed si falta `OTASYNC_WEBHOOK_SECRET`; `timingSafeEqual` con chequeo de longitud. |
| **Webhook WhatsApp** | HMAC-SHA256 sobre el rawBody (no re-serializado); fail-closed sin `WHATSAPP_APP_SECRET`; handshake GET compara `verify_token`. |
| **Auth admin** | Firebase ID token RS256 contra certs de Google; valida alg/kid/aud/iss/exp/iat/sub + `email_verified`; allowlist `ADMIN_EMAILS`; **no fail-open** si la allowlist está vacía. |
| **Auth staff** | Igual patrón; `STAFF_EMAILS ∪ ADMIN_EMAILS`; demo-mode solo sin `FIREBASE_PROJECT_ID` (nunca en Netlify). |
| **Funciones admin/staff gateadas** | ~20 (refund-admin-action, get-pending-refunds, read-quote-audit, *-quote, breakfast-*, *-probe, upload-drive-credentials, …). |
| **Rate-limit** | CAS atómico (`onlyIfMatch`/`onlyIfNew`) sobre Blobs strong-consistency, fallback a memoria; IP hasheada. |
| **Segundo factor** | `get-booking` + `request-cancellation` comparten `identityMatches` (email o apellido); respuesta **uniforme** en mismatch (sin oráculo de enumeración). |
| **noindex paneles** | Doble capa: `X-Robots-Tag` (netlify.toml) + `<meta robots>` + `no-store`. |
| **create-booking** | RETIRADA (410) con test de regresión. |

## Gaps y estado

### GAP-2 — `create-wompi-signature` sin rate-limit · ✅ CORREGIDO
Cada POST con referencia directa dispara `verifyDirectBookingAmount` → consulta
OTASync (amplificación de costo / sondeo de precios). **Aplicado:** rate-limit
30/5 min (`name: 'wompi-signature'`), best-effort. No toca dinero ni la creación
de reservas (la firma no crea reservas y ya verifica el monto server-side).

### GAP-1 — `otasync-webhook` acepta el secreto por query string · ⚠️ REQUIERE CONFIRMACIÓN
`otasync-webhook.js` acepta el secreto por `queryStringParameters.secret` además
del header `x-otasync-secret`. Los query strings se loguean en proxies/CDN/access
logs → posible fuga del secreto.
- **Fix:** quitar el fallback de query string (exigir solo el header).
- **POR QUÉ NO LO APLIQUÉ:** si OTASync está registrado HOY para enviar el
  secreto por query string, quitarlo **rompe la recepción de webhooks**
  (avail/reservation) → las cotizaciones dejan de re-validarse y el upsert de
  huéspedes a Odoo se detiene. **Acción del dueño/ops:** confirmar en el panel de
  OTASync cómo está registrado el endpoint. Si soporta header personalizado →
  aplicar el fix; si no → dejar el query-string como excepción documentada.

### GAP-3 — `get-booking` usa rate-limit en memoria · 📋 RECOMENDADO
`get-booking.js` usa un `Map` en memoria (15/min **por instancia**) en vez del
limiter compartido por Blobs que ya usan las demás funciones. Bajo concurrencia
(varias instancias Lambda) el límite es por-contenedor → más laxo y evadible.
- **Fix:** migrar a `checkRateLimit({ name: 'get-booking', limit: 15, windowMs: 60000 })`.
- Mejora de consistencia/hardening, **no** vulnerabilidad explotable crítica.

## Verificación manual recomendada (no automatizable)

- [ ] Consola del navegador en `index` / `reservar` / `cotizacion` / `datos-cuenta`: **0 violaciones CSP** (scripts inline + los 3 hashes Netlify-inyectados vigentes).
- [ ] `curl -I` a `/cotizar-admin.html` y `/desayuno-admin.html` → `X-Robots-Tag: noindex` presente.
- [ ] Tras cada deploy, confirmar que Netlify no cambió su snippet inyectado (si lo hace, el hash hardcodeado en `build.js` queda obsoleto y rompería ese script — disponibilidad, no seguridad).

## Riesgo neto

**Bajo.** Ninguno de los gaps toca la creación de reservas ni el movimiento de
dinero. Las correcciones son hardening defensivo.

## Addendum (2026-06-22) — IAM / autorización por permisos

Posterior a esta auditoría se añadió un sistema de **roles y permisos** para el
panel `/admin` (`_permissions.js` = catálogo de 22 permisos + roles admin /
recepción / cocina / tesorería; `_iam-store.js` = usuarios/roles en Blobs;
`_authz.js` = `authorize()` drop-in). Notas de seguridad:

- **Las variables de entorno (`ADMIN_EMAILS`/`STAFF_EMAILS`) siguen siendo el
  "maestro" de acceso:** quien esté en ellas es **superusuario** independiente de
  los roles del panel. El IAM por Blobs **añade** granularidad, no reemplaza la
  allowlist por env (que conserva el "no fail-open" de la auth admin/staff).
- **Demo-mode de IAM solo en local** (sin `FIREBASE_PROJECT_ID`); nunca en Netlify.
- **Anti-escalada** en `iam-admin.js` (un usuario no puede otorgarse permisos que
  no tiene).
- Funciones del panel migradas a `authorize` (list/create/update-quote,
  send-quote-email, read-quote-audit, get-pending-refunds, refund-admin-action,
  breakfast-*, probes, admin-settings, admin-discount-codes, iam-admin, whoami).
- **Nueva superficie de configuración** (`_settings.js`): override de toggles en
  Blobs `app-settings` con lista blanca `MANAGEABLE` — **nunca** gestiona secretos
  (límite de diseño verificado en el módulo).

GAP-1 (secreto del `otasync-webhook` por query string) sigue **abierto** a la
espera de la confirmación de Kunas (ver `docs/mensajes-terceros.md` §1).
