# Variables a cargar en Netlify — explicadas

Estas son las **variables NUEVAS** (las que aún no tienes en Netlify). Tu sitio
funciona sin ellas; sirven para **encender las funciones nuevas**. Cada función
está apagada hasta que agregues su variable.

> Cómo cargarlas: Netlify → tu sitio → **Site configuration → Environment
> variables → Add a variable**. Pones el **Key** (el nombre) y el **Value**.

---

## A. Para encender las funciones nuevas (decides cuáles y cuándo)

| Variable (Key) | Valor | Qué hace | ¿Prender ahora? |
|---|---|---|---|
| `BACKUP_ENABLED` | `true` | Respaldo automático **diario** de la info que vive solo en la nube (cotizaciones, reembolsos, desayunos, datos de huéspedes). Protege contra borrados accidentales. | ✅ **Recomendado ya** |
| `STAY_EMAILS_ENABLED` | `true` | Correos automáticos al huésped: **"te esperamos"** (1–2 días antes de llegar) y **"gracias por tu estadía"** (al día siguiente de irse). | ⏳ Tras probar con una reserva real |
| `REVIEW_LINK_URL` | tu enlace de reseñas (Google/Booking) | El botón "deja tu reseña" del correo post-estadía apunta a ese enlace. | Opcional (junto con el anterior) |
| `GUEST_NOTES_TO_PMS_ENABLED` | `true` | Hace que la **nota/solicitud** que el huésped escribe al reservar (ej. "llego tarde", "piso alto") **llegue a la reserva en Kunas**. | ⏳ Tras probar con una reserva real |
| `REFUND_BANK_FORM_ENABLED` | `true` | Prende el **formulario** donde el huésped registra su cuenta bancaria para recibir un reembolso por transferencia. | ⏳ Cuando empieces a usar reembolsos |
| `REFUND_LINK_SECRET` | un texto largo aleatorio (ej. 40+ caracteres) | Clave secreta que **firma el enlace seguro** de ese formulario (para que nadie lo adivine). Si no la pones, reutiliza otra que ya tienes y funciona igual. | Junto con el anterior |
| `QUOTE_EXPIRY_REMINDER_ENABLED` | `true` | Correo automático **"tu cotización vence pronto"** a los clientes de cotizaciones, un día antes de que expire. | Opcional |

### Opcionales avanzadas (de respaldo)
| Variable | Valor | Qué hace |
|---|---|---|
| `BACKUP_TO_DRIVE` | `true` | Además del respaldo interno, guarda una **copia en tu Google Drive** (respaldo fuera de Netlify, más seguro ante un fallo total). **Requiere** cargar también `GOOGLE_SERVICE_ACCOUNT_JSON` (la credencial de cuenta de servicio de Google; hoy usas Apps Script, que es distinto). |
| `BACKUP_RETENTION_DAYS` | `30` | Cuántos días se guardan los respaldos antes de borrar los viejos. (Si no la pones, usa 30.) |
| `ALERT_EMAIL` | un correo | A dónde llegan las **alertas si algo falla** (ej. un pago sin reserva). Si no la pones, llegan al correo de admin que ya tienes. Las alertas ya funcionan solas. |

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

```bash
# --- Funciones nuevas (Carril A) ---
BACKUP_ENABLED=true
# STAY_EMAILS_ENABLED=true
# REVIEW_LINK_URL=https://g.page/tu-hotel/review
# GUEST_NOTES_TO_PMS_ENABLED=true
# REFUND_BANK_FORM_ENABLED=true
# REFUND_LINK_SECRET=cambia-esto-por-un-texto-largo-aleatorio
# QUOTE_EXPIRY_REMINDER_ENABLED=true

# --- Bot de WhatsApp (cuando lo conectemos) ---
# WHATSAPP_TOKEN=
# WHATSAPP_PHONE_NUMBER_ID=
# WHATSAPP_APP_SECRET=
# WHATSAPP_VERIFY_TOKEN=
# WHATSAPP_BOT_ENABLED=true
# ANTHROPIC_API_KEY=
```
