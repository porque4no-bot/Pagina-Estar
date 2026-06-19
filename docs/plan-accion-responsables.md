# Plan de acción por responsable — camino a producción

Separa el [checklist de producción](checklist-produccion.md) en **tres carriles**
según quién puede ejecutar cada cosa:

- 🛠️ **Carril A — Solo equipo técnico.** Decisión ya tomada o puramente técnica;
  arranca sin esperar a nadie.
- 👤 **Carril B — Decisiones / datos del dueño.** Negocio o información que solo
  el propietario tiene. **Las preguntas están montadas abajo — basta responder.**
- 🤝 **Carril C — Requiere información de terceros.** Preguntas listas para
  enviar a Kunas, Wompi y Booking, más accesos (DNS, llaves).

> Regla práctica: el Carril A puede avanzar **hoy**. El B y el C **desbloquean**
> tareas técnicas — están marcadas con "→ desbloquea".

Fecha: 2026-06-19.

---

## 🛠️ Carril A — Solo equipo técnico (ejecutable ya)

No esperan a nadie. La decisión ya está tomada o es técnica.

| # | Tarea | Archivos clave |
|---|---|---|
| A1 | **Quitar parqueadero** (servicio que hoy se cobra y no existe) | `_pricing.js`, `reservar.html`, `guest.html`, `cotizar-admin.html`, `faq.html`, prompt bot |
| A2 | Alinear Flexible a **×1.10** exacto (mientras hay rate plans reales) | `_direct-pricing.js`, `motor-app.jsx` |
| A3 | **Observabilidad/alertas** (Sentry o similar) en `wompi-webhook`, `guest-checkin`, `create-quote`, `_otasync`, `send-confirmation` | nuevo módulo + funciones |
| A4 | **Respaldo/export de Netlify Blobs** (cotizaciones, reembolsos, PII, desayunos) | script + cron |
| A5 | Pre-hold de inventario en checkout directo (reutilizar `createHold`) | `_otasync.js`, `wompi-webhook.js` |
| A6 | Reintento con backoff en `insertReservation` (hoy 1 intento) | `_otasync.js` |
| A7 | Manejar `reservation edit/cancel` del webhook OTASync (liberar holds) | `otasync-webhook.js` |
| A8 | Pasar notas/solicitudes especiales del huésped al PMS | referencia Wompi + `wompi-webhook.js` |
| A9 | Formulario de **datos de cuenta** para reembolso manual + correo a tesorería | `request-cancellation.js`, `_refunds-store.js`, front |
| A10 | Emails faltantes: pre-llegada, post-estadía, recordatorio de cotización | `_email.js` + crons |
| A11 | Verificar CSP/headers/seguridad en producción | `build.js`, `netlify.toml` |
| A12 | Probar **cargo al folio** y **cobro online** del guest app en reserva real (hoy apagados) | `guest-action.js`, `wompi-webhook.js` (necesita reserva real → ver B) |

> A12 y la validación de desayunos QR necesitan **una reserva real de QA** — el
> dueño debe facilitarla (ver B8).

---

## 👤 Carril B — Decisiones / datos del dueño

**Responde aquí mismo (llena el espacio en blanco o marca la opción).** Cada
respuesta desbloquea trabajo técnico.

### B1 · NIT — dígito de verificación → desbloquea legales
Razón social **Mirada SAS**, NIT **902.032.515-`___`**.
**Pregunta:** ¿cuál es el dígito de verificación? → `____`

### B2 · Hora de check-out única → desbloquea late checkout + bot
Hoy hay inconsistencia: `index.html` dice 12:00, `faq.html` y el bot dicen 11:00.
Con late checkout hasta las 2:00 PM, la estándar debe ser **una sola**.
**Decisión:** ☐ 11:00 AM ☐ 12:00 M ☐ otra: `____`

