# Chatbot de WhatsApp (Cloud API de Meta)

Asistente conversacional sobre el número de WhatsApp del hotel, integrado con
el mismo backend del sitio: disponibilidad y precios en vivo desde
OTASync/Kunas, consulta de reservas con segundo factor y solicitudes de
cancelación auditadas.

## Arquitectura

```
Meta Cloud API ──POST──▶ /api/whatsapp-webhook   (firma X-Hub-Signature-256,
                              │                    dedupe por wamid, 200 rápido)
                              ▼
                        _whatsapp-bot.js          (máquina de estados, copy ES/EN,
                              │                    sesiones en Blobs 30 min)
        ┌─────────────────────┼──────────────────────────┐
        ▼                     ▼                          ▼
 _otasync.getDynamicPricing   request-cancellation       _email.sendEmail
 (disponibilidad/precios)     (lookup + solicitud)       (handoff a humano)
                              ▲
 Respuestas salientes ◀── _whatsapp.js (sendText / sendButtons / sendList /
                           sendTemplate / markRead — Graph API v25.0)
```

| Archivo | Rol |
|---|---|
| `netlify/functions/whatsapp-webhook.js` | Receptor: handshake GET (`hub.challenge`), validación de firma del POST, dedupe, enrutado al bot |
| `netlify/functions/_whatsapp.js` | Cliente Graph API: texto, botones (máx 3, títulos ≤20), listas (≤10 filas), plantillas, mark-as-read. Sin credenciales = mock logueado |
| `netlify/functions/_whatsapp-bot.js` | Conversación: menú, flujo de reserva (fechas → huéspedes → disponibilidad real + deep link a `reservar.html`), gestión de reserva (código + apellido/email), cancelación, info (vivir/empresas/check-in/ubicación), handoff a humano |
| `netlify/functions/whatsapp-probe.js` | Health check admin (Firebase auth): config presente + verificación del número contra Graph |

## Modo IA (Claude)

Con `ANTHROPIC_API_KEY` configurada, la conversación deja de ser un árbol de
menús: **Claude** (`claude-haiku-4-5` por defecto — rápido y económico para chat; configurable) entiende
lenguaje natural en español/inglés, responde preguntas generales del hotel y
actúa a través de cuatro herramientas que reutilizan la lógica de negocio
existente:

| Tool | Qué hace |
|---|---|
| `check_availability` | Disponibilidad y precios en vivo desde OTASync + enlace de reserva con fechas precargadas. El modelo tiene prohibido citar precios de memoria |
| `lookup_booking` | Consulta de reserva con el mismo segundo factor de `get-booking` (la verificación vive en la herramienta, no en el prompt) |
| `request_cancellation` | Solicitud de cancelación auditada (núcleo compartido con la web), solo tras confirmación explícita del huésped |
| `notify_team` | Escala a humano con resumen accionable (cotizaciones de larga estadía/empresas, quejas, problemas de pago, o cuando el huésped lo pide) |

Detalles de implementación (`_whatsapp-ai.js`):
- **Loop manual de tool use** (Messages API) con máximo 5 iteraciones por
  mensaje. En modelos que lo soportan (Opus 4.6+/Sonnet 4.6) se activa
  adaptive thinking con `effort: low`; en Haiku esos parámetros se omiten
  automáticamente (`modelParams`).
- **Memoria**: turnos de texto (sin bloques de tools) en la sesión de Blobs,
  ventana de 20 mensajes, TTL 30 min.
- **Prompt caching**: tools + system prompt estables con breakpoint
  `cache_control`; lo único volátil es la fecha (precisión día).
- **Guardrails**: precios solo por herramienta, pago solo en la web, segundo
  factor obligatorio para datos de reservas, sin datos de pago por chat,
  instrucción anti-inyección, y `stop_reason: refusal` manejado con mensaje
  de fallback.
- **Degradación**: sin API key o ante cualquier error del modelo, el bot cae
  a la máquina de estados determinista (los menús de abajo). La palabra
  *agente* escala a humano por código, sin pasar por el modelo.
- **Modelo**: `claude-haiku-4-5` por defecto — prioriza latencia (timeout de
  functions de Netlify, experiencia de chat) y costo (5× más barato), con
  calidad sobrada para un dominio acotado donde la seguridad vive en las
  herramientas. Para máxima calidad conversacional, `WHATSAPP_AI_MODEL=claude-opus-4-8`
  (los parámetros thinking/effort se adaptan solos al modelo). Si las
  respuestas se cortan por timeout del function, subir el timeout en Netlify
  o bajar `WHATSAPP_AI_TIMEOUT_MS`.

## Flujos implementados (modo determinista / fallback)

- **Menú principal** (botones): Reservar · Mi reserva · Más opciones.
- **Reservar**: pide fechas (`15/08 al 18/08`, `del 15 al 18 de agosto`, ISO),
  número de personas (1–6), consulta OTASync en vivo, responde tipologías
  disponibles con precio por noche y enlace profundo
  `reservar.html?checkin=…&checkout=…&guests=…` (el motor ya lee esos params).
