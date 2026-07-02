# Guía de estilo y diseño — Hotel estar

> Documento para **reseñar y mantener** el estilo visual del sitio web de estar.
> Describe en lenguaje claro cómo se ve la marca, de dónde sale cada decisión y
> qué reglas seguir para que todo se mantenga coherente.
>
> **Fuentes reales (no inventar valores):**
> - Tokens (colores, tipografía, espaciado): `colors_and_type.css`
> - Componentes (botones, header, hero, tarjetas, footer…): `styles.css`
> - Correos: `netlify/functions/_email.js` (ver [`docs/...`] y la memoria *correos-rediseño*)
>
> Regla de oro del proyecto: **nunca uses un color "a mano"** (ej. `#9b9065`
> suelto). Siempre por token (`var(--olive)`). Así un cambio de marca se hace en
> un solo archivo.

---

## 1. El lenguaje visual en una frase

**Apartaestudios boutique, editorial y cálido:** paleta tierra (olivo, arena,
barro), titulares en **mayúsculas** de palo seco contrastados con **cuerpo en
serif** elegante, mucho aire (espacios generosos), diseño **plano** apoyado en
color y líneas finas (casi sin sombras), y un **motivo de estrella** que aparece
como sello de marca, cursor y separador. Sensación: tranquilo, premium,
artesanal — no corporativo, no llamativo.

---

## 2. Paleta de color

Cuatro colores de marca + neutros. Cada uno tiene variantes (700 = más oscuro,
300 = más claro, 100 = muy claro), pensadas para fondos, hover y bordes.

| Token | Hex | Qué es | Dónde se usa |
|---|---|---|---|
| `--olive` | `#9b9065` | **Primario** — verde estar | Fondos de marca, banda de "reserva confirmada", botón "abrir app", sellos |
| `--sand` | `#c4ab8f` | **Secundario** — taupe / arena | Fondos suaves, banda de pre-llegada, botones secundarios |
| `--terracotta` | `#af6d3b` | **Acento** — barro | Botón principal (CTA), enlaces, estrella separadora, alertas/urgencia |
| `--ink` | `#28292b` | Texto y lienzo oscuro | Texto principal, header al hacer scroll, footer, botón oscuro |
| `--paper` | `#faf6ef` | Fondo de página — blanco cálido | Fondo general, encabezado de correos, tarjetas |
| `--white` | `#ffffff` | Blanco puro | Tarjetas, texto sobre color |

**Variantes clave:** `--olive-700 #7d7350`, `--olive-300 #b8ad86`,
`--terracotta-700 #8a5128` (enlaces/hover), `--sand-700 #a98c6a`,
`--paper-200 #f1ebe0` (tarjetas), `--paper-400 #e1d8c8` (líneas/divisores),
`--ink-500 #6b6c6f` (texto secundario), `--ink-300 #b8b9bb` (texto sutil).

**Semánticos (lo que de verdad se usa en el código):** `--bg`, `--bg-muted`,
`--bg-brand` (olivo), `--bg-accent` (barro), `--fg` (texto), `--fg-muted`,
`--border`. Editar estos cambia el sitio entero sin tocar componentes.

**Estados:** `--error #ffb4ab` / `--error-700 #c75444` · `--success #6e7c4a`
(éxito con tinte olivo, no verde genérico).

> **Reseña:** paleta muy bien resuelta y coherente con un hotel de montaña en
> Manizales. El barro (terracota) como único color "fuerte" para los CTA es un
> acierto: guía el ojo sin romper la calma. Riesgo a vigilar: el olivo sobre
> arena tiene poco contraste — reservarlo para bloques grandes, no para texto
> pequeño.

---

## 3. Tipografía

**Dos familias, roles opuestos a propósito:**

| Familia | Token | Rol | Carácter |
|---|---|---|---|
| Arial / Helvetica (palo seco) | `--font-heading` / `--font-display` / `--font-label` | Titulares, etiquetas, botones | **SIEMPRE EN MAYÚSCULAS**, peso 700–900, interletraje negativo |
| Libre Baskerville (serif) | `--font-body` | Cuerpo, frases destacadas, citas | Editorial, **itálica** para "lead" y citas |

**Decisión de marca importante:** *todos* los encabezados (`h1`–`h6`,
`.display-*`, `.t-h*`, `.hero-title`) van en **mayúsculas** por CSS. Lo único que
rompe la mayúscula a propósito es la serif en itálica (`.serif-italic`,
`.italic`) — el contraste mayúscula-dura / itálica-suave es la firma tipográfica.

**Escala (responsive con `clamp`):**

