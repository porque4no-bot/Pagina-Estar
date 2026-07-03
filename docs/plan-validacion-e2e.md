# Plan de validación punta a punta — Estar

> Runbook de validación **operativa** (producción) tras el merge del Carril A (PR #114)
> y sus correcciones (PR #115). Complementa `docs/testing.md` (pruebas automáticas) y
> `docs/checklist-produccion.md` (go/no-go). Este doc es para **verificar a mano** que
> todo el flujo real funciona, encendiendo cada función una por una.

## Cómo usar este doc

1. Trabajá **de arriba hacia abajo**: cada fase asume que la anterior pasó.
2. En cada prueba, marcá el **Estado** y llená **Notas/Hallazgos** (aunque sea "OK").
   - `⬜` sin probar · `✅` pasó · `❌` falló · `⏭️` no aplica / bloqueado por terceros.
3. Cuando termines, llená la **tabla de cierre** al final y me devolvés el archivo.
   Con eso reviso los hallazgos y confirmamos que quedó todo bien.
4. Los flags se encienden en **/admin → Configuración** (sin redeploy, surte efecto en <30 s).

**Datos de la corrida**

| Campo | Valor |
|---|---|
| Responsable | ______________________ |
| Fecha inicio | ______________________ |
| Fecha fin | ______________________ |
| Entorno | ☐ Producción (`estar.com.co`)  ☐ Deploy-preview (sandbox) |
| Commit / deploy | ______________________ |

> **Plata real:** la llave Wompi de producción es `pub_prod_` → **cobra de verdad** (no hay
> banner "MODO PRUEBA"). Para la Fase 1: o usás llaves sandbox en un deploy-preview
> (`docs/testing-production.md`), o hacés **una** transacción real mínima y la reembolsás.

---

## Prerrequisitos de entorno

Marcá lo que ya está cargado en Netlify antes de empezar. (Solo nombres — nunca pegar el valor de un secreto.)

| Bloque | Variables | ¿Cargado? | Necesario para |
|---|---|---|---|
| Pago activo (Wompi) | `PAYMENT_PROVIDER=wompi`, `WOMPI_PUBLIC_KEY`, `WOMPI_PRIVATE_KEY`, `WOMPI_INTEGRITY_SECRET`, `WOMPI_WEBHOOK_SECRET` | ☐ | Fase 1 |
| PMS | `OTASYNC_TOKEN`, `OTASYNC_USERNAME`, `OTASYNC_PASSWORD`, `OTASYNC_PROPERTY_ID`, `OTASYNC_WEBHOOK_SECRET`, `OTASYNC_CHANNEL_ID`, `OTASYNC_USE_CHANNEL` | ☐ | Fases 1,2,4,5 |
| Correo | `RESEND_API_KEY`, `ADMIN_NOTIFY_EMAIL` | ☐ | Fases 1,4,5 |
| Cifrado PII | `GUEST_APP_DATA_ENCRYPTION_KEY` (y opcional `GUEST_APP_KEY_RING`/`GUEST_APP_ACTIVE_KEY_ID` para rotación) | ☐ | Fase 2 |
| Guest App | `GUEST_APP_TOKEN_SECRET`, `GUEST_APP_SYNC_*`, `GUEST_APP_DRIVE_*`, `AZURE_DOCUMENT_INTELLIGENCE_*` | ☐ | Fase 2 |
| Admin / IAM | `FIREBASE_PROJECT_ID`, `ADMIN_EMAILS` (superusuarios) | ☐ | Fase 3 |
| Blobs | `BLOBS_TOKEN` + `NETLIFY_SITE_ID` (o `BLOBS_SITE_ID`) | ☐ | Fases 3,4,5,6 |
| Odoo CRM | `ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, `ODOO_API_KEY`, `ODOO_COMPANY_ID` | ☐ | Fase 4 (NPS/Helpdesk) |
| **Staff no-admin** (opcional) | `STAFF_EMAILS` — o crear usuarios en pestaña **Usuarios** | ☐ | Fase 6 (roles cocina/recepción) |
| **MP rollback** (opcional) | `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_PUBLIC_KEY`, **`MERCADOPAGO_WEBHOOK_SECRET`** (falta) | ☐ | Fase 9 |
| Numera (bloqueado) | `NUMERA_USERNAME`, `NUMERA_PASSWORD`, `NUMERA_COMPANY_ID` | ☐ | Fase 8 |
| TRA (bloqueado) | `TRA_TOKEN`, `TRA_NIT`, `TRA_RNT` | ☐ | Fase 8 |
| SIRE (config) | `SIRE_HOTEL_CODE`, `SIRE_CITY_CODE`, `SIRE_HOTEL_ADDRESS` | ☐ | Fase 8 |
| TTLock (bloqueado) | `TTLOCK_CLIENT_ID/SECRET/USERNAME/PASSWORD_MD5/LOCKS_JSON` | ☐ | Fase 8 |
| WhatsApp (bloqueado) | `WHATSAPP_TOKEN/PHONE_NUMBER_ID/APP_SECRET/VERIFY_TOKEN` (+ `ANTHROPIC_API_KEY`) | ☐ | Fase 8 |
| Twilio (bloqueado) | `TWILIO_ACCOUNT_SID/AUTH_TOKEN/VOICE_NUMBER`, `ESCALATION_PHONE_NUMBERS` | ☐ | Fase 8 |

### Seguridad previa (hacer antes de abrir tráfico)

- [ ] **Rotar `OTASYNC_TOKEN`, `BLOBS_TOKEN`, `GOOGLE_DRIVE_APPS_SCRIPT_SECRET`** (estuvieron expuestos en chat).
      Estado: ⬜   Notas: ______________________________________________
- [ ] Confirmar que ningún secreto aparece en el panel `/admin → Configuración` (la lista blanca los excluye).
      Estado: ⬜   Notas: ______________________________________________

---

## Fase 0 — Humo / salud (sin encender nada)

- [ ] **0.1** `estar.com.co` carga sin errores de consola; header, menú móvil y botón WhatsApp OK.
      Estado: ⬜   Notas: ______________________________________________
- [ ] **0.2** Páginas clave responden 200: `/reservar`, `/guest`, `/nosotros`, `/faq`, `/cancelacion`, `/en/`.
      Estado: ⬜   Notas: ______________________________________________
- [ ] **0.3** `/admin` pide login Firebase y, tras entrar con un correo de `ADMIN_EMAILS`, muestra las pestañas.
      Estado: ⬜   Notas: ______________________________________________
- [ ] **0.4** En `/reservar` con llaves de producción **NO** aparece el banner "MODO PRUEBA".
      (Si aparece → estás con llaves sandbox; correcto solo en preview.)
      Estado: ⬜   Notas: ______________________________________________
- [ ] **0.5** Consentimiento de cookies aparece en la primera visita y persiste al aceptar.
      Estado: ⬜   Notas: ______________________________________________

---

## Fase 1 — Núcleo: reserva → pago → reserva en PMS (Wompi, plata real)

> Hacé **una** reserva real de 1 noche, monto bajo, y reembolsala al final (Fase 5).

- [ ] **1.1 Disponibilidad:** buscar fechas + huéspedes muestra las 5 habitaciones con precio por noche real de OTASync.
      Estado: ⬜   Notas: ______________________________________________
- [ ] **1.2 Tarifas:** verificar que **Flexible = Estricta × 1.10** (+10% exacto) en el precio mostrado.
      Estado: ⬜   Notas: ______________________________________________
- [ ] **1.3 🔁 Regresión FIX #7:** el badge de tarifa muestra **"Estricta — Cancela gratis hasta 7 días antes"**
      (o "Flexible — Reembolsable"), **NUNCA** la palabra literal `undefined`. Revisar en el resumen lateral **y** en la
      pantalla de confirmación, en ES y EN.
      Estado: ⬜   Notas: ______________________________________________
- [ ] **1.4 Extras:** desayuno ($20k/pers/noche), late checkout (15%), early check-in (25%) suman correcto al total.
      Estado: ⬜   Notas: ______________________________________________
- [ ] **1.5 IVA:** huésped colombiano/negocio → IVA cobrado; extranjero turista → exención preliminar. Verificar el desglose.
      Estado: ⬜   Notas: ______________________________________________
- [ ] **1.6 Pago Wompi:** completar el pago real. El widget abre con llaves `pub_prod_`.
      Estado: ⬜   Notas: ______________________________________________
- [ ] **1.7 Confirmación:** la pantalla de confirmación aparece (polling hasta 60 s) y llega el **correo de confirmación** (Resend).
      Estado: ⬜   Notas: ______________________________________________
- [ ] **1.8 Reserva en OTASync:** la reserva aparece en OTASync/Kunas con fechas, huésped, habitación y monto correctos.
      Estado: ⬜   Notas: ______________________________________________
- [ ] **1.9 🔁 Regresión FIX #6:** en la **nota** de la reserva en OTASync el plan dice
      **"Estricta (reembolso 100% hasta 7 días antes)"** o **"Flexible (…24 h…)"** — **NO** "no reembolsable".
      Estado: ⬜   Notas: ______________________________________________
- [ ] **1.10 Plan derivado del monto:** el plan tarifario registrado en la reserva coincide con lo que se pagó
      (Estricta base vs Flexible +10%), no con lo que dijera el cliente.
      Estado: ⬜   Notas: ______________________________________________

---

## Fase 2 — Guest App, check-in y cifrado de PII

- [ ] **2.1 Sesión:** entrar en `/guest` con la reserva de la Fase 1; la sesión persiste al recargar. Reserva inexistente → error visible.
      Estado: ⬜   Notas: ______________________________________________
- [ ] **2.2 Documento + OCR:** subir un documento; Azure OCR autocompleta los campos (o cae a captura manual sin bloquear).
      Estado: ⬜   Notas: ______________________________________________
- [ ] **2.3 Multi-huésped:** agregar un segundo ocupante con su propio documento.
      Estado: ⬜   Notas: ______________________________________________
- [ ] **2.4 SIRE/TRA captura:** el formulario pide género, ocupación, procedencia/destino; extranjero debe declarar `destino`.
      Estado: ⬜   Notas: ______________________________________________
- [ ] **2.5 Contrato:** firmar el contrato; se genera el PDF.
      Estado: ⬜   Notas: ______________________________________________
- [ ] **2.6 Cifrado en reposo:** confirmar que el check-in queda guardado (no debe verse PII en claro en Blobs).
      Estado: ⬜   Notas: ______________________________________________
- [ ] **2.7 🔁 Regresión FIX #1 (rotación de clave — hacer en preview, NO en prod la primera vez):**
      con datos ya cifrados, simular la rotación documentada (`GUEST_APP_KEY_RING={"k1":"<viejo>","k2":"<nuevo>"}`,
      `GUEST_APP_ACTIVE_KEY_ID=k2`) y verificar que los check-ins **viejos siguen legibles** (no "decrypt-failed").
      Estado: ⬜   Notas: ______________________________________________
- [ ] **2.8 Consentimiento marketing:** marcar el opt-in y confirmar que el contacto llega a Odoo (tag + lista) con timestamp.
      Estado: ⬜   Notas: ______________________________________________
- [ ] **2.9 Archivo a Drive:** el documento se reenvía a la carpeta de Google Drive configurada.
      Estado: ⬜   Notas: ______________________________________________

---

## Fase 3 — Panel /admin, roles e IAM

- [ ] **3.1 whoami / pestañas:** el panel muestra solo las pestañas que el usuario puede usar (como admin, todas).
      Estado: ⬜   Notas: ______________________________________________
- [ ] **3.2 Usuarios:** crear un usuario con rol `recepcion`; iniciar sesión con él y confirmar que ve menos pestañas.
      Estado: ⬜   Notas: ______________________________________________
- [ ] **3.3 🔁 Regresión FIX #4a (anti-escalada simétrica):** con un usuario que tenga **solo** `roles.manage`,
      intentar guardar el rol **admin** con permisos vacíos → debe **RECHAZAR** ("No puedes quitar de un rol permisos que tú no tienes").
      El sistema nunca queda sin admin.
      Estado: ⬜   Notas: ______________________________________________
- [ ] **3.4 🔁 Regresión FIX #4b (no reactivar suspendidos):** suspender un usuario; luego editar su **nombre o roles**
      (sin tocar el estado) y guardar → debe **seguir suspendido**, no reactivarse.
      Estado: ⬜   Notas: ______________________________________________
- [ ] **3.5 Anti-auto-bloqueo:** intentar quitarte a vos mismo `users.manage` → rechazado.
      Estado: ⬜   Notas: ______________________________________________
- [ ] **3.6 🔁 Regresión FIX #11 (credenciales Blobs):** confirmar que **Usuarios**, **Configuración** y snapshots de pago
      leen/escriben del store sin error (no fallan por credenciales), igual que Cotizaciones.
      Estado: ⬜   Notas: ______________________________________________

---

## Fase 4 — Flags gestionables (encender uno a uno desde /admin → Configuración)

> Regla general **🔁 FIX #10 (cache):** al cambiar un flag en el panel, el efecto debe verse en **<30 s** sin redeploy.
> Verificalo en el primer flag que enciendas.

- [ ] **4.1 `DISCOUNT_CODES_ENABLED` ON** → aparece el campo "código de descuento" en el motor; un código válido descuenta.
      Estado: ⬜   Notas: ______________________________________________
- [ ] **4.2 🔁 Regresión FIX #3 (cupón un-uso-por-email):** con un código `onePerEmail`, intentar el **mismo email en 2 reservas**
      antes de pagar. El sistema no debe dejar un pago **cobrado sin reserva**: o valida al firmar, o rechaza limpio antes de cobrar.
      Estado: ⬜   Notas: ______________________________________________
- [ ] **4.3 `GUEST_NOTES_TO_PMS_ENABLED` ON (🔁 FIX #2)** → escribir una nota en el paso 3 del motor; tras pagar,
      la nota **aparece** en la reserva de OTASync. (Antes, prendido desde el panel, no llegaba.)
      Estado: ⬜   Notas: ______________________________________________
- [ ] **4.4 `REFUND_BANK_FORM_ENABLED` ON (🔁 FIX #2)** → aprobar un reembolso MANUAL_BANK genera el link a `datos-cuenta.html`;
      abrir el link y enviar la cuenta **NO debe dar 404**; tesorería recibe los datos.
      Estado: ⬜   Notas: ______________________________________________
- [ ] **4.5 `GUEST_SERVICE_PAYMENT_MODE = both` (🔁 FIX #2)** → un pedido de servicio del huésped pagado en línea (Wompi)
      se **asienta al folio** de la reserva; el intent queda `paid`. (Antes, en modo `both`, quedaba pagado sin asentar.)
      Estado: ⬜   Notas: ______________________________________________
- [ ] **4.6 `STAY_EMAILS_ENABLED` ON** → el cron manda pre-llegada (hoy+N) y post-estadía (hoy-1); revisar dedupe.
      Estado: ⬜   Notas: ______________________________________________
- [ ] **4.7 `QUOTE_EXPIRY_REMINDER_ENABLED` ON** → una cotización por vencer dispara el recordatorio una sola vez.
      Estado: ⬜   Notas: ______________________________________________
- [ ] **4.8 `BACKUP_ENABLED` ON** → el respaldo diario corre y deja el snapshot versionado por fecha.
      Estado: ⬜   Notas: ______________________________________________
- [ ] **4.9 `ALERT_ENABLED` ON + 🔁 Regresión FIX #8:** simular un fallo de fetch en reconciliación (p. ej. token de proveedor inválido)
      y confirmar que llega la **alerta** `reconcile-fetch-failed` (antes se apagaba en silencio con 200).
      Estado: ⬜   Notas: ______________________________________________
- [ ] **4.10 `HELPDESK_ENABLED` / `NPS_ENABLED` ON** → un pedido/cancelación abre ticket en Odoo Helpdesk; el correo post-estadía lleva el link NPS.
      Estado: ⬜   Notas: ______________________________________________

---

## Fase 5 — Reembolsos y cancelaciones

- [ ] **5.1 Solicitud de cancelación (2FA):** desde `/reservar` (Gestionar reserva) o el flujo público, pedir cancelación con
      el segundo factor (email o apellido). Un código solo, sin 2FA, no debe revelar nada.
      Estado: ⬜   Notas: ______________________________________________
- [ ] **5.2 Alerta al equipo:** la solicitud alerta al equipo y el huésped recibe acuse por correo.
      Estado: ⬜   Notas: ______________________________________________
- [ ] **5.3 Panel de reembolsos:** la solicitud aparece en `/admin`. **🔁 FIX #6:** el campo **Plan** dice
      "Estricta (100% hasta 7 días)" / "Flexible (100% hasta 24 h)" — **no** "no reembolsable".
      Estado: ⬜   Notas: ______________________________________________
- [ ] **5.4 Snapshot de pago:** el modal muestra auth code, fecha, últimos 4 y monto (desde `_payment-details`).
      Estado: ⬜   Notas: ______________________________________________
- [ ] **5.5 `OTASYNC_AUTO_CANCEL_ENABLED` ON (el pendiente):** aprobar/denegar el reembolso de una **reserva real de prueba**
      cancela la reserva en OTASync (soft-cancel), idempotente. **Validar con una reserva real antes de dejarlo prendido en vivo.**
      Estado: ⬜   Notas: ______________________________________________
- [ ] **5.6 Reembolsar la prueba de la Fase 1** (cerrar el ciclo de plata real).
      Estado: ⬜   Notas: ______________________________________________

---

## Fase 6 — Staff App ("Hoy") y desayunos

- [ ] **6.1 Pestaña Hoy:** el roster del día (llegadas/salidas/in-house) carga desde OTASync sin errores de consola.
      Estado: ⬜   Notas: ______________________________________________
- [ ] **6.2 Cola de tareas:** un evento accionable (p. ej. folio fallido) aparece como tarea; resolverla la saca de la lista.
      Estado: ⬜   Notas: ______________________________________________
- [ ] **6.3 🔁 Regresión FIX #5 (ops-queue):** generar varias tareas, resolver algunas y confirmar que las **abiertas siguen visibles**
      (no desaparecen tras acumularse resueltas). Las resueltas ya no reaparecen.
      Estado: ⬜   Notas: ______________________________________________
- [ ] **6.4 Reintento de folio:** una tarea `retry-folio` reintenta y, si funciona, se marca `posted` y se resuelve.
      Estado: ⬜   Notas: ______________________________________________
- [ ] **6.5 Desayunos (staff):** en `desayuno.html` escanear/buscar una reserva, marcar desayuno servido; idempotente 1/persona/día.
      Estado: ⬜   Notas: ______________________________________________
- [ ] **6.6 Desayunos (admin):** la analítica de dinero (`desayuno-admin` / pestaña Desayunos) es **solo admin**; la cocina no la ve.
      Estado: ⬜   Notas: ______________________________________________
- [ ] **6.7 Roles staff (requiere `STAFF_EMAILS` o usuario creado):** un usuario **cocina** ve desayunos pero **no** el panel de dinero.
      Estado: ⬜   Notas: ______________________________________________

---

## Fase 7 — Cupones / Códigos de descuento

- [ ] **7.1 Códigos:** crear, activar y desactivar un código desde la pestaña **Códigos**.
      Estado: ⬜   Notas: ______________________________________________
- [ ] **7.2 Tope de usos:** un código con máximo de usos no se pasa del cap ni con pagos concurrentes (compare-and-set).
      Estado: ⬜   Notas: ______________________________________________
- [ ] **7.3 Validación pública:** el campo del motor valida el código y da respuesta uniforme `{valid:false}` ante código malo (sin enumeración).
      Estado: ⬜   Notas: ______________________________________________

---

## Fase 8 — Integraciones opcionales (marcar ⏭️ si falta la credencial)

- [ ] **8.1 SIRE:** con `SIRE_HOTEL_CODE/CITY_CODE/HOTEL_ADDRESS` cargados y `SIRE_ENABLED` ON, generar el archivo plano de un extranjero.
      Estado: ⬜   Notas: ______________________________________________
- [ ] **8.2 TRA:** (bloqueado sin `TRA_TOKEN`) reportar una estadía de prueba al RNT.
      Estado: ⏭️   Notas: ______________________________________________
- [ ] **8.3 Numera:** (bloqueado sin credenciales de Ingrid) emitir una factura en dry-run y luego real.
      Estado: ⏭️   Notas: ______________________________________________
- [ ] **8.4 TTLock:** (bloqueado sin credenciales) generar un PIN temporal por reserva.
      Estado: ⏭️   Notas: ______________________________________________
- [ ] **8.5 WhatsApp bot:** (bloqueado sin credenciales Meta) handshake del webhook + una consulta de disponibilidad.
      Estado: ⏭️   Notas: ______________________________________________
- [ ] **8.6 Escalamiento Twilio:** (bloqueado sin credenciales) `notify_team` urgente dispara la llamada; si falla, cae a alerta.
      Estado: ⏭️   Notas: ______________________________________________

---

## Fase 9 — Mercado Pago (rollback) — opcional

> Solo si vas a validar MP. Requiere `MERCADOPAGO_WEBHOOK_SECRET`. Cambiar `PAYMENT_PROVIDER=mercadopago`
> (idealmente en un preview, no en prod).

- [ ] **9.1 Pago MP directo:** una reserva paga con MP crea la reserva en OTASync sin duplicar (con `MP_DIRECT_RESILIENT_ENABLED`).
      Estado: ⏭️   Notas: ______________________________________________
- [ ] **9.2 Reconciliación MP:** un pago sin reserva es detectado por `reconcile-payments` y alertado.
      Estado: ⏭️   Notas: ______________________________________________
- [ ] **9.3 🔁 Regresión FIX #9:** con `MERCADOPAGO_WEBHOOK_SECRET` **ausente**, un webhook de pago rechazado
      **NO** debe enviar correo al huésped (firma no verificada). Con el secreto **presente** y firma válida, sí lo envía.
      Estado: ⏭️   Notas: ______________________________________________

---

## Fase 10 — CSS / accesibilidad (rápido)

- [ ] **10.1 🔁 Regresión FIX #12:** `datos-cuenta.html` (ES/EN) y la pestaña Configuración de `/admin` usan los colores de marca
      (mensajes ok/error se ven bien en claro y oscuro), sin hex crudos fuera de tokens.
      Estado: ⬜   Notas: ______________________________________________

---

## Cierre / sign-off

**Resumen por fase**

| Fase | Título | Estado (✅/❌/⏭️) | Hallazgos abiertos |
|---|---|---|---|
| 0 | Humo / salud | | |
| 1 | Núcleo reserva → pago → PMS | | |
| 2 | Guest App / check-in / cifrado | | |
| 3 | /admin + IAM | | |
| 4 | Flags gestionables | | |
| 5 | Reembolsos y cancelaciones | | |
| 6 | Staff App / desayunos | | |
| 7 | Cupones | | |
| 8 | Integraciones opcionales | | |
| 9 | Mercado Pago (rollback) | | |
| 10 | CSS / a11y | | |

**Regresiones de los 12 fixes del PR #115 — verificadas:**

| Fix | Prueba | ✅/❌ |
|---|---|---|
| #1 crypto-vault rotación | 2.7 | |
| #2 panel-flag (notas) | 4.3 | |
| #2 panel-flag (reembolso link) | 4.4 | |
| #2 panel-flag (GST `both`) | 4.5 | |
| #3 cupón onePerEmail | 4.2 | |
| #4a anti-escalada rol admin | 3.3 | |
| #4b no reactivar suspendido | 3.4 | |
| #5 ops-queue abiertas visibles | 6.3 | |
| #6 etiquetas Estricta política real | 1.9 / 5.3 | |
| #7 badge tarifa sin "undefined" | 1.3 | |
| #8 alerta reconcile | 4.9 | |
| #9 correo MP solo con firma | 9.3 | |
| #10 cache settings <30s | 4 (general) | |
| #11 credenciales Blobs | 3.6 | |
| #12 tokens CSS | 10.1 | |

**Veredicto final**

- ☐ Todo OK — listo para tráfico real.
- ☐ OK con hallazgos menores (detallar abajo).
- ☐ Bloqueado — hallazgos críticos (detallar abajo).

**Hallazgos / comentarios generales para revisar:**

```
(Escribí acá cualquier cosa que falló, se vio raro, o quede en duda. Cuanto más
concreto —qué hiciste, qué esperabas, qué pasó— más rápido lo diagnostico.)

-
-
-
```

Firma responsable: ______________________   Fecha: ______________
