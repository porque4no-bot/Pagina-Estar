# Auditoría empresarial "Mesa Redonda" — informe ejecutivo y roadmap

> Fecha: 2026-06-22 · Método: auditoría multi-agente adversarial (3 especialistas
> leyeron el código real en solo-lectura + un Tech Lead consolidó) · Base:
> 656 tests (654 verdes; 2 fallas ambientales pre-existentes que requieren
> credenciales reales de OTASync/Firebase/Google).

## 1. Veredicto

**NO-GO para encender flags hoy. GO por fases tras tres bloqueos.** El sistema
está bien construido, pero *verde en tests no es verde en producción*: las tres
fallas críticas viven en la frontera con servicios reales (OTASync, Mercado Pago,
Google Drive) que los tests simulan. Nada está desplegado y hay 3 secretos sin
rotar.

## 2. Diagnóstico consolidado (5 críticas, ordenadas por exposición REAL)

| # | Crítica | ¿Vivo hoy? | Estado |
|---|---|---|---|
| C1 | **Cifrado de PII de un solo sentido** + documentos (incl. de menores) guardados en CLARO. No existía función para descifrar; la clave (sha256 directo) no se podía rotar. Violación Ley 1581. | **SÍ — al primer check-in real** | ✅ **ARREGLADO** (este turno) |
| C2 | **Fuga de folio silenciosa:** el cargo "a la cuenta" fallaba sin alerta (`{posted:false}` no lanzaba) → el huésped se iba sin pagar. | Al prender `GUEST_SERVICE_FOLIO_ENABLED` (OFF hoy) | ✅ **ARREGLADO** (este turno) |
| C3 | **Lazo de cancelación ABIERTO:** cancelar por web/bot responde "listo" pero NUNCA toca OTASync; la reserva sigue ocupando inventario hasta que un humano lea el correo. | Al prender guest-app / bot (OFF hoy) | ✅ **CERRADO** (Sprint 1, gated OFF) |
| C4 | **Mercado Pago duplica reservas:** la ruta directa de MP no toma lock ni idempotencia por estadía (Wompi sí) y marca procesado *después* del insert. | Solo si se cambia el proveedor a MP (hoy = Wompi) | ✅ **CERRADO** (Sprint 2, gated `MP_DIRECT_RESILIENT_ENABLED` OFF) |
| C5 | **Pago MP cobrado sin reserva, sin red:** la ruta MP no escribe `pending` y el cron `reconcile-payments` es ciego a MP. | Solo en rollback a MP | ✅ **CERRADO** (Sprint 2: recordPending + reconciliador MP) |

**Altas:** derivación de clave sin KDF/versión (resuelto junto con C1 vía bóveda);
un `edit` de fechas en el PMS no recalcula desayuno/accesos del huésped (S1);
la verificación de firma/monto server-side es una **fortaleza** que cualquier
rediseño debe preservar (invariante).

### El mayor vacío (causa raíz)
**No existe una Staff App real.** La operación del día descansa en correos
best-effort + Kunas. C3 y C5 solo son invisibles porque no hay tablero donde se
verían. Las piezas ya están en el código (`getReservationsByDate`, `breakfast-day`,
`get-pending-refunds`, los guest-events, los handoffs del bot) — solo no están
unificadas ni accionables. Ver `docs/staff-app-diseno.md`.

## 3. Lo que ya se arregló en este turno (código real + tests)

### C1 — Bóveda criptográfica reversible (`_crypto-vault.js`)
- `seal()`/`open()` **inversos verificables** (AES-256-GCM) — antes solo se cifraba
  y **nada descifraba**.
- Derivación **HKDF-SHA256** (no sha256 directo) con **anillo de claves versionado**
  (`keyId`) ⇒ **rotación real** sin perder el histórico + "derecho al olvido
  criptográfico" (retirar un `keyId` deja ilegible lo que cifró).
- **AAD = `bookingCode|tipo`**: ata cada ciphertext a su reserva (no se puede mover
  un sobre a otro registro).
- **Compatibilidad hacia atrás:** lee los sobres antiguos (`version:1`, campo
  `data`, sin AAD) ⇒ migración sin romper datos existentes.
- **Documentos crudos cifrados en reposo** (`guest-documents` y
  `guest-minor-documents`, incl. registro civil/autorización de menores) — antes
  iban en CLARO a Blobs.
- **Test round-trip obligatorio** (`tests/unit/crypto-vault.test.js`, 10 casos):
  si el cifrado dejara de ser reversible, **el build se cae**.
- Variables nuevas (opcionales, para rotación; ver `.env.example`):
  `GUEST_APP_KEY_RING`, `GUEST_APP_ACTIVE_KEY_ID`. **Sin tocar nada sigue
  funcionando** con el `GUEST_APP_DATA_ENCRYPTION_KEY` actual.

**Residual honesto:** el reenvío del documento a Google Drive (`dataBase64`) sigue
viajando por el webhook de Apps Script (TLS en tránsito, pero el binario llega
legible a Drive — necesario para revisión SIRE/manual). Mitigación: control de
acceso a la carpeta de Drive. Cifrar también ese canal queda como decisión de
negocio (rompería la lectura manual de los documentos en Drive).

### C2 — Folio no posteado = incidente (no log silencioso)
- `{posted:false}` (con o sin excepción) ahora **levanta alerta** (`reportAlert`
  `kind:'folio_post_failed'`, dedupe por `eventId`).
- Se **persiste `folioStatus`** (`posted`/`failed`) en el guest-event ⇒ una
  conciliación futura puede reintentar idempotente por `eventId`.
