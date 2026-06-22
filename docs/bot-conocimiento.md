# Base de conocimiento del bot — Estar (WhatsApp)

Este documento es la **fuente de verdad del conocimiento** que el bot usa para
atender. Tiene dos propósitos:

1. **Para el equipo:** revisar y completar las respuestas. Lo que diga aquí es
   lo que el bot dirá. Las casillas **⚠️ POR CONFIRMAR** son decisiones o datos
   que faltan — complétalos y el bot "aprende" en el siguiente despliegue.
2. **Para el sistema:** una vez aprobado, este contenido se carga como ficha de
   conocimiento del bot (hoy vive resumido en el system prompt de
   `_whatsapp-ai.js`; al crecer se moverá a un archivo cargado en contexto).

> Regla de oro: el bot **nunca inventa precios ni disponibilidad** — eso lo
> consulta en vivo a OTASync. Aquí van solo políticas, hechos y guiones
> estables. Los precios por noche NO se ponen aquí.

---

## 1. El alojamiento

- **Qué es:** apartaestudios completos (no habitaciones de hotel) en Manizales,
  Colombia. Cocina equipada, baño privado, WiFi de fibra, TV cable, zona de
  trabajo.
- **Tipologías y capacidad** (fuente: `rooms_db.json`):
  - Clásica — hasta 2 personas
  - Selección — hasta 5 personas
  - Reserva — hasta 2 personas
  - Origen — hasta 3 personas
  - Especial — hasta 2 personas
- **Dirección exacta:** ⚠️ POR CONFIRMAR (¿se comparte por chat o solo tras
  reservar? Hoy el bot remite a `explora.html`.)
- **Cómo llegar / referencias:** ⚠️ POR CONFIRMAR (punto de referencia, barrio).
- **¿Recepción física?** No hay recepción 24/7; el check-in es digital. ⚠️
  CONFIRMAR si hay personal en sitio y en qué horario.

## 2. Check-in / check-out

- **Check-in:** desde las 3:00 PM. 100% digital — un día antes llega un enlace
  con los códigos de acceso (sin llaves físicas).
- **Check-out:** **11:00 AM** (unificado 2026-06-22 en todo el sitio).
- **Early check-in** (entrada anticipada, sujeto a disponibilidad), % del valor
  de la noche estándar:
  - 2 h antes (≈1:00 PM): 15%
  - Desde las 10:00 AM: 35%
  - Desde las 6:00 AM: 50%
- **Late check-out** hasta las 2:00 PM: 15% del valor de la noche estándar.
- **¿Equipaje antes/después?** ⚠️ POR CONFIRMAR (¿se puede dejar maletas?).

## 3. Tarifas y reservas

- Dos planes de tarifa:
  - **Estricta** (base, más económica): cancelación gratuita hasta 7 días
    antes del check-in.
  - **Flexible** (+10%): cancelación gratuita hasta las 6:00 PM del día
    anterior al check-in.
- **El pago se hace siempre en la web** (`reservar.html`), nunca por chat. El
  bot entrega el enlace con fechas precargadas.
- **Medios de pago:** tarjetas (Visa/Mastercard/Amex), PSE, Nequi, Bancolombia
  (vía Wompi). ⚠️ CONFIRMAR si se quiere mencionar efectivo/transferencia.
- **Anticipo / pago parcial:** ⚠️ POR CONFIRMAR (¿se cobra el total o un %?).
- **Factura electrónica:** ⚠️ POR CONFIRMAR (¿se emite a todos? ¿cómo se pide?
  La facturación la lleva otro equipo. Razón social: **Mirada SAS, NIT
  902.032.515-0**).

## 4. Política de cancelación y reembolsos

- Dos planes (se eligen al reservar):
  - **Estricta** (base): cancelación gratis con reembolso 100% hasta **7 días antes** del check-in.
  - **Flexible** (+10%): cancelación gratis con reembolso 100% hasta **24 horas antes** del check-in.
- **Fuera de plazo** (cualquier plan): se cobra **1ª noche + impuestos + 3,5%** del total; se reembolsa el resto.
- **No-show:** si no cancela y pasan **24 horas desde el check-in**, pierde el reembolso (no se reembolsa nada).
- **Tiempos de reembolso** (sujeto al proveedor): tarjeta Wompi ~10 días
  hábiles; Mercado Pago ~15 días hábiles; PSE/Nequi/efectivo → transferencia
  manual (⚠️ definir SLA). Para esos casos el equipo pide los datos de la
  cuenta destino.
