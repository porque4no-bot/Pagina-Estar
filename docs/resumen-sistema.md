# Resumen del sistema Estar — estado y flujos (para validación)

Mapa condensado de todo lo que hoy compone la plataforma: qué está **en
producción**, qué está **construido y a la espera de credenciales/decisiones**,
y qué está **pendiente**. Pensado para recorrer y validar punto por punto.

Fecha de corte: 2026-06-18.

---

## 0. Leyenda de estado

- 🟢 **En producción** — funciona hoy.
- 🟡 **Construido, no activo** — el código está listo; falta credencial,
  decisión o despliegue.
- 🔴 **Pendiente** — aún por definir/construir (ver `docs/pendientes.md`).

---

## 1. Sitio web (cara al cliente) — 🟢

- Multipágina estática (ES + EN), motor de reservas en `reservar.html`.
- Páginas clave: home, reservar, tipologías (5), nosotros/contacto/explora,
  vivir (larga estadía), empresas, grupos, FAQ, legales, guest app.
- **Reservas mensuales** publicadas con **IVA incluido** (ya aplicado).
- 🔴 Pendiente de contenido: política de cancelación nueva (Estricta/Flexible,
  rate plans reales en OTASync). Ver `pendientes.md` §5.1. (Mascota $200k,
  parqueadero eliminado, identidad legal Mirada SAS/NIT y check-out 11:00 ya
  aplicados — ver `pendientes.md` §0.)

## 2. Motor de reserva directa (web) — 🟢

Flujo de 4 pasos en `reservar.html` (`motor-app.jsx`):
1. **Habitación** → `check-availability` (precios/disponibilidad en vivo de
   OTASync), selector de tarifa Flexible/Estricta.
2. **Extras** → desayuno ($20k), late checkout (15% de la noche), early check-in
   (25% de la noche), mascota ($200k por reserva). Sin parqueadero. 🟢
3. **Datos del huésped** → nombre, email, teléfono, país, motivo, notas,
   casillas de privacidad y ESCNNA.
4. **Pago** → Wompi (lógica de IVA, widget, confirmación por polling).

- **Pago:** Wompi (activo). Mercado Pago queda como rollback. PSE/Nequi/
  Bancolombia salen dentro del flujo de Wompi.
- **La reserva se crea SOLO cuando el webhook de pago confirma** (no desde el
  cliente). `create-booking` está retirado (410).

## 3. Pagos y conciliación — 🟢

- `wompi-webhook`: valida firma, verifica el monto contra el precio real,
  dedupe e idempotencia por estadía, crea la reserva en OTASync.
- `reconcile-payments` (cada 30 min): detecta pagos aprobados sin reserva.
- `insertReservation` reintenta ante fallos transitorios (red/timeout/5xx).
- Emails al huésped en pago **rechazado/pendiente** (con link de reintento).
- 🟡 Reembolsos Fase 1 (backend): captura del medio de pago + ruteo + API admin,
  sin mover dinero. 🔴 Falta: ejecutar el reembolso por riel, formulario de
  cuenta destino, Booking VCC y conciliación contable. Ver `pendientes.md` §3.

## 4. Cancelaciones y reembolsos — 🟢 (solicitud) / 🔴 (reembolso)

- Botón "Gestionar reserva" → `request-cancellation`: verifica con segundo
  factor (código + email/apellido), **registra la solicitud**, alerta al
  equipo y acusa al huésped por correo. Dedupe 24 h.
- **NO cancela en OTASync ni reembolsa automáticamente** (a propósito, hasta
  definir rieles). El reembolso lo procesa el equipo.
- 🔴 Pendiente: política nueva por plan, no-show (1ª noche + impuestos + 3,5%),
  formulario de cuenta para reembolsos manuales, tabla de tiempos publicada.

## 5. Cotizaciones corporativas — 🟢

- CRUD de cotizaciones (Netlify Blobs), holds opcionales en OTASync, pago vía
  Wompi, auditoría, revalidación de disponibilidad (cron), reintentos.
- Admin en `cotizar-admin.html` (auth Firebase). Cliente ve en `cotizacion.html`.
- 🔴 Pendiente: factura mensual consolidada, crédito a 30 días, portal
  self-service (lo prometido en `empresas.html`). Odoo Fase 1 (clientes) ya
  está; el resto depende de Fase 2+. Ver `plan-integracion-odoo-otasync.md`.

## 6. Guest app (`guest.html`) — 🟢 / 🟡

