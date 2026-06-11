# 🏛️ AUDITORÍA 360° — HOTEL ESTAR
### Informe del Comité de Dirección Tecnológica y de Negocio (C-Suite)

**Fecha:** 2026-06-11
**Alcance:** Repositorio completo (código fuente, funciones serverless, tests, assets). **Excluido:** `dist/`, `node_modules/`.
**Modo:** Solo lectura / diagnóstico. No se modificó ningún archivo del proyecto.
**Método:** Análisis estático, rastreo de flujos de datos extremo a extremo, ejecución de la suite de pruebas (`npm run test:unit` → **139/139 OK**) y auditoría de dependencias (`npm audit`).

> **Veredicto ejecutivo:** La plataforma es **notablemente madura** para un proyecto sin framework: el flujo de pago activo (Wompi) recomputa precios en el servidor, verifica firmas en tiempo constante, deduplica transacciones y tiene locks contra doble-reserva en cotizaciones. Sin embargo, existen **3 hallazgos críticos** que permiten crear reservas confirmadas sin pagar, manipular el precio en el flujo de Mercado Pago, y un **vacío de reconciliación** que deja pagos directos huérfanos sin alerta. Además hay exposición de PII y retención indefinida de documentos de identidad que implican riesgo legal (Ley 1581). Ninguno bloquea la operación hoy, pero el #1 y #2 son **explotables de forma remota y anónima**.

---

## 0. ✅ ESTADO DE REMEDIACIÓN (actualizado tras la implementación)

> El diagnóstico abajo se conserva tal cual (snapshot). Tras la auditoría se implementaron las correcciones acordadas con el negocio. Estado actual:

| ID | Hallazgo | Estado | Resolución |
|---|---|---|---|
| C-1 | `create-booking` crea reservas sin pago | ✅ Resuelto | Endpoint retirado (410); el webhook es el único creador de reservas |
| C-2 | Precio manipulable en Mercado Pago | ✅ Resuelto | Recompute server-side + gate de disponibilidad, paridad con Wompi |
| C-3 | Reconciliación ciega a reservas directas | ✅ Resuelto | `reconcile-payments` cubre reservas directas (alerta de pago-sin-reserva) |
| A-1/A-2 | PII por código / acceso huésped | ✅ Resuelto (proporcionado) | `get-booking` exige segundo factor (email o apellido); se mantiene el apellido como llave de la guest app, sin PIN |
| A-3 | Retención indefinida de PII | ✅ Resuelto | Cron `purge-guest-data`: retención **5 años** (decisión de negocio) |
| A-4 | Doble reserva directa | ✅ Resuelto | Idempotencia por estadía en el webhook directo |
| A-5 | Rate-limit no atómico | ✅ Mitigado | Compare-and-set (etag) con fallback |
| A-6 | Sin telemetría de conversión | ✅ Resuelto | Funnel GA4 e-commerce + conversión server-side (Measurement Protocol) + píxeles opcionales |
| A-7 | Sin consentimiento de cookies | ✅ Resuelto | Banner + Consent Mode v2 (opt-in, denegado por defecto) |
| M-1 | CVE en dependencias | ✅ Resuelto | `googleapis` reemplazado por `@googleapis/drive` standalone (204 MB → 2.4 MB; el monolito reventaba el límite de 250 MB por función en Netlify), `npm audit`: 0 vulnerabilidades |
| M-2 | Precios duplicados | ✅ Resuelto | `_pricing.js` único + test anti-divergencia front/back |
| M-5 | Huecos de tests | ✅ Mejorado | Tests de regresión para C-1, A-1/A-2, A-3, C-3, M-2 |
| M-6 | Skip-link parcial | ✅ Resuelto | Inyección en build-time en todas las páginas |
| M-7 | Escaping inconsistente | ✅ Resuelto | `renderCart` escapa el nombre del servicio |
| M-3 | Errores enmascarados como 200 | ⏳ Pendiente | Requiere panel de operación (Fase 3) |

**Pendiente de tu parte (sólo configuración en Netlify, sin código):** `GA4_API_SECRET` (conversiones server-side), y `META_PIXEL_ID` / `GOOGLE_ADS_ID` si quieres activar remarketing. Sin ellos, todo funciona; sólo no se envían esas señales.

