# -*- coding: utf-8 -*-
"""El programa entero (subir_sire.main) contra una exportacion y un portal
SIMULADOS en 127.0.0.1: ensayo, subida con ack, CAPTCHA, resolver e ingreso
fallido. Prueba la orden que corre de verdad, no funciones sueltas.

Necesita Playwright + Chromium. Si no estan (o SIRE_CHROMIUM no apunta a un
Chromium), se salta. En local:
    SIRE_CHROMIUM=".../chrome.exe" python -m unittest discover -s tools/sire-uploader/tests
"""

import io
import json
import os
import sys
import tempfile
import threading
import unittest
from contextlib import redirect_stdout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI.parent))

import sire_comun as c  # noqa: E402
import subir_sire  # noqa: E402

TOKEN = "t" * 40
CLAVE = "clave-de-prueba"
DOC_USUARIO = "70123456"
FILAS = [
    {"id": "1" * 24, "ref": "R1", "huesped": 2, "movimiento": "E", "fecha": "2026-10-03"},
    {"id": "2" * 24, "ref": "R1", "huesped": 2, "movimiento": "S", "fecha": "2026-10-06"},
]
LINEAS = [
    "H777\t17001\t3\tPA12345\t245\tMUNOZ PEREZ\tLUCIA\tE\t2026-10-03\t245\t589\t1990-02-03",
    "H777\t17001\t3\tPA12345\t245\tMUNOZ PEREZ\tLUCIA\tS\t2026-10-06\t245\t589\t1990-02-03",
]

PAGINA = """<!doctype html><html><head><meta charset="utf-8"><title>SIRE simulado</title></head><body>%s</body></html>"""


def chromium_disponible():
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return False
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(headless=True, executable_path=os.environ.get("SIRE_CHROMIUM") or None)
            b.close()
        return True
    except Exception:
        return False


