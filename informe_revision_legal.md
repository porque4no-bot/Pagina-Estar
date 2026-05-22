# Informe de Auditoría y Revisión Legal Web
**Proyecto:** portal web de *estar* (Hospedaje Contemporáneo · Manizales, Colombia)  
**Jurisdicción Principal:** República de Colombia  
**Perspectiva:** Legal y Regulatoria (Derecho del Consumidor, Protección de Datos, Ley de Turismo y Normativa Inmobiliaria)

---

## Introducción

Este documento presenta una revisión jurídica y análisis de cumplimiento normativo del portal web de **estar** (operado bajo el **Registro Nacional de Turismo RNT 276306**). El examen abarca tanto los textos legales explícitos (*Aviso Legal, Política de Cancelación, Privacidad, Cookies y Protección de Menores*) como los flujos de captura de datos personales y comerciales en formularios interactivos.

El objetivo es mitigar riesgos de sanciones administrativas por parte de la **Superintendencia de Industria y Comercio (SIC)** de Colombia, la **Fiscalía General de la Nación** u otros entes de control, garantizando al mismo tiempo una óptima experiencia de usuario sin perder la estética y tono del sitio.

---

## 1. Advertencias Críticas (Riesgo Alto y Medio)

### A. Ausencia de Consentimiento para Tratamiento de Datos (Habeas Data — Ley 1581 de 2012)
> [!WARNING]
> **Riesgo Fuerte de Sanción (SIC)**  
> En Colombia, recolectar datos personales sin autorización expresa, previa e informada está prohibido y acarrea multas severas de hasta 2,000 SMMLV. 

Se detectó que varios formularios del sitio capturan datos personales (nombres, correos, números de teléfono y requerimientos especiales) sin ningún mecanismo de consentimiento:
1. **Formulario Corporativo (`empresas.html`):** Captura datos de contacto y detalles empresariales sin casilla de aceptación de política de privacidad.
2. **Formulario de Grupos (`grupos.html`):** Recolecta información sobre organizadores, eventos y huéspedes sin casilla de aceptación de Habeas Data.
3. **Formulario de Larga Estancia (`vivir.html`):** Solicita nombres, correos, motivos de viaje e historial del solicitante sin casilla de Habeas Data.
4. **Formulario de Suscripción al Boletín (`index.html` - Newsletter):** Recolecta correos para fines de marketing directo sin informar al usuario ni obtener su consentimiento.
*Nota: Solo los formularios de `contacto.html` y `trabaja.html` cuentan actualmente con las casillas de aceptación de políticas correspondientes.*

### B. Omisión de la Advertencia ESCNNA en Home y Booking (Ley 679 de 2001 & Ley 1336 de 2009)
> [!IMPORTANT]
> **Requisito Legal Obligatorio en Colombia**  
> El artículo 17 de la Ley 679 de 2001 y el Decreto 3840 de 2009 exigen a todos los prestadores de servicios turísticos y sus intermediarios incluir el texto de advertencia contra la explotación sexual comercial de menores de edad (ESCNNA) de forma visible tanto en el establecimiento como en sus medios de difusión digitales (páginas web y motores de reserva).

Aunque el sitio cuenta con la página dedicada `escnna.html` y un enlace en el footer, la norma exige que la advertencia textual literal sea **visible de manera clara y permanente** en la página de inicio o en la sección de reservas. Limitarse a un enlace en el footer puede considerarse incumplimiento y dar lugar a multas y suspensiones del RNT.

### C. Identificación Jurídica Incompleta en los Documentos Legales (Art. 50 de la Ley 1480 de 2011)
> [!IMPORTANT]
> **Transparencia en el Comercio Electrónico**  
> El Estatuto del Consumidor de Colombia exige que el portal web de comercio electrónico identifique claramente la razón social o nombre completo del operador, su número de identificación tributaria (NIT) o documento de identidad, dirección física y canales de atención.

