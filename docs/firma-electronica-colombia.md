# Firma electrónica del contrato de hospedaje — Cumplimiento legal (Colombia)

Documenta cómo la guest app de Hotel Estar implementa la firma electrónica
simple del contrato de hospedaje y qué evidencia se conserva para acreditar
su validez probatoria conforme al marco normativo colombiano.

## Marco normativo

- **Ley 527 de 1999** — Mensajes de datos, comercio electrónico y firmas digitales (artículos 7, 10, 11, 12 son los relevantes para firma electrónica simple sin entidad certificadora).
- **Decreto 2364 de 2012** — Reglamenta la firma electrónica del artículo 7 de la Ley 527.
- **Ley 1581 de 2012** — Habeas Data (tratamiento de datos personales del huésped).
- **Decreto 1747 de 2000** — Reglamentación general (vigencia parcial; remite a entidades certificadoras).
- **Ley 679 de 2001** — Aviso ESCNNA en hospedaje turístico (ya implementado en la guest app).

Hotel Estar implementa **firma electrónica simple** (no certificada). Bajo
los artículos 1 y 3 del Decreto 2364, esta firma tiene plena validez si el
mecanismo (a) identifica al firmante, (b) indica que aprueba el contenido,
(c) es confiable para el propósito, y (d) puede verificarse.

## Cumplimiento por requisito

### Artículo 7 Ley 527 — Requisitos de la firma

| Requisito legal | Cómo se cumple |
|---|---|
| **a) Identificar al firmante** | Sesión JWT firmada en `guest-session` exige código de reserva + apellido del titular (token tiene `sub`, `guest`, `capacity`, `exp`). Identidad reforzada con documento subido y OCR (Azure Document Intelligence, `prebuilt-idDocument`) en `guest-checkin`; el campo `signedName` debe coincidir con el huésped principal. |
| **b) Indicar aprobación del contenido** | El usuario debe (1) abrir el modal "Ver contrato completo", (2) leerlo (scroll hasta el final o marcar la casilla "He leído el contrato completo"), (3) escribir su nombre, (4) marcar "Leí y acepto el contrato". Solo entonces se habilita el botón `Firmar contrato`. Se persiste `consentText`, `acceptedTerms: true`, `acknowledgedAt`. |
| **c) Confiabilidad apropiada para el propósito** | Sesión con JWT HMAC-SHA256 + secret de servidor; rate limiting (30 req / 10 min); registros cifrados en reposo con AES-256-GCM en Netlify Blobs (`GUEST_APP_DATA_ENCRYPTION_KEY`); validación servidor-lado del consentimiento; el cliente no puede alterar `signedAt`, `clientIp`, `userAgent`, `contractHash` ni `contractVersion`. |
| **d) Verificación / auditoría** | Por cada firma se almacena un `eventId` único (`GST-<timestamp>-<rand>`), hash SHA-256 del HTML del contrato presentado, IP del firmante, User-Agent, ISO-8601 timestamp con zona, versión del template, y reflejo del archivo en Google Drive si está configurado (`GUEST_APP_DRIVE_WEBHOOK_URL`). |

### Decreto 2364 de 2012 — Datos para validez

| Disposición | Implementación |
|---|---|
| Art. 3 lit. a — datos vinculados al firmante únicamente | Sesión JWT por reserva + documento del huésped (CC/Pasaporte) cargado en el flujo. |
| Art. 3 lit. b — control exclusivo del firmante | El acceso requiere el código de reserva (entregado vía email confirmado) y el apellido; la firma se ejecuta en el dispositivo del usuario autenticado. |
| Art. 3 lit. c — detectabilidad de alteraciones posteriores | El hash SHA-256 del contrato renderizado se persiste cifrado; cualquier modificación posterior del texto invalidaría el match. |
| Art. 3 lit. d — verificación por terceros | El operador puede recomponer el contrato a partir del `contractVersion` + `record` y comparar con `contractHash`. |

## Evidencia auditada por firma (registro persistido)

Cada evento `type: 'contract'` en el store `guest-events` (cifrado AES-256-GCM)
contiene:

| Campo | Origen | Propósito legal |
|---|---|---|
| `eventId` | Generado servidor (`GST-...`) | Identificador único del acto de firma |
| `bookingCode` | Sesión JWT (`sub`) | Vinculación a la reserva |
| `signedName` | Body sanitizado | Nombre tipográfico declarado por el firmante (Art. 7 lit. a) |
| `signedAt` | Reloj servidor (`new Date().toISOString()`) | Marca temporal confiable (ISO-8601 UTC) |
| `acknowledgedAt` | Cliente, validado <24h del servidor | Momento en que el usuario terminó de leer |
| `clientIp` | `x-nf-client-connection-ip` / `x-forwarded-for` | Identifica el dispositivo (Art. 7 lit. d) |
| `userAgent` | Header `User-Agent` (capado a 400) | Identifica navegador/dispositivo |
| `contractVersion` | Pinned: `ESTAR-HOSPEDAJE-2026-01` | Versión textual del contrato |
| `contractHash` | SHA-256 hex del HTML renderizado por `_contract-template.js` | Prueba criptográfica del contenido exacto |
| `contractHashAlgorithm` | `"sha256"` | Algoritmo del hash anterior |
| `consentText` | Texto exacto mostrado al usuario | Aprobación explícita del contenido (Art. 7 lit. b) |
| `acceptedTerms` | `true` (rechazado si distinto) | Confirmación binaria de aceptación |
| `guests[]` | Huéspedes registrados con documento (tipo + número) | Identidad del firmante y acompañantes |
| `checkIn`, `checkOut`, `roomName`, `capacity` | Reserva | Contexto del contrato |
| `email`, `phone` | Huésped principal | Canal de contacto para notificaciones |

