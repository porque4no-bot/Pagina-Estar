# Checklist de producción — Estar

Lista única **go / no-go** para pasar la plataforma a tráfico real. Consolida
las matrices de [`testing.md`](testing.md), [`testing-production.md`](testing-production.md)
y el checklist de [`resumen-sistema.md`](resumen-sistema.md) §9, y **suma la capa
que faltaba**: operación y confiabilidad (observabilidad, correo, respaldo,
handoff, panel de check-ins).

Fecha de creación: 2026-06-19. Derivado del mapa de arquitectura.

## Cómo usar este doc

- **Prioridad:** `P0` = bloqueante (no se lanza sin esto) · `P1` = antes de
  abrir el canal · `P2` = deseable / post-lanzamiento.
- Marca `[x]` cuando esté **verificado en producción** (no solo "construido").
- Cada bloque tiene un **responsable** sugerido: 👤 dueño / negocio ·
  🛠️ desarrollo · 🤝 proveedor externo.
- Criterio de salida al final.

---

## 0. Bloqueantes de lanzamiento (cerrar SÍ o SÍ)

Cosas que hoy están **mal** o ausentes y exponen legal/dinero. Detalle en
[`pendientes.md`](pendientes.md) donde aplique.

- [x] **P0 · 🛠️ Quitar parqueadero como servicio cobrado** (`pendientes.md` §6.3).
      ✅ **HECHO (verificado 22-jun):** el parqueadero **ya no se cobra** (FAQ +
      slot reservado en el `extrasMask` del motor, sin reindexar). Ya no es
      bloqueante.
- [x] **P0 · 👤🛠️ Identidad legal en documentos** (`pendientes.md` §6.7).
      ✅ **HECHO (verificado 22-jun):** **MIRADA S.A.S** + **NIT 902.032.515-0**
      (+ RNT 276306) **presentes y correctos** en `aviso-legal.html` y
      `privacidad.html` (ES/EN). Ya no es bloqueante.
- [x] **P0 · 👤 Hora de check-out unificada** (`pendientes.md` §6.9).
      ✅ **HECHO (verificado 22-jun):** el check-out **ya es 11:00** en todo el
      sitio (index, FAQ y bot coinciden). Ya no es bloqueante.
- [ ] **P0 · 👤🛠️ Política de cancelación + planes de tarifa reales**
      (`pendientes.md` §6.1). Estricta/Flexible como rate plans en OTASync,
      reescribir `cancelacion.html` (ES/EN) y etiquetas del motor.
- [ ] **P1 · 🤝👤 SIRE / TRA** (`pendientes.md` §2). Riesgo regulatorio con
      extranjeros: medir hoy qué % de reservas web llegan completas y decidir
      vía Kunas (opción A) vs. directa (opción B).

---

## 1. Motor de reserva directa (web) — P0

Ver banner **MODO PRUEBA** obligatorio en sandbox; ausente en producción.

- [ ] Buscar disponibilidad → 5 tipologías con **precios reales** de OTASync.
- [ ] Selector Flexible vs Estricta → diferencia de precio correcta (10% exacto;
      ya migrado de `/0.9` a `×1.10` en motor + servidor).
- [ ] Extras: desayuno suma bien; **mascota $200k** (§6.2); **sin parqueadero**;
      late/early con el modelo de % acordado (§6.5) o el actual documentado.
- [ ] Datos del huésped: validación de privacidad + ESCNNA obligatorias.
- [ ] Pago Wompi sandbox (tarjeta) → retorno OK / pendiente / rechazado
      actualizan la reserva.
- [ ] Pago con **PSE** y con **Nequi** → aparecen en el checkout y completan
      (§6.6).
- [ ] Pago rechazado/pendiente → llega correo con link de reintento.
- [ ] Reserva creada **solo** tras webhook; coinciden fechas, huésped,
      habitación, precio y referencia en OTASync (prop. 9889).
- [ ] Borrador `sessionStorage` se limpia al confirmar; TTL 30 min funciona.
- [ ] Desktop **y** móvil (Playwright cubre ambos; validar manual el pago).

## 2. Gestión de reserva y cancelación — P0/P1

- [ ] Buscar con código + email correcto → aparece.
- [ ] Código correcto + apellido/email equivocado → "no encontrada" (no filtra
      PII).
- [ ] Solicitar cancelación → correo al equipo + acuse al huésped; dedupe 24 h.
- [ ] La solicitud crea registro en `_refunds-store` (estado `NEEDS_REVIEW`).
- [ ] Panel de **Reembolsos** en `cotizar-admin.html`: aprobar/denegar, fijar
      monto, ver ruteo por medio (GATEWAY_AUTO / ASSISTED / MANUAL_BANK).
