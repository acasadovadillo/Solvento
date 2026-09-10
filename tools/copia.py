#!/usr/bin/env python3
"""Copia de seguridad del bloque cifrado (alberto-data.enc).

Hasta ahora el historial del repositorio hacía de copia sin querer: cada
guardado dejaba detrás su versión anterior. Al limpiar el historial esas
versiones desaparecieron —y era lo correcto—, pero con ellas se fue la única
red que había: hoy existe un solo bloque por cuenta y un guardado malo no tiene vuelta
atrás.

Esto baja el bloque tal cual está publicado y lo guarda fechado FUERA del
repositorio. Sigue cifrado: no hace falta que nadie vea nada para tener una
copia, y por eso el script no pide la contraseña ni sabría qué hacer con ella.

    python3 tools/copia.py                 # guarda una copia si ha cambiado
    python3 tools/copia.py --listar        # qué copias hay
    python3 tools/copia.py --restaurar F   # deja F como bloque cifrado del repositorio

Una vez al día, sin acordarte (crontab -e):

    30 22 * * * cd /ruta/a/Solvento && /usr/bin/python3 tools/copia.py >> /tmp/solvento-copia.log 2>&1
"""

import argparse
import base64
import hashlib
import json
import shutil
import sys
import urllib.request
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CRUDO = "https://raw.githubusercontent.com/acasadovadillo/Solvento/main/alberto-data.enc"
DESTINO_POR_DEFECTO = REPO.parent / "Solvento_COPIAS"
CONSERVAR = 30


def descargar(url):
    """El bloque publicado, tal cual. Sin caché: una copia vieja no es una copia."""
    pet = urllib.request.Request(url, headers={"Cache-Control": "no-cache"})
    with urllib.request.urlopen(pet, timeout=60) as r:
        return r.read()


def revisar(datos):
    """Que lo descargado tenga forma de bloque cifrado de Solvento.

    No comprueba la contraseña —para eso hay que descifrar, y eso pasa en el
    navegador— pero sí que no estamos guardando una página de error de GitHub,
    un archivo a medias o un JSON de otra cosa. Un cortafuegos que devuelve HTML
    con 200 es más común de lo que parece.
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
    for campo, minimo in (("salt", 16), ("iv", 12), ("ct", 1000)):
        try:
            crudo = base64.b64decode(blob[campo], validate=True)
        except Exception:
            return "el campo %s no es base64" % campo
        if len(crudo) < minimo:
            return "el campo %s mide %d bytes y debería medir al menos %d" % (campo, len(crudo), minimo)
    return None


def copias(destino):
    return sorted(destino.glob("data-*.enc"))


def humano(n):
    return "%.1f MB" % (n / 1048576.0) if n >= 1048576 else "%.0f KB" % (n / 1024.0)


def guardar(destino, conservar):
    destino = destino.resolve()
    # Una copia dentro del repositorio no es una copia: es el mismo archivo
    # esperando a que alguien lo suba sin querer.
    if destino == REPO or REPO in destino.parents:
        print("✗ El destino está dentro del repositorio. Elige otro sitio.", file=sys.stderr)
        return 2
    destino.mkdir(parents=True, exist_ok=True)

    try:
        datos = descargar(CRUDO)
    except Exception as e:
        print("✗ No se ha podido descargar el bloque: %s" % e, file=sys.stderr)
        return 1

    mal = revisar(datos)
    if mal:
        print("✗ Lo descargado no vale como copia: %s" % mal, file=sys.stderr)
        return 1

    huella = hashlib.sha256(datos).hexdigest()
    ultimas = copias(destino)
    if ultimas:
        anterior = hashlib.sha256(ultimas[-1].read_bytes()).hexdigest()
        if anterior == huella:
            print("· Sin cambios desde %s. No hago una copia igual." % ultimas[-1].name)
            return 0

    nombre = "data-%s-%s.enc" % (datetime.now().strftime("%Y%m%d-%H%M"), huella[:8])
    archivo = destino / nombre
    # Se escribe al lado y se renombra: si esto se corta a la mitad, no deja un
    # archivo incompleto con nombre de copia buena.
    temporal = archivo.with_suffix(".enc.parcial")
    temporal.write_bytes(datos)
    temporal.replace(archivo)
    print("✓ %s (%s) en %s" % (nombre, humano(len(datos)), destino))

    sobran = copias(destino)[:-conservar] if conservar > 0 else []
    for viejo in sobran:
        viejo.unlink()
    if sobran:
        print("· Borradas %d copias antiguas; se conservan las %d últimas." % (len(sobran), conservar))
    return 0


def listar(destino):
    destino = destino.resolve()
    hay = copias(destino) if destino.is_dir() else []
    if not hay:
        print("No hay ninguna copia en %s" % destino)
        print("Haz la primera con:  python3 tools/copia.py")
        return 1
    total = 0
    for f in hay:
        tam = f.stat().st_size
        total += tam
        print("  %s  %8s  %s" % (
            datetime.fromtimestamp(f.stat().st_mtime).strftime("%d/%m/%Y %H:%M"), humano(tam), f.name))
    print("\n%d %s · %s · %s" % (len(hay), "copia" if len(hay) == 1 else "copias", humano(total), destino))
    return 0


def restaurar(origen):
    origen = Path(origen).resolve()
    if not origen.is_file():
        print("✗ No existe %s" % origen, file=sys.stderr)
        return 1
    datos = origen.read_bytes()
    mal = revisar(datos)
    if mal:
        print("✗ Esa copia no vale: %s" % mal, file=sys.stderr)
        return 1

    actual = REPO / "alberto-data.enc"
    if actual.is_file():
        rescate = REPO.parent / ("data-antes-de-restaurar-%s.enc" % datetime.now().strftime("%Y%m%d-%H%M"))
        shutil.copy2(actual, rescate)
        print("· El data.enc que había queda a salvo en %s" % rescate)
    shutil.copy2(origen, actual)
    print("✓ %s es ahora el data.enc del repositorio.\n" % origen.name)
    # Subir es tuyo, no mío: esto sobrescribe todo lo que haya guardado la web.
    print("Para publicarlo, cuando lo hayas mirado:")
    print("    git add data.enc && git commit -m 'Restaurar copia %s' && git push" % origen.name)
    print("\nY en el navegador, una recarga dura para que la web deje de servir")
    print("su copia local (⌘⇧R en Mac).")
    return 0


def main():
    p = argparse.ArgumentParser(description="Copia de seguridad del data.enc cifrado.")
    p.add_argument("--destino", default=str(DESTINO_POR_DEFECTO),
                   help="carpeta de las copias (por defecto: %s)" % DESTINO_POR_DEFECTO)
    p.add_argument("--conservar", type=int, default=CONSERVAR,
                   help="cuántas copias mantener (por defecto: %d; 0 = todas)" % CONSERVAR)
    p.add_argument("--listar", action="store_true", help="enseña las copias que hay")
    p.add_argument("--restaurar", metavar="ARCHIVO", help="deja esa copia como data.enc del repositorio")
    a = p.parse_args()

    if a.restaurar:
        return restaurar(a.restaurar)
    if a.listar:
        return listar(Path(a.destino))
    return guardar(Path(a.destino), a.conservar)


if __name__ == "__main__":
    sys.exit(main())
