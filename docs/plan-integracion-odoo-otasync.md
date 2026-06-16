# Plan de integración: Odoo + OTASync + desarrollo propio

Arquitectura objetivo y plan de trabajo para unificar el back-office (Odoo),
el PMS/channel manager (OTASync) y la plataforma propia (web, motor de
reservas, guest app, bot), con el **cliente como eje central** y la
**evaluación financiera** (DataCrédito + extractos) integrada al flujo.

Fecha: 2026-06-16 · Estado: propuesta para validar (no implementado).

---

## Contexto confirmado (2026-06-16)

- **Odoo:** versión **19, licencia custom** → podemos usar la API externa **y**
  construir módulos a medida. Máxima flexibilidad.
- **Facturación / contabilidad:** ya implementada en Odoo, automatizada con
  **Numera** (todo el módulo contable). ⇒ **No construimos la integración DIAN**;
  nuestro trabajo es **alimentar Odoo** correctamente (clientes, ventas,
  facturas) y Numera se encarga del módulo contable / electrónico. *(Falta
  confirmar cómo encaja Numera con Odoo — ver §8.)*
- **DataCrédito:** **hay contrato** ⇒ la evaluación financiera **se automatiza**
  por API (no queda solo manual). Falta saber el producto/endpoints contratados.
- **Alcance de clientes:** **todos** los clientes en el maestro, para CRM,
  marketing y demás (no solo empresas/larga estadía).
- **Cotizaciones:** se **sincronizan** desde nuestra UI a Odoo (no se migran a
  Odoo nativo).

---

## 1. Objetivo

Pasar de sistemas aislados a un ecosistema con **una sola fuente de verdad por
dato**, donde:
- Cada **cliente** (persona o empresa) existe una sola vez y todo cuelga de él:
  cotizaciones, reservas, facturas, pagos, evaluación financiera, contratos.
- La **facturación electrónica (DIAN)** y la **contabilidad** viven en Odoo.
- El **inventario, calendario y tarifas** siguen en OTASync (no se duplican).
- La **evaluación financiera** (DataCrédito + extractos bancarios) deja de ser
  manual y queda registrada en el cliente, habilitando crédito y larga estadía.

## 2. Estado actual (por qué hay que integrar)

| Dato | Dónde vive hoy | Problema |
|---|---|---|
| Clientes | **No existe maestro.** Datos sueltos en cada cotización (`empresa`, `nit`, `contacto`) y nombre del huésped en OTASync | Imposible ver el historial de un cliente; no se deduplica |
| Cotizaciones | Netlify Blobs (`quotes`) | No vinculadas a un cliente; sin factura ni contabilidad |
| Reservas | OTASync | Sin vínculo a cliente ni a contabilidad |
| Facturas | **Manual** (Excel / Drive `03_facturas`) | Sin DIAN automatizado, sin CxC, sin numeración fiscal |
| Pagos | Wompi / Mercado Pago | Sin conciliación contable; `reconcile-payments` solo cruza pago↔reserva |
| Evaluación financiera | **100% manual y externa** (DataCrédito por portal + extractos por correo) | No queda registro estructurado; no gatea el crédito ni la larga estadía |
| Crédito a 30 días | **Solo es texto** en `empresas.html` / emails | Prometido, no implementado |

## 3. Arquitectura objetivo

### 3.1 Fuente de verdad por dominio (regla anti-duplicación)

| Dominio | Sistema de verdad | Réplica/consumo |
|---|---|---|
| **Cliente** (persona/empresa) | **Odoo** `res.partner` | La web/bot/guest app crean o buscan el partner; OTASync guarda referencia |
| **Inventario, calendario, tarifas, disponibilidad** | **OTASync** | La web lo consulta; Odoo NO maneja inventario |
| **Reserva (estadía)** | **OTASync** (operativa) | Se espeja a Odoo como documento de venta/analítica, ligado al cliente |
| **Cotización** | **Odoo** `sale.order` (o sincronizada desde nuestra UI) | El cliente la ve; se convierte en factura |
| **Factura (DIAN)** | **Odoo** `account.move` | Ligada al cliente; numeración fiscal y e-invoice |
| **Pago** | Wompi/MP (riel) | Conciliado en Odoo (`account.payment`) contra la factura |
| **Evaluación financiera** | **Odoo** (en el cliente: cupo, score, decisión, adjuntos) | La intake/carga de documentos la hace nuestra plataforma |
| **Datos de huésped / check-in / documentos** | Nuestra plataforma (Blobs cifrado + Drive) + SIRE/TRA | Ligados al cliente/reserva |

