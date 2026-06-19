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
| ¿Aceptan mascotas? ¿cuánto? | 🟢 | Sí; $200k aseo (corta) / +$500k depósito (larga) |
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

## 4. Qué cubre HOY el bot construido (referencia)
El motor ya implementado (`_whatsapp-ai.js` + `_whatsapp-bot.js`) ya hace: info
general (🟢), disponibilidad en vivo (🔵), consulta de reserva con 2º factor (🔵),
solicitud de cancelación (🔵), y escalar a humano (🔴). Lo que falta para
**activarlo** es: (a) decidir el modelo de atención humana (ver abajo) y (b)
cargar las credenciales de Meta + `ANTHROPIC_API_KEY`.

## 5. Modelo de atención humana (handoff) — decisión pendiente
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
