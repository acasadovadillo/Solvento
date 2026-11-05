# Solvento-Price-Update

Los precios públicos de Solvento. La app ya no vive aquí: está en
[SweetSuite](https://github.com/acasadovadillo/SweetSuite), en `apps/solvento`.

- `tickers.json`: la lista de activos. La pone al día Solvento.
- `prices.json`: los precios en euros. Los genera `.github/workflows/generate.yml`
  cada día con `tools/build_prices.py`.
- `nav/`: los valores liquidativos de lo que no cotiza. Los sube Solvento.

SweetSuite lee estos archivos de `/Solvento-Price-Update/`, sin token. Aquí no hay
datos personales: viven cifrados en el repositorio privado `Solvento-Data`.

El código de la app de antes sigue en el historial de git de este repositorio.
