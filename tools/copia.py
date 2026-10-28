#!/usr/bin/env python3
"""Copia de seguridad de los bloques cifrados de todas las cuentas.

Los datos de cada cuenta viven en el repositorio PRIVADO datos-cifrados
(carpeta Solvento/), uno por cuenta, según perfil.json. Su historial de git ya
guarda cada versión; esto, además, baja cada bloque tal cual y lo guarda
fechado FUERA de cualquier repositorio (un disco, otra carpeta). Siguen
cifrados: no hace falta que nadie vea nada para tener una copia, y por eso el
script no pide ninguna contraseña ni sabría qué hacer con ella.

Como el repositorio es privado, hace falta un token que pueda LEERLO. Se busca,
por este orden, en las variables SOLVENTO_TOKEN, GH_TOKEN y GITHUB_TOKEN y, si
no hay ninguna, se le pide a la CLI de GitHub («gh auth token»).

    python3 tools/copia.py                          # copia de cada cuenta, si ha cambiado
    python3 tools/copia.py --listar                 # qué copias hay
    python3 tools/copia.py --restaurar F --cuenta alberto
                                                    # sube F como bloque de esa cuenta

Una vez al día, sin acordarte (crontab -e; con el token en SOLVENTO_TOKEN,
porque cron no ve el llavero de «gh»):

    30 22 * * * cd /ruta/a/Solvento && SOLVENTO_TOKEN=… /usr/bin/python3 tools/copia.py >> /tmp/solvento-copia.log 2>&1
"""

import argparse
import base64
import hashlib
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DESTINO_POR_DEFECTO = REPO.parent / "Solvento_COPIAS"
CONSERVAR = 30
API = "https://api.github.com"


# ── De dónde ────────────────────────────────────────────────────────────────
def cuentas():
    """Las cuentas de perfil.json y dónde guarda cada una."""
    perfil = json.loads((REPO / "perfil.json").read_text(encoding="utf-8"))
    out = []
    for c in perfil.get("cuentas", []):
        a = c.get("almacen") or {}
        if c.get("usuario") and a.get("repo") and a.get("path"):
            out.append({"usuario": c["usuario"], "owner": a.get("owner", "acasadovadillo"),
                        "repo": a["repo"], "branch": a.get("branch", "main"), "path": a["path"]})
    return out


def token():
    for var in ("SOLVENTO_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"):
        if os.environ.get(var):
            return os.environ[var].strip()
    try:
        r = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, timeout=20)
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout.strip()
    except Exception:
        pass
    return None


def pedir(url, tk, metodo="GET", cuerpo=None, crudo=False):
    cab = {"Authorization": "Bearer " + tk, "X-GitHub-Api-Version": "2022-11-28",
           "Accept": "application/vnd.github.raw" if crudo else "application/vnd.github+json",
           "Cache-Control": "no-cache"}
    datos = None
    if cuerpo is not None:
        datos = json.dumps(cuerpo).encode("utf-8")
        cab["Content-Type"] = "application/json"
    pet = urllib.request.Request(url, data=datos, headers=cab, method=metodo)
    with urllib.request.urlopen(pet, timeout=60) as r:
        return r.read()


def url_de(c):
    return "%s/repos/%s/%s/contents/%s" % (API, c["owner"], c["repo"], c["path"])


def descargar(c, tk):
    """El bloque publicado, tal cual (en bruto: los de más de 1 MB también)."""
    return pedir(url_de(c) + "?ref=" + c["branch"], tk, crudo=True)


