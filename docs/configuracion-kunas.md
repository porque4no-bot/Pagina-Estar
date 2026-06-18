# Configurar Kunas (OTASync) para que cuadre con la web

> Guía paso a paso para dejar Kunas configurado **desde cero** y alineado con lo
> que la página web espera. Pensada para ejecutarse en orden. Escrita en lenguaje
> de negocio; al final de cada flujo hay una prueba para confirmar que quedó bien.
>
> **Property ID de Estar en Kunas/OTASync: `9889`.**

---

## 0. La regla de oro (lee esto primero — resuelve el 80% del "no cuadra")

La web **no** lee de Kunas casi nada de lo que uno esperaría. La mayoría de
cálculos (las dos tarifas, los descuentos, los precios de los extras, el IVA)
los hace **el navegador del cliente**, no Kunas. Por eso, si configuras cosas
dentro de Kunas pensando que la web las va a usar, **la web las ignora** y
parece que "no cuadra".

Lo que la web **SÍ lee de Kunas** (esto tiene que estar perfecto):

| La web lee de Kunas | Para qué |
|---|---|
| Los **5 tipos de habitación** (sus IDs) | Identificar cada apartaestudio |
| **1 precio por noche** por tipo de habitación | La tarifa base que ve el cliente |
| La **disponibilidad** (cuántas unidades libres) por fecha | Mostrar/ocultar habitaciones |
| La **capacidad** (ocupación máxima) por tipo | Validar cuántos huéspedes caben |

Lo que la web **NO lee de Kunas** (lo calcula sola — configurarlo en Kunas no sirve):

| La web calcula sola | Cómo |
|---|---|
| La tarifa "**Flexible**" | Toma el precio de Kunas y lo divide por 0,9 (≈ +11%) |
| La tarifa "**Mejor Precio**" | Es el precio de Kunas tal cual |
| **Descuentos / planes múltiples** | No los usa: solo toma el primer precio |
| **Desayuno** ($20.000/persona/noche) | Número fijo en el código |
| **Late check-out** (15%) y **Early check-in** (25%) | Porcentaje fijo sobre la noche |
| **Mascota** ($200.000 por reserva) | Número fijo en el código |
| **IVA 19%** | Lo decide y calcula la web según país/motivo del huésped |

**Conclusión práctica:** en Kunas solo configuras **habitaciones, un precio por
noche, disponibilidad y capacidad**. Todo lo demás (tarifas dobles, extras,
IVA) es de la web. No pierdas tiempo creando planes de descuento o extras en
Kunas para el motor de la web: no se usan.

> **Excepción:** las **cotizaciones corporativas** y los **pedidos del guest
> app** sí mandan extras a Kunas (ver Flujos C y D). Esos son casos aparte.

---

## ⚠️ Advertencia crítica antes de tocar nada: NO borres los tipos de habitación

"Hacer como si no existiera ninguna configuración" es un buen ejercicio para
**revisar** cada ajuste — pero hay **un ancla que no se puede recrear**: los
**IDs de los 5 tipos de habitación**.

Esos IDs (`31348` … `31352`) están grabados en el código de la web, en el
archivo `rooms_db.json`, y en todas las reservas ya existentes. Kunas asigna un
ID nuevo cada vez que **creas** un tipo de habitación. Si borras los tipos y los
vuelves a crear, **los IDs cambian y se rompe todo**: el motor deja de encontrar
las habitaciones, los precios y las reservas.

**Por eso:** para cuadrar los tipos de habitación, **EDÍTALOS** (no los borres y
recrees). Si por alguna razón ya cambiaron de ID, hay que actualizar
`rooms_db.json` con los IDs nuevos — eso es trabajo de código, avísame.

---

## Mapa de los 4 flujos

La web habla con Kunas en cuatro situaciones distintas. Cada una espera cosas
distintas:

| Flujo | Cuándo ocurre | Qué crea/toca en Kunas |
|---|---|---|
| **A — Motor de reservas directo** | Cliente reserva y paga en `reservar.html` | Crea una **reserva confirmada** con 1 habitación, 1 huésped y el pago |
| **B — Disponibilidad y precios** | Cliente busca fechas | Solo **lee** precios y disponibilidad (no escribe nada) |
| **C — Cotizaciones corporativas** | Empresa acepta una cotización y paga | Crea reserva confirmada con **extras estructurados** y, opcionalmente, un **bloqueo temporal** |
| **D — Guest app (folio)** | Huésped pide servicios durante su estadía | Agrega **cargos al folio** de una reserva existente |

