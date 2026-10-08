# 📋 Dudas y decisiones para implementar las mejoras (todas las fases)

---

## ✅ ESTADO (actualizado tras implementación)

**Fase 0 y Fase 1: IMPLEMENTADAS** con las decisiones del cliente. **Fase 2: EN PAUSA** (políticas a revisar con los fundadores).

| # | Decisión registrada |
|---|---|
| 1.1 | Check-out siempre 11:00 a. m. (todas las tipologías y estadías) |
| 1.2 | Late check-out hasta 5:00 p. m. por $60.000 (corrige el $80.000 de la guest app) |
| 2.1 | Texto de polling aprobado |
| 3.1 | Resumen móvil: barra sticky superior expandible (opción a) |
| 4.1 | SLA contacto: menos de 24 horas |
| 4.2 | SLA Concierge guest app: máximo 10 min en horario 6–10 a. m. y 4–10 p. m. |
| 5.1 | Reseñas de Booking reutilizadas en empresas/grupos/vivir + score en vivo |
| 5.2 | Sin testimonios propios aún → nota TODO para personalizar por persona |
| 6.1 | Empresas: valor = facilidades/servicio/cercanía (no ahorro) |
| 7 | Empresas: mismas tarifas públicas, hasta 15% por convenio, nota de contratación directa (sin sobrecosto de broker) |
| 8.1 | Grupos: descuento por persona hasta 30% (sin rangos rígidos) |
| 8.2 | Bloqueo 48h sin compromiso para reservas con >1 semana de anticipación |
| 8.3 | Grupos: anticipo de al menos 50% |
| 9.1 | (técnico, resuelto sin tu intervención) Confirmación "✓ Documento cargado" |
| 9.2 | Badge del carrito (oculto cuando vacío) |

**Fase 2 (en pausa hasta revisar con fundadores):** cancelación (10.1–10.4), FAQ (11.1–11.5), estadía larga (12.1–12.5). Quedan abajo tal cual para cuando tengas los datos.

---


> **Cómo usar este documento:** responde marcando junto a cada número (ej. *"1 → 11:00 para todo"*, *"7a → desde $180.000"*). Lo que dejes sin responder, lo implemento con la opción marcada como **(default propuesto)**. Lo que está como **[BLOQUEANTE]** no puedo inventarlo: necesito tu dato real (precios, políticas, SLA).
>
> Leyenda: 🟥 Fase 0 · 🟧 Fase 1 · 🟨 Fase 2

---

## 🟥 FASE 0 — Quick wins

### 1. Check-out unificado a 11:00 a.m. ✅ (ya decidido)
Corrijo `index.html:60` y `en/index.html:53` (`checkoutTime: "12:00"` → `"11:00"`). La FAQ se queda en 11:00.
- **1.1** ¿El check-out 11:00 aplica **igual a estadía corta y a estadía larga** (`vivir`)? ¿Y a todas las tipologías? *(default: sí, 11:00 para todos)*
- **1.2** El late check-out de pago: hoy un sitio dice "hasta las 4:00 p. m." (`guest.html`) y el extra del motor dice "60k/80k". ¿Cuál es el precio y la hora correctos del late check-out? **[BLOQUEANTE si difieren]**

### 2. Texto "puedes cerrar la ventana" en el polling de pago
Mostraré junto al spinner: *"Estamos confirmando tu reserva. Puedes cerrar esta ventana: te enviaremos la confirmación por correo."*
- **2.1** ¿Apruebas ese texto (ES) y su traducción EN? *(default: sí)*

### 3. Resumen/total visible en móvil durante el checkout
Hoy el resumen se oculta en pantallas <960px.
- **3.1** ¿Prefieres **(a)** una barra sticky arriba con "Total $X · N noches" que se expande al tocar *(default propuesto)*, o **(b)** el resumen completo embebido entre pasos?

