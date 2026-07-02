# Plan de marketing + motor de códigos de descuento — Hotel Estar

> Campañas de descuento (a quién, cuándo, qué) + el motor técnico de códigos con
> anti-abuso, respetando la verificación de precio server-side y la Ley 1581.
> Base: workflow `estar-marketing-descuentos` (2026-06-21), auditando el flujo de
> precio/pago real + estrategia hotelera.

## La idea central
La **primera campaña no vende: LEGITIMA**. Hoy no tenemos una base de contactos
con permiso de marketing válido (Ley 1581), así que el primer paso es un **único
mensaje de re-consentimiento** a los ~87 huéspedes históricos, ofreciendo un
cupón a cambio del "Sí". Sin base con opt-in, ninguna otra campaña es legal de
enviar.

**Principio rentable:** la reserva directa cuesta ~4-5% vs **15-30% de comisión
OTA**, así que un descuento directo de hasta ~10% sigue siendo más barato que la
OTA. Pero la mejor jugada es ofrecer **VALOR** (late checkout, early check-in,
desayuno, upgrade) en vez de **PRECIO**, para no romper la paridad de tarifa con
Booking/Airbnb/Expedia. Meta sana de reservas directas: **30-50%**.

**Regla de oro:** todos los códigos quedan **bloqueados por defecto en temporada
alta** (Feria de Manizales, Semana Santa, puentes). En el pico se vende paquete y
anticipación, no descuento.

## A quién (segmentos)
| Segmento | Estado consentimiento | Canal | Jugada |
|---|---|---|---|
| **Histórico sin opt-in (~87)** | ❌ sin permiso marketing | WhatsApp/email (solo el mensaje de re-consentimiento) | Re-consentir con cupón de estreno |
| **Suscriptores newsletter** | ✅ opt-in vigente | Email (+WhatsApp si dio número) | Base limpia para campañas recurrentes |
| **Huésped OTA → directo** | capturar en sitio | QR/check-in + WhatsApp | Que la PRÓXIMA reserva sea directa |
| **Corporativo (B2B)** | requiere opt-in comercial | Email | Tarifa convenio, no cupones públicos |
| **Larga estadía / recurrente** | re-consentir si falta | WhatsApp + email | Premiar permanencia y recompra |
| **Dormido (+12 meses)** | solo si tiene opt-in | WhatsApp + email | Win-back antes de que use OTA |

## Calendario de campañas
1. **Bienvenido de vuelta** *(FUNDACIONAL, va primera)* — re-consentimiento de los ~87 + cupón 12-15% (o noche gratis en 4+ noches). One-shot en temporada media. **KPI:** % de "Sí" (meta ≥30%).
2. **Reserva directo y ahorra** *(evergreen)* — solo en el sitio y material en habitación (QR), **nunca en OTAs**; igualar/quedar 5-8% bajo la OTA tras cupón + perks. **KPI:** share directo, costo de canal.
3. **Gracias por tu estadía** *(disparador)* — 2-3 días post-checkout, código 10% próxima reserva directa (engancha con el correo post-estadía ya existente).
4. **Cumpleaños** *(disparador)* — 10% + cortesía el mes del cumpleaños.
5. **Te extrañamos** *(win-back)* — dormidos +12 meses, 15% o 2ª noche a mitad, cupos limitados.
6. **Llena la temporada baja** — last-minute (<72h) 15-20% o 3x2 entre semana, dom-jue, fuera de puentes.
7. **Semana Santa / puentes** — sin descuento o máx 5-8%; mejor **paquete** (noches + desayuno + late checkout) con mínimo de estadía.
8. **Feria de Manizales** *(4-10 ene 2027)* — **CERO descuento en el pico**; captar anticipado (oct-nov), tarifa garantizada + restringir cupos OTA en el pico.
9. **Preventa Medellín** — tarifa fundador 15-20% a la base directa, antes de abrir en OTAs.

