#!/usr/bin/env python3
"""
Solvento — servidor de DESARROLLO.

Sirve la aplicación en http://localhost:4400 y hace de GitHub para ella, sin
salir de este ordenador:

  /__dev/api/repos/<owner>/<repo>                    el repositorio: si existe y
                                                     si el token puede escribir
  /__dev/api/repos/<owner>/<repo>/contents/<ruta>   como la API de contenidos
                                                     (GET para leer y saber el
                                                     sha, PUT para escribir)
  /__dev/raw/<owner>/<repo>/<rama>/<ruta>            como raw.githubusercontent
  /__dev/entorno                                     dice que esto es desarrollo

Imita lo que importa de GitHub:
  · repositorios PRIVADOS (los marcados «privado» en perfil.dev.json): sin
    token no se lee nada, ni por la API ni por raw (404, como GitHub)
  · la API de contenidos no devuelve el contenido de un archivo de más de 1 MB
    (encoding «none»): hay que pedirlo en bruto con
    «Accept: application/vnd.github.raw», como en GitHub
  · el sha de git, y los 401, 409 y 422 de una escritura mal hecha

Los archivos viven en dev-data/<repo>/<ruta>, que git ignora. Cada escritura se
apunta en dev-data/.historial.log, que hace las veces de los commits.

Lo que NO hace, a propósito:
  · servir nada fuera de una lista cerrada: en esta carpeta están los .enc
    reales y data.json en claro, y no deben salir por aquí aunque se pidan
  · aceptar un token de verdad de GitHub, ni escribir en un repo llamado
    «Solvento», que es el de producción
  · escuchar fuera de este ordenador, salvo con --red (para probar desde el
    iPhone en la wifi de casa)

Al arrancar crea las cuentas de perfil.dev.json que no existan,
con datos FICTICIOS y la contraseña «desarrollo».

  python3 tools/dev/servidor.py               arranca en 127.0.0.1:4400
  python3 tools/dev/servidor.py --red         también desde la wifi
  python3 tools/dev/servidor.py --reiniciar   borra dev-data/ y vuelve a sembrar
"""
import argparse
import base64
import hashlib
import json
import os
import posixpath
import shutil
import sys
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DATOS = os.path.join(RAIZ, "dev-data")
PUERTO = 4400
CLAVE_DEV = "desarrollo"          # contraseña de las cuentas de prueba
REPO_PRODUCCION = "solvento"      # nunca se escribe en un repo con este nombre
LIMITE_API = 1024 * 1024          # GitHub no devuelve el contenido por la API por encima de 1 MB

# Lo único que se sirve como archivo. Todo lo demás, 404.
PERMITIDOS = {"/", "/index.html", "/manifest.json", "/sw.js", "/prices.json",
              "/tickers.json", "/perfil.dev.json"}
PREFIJOS = ("/src/", "/img/", "/tools/pruebas/")   # en pruebas solo hay datos ficticios
TOKENS_REALES = ("github_pat_", "ghp_", "gho_", "ghs_", "ghu_", "ghr_")


def perfil_dev():
    with open(os.path.join(RAIZ, "perfil.dev.json"), encoding="utf-8") as f:
        return json.load(f)


def repos_privados():
    return {str((c.get("almacen") or {}).get("repo", "")).lower()
            for c in perfil_dev().get("cuentas", []) if (c.get("almacen") or {}).get("privado")}


# ── Cifrado: el mismo formato que src/js/crypto.js ──────────────────
def cifrar(doc, clave):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    sal, iv = os.urandom(16), os.urandom(12)
    k = hashlib.pbkdf2_hmac("sha256", clave.encode(), sal, 310000, 32)
    ct = AESGCM(k).encrypt(iv, json.dumps(doc, ensure_ascii=False).encode("utf-8"), None)
    b64 = lambda b: base64.b64encode(b).decode()
    return {"v": 1, "kdf": "PBKDF2-SHA256", "iter": 310000, "salt": b64(sal), "iv": b64(iv), "ct": b64(ct)}


def doc_abies():
    """Una organización de mentira: dos cuentas y tres apuntes."""
    return {
        "movimientos": [
            {"id": "a1", "fecha": "05/09/2026", "tipo": "Ingreso", "importe": "240", "cuenta_destino": "Banco de prueba",
             "tipo_ingreso": "Cuotas", "detalle": "Cuotas de socios (ficticio)"},
            {"id": "a2", "fecha": "12/09/2026", "tipo": "Gasto", "importe": "35.5", "cuenta_origen": "Banco de prueba",
             "tipo_gasto": "Material", "detalle": "Material de oficina (ficticio)"},
            {"id": "a3", "fecha": "20/09/2026", "tipo": "Traspaso", "importe": "50", "cuenta_origen": "Banco de prueba",
             "cuenta_destino": "Efectivo", "detalle": "Caja para actividades (ficticio)"},
        ],
        "inversiones": [], "propiedades": [], "pasivos": [], "cobros": [],
        "config": {"cuentas": [{"cuenta": "Banco de prueba", "accent": "#0ea5e9"},
                               {"cuenta": "Efectivo", "accent": "#2d9e5f", "emoji": "💵"}],
                   "activos": []},
    }


