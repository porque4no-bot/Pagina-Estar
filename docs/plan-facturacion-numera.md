# Plan de implementación — Facturación electrónica con la API de Numera

> Fecha: 2026-06-30 · Para: dueño de Hotel Estar (MIRADA SAS) + equipo técnico
> Insumos: `send_electronic_invoice_api` (API Numera) + respuesta de Kunas sobre
> SIRE/TRA y webhook (26-jun) + mapeo del código (6 agentes).
> Relacionado: [`preguntas-numera.md`](preguntas-numera.md),
> [`plan-integracion-odoo-otasync.md`](plan-integracion-odoo-otasync.md),
> [`recepcion-sire-tra-roles`](../).

---

## 0. Resumen en una página (para el dueño)

- **Referencia de la reserva en la factura: SÍ.** La API trae `numero_reserva`,
  `huesped`, `centro_costo` y `nombre_contacto` en el encabezado. (Falta confirmar
  con Numera **dónde se ven**: PDF / XML DIAN / metadato Odoo, y si son buscables.)
- **¿Llegan TODAS las reservas al portal (Kunas manual + OTA + web)? SÍ es viable.**
  OTASync tiene una **API de Guests** con documento (`travel_document_number` /
  `_co`), tipo de documento, fecha de nacimiento, género, dirección, ciudad y país
  del huésped — que **se llena cuando el huésped hace el check-in**. Y
  `reservation/data/reservations` (que ya usamos) lista **todos los canales**. O sea:
  leemos reserva + datos del huésped desde OTASync y armamos la factura, sin importar
  por dónde entró la reserva. (2 confirmaciones pendientes con Kunas — §9.)
- **El evento que dispara la aprobación en el panel (tu decisión):** que **todos los
  huéspedes de la reserva completaron el check-in** correctamente. Ahí ya existe el
  documento de cada uno, está resuelta la exención de IVA del extranjero, y están los
  datos que SIRE/TRA necesita. El pago en línea previo se trata como **abono**.
- **Numera no reemplaza a la contabilidad; la alimenta.** No construimos DIAN ni
  `account.move`: preparamos el payload, lo aprobamos en el panel y se lo pasamos a
  Numera por su API; Numera homologa → DIAN → Odoo.
- **Antes de construir hay que cerrar con Numera (§9):** (1) quién es dueño del
  **consecutivo** (necesitamos rango/prefijo propio para web), (2) si la API **ya
  crea la factura en Odoo** (para no duplicar), (3) cómo obtenemos el **número legal +
  CUFE + PDF** de vuelta.
- **Hallazgo SIRE/TRA (Kunas):** ellos reportan SIRE y TRA **automáticamente** cuando
  el huésped completa el check-in **en la app de ellos** → **no necesitamos construir
  un exportador**. Pero **no hay API para empujarles nuestros datos de check-in** →
  esto obliga a una decisión sobre cuál app de check-in es la oficial (§10).

---

## 1. Cómo funciona la API de Numera

1. **Login** — `POST /api/v1/login/` (form-urlencoded) → `access_token`.
2. **Emitir** — `POST /api/v1/electronic-documents/send-electronic-invoice/`, header
   `Auth: <access_token>`, cuerpo `{ company_id, data:{ encabezado, lineas, impuestos,
   cliente } }`. Numera homologa a BTW y envía.
3. **Tipos:** `InvoiceType`, `CreditNoteType` (requiere `ref_factura`), `DebitNoteType`.
4. **Validaciones que replicamos localmente** (para no comernos un `400`):
   `precio_total = cantidad*precio_unitario` · `subtotal = Σ lineas` ·
   `valor_impuesto = Σ impuestos no-retención` · `retenciones = Σ retenciones`.
5. **Respuesta de éxito:** `{ status: "sent_to_btw", response: {} }` → ⚠️ no trae (en
   el ejemplo) número legal / CUFE / PDF → **pregunta abierta** (§9).

