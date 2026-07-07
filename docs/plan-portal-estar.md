# Blueprint maestro — Portal Estar

> Fecha: 2026-07-07 · Estado: **propuesta de arquitectura, NO implementada**.
> Todo lo descrito nace **apagado por defecto** (gated OFF vía `_settings.flag`) y
> queda **pendiente de review** funcional, de seguridad y **legal (abogado)** antes
> de encenderse en producción.
> Relacionado: [`plan-integracion-odoo-otasync.md`](plan-integracion-odoo-otasync.md),
> [`plan-facturacion-numera.md`](plan-facturacion-numera.md),
> [`firma-electronica-colombia.md`](firma-electronica-colombia.md),
> [`guest-app.md`](guest-app.md).

Este documento es el **plano de ingeniería** del Portal Estar: qué funciones
nuevas se crean, con qué flag / permiso / ruta `/api` / store de Blobs, y **qué
reutiliza** del código existente. No introduce ningún efecto activo por sí mismo:
es la referencia para construir cada pieza de forma incremental, siempre detrás de
un flag OFF.

---

## 0. Principios que gobiernan TODO el portal

1. **Gated OFF por defecto** (convención #7). Cada superficie y cada efecto se
   cortocircuita con `if (!(await flag('XXX_ENABLED'))) return inerte;` antes de
   ejecutar nada. Sin el flag, la función responde inerte y nunca toca red ni datos.
2. **Mock-safe** (convención #2). Sin credenciales (`OTASync`, `Odoo`, `Resend`,
   `Drive`, `Twilio`, `WhatsApp`, `DataCrédito`, proveedor de pagaré) toda función
   devuelve `{isMock:true}` / no-op logueado y **nunca lanza**.
3. **Identidad ≠ autorización.** El portal de **clientes** (empresa / residente) usa
   un **token de sesión propio firmado** (patrón `guest-session`), NO expone
   credenciales de OTASync/Odoo al cliente (convención #8). El **staff** que aprueba
   crédito / gestiona cobranza usa **Firebase + `authorize(event, 'permiso')`**.
4. **Human-in-the-loop en crédito** (convención #12). La IA **solo emite una
   recomendación** (`aprobar` / `requiere_codeudor` / `rechazar`) con justificación;
   la **decisión de crédito la toma SIEMPRE un humano** con permiso `credito.aprobar`.
   La IA jamás aprueba ni reporta sola.
5. **PII financiera cifrada en reposo** (convenciones #11 y Ley 1266): extractos,
   consulta DataCrédito y pagaré se guardan **cifrados** con el patrón
   `_crypto-vault` (`seal`/`open`, AAD = `bookingCode|type`) + **consentimiento
   explícito registrado**. Nada en claro.
6. **Cobranza acotada por ley** (convención #13): mora con **techo duro** en la tasa
   de usura vigente; gastos de cobranza = **monto acumulativo itemizado por gestión
   realmente efectuada** (costo fijo por tipo, default 0), **no** un porcentaje del
   saldo; **un solo número** con opt-in/opt-out y horarios, **sin rotación de
   números**; clausulado **pendiente de abogado**.
7. **Bilingüe** (convención #3): toda superficie de cara al cliente en ES (raíz) y EN
   (`/en/`); strings de correo/UI en ambos idiomas.

---

## 1. Visión

Un **portal unificado** (`portal.html` + `/en/portal.html`, servido en `/portal`)
con **dos perfiles** que comparten login y shell pero ven paneles distintos:

| Perfil | Quién | Qué ve |
|---|---|---|
| **Empresa (B2B)** | Cuenta corporativa (por NIT) | Documentación (carpeta Drive), cotizaciones, cartera (aging), facturas, historial de pedidos, (opcional) crédito |
| **Residente (larga estancia)** | Huésped de estadía extendida | Estado de cuenta / folio, pedir aseo extra y mantenimiento, PQR, (opcional) crédito |

**Login (dos vías, ambas emiten el MISMO token de sesión propio):**

- **Magic-link por correo:** el usuario pide acceso con su email; se le envía un
  enlace con un **token corto** (TTL ~15 min, `purpose:'magiclink'`); al hacer clic se
  **canjea** por un **token de sesión** de TTL completo (`purpose:'session'`).
- **Google / Firebase:** el cliente hace login con Google; el servidor **verifica el
  Firebase ID token** (`_firebase-auth.verifyFirebaseToken`), extrae `email` y **acuña
  su propio token de portal** (nunca entrega el token de Firebase como sesión).

En ambos casos la **autorización** (qué perfil, qué NIT, qué reservas) se resuelve
**server-side** contra el store `portal-accounts` a partir del email verificado. El
cliente nunca declara su identidad en el body.

---

## 2. Arquitectura de sesión del portal

> Reutiliza **verbatim** el patrón de `guest-session.js` / `_guest-app.js`
> (token de 2 partes `base64url(payload).hmacSig`, HMAC-SHA256, **no** es un JWT de
> 3 segmentos). **Secreto propio** `PORTAL_SESSION_SECRET` — **no** reusar
> `GUEST_APP_TOKEN_SECRET` para mantener audiencias de token aisladas.

### 2.1 Módulo compartido nuevo `_portal-auth.js`

Clona la forma de `_guest-app.js` pero con claims de portal:

| API | Firma | Notas |
|---|---|---|
| `signPortalToken(profile, ttl, purpose)` | `-> string` | Claims: `{sub:email, role:'empresa'\|'residente', nit?, accounts?, purpose:'session'\|'magiclink', exp}`. Firma con `portalSecret()`. |
| `verifyPortalToken(token)` | `-> payload\|null` | Split `.`, exige 2 partes, `timingSafeEqual`, valida `exp` **y** `purpose`. Nunca lanza. |
| `requirePortalSession(event)` | `-> payload` (throw `.statusCode=401`) | Espeja `requireGuest`. Exige `purpose==='session'`. |
| `portalSecret()` | `-> string` (throw 503 en prod si falta) | Lee `PORTAL_SESSION_SECRET`; fallback dev fijo solo en demo. |

**Gotcha crítico:** distinguir `purpose` en `verify` — un token de magic-link (corto)
**no** debe poder replayearse como token de sesión (largo). El canje verifica
`purpose:'magiclink'` y **consume** el `jti` (one-time) en el store `portal-magic`.

### 2.2 `portal-session.js` (HTTP `/api/portal-session`)

Endpoint único con acciones (`{action}` en el body):

| `action` | Efecto |
|---|---|
| `request-link` | Recibe `{email}`, rate-limited (10/10min), respuesta **uniforme** exista o no la cuenta (anti-enumeración), y si existe manda el magic-link (`_email.sendEmail` con plantilla nueva `portalMagicLinkHtml`). En `DEBUG` loguea el enlace. |
| `exchange` | Recibe `{token}` (magic-link), lo verifica (`purpose:'magiclink'`), consume el `jti`, y devuelve `{ok, token: signPortalToken(profile,'session'), profile}`. |
| `google` | Recibe `{idToken}` de Firebase, `verifyFirebaseToken`, resuelve cuenta por email, devuelve token de sesión. |

- Flag: **`PORTAL_ENABLED`** (todo el endpoint inerte si OFF).
- Reusa: `_email.sendEmail`, `_rate-limit.checkRateLimit`, `_firebase-auth.verifyFirebaseToken`,
  `corsHeaders`/`json`/`parseJsonBody`.
- Store: `portal-accounts` (lectura), `portal-magic` (consumo one-time).

### 2.3 `portal-profile.js` (HTTP `/api/portal-profile`)

`whoami` del portal: `requirePortalSession`, devuelve `{role, nit?, empresa?, panels:[…]}`
para que `portal.html` muestre solo los paneles habilitados. Read-only.

---

## 3. Store maestro de cuentas — `portal-accounts` + `_portal-store.js`

Módulo compartido nuevo `_portal-store.js` sobre Netlify Blobs (store `portal-accounts`):

```
key = email (lowercased)
value = {
  email, role: 'empresa' | 'residente',
  nit?, empresa?,                 // empresa
  driveFolderId?,                 // empresa: carpeta Drive de documentación
  reservationCodes?: string[],    // residente: reservas asociadas (folio)
  odooPartnerKey?: { vat } | { email } | number,  // para cartera/facturas/pedidos
  creditStatus?: 'none'|'enrolled'|'analyzing'|'recommended'|'approved'|'rejected',
  createdAt, updatedAt
}
```

- La cuenta se **provisiona** desde el panel `/admin` (una función `iam`-style de
  alta de cuentas de portal) o al aceptar una cotización empresa. **No** hay
  auto-registro público que otorgue acceso a datos financieros.
- El `odooPartnerKey` es el puente a las `getCartera/getInvoices/getOrders` de
  `_odoo.js` (resuelto por `resolvePartnerId`, dedup por NIT→email igual que
  `upsertPartner`).

---

## 4. Perfil EMPRESA (B2B)

Todas las funciones: `requirePortalSession` → exigen `role:'empresa'` → filtran por
`nit`/`odooPartnerKey` de la **sesión** (nunca del body).

| Función (`/api/…`) | Flag | Store / fuente | Reusa | Notas |
|---|---|---|---|---|
| `portal-docs` | `PORTAL_EMPRESA_ENABLED` | Drive `driveFolderId` | `_google-drive` (`search_files`/`list` por carpeta) | Lista documentos de la carpeta Drive de la empresa (contratos, cotizaciones firmadas). Solo lectura; descarga vía enlace temporal Drive. |
| `portal-quotes` | `PORTAL_EMPRESA_ENABLED` | Blobs `quotes` | `_quotes-store.listAllQuotes` + `effectiveStatus` + **`toPublic`** | **NO** reusar `list-quotes` (expone comisión/tarifaBase/tokens y usa `quotes.view`). Filtra `listAllQuotes` por `normNit(q.nit)===sessionNit` y devuelve `toPublic(q)` + `statusEfectivo`. |
| `portal-cartera` | `PORTAL_EMPRESA_ENABLED` | Odoo `account.move.line` | **`_odoo.getCartera`** (propuesta en inventario) | Aging de cartera (buckets current/1-30/31-60/61-90/90+). El cálculo de buckets/`daysOverdue` es lógica **pura** → testeable. |
| `portal-invoices` | `PORTAL_EMPRESA_ENABLED` | Odoo `account.move` | **`_odoo.getInvoices`** | Facturas de venta (Numera→Odoo). `move_type='out_invoice'`, `state='posted'`, `payment_state`. Solo lectura. |
| `portal-orders` | `PORTAL_EMPRESA_ENABLED` | Odoo `sale.order` | **`_odoo.getOrders`** | Historial de pedidos. Tolera módulo Sales ausente (try/catch → lista vacía). |

**Documentación (Drive por ID):** cada empresa tiene un `driveFolderId` en su cuenta.
`portal-docs` NO expone credenciales de Drive: el servidor lista/firma URLs y las
devuelve. Reusa el conector `_google-drive` (service account) ya existente.

**Cartera / facturas / pedidos:** dependen de tres funciones **nuevas** en `_odoo.js`
(`getCartera`, `getInvoices`, `getOrders`) descritas en el inventario. Ese archivo es
asignación de otro agente — ver **integrationNotes**. Todas mock-safe (`isMock:true`
sin credenciales), `transport` inyectable para tests, `withCtx` multiempresa.

---

## 5. Perfil RESIDENTE (larga estancia)

`requirePortalSession` → `role:'residente'` → opera sobre las `reservationCodes` de la
sesión.

| Función (`/api/…`) | Flag | Store / fuente | Reusa | Notas |
|---|---|---|---|---|
| `portal-account-statement` | `PORTAL_RESIDENTE_ENABLED` | OTASync folio | `_otasync` (lectura de folio / reserva) | Estado de cuenta: cargos del folio, pagos, saldo. Solo lectura. |
| `portal-service` | `PORTAL_RESIDENTE_ENABLED` (+ `GUEST_SERVICE_FOLIO_ENABLED` para el cargo real) | Blobs `guest-events` (cifrado) + OTASync folio | `_services-catalog`, `_otasync.postOrderExtrasToFolio`, `guest-action` como patrón | Pide **aseo extra ($50.000)** y **mantenimiento**; carga al folio Kunas si `GUEST_SERVICE_FOLIO_ENABLED`, o queda registrado para cobro a checkout. |
| `portal-pqr` | `HELPDESK_ENABLED` | Odoo Helpdesk | `_odoo.createHelpdeskTicket` (team id 3) + `_odoo.upsertPartner` | PQR: abre ticket en Helpdesk. Best-effort; nunca tumba la solicitud. |

### 5.1 Servicios nuevos: **aseo extra** y **mantenimiento**

Hoy **no existen** en el catálogo. Para añadirlos (asignación del agente dueño de
`_services-catalog.js` / `guest-action.js` — ver integrationNotes):

1. **`_services-catalog.js`** → `SERVICES`:
   - `aseoExtra`: `{ es:'Aseo extra', en:'Extra cleaning', price:50000, tax:'iva', multiplier:'flat', surfaces:['guest','portal'] }`
   - `mantenimiento`: `{ es:'Mantenimiento', en:'Maintenance request', price:0, tax:'none', multiplier:'flat', surfaces:['guest','portal'] }` (precio 0 = solicitud sin cargo; se cotiza si aplica).
2. **`guest-action.js`** → `GUEST_SERVICE_KEYS`: mapear `aseo_extra:'aseoExtra'`, `mantenimiento:'mantenimiento'`.
3. **`tests/unit/services-catalog.test.js`** valida paridad de superficies/idiomas.
4. Reflejar strings ES/EN en el front del portal (y `/en/`).

Con esto, el **folio** (`postOrderExtrasToFolio`, tax:0 en la línea, `name='… (app)'`)
y el **PQR** funcionan automáticamente, sin más cambios. Precio 100% server-side
(`sanitizeItems` recalcula desde catálogo; el cliente no inyecta precio).

> **Nota de superficie:** `surfaces` gana una etiqueta nueva `'portal'`. `guest-action`
> filtra por `'guest'`; el portal-service filtra por `'portal'`. Un servicio puede
> estar en ambas.

---

## 6. Crédito (`CREDIT_ENABLED` — OFF)

> **Decisión de crédito = SIEMPRE humana** con permiso `credito.aprobar`. La IA solo
> **recomienda**. Todo dato financiero **cifrado** + **consentimiento** Ley 1266.

### 6.1 Flujo

```
Enrolment (cliente, portal)  →  Análisis IA (server)  →  Decisión humana (staff /admin)
```

1. **Enrolment — `portal-credit-enroll.js`** (`/api/portal-credit-enroll`)
   - `requirePortalSession`. Flag `CREDIT_ENABLED`.
   - Recibe: **consentimiento explícito** (Ley 1266 + Ley 1581, casilla + timestamp +
     canal, registrado en `portal-consents`), **PDF de consulta DataCrédito** (v1
     **carga manual** — el cliente/agente sube el PDF; **no** hay scraper), y **3
     meses de extractos bancarios** (PDF, **multi-banco**).
   - Cifra cada archivo con `_crypto-vault.seal(buffer, aad='<accountId>|credito-<tipo>')`
     y guarda el sobre en `portal-credit`. **Nada en claro.**
   - Marca `creditStatus='enrolled'`.

2. **Análisis IA — `portal-credit-analyze.js`** (server, disparado por staff con
   `credito.ver`)
   - Módulo nuevo `_credit-ai.js`: abre los PDFs (`_crypto-vault.open`), **extrae
     señales** (ingresos/egresos promedio, saldos, ratio de endeudamiento, marcas
     DataCrédito, alertas), y produce una **recomendación** `{recomendacion:
     'aprobar'|'requiere_codeudor'|'rechazar', justificacion, señales, cupoSugerido}`.
   - Usa Claude vía `@anthropic-ai/sdk` (patrón `_whatsapp-ai`), `ANTHROPIC_API_KEY`.
     Sin key → no-op mock (`isMock:true`).
   - **La IA NO decide ni reporta.** Solo escribe la recomendación cifrada en
     `portal-credit`; `creditStatus='recommended'`.

3. **Decisión humana — `portal-credit-decision.js`** (`/api/portal-credit-decision`)
   - `authorize(event, 'credito.aprobar')` (Firebase staff). Flag `CREDIT_ENABLED`.
   - Un humano ve la recomendación + señales y decide `aprobar`/`rechazar`/
     `requiere_codeudor`, con cupo y plazo. Se registra actor + timestamp + motivo
     (auditoría). `creditStatus='approved'|'rejected'`.
   - **Solo aquí** se habilita un cupo de crédito; jamás automático.

### 6.2 Permisos / stores / cifrado

- Permisos nuevos: `credito.ver` (leer expediente + recomendación), `credito.aprobar`
  (decidir). Grant sugerido: `tesoreria` → `credito.ver`; `admin`/rol nuevo
  `credito` → `credito.aprobar`.
- Store `portal-credit` (sobres cifrados) + `portal-consents` (consentimientos).
- Cifrado: `_crypto-vault` con AAD `accountId|credito-datacredito` /
  `accountId|credito-extracto-<n>` / `accountId|credito-recomendacion` — un sobre no
  puede moverse de contexto (AAD binding).
- **Retención:** los PDFs financieros entran al barrido de `purge-guest-data` (o uno
  análogo) con la política que fije el abogado (Ley 1266 tiene reglas propias de
  permanencia del dato negativo — **TODO abogado**).

---

## 7. Pagaré electrónico (`PAGARE_ESIGN_ENABLED` — OFF)

> **Título valor** bajo **Ley 527** (mensaje de datos + firma electrónica). Validez
> del título **pendiente de abogado** (checklist §11).

### 7.1 Módulo swappable `_pagare-provider.js`

Interfaz de proveedor **agnóstica** (para poder cambiar de firmante electrónico sin
tocar el resto):

```
createEnvelope({ signerName, signerId, docHtml, amount, terms }) -> { envelopeId, status }
getStatus(envelopeId) -> { status: 'sent'|'signed'|'declined', signedAt?, evidence? }
downloadSigned(envelopeId) -> { pdf: Buffer, evidence }
```

- Implementación concreta detrás de env (`PAGARE_PROVIDER`, `PAGARE_API_URL`,
  `PAGARE_API_KEY`). Sin credenciales → mock (`isMock:true`), nunca lanza.
- `portal-pagare.js` (`/api/portal-pagare`): `requirePortalSession` (firma el cliente)
  / `authorize('credito.aprobar')` para emitirlo. Flag `PAGARE_ESIGN_ENABLED`.
- **Evidencia probatoria** (espeja `firma-electronica-colombia.md`): hash SHA-256 del
  documento, IP, User-Agent, timestamp ISO-8601, versión de plantilla, identidad del
  firmante. Se guarda cifrado en store `portal-pagare`.
- La firma reutiliza donde aplique el marco ya documentado de firma electrónica simple
  (Ley 527 art. 7, Decreto 2364).

### 7.2 Reporte a DataCrédito (`DATACREDITO_ENABLED` — OFF)

- **Punto de integración manual v1.** `portal-datacredito-report.js` deja el gancho
  para reportar el estado de la obligación a DataCrédito, pero **v1 es manual** (no
  API, **no** RPA/scraper). Sin `DATACREDITO_ENABLED` la función es inerte.
- Puntos de integración marcados para **API/RPA futura** (cuando exista contrato y
  endpoints — hoy no se construye). El reporte de dato negativo exige **preaviso al
  titular** (Ley 1266) — **TODO abogado**.

---

## 8. Cobranza (`COLLECTIONS_ENABLED` — OFF)

> Convención #13 aplicada al detalle. Módulo `_collections.js` (**lógica pura**,
> testeable con `node:test`) + orquestador `portal-collections.js`.

### 8.1 Cálculo de mora — **techo duro de usura**

- Interés de mora se calcula sobre el saldo vencido, con **techo duro** en la **tasa
  de usura vigente** leída de config (`USURA_RATE_CEILING`, nunca hardcodeada, nunca
  por encima). `moraInteres(saldo, dias, tasaPactada, techoUsura)` **clampa** la tasa
  aplicada a `min(tasaPactada, techoUsura)`.
- La tasa de usura **cambia mensualmente** (la certifica la Superfinanciera) → se
  gestiona desde `/admin` Configuración (`USURA_RATE_CEILING`), sin redeploy. **TODO
  operación:** actualizarla cada mes.

### 8.2 Gastos de cobranza — **monto acumulativo itemizado**

- **NO** es un porcentaje del saldo. Es la **suma de costos fijos por gestión
  realmente efectuada**: cada WhatsApp / llamada / carta suma su **costo fijo
  configurado** (`COLLECTIONS_GESTION_COSTS`, JSON por tipo, **default 0**).
- `gastosCobranza(gestiones)` = Σ costo(tipo) por cada gestión **con evidencia de
  haberse efectuado** (el sender devolvió `sent/ok===true`). Itemizado y registrado en
  `portal-collections` (ledger append-only): tipo, fecha, costo, resultado.
- Una gestión que **falló** (sender devolvió `sent:false`) **no** suma costo.

### 8.3 Escalado de mensajería — **un número, sin rotación**

Reutiliza la cadena de mensajería existente (todos mock-safe, nunca lanzan):

1. **Primer contacto** (casi siempre fuera de la ventana 24h) → `_whatsapp.sendTemplate`
   con **plantilla pre-aprobada** en Meta. **Un único** `WHATSAPP_PHONE_NUMBER_ID`.
2. **Dentro de ventana** → `_whatsapp.sendText`/`sendButtons` (ej. "Ya pagué" / "Acordar
   plan").
3. **Escalado** → `_escalation.escalate` (PRIORIDAD = llamada Twilio a
   `ESCALATION_PHONE_NUMBERS` en orden; FALLBACK = alerta correo + tarea `/admin`).
   **Un único** `TWILIO_VOICE_NUMBER`.
4. **Correo** → `_email.sendEmail` (FROM único `reservas@estar.com.co`).

- **SIN rotación de números** (decisión de cumplimiento, explícita): WhatsApp = 1
  número; voz = 1 número; correo = 1 FROM. `ESCALATION_PHONE_NUMBERS` son **destinos**
  (a quién se llama), no orígenes → no es rotación.
- **Opt-in/opt-out + horarios:** capa **nueva** en `_collections.js` (los módulos de
  mensajería **no** la traen). Registro de opt-out en `portal-collections`; franjas
  horarias permitidas (`COLLECTIONS_QUIET_HOURS`); **antes** de invocar cualquier
  sender se verifica opt-out + horario. El consentimiento de marketing (Ley 1581)
  **no** cubre cobranza (Ley 1266) → capa propia.

### 8.4 Plantilla de correo de cobranza

**No existe** hoy. Construir con `_email.emailShell`/`para`/`ctaCenter`/`ctaButton`
(bilingüe). **TODO abogado:** el clausulado / tono / avisos legales del mensaje.

---

## 9. Catálogo de flags (todos OFF por defecto)

> Añadir al whitelist `MANAGEABLE` de `_settings.js` (**archivo compartido** →
> integrationNotes). Todos gestionables desde `/admin` Configuración, **ninguno es
> secreto**.

| Flag | Tipo | Grupo | Efecto |
|---|---|---|---|
| `PORTAL_ENABLED` | bool | Portal | Habilita el login y la sesión del portal. |
| `PORTAL_EMPRESA_ENABLED` | bool | Portal | Paneles empresa (docs/cotizaciones/cartera/facturas/pedidos). |
| `PORTAL_RESIDENTE_ENABLED` | bool | Portal | Paneles residente (estado de cuenta/servicios). |
| `CREDIT_ENABLED` | bool | Crédito | Enrolment + análisis + decisión de crédito. |
| `PAGARE_ESIGN_ENABLED` | bool | Crédito | Firma electrónica del pagaré. |
| `DATACREDITO_ENABLED` | bool | Crédito | Punto de reporte a DataCrédito (v1 manual). |
| `COLLECTIONS_ENABLED` | bool | Cobranza | Motor de mora + gestiones de cobranza. |
| `COLLECTIONS_GESTION_COSTS` | text (JSON) | Cobranza | Costo fijo por tipo de gestión (default `{}` → 0). |
| `USURA_RATE_CEILING` | number | Cobranza | Techo duro de la tasa de mora (usura vigente, mensual). |
| `COLLECTIONS_QUIET_HOURS` | text | Cobranza | Franja horaria permitida para contactar (ej. `08:00-19:00`). |

Reutiliza flags existentes: `GUEST_SERVICE_FOLIO_ENABLED` (cargo al folio),
`HELPDESK_ENABLED` / `HELPDESK_TEAM_ID` (PQR), `ESCALATION_CALL_ENABLED` +
`ESCALATION_PHONE_NUMBERS` (escalado voz), `WHATSAPP_BOT_ENABLED`.

---

## 10. Catálogo de permisos nuevos

> Añadir a `ALL_PERMISSIONS` en `_permissions.js` (**compartido** → integrationNotes;
> **append**, nunca reordenar/borrar). Los permisos de **portal de cliente** NO son
> permisos Firebase — el cliente usa el token de sesión propio; aquí van solo los
> permisos de **staff**.

| Permiso | Para | Rol sugerido |
|---|---|---|
| `portal.accounts.manage` | Alta/edición de cuentas de portal en `/admin` | `admin` |
| `cartera.view` | Ver cartera/aging de un cliente (staff) | `tesoreria`, `admin` |
| `credito.ver` | Ver expediente de crédito + recomendación IA | `tesoreria`, `admin` |
| `credito.aprobar` | **Decidir** el crédito (humano) | rol nuevo `credito` / `admin` |
| `cobranza.ver` | Ver estado de cartera vencida + gestiones | `tesoreria`, `admin` |
| `cobranza.gestionar` | Disparar/registrar gestiones de cobranza | `tesoreria`, `admin` |
| `pagare.ver` | Ver pagarés y su evidencia | `tesoreria`, `admin` |

`admin` recibe todos por `slice()`. Añadir `PERMISSION_LABELS` ES/EN y, si se crea el
rol `credito`, su `ROLE_LABELS`.

---

## 11. Catálogo de stores Blobs nuevos

| Store | Contenido | Cifrado |
|---|---|---|
| `portal-accounts` | Cuentas de portal (email → perfil, NIT, driveFolderId, reservas, odooPartnerKey) | No (sin PII financiera) |
| `portal-magic` | `jti` de magic-links consumidos (one-time) | No |
| `portal-consents` | Consentimientos Ley 1266/1581 (timestamp, canal, texto) | No (metadato de consentimiento) |
| `portal-credit` | Sobres cifrados: PDF DataCrédito, extractos, recomendación IA, decisión | **Sí** (`_crypto-vault`) |
| `portal-pagare` | Pagarés + evidencia probatoria (hash, IP, UA, timestamp) | **Sí** |
| `portal-collections` | Ledger de mora + gestiones itemizadas + opt-out | Parcial (PII de contacto sellada) |

---

## 12. Catálogo de env vars nuevas (secretos — solo Netlify, NUNCA en el panel)

```
PORTAL_SESSION_SECRET=       # secreto propio del token de portal (NO reusar GUEST_APP_TOKEN_SECRET)
PORTAL_MAGICLINK_TTL=        # opcional, default 900s
PAGARE_PROVIDER=             # id del proveedor de firma (swappable)
PAGARE_API_URL=
PAGARE_API_KEY=
DATACREDITO_API_URL=         # futuro (v1 manual, sin uso)
DATACREDITO_API_KEY=         # futuro
```

Reutiliza (ya existen): `GUEST_APP_DATA_ENCRYPTION_KEY` / `GUEST_APP_KEY_RING` +
`GUEST_APP_ACTIVE_KEY_ID` (cifrado), `ANTHROPIC_API_KEY` (IA), `RESEND_API_KEY`
(correo), `WHATSAPP_*` / `TWILIO_*` (cobranza), `GOOGLE_SERVICE_ACCOUNT_JSON` /
`GOOGLE_DRIVE_*` (docs), `ODOO_*` (cartera/facturas/pedidos), `FIREBASE_PROJECT_ID`
(login Google + staff).

---

## 13. Rutas `/api` (automáticas por `netlify.toml`)

El rewrite `[[redirects]] /api/* → /.netlify/functions/:splat` ya existente da ruta
**gratis** a cualquier `netlify/functions/portal-*.js`. **No** se necesita editar
`netlify.toml` para las funciones. **Sí** se necesita editar `netlify.toml` para:

- Un bloque de **headers por-path** `noindex` + `no-store` para `/portal.html` y
  `/en/portal.html` (sirven PII financiera) — espejar los bloques de `/guest.html` /
  `/datos-cuenta.html`.
- Cualquier **schedule** nuevo (ej. un cron de recordatorio de cartera vencida).

Y editar **`build.js`** (`writeCspHeaders`) **solo** si `portal.html` referencia un
host externo, `fetch`/`iframe`/`form` a un dominio nuevo (ej. el widget del proveedor
de pagaré). Los `<script>` inline se hashean solos (SHA-256); los `onclick=` NO — usar
`addEventListener` en un `<script>` hasheado.

---

## 14. Superficie front (`portal.html`)

- Nuevo `portal.html` (raíz, ES) + `/en/portal.html`, servido en `/portal`.
- Vanilla HTML/CSS/JS (convención #1); **cero** React (el único React es
  `motor-app.jsx`, intocable). `<script>` inline hasheado por CSP.
- CSS solo con **design tokens** (`--olive`, `--sand`, `--ink`, `--space-*`,
  `.t-h1`…); cero hex crudos (convención #6).
- `shell.js` para nav/footer/reveal; el JS del portal llama a `/api/portal-*` con
  `Authorization: Bearer <token de portal>`.
- Bilingüe con `.lang-es`/`.lang-en` (build.js strippea el opuesto).

---

## 15. Tests (node:test) — solo lógica pura

Colocar en `tests/unit/`. Testear **solo** lógica determinista, inyectando
`deps`/`transport`/`store` falsos (convención #4). Cobertura mínima propuesta:

| Test | Qué valida |
|---|---|
| `portal-auth.test.js` | `sign`/`verify`/`purpose`/`exp`; rechazo de magic-link como sesión; `timingSafeEqual`. |
| `credit-signals.test.js` | Extracción de señales / forma de la recomendación (con PDF/entrada simulada). **No** llama a la IA real. |
| `collections-mora.test.js` | `moraInteres` **clampa** al techo de usura; nunca lo excede. |
| `collections-gastos.test.js` | Gastos = suma de costos por gestión **efectuada**; gestión fallida = 0; itemización correcta. |
| `collections-quiet-hours.test.js` | Respeto de opt-out y franja horaria antes de enviar. |
| `portal-quotes-filter.test.js` | Filtro por NIT normalizado + `toPublic` (sin campos internos). |
| `odoo-aging.test.js` | Buckets/`daysOverdue` de `getCartera` (lógica pura, transport inyectado). |

---

## 16. Checklist legal (marcado para ABOGADO)

- [ ] **Pagaré electrónico — validez del título valor** (Ley 527, Decreto 2364,
      Código de Comercio art. 619 y ss.): requisitos del título, firma electrónica
      admisible, cláusula de aceleración, espacios en blanco / carta de instrucciones.
- [ ] **Consentimiento Ley 1266** (Habeas Data financiero): texto, alcance,
      autorización expresa para **consultar** y **reportar** a DataCrédito.
- [ ] **Preaviso de reporte negativo** a DataCrédito (Ley 1266): plazo y forma antes
      de reportar mora.
- [ ] **Retención del dato financiero** (permanencia del dato negativo Ley 1266 vs
      barrido Ley 1581): política de purga de extractos/consultas.
- [ ] **Clausulado de cobranza** (convención #13): tono, avisos, horarios, costos de
      cobranza itemizados, opt-out — mensaje WhatsApp/correo/llamada.
- [ ] **Techo de usura**: confirmar fuente oficial y periodicidad de actualización.
- [ ] **Contrato de crédito / cupo rotativo**: términos, plazo, garantías, codeudor.
- [ ] **Tratamiento de PII financiera**: aviso de privacidad ampliado para el portal.

---

## 17. Plan de terceros

| Tercero | Qué falta | Bloquea |
|---|---|---|
| **Abogado** | Todo el checklist §16 (pagaré, Ley 1266, cobranza, retención) | `PAGARE_ESIGN_ENABLED`, `COLLECTIONS_ENABLED`, `DATACREDITO_ENABLED` |
| **DataCrédito** | Confirmar producto/endpoints contratados; v1 es **carga manual de PDF**; API/RPA futura | `DATACREDITO_ENABLED` (reporte automático) |
| **Numera** | Confirmar cómo se ven las facturas en Odoo (para `getInvoices`); ver `plan-facturacion-numera.md` §9 | `portal-invoices` (datos completos) |
| **Proveedor de pagaré** | Elegir firmante electrónico; definir contrato de la interfaz `_pagare-provider` | `PAGARE_ESIGN_ENABLED` |
| **Odoo** | `getCartera`/`getInvoices`/`getOrders` nuevos en `_odoo.js`; verificar módulos Accounting/Sales instalados | `portal-cartera/invoices/orders` |
| **Meta (WhatsApp)** | Plantilla de cobranza **pre-aprobada** (fuera de ventana 24h) | Primer contacto de cobranza |

---

## 18. Orden de construcción sugerido (incremental, cada paso detrás de su flag)

1. **Base:** `_portal-auth.js` + `portal-session.js` + `portal-profile.js` +
   `_portal-store.js` + `portal.html` (`PORTAL_ENABLED`). Login funcionando, paneles
   vacíos.
2. **Empresa lectura:** `portal-quotes`, `portal-docs` (reusan lo existente).
3. **Empresa Odoo:** `getCartera/getInvoices/getOrders` en `_odoo.js` +
   `portal-cartera/invoices/orders`.
4. **Residente:** `portal-account-statement`, `portal-service` (+ servicios aseo/
   mantenimiento), `portal-pqr`.
5. **Crédito** (tras abogado): enrolment → IA recomendación → decisión humana.
6. **Pagaré** (tras abogado + proveedor).
7. **Cobranza** (tras abogado): mora + gestiones + escalado.
8. **DataCrédito** reporte (tras contrato).

Cada paso: flag OFF por defecto, mock-safe, tests de lógica pura, review de seguridad,
y **encendido solo tras validación** (convención #7, #9).
