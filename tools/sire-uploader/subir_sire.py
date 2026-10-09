#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""subir_sire.py — Sube al SIRE (Migracion Colombia) los movimientos de los
huespedes extranjeros del Hotel Estar. Corre en el VPS del grupo.

La fuente es el check-in en linea de estar.com.co: la funcion `sire-export`
entrega el archivo plano ya armado (solo extranjeros, E en el check-in y S en
el check-out) y este programa lo sube al portal con Playwright.

Modos (uno por corrida):
  --ensayo        descarga la exportacion, escribe el archivo en una carpeta
                  temporal 700, inicia sesion, llega a la pantalla de carga y
                  toma capturas del formulario y de la guia de formato. NO sube.
                  Borra el archivo al terminar.
  --subir         la subida de verdad: sube, lee las observaciones del portal,
                  hace ack de lo aceptado y borra el archivo. Exige la
                  autorizacion del dueno (.secrets/sire_autorizacion.txt).
  --solo-archivo  deja el archivo para subirlo a mano (en la carpeta de estado,
                  600) y avisa. Despues: --resolver reportado.
  --resolver reportado|reintentar
                  cierra lo pendiente (subida dudosa, archivo manual, registros
                  rechazados): `reportado` hace ack (ya esta en el portal);
                  `reintentar` lo suelta para que la proxima pasada lo suba.

En el VPS (como vault):
  bash "/opt/vault/99 - Herramientas/vps/correr.sh" sire/subir_sire.py --ensayo

Codigos de salida: 0 bien · 1 error tecnico · 2 uso · 3 configuracion ·
4 verificacion humana (CAPTCHA) · 5 el portal rechazo registros ·
6 resultado no verificable · 7 hay algo pendiente sin resolver ·
8 subida real no autorizada · 9 el portal rechazo el ingreso.