def revisar(datos):
    """Que lo descargado tenga forma de bloque cifrado de Solvento.

    No comprueba la contraseña —para eso hay que descifrar, y eso pasa en el
    navegador— pero sí que no estamos guardando una página de error de GitHub,
    un archivo a medias o un JSON de otra cosa.
    """
    try:
        blob = json.loads(datos.decode("utf-8"))
    except Exception as e:
        return "no es JSON (%s)" % e
    if not isinstance(blob, dict):
        return "no es un objeto JSON"
    if blob.get("v") != 1:
        return "formato desconocido (v=%r)" % blob.get("v")
    if blob.get("kdf") != "PBKDF2-SHA256":
        return "derivación de clave inesperada (%r)" % blob.get("kdf")
    if not isinstance(blob.get("iter"), int) or blob["iter"] < 100000:
        return "iteraciones sospechosas (%r)" % blob.get("iter")
    for campo, minimo in (("salt", 16), ("iv", 12), ("ct", 16)):
        try:
            crudo = base64.b64decode(blob[campo], validate=True)
        except Exception:
            return "el campo %s no es base64" % campo
        if len(crudo) < minimo:
            return "el campo %s mide %d bytes y debería medir al menos %d" % (campo, len(crudo), minimo)
    return None


# ── Adónde ──────────────────────────────────────────────────────────────────
def copias(carpeta, usuario):
    return sorted(carpeta.glob("%s-*.enc" % usuario))


def humano(n):
    return "%.1f MB" % (n / 1048576.0) if n >= 1048576 else "%.0f KB" % (n / 1024.0)


def fuera_del_repo(destino):
    # Una copia dentro del repositorio no es una copia: es el mismo archivo
    # esperando a que alguien lo suba sin querer.
    return not (destino == REPO or REPO in destino.parents)


def guardar(destino, conservar):
    destino = destino.resolve()
    if not fuera_del_repo(destino):
        print("✗ El destino está dentro del repositorio. Elige otro sitio.", file=sys.stderr)
        return 2
    tk = token()
    if not tk:
        print("✗ Sin token para leer el repositorio privado (SOLVENTO_TOKEN, o «gh auth login»).", file=sys.stderr)
        return 1
    fallos = 0
    for c in cuentas():
        carpeta = destino / c["usuario"]
        carpeta.mkdir(parents=True, exist_ok=True)
        try:
            datos = descargar(c, tk)
        except Exception as e:
            print("✗ %s: no se ha podido descargar (%s)" % (c["usuario"], e), file=sys.stderr)
            fallos += 1
            continue
        mal = revisar(datos)
        if mal:
            print("✗ %s: lo descargado no vale como copia: %s" % (c["usuario"], mal), file=sys.stderr)
            fallos += 1
            continue
        huella = hashlib.sha256(datos).hexdigest()
        ultimas = copias(carpeta, c["usuario"])
        if ultimas and hashlib.sha256(ultimas[-1].read_bytes()).hexdigest() == huella:
            print("· %s: sin cambios desde %s" % (c["usuario"], ultimas[-1].name))
            continue
        nombre = "%s-%s-%s.enc" % (c["usuario"], datetime.now().strftime("%Y%m%d-%H%M"), huella[:8])
        archivo = carpeta / nombre
        # Se escribe al lado y se renombra: si esto se corta a la mitad, no deja
        # un archivo incompleto con nombre de copia buena.
        temporal = archivo.with_suffix(".enc.parcial")
        temporal.write_bytes(datos)
        temporal.replace(archivo)
        print("✓ %s: %s (%s)" % (c["usuario"], nombre, humano(len(datos))))
        sobran = copias(carpeta, c["usuario"])[:-conservar] if conservar > 0 else []
        for viejo in sobran:
            viejo.unlink()
        if sobran:
            print("  · borradas %d copias antiguas; se conservan las %d últimas" % (len(sobran), conservar))
    print("\nCopias en %s" % destino)
    return 1 if fallos else 0


def listar(destino):
    destino = destino.resolve()
    total, n = 0, 0
    for c in cuentas():
        hay = copias(destino / c["usuario"], c["usuario"]) if (destino / c["usuario"]).is_dir() else []
        print("%s: %d %s" % (c["usuario"], len(hay), "copia" if len(hay) == 1 else "copias"))
        for f in hay:
            tam = f.stat().st_size
            total += tam
            n += 1
            print("  %s  %8s  %s" % (datetime.fromtimestamp(f.stat().st_mtime).strftime("%d/%m/%Y %H:%M"), humano(tam), f.name))
    if not n:
        print("\nNo hay ninguna copia en %s. Haz la primera con:  python3 tools/copia.py" % destino)
        return 1
    print("\n%d copias · %s · %s" % (n, humano(total), destino))
    return 0


