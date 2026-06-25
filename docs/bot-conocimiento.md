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

<!-- BOT-KNOWLEDGE:START — todo lo que está entre estos marcadores se carga en el
     contexto del bot en tiempo de ejecución (_whatsapp-ai.js). Las líneas con ⚠️
     se filtran automáticamente (no llegan al bot). NO muevas los marcadores sin
     querer. -->

## 1. El alojamiento

- **Qué es:** apartaestudios completos (no habitaciones de hotel) en Manizales,
  Colombia. Cada uno con cocina equipada, baño privado, WiFi de fibra, TV cable
  y zona de trabajo.
- **Tipologías** (fuente: `rooms_db.json` — tamaño, camas y amenidades por tipo):
  - **Clásica** — 29 m² · hasta 2 personas · 1 cama doble · vista interior · WiFi fibra, TV cable, cocina equipada (estufa, microondas, cafetera), baño privado con ducha, secador.
  - **Reserva** — 24 m² · hasta 2 personas · 1 cama doble · vista a la ciudad · WiFi fibra, TV cable, cocina equipada, baño privado, secador.
  - **Especial** — 27 m² · hasta 2 personas · 1 cama doble · vista a la ciudad · cocina equipada, baño privado con ducha, secador y plancha.
  - **Origen** — 29 m² · hasta 3 personas · 1 cama doble + 1 sencilla · vista a la ciudad · cocina completa, baño privado, secador.
  - **Selección** — 36 m² · hasta 5 personas · 1 king + 1 doble + 1 sencilla · vista a la ciudad · cocina completa, baño privado, secador y plancha.
  - **Cantidad de unidades por tipología:** ⚠️ POR CONFIRMAR (cuántos apartaestudios hay de cada tipo).
- **Dirección (se puede compartir libremente):** **Cl. 61 #23-36**, barrio **La
  Estrella**, sector **Palogrande**, Manizales, Caldas.
- **Cómo llegar / referencias:** a **una cuadra de la Av. Santander**, cerca del
  **Estadio Palogrande**, **Cable Plaza**, la **Universidad Nacional** y la
  **Universidad de Caldas**.
  - Google Maps: https://maps.app.goo.gl/QwDXDmpE7NwV4m1ZA
  - Waze: https://ul.waze.com/ul?place=ChIJT2vbCbBlR44Rbq4GbLKZIeU&ll=5.05957470,-75.48809350&navigate=yes
- **Recepción:** el ingreso/check-in es **autónomo (100% digital)**, pero **sí hay
  recepción** para atenderte de **6:00–10:00 AM** y **4:00–10:00 PM**. Mensaje
  modelo: _"El ingreso es autónomo, pero contamos con recepción de 6 a 10 am y de
  4 a 10 pm para atenderte en lo que necesites."_ Si la pides, en esos horarios
  pueden darte una **tarjeta de ingreso**.

## 2. Check-in / check-out

- **Check-in:** desde las 3:00 PM. **Ingreso autónomo 100% digital** — un día
  antes llega un enlace con los códigos de acceso (sin llaves físicas). Hay
  **recepción** 6:00–10:00 AM y 4:00–10:00 PM para lo que necesites.
- **Check-out:** **11:00 AM**.
- **Early check-in** (entrada anticipada): **tarifa única del 25%** del valor de
  la tarifa estándar; habilita el ingreso **desde las 6:00 AM**, sujeto a
  disponibilidad. **Antes de las 6:00 AM** ya se debe **tomar la noche previa**.
- **Late check-out:** hasta las **2:00 PM** por el **15%** del valor de la noche.
  Para horas más tardes se **consulta con recepción**, pero la norma es
  **reservar una noche más**.
- **Guardado de equipaje:** sí, se puede **dejar el equipaje** dentro de los
  **horarios de atención de recepción** (6–10 AM y 4–10 PM).

## 3. Tarifas y reservas

- Dos planes de tarifa:
  - **Estricta** (base, más económica): cancelación gratuita hasta **7 días**
    antes del check-in.
  - **Flexible** (+10%): cancelación gratuita hasta **24 horas** antes del
    check-in.
- **El pago se hace SIEMPRE en la web** (`reservar.html`), nunca por chat. Para
  reservar hay que **pagar a través de la plataforma**. El bot entrega el enlace
  con fechas precargadas.
- **No menciones medios de pago específicos** (efectivo/transferencia/etc.):
  **todos los pagos se dirigen por la página web** (pasarela segura).
- **Facturación:** se emite **a nombre de quien hace la reserva (el titular)**.
  Si se requiere a nombre de un **tercero o empresa**, se debe **diligenciar el
  formulario de facturación dentro de la reserva**. Razón social: **Mirada SAS,
  NIT 902.032.515-0**. _(Cambiar una factura ya emitida → solicitud con filtro
  de seguridad; ver `pendientes.md`.)_

## 4. Política de cancelación y reembolsos

- Dos planes (se eligen al reservar):
  - **Estricta** (base): cancelación gratis con reembolso 100% hasta **7 días antes** del check-in.
  - **Flexible** (+10%): cancelación gratis con reembolso 100% hasta **24 horas antes** del check-in.