**Lo que la doc YA responde (no lo preguntamos):** códigos de medio de pago (48
tarjeta crédito, 49 débito, 30 transferencia, 42 consignación, 10 efectivo, ZZZ);
`ref_factura` = número legal de la factura referenciada; `fecha_factura` = fecha
actual COT (o la pone Numera); tipos de operación (10 estándar, 20/22/23 notas
crédito); códigos DIAN de impuesto (01 IVA, 04 INC); tipos de identificación (13 CC,
31 NIT, 41 pasaporte, 22 cédula extranjería…) y de empresa (1 jurídica, 2 natural).

---

## 2. Arquitectura — "nosotros disparamos, Numera homologa"

```
 (1) Pago confirmado           →  crea el REGISTRO de factura (estado: esperando check-in)
     · directo  (EST-…)           Blobs store 'invoices'
     · cotización (COT-…)
     · OTA / manual (sin pago     ·(estos entran por el (2), no por pago)
        en línea)

 (2) CHECK-IN COMPLETO de TODOS los huéspedes   →  el registro pasa a BORRADOR LISTO
     (señal desde OTASync: guest_status / webhook / sondeo)   y aparece en la cola
                                                              /admin → Facturación
                                                                        │
                                              Admin revisa + verifica datos críticos
                                              (documento, IVA, totales, líneas, reserva)
                                                                        │ Emitir (invoices.issue)
                                                                        ▼
                                        _numera.js → login + send-electronic-invoice
                                                                        │
                                        Guarda { estado, nº legal, CUFE, PDF } en el registro
                                                                        ▼
                                        Numera → DIAN + Odoo · panel muestra estado/PDF
                                                                        ▼
                                        (opcional) correo de factura al huésped
```

**Idea central:** el **pago** solo crea el registro; **el check-in completo de todos
los huéspedes** es lo que lo pone "listo para aprobar". Así la factura sale con el
documento real de cada huésped y el IVA ya resuelto.

### Componentes nuevos (gated, aditivos, OFF por defecto)

| Pieza | Qué hace | Reusa |
|---|---|---|
| `_numera.js` | `login()` (cachea token), `sendInvoice()`, `buildInvoicePayload(reserva)`, validaciones locales. Mock-safe sin credenciales, nunca lanza. | `_otasync.js`, `_twilio-voice.js` |
| Store Blobs `invoices` | Registro por reserva: payload, estado (`waiting-checkin`/`draft`/`issued`/`error`/`void`), nº legal, CUFE, PDF, origen, idempotencia. | `_refunds-store.js` |
| `_otasync.getGuests()` / `getReservationGuests()` | **NUEVO en `_otasync`:** lee la API de Guests (documento, tipo, DOB, dirección…) por reserva. | patrón de `getReservationsByDate` |
| `get-pending-invoices.js` | Cola para el panel. | `get-pending-refunds.js` |
| `invoice-admin-action.js` | `emit` / `void` / `retry` / `credit-note` / `edit-client`, `authorize('invoices.issue')`, idempotente por reserva. | `refund-admin-action.js` |
| Pestaña **Facturación** (`cotizar-admin.html`) | Cola + ficha con datos faltantes resaltados + Emitir. `data-perm="invoices.view"`. | pestañas Reembolsos / Hoy |
| Permisos `invoices.view` / `invoices.issue` | Roles `tesoreria` + `admin`. | `_permissions.js` |
| Flags `_settings` (`MANAGEABLE`) | `NUMERA_INVOICING_ENABLED`, `NUMERA_AUTO_DRAFT_ENABLED`, `NUMERA_COMPANY_ID`, `NUMERA_INVOICE_PREFIX`. Secretos (`NUMERA_USERNAME/PASSWORD`) **solo Netlify**. | panel Configuración |

**Compuerta humana:** es plata + documento legal → arrancamos 100% con aprobación
manual y sandbox; auto-emisión solo después, para casos simples (consumidor final).

---

## 3. Traer TODOS los canales desde OTASync (la respuesta a tu pregunta)

**Sí tenemos la infraestructura.** `_otasync.js` ya autentica, cachea sesión y consulta
la API. Dos endpoints hacen el trabajo:

1. **`reservation/data/reservations`** (ya lo usamos en `getReservationsByDate`): lista
   reservas de **todos los canales** — web directa, OTAs (Booking/Airbnb/…) y las
   creadas **manualmente en el panel de Kunas**. Trae `guest_status`, fechas, montos,
   habitaciones y el arreglo `guests`.
