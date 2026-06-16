# Plan de integración: Odoo + OTASync + desarrollo propio

Arquitectura objetivo y plan de trabajo para unificar el back-office (Odoo),
el PMS/channel manager (OTASync) y la plataforma propia (web, motor de
reservas, guest app, bot), con el **cliente como eje central** y la
**evaluación financiera** (DataCrédito + extractos) integrada al flujo.

Fecha: 2026-06-16 · Estado: propuesta para validar (no implementado).

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

## 5. Flujo de evaluación financiera (detalle — punto E)

Hoy: se consulta DataCrédito y se piden extractos por correo; la decisión vive
en la cabeza de alguien. Objetivo: convertirlo en un flujo con registro.

```
Solicitud (larga estadía / crédito empresa)
  → Intake seguro en nuestra plataforma:
       · autorización Habeas Data FINANCIERO (Ley 1266) — explícita
       · carga de extractos / documentos (cifrado, como guest app)
       · creación/match del partner en Odoo
  → Consulta DataCrédito (API si hay contrato; si no, tarea de consulta manual)
  → Registro en el cliente (Odoo): score, decisión, cupo, vigencia, adjuntos
  → Gatea: aprobación de larga estadía / habilitar "pago a 30 días"
```

**Consideraciones legales y de seguridad (no opcionales):**
- **DataCrédito** (operado por Experian) requiere **contrato con el buró** para
  consultar por API, y **autorización de Habeas Data Financiero (Ley 1266 de
  2008)** del titular para cada consulta — distinta de la Ley 1581 general.
- **Extractos bancarios** = dato financiero sensible: cifrado en reposo, acceso
  por rol en Odoo, política de retención y borrado. Alternativa a la carga
  manual: agregadores de open banking (Belvo, Truora, etc.) — requieren
  contrato propio.
- Definir **quién** puede ver la información financiera (rol restringido).

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

## 8. Dudas y decisiones que necesito de ti

**Sobre Odoo:**
1. ¿Ya tienen instancia de Odoo? ¿Qué edición/hosting — **Odoo Online (SaaS),
   Odoo.sh, o self-host/Community**? (Define si podemos poner módulos a medida.)
2. ¿Ya emiten **factura electrónica DIAN** con algún software/proveedor hoy, o
   arrancamos de cero en Odoo? ¿Qué proveedor tecnológico/PAC prefieren?
3. ¿Quién opera Odoo día a día (contador/equipo)? Define cuánto automatizamos vs
   dejamos nativo de Odoo.

**Sobre clientes y alcance:**
4. ¿El maestro de clientes incluye **solo empresas + larga estadía**, o también
   **cada huésped directo/OTA**? (Recomiendo: todos como partner, con PII mínima
   para los transitorios.)
5. ¿Migramos datos existentes (clientes/cotizaciones/facturas de Excel u otro
   sistema) a Odoo, o partimos limpio?
6. **Cotizaciones:** ¿migramos el motor de cotizaciones a `sale.order` de Odoo,
   o mantenemos nuestra UI actual (con holds en OTASync) y la **sincronizamos**
   a Odoo? (Sincronizar es más rápido; migrar es más "Odoo nativo".)

**Sobre evaluación financiera:**
7. ¿Tienen **contrato/API con DataCrédito (Experian)** o lo consultan por portal
   manualmente? (Define si la Fase 3 automatiza la consulta o solo la registra.)
8. Extractos bancarios: ¿seguimos con **carga manual** del documento, o evalúan
   un agregador de **open banking** (Belvo/Truora)?
9. ¿Qué criterios definen la **viabilidad/cupo** hoy? (Para poder modelarlos:
   score mínimo, ingresos vs canon, etc.)

**Sobre prioridad:**
10. ¿Por dónde arrancamos? Mi recomendación: **Fase 0 (decisiones) → Fase 1
    (maestro de clientes)** como base, porque sin el partner unificado nada de lo
    demás (facturas, evaluación, CxC) se puede colgar correctamente.

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
