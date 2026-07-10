# Revisión completa de bugs — 10 de julio 2026

> **Estado (rama `fix/revision-bugs-4k`):** ARREGLADOS los 6 altos, los 16 medios (salvo M7) y 12 bajos.
> **Pendientes a propósito:** **M7** (estructura del folio en Kunas) — escritura contable que debe validarse contra una reserva real antes de tocarla (tarea aparte). Dos bajos se dejan como nota: el `{ttl}` inerte de Netlify Blobs (comportamiento seguro, solo comentarios engañosos) y las redes de seguridad del camino directo de Mercado Pago (rollback, OFF por defecto).
> **Verificación:** build ✅ · 915 pruebas unitarias ✅ · 35 e2e (desktop+móvil) ✅ · 9 nuevas de regresión (`tests/unit/revision-bugs-4k.test.js`) ✅.


Revisión de código de todo el proyecto con 6 revisores especializados (pagos, motor de reservas, guest app/PII, permisos/admin, cotizaciones/OTASync, build/frontend/bot). Los hallazgos de severidad ALTA fueron verificados manualmente en el código línea por línea.

**Conclusión general:** la cadena de pago de Wompi (firma → pago → webhook) es sólida — no hay forma de subpagar ni de saltarse la verificación de montos. La capa de seguridad principal (tokens Firebase, anti-escalación, secretos, cifrado, gate del bot) está bien construida. Los bugs encontrados se concentran en: rutas secundarias que no recibieron los blindajes de las principales, redondeos, zona horaria UTC vs Colombia, y un hueco serio de datos personales.

---

## ALTOS (6 — todos verificados en código)

### A1. Fotos de documentos de identidad guardadas sin cifrar y para siempre
`netlify/functions/guest-checkin.js:156-183` (`stageDraftDocument`) + `purge-guest-data.js:24`

Cada intento de OCR del check-in guarda la imagen de la cédula/pasaporte en el store `guest-checkin-drafts` en base64 **sin cifrar**. El `{ ttl: 24h }` que se le pasa a Netlify Blobs **no hace nada** (Blobs no soporta TTL — el propio repo lo sabe en `_rate-limit.js:36`), nadie las borra al consumirlas, y el store NO está en la lista `PII_STORES` de la purga de retención (Ley 1581). Resultado: acumulación indefinida de imágenes de documentos de identidad en claro, contradiciendo todo el trabajo de `_crypto-vault`.

**Fix:** cifrar el draft con `sealBinaryForStore`, borrar el draft al consumirlo en el submit, y añadir `guest-checkin-drafts` a `PII_STORES`.

### A2. Precio promedio sin redondear → pantalla en millones y pagos bloqueados en estadías largas
`netlify/functions/check-availability.js:260,263` vs `_otasync.js:234`

`check-availability` calcula `avgPrice = totalAmount / count` SIN redondear; el verificador de precio del servidor (`_otasync.js:234` → `_direct-pricing.js`) SÍ redondea. Dos consecuencias: (1) con precios diarios distintos, `formatCOP` convierte `223333.333` en **"$ 223.333.333"** en la tarjeta de la habitación; (2) en estadías ≥ ~11 noches la deriva supera la tolerancia de 500 centavos y el huésped legítimo queda en bucle de `price_mismatch` ("hubo un cambio en la tarifa"). Crítico para estadías extendidas (vivir.html, 30 noches ⇒ deriva ~1.500 centavos).

**Fix:** `Math.round(totalAmount / count)` en check-availability.js:260/263, igual que `_otasync.js:234`.

### A3. "Reactivar" una cotización YA PAGADA no tiene guarda → doble pago / doble reserva
`netlify/functions/update-quote.js:70-82`

`cancel` y el edit completo bloquean cotizaciones `aceptada`, pero `reactivate` no valida nada: la vuelve `activa/vista`. Con eso: `create-wompi-signature` vuelve a firmar el pago (el cliente puede pagar dos veces), el dedupe del webhook (que descansa en `status === 'aceptada'`) permite una segunda reserva, y se rompe la puerta de `retry-quote-booking`.

**Fix:** en `reactivate`, rechazar con 409 si `effectiveStatus(existing) === 'aceptada'` (misma guarda que `cancel`).

### A4. Reintento tras timeout al crear la reserva en OTASync → reserva duplicada
`netlify/functions/_otasync.js:406-448` (`insertReservation`)

