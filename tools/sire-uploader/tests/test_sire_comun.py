# -*- coding: utf-8 -*-
"""Pruebas livianas del subidor SIRE: formato, lectura del resultado del
portal, tachado de datos personales, secretos, estado. Sin red ni navegador.

    python -m unittest discover -s tools/sire-uploader/tests
"""

import io
import json
import os
import sys
import tempfile
import time
import unittest
from contextlib import redirect_stdout
from pathlib import Path

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI.parent))

import sire_comun as c  # noqa: E402
import sire_portal as sp  # noqa: E402

ID1 = "a" * 24
ID2 = "b" * 24
ID3 = "c" * 24


def exportacion(lineas, filas=None, listo=True):
    filas = filas if filas is not None else [
        {"id": i, "ref": "R%d" % n, "huesped": 1, "movimiento": "E", "fecha": "2026-10-03"}
        for n, i in enumerate([ID1, ID2, ID3][: len(lineas)], 1)
    ]
    return {"listo": listo, "filas": filas, "txt": "\r\n".join(lineas), "avisos": [], "conteos": {},
            "formato": {"columnas": ["a", "b"], "delimitador": "TAB"}}


class TestResultadoPortal(unittest.TestCase):
    def test_exito_claro(self):
        r = c.interpretar_resultado("El archivo fue cargado exitosamente. Registros cargados: 3. Registros con error: 0", 3)
        self.assertEqual(r["estado"], "aceptado")

    def test_exito_sin_observaciones(self):
        self.assertEqual(c.interpretar_resultado("Proceso finalizado sin observaciones", 2)["estado"], "aceptado")

    def test_exito_con_cuenta_distinta_es_incierto(self):
        r = c.interpretar_resultado("Se cargaron 2 registros exitosamente", 3)
        self.assertEqual(r["estado"], "incierto")

    def test_parcial_con_cuentas_que_cuadran(self):
        texto = "Registros procesados correctamente: 2\nRegistros con error: 1\nRegistro 2: el codigo de nacionalidad no existe"
        r = c.interpretar_resultado(texto, 3)
        self.assertEqual(r["estado"], "parcial")
        self.assertEqual(r["rechazadas"], [2])

    def test_observaciones_sin_cuentas_es_incierto(self):
        r = c.interpretar_resultado("Línea 2: fecha inválida", 3)
        self.assertEqual(r["estado"], "incierto")
        self.assertEqual(r["rechazadas"], [2])

    def test_referencia_fuera_del_archivo_es_incierto(self):
        r = c.interpretar_resultado("Registros cargados: 2. Registros con error: 1. Fila 9: dato inválido", 3)
        self.assertEqual(r["estado"], "incierto")

    def test_rechazo_total(self):
        r = c.interpretar_resultado("Error en la estructura del archivo. Registros cargados: 0", 3)
        self.assertEqual(r["estado"], "rechazado")

    def test_vacio_o_desconocido_es_incierto(self):
        self.assertEqual(c.interpretar_resultado("", 3)["estado"], "incierto")
        self.assertEqual(c.interpretar_resultado("Bienvenido al sistema", 3)["estado"], "incierto")
        self.assertEqual(c.interpretar_resultado("Ocurrio un error inesperado", 3)["estado"], "incierto")


class TestTachado(unittest.TestCase):
    def test_redacta_valores_del_archivo_y_numeros_largos(self):
        lineas = ["H777\t17001\t3\tPA12345\t245\tMUNOZ PEREZ\tLUCIA\tE\t2026-10-03\t245\t589\t1990-02-03"]
        sensibles = c.valores_sensibles(lineas)
        texto = "Registro 1: el documento PA12345 de LUCIA MUNOZ (nacida 1990-02-03) ya existe; ref X99887766"
        salida = c.redactar(texto, sensibles)
        for dato in ("PA12345", "LUCIA", "MUNOZ", "1990-02-03", "X99887766"):
            self.assertNotIn(dato, salida)
        self.assertIn("Registro 1", salida)

    def test_resumen_de_avisos_sin_datos_personales(self):
        avisos = [{"ref": "R5", "huesped": 2, "movimientos": ["E", "S"], "faltan": ["codigo_nacionalidad"]}]
        texto = "\n".join(c.resumen_avisos(avisos))
        self.assertIn("reserva R5, huesped 2 (E/S): falta codigo_nacionalidad", texto)


