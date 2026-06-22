# WhatsApp — árbol de respuestas y categorización (PENDIENTE: para cuando se active el bot)

Documento de preparación para el chat de WhatsApp de Estar. Mapea las preguntas
que suele recibir un hotel, las clasifica por **quién debe responder** (bot
simple / IA / humano) y propone el árbol de decisión. **No se implementa todavía**
— queda parqueado para cuando arranque el proceso del bot (ver `pendientes.md`).

Basado en: investigación del sector (fuentes al final) + la base de conocimiento
ya existente del proyecto (`docs/bot-conocimiento.md`) + las particularidades de
Estar (check-in 100% digital, sin parqueadero propio, cobro de mascota, política
de cancelación de 2 planes, larga estadía, empresas).

---

## 1. Las 3 categorías de respuesta

| Nivel | Quién responde | Cuándo aplica |
|---|---|---|
| 🟢 **Bot simple** (reglas/FAQ) | Respuesta fija, sin pensar | Datos que no cambian: horarios, dirección, qué incluye, políticas. Respuesta idéntica siempre. |
| 🔵 **IA / chatbot** (Claude + herramientas) | Necesita entender e ir a buscar datos en vivo | Disponibilidad/precios por fechas, consultar una reserva, recomendaciones personalizadas, resolver dudas redactadas de forma libre. |
| 🔴 **Humano** (recepción) | Solo una persona | Dinero/cambios sensibles, quejas, casos fuera de catálogo, todo lo que implique criterio o excepción. |

**Regla de oro de seguridad (ya en el código, no en el prompt):** ninguna acción
sensible (ver datos de una reserva, cancelar) ocurre sin **segundo factor**
(código + email/apellido) verificado en la misma conversación. La autorización
es código, no confianza en el modelo.

---

## 2. Inventario de preguntas por etapa + categoría

### A. Antes de reservar (pre-venta)
| Pregunta típica | Nivel | Nota |
|---|---|---|
| ¿Dónde quedan? / dirección / cómo llego | 🟢 | Palogrande, Manizales |
| ¿Qué tipos de apartaestudio hay? / fotos | 🟢 | 5 tipologías; enlace al sitio |
| ¿Cuánto cuesta del X al Y para N personas? | 🔵 | **Disponibilidad + precio en vivo (OTASync)**; devuelve enlace de reserva |
| ¿Tienen disponibilidad para [fechas]? | 🔵 | Igual que arriba |
| ¿Aceptan mascotas? ¿cuánto? | 🟢 | Sí; **$200k fijos por reserva** (corta). Larga estadía: por confirmar (ver `bot-conocimiento.md` §5/§6) |
| ¿Tienen parqueadero? | 🟢 | No propio; parqueadero público cercano |
| ¿Métodos de pago? | 🟢 | Tarjeta, PSE, Nequi, Bancolombia (Wompi) |
| ¿Política de cancelación? | 🟢 | 2 planes (Estricta/Flexible); enlace a `cancelacion.html` |
| ¿Aire acondicionado / calefacción? | 🟢 | Clima templado; ventilador/calefactor a solicitud |
| ¿Descuentos / promociones? | 🔴→🔵 | Si hay campaña definida, IA; si es negociación, humano |
| Cotización empresa / grupo / larga estadía | 🔴 | Deriva a humano (lo maneja ventas) |

### B. Al reservar / transaccional
| Pregunta típica | Nivel | Nota |
|---|---|---|
| ¿Cómo reservo? | 🟢 | Enlace al motor; el bot **no crea reservas** |
| No me funcionó el pago / ¿quedó mi reserva? | 🔵→🔴 | IA consulta estado con 2º factor; si hay problema real → humano |
| Quiero modificar fechas/huéspedes | 🔴 | Cambios en el PMS = humano (el bot no modifica) |
| Quiero cancelar mi reserva | 🔵 | IA: exige 2º factor, registra **solicitud** (no cancela ni reembolsa) |
| ¿Me pueden facturar? / datos de factura | 🔴 | Humano / proceso de facturación |

