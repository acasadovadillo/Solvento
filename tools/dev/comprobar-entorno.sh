#!/bin/sh
#
# Solvento — ¿estamos en desarrollo de verdad? Se pasa antes de cada cambio. Si algo apunta a producción, sale con error y dice qué.
#
#   sh tools/dev/comprobar-entorno.sh
#
set -u
raiz=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "✗ No es un repositorio git"; exit 1; }
cd "$raiz" || exit 1
fallos=0
ok()    { printf '  ✓ %s\n' "$1"; }
mal()   { printf '  ✗ %s\n' "$1"; fallos=$((fallos + 1)); }
aviso() { printf '  ⚠ %s\n' "$1"; }

echo "Entorno de desarrollo de Solvento"

# 1. La rama: nunca main.
rama=$(git symbolic-ref --short -q HEAD || echo "")
case "$rama" in
  main|master) mal "estás en «$rama»: se trabaja en una rama aparte" ;;
  *) ok "rama «$rama»" ;;
esac

# 2. Los hooks del repositorio, activos.
[ "$(git config core.hooksPath)" = ".githooks" ] \
  && ok "hooks de .githooks activos (prueba de humo antes de cada push)" \
  || mal "los hooks no están activos (git config core.hooksPath .githooks)"

# 3. Las cuentas de desarrollo: todas marcadas y ninguna en el repo real.
if python3 - <<'EOF'
import json, sys
p = json.load(open("perfil.dev.json", encoding="utf-8"))
malas = [c.get("usuario") for c in p.get("cuentas", [])
         if (c.get("almacen") or {}).get("dev") is not True
         or str((c.get("almacen") or {}).get("repo", "")).lower() == "solvento"]
sys.exit(1 if malas or not p.get("cuentas") else 0)
EOF
then ok "perfil.dev.json: todas las cuentas son de desarrollo"
else mal "perfil.dev.json falta, está vacío o tiene cuentas que no son de desarrollo"
fi

# 4. El código no lleva direcciones de GitHub escritas a mano: todas pasan por
#    entorno.js, que las bloquea fuera de producción.
if grep -nE "https://(api\.github\.com|raw\.githubusercontent\.com)" src/js/*.js | grep -v "^src/js/entorno.js:" | grep -vE "^\S+:\s*(//|\*)" >/dev/null; then
  mal "hay URLs de GitHub fuera de entorno.js:"; grep -nE "https://(api\.github\.com|raw\.githubusercontent\.com)" src/js/*.js | grep -v "^src/js/entorno.js:" | sed 's/^/      /'
else
  ok "ninguna URL de GitHub fuera de entorno.js"
fi
grep -q 'PRODUCCION = \["acasadovadillo.github.io"\]' src/js/entorno.js \
  && ok "producción es solo acasadovadillo.github.io" \
  || mal "entorno.js no define producción como solo acasadovadillo.github.io"

# 5. Los datos de desarrollo, fuera de git.
git check-ignore -q dev-data/ && [ -z "$(git ls-files dev-data .env.dev)" ] \
  && ok "dev-data/ y .env.dev ignorados por git" \
  || mal "dev-data/ o .env.dev no están ignorados (o hay algo suyo en git)"

# 6. Ningún token real a mano en este terminal.
if [ -n "${GH_TOKEN:-}${GITHUB_TOKEN:-}" ]; then
  aviso "hay GH_TOKEN/GITHUB_TOKEN en el entorno: el servidor de desarrollo no los usa, pero sobran aquí"
else
  ok "sin tokens de GitHub en el entorno"
fi

# 7. Si el servidor está en marcha, que diga que es de desarrollo.
if r=$(curl -fsS --max-time 2 http://localhost:4400/__dev/entorno 2>/dev/null); then
  echo "$r" | grep -q '"desarrollo"' && ok "servidor de desarrollo respondiendo en :4400" || mal "en :4400 responde algo que no es el servidor de desarrollo"
else
  aviso "el servidor de desarrollo no está en marcha (python3 tools/dev/servidor.py)"
fi

echo
if [ "$fallos" -gt 0 ]; then echo "✗ $fallos problema(s): no sigas hasta arreglarlos."; exit 1; fi
echo "✓ Todo apunta a desarrollo."
