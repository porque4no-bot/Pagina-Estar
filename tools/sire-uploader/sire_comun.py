# -*- coding: utf-8 -*-
"""Piezas del subidor SIRE que no necesitan navegador.

Secretos, descarga de la exportacion de estar.com.co, el archivo temporal, la
lectura del resultado que muestra el portal, el estado local y el aviso por
correo. Todo lo que se puede probar sin Playwright vive aqui.

Reglas de la casa que se cumplen en este modulo:
  - Ningun secreto ni dato personal en el registro: los mensajes llevan
    conteos, codigos de reserva e indices de huesped, nunca nombres, numeros
    de documento ni fechas de nacimiento.
  - Lo que lleva datos personales se escribe con umask 077 (archivos 600,
    carpetas 700) y se borra en cuanto deja de hacer falta.
"""

import json
import os
import re
import smtplib
import socket
import tempfile
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path

BOGOTA = timezone(timedelta(hours=-5))

# Codigos de salida (documentados en README.md / SIRE.md).
OK = 0
ERROR = 1
USO = 2
CONFIG = 3
VERIFICACION_HUMANA = 4
RECHAZOS = 5
NO_VERIFICABLE = 6
BLOQUEADO = 7
NO_AUTORIZADA = 8
LOGIN = 9

ID_RE = re.compile(r"^[a-f0-9]{24}$")
FECHA_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ARCHIVO_AUTORIZACION = "sire_autorizacion.txt"
DIAS_RETENCION_PENDIENTES = 15


class ErrorSire(Exception):
    """Fallo con codigo de salida y un mensaje que NO lleva datos personales."""

    def __init__(self, codigo, mensaje):
        super().__init__(mensaje)
        self.codigo = codigo
        self.mensaje = mensaje


def ahora():
    return datetime.now(BOGOTA)


def log(mensaje):
    """Una linea al registro (stdout; el envoltorio la manda a sire.log)."""
    print("[sire %s] %s" % (ahora().strftime("%Y-%m-%d %H:%M:%S"), mensaje), flush=True)


# ---------------------------------------------------------------- rutas


def dir_secretos(argumento=None):
    """Carpeta de secretos: --secretos, SIRE_SECRETOS, o la primera `.secrets`
    subiendo desde este fichero (en el VPS: '99 - Herramientas/.secrets')."""
    if argumento:
        return Path(argumento)
    env = os.environ.get("SIRE_SECRETOS")
    if env:
        return Path(env)
    aqui = Path(__file__).resolve().parent
    for p in [aqui, *aqui.parents]:
        candidato = p / ".secrets"
        if candidato.is_dir():
            return candidato
    return Path("/opt/vault/99 - Herramientas/.secrets")


def dir_estado(argumento=None):
    """Estado local (sin datos personales salvo el archivo pendiente, 600):
    --estado, SIRE_ESTADO, o ~/.local/state/estar-sire (fuera del repo)."""
    if argumento:
        base = Path(argumento)
    elif os.environ.get("SIRE_ESTADO"):
        base = Path(os.environ["SIRE_ESTADO"])
    else:
        xdg = os.environ.get("XDG_STATE_HOME") or str(Path.home() / ".local" / "state")
        base = Path(xdg) / "estar-sire"
    crear_dir_privado(base)
    return base


def crear_dir_privado(ruta):
    ruta = Path(ruta)
    viejo = os.umask(0o077)
    try:
        ruta.mkdir(parents=True, exist_ok=True)
    finally:
        os.umask(viejo)
    if os.name == "posix":
        os.chmod(ruta, 0o700)
    return ruta


# ---------------------------------------------------------------- secretos


def permisos_privados(ruta):
    """En POSIX: True si grupo y otros no tienen ningun permiso (600/400)."""
    if os.name != "posix":
        return True
    return (os.stat(ruta).st_mode & 0o077) == 0


def leer_secreto_json(ruta, requeridos):
    """Lee un JSON de `.secrets`. Los errores nombran el fichero y los CAMPOS,
    nunca los valores."""
    ruta = Path(ruta)
    if not ruta.is_file():
        raise ErrorSire(CONFIG, "falta %s en %s" % (ruta.name, ruta.parent))
    if not permisos_privados(ruta):
        raise ErrorSire(CONFIG, "%s tiene permisos demasiado abiertos: debe ser 600 (chmod 600)" % ruta.name)
    try:
        datos = json.loads(ruta.read_text(encoding="utf-8"))
    except Exception:
        raise ErrorSire(CONFIG, "%s no es un JSON valido" % ruta.name)
    if not isinstance(datos, dict):
        raise ErrorSire(CONFIG, "%s debe ser un objeto JSON" % ruta.name)
    faltan = [k for k in requeridos if not str(datos.get(k, "")).strip()]
    if faltan:
        raise ErrorSire(CONFIG, "%s: faltan campos %s" % (ruta.name, ", ".join(faltan)))
    return datos