### C. Durante la estadía (in-stay)
| Pregunta típica | Nivel | Nota |
|---|---|---|
| ¿Cuál es el wifi / clave? | 🟢 | Dato fijo |
| ¿A qué hora es el desayuno / qué incluye? | 🟢 | Horario fijo |
| ¿Cómo funciona el check-in digital / mis códigos? | 🟢 | Explicación fija + enlace guest app |
| No me llegaron los códigos / no entra la clave | 🔴 | Acceso = urgente, humano |
| Quiero late check-out / early check-in | 🔵→🔴 | IA informa precio (15%/35%); ejecutar el cargo = humano/guest app |
| Pedir toallas / aseo / algo a la habitación | 🔵→🔴 | IA toma el pedido; recepción ejecuta |
| Recomendaciones de Manizales (qué hacer/comer) | 🔵 | IA con la base de conocimiento |
| Problema en el apartaestudio (daño, ruido) | 🔴 | Queja = humano siempre |

### D. Después de la estadía (post-venta)
| Pregunta típica | Nivel | Nota |
|---|---|---|
| Dejé algo olvidado | 🔴 | Humano |
| ¿Dónde dejo una reseña? | 🟢 | Enlace de reseña |
| Estado de mi reembolso | 🔵→🔴 | IA consulta con 2º factor; gestión = humano |
| Quiero volver / repetir reserva | 🔵 | IA: disponibilidad + enlace |

### E. Siempre humano (cualquier etapa)
Quejas y reclamos · disputas de cobro · solicitudes de excepción a la política ·
temas legales · datos de otra persona/reserva sin verificar · cualquier cosa que
el guardián de seguridad marque como sospechosa (3 strikes → alerta al equipo).

---

## 3. Árbol de decisión (flujo)

```
Mensaje entra
  │
  ├─ ¿Es saludo / menú? ──────────────► 🟢 Bot: saluda + ofrece opciones
  │
  ├─ ¿Pide humano / "agente" / queja? ─► 🔴 Escala a humano (correo + aviso)
  │
  ├─ ¿Pregunta de info fija (horarios,
  │   dirección, políticas, mascotas,
  │   parqueadero, pagos)? ────────────► 🟢 Bot: respuesta de la base de conocimiento
  │
  ├─ ¿Disponibilidad / precio por fechas? ─► 🔵 IA → consulta OTASync en vivo → enlace
  │
  ├─ ¿Sobre SU reserva (consultar,
  │   cancelar, reembolso, pago)?
  │        │
  │        ├─ ¿Verificó código + email/apellido?
  │        │       ├─ No ──► 🔵 IA pide el 2º factor
  │        │       └─ Sí ──► 🔵 IA: consulta / registra solicitud de cancelación
  │        │
  │        └─ ¿Pide modificar fechas / facturar / caso raro? ─► 🔴 Humano
  │
  ├─ ¿Cotización empresa / grupo / larga estadía? ─► 🔴 Humano (ventas)
  │
  └─ ¿No entiendo / fuera de alcance? ─► 🔵 IA intenta; si no, 🔴 humano
```

---

## 4. Respuestas modelo + datos requeridos por pregunta

> Para cada punto: un **ejemplo de cómo respondería el bot** (estilo WhatsApp del
> prompt real: corto < 600 caract., *negrita*, guiones, máx. un emoji, termina con
> el siguiente paso) y **qué dato necesita / de dónde lo saca**.
>
> **Convención de fuentes:**
> - **[FIJO]** está en el conocimiento del bot → no consulta nada.
> - **[OTASYNC]** llama una herramienta que consulta OTASync **en vivo**.
> - **[PIDE]** el bot primero debe sacarle el dato al huésped.
> - **[WEB]** la acción real ocurre en la página; el bot entrega el enlace.
>
> Solo **dos** tipos de pregunta tocan OTASync: *disponibilidad/precio* y
> *consultar una reserva*. Todo lo demás es conocimiento fijo o se deriva.

### A. Antes de reservar

**¿Dónde quedan? / ¿cómo llego?** — 🟢 [FIJO]
> Estamos en *Palogrande, Manizales* 📍 muy cerca del estadio y la zona
> universitaria. ¿Te comparto la ubicación exacta para tu llegada?