2. **`guests/data/guest`** (+ `guests/data/guests` y `guests/search/guests`) — **API de
   Guests, hay que agregarla a `_otasync`**. Cada huésped trae:
   `first_name`, `last_name`, `email`, `phone`, **`address`, `city`, `zip`, `country`**,
   **`travel_document_number` (+ `travel_document_number_co`)**, **`travel_document_type`**,
   **`date_of_birth`**, `gender`, `id_companies`, `total_nights/arrivals/paid`.

**Estos campos de huésped se llenan en el check-in** (antes están vacíos: `""` /
`0001-01-01`). Por eso el trigger "check-in completo" calza perfecto: en ese momento el
registro del huésped en OTASync ya tiene el documento, y podemos leerlo para la factura.

**Flujo de datos para facturar cualquier canal:**
```
reserva (OTASync, cualquier canal)  +  guests (OTASync, llenos tras check-in)
        └──────────────► buildInvoicePayload() ──► borrador en el panel ──► emitir a Numera
```

**Lo que SÍ resuelve OTASync:** documento, tipo de documento, nombre, dirección, ciudad
(texto), país, fecha de nacimiento — para huéspedes de **todos los canales**.

**Lo que OTASync NO da (queda gap):**
- **Códigos DANE** de departamento/ciudad (da `city`/`address` como **texto libre**, no
  el código de 5 dígitos que pide Numera) → se resuelve con un mapeo texto→DANE o con
  la vía **consumidor final** (§5).
- **Posición fiscal** y **tipo de empresa** → default sensato (persona natural /
  consumidor final) + override en cotización corporativa.
- **Señal de "check-in completo de TODOS los huéspedes"** → hay que confirmar con Kunas
  qué campo lo indica (`guest_status`? un flag por huésped?) y si hay **webhook** de
  check-in, o si sondeamos `getReservationsByDate` (§9).

---

## 4. Cuándo se factura y por qué (trigger = check-in completo)

- **Antes:** pago (no sirve: en directo el huésped paga subtotal, el IVA se cobra en el
  hotel, y aún no hay documento del huésped).
- **Ahora (tu decisión):** **check-in completo de todos los huéspedes.** Ventajas:
  1. Ya está el **documento** de cada huésped (vía la API de Guests).
  2. Ya se **resolvió la exención de IVA** del extranjero (se valida al llegar).
  3. Coincide con lo que dispara **SIRE/TRA** en Kunas → un solo momento "todo listo".
- **Abono/anticipo:** el pago en línea previo se trata como abono contra la factura
  final. Confirmar tratamiento con Numera (§9).
- **Extras al folio durante la estadía** (si se habilita `GUEST_SERVICE_FOLIO_ENABLED`):
  si el huésped consume después del check-in, esos cargos entran **después**. Opciones:
  (a) emitir al check-out en vez del check-in cuando la reserva tenga folio abierto, o
  (b) factura al check-in + nota débito/segunda factura por los extras. **A definir**
  (para la mayoría sin folio, check-in = check-out en datos).

---

## 5. Mapeo de datos → payload Numera (fuente actualizada: OTASync Guests)

Leyenda: ✅ tenemos · 🟡 parcial · ❌ falta.

### `cliente` (ahora con la API de Guests de OTASync)
| Campo Numera | Origen | Estado |
|---|---|---|
| `nombre` | `first_name`+`last_name` (Guests) / empresa (COT) | ✅ |
| `identificacion` | `travel_document_number(_co)` (Guests) / NIT (COT) | ✅ |
| `tipo_identificacion` | `travel_document_type` → mapear a DIAN (13/22/41…); 31 en COT | 🟡 |
| `correo` / `telefono` | Guests / reserva / COT | ✅ |
| `direccion` | `address` (Guests) | 🟡 (a veces vacío) |
| `pais` | `country` (Guests) | ✅ |
| `departamento` / `ciudad` (**DANE**) | `city` texto → **falta código DANE** | ❌ |
| `posicion_fiscal` | no existe → default | ❌ |
| `tipo_empresa` | derivar (COT=1, directo=2) | 🟡 |