class Simulador:
    """Servidor con la exportacion (/api/sire-export) y el portal (/sire/...)."""

    def __init__(self):
        self.captcha = False
        self.acks = []
        self.recibidos = []
        self.reportados = set()
        sim = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _enviar(self, codigo, cuerpo, tipo="text/html; charset=utf-8"):
                datos = cuerpo.encode("utf-8") if isinstance(cuerpo, str) else cuerpo
                self.send_response(codigo)
                self.send_header("Content-Type", tipo)
                self.send_header("Content-Length", str(len(datos)))
                self.end_headers()
                self.wfile.write(datos)

            def _cuerpo(self):
                n = int(self.headers.get("Content-Length") or 0)
                return self.rfile.read(n) if n else b""

            def do_GET(self):
                ruta = urlparse(self.path).path
                if ruta == "/api/sire-export":
                    if self.headers.get("Authorization") != "Bearer " + TOKEN:
                        return self._enviar(401, json.dumps({"error": "No autorizado."}), "application/json")
                    filas = [f for f in FILAS if f["id"] not in sim.reportados]
                    lineas = [l for f, l in zip(FILAS, LINEAS) if f["id"] not in sim.reportados]
                    datos = {"ok": True, "listo": True, "filas": filas, "txt": "\r\n".join(lineas),
                             "avisos": [{"ref": "R9", "huesped": 1, "movimientos": ["E"], "faltan": ["codigo_destino"]}],
                             "conteos": {"movimientos_listos": len(filas), "incompletos": 1},
                             "rango": {"desde": "2026-10-01", "hasta": "2026-10-07"},
                             "formato": {"columnas": ["c%d" % i for i in range(12)], "delimitador": "TAB", "fecha": "YYYY-MM-DD"},
                             "configuracion": {"faltante": [], "errores": []}}
                    return self._enviar(200, json.dumps(datos), "application/json")
                if ruta == "/sire/public/login.jsf":
                    captcha = '<div class="g-recaptcha" data-sitekey="x">No soy un robot</div>' if sim.captcha else ""
                    return self._enviar(200, PAGINA % (
                        '<form id="formLogin" method="post" action="/sire/ingresar">'
                        '<select id="formLogin:tipoDocumento" name="formLogin:tipoDocumento">'
                        '<option value="">Seleccione</option><option value="1">Cédula de Ciudadanía</option>'
                        '<option value="3">Pasaporte</option></select>'
                        '<input id="formLogin:numeroDocumento" name="formLogin:numeroDocumento">'
                        '<input id="formLogin:password" name="formLogin:password" type="password">'
                        + captcha +
                        '<input id="formLogin:ingresar" type="submit" value="Ingresar"></form>'))
                if ruta == "/sire/menu":
                    return self._enviar(200, PAGINA % '<nav><a href="/sire/alojamiento">Cargar Información</a> <a href="/sire/public/login.jsf">Cerrar Sesión</a></nav>')
                if ruta == "/sire/alojamiento":
                    return self._enviar(200, PAGINA % '<div role="tablist"><a role="tab" href="/sire/opciones">Alojamiento y Hospedaje</a></div>')
                if ruta == "/sire/opciones":
                    return self._enviar(200, PAGINA % '<a href="/sire/carga">Cargar archivo</a>')
                if ruta == "/sire/carga":
                    return self._enviar(200, PAGINA % (
                        '<a href="/sire/guia" target="_blank">Guía de formato</a>'
                        '<input type="file" id="archivo"><button id="cargar" onclick="subir()">Cargar</button>'
                        '<div id="res" role="dialog" style="display:none"></div>'
                        '<a href="/sire/public/login.jsf">Cerrar sesión</a>'
                        '<script>async function subir(){const f=document.getElementById("archivo").files[0];'
                        'const t=await f.text();await fetch("/sire/recibido",{method:"POST",body:t});'
                        'const n=t.split("\\r\\n").length;const d=document.getElementById("res");'
                        'd.textContent="Proceso finalizado. Registros cargados: "+n+". Registros con error: 0";'
                        'd.style.display="block";}</script>'))
                if ruta == "/sire/guia":
                    return self._enviar(200, PAGINA % "<h1>Estructura del archivo plano</h1><p>Columnas separadas por tabulador.</p>")
                return self._enviar(404, "no")

            def do_POST(self):
                ruta = urlparse(self.path).path
                cuerpo = self._cuerpo()
                if ruta == "/api/sire-export":
                    if self.headers.get("Authorization") != "Bearer " + TOKEN:
                        return self._enviar(401, json.dumps({"error": "No autorizado."}), "application/json")
                    datos = json.loads(cuerpo.decode("utf-8"))
                    sim.acks.append(datos)
                    for f in datos.get("filas", []):
                        sim.reportados.add(f["id"])
                    return self._enviar(200, json.dumps({"ok": True, "marcados": len(datos.get("filas", [])), "yaEstaban": 0}), "application/json")
                if ruta == "/sire/ingresar":
                    campos = parse_qs(cuerpo.decode("utf-8"))
                    ok = (campos.get("formLogin:numeroDocumento") == [DOC_USUARIO]
                          and campos.get("formLogin:password") == [CLAVE]
                          and campos.get("formLogin:tipoDocumento") == ["1"])
                    if ok:
                        self.send_response(303)
                        self.send_header("Location", "/sire/menu")
                        self.end_headers()
                        return None
                    return self._enviar(200, PAGINA % (
                        '<form id="formLogin"><input id="formLogin:password" type="password">'
                        '<span class="rf-msgs-err">Usuario o contraseña incorrectos</span></form>'))
                if ruta == "/sire/recibido":
                    sim.recibidos.append(cuerpo)
                    return self._enviar(200, "ok", "text/plain")
                return self._enviar(404, "no")

        self.servidor = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.puerto = self.servidor.server_address[1]
        self.hilo = threading.Thread(target=self.servidor.serve_forever, daemon=True)
        self.hilo.start()

    def cerrar(self):
        self.servidor.shutdown()
        self.servidor.server_close()