Los pasos de abajo configuran Kunas para que los cuatro funcionen.

---

## Flujo 1 — Fundamentos: conexión entre la web y Kunas

Antes de configurar habitaciones, la web tiene que poder **entrar** a Kunas.

### Qué necesitas reunir en Kunas

1. **Property ID:** `9889` (ya lo sabemos; confírmalo en Kunas).
2. **Token de conectividad (API).** En Kunas se obtiene activando la conexión
   por API / "connectivity partner". Es una cadena larga de letras y números.
3. **Usuario y contraseña** del PMS con permisos sobre la propiedad 9889.

### Dónde se guardan (esto es trabajo de código/Netlify, no de Kunas)

Estos valores viven en Netlify (Site settings → Environment variables), **no**
en el código. Si los cambias en Kunas, hay que actualizarlos también en Netlify:

```
OTASYNC_TOKEN=        (el token de conectividad)
OTASYNC_USERNAME=     (usuario del PMS)
OTASYNC_PASSWORD=     (contraseña del PMS)
OTASYNC_PROPERTY_ID=9889
```

> Si estos cuatro no están bien, **toda** la integración cae en "modo simulado"
> (precios de ejemplo) o devuelve error. Es lo primero que hay que verificar.

### ✅ Prueba del Flujo 1
En la web, busca disponibilidad para unas fechas cualquiera. Si aparecen las 5
habitaciones con precios **reales** (no precios redondos de ejemplo como
$195.000 idénticos en todas), la conexión funciona.

---

## Flujo 2 — Los 5 tipos de habitación

La web espera **exactamente estos 5 tipos**, con estos IDs. Edita cada uno en
Kunas para que coincida:

| ID en Kunas | Nombre | Capacidad (ocupación máx.) | Área | Camas |
|---|---|---|---|---|
| `31348` | **Clásica** | 2 | 29 m² | 1 doble |
| `31349` | **Selección** | 5 | 36 m² | 1 king + 1 doble + 1 sencilla |
| `31350` | **Reserva** | 2 | 24 m² | 1 doble |
| `31351` | **Origen** | 3 | 29 m² | 1 doble + 1 sencilla |
| `31352` | **Especial** | 2 | 27 m² | 1 doble |

### Qué revisar en cada tipo de habitación

- **Capacidad / ocupación máxima:** debe ser la de la tabla. La web la usa para
  decidir cuántos huéspedes caben. Si en Kunas dice 2 pero el cliente pide 3, la
  web oculta esa habitación.
- **Nombre:** idealmente igual al de la tabla (el nombre que se muestra al
  cliente sale del archivo de la web, pero conviene que coincida para no
  confundir a recepción).
- **Número de unidades:** cuántos apartaestudios físicos hay de cada tipo. Esto
  alimenta la disponibilidad (Flujo 4).
- **Motor de reservas activado:** ver Flujo 5.

> **Recordatorio:** EDITA estos 5, no los borres. Los IDs son sagrados.

### ✅ Prueba del Flujo 2
En la búsqueda de la web, las 5 habitaciones aparecen con el nombre correcto y,
al pedir más huéspedes que la capacidad, esa habitación desaparece de los
resultados.

---

## Flujo 3 — Precios por noche (el corazón del "no cuadra")

Esta es la parte donde más confusión hay. Léela con calma.

### Cómo funciona realmente

1. En Kunas pones **un (1) precio por noche** para cada tipo de habitación.
2. La web toma ese precio y lo muestra como **"Mejor Precio"** (la tarifa más
   barata, no reembolsable).
3. La web **inventa** la tarifa **"Flexible"** dividiendo ese precio por 0,9
   (queda ≈ 11% más cara) — esto pasa en el navegador, Kunas no se entera.

**Ejemplo:** si en Kunas pones la Clásica a **$220.000**/noche:
- El cliente ve **"Mejor Precio: $220.000"**
- El cliente ve **"Flexible: $244.444"** (= 220.000 ÷ 0,9), calculado por la web.

### Consecuencias que tienes que tener claras

- **El precio que pongas en Kunas es el MÁS BARATO que verá el cliente.** No
  pongas ahí la tarifa "flexible" pensando que es la base — la web la abarataría
  todavía más.
- **Solo necesitas UN plan de precios** por habitación. Si en Kunas creas varios
  planes/tarifas con descuentos, la web **toma solo el primero** y los ignora.
  No configures planes múltiples para el motor: confunden y no se usan.
- Asegúrate de que el plan que quieres usar sea **el primero / principal** del
  motor de reservas de Kunas (la web usa el primero que Kunas le entregue).