---

## 1. 🚨 HALLAZGOS CRÍTICOS

### 🔴 C-1 — `create-booking` crea reservas CONFIRMADAS sin verificar el pago (AppSec / Revenue)
**Severidad: CRÍTICA** · **Explotable anónimamente** · `netlify/functions/create-booking.js`

El endpoint público `/api/create-booking` inserta una reserva con `status:"confirmed"` en OTASync **independientemente de si hubo pago**. El estado de pago se toma del cuerpo de la petición que envía el cliente:

```js
// create-booking.js:427-439
const paymentInfo = [];
if (paymentDetails && (paymentDetails.status === 'APPROVED' || paymentDetails.status === 'PENDING')) {
    const actuallyCollected = clientPaidAmount > 0 ? clientPaidAmount : roomPrice;
    paymentInfo.push({ amount: actuallyCollected, ... note: `Wompi ID: ${paymentDetails.id}, ... Status: ${paymentDetails.status}` });
}
// ...y SIEMPRE se inserta:
status: "confirmed",   // create-booking.js:446
```

No hay autenticación, no se valida la transacción contra Wompi, y la firma de pago nunca se comprueba. Cualquiera puede hacer `POST /api/create-booking` con fechas/habitación válidas y `paymentDetails:{status:'APPROVED', id:'falso'}` y obtener una reserva confirmada en el PMS. El rate-limit es de **6 req/min por IP** (`create-booking.js:146`), suficiente para **agotar inventario** (denegación de inventario / overbooking malicioso) o sembrar reservas fraudulentas.

**Matiz importante:** el flujo de producción actual de `motor-app.jsx` **ya no usa** este endpoint — la reserva la crea exclusivamente el webhook de pago y el front solo hace *polling* de `booking-status` (ver `motor-app.jsx:1632-1704`). Es decir, **`create-booking` es un endpoint huérfano que quedó desplegado y sigue siendo invocable**. El `CLAUDE.md` todavía lo documenta como vía activa, lo que agrava el riesgo de que se reactive por error.

**Recomendación:** Deshabilitarlo (retirar del despliegue / responder 410) o, si se conserva como respaldo, exigir prueba criptográfica del pago: consultar la transacción contra la API de Wompi por `transaction.id` y validar `status===APPROVED` + monto + referencia server-side **antes** de insertar. Nunca confiar en `paymentDetails` del cliente.

---

### 🔴 C-2 — Manipulación de precio en el flujo de Mercado Pago (AppSec / Revenue)
**Severidad: CRÍTICA (latente — sólo si `PAYMENT_PROVIDER=mercadopago`)** · `create-mercadopago-preference.js`, `_payments.js`

En el flujo de reserva directa de Mercado Pago, el **monto a cobrar se toma directamente del cliente** sin recomputarlo nunca contra OTASync:

```js
// create-mercadopago-preference.js:151-173 (preferenceForDirectBooking)
const amountCents = Math.max(0, parseInt(body.amountCents, 10) || 0);   // ← del cliente
...
const reference = createDirectReference({ ..., amountCents });          // se firma en la referencia
// unit_price: amountCents / 100  → la preferencia MP se crea por ESE monto
```

Y el webhook sólo compara el monto pagado contra el valor que el propio cliente metió en la referencia:

```js
// _payments.js:344 (processDirectPayment)
if (decoded.amountCents && Math.abs(transaction.amountCents - decoded.amountCents) > 100) { ...reject... }
// decoded.amountCents == el amountCents del cliente → la comprobación es circular
```

Un atacante puede pedir `amountCents: 100` ($1 COP) para una habitación de $300.000, pagar $1 en MP, y el webhook crea la reserva confirmada en OTASync porque "el monto pagado coincide con el esperado". El flujo de **Wompi sí está protegido** (recomputa vía `_direct-pricing.verifyDirectBookingAmount`, ver `create-wompi-signature.js:106-135`); el de MP **no tiene equivalente**. Como MP es el proveedor de *rollback*, esto es una mina latente: el día que se active `PAYMENT_PROVIDER=mercadopago`, la tienda queda con precios manipulables.

