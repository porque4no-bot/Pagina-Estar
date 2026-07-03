# Preguntas para el equipo de facturación (Numera) — Hotel Estar

> Numera = software + equipo contable que opera la facturación de Mirada en Odoo
> (localización colombiana DIAN, ya viva: 109 facturas). Este documento reúne
> TODO lo que hay que resolver con ellos antes de integrar facturación, compras y
> reportería sin pisar su flujo. Para la reunión (lunes).

## A. Conexión / arquitectura
1. Nos pidieron **dos usuarios** (uno para un "bot" y otro para una persona del equipo): ¿usuarios **de Odoo** que creamos nosotros? ¿con qué permisos exactos? ¿el "bot" qué hace (lee, escribe, postea facturas)?
2. ¿Cómo es **su software de automatización**? ¿es de ellos o un servicio externo? ¿se conecta a Odoo por API, o a nosotros directamente?
3. ¿La facturación es **100% automática** hoy? ¿Qué la **dispara** (una reserva pagada, una acción manual, un cron)?

## B. Vincular factura ↔ reserva (lo que nos bloquea)
4. ¿Pueden escribir el **código de la reserva** (OTASync) o el **COT-id** de la cotización en un campo de la factura (`ref` / `invoice_origin`)? Hoy están vacíos → no podemos saber qué factura es de qué reserva.
5. ¿Nos dan **permiso de LECTURA** de `account.move` filtrado por Mirada (company 5) al usuario de integración, para mostrar el estado/nº/PDF de la factura en nuestro panel?
6. ¿Cómo queremos que les **lleguen las solicitudes de factura** desde nuestra web/panel? (correo a una dirección del equipo, un campo en Odoo, un webhook). Necesitamos `BILLING_TEAM_EMAIL`.

## C. Frontera Compras / Inventario (Fase 5 del plan Odoo)
7. Si activamos **Purchase + Inventory** para costear amenities/insumos: nuestro alcance llega a **órdenes de compra + recepción de mercancía**; la **contabilización de la factura del proveedor** la cierran ustedes. ¿Dónde ponemos exactamente la frontera para **no registrar dos veces**?
8. (Nota: el **desayuno es tercerizado**, sin recetas/producción nuestra → no montamos inventario de cocina; esto aplica solo a amenities/insumos que sí compremos.)

## D. Reportería, conciliación y caja (lo que el dueño quiere fortalecer)
9. **Conciliación bancaria** y **cierres de caja**: ¿lo manejan ustedes en Odoo? ¿Podemos **ver reportes** (dashboards de Odoo) sin tocar la contabilización?
10. ¿Qué **reportería** podemos construir/leer de nuestro lado (ocupación, ingresos por canal, directo vs OTA) sin invadir lo contable?

## E. Locales comerciales y cruce de cuentas
11. La propiedad tiene **2 locales comerciales en arriendo**. Con **uno de ellos** está el **convenio del desayuno** → hay un **cruce de cuentas** (ellos nos deben arriendo, nosotros les debemos desayunos → se netea).
12. ¿Cómo se modela ese cruce contablemente (en Odoo) y qué parte, si alguna, debe **reflejarse en nuestro sistema** (p. ej. el costo del desayuno por noche para el margen)? ¿Quién emite/recibe qué factura?
13. ¿El **ingreso por arriendo** de los 2 locales lo manejan 100% ustedes, o necesitamos verlo en algún reporte?

## F. Larga estadía (futuro)
14. Para **facturación recurrente** de larga estadía (canon mensual): si algún día usamos Subscriptions en Odoo, ¿cómo se coordina con su emisión DIAN? (por ahora EN PAUSA).

## G. Integración por API directa (`send-electronic-invoice`) — lo nuevo

> Nos pasaron la **API de facturación**. Queremos que **nuestro panel** dispare la
> emisión (con aprobación humana, **cuando el huésped completa el check-in**) y que
> Numera homologue → DIAN → Odoo. Plan: [`plan-facturacion-numera.md`](plan-facturacion-numera.md).
>
> **Ya lo responde la doc de la API (NO lo preguntamos):** códigos de medio de pago
> (48/49 tarjeta, 30 transferencia, 42 consignación, 10 efectivo, ZZZ); `ref_factura`
> = número legal de la factura referenciada; `fecha_factura` = fecha actual en COT
> (o la pone Numera); tipos de operación (10 estándar, 20/22/23 notas crédito);
> códigos DIAN de impuesto (01 IVA, 04 INC) y de identificación/empresa.
> **Confirmado (no preguntamos):** se puede emitir a **consumidor final**
> (`identificacion=222222222222`).