- **Fuera de plazo** (cualquier plan): se cobra **1ª noche + impuestos + 3,5%** del total; se reembolsa el resto.
- **No-show:** si no cancela y pasan **24 horas desde el check-in**, pierde el reembolso (no se reembolsa nada).
- **Tiempo de reembolso:** **15 días hábiles** — igual para **todos** los medios
  de pago (no se diferencia por método). No cites tiempos distintos por canal.
- **Cómo cancela un huésped, según el canal:**
  - **Reserva por una OTA** (Booking, Airbnb, etc.): debe tramitarla **por la
    misma OTA**. El bot le indica **consultar/descargar la información de
    cancelación en la OTA** para que cancele allí.
  - **Reserva directa** (web): el bot **verifica** (código + email/apellido), le
    **envía el enlace del guest app** y le indica la ruta para gestionarla.
    Registra la solicitud; el equipo procesa el reembolso. **No es instantáneo.**

## 5. Servicios y amenidades

- **Desayuno:** ⚠️ POR CONFIRMAR — el **menú está pendiente** (lo envía el dueño;
  ver `pendientes.md`).
- **Mascotas:** bienvenidas. Estadía corta: **$200.000 por reserva** (no
  reembolsable). **Máximo 2 mascotas.** **No se pueden dejar solas** en el
  apartaestudio. (Larga estadía: ver §6.)
- **Parqueadero:** Estar **no** tiene parqueadero propio. Justo **al frente** hay
  **zona azul** (parqueo en vía) y un **parqueadero público cerrado a ~20 metros**.
- **Limpieza:** **estadía corta → aseo diario**; **larga estadía → aseo semanal**.
- **Lavandería:**
  - Larga estadía: **1 ciclo de lavado + secado por semana** incluido.
  - Estadía corta (tarifas): **Lavandería completa $35.000** · **Solo lavado
    $15.000** · **Solo secado $25.000**.
- **Wifi (una red por apartaestudio):** cada apartaestudio tiene su propia red.
  El **nombre de la red es `estar` + el número del apartaestudio** y la **clave es
  el número del apartaestudio + `estar`**. Ejemplo: apto **101** → red `estar101`,
  clave `101estar`. El dato también llega en el enlace de check-in. _(Nota: el
  esquema es predecible a partir del número de apto; si en algún momento quieren
  claves más fuertes, se cambia el patrón.)_
- **Cocina (equipamiento):** cafetera, licuadora, cubiertos, platos y vasos para
  dos personas, ollas y sartenes. (Estufa y microondas según tipología.)

## 6. Estadías largas ("Vivir en Estar")

- 1 a 12 meses, todo incluido (servicios, internet de fibra, aseo semanal),
  sin fiadores, proceso 100% digital. Tarifas mensuales **con IVA incluido**.
- **Cotizaciones:** el bot **puede orientar** con base en las **tarifas
  publicadas** según el tiempo que la persona planee quedarse, y la **remite a
  `vivir.html`** para verlas. Si pide una cotización formal, la refiere a la
  página (normalmente no se requiere una cotización aparte).
- **Mascota en larga estadía:** pago de **$200.000** + un **depósito reembolsable
  de $500.000** (se reintegra al final si no hubo problemas).
- **Requisitos:** inicialmente **copia del documento** + **consentimiento para
  consulta en DataCrédito**. Si **no se cumplen**, se solicita un **codeudor**.

## 7. Empresas y grupos

- Tarifas corporativas, bloqueos de inventario, cotizaciones formales. El bot
  escala al equipo comercial (`notify_team`).
- **Crédito a 30 días: sí se ofrece.** También **bolsas de noches con
  descuentos**, sujetas a un **proceso de vinculación y evaluación financiera**.
- **Documentos legales para proveedores** (RUT, Cámara de Comercio): se podrán
  descargar desde la web (en gestión).

## 8. Zona / recomendaciones (Manizales)

Guía curada por Estar (la versión con fotos y mapa vive en `explora.html`).
Estar está en **Cl. 61 #23-36, La Estrella / Palogrande**, así que muchos
lugares quedan a minutos a pie. Al recomendar, sugiere **2-3 según el interés
del huésped** (café, comida, naturaleza, aves, deporte), no toda la lista.

**A unos pasos (caminando):**
- *Restaurantes:* Lyara (2 min), KOMO – sushi/asiática (2 min), Ednia
  mediterránea (10 min), Vino y Pimienta – carnes y vinos (12 min)
- *Cafés de especialidad:* Differente (1 min), Caferatto (3 min),
  35mm Coffee Lab (8 min)
- *Universidades:* U. de Caldas – Palogrande (3 min, al frente), U. Nacional –
  Palogrande (3 min), U. Católica (4 min), U. de Caldas – Central (5 min)
- *Deportivo:* Estadio Palogrande (1 min), Coliseos Ramón Marín y Jorge Arango
  (2 min)
