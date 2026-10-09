---
titulo: "SIRE: la subida diaria de los extranjeros del Hotel Estar"
fecha: "2026-10-08"
---

# SIRE

**Qué es.** Migración Colombia exige que el hotel reporte en el **SIRE** cada
entrada (E) y salida (S) de un huésped **extranjero**. El portal no tiene API:
se sube un archivo plano. Desde este montaje lo sube el VPS solo, cada día a las
**10:00 de Colombia**, con `vault-sire.timer`.

**De dónde salen los datos.** Del check-in en línea de estar.com.co, no de
Kunas: su API no trae ni el documento ni la nacionalidad. La web arma el
archivo (función `sire-export`, con un token propio) y el VPS lo descarga, lo
sube al portal con Playwright y le devuelve a la web lo que el portal aceptó,
para no reportar nada dos veces.

**Cuándo NO sube.** Si el portal pide un CAPTCHA o cualquier verificación
humana, no se intenta saltar: el archivo queda listo para subirlo a mano y llega
un aviso. Y la primera subida real no sale sin el visto bueno del dueño.

| qué | dónde |
| :-- | :-- |
| el programa | `99 - Herramientas/sire/subir_sire.py` (+ `sire_comun.py`, `sire_portal.py`, `portal.json`) |
| el envoltorio y las unidades | `99 - Herramientas/vps/sire_vps.sh`, `vault-sire.service`, `vault-sire.timer` |
| los secretos | `99 - Herramientas/.secrets/sire.json`, `sire_export.json`, `sire_autorizacion.txt` (600) |
| el registro | `90 - Datos/sire.log` (solo conteos y códigos de reserva) |
| el estado y las capturas del ensayo | `/home/vault/.local/state/estar-sire/` (700) |
| el código de origen | repo de la página del hotel, `tools/sire-uploader/` |

## Instalación (una vez)

Nada de esto lo hace el temporizador: lo hace una persona, en este orden.

**1. Los ficheros.** En el repo del archivo, desde el portátil: copiar
`tools/sire-uploader/{subir_sire.py,sire_comun.py,sire_portal.py,portal.json,requirements.txt,tests/}`
a `99 - Herramientas/sire/` y `tools/sire-uploader/vps/*` a
`99 - Herramientas/vps/`; este documento a `00 - Indice/SIRE.md`, y una fila en
la tabla de [LO-QUE-CORRE-SOLO.md](LO-QUE-CORRE-SOLO.md). Subir a GitHub. En el
VPS los trae la ingesta de la noche, o a mano:

```bash
sudo -u vault git -C /opt/vault pull --ff-only github main
```

**2. Playwright en el venv de la ingesta** (como `vault`, para que el navegador
quede en su `~/.cache`), y las librerías del sistema que Chromium necesita
(esto último sí pide root, una vez):

```bash
sudo -u vault /opt/vault/.venv-ingesta/bin/pip install -r "/opt/vault/99 - Herramientas/sire/requirements.txt"
sudo -u vault /opt/vault/.venv-ingesta/bin/python -m playwright install chromium
sudo /opt/vault/.venv-ingesta/bin/python -m playwright install-deps chromium
```

**3. Netlify** (sitio `estarmz`), en *Environment variables*, y luego un
redeploy (las funciones leen el entorno al desplegarse):

| variable | valor | secreto |
| :-- | :-- | :-- |
| `SIRE_EXPORT_TOKEN` | `openssl rand -hex 32` (32+ caracteres). Sin ella la exportación está **apagada** | sí |
| `SIRE_HOTEL_CODE` | el código SIRE del establecimiento (lo da Migración; se ve en el portal) | no |
| `SIRE_ENABLED` | `true` (también desde `/admin` → Configuración) | no |
| `SIRE_REPORT_START` | fecha `YYYY-MM-DD` de la **primera subida real** (también desde `/admin`). Lo anterior se reportó a mano y no se sube. Sin ella la exportación no entrega archivo | no |
| `SIRE_CITY_CODE` | opcional; por defecto `17001` (Manizales, DIVIPOLA) | no |