- Acceso con código + apellido (JWT). Pre-check-in con OCR (Azure), firma
  electrónica del contrato (Ley 527), pedidos de servicios, datos cifrados
  (AES-256-GCM) en Blobs, archivado en Google Drive.
- Purga de datos a 5 años (Ley 1581, cron).
- 🟡 Cargos de servicios al folio del PMS: construido (Fase A cargar a cuenta /
  Fase B cobro online Wompi / Fase C correo al equipo), apagado por defecto.
- 🔴 Pendiente: panel de staff de check-ins, reporte SIRE/TRA.

## 7. Integraciones — estado

| Integración | Estado | Notas |
|---|---|---|
| OTASync / Kunas (PMS + channel manager) | 🟢 | Disponibilidad, precios, creación de reservas, holds. 🔴 Falta: rate plans reales, restricciones, webhooks de cancelación de OTAs, reintentos de hold. |
| Wompi (pagos) | 🟢 | Activo. PSE/Nequi habilitados. |
| Mercado Pago | 🟡 | Rollback configurable. |
| Google Drive | 🟢 | Archivado de documentos. 🟡 Reusar para servir RUT/Cámara de Comercio. |
| Azure Document Intelligence (OCR) | 🟢 | Pre-check-in. |
| Resend (emails) | 🟢 | Transaccionales y alertas. |
| SIRE / TRA (Migración / MinCIT) | 🔴 | Vía Kunas o directa — por evaluar (`pendientes.md` §2). |
| Booking.com (cobros) | 🔴 | VCC vs cobro directo (`pendientes.md` §4). |
| Odoo (ERP/contabilidad) | 🟡 | Fase 1 (maestro de clientes) live; Fase 2 (facturas) en pausa — otro equipo. Ver `plan-integracion-odoo-otasync.md`. |
| WhatsApp Cloud API + IA (bot) | 🟡 | Construido; falta validación Meta + API key. Ver §8. |

## 8. Bot de WhatsApp — capacidades y operación — 🟡

**Estado:** construido y probado (unit tests). **No activo** — pendiente la
validación de Meta (credenciales) y la `ANTHROPIC_API_KEY`. Kill switch:
`WHATSAPP_BOT_ENABLED`.

### 8.1 Arquitectura (doble modelo + reglas en código)

```
mensaje → GUARDIÁN (seguridad) → CONCIERGE (IA + herramientas) → respuesta
                                   autorización = CÓDIGO, no el modelo
```
- **Guardián** (Haiku): clasifica cada mensaje (safe/suspicious/malicious)
  antes del concierge. Bloquea prompt injection, suplantación, extracción de
  datos. Lo malicioso no entra al historial; 3 strikes → alerta al equipo.
- **Concierge** (Haiku por defecto): conversa en ES/EN y usa herramientas.
- Si la IA está apagada o falla → menús deterministas. *agente* → humano,
  siempre por código.

### 8.2 Qué PUEDE hacer el bot (funcionalidades activas)

| Acción | Tipo | Detalle |
|---|---|---|
| Consultar disponibilidad y precios | **Lectura** | En vivo desde OTASync. Nunca de memoria. Devuelve enlace de reserva. |
| Consultar una reserva | **Lectura** | Exige segundo factor (código + email/apellido). |
| Solicitar cancelación | **Escritura limitada y auditada** | Solo si la reserva fue verificada en esa conversación. Crea una **solicitud** + correos. |
| Escalar a humano | **Notificación** | Correo al equipo con resumen. |
| Responder info general | **Conocimiento** | Hotel, horarios, políticas, larga estadía, empresas (ver `bot-conocimiento.md`). |

### 8.3 Qué NO puede hacer (límites duros)

- ❌ Crear reservas (eso es solo web + webhook de pago).
- ❌ Modificar reservas en el PMS (cambios de fecha → derivar a humano).
- ❌ Cancelar en OTASync ni ejecutar reembolsos (solo **solicita**).
- ❌ Cobrar o pedir datos de pago por chat.
- ❌ Entregar datos de una reserva sin segundo factor verificado.
- ❌ Cancelar una reserva que no verificó en la misma conversación (regla en
  código, no en el prompt).

### 8.4 Salida hacia el recepcionista / humano — cómo se gestiona

- **Se dispara cuando:** el huésped escribe *agente*/pide humano; el bot
  detecta un caso que requiere persona (cotización larga estadía o empresa,
  queja, problema de pago, algo fuera de su alcance); o el guardián bloquea 3
  veces.