Nunca escribe en el registro datos personales ni secretos: solo conteos,
codigos de reserva e indices de huesped.
"""

import argparse
import os
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import sire_comun as c  # noqa: E402

CONSEJOS = {
    c.CONFIG: "Revisar la configuracion: secretos en .secrets/ (sire.json, sire_export.json, permisos 600) y, en Netlify, SIRE_ENABLED, SIRE_HOTEL_CODE y SIRE_EXPORT_TOKEN. Ver SIRE.md.",
    c.VERIFICACION_HUMANA: "El portal pidio verificacion humana y no se intenta saltar. Subir a mano el archivo indicado y despues correr: correr.sh sire/subir_sire.py --resolver reportado",
    c.NO_VERIFICABLE: "Entrar al portal SIRE y revisar si el archivo de esta pasada quedo cargado. Si quedo: --resolver reportado. Si no: --resolver reintentar.",
    c.BLOQUEADO: "Hay algo pendiente de una pasada anterior; mientras tanto no se sube nada para no reportar dos veces. Si el motivo es ack_pendiente el archivo YA quedo cargado en el portal: solo --resolver reportado (reintentar lo subiria otra vez). En los demas casos: --resolver reportado si quedo en el portal, --resolver reintentar si no (ver SIRE.md). Lo que se acumule mientras tanto no se pierde: la siguiente pasada se pone al dia sola.",
    c.NO_AUTORIZADA: "Correr --ensayo, revisar las capturas con el dueno y, con su visto bueno, crear .secrets/sire_autorizacion.txt (quien y cuando). Ver SIRE.md.",
    c.LOGIN: "Revisar tipo_documento / numero_documento / password en .secrets/sire.json: puede haber cambiado o vencido la clave del portal.",
    c.RECHAZOS: "El portal rechazo registros: corregirlos a mano en el portal y despues --resolver reportado (o corregir el dato en el check-in y --resolver reintentar).",
    c.ERROR: "Error tecnico: revisar el registro.",
}


def ruta_log():
    return os.environ.get("SIRE_LOG", "/opt/vault/90 - Datos/sire.log")


def asunto(texto):
    return "SIRE Hotel Estar: %s (%s)" % (texto, c.ahora().strftime("%d-%m"))


def lote_id():
    return "vps-" + c.ahora().strftime("%Y%m%dT%H%M")


def filas_minimas(filas):
    """Lo que se guarda de cada movimiento en el estado: sin datos personales."""
    return [{"id": f["id"], "ref": f.get("ref"), "huesped": f.get("huesped"),
             "movimiento": f.get("movimiento"), "fecha": f.get("fecha")} for f in filas]


def informar_exportacion(datos):
    k = datos.get("conteos") or {}
    rango = datos.get("rango") or {}
    fmt = datos.get("formato") or {}
    c.log("exportacion %s..%s: %s movimiento(s) listos (E=%s, S=%s), ya reportados %s, incompletos %s, extranjeros %s" % (
        rango.get("desde"), rango.get("hasta"), k.get("movimientos_listos"), k.get("entradas"), k.get("salidas"),
        k.get("ya_reportados"), k.get("incompletos"), k.get("extranjeros")))
    c.log("no vigentes en OTASync %s, sin verificar %s, atrasados %s, check-ins ilegibles %s" % (
        k.get("no_vigentes", 0), k.get("sin_verificar", 0), k.get("atrasados", 0), k.get("ilegibles", 0)))
    for adv in datos.get("advertencias") or []:
        c.log("ADVERTENCIA: %s" % adv)
    for linea in resumen_excluidos(datos.get("excluidos")):
        c.log(linea.strip())
    c.log("formato: %s columnas, separador %s, fecha %s" % (
        len(fmt.get("columnas") or []), fmt.get("delimitador"), fmt.get("fecha")))
    conf = datos.get("configuracion") or {}
    for f in conf.get("faltante") or []:
        c.log("configuracion faltante en Netlify: %s" % f)
    for e in conf.get("errores") or []:
        c.log("error de configuracion: %s" % e)
    for linea in c.resumen_avisos(datos.get("avisos")):
        c.log(linea.strip())


MOTIVOS_EXCLUSION = {
    "reserva_no_vigente": "cancelada o no-show en Kunas",
    "reserva_no_encontrada": "no aparece en Kunas",
    "reserva_sin_verificar": "no se pudo comprobar en Kunas (se reintenta)",
}


def resumen_excluidos(excluidos, maximo=40):
    """Reservas que la exportacion NO incluyo por su estado en OTASync. Sin
    datos personales: solo codigo de reserva y motivo."""
    lineas = []
    for e in (excluidos or [])[:maximo]:
        lineas.append("  reserva %s (%s): no se reporta, %s" % (
            e.get("ref"), "/".join(e.get("movimientos") or []) or "-",
            MOTIVOS_EXCLUSION.get(e.get("motivo"), e.get("motivo"))))
    if excluidos and len(excluidos) > maximo:
        lineas.append("  ... y %d mas" % (len(excluidos) - maximo))
    return lineas


def pendientes_atrasados(datos, estado):
    """Movimientos sin reportar anteriores a la ventana que NO son rechazos ya
    conocidos (esos esperan correccion manual y no deben frenar lo demas)."""
    rechazados = estado.get("rechazados") or {}
    filas = ((datos.get("atrasados") or {}).get("filas")) or []
    return [a for a in filas if a.get("id") not in rechazados and c.FECHA_RE.match(str(a.get("fecha") or ""))]


def ponerse_al_dia(cfg, args, datos, estado):
    """Si la cadena estuvo parada mas que la ventana (bloqueo, CAPTCHA, portal
    rechazando, exportacion apagada, VPS apagado), la exportacion devuelve los
    movimientos sin reportar anteriores en `atrasados`. Se vuelve a pedir desde
    el mas antiguo (maximo 62 dias por pasada) para que nada quede por fuera de
    la ventana. Con --desde/--hasta explicitos se respeta lo pedido."""
    if args.desde or args.hasta:
        pend = pendientes_atrasados(datos, estado)
        if pend:
            c.log("OJO: hay %d movimiento(s) sin reportar anteriores a --desde (el mas antiguo del %s)" % (
                len(pend), min(a["fecha"] for a in pend)))
        return datos
    pend = pendientes_atrasados(datos, estado)
    if not pend:
        return datos
    from datetime import date, timedelta
    desde = min(a["fecha"] for a in pend)
    hasta_original = (datos.get("rango") or {}).get("hasta") or desde
    tope = (date.fromisoformat(desde) + timedelta(days=61)).isoformat()
    hasta = min(tope, hasta_original)
    c.log("poniendose al dia: %d movimiento(s) sin reportar desde el %s; se pide %s..%s" % (
        len(pend), desde, desde, hasta))
    nuevos = c.descargar_exportacion(cfg, desde, hasta)
    nuevos["_al_dia"] = {"pendientes": len(pend), "desde": desde, "hasta": hasta,
                         "completo": hasta == hasta_original}
    informar_exportacion(nuevos)
    return nuevos


def exigir_lista(datos):
    if not datos.get("listo"):
        conf = datos.get("configuracion") or {}
        detalle = ", ".join((conf.get("faltante") or []) + (conf.get("errores") or [])) or "sin detalle"
        raise c.ErrorSire(c.CONFIG, "la exportacion no esta lista (%s)" % detalle)


def delimitador(datos):
    d = (datos.get("formato") or {}).get("delimitador") or "TAB"
    return "\t" if d == "TAB" else d


def debe_avisar(estado, clave, cada_dias):
    """Un aviso que llega todos los dias deja de leerse: lo repetido sale cada
    `cada_dias`; lo nuevo, siempre."""
    marcas = estado.setdefault("avisos_enviados", {})
    hoy = c.ahora().date()
    ultimo = marcas.get(clave)
    if ultimo:
        try:
            from datetime import date
            if (hoy - date.fromisoformat(ultimo)).days < cada_dias:
                return False
        except ValueError:
            pass
    marcas[clave] = hoy.isoformat()
    return True


def avisos_nuevos(estado, datos):
    """Avisos (datos incompletos, reservas excluidas, advertencias, puesta al
    dia) que no se habian contado antes: lo repetido no vuelve a llegar por
    correo cada dia; lo nuevo, siempre."""
    conocidos = set(estado.get("avisos_conocidos") or [])
    claves = ["%s#%s#%s" % (a.get("ref"), a.get("huesped"), ",".join(sorted(a.get("faltan") or [])))
              for a in datos.get("avisos") or []]
    claves += ["excl#%s#%s" % (e.get("ref"), e.get("motivo")) for e in datos.get("excluidos") or []
               if e.get("motivo") != "reserva_sin_verificar"]
    claves += ["adv#%s" % a for a in datos.get("advertencias") or []]
    if datos.get("_al_dia"):
        claves.append("aldia#%s" % datos["_al_dia"]["desde"])
    nuevos = [k for k in claves if k not in conocidos]
    estado["avisos_conocidos"] = claves[-500:]
    return nuevos


def notas_pendientes(datos, estado):
    notas = []
    for adv in datos.get("advertencias") or []:
        notas.append("ADVERTENCIA: %s" % adv)
    al_dia = datos.get("_al_dia")
    if al_dia:
        notas.append("La subida estuvo parada: habia %d movimiento(s) sin reportar desde el %s. Esta pasada pidio %s..%s%s." % (
            al_dia["pendientes"], al_dia["desde"], al_dia["desde"], al_dia["hasta"],
            "" if al_dia["completo"] else " (lo mas reciente sale en las pasadas siguientes)"))
    excluidos = [e for e in datos.get("excluidos") or [] if e.get("motivo") != "reserva_sin_verificar"]
    if excluidos:
        notas.append("Reservas de extranjeros que NO se reportan por su estado en Kunas (revisar que sea correcto):")
        notas.extend(resumen_excluidos(excluidos))
    avisos = datos.get("avisos") or []
    if avisos:
        notas.append("Huespedes extranjeros con datos incompletos (no se suben hasta completarlos en el check-in o a mano en el portal):")
        notas.extend(c.resumen_avisos(avisos))
    if estado.get("rechazados"):
        notas.append("Movimientos que el portal rechazo y esperan correccion manual: %d (ver --resolver)." % len(estado["rechazados"]))
    return notas


# ------------------------------------------------------------------ modos


def modo_ensayo(args, secretos, estado_dir, conf, enviar):
    from sire_portal import Portal, VerificacionHumana, navegador

    problemas = []
    capturas = estado_dir / "capturas" / c.ahora().strftime("%Y%m%d_%H%M%S")
    cred = cfg = None
    for leer in (c.leer_credenciales, c.leer_config_exportacion):
        try:
            if leer is c.leer_credenciales:
                cred = leer(secretos)
            else:
                cfg = leer(secretos)
        except c.ErrorSire as e:
            problemas.append(e)

    archivo = None
    try:
        if cfg:
            datos = c.descargar_exportacion(cfg, args.desde, args.hasta)
            informar_exportacion(datos)
            if not datos.get("listo"):
                try:
                    exigir_lista(datos)
                except c.ErrorSire as e:
                    problemas.append(e)
            lineas = c.lineas_de(datos.get("txt") or "")
            if lineas:
                archivo = c.escribir_archivo(lineas, c.carpeta_temporal(), c.nombre_archivo(),
                                             conf["archivo"]["codificacion"], conf["archivo"]["fin_de_linea"])
                esperadas = len((datos.get("formato") or {}).get("columnas") or [])
                columnas = sorted({len(l.split(delimitador(datos))) for l in lineas})
                c.log("archivo de prueba escrito (700/600): %d linea(s), columnas por linea %s (esperadas %d)" % (
                    len(lineas), columnas, esperadas))
                if columnas != [esperadas]:
                    problemas.append(c.ErrorSire(c.ERROR, "el archivo de prueba no tiene %d columnas en todas las lineas" % esperadas))
            else:
                c.log("la exportacion no trae movimientos en este rango: no hay archivo de prueba")

        if cred:
            with navegador(args.visible) as page:
                portal = Portal(page, conf, capturas)
                try:
                    portal.abrir_login()
                    portal.capturar("ensayo_login")
                    portal.describir("ensayo_login")
                    portal.iniciar_sesion(cred)
                    portal.capturar("ensayo_inicio")
                    portal.ir_a_carga()
                    portal.capturar("ensayo_formulario")
                    portal.describir("ensayo_formulario")
                    guia = portal.capturar_guia()
                    c.log("guia de formato: %s" % (guia.name if guia else "no se encontro un enlace a la guia; revisar la captura del formulario"))
                    portal.cerrar_sesion()
                except VerificacionHumana:
                    portal.capturar("ensayo_verificacion_humana")
                    raise
                except c.ErrorSire:
                    portal.capturar("ensayo_error")
                    raise
            c.log("capturas del ensayo en %s" % capturas)
    except c.ErrorSire as e:
        problemas.append(e)
    finally:
        c.borrar(archivo)
        if archivo:
            c.log("archivo de prueba borrado")

    if problemas:
        for p in problemas:
            c.log("PROBLEMA: %s" % p.mensaje)
        if enviar:
            c.avisar(asunto("el ensayo encontro problemas"), [p.mensaje for p in problemas] + ["", "Registro: %s" % ruta_log()])
        return problemas[0].codigo, {}
    c.log("ENSAYO SIN PROBLEMAS: no se subio nada. Revisar las capturas con el dueno antes de autorizar la primera subida real.")
    return c.OK, {}


def ack_o_dejar_pendiente(cfg, filas, lote, estado, estado_dir, enviar):
    try:
        r = c.enviar_ack(cfg, filas, lote)
        c.log("ack: %s marcado(s), %s ya estaban" % (r.get("marcados"), r.get("yaEstaban")))
        return True
    except c.ErrorSire as e:
        estado["bloqueo"] = {"motivo": "ack_pendiente", "desde": c.ahora().isoformat(), "lote": lote,
                             "filas": filas_minimas(filas), "archivo": None}
        c.guardar_estado(estado_dir, estado)
        c.log("el portal acepto pero el ack fallo: queda pendiente y se reintenta en la proxima pasada (%s)" % e.mensaje)
        if enviar:
            c.avisar(asunto("subido, pero falta marcarlo como reportado"), [
                "El portal acepto %d movimiento(s) pero no se pudo avisar a estar.com.co (%s)." % (len(filas), e.mensaje),
                "La proxima pasada lo reintenta sola antes de subir nada mas.",
                "Registro: %s" % ruta_log()])
        return False


def guardar_pendiente(archivo, estado_dir):
    destino_dir = c.crear_dir_privado(Path(estado_dir) / "pendientes")
    destino = destino_dir / Path(archivo).name
    # shutil.move y no os.replace: con PrivateTmp=true el /tmp del servicio es
    # otro sistema de ficheros y renombrar entre los dos falla.
    shutil.move(str(archivo), str(destino))
    if os.name == "posix":
        os.chmod(destino, 0o600)
    c.borrar(Path(archivo))  # limpia la carpeta temporal vacia
    return destino


def modo_subir(args, secretos, estado_dir, conf, enviar):
    from sire_portal import Portal, VerificacionHumana, navegador

    estado = c.cargar_estado(estado_dir)
    cfg = c.leer_config_exportacion(secretos)

    bloqueo = estado.get("bloqueo")
    if bloqueo and bloqueo.get("motivo") == "ack_pendiente":
        try:
            c.enviar_ack(cfg, bloqueo.get("filas") or [], bloqueo.get("lote"))
            c.log("ack pendiente de la pasada anterior: enviado")
            estado["bloqueo"] = None
            c.guardar_estado(estado_dir, estado)
        except c.ErrorSire as e:
            raise c.ErrorSire(c.BLOQUEADO, "sigue pendiente el ack de la subida del %s (%s). Ese archivo YA esta cargado en el portal: resolver solo con --resolver reportado" % (
                bloqueo.get("desde", "?")[:10], e.mensaje))
    bloqueo = estado.get("bloqueo")
    if bloqueo:
        raise c.ErrorSire(c.BLOQUEADO, "pendiente desde %s (%s)%s" % (
            str(bloqueo.get("desde", "?"))[:16], bloqueo.get("motivo"),
            "; archivo en %s" % bloqueo["archivo"] if bloqueo.get("archivo") else ""))

    if not c.subida_autorizada(secretos):
        raise c.ErrorSire(c.NO_AUTORIZADA, "la subida real aun no esta autorizada: falta %s" % c.ARCHIVO_AUTORIZACION)

    cred = c.leer_credenciales(secretos)
    datos = c.descargar_exportacion(cfg, args.desde, args.hasta)
    informar_exportacion(datos)
    exigir_lista(datos)
    datos = ponerse_al_dia(cfg, args, datos, estado)
    exigir_lista(datos)
    filas, lineas = c.quitar_rechazados(datos, estado.get("rechazados") or {})
    resumen = {"movimientos": len(lineas), "incompletos": (datos.get("conteos") or {}).get("incompletos", 0)}

    notas = notas_pendientes(datos, estado)
    nuevos = avisos_nuevos(estado, datos)
    c.guardar_estado(estado_dir, estado)

    if not lineas:
        c.log("nada que reportar en este rango")
        if notas and nuevos and enviar:
            c.avisar(asunto("hay pendientes del SIRE por revisar"), notas + ["", "Registro: %s" % ruta_log()])
        return c.OK, resumen

    archivo = c.escribir_archivo(lineas, c.carpeta_temporal(), c.nombre_archivo(),
                                 conf["archivo"]["codificacion"], conf["archivo"]["fin_de_linea"])
    lote = lote_id()
    enviado = {"si": False}
    texto = ""
    try:
        with navegador(args.visible) as page:
            portal = Portal(page, conf, capturas=None)  # nunca capturas en la subida real
            portal.abrir_login()
            portal.iniciar_sesion(cred)
            portal.ir_a_carga()
            texto = portal.subir_archivo(archivo, al_enviar=lambda: enviado.__setitem__("si", True))
            try:
                portal.cerrar_sesion()
            except Exception:
                pass
    except VerificacionHumana as e:
        destino = guardar_pendiente(archivo, estado_dir)
        archivo = None
        estado["bloqueo"] = {"motivo": "verificacion_humana", "desde": c.ahora().isoformat(), "lote": lote,
                             "filas": filas_minimas(filas), "archivo": str(destino), "enviado": enviado["si"]}
        c.guardar_estado(estado_dir, estado)
        raise c.ErrorSire(c.VERIFICACION_HUMANA, "%s. Archivo listo para subir a mano: %s%s" % (
            e.mensaje, destino, " (OJO: ya se habia enviado; revisar primero si quedo cargado)" if enviado["si"] else ""))
    except Exception as e:
        if enviado["si"]:
            estado["bloqueo"] = {"motivo": "no_verificable", "desde": c.ahora().isoformat(), "lote": lote,
                                 "filas": filas_minimas(filas), "archivo": None,
                                 "detalle": "fallo despues de enviar (%s)" % type(e).__name__}
            c.guardar_estado(estado_dir, estado)
            raise c.ErrorSire(c.NO_VERIFICABLE, "fallo despues de enviar el archivo (%s): no se sabe si quedo cargado" % type(e).__name__)
        raise
    finally:
        c.borrar(archivo)

    n = len(lineas)
    r = c.interpretar_resultado(texto, n)
    c.log("resultado del portal: %s (%s)" % (r["estado"], r["motivo"]))
    c.log("mensaje del portal (tachado): %s" % c.redactar(texto, c.valores_sensibles(lineas, delimitador(datos))))

    if r["estado"] == "aceptado":
        ok = ack_o_dejar_pendiente(cfg, filas, lote, estado, estado_dir, enviar)
        c.log("SUBIDA COMPLETA: %d movimiento(s) reportado(s) al SIRE" % n)
        if notas and nuevos and enviar:
            c.avisar(asunto("subida hecha; hay datos incompletos"), ["Se reportaron %d movimiento(s)." % n, ""] + notas + ["", "Registro: %s" % ruta_log()])
        return (c.OK if ok else c.ERROR), resumen

    if r["estado"] == "parcial":
        rech = set(r["rechazadas"])
        aceptadas = [f for i, f in enumerate(filas, 1) if i not in rech]
        rechazadas = [f for i, f in enumerate(filas, 1) if i in rech]
        ack_o_dejar_pendiente(cfg, aceptadas, lote, estado, estado_dir, enviar)
        estado = c.cargar_estado(estado_dir)
        for f in filas_minimas(rechazadas):
            estado.setdefault("rechazados", {})[f["id"]] = {k: f[k] for k in ("ref", "huesped", "movimiento", "fecha")}
        c.guardar_estado(estado_dir, estado)
        cuerpo = ["El portal acepto %d y rechazo %d movimiento(s):" % (len(aceptadas), len(rechazadas))]
        cuerpo += ["  reserva %s, huesped %s, %s del %s" % (f.get("ref"), f.get("huesped"), f.get("movimiento"), f.get("fecha")) for f in rechazadas]
        cuerpo += ["", CONSEJOS[c.RECHAZOS], "Registro (mensaje del portal tachado): %s" % ruta_log()]
        if enviar:
            c.avisar(asunto("el portal rechazo %d registro(s)" % len(rechazadas)), cuerpo)
        return c.RECHAZOS, resumen

    if r["estado"] == "rechazado":
        if enviar:
            c.avisar(asunto("el portal no cargo el archivo"), [
                "El portal no cargo ninguno de los %d movimiento(s) (%s)." % (n, r["motivo"]),
                "Suele ser formato (separador, fechas, columnas, codigos): revisar el mensaje tachado en el registro y la guia del portal.",
                "No se marco nada como reportado: la proxima pasada lo vuelve a intentar.",
                "Registro: %s" % ruta_log()])
        return c.RECHAZOS, resumen

    estado = c.cargar_estado(estado_dir)
    estado["bloqueo"] = {"motivo": "no_verificable", "desde": c.ahora().isoformat(), "lote": lote,
                         "filas": filas_minimas(filas), "archivo": None, "detalle": r["motivo"]}
    c.guardar_estado(estado_dir, estado)
    raise c.ErrorSire(c.NO_VERIFICABLE, "no se pudo confirmar que el portal cargo el archivo (%s)" % r["motivo"])


def modo_solo_archivo(args, secretos, estado_dir, conf, enviar):
    estado = c.cargar_estado(estado_dir)
    if estado.get("bloqueo"):
        b = estado["bloqueo"]
        raise c.ErrorSire(c.BLOQUEADO, "ya hay algo pendiente desde %s (%s)" % (str(b.get("desde", "?"))[:16], b.get("motivo")))
    cfg = c.leer_config_exportacion(secretos)
    datos = c.descargar_exportacion(cfg, args.desde, args.hasta)
    informar_exportacion(datos)
    exigir_lista(datos)
    datos = ponerse_al_dia(cfg, args, datos, estado)
    exigir_lista(datos)
    filas, lineas = c.quitar_rechazados(datos, estado.get("rechazados") or {})
    if not lineas:
        c.log("nada que reportar en este rango: no se deja archivo")
        return c.OK, {"movimientos": 0}
    destino = c.escribir_archivo(lineas, Path(estado_dir) / "pendientes", c.nombre_archivo(),
                                 conf["archivo"]["codificacion"], conf["archivo"]["fin_de_linea"])
    estado["bloqueo"] = {"motivo": "solo_archivo", "desde": c.ahora().isoformat(), "lote": lote_id(),
                         "filas": filas_minimas(filas), "archivo": str(destino)}
    c.guardar_estado(estado_dir, estado)
    cuerpo = [
        "Archivo listo para subir a mano al portal SIRE: %d movimiento(s)." % len(lineas),
        "Esta en: %s (permisos 600; se borra solo a los %d dias)." % (destino, c.DIAS_RETENCION_PENDIENTES),
        "Despues de subirlo: correr.sh sire/subir_sire.py --resolver reportado",
    ] + notas_pendientes(datos, estado)
    if enviar:
        c.avisar(asunto("archivo listo para subida manual"), cuerpo)
    else:
        for linea in cuerpo:
            c.log(linea)
    return c.OK, {"movimientos": len(lineas)}


def modo_resolver(args, secretos, estado_dir, conf, enviar):
    estado = c.cargar_estado(estado_dir)
    bloqueo = estado.get("bloqueo")
    rechazados = estado.get("rechazados") or {}
    if not bloqueo and not rechazados:
        c.log("no hay nada pendiente")
        return c.OK, {}
    if args.resolver == "reintentar" and bloqueo and bloqueo.get("motivo") == "ack_pendiente":
        # El portal YA acepto ese lote; solo fallo avisarle a estar.com.co.
        # Soltarlo lo volveria a subir: registros duplicados en el SIRE.
        raise c.ErrorSire(c.USO, "el bloqueo es ack_pendiente: ese archivo YA quedo cargado en el portal el %s. "
                          "No se puede reintentar (se duplicaria en el SIRE); usar --resolver reportado." % (
                              str(bloqueo.get("desde", "?"))[:10]))
    filas = list(bloqueo.get("filas") or []) if bloqueo else []
    filas += [dict(v, id=k) for k, v in rechazados.items()]
    if args.resolver == "reportado":
        cfg = c.leer_config_exportacion(secretos)
        r = c.enviar_ack(cfg, filas, lote_id() + "-manual")
        c.log("marcados como reportados: %s (ya estaban %s)" % (r.get("marcados"), r.get("yaEstaban")))
    else:
        c.log("se sueltan %d movimiento(s): la proxima pasada los vuelve a subir" % len(filas))
    if bloqueo and bloqueo.get("archivo"):
        c.borrar(bloqueo["archivo"])
        c.log("archivo pendiente borrado")
    estado["bloqueo"] = None
    estado["rechazados"] = {}
    c.guardar_estado(estado_dir, estado)
    return c.OK, {"movimientos": len(filas)}


# ------------------------------------------------------------------ principal


def fecha_valida(valor):
    if not c.FECHA_RE.match(valor or ""):
        raise argparse.ArgumentTypeError("usa YYYY-MM-DD")
    return valor


def construir_parser():
    p = argparse.ArgumentParser(description="Sube al SIRE los movimientos de huespedes extranjeros del Hotel Estar.")
    modo = p.add_mutually_exclusive_group(required=True)
    modo.add_argument("--ensayo", action="store_true", help="todo menos subir; toma capturas")
    modo.add_argument("--subir", action="store_true", help="subida real (requiere autorizacion)")
    modo.add_argument("--solo-archivo", action="store_true", help="deja el archivo para subida manual y avisa")
    modo.add_argument("--resolver", choices=["reportado", "reintentar"], help="cierra lo pendiente")
    p.add_argument("--desde", type=fecha_valida, help="YYYY-MM-DD (hora Colombia); default: hace 7 dias, o el movimiento sin reportar mas antiguo")
    p.add_argument("--hasta", type=fecha_valida, help="YYYY-MM-DD (hora Colombia); default: ayer")
    p.add_argument("--secretos", help="carpeta de secretos (default: .secrets del repo)")
    p.add_argument("--estado", help="carpeta de estado (default: ~/.local/state/estar-sire)")
    p.add_argument("--portal-conf", help="portal.json alternativo")
    p.add_argument("--visible", action="store_true", help="muestra el navegador (solo con pantalla)")
    p.add_argument("--sin-aviso", action="store_true", help="no envia correo; solo registro")
    p.add_argument("--avisar", action="store_true", help="en --ensayo, enviar correo si hay problemas")
    return p


def main(argv=None):
    os.umask(0o077)
    args = construir_parser().parse_args(argv)
    if args.ensayo:
        nombre, funcion = "ensayo", modo_ensayo
    elif args.subir:
        nombre, funcion = "subir", modo_subir
    elif args.solo_archivo:
        nombre, funcion = "solo-archivo", modo_solo_archivo
    else:
        nombre, funcion = "resolver-%s" % args.resolver, modo_resolver
    enviar = not args.sin_aviso and (not args.ensayo or args.avisar) and not args.resolver
    c.log("inicio: modo %s" % nombre)

    resumen = {}
    estado_dir = None
    try:
        secretos = c.dir_secretos(args.secretos)
        estado_dir = c.dir_estado(args.estado)
        borrados = c.purgar_pendientes(estado_dir)
        if borrados:
            c.log("se borraron %d archivo(s) pendiente(s) con mas de %d dias" % (borrados, c.DIAS_RETENCION_PENDIENTES))
        from sire_portal import cargar_conf
        conf = cargar_conf(args.portal_conf)
        codigo, resumen = funcion(args, secretos, estado_dir, conf, enviar)
    except c.ErrorSire as e:
        codigo = e.codigo
        c.log("FALLO (codigo %d): %s" % (codigo, e.mensaje))
        repetible = codigo in (c.BLOQUEADO, c.NO_AUTORIZADA)
        avisar_ahora = enviar
        if enviar and repetible and estado_dir is not None:
            try:
                estado = c.cargar_estado(estado_dir)
                avisar_ahora = debe_avisar(estado, "codigo-%d" % codigo, 3)
                c.guardar_estado(estado_dir, estado)
            except c.ErrorSire:
                pass
        if avisar_ahora:
            c.avisar(asunto("la pasada %s no se completo" % nombre), [
                "Motivo: %s" % e.mensaje, "", "Que hacer: %s" % CONSEJOS.get(codigo, CONSEJOS[c.ERROR]),
                "", "Registro: %s" % ruta_log()])
    except Exception as e:  # nunca el mensaje crudo: podria arrastrar datos
        codigo = c.ERROR
        c.log("FALLO inesperado: %s" % type(e).__name__)
        if enviar:
            c.avisar(asunto("error inesperado en la pasada %s" % nombre), [
                "Error tecnico: %s (el detalle no se registra por si lleva datos)." % type(e).__name__,
                "", "Registro: %s" % ruta_log()])

    if estado_dir is not None:
        try:
            estado = c.cargar_estado(estado_dir)
            c.anotar_historial(estado, dict({"fecha": c.ahora().isoformat(), "modo": nombre, "codigo": codigo}, **(resumen or {})))
            c.guardar_estado(estado_dir, estado)
        except Exception:
            pass
    c.log("fin: codigo %d" % codigo)
    return codigo


if __name__ == "__main__":
    sys.exit(main())
