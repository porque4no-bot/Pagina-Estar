# Subidor SIRE (Hotel Estar → Migración Colombia)

Sube cada día al portal **SIRE** de Migración Colombia los movimientos de los
huéspedes **extranjeros** del Hotel Estar. Corre en el **VPS del grupo**
(Debian 12, usuario `vault`), no en Netlify.

```
check-in en línea ──► Netlify: /api/sire-export ──► VPS: subir_sire.py ──► portal SIRE
 (guest-checkins,       (arma el .txt: solo          (Playwright: entra,
  cifrado)               extranjeros, E y S)          carga, lee el resultado)
                               ▲                              │
                               └──── POST ack (lo aceptado) ◄─┘
```

- **La fuente es nuestro check-in en línea**: la API de Kunas no trae documento
  ni nacionalidad.
- La función `sire-export` (en `netlify/functions/`) arma el archivo plano: una
  fila **E** en la fecha de check-in y una **S** en la de check-out, solo de
  movimientos que ya ocurrieron. Cada fila lleva un id opaco; el subidor
  devuelve un **ack** con lo que el portal aceptó y así nada se reporta dos
  veces.
- El portal no tiene API: el subidor maneja la página con **Playwright**. Si
  aparece un **CAPTCHA** o cualquier verificación humana **no se salta**: deja
  el archivo listo y avisa.

El paso a paso de instalación, el ensayo y la confirmación del dueño están en
[`SIRE.md`](SIRE.md) (es el documento que va a `00 - Indice/` del repo del VPS).

## Ficheros

| fichero | qué es | va en el VPS a |
| :-- | :-- | :-- |
| `subir_sire.py` | el programa (modos, flujo, avisos) | `99 - Herramientas/sire/` |
| `sire_comun.py` | lo que no necesita navegador: secretos, exportación, archivo, lectura del resultado, estado, aviso | `99 - Herramientas/sire/` |
| `sire_portal.py` | el portal con Playwright (ingreso, menú, carga, CAPTCHA) | `99 - Herramientas/sire/` |
| `portal.json` | selectores y textos del portal (se calibran tras el ensayo) | `99 - Herramientas/sire/` |
| `requirements.txt` | `playwright` (versión fija) | `99 - Herramientas/sire/` |
| `tests/` | pruebas (formato + flujo completo contra un portal simulado) | `99 - Herramientas/sire/tests/` |
| `vps/sire_vps.sh` | envoltorio: registro, marcas de inicio/fin, relé de avisos | `99 - Herramientas/vps/` |
| `vps/vault-sire.service` / `.timer` | unidades systemd (10:00 hora Colombia) | `99 - Herramientas/vps/` → `/etc/systemd/system/` |
| `ejemplos/*.ejemplo` | forma de los secretos (sin valores) | — |
| `SIRE.md` | documento para `00 - Indice/` | `00 - Indice/SIRE.md` |

## Modos

```bash
correr.sh sire/subir_sire.py --ensayo        # todo menos subir; capturas del formulario y la guía
correr.sh sire/subir_sire.py --subir         # la subida real (exige autorización del dueño)
correr.sh sire/subir_sire.py --solo-archivo  # deja el .txt para subirlo a mano y avisa
correr.sh sire/subir_sire.py --resolver reportado    # lo pendiente ya está en el portal: ack
correr.sh sire/subir_sire.py --resolver reintentar   # soltarlo para que la próxima pasada lo suba (NUNCA con ack_pendiente)
```

Opcionales: `--desde/--hasta YYYY-MM-DD` (hora Colombia; por defecto los 7 días
que terminan ayer **o, si quedó algo sin reportar de antes, desde el movimiento
pendiente más antiguo**, en tramos de 62 días: un bloqueo largo no deja nada por
fuera), `--secretos DIR`, `--estado DIR`, `--portal-conf FICHERO`,
`--visible`, `--sin-aviso`, `--avisar` (en el ensayo).

`sire_vps.sh` es lo que lanza el temporizador: escribe en
`/opt/vault/90 - Datos/sire.log` la marca `---- fecha ----`, la pasada y
`---- fin, codigo N ----`. **La señal fiable es esa última línea**, no que el
temporizador exista.

## Códigos de salida