- [ ] Falta capturar **datos de cuenta** del huésped para reembolso manual
      (`pendientes.md` §6.8) — formulario + correo a tesorería.

## 3. Guest app — P0/P1

- [ ] Login: solo código + apellido correctos abren la estancia; reserva
      inexistente muestra error.
- [ ] Documento JPG/PNG/PDF → Azure extrae o permite corrección manual.
- [ ] Documento > 4.5 MB se rechaza antes de enviar; documento vencido advierte.
- [ ] Campos/privacidad incompletos → no se envía el check-in.
- [ ] Drive: se crea carpeta de reserva con metadata + documento correcto.
- [ ] Firma de contrato → PDF con reserva, firmante, fecha, versión y evidencia
      (Ley 527).
- [ ] Servicios adicionales: el servidor recalcula cantidades/total desde
      `_services-catalog.js` (no confía en el navegador).
- [ ] Cargo al folio (`GUEST_SERVICE_FOLIO_ENABLED`) y cobro online
      (`GUEST_SERVICE_PAYMENT_MODE=wompi`): **probar en reserva real antes de
      activar** (hoy apagados).
- [ ] Cerrar sesión y expiración: token vencido no reingresa.
- [ ] Purga a 5 años (`purge-guest-data`, Ley 1581) corre sin borrar de más.

## 4. Cotizaciones corporativas — P1

- [ ] Crear/editar cotización (bloqueado si falta disponibilidad).
- [ ] Hold opcional en OTASync; liberación en cancelar/expirar (`revalidate-quotes`).
- [ ] Pago Wompi de cotización → verifica monto, marca `aceptada`, idempotente.
- [ ] Cliente ve `cotizacion.html`; admin opera `cotizar-admin.html` (auth
      Firebase + `ADMIN_EMAILS`).
- [ ] Auditoría (`read-quote-audit`) registra cambios.

## 5. Desayunos QR (staff) — P1

- [ ] Escanear QR (`bookingCode:guestIndex`) en `desayuno.html` → estado correcto.
- [ ] Redención idempotente (1/persona/día); cuenta ciclo/día.
- [ ] Upgrade (`BREAKFAST_UPGRADE_ENABLED`) carga el folio si está activo.
- [ ] `desayuno-admin.html`: analytics solo-admin (`ADMIN_EMAILS`), tablero del
      día, cortesías.
- [ ] **Validar con una reserva real en OTASync** (pendiente del dueño).

## 6. Bot de WhatsApp — P1 (antes de activar)

- [ ] `whatsapp-probe` (admin) → credenciales Meta OK.
- [ ] Disponibilidad en vivo + enlace de reserva.
- [ ] Cancelación: exige 2º factor verificado **en la misma conversación**.
- [ ] Prompt injection / pedir datos de otra reserva → bloqueado por el guardián.
- [ ] `agente` → escala a humano (llega el correo).
- [ ] **🔴 Definir el handoff humano** (ver §11.4) — bloqueante operativo.

---

## 7. Integraciones — verificar cada puente — P0/P1

- [ ] **OTASync/Kunas**: disponibilidad, precios, creación de reserva, holds.
- [ ] **Wompi** (producción): firma server-side, verificación de monto,
      webhook 200, dedupe/idempotencia. Banner de prueba ausente.
- [ ] **Mercado Pago** (rollback): `PAYMENT_PROVIDER=mercadopago` redespliega y
      enruta (probar en sandbox).
- [ ] **Resend**: correos transaccionales llegan (ver §11.2 deliverability).
- [ ] **Azure OCR**: `prebuilt-idDocument` responde; fallback manual si no.
- [ ] **Google Drive**: `drive-probe` OK; archivado funciona.
- [ ] **Firebase**: login admin en paneles noindex.
- [ ] **Reserva de OTA (Booking)** entra a OTASync correctamente.
- [ ] **Booking.com cobros** (`pendientes.md` §4): definir VCC vs cobro directo.

---

## 8. Seguridad — P0/P1

- [ ] CSP por hash SHA-256 sin `unsafe-inline` en script-src (generada por
      `build.js` en `dist/_headers`).
- [ ] Headers: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
      `Permissions-Policy` presentes.
- [ ] Paneles admin/staff/guest con `noindex` + `no-store`.
- [ ] No hay secretos ni documentos reales en Git, logs ni reportes
      (secret-scanning de Netlify activo).
- [ ] `get-booking`/`request-cancellation` exigen 2º factor; respuesta uniforme
      "no encontrada".
- [ ] Webhooks validan firma (Wompi `WOMPI_WEBHOOK_SECRET`, OTASync
      `OTASYNC_WEBHOOK_SECRET`, WhatsApp `X-Hub-Signature-256`).