Timeout de 10 s tratado como transitorio y reintentado. Si OTASync SÍ procesó el insert pero respondió tarde, el reintento crea una **segunda reserva confirmada** (o un segundo hold huérfano) por un solo pago. No hay clave de idempotencia ni verificación previa por `reference`.

**Fix:** antes de reintentar tras timeout, consultar si ya existe una reserva con esa `reference` (o no reintentar timeouts, solo errores de conexión previos al envío).

### A5. Botón "reintentar reserva" del panel sin candado → doble clic = dos reservas
`netlify/functions/retry-quote-booking.js:44-77`

A diferencia del webhook (que usa `acquireQuoteLock`), el retry no toma lock: dos POST concurrentes pasan ambos el check `aceptada && reservationPending` y ambos llaman `createConfirmedReservation`. Agravante: si el insert triunfa pero `saveQuote` falla, el error se traga y la quote sigue `reservationPending: true` → un retry posterior duplica.

**Fix:** envolver con `acquireQuoteLock`/`releaseQuoteLock` igual que wompi-webhook.js:613.

### A6. El bot de WhatsApp cotiza fechas del AÑO SIGUIENTE todas las noches (7 p.m.–medianoche)
`netlify/functions/_whatsapp-bot.js:137,148` + `_whatsapp-ai.js:351`

`rollForward`/`parseDateRange` usan la fecha **UTC** como "hoy". Colombia es UTC-5: de 7 p.m. a medianoche, "hoy" UTC ya es mañana, así que "10/07 al 12/07" escrito el 10-jul a las 8 p.m. se interpreta como fecha pasada y se corre a **julio de 2027**. El modo IA tiene la misma raíz ("Hoy es <fecha UTC>" en el prompt). Ocurre en la franja pico de reservas same-day. El mismo bug UTC existe en el motor web (`reservar.html:683` `getToday()`): después de las 7 p.m. no se puede seleccionar hoy como check-in.

**Fix:** calcular "hoy" en `America/Bogota` (p. ej. `toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })`) en los tres puntos.

---

## MEDIOS (14)

**Pagos / cotizaciones:**
- **M1.** Cotización pagada sin credenciales OTASync en prod = pérdida silenciosa: quote queda `aceptada` sin reserva, sin alerta, y `reconcile-payments` la da por reconciliada (`wompi-webhook.js:639-650`, `reconcile-payments.js:255`). El fix C5 de la Mesa Redonda solo cubrió reservas directas.
- **M2.** `handleQuotePayment` sin `catch` con mark-before-work: una excepción no capturada (p. ej. `quote.items` corrupto) pierde el pago para la reconciliación (`wompi-webhook.js:619-892,1076`).
- **M3.** El camino directo Wompi NO tiene el lock single-writer que sí tiene MP (`MP_DIRECT_RESILIENT_ENABLED`): entregas concurrentes del mismo evento pueden duplicar reserva o cargo al folio (`wompi-webhook.js:1048-1102`).
- **M4.** Fuga de hold si `saveQuote` falla después de `createHold`: hold vivo en OTASync sin referencia, nada lo puede liberar (`create-quote.js:122-132`, `update-quote.js:164-171`).
- **M5.** `wompi-webhook` limpia `holdReservationIds` aunque `releaseHold` falle → hold zombi doble-bloqueando la unidad (`wompi-webhook.js:656-661`).
- **M6.** Cancelaciones en OTASync de reservas corporativas PAGADAS se saltan en silencio: el filtro `^COT-` no verifica `status==='tentative'` como sí hace `isHoldReservation` (`otasync-webhook.js:144-146`).
- **M7.** `createConfirmedReservation` manda `discount_amount: 0` y total sin IVA/INC → el folio de Kunas nunca cuadra con el pago registrado (`_otasync.js:661-664`).
- **M8.** Recordatorio de vencimiento de cotización enlaza sin `publicToken` → "Cotización no encontrada" al 100% cuando se active el flag (`revalidate-quotes.js:155`).