@unittest.skipUnless(chromium_disponible(), "sin Playwright/Chromium (definir SIRE_CHROMIUM para correrla)")
class TestFlujoSimulado(unittest.TestCase):
    def setUp(self):
        self.sim = Simulador()
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.secretos = base / "secrets"
        self.estado = base / "estado"
        self.secretos.mkdir()
        self._secreto("sire.json", {"tipo_documento": "CC", "numero_documento": DOC_USUARIO, "password": CLAVE})
        self._secreto("sire_export.json", {"url": "http://127.0.0.1:%d/api/sire-export" % self.sim.puerto, "token": TOKEN})
        self.env_previo = {k: os.environ.get(k) for k in ("SIRE_PORTAL_URL", "VAULT_SMTP", "SIRE_AVISO_A")}
        os.environ["SIRE_PORTAL_URL"] = "http://127.0.0.1:%d/sire/public/login.jsf" % self.sim.puerto
        os.environ.pop("VAULT_SMTP", None)
        os.environ.pop("SIRE_AVISO_A", None)

    def tearDown(self):
        self.sim.cerrar()
        self.tmp.cleanup()
        for k, v in self.env_previo.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def _secreto(self, nombre, datos):
        ruta = self.secretos / nombre
        ruta.write_text(json.dumps(datos), encoding="utf-8")
        if os.name == "posix":
            os.chmod(ruta, 0o600)

    def _correr(self, *args):
        buf = io.StringIO()
        with redirect_stdout(buf):
            codigo = subir_sire.main(list(args) + ["--secretos", str(self.secretos), "--estado", str(self.estado)])
        salida = buf.getvalue()
        for dato in ("PA12345", "LUCIA", "MUNOZ", "1990-02-03", DOC_USUARIO, CLAVE, TOKEN):
            self.assertNotIn(dato, salida, "el registro no debe llevar %s" % dato)
        return codigo, salida

    def autorizar(self):
        (self.secretos / c.ARCHIVO_AUTORIZACION).write_text("prueba", encoding="utf-8")

    def test_ensayo_no_sube_y_deja_capturas(self):
        codigo, salida = self._correr("--ensayo")
        self.assertEqual(codigo, c.OK, salida)
        self.assertEqual(self.sim.recibidos, [])
        self.assertEqual(self.sim.acks, [])
        capturas = list((self.estado / "capturas").iterdir())[0]
        nombres = {p.name for p in capturas.iterdir()}
        for esperado in ("ensayo_login.png", "ensayo_login.json", "ensayo_formulario.png", "ensayo_formulario.json", "ensayo_guia.png"):
            self.assertIn(esperado, nombres)
        login = json.loads((capturas / "ensayo_login.json").read_text(encoding="utf-8"))
        self.assertNotIn(CLAVE, json.dumps(login))
        self.assertIn("ENSAYO SIN PROBLEMAS", salida)

    def test_subida_real_exige_autorizacion(self):
        codigo, salida = self._correr("--subir")
        self.assertEqual(codigo, c.NO_AUTORIZADA, salida)
        self.assertEqual(self.sim.recibidos, [])

    def test_subida_completa_con_ack(self):
        self.autorizar()
        codigo, salida = self._correr("--subir")
        self.assertEqual(codigo, c.OK, salida)
        self.assertEqual(self.sim.recibidos, ["\r\n".join(LINEAS).encode("utf-8")])
        self.assertEqual(len(self.sim.acks), 1)
        self.assertEqual({f["id"] for f in self.sim.acks[0]["filas"]}, {f["id"] for f in FILAS})
        estado = c.cargar_estado(self.estado)
        self.assertIsNone(estado["bloqueo"])
        self.assertEqual(estado["historial"][-1]["codigo"], 0)
        # la siguiente pasada ya no tiene nada que subir
        codigo2, salida2 = self._correr("--subir")
        self.assertEqual(codigo2, c.OK, salida2)
        self.assertIn("nada que reportar", salida2)
        self.assertEqual(len(self.sim.recibidos), 1)

    def test_captcha_deja_el_archivo_y_bloquea_hasta_resolver(self):
        self.autorizar()
        self.sim.captcha = True
        codigo, salida = self._correr("--subir")
        self.assertEqual(codigo, c.VERIFICACION_HUMANA, salida)
        self.assertEqual(self.sim.recibidos, [])
        estado = c.cargar_estado(self.estado)
        pendiente = Path(estado["bloqueo"]["archivo"])
        self.assertTrue(pendiente.is_file())
        if os.name == "posix":
            self.assertEqual(os.stat(pendiente).st_mode & 0o777, 0o600)
        # mientras haya algo pendiente no se sube nada
        self.sim.captcha = False
        codigo2, _ = self._correr("--subir")
        self.assertEqual(codigo2, c.BLOQUEADO)
        self.assertEqual(self.sim.recibidos, [])
        # una persona lo subio a mano: se marca como reportado
        codigo3, salida3 = self._correr("--resolver", "reportado")
        self.assertEqual(codigo3, c.OK, salida3)
        self.assertFalse(pendiente.exists())
        self.assertEqual({f["id"] for f in self.sim.acks[-1]["filas"]}, {f["id"] for f in FILAS})
        self.assertIsNone(c.cargar_estado(self.estado)["bloqueo"])

    def test_solo_archivo_y_resolver_reintentar(self):
        codigo, salida = self._correr("--solo-archivo")
        self.assertEqual(codigo, c.OK, salida)
        estado = c.cargar_estado(self.estado)
        archivo = Path(estado["bloqueo"]["archivo"])
        self.assertEqual(archivo.read_bytes(), "\r\n".join(LINEAS).encode("utf-8"))
        codigo2, _ = self._correr("--resolver", "reintentar")
        self.assertEqual(codigo2, c.OK)
        self.assertFalse(archivo.exists())
        self.assertEqual(self.sim.acks, [])

    def test_ingreso_rechazado(self):
        self.autorizar()
        self._secreto("sire.json", {"tipo_documento": "CC", "numero_documento": DOC_USUARIO, "password": "otra-clave"})
        codigo, salida = self._correr("--subir")
        self.assertEqual(codigo, c.LOGIN, salida)
        self.assertEqual(self.sim.recibidos, [])
        self.assertIsNone(c.cargar_estado(self.estado)["bloqueo"])


if __name__ == "__main__":
    unittest.main()