### ¿Con IVA o sin IVA? → **SIN IVA**

El precio por noche en Kunas va **sin IVA** (tarifa neta). La web le suma el IVA
del 19% **por encima** y solo a quien corresponde (residentes colombianos o
viajeros de negocios; ver Flujo 6). Si pusieras el precio con IVA en Kunas, a
los colombianos les cobraría IVA sobre IVA.

### Coherencia con el marketing

Las fichas de cada habitación en la web muestran precios de referencia. Revisa
que el **precio por noche que pongas en Kunas** sea coherente con lo que se
anuncia, para que el cliente no vea un número en la ficha y otro distinto en el
motor. (Los precios de **alquiler mensual / larga estadía** que salen en las
fichas son otra cosa, no son la tarifa por noche del motor.)

### Tabla para definir tus precios por noche (sin IVA)

Llénala con los valores que quieres cobrar y úsala como checklist al cargarlos
en Kunas:

| Habitación | Precio/noche en Kunas (sin IVA) |
|---|---|
| Clásica (31348) | $ ____________ |
| Selección (31349) | $ ____________ |
| Reserva (31350) | $ ____________ |
| Origen (31351) | $ ____________ |
| Especial (31352) | $ ____________ |

> **Recargo por persona adicional:** la web suma **$31.000 por noche** por cada
> huésped más allá del primero. Ese número está en el código, **no** en Kunas.
> Si quieres cambiarlo, es cambio de código — avísame. No lo configures en Kunas
> porque no lo leería.

### ✅ Prueba del Flujo 3
Busca una habitación en la web y confirma que el **"Mejor Precio"** coincide con
el precio que pusiste en Kunas, y que el **"Flexible"** es ≈ 11% más alto.

---

## Flujo 4 — Disponibilidad e inventario

La web pregunta a Kunas, para cada fecha, **cuántas unidades libres** hay de
cada tipo. Si Kunas dice 0, la web marca la habitación como no disponible.

### Qué configurar en Kunas

- **Número de unidades** por tipo de habitación (cuántos apartaestudios físicos
  hay de cada uno).
- **Calendario de disponibilidad** abierto para las fechas que quieres vender.
- **Bloqueos / mantenimientos:** si cierras una unidad en Kunas, la web deja de
  ofrecerla automáticamente para esas fechas. Así es como controlas qué se
  vende.

> Cuando entra una reserva (por la web, por Booking, por recepción), Kunas baja
> la disponibilidad y la web deja de ofrecer esa unidad. No tienes que hacer
> nada manual para eso.

### ✅ Prueba del Flujo 4
Bloquea una unidad en Kunas para una fecha y confirma que esa habitación
desaparece de la web para esa fecha. Libérala y vuelve a aparecer.

---

## Flujo 5 — Motor de reservas (booking engine) de cada habitación

La web consulta precios/disponibilidad a través del **motor de reservas** de
Kunas (no del módulo administrativo). Por eso, cada uno de los 5 tipos de
habitación tiene que tener el **motor de reservas / booking engine ACTIVADO**
en Kunas.

- Si una habitación tiene el motor desactivado, **no aparece** en la web aunque
  tenga precio y disponibilidad.
- La web pide los precios en **pesos colombianos (COP)** e idioma **español**.
  Confirma que la propiedad/motor en Kunas maneje COP.

### ✅ Prueba del Flujo 5
Las 5 habitaciones aparecen en la web. Si falta alguna, casi siempre es porque
tiene el motor de reservas apagado en Kunas (o capacidad/disponibilidad en 0).

---

## Flujo 6 — Canal "Pagina web" (revisar el ID 66483)

Cada reserva que crea la web se **etiqueta con un canal** en Kunas, para que en
las estadísticas sepas cuántas reservas vinieron de la web directa. Hoy la web
usa por defecto:

- **ID de canal:** `66483`
- **Nombre de canal:** `Pagina web`

### Qué verificar

1. En Kunas, confirma que **existe un canal con ID `66483`** y que corresponde a
   la web directa ("Pagina web" / "Reserva directa").
2. Si en tu Kunas ese canal tiene **otro ID** o **otro nombre**, hay dos
   opciones:
   - **(Recomendado)** Ajustar las variables en Netlify para que coincidan con
     tu Kunas:
     ```
     OTASYNC_CHANNEL_ID=<el ID real de tu canal de web directa>
     OTASYNC_CHANNEL_NAME=<el nombre real>
     ```
   - O renombrar/identificar el canal en Kunas para que sea el 66483.