**Adicional (mismo archivo):** `processDirectPayment` tampoco hace el chequeo final de disponibilidad (`findAvailableRoomId`) que sí hace el path de Wompi (`wompi-webhook.js:897-947`), e inserta `id_rooms: 0` → **riesgo de overbooking** en el flujo MP.

**Recomendación:** Antes de activar MP, replicar en `preferenceForDirectBooking` la recomputación server-side de `_direct-pricing.js` y el gate de disponibilidad. Ignorar `body.amountCents`; calcularlo desde OTASync.

---

### 🔴 C-3 — La reconciliación de pagos IGNORA las reservas directas (Revenue / DevOps)
**Severidad: CRÍTICA (pérdida silenciosa de reservas)** · `netlify/functions/reconcile-payments.js`

El cron de reconciliación (cada 30 min) existe precisamente para atrapar pagos cuyo webhook nunca llegó. Pero **descarta todas las transacciones que no sean cotizaciones**:

```js
// reconcile-payments.js:132-134
const isQuote = /^COT-\d{4}-[A-Z0-9]{5}$/.test(ref);
if (!isQuote) continue;   // ← las reservas directas (el flujo principal del consumidor) se saltan
```

El flujo **principal** del motor de reservas (huésped individual) genera referencias base64, **no** `COT-...`. Por tanto, si un huésped paga en Wompi y el webhook falla (timeout, 500, error de firma, despliegue en curso), **nadie se entera**: la reserva no se crea en OTASync y el cron no la reporta. El comentario del archivo afirma que cubre "esos huecos", pero en la práctica sólo cubre cotizaciones corporativas (un volumen menor). Es una **brecha de ingresos y de experiencia**: el huésped pagó y no tiene habitación, y el hotel no lo sabe hasta que el huésped reclama.

**Recomendación:** Extender el reconciliador a referencias directas: decodificar la referencia, comprobar contra el blob `booking-results` (`direct-<code>`) y alertar/crear cuando falte. La infraestructura de dedup ya existe; sólo falta levantar el filtro.

---

## 2. 🟠 HALLAZGOS ALTOS Y MEDIOS

### 🟠 A-1 — Fuga de PII por código de reserva, sin autenticación (AppSec / Legal)
`netlify/functions/get-booking.js` · **Alto**

`GET /api/get-booking?code=<id>` devuelve nombre del huésped, habitación, fechas, monto total y estado **sin pedir ningún factor de verificación** (a diferencia de `guest-session`, que sí exige apellido). Los `id_reservations` de OTASync suelen ser enteros secuenciales → **enumerables**. Con rate-limit de 15/min (`get-booking.js:89`) un atacante puede recorrer el espacio e indexar la base de huéspedes (quién se hospeda, cuándo y cuánto pagó). Es exposición de datos personales y vector de *doxing*/ingeniería social.

**Recomendación:** Exigir un segundo factor (apellido o email parcial) como en `guest-session`, o devolver sólo existencia/estado sin PII.

### 🟠 A-2 — Cadena de toma de sesión de huésped (enumeración + apellido) (AppSec)
`netlify/functions/_guest-app.js:208-220` (`matchesAccessKey`), `guest-session.js` · **Alto**

La "clave de acceso" del huésped es **el apellido** (o email), y el emparejamiento acepta que el término coincida con **cualquier token** del apellido:

```js
// _guest-app.js:212-214
if (lastName) {
  return lastName === candidate || lastName.split(' ').includes(candidate);
}
```

Encadenado con **A-1** (que filtra el nombre del titular por código), un atacante: (1) enumera `get-booking` hasta hallar un código válido y leer el apellido, (2) usa ese apellido como `accessKey` para emitir un token de huésped de 24 h. Con ese token puede consultar la reserva ajena y **enviar check-ins, pedidos, contratos firmados o solicitudes de cancelación** a nombre de otro huésped (`guest-checkin.js`, `guest-action.js`). El rate-limit de `guest-session` (10/10 min/IP) frena fuerza bruta pero no un atacante distribuido.

**Recomendación:** Tratar el apellido como identificador, no como secreto. Sumar un segundo factor real (PIN enviado por email/SMS al reservar) y exigir coincidencia de apellido **completo**, no por token.