- **Cómo cancela un huésped:** el bot verifica la reserva (código + email o
  apellido) y registra la solicitud; el equipo procesa el reembolso. **No es
  instantáneo.**

## 5. Servicios y amenidades

- **Desayuno:** disponible como extra (⚠️ CONFIRMAR si se mantiene y qué
  incluye; ¿restricciones dietarias?).
- **Mascotas:** bienvenidas con un **cobro de $200.000 por reserva** (monto
  fijo). ⚠️ CONFIRMAR reglas (tamaño/número de mascotas, áreas permitidas).
- **Parqueadero:** Estar **no** ofrece parqueadero propio. Hay un **parqueadero
  público cercano**, ajeno a la propiedad. ⚠️ CONFIRMAR nombre/distancia para
  poder orientar.
- **Limpieza:** ⚠️ POR CONFIRMAR para estadía corta (¿aseo durante la estadía?
  En larga estadía es semanal).
- **Lavandería / otros servicios:** ⚠️ POR CONFIRMAR (el guest app menciona
  lavandería).
- **Wifi, cocina, electrodomésticos:** incluidos. ⚠️ Detalle de equipamiento
  por tipología si se quiere precisión.

## 6. Estadías largas ("Vivir en Estar")

- 1 a 12 meses, todo incluido (servicios, internet de fibra, aseo semanal),
  sin fiadores, proceso 100% digital. Tarifas mensuales **con IVA incluido**.
- Las cotizaciones las hace el equipo (el bot escala con `notify_team`).
- **Depósito de mascota en larga estadía:** ⚠️ POR CONFIRMAR si aplica el cobro
  de $200k o un depósito reembolsable distinto.
- **Requisitos / proceso de aplicación:** ⚠️ POR CONFIRMAR (¿verificación de
  perfil? ¿contrato?).

## 7. Empresas y grupos

- Tarifas corporativas, bloqueos de inventario, cotizaciones formales. El bot
  escala al equipo comercial.
- **Convenios / crédito a 30 días:** ⚠️ POR CONFIRMAR qué se ofrece realmente
  (la web lo menciona; aún no está implementado).
- **Documentos legales para proveedores** (RUT, Cámara de Comercio): se podrán
  descargar desde la web (en gestión).

## 8. Zona / recomendaciones (Manizales)

- ⚠️ POR CONFIRMAR / AMPLIAR: qué hay cerca (restaurantes, supermercados,
  Termales, Nevado, transporte, aeropuerto/distancias). Hoy el bot remite a
  `explora.html`. Si quieres que responda con detalle, lista aquí los lugares
  y datos clave.

## 9. Situaciones especiales (guiones)

- **Problema de acceso / no llega el código:** ⚠️ definir qué responde y a quién
  escala (¿teléfono de soporte 24/7?).
- **Emergencia o daño en el apartaestudio:** ⚠️ definir canal y mensaje.
- **Huésped molesto / queja:** el bot escala a humano (`notify_team`) con
  resumen. ⚠️ confirmar tono y compensaciones que puede ofrecer (o ninguna).
- **Solicitud fuera de alcance** (reembolso ya hecho, cambio de fechas, etc.):
  el bot escala. ⚠️ confirmar qué puede prometer.

## 10. Límites del bot (lo que NO debe hacer)

- No cita precios de memoria (siempre consulta OTASync).
- No comparte datos de otros huéspedes ni de reservas sin verificar el segundo
  factor.
- No pide ni acepta datos de tarjeta/pago por chat.
- No da asesoría legal ni fiscal.
- No confirma cancelaciones sin verificación previa en la misma conversación.
- No modifica reservas directamente (las cancelaciones son **solicitudes**;
  los cambios de fecha hoy se derivan al equipo).

---

## Lo que necesito de ti para completar el bot

Prioriza estas respuestas (son las que más pregunta un huésped):

1. ~~Hora de check-out definitiva.~~ ✅ Resuelto: **11:00 AM**.
2. ¿Se puede compartir la dirección por chat o solo tras reservar? Dirección y
   punto de referencia.
3. Nombre y distancia del parqueadero público cercano.
4. Desayuno: ¿se mantiene? ¿qué incluye? ¿precio?
5. Reglas de mascotas (además del cobro de $200k).
6. Aseo durante la estadía corta: ¿sí/no?
7. Soporte fuera de horario: ¿hay un teléfono 24/7 para emergencias de acceso?
8. Factura: ¿se emite a todos? ¿se pide en el chat o en la web?
9. Recomendaciones de la zona que quieras que el bot maneje.
10. ¿El bot puede ofrecer algo ante una queja, o siempre escala sin prometer?
