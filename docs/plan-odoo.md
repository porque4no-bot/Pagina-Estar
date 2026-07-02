# Plan maestro de Odoo — Hotel Estar

> Qué se puede hacer con Odoo para sacarle el máximo, **sin tocar la facturación
> DIAN** (la cierra el otro equipo / Numera) ni el PMS (OTASync sigue dueño de
> inventario, calendario, tarifas y reservas). Documento de planeación: el dueño
> decide qué se construye y qué no. Base: auditoría en vivo (solo lectura) del
> Odoo real + investigación de capacidades + cruce con los datos del sitio
> (workflow `estar-odoo-plan-maestro`, 2026-06-21).

## La visión en una frase
Odoo se vuelve el **back-office vivo** de Hotel Estar: un único maestro de
clientes (`res.partner`) del que cuelgan CRM, marketing con permiso, operación
(PQR, mantenimiento, housekeeping, turnos) y costeo del desayuno/amenidades —
sin duplicar el PMS ni la facturación.

## Qué encontramos en tu Odoo (auditoría real)
- **Odoo 19 Enterprise (SaaS), multiempresa**: 4 compañías comparten la instancia con el equipo de facturación. **MIRADA S.A.S = company 5** (NIT 902032515-0), que es la que usa la integración (`ODOO_COMPANY_ID=5`).
- **Ya instalado y aprovechable sin costo extra** (licencia *Custom*): CRM, **Email Marketing**, **Marketing Automation**, **SMS Marketing**, **WhatsApp Messaging**, Contactos/Portal, Documents, Knowledge, Website, Calendar, Spreadsheet/Dashboards, UTM/Link tracker, 2FA/Passkeys.
- **Facturación viva** (del otro equipo): localización colombiana completa — `l10n_co_dian` (DIAN), `l10n_co_edi` (Carvajal), `account` con **109 facturas** en Mirada. **No se toca** (a lo sumo se LEE para enriquecer la ficha del cliente).
- **NO instalado** (habría que activarlo, lo cubre la licencia): Surveys (NPS), Project, Helpdesk, Planning/Field Service, Inventory, Purchase, Sign, eLearning. **No existen** `sale.order` ni `sale.subscription` (pertenecen al flujo de facturación → cotizaciones/reservas se mapean a CRM, no a documentos de venta).
- **Datos hoy**: `res.partner` = 1108 (114 en Mirada), **`crm.lead` = 103**, esquema de contacto **vanilla** (0 campos personalizados). Embudo CRM con 4 etapas default. **1 lista de Newsletter** (1 contacto). **7 etiquetas** que ya cubren canales de hotel: *Reserva Directa, Booking.com, Airbnb, Corporativo, Larga estadía, Huésped histórico*.
- **Lo que ya sincroniza la web** (`_odoo.js`): `upsertPartner` (cliente único deduplicado por NIT/email, con etiquetas) desde web/cotización/larga estadía/reservas OTA, y `createLead` (oportunidad CRM) desde cotización corporativa y larga estadía.

---

## Las 6 fases

### Fase 1 — Embudo CRM + enriquecer el contacto  *(lo que pediste arrancar · 0 apps nuevas)*
**Meta:** que ningún interés ni huésped se pierda — todo entra como contacto enriquecido y oportunidad en un embudo que ventas trabaja.
- **[YA] Embudo CRM de hotel** — renombrar/ampliar las 4 etapas default a etapas de hotel: *Solicitud → Calificado → Cotización enviada → Negociación/Contrato → Ganado/Perdido*, con **motivos de pérdida**. Convierte los negocios B2B y de larga estadía (hoy en correos sueltos) en un pipeline medible. *(Decisión: nombres finales de etapas + motivos de pérdida.)*
- **[YA] Enriquecer el contacto (campos de hotel)** — agregar a la ficha: canal, último checkout, noches estimadas, presupuesto, motivo de viaje. La web ya tiene esos datos y los escribiría. Es la base del scoring y de la automatización post-estadía. *(Decisión: qué campos exactos quieres ver.)*
- **[YA] Cerrar el uso de las 7 etiquetas de canal** en cada flujo entrante (directo/OTA/corporativo/larga estadía) — segmentación gratis para marketing y reportes.
- **[Después] Lead scoring básico** por noches/presupuesto/canal — priorizar a quién llamar primero (Odoo 19 trae ayuda de IA para esto).

