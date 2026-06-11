# 🧭 Evaluación de Customer Journey — Hotel Estar

**Fecha:** 2026-06-11
**Alcance:** Recorrido de la web pública por *personas* de cliente (no técnico/seguridad — eso está cubierto en `AUDITORIA_360_HOTEL_ESTAR.md`).
**Lente:** UX, copy, conversión, confianza y claridad de proceso a lo largo del funnel.
**Modo:** Solo diagnóstico. No se modificó ningún archivo del producto.

> **Veredicto:** La web es **madura, honesta y con marca fuerte**. Destacan la prueba social en el hero, el manejo de "sin disponibilidad" en el motor, la transparencia del IVA y la página `vivir.html` (única con precios publicados). Las falencias son sobre todo de **conversión B2B** (precios ocultos, sin testimonios), **consistencia de datos** (horarios de check-out contradictorios) y **feedback en el journey post-reserva** (sin SLA ni confirmaciones de subida). Ninguna bloquea la operación; varias son arreglos de bajo esfuerzo y alto impacto.

---

## 0. Personas evaluadas

| # | Persona | Páginas del journey |
|---|---|---|
| P1 | Turista de ocio | `index.html` → `clasica.html` / `explora.html` → `reservar.html` (motor) |
| P2 | Viajero de negocios / Empresa | `empresas.html` → `cotizacion.html` |
| P3 | Organizador de grupos | `grupos.html` |
| P4 | Nómada digital / estadía larga | `vivir.html` |
| P5 | Huésped post-reserva | `guest.html`, `faq.html`, `contacto.html`, `nosotros.html`, `cancelacion.html`, `privacidad.html`, `escnna.html` |

---

## 1. Hallazgos transversales (afectan a todas las personas)

### 🔴 Inconsistencia de horario de check-out
- `index.html` structured data: `"checkoutTime": "12:00"` (mediodía) (`index.html:60`).
- `faq.html`: *"check-out es hasta las 11:00 AM"* (`faq.html:31` y `:129`).
- **Impacto:** Google muestra el dato estructurado (mediodía) mientras la FAQ dice 11:00. Fricción real el día de salida y señal de SEO contradictoria. **Unificar a una sola hora.** (check-in 15:00 sí es consistente en todas las páginas).

### 🟠 Precios ocultos en los segmentos de mayor ticket (B2B)
- `empresas.html` solo dice *"Hasta 25% bajo tarifa pública"* (`empresas.html:105`) sin tarifa base.
- `grupos.html` menciona *"descuentos preferenciales... +4 unidades"* (`grupos.html:194`) sin escala.
- `vivir.html` **sí** publica matriz completa por tipología y tramo (1-2 / 3-5 / 6-11 / 12+ meses) → es el patrón a replicar.
- **Impacto:** El B2B abandona o difiere la decisión cuando no hay ancla de precio. Un "desde $X corporativo/noche" reduce la fricción sin comprometer la negociación final.

### 🟠 Ausencia de testimonios (solo números)
- Hay prueba social cuantitativa fuerte (Booking 9.0 · 126 reseñas, Superhost, RNT 276306) en el hero y `nosotros.html`, pero **ningún quote de cliente** en toda la web.
- Empresas lista logos (Universidad Nacional, Hospital de Caldas, Sura...) pero **sin caso de éxito narrativo ni cifra de ahorro**.
- **Impacto:** El número "9.0" es estático; un testimonio con nombre/cara convierte mejor, especialmente en `empresas`, `grupos` y `vivir` (estos dos últimos sin ninguna prueba social).

### 🟡 SLA de respuesta inconsistente
- "Menos de 24 horas" aparece en empresas/grupos/vivir/contacto, pero **no** en el panel Concierge de `guest.html` ni en el formulario de `contacto.html` (sin feedback post-envío).
- **Impacto:** El huésped que ya está dentro (mayor valor) es quien tiene menos certeza de cuándo le responden.

---

## 2. P1 — Turista de ocio

**Fortalezas**
- Hero con propuesta clara ("Un lugar para estar"), precio visible ("Desde $200.000 / noche") y **3 sellos de confianza** inmediatos: Booking 9.0/126, Superhost, RNT.
- Barra de reserva fija con 3 campos + "Ver precios y disponibilidad" → CTA siempre accesible.
- "✓ Cancelación gratuita hasta 48h antes" en el hero → reduce fricción psicológica.
- **Motor (`reservar.html`):** 4 pasos claros, IVA transparente y *educativo* según nacionalidad/motivo, y un **excelente manejo de "sin disponibilidad"** (botón "Buscar 1 semana después" + fallback WhatsApp) que evita el abandono total.
- `explora.html`: mapa + ~34 POI curados → diferenciador real frente a Airbnb (rol de anfitrión/concierge).