### 🟠 A-3 — Retención indefinida de documentos de identidad y PII (Legal / AppSec)
`netlify/functions/guest-checkin.js:799, 805, 842, 852` · **Alto (Compliance)**

Los expedientes de check-in (PII cifrada AES-256-GCM) y los binarios de documentos (cédulas, pasaportes, **registros civiles de menores**) se guardan en Netlify Blobs **sin TTL**:

```js
// guest-checkin.js:799 — sin opción ttl → retención indefinida
await deps.guestStore('guest-checkins').setJSON(checkinId, deps.protectRecord(record));
// 805/842/852 — guest-documents / guest-minor-documents .set(...) sin ttl
```

(Los *borradores* sí tienen TTL de 24 h, pero los registros finales no.) Bajo la **Ley 1581 de 2012** (habeas data) y su decreto reglamentario, el responsable debe definir finalidad y **periodo de retención**, y suprimir cuando cesa la finalidad. Guardar indefinidamente documentos de menores es especialmente sensible. No se observa política ni job de expiración/borrado. El cifrado está bien implementado (IV aleatorio de 12 bytes por registro, `_guest-app.js:307-327`), pero el cifrado no sustituye la minimización/retención.

**Recomendación:** Definir TTL/retención (p. ej. eliminar tras el check-out + X días), documentarlo en la política de privacidad y agregar un cron de purga. Confirmar base de licitud para tratar documentos de menores.

### 🟠 A-4 — Doble cobro → doble reserva en el flujo directo de Wompi (Arquitectura / Revenue)
`wompi-webhook.js` vs `_quote-lock.js` · **Medio-Alto**

Las cotizaciones tienen un *lock* por `quoteId` (`acquireQuoteLock`) que evita doble-reserva ante dos webhooks. El **flujo directo no tiene lock equivalente por estadía**: se apoya sólo en dedup por `transaction.id` y en el blob `booking-results['direct-<code>']`. Como cada intento de pago genera un `code` nuevo en el cliente (`motor-app.jsx:719 genCode()`), si un huésped paga dos veces (dos dispositivos/reintentos) se generan **dos códigos distintos → dos reservas en OTASync**. `create-booking` sí tiene idempotencia por `room+fechas+email` (`create-booking.js:228`), pero el webhook (la vía real) no.

**Recomendación:** Añadir idempotencia a nivel de estadía en el webhook directo (clave `roomType|checkin|checkout|email`) análoga a la de `create-booking`.

### 🟠 A-5 — Rate-limit no atómico y por instancia (AppSec / DevOps)
`netlify/functions/_rate-limit.js:28-53` · **Medio**

El limitador hace *read-modify-write* no atómico sobre Blobs: dos peticiones concurrentes pueden leer el mismo `count`, incrementar y guardar, **excediendo el límite** bajo carga. Si Blobs no está disponible, cae a un `Map` **en memoria por instancia** (`_rate-limit.js:5,49-52`) — en serverless con N instancias el límite efectivo se multiplica por N y se reinicia en cada cold start. Suficiente para casos normales, débil contra un atacante decidido (p. ej. *email bombing* vía `send-confirmation`/`request-quote`, o enumeración de A-1).

**Recomendación:** Documentar que es *best-effort*. Para endpoints sensibles considerar el operador atómico de Blobs (`onlyIfNew`/CAS, ya usado en `_quote-lock.js`) o un store con incremento atómico.

### 🟠 A-6 — Telemetría de conversión inexistente (Analista de Datos)
`build.js:159-177` · **Medio (ceguera de negocio)**

El build inyecta **únicamente** el snippet base de GA4 (`gtag('config', ...)`) en todas las páginas. No existe **ni un solo evento** de e-commerce/funnel en todo el código (`grep` de `gtag`/`dataLayer`/`purchase`/`begin_checkout` → 0 coincidencias en `motor-app.jsx`, `shell.js`, `kunas.js`). Consecuencias:
- No se mide `view_item` / `begin_checkout` / `add_payment_info` / **`purchase`** → imposible calcular **tasa de conversión, abandono por paso del motor, ni ROAS**.
- No hay `transaction_id`/value en GA4 → no se atribuyen ingresos a campañas.
- Sin píxel de Meta/Google Ads → no se pueden optimizar campañas ni hacer *remarketing* de carritos abandonados.