### Fase 2 — Cerrar las fugas de captura  *(formularios que hoy NO llegan a Odoo)*
**Meta:** que todo contacto entrante caiga en el maestro/CRM, respetando consentimiento.
- **[YA] Sincronizar el Newsletter** (con su checkbox de habeas data) a una lista de marketing en Odoo. Es la **única fuente con permiso legal limpio** para email marketing y hoy no tiene conexión.
- **[YA] Sincronizar el form de Contacto** (contacto.html) como contacto/lead — hoy se queda solo en Netlify. *(Decisión: ¿crea oportunidad o solo contacto?)*
- **[YA] Decidir "Trabaja/Empleo"** — recomendación: **NO** meterlo al CRM comercial (es dato de empleo); si se sistematiza, va en HR/Recruiting. *(Decisión: ¿sistematizar reclutamiento?)*

### Fase 3 — Marketing con permiso: reserva directa + automatización + NPS
**Meta:** empujar reserva directa (ahorrar comisión OTA) y reactivar huéspedes, **solo sobre contactos con opt-in**.
- **[Bloqueado por consentimiento] Campaña "reserva directa"** a los ~87 *Huéspedes históricos* — el caso más rentable (cada reserva directa ahorra comisión de Booking/Airbnb), **pero** ese backfill no tiene opt-in de marketing → hay que legitimarlo primero (ver decisiones).
- **[Después] Newsletter mensual de Manizales** a la lista con opt-in — fideliza y empuja reserva directa.
- **[YA] Nurturing automático** de leads B2B/larga estadía que no cierran (día 0/3/7) con Marketing Automation (ya instalado).
- **[Instalar Surveys] NPS / encuesta post-estadía** automática a los 2 días del checkout: nota baja → alerta para llamar; nota alta → pedir reseña en Booking/Google.

### Fase 4 — Operación interna que hoy no tiene sistema  *(requiere instalar apps, sin costo de licencia)*
**Meta:** dar sistema a PQR, mantenimiento, housekeeping y turnos. No toca dinero ni PMS.
- **[Instalar Project]** pendientes internos y tareas recurrentes (extintores, RUT, inventario de amenidades).
- **[Instalar Helpdesk]** PQRSD centralizadas con alias de correo (`soporte@…`) y SLA, ligadas al cliente.
- **[Instalar Planning + Field Service]** housekeeping y mantenimiento como órdenes (checklist, fotos, materiales) + turnos del personal. *Limitación: OTASync no da limpio el roster del día → la agenda se alimenta por evento de reserva.*

### Fase 5 — Costear el desayuno y amenidades  *(cruza con el conteo QR que ya existe)*
**Meta:** saber el **margen real** del desayuno ($20k cobrados vs costo de insumos).
- **[Instalar Inventory]** stock de insumos (café, huevos, pan, kits de aseo) con reglas min/max; cada desayuno servido (que el QR ya cuenta) descuenta insumos.
- **[Instalar Purchase]** formalizar compras recurrentes. *Frontera: la factura del proveedor la contabiliza el otro equipo — nuestro alcance llega a compras+recepciones.*

### Fase 6 — Apoyo a larga estadía y personal  *(condicionada)*
- **[Instalar Sign]** firma de contratos de larga estadía / convenio corporativo (coexiste con la e-firma del check-in).
- **[Instalar eLearning]** onboarding del personal (resuelve el pendiente "onboarding QR no existe").
- **[Instalar Documents]** repositorio de RUT/Cámara/contratos de empresas. **NO** mover aquí la PII de huéspedes sin auditoría.
- **[EN PAUSA] Subscriptions** (canon recurrente de larga estadía) — bloqueado por la frontera de facturación; solo coordinado con el otro equipo.

---

## 🥇 Quick wins (mayor valor / menor esfuerzo, construibles ya)
1. Renombrar/ampliar el embudo CRM a etapas de hotel + motivos de pérdida.
2. Sincronizar el Newsletter (opt-in) a una lista de marketing en Odoo.
3. Cerrar el uso de las 7 etiquetas de canal en cada flujo entrante.
4. Agregar campos de hotel a la ficha del cliente (canal, último checkout, noches, presupuesto, motivo).
5. Conectar los forms de Contacto (y decidir Trabaja) que hoy se pierden.

## 🚫 Fuera de alcance (otro equipo / no migrar)
- Facturación DIAN (`account.move`) y crear `sale.order`/`sale.subscription` → equipo de facturación (Numera). A lo sumo **leer** facturas para la ficha del cliente.
- Inventario de habitaciones, calendario, tarifas, disponibilidad y reservas → viven en **OTASync**.
- La web propia y el motor de reservas → **no** migrar a Odoo Website/eCommerce.
- PII de identidad del huésped (documentos de check-in) → sigue cifrada en Blobs+Drive (Ley 1581); no pasa a Documents sin auditoría.
- Marketing a contactos **sin opt-in** (sobre todo el histórico) → prohibido por Ley 1581 hasta legitimar la base.
- Nómina → otro sistema.