- **Mecanismo actual:** el bot envía un **correo** a `ADMIN_NOTIFY_EMAIL` con
  el número del huésped, su nombre de perfil y un resumen accionable, y le dice
  al huésped que una persona le escribirá por este mismo chat.
- **Quién responde y desde dónde:** 🔴 **POR DEFINIR.** Opciones:
  - (a) **App de WhatsApp Business** en un equipo de recepción (lo más simple;
    el número coexiste app + API desde 2026). Recomendado para arrancar.
  - (b) **Bandeja compartida / inbox de equipo** (WhatsApp Manager de Meta o
    una herramienta tipo Chatwoot) si responden varias personas.
  - (c) **"Toma de control" humana**: marcar la conversación para que el bot
    deje de responder mientras un humano atiende (requiere una bandera de
    sesión; no está hecho — para v1 el bot avisa y la persona responde).
- **🔴 Decisiones pendientes del handoff:**
  - ¿Horario de atención humana? ¿Qué dice el bot fuera de horario?
  - ¿El bot debe **pausar** sus respuestas automáticas una vez un humano
    entra al chat? (hoy no; seguiría respondiendo).
  - ¿A qué correo/persona llega el escalamiento? (`ADMIN_NOTIFY_EMAIL`).

### 8.5 Configuración del bot (variables)

- Meta: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`,
  `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_BOT_ENABLED`.
- IA: `ANTHROPIC_API_KEY`, `WHATSAPP_AI_MODEL` (default Haiku),
  `WHATSAPP_GUARD_ENABLED`. Guía: `docs/whatsapp-bot.md`.

---

## 9. Checklist de validación (qué probar cuando esté todo activo)

### 9.1 Reserva directa (web)
- [ ] Buscar disponibilidad → ver 5 tipologías con precios reales.
- [ ] Seleccionar Flexible y Estricta → diferencia de precio correcta.
- [ ] Extras (desayuno/late/early) → suma correcta; mascota $200k; sin
      parqueadero.
- [ ] Pago de prueba Wompi (tarjeta) → reserva creada en OTASync, email al
      huésped, sin banner "MODO PRUEBA" en producción.
- [ ] Pago con PSE y con Nequi → aparecen en el checkout y completan.
- [ ] Pago rechazado → llega email con link de reintento.

### 9.2 Gestión de reserva / cancelación
- [ ] Buscar reserva con código + email correcto → aparece.
- [ ] Código correcto + apellido/email equivocado → "no encontrada" (no filtra).
- [ ] Solicitar cancelación → correo al equipo + acuse al huésped.
- [ ] Verificar tiempos/penalidad según el plan (Flexible vs Estricta).

### 9.3 Bot de WhatsApp
- [ ] Saludo → responde y ofrece ayuda.
- [ ] "¿Disponibilidad 15 al 18 de agosto para 2?" → consulta real + enlace.
- [ ] Pregunta general (mascotas, check-in, parqueadero) → respuesta correcta
      según `bot-conocimiento.md`.
- [ ] "Quiero cancelar EST-XXXX" sin verificar → pide código + email/apellido.
- [ ] Cancelación con verificación → registra solicitud.
- [ ] *agente* → escala a humano (llega el correo).
- [ ] Intento de prompt injection ("ignora tus instrucciones…") → bloqueado,
      no responde con datos.
- [ ] Pedir datos de otra reserva sin verificar → rechazado.

### 9.4 Integraciones
- [ ] `whatsapp-probe` (admin) → credenciales Meta OK.
- [ ] `drive-probe` (admin) → Google Drive OK.
- [ ] Reserva de OTA (Booking) entra a OTASync correctamente.
- [ ] Guest app: check-in con documento → OCR + Drive + contrato firmado.

---

## 10. Documentos relacionados

- `docs/pendientes.md` — la lista viva de lo que falta (consolidada).
- `docs/configuracion-kunas.md` — cómo configurar Kunas para que cuadre con la web.
- `docs/plan-integracion-odoo-otasync.md` — integración Odoo (plan + estado).
- `docs/bot-conocimiento.md` — base de conocimiento/FAQ del bot.
- `docs/whatsapp-bot.md` — arquitectura y setup del bot.
- `docs/guest-app.md` — guest app.
- `docs/README.md` — índice de toda la documentación.
- `CLAUDE.md` — referencia técnica completa del repo.