**Recomendación:** Instrumentar el funnel de 4 pasos con eventos GA4 e-commerce (incl. `purchase` con `transaction_id`, `value`, `items`) en `motor-app.jsx`, y enviar la conversión también desde el webhook (server-side, Measurement Protocol) para no perder ventas por bloqueadores. Añadir consentimiento de cookies (ver A-7).

### 🟠 A-7 — Cookies/analítica sin gestión de consentimiento (Legal)
`build.js` inyecta GA4 incondicionalmente · existe `cookies.html` · **Medio**

GA4 se carga en todas las páginas **antes de cualquier consentimiento**. Hay página `cookies.html` y `privacidad.html`, pero no se observa banner de consentimiento ni *Consent Mode v2*. Para visitantes de la UE/UK (la web es bilingüe y apunta a "nómadas digitales") esto incumple ePrivacy/GDPR. En Colombia el estándar es más laxo, pero el público objetivo internacional eleva el riesgo.

**Recomendación:** Implementar banner + Google Consent Mode v2; cargar GA4/píxeles sólo tras *opt-in* analítico.

### 🟡 M-1 — Dependencias con CVE moderado (AppSec / DevOps)
`npm audit` · **Bajo-Medio**

4 vulnerabilidades **moderadas**: `uuid <11.1.1` (GHSA-w5hq-g745-h8pq, *missing buffer bounds check*) arrastrada transitivamente por `googleapis@144`→`googleapis-common`→`gaxios`→`uuid`. No hay vulnerabilidades altas/críticas. `googleapis` sólo se usa en la integración con Drive (server-side), por lo que la superficie es limitada.

**Recomendación:** Programar `npm audit fix --force` (sube `googleapis` a 173 — *breaking*, requiere prueba de la integración Drive) en una ventana de mantenimiento.

### 🟡 M-2 — Fuentes de verdad de precios duplicadas → riesgo de divergencia (Arquitectura QA / Revenue)
`_otasync.js:154-155`, `check-availability.js:117-120,256,273`, `_direct-pricing.js:47-58`, `guest-action.js:64-71` · **Medio**

Las constantes de pricing están **repetidas en varios archivos** sin única fuente de verdad:
- Recargo por huésped extra `31000` y *fallback* `195000`: duplicados en `_otasync.js` **y** `check-availability.js` (×3).
- Precios de extras del motor (`desayuno 20000`, `late 60000`, `early 50000`) viven en `_direct-pricing.js` **y** en el front (`motor-app.jsx`), y deben mantenerse en sync manualmente (el propio comentario lo admite: *"Keep these in sync with reservar.html / motor-app.jsx"*).
- El catálogo de servicios de la guest-app (`guest-action.js`: `breakfast 28000`, `late_checkout 80000`, `airport_transfer 120000`) usa **precios distintos** a los extras del motor para conceptos análogos.

Si alguien actualiza una tarifa en un sitio y no en los otros, la verificación de precio server-side rechazará pagos legítimos (`price_mismatch`) o cobrará de más. Es deuda técnica con impacto directo en ingresos y en disponibilidad del checkout.

**Recomendación:** Centralizar todas las constantes de pricing en un módulo único (o en `rooms_db.json`) consumido por front y back. Aclarar si los precios de la guest-app deben coincidir con los del motor.

### 🟡 M-3 — Manejo de errores que enmascara fallos como éxito 200 (Arquitectura QA)
Múltiples webhooks · **Medio (por diseño, pero opaco)**

Por diseño (correcto para no provocar reintentos infinitos del proveedor), casi todos los caminos de error de los webhooks devuelven **HTTP 200** con un mensaje interno y dependen de un **email al admin** como única red de seguridad (`wompi-webhook.js:888-893, 1148-1152`; `_payments.js:295`). Si `RESEND_API_KEY` no está configurada, `sendEmail` retorna silenciosamente `{sent:false}` (`_email.js:28-30`) y **la alerta se pierde**: pago cobrado, reserva no creada, y **nadie notificado**. La observabilidad depende enteramente de un canal frágil (email) sin *dead-letter queue* ni dashboard.