**¿Qué apartaestudios tienen? / fotos** — 🟢 [FIJO] [WEB]
> Tenemos 5 tipologías de apartaestudio (de 2 a 5 personas), todas con cocina
> equipada, baño privado y WiFi de fibra. Puedes ver fotos y detalles aquí:
> estar.com.co 🙂 ¿Para qué fechas y cuántas personas estás mirando?
- _Datos:_ catálogo [FIJO] (nombres/capacidades de `rooms_db.json`).

**¿Cuánto cuesta del 5 al 8 de julio para 2 personas?** — 🔵 [OTASYNC] [WEB]
- _Datos que necesita:_ **check-in**, **check-out**, **# personas** → si faltan, los pide.
- _Flujo:_ `check_availability(checkin, checkout, guests)` → OTASync (cupos + precio por noche) → arma la lista + **enlace de reserva prellenado**.
> *Del 5 al 8 jul (3 noches) · 2 personas:*
> - *Clásica* — desde $XXX.XXX/noche
> - *Selección* — desde $XXX.XXX/noche
> El pago se hace en la web; aquí te dejo todo listo 👇
> estar.com.co/reservar.html?checkin=2026-07-05&checkout=2026-07-08&guests=2
- _Si faltan datos:_
> ¡Con gusto! ¿Para qué *fechas* (entrada y salida) y *cuántas personas*? Con eso te confirmo disponibilidad y precio.
- ⚠️ El bot **nunca inventa** precios: si la herramienta no responde, dice que verifiquen en la web o pasa con el equipo.

**¿Tienen disponibilidad para [fechas]?** — 🔵 [OTASYNC] — igual que el anterior (misma herramienta).

**¿Aceptan mascotas? ¿cuánto?** — 🟢 [FIJO]
> ¡Sí, son bienvenidas! 🐾 En estadía corta hay un *cobro de aseo de $200.000* (no reembolsable). En larga estadía, además un *depósito reembolsable de $500.000*. ¿Para qué fechas viajas?

**¿Tienen parqueadero?** — 🟢 [FIJO]
> No tenemos parqueadero propio, pero hay un *parqueadero público muy cerca* (ajeno a la propiedad). ¿Te ayudo con algo más de tu reserva?

**¿Cómo puedo pagar?** — 🟢 [FIJO]
> Puedes pagar con *tarjeta, PSE, Nequi o Bancolombia* a través de la pasarela segura en la web. El pago siempre es en la página, nunca por chat.

**¿Cuál es la política de cancelación?** — 🟢 [FIJO] [WEB]
> Manejamos 2 planes: *Estricta* (más económica, cancelas gratis hasta 7 días antes) y *Flexible* (gratis hasta 24 h antes). Fuera de plazo se cobra la 1ª noche + impuestos + 3,5%. Detalle: estar.com.co/cancelacion.html

**¿Tienen aire acondicionado / calefacción?** — 🟢 [FIJO]
> Manizales tiene clima templado, así que los apartaestudios no necesitan A/C. Si quieres, podemos dejar un *calefactor o ventilador* a tu llegada. 🙂

**¿Tienen descuentos / promociones?** — 🔵/🔴 [FIJO si hay campaña]
> _(Con campaña activa)_ ¡Sí! Tenemos *[cupón XX]* válido hasta [fecha]; aplícalo en el paso de pago. _(Sin campaña)_ Ahora mismo no tengo promos activas, pero cuéntame tus fechas y te paso el mejor precio disponible.
- _Datos:_ existencia/condiciones del cupón [FIJO, si está cargado]. Negociación de precio → 🔴 humano.

### B. Al reservar / transaccional

**¿Cómo reservo?** — 🟢 [WEB] (el bot **no** crea reservas)
> La reserva se hace en la web en 4 pasos (eliges apartaestudio → extras → tus datos → pago). ¿Para qué fechas y cuántas personas? Te dejo el enlace listo.