Los documentos `aviso-legal.html` y `privacidad.html` se refieren al operador simplemente como "**estar**". Desde el punto de vista legal, "estar" es una marca comercial. Es obligatorio especificar la persona jurídica o natural que respalda la operación (por ejemplo: *Operadora de Hospedaje Estar S.A.S.* o el nombre de su propietario persona natural) junto con su **NIT**.

### D. Vulnerabilidad en Contratos de Larga Estancia (Ley 820 de 2003 vs. Hospedaje Turístico)
> [!CAUTION]
> **Riesgo Inmobiliario y Contractual**  
> Si las estancias mensuales (sección "Vivir en estar") se estructuran o redactan como un arrendamiento de vivienda tradicional, el negocio se somete a la Ley 820 de 2003 (Ley de Arrendamiento de Vivienda Urbana).

Bajo la Ley 820 de 2003:
1. El artículo 16 **prohibe estrictamente exigir depósitos de garantía en dinero** para asegurar obligaciones contractuales. En la página `cancelacion.html` se indica que *"el depósito de garantía (...) será retenido en caso de salida anticipada"*, lo cual es nulo e ilegal bajo un arrendamiento residencial ordinario.
2. Los procesos de restitución (desalojo) de vivienda urbana en Colombia pueden demorar meses o años debido al marco legal protector del inquilino.
*Recomendación:* La redacción contractual y la información de la web deben blindarse bajo la figura de **Hospedaje Turístico o Co-Living** (sujeto a las normas comerciales de alojamiento turístico) en lugar de un arrendamiento residencial clásico, aclarando que el servicio no constituye una residencia permanente regida por la Ley 820.

### E. Ausencia de Aviso y Gestión de Cookies (Guías de la SIC y estándares internacionales)
> [!NOTE]
> Aunque las cookies técnicas (idioma, tema visual) no requieren consentimiento previo estricto bajo el criterio de necesidad, la existencia de cookies de analítica comercial y la captación de tráfico internacional (especialmente de Europa sujeto a GDPR) requiere un aviso de cookies con opción de aceptación/rechazo para evitar incidentes legales internacionales.

---

## 2. Sugerencias de Modificación y Plan de Acción

A continuación, se detallan las correcciones propuestas en el código HTML de cada página afectada para solventar los riesgos identificados.

### Modificación 1: Añadir casillas de consentimiento Habeas Data

En los siguientes formularios se debe integrar una casilla de verificación idéntica a la que ya funciona en `contacto.html`.

#### Formulario Corporativo (`empresas.html`)
Añadir la casilla de verificación antes del botón de envío (`<button type="submit"...`):

```html
<!-- En empresas.html - Línea aprox. 164 -->
<label class="form-checkbox" style="display: flex; align-items: flex-start; gap: var(--space-3); cursor: pointer; font-family: var(--font-body); font-size: 13px; color: var(--fg-muted); margin: var(--space-2) 0;">
  <input type="checkbox" required style="margin-top: 3px; cursor: pointer;">
  <span>
    <span class="lang-es">Acepto la <a href="privacidad.html" target="_blank" style="color: var(--terracotta); text-decoration: underline;">Política de Privacidad</a> e información de Habeas Data corporativo.</span>
    <span class="lang-en">I accept the <a href="privacidad.html" target="_blank" style="color: var(--terracotta); text-decoration: underline;">Privacy Policy</a> and corporate Habeas Data terms.</span>
  </span>
</label>
```

#### Formulario de Grupos (`grupos.html`)
Añadir la casilla de verificación antes del botón de envío:

```html
<!-- En grupos.html - Línea aprox. 226 -->
<label class="form-checkbox" style="display: flex; align-items: flex-start; gap: var(--space-3); cursor: pointer; font-family: var(--font-body); font-size: 13px; color: var(--fg-muted); margin: var(--space-2) 0;">
  <input type="checkbox" required style="margin-top: 3px; cursor: pointer;">
  <span>
    <span class="lang-es">Acepto el tratamiento de mis datos personales para cotización según la <a href="privacidad.html" target="_blank" style="color: var(--terracotta); text-decoration: underline;">Política de Privacidad</a>.</span>
    <span class="lang-en">I accept the processing of my personal data for quoting per the <a href="privacidad.html" target="_blank" style="color: var(--terracotta); text-decoration: underline;">Privacy Policy</a>.</span>
  </span>
</label>
```

