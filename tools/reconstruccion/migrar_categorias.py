#!/usr/bin/env python3
"""
Remapea las categorías antiguas a la taxonomía nueva.

El motor de clasificación solo rellena lo que está vacío, porque lo que alguien
clasificó a mano es mejor información que un patrón. Pero eso deja intactas las
categorías del catálogo viejo, y entonces conviven dos taxonomías: "Inmuebles >
Luz" al lado de "Vivienda > Suministros > Luz", contando lo mismo en dos sitios
y rompiendo cualquier agregado.

La tabla se pasa aparte porque lleva nombres que son datos personales —una
asociación, un municipio, un establecimiento del barrio— y este repositorio es
público. Formato, separado por tabuladores:

    categoría vieja<TAB>categoría nueva

Lo que no esté en la tabla se queda como está y se avisa, para que no
desaparezca nada en silencio.

    python3 migrar_categorias.py <entrada.json> <salida.json> <tabla.tsv> [clasificacion.tsv]

La tabla opcional de clasificación dice qué madres son necesarias, cuáles son
deseo y cuáles ahorro, para que la regla 50/30/20 funcione:

    madre<TAB>necesario|deseo|ahorro

Basta clasificar las madres: clasificarCategoria hereda hacia las hijas, así que
una categoría nueva colgada de "Vivienda" ya nace clasificada como necesaria.
"""
import sys, json, collections


def main():
    entrada, salida, tabla = sys.argv[1:4]
    mapa = {}
    for linea in open(tabla, encoding="utf-8"):
        linea = linea.rstrip("\n")
        if not linea.strip() or linea.lstrip().startswith("#"):
            continue
        partes = linea.split("\t")
        if len(partes) >= 2 and partes[0].strip():
            mapa[partes[0].strip()] = partes[1].strip()

    doc = json.load(open(entrada))
    num = lambda x: abs(float(str(x or 0).replace(",", ".")))
    hechos, sin_mapa = collections.Counter(), collections.Counter()

    for m in doc["movimientos"]:
        for campo in ("tipo_gasto", "tipo_ingreso"):
            v = str(m.get(campo) or "").strip()
            if not v:
                continue
            if v in mapa:
                if mapa[v] != v:
                    hechos[f"{v}  →  {mapa[v]}"] += 1
                m[campo] = mapa[v]
            else:
                sin_mapa[v] += num(m.get("importe"))

    # El catálogo de config también se pone al día, para que los formularios
    # ofrezcan las nuevas y no las viejas.
    cfg = doc.setdefault("config", {})
    viejas = cfg.get("categorias") or []
    nuevas = []
    for c in viejas:
        n = mapa.get(c, c)
        if n and n not in nuevas:
            nuevas.append(n)
    for n in mapa.values():
        if n and n not in nuevas:
            nuevas.append(n)
    cfg["categorias"] = sorted(nuevas)

    # Clasificación para el 50/30/20, si se ha pasado su tabla
    clasif = {}
    if len(sys.argv) > 4:
        for linea in open(sys.argv[4], encoding="utf-8"):
            linea = linea.rstrip("\n")
            if not linea.strip() or linea.lstrip().startswith("#"):
                continue
            partes = linea.split("\t")
            if len(partes) >= 2 and partes[0].strip():
                clasif[partes[0].strip()] = partes[1].strip()
        cfg["clasificacion"] = clasif

    json.dump(doc, open(salida, "w"), ensure_ascii=False, indent=2)
    print(f"{len(mapa)} equivalencias · {sum(hechos.values())} movimientos remapeados\n")
    for k, n in hechos.most_common():
        print(f"   {n:>4}  {k}")
    if sin_mapa:
        print(f"\n⚠ categorías sin equivalencia, se quedan como estaban:")
        for c, imp in sin_mapa.most_common():
            print(f"   {c:52} {imp:>10,.2f} €".replace(",", " "))
    print(f"\ncatálogo: {len(viejas)} → {len(cfg['categorias'])} categorías")
    if clasif:
        print(f"clasificación 50/30/20: {len(clasif)} madres")
        # Aviso si alguna madre en uso se queda sin clasificar: su gasto saldría
        # como "sin clasificar" en el reparto y lo desvirtuaría entero.
        madres = {str(m.get(c) or "").split(">")[0].strip()
                  for m in doc["movimientos"] for c in ("tipo_gasto",)
                  if str(m.get(c) or "").strip()}
        faltan = sorted(madres - set(clasif))
        if faltan:
            print(f"   ⚠ madres en uso sin clasificar: {', '.join(faltan)}")
    print(f"escrito: {salida}")


if __name__ == "__main__":
    main()
