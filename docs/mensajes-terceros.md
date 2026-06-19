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

---

## 3. Booking.com — (lo gestiona el dueño)
Pendiente con el account manager: medio de payout para Colombia (tarjeta virtual
VCC vs transferencia), fee de Payments by Booking, activación por plan de tarifa
y manejo de reembolsos. Detalle en `pendientes.md` §4.