def restaurar(origen, usuario, destino):
    """Sube una copia como bloque actual de una cuenta. Pide confirmación."""
    origen = Path(origen).resolve()
    c = next((x for x in cuentas() if x["usuario"] == usuario), None)
    if not c:
        print("✗ No hay ninguna cuenta «%s» en perfil.json" % usuario, file=sys.stderr)
        return 1
    if not origen.is_file():
        print("✗ No existe %s" % origen, file=sys.stderr)
        return 1
    datos = origen.read_bytes()
    mal = revisar(datos)
    if mal:
        print("✗ Esa copia no vale: %s" % mal, file=sys.stderr)
        return 1
    tk = token()
    if not tk:
        print("✗ Sin token para escribir en el repositorio privado.", file=sys.stderr)
        return 1
    # Lo que hay ahora se guarda antes, como una copia más: restaurar no
    # puede ser la forma de perder lo último.
    try:
        actual = json.loads(pedir(url_de(c) + "?ref=" + c["branch"], tk).decode("utf-8"))
        sha = actual.get("sha")
        previo = descargar(c, tk)
        rescate = destino.resolve() / usuario / ("%s-antes-de-restaurar-%s.enc" % (usuario, datetime.now().strftime("%Y%m%d-%H%M")))
        rescate.parent.mkdir(parents=True, exist_ok=True)
        rescate.write_bytes(previo)
        print("· Lo que había queda a salvo en %s" % rescate)
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise
        sha = None
    print("\nVas a sustituir el bloque de «%s» (%s/%s/%s) por %s." % (usuario, c["owner"], c["repo"], c["path"], origen.name))
    print("Todo lo que esa cuenta haya guardado después de esa copia dejará de verse.")
    if input("Escribe RESTAURAR para seguir: ").strip() != "RESTAURAR":
        print("No se ha cambiado nada.")
        return 1
    cuerpo = {"message": "Solvento: restaurar copia %s" % origen.name, "branch": c["branch"],
              "content": base64.b64encode(datos).decode("ascii")}
    if sha:
        cuerpo["sha"] = sha
    pedir(url_de(c), tk, metodo="PUT", cuerpo=cuerpo)
    print("✓ Restaurado. En cada dispositivo, al entrar, se bajará esta versión")
    print("  (si alguno tiene cambios sin subir, se quedará con los suyos: revísalo).")
    return 0


def main():
    p = argparse.ArgumentParser(description="Copia de seguridad de los bloques cifrados (repositorio privado datos-cifrados).")
    p.add_argument("--destino", default=str(DESTINO_POR_DEFECTO),
                   help="carpeta de las copias (por defecto: %s)" % DESTINO_POR_DEFECTO)
    p.add_argument("--conservar", type=int, default=CONSERVAR,
                   help="cuántas copias mantener por cuenta (por defecto: %d; 0 = todas)" % CONSERVAR)
    p.add_argument("--listar", action="store_true", help="enseña las copias que hay")
    p.add_argument("--restaurar", metavar="ARCHIVO", help="sube esa copia como bloque actual de --cuenta")
    p.add_argument("--cuenta", help="la cuenta que se restaura (alberto, abies…)")
    a = p.parse_args()

    if a.restaurar:
        if not a.cuenta:
            p.error("--restaurar necesita --cuenta")
        return restaurar(a.restaurar, a.cuenta, Path(a.destino))
    if a.listar:
        return listar(Path(a.destino))
    return guardar(Path(a.destino), a.conservar)


if __name__ == "__main__":
    sys.exit(main())