### 4. SLA y confirmación de envío en formularios de soporte
- **4.1** ¿Cuál es el **tiempo de respuesta real** que quieres comprometer públicamente? *(default propuesto: "Respondemos en menos de 24 horas hábiles")* **[BLOQUEANTE si es otro]**
- **4.2** ¿Mismo SLA para el panel **Concierge de la guest app** que para `contacto.html`? ¿O el huésped activo tiene uno más rápido (ej. WhatsApp en horario X)?

---

## 🟧 FASE 1 — Conversión y confianza

### 5. Prueba social en páginas B2B (`empresas`, `grupos`, `vivir`, `nosotros`)
Plan: reutilizar la sección de reseñas de la home + opcional 1-2 testimonios por segmento.
- **5.1** ¿OK con **mostrar las reseñas de Booking de la home** también en empresas/grupos/vivir? *(default: sí)*
- **5.2** ¿Tienes **testimonios específicos por segmento** con permiso de uso (un CFO/administrador para empresas, un organizador de bodas/retiros para grupos, un médico residente/nómada para vivir)? Si me das texto + nombre/rol + foto (opcional), los integro. Si no, uso solo las reseñas de Booking. **[BLOQUEANTE solo si quieres testimonios propios]**

### 6. Caso de éxito con cifras en `empresas.html`
Hoy hay logos (Universidad Nacional, Hospital de Caldas, Sura…) pero sin números.
- **6.1** ¿Qué **dato real** puedo publicar de algún cliente? Ej.: "*Hospital de Caldas — N residentes/trimestre, X% de ahorro vs tarifa pública*". Dame 1-3 casos con cifras que estés autorizado a publicar. **[BLOQUEANTE]**

### 7. Precio ancla B2B — `empresas.html`
- **7.1** ¿Publicamos un **"desde $X/noche corporativo"**? ¿Cuál es ese valor (o rango)? **[BLOQUEANTE]**
- **7.2** El "Hasta 25% bajo tarifa pública": ¿se mantiene como mensaje o lo reemplazamos por la tarifa concreta?
- **7.3** ¿Prefieres mantener **"cotización a la medida"** sin número y en su lugar solo agregar el rango de descuento? *(alternativa si no quieres exponer precio)*

### 8. Escala de descuentos por grupo — `grupos.html`
- **8.1** ¿Cuál es la **escala real** de descuento por nº de unidades? Ej.: 4-6 uds = X%, 7-10 = Y%, 11-13 = Z%. **[BLOQUEANTE]**
- **8.2** El "bloqueo preventivo 48h sin compromiso": ¿requiere **depósito/anticipo** o es realmente sin pago? ¿Cómo se le comunica al cliente (email/WhatsApp)?
- **8.3** El anticipo: ¿qué % del total y qué métodos exactos (transferencia + link de pago Wompi)?

### 9. Feedback de subida de documentos + badge de carrito (guest app)
- **9.1** Confirmación "✓ Documento recibido": ¿el backend (`guest-checkin`) ya devuelve una señal de éxito que pueda usar, o lo muestro al completar el POST sin error? *(esto lo verifico yo en código; sin acción tuya salvo que sepas de un caso especial)*
- **9.2** Badge de cantidad en el carrito de servicios: cambio puramente visual, **no necesito decisión**. *(lo implemento)*

---

## 🟨 FASE 2 — Políticas y contenido

### 10. Política de cancelación — `cancelacion.html` (ES/EN)
Para poder escribir ejemplos numéricos correctos necesito los valores reales:
- **10.1** Penalidad por **no-show**: ¿exactamente **1 noche**? ¿o un % del total? **[BLOQUEANTE]**
- **10.2** Plazo de **reembolso**: hoy dice "5–15 días hábiles". ¿Puedo cambiarlo a un rango más estrecho real (ej. "7–10 días hábiles, según tu banco")? ¿Cuál es el real? **[BLOQUEANTE]**
- **10.3** **Extended Stay / salida anticipada (30 días de aviso):** si alguien reservó 60 noches y se va en la 40, ¿qué pierde exactamente (1 mes de depósito, el mes en curso, nada)? Necesito la regla precisa para el ejemplo. **[BLOQUEANTE]**
- **10.4** ¿Apruebas que añada **ejemplos numéricos** tipo "5 noches a $100k → cancelas a >48h: reembolso total; a <48h: pierdes 1 noche"? *(default: sí)*