**Recomendación:** Persistir los estados "pagado sin reserva" en un store consultable (ya existe parcialmente vía `reservationPending` en cotizaciones; falta para directas) y construir un panel de operación. No depender sólo de email.

### 🟡 M-4 — `_env` carga `.env` con `eval`-like parsing y `motor-app.js` versionado (DevOps)
`server.js`, `.gitignore` · **Bajo**

`motor-app.js` (artefacto compilado) está en `.gitignore` correctamente, pero conviene verificar que no se haya colado en historial. `_env.js` sólo actúa fuera de producción (bien). Sin observaciones graves; `.gitignore` es completo (cubre `.env*`, `dist/`, `uploads/`, salidas de scraper).

### 🟡 M-5 — Cobertura de pruebas: huecos en los caminos críticos de dinero (Arquitectura QA)
`tests/` · **Medio**

La suite es sólida en lógica pura (139 tests, firma Wompi, math de cotizaciones, locks, pricing server-side). Pero faltan pruebas de los escenarios de mayor riesgo de negocio:
- **No hay test** que verifique que `create-booking` rechaza pagos no verificados (porque hoy **no los rechaza** — ver C-1).
- **No hay test** del path directo de Mercado Pago contra manipulación de monto (C-2).
- **No hay test** de reconciliación de reservas **directas** (C-3) — sólo de cotizaciones.
- **No hay test** de concurrencia de doble-pago en flujo directo (A-4).
- E2E (`booking-flow.spec.js`, 71 líneas) cubre el *happy path*, no los fallos de webhook ni overbooking.

**Recomendación:** Añadir tests de regresión para C-1…C-3 y A-4 antes de cerrarlos; servirán de red permanente.

### 🟡 M-6 — Accesibilidad: buena base, huecos puntuales (Experto A11y)
HTML del sitio · **Medio**

Aspectos positivos verificados: **0 imágenes sin `alt`** en las 75 `<img>` de raíz, 296 usos de `aria-*`/`role`, formularios con `<label>`, `lang` declarado, `prefers-reduced-motion` esperable en CSS. Huecos:
- **Skip-link presente sólo en `index.html` y `nosotros.html`** — falta en el resto (reservar, guest, contacto, etc.), dificultando navegación por teclado.
- El cursor-estrella custom y reveals por scroll deben verificarse contra `prefers-reduced-motion`.
- El motor (`motor-app.jsx`) y la guest-app construyen UI dinámica; conviene auditar foco gestionado, `aria-live` para errores de pago y navegabilidad por teclado del carrusel/datepicker (`kunas.js`).

**Recomendación:** Propagar el skip-link a todas las plantillas; pasar un audit axe-core en CI sobre las páginas clave (home, reservar, guest).

### 🟡 M-7 — XSS de bajo riesgo e inconsistencia de *escaping* (AppSec)
`guest-app.js:1534-1536` · **Bajo**

`renderCart()` interpola `item.name` en `innerHTML` **sin escapar**, mientras que `renderGuestCards()` (línea 634) sí usa `escHtml`. Hoy `item.name` proviene de un catálogo estático server-side, no de input del usuario, así que no es explotable; pero es una inconsistencia que se vuelve peligrosa si el catálogo pasa a ser dinámico. El resto de sinks (`shell.js`, emails) escapan correctamente (`escapeHtml`/`esc`).

**Recomendación:** Escapar `item.name` por defensa en profundidad y uniformidad.

---

## 3. ✅ FORTALEZAS RECONOCIDAS (lo que está bien hecho)

Para calibrar el riesgo, el comité destaca decisiones de ingeniería **acertadas**:

