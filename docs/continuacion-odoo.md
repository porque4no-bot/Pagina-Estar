# Continuación — trabajo local con Odoo (handoff)

Documento para retomar la integración con Odoo en una **sesión local de Claude
Code** (corriendo en el PC, que sí alcanza Odoo — el entorno en la nube tiene
el egress restringido y no puede). Una sesión local nueva no trae la memoria de
este chat, pero con este documento + los docs del repo queda al día.

---

## ⚡ Pégale esto a la sesión local para arrancar

> Estamos integrando Odoo (ERP/CRM, v19 multiempresa, `bpo-dici`) con esta
> plataforma. La Fase 1 es el **maestro de clientes**. Ya está construido el
> conector `netlify/functions/_odoo.js` (JSON-RPC, modo mock sin credenciales,
> `upsertPartner` deduplica por NIT/email con fallback si la localización
> rechaza el NIT) y está enganchado en `request-quote`. Falta **verificarlo
> contra el Odoo real y resolver la multiempresa**. Lee
> `docs/continuacion-odoo.md`, `docs/plan-integracion-odoo-otasync.md` y
> `docs/pendientes.md`. Luego ejecuta `node scripts/odoo-test.js` (con el `.env`
> ya creado), muéstrame la salida y seguimos desde el "Paso 1" del documento de
> continuación. Estamos en la rama `claude/epic-fermat-1fl42x` (PR #80).

---

## Cómo correr en local

1. **Instala Claude Code** en el PC y autentícate.
2. En la carpeta del repo, ubícate en la rama del trabajo:
   ```bash
   git fetch origin
   git checkout claude/epic-fermat-1fl42x
   git pull
   ```
3. **Crea el `.env`** a partir del template (ya viene con 3 de las 4 variables):
   ```bash
   cp docs/odoo-local.env.example .env
   ```
   Abre `.env` y pega tu **`ODOO_API_KEY`** (la que generaste en Odoo →
   Mi perfil → Seguridad de la cuenta → API Keys). Las otras 3 ya están.
4. Asegúrate de tener **Node 18 o superior** (`node -v`).
5. Lanza `claude` en esa carpeta y pégale el bloque de arriba.

> **Nota:** el `.env` **no se sube a git** (está en `.gitignore` por seguridad).
> Se queda solo en tu PC. La API key nunca debe viajar al repo.

---

## Estado actual (qué ya está hecho)

- **Rama/PR:** `claude/epic-fermat-1fl42x` → PR #80.
- **Conector `_odoo.js`:** API externa por JSON-RPC; `upsertPartner` crea/
  encuentra un `res.partner` deduplicado por NIT (`vat`) y, en su defecto,
  email; si la localización CO rechaza el NIT, reintenta sin `vat` y lo guarda
  en la nota. Sin credenciales = no-op logueado (mock).
- **Enganchado** en `netlify/functions/request-quote.js` (formulario de
  cotización corporativa de `empresas.html`), no fatal.
- **`netlify/functions/odoo-probe.js`:** health check admin (auth Firebase).
- **`scripts/odoo-test.js`:** diagnóstico local (lo que se corre ahora).
- **Decisiones/arquitectura:** `docs/plan-integracion-odoo-otasync.md`
  (incluye el modelo de evaluación financiera y la guía de credenciales).

## El problema — ✅ VERIFICADO Y RESUELTO EN LOCAL (2026-06-15)

`node scripts/odoo-test.js` contra el Odoo real: servidor **19.0+e** alcanzable,
**autenticación OK** (uid=2), el usuario ve ~1000 contactos y el upsert/dedup del
partner de prueba funciona.

**Empresas del grupo (multiempresa confirmada).** El usuario de integración tiene
permitidas `[1,3,4,5]` y entra por defecto en **DICI (1)**:

| ID | Empresa | NIT |
|---|---|---|
| 1 | DICI S.A.S. *(default del usuario)* | 901386785-8 |
| 3 | RIVO S.A.S. | 901079655-2 |
| 4 | GRUPO PINAO S EN C A | 900436848-5 |
| **5** | **MIRADA S.A.S** ← el hotel | **902032515-0** |

**Causa real del "no apareció":** NO era la multiempresa. Un contacto
**compartido** (`company_id=false`) sí se ve en todas las empresas (comprobado).
Lo más probable fue (1) el formulario nativo de Netlify ("Solicitar convenio")
que no pasa por la función, o (2) **modo mock** en deploy-preview (faltaban las
variables de Odoo).

**Decisión (multiempresa):** asignar los clientes del hotel a **Mirada SAS
(company 5)** para segregarlos del grupo y alinear ventas/facturas. Implementado
en `_odoo.js` con la variable **`ODOO_COMPANY_ID`**: setea `company_id` y pasa
`allowed_company_ids` en el contexto de las llamadas. Verificado: "PRUEBA ODOO
SAS" queda en `company_id=[5,"MIRADA S.A.S"]` y aparece en Contactos al
seleccionar Mirada en el selector de empresa (arriba a la derecha).

> ⚠️ **Producción (Netlify):** cargar las 4 variables de Odoo **+
> `ODOO_COMPANY_ID=5`** en el panel (hoy en prod corre en mock). Recordar: los
> contactos del hotel se ven con **Mirada** seleccionada, no con DICI.

---

## Paso 1 — Diagnóstico ✅ HECHO

`node scripts/odoo-test.js` (con `.env` y `--env-file`) corrido y verde: servidor
19.0+e, auth uid=2, empresas permitidas `[1,3,4,5]`, Mirada SAS = **5**, y el
contacto de prueba se crea/dedupica. Para repetirlo:
`node --env-file=.env scripts/odoo-test.js`.

## Paso 2 — Ajustar el conector a la multiempresa ✅ HECHO

Resuelto: los clientes del hotel se asignan a **Mirada SAS (5)** vía
`ODOO_COMPANY_ID`. `_odoo.js` setea `company_id` y pasa `allowed_company_ids` en
el contexto; sin la variable quedan compartidos (compat. hacia atrás). Cubierto
por tests en `tests/unit/odoo.test.js` y el diagnóstico confirma la visibilidad.

## Paso 3 — Fase 1 ✅ (canales propios) + etiquetas de origen

`upsertPartner` enganchado en TODOS los canales que controlamos, cada uno con su
etiqueta de origen (`res.partner.category` — segmentación tipo CRM SIN el módulo
CRM; `upsertPartner` acepta `tags` y crea/añade la categoría con (4,id)):
- ✅ **Cotización corporativa** (`request-quote.js`) → empresa · "Corporativo".
- ✅ **Reservas pagadas** (`wompi-webhook.js`): cotización → empresa "Corporativo";
  reserva directa → persona "Huésped directo".
- ✅ **Larga estadía** (`vivir.html`): vía `submission-created.js` (función de
  EVENTO de Netlify; el form sigue siendo nativo) → persona "Larga estadía".

## CRM en Odoo — INSTALADO y enganchado (2026-06-16)

La licencia (Custom) cubre todos los apps sin costo extra → se instalaron por API
(`ir.module.module` `button_immediate_install`): **CRM, Email Marketing, Marketing
Automation, SMS Marketing** (todos `installed`, verificado). Contactos ya estaba.

Enganche (`_odoo.js` → `createLead`): además del cliente, el interés entrante crea
una **oportunidad** (`crm.lead`, `type=opportunity`, empresa Mirada 5, ligada al
partner):
- ✅ Cotización corporativa (`request-quote.js`) → "Cotización corporativa — <empresa>".
- ✅ Larga estadía (`submission-created.js`) → "Larga estadía — <nombre>".

Verificado contra el Odoo real: el lead cae en equipo "Sales", etapa "New",
empresa Mirada, ligado al partner. Etiquetas de origen del partner
(`res.partner.category`: Corporativo / Huésped directo / Larga estadía) siguen
activas. (Reservas pagadas → cliente, NO lead, porque ya son clientes ganados.)

## Kunas/OTASync → Odoo (clientes reales)

Decidido hacer **ambas**. Estado tras explorar el API real (ya con credenciales):

**Continuo (nuevas reservas) — CONSTRUIDO ✅.** `otasync-webhook.js` extrae el
huésped del objeto `reservation` del webhook (`extractGuest` → `upsertPartner`,
etiquetado por canal: Booking.com, Airbnb, …). Omite el canal web propio (lo
maneja `wompi-webhook`). No fatal; en DEBUG loguea el payload para verificar la
forma real. **Para activarlo falta:** (1) registrar un webhook en OTASync hacia
`https://estar.com.co/api/otasync-webhook` (hoy solo hay uno, de SIRE; ninguno al
nuestro) — es una escritura, requiere OK; (2) `OTASYNC_*` + `OTASYNC_WEBHOOK_SECRET`
+ vars de Odoo en Netlify; (3) verificar los nombres de campo del huésped con la
primera reserva real.

**Backfill (existentes) — BLOQUEADO.** Los endpoints de listado no están
documentados y resistieron 4 rondas: `reservation/data/reservations` → 500 opaco;
`guests/data/guests` → "date is not valid" con todo formato (ISO, timestamp,
nombres). Sí funciona `reservation/data/reservation` (uno, por `id_reservations`)
pero falta enumerar los ids. Desbloqueo: pedir a **Kunas soporte** el contrato
exacto de "Get reservations"/"Guests", o **exportar CSV** desde la UI de Kunas e
importarlo.

## Fase 2 — hallazgos del Odoo real (sondeo de solo lectura, 2026-06-15)

> ⛔ **EN PAUSA (2026-06-15):** la **facturación la integra OTRO EQUIPO**. Por
> decisión del dueño, **no construir** la creación de facturas (`account.move`,
> diario FACTURA DE VENTA, DIAN/Numera) hasta que ese equipo termine. Nuestro
> alcance en Odoo se limita al **maestro de clientes** (`res.partner`). Cuando se
> retome: impuesto del hospedaje = **IVA 19%** (`account.tax` id 1930). Coordinar
> la creación de partners con ese equipo (las facturas cuelgan del partner).

Hallazgos del sondeo (guardados para cuando se retome):

- ❗ **No hay módulo de Ventas** (`sale.order` no existe). Solo Contabilidad
  (`account.move`). ⇒ la Fase 2 crea **facturas de cliente directamente**, no
  `sale.order` (más simple que el plan original).
- Impuestos de venta: **IVA 19% = `account.tax` id 1930**, **INC 8% = id 1943**.
- Diarios de venta: **FACTURA DE VENTA (FV) = id 111** (¿factura electrónica DIAN
  vía Numera? — confirmar), COTIZACION = 105, Sales/INV = 89, Nota Crédito = 112.
- Catálogo: 2931 productos (elegir/crear el de "hospedaje" con cuenta de ingreso
  + impuesto).
- ⚠️ Crear una `account.move` en el diario FV = **factura electrónica DIAN real**
  (difícil de revertir → nota crédito). Decisiones abiertas antes de construir:
  (A) auto-emitir vs solo borrador vs aún no; (B) impuesto del hospedaje (IVA 19%
  probable); (C) cómo procesa Numera el diario FV; (D) producto/cuenta de ingreso.

## Después (Fase 2+)

Ventas/cotizaciones y facturas ligadas al cliente (sincronizar nuestra UI a
Odoo; Numera procesa DIAN), y la evaluación financiera con DataCrédito. Todo en
`docs/plan-integracion-odoo-otasync.md`.

---

## Variables de entorno

- **Para el diagnóstico y el conector:** solo las **4 de Odoo** (`ODOO_URL`,
  `ODOO_DB`, `ODOO_USERNAME`, `ODOO_API_KEY`) — ya en `docs/odoo-local.env.example`.
- **Si más adelante probamos el flujo completo en local** con
  `npx netlify-cli dev` (p. ej. el `request-quote` real end-to-end), harían
  falta más variables de Netlify (`RESEND_API_KEY`, OTASync, Wompi, Blobs…).
  En ese momento te digo exactamente cuáles bajar del panel de Netlify. Para lo
  de ahora **no hacen falta**.

## Qué se sube y qué no

- **Lo que dejé committeado y pusheado** (tú solo haces `git pull`): el conector
  `_odoo.js`, `odoo-probe.js`, `scripts/odoo-test.js`, este documento, el
  template `docs/odoo-local.env.example`, y los docs del plan. Todo en la rama
  `claude/epic-fermat-1fl42x`.
- **Lo que NO se sube nunca:** el archivo **`.env`** con tu `ODOO_API_KEY`
  (gitignored). Se queda en tu PC.
- Cuando en local hagamos cambios al código, los **commiteo y pusheo** a la
  misma rama; el `.env` se queda fuera.
