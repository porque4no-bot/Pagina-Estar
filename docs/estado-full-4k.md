# Estado de validación — camino a "full 4k"

> Validación completa (workflow `estar-validacion-full-4k`, 2026-06-22): verificación
> + revisión **adversarial** (busca bugs) de pagos y auth/guest/odoo + auditoría de
> producción + síntesis. Ground truth del orquestador: **638/640 tests** (2 fallas
> pre-existentes de entorno), **build limpio**, **112 archivos sin commitear**.

## Veredicto: ~70% de "full 4k"
La ingeniería está hecha y bien hecha (código sólido, seguro, unit-probado). El 30% que falta es el que **ve el negocio**: desplegar, encender observabilidad, garantizar que los correos lleguen, y sobre todo **probar una transacción real de plata de punta a punta** contra OTASync y Wompi. Hasta que no exista una reserva real cobrada, confirmada en el PMS y con su correo en bandeja, seguimos en **"demo impecable"**, no en "producción impecable". El riesgo restante es de **validación/integración**, no de reescribir código.

## Las 2 pruebas que "siempre fallan" — confirmado: ruido de entorno
Reproducidas en `HEAD` limpio con `git stash` → fallan **igual sin nuestros cambios**. Causa: `guest-session` y `guest-drive` hacen una **autenticación real contra OTASync** que sin credenciales locales devuelve 400 → 500 / fallback. **No son bugs ni agentes caídos**; en producción (con credenciales) pasan.

## Hallazgos de la revisión adversarial (lo que SÍ hay que arreglar)
| Sev | Hallazgo | Arreglo |
|---|---|---|
| **Media** | **Plan tarifario no se valida contra el monto pagado:** un huésped podría pagar el precio **Estricta** (más barato, no reembolsable) y codificar **Flexible** en la referencia → quedar como reembolsable. Exposición = el +10% solo si pide y se le aprueba un reembolso. | Derivar el plan del **subtotal que de verdad coincidió en el servidor**, no de la referencia del cliente. *(código, yo)* |
| **Media** | **Demo-mode foot-gun:** `GUEST_APP_DEMO_MODE=true` SIN `FIREBASE_PROJECT_ID` daría admin sin token. Hoy NO explotable (en Netlify Firebase siempre está), pero peligroso. | Endurecer para que jamás aplique en un deploy. *(código, yo)* |
| **Media** | Faltan **tests de los guards de seguridad** del panel de usuarios (solo se probaron los helpers puros). | Agregar tests de los caminos críticos del handler iam. *(código, yo)* |
| Baja | `onePerEmail` del cupón no se aplica en la firma (se cobra y luego se rechaza la reserva). | Validar email en la firma. *(código, yo)* |
| Baja | `restoreDiscountUse` existe pero **no se invoca** al cancelar/reembolsar. | Cablearlo a `refund-admin-action`. *(código, yo)* |
| Baja | Cableado TTLock latente con un bug (gated OFF). | Arreglar antes de cargar credenciales. *(código, yo)* |
| Baja | El gate "3 intentos → manual" del check-in lo controla el cliente. | Reforzar también en el backend. *(código, yo)* |
| Baja | `_staff-auth.js` quedó como **código muerto** tras migrar a `authorize`. | Limpieza. *(código, yo)* |

**Lo que la revisión confirmó SÓLIDO:** verificación de monto siempre server-side; el webhook MP sin secreto **no** permite reservas falsas (la verdad es la API de MP); idempotencia robusta (anti doble-cobro); reembolso MP doblemente gated; el descuento viaja fuera de la firma y se re-valida.

## Gaps de producción (severidad ALTA — bloquean el lanzamiento)
1. **Nada está desplegado** — 112 archivos sin commitear, sin PR, sin deploy. *(yo + tu merge)*
2. **Falta la prueba real de punta a punta** — reserva real → Wompi APPROVED → webhook → OTASync 9889 → PDF/Drive → correo. Nunca se hizo contra servicios reales. *(dueño + yo verifico)*
3. **Observabilidad apagada** — `ALERT_ENABLED` off: un fallo en cobro/check-in/cotización fallaría **en silencio**. *(yo enciendo)*
4. ~~Entregabilidad de correos~~ → **HECHO (22-jun, confirmado por el dueño):** SPF/DKIM/DMARC configurados y verificados.
5. ~~**Bloqueantes de contenido**~~ → **VERIFICADO YA HECHOS (22-jun)**, el checklist estaba desactualizado: parqueadero **no se cobra** (FAQ + slot reservado en el motor); identidad legal **presente y correcta** (MIRADA S.A.S, NIT 902.032.515-0, RNT 276306 en aviso-legal + privacidad, ES/EN); hora de check-out **ya es 11:00** en todo el sitio. **No son bloqueantes.**
6. **Rotar 3 secretos** expuestos en chat: `OTASYNC_TOKEN`, `BLOBS_TOKEN`, `GOOGLE_DRIVE_APPS_SCRIPT_SECRET`. *(dueño)*
7. **Estricta/Flexible** aún no son tarifas reales en OTASync (el +10% se calcula en el cliente). *(dueño configura + yo consumo)*

## Roadmap a "full 4k"
0. **Higiene de contenido** *(yo; dueño confirma NIT-DV + hora checkout):* quitar parqueadero, identidad legal, hora de checkout única.
0.5 **Rotar los 3 secretos** *(dueño; yo indico dónde).*
1. **Subir el Carril A** *(yo; tu merge):* commit → PR → `npm test` completo (unit + Playwright) → merge → deploy. **Todo sigue apagado.**
2. **Encender observabilidad PRIMERO** *(yo; tú confirmas alerta de prueba).*
3. **Verificar entregabilidad de correos** *(externo: DNS Cloudflare; yo doy los registros).*
4. **PRUEBA REAL de punta a punta** *(dueño cobra; yo verifico logs/webhook/OTASync en vivo).*
5. **Estricta/Flexible como tarifas reales en OTASync** + fix del plan tarifario server-side *(dueño configura; yo ajusto).*
6. **Validar OTASync a fondo + SIRE/TRA + folio Kunas** contra reserva real *(dueño + decisión de negocio).*
7. **Backup + resiliencia:** `BACKUP_ENABLED`, endurecer demo-mode, tests iam *(yo).*
8. **Encender el resto UNA POR UNA** tras validar cada una *(yo; tú priorizas).*
9. **Integraciones de terceros:** TTLock (credenciales), Odoo Helpdesk/NPS, bot WhatsApp (handoff), plantilla Bancolombia *(dueño/proveedores + yo).*

## Lo que puedo arreglar YA (solo código, sin esperar nada)
Los hallazgos "media/baja" de la revisión: validar el plan tarifario en servidor, endurecer demo-mode, tests de iam, cablear `restoreDiscountUse`, reforzar el gate del check-in, limpiar `_staff-auth`. Son fixes acotados y unit-probables.
