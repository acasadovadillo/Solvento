#!/usr/bin/env python3
"""
Lee el extracto de cuenta de Trade Republic (PDF).

Es el más enrevesado de los cuatro. Cada transacción ocupa tres renglones —día y
mes arriba, año abajo, y en medio el tipo con los importes— y la descripción se
derrama sobre los renglones de la fecha, así que leer por líneas de texto plano
mezcla unas transacciones con otras. Se lee por coordenadas: cada palabra sabe
en qué renglón y en qué columna estaba.

El signo sale otra vez de la cadena de balances, no de las columnas «entrada» y
«salida», y se contrasta con el importe impreso. Al final, el balance calculado
tiene que dar el que declara el resumen de cabecera.

Lo importante para la contabilidad: los 67 apuntes de tipo «Operar» NO son
movimientos de caja sino operaciones de inversión —traen ISIN y participaciones—
y en Solvento el efectivo lo mueve la operación, no un apunte aparte. Si se
registraran como gasto, el dinero saldría dos veces de la cuenta.

Uso:  python3 leer_tr.py <extracto.pdf>
"""
import sys, re, subprocess, datetime
from xml.etree import ElementTree

MES = {m: i + 1 for i, m in enumerate(
    "ene feb mar abr may jun jul ago sept oct nov dic".split())}
RE_EUR = re.compile(r"^-?[\d.]+,\d{2}$")
RE_DIA = re.compile(r"^(\d{1,2})$")
RE_ANIO = re.compile(r"^(20\d{2})$")
# El tipo puede venir partido en dos renglones («Transacción» arriba y «con
# tarjeta» abajo), así que se busca en el texto de los renglones vecinos y no
# como palabra suelta de la fila. La tarjeta de Trade Republic es de débito: sus
# compras salen de la cuenta al momento, no a fin de mes como la de Bankinter.
TIPOS = ("Operar", "Transferencia", "Interés", "Regalo", "Rentabilidad", "Recompensa")
# «Transacción» y «con tarjeta» quedan separadas por la descripción al juntar los
# renglones, así que se buscan por separado y no como frase seguida.
RE_TIPO = [("Tarjeta", lambda t: re.search(r"Transacci[óo]n", t, re.I) and re.search(r"tarjeta", t, re.I))] + \
          [(x, (lambda p: (lambda t: re.search(re.escape(p), t, re.I)))(x)) for x in TIPOS]
TOL_Y = 3.0
NS = "{http://www.w3.org/1999/xhtml}"


def filas_por_pagina(pdf):
    xml = subprocess.run(["pdftotext", "-bbox-layout", "-enc", "UTF-8", str(pdf), "-"],
                         capture_output=True, text=True).stdout
    raiz = ElementTree.fromstring(xml)
    for pag in raiz.iter(NS + "page"):
        ws = []
        for w in pag.iter(NS + "word"):
            t = (w.text or "").strip()
            if t:
                ws.append({"x": float(w.get("xMin")), "y": float(w.get("yMin")), "t": t})
        filas, actual = [], []
        for w in sorted(ws, key=lambda w: (w["y"], w["x"])):
            if actual and abs(w["y"] - actual[0]["y"]) > TOL_Y:
                filas.append(sorted(actual, key=lambda w: w["x"])); actual = []
            actual.append(w)
        if actual:
            filas.append(sorted(actual, key=lambda w: w["x"]))
        yield filas


def num(t):
    return float(t.replace(".", "").replace(",", "."))