- *Turismo:* Torre del Cable (4 min)

**Escapadas y naturaleza (en carro):**
- Recinto del Pensamiento – orquídeas, mariposas y bosque andino (15 min)
- Hacienda Venecia – Paisaje Cultural Cafetero (30 min)
- Viga Vieja – arquitectura colonial y café (40 min)
- Finca Romelia – orquídeas y aves (45 min)
- Hotel Termales del Ruiz – aguas termales en el páramo (1h 15)
- Nevado del Ruiz – volcán y Parque Los Nevados (1h 30)

**Avistamiento de aves (birding):**
- Reserva Tinamú – colibríes (30 min), Reserva Río Blanco "Owls Watch"
  (25 min), Hacienda El Bosque (40 min), Tominejo Ecolodge (35 min),
  El Color de mis Rêves – glamping en bosque de niebla (35 min)

**Otros planes (en carro):** 2.0 Cocina y Copas (15 min), Lobo Cantina Mex
(8 min); Torre de Chipre – atardeceres (15 min), Catedral Basílica – la más alta
de Colombia (12 min); deportivo: Patinódromo, Complejo Acuático, pistas de
Downhill y BMX (10-15 min).

- **Reseñas (Google):** invita a dejar reseña con el **enlace directo de
  "escribir reseña"** → https://g.page/r/CW6uBmyymSHlEBM/review
- **Aeropuerto / transporte / supermercados cercanos:** ⚠️ POR CONFIRMAR
  (distancia al aeropuerto La Nubia, taxi/app recomendada, supermercado más
  cercano).

<!-- BOT-KNOWLEDGE:END -->

## 9. Situaciones especiales — protocolo de escalamiento

> El escalamiento deseado es por **llamada telefónica** (no solo correo). Eso
> **requiere una integración de telefonía** (ej. Twilio): hoy el bot solo manda
> correo (`notify_team`). El protocolo objetivo es el siguiente — ver `pendientes.md`.

- **Acceso / no llega el código (fuera del horario de recepción):** escalar con
  **llamada** a un **primer número responsable** con el aviso _"huésped requiere
  atención en horario de desconexión"_. Si esa persona **no entra al chat ni
  atiende en 10 minutos**, **llamar a los dueños**.
- **Necesita recepción (en general):** **llamada** a recepción con _"huésped
  requiere atención"_. Si el recepcionista/responsable **no contesta**, redirigir
  la llamada al **dueño**.
- **Señal de alarma / seguridad** (el guard marca 3 strikes): escalamiento a
  humano con **llamada + historial + resumen** de la conversación.
- **No urgente / administrativo:** el bot envía los **horarios de atención** y
  avisa que **se atenderá tan pronto sea posible**.

⚠️ POR DEFINIR para implementar: los **números** (primer responsable, recepción,
dueños) y el proveedor de telefonía/llamadas.

## 10. Límites del bot (lo que NO debe hacer)

- No cita precios de memoria (siempre consulta OTASync).
- No comparte datos de otros huéspedes ni de reservas sin verificar el segundo
  factor.
- No pide ni acepta datos de tarjeta/pago por chat.
- No da asesoría legal ni fiscal.
- No confirma cancelaciones sin verificación previa en la misma conversación.
- No modifica reservas directamente. **Ruta de cualquier cambio:** (1) por la
  **guest app**; (2) si no es posible con las capacidades de la guest app, se
  **deriva a recepción en su horario** (6–10 AM / 4–10 PM); (3) si es **urgente**,
  por **llamada** con el protocolo de la §9.

---

## Lo que necesito de ti para completar el bot

Casi todo resuelto en esta ronda (2026-06-24). Lo que **sigue pendiente**:

1. ~~Hora de check-out.~~ ✅ 11:00 AM.
2. ~~Dirección (¿se comparte?).~~ ✅ Se comparte libremente (§1).
3. ~~Parqueadero cercano.~~ ✅ Zona azul al frente + parqueadero cerrado a ~20 m (§5).
4. **Desayuno: menú PENDIENTE** — el dueño lo enviará para agregarlo (§5 / `pendientes.md`).
5. ~~Reglas de mascotas.~~ ✅ Máx. 2, no dejarlas solas (§5); larga estadía 200k+500k (§6).
6. ~~Aseo.~~ ✅ Corta: diario · larga: semanal (§5).
7. **Escalamiento por llamada: faltan los NÚMEROS** (primer responsable, recepción, dueños) y el proveedor de telefonía (§9 / `pendientes.md`).
8. ~~Factura.~~ ✅ Al titular; formulario para empresa/tercero (§3).
9. ~~Recomendaciones de la zona.~~ ✅ Guía curada en §8.
10. ~~¿Algo ante una queja?~~ ✅ El bot escala; no urgente → manda horarios; urgente → llamada (§9-§10).
11. **Falta un servicio/amenidad (§5.6)** que el dueño mencionó que enviará (`pendientes.md`).
12. **Reseñas:** ✅ enlace directo cargado (`g.page/r/CW6uBmyymSHlEBM/review`, §8).