**4. Los secretos en el VPS**, como `vault`, con permisos 600 (el programa se
niega a leerlos si están más abiertos):

```bash
S="/opt/vault/99 - Herramientas/.secrets"
sudo -u vault sh -c "umask 077; cat > '$S/sire.json'"          # {"tipo_documento":"CC","numero_documento":"…","password":"…"}
sudo -u vault sh -c "umask 077; cat > '$S/sire_export.json'"   # {"url":"https://estar.com.co/api/sire-export","token":"<SIRE_EXPORT_TOKEN>"}
```

(Se pega el JSON y se cierra con Ctrl-D. Así no queda en el historial del
shell; las plantillas sin valores están en `tools/sire-uploader/ejemplos/`.)

El usuario del portal es el de la persona registrada ante Migración para el
hotel. `tipo_documento` vale con el valor o el texto de la opción del portal
(`CC`, `Cédula de Ciudadanía`, …).

## Primero, el ensayo

**El ensayo hace todo menos subir**: descarga la exportación, escribe el archivo
en una carpeta temporal 700 (y lo borra), entra al portal, llega a «Cargar
información → Alojamiento y hospedaje → Cargar archivo» y toma capturas del
formulario y de la guía de formato.

```bash
sudo -u vault bash "/opt/vault/99 - Herramientas/vps/sire_vps.sh" --ensayo
tail -40 "/opt/vault/90 - Datos/sire.log"
ls /home/vault/.local/state/estar-sire/capturas/
```

Las capturas no llevan datos de huéspedes (el formulario está vacío); sí pueden
mostrar el nombre del usuario del portal. La carpeta es 700 de `vault`; para
verlas en el portátil:
`ssh vault-vps 'sudo -u vault tar -C /home/vault/.local/state/estar-sire -cz capturas/<fecha>' > capturas-sire.tgz`.
Además de las imágenes quedan `ensayo_login.json` y `ensayo_formulario.json`:
el inventario de campos de cada pantalla (ids, nombres, opciones, sin valores),
que es lo que se usa para ajustar `portal.json`.

**Con las capturas en la mano se coteja el formato.** Nada de esto está
confirmado contra el portal; cada punto se corrige sin tocar código:

| qué | hoy | dónde se cambia |
| :-- | :-- | :-- |
| separador de columnas | tabulador | `SIRE_DELIMITER` (panel /admin) |
| formato de fecha | `YYYY-MM-DD` (las guías sugieren `DD/MM/YYYY`) | `SIRE_DATE_FORMAT` (panel /admin) |
| orden de columnas | código hotel, ciudad, tipo doc., número, nacionalidad, apellidos, nombres, E/S, fecha, procedencia, destino, nacimiento | `SIRE_COLUMNS` en Netlify (p. ej. `primer_apellido,segundo_apellido`) |
| códigos de tipo de documento | Pasaporte 3, CE 5, documento extranjero 10 | `SIRE_DOC_TYPE_CODES_JSON` |
| códigos de país | tabla DANE/DIAN (España 245, EE. UU. 249…) | `SIRE_COUNTRY_CODES_JSON` |
| códigos de ciudad (procedencia/destino en Colombia) | DIVIPOLA (Bogotá 11001…) | `SIRE_CITY_CODES_JSON` |
| nombres | MAYÚSCULAS sin tildes | `SIRE_TEXT_ASCII=false` para dejarlos como vienen |
| selectores y textos del portal | `portal.json` | `99 - Herramientas/sire/portal.json` |

Después de cada cambio, otro ensayo. El ensayo termina en `ENSAYO SIN
PROBLEMAS` y código 0 cuando todo cuadra.

## La confirmación del dueño, y la primera subida

**Sin el visto bueno del dueño no hay subida real.** Con el ensayo limpio y las
capturas revisadas con él, se deja constancia:

```bash
sudo -u vault sh -c 'umask 077; echo "Autorizado por <nombre> el <fecha>, tras revisar el ensayo" > "/opt/vault/99 - Herramientas/.secrets/sire_autorizacion.txt"'
```

La primera subida se hace **a mano, mirando**:

