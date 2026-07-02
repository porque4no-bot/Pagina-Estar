# Staff App operativa — diseño (Fase 3)

> Surge del mayor vacío de la Mesa Redonda: **no existe una consola operativa**.
> Hoy la "Staff App" real es Kunas + la bandeja de correo del admin. Cero
> visibilidad del día; cancelaciones y cargos al folio dependen de que alguien
> lea un correo a tiempo. Las piezas YA están en el código — solo falta unirlas y
> hacerlas accionables. Objetivo: **eliminar la dependencia de las alertas por
> correo** como mecanismo operativo.

## Principio rector
Una cadena hotelera opera contra **un tablero de llegadas/salidas/en-casa con
tareas y SLA**, no contra un inbox. Reutilizamos la misma arquitectura del repo
(HTML estático + `fetch` a functions + auth `_authz`/`_iam-store`, idéntico a
`cotizar-admin.html`/`desayuno-admin.html`). **Sin frameworks pesados.**

## Pantalla única "Hoy" (3 bloques)

### (a) Roster in-house del día — *read-only, ya construible*
- Fuente: `_otasync.getReservationsByDate` (ya probado en `send-stay-emails`, hoy
  **invisible** para el staff).
- Muestra: **llegadas**, **salidas** y **en-casa** de la fecha, con habitación,
  huésped, noches, y estado de check-in (¿hizo el check-in digital? ¿documentos?).
- Cruce con `breakfast-day` para el derecho a desayuno del día.

### (b) Cola accionable — *lo que hoy llega por correo*
| Origen (ya existe) | Acción en la cola |
|---|---|
| `request-cancellation` + `guest-action` (`reservation_change`) | Aprobar/denegar cancelación o cambio → **cierra el lazo contra OTASync** |
| `get-pending-refunds` / `refund-admin-action` | Aprobar/marcar reembolso (panel ya existe; se integra aquí) |
| pedidos de servicio (`guest-events`) | Ver **estado de folio** (`posted`/`failed`) + **botón de reintento idempotente** |
| handoffs del bot WhatsApp (`_whatsapp-guard` 3-strikes, "hablar con agente") | Bandeja de tareas, no inbox |

### (c) Estado del bot y alertas
- Los `reportAlert` (incl. el nuevo `folio_post_failed`) y los handoffs del bot se
  vuelven **registros consultables** (un blob `ops-queue` append-only) que la app
  pinta como tareas con estado, en vez de correos que se pierden.

## Backend nuevo (mínimo)
1. **`staff-today`** (read-only, auth staff): combina `getReservationsByDate`
   (arrivals/departures/in-house) + `breakfast-day` + la cola de pendientes.
   Un solo endpoint que la pantalla consume.
2. **`ops-queue`** (blob append-only): cada `reportAlert`/handoff/pedido-con-folio
   escribe un item `{id, kind, status, context, createdAt}`. La app lista y marca
   `done`/`retry`.
3. **Worker de sincronía bidireccional** (cron ligero, estilo `reconcile-payments`,
   detrás de flag): drena la `ops-queue` y aplica de forma **idempotente** las
   escrituras salientes que hoy faltan:
   - cancelación aprobada → `releaseHold`/`delete-reservation`/`edit→cancelled`
     (clave idempotencia: `id_reservations`).
   - pedido con `folioStatus:'failed'` → reintenta `postOrderExtrasToFolio`
     (clave: `eventId`).
   - `edit` de fechas entrante → recalcula roster de desayunos + re-emite accesos.

## Cómo cierra los críticos
- **C3 (lazo de cancelación abierto):** la aprobación en la cola dispara la
  escritura saliente a OTASync. Ya no depende de que un humano lea el correo.
- **C5 / fuga de folio (C2 ya parchada):** el pedido con `folioStatus:'failed'` es
  visible en la cola con botón de reintento; el worker lo reconcilia solo.

## Roles (ya existen en `_permissions`)
- `recepcion`: roster + cola de cancelaciones/cambios + reintento de folio.
- `tesoreria`: reembolsos.
- `cocina`: solo el bloque desayunos del día.
- `admin`: todo + configuración.
La pantalla muestra cada bloque según `whoami` (mismo patrón de gating que `/admin`).

## Entrega por fases (alineado al roadmap)
- **v1 (Sprint 1) — ✅ HECHO (2026-06-22):** function `staff-today.js` (read-only,
  auth `guests.checkin.view`) con roster del día (llegadas/en-casa/salidas vía
  `getReservationsByDate`) + cola de reembolsos pendientes (solo si el rol tiene
  `refunds.view`). Pestaña **"Hoy"** en `cotizar-admin.html` (CSP-safe, primera
  pestaña → home operativo de recepción). Tests: `staff-today` (6).
- **v2 (Sprint 2) — ✅ HECHO (2026-06-22):** cola de tareas accionable. `_ops-queue.js`
  (append-only en Blobs, idempotente por dedupeKey, re-abre fallos recurrentes);
  `_alert.reportAlert` ahora **encola toda alerta como tarea** (no solo correo) →
  cumple "eliminar la dependencia del correo". `staff-ops.js` (auth
  `guests.checkin.view`): GET lista tareas abiertas, POST `resolve`, POST
  `retry-folio` (recarga el evento cifrado, re-postea con `postOrderExtrasToFolio`,
  marca el evento `posted` y resuelve la tarea; gated `GUEST_SERVICE_FOLIO_ENABLED`
  + `guests.register`). Sección **"Tareas pendientes"** en la pestaña "Hoy" con
  botones Resolver / Reintentar folio (CSP-safe). Tests: `ops-queue` (6) +
  `staff-ops` (10). La aprobación de cancelación ya cierra en el gate de Reembolsos
  (Sprint 1).
- **v3 (pendiente):** worker/cron que drene la cola y auto-reintente (hoy el
  reintento de folio es manual desde el botón — suficiente para una recepción
  pequeña); `otasync-webhook` `edit` de fechas → recalcular desayuno/accesos.
