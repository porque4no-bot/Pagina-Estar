# Pendientes — integraciones y lógica de negocio

Lista de trabajo priorizada surgida de la revisión de negocio e integraciones
(junio 2026). Cada ítem incluye el contexto necesario para arrancar sin
re-investigar.

---

## 1. Integración con Odoo (ERP / contabilidad)

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

## 4. Notas relacionadas (de la misma revisión, sin dueño aún)

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
