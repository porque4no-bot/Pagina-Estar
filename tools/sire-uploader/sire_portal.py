# -*- coding: utf-8 -*-
"""El portal SIRE de Migracion Colombia, manejado con Playwright (API sincrona).

Portal JSF/RichFaces sin API. Los selectores y los textos del menu viven en
`portal.json` para poder ajustarlos despues del ensayo sin tocar codigo.

Reglas:
  - Si aparece un CAPTCHA o cualquier verificacion humana, NO se intenta
    saltar: se lanza VerificacionHumana y quien llama deja el archivo listo y
    avisa.
  - No se registran valores escritos en formularios ni el texto de las
    observaciones sin tachar. Las capturas solo se toman antes de cargar el
    archivo (formulario vacio, guia de formato): nunca del resultado.
"""

import json
import os
import re
import time
import unicodedata
from contextlib import contextmanager
from pathlib import Path

from sire_comun import CONFIG, ERROR, LOGIN, VERIFICACION_HUMANA, ErrorSire, crear_dir_privado, log, redactar

CAPTCHA_SELECTORES = (
    "iframe[src*='recaptcha']", "iframe[src*='hcaptcha']", "iframe[src*='turnstile']",
    ".g-recaptcha", ".h-captcha", ".cf-turnstile", "[data-sitekey]",
    "img[id*='captcha' i]", "img[src*='captcha' i]", "input[name*='captcha' i]", "input[id*='captcha' i]",
)
CAPTCHA_TEXTOS = (
    "no soy un robot", "i'm not a robot", "verifica que eres humano", "verifique que es humano",
    "verificacion humana", "captcha", "codigo de verificacion", "codigo de la imagen",
)
CARGANDO = ("cargando", "procesando", "espere", "loading", "por favor espere")


class VerificacionHumana(ErrorSire):
    def __init__(self, mensaje):
        super().__init__(VERIFICACION_HUMANA, mensaje)


class PortalCambio(ErrorSire):
    """El portal no tiene lo que se esperaba: hay que revisar portal.json."""

    def __init__(self, mensaje):
        super().__init__(ERROR, mensaje)


def sin_tildes(texto):
    return "".join(c for c in unicodedata.normalize("NFD", texto or "") if unicodedata.category(c) != "Mn").lower()


def regex_flexible(texto):
    """Regex que tolera tildes y mayusculas: 'Cargar informacion' encuentra
    'Cargar Información'."""
    clases = {"a": "[aá]", "e": "[eé]", "i": "[ií]", "o": "[oó]", "u": "[uúü]", "n": "[nñ]"}
    partes = []
    for c in sin_tildes(texto).strip():
        if c in clases:
            partes.append(clases[c])
        elif c.isspace():
            partes.append(r"\s+")
        else:
            partes.append(re.escape(c))
    return re.compile("".join(partes), re.IGNORECASE)


ALIAS_TIPO = {
    "cc": "ciudadania", "cedula": "ciudadania", "cedula de ciudadania": "ciudadania",
    "ce": "extranjeria", "cedula de extranjeria": "extranjeria",
    "pa": "pasaporte", "pas": "pasaporte", "pasaporte": "pasaporte", "passport": "pasaporte",
    "nit": "nit", "pep": "permiso especial", "ppt": "proteccion temporal",
}


def elegir_opcion(opciones, deseado):
    """Opcion del <select> de tipo de documento que corresponde a lo escrito en
    sire.json (valor exacto, texto exacto, alias o texto parcial). None si no
    hay ninguna."""
    d = sin_tildes(str(deseado)).strip()
    if not d:
        return None
    validas = [o for o in opciones if str(o.get("v", "")).strip() != ""]
    for o in validas:
        if sin_tildes(str(o["v"])).strip() == d:
            return o["v"]
    for o in validas:
        if sin_tildes(o.get("t", "")).strip() == d:
            return o["v"]
    clave = ALIAS_TIPO.get(d)
    if clave:
        for o in validas:
            if clave in sin_tildes(o.get("t", "")):
                return o["v"]
    for o in validas:
        if d in sin_tildes(o.get("t", "")):
            return o["v"]
    return None


def cargar_conf(ruta=None):
    ruta = Path(ruta) if ruta else Path(__file__).with_name("portal.json")
    conf = json.loads(ruta.read_text(encoding="utf-8"))
    if os.environ.get("SIRE_PORTAL_URL"):
        conf["url_login"] = os.environ["SIRE_PORTAL_URL"]
    return conf


