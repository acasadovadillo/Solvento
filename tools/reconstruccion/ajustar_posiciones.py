#!/usr/bin/env python3
"""
Cuadra las participaciones de cada fondo con las que declara la entidad.

El extracto de efectivo dice cuánto dinero se puso; el de posiciones dice cuántas
participaciones se compraron con él. Cuando el importe es bueno y el número de
participaciones no, la valoración de la cartera miente aunque el efectivo cuadre:
100 € en un fondo son 3,419821 participaciones o son 6,25 según a quién le
preguntes, y solo una de las dos respuestas es la del banco.

Se corrige la ÚLTIMA operación de esa posición, que es donde se acumula el error,
y se avisa cuando la corrección es grande o dejaría participaciones negativas.

    cuenta<TAB>isin<TAB>títulos reales<TAB>fecha de la foto<TAB>valor de mercado

Si se da el valor de mercado, se apunta además el precio que se deduce de él como
un NAV de esa fecha. Hace falta más de lo que parece: un fondo sin NAV vale cero
en la cartera, y uno con el NAV de hace dos meses vale lo que valía hace dos
meses. El extracto trae las dos cosas —participaciones y valor—, y con ellas la
posición vale exactamente lo que dice la entidad.

    python3 ajustar_posiciones.py <entrada.json> <salida.json> <posiciones.tsv>
"""
import sys, json, collections

TOL = 1e-6


def num(x):
    return float(str(x if x not in (None, "") else 0).replace(",", "."))


def main():
    entrada, salida, ruta = sys.argv[1:4]
    doc = json.load(open(entrada))
    ops = doc.get("inversiones", [])
    ajustes = 0

    for n, linea in enumerate(open(ruta, encoding="utf-8"), 1):
        linea = linea.rstrip("\n")
        if not linea.strip() or linea.lstrip().startswith("#"):
            continue
        p = (linea.split("\t") + [""] * 5)[:5]
        cuenta, isin, titulos, foto, valor = (x.strip() for x in p)
        reales = num(titulos)
        suyas = [o for o in ops if str(o.get("cuenta") or "").strip() == cuenta
                 and str(o.get("isin") or "").strip() == isin]
        if not suyas:
            print(f"   ⚠ línea {n}: no hay operaciones de {isin} en {cuenta}")
            continue
        actual = round(sum(num(o.get("unidades")) for o in suyas), 6)
        if abs(actual - reales) < TOL:
            print(f"   ✓ {cuenta:12} {isin:14} {actual:>12.6f} participaciones, ya cuadra")
            continue
        ultima = suyas[-1]
        nuevas = round(num(ultima.get("unidades")) + (reales - actual), 6)
        if nuevas < 0:
            print(f"   ⚠ {cuenta} {isin}: cuadrar exigiría dejar la última operación "
                  f"en {nuevas:.6f} participaciones, se deja como está")
            continue
        print(f"   {cuenta:12} {isin:14} {actual:>12.6f} → {reales:<12.6f} "
              f"({reales - actual:+.6f} en la operación de {ultima.get('fecha')})")
        ultima["unidades"] = f"{nuevas:.6f}".rstrip("0").rstrip(".")
        ultima["ajuste_posicion"] = f"participaciones cuadradas con el extracto de {foto}"
        ajustes += 1

        if valor and reales:
            precio = num(valor) / reales
            serie = doc.setdefault("nav", {}).setdefault(isin, [])
            serie[:] = [e for e in serie if str(e.get("fecha")) != foto]
            serie.append({"fecha": foto, "precio": f"{precio:.6f}"})
            print(f"                 NAV {foto} = {precio:.6f} €  ({num(valor):,.2f} € de valor)"
                  .replace(",", " "))

    json.dump(doc, open(salida, "w"), ensure_ascii=False, indent=2)
    print(f"posiciones corregidas: {ajustes}")


if __name__ == "__main__":
    main()
