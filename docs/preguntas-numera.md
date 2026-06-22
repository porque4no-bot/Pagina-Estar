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
