#!/bin/sh
#
# Solvento — Llevar ESTE código a otro despliegue.
#
# Una asociación tiene su propio Solvento: su repositorio, su bloque cifrado y
# su contraseña. Lo que NO tiene es su propio código, y ahí está la gracia: si
# se duplicara, en un mes serían dos aplicaciones distintas y cada arreglo
# habría que copiarlo a mano. Con esto, actualizar el de la asociación es
# ejecutar una línea.
#
#   sh tools/publicar.sh ../ABIES-Solvento
#
# Lo que NO viaja, porque es de cada uno:
#   data.enc      sus datos cifrados
#   perfil.json   quién entra y dónde guarda
#   tools/reconstruccion  los lectores de MIS extractos bancarios
#
# Después, en el destino: git add -A && git commit && git push.

set -e
destino="$1"
if [ -z "$destino" ] || [ ! -d "$destino" ]; then
  echo "Uso: sh tools/publicar.sh <carpeta del otro repositorio>" >&2
  exit 1
fi
origen="$(cd "$(dirname "$0")/.." && pwd)"
cd "$origen"

copiar() {
  for x in "$@"; do
    [ -e "$x" ] || continue
    mkdir -p "$destino/$(dirname "$x")"
    rm -rf "$destino/$x"
    cp -R "$x" "$destino/$x"
    echo "  · $x"
  done
}

echo "De $origen"
echo "A  $destino"
copiar index.html sw.js manifest.json src img tickers.json prices.json \
       .gitignore .githooks .github/workflows/pruebas.yml .github/workflows/generate.yml \
       tools/build_prices.py tools/csv_to_json.py tools/copia.py tools/instalar.sh tools/pruebas

echo
echo "Hecho. Lo suyo —data.enc y perfil.json— no se ha tocado."
echo "Ahora, en el destino:  git add -A && git commit -m 'Actualizar Solvento' && git push"