**No me funcionó el pago / ¿quedó mi reserva?** — 🔵 [OTASYNC] [PIDE] → 🔴 si hay problema real
- _Datos que necesita:_ **código de reserva** + **email o apellido** (2º factor).
- _Flujo:_ `lookup_booking(code, email/apellido)` → OTASync → confirma estado.
> Lo reviso enseguida 🙏 ¿Me confirmas tu *código de reserva* y el *email o apellido* con que reservaste?
> _(tras verificar, si existe)_ Tu reserva *EST-1042* está *confirmada*: Selección, 5–8 jul. ¿Necesitas algo más?
> _(si no aparece o hay inconsistencia)_ No encuentro una reserva con esos datos. ¿Los revisas? Si el cobro salió pero no ves la reserva, te paso con el equipo para resolverlo.

**Quiero modificar fechas / huéspedes** — 🔴 [HUMANO]
> Para cambiar fechas o huéspedes te paso con el equipo, que lo ajusta directamente. ¿Me confirmas tu código de reserva y qué cambio necesitas?
- _Acción:_ `notify_team` con el resumen. El bot **no** modifica el PMS.

**Quiero cancelar mi reserva** — 🔵 [OTASYNC] [PIDE]
- _Datos:_ **código + email/apellido** (verifica con `lookup_booking`), luego **confirmar la intención**.
- _Flujo:_ `lookup_booking` (verifica) → confirma → `request_cancellation` (registra la solicitud; **no** cancela ni reembolsa al instante).
> Para gestionar tu cancelación primero verifico la reserva: ¿tu *código* y *email/apellido*?
> _(verificada)_ Confirmo: ¿deseas cancelar la reserva *EST-1042* (Selección, 5–8 jul)? El equipo procesa el reembolso según tu tarifa (no es inmediato).
> _(tras "sí")_ Listo, registré tu *solicitud de cancelación*. El equipo te contacta para el reembolso según la política. 🙏
- 🔒 _Candado de seguridad (en código, no en el prompt):_ no se puede cancelar una reserva que no se haya **verificado con 2º factor en esa misma conversación**.

**¿Me pueden facturar? / datos de factura** — 🔴 [HUMANO]
> Con gusto, la facturación la gestiona el equipo. Te paso con ellos con tus datos. ¿Razón social y NIT?

### C. Durante la estadía

**¿Cuál es el WiFi / la clave?** — 🟢 [FIJO]
> Cada apartaestudio tiene su propia red 📶 El *nombre* es *estar + el número de tu apartaestudio* y la *clave* es *el número + estar*. Ej.: apto 101 → red *estar101*, clave *101estar*. También viene en tu enlace de check-in.
- _Datos:_ patrón fijo (red `estar<#apto>` / clave `<#apto>estar`). Si el bot conoce el # de apto (vía `lookup_booking`), puede dar la red exacta.

**¿Cómo funciona el check-in digital / mis códigos?** — 🟢 [FIJO] [WEB]
> Todo es digital, sin recepción: *un día antes* te llega un enlace con tus *códigos de acceso*. Entras directo, sin llaves. Aquí tu portal: estar.com.co/guest.html

**No me llegaron los códigos / no entra la clave** — 🔴 [HUMANO — urgente]
> Eso lo resolvemos ya. Te paso con el equipo de inmediato 🙏 ¿Tu código de reserva y a qué apartaestudio llegas?
- _Acción:_ `notify_team` marcado urgente (acceso = nunca esperar al bot).

**Quiero late check-out / early check-in** — 🔵 [FIJO precio] → 🔴/[WEB] para ejecutar
> Claro: *late check-out* (hasta 2 pm) y *early check-in* (desde 6 am) tienen un costo según tu tarifa. Puedes solicitarlo desde tu *portal de huésped* (estar.com.co/guest.html) o te paso con el equipo. ¿Cuál prefieres?

**Pedir toallas / aseo / algo a la habitación** — 🔵 [PIDE] → 🔴 ejecuta
> ¡Anotado! ¿Qué necesitas y a qué apartaestudio? Lo paso al equipo para que te lo lleve.
- _Acción:_ `notify_team` con el pedido (o el huésped lo pide desde el guest app).