## El motor de códigos (diseño técnico)
Se **injerta en la tubería de precio que ya existe** (no se reinventa nada):
- **Stores (Netlify Blobs):** `discount-codes` (definición de cada código) y `discount-usage` (conteo de usos, idempotente con incremento atómico CAS — el mismo patrón de `_rate-limit.js`, para que dos pagos simultáneos no excedan el cupo).
- **Modelo del código:** tipo (%/monto fijo/noche gratis/extra cortesía), valor, segmento (directo/cotización), vigencia, usos máximos, **un-uso-por-email**, estadía mínima, habitaciones, no acumulable, fechas excluidas (blackout), audit.
- **Validación SIEMPRE en el servidor** — el cliente nunca fija el precio. Se conecta a la **doble defensa que ya existe**:
  1. `create-wompi-signature.js` recalcula el precio CON descuento y **firma el monto final**.
  2. `wompi-webhook.js` **revalida** el descuento antes de crear la reserva (no expirado, no agotado, fechas) → si falla, lo rechaza como `price_mismatch` y no crea reserva.
- El código viaja **como parámetro aparte** (no dentro de la referencia, por el límite de 255 caracteres).
- **Dónde se usa:** Paso 4 del motor de reservas + el visor de cotización (el admin lo ingresa). UI con validación en vivo (`validate-discount-code.js`), sin revelar códigos válidos en los errores.
- **Panel admin** para crear/desactivar códigos (auth `ADMIN_EMAILS`, con audit).

## Anti-abuso (lo que el motor codifica)
- Validación 100% server-side + firma del monto final.
- **Un uso por persona** (código atado al email/teléfono del consentimiento, no transferible).
- **Un descuento por reserva** (no acumulable, no se combina con perks ni convenios).
- Conteo atómico (no se excede el cupo bajo concurrencia) + dedup idempotente.
- Vigencia explícita + caducidad automática.
- **Bloqueo de temporada alta por defecto** en todos los códigos.
- Solo canal directo, nunca publicable en OTAs (paridad).
- No exponer códigos válidos en errores + rate-limit.
- Audit de creación/uso/modificación; revocar un código ante fraude.
- Reembolso: opción admin de "restaurar uso" si se cancela la reserva.
- Marketing solo a contactos con consentimiento Ley 1581 verificable, con baja fácil y prueba (fecha/hora/canal).

## Secuencia de construcción (de menor a mayor riesgo)
0. **Motor base server-side** (sin tocar dinero): store + validación + `validate-discount-code` (solo lectura) + tests.
1. **Panel admin** de códigos (crear/desactivar + audit).
2. **Aplicación en el precio/firma** (el descuento ya cambia el monto firmado) → probar en **sandbox Wompi**.
3. **Defensa en el webhook** (revalida + incrementa uso idempotente) + reembolsos → probar con **una reserva real**.
4. **UI** del campo "Código de descuento" en el motor (ES/EN).
5. **Disparadores evergreen** (post-estadía, cumpleaños, "reserva directo" + QR en habitación).
6. **Campaña fundacional de re-consentimiento** (~87) por WhatsApp con plantilla Meta + botón Sí/No.
7. **Campañas estacionales** y por último **Preventa Medellín**.

## Decisiones para el dueño
- **Cuándo** disparar el re-consentimiento de los ~87 (un mes de temporada media) y el incentivo: **12-15% vs noche gratis en 4+ noches**.
- Aprobar y **registrar en Meta la plantilla de WhatsApp** (toma días) y confirmar que el opt-in cubre el canal WhatsApp.
- **Techo de descuento** directo (recomendado máx 10-15%; preferir valor sobre %).
- Confirmar la **política de paridad** (el diferencial va como perk o precio oculto tras cupón, nunca tarifa pública bajo la OTA).
- Aprobar el **bloqueo por defecto** en Feria/Semana Santa/puentes.
- Publicar los **T&C de los códigos** en el sitio.
- Validar **una reserva real con código** antes de abrir el flujo (mismo gate que el QR de desayuno).
- Para Feria: **cerrar/restringir cupos OTA** en el pico.
- Detalle técnico: si un email usa el código en directo y luego en cotización, ¿cuenta como mismo uso o separado?