def sembrar():
    """Crea las cuentas de perfil.dev.json que falten, con datos ficticios."""
    hechas = []
    for c in perfil_dev().get("cuentas", []):
        a = c.get("almacen") or {}
        if a.get("dev") is not True or str(a.get("repo", "")).lower() == REPO_PRODUCCION:
            sys.exit(f"perfil.dev.json: la cuenta «{c.get('usuario')}» no es de desarrollo. No arranco.")
        destino = ruta_datos(a["repo"], a["path"])
        if os.path.exists(destino):
            continue
        if c.get("tipo") == "organizacion":
            doc = doc_abies()
        else:
            with open(os.path.join(RAIZ, "tools", "pruebas", "datos-ejemplo.json"), encoding="utf-8") as f:
                doc = json.load(f)
        os.makedirs(os.path.dirname(destino), exist_ok=True)
        with open(destino, "w", encoding="utf-8") as f:
            json.dump(cifrar(doc, CLAVE_DEV), f)
        hechas.append(c.get("usuario"))
    return hechas


# ── Rutas dentro de dev-data, sin escaparse ─────────────────────────────────
def ruta_datos(repo, ruta):
    if ".." in str(ruta).replace("\\", "/").split("/"):
        raise ValueError("ruta no válida")
    limpia = posixpath.normpath("/" + ruta).lstrip("/")
    if not limpia or limpia.startswith("..") or not repo or "/" in repo or repo.startswith("."):
        raise ValueError("ruta no válida")
    final = os.path.abspath(os.path.join(DATOS, repo, limpia))
    if not final.startswith(os.path.abspath(DATOS) + os.sep):
        raise ValueError("ruta fuera de dev-data")
    return final


def sha_git(datos):
    """El sha que daría git a ese contenido, como el de la API de GitHub."""
    return hashlib.sha1(b"blob %d\0" % len(datos) + datos).hexdigest()


def apuntar(repo, ruta, mensaje, n):
    with open(os.path.join(DATOS, ".historial.log"), "a", encoding="utf-8") as f:
        f.write(f"{datetime.now(timezone.utc).isoformat(timespec='seconds')}  {repo}/{ruta}  {n} bytes  {mensaje}\n")