| código | significa | qué hacer |
| --: | :-- | :-- |
| 0 | bien (incluye «nada que reportar») | nada |
| 1 | error técnico | mirar el registro |
| 2 | uso incorrecto | revisar la orden |
| 3 | configuración: secretos, permisos o Netlify (`SIRE_ENABLED`, `SIRE_HOTEL_CODE`, `SIRE_EXPORT_TOKEN`) | ver el mensaje |
| 4 | **verificación humana / CAPTCHA**: el archivo quedó listo en la carpeta de estado | subirlo a mano y `--resolver reportado` |
| 5 | el portal rechazó registros (o el archivo entero) | corregir a mano en el portal y `--resolver reportado`, o corregir el dato y `--resolver reintentar` |
| 6 | no se pudo confirmar si el portal cargó el archivo | mirar el portal: `--resolver reportado` o `--resolver reintentar` |
| 7 | hay algo pendiente de una pasada anterior: no se sube nada | `--resolver …`; si el motivo es `ack_pendiente` el archivo YA está en el portal: **solo** `--resolver reportado` (reintentar se rechaza: duplicaría) |
| 8 | la subida real aún no está autorizada | ensayo + visto bueno del dueño → `.secrets/sire_autorizacion.txt` |
| 9 | el portal rechazó el ingreso | revisar `.secrets/sire.json` |

Todo lo distinto de 0 manda un aviso por correo (relé SMTP del VPS, como la
alarma de la ingesta). Lo que se repite (pendiente sin resolver, falta de
autorización) se recuerda cada 3 días, no cada día; los datos incompletos solo
se avisan cuando aparece uno nuevo.

## Secretos (`99 - Herramientas/.secrets/`, permisos 600)

`sire.json` — el usuario del portal SIRE:

```json
{ "tipo_documento": "CC", "numero_documento": "…", "password": "…" }
```

`tipo_documento` acepta el valor o el texto de la opción del portal (`CC`,
`Cédula de Ciudadanía`, `CE`, `Pasaporte`…).

`sire_export.json` — la exportación de estar.com.co:

```json
{ "url": "https://estar.com.co/api/sire-export", "token": "…" }
```

El `token` es el mismo valor de `SIRE_EXPORT_TOKEN` en Netlify (32+
caracteres; p. ej. `openssl rand -hex 32`).

`sire_autorizacion.txt` — **solo** después de que el dueño revise el ensayo:
quién autorizó y cuándo. Sin este fichero `--subir` se niega (código 8).

El programa rechaza cualquier secreto con permisos más abiertos que 600 y
nunca escribe sus valores en el registro.

## Datos personales (Ley 1581)

- Los datos solo salen hacia el SIRE. El registro lleva **conteos, códigos de
  reserva e índices de huésped**; nunca nombres, documentos ni fechas de
  nacimiento. El texto que devuelve el portal se registra **tachado**.
- El archivo de la pasada se escribe con `umask 077` (carpeta 700, archivo 600)
  y se borra al terminar. Si hay que dejarlo para subida manual, queda en
  `~/.local/state/estar-sire/pendientes/` (600) y se borra al resolver o, como
  mucho, a los 15 días.
- Las capturas solo se toman en el **ensayo** (formulario vacío, guía de
  formato), nunca del resultado de una subida real.
- El estado (`~/.local/state/estar-sire/estado.json`, 600) guarda ids opacos,
  códigos de reserva, fechas de movimiento y conteos.

## Pruebas

```bash
python -m unittest discover -s tools/sire-uploader/tests
```

- `test_sire_comun.py`: formato, lectura del resultado del portal, tachado,
  secretos, estado (sin red ni navegador; también corre dentro de
  `npm run test:unit`).
- `test_flujo_simulado.py`: el programa entero contra una exportación y un
  portal **simulados** en 127.0.0.1 (ensayo, subida con ack, CAPTCHA,
  `--resolver`, ingreso rechazado). Necesita Playwright + Chromium; si no hay,
  se salta. `SIRE_CHROMIUM=/ruta/a/chrome` para usar un Chromium propio.

**Lo que las pruebas NO prueban**: el portal real. Los selectores, los textos
del menú y la forma del mensaje de resultado salen de la descripción del portal
y de guías de proveedores; se confirman con el ensayo y con la primera subida
supervisada (ver `SIRE.md`).
