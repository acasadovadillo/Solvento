#!/usr/bin/env python3
"""
Empareja los traspasos entre cuentas propias.

Un traspaso deja dos rastros: la salida en una cuenta y la entrada en otra. Al
reconstruir cada extracto por separado quedan como dos apuntes sueltos —un gasto
y un ingreso— y entonces el patrimonio sale bien pero la contabilidad miente: el
gasto total aparece inflado por dinero que no se gastó, solo se movió.

Esto solo puede hacerse cuando están TODAS las cuentas dentro, porque hasta
entonces falta siempre una de las dos mitades.

La regla para no juntar lo que no debe juntarse: mismo importe, signo opuesto,
cuentas distintas, pocos días de diferencia Y que al menos uno de los dos
conceptos diga que es una transferencia a nombre propio. Dos gastos del mismo
importe en la misma semana existen; lo que no existe es que los dos digan
«Alberto Casado Vadillo».

    python3 emparejar_traspasos.py <entrada.json> <salida.json> [dias]
"""
import sys, re, json, datetime, collections

# Nombre del titular tal y como lo escribe cada banco en sus conceptos
RE_PROPIO = re.compile(r"alberto\s+casado|casado\s+vadillo", re.I)
RE_TRANSF = re.compile(r"trans\b|transf|transferencia|incoming transfer|traspaso", re.I)


def fecha(s):
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", str(s or ""))
    return datetime.date(int(m.group(3)), int(m.group(2)), int(m.group(1))) if m else None


def cuenta_de(m):
    if m.get("tipo") == "Ingreso":
        return str(m.get("cuenta_destino") or "").strip(), 1
    if m.get("tipo") == "Gasto":
        return str(m.get("cuenta_origen") or "").strip(), -1
    return None, 0


def main():
    entrada, salida = sys.argv[1:3]
    dias = int(sys.argv[3]) if len(sys.argv) > 3 else 4
    doc = json.load(open(entrada))
    cuentas = {c["cuenta"] for c in doc["config"]["cuentas"]}

    sueltos = []
    for m in doc["movimientos"]:
        cta, signo = cuenta_de(m)
        f = fecha(m.get("fecha"))
        if not cta or cta not in cuentas or not f:
            continue
        sueltos.append({"m": m, "cta": cta, "f": f,
                        "imp": signo * abs(float(str(m.get("importe") or 0).replace(",", "."))),
                        "txt": str(m.get("detalle") or "")})

    # Solo se consideran los que alguien ha marcado como transferencia propia
    def propio(x):
        return bool(RE_PROPIO.search(x["txt"]) and RE_TRANSF.search(x["txt"]))

    candidatos = [x for x in sueltos if propio(x)]
    usados, parejas, ambiguos = set(), [], []
    for x in sorted(candidatos, key=lambda x: x["f"]):
        if id(x["m"]) in usados or x["imp"] >= 0:
            continue                                   # se recorre desde la salida
        opciones = []
        for y in sueltos:
            if id(y["m"]) in usados or y is x:
                continue
            if y["cta"] == x["cta"] or abs(y["imp"] + x["imp"]) > 0.005:
                continue
            d = abs((y["f"] - x["f"]).days)
            if d <= dias and (propio(y) or RE_TRANSF.search(y["txt"])):
                opciones.append((d, y))
        if not opciones:
            continue
        opciones.sort(key=lambda o: o[0])
        # Si hay varias a la misma distancia, no se decide sola
        if len(opciones) > 1 and opciones[0][0] == opciones[1][0]:
            ambiguos.append((x, [o[1] for o in opciones if o[0] == opciones[0][0]]))
            continue
        y = opciones[0][1]
        usados.add(id(x["m"])); usados.add(id(y["m"]))
        parejas.append((x, y))

    # ── aplicar: un único traspaso sustituye a las dos mitades ──
    fuera = set()
    for x, y in parejas:
        origen, destino = x, y                        # x es la salida, y la entrada
        t = origen["m"]
        t["tipo"] = "Traspaso"
        t["cuenta_origen"] = origen["cta"]
        t["cuenta_destino"] = destino["cta"]
        t["tipo_gasto"] = ""; t["tipo_ingreso"] = ""
        t["detalle"] = f"Traspaso {origen['cta']} → {destino['cta']}"
        fuera.add(id(destino["m"]))
    doc["movimientos"] = [m for m in doc["movimientos"] if id(m) not in fuera]
    json.dump(doc, open(salida, "w"), ensure_ascii=False, indent=2)

    print(f"transferencias propias detectadas   {len(candidatos):>4}")
    print(f"parejas resueltas                   {len(parejas):>4}")
    print(f"ambiguas, para decidir a mano       {len(ambiguos):>4}")
    tardias = [(x, y, abs((y["f"] - x["f"]).days)) for x, y in parejas if abs((y["f"] - x["f"]).days) > 4]
    if tardias:
        print(f"\nparejas con más de 4 días de diferencia ({len(tardias)}):")
        for x, y, dd in sorted(tardias, key=lambda t: -t[2]):
            print(f"   {dd:>2}d  {x['f']:%d/%m/%Y} {x['cta']:14} {x['imp']:>9,.2f}  →  "
                  f"{y['f']:%d/%m/%Y} {y['cta']:14}".replace(",", " "))
    print(f"\npor pareja de cuentas:")
    for k, n in collections.Counter(f"{x['cta']} → {y['cta']}" for x, y in parejas).most_common():
        s = sum(abs(x["imp"]) for x, y in parejas if f"{x['cta']} → {y['cta']}" == k)
        print(f"   {k:34} {n:>4}   {s:>10,.2f} €".replace(",", " "))
    if ambiguos:
        print("\nAMBIGUAS (mismo importe y misma distancia en fechas):")
        for x, ys in ambiguos[:10]:
            print(f"   {x['f']:%d/%m/%Y} {x['cta']:14} {x['imp']:>9,.2f}  {x['txt'][:40]}".replace(",", " "))
            for y in ys:
                print(f"      ¿→ {y['f']:%d/%m/%Y} {y['cta']:14} {y['txt'][:44]}")
    sin_pareja = [x for x in candidatos if id(x["m"]) not in usados
                  and not any(x is a for a, _ in ambiguos)]
    print(f"\nsin pareja: {len(sin_pareja)}  (transferencias a terceros, o cuya otra mitad no está en el periodo)")
    for x in sorted(sin_pareja, key=lambda x: x["f"])[:8]:
        print(f"   {x['f']:%d/%m/%Y} {x['cta']:14} {x['imp']:>9,.2f}  {x['txt'][:48]}".replace(",", " "))
    print(f"\nescrito: {salida}")


if __name__ == "__main__":
    main()