**Fricciones**
- **Resumen del carrito desaparece en móvil** (`.be-summary-col` oculto <960px): el huésped llena el formulario sin ver el total. *Alto impacto en checkout móvil.*
- **Draft solo en `sessionStorage`** (TTL 30 min): cambiar de app en el móvil puede perder los datos del formulario.
- **Polling de confirmación sin "puedes cerrar la ventana"**: si el huésped cierra durante los hasta 60s de polling, no sabe si reservó → riesgo de doble reserva.
- Múltiples CTAs "Reservar" en home (tarjetas + tabla comparadora) con **idéntica jerarquía visual** ("Ver detalles" vs "Reservar" se ven igual).
- `explora.html`: el CTA "Reserva tu estadía" queda al final; falta un CTA sticky tras explorar.
- Aviso ESCNNA en el hero (`index.html:287`) es legalmente correcto pero pesa visualmente para el visitante casual.

---

## 3. P2 — Viajero de negocios / Empresa

**Fortalezas**
- Propuesta muy bien posicionada: *"No somos una agencia de viajes. Somos los anfitriones"* + 3 pilares (facturación centralizada, tarifas pre-negociadas, account manager).
- **Logo strip con instituciones reales** y casos de uso concretos ("Hospital de Caldas — 18 residentes/trimestre").
- Formularios de baja fricción con placeholders guía y checkbox de crédito 30 días preseleccionado.

**Fricciones**
- **Sin precio ancla** (ver §1).
- "Portal B2B activo en una semana" y "compatible con SAP/Odoo/QuickBooks" sin explicar qué es el portal ni cómo es la integración.
- Casos = listas, no narrativas con cifras ("¿cuánto ahorró el Hospital de Caldas?").
- Política de cancelación corporativa vaga en `cotizacion.html` ("48 horas" sin más detalle).

---

## 4. P3 — Organizador de grupos

**Fortalezas**
- Segmentación clara ("De 4 a 13 unidades", edificio exclusivo) y proceso en 3 pasos (cotizar <24h → bloqueo+anticipo → rooming list + accesos digitales).
- Selector de motivo (boda, retiro, evento académico, deportivo, audiovisual) que ayuda a la calificación comercial.

**Fricciones**
- **El segmento con menos confianza:** sin precios, sin casos, sin testimonios, sin cifra de volumen ("X grupos alojados").
- "Bloqueo preventivo 48h sin compromiso" no aclara si requiere depósito ni cómo se comunica.
- Segundo método de pago del anticipo ("enlace de pago seguro") sin especificar.

---

## 5. P4 — Nómada digital / estadía larga (`vivir.html`)

**La página mejor resuelta del sitio.**

**Fortalezas**
- **Precios 100% publicados** por tipología y 4 tramos, con ahorro etiquetado ("Más pedido — 34%").
- Diferenciadores potentes: "sin fiadores ni codeudores", aprobación 100% digital, "internet de fibra dedicado por unidad — no compartido".
- "Todo incluido en un pago mensual" detallado (servicios, mobiliario, escritorio ergonómico).

**Fricciones**
- **Criterios de aprobación opacos**: no dice requisitos (ingresos/referencias), tiempo ni tasa de aprobación.
- Sin calendario de disponibilidad real; el formulario es "propuesta", no reserva confirmada.
- "Mascotas bienvenidas con depósito" enterrado al final; debería estar en "qué incluye".
- Sin prueba social (ningún testimonio de médico residente / nómada / corporativo).

---

## 6. P5 — Huésped post-reserva

**Fortalezas**
- Acceso a la guest app de baja fricción (código + apellido) con fallback WhatsApp.
- Check-in digital en 3 pasos con OCR, contrato digital con seguimiento de scroll + firma, y seguridad **comunicada explícitamente** ("no publicamos llaves de Azure ni OTASync en el navegador").
- `nosotros.html`: historia creíble con fundadores y equipo nombrados → confianza humana, no corporativa anónima.
- Políticas legales sólidas: `escnna.html` (9/10, muy claro y accionable con canales de denuncia), `privacidad.html` (derechos Habeas Data claros, responsable trazable).