### 3.2 Topología de integración

Odoo como **hub de back-office**; nuestras Netlify Functions como **capa de
integración** (ya hablan con OTASync, Wompi, Drive — se les añade Odoo).

```
   Web / Motor / Guest app / Bot WhatsApp
                 │  (eventos: lead, reserva, cotización, pago, check-in)
                 ▼
        Netlify Functions  ── capa de integración ──┐
          │                │                        │
          ▼                ▼                        ▼
       OTASync           Wompi/MP                  ODOO  ◀── back-office
   (PMS / channel)      (pagos)            res.partner / sale.order /
   inventario·reservas                     account.move / account.payment
                                           + evaluación financiera + CxC
                                                    │
                                                    ▼
                                        Factura electrónica DIAN (proveedor)
```

- **Conector `_odoo.js`** (nuevo): autenticación + upsert de partner, creación
  de cotización/factura/pago. Odoo expone API externa (XML-RPC o JSON-RPC).
- Disparadores: lead corporativo/larga estadía → partner; reserva pagada
  (`wompi-webhook`) → partner + venta + factura; cotización aceptada → factura;
  reserva de OTA (Booking) → vía webhook OTASync → espejo en Odoo.

### 3.3 Modelo del cliente unificado (`res.partner`)

Un solo registro por persona/empresa, deduplicado por **NIT/cédula + email**:
- Datos base: razón social/nombre, NIT/cédula (`vat`), contacto, email, tel.
- Jerarquía: empresa (parent) ↔ colaboradores/contactos (child) → habilita
  "resumen por colaborador y centro de costos" que promete `empresas.html`.
- Campos de crédito/riesgo: `credit_limit`, score DataCrédito, decisión,
  `payment_terms` (contado / 30 días), vigencia de la evaluación.
- Adjuntos: RUT y Cámara de Comercio del cliente, extractos (cifrados/acceso
  restringido), autorización de habeas data financiero.
- Centro de costos / proyecto para el reporte corporativo.

## 4. Oportunidades de automatización

Las que planteaste + las que detecto, priorizadas:

| # | Automatización | Valor | Fase |
|---|---|---|---|
| A | **Maestro de clientes** (todo cuelga del partner) | Base de todo lo demás | 1 |
| B | **Cotización y factura ligadas al cliente** | Historial, CxC, DIAN | 2 |
| C | **Facturación electrónica DIAN** desde Odoo | Cierra riesgo fiscal | 2 |
| D | **Factura mensual consolidada por empresa** + CxC | Promesa `empresas.html` | 2/4 |
| E | **Evaluación financiera** (DataCrédito + extractos) | Habilita crédito y larga estadía con riesgo controlado | 3 |
| F | **Conciliación de pagos** Wompi/MP → Odoo | Cuadre contable | 4 |
| G | **Espejo de reservas** (directas + OTA) en Odoo | Ingresos por cliente, analítica | 4 |
| H | **Comisiones de OTA** (Booking) como gasto por reserva | Margen real por canal | 4 |
| I | **Contrato de larga estadía** generado + firmado (reusar e-firma) y ligado al cliente | Cierra el ciclo de larga estadía | 3/5 |
| J | **Facturación recurrente** larga estadía (mensual anticipada) | Cobro automático | 5 |
| K | **Portal corporativo self-service** (cotizaciones, reservas, facturas, saldo, descarga de documentos) | Promesa `empresas.html` | 5 |
| L | **Documentos propios** (RUT/Cámara) servidos desde Drive, autoactualizados | Gestión proveedores | 1/2 |

## 5. Evaluación financiera (detalle — punto E)

Hoy: se consulta DataCrédito y se piden extractos por correo; la decisión vive
en la cabeza de alguien. Objetivo: convertirlo en un flujo con registro y un
**modelo de scoring explícito y configurable**.

### 5.1 Flujo

```
Solicitud (larga estadía / crédito empresa)
  → Intake seguro en nuestra plataforma:
       · autorización Habeas Data FINANCIERO (Ley 1266) — explícita
       · carga de extractos / documentos (cifrado, como guest app)
       · creación/match del partner en Odoo
  → Consulta DataCrédito por API (hay contrato) con la autorización
  → Motor de scoring (ver 5.2/5.3) → decisión
  → Registro en el cliente (Odoo): score, decisión, cupo, depósito/garantía,
    payment_terms, vigencia (re-evaluar p. ej. cada 12 meses), adjuntos
  → Gatea: aprobación de larga estadía / habilitar "pago a 30 días"
```