### `encabezado` / `lineas` / `impuestos`
(Igual que antes: totales desde nuestro pricing / `computeQuoteTotal`; líneas de
alojamiento + extras; IVA 01/19% + INC 04/8%.) `numero_reserva` = bookingCode / COT-id;
`huesped` = nombre. `prefijo`+`consecutivo` = **⚠️ a definir con Numera**. Exención del
extranjero: **⚠️ cómo representarla** (§9).

---

## 6. Datos que faltan capturar (reducido gracias a OTASync)

| Falta | Solución |
|---|---|
| Códigos **DANE** depto/ciudad | tabla DANE cacheada + match por texto; o **consumidor final** (no requiere) |
| `posicion_fiscal` | default (no responsable / consumidor final) + override COT |
| `tipo_empresa` (1/2) | derivar (COT=1, directo=2) |
| `tipo_identificacion` DIAN | mapear `travel_document_type` de OTASync → códigos DIAN |
| Señal "check-in completo" | confirmar campo/webhook con Kunas (§9) |

**Consumidor final (B2C) — confirmado:** se puede emitir por API a consumidor final
(`identificacion=222222222222`), así que el camino para el huésped que **no exige factura
a su nombre** es trivial (sin DANE ni posición fiscal). La factura "a nombre de" (empresa
o persona con datos completos) queda como caso especial.

---

## 7. Notas crédito — análisis para emitirlas cuando se necesiten

**Cuándo se necesita una nota crédito (`CreditNoteType`):**
1. **Cancelación con reembolso de una estadía YA facturada.** (Con el trigger =
   check-in, una cancelación **antes** del check-in **nunca** generó factura → no hay
   NC. Solo las estadías facturadas que se reembolsan necesitan NC. Más limpio.)
2. **Corrección** de una factura ya emitida (NIT/datos errados) → anular y reexpedir.
3. **Reembolso parcial / ajuste** (se devuelve una parte) → NC parcial.

**Qué exige Numera:**
- `tipo_factura: "CreditNoteType"` + **`ref_factura` = número legal de la factura
  original**. → depende de que hayamos guardado ese número al emitir (§9, pregunta del
  número legal de vuelta). Lo persistimos en el store `invoices`.
- `tipo_operacion`: **20** (NC que referencia una factura electrónica) — el normal para
  nuestro caso; 22 (sin referencia) y 23 (V1) existen pero no aplican.
- Líneas/impuestos de la NC = lo que se anula/devuelve (total o parcial), con el IVA/INC
  correspondiente, cumpliendo las mismas validaciones de suma.
- **Concepto de corrección DIAN** (1=devolución, 2=anulación, 3=rebaja, 4=descuento,
  5=otros): **no aparece en la doc de la API** → **pregunta para Numera** (§9).

**Flujo propuesto (engancha con lo que ya existe):**
```
Reembolso/cancelación aprobado en el panel (refund-admin-action, ya existe)
   └─ ¿la reserva tiene factura emitida? (store 'invoices')
         · NO  → no se hace nada (no había factura)
         · SÍ  → invoice-admin-action.credit-note:
                  build CreditNote { ref_factura = nº legal, cliente igual,
                                     lineas/impuestos = monto devuelto, concepto }
                  → _numera.sendInvoice → guarda nº NC + CUFE
```
- **Idempotente:** una NC por factura por evento de reembolso (dedupe por
  `bookingCode`+`ref_factura`).
- **Gating:** mismo permiso `invoices.issue`; nunca automática sin aprobación.
- **Monto:** reembolso total → NC total; parcial → NC parcial (usa el monto que ya
  calcula el flujo de reembolsos según política).

---

## 8. Seguridad, idempotencia, gating

- `NUMERA_INVOICING_ENABLED` OFF; sin credenciales `_numera.js` es mock no-op.
  `NUMERA_USERNAME/PASSWORD` **solo Netlify** (secretos); `COMPANY_ID`/`PREFIX`
  gestionables desde el panel.
- **Una factura por reserva** (lock + dedupe por `bookingCode`/`COT-id`, como en pagos).
  Reintento seguro.