- **Mi reserva**: código + apellido/email (mismo gate anti-enumeración de
  `get-booking`); muestra estado y ofrece **Solicitar cancelación**, que usa el
  mismo núcleo `submitCancellationRequest` de la web (correo al equipo +
  acuse al huésped + auditoría en Blobs).
- **Más opciones** (lista): Estadías largas, Empresas y grupos, Check-in y
  horarios, Ubicación, Hablar con el equipo.
- **Handoff a humano** (`agente`, `asesor`, botón): notifica a
  `ADMIN_NOTIFY_EMAIL` con número, nombre de perfil y último mensaje; el
  equipo responde desde su bandeja de WhatsApp Business (coexistencia
  app + API es posible desde 2026 en el mismo número).
- **Idioma**: ES por defecto; detecta EN por palabras clave y responde en
  inglés. Todo el copy vive en `STRINGS` (`_whatsapp-bot.js`).

## Variables de entorno

```
WHATSAPP_TOKEN=             # token permanente de system user (Meta)
WHATSAPP_PHONE_NUMBER_ID=   # id del número en Cloud API (no es el número)
WHATSAPP_APP_SECRET=        # App secret — firma X-Hub-Signature-256
WHATSAPP_VERIFY_TOKEN=      # string arbitrario para el handshake del webhook
WHATSAPP_GRAPH_VERSION=     # opcional, default v25.0
WHATSAPP_BOT_ENABLED=       # 'true' para que el bot responda (kill switch)

# Modo IA (Claude)
ANTHROPIC_API_KEY=          # habilita el modo IA; sin ella, menús deterministas
WHATSAPP_AI_MODEL=          # opcional, default claude-haiku-4-5
WHATSAPP_AI_EFFORT=         # opcional: low (default) | medium | high
WHATSAPP_AI_MAX_TOKENS=     # opcional, default 8000
WHATSAPP_AI_TIMEOUT_MS=     # opcional, default 50000
```

Sin `WHATSAPP_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` todo envío es un no-op
logueado (`isMock`), igual que el resto de funciones sin credenciales. El
webhook **rechaza** POSTs si `WHATSAPP_APP_SECRET` no está configurado
(fail-safe, mismo criterio que `otasync-webhook`).

## Checklist de credenciales (lo que debe entregar el propietario)

1. **Meta Business Portfolio** con **verificación de negocio** completada
   (necesaria para producción y el límite de 100K msg/día de 2026).
2. App de developers tipo *Business* con el producto **WhatsApp** añadido.
3. Desde el dashboard: **`PHONE_NUMBER_ID`**, **`WABA_ID`**, **App ID** y
   **App Secret**.
4. **Token permanente**: Business Settings → System Users → crear system user
   (Admin) → asignar app + WABA → generar token con scopes
   `whatsapp_business_messaging` + `whatsapp_business_management`, sin
   expiración. (Los tokens del dashboard caducan en ~24 h.)
5. **Webhook**: App Dashboard → WhatsApp → Configuration → Callback URL
   `https://estar.com.co/api/whatsapp-webhook`, verify token =
   `WHATSAPP_VERIFY_TOKEN`, suscripción al campo **`messages`**.
   ⚠ Pitfall conocido (UI 2026): la WABA puede quedar sin vincular a la app —
   confirmar con `POST /{WABA_ID}/subscribed_apps` y verificar con GET.
6. **Número**: puede usarse el actual (+57 310 249 0414) — desde enero 2026
   la Cloud API coexiste con la app de WhatsApp Business en el mismo número.
7. Aprobación del **display name** y método de pago en WhatsApp Manager
   (solo necesario para plantillas de pago).

## Desarrollo sin credenciales de producción

Meta provee un **número de prueba gratuito** al añadir el producto WhatsApp:
plantilla `hello_world` pre-aprobada, webhooks completos, hasta 5 números
destinatarios verificados por OTP. Se puede validar todo el bot contra ese
número y luego cambiar `PHONE_NUMBER_ID` + token por los de producción.
`GET /api/whatsapp-probe` (admin) confirma que las credenciales resuelven.

## Costos y ventana de 24 horas

- Mensajes de **servicio** (respuestas libres dentro de las 24 h desde el
  último mensaje del huésped): **gratis**. Todo el tráfico del bot de
  recepción cae aquí.
- Fuera de la ventana solo se pueden enviar **plantillas** aprobadas
  (modelo por-mensaje desde julio 2025: utility dentro de ventana gratis;
  marketing/utility fuera de ventana se cobran por mensaje).
- `sendTemplate()` ya está implementado para la fase 2 (ver roadmap).

## Roadmap (fase 2)

- Plantillas utility: confirmación de reserva por WhatsApp, recordatorio
  pre-llegada con link del guest app, aviso post-pago.
- Notificación al bot cuando el webhook de Wompi confirma una reserva
  (mensaje proactivo con código y fechas — requiere plantilla aprobada).
- Cotizaciones de estadías largas guiadas (hoy: info + handoff).
- Bandeja/inbox para el handoff (hoy: email al equipo + respuesta manual
  desde la app de WhatsApp Business).
- Soporte BSUID (usernames de WhatsApp, rollout 2026): no asumir que `from`
  es siempre un número de teléfono.