- **Firma Wompi robusta:** verificación en **tiempo constante** (`crypto.timingSafeEqual`), validación de formato hex, y validación de las rutas de propiedades de firma contra regex para evitar traversal (`wompi-webhook.js:175-214`). Fail-closed si falta `WOMPI_WEBHOOK_SECRET`.
- **Precio server-side en Wompi:** el flujo activo recomputa el subtotal desde OTASync y rechaza montos manipulados, con *fail-closed* en producción si faltan credenciales (`create-wompi-signature.js`, `_direct-pricing.js`; test "fails closed in production").
- **Locks anti doble-reserva** en cotizaciones vía `onlyIfNew` (CAS) con TTL y detección de *staleness* (`_quote-lock.js`).
- **Dedup de transacciones** en memoria + Blobs persistente con TTL 24 h (`wompi-webhook.js:20-37, 740-792`).
- **Auth admin sólida:** verificación real de Firebase ID token (RS256 contra certificados de Google, `aud`/`iss`/`exp`/`iat`/`email_verified` + allowlist) sin dependencias (`_firebase-auth.js`).
- **Cifrado de PII** AES-256-GCM con IV por registro (`_guest-app.js:307-327`).
- **CSP endurecida:** `script-src` con hashes SHA-256 por script inline (sin `'unsafe-inline'`), generada en build (`build.js:534-584`).
- **SEO técnico fuerte:** canonical + `hreflang` es/en/x-default, OpenGraph/Twitter, **JSON-LD `LodgingBusiness`** con geo/dirección/horarios, sitemap con 38 URLs incluyendo `/en/`, `robots.txt` que excluye `/api/` y páginas noindex.
- **Tax math de cotizaciones** correcta (IVA 19% + INC 8% con descuento prorrateado, `_quotes-store.js:174-218`).

---

## 4. ❓ PREGUNTAS CLAVE PARA EL NEGOCIO (Fundadores)

1. **IVA diferido al check-in:** El cobro online es **siempre el subtotal SIN IVA** (`motor-app.jsx:745,771`); para colombianos/viajeros de negocio el IVA (19%) se marca "por cobrar en alojamiento". ¿Existe un control operativo **garantizado** en recepción para cobrar ese IVA? Si el huésped no aparece o disputa, ¿quién asume la exposición fiscal? ¿Se concilia el IVA cobrado en recepción contra los "notes" de OTASync?

2. **Exención de IVA autodeclarada:** La condición de "turista extranjero exento" se basa en país y motivo **autodeclarados** por el huésped (`isColombianGuest`/`isBusinessGuest`). ¿La DIAN aceptaría esta autodeclaración sin validación documental en el momento del pago? ¿Cuál es el procedimiento de validación en arribo y su tasa de cumplimiento real?

3. **`create-booking` huérfano (C-1):** ¿Es un respaldo intencional o código muerto? Si es respaldo, ¿bajo qué circunstancia se reactivaría y quién es responsable de que no cree reservas sin pago?

4. **Mercado Pago como rollback (C-2):** ¿Cuál es el *runbook* exacto para activar MP? ¿Existe checklist que obligue a portar la verificación de precio de Wompi antes de cambiar `PAYMENT_PROVIDER`? Hoy activarlo abriría la manipulación de precio.

5. **Pagos directos huérfanos (C-3):** ¿Con qué frecuencia histórica han fallado webhooks? ¿Cómo se ha detectado hasta ahora un "pagó pero no tiene reserva" en el flujo de huésped individual, si el cron no lo cubre?

6. **Retención de datos (A-3):** ¿Cuál es la política de retención **declarada** para documentos de identidad y registros civiles de menores? ¿Hay encargado de tratamiento (Netlify/Google Drive) con contrato de transferencia internacional de datos firmado?

7. **Holds en OTASync (`bloquearHabitaciones`):** Los holds tentativos bloquean inventario real. ¿Hay límite de cuántas cotizaciones pueden mantener holds simultáneos? ¿Qué pasa si el cron `revalidate-quotes` falla y los holds no se liberan — se pierde inventario vendible?

8. **Estrategia de conversión (A-6):** Sin medición de funnel ni `purchase`, ¿cómo se decide hoy la inversión en marketing? ¿Se ha cuantificado el abandono entre "ver habitación" y "pago confirmado"?

9. **Precios divergentes guest-app vs motor (M-2):** ¿Son productos distintos a propósito (desayuno $20k en reserva vs $28k in-stay) o un descuadre? Impacta la percepción de precio del huésped.

---

## 5. 🗺️ PLAN DE ACCIÓN Y VISIÓN DE FUTURO