class TestExportacion(unittest.TestCase):
    def test_valida_lineas_y_filas(self):
        c.validar_exportacion(exportacion(["l1", "l2"]))
        with self.assertRaises(c.ErrorSire):
            c.validar_exportacion(exportacion(["l1", "l2"], filas=[{"id": ID1}]))
        with self.assertRaises(c.ErrorSire):
            c.validar_exportacion(exportacion(["l1"], filas=[{"id": "no-hex"}]))
        c.validar_exportacion(exportacion([], filas=[]))

    def test_quitar_rechazados_mantiene_la_correspondencia(self):
        datos = exportacion(["l1", "l2", "l3"])
        filas, lineas = c.quitar_rechazados(datos, {ID2: {}})
        self.assertEqual([f["id"] for f in filas], [ID1, ID3])
        self.assertEqual(lineas, ["l1", "l3"])


class TestArchivo(unittest.TestCase):
    def test_escribe_crlf_y_no_pisa(self):
        with tempfile.TemporaryDirectory() as d:
            ruta = c.escribir_archivo(["a\tb", "c\td"], d, "x.txt")
            self.assertEqual(ruta.read_bytes(), b"a\tb\r\nc\td")
            if os.name == "posix":
                self.assertEqual(os.stat(ruta).st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                c.escribir_archivo(["z"], d, "x.txt")

    def test_borrar_quita_archivo_y_carpeta_temporal(self):
        carpeta = c.carpeta_temporal()
        ruta = c.escribir_archivo(["a"], carpeta, "y.txt")
        if os.name == "posix":
            self.assertEqual(os.stat(carpeta).st_mode & 0o777, 0o700)
        c.borrar(ruta)
        self.assertFalse(ruta.exists())
        self.assertFalse(carpeta.exists())

    def test_purga_pendientes_viejos(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "pendientes"
            p.mkdir()
            viejo = p / "sire_20260101_100000.txt"
            nuevo = p / "sire_20261007_100000.txt"
            viejo.write_text("x")
            nuevo.write_text("y")
            hace_20_dias = time.time() - 20 * 86400
            os.utime(viejo, (hace_20_dias, hace_20_dias))
            self.assertEqual(c.purgar_pendientes(d), 1)
            self.assertFalse(viejo.exists())
            self.assertTrue(nuevo.exists())


class TestSecretos(unittest.TestCase):
    def test_campos_faltantes_sin_revelar_valores(self):
        with tempfile.TemporaryDirectory() as d:
            ruta = Path(d) / "sire.json"
            ruta.write_text(json.dumps({"tipo_documento": "CC", "numero_documento": "998877", "password": ""}))
            if os.name == "posix":
                os.chmod(ruta, 0o600)
            with self.assertRaises(c.ErrorSire) as ctx:
                c.leer_credenciales(d)
            self.assertEqual(ctx.exception.codigo, c.CONFIG)
            self.assertIn("password", ctx.exception.mensaje)
            self.assertNotIn("998877", ctx.exception.mensaje)

    @unittest.skipUnless(os.name == "posix", "permisos POSIX")
    def test_rechaza_permisos_abiertos(self):
        with tempfile.TemporaryDirectory() as d:
            ruta = Path(d) / "sire.json"
            ruta.write_text(json.dumps({"tipo_documento": "CC", "numero_documento": "1", "password": "x"}))
            os.chmod(ruta, 0o644)
            with self.assertRaises(c.ErrorSire) as ctx:
                c.leer_credenciales(d)
            self.assertIn("600", ctx.exception.mensaje)

    def test_url_de_exportacion_debe_ser_https(self):
        with tempfile.TemporaryDirectory() as d:
            ruta = Path(d) / "sire_export.json"
            ruta.write_text(json.dumps({"url": "http://estar.com.co/api/sire-export", "token": "t"}))
            if os.name == "posix":
                os.chmod(ruta, 0o600)
            with self.assertRaises(c.ErrorSire):
                c.leer_config_exportacion(d)
            ruta.write_text(json.dumps({"url": "http://127.0.0.1:9999/api/sire-export", "token": "t"}))
            self.assertEqual(c.leer_config_exportacion(d)["url"], "http://127.0.0.1:9999/api/sire-export")

    def test_autorizacion(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertFalse(c.subida_autorizada(d))
            (Path(d) / c.ARCHIVO_AUTORIZACION).write_text("Rafael, 2026-10-20, tras revisar el ensayo")
            self.assertTrue(c.subida_autorizada(d))


class TestEstado(unittest.TestCase):
    def test_ida_y_vuelta(self):
        with tempfile.TemporaryDirectory() as d:
            e = c.cargar_estado(d)
            self.assertIsNone(e["bloqueo"])
            e["bloqueo"] = {"motivo": "solo_archivo", "filas": [{"id": ID1}]}
            c.anotar_historial(e, {"modo": "x"})
            c.guardar_estado(d, e)
            otra = c.cargar_estado(d)
            self.assertEqual(otra["bloqueo"]["motivo"], "solo_archivo")
            self.assertEqual(len(otra["historial"]), 1)

    def test_aviso_sin_rele_queda_en_el_registro(self):
        viejo = {k: os.environ.pop(k, None) for k in ("VAULT_SMTP", "SIRE_AVISO_A")}
        try:
            buf = io.StringIO()
            with redirect_stdout(buf):
                enviado = c.avisar("asunto", ["linea 1"])
            self.assertFalse(enviado)
            self.assertIn("NO se pudo enviar el aviso", buf.getvalue())
            self.assertIn("linea 1", buf.getvalue())
        finally:
            for k, v in viejo.items():
                if v is not None:
                    os.environ[k] = v


class TestPortalPuro(unittest.TestCase):
    def test_elegir_tipo_de_documento(self):
        opciones = [{"v": "", "t": "Seleccione"}, {"v": "1", "t": "Cédula de Ciudadanía"},
                    {"v": "5", "t": "Cédula de Extranjería"}, {"v": "3", "t": "Pasaporte"}]
        self.assertEqual(sp.elegir_opcion(opciones, "CC"), "1")
        self.assertEqual(sp.elegir_opcion(opciones, "cedula de ciudadania"), "1")
        self.assertEqual(sp.elegir_opcion(opciones, "CE"), "5")
        self.assertEqual(sp.elegir_opcion(opciones, "3"), "3")
        self.assertEqual(sp.elegir_opcion(opciones, "pasaporte"), "3")
        self.assertIsNone(sp.elegir_opcion(opciones, "NIT"))

    def test_regex_flexible_tolera_tildes(self):
        self.assertTrue(sp.regex_flexible("Cargar informacion").search("Cargar Información"))
        self.assertTrue(sp.regex_flexible("Cerrar sesión").search("CERRAR SESION"))

    def test_portal_json_tiene_lo_necesario(self):
        conf = sp.cargar_conf()
        self.assertTrue(conf["url_login"].startswith("https://apps.migracioncolombia.gov.co/sire/"))
        for clave in ("tipo_documento", "numero_documento", "password", "boton", "ok_textos", "error_selectores"):
            self.assertTrue(conf["login"][clave], clave)
        self.assertEqual([p["texto"] for p in conf["navegacion"]["pasos"]],
                         ["Cargar información", "Alojamiento y hospedaje", "Cargar archivo"])
        self.assertTrue(conf["carga"]["input_archivo"])
        self.assertEqual(conf["archivo"]["fin_de_linea"], "\r\n")


if __name__ == "__main__":
    unittest.main()
