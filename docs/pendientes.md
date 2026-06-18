# Pendientes — Hotel Estar (estado de trabajo)

Lista única y viva de lo que falta: integraciones, lógica de negocio, conversión
y cumplimiento. Cada ítem trae el contexto necesario para arrancar sin
re-investigar.

**Fecha de corte: 2026-06-18.** Este documento **consolida y reemplaza** a los
informes de trabajo que ya cumplieron su propósito (la auditoría 360° de
seguridad, la evaluación de customer journey, el cuestionario de dudas de
implementación y la revisión legal): lo que de ellos seguía vivo quedó aquí; el
resto ya está implementado (ver §0). El historial completo de esos informes vive
en git.

---

## 0. Ya implementado (resumen — para no re-trabajar)

> Lo de abajo **ya está en producción o en `master`**. Se lista para que ninguna
> sesión futura lo proponga como pendiente (era el origen de la confusión).

- **Seguridad (auditoría 360°):** `create-booking` retirado (410) — el webhook de
  pago es el único creador de reservas; recompute server-side de precio + gate de
  disponibilidad también en Mercado Pago; `reconcile-payments` cubre reservas
  directas (no solo cotizaciones); `get-booking`/guest-session exigen segundo
  factor; purga de PII a 5 años (cron `purge-guest-data`); idempotencia por
  estadía en el webhook directo; GA4 e-commerce + Consent Mode v2; CVE de
  dependencias resuelto; precios con fuente única (`_pricing.js`) + test
  anti-divergencia.
- **Extras y tarifas:** parqueadero eliminado como servicio; mascota **$200.000
  por reserva** (fijo); late check-out **15% de la noche** (hasta 2 PM); early
  check-in **25% de la noche** (plano, desde 6 AM — el modelo escalonado 15/35/50
  se descartó); catálogo único de adicionales (desayuno $20k unificado).
- **Check-out unificado a 11:00** en index, FAQ, contrato, PDF y correo.
- **Reembolsos Fase 1 (backend):** captura del medio de pago + ruteo + API admin
  (sin mover dinero todavía).
- **Guest app → folio Kunas:** Fase A (cargar a la cuenta), Fase B (cobro online
  Wompi) y Fase C (correo al equipo) construidas; A y B **apagadas por defecto**.
- **Odoo Fase 1 (maestro de clientes):** conector `_odoo.js` live, partners
  deduplicados en Mirada SAS (company 5), CRM instalado, backfill de huéspedes
  ejecutado. Detalle en `plan-integracion-odoo-otasync.md`.
- **Legal:** identidad jurídica (Mirada SAS · NIT 902032515) en `aviso-legal.html`
  y `privacidad.html`; aviso ESCNNA en el hero; banner de cookies con opt-in.