- El **correo al equipo refleja el estado real** ("⚠️ NO se pudo cargar al folio,
  cobrar al check-out") en vez de decir ciegamente "Cargar a la cuenta".
- Tests: 2 casos nuevos en `tests/unit/guest-action.test.js`.

## 4. Roadmap por sprints (2 semanas c/u)

### Sprint 0 — Pre-lanzamiento (dueño + yo) · *antes de cualquier flag*
- [ ] Rotar los 3 secretos expuestos en chat: `OTASYNC_TOKEN`, `BLOBS_TOKEN`,
      `GOOGLE_DRIVE_APPS_SCRIPT_SECRET`.
- [ ] Commit → PR → `npm test` completo (unit + Playwright) → merge → deploy del
      Carril A. **Todo sigue OFF.**
- [ ] Encender observabilidad PRIMERO (`ALERT_ENABLED`) y verificar una alerta de
      prueba.
- [ ] **Prueba real de punta a punta:** reserva real → Wompi APPROVED → webhook →
      OTASync 9889 → PDF/Drive → correo.

### Sprint 1 — Bloqueante de OPS (C3) + Staff App v1 — ✅ HECHO (2026-06-22, gated OFF, sin desplegar)
- [x] **Cerrar el lazo de cancelación** contra OTASync: `_otasync.cancelReservation`
      (endpoint documentado `reservation/delete/delete` = soft-cancel, preserva el
      registro) con reintento+backoff+alerta como `insertReservation`, idempotente
      (404 = ya cancelada). Cableado en `refund-admin-action` (approve **y** deny =
      decisión terminal), **gated `OTASYNC_AUTO_CANCEL_ENABLED` (OFF)**, idempotente
      por reserva, solo reservas directas (las COT- van por hold/release),
      best-effort + alerta. Tests: `otasync-cancel` (6) + `refund-cancel-loop` (5).
- [x] **Staff App v1** (read-only): function `staff-today` (roster
      llegadas/salidas/en-casa vía `getReservationsByDate` + cola de reembolsos
      pendientes si el rol tiene `refunds.view`) + pestaña **"Hoy"** en `/admin`
      (gated `guests.checkin.view`). Tests: `staff-today` (6). Ver
      `docs/staff-app-diseno.md`.
- [ ] *(movido a S2)* `otasync-webhook`: ante un `edit` que mueve fechas, recalcular
      roster de desayunos y re-emitir accesos (no solo upsert Odoo).
- [ ] *(S2)* Staff App v2: cola **accionable** (botón aprobar/reintentar) y el worker
      bidireccional que drena la `ops-queue`.

### Sprint 2 — Bloqueante de PAGOS (C4/C5) — ✅ HECHO (2026-06-22, gated OFF, sin desplegar)
- [x] Igualar Mercado Pago a Wompi: lock single-writer + idempotencia por estadía
      + mark-before-work + `recordPending` SIEMPRE en
      `_payments.processDirectPayment`, todo detrás de `MP_DIRECT_RESILIENT_ENABLED`
      (OFF). `insertReservation` exportado y usado (reintentos+backoff+alerta) en
      lugar del `fetch` crudo. Tests: `payments-mp-direct` (6).
- [x] Extender `reconcile-payments` a la API de MP (search), gated por
      `PAYMENT_PROVIDER`/`MERCADOPAGO_ACCESS_TOKEN`, try/catch independiente por
      proveedor. **Fix del riesgo sutil:** las reservas directas ya NO se omiten por
      `processed` (cruzan `booking-results`), así un insert fallido con
      `reservationPending` se detecta. Tests: `reconcile-mp` (6).
- [x] **Staff App v2 (2026-06-22):** cola **accionable** — `_ops-queue` (toda
      alerta → tarea, vía `reportAlert`), `staff-ops` (listar/resolver/reintentar
      folio) y sección "Tareas pendientes" en la pestaña "Hoy". Tests: `ops-queue`
      (6) + `staff-ops` (10). *(worker/cron de auto-reintento → v3)*
- [ ] *(pendiente)* `otasync-webhook`: `edit` de fechas → recalcular desayuno/accesos.
- [ ] *(diferido, opcional)* `savePaymentDetails` para MP (mapear shape → last-4/auth
      code); sin esto el reembolso MP queda parcialmente ciego. Documentado.

### Sprint 3+ — Destino arquitectónico (propuestas radicales)
- [ ] **Máquina de estados de pago durable** (outbox/dead-letter en Blobs,
      provider-agnóstica) que absorba `reconcile-payments`; el webhook solo
      verifica+encola, un cron drena. Las líneas de folio = otra transición
      idempotente del mismo worker. *Por fases, detrás de flags — no big-bang.*
- [ ] **Rotación de claves programada** (re-cifrado incremental desde el cron
      diario `purge-guest-data`, aprovechando el anillo de claves ya construido).
- [ ] Registro append-only de accesos de descifrado (auditoría 360° Ley 1581).

## 5. Reglas de operación (transversales)
- **Prender cada flag de a uno**, con su alerta y su panel de verificación. Nunca
  todos juntos.
- Cada bloqueante se valida **contra el servicio real** antes del flag (los unit
  tests simulan OTASync/MP/Drive y no atrapan carreras ni integraciones faltantes).
- Las propuestas radicales convergen en lo mismo: **una máquina de estados durable
  para pagos/folio** y **una Staff App operativa** que haga visible y accionable lo
  que hoy se pierde en un correo.