- **Validación local previa** (espeja §1.4) para no recibir `400`.
- **Auditoría:** quién emitió/anuló qué (patrón de auditoría de cotizaciones/IAM).

---

## 9. Lo que hay que cerrar con proveedores (antes de construir)

### Con **Numera** (sección G de [`preguntas-numera.md`](preguntas-numera.md), ya podada)
Críticas: consecutivo · `company_id`+sandbox · **número legal/CUFE/PDF de vuelta** ·
¿la API crea en Odoo? · aceptación DIAN · exención extranjero · concepto de nota crédito.

**Estado (1-jul, Jorge García/Numera por WhatsApp):**
- **Consecutivo:** DIAN por resolución, **auto-incremental**, visible en Odoo. Falta
  confirmar si la API lo **asigna** o lo **enviamos**, y si hay/necesitamos **rango
  propio para ventas web** → va al ticket.
- **Sandbox/BTW pruebas:** lo valida **Ingrid Rivera** (pendiente).
- **Número legal/CUFE/PDF, estado DIAN, concepto de nota crédito y exención del
  extranjero:** → se resuelven por **TICKET** (Jorge lo eleva a desarrollo + entrega
  documentación).
- **Odoo — NO se duplica:** Numera **baja la factura de la DIAN** y la radica/procesa
  **"como las compras"**; el `account.move` lo **concilia Numera desde la DIAN**, no
  nuestra llamada. (Esto elimina el riesgo de doble registro que nos preocupaba.)
- **Usuario de la API:** uno **distinto, rol "cliente"**, para **Numera** (`esnumera.com`).

### Con **Kunas / OTASync** (nuevas, específicas de facturación)
1. **Lectura de huéspedes por API:** ¿el usuario de integración puede leer
   `guests/data/guest(s)` para la propiedad 9889, con documento/tipo/DOB/dirección de
   **todos los canales**? (Para armar la factura fuera de su app.)
2. **Señal de "check-in completo":** ¿qué campo indica que **todos** los huéspedes de
   una reserva completaron el check-in (`guest_status`? un flag por huésped)? ¿Existe un
   **webhook** de check-in, o debemos **sondear** `reservation/data/reservations`?
3. **Multi-ocupante (su pregunta 5 quedó pendiente):** aclararles que **una reserva
   tiene N huéspedes**, cada uno con su documento, y preguntar cómo se sabe que **los N**
   ya hicieron check-in (no solo el titular).
4. **Webhook inseguro (dato que nos dieron):** confirmaron que el secreto **NO** va por
   cabecera, solo por URL → queda en logs. Ver §11 (tarea de seguridad aparte).

---

## 10. Decisión tomada (dueño, 30-jun): check-in = NUESTRA guest app

El dueño decide que **nuestro check-in (`guest.html`) es el oficial** — es más sólido
que el de Kunas y lo queremos superar. Consecuencias:

- **El "check-in completo de todos los huéspedes" lo maneja NUESTRA guest app**, y ese
  es el evento que crea el borrador de factura. La data fiscal para facturar sale de
  **nuestro almacén cifrado de check-in** (`guest-checkin`), no de OTASync. (La API de
  Guests de OTASync queda como **respaldo** para reservas que no pasen por nuestra app.)
- **SIRE/TRA lo resolvemos nosotros.** El reporte automático de Kunas se dispara con SU
  app, no con la nuestra, y su API pública **no permite inyectar** los campos que
  SIRE/TRA exigen: el `guests/edit/guest` documentado **NO incluye número/tipo de
  documento ni nacionalidad/procedencia/destino**. → Ver §10.1. (Primero se confirma con
  Kunas por correo; si es que no, construimos lo propio.)

### 10.1 — SIRE/TRA como conexión propia (evaluación)
- **TRA (MinCIT):** **SÍ tiene API REST oficial** (`traapi.mincit.gov.co`): POST titular
  → `/api/`, POST cada acompañante → `/apitwo/` con el `id` del titular; token del RNT
  (se pide en `/token/`, llega al correo del RNT). **Automatizable** desde nuestro
  backend al completarse el check-in. Requiere: **RNT activo, NIT, token**.