### B3 · Política de cancelación / planes de tarifa → desbloquea §6.1
Propuesta (decidida 2026-06-13, falta confirmar y crear en OTASync):
- **Estricta** = base. Gratis hasta **7 días antes**; luego no reembolsable.
- **Flexible** = base **+10%**. Gratis hasta **6:00 PM del día anterior**; luego penalidad.
- **No-show / tardía** = **1ª noche + impuestos + 3,5%** del total.
**Preguntas:**
1. ¿Se confirma tal cual? ☐ Sí ☐ Ajustar: `____`
2. ¿Quién crea los rate plans **reales** en OTASync? (recepción / dueño / Kunas) `____`

### B4 · Cobro por mascota → desbloquea §6.2
Estadía corta = **$200.000 fijos por reserva** (decidido).
**Pregunta:** en **larga estadía**, ¿sigue siendo este cobro de $200k o un
**depósito reembolsable**? → ☐ $200k fijo ☐ Depósito reembolsable de `$____`

### B5 · Reprecio de extras → desbloquea §6.5
Propuesta: **late checkout** hasta 2 PM = 15% de la noche; **early check-in**
escalonado (2 h antes 15% / desde 10 AM 35% / desde 6 AM 50%).
**Preguntas:**
1. ¿Se aplica el early **escalonado** (3 tramos) o se deja el **25% plano** actual? ☐ Escalonado ☐ 25% plano
2. ¿El **desayuno** se mantiene en **$20.000/persona/noche**? ☐ Sí ☐ Nuevo: `$____`

### B6 · Tarifas reales en OTASync → desbloquea precisión del motor
El motor usa fallback si OTASync no responde: Clásica $165k · Selección $265k ·
Reserva $205k · Origen $265k · Especial $195k.
**Pregunta:** ¿los precios cargados en OTASync **coinciden** con estos? ¿Quién
los verifica/actualiza? → `____`

### B7 · Larga estadía — estructura legal → §6.4
Hospedaje turístico vs. arrendamiento (afecta la validez de retención de depósito).
**Pregunta:** ¿se mantiene **pendiente** por ahora? ☐ Sí, pendiente ☐ Decisión: `____`

### B8 · Reserva de QA real → desbloquea A12 + desayunos QR
**Pregunta:** ¿puedes crear/apartar **una reserva real** (de prueba) en OTASync
para validar cargo al folio, cobro online y el pase de desayuno? → `____`

### B9 · Cloudflare Bot Fight Mode → rendimiento/abuso
Es un interruptor en el dashboard de Cloudflare (tú tienes acceso). Palanca
grande para PageSpeed 90+ y bloqueo de bots.
**Pregunta:** ¿lo activas? ☐ Sí, activado ☐ Necesito ayuda

### B10 · RUT + Cámara de Comercio → desbloquea §6.7 (portal empresas)
**Pregunta:** ¿subes los PDF **vigentes** a una carpeta de Google Drive (ya hay
integración Drive)? Indica la carpeta/enlace: `____`

### B11 · SLA de reembolso manual → desbloquea §6.8
Para PSE / Nequi / efectivo / datáfono (devolución por transferencia).
**Pregunta:** ¿cuántos **días hábiles** se promete al huésped? → `____`
(hoy el código comunica 15 días hábiles para todo).

### B12 · Handoff humano del bot de WhatsApp → desbloquea activar el bot
**Preguntas:**
1. ¿Quién responde y **desde dónde**? ☐ App WhatsApp Business (recepción) ☐ Inbox compartido (Chatwoot/Meta) ☐ Otro: `____`
2. ¿El bot debe **pausar** sus respuestas cuando entra un humano? ☐ Sí ☐ No (v1)
3. ¿**Horario** de atención humana? `____` · ¿Qué dice el bot fuera de horario? `____`
4. ¿A qué **correo** llega el escalamiento (`ADMIN_NOTIFY_EMAIL`)? `____`

### B13 · Llaves de pago de producción → desbloquea cobro real
Las cuentas son tuyas; el equipo las configura en Netlify (no van a Git).
**Datos requeridos (de tu panel Wompi producción):**
- `WOMPI_PUBLIC_KEY` (pub_prod_…): `____`
- `WOMPI_INTEGRITY_SECRET`: `____`
- `WOMPI_WEBHOOK_SECRET`: `____`