### Fase 0 — Contención inmediata (días 1-3) · *detener la hemorragia*
| # | Acción | Esfuerzo |
|---|---|---|
| C-1 | Deshabilitar `/api/create-booking` (responder 410) o exigir verificación de pago server-side contra Wompi. Actualizar `CLAUDE.md`. | S |
| C-2 | **Bloquear** la activación de Mercado Pago hasta portar la verificación de precio + gate de disponibilidad. Añadir guard en CI/checklist. | S |
| C-3 | Extender `reconcile-payments` a referencias directas (decodificar + comprobar `booking-results` + alertar). | M |
| A-3 | Definir y aplicar TTL/retención a `guest-checkins`/`guest-documents`/`guest-minor-documents`; documentar en privacidad. | M |
| M-3 | Verificar que `RESEND_API_KEY` y `ADMIN_NOTIFY_EMAIL` están configurados en prod (la red de seguridad depende de email). | S |

### Fase 1 — Estabilización (semanas 1-3) · *cerrar los flancos*
- **A-1/A-2:** Añadir segundo factor real al acceso de huésped y a `get-booking`; exigir apellido completo.
- **A-4:** Idempotencia por estadía en el webhook directo.
- **A-5:** Endurecer rate-limit en endpoints sensibles (CAS atómico).
- **M-5:** Tests de regresión para C-1…C-3 y A-4 (que fallen hoy y pasen tras el fix).
- **M-1:** Ventana para `npm audit fix --force` + prueba de integración Drive.
- **M-2:** Centralizar constantes de pricing en módulo único.

### Fase 2 — Crecimiento y medición (semanas 4-8) · *ver para vender*
- **A-6:** Instrumentar funnel GA4 e-commerce (`view_item`→`purchase`) en `motor-app.jsx` + conversión server-side desde webhook (Measurement Protocol). Píxel de Google Ads/Meta.
- **A-7:** Banner de consentimiento + Consent Mode v2.
- **M-6:** Propagar skip-link; axe-core en CI sobre home/reservar/guest.
- **M-3:** Panel de operación para pagos/reservas pendientes (sustituir dependencia de email).
- Revisar el `informe_revision_legal.md` existente y cerrar sus pendientes junto con A-3/A-7.

### Fase 3 — Escala (trimestre 2) · *robustez de plataforma*
- Migrar la lógica de pago/reserva a una máquina de estados explícita con *dead-letter queue* (idempotencia, reintentos, auditoría) en lugar de webhooks que devuelven 200 + email.
- Observabilidad: métricas de tasa de éxito de webhook, latencia OTASync, *orphans* de pago, en un dashboard.
- Pruebas de carga/concurrencia sobre el camino de dinero (overbooking, doble-pago).
- Evaluar consolidar las dos fuentes de pricing (motor vs guest-app) y el inventario/holds bajo un único servicio.

---

### Resumen de severidades
| Severidad | Hallazgos |
|---|---|
| 🔴 Crítica | C-1 (reserva sin pago), C-2 (precio MP manipulable), C-3 (reconciliación ciega a directas) |
| 🟠 Alta | A-1 (PII por código), A-2 (toma de sesión huésped), A-3 (retención indefinida), A-4 (doble reserva directa), A-6 (sin telemetría), A-7 (consentimiento) |
| 🟡 Media/Baja | A-5, M-1…M-7 |

> **Cierre del comité:** Los fundamentos de seguridad del **flujo activo (Wompi)** son sólidos y reflejan buen criterio de ingeniería. El riesgo concentrado está en (a) un **endpoint legacy que quedó vivo** (C-1), (b) un **proveedor de rollback sin paridad de seguridad** (C-2), y (c) un **punto ciego de reconciliación** (C-3). Resolver la Fase 0 elimina la exposición explotable; la Fase 2 desbloquea la capacidad de **medir y escalar la captación**, hoy inexistente. Recomendamos no activar Mercado Pago ni promocionar `get-booking`/guest-app a gran escala hasta cerrar Fase 0-1.

*— Fin del informe. Generado en modo solo-lectura; no se modificó ningún archivo del proyecto salvo la creación de este documento.*