**Recomendaciones de Manizales (qué hacer / comer)** — 🔵 [FIJO/IA]
> ¡Tenemos una guía curada! ☕ A pasos: café en *Differente* o *Caferatto*, comer en *Lyara* o *KOMO*. ¿Buscas café, comida, naturaleza o avistamiento de aves? Te afino 2-3 según tu plan.
- _Datos:_ guía curada de §8 de `bot-conocimiento.md` (34 lugares de `explora.html` por categoría/distancia). El bot sugiere 2-3, no la lista entera.

**Problema en el apartaestudio (daño, ruido)** — 🔴 [HUMANO]
> Lamento eso 🙏 Te paso de una con el equipo para resolverlo. ¿Me describes brevemente qué pasa y tu apartaestudio?

### D. Después de la estadía

**Dejé algo olvidado** — 🔴 [HUMANO]
> Te ayudamos a recuperarlo. Te paso con el equipo. ¿Qué olvidaste y en qué apartaestudio/fechas te alojaste?

**¿Dónde dejo una reseña?** — 🟢 [FIJO] [WEB]
> ¡Nos encantaría leerte! 🙏 Déjanos tu reseña en Google aquí: https://share.google/0RcHkOyTWXTNrj8oH ¡Gracias por elegir Estar!
- _Datos:_ enlace del perfil de Google de Hotel Estar. _(Pendiente: cambiarlo por el enlace directo `g.page/r/.../review` para que abra el cuadro de reseña de un clic — ver `bot-conocimiento.md`.)_

**Estado de mi reembolso** — 🔵 [OTASYNC/PIDE] → 🔴 gestión
> Lo reviso. ¿Tu *código de reserva* y *email/apellido*? El estado y el giro del reembolso los gestiona el equipo dentro del plazo de la política.

**Quiero volver / repetir reserva** — 🔵 [OTASYNC] [WEB] — misma vía que disponibilidad (pide fechas → `check_availability` → enlace).

---

## 5. Cómo interactúa con la web y con OTASync

El bot es **consulta + calificación + entrega de enlaces**: nunca cobra, nunca
crea ni modifica reservas. El "trabajo pesado" (pago, check-in, cambios) vive en
la **web** y en el **PMS (OTASync/Kunas)**; el bot orquesta y deriva.

### 5.1 Las dos únicas consultas en vivo a OTASync
| Herramienta | Cuándo | Qué pide al huésped | Qué consulta en OTASync | Qué devuelve |
|---|---|---|---|---|
| `check_availability` | "¿precio/disponibilidad para X fechas?" | check-in, check-out, # personas | precios y cupos por tipología (`getDynamicPricing`, sesión `pkey` cacheada 30 min) | tipologías disponibles + precio/noche + **enlace de reserva prellenado** |
| `lookup_booking` | "¿mi reserva? / cancelar / reembolso / ¿quedó el pago?" | **código + email o apellido** (2º factor) | la reserva por código (`reservation/data/reservation`) y valida el 2º factor | estado, apartaestudio, fechas, noches, si es cancelable |

Las otras dos herramientas **no** tocan OTASync: `request_cancellation` registra
la solicitud (Blobs) y avisa al equipo; `notify_team` manda un correo de
escalamiento. La cancelación efectiva en OTASync ocurre **después**, cuando el
equipo la aprueba en /admin (lazo de cancelación, gated).

### 5.2 El "puente" con la web (el bot entrega, la web ejecuta)
| Intención | El bot entrega | Dónde se completa |
|---|---|---|
| Reservar / ver precio | `…/reservar.html?checkin=&checkout=&guests=` (prellenado) | **Motor de reserva**: elige → extras → datos → **pago (Wompi)** |
| Ver fotos/detalle | `estar.com.co` + páginas de cada apartaestudio | Sitio |
| Check-in / códigos / pedidos | `…/guest.html` | **Guest app** (códigos, documentos, servicios) |
| Política de cancelación | `…/cancelacion.html` | Sitio |
| Larga estadía | `…/vivir.html` + `notify_team` | **Equipo** (cotiza) |
| Empresas / grupos | `…/empresas.html` + `notify_team` | **Equipo de ventas** |
| Reseña | enlace de reseña | Booking/Google |