- [ ] Rate limiting (`_rate-limit`) en endpoints sensibles.
- [ ] **P2 · Cloudflare Bot Fight Mode** (dashboard, no código) — palanca grande
      de rendimiento/abuso.

## 9. Rendimiento y SEO — P1/P2

- [ ] Imágenes WebP, video hero diferido, fuentes no bloquean (PageSpeed móvil
      objetivo 90+).
- [ ] Canonical, sitemap, robots, titles/descriptions correctos (ES/EN).
- [ ] Responsive 360 / 768 / 1024 / 1440 sin desbordes.
- [ ] Accesibilidad por teclado: foco visible, menú/formularios sin ratón
      (contraste WCAG AA — ya trabajado).
- [ ] Consent Mode v2: analytics/ads en `denied` por defecto; banner funciona.

---

## 10. Pre-lanzamiento: una transacción real

(De [`testing-production.md`](testing-production.md) §5 — no omitir.)

- [ ] Clásica, 1 noche, correo propio, tarjeta real.
- [ ] Sin banner amarillo en el paso de pago.
- [ ] Verificar en orden: Wompi APPROVED → `wompi-webhook` 200 → reserva en
      OTASync 9889 → PDF/log en Drive → correo de confirmación al huésped.
- [ ] Cancelar la reserva y reembolsar el cargo. Registrar timestamp + código.

---

## 11. Operación y confiabilidad — la capa que faltaba en el panel

Estos **no** estaban (o estaban sueltos) en `pendientes.md`. Son los que evitan
que algo "falle en silencio" en producción.

### 11.1 Observabilidad y alertas — 🔴 P0 · 🛠️
- [ ] Error tracking (ej. Sentry) en funciones críticas: `wompi-webhook`,
      `guest-checkin`, `create-quote`, `_otasync`, `send-confirmation`.
- [ ] Alerta cuando un webhook devuelve 5xx, OTASync no responde, o un correo
      no se envía. Hoy solo `reconcile-payments` cubre **pagos**; el resto es
      silencioso.
- [ ] Tablero/alarma de los crons (que efectivamente corrieron).

### 11.2 Entregabilidad de correo — ✅ HECHO (confirmado por el dueño 22-jun)
- [x] **SPF / DKIM / DMARC** del dominio configurados y verificados en Resend.
- [x] Prueba real a Gmail/Outlook/Apple Mail → llega a bandeja, no a spam.
- [x] Remitente y dominio verificados; enlaces no marcados como sospechosos.

### 11.3 Respaldo / recuperación de Netlify Blobs — 🔴 P1 · 🛠️
- [ ] Estrategia de backup/export de Blobs: cotizaciones, **reembolsos**,
      desayunos y **PII cifrada** viven solo ahí.
- [ ] Procedimiento de restauración probado al menos una vez.

### 11.4 Handoff humano del bot — 🟡 P1 · 👤
(Decisiones de [`resumen-sistema.md`](resumen-sistema.md) §8.4, sin dueño.)
- [ ] ¿Quién responde y desde dónde? (app WhatsApp Business / inbox compartido).
- [ ] ¿El bot **pausa** sus respuestas cuando entra un humano? (hoy no).
- [ ] ¿Horario de atención? ¿Qué dice el bot fuera de horario?
- [ ] ¿A qué correo/persona llega el escalamiento? (`ADMIN_NOTIFY_EMAIL`).

### 11.5 Panel de staff para check-ins — 🟡 P1 · 🛠️
- [ ] Pantalla de recepción para revisar check-ins del guest app y **empujar los
      datos al PMS** (cierra el loop guest-app → OTASync/Kunas y habilita
      SIRE/TRA opción A). Hoy los datos se capturan y cifran pero nadie los
      acciona.

---

## 12. Criterio de salida (go / no-go)

Se pasa a producción cuando:

1. `npm test` termina sin fallos.
2. Todos los **P0** de §0–§11 están verificados en producción.
3. La transacción real de §10 pasó completa y se documentó.
4. No hay secretos ni datos reales en Git, logs o reportes.
5. Observabilidad (§11.1) y deliverability (§11.2) están activas — sin esto,
   un fallo no se detecta a tiempo.
6. Cada **P1** pendiente tiene responsable, riesgo documentado y fecha.

---

## Documentos relacionados

- [`pendientes.md`](pendientes.md) — decisiones e integraciones pendientes.
- [`resumen-sistema.md`](resumen-sistema.md) — estado por componente.
- [`testing.md`](testing.md) / [`testing-production.md`](testing-production.md) —
  matrices de prueba y setup sandbox/producción.
- [`CLAUDE.md`](../CLAUDE.md) — referencia técnica del repo.