> **Ojo, posible fuente de desajuste:** hoy la web **siempre** etiqueta con el
> canal 66483 aunque no lo configures. Si ese ID no es el correcto en tu Kunas,
> las reservas de la web pueden quedar mal clasificadas (o caer en un canal
> equivocado) en tus estadísticas. Vale la pena confirmarlo.

### Sobre el IVA (se decide aquí, pero lo calcula la web)

La web decide si cobra IVA según lo que el huésped declara al reservar:
- **País = Colombia**, o **motivo = negocios/trabajo** → se le cobrará IVA (19%)
  **en recepción al llegar** (no online).
- **Extranjero + turismo** → exención preliminar (se valida al llegar).

Esto **no se configura en Kunas**; la reserva que llega a Kunas trae una **nota**
indicando si el IVA queda "POR COBRAR EN ALOJAMIENTO" o "EXENTO PRELIMINAR".
Recepción se guía por esa nota. Solo asegúrate de que tu equipo sepa leerla.

### ✅ Prueba del Flujo 6
Haz una reserva de prueba en la web (sandbox de pagos) y confirma en Kunas que
la reserva entra etiquetada con el canal correcto y con la nota de IVA.

---

## Flujo 7 — Extras (qué NO configurar y qué SÍ)

### Para el motor de la web (Flujo A): NO configures extras en Kunas

El desayuno, late check-out, early check-in y mascota que ofrece el motor se
calculan **en la web** y viajan a Kunas como **texto en la nota** de la reserva
— **no** como líneas de extra estructuradas. Por eso **no necesitas crearlos en
Kunas** para el motor. Si los creas, el motor no los usa.

Recepción ve los extras de una reserva web en la **nota** de la reserva (ej.:
"Extras: Desayuno, Late check-out…"). Si quieres que queden como líneas de cobro
en el folio, hoy hay que agregarlos a mano en Kunas.

### Para el guest app (Flujo D): SÍ se usa un extra genérico

Cuando un huésped pide servicios desde el guest app y elige "cargar a mi
cuenta", la web sí agrega el cargo al folio de Kunas. Para eso usa **un único
extra genérico llamado "Pedido guest app"**:

- La web lo **crea automáticamente** la primera vez (no tienes que hacer nada),
  o puedes crearlo tú a mano y poner su ID en la variable
  `OTASYNC_GUEST_SERVICE_EXTRA_ID`.
- Cada pedido entra como una línea con el nombre real del servicio
  (ej. "Desayuno (app)") y su precio.

> Este flujo está **apagado por defecto**. Se activa con la variable
> `GUEST_SERVICE_FOLIO_ENABLED=true` en Netlify, y **solo después de probarlo
> contra una reserva real**. Ver Flujo D abajo.

### Para cotizaciones corporativas (Flujo C): extras estructurados

Las cotizaciones sí mandan extras estructurados (desayuno, almuerzo, cena,
persona adicional, otros) a la reserva en Kunas. Esos salen del catálogo de
cotizaciones de la web, no de Kunas.

---

## Flujo 8 — Webhooks (recomendado, no obligatorio)

Kunas puede **avisarle a la web** cuando algo cambia (una reserva nueva desde
otra parte, un cambio de disponibilidad o de precios). Esto mantiene las
cotizaciones corporativas al día (si una empresa tiene rooms cotizados y se
acaba la disponibilidad, la web lo detecta).

### Qué configurar en Kunas (sección Webhooks)

Registra un webhook apuntando a la web:

```
https://estar.com.co/api/otasync-webhook
```

Kunas enviará avisos de estos eventos:
- **reservation** (insertar / editar / cancelar)
- **avail** (cambios de disponibilidad)
- **prices** (cambios de precios)
- **restrictions** (cambios de restricciones)

> Es opcional para que la web funcione, pero **recomendado** para que las
> cotizaciones y la disponibilidad se mantengan sincronizadas sin depender solo
> de los chequeos programados.

### ✅ Prueba del Flujo 8
En Kunas, usa la opción de "probar webhook" hacia esa URL. Debe responder OK.

---

## Flujo D (detalle) — Pedidos del guest app al folio

Para que un huésped pueda pedir servicios y que el cargo llegue al folio de su
reserva en Kunas, se necesita que:

1. La **reserva exista** en Kunas con el código con el que el huésped entra al
   guest app.
2. La reserva tenga **al menos una habitación asignada** (la web cuelga el cargo
   de esa habitación).
3. Exista el extra **"Pedido guest app"** (auto-creado, ver Flujo 7).
4. La variable `GUEST_SERVICE_FOLIO_ENABLED=true` esté activada en Netlify.

