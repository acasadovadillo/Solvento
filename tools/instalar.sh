#!/bin/sh
# Deja el repositorio listo en un clon nuevo.
#
# De momento solo hace una cosa, pero es la que no se puede olvidar: los hooks
# viven en .githooks (dentro del repositorio, así que viajan con él), pero git
# no los usa hasta que se le dice. Esa orden vive en .git/config, que no se
# clona: en un ordenador nuevo hay que darla otra vez.

set -e
cd "$(dirname "$0")/.."
git config core.hooksPath .githooks
chmod +x .githooks/* 2>/dev/null || true
echo "✓ Hooks activos: ningún commit con datos personales saldrá de aquí."
echo "  Pruébalo con:  git commit --allow-empty -m prueba"
