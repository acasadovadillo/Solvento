# Banco de pruebas

Dos comprobaciones que responden a preguntas distintas. Las dos usan datos
inventados, así que funcionan recién clonado el repositorio y sin que nadie
tenga que enseñar sus finanzas.

## ¿Cuadran los números? — prueba de humo

```bash
jsc tools/pruebas/humo.js      # macOS
node tools/pruebas/humo.js
```

Carga el modelo con `datos-ejemplo.json` y comprueba **invariantes**: cosas que
tienen que cumplirse pase lo que pase y que, si dejan de cumplirse, significan
que algo se ha roto aunque la pantalla parezca normal. Por ejemplo, que la suma
de los flujos mensuales dé exactamente el saldo de caja de hoy.

Un invariante solo vale si los datos de ejemplo recorren el camino que protege.
La tarjeta de crédito está ahí con compras y con su recibo mensual justamente
por eso: sin esos movimientos, la comprobación del flujo de caja pasaba incluso
con el cálculo roto a propósito.

## ¿Se pinta? — banco de pruebas

```bash
python3 tools/pruebas/montar.py --pagina balance
python3 -m http.server 4324
# abre http://localhost:4324/_prueba-app.html
```

Monta el `index.html` de producción con el login saltado y un documento en
claro inyectado. Es la única forma de ver que la aplicación se construye de
verdad: un fallo en `render.js` no aparece al escribirlo, aparece al pintarlo.

Con `--datos ruta.json` se le pasa un export propio para depurar algo concreto.
Ese fichero y el HTML montado los ignora git.

En la consola del navegador quedan `window.__LISTO` (verdadero si terminó de
pintar) y `window.__ERROR`.

## Antes de desplegar

1. `jsc tools/pruebas/humo.js` → *todo en orden*.
2. Montar el banco, abrirlo y mirar la consola: **sin errores**.
3. Recorrer las páginas que tocó el cambio; si tocó un formulario, abrirlo y
   guardar una vez.
4. Subir el `?v=pNN` de `index.html`, o el navegador servirá el JavaScript
   viejo y estarás mirando el código de antes.