@contextmanager
def navegador(visible=False):
    """Chromium de Playwright. SIRE_CHROMIUM permite apuntar a un ejecutable
    propio (pruebas locales). Sin trazas ni video: podrian guardar datos."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise ErrorSire(CONFIG, "falta Playwright en el venv: pip install -r requirements.txt && python -m playwright install chromium")
    with sync_playwright() as p:
        try:
            b = p.chromium.launch(headless=not visible, executable_path=os.environ.get("SIRE_CHROMIUM") or None)
        except Exception as e:
            raise ErrorSire(CONFIG, "no arranco Chromium (%s): python -m playwright install chromium" % type(e).__name__)
        ctx = b.new_context(accept_downloads=True, locale="es-CO", timezone_id="America/Bogota",
                            viewport={"width": 1366, "height": 900})
        page = ctx.new_page()
        try:
            yield page
        finally:
            try:
                ctx.close()
            finally:
                b.close()


def _chmod600(ruta):
    if os.name == "posix":
        os.chmod(ruta, 0o600)


class Portal:
    def __init__(self, page, conf, capturas=None):
        self.page = page
        self.conf = conf
        self.capturas = Path(capturas) if capturas else None
        tiempos = conf.get("tiempos_ms") or {}
        self.t_nav = int(tiempos.get("navegacion", 45000))
        self.t_res = int(tiempos.get("resultado", 120000))
        page.set_default_timeout(self.t_nav)

    # ------------------------------------------------------------ utilidades

    def _primero(self, selectores, visible=True, espera_ms=0):
        fin = time.time() + espera_ms / 1000.0
        while True:
            for s in selectores:
                try:
                    loc = self.page.locator(s)
                    n = loc.count()
                except Exception:
                    continue
                for i in range(min(n, 6)):
                    el = loc.nth(i)
                    try:
                        if not visible or el.is_visible():
                            return el
                    except Exception:
                        continue
            if time.time() >= fin:
                return None
            self.page.wait_for_timeout(250)

    def _buscar_texto(self, texto, espera_ms=8000):
        patron = regex_flexible(texto)
        fin = time.time() + espera_ms / 1000.0
        while True:
            candidatos = []
            for rol in ("link", "menuitem", "tab", "button"):
                candidatos.append(self.page.get_by_role(rol, name=patron))
            candidatos.append(self.page.get_by_text(patron))
            for loc in candidatos:
                try:
                    n = loc.count()
                except Exception:
                    continue
                for i in range(min(n, 6)):
                    el = loc.nth(i)
                    try:
                        if el.is_visible():
                            return el
                    except Exception:
                        continue
            if time.time() >= fin:
                return None
            self.page.wait_for_timeout(300)

    def _esperar_quieto(self):
        try:
            self.page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            pass

    def hay_verificacion_humana(self, pagina=None):
        p = pagina or self.page
        for s in CAPTCHA_SELECTORES:
            try:
                if p.locator(s).count():
                    return True
            except Exception:
                continue
        for f in p.frames:
            url = (f.url or "").lower()
            if any(k in url for k in ("recaptcha", "hcaptcha", "turnstile", "captcha")):
                return True
        try:
            texto = sin_tildes(p.locator("body").inner_text(timeout=5000))
        except Exception:
            texto = ""
        return any(k in texto for k in CAPTCHA_TEXTOS)

    def exigir_sin_verificacion(self, momento):
        if self.hay_verificacion_humana():
            raise VerificacionHumana("el portal pide verificacion humana (%s): no se intenta saltar" % momento)

    def capturar(self, nombre, pagina=None):
        if not self.capturas:
            return None
        crear_dir_privado(self.capturas)
        ruta = self.capturas / ("%s.png" % nombre)
        (pagina or self.page).screenshot(path=str(ruta), full_page=True)
        _chmod600(ruta)
        return ruta

    def describir(self, nombre, pagina=None):
        """Inventario de los campos de la pantalla (id, name, tipo, etiquetas y
        opciones), SIN valores escritos: sirve para calibrar portal.json."""
        if not self.capturas:
            return None
        p = pagina or self.page
        campos = p.evaluate(
            """() => Array.from(document.querySelectorAll('input,select,textarea,button,a,[role=tab],[role=menuitem]'))
                .slice(0, 400)
                .map(el => {
                  const d = { tag: el.tagName.toLowerCase(), id: el.id || '', name: el.getAttribute('name') || '',
                              type: el.getAttribute('type') || '', clase: (el.className && el.className.baseVal === undefined ? el.className : '') || '' };
                  if (d.tag === 'select') d.opciones = Array.from(el.options).map(o => ({ v: o.value, t: (o.textContent || '').trim() }));
                  if (['button', 'a'].includes(d.tag) || el.getAttribute('role') || ['submit', 'button'].includes(d.type)) {
                    d.texto = (el.innerText || el.getAttribute('value') || '').trim().slice(0, 80);
                  }
                  if (d.tag === 'a') d.href = (el.getAttribute('href') || '').slice(0, 200);
                  return d;
                })
                .filter(d => d.tag !== 'a' || d.texto)"""
        )
        crear_dir_privado(self.capturas)
        ruta = self.capturas / ("%s.json" % nombre)
        viejo = os.umask(0o077)
        try:
            ruta.write_text(json.dumps({"url": p.url, "campos": campos}, ensure_ascii=False, indent=1), encoding="utf-8")
        finally:
            os.umask(viejo)
        _chmod600(ruta)
        return ruta

    # ------------------------------------------------------------ ingreso

    def abrir_login(self):
        self.page.goto(self.conf["url_login"], wait_until="domcontentloaded")
        self._esperar_quieto()
        self.exigir_sin_verificacion("en la pagina de ingreso")

    def _elegir_tipo(self, loc, deseado):
        tag = loc.evaluate("el => el.tagName.toLowerCase()")
        if tag != "select":
            log("el tipo de documento no es un <select> nativo: se intenta como lista desplegable")
            loc.click()
            alias = ALIAS_TIPO.get(sin_tildes(str(deseado)).strip(), str(deseado))
            opcion = self._buscar_texto(alias, espera_ms=3000)
            if opcion is None:
                raise ErrorSire(CONFIG, "no se encontro en el portal el tipo de documento de sire.json")
            opcion.click()
            return
        opciones = loc.evaluate("el => Array.from(el.options).map(o => ({ v: o.value, t: (o.textContent || '').trim() }))")
        valor = elegir_opcion(opciones, deseado)
        if valor is None:
            raise ErrorSire(CONFIG, "el tipo_documento de sire.json no coincide con ninguna opcion del portal (ver ensayo_login.json)")
        loc.select_option(value=valor)
        self.page.wait_for_timeout(600)  # JSF puede refrescar el formulario al cambiar

    def iniciar_sesion(self, cred):
        L = self.conf["login"]
        tipo = self._primero(L["tipo_documento"], espera_ms=3000)
        if tipo is not None:
            self._elegir_tipo(tipo, cred["tipo_documento"])
        else:
            log("no se vio el selector de tipo de documento: se sigue sin el")
        numero = self._primero(L["numero_documento"], espera_ms=8000)
        if numero is None:
            raise PortalCambio("no se encontro el campo de numero de documento (revisar portal.json)")
        numero.fill(str(cred["numero_documento"]))
        clave = self._primero(L["password"], espera_ms=3000)
        if clave is None:
            raise PortalCambio("no se encontro el campo de contrasena (revisar portal.json)")
        clave.fill(str(cred["password"]))
        self.exigir_sin_verificacion("en el formulario de ingreso")
        boton = self._primero(L["boton"], espera_ms=3000)
        if boton is not None:
            boton.click()
        else:
            clave.press("Enter")
        self._esperar_ingreso(cred)

    def _esperar_ingreso(self, cred):
        L = self.conf["login"]
        sensibles = {str(cred.get("numero_documento", ""))}
        fin = time.time() + self.t_nav / 1000.0
        while time.time() < fin:
            if self.hay_verificacion_humana():
                raise VerificacionHumana("el portal pide verificacion humana despues de enviar el ingreso")
            # Exito = el formulario de ingreso ya no esta Y aparece el menu (un
            # texto suelto como "Cargar informacion" podria estar en la portada).
            if self._primero(L["password"]) is None:
                for texto in L["ok_textos"]:
                    if self._buscar_texto(texto, espera_ms=0) is not None:
                        log("sesion iniciada en el portal")
                        return True
            error = self._primero(L["error_selectores"])
            if error is not None:
                try:
                    msg = (error.inner_text() or "").strip()
                except Exception:
                    msg = ""
                if msg:
                    raise ErrorSire(LOGIN, "el portal rechazo el ingreso: %s" % redactar(msg, sensibles)[:160])
            self.page.wait_for_timeout(500)
        raise ErrorSire(LOGIN, "no se pudo confirmar el ingreso: no aparecio el menu ni un mensaje de error")

    def cerrar_sesion(self):
        for texto in self.conf["login"].get("salir_textos", ["Cerrar sesion", "Salir"]):
            el = self._buscar_texto(texto, espera_ms=0)
            if el is not None:
                try:
                    el.click()
                    self._esperar_quieto()
                    log("sesion cerrada")
                except Exception:
                    pass
                return

    # ------------------------------------------------------------ carga

    def ir_a_carga(self):
        for paso in self.conf["navegacion"]["pasos"]:
            self.exigir_sin_verificacion("navegando a la carga")
            el = self._buscar_texto(paso["texto"])
            if el is None:
                raise PortalCambio("no se encontro '%s' en el portal (revisar portal.json)" % paso["texto"])
            if paso.get("hover_primero"):
                el.hover()
                self.page.wait_for_timeout(500)
            el.click()
            self._esperar_quieto()
        if self._primero(self.conf["carga"]["input_archivo"], visible=False, espera_ms=10000) is None:
            raise PortalCambio("la pantalla de carga no tiene campo de archivo (revisar portal.json)")
        log("en la pantalla de carga de archivo")

    def _campos_extra(self):
        for campo in self.conf["carga"].get("campos_extra", []):
            el = self._primero(campo["selectores"], espera_ms=3000)
            if el is None:
                raise PortalCambio("no se encontro el campo extra '%s'" % campo.get("nombre", "?"))
            if "opcion" in campo:
                el.select_option(label=campo["opcion"]) if campo.get("por_etiqueta") else el.select_option(value=campo["opcion"])
            elif "valor" in campo:
                el.fill(str(campo["valor"]))
            elif campo.get("marcar"):
                el.check()

    def subir_archivo(self, ruta, al_enviar=None):
        """Carga el archivo y devuelve el texto del resultado ('' si no aparece).
        `al_enviar` se llama justo antes de entregar el archivo al portal: desde
        ahi un fallo ya no garantiza que no haya quedado cargado."""
        C = self.conf["carga"]
        self.exigir_sin_verificacion("antes de cargar el archivo")
        self._campos_extra()
        entrada = self._primero(C["input_archivo"], visible=False, espera_ms=5000)
        if entrada is None:
            raise PortalCambio("no se encontro el campo de archivo")
        if al_enviar:
            al_enviar()
        entrada.set_input_files(str(ruta))
        self.page.wait_for_timeout(800)
        boton = self._primero(C["boton_subir"], espera_ms=4000)
        if boton is not None:
            boton.click()
        log("archivo enviado al portal; esperando el resultado")
        return self._leer_resultado()

    def _leer_resultado(self):
        C = self.conf["carga"]
        fin = time.time() + self.t_res / 1000.0
        while time.time() < fin:
            if self.hay_verificacion_humana():
                raise VerificacionHumana("el portal pidio verificacion humana al cargar el archivo")
            res = self._primero(C["resultado"])
            if res is not None:
                try:
                    texto = (res.inner_text() or "").strip()
                except Exception:
                    texto = ""
                if texto and not any(k in sin_tildes(texto) for k in CARGANDO):
                    self.page.wait_for_timeout(1500)
                    try:
                        return (res.inner_text() or "").strip()
                    except Exception:
                        return texto
            self.page.wait_for_timeout(500)
        return ""

    def capturar_guia(self):
        """Busca el enlace a la guia/formato del cargue y lo guarda (pantalla,
        ventana nueva o descarga). Solo en el ensayo."""
        if not self.capturas:
            return None
        for texto in self.conf["carga"].get("guia_textos", []):
            el = self._buscar_texto(texto, espera_ms=0)
            if el is None:
                continue
            descargas, paginas = [], []

            # Funciones de verdad (Playwright les pone un atributo: un
            # list.append no lo admite).
            def al_descargar(descarga):
                descargas.append(descarga)

            def al_abrir(pagina):
                paginas.append(pagina)

            self.page.on("download", al_descargar)
            self.page.context.on("page", al_abrir)
            try:
                el.click()
                self.page.wait_for_timeout(5000)
            except Exception:
                continue
            finally:
                self.page.remove_listener("download", al_descargar)
                self.page.context.remove_listener("page", al_abrir)
            if descargas:
                d = descargas[0]
                nombre = re.sub(r"[^A-Za-z0-9._-]", "_", d.suggested_filename or "guia")[:80]
                destino = self.capturas / ("guia_" + nombre)
                d.save_as(str(destino))
                _chmod600(destino)
                return destino
            if paginas:
                otra = paginas[0]
                try:
                    otra.wait_for_load_state("domcontentloaded", timeout=15000)
                except Exception:
                    pass
                ruta = self.capturar("ensayo_guia", otra)
                self.describir("ensayo_guia", otra)
                otra.close()
                return ruta
            return self.capturar("ensayo_guia")
        return None