```bash
sudo -u vault bash "/opt/vault/99 - Herramientas/vps/sire_vps.sh" --subir
tail -40 "/opt/vault/90 - Datos/sire.log"
```

y se comprueba en el portal que los registros quedaron. La línea `resultado del
portal:` dice cómo se leyó el mensaje del portal (el texto va tachado). **El
formato de ese mensaje tampoco está confirmado**: si sale `incierto`, el
programa no marca nada como reportado y se bloquea hasta que una persona mire el
portal — mejor eso que reportar dos veces. Con el mensaje real a la vista se
ajusta la lectura (`interpretar_resultado` en `sire_comun.py`) y se cierra con
`--resolver reportado`.

## Encender el temporizador

Solo después de una primera subida limpia:

```bash
sudo install -m 644 "/opt/vault/99 - Herramientas/vps/vault-sire.service" "/opt/vault/99 - Herramientas/vps/vault-sire.timer" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now vault-sire.timer
systemctl list-timers "vault-*"
```

## Cómo saber si funcionó

```bash
ssh vault-vps 'tail -40 "/opt/vault/90 - Datos/sire.log"'
```

**La señal fiable es la línea `---- fin, codigo N ----` de ese día**, no que
el temporizador exista. Si algo sale mal llega un correo (el mismo relé SMTP de
la alarma de la ingesta, `VAULT_SMTP` de `ingesta.env`); lo repetido se recuerda
cada 3 días y los datos incompletos solo cuando aparece uno nuevo.

| código | qué pasó | qué hacer |
| --: | :-- | :-- |
| 0 | bien, o nada que reportar | nada |
| 3 | configuración (secretos, permisos, Netlify) | leer el mensaje |
| 4 | CAPTCHA o verificación humana: el archivo quedó en `…/estar-sire/pendientes/` | subirlo a mano y `--resolver reportado` |
| 5 | el portal rechazó registros | corregir a mano y `--resolver reportado`, o corregir el dato y `--resolver reintentar` |
| 6 | no se sabe si el portal cargó el archivo | mirar el portal: `--resolver reportado` o `reintentar` |
| 7 | hay algo pendiente de antes: no se sube nada hasta resolverlo | `--resolver …`; con `ack_pendiente` el archivo YA está en el portal: **solo** `--resolver reportado` |
| 8 | falta `sire_autorizacion.txt` | ensayo + visto bueno |
| 9 | el portal rechazó el usuario o la clave | revisar `sire.json` |

Lo que se acumule mientras algo está bloqueado (o la exportación apagada, o el
VPS caído) **no se pierde**: la exportación devuelve los movimientos sin
reportar anteriores a la ventana y la pasada siguiente se pone al día sola
desde el más antiguo (avisa por correo cuando lo hace).

Antes de exportar, la página comprueba cada reserva en Kunas: si está
**cancelada o no-show** no se reporta nada a Migración y llega el aviso; las
fechas que se reportan son las de Kunas (salida anticipada o extensión).

`--resolver` se corre igual que lo demás:
`sudo -u vault bash "/opt/vault/99 - Herramientas/vps/sire_vps.sh" --resolver reportado`.

**Huéspedes con datos incompletos** (un país que no está en la tabla, un
destino que no se reconoce, un check-in sin fechas): no se suben y el aviso dice
qué falta, con el código de reserva y el número del huésped. Se completan en el
portal a mano o se corrige la tabla de códigos.

**Lo que no hace.** No comprueba contra Kunas si el huésped llegó de verdad: un
check-in en línea de alguien que no llegó (no-show) saldría como entrada.
Recepción tiene que saberlo.

## Datos personales (Ley 1581)

- Los datos solo salen hacia el SIRE. El registro y los avisos llevan **conteos,
  códigos de reserva e índices de huésped**; nunca nombres, documentos ni fechas
  de nacimiento. El mensaje del portal se registra tachado.
- El archivo de cada pasada vive en una carpeta 700 y se borra al terminar. El
  que se deja para subida manual (600) se borra al resolver, o a los 15 días.
- Las capturas son solo del ensayo. En la web, el registro de lo ya reportado
  (`sire-reports`) guarda ids opacos y el código de reserva.
