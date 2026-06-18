# Documentación de Hotel Estar

Índice de la documentación del proyecto. Edita siempre el documento que
corresponde a cada tema (no dupliques estado entre archivos).

## Por dónde empezar

| Si quieres… | Lee |
|---|---|
| Entender la arquitectura completa (código, funciones, comandos) | [`../CLAUDE.md`](../CLAUDE.md) |
| Ver el estado del sistema de un vistazo (qué está en prod / construido / pendiente) | [`resumen-sistema.md`](resumen-sistema.md) |
| Saber **qué falta por hacer** (la lista viva) | [`pendientes.md`](pendientes.md) |

## Referencia técnica

- [`../CLAUDE.md`](../CLAUDE.md) — arquitectura, páginas, funciones serverless, build, variables de entorno.
- [`../AGENTS.md`](../AGENTS.md) — guía para agentes cloud (qué corre en qué puerto, validación).
- [`resumen-sistema.md`](resumen-sistema.md) — mapa de estado por colores + checklist de validación.

## Integración con el PMS (Kunas / OTASync)

- [`configuracion-kunas.md`](configuracion-kunas.md) — cómo configurar Kunas para que cuadre con la web (lenguaje de negocio, paso a paso).
- [`kunas-api.md`](kunas-api.md) — notas de la API de Kunas/OTASync (del proyecto).
- [`OTASync-Public-API.md`](OTASync-Public-API.md) — referencia **completa** de la API del vendor (auth, disponibilidad, reservas, extras, webhooks…).

## Guest app y cumplimiento

- [`guest-app.md`](guest-app.md) — check-in digital, OCR, pedidos, archivado.
- [`firma-electronica-colombia.md`](firma-electronica-colombia.md) — cómo cumple la firma electrónica del contrato (Ley 527, evidencia, retención 5 años).

## Bot de WhatsApp

- [`whatsapp-bot.md`](whatsapp-bot.md) — arquitectura, modo IA (Claude), credenciales y setup.
- [`bot-conocimiento.md`](bot-conocimiento.md) — base de conocimiento/FAQ que usa el bot (datos por confirmar marcados ⚠️).

## Integración Odoo (ERP / contabilidad)

- [`plan-integracion-odoo-otasync.md`](plan-integracion-odoo-otasync.md) — arquitectura, plan por fases, modelo de evaluación financiera y **estado de ejecución** (Fase 1 hecha). Template de credenciales local: `odoo-local.env.example`.

## Pruebas y despliegue

- [`testing.md`](testing.md) — plan de pruebas y matriz manual antes de producción.
- [`testing-production.md`](testing-production.md) — sandbox vs. producción de pagos (Netlify per-context), webhooks, rollback.

---

> **Nota de mantenimiento (2026-06-18):** se consolidaron en `pendientes.md` y se
> eliminaron del repo cuatro informes de trabajo cuyo contenido ya se ejecutó
> (auditoría 360° de seguridad, evaluación de customer journey, dudas de
> implementación y revisión legal) y el handoff `continuacion-odoo.md` (fusionado
> en `plan-integracion-odoo-otasync.md`). El historial sigue en git.