#### Formulario de Larga Estancia (`vivir.html`)
Añadir la casilla de verificación antes del botón de envío:

```html
<!-- En vivir.html - Línea aprox. 163 -->
<label class="form-checkbox" style="display: flex; align-items: flex-start; gap: var(--space-3); cursor: pointer; font-family: var(--font-body); font-size: 13px; color: var(--fg-muted); margin: var(--space-2) 0;">
  <input type="checkbox" required style="margin-top: 3px; cursor: pointer;">
  <span>
    <span class="lang-es">Acepto la verificación de perfil y la <a href="privacidad.html" target="_blank" style="color: var(--terracotta); text-decoration: underline;">Política de Privacidad</a>.</span>
    <span class="lang-en">I accept profile verification and the <a href="privacidad.html" target="_blank" style="color: var(--terracotta); text-decoration: underline;">Privacy Policy</a>.</span>
  </span>
</label>
```

#### Formulario de Suscripción/Boletín (`index.html`)
Bajo la ley colombiana, el envío de correos electrónicos promocionales requiere consentimiento previo. Se propone rediseñar el formulario del Newsletter para incluir el aviso legal abreviado de Habeas Data:

```html
<!-- En index.html - Línea aprox. 604 -->
<form data-reveal onsubmit="event.preventDefault(); this.querySelector('input').value=''; this.querySelector('button').textContent='Gracias ✶';" style="display: flex; flex-direction: column; gap: var(--space-3);">
  <div style="display: flex; gap: 8px;">
    <input type="email" placeholder="tu@correo.com" required style="flex: 1; padding: 12px; border: 1px solid var(--border); border-radius: 4px; background: var(--paper-200); color: var(--fg);">
    <button type="submit" style="padding: 12px 24px; background: var(--fg); color: var(--paper); border: none; border-radius: 4px; cursor: pointer;">Suscribirme <span aria-hidden="true">→</span></button>
  </div>
  <p style="font-size: 11px; color: var(--fg-subtle); margin: 0; line-height: 1.4;">
    <span class="lang-es">Al suscribirte autorizas el uso de tu correo bajo nuestra <a href="privacidad.html" target="_blank" style="text-decoration: underline; color: inherit;">Política de Privacidad</a>.</span>
    <span class="lang-en">By subscribing you authorize email usage under our <a href="privacidad.html" target="_blank" style="text-decoration: underline; color: inherit;">Privacy Policy</a>.</span>
  </p>
</form>
```

---

### Modificación 2: Integrar el aviso ESCNNA en el flujo de Reserva

Para cumplir rigurosamente con la Ley 679 de 2001, se recomienda agregar una banda o alerta legal directamente debajo del formulario del buscador de reservas en la página principal (`index.html`). Esto demuestra de forma irrefutable que el aviso se despliega a todo cliente potencial antes de concretar la reserva.

Propuesta estética e informativa para agregar justo debajo de la etiqueta `</form>` del booking-bar:

```html
<!-- En index.html - Línea aprox. 113 (abajo del </form> de booking-bar) -->
<div class="escnna-inline-notice" style="width: 100%; text-align: center; margin-top: var(--space-4); font-size: 11px; line-height: 1.4; color: var(--fg-muted); padding: 8px 12px; border-top: 1px dashed var(--border);">
  <span class="lang-es">
    ✶ <strong>Prevención ESCNNA:</strong> En cumplimiento de la Ley 679 de 2001, advertimos que la explotación y el abuso sexual de menores de edad son sancionados penal y administrativamente. <a href="escnna.html" target="_blank" style="color: var(--terracotta); text-decoration: underline;">Ver normatividad y canales de denuncia</a>.
  </span>
  <span class="lang-en">
    ✶ <strong>Minor Protection:</strong> In compliance with Law 679 of 2001, we warn that child sexual exploitation and abuse are criminally and administratively punished. <a href="escnna.html" target="_blank" style="color: var(--terracotta); text-decoration: underline;">Read regulations and report hotlines</a>.
  </span>
</div>
```

