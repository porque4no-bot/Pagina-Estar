# Pendientes — integraciones y lógica de negocio

Lista de trabajo priorizada surgida de la revisión de negocio e integraciones
(junio 2026). Cada ítem incluye el contexto necesario para arrancar sin
re-investigar.

---

## 1. Integración con Odoo (ERP / contabilidad)

> **Ampliado en `docs/plan-integracion-odoo-otasync.md`** — arquitectura
> objetivo (cliente como eje), topología Odoo↔OTASync↔desarrollo propio,
> evaluación financiera (DataCrédito + extractos), plan por fases y las
> decisiones abiertas. Lo de abajo es el resumen original.

**Estado actual:** no existe ninguna integración. La única mención de Odoo en
el proyecto es la promesa comercial de `empresas.html` ("Una sola factura
mensual… Compatible con Odoo, SAP y QuickBooks"). Hoy el dinero y las
obligaciones viven en cuatro silos sin capa contable: pagos en Wompi, reservas
en OTASync, cotizaciones en Netlify Blobs y facturas manuales en Google Drive
(carpeta `03_facturas/`, evento `guest-invoice`).

**Fases propuestas (en orden de valor):**

1. **Sincronización de ventas.** Módulo `netlify/functions/_odoo.js` + hook
   post-pago en `wompi-webhook.js` (junto al `trackPurchase` existente):
   buscar/crear `res.partner` por NIT y registrar `account.move` (factura de
   venta, IVA 19%) por cada pago aprobado — directo y de cotización.
   Extender el esquema de cotización con `odooPartnerId`, `odooInvoiceId`,
   `costCenter`, `paymentTerms`.
2. **Facturación electrónica DIAN.** Emitir desde Odoo usando la localización
   colombiana (proveedor tecnológico certificado), en lugar de construir la
   integración DIAN a mano. Cierra el riesgo fiscal de las solicitudes de
   factura del guest app (`guest-action.js`, requestKind `invoice`) que hoy
   se resuelven manualmente.
3. **Consolidado mensual B2B + CxC.** Job programado que agrupe facturas por
   NIT/mes (la "factura mensual única" prometida en `empresas.html`) y manejo
   de cartera para habilitar el "pago a crédito sujeto a aprobación" que ya
   menciona `send-quote-email.js`.
4. **Conciliación a tres bandas.** Extender `reconcile-payments` para detectar
   también ventas sin factura: Wompi ↔ Odoo ↔ OTASync.

**Prerrequisitos:** instancia Odoo + credenciales API (XML-RPC o JSON-RPC),
mapa contable (cuentas, diarios, impuestos IVA 19% / INC 8%), y decisión de
si el NIT se valida contra el RUES/DIAN al crear cotizaciones.

---

## 2. SIRE y TRA — evaluar la vía Kunas vs. integración directa

**Contexto:** el reporte a SIRE (Migración Colombia, huéspedes extranjeros) y
la TRA (Tarjeta de Registro de Alojamiento, MinCIT) se está manejando desde el
lado de Kunas. Kunas tiene integración nativa: se activa en
Ajustes > Integraciones > TRA/SIRE con TOKEN + RNT + código de propiedad +
código de alojamiento, y reporta automáticamente a partir de los datos de las
reservas en el PMS (ver centro de ayuda de Kunas, artículos "¿Cómo configuro y
realizo el registro al TRA?" y "¿Cómo realizo el registro del SIRE?").

**El problema a evaluar:** las reservas que crea nuestra web en OTASync llevan
un solo huésped con `first_name`/`last_name` y nada más (`_otasync.js`,
`wompi-webhook.js`) — sin tipo/número de documento, nacionalidad, fecha de
nacimiento ni procedencia, que son los campos que SIRE y TRA exigen. Si Kunas
reporta desde la reserva del PMS, los registros de reservas web salen
incompletos o dependen de que recepción complete los datos a mano en Kunas,
aunque el guest app ya captura exactamente esos datos (documento + OCR Azure,
multi-ocupante) y los guarda cifrados en Blobs sin empujarlos al PMS.

**Preguntas para Kunas antes de decidir:**
- ¿El registro TRA/SIRE se dispara con datos de la reserva o del check-in en
  el PMS? ¿Qué campos exactos toma y cuáles son obligatorios?
- ¿Hay endpoint API para completar los datos de huéspedes/documentos de una
  reserva existente (el "Phase 2" pendiente de `docs/guest-app.md`)?
- ¿Cubre todos los canales (web directa + OTAs) o solo reservas manuales?
- ¿Qué pasa con multi-ocupante (N huéspedes por reserva)?
- ¿Genera evidencia/constancia del envío (folio SIRE, acuse TRA) consultable?

**Criterio de decisión:**
- Si Kunas expone API para completar huéspedes → **opción A (preferida):**
  cerrar el loop guest-app → OTASync/Kunas (push de datos de check-in) y dejar
  que Kunas reporte. Mínimo desarrollo, una sola fuente de verdad.
- Si no la expone → **opción B:** reportar nosotros directamente desde
  `guest-checkin` (SIRE por carga de archivo/API de Migración; TRA por API del
  MinCIT), usando los datos que el guest app ya captura. Más desarrollo, pero
  sin depender del data-entry manual de recepción.

**En cualquier caso:** medir hoy qué % de reservas web llegan a SIRE/TRA
completas — ese es el riesgo regulatorio actual.

---

## 3. Devoluciones y política de cancelación (Wompi / Mercado Pago / efectivo / datáfono)

**Estado actual del código:** el botón "Cancelar reserva" del motor ahora envía
una **solicitud** real (`request-cancellation`): verifica la reserva con
segundo factor, alerta al equipo por correo y confirma al huésped. La
cancelación en OTASync y el reembolso siguen siendo manuales. La tarifa
(Flexible vs. Best Price) aún **no** queda registrada de forma estructurada en
el PMS — va implícita en el monto pagado; registrar el plan en la referencia
de pago y en la nota de la reserva es prerrequisito para automatizar
reembolsos.

**Lo investigado sobre los rieles de devolución:**

- **Wompi (tarjetas Visa/MC/Amex):** existe *anulación* (mejor hacerla lo
  antes posible tras la aprobación; pasada la ventana de la red ya no procede)
  y *reembolso* gestionado con soporte de Wompi aportando código de
  autorización, fecha, últimos dígitos y valor. Tiempo de respuesta estipulado:
  hasta 10 días hábiles; el abono al tarjetahabiente depende del banco emisor.
  Los reembolsos solo aplican a transacciones con medio de pago "Tarjetas"
  (Redeban/Credibanco) — **PSE/Nequi/Botón Bancolombia no tienen reembolso por
  la pasarela**: hay que devolver por transferencia bancaria manual al
  huésped. Confirmar con el ejecutivo de Wompi si nuestra cuenta tiene
  anulación por panel o si todo pasa por soporte.
- **Mercado Pago (rollback):** sí tiene API de reembolsos
  (`POST /v1/payments/{id}/refunds`, total o parcial) hasta 180 días después
  del pago, sujeto a saldo disponible en la cuenta; el abono en tarjeta puede
  tardar hasta ~15 días hábiles según el banco. Pagos PSE se devuelven a la
  cuenta Mercado Pago del comprador.
- **Efectivo / datáfono en sitio:** fuera del alcance de la web. Definir
  procedimiento operativo: datáfono → anulación el mismo día en el POS o
  devolución vía adquirente; efectivo → devolución por transferencia
  (Bancolombia/Nequi) con soporte firmado, registrado en caja. Dejarlo
  escrito en el manual de recepción y reflejado en `cancelacion.html`
  ("los reembolsos se hacen por el mismo medio de pago; en pagos en efectivo,
  por transferencia dentro de N días hábiles").

**Trabajo pendiente:**
1. Definir con Wompi el flujo exacto (panel vs. soporte) y los SLA reales.
2. Actualizar `cancelacion.html` (ES/EN) con medios y plazos de reembolso.
3. Registrar el plan tarifario (Flexible/Best Price) en la referencia Wompi y
   en la nota de OTASync para que la política sea verificable por reserva.
4. Fase 2 de autoservicio: `cancel-booking` real — verificación de tarifa y
   ventana de 48 h → cancelación en OTASync (`reservation/delete/reservation`)
   → reembolso automático (API MP; Wompi según lo que se acuerde) → correo de
   confirmación con el detalle del reembolso.
5. Plantilla de correo al huésped con plazos por medio de pago.

**Fuentes:**
- [Wompi — reversión de transacción con tarjeta de crédito](https://soporte.wompi.co/hc/es-419/articles/360046916653--C%C3%B3mo-se-gestiona-la-reversi%C3%B3n-de-una-transacci%C3%B3n-con-Tarjeta-de-cr%C3%A9dito)
- [Wompi — reembolso total e impuestos](https://soporte.wompi.co/hc/es-419/articles/1500009267322--Qu%C3%A9-es-reembolso-total-y-qu%C3%A9-pasa-con-los-impuestos-previamente-liquidados)
- [Mercado Pago — reembolsos y cancelaciones (Checkout API)](https://www.mercadopago.com.co/developers/es/docs/checkout-api/payment-management/cancellations-and-refunds)
- [Mercado Pago — cuándo recibe el dinero el comprador](https://www.mercadopago.com.co/ayuda/devolver-dinero-mi-compra_1601)
- [Kunas — TRA & SIRE](https://kunas.io/TRA-&-SIRE/)
- [Kunas — configurar registro TRA](https://faq.kunas.io/es/articles/9033801-como-configuro-y-realizo-el-registro-al-tra)
- [Kunas — registro del SIRE](https://faq.kunas.io/es/articles/11061823-como-realizo-el-registro-del-sire)

---

## 4. Booking.com — configurar el cobro de las reservas

**Objetivo:** dejar de depender del cobro manual de las reservas que entran
por Booking.com y definir el modelo de pago oficial del canal.

**Los dos modelos posibles:**

1. **Payments by Booking.com (recomendado evaluar primero).** Booking le
   cobra al huésped (tarjeta, PSE, wallets — métodos que el hotel no podría
   aceptar solo) y le paga al hotel por uno de dos medios según el país:
   - **Tarjeta de crédito virtual (VCC):** una Mastercard digital por
     reserva, que se activa normalmente el día del check-in y se cobra como
     cualquier tarjeta no presente. Se puede cobrar hasta 6 meses después
     del check-out (extensible otros 6). **Requisito operativo:** un medio
     para cobrar tarjeta no presente — datáfono con digitación manual
     (Redeban/Credibanco) o terminal virtual del adquirente. Conectar esto
     con el procedimiento de datáfono del punto 3.
   - **Transferencia bancaria:** payout consolidado; disponibilidad por país.
   Ventajas: elimina no-shows con tarjetas inválidas, menos manejo PCI de
   tarjetas de huéspedes, cobro garantizado. Contras: fee adicional de
   procesamiento sobre la comisión, y flujo de caja atado a la fecha de
   activación de la VCC.
2. **Cobro directo por el hotel (modelo actual implícito):** Booking pasa
   los datos de la tarjeta del huésped (requiere acceso PCI activado en la
   extranet) y el hotel cobra manualmente según su política. Contras: carga
   operativa, tarjetas declinadas/no válidas, riesgo PCI, disputas.

**Pasos para configurarlo (extranet):**
1. Extranet → **Finanzas → Payments by Booking.com** (u "Online payments"):
   verificar elegibilidad de la propiedad en Colombia y el medio de payout
   ofrecido (VCC vs transferencia).
2. Revisar/ajustar **políticas de prepago y cancelación por plan de tarifa** —
   determinan cuándo Booking le cobra al huésped (al reservar, a X días del
   check-in, o no reembolsable inmediato) y por tanto cuándo hay plata.
3. Si el payout es VCC: confirmar con el banco/adquirente que el datáfono
   permite **digitación manual de tarjeta no presente** (o solicitar terminal
   virtual), y documentar en recepción el procedimiento de cobro de VCC
   (fecha de activación, monto exacto, no sobrepasar el saldo).
4. Definir el tratamiento de **no-shows y cancelaciones tardías** del canal
   (Booking cobra y paga vía VCC según la política configurada).
5. **Conciliación:** las reservas de Booking llegan a OTASync por el channel
   manager, pero el dinero (VCC/transferencia) y la factura de comisión van
   por otro lado — incluir este flujo en la conciliación contable (fase
   Odoo, punto 1: ventas OTA + comisiones Booking como gasto).

**Preguntas para el account manager de Booking:**
- ¿Qué medios de payout están habilitados para Colombia y esta propiedad?
- ¿Fee de procesamiento de Payments by Booking sobre la comisión actual?
- ¿Se puede activar por plan de tarifa (p. ej. solo no-reembolsables) o es
  todo-o-nada?
- ¿Cómo se manejan los reembolsos al huésped cuando Booking cobró (los hace
  Booking directamente)?

**Fuentes:**
- [Payments by Booking.com — FAQs oficiales](https://partner.booking.com/en-us/help/policies-payments/payment-products/payments-bookingcom-faqs)
- [Booking.com — Online Payments (partners)](https://partner.booking.com/en-us/solutions/online-payments)
- [Cloudbeds — FAQ de tarjetas virtuales (VCC) de Booking.com](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/44061325834779-Booking-com-VCC-FAQ)

---

## 5. Notas relacionadas (de la misma revisión, sin dueño aún)

- Pre-hold de inventario en el checkout directo (reutilizar `createHold`).
- Reintento con backoff en `insertReservation` (hoy 1 intento / timeout 10 s).
- Manejar eventos `reservation edit/cancel` del webhook OTASync (cancelaciones
  desde OTAs no liberan holds ni se sincronizan).
- Las notas/solicitudes especiales del huésped no llegan al PMS (la referencia
  Wompi no las codifica).
- Control de capacidad de extras (parqueadero, early/late) y precios de extras
  en configuración (Blobs) en vez de hardcode en `_pricing.js`.
- Emails faltantes: pago rechazado/pendiente, pre-llegada, post-estadía,
  recordatorio de cotización por vencer.
- IVA en check-in: checklist operativo en guest app + reporte mensual de IVA
  diferido vs. cobrado.
- **Pedidos de servicios del guest app → cobro y comunicación con Kunas.** Desde
  2026-06-18 el guest app cobra todos los servicios desde el catálogo único
  (`_services-catalog.js`) y guarda el pedido con el desglose (ítems, montos,
  `paymentPreference` = `account` cargar a la cuenta / `online` pagar en línea).
  La API de OTASync **sí** soporta el loop (`OTASync-Public-API.md`: `add_extra`,
  `add_payment`, `get-reservation` con `id_reservations_rooms`).
  - **Fase A — cargo al folio (HECHO, apagado).** `_otasync.js` →
    `postOrderExtrasToFolio()` (+ `getExtras`/`insertExtra`/`ensureGuestServiceExtra`/
    `getReservationFirstRoom`/`addReservationExtra`); `guest-action` lo llama best-effort
    para pedidos `account`. **Gated por `GUEST_SERVICE_FOLIO_ENABLED='true'`** (off por
    defecto). Usa un extra genérico "Pedido guest app" (auto-creado una vez, o
    `OTASYNC_GUEST_SERVICE_EXTRA_ID`). **Probar en una reserva real antes de activar.**
  - **Fase B — cobro online (HECHO, apagado).** `GUEST_SERVICE_PAYMENT_MODE=wompi`:
    `guest-action` arma un Wompi Web Checkout **firmado server-side** (monto = total del
    pedido; reference = eventId `GST-...`) y guarda un intent en `_guest-payments`
    (store `guest-service-payments`). Al aprobar, `wompi-webhook.handleGuestServicePayment`
    verifica el monto, postea `add_extra` + `add_payment` al folio y marca el intent `paid`.
    Idempotente por `intent.status`; ante falla de folio marca `paid_folio_failed` y **no
    reintenta** (add_extra no es idempotente) → seguimiento manual. Requiere
    `WOMPI_PUBLIC_KEY`/`WOMPI_INTEGRITY_SECRET`/`WOMPI_WEBHOOK_SECRET`. **Probar en sandbox
    Wompi + reserva real antes de activar.** Front: la guest app redirige al checkout y al
    volver muestra aviso (`?order=`). Falta opcional: extender `reconcile-payments` para
    detectar intents `pending`/`paid_folio_failed` viejos.
  - **Fase C — correo al equipo (HECHO).** `guest-action.notifyOrderTeam` envía al
    equipo (`adminEmail()` = `ADMIN_NOTIFY_EMAIL`) un resumen de cada pedido (reserva,
    huésped, ítems, total, forma de pago, cuándo/notas) vía Resend. Best-effort: no-op
    sin `RESEND_API_KEY`, y un fallo de correo nunca tumba el pedido.
  El monto del late/early check-out se calcula como 15%/25% del **promedio de
  noche** (`totalAmount / nights`, IVA incl.) — aproxima la tarifa neta del motor;
  si se quiere exacto, firmar la tarifa neta de la habitación en el token de
  `guest-session` (hoy firma `nights` + `totalAmount`).
- Early check-in en guest app quedó al **25% plano** (paridad con el catálogo y
  el motor). El modelo escalonado 15/35/50 de §6.5 sigue pendiente y, cuando se
  implemente, debe cambiarse en las tres superficies a la vez (no solo aquí).

---

## 6. Decisiones de negocio tomadas — pendientes de implementar

Decididas el 2026-06-13. Falta aplicarlas (tocan varios archivos
cliente + el motor + el bot); conviene hacerlo en una sola pasada coherente.

### 6.1 Planes de tarifa y política de cancelación
Reemplaza el esquema actual ("Flexible 48 h" / "Best Price no reembolsable").
Se crean como **rate plans REALES en OTASync** (no calculados en el cliente),
para paridad con Booking/Airbnb:
- **Estricta** = tarifa base. Cancelación gratuita hasta **7 días antes** del
  check-in; después, no reembolsable.
- **Flexible** = base **+10%**. Cancelación gratuita hasta las **6:00 PM del
  día anterior** al check-in; después, penalidad.
- **No-show / cancelación tardía** (ambos planes): se cobra **la primera
  noche + impuestos + 3,5% del total de la reserva** (el 3,5% cubre la
  comisión de la pasarela de tarjetas, que no se reembolsa).

Notas de implementación:
- Hoy la Flexible se calcula como `precio / 0.9` (= +11,1%) en
  `_direct-pricing.js` y `motor-app.jsx`. Con rate plans reales en OTASync,
  `check-availability` debe devolver **ambos precios desde OTASync** y el
  motor deja de calcular el ±%. Mientras tanto, si se mantiene el cálculo,
  alinear a `× 1.10` (10% exacto, no 11,1%).
- Reescribir `cancelacion.html` / `en/cancelacion.html` (secciones 1 y 2),
  etiquetas de tarifa en `motor-app.jsx` + `i18n/motor.*.json`, system prompt
  del bot, y la política que muestra `ManageBooking`.

### 6.5 Reprecio de extras (late checkout / early check-in)
Dejan de ser montos fijos; pasan a **% del precio estándar por noche** de la
habitación (tarifa base/Estricta):
- **Late checkout** hasta las **2:00 PM** → **15%** de la noche estándar.
  (Hoy: $60.000 fijo, "hasta las 3:00 pm" — cambia hora y modelo.)
- **Early check-in** escalonado (entre más temprano, más caro):
  - Entrada **2 h antes** del check-in (≈1:00 PM) → **15%**
  - Entrada desde las **10:00 AM** → **35%**
  - Entrada desde las **6:00 AM** (o antes) → **50%**
  (Hoy: $50.000 fijo, "desde las 10:00 am".)
- Impacto: `_pricing.js` (multiplicadores % en vez de `flat`), `reservar.html`
  (`BE_EXTRAS` + cálculo), y el system prompt del bot. El early pasa de 1 a 3
  opciones — revisar el `extrasMask` de la referencia Wompi.
- Pendiente: ¿desayuno ($20k/persona/noche) se mantiene igual? (no se mencionó)

### 6.6 Métodos de pago en la web (PSE y Nequi)
- PSE y Nequi **ya están habilitados en la cuenta Wompi** y el widget de
  Wompi los ofrece dentro de su flujo. La opción de pago en `reservar.html`
  ya los menciona en su descripción ("Tarjetas colombianas, PSE, Nequi,
  Bancolombia"). **Verificar** que aparezcan en el checkout de Wompi en
  producción; si se quiere, darles visibilidad propia (íconos) en la UI.

### 6.7 Identidad legal y documentos descargables
- **Razón social:** Mirada SAS · **NIT:** 902032515 (confirmar dígito de
  verificación, p. ej. 902.032.515-?).
- Incluir la razón social + NIT en `aviso-legal.html` y `privacidad.html`
  (hoy solo aparece la marca "estar" — hallazgo legal pendiente).
- Nueva sección para **descargar RUT y la Cámara de Comercio más reciente**
  (facilita la gestión a las empresas). Ubicación sugerida: portal corporativo
  (`empresas.html`) y/o footer legal.
- Los documentos deben **autoactualizarse al más reciente subido en una
  carpeta de Google Drive** — ya existe integración Drive (`_google-drive`,
  service account); reutilizarla para servir/enlazar el archivo vigente.

### 6.8 Reembolsos — tiempos por método + formulario de cuenta
Política de tiempos a publicar (sujeto a los tiempos de cada proveedor):

| Método de pago | Reembolso | Tiempo estimado |
|---|---|---|
| Tarjeta (Wompi) | Por la pasarela | hasta ~10 días hábiles (depende del banco emisor) |
| Tarjeta (Mercado Pago) | API de reembolsos | hasta ~15 días hábiles |
| PSE / Nequi / Bancolombia | **Transferencia manual** | definir SLA (p. ej. 5 días hábiles) |
| Efectivo / datáfono en sitio | **Transferencia manual** | definir SLA |
| Booking.com (VCC) | Lo gestiona Booking | según Booking |

- Para los métodos **no autogestionables** (todo lo "manual" de arriba),
  cuando se apruebe una cancelación con reembolso: enviar al huésped un
  **formulario** donde indique **a qué cuenta** quiere el reembolso (banco,
  tipo y número de cuenta, titular, documento) + correo de notificación al
  equipo para tramitarlo. Engancha con `request-cancellation` (hoy solo
  registra la solicitud; falta el paso de captura de cuenta + el correo con
  los datos para tesorería).
- Publicar la tabla de tiempos en `cancelacion.html` con la nota "los plazos
  dependen de los tiempos de procesamiento de cada medio de pago".

### 6.9 Hora de check-out — resolver inconsistencia
- `index.html` (schema `checkoutTime`) dice **12:00**; `faq.html` dice
  **11:00 AM**. Definir la correcta y unificar (afecta el late checkout y el
  system prompt del bot, que hoy dice 11:00). *(Nota: con late checkout hasta
  las 2:00 PM, el check-out estándar debe ser una sola hora — definirla.)*

### 6.2 Cobro por mascota
- **$200.000 por reserva** (monto fijo, NO por noche, NO por mascota).
- Reemplaza el lenguaje de "depósito" para estadía corta. Confirmar si en
  **larga estadía** sigue siendo depósito reembolsable o también este cobro.
- Impacto: añadir como cargo en el motor (extra fijo) y, si se cobra en
  larga estadía, en cotizaciones; actualizar `faq.html`, `vivir.html`,
  `cancelacion.html` y el system prompt del bot ("mascotas con depósito" →
  "mascotas con cobro de $200.000 por reserva").

### 6.3 Parqueadero — eliminar como servicio propio
- Estar **no** ofrece ni cobra parqueadero. Hay un **parqueadero público
  cercano** (ajeno a la propiedad). Quitar toda mención a parqueadero
  cubierto/seguro "en el edificio" y todo cobro.
- Impacto (muchos puntos):
  - `_pricing.js` — quitar `parqueadero` de `EXTRAS_PRICES` y de
    `EXTRAS_KEYS`. **Ojo:** `EXTRAS_KEYS` define el orden del `extrasMask`
    de 6 bits en la referencia Wompi; quitarlo del medio corre los bits
    (revisar `_direct-pricing.js` y `motor-app.jsx` para no romper reservas
    en vuelo — mejor dejar el slot vacío/reservado que reindexar).
  - `reservar.html` / `en/reservar.html` — quitar de `BE_EXTRAS` y del
    cálculo (`if(extras.parqueadero)...`).
  - `guest.html` — quitar la tarjeta de servicio `parking` ($25k) y la
    mención en "Agregar servicios".
  - `cotizar-admin.html` / `cotizacion.html` — quitar `parqueadero` del
    catálogo de servicios de cotizaciones.
  - `faq.html` / `en/faq.html` — cambiar la respuesta de "sí, parqueadero
    cubierto en el edificio" por "parqueadero público cercano, ajeno a la
    propiedad".
  - System prompt del bot — quitar "parqueadero cubierto disponible
    (reservable como extra)".

### 6.4 Estructura legal de larga estadía (punto 7) — SE MANTIENE PENDIENTE
- Confirmar hospedaje turístico vs. arrendamiento (decisión del huésped:
  dejar pendiente por ahora). Afecta la validez de la retención de depósito.