class Manejador(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=RAIZ, **k)

    def end_headers(self):
        # En desarrollo nada se guarda en caché: se prueba siempre lo último.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))

    def _json(self, codigo, obj):
        cuerpo = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def _bytes(self, codigo, datos, tipo="text/plain; charset=utf-8"):
        self.send_response(codigo)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(datos)))
        self.end_headers()
        self.wfile.write(datos)

    def _token(self):
        t = (self.headers.get("Authorization") or "")
        for p in ("Bearer ", "token "):
            t = t.replace(p, "")
        return t.strip()

    # Un token con forma de real no se acepta nunca; uno de prueba, siempre.
    def _token_valido(self):
        t = self._token()
        return bool(t) and not t.startswith(TOKENS_REALES)

    # /__dev/api/repos/<owner>/<repo>/contents/<ruta>
    def _api(self):
        partes = unquote(urlparse(self.path).path).split("/")
        if len(partes) < 8 or partes[3] != "repos" or partes[6] != "contents":
            return None
        return partes[5], "/".join(partes[7:])

    def do_GET(self):
        p = unquote(urlparse(self.path).path)
        if p == "/__dev/entorno":
            return self._json(200, {"entorno": "desarrollo", "datos": "dev-data/"})
        if p.startswith("/__dev/api/"):
            partes = p.split("/")
            if len(partes) == 6 and partes[3] == "repos":     # /__dev/api/repos/<owner>/<repo>
                repo = partes[5]
                privado = repo.lower() in repos_privados()
                if privado and not self._token_valido():
                    return self._json(404, {"message": "Not Found"})
                return self._json(200, {"name": repo, "full_name": f"{partes[4]}/{repo}", "private": privado,
                                        "permissions": {"pull": True, "push": self._token_valido()}})
            dest = self._api()
            if not dest:
                return self._json(404, {"message": "Not Found"})
            repo, ruta = dest
            if repo.lower() in repos_privados() and not self._token_valido():
                return self._json(404, {"message": "Not Found"})     # privado y sin token: como si no existiera
            try:
                f = ruta_datos(repo, ruta)
            except ValueError:
                return self._json(400, {"message": "ruta no válida"})
            if not os.path.isfile(f):
                return self._json(404, {"message": "Not Found"})
            datos = open(f, "rb").read()
            if "application/vnd.github.raw" in (self.headers.get("Accept") or ""):
                return self._bytes(200, datos, "application/octet-stream")
            grande = len(datos) > LIMITE_API
            return self._json(200, {"name": os.path.basename(f), "path": ruta, "sha": sha_git(datos),
                                    "size": len(datos), "encoding": "none" if grande else "base64",
                                    "content": "" if grande else base64.b64encode(datos).decode()})
        if p.startswith("/__dev/raw/"):
            partes = p.split("/")          # '', __dev, raw, owner, repo, rama, ruta…
            if len(partes) < 7:
                return self._bytes(404, b"404: Not Found")
            if partes[4].lower() in repos_privados() and not self._token_valido():
                return self._bytes(404, b"404: Not Found")
            try:
                f = ruta_datos(partes[4], "/".join(partes[6:]))
            except ValueError:
                return self._bytes(400, "ruta no válida".encode())
            if not os.path.isfile(f):
                return self._bytes(404, b"404: Not Found")
            return self._bytes(200, open(f, "rb").read())
        # Archivos de la app: solo la lista cerrada.
        if p in PERMITIDOS or p.startswith(PREFIJOS):
            if ".." in p.split("/"):
                return self._bytes(404, b"404: Not Found")
            return super().do_GET()
        return self._bytes(404, b"404: Not Found")

    def do_HEAD(self):
        return self.do_GET()

    def do_PUT(self):
        p = unquote(urlparse(self.path).path)
        if not p.startswith("/__dev/api/"):
            return self._json(405, {"message": "Method Not Allowed"})
        dest = self._api()
        if not dest:
            return self._json(404, {"message": "Not Found"})
        repo, ruta = dest
        if not self._token():
            return self._json(401, {"message": "Requires authentication"})
        if not self._token_valido():
            return self._json(403, {"message": "En desarrollo no se usan tokens reales de GitHub: pon «dev»."})
        if repo.lower() == REPO_PRODUCCION:
            return self._json(403, {"message": "Este servidor no escribe en el repositorio de producción."})
        try:
            f = ruta_datos(repo, ruta)
            largo = int(self.headers.get("Content-Length") or 0)
            cuerpo = json.loads(self.rfile.read(largo) or b"{}")
            nuevo = base64.b64decode(cuerpo.get("content", ""))
        except (ValueError, json.JSONDecodeError):
            return self._json(400, {"message": "petición no válida"})
        existe = os.path.isfile(f)
        if existe:
            actual = sha_git(open(f, "rb").read())
            # Igual que GitHub: sin sha no se pisa, y con uno viejo tampoco.
            if not cuerpo.get("sha"):
                return self._json(422, {"message": "\"sha\" wasn't supplied."})
            if cuerpo["sha"] != actual:
                return self._json(409, {"message": f"{ruta} does not match {cuerpo['sha']}"})
        os.makedirs(os.path.dirname(f), exist_ok=True)
        tmp = f + ".tmp"
        with open(tmp, "wb") as out:
            out.write(nuevo)
        os.replace(tmp, f)
        apuntar(repo, ruta, cuerpo.get("message", ""), len(nuevo))
        return self._json(200 if existe else 201, {
            "content": {"name": os.path.basename(f), "path": ruta, "sha": sha_git(nuevo)},
            "commit": {"message": cuerpo.get("message", "")},
        })


def main():
    ap = argparse.ArgumentParser(description="Servidor de desarrollo de Solvento")
    ap.add_argument("--red", action="store_true", help="escuchar también en la wifi (para el iPhone)")
    ap.add_argument("--puerto", type=int, default=PUERTO)
    ap.add_argument("--reiniciar", action="store_true", help="borrar dev-data/ y volver a sembrar")
    args = ap.parse_args()

    if args.reiniciar and os.path.isdir(DATOS):
        shutil.rmtree(DATOS)
    os.makedirs(DATOS, exist_ok=True)
    hechas = sembrar()

    host = "0.0.0.0" if args.red else "127.0.0.1"
    srv = ThreadingHTTPServer((host, args.puerto), Manejador)
    print(f"Solvento · DESARROLLO en http://localhost:{args.puerto}"
          + ("  (también en la wifi)" if args.red else ""))
    print(f"  datos: {DATOS} · repos privados: {', '.join(sorted(repos_privados())) or '—'}")
    if hechas:
        print(f"  cuentas de prueba creadas: {', '.join(hechas)} · contraseña «{CLAVE_DEV}»")
    print("  token de GitHub para probar: cualquiera que no sea real, p. ej. «dev»")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
