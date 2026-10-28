# Entorno de desarrollo de Solvento

En local, Solvento no habla con GitHub: un servidor de esta carpeta hace de GitHub con datos ficticios.

## Arrancar

```sh
python3 tools/dev/servidor.py            # http://localhost:4400
sh tools/dev/comprobar-entorno.sh        # antes de cada cambio
```

- **Cuentas de prueba:** `alberto`, `abies`, `hafsa` y `paula`, con la contraseña `desarrollo` y datos ficticios. Viven en el repositorio **privado** simulado `datos-cifrados-dev`, carpeta `Solvento/` (`dev-data/datos-cifrados-dev/Solvento/`), igual que las de verdad en `datos-cifrados`.
- **Token:** `dev`, o cualquiera que no sea real. Uno con forma de token real (`ghp_…`, `github_pat_…`) se rechaza y, como el repositorio es privado, sin token válido se recibe un 404, como en GitHub.
- **Dos dispositivos en el mismo navegador:** `http://localhost:4400` y `http://127.0.0.1:4400` son orígenes distintos, cada uno con su almacenamiento.
- **Empezar de cero:** `python3 tools/dev/servidor.py --reiniciar`, que borra `dev-data/` y vuelve a sembrar.
- **Probar desde el iPhone en la wifi de casa:** `--red`, y abrir `http://<IP-del-Mac>:4400`.
- **El historial** (lo que en GitHub serían los commits): `dev-data/.historial.log`.

## Qué hace distinto de producción

| | Producción (`acasadovadillo.github.io`) | Desarrollo (cualquier otra dirección) |
|---|---|---|
| Catálogo de cuentas | `perfil.json` | `perfil.dev.json` (solo cuentas con `dev: true` en repositorios `…-dev`) |
| Datos | API de GitHub, repositorio privado `datos-cifrados` | `/__dev/api` y `/__dev/raw` → `dev-data/` |
| Llamadas a GitHub | permitidas | bloqueadas en el código (`src/js/entorno.js`) |
| Service worker | sí | no (y quita el que hubiera) |
| Aviso | — | banda «DESARROLLO» y «[DEV]» en el título |

El servidor solo entrega una lista cerrada de archivos (la app, sus imágenes y `perfil.dev.json`). Los `.enc` reales y `data.json` de esta carpeta dan 404 aunque se pidan.
