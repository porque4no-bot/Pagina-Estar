# ✅ Pendientes por revisar — Hotel Estar

> Lista de lo que queda **de tu lado** (negocio / fundadores). Lo técnico ya está implementado y probado.
> Detalle de cada pregunta en `DUDAS_IMPLEMENTACION.md`. Marca `[x]` lo que vayas resolviendo.

Última actualización: 2026-06-12 · Estado: Fase 0 y Fase 1 implementadas · Fase 2 pendiente.

---

## 1. 🔴 Fase 2 — Políticas (a revisar con los fundadores)

Estas requieren la política real antes de poder escribirlas en la web. No las toqué.

### Cancelación (`cancelacion.html`)
- [ ] **10.1** Penalidad por no-show: ¿exactamente 1 noche o un % del total?
- [ ] **10.2** Plazo real de reembolso (hoy dice "5–15 días"). ¿Lo fijamos en "7–10 días hábiles"?
- [ ] **10.3** Salida anticipada en estadía larga (aviso de 30 días): ¿qué pierde el huésped exactamente?
- [ ] **10.4** Aprobar que agregue ejemplos numéricos de reembolso.

### FAQ (`faq.html`) — respuestas reales para ampliar de 6 a ~12 preguntas
- [ ] **11.1** ¿Cuándo recibe el huésped los códigos de acceso (1 día antes / al completar check-in)?
- [ ] **11.2** ¿Hay soporte 24/7 o solo en horario? ¿Cuál es el horario oficial?
- [ ] **11.3** ¿Hay cargos no incluidos (depósito de garantía, IVA en check-in, aseo)?
- [ ] **11.4** ¿Las unidades tienen aire acondicionado / calefacción? (Manizales es frío)
- [ ] **11.5** Aprobar agregar una pregunta que enlace a la política de cancelación.

### Estadía larga (`vivir.html`)
- [ ] **12.1** Criterios reales de aprobación (¿ingresos, referencias, depósito?)
- [ ] **12.2** Tiempo de aprobación (¿24h / 48h?) — ¿podemos comprometer un SLA?
- [ ] **12.3** ¿Hay depósito / garantía? ¿de cuánto?
- [ ] **12.4** Monto del depósito de mascotas (hoy solo dice "con depósito")
- [ ] **12.5** ¿Renovación automática al pasar de 12 meses?

---

## 2. 🟠 Contenido a aportar (mejora lo ya implementado)

- [ ] **Reseñas por persona (5.2):** cuando extraigas de Booking reseñas específicas para cada perfil
      (empresa, grupos, estadía larga), me las pasas y reemplazo las generales que dejé.
      Hoy hay un `<!-- TODO (5.2) -->` en cada sección de reseñas de `empresas/grupos/vivir`.
- [ ] **Caso de éxito con cifras (empresas):** si quieres, un dato concreto de un cliente
      (ej. "Hospital de Caldas — N residentes/trimestre") para reforzar la sección.
- [ ] **Testimonios propios opcionales:** un quote real de un CFO / médico residente / organizador de evento.

---

## 3. 🟡 A verificar / confirmar de lo ya implementado

- [ ] **Tarifas de empresas:** publiqué los mismos precios de la home (Clásica $220k · Selección $265k ·
      Reserva $320k · Origen $385k · Especial $450k). **Confirma que son los vigentes.**
      ⚠️ Si cambian en la home, hay que actualizarlos también en `empresas.html` (lo dejé marcado con un
      comentario en el código).
- [ ] **Mensaje "hasta 15% por convenio" y "hasta 30% por persona en grupos":** confirmar que los topes
      son correctos comercialmente.
- [ ] **Nota de contratación directa (anti-broker):** revisar el tono del texto en `empresas.html`
      por si quieres suavizarlo.
- [ ] **Anticipo de grupos 50% + bloqueo solo con >1 semana de anticipación:** confirmar.

---

## 4. 🔧 Configuración en Netlify (sin código, opcional)

Heredado de la auditoría previa (`AUDITORIA_360_HOTEL_ESTAR.md`). Sin esto todo funciona; solo no se envían esas señales:
- [ ] `GA4_API_SECRET` — conversiones server-side
- [ ] `META_PIXEL_ID` / `GOOGLE_ADS_ID` — remarketing (solo si quieres activarlo)
- [ ] `PROXY_URL` — confirmar que apunta al scraper de Booking (alimenta el rating en vivo de las reseñas)

---

## 5. 👀 Revisión visual (recomendada antes de fusionar el PR)

- [ ] Abrir el **deploy preview de Netlify** del PR #79 y revisar:
  - [ ] Barra de resumen/total **en móvil** dentro del motor de reserva (`reservar.html`)
  - [ ] Sección de **reseñas** en empresas / grupos / vivir (ES y EN)
  - [ ] **Tarifas** en `empresas.html` (responsive en móvil: la grilla de 5 columnas)
  - [ ] Texto del **late check-out (5 p. m. / $60.000)** y **check-out 11:00** coherentes

---

### Estado técnico (referencia, ya cerrado)
- ✅ Fase 0: check-out 11:00 · late check-out 5pm/$60k · polling · resumen móvil · SLA
- ✅ Fase 1: tarifas y copy empresas · descuentos grupos · reseñas B2B · guest app (badge + confirmación documento)
- ✅ Pruebas: 156/156 unit · estructura · build · e2e (CI) · smoke — todo verde
