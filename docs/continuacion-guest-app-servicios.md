# Continuación — Motor único de servicios en la Guest App (Frente 1)

> **Para el siguiente agente.** Documento autocontenido. Léelo completo antes de tocar código.
> Creado: 2026-06-18. Autor previo: sesión del panel de reembolsos (#91).

## 0. Contexto en 30 segundos

Sitio estático + React compilado (`motor-app.jsx`) + funciones Netlify para **Hotel Estar** (apartaestudios, Manizales). Dueño no técnico, español colombiano informal: él decide negocio/precios/políticas, el agente decide lo técnico. Lee `CLAUDE.md` (raíz) para arquitectura y comandos.

**Lo que se acaba de entregar (no lo rehagas):** PR [#91](https://github.com/porque4no-bot/Pagina-Estar/pull/91) — panel admin "Reembolsos" (Fase 1c). Independiente de esta tarea.

**Esta tarea = Frente 1 del roadmap:** existe un **catálogo único** de servicios adicionales (`netlify/functions/_services-catalog.js`) que debe ser la única fuente de verdad para las 3 superficies que venden extras: **reservas** (motor), **cotización** (admin), **guest app**. Reservas y cotización ya están alineadas. **La guest app NO: tiene precios desactualizados y duplicados que el huésped ve mal.**

## 1. Hallazgos verificados (drift real — esto es lo importante)

Comparación de precios **hoy** (2026-06-18):

| Servicio | Catálogo `_services-catalog.js` | Servidor `guest-action.js` `SERVICE_CATALOG` | UI `guest.html` (lo que VE el huésped) | Problema |
|---|---|---|---|---|
| **breakfast / desayuno** | `20000` | `20000` ✓ | **`data-service-price="28000"` y texto `$28.000`** | 🐞 **BUG visible:** el huésped ve y se le cotiza **$28.000**, pero el servidor registra **$20.000**. |
| **late_checkout** | `late` = **15% de la noche** (`pctOfNight`) | **`80000` plano** | **`60000` / `$60.000`** | ⚠️ **Triple discrepancia** (15%-noche vs 80k vs 60k). Requiere decisión de modelo (ver §4). |
| **parking / parqueadero** | (no listado para `guest`) | **`25000`** | (no hay tarjeta en UI) | ⚠️ Parqueadero fue **retirado** de reservas/cotización (Lote B), pero sigue vivo en el backend del guest app y no está en el catálogo. |
| laundry | `35000` | `35000` ✓ | `35000` / `$35.000` ✓ | OK |
| airport_transfer | `120000` | `120000` ✓ | `120000` / `$120.000` ✓ | OK |
| city_experience | `95000` | `95000` ✓ | `95000` / `$95.000` ✓ | OK |

**Cómo fluye el precio (por qué el bug es visible):**
- `guest-app.js:1559` → `const price = Number(card.dataset.servicePrice)` arma el carrito y el total con el **precio del HTML**. → el huésped ve/confirma $28.000.
- `netlify/functions/guest-action.js` `sanitizeItems()` (≈línea 73) **re-precia en el servidor** desde su propio `SERVICE_CATALOG` ignorando el precio del cliente. → se registra $20.000.
- Resultado: **lo que ve el huésped ≠ lo que queda registrado.** El servidor es la autoridad (bien), pero la UI debe coincidir.

**Por qué el guard no lo atrapó:** `tests/unit/services-catalog.test.js` parsea `guest-action.js` (servidor) contra el catálogo, pero **NO** parsea `guest.html` (`data-service-price`/texto). Además `late_checkout` y `parking` **no se asertan** (esperan la decisión de superficies del dueño). Por eso el 28k de la UI pasó desapercibido.

## 2. Archivos clave

| Archivo | Qué es | Líneas relevantes |
|---|---|---|
| `netlify/functions/_services-catalog.js` | **Fuente única** (objeto `SERVICES`, con `surfaces: ['booking'|'quote'|'guest']`) | todo (44 líneas) |
| `netlify/functions/guest-action.js` | Backend guest app; `SERVICE_CATALOG` hardcodeado + `sanitizeItems()` (re-precio server-side) | `SERVICE_CATALOG` ≈64–71, `sanitizeItems` ≈73–86 |
| `guest.html` | UI guest app; grid de servicios con precios hardcodeados | tarjetas en ≈359–385 (`data-service-price` + `<strong>$…</strong>`) |
| `guest-app.js` | JS del guest app (hand-written, build lo minifica); lee `dataset.servicePrice` → carrito | ≈1528 (cartCount), ≈1558–1559 (lee precio), ≈1687 (botones) |
| `tests/unit/services-catalog.test.js` | Guard anti-drift entre superficies | todo |
| `i18n/guest.es.json` / `guest.en.json` | Strings ES/EN del guest app (inline en build) | — |
| `docs/guest-app.md` | Doc de arquitectura del guest app | — |

Notas:
- **No existe `en/guest.html`.** El guest app es una sola página; la i18n es **runtime** vía `guest-app.js` + `i18n/guest.*.json` (no hay `data-i18n` ni `.lang-es/.lang-en` en `guest.html`). Verifica si los nombres de servicio salen de la i18n o del markup; mantén **ES y EN en paridad** pase lo que pase.
- `guest-action.js` es una función Netlify → puede `require('./_services-catalog')` directamente (sin build).

## 3. Tareas (en orden; las primeras NO requieren decisión)

1. **Arreglar el bug visible de desayuno:** en `guest.html` poner breakfast a **$20.000** (`data-service-price="20000"` y el `<strong>$20.000</strong>`). Servidor y catálogo ya están en 20k.
2. **Conectar el backend al catálogo:** en `guest-action.js`, construir `SERVICE_CATALOG` **desde** `_services-catalog.js` (`require` + filtrar `surfaces.includes('guest')`), en vez de la copia hardcodeada. Mapea las llaves (catálogo usa `desayuno`; guest app usa `breakfast` — mantén el id `breakfast` que ya consume el front/contratos, pero toma el `price` del catálogo).
3. **Inyectar precios del catálogo en `guest.html` vía `build.js`** (igual que la i18n) **para que la UI no pueda divergir** del servidor. Si eso es mucho alcance, **mínimo**: extender `services-catalog.test.js` para que parsee `guest.html` (`data-service-price` y el texto `$…`) y falle si difiere del catálogo. Sin esto, el drift de UI volverá.
4. **Resolver `parking`:** quitarlo de `guest-action.js` (parqueadero retirado) salvo que el dueño diga lo contrario (§4).
5. **`late_checkout`:** implementar según la decisión del dueño (§4) y recién ahí alinear UI↔servidor↔catálogo y agregarlo al guard.

## 4. Requiere DECISIÓN del dueño — NO inventes (usa AskUserQuestion)

- **Modelo de late check-out en la guest app.** En reservas es **15% de la noche**. En la guest app hoy es plano (UI 60k / servidor 80k) y el huésped ya está alojado, así que la "base de la noche" puede no estar disponible limpia en `guest-action`. Pregunta: ¿tarifa **plana** (¿qué valor: 60k u 80k?) o **15% de la noche** como en reservas? (El roadmap lo marca como pendiente.)
- **Qué servicios ofrece la guest app.** ¿Agregar **early check-in** y/o **mascota**? ¿Eliminar parqueadero del todo? (matriz de superficies).
- **¿Pago online de estos servicios?** Hoy `guest-action` solo **registra** el pedido (no cobra). Revisa `GUEST_SERVICE_PAYMENT_MODE` / `GUEST_SERVICE_PAYMENT_URL` en `.env.example` y `CLAUDE.md`. Si el dueño quiere cobro online, el monto debe firmarse server-side (mismo principio que reservas).

## 5. Constraints (no los rompas)

- **Autoridad de monto server-side:** el servidor re-precia; la UI es informativa pero **debe** coincidir con el catálogo/servidor.
- **i18n ES/EN obligatorio** en todo texto. `npm run build` valida paridad de claves y **regenera el CSP** con hashes de scripts inline (cualquier cambio en JS inline obliga a rebuild).
- **Tests:** `npm run test:unit` debe quedar verde **salvo 2 fallas locales conocidas** (`guest session …` y `Drive webhook … PDF`) causadas por credenciales reales en el `.env` local; **en CI están verdes**. No las "arregles".
- Si más adelante conectas pago: **`extrasMask` es append-only** y la referencia Wompi se decodifica posicionalmente (ver `estar-roadmap` en memoria y `_pricing.js`).

## 6. Verificación

1. `npm run build` (debe decir "Build completed" + regenerar `_headers`).
2. `npm run test:unit` (verde salvo las 2 conocidas) — y **el guard de servicios debe seguir pasando**.
3. Preview del guest app: levanta `estar-static` (`.claude/launch.json`) o `npx netlify-cli dev --offline`, abre `guest.html`, revisa el grid de servicios y el carrito; confirma que **el precio mostrado = el del catálogo** y que el total del carrito coincide con lo que registraría el servidor.

## 7. Git / PR

- Parte de **master actualizado** (`git checkout master && git pull`); esta tarea es independiente de #91.
- Rama `claude/guest-app-servicios-catalogo` (o similar). Commit convencional en **español** (ej. `fix(guest-app): alinear precios de servicios al catálogo único`).
- **El dueño hace merge por defecto** (a menos que delegue explícitamente). Abre el PR y déjaselo, con plan de pruebas.
- Termina con `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## 8. Referencias

- `CLAUDE.md` (arquitectura, build, env vars, sección Guest app).
- `docs/guest-app.md` (detalle del guest app).
- `netlify/functions/_services-catalog.js` y `tests/unit/services-catalog.test.js` (el motor único + su guard).
- Memoria del proyecto: `estar-roadmap` (Frente 1) y `apartment-data-model`.
