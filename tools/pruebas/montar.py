#!/usr/bin/env python3
"""
Monta el banco de pruebas: Solvento entero, con datos, sin contraseña.

Un cambio en render.js no falla al escribirlo, falla al pintarlo, y eso solo se
ve abriendo la aplicación. Pero la aplicación pide una contraseña y descifra un
documento, así que probarla de verdad significaba o teclear la contraseña real o
no probarla. Esto abre la tercera puerta: el mismo index.html de producción, con
un documento en claro inyectado y el login saltado.

Por defecto usa datos inventados —cuentas que no existen, importes al azar— para
que el banco de pruebas funcione recién clonado el repositorio y sin que nadie
tenga que enseñar sus finanzas. Con --datos se le puede pasar un export propio
mientras se depura algo concreto; ese fichero no entra en el repositorio.

    python3 tools/pruebas/montar.py [--datos ruta.json] [--pagina caja]

Deja _prueba-app.html en la raíz (ignorado por git) y dice qué URL abrir.
"""
import argparse
import json
import pathlib
import shutil
import sys

RAIZ = pathlib.Path(__file__).resolve().parents[2]
SALIDA = RAIZ / "_prueba-app.html"
DATOS = RAIZ / "_datos-prueba.json"

INYECCION = """
<script>
// Banco de pruebas: entra sin contraseña con un documento en claro. No forma
// parte de la aplicación; lo monta tools/pruebas/montar.py y git lo ignora.
window.addEventListener("load", function () {
  Promise.all([fetch("_datos-prueba.json?cb=" + Date.now()).then(function (r) { return r.json(); }),
               fetch("prices.json").then(function (r) { return r.json(); }).catch(function () { return {}; })])
    .then(function (res) {
      var doc = res[0], precios = res[1];
      // El perfil decide qué páginas existen, así que se espera igual que en la
      // aplicación de verdad: si no, el banco de pruebas pinta una cosa distinta.
      return (window.SolventoPerfil ? window.SolventoPerfil.cargar() : Promise.resolve())
        .catch(function () {}).then(function () { return [doc, precios]; });
    })
    .then(function (res) {
      var doc = res[0], precios = res[1];
      document.getElementById("boot-overlay").style.display = "none";
      document.documentElement.style.overflow = "";
      document.getElementById("app").style.display = "block";
      if (window.SolventoDB) window.SolventoDB.state.doc = doc;
      window.SolventoConfig.usarDoc(doc);
      window.__PRICES = precios;
      // Guardar de verdad exigiría contraseña y token: aquí se finge, para que
      // los formularios se puedan probar enteros sin tocar nada de nadie.
      window.SolventoBoot = window.SolventoBoot || {};
      window.SolventoBoot.saveDoc = function () { window.__GUARDADO = (window.__GUARDADO || 0) + 1; return Promise.resolve(); };
      window.SolventoBoot.toast = function (t) { window.__TOAST = t; };
      window.SolventoRender.render(doc, precios);
      if (PAGINA && window.SolventoRender.showPage) window.SolventoRender.showPage(PAGINA);
      window.__LISTO = true;
    })
    .catch(function (e) { window.__ERROR = e && e.message; console.error("BANCO DE PRUEBAS:", e); });
});
</script>
"""


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--datos", help="export en claro propio (por defecto, datos inventados)")
    p.add_argument("--pagina", default="", help="página a abrir: caja, balance, cartera…")
    a = p.parse_args()

    origen = pathlib.Path(a.datos) if a.datos else RAIZ / "tools/pruebas/datos-ejemplo.json"
    if not origen.exists():
        sys.exit(f"no encuentro {origen}")
    doc = json.loads(origen.read_text())
    DATOS.write_text(json.dumps(doc, ensure_ascii=False))

    html = (RAIZ / "index.html").read_text()
    inyeccion = INYECCION.replace("PAGINA", json.dumps(a.pagina))
    (SALIDA).write_text(html.replace("</body>", inyeccion + "</body>"))

    propio = " (TUS DATOS: no lo dejes abierto por ahí)" if a.datos else " (datos inventados)"
    print(f"montado con {len(doc.get('movimientos', []))} movimientos{propio}")
    print("   abre  http://localhost:4324/_prueba-app.html")
    print("   sirve con:  python3 -m http.server 4324")


if __name__ == "__main__":
    main()