> El dominio de los enlaces es dinámico: en producción usa la URL real del sitio
> (`process.env.URL`); el `estar.com.co` que ves es solo el valor por defecto.

### 5.3 Flujo de una consulta de precio (de punta a punta)
```
Huésped: "precio del 5 al 8 jul para 2"
   │
   ▼ (filtro de seguridad _whatsapp-guard: descarta inyección/suplantación)
Claude (con el system prompt + herramientas)
   │  ¿tiene fechas y # personas?  ── no ──► pide los datos faltantes
   │  sí
   ▼
check_availability(2026-07-05, 2026-07-08, 2)
   │
   ▼  getDynamicPricing → OTASync (pkey cacheada) → cupos + precios
respuesta de la herramienta {nights, rooms[], bookingLink}
   │
   ▼
Claude redacta la respuesta WhatsApp + pega el bookingLink
   │
   ▼
Huésped abre el enlace → reservar.html (ahí elige y PAGA en Wompi)
```
Para "mi reserva/cancelar" el flujo es igual pero con `lookup_booking` (exige
código + email/apellido) y, si aplica, `request_cancellation`.

### 5.4 Lo que el bot NO hace (a propósito)
- **No cobra ni pide datos de tarjeta** por chat (el pago es en la web).
- **No crea ni modifica reservas** en OTASync (eso es la web o el equipo).
- **No cancela ni reembolsa** al instante (registra la solicitud; el equipo ejecuta).
- **No inventa** precios, disponibilidad ni datos de otra reserva.

---

## 6. Qué cubre HOY el bot construido (referencia)
El motor ya implementado (`_whatsapp-ai.js` + `_whatsapp-bot.js`) ya hace: info
general (🟢), disponibilidad en vivo (🔵), consulta de reserva con 2º factor (🔵),
solicitud de cancelación (🔵), y escalar a humano (🔴). Lo que falta para
**activarlo** es: (a) decidir el modelo de atención humana (ver abajo) y (b)
cargar las credenciales de Meta + `ANTHROPIC_API_KEY`.

## 7. Modelo de atención humana (handoff) — decisión pendiente
El dueño descartó la **Opción A** (app de WhatsApp Business en un celular).
Quedan:

- 🔵 **Opción B — Bandeja compartida de equipo** (ej. Chatwoot / inbox de Meta):
  varias personas atienden desde el computador, con asignación e historial.
- 🔴 **Opción C — "Toma de control" automática** (ver definición abajo).

### ¿Qué implica la Opción C? (explicación)
Hoy, cuando el bot escala, **sigue prendido**: si el huésped sigue escribiendo,
el bot le contesta aunque ya haya un humano en camino. La "toma de control" es
una **bandera por conversación**: cuando un humano entra a ese chat, el sistema
**silencia al bot solo para esa conversación** (deja de responder), el humano
atiende, y al cerrar, el bot **se reactiva** para ese chat. Es lo más profesional
(el cliente nunca recibe respuestas cruzadas bot+humano), pero **requiere
desarrollo**: un panel/bandeja donde el humano vea el chat y un botón
"tomar/soltar" que prenda/apague la bandera. En la práctica, la Opción C **vive
encima de la Opción B** (necesitas la bandeja para que el humano vea y tome el
chat). Recomendación: implementar **B con toma de control (C) incluida** como un
solo proyecto.

**Para arrancar este proceso se necesita decidir:** (1) B vs B+C, (2) horario de
atención humana y mensaje fuera de horario, (3) a qué correo/persona llega el
escalamiento (hoy `ADMIN_NOTIFY_EMAIL`).

---

## Fuentes
- [HiJiffy — preguntas comunes de huéspedes](https://www.hijiffy.com/resources/articles/what-are-the-most-common-and-weird-questions-from-guests-in-hotels)
- [TrustYou — Hotel chatbots 2026: booking bots vs guest-facing agents](https://www.trustyou.com/blog/ai-agents/hotel-chatbots-in-2026-booking-bots-vs-guest-facing-agents-compared/)
- [Asksuite / HiJiffy / Myma AI — automatización pre-stay / in-stay / post-stay](https://www.myma.ai/hotel-chatbot)