15. **Consecutivo:** la API recibe `prefijo`+`consecutivo`. ¿Lo **asigna Numera** o lo **enviamos nosotros**? Si lo enviamos, necesitamos un **prefijo/rango DIAN propio para ventas web**, separado del de contabilidad, para no romper la secuencia. ¿Cuál sería?
16. **`company_id` + sandbox:** ¿cuál es el de Mirada (¿el mismo de Odoo, company 5?)? ¿Hay **ambiente de pruebas** y credenciales de prueba?
17. **Número legal de vuelta:** el éxito devuelve `response:{}` vacío. ¿Cómo obtenemos el **número legal + CUFE + PDF** de la factura emitida? (Lo necesitamos para mostrarla y para **referenciarla luego en notas crédito**.) ¿Endpoint de **consulta de estado** o **webhook**?
18. **Aceptación DIAN:** `sent_to_btw` ≠ aceptada. ¿Cómo sabemos si la DIAN la **aceptó o rechazó**?
19. **¿La API crea la factura en Odoo?** Si sí, ¿es **idempotente** y **deduplica `res.partner`** por NIT/email (para no chocar con nuestro `_odoo.js` ni duplicar)?
20. **Idempotencia:** ¿hay **clave de idempotencia** para que un reintento no emita dos facturas iguales?
21. **Exención de IVA al turista extranjero:** ¿cómo se representa — `tipo_operacion` de exentos/excluidos, o impuesto con `porcentaje=0`?
22. **Concepto de nota crédito:** para `CreditNoteType`, ¿dónde va el **concepto DIAN** (1 devolución, 2 anulación, 3 rebaja, 4 descuento, 5 otros)? No aparece en la doc de la API.
23. **`numero_reserva`/`huesped`:** ¿dónde aparecen — **PDF**, **XML DIAN** o solo **metadato en Odoo**? ¿Son **buscables** para conciliar factura ↔ reserva?
24. **`tipo_operacion` / medios faltantes:** ¿`10` (estándar) es lo correcto para **hospedaje**? ¿Qué `codigo_medio_pago` usan **PSE** y **Nequi** (tarjeta y transferencia ya están en la doc)?
25. **Abono/anticipo:** en directo el huésped paga el subtotal en línea y el IVA se cobra en el hotel. Facturamos al **check-in completo** con el total real; ¿el pago online se trata como **abono**? ¿Un solo documento?
26. **Usuario de la API:** ya tenemos un **usuario ordinario** en la plataforma. Para consumir la API de facturación, ¿sirve ese mismo o necesitamos un usuario **específico / creado de otra forma**? ¿Qué permisos/rol necesita?

### Respuestas de Numera (WhatsApp, Jorge García, 1-jul-2026)
- **Consecutivo (15):** es el de la **DIAN según resolución**, **auto-incremental**; Numera lo maneja/reporta y **se ve en Odoo**. ⏳ *Falta confirmar:* ¿lo **asigna la API** o lo **enviamos**? ¿**resolución/rango dedicado** para ventas web (no chocar con contabilidad)? → al ticket.
- **company_id + sandbox (16):** ⏳ lo valida **Ingrid Rivera** (ambiente de pruebas **BTW**).
- **Número legal/CUFE/PDF (17):** → **abrir TICKET**, lo eleva a desarrollo.
- **Aceptación DIAN (18):** con **200** el documento va a la DIAN y **el operador (BTW) se encarga**; para el detalle del estado → **TICKET**, ajustan + dan documentación.
- **Odoo (19):** **no duplica.** Numera **baja la info de la DIAN**, la radica en Numera y la procesa **"como las compras"** → el `account.move` NO lo crea nuestra llamada, lo **concilia Numera desde la DIAN**.
- **Exención IVA extranjero (21):** ⏳ no la respondió → **al ticket**.
- **Concepto nota crédito (22):** → **TICKET**, te cuenta.
- **Usuario de la API (26):** **mejor un usuario distinto, rol "cliente".** Preguntó ¿es para **BTW o Numera**? → respuesta nuestra: **Numera** (consumimos `esnumera.com/api/v1`).

**Acciones:** (1) abrir **ticket** con 17, 18 (docs), 21, 22 + confirmar 15; (2) responder a Jorge lo del usuario (Numera, rol cliente, distinto); (3) esperar a Ingrid (sandbox BTW).