Adicionalmente, los **documentos de identidad** (cédula/pasaporte/registro
civil/carta de autorización) subidos en `guest-checkin` quedan cifrados en
los stores `guest-documents` y `guest-minor-documents`, y se reflejan en
Google Drive bajo la carpeta de la reserva si el webhook está configurado.

## Conservación (Ley 527, art. 12)

El **Artículo 12** exige conservar los mensajes de datos accesibles para
consulta posterior, en su formato original o reproducible, y permitiendo
determinar su origen, destino, fecha y hora de envío/recepción.

Hotel Estar conserva por **mínimo 5 años** contados desde la fecha de
salida (check-out) del huésped:

1. El registro completo del evento de firma en Netlify Blobs (cifrado AES-256-GCM, store `guest-events`).
2. El documento de identidad cargado (Blobs `guest-documents` + Drive si está configurado).
3. El PDF del contrato (renderizado bajo demanda desde `_pdf-render.js` a partir del registro guardado).
4. El log de envío del webhook a Drive (campos `archive.delivered`, `sync.delivered` en la respuesta).

5 años es coherente con: (a) el plazo prescriptivo general de acciones
mercantiles ordinarias en Colombia (Código de Comercio), (b) el plazo
mínimo recomendado por la Superintendencia de Industria y Comercio (SIC)
para evidencia de consentimiento bajo Ley 1581, y (c) la práctica
hotelera para soportar revisiones tributarias / DIAN.

## Brechas remanentes (acciones operativas, no de código)

Las siguientes mitigaciones requieren proceso o configuración fuera del
código de la guest app:

1. **Política formal de retención.** Documentar en el manual interno de Hotel Estar el plazo de 5 años, el responsable de la custodia y el procedimiento para responder a requerimientos judiciales o de la SIC.
2. **Backup independiente.** Programar export periódico de los stores `guest-events`, `guest-checkins`, `guest-documents` y `guest-minor-documents` a un almacenamiento frío (Google Drive ya hace una copia; conviene una segunda copia regional). *(Avance: la función programada `backup-blobs` ya respalda estos stores PII — gateada por `BACKUP_INCLUDE_PII=true` — conservando el ciphertext; ver `docs/backup-blobs.md`. La PII en claro nunca sale a Drive.)*
3. **Rotación de claves.** `GUEST_APP_TOKEN_SECRET` y `GUEST_APP_DATA_ENCRYPTION_KEY` deben rotarse al menos una vez al año y custodiarse en un gestor (1Password / Bitwarden compartido del equipo). Documentar el procedimiento de rotación sin pérdida (re-cifrado offline de los blobs existentes).
4. **Verificación de identidad reforzada (opcional).** Para reservas de alto valor o estadías largas, considerar firma electrónica certificada con una entidad de certificación digital acreditada por ONAC (p. ej. Andes SCD, Certicámara) — esto eleva la prueba a "firma digital" (Ley 527 art. 28) y traslada la carga probatoria.
5. **Aviso de privacidad explícito.** Asegurar que la pantalla de login muestra (o enlaza) la política de privacidad y el aviso de tratamiento de datos personales conforme a la Ley 1581 antes de capturar el documento — ya se hace en el botón "Privacidad" del flujo de reserva; verificar paridad en la guest app.
6. **Sello de tiempo cualificado (opcional).** Para máxima oponibilidad, agregar `tsa.belsign.gov.co` u otro Time Stamping Authority sobre `contractHash`. Hoy el `signedAt` es la hora del servidor Netlify; suficiente para firma electrónica simple, no para firma digital cualificada.
7. **Procedimiento de revocación / impugnación.** Documentar cómo un huésped puede solicitar que se elimine su firma (Ley 1581 derechos ARCO) y cómo Hotel Estar valida la solicitud sin perder la evidencia probatoria mínima.

## Verificación posterior (cómo probar la firma)

Para demostrar la validez de una firma años después:

```
1. Recuperar el registro 'guest-events' del eventId reclamado.
2. Descifrar con GUEST_APP_DATA_ENCRYPTION_KEY (AES-256-GCM, IV + tag almacenados).
3. Re-renderizar el contrato con renderContractHTML(record) de _contract-template.js
   en la versión apuntada por record.contractVersion.
4. Calcular SHA-256 del resultado y comparar contra record.contractHash.
5. Confrontar IP, User-Agent y timestamps con cualquier registro alternativo
   (logs de Netlify, correos de confirmación, registros de OTASync).
```

Una coincidencia exacta del hash demuestra que el huésped recibió y aceptó
ese texto literal, en ese momento, desde esa IP y dispositivo.