### 5.2 Modelo propuesto — personas (larga estadía)

> Nota: el objetivo correcto es que **la obligación (canon) no supere ~30% del
> ingreso** (= ingreso ≥ ~3,3× el canon), que es el estándar de arrendamiento —
> no al revés. Todos los umbrales son perillas configurables.

5 factores → semáforo → decisión:

| Factor | Peso | 🟢 Verde | 🟡 Amarillo | 🔴 Rojo |
|---|---|---|---|---|
| **Capacidad de pago** (canon / ingreso neto) | alto | ≤ 30% | 30–40% | > 40% |
| **Score DataCrédito** (~150–950) | alto | ≥ 700 | 560–699 | < 560 o mora vigente / reporte negativo activo |
| **Carga financiera total** ((cuotas actuales + canon) / ingreso) | medio | ≤ 50% | 50–65% | > 65% |
| **Estabilidad de ingresos** | medio | empleado indefinido, antigüedad | independiente / nómada con soporte | sin soporte verificable |
| **Validación de extractos** (3 meses) | medio | abonos coinciden con lo declarado, saldo sano | inconsistencias menores | sobregiros recurrentes / no coincide |

**Decisión:**
- **Aprobado:** mayoría verde, sin rojo en capacidad de pago ni en score.
- **Aprobado con garantía** (codeudor, póliza de arrendamiento, o depósito
  mayor): amarillos, o un rojo en carga/estabilidad/extractos.
- **Rechazado:** rojo en capacidad de pago o en score, o mora vigente.

Salida → en el cliente: `decision`, `cupo`, `deposito_requerido`,
`requiere_codeudor`.

### 5.3 Modelo propuesto — empresas (crédito a 30 días)

La pregunta empresarial no es "¿puede pagar una noche?" sino "¿le damos
**crédito** (pagar a 30 días en vez de por adelantado) y por **cuánto cupo**?".

**Factores:**
1. **Existencia y antigüedad** (Cámara de Comercio): empresa constituida, RUT al
   día, objeto social coherente. Antigüedad: ≥ 2 años = sólido · 1–2 años =
   revisar · < 1 año = arrancar en contado o cupo bajo.
2. **DataCrédito Empresas:** score empresarial, moras vigentes, reportes
   negativos, hábito de pago con otros proveedores.
3. **Solvencia / capacidad:** estados financieros o extractos (liquidez,
   endeudamiento); referencias comerciales si las hay.
4. **Volumen esperado con Estar:** cuánto proyecta consumir al mes → el cupo
   debe cubrir ~1–2 meses de ese consumo.

**Asignación de cupo (arranque conservador):**
- Cupo inicial = el **menor** entre (a) un tope fijo prudente y (b) ~1 mes de
  consumo proyectado.
- **Se amplía con historial de pago puntual** (p. ej. tras 3–6 meses sin mora,
  subir el cupo).
- **Política de bloqueo:** si el saldo vivo supera el cupo, o hay factura
  vencida > N días, las nuevas reservas a crédito vuelven a **contado** hasta
  ponerse al día.

**Decisión:**
- **Crédito aprobado** (cupo + plazo 30 días): antigüedad ≥ mínima, sin moras
  vigentes, score aceptable.
- **Crédito condicionado** (cupo bajo, garantía o anticipo parcial): antigüedad
  corta o score medio.
- **Solo contado:** moras vigentes, score bajo o información insuficiente.

**Operativa en Odoo (reutilizamos, no construimos):**
- Cupo → `res.partner.credit_limit`; plazo → `property_payment_term_id` (30 días).
- Odoo ya trae **gestión de crédito y CxC**: alerta al superar el cupo, estados
  de cuenta, *aging*, y **recordatorios de pago automáticos** (follow-ups). Se
  aprovecha en lugar de reconstruirlo.

### 5.4 Automatización y registro

- Consulta DataCrédito por **API** desde la capa de integración (o un módulo
  Odoo a medida — tenemos custom), con la autorización del titular.
- El motor de scoring (5.2/5.3) puede vivir en un **módulo Odoo** (donde está
  contabilidad) o en nuestra capa; el resultado se escribe en el cliente.
- Re-evaluación periódica (vigencia 12 meses) y al renovar larga estadía.

### 5.5 Consideraciones legales y de seguridad (no opcionales)

