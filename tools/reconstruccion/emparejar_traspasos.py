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
# Sus propios apuntes de "llevar dinero a invertir" son traspasos entre cuentas
# suyas, aunque el concepto no diga ni su nombre ni las cuentas: el de 100 € a
# MyInvestor tiene su pareja exacta el mismo día.
RE_PROPIO_EXTRA = re.compile(r"^inversion(es)?$|entrada de dinero en|pasar dinero", re.I)
# Revolut nombra la operación pero nunca al pagador: una «recarga con open
# banking» solo puede venir de una cuenta bancaria del propio titular, porque es
# él quien se autentica en su banco para ordenarla. Sin esto, la entrada no se
# reconocía como propia y su cargo en Bankinter se quedaba huérfano.
RE_RECARGA = re.compile(r"recarga con open banking|recarga desde|top-?up", re.I)


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
        # Se mira la redacción propia Y la del banco: la primera dice mejor QUÉ
        # fue, la segunda dice si fue una transferencia.
        sueltos.append({"m": m, "cta": cta, "f": f,
                        "imp": signo * abs(float(str(m.get("importe") or 0).replace(",", "."))),
                        "txt": (str(m.get("detalle") or "") + " · " + str(m.get("detalle_banco") or "")).strip(" ·")})

    # Solo se consideran los que alguien ha marcado como transferencia propia.
    # Además del nombre del titular vale que el concepto NOMBRE DOS CUENTAS
    # suyas: "Pasar dinero de Bankinter a Santander" es tan inequívoco como su
    # nombre, y sin esto esos pares se quedaban sueltos.
    def dos_cuentas(t):
        return sum(1 for c in cuentas if re.search(re.escape(c), t, re.I)) >= 2

    def propio(x):
        t = x["txt"].strip()
        return bool((RE_PROPIO.search(t) and RE_TRANSF.search(t))
                    or dos_cuentas(t) or RE_PROPIO_EXTRA.search(t)
                    or RE_RECARGA.search(t))

    candidatos = [x for x in sueltos if propio(x)]
    usados, parejas, ambiguos = set(), [], []
    # Se recorre desde CUALQUIERA de las dos patas, no solo desde la salida. La
    # marca de "es mío" puede estar en la entrada —"Incoming transfer from
    # ALBERTO CASADO"— mientras la salida se llama "Traspaso por bono transporte
    # julio"; exigiéndola en la salida, esos pares no se consideraban nunca.
    opciones = collections.defaultdict(list)
    for x in candidatos:
        for y in sueltos:
            if y is x or y["cta"] == x["cta"] or abs(y["imp"] + x["imp"]) > 0.005:
                continue
            # El dinero sale antes de entrar. Medir la distancia en valor
            # absoluto daba pares imposibles: la recarga de Revolut ordenada el
            # 08/08 se emparejaba con un cargo del 03/08, cinco días ANTES de
            # existir la orden. Se deja un día de margen por las fechas valor.
            sale, entra = (x, y) if x["imp"] < 0 else (y, x)
            d = (entra["f"] - sale["f"]).days
            if -1 <= d <= dias and (propio(y) or RE_TRANSF.search(y["txt"])):
                opciones[id(x)].append((d, y))

    # Se resuelve por CERCANÍA, no por orden de calendario. Recorriendo por fecha,
    # el primer cargo del mes se quedaba con una entrada que pertenecía a otro
    # posterior —el de Revolut se lo llevaba el cargo del 03/08 estando el suyo a
    # un solo día— y el error se propagaba en cadena. Los pares evidentes se
    # cierran antes y los dudosos se reparten lo que queda.
    todas = sorted(((d, x, y) for x in candidatos for d, y in opciones[id(x)]),
                   key=lambda o: (o[0], o[1]["f"]))
    for d, x, y in todas:
        if id(x["m"]) in usados or id(y["m"]) in usados:
            continue
        # Si a esa misma distancia hay otra entrada libre, no se decide sola
        empates = [z for dd, z in opciones[id(x)]
                   if dd == d and z is not y and id(z["m"]) not in usados]
        if empates:
            ambiguos.append((x, [y] + empates))
            usados.add(id(x["m"]))
            continue
        usados.add(id(x["m"])); usados.add(id(y["m"]))
        # La salida es siempre el origen del traspaso, venga de x o de y
        parejas.append((x, y) if x["imp"] < 0 else (y, x))

    # ── El efectivo ingresado en ventanilla vuelve de Efectivo ──
    # Es el reintegro de cajero al revés: dinero que sale del bolsillo y entra en
    # la cuenta. Su contrapartida es Efectivo, que no tiene extracto, así que no
    # hay pareja que buscar: se convierte aquí. Sin esto, ese dinero se contaba
    # como si nunca hubiera salido del bolsillo e inflaba el ajuste de efectivo.
    RE_DEPOSITO = re.compile(r"dep[óo]sito de efectivo|ingreso de efectivo", re.I)
    depositos = 0
    for m in doc["movimientos"]:
        if m.get("tipo") != "Ingreso" or not RE_DEPOSITO.search(str(m.get("detalle") or "")):
            continue
        destino = str(m.get("cuenta_destino") or "").strip()
        if destino not in cuentas or destino == "Efectivo":
            continue
        m["tipo"] = "Traspaso"; m["cuenta_origen"] = "Efectivo"; m["tipo_ingreso"] = ""
        depositos += 1

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

    print(f"ingresos de efectivo en ventanilla   {depositos:>4}  (pasan a traspaso desde Efectivo)")
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
