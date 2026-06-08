# Google Drive Apps Script para Guest App

Esta carpeta contiene el script que archiva documentos y contratos de la guest app en Google Drive.

## 1. Crear la carpeta raíz

1. En Google Drive, crea una carpeta privada, por ejemplo `Estar Guest App - Expedientes`.
2. Abre la carpeta y copia el ID de la URL.

Ejemplo:

```text
https://drive.google.com/drive/folders/1ABC...
```

El ID es la parte después de `/folders/`.

## 2. Crear el Apps Script

1. Abre [Google Apps Script](https://script.google.com/).
2. Crea un proyecto nuevo.
3. Copia el contenido de `Code.gs` en el editor.
4. En `Project Settings > Script properties`, agrega:

```text
ROOT_FOLDER_ID=<ID_DE_LA_CARPETA_DE_DRIVE>
WEBHOOK_SECRET=<VALOR_DE_GOOGLE_DRIVE_APPS_SCRIPT_SECRET>
```

`WEBHOOK_SECRET` debe ser exactamente el mismo valor configurado en Netlify como `GOOGLE_DRIVE_APPS_SCRIPT_SECRET`.

## 3. Desplegar como Web App

1. Haz clic en `Deploy > New deployment`.
2. Selecciona tipo `Web app`.
3. Configura:
   - `Execute as`: `Me`
   - `Who has access`: `Anyone`
4. Autoriza los permisos de Drive y Docs cuando Google lo solicite.
5. Copia la URL terminada en `/exec`.

Esa URL va en Netlify como:

```env
GOOGLE_DRIVE_APPS_SCRIPT_URL=https://script.google.com/macros/s/.../exec
```

## 4. Variables de Netlify

La guest app usa dos secretos:

```env
GUEST_APP_DRIVE_WEBHOOK_URL=https://estar.com.co/api/guest-drive
GUEST_APP_DRIVE_WEBHOOK_SECRET=<secreto interno entre guest app y Netlify>
GOOGLE_DRIVE_APPS_SCRIPT_URL=<URL /exec del Apps Script>
GOOGLE_DRIVE_APPS_SCRIPT_SECRET=<secreto interno entre Netlify y Apps Script>
```

## Estructura creada en Drive

```text
Estar Guest App - Expedientes/
  RESERVA-123/
    00_metadata/
    01_documentos/
    02_contratos/
    03_facturas/
```

La carpeta de facturas se crea cuando el backend envía un evento `guest-invoice` con el PDF. La solicitud de factura por sí sola queda registrada como metadata hasta que OTASync o el sistema contable entregue ese archivo.

## Seguridad

- La URL de Apps Script queda protegida por `WEBHOOK_SECRET`.
- No publiques la carpeta raíz de Drive.
- No compartas los secretos en correo, chat ni documentos.
- Si el script se vuelve a desplegar, actualiza `GOOGLE_DRIVE_APPS_SCRIPT_URL` en Netlify si Google genera una URL nueva.