---

## 🤝 Carril C — Requiere información de terceros

Preguntas **listas para enviar**. Algunas necesitan que el dueño abra la cuenta
o reenvíe al ejecutivo.

### C1 · Kunas — SIRE / TRA (Migración / MinCIT) → desbloquea §2 + panel check-ins
**Datos que el dueño debe tener a mano:** TOKEN de integración, **RNT**, código
de propiedad y código de alojamiento (Ajustes > Integraciones > TRA/SIRE).
**Preguntas para Kunas:**
1. ¿El registro TRA/SIRE se dispara con datos de la **reserva** o del **check-in** en el PMS? ¿Qué campos toma y cuáles son obligatorios?
2. ¿Hay **endpoint API** para completar datos de huéspedes/documentos de una reserva existente? (cerrar el loop guest-app → PMS)
3. ¿Cubre **todos los canales** (web directa + OTAs) o solo reservas manuales?
4. ¿Cómo maneja **multi-ocupante** (N huéspedes por reserva)?
5. ¿Genera **evidencia/constancia** del envío (folio SIRE, acuse TRA) consultable?
> Si Kunas expone API para completar huéspedes → **opción A** (push desde el
> guest app, mínimo desarrollo). Si no → **opción B** (reportar nosotros).

### C2 · Wompi — reembolsos y anulaciones → desbloquea §3 / §6.8
**Preguntas para el ejecutivo de Wompi:**
1. ¿Nuestra cuenta tiene **anulación por panel** o todo pasa por soporte?
2. ¿SLA reales de anulación y de reembolso? (lo publicado: hasta 10 días hábiles)
3. Confirmar que **PSE / Nequi / Bancolombia no tienen reembolso por la pasarela** (se devuelven por transferencia manual).

### C3 · Booking.com — modelo de cobro del canal → desbloquea §4
**Preguntas para el account manager de Booking:**
1. ¿Qué medios de **payout** están habilitados para Colombia y esta propiedad (VCC vs. transferencia)?
2. ¿**Fee** de procesamiento de Payments by Booking sobre la comisión actual?
3. ¿Se puede activar **por plan de tarifa** (p. ej. solo no-reembolsables) o es todo-o-nada?
4. ¿Cómo se manejan los **reembolsos** al huésped cuando Booking cobró?
> Si se elige VCC: confirmar con el banco/adquirente que el datáfono permite
> **digitación manual de tarjeta no presente** (o pedir terminal virtual).

### C4 · DNS del dominio — entregabilidad de correo → desbloquea §11.2
Para que los correos (código de reserva, confirmación) no caigan en spam hay que
configurar **SPF / DKIM / DMARC** en el DNS del dominio.
**Pregunta:** ¿quién controla el **DNS de `hotelestar.co`** (registrador /
Cloudflare / agencia)? → `____` (el equipo técnico hace los registros una vez
tenga acceso o los valores a publicar).

---

## Fuera de alcance de este equipo

- **Facturación electrónica / DIAN / `account.move` en Odoo** — lo lleva **otro
  equipo** (contabilidad). Nosotros ya tenemos LIVE el maestro de clientes
  (`res.partner` upsert). No construir facturación aquí. Ver
  [`plan-integracion-odoo-otasync.md`](plan-integracion-odoo-otasync.md).

---

## Resumen de dependencias

```
B1 (NIT) ─────────────► A: legales (aviso-legal / privacidad)
B2 (checkout) ────────► A: late checkout + bot
B3 (cancelación) ─────► A: rate plans, cancelacion.html, motor
B5 (extras %) ────────► A: _pricing.js, reservar.html
B8 (reserva QA) ──────► A12: folio/cobro online + desayunos QR
B12 (handoff) ────────► activar bot WhatsApp
B13 (llaves) ─────────► cobro real en producción
C1 (Kunas) ───────────► SIRE/TRA + panel de check-ins
C2 (Wompi) ───────────► política de reembolsos publicada
C3 (Booking) ─────────► modelo de cobro del canal
C4 (DNS) ─────────────► deliverability de correo
```
