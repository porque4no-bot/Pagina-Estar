# Variables a cargar en Netlify — explicadas

Estas son las **variables NUEVAS** (las que aún no tienes en Netlify). Tu sitio
funciona sin ellas; sirven para **encender las funciones nuevas**. Cada función
está apagada hasta que agregues su variable.

> Cómo cargarlas: Netlify → tu sitio → **Site configuration → Environment
> variables → Add a variable**. Pones el **Key** (el nombre) y el **Value**.

> **NUEVO (2026-06-22): la mayoría de los interruptores ya NO necesitan tocarse
> en Netlify.** Hay una pestaña **Configuración** en el panel `/admin` (permiso
> `settings.manage`) que prende/apaga **17+ toggles** con un clic y un botón ℹ
> que explica cada uno (correos pre-llegada/post-estadía, nota del huésped al PMS,
> respaldo diario, códigos de descuento, cargo al folio del guest app, agregar
> desayuno desde el comedor, chapas TTLock, bot de WhatsApp, tickets Helpdesk,
> encuesta NPS, etc.). El override del panel **manda sobre** la variable de
> Netlify (si el panel no tiene valor, cae a la variable). Lo que SÍ se sigue
> cargando en Netlify son los **secretos y credenciales** (claves, tokens, URLs):
> el panel **nunca** gestiona secretos. Regla simple: *toggle de sí/no → panel;
> credencial/secreto → Netlify.*

---

## A. Para encender las funciones nuevas (decides cuáles y cuándo)

> Los que tienen **(panel)** se pueden prender desde `/admin → Configuración` sin
> tocar Netlify. Si prefieres, también funcionan como variable de entorno (el
> panel manda sobre la variable). Los que NO tienen **(panel)** son secretos/datos
> y **sí** van en Netlify.

| Variable (Key) | Valor | Qué hace | ¿Prender ahora? |
|---|---|---|---|
| `BACKUP_ENABLED` **(panel)** | `true` | Respaldo automático **diario** de la info que vive solo en la nube (cotizaciones, reembolsos, desayunos, datos de huéspedes). Protege contra borrados accidentales. | ✅ **Recomendado ya** |
| `STAY_EMAILS_ENABLED` **(panel)** | `true` | Correos automáticos al huésped: **"te esperamos"** (1–2 días antes de llegar) y **"gracias por tu estadía"** (al día siguiente de irse). | ⏳ Tras probar con una reserva real |
| `REVIEW_LINK_URL` | tu enlace de reseñas (Google/Booking) | El botón "deja tu reseña" del correo post-estadía apunta a ese enlace. | Opcional (junto con el anterior) |
| `GUEST_NOTES_TO_PMS_ENABLED` **(panel)** | `true` | Hace que la **nota/solicitud** que el huésped escribe al reservar (ej. "llego tarde", "piso alto") **llegue a la reserva en Kunas**. | ⏳ Tras probar con una reserva real |
| `REFUND_BANK_FORM_ENABLED` **(panel)** | `true` | Prende el **formulario** donde el huésped registra su cuenta bancaria para recibir un reembolso por transferencia. | ⏳ Cuando empieces a usar reembolsos |
| `REFUND_LINK_SECRET` | un texto largo aleatorio (ej. 40+ caracteres) | Clave secreta que **firma el enlace seguro** de ese formulario (para que nadie lo adivine). Si no la pones, reutiliza otra que ya tienes y funciona igual. | Junto con el anterior |
| `REFUND_GATEWAY_AUTO_ENABLED` **(panel)** | `true` | Cuando apruebas un reembolso de **Mercado Pago** en el panel, se ejecuta **solo** (vía API). Wompi NO tiene API de reembolso → sigue siendo ticket manual. | ⏳ Solo si usas Mercado Pago |
| `DISCOUNT_CODES_ENABLED` **(panel)** | `true` | Prende el **motor de códigos de descuento**: el campo "código" en el motor de reservas + la validación de cupones. Los cupones se crean en `/admin → Códigos`. | Opcional (cuando lances promos) |
| `QUOTE_EXPIRY_REMINDER_ENABLED` **(panel)** | `true` | Correo automático **"tu cotización vence pronto"** a los clientes de cotizaciones, un día antes de que expire. | Opcional |

### Opcionales avanzadas (de respaldo)
| Variable | Valor | Qué hace |
|---|---|---|
| `BACKUP_TO_DRIVE` | `true` | Además del respaldo interno, guarda una **copia en tu Google Drive** (respaldo fuera de Netlify, más seguro ante un fallo total). **Requiere** cargar también `GOOGLE_SERVICE_ACCOUNT_JSON` (la credencial de cuenta de servicio de Google; hoy usas Apps Script, que es distinto). |
| `BACKUP_RETENTION_DAYS` | `30` | Cuántos días se guardan los respaldos antes de borrar los viejos. (Si no la pones, usa 30.) |
| `ALERT_EMAIL` | un correo | A dónde llegan las **alertas si algo falla** (ej. un pago sin reserva). Si no la pones, llegan al correo de admin que ya tienes. Las alertas ya funcionan solas. |

---

## A bis. Integraciones nuevas (chapas, Odoo CRM, roles) — credenciales

Estas **sí** van en Netlify porque son secretos/datos; sus interruptores de sí/no
viven en `/admin → Configuración`.

### Chapas inteligentes (TTLock) — para mandar los códigos de acceso por reserva
El correo de "códigos de acceso" está diseñado pero hoy no lo dispara nada (los
códigos cambian por estadía). TTLock cierra ese hueco. Apagado mientras no cargues
las credenciales.