| Estilo | Tamaño | Uso |
|---|---|---|
| `--fs-display` / `.display-xl` | 48–124px | Héroes, número grande |
| `--fs-h1` / `.display-l` | 28–84px | Títulos de sección |
| `.display-m` | 32–56px | Subtítulos grandes |
| `--fs-h2` | 32px | Encabezados |
| `--fs-h3` / `.t-h3` | 24px | Sub-encabezados |
| `--fs-body` / `.t-body` | 16px (línea 1.7) | Párrafos (serif), máx. 64 caracteres de ancho |
| `.lead` / `.t-lead` | 18–22px itálica | Entradilla |
| `--fs-label` / `.t-label` / `.eyebrow` | 11–12px | Etiquetas en mayúscula, interletraje 0.18–0.24em |
| `.t-price` | 28px peso 900 | Precios |

**Clases utilitarias** (usar estas, no reglas sueltas): `.t-display`, `.t-h1`–
`.t-h4`, `.t-body`, `.t-body-sm`, `.t-lead`, `.t-label`, `.t-eyebrow`,
`.t-price`, `.t-quote`, `.t-link`.

> **Reseña:** el binomio "mayúscula sans + serif itálica" es distintivo y se ve
> caro. Funciona porque es disciplinado. El cuerpo serif a 16px/1.7 con ancho
> máximo de 64 caracteres es muy legible. Punto a cuidar: títulos largos en
> mayúscula pueden costar de leer en móvil — está mitigado con `clamp` y
> `word-break`, conviene revisarlo en títulos de 4+ palabras.

---

## 4. Espaciado, formas, sombra y movimiento

- **Espaciado** — escala de 4 puntos: `--space-1` 4px → `--space-10` 128px.
  Secciones con **mucho aire**: `padding: 96px` (144px en escritorio).
  Contenedor centrado, ancho máximo **1440px**, márgenes laterales 32/64px.
- **Esquinas** (`--radius`): `sm` 4px · `md` 8px (botones, tarjetas) ·
  `lg` 16px · `xl` 24px · `pill` 999px.
- **Sombra** — **minimalista a propósito.** La marca se apoya en color plano y
  bordes finos, no en sombras. `--shadow-sm/md/lg` existen pero se usan poco.
- **Movimiento** — suave y sobrio: `--ease-out cubic-bezier(.22,.61,.36,1)`,
  duraciones `fast` 140ms / `base` 240ms / `slow` 480ms. Los botones hacen
  `scale(0.98)` al presionar; el header se difumina al hacer scroll.

---

## 5. Componentes

**Botones** (`.btn` base: mayúsculas, Arial, 12px, interletraje 0.22em, radio
8px, padding 18×28px):
- `.btn-primary` — fondo **terracota**, texto blanco. El CTA principal. Hover → terracota-700.
- `.btn-ink` — fondo **tinta** (casi negro), texto papel. Acciones secundarias fuertes.
- `.btn-ghost-light` — transparente con borde claro (sobre fondos oscuros/héroe).
- `.btn-ghost-dark` — transparente con borde tinta (sobre fondos claros).
- `.text-link` — enlace en mayúscula con subrayado; **el espacio con la flecha
  crece en hover** (microinteracción de marca).

**Header** (`.site-header`): fijo arriba, **transparente** sobre el héroe y al
hacer scroll se vuelve **papel al 92% + desenfoque** con una línea inferior. La
marca (`.brand`) es **estrella + logotipo**; la estrella **gira 180° al pasar el
mouse**.

**Héroe** (`.hero`): video o imagen a pantalla completa + velo oscuro
(`.hero-scrim`) + etiqueta + título enorme + meta (ubicación, etc.). En la home
hay **cursor de estrella** (`shell.js`).

**Secciones y separadores**: `.section-divider` es una línea fina con una
**estrella terracota** en el centro (`.section-divider-star`). Algunas secciones
usan fondo de **puntos** sutiles (`.section-dotted`, `.amenities`).

**Tarjetas**: habitaciones (`.room`, `.pricing-card`, `.booking-room-card`),
reseñas (`.review-card`), cotización (`.quote-*`). Todas planas, con borde fino y
radio medio. Imagen + título en mayúscula + specs + precio.

**Formularios / motor de reserva** (`motor-app.jsx` + `.booking-*`): barra de
reserva, calendario propio (`.calendar-*`), pasos (`.booking-steps`, `.rp-step`),
resumen lateral, vista de éxito. Mismos tokens y tipografía que el resto.

**Footer** (`.site-footer`): fondo **tinta**, texto papel al 70%, logotipo
apilado, frase de marca en **serif itálica**, dirección y columnas de enlaces.

**Flotantes**: botón de contacto/WhatsApp (`.contact-float`) y banner de cookies
(`.cookie-consent`) — consentimiento por defecto en **denegado** (privacidad).

---

## 6. Motivos de marca (lo que hace única a estar)

- **La estrella** — sello del logo, cursor en el héroe, separador de secciones,
  y gira al pasar el mouse. Es el "ícono firma". Archivos: `assets/icon-star-*`.
- **Logotipos** — `assets/logo-wordmark-charcoal-onwhite.png` (sobre claro),
  `logo-wordmark-olive-onwhite.png`, `logo-stacked-charcoal.png` (footer).