**Fricciones**
- **Sin feedback de subida de documentos**: tras subir, no hay "documento recibido". El huésped no sabe si funcionó.
- **Carrito de servicios sin badge de cantidad**: se olvida lo añadido.
- **Sin SLA** en Concierge ni en `contacto.html` (ni confirmación visual de envío de formulario).
- Requisitos de menores (registro civil + autorización notariada) **se descubren tarde**, dentro del check-in.
- `cancelacion.html` (6/10): penalidad por no-show ambigua, reembolso "5–15 días hábiles" (rango ancho que genera ansiedad), regla de Extended Stay confusa; **faltan ejemplos numéricos**.
- `faq.html`: solo 6 preguntas; no cubre "¿qué pasa tras el check-in?", "¿cargos ocultos?", "¿soporte 24/7?" ni enlaza a `cancelacion.html`.
- Tono ESCNNA durante el check-in puede leerse como acusatorio para el huésped honesto.

---

## 7. Plan de mejora priorizado

### Quick wins (alto impacto / bajo esfuerzo)
| # | Acción | Página(s) | Por qué |
|---|---|---|---|
| 1 | Unificar check-out (11:00 vs 12:00) | `index.html:60`, `faq.html` | Elimina contradicción de cara al huésped y a Google |
| 2 | Mostrar resumen/total sticky en móvil durante el checkout | `reservar.html` / `motor-app.jsx` | Evita "sorpresa de precio" y abandono móvil |
| 3 | Texto "Puedes cerrar — te enviaremos el email" en el polling | `motor-app.jsx` (paso 4) | Previene doble reserva / ansiedad |
| 4 | SLA explícito ("respondemos en <24h") + confirmación de envío | `guest.html` Concierge, `contacto.html` | Reduce incertidumbre post-envío |
| 5 | Feedback "✓ Documento recibido" tras subir | `guest.html` / `guest-app.js` | Confirma éxito del check-in |
| 6 | Badge de cantidad en el carrito de servicios | `guest.html` | Evita olvidos / sube upsell |

### Esfuerzo medio / alto retorno
| # | Acción | Página(s) | Por qué |
|---|---|---|---|
| 7 | Publicar **precio ancla** corporativo y escala de descuento por unidades | `empresas.html`, `grupos.html` | Desbloquea decisión B2B |
| 8 | Añadir **testimonios reales** (CFO, médico residente, organizador) | `empresas`, `grupos`, `vivir`, `nosotros` | Convierte donde hoy solo hay números/logos |
| 9 | Criterios + SLA + tasa de aprobación de estadía larga | `vivir.html` | Cierra el principal vacío de la mejor página |
| 10 | Ejemplos numéricos de reembolso + acotar a "7–10 días hábiles" | `cancelacion.html` | Elimina ansiedad y consultas repetidas |
| 11 | Expandir FAQ a ~12 preguntas y enlazar a cancelación | `faq.html` | Reduce contactos post-reserva |
| 12 | Persistir borrador del motor más allá de `sessionStorage` | `motor-app.jsx` | Recupera carritos móviles abandonados |
| 13 | CTA sticky "¿Listo para tu viaje?" tras explorar | `explora.html` | Reconecta exploración → reserva |

---

## 8. Síntesis

| Dimensión | Nota | Comentario |
|---|---|---|
| Marca y tono | 9/10 | Cálido, local, humano; "estar" como verbo |
| Confianza (B2C) | 8.5/10 | Sellos fuertes; falta testimonio cualitativo |
| Confianza (B2B) | 6/10 | Logos sí, casos/cifras/precio no |
| Motor de reserva | 8/10 | Robusto; fricciones de carrito/polling en móvil |
| Claridad de precios | 7/10 | Excelente en `vivir`, opaca en B2B |
| Journey post-reserva | 6.5/10 | Buena app; faltan SLA y confirmaciones |
| Claridad de políticas | 7/10 | Sólidas; cancelación con ejemplos faltantes |
| Consistencia de datos | 6/10 | Horario de check-out contradictorio |

**Si solo se hicieran 3 cosas:** (1) unificar el check-out, (2) precio ancla + testimonios en B2B, (3) SLA y confirmaciones en el journey post-reserva. Son las tres que más mueven conversión y satisfacción con el menor esfuerzo.