### 11. Expandir FAQ — `faq.html` (de 6 a ~12 preguntas)
Necesito las respuestas reales a las preguntas nuevas que quiero añadir:
- **11.1** **¿Cuándo recibe el huésped los códigos de acceso?** (hoy la FAQ dice "un día antes" para el link de registro; ¿los códigos llegan también 1 día antes, o tras completar el check-in?) **[BLOQUEANTE]**
- **11.2** **¿Hay soporte/contacto 24/7** o solo en horario? ¿Cuál es el horario de atención? **[BLOQUEANTE]**
- **11.3** **¿Hay algún cargo no incluido** que el huésped deba saber (depósito de garantía, IVA en check-in, aseo, etc.)? Para responder "¿hay cargos ocultos?" con transparencia. **[BLOQUEANTE]**
- **11.4** **¿Aire acondicionado / calefacción?** (Manizales es frío; conviene aclararlo). ¿Qué tienen las unidades exactamente?
- **11.5** ¿Quieres que agregue una pregunta que **enlace a la política de cancelación** completa? *(default: sí)*

### 12. Estadía larga — `vivir.html`
- **12.1** **Criterios de aprobación**: ¿qué se pide realmente? (documento de identidad + entrevista ya se mencionan; ¿también comprobante de ingresos, referencias, depósito?) **[BLOQUEANTE]**
- **12.2** **Tiempo de aprobación**: ¿24h, 48h? ¿Puedo comprometer un SLA?
- **12.3** **Depósito / garantía**: ¿hay? ¿de cuánto (ej. 1 mes)?
- **12.4** **Mascotas con depósito**: ¿de cuánto es el depósito? (hoy está al final; lo subo a "qué incluye"). **[BLOQUEANTE para el monto]**
- **12.5** ¿Renovación automática al pasar de 12 meses? ¿Aplica la tarifa "12+"?

---

## ⚙️ Decisiones transversales

- **T.1** ¿Todos los cambios de copy deben ir **bilingües (ES/EN)** sí o sí? *(default: sí — es regla del proyecto; lo haré en ambos idiomas y en los `/i18n/`)*
- **T.2** **Estructura de PRs:** ¿prefieres **(a)** un PR por fase (3 PRs) *(default propuesto)*, **(b)** un solo PR con todo, o **(c)** un PR por cambio?
- **T.3** ¿Mantengo el **informe (`EVALUACION_CUSTOMER_JOURNEY.md`)** y este documento dentro del repo, o son solo de trabajo y los elimino al final?
- **T.4** ¿Hay algún cambio del plan que **NO** quieras hacer? (para descartarlo desde ya)

---

### Resumen de bloqueantes (lo mínimo para arrancar cada fase)
| Fase | Bloqueantes que necesito de ti |
|---|---|
| 🟥 0 | 1.2 (late check-out), 4.1 (SLA real) |
| 🟧 1 | 6.1 (caso con cifras), 7.1 (precio corporativo), 8.1 (escala grupos) |
| 🟨 2 | 10.1/10.2/10.3 (cancelación), 11.1/11.2/11.3 (FAQ), 12.1/12.4 (vivir) |

Con los **default** ya puedo dejar lista toda la parte de **UX/código sin datos de negocio** (check-out, polling, resumen móvil, badge de carrito, feedback de subida, reutilización de reseñas, ejemplos de cancelación una vez tenga 10.x). Dime y arranco por ahí mientras consigues los bloqueantes.