def leer(pdf):
    # El resumen de cabecera da el balance final que hay que alcanzar
    plano = subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", str(pdf), "-"],
                           capture_output=True, text=True).stdout
    res = re.search(r"Cuenta corriente\s+([\d.,]+)\s*€\s+([\d.,]+)\s*€\s+([\d.,]+)\s*€\s+([\d.,]+)\s*€", plano)
    resumen = {"inicial": num(res.group(1)), "entradas": num(res.group(2)),
               "salidas": num(res.group(3)), "final": num(res.group(4))} if res else None

    movs, dudosas, anterior = [], [], (resumen["inicial"] if resumen else 0.0)
    for filas in filas_por_pagina(pdf):
        for i, f in enumerate(filas):
            textos = [w["t"] for w in f]
            euros = [w for w in f if RE_EUR.match(w["t"])]
            # La fila del resumen de cabecera trae cuatro importes y no es una
            # transacción: leerla ponía el balance final como saldo de partida.
            if len(euros) != 2 or "corriente" in " ".join(textos).lower():
                continue
            # El tipo se busca en el renglón y en sus vecinos, porque puede venir
            # partido; sin tipo reconocido la transacción se lee igual, con un
            # aviso, en vez de descartarse y romper la cadena.
            vecino = " ".join(w["t"] for g in filas[max(0, i - 1): i + 2] for w in g)
            tipo = next((t for t, prueba in RE_TIPO if prueba(vecino)), "?")
            impreso, balance = num(euros[-2]["t"]), num(euros[-1]["t"])
            importe = round(balance - anterior, 2)
            if abs(abs(importe) - impreso) > 0.005:
                dudosas.append((f"impreso {impreso:.2f} ≠ deducido {importe:+.2f}",
                                " ".join(textos)[:110]))
                anterior = balance
                continue
            # La fecha vive repartida: el día y el mes en el renglón de arriba y el
            # año en el de abajo, así que se buscan alrededor de este.
            dia = mes = anio = None
            for g in filas[max(0, i - 2): i + 3]:
                for k, w in enumerate(g):
                    if w["x"] > 120:
                        continue
                    if RE_DIA.match(w["t"]) and k + 1 < len(g) and g[k + 1]["t"].rstrip(".") in MES:
                        dia, mes = int(w["t"]), MES[g[k + 1]["t"].rstrip(".")]
                    elif RE_ANIO.match(w["t"]):
                        anio = int(w["t"])
            # La descripción se recompone de los renglones que abarca la transacción
            desc = []
            for g in filas[max(0, i - 1): i + 2]:
                desc += [w["t"] for w in g
                         if 150 < w["x"] < euros[-2]["x"] - 10
                         and w["t"] not in TIPOS and w["t"] not in ("Transacción", "con", "tarjeta")]
            movs.append({"fecha": datetime.date(anio, mes, dia) if (dia and mes and anio) else None,
                         "tipo": tipo, "concepto": " ".join(desc).strip(),
                         "importe": importe, "balance": balance})
            anterior = balance
    return {"resumen": resumen, "movs": movs, "dudosas": dudosas}


RE_ISIN = re.compile(r"\b([A-Z]{2}[A-Z0-9]{9}\d)\b")
RE_CANT = re.compile(r"quantity:\s*([\d.]+)")


def main(pdf):
    d = leer(pdf)
    r, movs = d["resumen"], d["movs"]
    print(f"RESUMEN DEL BANCO   inicial {r['inicial']:,.2f} €   entradas {r['entradas']:,.2f} €   "
          f"salidas {r['salidas']:,.2f} €   final {r['final']:,.2f} €".replace(",", " "))
    print(f"\n{len(movs)} transacciones leídas · {len(d['dudosas'])} dudosas")
    sin_fecha = [m for m in movs if not m["fecha"]]
    if sin_fecha:
        print(f"   ⚠ {len(sin_fecha)} sin fecha reconocible")
    calc = round((r["inicial"] if r else 0) + sum(m["importe"] for m in movs), 2)
    print(f"\nCADENA   calculado {calc:,.2f} €   declarado {r['final']:,.2f} €   "
          f"{'✓ EXACTO' if abs(calc - r['final']) < 0.005 else f'✗ descuadre {calc - r['final']:.2f}'}".replace(",", " "))
    import collections
    print("\npor tipo:")
    for t, n in collections.Counter(m["tipo"] for m in movs).most_common():
        s = sum(m["importe"] for m in movs if m["tipo"] == t)
        print(f"   {t:16} {n:>4}   {s:>11,.2f} €".replace(",", " "))
    ops = [m for m in movs if m["tipo"] == "Operar"]
    con_isin = [m for m in ops if RE_ISIN.search(m["concepto"])]
    con_cant = [m for m in ops if RE_CANT.search(m["concepto"])]
    print(f"\nOPERACIONES DE INVERSIÓN   {len(ops)} · con ISIN {len(con_isin)} · con participaciones {len(con_cant)}")
    for m in ops[:5]:
        isin = (RE_ISIN.search(m["concepto"]) or [None, "?"])[1] if RE_ISIN.search(m["concepto"]) else "?"
        cant = (RE_CANT.search(m["concepto"]) or [None, "?"])[1] if RE_CANT.search(m["concepto"]) else "?"
        print(f"   {m['fecha']} {m['importe']:>9,.2f}  {isin}  {cant}".replace(",", " "))
    for motivo, linea in d["dudosas"][:5]:
        print(f"   ⚠ {motivo}\n       {linea}")
    return d


if __name__ == "__main__":
    main(sys.argv[1])