## ✅ Decisiones para el dueño
1. **Consentimiento de marketing (lo más importante):** el histórico (~87 contactos) NO tiene opt-in. ¿Re-consentir por correo y marketear solo a quien acepte, o limitar a quienes den opt-in nuevo? **Sin base legal no se les puede escribir.**
2. Nombres finales de las etapas del CRM + catálogo de motivos de pérdida.
3. Qué campos de hotel quieres ver en la ficha del cliente.
4. ¿Aprobar instalar apps nuevas (Surveys, Project, Helpdesk, Planning/Field Service, Inventory, Purchase, Sign, eLearning, Documents)? Todas cubiertas por la licencia (costo = configuración/contenido; SMS consume créditos de pago).
5. ¿Sistematizar reclutamiento (form "trabaja")? Si no, queda fuera de Odoo.
6. Field Service/Planning: ¿quién es el personal y cómo alimentamos el calendario de checkouts?
7. Coordinar con facturación la frontera de Purchase/Inventory antes de activar conciliación.
8. **SMS:** recomiendo WhatsApp como canal principal (ya montado, mejor en Colombia) y SMS solo para cobranza B2B puntual.
9. **Website/eCommerce:** recomiendo **NO** instalarlo (duplicaría lo propio).

## Secuencia recomendada
**F1** (CRM + enriquecer) → **F2** (tapar fugas de captura) → **F3** (marketing con permiso + NPS) → **F4** (operación) → **F5** (costeo desayuno) → **F6** (apoyo larga estadía/personal). Cada fase deja valor por sí sola. Transversal: aterrizar con el abogado el opt-in/habeas data antes de cualquier campaña.

---

## Roadmap de producto y CRM (ideas del dueño, 2026-06-21)
Direcciones nuevas que se incorporan al plan (requieren definición de negocio antes de construir; varias son comerciales, no solo técnicas):

- **Pipelines por tipo de cliente:** el CRM permite **embudos separados** según perfil — larga estadía, **grupos**, **agencias de viajes**, corporativo, **comisionistas** — cada uno con sus etapas. Se personaliza el flujo por tipo (no todos siguen el mismo camino).
- **Producto "bolsas de noches"** *(idea destacada del dueño):* paquetes de N noches prepagadas para **viajeros frecuentes** que no se quedan un mes corrido pero sí varias veces al año. Es producto + comercial + técnico (cómo se vende, se consume y se controla el saldo de noches). Definir antes de construir.
- **Reservas de grupos:** flujo y cotización específicos para grupos (varias habitaciones/fechas).
- **Analítica por perfil:** estadísticas dentro de la cotización por tipo (agencias, empresas, grupos, comisionistas) — conversión, valor medio, recurrencia.
- **Servicios auxiliares a futuro:** tours, transporte, eventos — pensar desde ya cómo se incorporan al catálogo/cotización/CRM para no rehacer.
- **Comisionistas:** son un actor con el que se trabaja → modelarlos como un tipo de contacto/rol comercial en Odoo (comisiones, atribución de reservas).
- **Ficha del cliente — campos adicionales pedidos:** además de canal/último checkout/noches/presupuesto/motivo → **total facturado**, **valor medio pagado**, nº de estadías, recurrencia, perfil (huésped/agencia/empresa/grupo/comisionista). (El "total facturado" requiere la lectura de `account.move` que se coordina con Numera.)

### Decisiones del dueño ya tomadas sobre el plan (2026-06-21)
- Re-consentir al histórico con un correo + **descuento** (→ motor de descuentos, `docs/plan-marketing-descuentos.md`).
- **WhatsApp** para toda interacción; **SMS** solo cobranza B2B puntual.
- **Reclutamiento (form "trabaja") SÍ** → Odoo Recruiting (`hr.applicant`), no al CRM comercial.
- **Website: mantener en Netlify** (no migrar a Odoo) — confirmado.
- Personal hoy = 1 camarera; **estructurar Field Service/Planning pensando en el hotel de Medellín** (más grande).
- **Desayuno tercerizado** (sin recetas) → Inventory solo para amenities, no cocina.
- Reportería / conciliación bancaria / cierres de caja / cruce de cuentas de los 2 locales → coordinar con **Numera** (`docs/preguntas-numera.md`).
