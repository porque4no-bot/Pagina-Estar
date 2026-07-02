# Respaldo de Netlify Blobs (A4)

Cotizaciones, reembolsos, desayunos, solicitudes de cancelación y la PII cifrada
de huéspedes viven **solo** en Netlify Blobs. La función programada
`backup-blobs` (cron diario 04:00 UTC) toma un snapshot versionado por fecha en
un store aislado `backups` y, opcionalmente, lo copia a Google Drive (off-site).

## Qué se respalda

| Grupo | Stores | Por defecto |
|---|---|---|
| `business` | `quotes`, `quote-audit`, `refunds`, `breakfast-redemptions`, `cancellation-requests` | ✅ siempre |
| `pii` | `guest-checkins`, `guest-events`, `guest-documents`, `guest-minor-documents` | ⛔ solo con `BACKUP_INCLUDE_PII=true` |

- **No** se respaldan stores efímeros/TTL (`booking-results`, `processed-transactions`, `booking-idempotency`, rate-limit, whatsapp-*): son ventana rodante de días, restaurarlos reintroduce datos vencidos.
- La PII de `guest-checkins`/`guest-events` ya está **cifrada en reposo** (AES-256-GCM); el snapshot copia el ciphertext tal cual — la clave `GUEST_APP_DATA_ENCRYPTION_KEY` **nunca** entra al backup.
- **PII en claro nunca va a Drive**: la copia a Drive es solo del grupo `business`.

## Activación (Netlify → Environment variables)

| Variable | Default | Qué hace |
|---|---|---|
| `BACKUP_ENABLED` | `false` | `true` activa el cron (si no, retorna `skipped: disabled`) |
| `BACKUP_RETENTION_DAYS` | `30` | snapshots más viejos se purgan |
| `BACKUP_INCLUDE_PII` | `false` | incluir el grupo PII |
| `BACKUP_TO_DRIVE` | `false` | copiar `business` a Google Drive (off-site real) |
| `BACKUP_ALWAYS_EMAIL` | `false` | correo resumen siempre (si no, solo ante error) |
| `BACKUP_MAX_ENTRY_BYTES` | `6291456` | tope por blob (evita OOM con binarios) |

> El store `backups` vive en el **mismo perímetro Netlify** que las fuentes:
> protege contra borrado accidental, NO contra una caída total del proveedor.
> Para DR real off-site, activa `BACKUP_TO_DRIVE=true` (requiere la service
> account de Drive ya configurada).

## Formato del snapshot

Un blob por store y día: clave `${YYYY-MM-DD}/${grupo}/${store}.json`, contenido:

```json
{ "version": 1, "takenAt": "ISO", "group": "business", "store": "refunds",
  "entries": [ { "key": "<blobKey>", "bytes": 123, "b64": "<base64 del valor>", "metadata": { } } ] }
```

Entradas que superan `BACKUP_MAX_ENTRY_BYTES` se registran como `{ key, bytes, oversized: true }` (sin `b64`).

## Restauración (manual)

1. Localiza el snapshot del día deseado en el store `backups` (o en Drive,
   carpeta `backups-blobs/<fecha>/`).
2. Para cada `store`, recorre `entries` y reescribe cada blob en el store destino:

```js
const { getStore } = require('@netlify/blobs');
const snapshot = require('./quotes.json'); // el snapshot leído
const dest = getStore({ name: snapshot.store, consistency: 'strong' });
for (const e of snapshot.entries) {
  if (!e.b64) continue; // oversized/error — recuperar aparte
  const buf = Buffer.from(e.b64, 'base64');
  // documentos binarios: conserva la metadata (contentType, bookingCode, …)
  await dest.set(e.key, buf, e.metadata ? { metadata: e.metadata } : undefined);
}
```

3. Para PII cifrada: se restaura el ciphertext tal cual; el descifrado sigue
   dependiendo de `GUEST_APP_DATA_ENCRYPTION_KEY` (que no está en el backup).

## Notas

- Función **solo-lectura** sobre las fuentes (`list` + `get`); solo escribe en
  `backups` y, opcional, Drive. No toca OTASync, pagos ni disponibilidad.
- Best-effort por store: si uno falla, los demás se respaldan igual y llega un
  correo de alerta.
- La credencial de Drive (`secrets` store) no se respalda; es re-subible vía
  `/api/upload-drive-credentials`.
