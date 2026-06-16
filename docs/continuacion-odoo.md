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

## El problema a resolver ahora

En la prueba sobre el deploy preview **el contacto no apareció** en Odoo. Causas
posibles (el diagnóstico las distingue):
1. Se llenó el formulario de **"Solicitar convenio"** de `empresas.html`, que es
   un **form nativo de Netlify** y NO pasa por la función (el que sí llama a
   Odoo es **"Solicitar cotización"**).
2. Las variables de Odoo no estaban en el contexto **deploy-preview** → el
   conector corrió en **modo mock**.
3. **Multiempresa:** el contacto se creó pero quedó asignado a otra empresa y la
   UI de Contactos lo **filtra por la empresa seleccionada**.

> Dato confirmado: la base de Odoo es **MULTIEMPRESA**.

---

## Paso 1 — Diagnóstico (primero en local)

Ejecuta:
```bash
node scripts/odoo-test.js
```
Captura la salida. Confirma: servidor alcanzable + versión, **autenticación
(uid)**, **empresa por defecto y empresas permitidas del usuario**, conteo de
contactos, y la **creación del contacto de prueba** (id o el error exacto).

➡️ **Anota el ID de la empresa del hotel (Mirada SAS)** dentro de ese Odoo
(aparece en "Empresas permitidas"). Lo necesito para el Paso 2.

## Paso 2 — Ajustar el conector a la multiempresa

Según el resultado:
- Si el contacto **se creó pero no se ve en la UI** → es filtro por empresa.
  Decidir: crear los clientes en la **empresa del hotel** (setear `company_id`)
  o dejarlos **compartidos** (`company_id` nulo, visibles en todas). Recomiendo
  asignarlos a la empresa del hotel para que ventas/facturas cuadren después.
  Implica setear `company_id` en `buildPartnerValues` y, posiblemente, pasar
  `allowed_company_ids` en el contexto de las llamadas.
- Si **falló la autenticación** → revisar DB/usuario/API key.
- Si **falló el create por el NIT** → ya hay fallback; ver el detalle.

## Paso 3 — Completar la Fase 1

Enganchar `upsertPartner` también en:
- **Reservas pagadas** (`wompi-webhook.js`): cada huésped directo → cliente en
  Odoo (mayor volumen para el CRM). Persona, no empresa.
- **Larga estadía** (formulario de `vivir.html`): ojo, revisar si ese form es
  nativo de Netlify o llama a una función — define cómo se engancha.

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
