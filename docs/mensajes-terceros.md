# Mensajes para terceros (listos para copiar/enviar)

Plantillas para resolver los pendientes que dependen de proveedores.
**Booking.com lo está atendiendo el dueño directamente** (fuera de esta lista).

---

## 1. Kunas / OTASync — correo UNIFICADO (webhook + SIRE/TRA)

> **Para:** soporte de Kunas / OTASync
> **Asunto:** Consulta técnica — webhook de seguridad y reporte SIRE/TRA (propiedad 9889)

Hola, equipo de Kunas:

Somos Hotel Estar (propiedad **9889**, Manizales). Tenemos dos consultas:

**1) Seguridad del webhook**
Tenemos configurada la integración por *webhooks* de OTASync hacia nuestra web
(eventos de disponibilidad y reservas). Necesito confirmar **cómo se envía el
secreto/token de validación** de ese webhook:
- ¿Va como **parámetro en la URL** (ej. `...?secret=XXXX`) o como **cabecera
  HTTP** (ej. `x-otasync-secret`)?
- Por seguridad queremos **dejar de aceptarlo por la URL** (las URLs quedan en
  logs) y exigirlo **solo por cabecera**. ¿El sistema permite enviar el secreto
  por una **cabecera personalizada**? Si ya lo hace, ¿cuál es el nombre exacto
  de la cabecera?

**2) Reporte a SIRE y TRA (huéspedes)**
Queremos asegurar el reporte a **SIRE (Migración Colombia)** y **TRA (MinCIT)**.
Preguntas:
1. ¿El registro TRA/SIRE se dispara con los datos de la **reserva** o del
   **check-in** en el PMS? ¿Qué campos toma y cuáles son **obligatorios**?
2. ¿Existe **API/endpoint** para **completar los datos de huéspedes y documentos**
   de una reserva ya creada? (queremos enviar desde nuestra app de check-in los
   datos que ya capturamos: documento, nacionalidad, fecha de nacimiento, etc.)
3. ¿El reporte cubre **todos los canales** (web directa + OTAs) o solo reservas
   manuales?
4. ¿Cómo maneja **varios huéspedes** por reserva (multi-ocupante)?
5. ¿Genera **constancia/acuse** del envío (folio SIRE, acuse TRA) que podamos
   consultar?

Quedo atento. Gracias.

> **Datos que conviene tener a mano para activar TRA/SIRE en Kunas** (Ajustes >
> Integraciones): TOKEN de integración, **RNT 276306**, código de propiedad y
> código de alojamiento.

---

## 2. Wompi — ejecutivo de cuenta (reembolsos)

> **Para:** ejecutivo de Wompi
> **Asunto:** Flujo de reembolsos y anulaciones — cuenta Hotel Estar

Hola:

Para nuestra operación necesito confirmar el flujo de **reembolsos/anulaciones**
de nuestra cuenta:
1. ¿Puedo **anular o reembolsar** una transacción **desde el panel** de Wompi, o
   todo se gestiona por **soporte**?
2. ¿Cuáles son los **tiempos reales** de reembolso al tarjetahabiente?
3. Confírmame que **PSE, Nequi y Botón Bancolombia NO tienen reembolso por la
   pasarela** (es decir, esos se devuelven por **transferencia bancaria manual**).
4. Para reembolsos de tarjeta por soporte, ¿qué datos necesitan (código de
   autorización, fecha, últimos dígitos, valor)?

Gracias.

### Respuesta de Wompi (recibida 2026-06-19)

1. **Anular desde el panel:** sí, **pero solo el mismo día** y si la red transaccional
   lo permite. Detalle de la transacción → **"Anular transacción"** (hay que hacerlo
   **inmediatamente** tras el pago para que quede en línea). Si ya está aprobada y la
   red no permite anulación en línea → **escalar a soporte** para la reversión ante la red.
2. **Tiempos al tarjetahabiente:** no hay un plazo fijo; **depende de la red y del banco
   emisor**. Para un dato preciso, escalar a un asesor.
3. **PSE, Nequi y Botón Bancolombia:** la anulación en línea **aplica solo a tarjetas**.
   Para PSE/Nequi/Botón Bancolombia **no hay anulación por la pasarela** → en la práctica
   esos se devuelven por **transferencia bancaria manual** (nuestro flujo
   `datos-cuenta.html` + tesorería). El proceso manual exacto: confirmar con un asesor.
4. **Datos para reversión de tarjeta por soporte:** código de autorización · fecha de la
   transacción · últimos dígitos de la tarjeta · valor de la transacción.

**Horario de soporte Wompi:** lunes a viernes, 8:00–17:00.

**Implicaciones para nuestro sistema:**
- El flujo de **reembolso por transferencia** que ya construimos (`datos-cuenta.html` +
  correo a tesorería + panel /admin → Reembolsos) es el **correcto** para PSE/Nequi/
  Bancolombia, porque esos **no** se pueden revertir por la pasarela.
- Para **tarjeta**: si es el mismo día, anular en el panel de Wompi; si no, escalar a
  soporte con los **4 datos** de arriba.
- **IMPLEMENTADO (2026-06-19):** esos 4 datos ahora se **capturan al momento del pago**
  (`_payment-details.js` → `savePaymentDetails`, llamado desde `wompi-webhook` en pago de
  reserva directa y de cotización) y quedan en un store durable (~13 meses). El registro
  de reembolso (`_refunds-store.recoverPaymentInfo` → `createRefundRequest`) los arrastra
  (`cardLast4`, `cardBrand`, `authCode`, `paymentDate`, `transactionId`, monto), así el
  equipo no tiene que buscarlos en el panel de Wompi semanas después. **Pendiente menor:**
  mostrarlos en el panel `/admin → Reembolsos` (los datos ya están en el registro).

---

## 3. Booking.com — (lo gestiona el dueño)
Pendiente con el account manager: medio de payout para Colombia (tarjeta virtual
VCC vs transferencia), fee de Payments by Booking, activación por plan de tarifa
y manejo de reembolsos. Detalle en `pendientes.md` §4.