**Motor de reservas:**
- **M9.** Con cupón aplicado, la pantalla de confirmación y el correo dicen el monto SIN descuento (Wompi cobró menos) (`motor-app.jsx:1375,1929-2036`).
- **M10.** Checkout == checkin permitido en la UI → 400 del servidor mostrado como falso "sistema caído" (`motor-app.jsx:202`, `check-availability.js:76`).
- **M11.** El draft de sessionStorage guarda la habitación sin precio → "$ NaN" al restaurar si el fetch de disponibilidad falla (`motor-app.jsx:1750-1754`).

**Guest app / seguridad:**
- **M12.** El control anti-documento-duplicado (A-20) es código muerto: `normalizeGuestEntry` descarta `documentRef` antes de que `validateGuests` lo compare (`guest-checkin.js:658-716`).
- **M13.** Segundo factor de `guest-session` acepta tokens de apellido de 2 letras ("de", "la") — más débil que el de `get-booking` (mínimo 3) (`_guest-app.js:236-248`).
- **M14.** `iam-admin` `upsert-user`: despojar de roles a un admin ACTIVO no pasa por la guarda "nunca cero admins" (solo la pasa suspender/borrar) (`iam-admin.js:184-193`). Mitigado por ADMIN_EMAILS env.

**Portal / build:**
- **M15.** Portal sin allowlist configurada = cualquier cuenta Google verificada recibe sesión `residente` (no falla cerrado; solo relevante si se enciende PORTAL_ENABLED sin poblar listas) (`portal-session.js:254-264`).
- **M16.** `build.js` inyecta GA4 + skip-link dentro de la plantilla de correo `invite.html` → el correo de invitación sale con un link "Saltar al contenido principal" visible (`build.js:122,210-282`).

## BAJOS (12, resumen)

- Falsa alerta "Doble pago detectado" cuando el lock lo tiene el mismo tx (pide reembolsar un pago legítimo) — `wompi-webhook.js:598-613`.
- `preferenceForQuote` (MP) sin `publicToken` ni rate limit → enumeración de cotizaciones B2B — `create-mercadopago-preference.js:97-151`.
- `{ ttl }` pasado a Blobs no existe en ~10 sitios → `processed-transactions`/`booking-results` crecen para siempre (los comentarios de diseño sobre expiración son falsos) — varios archivos.
- Catch del pago de servicio GST- confunde "folio falló" con "marcado falló" → riesgo de doble cargo manual vía retry-folio — `wompi-webhook.js:524-538`.
- Camino directo MP (rollback OFF) sin correo de confirmación, sin snapshot de reembolso, sin descuentos — `_payments.js:362-681`.
- Ruta legacy `?d=` de `get-quote` renderiza JSON arbitrario (spoofing con la marca) — `get-quote.js:87-103`.
- `err.message` interno expuesto en respuestas 500 de 5 funciones de quotes.
- Clave i18n `stepRoom` no existe (eyebrow vacío en confirmación) — `motor-app.jsx:1355`.
- `?guests=25` en la URL → falso mensaje de outage — `motor-app.jsx:62-63`.
- Skip-link duplicado en todas las páginas (doble parada de Tab) — `build.js:276` + `shell.js:886`.
- 404 inglés sin estilos en rutas de 2+ segmentos y con skip-link en español — `build.js:292-298`, `netlify.toml:175-178`.
- Caché del calendario atascada en 'loading' si la API responde 200 sin `rooms` — `kunas.js:110-113`.
- `_crypto-vault`: redefinir `k1` en el key ring brickea los sobres v1 históricos — `_crypto-vault.js:63-64,146`.

## Verificado y descartado (no re-auditar)

- Verificación de montos Wompi (firma con tope $5 COP, webhook ±100 centavos): sin bypass.
- Motor de cupones: CAS atómico, idempotente por reserva, sin viaje del código en la referencia.
- Tokens Firebase (`_firebase-auth`): firma, aud, iss, exp, iat, kid — correcto.
- Demo-grant: imposible en deploy Netlify.
- Separación de audiencias guest/portal/staff: correcta (secretos distintos + purpose).
- Magic-link: single-use CAS, TTL 15 min, fail-closed en prod.
- Whitelist de settings: ningún secreto puede entrar al panel.
- Gate de cancelación del bot (código, no prompt): sin bypass, doble candado.
- Firma del webhook WhatsApp sobre raw body: correcta.
- CSP: hashes calculados sobre el HTML final; completo.
- Pipe `|` en nombres: sanitizado antes de armar la referencia.
- Consent Mode: denied por defecto, update solo en opt-in.