- **Habeas Data Financiero (Ley 1266 de 2008):** autorización explícita del
  titular para **cada** consulta a DataCrédito — distinta de la Ley 1581
  general. Redactar el texto con el abogado.
- **Extractos bancarios** = dato financiero sensible: cifrado en reposo (como
  guest app), **acceso por rol** en Odoo, política de retención/borrado.
  Alternativa futura a la carga manual: agregadores de open banking
  (Belvo/Truora) — requieren contrato propio.
- **Marketing:** si los clientes entran al CRM para campañas, se requiere
  **autorización de tratamiento con finalidad de marketing** (opt-in), separada
  de la transaccional.

## 6. Plan de trabajo por fases

> Cada fase deja valor por sí sola. Las fases 1–2 son la columna vertebral.

**Fase 0 — Decisiones y fundaciones (sin código).**
Elegir edición/hosting de Odoo, proveedor de e-factura DIAN, modelo de acceso a
DataCrédito; confirmar el mapa de fuente-de-verdad; aprovisionar Odoo + API;
redactar la autorización de habeas data financiero.

**Fase 1 — Maestro de clientes (CRM) + sincronización de contactos.**
- Conector `_odoo.js` (auth + `res.partner` upsert por NIT/email/documento).
- Empujar a Odoo: formulario corporativo (`request-quote`), formulario de larga
  estadía (`vivir`), y huéspedes de reservas pagadas → crear/encontrar partner.
- Backfill: convertir las empresas de las cotizaciones existentes en partners.
- Servir RUT/Cámara propios desde Drive (punto L).

**Fase 2 — Ventas/cotizaciones + facturación ligadas al cliente.**
- Cotización aceptada y pagada (`wompi-webhook` ruta `COT-`) → `sale.order` +
  `account.move` en Odoo sobre el partner, con IVA 19% / INC 8%.
- Reserva directa pagada → factura en Odoo (opcional, según política).
- Emisión de **factura electrónica DIAN** vía localización colombiana.
- Job de **factura mensual consolidada** por NIT.

**Fase 3 — Evaluación financiera + crédito + contrato larga estadía.**
- Intake seguro (autorización + carga de documentos cifrada) → partner en Odoo.
- Consulta DataCrédito (API o tarea manual) → score/decisión/cupo en el cliente.
- Gatear "crédito a 30 días" y aprobación de larga estadía.
- Generar y firmar el contrato (reusar e-firma del guest app), ligado al cliente.

**Fase 4 — Espejo de reservas + CxC + conciliación.**
- Espejar reservas (directas + OTA + cotizaciones) en Odoo ligadas al cliente.
- Conciliar pagos Wompi/MP en Odoo (`account.payment`) contra facturas.
- Comisiones de OTA como gasto por reserva.
- CxC, estados de cuenta por empresa; conciliación a tres bandas
  Wompi↔Odoo↔OTASync (extiende `reconcile-payments`).

**Fase 5 — Portal corporativo + recurrencia.**
- Portal (Odoo o nuestro `empresas`) con cotizaciones, reservas, facturas,
  saldo, descarga de documentos, reportes por centro de costos.
- Facturación recurrente de larga estadía (mensual anticipada).

## 7. Riesgos y dependencias

- **No duplicar inventario:** Odoo NO debe manejar calendario/disponibilidad —
  eso queda en OTASync. Odoo recibe el espejo contable, no opera el inventario.
- **Identidad del cliente:** deduplicación robusta por NIT/cédula para no crear
  partners repetidos (web, OTA, bot crean por distintos canales).
- **Legal financiero:** sin contrato DataCrédito + autorización habeas data
  financiero, la consulta automática no procede (queda manual en Fase 3).
- **Edición de Odoo:** Online (SaaS) no permite módulos a medida; .sh /
  self-host sí. La e-factura DIAN depende de la localización + proveedor.
- **PII sensible:** extractos y datos financieros exigen cifrado, acceso por rol
  y retención definida.

## 8. Decisiones — resueltas y pendientes

**Resueltas (2026-06-16):**
- ✅ Odoo **19 custom** (API + módulos a medida).
- ✅ Facturación ya en Odoo con **Numera**; no construimos DIAN, alimentamos Odoo.
- ✅ **Contrato DataCrédito** → evaluación automatizada por API.
- ✅ Alcance: **todos** los clientes en el maestro (CRM + marketing).
- ✅ Cotizaciones: **sincronizar** desde nuestra UI a Odoo.
- ✅ Criterios de evaluación: modelo propuesto en §5.2/5.3 (ajustar umbrales).