| Variable | Qué es |
|---|---|
| `TTLOCK_ENABLED` **(panel)** | `true` para emitir/enviar códigos de chapa por reserva |
| `TTLOCK_CLIENT_ID` / `TTLOCK_CLIENT_SECRET` | Credenciales de la app en la plataforma abierta de TTLock |
| `TTLOCK_USERNAME` / `TTLOCK_PASSWORD_MD5` | Usuario de TTLock y su clave en formato MD5 |
| `TTLOCK_LOCKS_JSON` | Mapa de qué chapa corresponde a cada apartaestudio (JSON) |
| `TTLOCK_API_BASE` / `TTLOCK_TIMEOUT_MS` / `TTLOCK_PASSCODE_TYPE` | Opcionales (tienen valor por defecto) |

### Odoo (CRM / operación) — ya está LIVE el maestro de clientes
El conector Odoo enriquece contactos, crea oportunidades (leads) y, con estos
toggles, tickets de PQR y encuesta de satisfacción. Las **4 credenciales de Odoo**
(`ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, `ODOO_API_KEY`) **+ `ODOO_COMPANY_ID=5`**
(empresa Mirada) deben estar en Netlify (hoy en prod corre en modo simulado si
faltan). Ver `docs/continuacion-odoo.md`.

| Variable | Qué es |
|---|---|
| `HELPDESK_ENABLED` **(panel)** | `true` para que las solicitudes/cancelaciones del huésped abran un **ticket en Odoo Helpdesk** |
| `HELPDESK_TEAM_ID` | ID del equipo de Helpdesk en Odoo (hoy `3`) |
| `NPS_ENABLED` **(panel)** | `true` para agregar el enlace de **encuesta NPS** al correo post-estadía (requiere correos post-estadía activos) |
| `NPS_SURVEY_URL` | El enlace de la encuesta de satisfacción |

### Mercado Pago — su secreto de webhook ahora es OPCIONAL
`MERCADOPAGO_WEBHOOK_SECRET` pasó a ser **opcional**: si no lo cargas, el webhook
de Mercado Pago verifica el pago **consultando la API** de MP en vez de validar la
firma. Recomendado cargarlo igual cuando uses MP en producción.

### Roles y usuarios del panel (IAM)
No requiere variables nuevas. El panel `/admin` tiene una pestaña **Usuarios** para
asignar roles (admin / recepción / cocina / tesorería) por correo. **Quien tenga su
correo en `ADMIN_EMAILS`/`STAFF_EMAILS` de Netlify es superusuario** (acceso total),
independiente de los roles del panel — esas listas siguen siendo el "maestro" de
acceso. El modo demo de IAM **solo** existe en local (nunca en Netlify).

---

## B. Para encender el bot de WhatsApp (cuando lo conectemos)

Estas las obtienes en **Meta** (tu app ya está creada) y en Anthropic. Se cargan
cuando activemos el bot:

| Variable | Qué es |
|---|---|
| `WHATSAPP_TOKEN` | El token de acceso de la API de WhatsApp (Meta) |
| `WHATSAPP_PHONE_NUMBER_ID` | El ID del número de WhatsApp (Meta) |
| `WHATSAPP_APP_SECRET` | El secreto de la app de Meta (valida que los mensajes son legítimos) |
| `WHATSAPP_VERIFY_TOKEN` | Un texto que tú inventas; sirve para conectar el webhook con Meta |
| `WHATSAPP_BOT_ENABLED` | `true` para prender el bot |
| `ANTHROPIC_API_KEY` | La clave de Claude (la IA que conversa). Sin esto el bot usa menús simples |

---

## Bloque para copiar/pegar (descomenta lo que vayas a usar)

> Recordatorio: los toggles marcados **(panel)** arriba se pueden dejar como
> variable o, mejor, prenderlos desde `/admin → Configuración`. Aquí se listan por
> si prefieres fijarlos por entorno.

```bash
# --- Funciones nuevas (Carril A) — toggles también disponibles en /admin → Configuración ---
BACKUP_ENABLED=true
# STAY_EMAILS_ENABLED=true
# REVIEW_LINK_URL=https://g.page/tu-hotel/review
# GUEST_NOTES_TO_PMS_ENABLED=true
# REFUND_BANK_FORM_ENABLED=true
# REFUND_LINK_SECRET=cambia-esto-por-un-texto-largo-aleatorio
# REFUND_GATEWAY_AUTO_ENABLED=true   # solo si usas Mercado Pago
# DISCOUNT_CODES_ENABLED=true
# QUOTE_EXPIRY_REMINDER_ENABLED=true

# --- Chapas inteligentes (TTLock) — credenciales en Netlify, toggle en el panel ---
# TTLOCK_ENABLED=true
# TTLOCK_CLIENT_ID=
# TTLOCK_CLIENT_SECRET=
# TTLOCK_USERNAME=
# TTLOCK_PASSWORD_MD5=
# TTLOCK_LOCKS_JSON={}

# --- Odoo CRM (Helpdesk / NPS) — credenciales Odoo aparte (ver continuacion-odoo.md) ---
# HELPDESK_ENABLED=true
# HELPDESK_TEAM_ID=3
# NPS_ENABLED=true
# NPS_SURVEY_URL=

# --- Bot de WhatsApp (cuando lo conectemos) ---
# WHATSAPP_TOKEN=
# WHATSAPP_PHONE_NUMBER_ID=
# WHATSAPP_APP_SECRET=
# WHATSAPP_VERIFY_TOKEN=
# WHATSAPP_BOT_ENABLED=true
# ANTHROPIC_API_KEY=
```