- **Dirección canónica** unificada (Cl. 61 #23-36).

---

## 1. Integración con Odoo (ERP / contabilidad)

> **Plan completo en `plan-integracion-odoo-otasync.md`** (arquitectura, modelo
> de evaluación financiera con DataCrédito, plan por fases y estado de ejecución).

- **Fase 1 (maestro de clientes): HECHA** — ver §0.
- **Fase 2 (ventas/facturas): EN PAUSA por decisión del dueño** — la facturación
  electrónica (DIAN/Numera) la integra **otro equipo**. Nuestro alcance en Odoo se
  limita al maestro de clientes (`res.partner`) hasta que ese equipo termine.
- **Fases 3-5 (evaluación financiera + crédito, espejo de reservas + CxC, portal
  corporativo):** pendientes; dependen de Fase 0 (accesos DataCrédito) y de Fase 2.

---

## 2. SIRE y TRA — evaluar la vía Kunas vs. integración directa

**Contexto:** el reporte a SIRE (Migración Colombia, huéspedes extranjeros) y la
TRA (Tarjeta de Registro de Alojamiento, MinCIT) se está manejando desde Kunas.
Kunas tiene integración nativa: Ajustes > Integraciones > TRA/SIRE con TOKEN +
RNT + código de propiedad + código de alojamiento, y reporta automáticamente a
partir de los datos de las reservas en el PMS.

**El problema a evaluar:** las reservas que crea nuestra web en OTASync llevan un
solo huésped con `first_name`/`last_name` y nada más (`_otasync.js`,
`wompi-webhook.js`) — sin tipo/número de documento, nacionalidad, fecha de
nacimiento ni procedencia, que son los campos que SIRE y TRA exigen. El guest app
ya captura exactamente esos datos (documento + OCR Azure, multi-ocupante) y los
guarda cifrados en Blobs **sin empujarlos al PMS**.

**Preguntas para Kunas antes de decidir:**
- ¿El registro TRA/SIRE se dispara con datos de la reserva o del check-in en el
  PMS? ¿Qué campos exactos toma y cuáles son obligatorios?
- ¿Hay endpoint API para completar los datos de huéspedes/documentos de una
  reserva existente (el "Phase 2" pendiente de `guest-app.md`)?
- ¿Cubre todos los canales (web directa + OTAs) o solo reservas manuales?
- ¿Qué pasa con multi-ocupante (N huéspedes por reserva)?
- ¿Genera evidencia/constancia del envío (folio SIRE, acuse TRA) consultable?

**Criterio de decisión:**
- Si Kunas expone API para completar huéspedes → **opción A (preferida):** cerrar
  el loop guest-app → OTASync/Kunas (push de datos de check-in) y dejar que Kunas
  reporte. Mínimo desarrollo, una sola fuente de verdad.
- Si no la expone → **opción B:** reportar nosotros directamente desde
  `guest-checkin` (SIRE por carga/API de Migración; TRA por API del MinCIT), con
  los datos que el guest app ya captura.

**En cualquier caso:** medir hoy qué % de reservas web llegan a SIRE/TRA completas
— ese es el riesgo regulatorio actual.

---

## 3. Devoluciones y política de cancelación (Wompi / MP / efectivo / datáfono)

**Estado:** el botón "Gestionar reserva" envía una **solicitud** real
(`request-cancellation`): verifica con segundo factor, alerta al equipo y confirma
al huésped. La **Fase 1 de reembolsos (backend)** ya captura el medio de pago y lo
rutea (sin mover dinero). Falta: ejecutar el reembolso por cada riel, el
formulario de cuenta para los manuales, y publicar los plazos.

**Rieles de devolución (investigado):**

- **Wompi (tarjetas Visa/MC/Amex):** existe *anulación* (cuanto antes mejor) y
  *reembolso* gestionado con soporte aportando código de autorización, fecha,
  últimos dígitos y valor. Hasta 10 días hábiles; el abono depende del banco
  emisor. Solo aplica a "Tarjetas" — **PSE/Nequi/Botón Bancolombia NO tienen
  reembolso por la pasarela**: hay que devolver por transferencia manual.
  Confirmar con el ejecutivo de Wompi si la cuenta tiene anulación por panel.
- **Mercado Pago (rollback):** API de reembolsos
  (`POST /v1/payments/{id}/refunds`, total o parcial) hasta 180 días, sujeto a
  saldo; abono en tarjeta hasta ~15 días hábiles. PSE se devuelve a la cuenta MP.
- **Efectivo / datáfono en sitio:** fuera del alcance de la web. Definir
  procedimiento operativo y reflejarlo en `cancelacion.html`.

**Trabajo pendiente:**
1. Definir con Wompi el flujo exacto (panel vs. soporte) y los SLA reales.
2. Actualizar `cancelacion.html` (ES/EN) con medios y plazos de reembolso.
3. Registrar el plan tarifario (Flexible/Estricta) en la referencia Wompi y en la
   nota de OTASync para que la política sea verificable por reserva.
4. Fase 2 de autoservicio: `cancel-booking` real — verificación de tarifa/ventana
   → cancelación en OTASync (`reservation/delete/reservation`) → reembolso
   automático (API MP; Wompi según lo acordado) → correo con el detalle.
5. **Formulario de cuenta destino** para los métodos no autogestionables
   (PSE/Nequi/efectivo): banco, tipo y número de cuenta, titular, documento +
   correo a tesorería. Engancha con `request-cancellation`.

**Tabla de tiempos a publicar** (sujeto a cada proveedor):

| Método de pago | Reembolso | Tiempo estimado |
|---|---|---|
| Tarjeta (Wompi) | Por la pasarela | ~10 días hábiles (depende del banco) |
| Tarjeta (Mercado Pago) | API de reembolsos | ~15 días hábiles |
| PSE / Nequi / Bancolombia | Transferencia manual | definir SLA (p. ej. 5 días hábiles) |
| Efectivo / datáfono en sitio | Transferencia manual | definir SLA |
| Booking.com (VCC) | Lo gestiona Booking | según Booking |

**Fuentes:**
- [Wompi — reversión de transacción con tarjeta de crédito](https://soporte.wompi.co/hc/es-419/articles/360046916653--C%C3%B3mo-se-gestiona-la-reversi%C3%B3n-de-una-transacci%C3%B3n-con-Tarjeta-de-cr%C3%A9dito)
- [Wompi — reembolso total e impuestos](https://soporte.wompi.co/hc/es-419/articles/1500009267322--Qu%C3%A9-es-reembolso-total-y-qu%C3%A9-pasa-con-los-impuestos-previamente-liquidados)
- [Mercado Pago — reembolsos y cancelaciones (Checkout API)](https://www.mercadopago.com.co/developers/es/docs/checkout-api/payment-management/cancellations-and-refunds)
- [Kunas — TRA & SIRE](https://kunas.io/TRA-&-SIRE/) · [configurar TRA](https://faq.kunas.io/es/articles/9033801-como-configuro-y-realizo-el-registro-al-tra) · [registro SIRE](https://faq.kunas.io/es/articles/11061823-como-realizo-el-registro-del-sire)

---

## 4. Booking.com — configurar el cobro de las reservas

**Objetivo:** dejar de depender del cobro manual de las reservas que entran por
Booking.com y definir el modelo de pago oficial del canal.

**Los dos modelos posibles:**

1. **Payments by Booking.com (evaluar primero).** Booking le cobra al huésped y le
   paga al hotel por **tarjeta de crédito virtual (VCC)** — una Mastercard digital
   por reserva, activada normalmente el día del check-in, cobrable hasta 6 meses
   después (extensible) — o por **transferencia bancaria**. Requisito operativo de
   la VCC: un medio para cobrar tarjeta no presente (datáfono con digitación
   manual Redeban/Credibanco o terminal virtual — conectar con el punto 3).
   Ventajas: elimina no-shows con tarjetas inválidas, menos manejo PCI, cobro
   garantizado. Contras: fee adicional y flujo de caja atado a la activación.
2. **Cobro directo por el hotel (modelo actual implícito):** Booking pasa los
   datos de tarjeta del huésped (requiere acceso PCI en la extranet) y el hotel
   cobra manualmente. Contras: carga operativa, tarjetas declinadas, riesgo PCI.

**Pasos (extranet):**
1. Finanzas → Payments by Booking.com: verificar elegibilidad en Colombia y el
   medio de payout (VCC vs transferencia).
2. Revisar políticas de prepago y cancelación por plan de tarifa (determinan
   cuándo Booking cobra al huésped).
3. Si es VCC: confirmar con el banco/adquirente la digitación manual de tarjeta no
   presente y documentar el procedimiento de cobro en recepción.
4. Definir el tratamiento de no-shows y cancelaciones tardías del canal.
5. **Conciliación:** las reservas llegan a OTASync por el channel manager, pero el
   dinero (VCC/transferencia) y la comisión van por otro lado — incluir en la
   conciliación contable (fase Odoo: ventas OTA + comisiones Booking como gasto).

**Preguntas para el account manager de Booking:**
- ¿Qué medios de payout están habilitados para Colombia y esta propiedad?
- ¿Fee de procesamiento de Payments by Booking sobre la comisión actual?
- ¿Se puede activar por plan de tarifa (solo no-reembolsables) o es todo-o-nada?
- ¿Cómo se manejan los reembolsos al huésped cuando Booking cobró?

**Fuentes:**
- [Payments by Booking.com — FAQs](https://partner.booking.com/en-us/help/policies-payments/payment-products/payments-bookingcom-faqs)
- [Booking.com — Online Payments (partners)](https://partner.booking.com/en-us/solutions/online-payments)
- [Cloudbeds — FAQ de VCC de Booking.com](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/44061325834779-Booking-com-VCC-FAQ)

---

## 5. Decisiones de negocio tomadas — lo que falta aplicar

> Las decisiones del 2026-06-13 ya implementadas (parqueadero, mascota, late/early
> %, check-out 11:00) están en §0. Aquí queda **solo lo pendiente**.

### 5.1 Planes de tarifa reales en OTASync
Hoy la web **calcula** la tarifa Flexible (`precio ÷ 0,9` ≈ +11%) y solo lee un
precio de Kunas. La decisión es crear **dos rate plans REALES en OTASync** para
paridad con Booking/Airbnb:
- **Estricta** = base. Cancelación gratuita hasta **7 días antes**; después, no
  reembolsable.
- **Flexible** = base **+10%**. Cancelación gratuita hasta las **6:00 PM del día
  anterior**; después, penalidad.
- **No-show / cancelación tardía** (ambos): primera noche + impuestos + **3,5%**
  del total (el 3,5% cubre la comisión de la pasarela, no reembolsable).

Implementación: `check-availability` debe devolver **ambos precios desde OTASync**
y el motor deja de calcular el ±%. Reescribir `cancelacion.html` (ES/EN),
etiquetas de tarifa en `motor-app.jsx` + `i18n/motor.*.json`, system prompt del
bot y la política de `ManageBooking`. Mientras tanto, si se mantiene el cálculo,
alinear a `× 1.10` (10% exacto, no 11,1%). Ver también `configuracion-kunas.md`.

### 5.2 Documentos legales descargables (RUT y Cámara de Comercio)
Sección para descargar el **RUT y la Cámara de Comercio** más recientes (facilita
la gestión a las empresas), en `empresas.html` y/o footer legal. Deben
**autoactualizarse al más reciente subido en una carpeta de Google Drive** —
reutilizar la integración Drive existente (`_google-drive`, service account).

### 5.3 Verificar PSE y Nequi en el checkout de producción
PSE y Nequi ya están habilitados en la cuenta Wompi y el widget los ofrece.
`reservar.html` ya los menciona. **Verificar** que aparezcan en el checkout en
producción; opcionalmente darles visibilidad propia (íconos) en la UI.

### 5.4 Estructura legal de larga estadía (Ley 820) — SE MANTIENE PENDIENTE
Confirmar hospedaje turístico vs. arrendamiento (decisión del huésped, pendiente).
Afecta la validez de la retención de depósito. La Ley 820 de 2003 **prohíbe
exigir depósitos en dinero** en arrendamiento de vivienda urbana; `cancelacion.html`
ya enmarca la larga estadía como hospedaje turístico (Código de Comercio), pero la
decisión de fondo sigue abierta.

---

## 6. Conversión y experiencia (de la evaluación de customer journey)

> Lo de bajo esfuerzo y alto impacto ya se hizo (resumen móvil sticky, texto del
> polling, badge del carrito, feedback de subida de documentos, reseñas de Booking
> reutilizadas en B2B). Queda lo que **necesita datos del dueño** o más esfuerzo.

| # | Acción | Página(s) | Necesita del dueño |
|---|---|---|---|
| 1 | **Precio ancla corporativo** ("desde $X/noche") | `empresas.html` | Sí — el valor o rango |
| 2 | **Escala de descuento por nº de unidades** | `grupos.html` | Sí — los % por tramo |
| 3 | **Caso de éxito con cifras** (Hospital de Caldas, etc.) | `empresas.html` | Sí — 1-3 casos publicables |
| 4 | **Criterios + SLA + tasa de aprobación** de larga estadía | `vivir.html` | Sí — requisitos reales |
| 5 | **Ejemplos numéricos de reembolso** + acotar plazo | `cancelacion.html` | Depende de §3 y §5.1 |
| 6 | **Expandir FAQ** (de 6 a ~12, enlazar a cancelación) | `faq.html` | Sí — respuestas (ver §7) |
| 7 | Persistir el borrador del motor más allá de `sessionStorage` (30 min) | `motor-app.jsx` | No (técnico) |
| 8 | CTA sticky "¿Listo para tu viaje?" tras explorar | `explora.html` | No (técnico) |
| 9 | Testimonios propios por segmento (CFO, organizador, nómada) | B2B | Opcional — texto + permiso |

---

## 7. Datos de negocio por confirmar (alimentan la web y el bot)

Datos que solo el dueño tiene y que hoy salen como "POR CONFIRMAR" en
`bot-conocimiento.md` y bloquean respuestas/contenido. Prioridad por frecuencia de
pregunta del huésped:

1. **¿Se comparte la dirección por chat o solo tras reservar?** (hoy el bot remite
   a `explora.html`).
2. **Parqueadero público cercano:** nombre y distancia (para orientar — el hotel
   no ofrece parqueadero propio).
3. **Desayuno:** ¿se mantiene como extra? ¿qué incluye? ¿restricciones dietarias?
4. **Reglas de mascotas** además del cobro de $200k (tamaño/número, áreas).
5. **Aseo durante la estadía corta:** ¿sí/no? (en larga estadía es semanal).
6. **Soporte fuera de horario:** ¿teléfono 24/7 para emergencias de acceso?
7. **Factura electrónica:** ¿se emite a todos? ¿se pide en chat o en la web?
8. **SLA real comprometido** públicamente (contacto y Concierge guest app).
9. **Recomendaciones de la zona** que el bot deba manejar (restaurantes, Termales,
   Nevado, aeropuerto/distancias).
10. **Política Fase 2 de cancelación/FAQ/larga estadía** (montos, plazos,
    requisitos, depósitos) — el detalle que falta para escribir `cancelacion.html`,
    `faq.html` y `vivir.html` con ejemplos correctos.

---

## 8. Observabilidad y robustez (de la auditoría 360°)

- **Panel de operación para pagos/reservas pendientes (M-3, Fase 3).** Hoy casi
  todos los errores de webhook devuelven 200 + email al admin como única red de
  seguridad; si falta `RESEND_API_KEY` la alerta se pierde. Persistir los estados
  "pagado sin reserva" en un store consultable y construir un panel; no depender
  solo de email. *(Verificar que `RESEND_API_KEY` y `ADMIN_NOTIFY_EMAIL` estén en
  prod entretanto.)*
- **Métricas/observabilidad:** tasa de éxito de webhook, latencia OTASync,
  *orphans* de pago, en un dashboard. Eventualmente máquina de estados explícita
  con *dead-letter queue* en lugar de webhooks que devuelven 200.
- **Pre-hold de inventario** en el checkout directo (reutilizar `createHold`).
- **Webhook OTASync `reservation edit/cancel`:** las cancelaciones desde OTAs no
  liberan holds ni se sincronizan — manejarlas.
- **Capacidad de extras** (early/late) y **precios de extras en configuración**
  (Blobs) en vez de hardcode en `_pricing.js`.
- **Notas/solicitudes especiales del huésped** no llegan al PMS (la referencia
  Wompi no las codifica).
- **Emails faltantes:** pre-llegada, post-estadía, recordatorio de cotización por
  vencer (rechazado/pendiente ya existen).

---

## 9. Preguntas de negocio abiertas (de la auditoría)

1. **IVA diferido al check-in:** el cobro online es siempre el subtotal SIN IVA;
   para colombianos/viajeros de negocio el IVA (19%) se marca "por cobrar en
   alojamiento". ¿Hay control operativo **garantizado** en recepción para cobrarlo?
   ¿Se concilia contra las notas de OTASync?
2. **Exención de IVA autodeclarada:** la condición de "turista extranjero exento"
   se basa en país y motivo autodeclarados. ¿La DIAN acepta esto sin validación
   documental? ¿Cuál es el procedimiento de validación en arribo?
3. **Retención de datos:** confirmar la base de licitud para tratar documentos de
   menores y firmar el contrato de transferencia internacional con los encargados
   (Netlify/Google Drive). Política formal de retención documentada (la firma
   electrónica ya fija 5 años — ver `firma-electronica-colombia.md`).
4. **Holds en OTASync:** ¿límite de cotizaciones con holds simultáneos? ¿Qué pasa
   si `revalidate-quotes` falla y los holds no se liberan?