def leer_credenciales(secretos):
    return leer_secreto_json(Path(secretos) / "sire.json", ["tipo_documento", "numero_documento", "password"])


def leer_config_exportacion(secretos):
    datos = leer_secreto_json(Path(secretos) / "sire_export.json", ["url", "token"])
    url = str(datos["url"]).strip()
    partes = urllib.parse.urlparse(url)
    local = partes.hostname in ("127.0.0.1", "localhost", "::1")
    if partes.scheme != "https" and not (partes.scheme == "http" and local):
        raise ErrorSire(CONFIG, "sire_export.json: la url debe ser https")
    return {"url": url, "token": str(datos["token"]).strip()}


def subida_autorizada(secretos):
    """La primera subida real necesita la confirmacion del dueno: se deja
    constancia en `.secrets/sire_autorizacion.txt` (quien y cuando)."""
    ruta = Path(secretos) / ARCHIVO_AUTORIZACION
    return ruta.is_file() and bool(ruta.read_text(encoding="utf-8", errors="replace").strip())


# ---------------------------------------------------------------- exportacion


def _peticion(cfg, metodo="GET", query=None, cuerpo=None, timeout=60):
    url = cfg["url"]
    if query:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(query)
    datos = None
    cabeceras = {
        "Authorization": "Bearer " + cfg["token"],
        "Accept": "application/json",
        "User-Agent": "estar-sire-subidor/1",
    }
    if cuerpo is not None:
        datos = json.dumps(cuerpo).encode("utf-8")
        cabeceras["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=datos, method=metodo, headers=cabeceras)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError) as e:
        raise ErrorSire(ERROR, "no se pudo conectar con la exportacion (%s)" % type(e).__name__)


def _mensaje_servidor(cuerpo):
    """El campo `error` de la respuesta (lo escribe nuestra funcion: sin datos
    personales), recortado."""
    try:
        return str(json.loads(cuerpo.decode("utf-8")).get("error", ""))[:160]
    except Exception:
        return ""


def descargar_exportacion(cfg, desde=None, hasta=None):
    query = {}
    if desde:
        query["desde"] = desde
    if hasta:
        query["hasta"] = hasta
    estado, cuerpo = _peticion(cfg, "GET", query=query)
    if estado == 401:
        raise ErrorSire(CONFIG, "la exportacion rechazo el token (401): revisar sire_export.json y SIRE_EXPORT_TOKEN en Netlify")
    if estado == 503:
        raise ErrorSire(CONFIG, "la exportacion esta apagada o sin configurar (503): %s" % _mensaje_servidor(cuerpo))
    if estado == 429:
        raise ErrorSire(ERROR, "la exportacion pidio esperar (429, limite de peticiones)")
    if estado != 200:
        raise ErrorSire(ERROR, "la exportacion respondio %s: %s" % (estado, _mensaje_servidor(cuerpo)))
    try:
        datos = json.loads(cuerpo.decode("utf-8"))
    except Exception:
        raise ErrorSire(ERROR, "la exportacion no devolvio JSON")
    validar_exportacion(datos)
    return datos


def lineas_de(txt):
    if not txt:
        return []
    return txt.split("\r\n") if "\r\n" in txt else txt.split("\n")


def validar_exportacion(datos):
    """Que cada linea del txt tenga su fila y viceversa: si no, el ack marcaria
    movimientos equivocados."""
    if not isinstance(datos, dict):
        raise ErrorSire(ERROR, "exportacion con forma inesperada")
    for clave in ("listo", "filas", "txt", "avisos", "conteos"):
        if clave not in datos:
            raise ErrorSire(ERROR, "exportacion sin el campo %s" % clave)
    filas = datos["filas"] or []
    lineas = lineas_de(datos["txt"] or "")
    if len(filas) != len(lineas):
        raise ErrorSire(ERROR, "exportacion incoherente: %d lineas y %d filas" % (len(lineas), len(filas)))
    for f in filas:
        if not isinstance(f, dict) or not ID_RE.match(str(f.get("id", ""))):
            raise ErrorSire(ERROR, "exportacion con un id de fila invalido")
    return True


def enviar_ack(cfg, filas, lote):
    if not filas:
        return {"marcados": 0, "yaEstaban": 0}
    cuerpo = {
        "accion": "ack",
        "lote": lote,
        "filas": [{"id": f["id"], "ref": f.get("ref"), "movimiento": f.get("movimiento"), "fecha": f.get("fecha")} for f in filas],
    }
    estado, respuesta = _peticion(cfg, "POST", cuerpo=cuerpo)
    if estado != 200:
        raise ErrorSire(ERROR, "el ack fallo (%s): %s" % (estado, _mensaje_servidor(respuesta)))
    try:
        return json.loads(respuesta.decode("utf-8"))
    except Exception:
        return {}


def quitar_rechazados(datos, rechazados):
    """Saca del lote los movimientos que el portal ya rechazo y esperan
    correccion manual (no se reintentan solos cada dia)."""
    filas, lineas = [], []
    for fila, linea in zip(datos.get("filas") or [], lineas_de(datos.get("txt") or "")):
        if fila["id"] in rechazados:
            continue
        filas.append(fila)
        lineas.append(linea)
    return filas, lineas


# ---------------------------------------------------------------- archivo


def nombre_archivo(momento=None):
    momento = momento or ahora()
    return "sire_%s.txt" % momento.strftime("%Y%m%d_%H%M%S")


def escribir_archivo(lineas, carpeta, nombre, codificacion="utf-8", fin_de_linea="\r\n"):
    """Escribe el archivo para el portal con permisos 600 (umask 077). Falla si
    ya existe: nunca pisa otro archivo."""
    carpeta = crear_dir_privado(carpeta)
    ruta = Path(carpeta) / nombre
    contenido = fin_de_linea.join(lineas).encode(codificacion)
    viejo = os.umask(0o077)
    try:
        fd = os.open(str(ruta), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(contenido)
    finally:
        os.umask(viejo)
    return ruta


def carpeta_temporal():
    """Carpeta 700 para el archivo de la pasada (mkdtemp ya la crea 700)."""
    return Path(tempfile.mkdtemp(prefix="sire-"))


def borrar(ruta):
    """Borra un archivo (y su carpeta temporal si quedo vacia). Nunca lanza."""
    if not ruta:
        return
    ruta = Path(ruta)
    try:
        if ruta.is_file():
            ruta.unlink()
    except OSError:
        pass
    try:
        if ruta.parent.name.startswith("sire-") and not any(ruta.parent.iterdir()):
            ruta.parent.rmdir()
    except OSError:
        pass


# ---------------------------------------------------------------- resultado del portal


def _sin_tildes(texto):
    return "".join(c for c in unicodedata.normalize("NFD", texto or "") if unicodedata.category(c) != "Mn").lower()


PALABRAS_EXITO = (
    "exitosamente", "exitoso", "exitosa", "correctamente", "satisfactoriamente",
    "con exito", "se cargo", "se cargaron", "carga finalizada", "proceso finalizado",
    "sin observaciones", "sin errores",
)
PALABRAS_ERROR = (
    "error", "rechaz", "invalid", "no se pudo", "fallid", "fallo", "observacion", "incorrect", "no valid",
)
_ERR = r"error(?:es)?"
_OBS = r"observacion(?:es)?"
_MALOS = r"(?:con\s+(?:%s|%s)|rechazados?|fallidos?|invalidos?)" % (_ERR, _OBS)
NEGACIONES = (
    r"sin\s+%s" % _OBS, r"sin\s+%s" % _ERR, r"\b0\s+%s" % _ERR, r"%s\s*:\s*0\b" % _ERR,
    r"%s\s*:\s*0\b" % _MALOS, r"\b0\s+registros?\s+%s" % _MALOS,
)
RE_REFERENCIA = re.compile(r"\b(?:registro|linea|fila)\s*(?:n(?:o|ro|um|umero)?\.?\s*)?[:#]?\s*(\d{1,5})\b")
# "etiqueta: N" primero; "N registros ..." despues y sin cruzar de linea (_E =
# espacio que no es salto), para no tomar el numero de la linea de arriba.
_E = r"[^\S\n]"
RE_CARGADOS = (
    re.compile(r"(?:registros\s+)?(?:cargados|exitosos|aceptados|validos|procesados(?:\s+correctamente)?)\s*:\s*(\d+)"),
    re.compile(r"(\d+)%s+registros?%s+(?:fueron%s+)?(?:cargad|procesad|aceptad|exitos|correctamente|valid)" % (_E, _E, _E)),
    re.compile(r"se%s+(?:cargaron|procesaron)%s+(\d+)" % (_E, _E)),
)
RE_CON_ERROR = (
    re.compile(r"(?:registros\s+)?%s\s*:\s*(\d+)" % _MALOS),
    re.compile(r"(\d+)%s+registros?%s+%s" % (_E, _E, _MALOS)),
)


def _primer_numero(patrones, texto):
    for p in patrones:
        m = p.search(texto)
        if m:
            return int(m.group(1))
    return None


def interpretar_resultado(texto, n_lineas):
    """Lee lo que el portal dijo despues de cargar el archivo.

    Devuelve {estado, rechazadas, cargados, con_error}. `estado`:
      - 'aceptado'  : exito claro, sin referencias a registros ni palabras de error.
      - 'parcial'   : el portal nombra registros con observacion Y las cuentas
                      cuadran (cargados = total - rechazados): se puede hacer ack
                      del resto con seguridad.
      - 'rechazado' : error y 0 registros cargados (nada entro).
      - 'incierto'  : cualquier otra cosa. No se hace ack de nada y se bloquea
                      hasta que una persona mire el portal: mejor eso que
                      reportar dos veces.
    El formato real del mensaje del portal NO esta confirmado (TODO: ajustar en
    la primera subida supervisada); por eso la regla es conservadora.
    """
    t = _sin_tildes(texto)
    t = re.sub(r"[^\S\n]+", " ", t)
    cargados = _primer_numero(RE_CARGADOS, t)
    con_error = _primer_numero(RE_CON_ERROR, t)
    limpio = t
    for patron in NEGACIONES:
        limpio = re.sub(patron, " ", limpio)
    refs = sorted({int(m.group(1)) for m in RE_REFERENCIA.finditer(limpio)})
    hay_error = any(p in limpio for p in PALABRAS_ERROR)
    hay_exito = any(p in t for p in PALABRAS_EXITO)
    base = {"rechazadas": [], "cargados": cargados, "con_error": con_error}

    if not t.strip():
        return dict(base, estado="incierto", motivo="el portal no mostro ningun mensaje")
    if any(r < 1 or r > n_lineas for r in refs):
        return dict(base, estado="incierto", motivo="el portal nombra registros fuera del archivo")
    if not refs and not hay_error:
        if cargados is not None and cargados != n_lineas:
            return dict(base, estado="incierto", motivo="el portal dice %d cargados de %d" % (cargados, n_lineas))
        if hay_exito or cargados == n_lineas:
            return dict(base, estado="aceptado", motivo="exito")
        return dict(base, estado="incierto", motivo="mensaje del portal no reconocido")
    if refs:
        cuentas = cargados is not None or con_error is not None
        cuadra = cuentas
        if cargados is not None and cargados != n_lineas - len(refs):
            cuadra = False
        if con_error is not None and con_error != len(refs):
            cuadra = False
        if cuadra:
            return dict(base, estado="parcial", rechazadas=refs, motivo="observaciones en %d registro(s)" % len(refs))
        return dict(base, estado="incierto", rechazadas=refs, motivo="observaciones sin cuentas que cuadren")
    if cargados == 0:
        return dict(base, estado="rechazado", motivo="el portal no cargo ningun registro")
    return dict(base, estado="incierto", motivo="el portal reporto un error general")


def valores_sensibles(lineas, delimitador="\t"):
    """Lo que se tachara de cualquier texto del portal antes de registrarlo:
    cada celda del archivo con 2+ caracteres (un apellido como LI o WU) y cada
    palabra de 3+ dentro de una celda."""
    valores = set()
    for linea in lineas:
        for celda in linea.split(delimitador):
            celda = celda.strip()
            if len(celda) >= 2:
                valores.add(celda)
                for palabra in re.split(r"\s+", celda):
                    if len(palabra) >= 3:
                        valores.add(palabra)
    return valores


def redactar(texto, sensibles=()):
    """Tacha datos personales de un texto del portal: los valores del archivo
    (como palabra entera, sin distinguir mayusculas ni tildes) y, por si acaso,
    cualquier cadena con 5+ letras/digitos que tenga digitos, y las fechas."""
    salida = texto or ""
    for v in sorted(sensibles, key=len, reverse=True):
        patron = r"(?<![A-Za-z0-9])%s(?![A-Za-z0-9])" % re.escape(v)
        salida = re.sub(patron, "***", salida, flags=re.IGNORECASE)
        sin = "".join(ch for ch in unicodedata.normalize("NFD", salida) if unicodedata.category(ch) != "Mn")
        if sin != salida and re.search(patron, sin, flags=re.IGNORECASE):
            salida = re.sub(patron, "***", sin, flags=re.IGNORECASE)
    salida = re.sub(r"\b(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{5,}\b", "***", salida)
    salida = re.sub(r"\d{1,4}[/-]\d{1,2}[/-]\d{1,4}", "***", salida)
    return re.sub(r"\s+", " ", salida).strip()[:600]


# ---------------------------------------------------------------- estado local


def cargar_estado(carpeta):
    ruta = Path(carpeta) / "estado.json"
    if not ruta.is_file():
        return {"bloqueo": None, "rechazados": {}, "historial": []}
    try:
        datos = json.loads(ruta.read_text(encoding="utf-8"))
    except Exception:
        raise ErrorSire(ERROR, "estado.json esta danado: revisar a mano (%s)" % ruta)
    datos.setdefault("bloqueo", None)
    datos.setdefault("rechazados", {})
    datos.setdefault("historial", [])
    return datos


def guardar_estado(carpeta, estado):
    """Escritura atomica, 600. El estado guarda ids opacos, codigos de reserva,
    conteos y la ruta del archivo pendiente: ningun dato personal."""
    carpeta = crear_dir_privado(carpeta)
    ruta = Path(carpeta) / "estado.json"
    tmp = Path(carpeta) / ("estado.json.%d.tmp" % os.getpid())
    viejo = os.umask(0o077)
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(estado, f, ensure_ascii=False, indent=1)
        os.replace(tmp, ruta)
    finally:
        os.umask(viejo)
    return ruta


def anotar_historial(estado, entrada, maximo=60):
    estado.setdefault("historial", []).append(entrada)
    del estado["historial"][:-maximo]


def purgar_pendientes(carpeta, dias=DIAS_RETENCION_PENDIENTES, ahora_ts=None):
    """Ley 1581: un archivo dejado para subida manual no se guarda para siempre."""
    pendientes = Path(carpeta) / "pendientes"
    if not pendientes.is_dir():
        return 0
    limite = (ahora_ts or time.time()) - dias * 86400
    borrados = 0
    for f in pendientes.glob("sire_*.txt"):
        try:
            if f.stat().st_mtime < limite:
                f.unlink()
                borrados += 1
        except OSError:
            pass
    return borrados


# ---------------------------------------------------------------- aviso


def resumen_avisos(avisos, maximo=40):
    """Avisos de la exportacion → lineas legibles SIN datos personales."""
    lineas = []
    for a in (avisos or [])[:maximo]:
        movs = "/".join(a.get("movimientos") or []) or "-"
        lineas.append("  reserva %s, huesped %s (%s): falta %s" % (
            a.get("ref"), a.get("huesped"), movs, ", ".join(a.get("faltan") or [])))
    if avisos and len(avisos) > maximo:
        lineas.append("  ... y %d mas" % (len(avisos) - maximo))
    return lineas


def avisar(asunto, cuerpo, enviar=True):
    """Correo al responsable por el rele SMTP del VPS (VAULT_SMTP=host:puerto,
    sin contrasena, POR IPv4 A LA FUERZA: la IP registrada en Google es la v4).
    Misma convencion que la alarma de la ingesta. El cuerpo NUNCA lleva datos
    personales. Si no se puede enviar, queda en el registro."""
    texto = cuerpo if isinstance(cuerpo, str) else "\n".join(cuerpo)
    log("AVISO: %s" % asunto)
    for linea in texto.splitlines():
        print("    " + linea, flush=True)
    if not enviar:
        return False
    rele = os.environ.get("VAULT_SMTP", "").strip()
    para = os.environ.get("SIRE_AVISO_A", "").strip()
    if not rele or not para:
        log("NO se pudo enviar el aviso (falta VAULT_SMTP o SIRE_AVISO_A); queda en el registro")
        return False
    try:
        m = EmailMessage()
        m["From"] = os.environ.get("SIRE_AVISO_DE", "").strip() or para
        m["To"] = para
        m["Subject"] = asunto
        m.set_content(texto)
        host, _, puerto = rele.partition(":")
        with smtplib.SMTP(host, int(puerto or 587), timeout=30, source_address=("0.0.0.0", 0)) as s:
            s.ehlo("archivo.grupopinao.com")
            s.starttls()
            s.ehlo("archivo.grupopinao.com")
            s.send_message(m)
        log("aviso enviado")
        return True
    except Exception as e:
        log("NO se pudo enviar el aviso (%s); queda en el registro" % type(e).__name__)
        return False