**Dos modalidades:**
- **"Cargar a mi cuenta"** → el cargo se agrega al folio al instante; el huésped
  paga al hacer check-out en recepción.
- **"Pagar en línea"** → el huésped paga por Wompi; al aprobarse, la web agrega
  al folio **el cargo y el pago** (queda saldado). Requiere
  `GUEST_SERVICE_PAYMENT_MODE=wompi` + llaves de Wompi.

> Ambas están **apagadas por defecto**. Actívalas solo después de probar con una
> reserva real. Si el folio falla, el pedido **no se pierde** (queda guardado
> aparte y se puede cargar a mano).

---

## Datos de huésped, SIRE y TRA (pendiente regulatorio a tener presente)

Las reservas que crea la web en Kunas llevan **datos mínimos del huésped**: solo
nombre y apellido. **No** llevan tipo/número de documento, nacionalidad ni fecha
de nacimiento — que son los datos que **SIRE** (Migración) y **TRA** (MinCIT)
exigen.

El **guest app sí captura** esos datos (documento + lectura automática), pero hoy
**no** los empuja a Kunas. Entonces, si tienes el reporte SIRE/TRA activado en
Kunas, las reservas web pueden salir **incompletas** y depender de que recepción
complete los datos a mano.

**Acción sugerida:** decidir con Kunas si el reporte SIRE/TRA toma los datos de
la reserva o del check-in en el PMS, y si hay forma de completar los datos de
huésped de una reserva existente vía API. Es una conversación a tener; está
documentada en `docs/pendientes.md` (punto 2).

---

## Checklist final de verificación (recórrelo de arriba abajo)

- [ ] **Conexión:** la web muestra precios reales (no de ejemplo). *(Flujo 1)*
- [ ] **5 tipos:** aparecen las 5 habitaciones con su nombre. *(Flujo 2)*
- [ ] **Capacidad:** pedir más huéspedes que la capacidad oculta la habitación. *(Flujo 2)*
- [ ] **Precio:** "Mejor Precio" en la web = precio en Kunas; "Flexible" ≈ +11%. *(Flujo 3)*
- [ ] **Disponibilidad:** bloquear una unidad en Kunas la quita de la web. *(Flujo 4)*
- [ ] **Motor:** las 5 tienen el booking engine activado y la propiedad maneja COP. *(Flujo 5)*
- [ ] **Canal:** una reserva de prueba entra con el canal correcto y la nota de IVA. *(Flujo 6)*
- [ ] **Webhook:** (opcional) registrado hacia `/api/otasync-webhook` y responde OK. *(Flujo 8)*
- [ ] **Folio guest app:** (cuando se quiera activar) probado contra una reserva real antes de prender `GUEST_SERVICE_FOLIO_ENABLED`. *(Flujo D)*

---

## Decisiones de negocio que afectan esta configuración

**Ya implementadas** (no requieren acción en Kunas hoy, pero conviene saberlas):
- **Parqueadero eliminado** como servicio (hay un parqueadero público cercano,
  ajeno al hotel). El motor ya no lo ofrece ni lo cobra.
- **Late check-out** = 15% de la noche (hasta 2 PM); **early check-in** = 25% de
  la noche (tarifa plana, desde 6 AM). Los calcula la web, no Kunas.

**Pendientes** (cambios de código que se harán en conjunto — no las apliques en
Kunas todavía):
1. **Tarifas reales en Kunas** (en vez de calculadas en la web). Se decidió pasar
   a dos planes de tarifa **reales** en OTASync — "Estricta" (base) y "Flexible"
   (+10%) — con sus políticas de cancelación. Cuando esto se haga, **sí** crearás
   2 planes en Kunas y la web dejará de inventar la Flexible. (Hoy es 1 solo
   plan.) Ver `docs/pendientes.md` §5.1.
2. **SIRE/TRA y push de datos de huésped a Kunas.** Ver `docs/pendientes.md` §2.

> Tocan código en varias partes a la vez. Cuando quieras avanzar con alguna, dime
> cuál y la hacemos completa (web + Kunas + bot a la vez) para que no quede a
> medias.

---

*Documento generado a partir del código actual de la web (`_otasync.js`,
`check-availability.js`, `wompi-webhook.js`, `_pricing.js`, `guest-action.js`,
`_guest-payments.js`, `rooms_db.json`) y de `docs/kunas-api.md` /
`docs/OTASync-Public-API.md`. Si el código cambia, actualizar esta guía.*