- **SIRE (Migración Colombia):** **NO hay API pública**; se reporta por el **portal**
  (formulario o **archivo plano .txt**): movimiento **E** el día del check-in, **S** el
  día del check-out. → Lo automatizable es **generar el archivo plano** desde nuestros
  datos; la subida va por el portal (manual, o el canal que Migración habilite).
  Requiere: **código SIRE del establecimiento, código de ciudad, dirección** y el
  catálogo de códigos SIRE.
- **Plan:** (1) preguntar a Kunas si de algún modo su API dispara SIRE/TRA con nuestros
  datos (correo, §9). (2) Si no (lo más probable): **TRA por API + SIRE por archivo
  plano**, disparados por el "check-in completo" de nuestra guest app.

---

## 11. Nota de seguridad (aparte de facturación)

Kunas confirmó que el **secreto del webhook de OTASync no se puede enviar por cabecera**,
solo por URL (`?secret=…`), y las URLs quedan en logs. Nuestro `otasync-webhook.js` debe:
(a) seguir validando el secreto por query, (b) idealmente rotarlo, y (c) no loguear la
URL completa. Es una **tarea de seguridad separada** de este plan; la anoto para no
perderla.

---

## 12. Fases de implementación (incremental, gated)

> **✅ Construido el 1-jul (andamiaje, apagado):** `_numera.js` (dry-run + validaciones),
> `_tra.js`, `_sire.js`, `_legal-docs.js` + endpoints (`get-legal-docs`,
> `get-pending-invoices`, `invoice-admin-action` stub gated) + permisos
> (`invoices.view/issue`, `docs.view`) + flags en /admin + `.env.example`. Build OK,
> 789/796 tests (7 fallos conocidos de entorno). **Falta:** credenciales (Numera/TRA/SIRE)
> + conectar la emisión real (TODO NUMERA) + la UI de las pestañas + cablear TRA/SIRE al
> "check-in completo". Detalle de credenciales en `pendientes-socios.md` §5.5.6.

- **Fase 0 — Reuniones.** Cerrar §9 (Numera + Kunas). Sin el consecutivo, el número
  legal de vuelta y la lectura de Guests, no se construye emisión.
- **Fase 1 — Lectura OTASync Guests + payload (dry-run).** `_otasync.getGuests`,
  `_numera.buildInvoicePayload` + validaciones locales, arma el JSON y lo muestra **sin
  emitir**. Tests del armado.
- **Fase 2 — Panel Facturación.** Store `invoices`, `get-pending-invoices`, pestaña,
  permisos. Registro al pago + **paso a borrador cuando el check-in está completo**.
  Solo se ve; no emite.
- **Fase 3 — Emisión real (sandbox primero).** `emit` a la API, guarda nº/CUFE/PDF,
  idempotente. Facturas de prueba.
- **Fase 4 — Notas crédito** enganchadas a reembolsos/cancelaciones (§7).
- **Fase 5 — (Opcional) auto-emisión** para consumidor final, tras validar confianza.

---

## Anexo — Hallazgos del mapeo (resumen)

- **Datos al pago:** `booking-results` (7d), `payment-details` (~13m: tarjeta/auth),
  `quote-store` (COT: empresa/NIT/ítems/IVA/INC). El **documento del huésped** llega con
  el **check-in** (OTASync Guests), no con la reserva.
- **IVA:** directo paga subtotal en línea, IVA en alojamiento si colombiano/negocios;
  extranjero turismo = exento preliminar. COT: IVA 19% + INC 8% con descuento
  prorrateado (redondeo al peso, tolerancia 0.5%/100 pesos).
- **Frontera Odoo:** `_odoo.js` solo toca `res.partner`/CRM — nunca `account.move`.
  Riesgo mayor: **doble registro** de factura/cliente si la API y contabilidad emiten
  sin coordinarse (§9).
- **SIRE/TRA (Kunas):** automático al check-in en su app; sin API para empujar nuestros
  datos; cubre todos los canales; no hay acuse consultable (revisar portales SIRE/TRA);
  multi-ocupante quedó pendiente de aclarar.