**Pendientes (nuevas, ahora que conocemos el stack):**
1. **Numera ↔ Odoo:** ¿Numera está **integrado dentro de Odoo** (creamos la
   factura/venta en Odoo y Numera la procesa hacia DIAN), o es un sistema
   aparte que Odoo sincroniza? Define dónde y cómo creamos los documentos.
2. **Acceso a Odoo 19:** URL de la instancia, base de datos, y un **usuario
   de integración con API key** (permisos de ventas/contactos/facturación).
   ¿Self-host o Odoo.sh? (para saber cómo desplegar un módulo a medida.)
3. **Producto DataCrédito:** ¿qué producto/API tienen contratado (p. ej. Score,
   Perfil Crédito, DataCrédito Empresas)? Credenciales y documentación del API.
4. **Umbrales del modelo financiero** (§5.2/5.3): confírmame/ajusta los cortes
   (score mínimo, % capacidad de pago, cupo inicial de empresas).
5. **Migración de datos:** ¿hay clientes/cotizaciones/facturas previos (Excel u
   otro) para importar al maestro, o partimos de lo que entre de aquí en
   adelante?
6. **Marketing:** ¿se usará Odoo para campañas (email/CRM)? → necesitamos
   capturar **opt-in de marketing** separado del consentimiento transaccional.

**Arranque recomendado:** **Fase 1 (maestro de clientes)** — el conector
`_odoo.js` + sincronizar contactos. Es la fundación y de bajo riesgo (no toca
dinero todavía); sin el cliente unificado nada de lo demás se cuelga bien.

## 9. Mi recomendación de arranque

1. **Cerrar Fase 0** respondiendo las dudas de §8 (sobre todo edición de Odoo y
   acceso a DataCrédito — son las que bloquean el diseño técnico).
2. **Fase 1 (maestro de clientes)** primero: el conector `_odoo.js` + sincronizar
   contactos. Es la fundación y de bajo riesgo (no toca dinero todavía).
3. En paralelo, ir aterrizando la **autorización legal** (habeas data financiero)
   con el abogado, para no frenar la Fase 3.

> Este documento amplía y reemplaza el punto 1 ("Integración con Odoo") de
> `docs/pendientes.md`. Las decisiones de tarifas/mascota/parqueadero y los
> demás pendientes operativos siguen en ese archivo.

---

## 10. Cómo conseguir el acceso a Odoo (guía paso a paso)

Necesito 4 datos para enchufar la integración. Esto se hace **una vez** en tu
Odoo 19, idealmente con un usuario dedicado a la integración (no el tuyo
personal), para poder revocarlo o auditarlo sin afectar a nadie.

1. **`ODOO_URL`** — la dirección de tu Odoo, p. ej.
   `https://miempresa.odoo.com` (Odoo.sh/Online) o tu dominio si es self-host.
   Sin slash final.

2. **`ODOO_DB`** — el nombre de la base de datos. En Odoo Online suele ser el
   subdominio (la parte antes de `.odoo.com`). Si dudas, se ve en
   **Ajustes → (modo desarrollador) → Información técnica**, o en la pantalla de
   selección de base de datos (`/web/database/selector`).

3. **Usuario de integración** — en **Ajustes → Usuarios**, crear un usuario
   (p. ej. `integracion@estar.com.co`) con permisos de **Contactos**, **Ventas**
   y **Facturación** (los que vayamos necesitando por fase). Ese login es el
   `ODOO_USERNAME`.

4. **`ODOO_API_KEY`** — entrando con ese usuario: **Avatar (arriba a la derecha)
   → Mi perfil / Preferencias → pestaña "Seguridad de la cuenta" → API Keys →
   "Nueva clave API"**. Se genera una clave que **reemplaza la contraseña** para
   las llamadas por API. *(Requiere tener activada la verificación; si no
   aparece la opción, activar el modo desarrollador.)*

Con esos 4 valores los cargo en Netlify (como el resto de credenciales) y el
conector pasa de **mock** a sincronizar de verdad — sin tocar el código.

> **Nota Numera:** Numera está integrado con Odoo (y además gestiona nómina y
> complejidades colombianas como software aparte). Para la facturación,
> partimos del supuesto de que **creamos la venta/factura en Odoo y Numera la
> procesa hacia DIAN**. Lo confirmamos cuando tengas acceso; no bloquea la
> Fase 1 (clientes).