---

### Modificación 3: Robustecer los Textos de las Políticas

#### A. En `aviso-legal.html` y `privacidad.html`
Actualizar la Sección 1 (Información General / Responsable) para detallar la información mercantil del propietario del RNT:

*Ejemplo de redacción corregida (Español):*
> **1. Información General / Responsable del Tratamiento**  
> En cumplimiento con la Ley 1480 de 2011 (Estatuto del Consumidor), las disposiciones vigentes del comercio electrónico y las leyes de turismo colombianas, se informa que este sitio web es operado por **[INSERTAR RAZÓN SOCIAL / NOMBRE COMPLETO PROPIETARIO]**, prestador de servicios turísticos identificado bajo el **NIT [INSERTAR NIT / CÉDULA]** y con Registro Nacional de Turismo número **RNT 276306**. Dirección física del establecimiento: Sector Palogrande, Manizales, Caldas, Colombia. Correo de contacto: reservas@hotelestar.com.

#### B. En `cancelacion.html` (Sección 3 - Vivir en estar)
Para evitar que se asimile a un contrato residencial urbano prohibido por la Ley 820 de 2003, se debe aclarar la naturaleza hotelera/comercial de la estancia prolongada.

*Redacción sugerida (Español):*
> **3. Estancias Prolongadas ("Vivir en estar")**  
> Los servicios de estancias prolongadas corresponden a la modalidad de **alojamiento turístico de larga estancia** y se rigen bajo las normas mercantiles aplicables al contrato de hospedaje (Código de Comercio de Colombia), sin constituir un contrato de arrendamiento de vivienda urbana bajo la Ley 820 de 2003. El huésped acepta que el uso del apartaestudios es transitorio, no residencial, y que las garantías exigidas corresponden a la cobertura de consumos adicionales, daños y servicios complementarios asociados a la hospitalidad.

#### C. En `privacidad.html` (Protección de datos de menores)
Dado que la web trata con menores de edad para su registro hotelero legal (conforme a la Ley 679 de 2001), la Política de Privacidad debe hacer mención explícita al cumplimiento del artículo 7 de la Ley 1581 de 2012:

*Cláusula sugerida para adicionar:*
> **5. Tratamiento de Datos de Niños, Niñas y Adolescentes (NNA)**  
> En **estar** velamos por el respeto a los derechos prevalentes de los menores de edad. Solo recolectamos y tratamos datos personales de niños, niñas y adolescentes con el fin estricto de cumplir con la Tarjeta de Registro Hotelero obligatoria exigida por el Ministerio de Comercio, Industria y Turismo, y siempre bajo la autorización del padre, madre o tutor legal al momento del check-in. Nos abstenemos de utilizar estos datos para fines comerciales o de mercadeo.

---

## 3. Conclusión y Próximos Pasos

El sitio web actual posee una excelente arquitectura de información legal, pero se encuentra en una situación de **vulnerabilidad regulatoria activa** debido a la falta de casillas de verificación de Habeas Data en 4 formularios clave y a la falta de exposición de la advertencia literal ESCNNA exigida por la Ley de Turismo colombiana en zonas de alto tráfico (Home/Booking).

### Recomendación de Implementación
Se sugiere proceder con la adición de los checkboxes obligatorios de Habeas Data en los formularios descritos y la integración del aviso inline ESCNNA en `index.html`. Estos cambios no afectan la interfaz general y garantizan un blindaje jurídico sólido frente a la SIC.

---
*Fin del Informe Legal*