- **Video/cinemagraph** en el héroe (decisión del dueño: el video **no se quita**;
  se difiere para no afectar el rendimiento).
- **Mayúscula + itálica** como contraste tipográfico recurrente.

---

## 7. Página por página (carácter visual)

| Página | Carácter |
|---|---|
| `index.html` (home) | Héroe con video, secciones amplias, comparador de habitaciones, reseñas, prueba social |
| `reservar.html` | Motor de reserva (React), 4 pasos, calendario propio, doble tarifa |
| Habitaciones (`clasica`, `seleccion`, `reserva`, `origen`, `especial`) | Galería, specs, precio, CTA a reservar |
| `nosotros` / `explora` / `contacto` | Marketing editorial, fotos, mapa |
| `vivir` / `empresas` / `grupos` | Estancias largas y B2B, tono más informativo |
| `guest.html` | App del huésped: check-in, documentos, servicios — UI funcional con los mismos tokens |
| `cotizacion.html` | Documento de cotización B2B, tipo "factura" elegante |
| `/admin` (`cotizar-admin`) | Panel interno (cotizaciones + reembolsos + desayunos), `noindex` |
| `desayuno*.html` | Verificador y analítica de desayunos (staff/admin), `noindex` |
| Legales (`privacidad`, `cancelacion`, `cookies`, `aviso-legal`, `escnna`) | Texto largo legible, plantilla sobria |
| `404.html` | Error con la marca |

Versiones en inglés bajo `/en/` que **reflejan** la estructura en español.

---

## 8. Correos

Todos los correos transaccionales ya comparten esta identidad (encabezado crema
con logo, banda olivo/terracota/arena, pie con estrella). Viven en
`netlify/functions/_email.js` (shell + componentes compartidos) y
`send-confirmation.js`. Ver la memoria *correos-rediseño* y `docs/pendientes.md`.

---

## 9. Reseña general (fortalezas, riesgos, oportunidades)

**Fortalezas**
- Sistema de **tokens completo y semántico** → muy mantenible; un rebrand se hace
  en `colors_and_type.css`.
- Identidad **distintiva y consistente** (paleta tierra + mayúscula/serif +
  estrella). No se parece a una plantilla genérica.
- **Disciplina**: clases utilitarias de tipografía, casi sin sombras, espaciado
  en rejilla de 4pt.
- Accesibilidad considerada (contraste AA, `skip-link`, `.visually-hidden`,
  fallback de `data-reveal` sin JS).

**Riesgos / a vigilar**
- **Contraste olivo↔arena** bajo: no usar para texto pequeño.
- **Títulos largos en mayúscula** pueden costar en móvil (revisar 4+ palabras).
- `styles.css` es grande (~5.500 líneas): conviene no duplicar componentes;
  reusar clases existentes antes de crear nuevas.
- Dependencia de **imágenes** para logo/estrella en correos (los clientes de
  correo las bloquean por defecto) — aceptable, pero el texto alternativo debe
  quedar siempre claro.

**Oportunidades**
- Un **styleguide visual** (página HTML que renderice swatches y componentes)
  para revisar el diseño "en vivo", no solo en este documento. *(Puedo generarlo.)*
- Documentar los estados de error/vacío del motor de reserva.
- Revisar foco de teclado en el motor (`motor-app.jsx`) para accesibilidad total.

---

## 10. Cómo mantener la consistencia (reglas para editar)

1. **Colores solo por token** (`var(--…)`), nunca hex suelto.
2. **Tipografía por clase utilitaria** (`.t-h2`, `.t-body`…), no reglas nuevas.
3. **Titulares en mayúscula** (lo hace el CSS) salvo serif itálica a propósito.
4. **Bilingüe siempre**: todo cambio de texto se refleja en `.lang-es` **y**
   `.lang-en` (y en los JSON de `/i18n/`). El build valida la paridad de claves.
5. **Reusar componentes** de `styles.css` antes de crear nuevos.
6. **Reveal**: añade `data-reveal` para que un elemento aparezca al hacer scroll.
7. **Imágenes** a `webp` cuando sea posible; el video del héroe se difiere.

---

## 11. Inventario (dónde vive cada cosa)

| Qué | Archivo |
|---|---|
| Tokens (color, tipografía, espaciado, radios, motion) | `colors_and_type.css` |
| Componentes y layout | `styles.css` |
| Comportamientos (header, menú, reveal, cursor estrella, WhatsApp) | `shell.js` |
| Barra de reserva / puente al motor | `kunas.js` |
| Motor de reserva (React) | `motor-app.jsx` → `dist/motor-app.js` |
| Textos traducibles | `/i18n/*.es.json` y `*.en.json` |
| Logos e íconos | `assets/logo-*`, `assets/icon-star-*` |
| Correos (marca compartida) | `netlify/functions/_email.js`, `send-confirmation.js` |
