# Plan de pruebas de Estar

## Objetivo

Validar la web pública, el motor de reservas y la Guest App antes de cada despliegue. Las pruebas automáticas no deben usar documentos, reservas, tarjetas ni datos personales reales.

## Comandos

```bash
npm test
npm run test:unit
npm run test:e2e
npm run test:smoke
npm run test:report
```

- `test:unit`: compila el sitio, revisa enlaces, recursos, metadata, configuración y funciones críticas.
- `test:e2e`: ejecuta los recorridos en Chromium de escritorio y móvil.
- `test:smoke`: prueba rápida del sitio público en escritorio.
- `test:report`: abre el reporte HTML de Playwright.

## Pruebas automáticas

### Web global

- El build termina sin errores.
- Las páginas públicas principales existen.
- Todos los enlaces y recursos internos de los HTML compilados resuelven a archivos.
- Cada página tiene `lang`, `title` y viewport.
- La portada carga sin errores de JavaScript.
- El formulario principal conserva fechas y huéspedes al abrir el motor de reservas.
- Las páginas de reservas, exploración, privacidad, inglés y Guest App responden.
- La navegación móvil puede abrirse.

### Guest App

- Inicio de sesión correcto y persistencia de sesión al recargar.
- Error visible para una reserva inexistente.
- Carga y análisis de documento.
- Autocompletado de campos extraídos.
- Envío del pre check-in con autorización Bearer.
- Firma del contrato.
- Pedido de servicios adicionales con cantidades correctas.
- Solicitud al concierge.
- Firma y validación de tokens temporales.
- Protección del webhook de Drive.
- Rechazo de respuestas HTML o de login devueltas por Apps Script.
- Variables y headers de seguridad requeridos.

## Matriz manual antes de producción

### Sitio público

| Prioridad | Prueba | Resultado esperado |
| --- | --- | --- |
| P0 | Reserva completa en escritorio y móvil | Disponibilidad, habitación, datos y pago avanzan sin perder información |
| P0 | Pago Wompi en sandbox | Retorno exitoso, pendiente y fallido actualizan la reserva correctamente |
| P0 | Reserva creada en OTASync | Fechas, huésped, habitación, precio y referencia coinciden |
| P1 | Navegación ES/EN | Enlaces, textos y páginas conservan el idioma |
| P1 | Formularios de contacto y empresas | Se registra el envío y llega la notificación |
| P1 | Responsive 360, 768, 1024 y 1440 px | No hay desbordamientos, controles ocultos ni texto cortado |
| P1 | Accesibilidad por teclado | Menú, formularios y botones operan sin ratón y muestran foco |
| P2 | SEO | Canonical, sitemap, robots, titles y descriptions son correctos |
| P2 | Rendimiento | Imágenes WebP, video y fuentes no bloquean la interacción principal |

### Guest App

| Prioridad | Prueba | Resultado esperado |
| --- | --- | --- |
| P0 | Reserva real válida e inválida | Solo el código y apellido correctos abren la estancia |
| P0 | Documento JPG, PNG y PDF | Azure extrae datos o permite corrección manual |
| P0 | Documento mayor de 4.5 MB | Se rechaza antes de enviarlo |
| P0 | Documento vencido | Se muestra advertencia y no se completa el check-in |
| P0 | Campos y privacidad incompletos | No se puede enviar el check-in |
| P0 | Archivo en Drive | Se crea carpeta de reserva con metadata y documento correcto |
| P0 | Firma de contrato | Se genera PDF con reserva, firmante, fecha, versión y evidencia |
| P0 | Evento OTASync | El evento queda en cola y llega la notificación administrativa |
| P1 | Servicios adicionales | El servidor recalcula cantidades y total; no confía en precios del navegador |
| P1 | Concierge y cambios | La solicitud queda asociada a la reserva correcta |
| P1 | Solicitud de factura | Queda registrada y el PDF se archiva cuando esté disponible |
| P1 | Cerrar sesión y expiración | Se elimina la sesión y un token vencido no vuelve a entrar |
| P1 | Móvil y cámara | La carga de documento funciona desde galería/cámara con consentimiento |
| P2 | Reintentos de Azure, Drive y OTASync | Un fallo externo se informa y no produce registros duplicados |

## Datos de prueba

- Mantener una reserva de sandbox exclusiva para QA.
- Usar imágenes ficticias de documentos, nunca identificaciones reales.
- Usar correos con dominio de pruebas y teléfonos no reales.
- Ejecutar pagos únicamente con credenciales y tarjetas sandbox.
- Borrar expedientes de prueba de Drive después de cada ciclo.

## Criterio de salida

Un despliegue puede pasar a producción cuando:

1. `npm test` termina sin fallos.
2. Todas las pruebas manuales P0 están aprobadas.
3. No hay secretos ni documentos reales en Git, logs o reportes.
4. Azure, Drive, OTASync, correo y pagos responden en el entorno de pruebas.
5. Cualquier prueba P1 pendiente tiene responsable, riesgo documentado y fecha de corrección.
