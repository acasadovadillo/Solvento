#!/usr/bin/env python3
"""
Reconstruye Trade Republic: su caja Y sus operaciones de inversión.

Aquí las dos cosas van juntas por necesidad, no por comodidad. En Solvento el
efectivo de una compra lo mueve la propia operación, así que la caja de Trade
Republic no puede cuadrar si sus operaciones no están completas: el extracto
dice que salieron 1.212,31 € en compras y Solvento solo tenía 1.011,06 €
registrados. Esos 201,25 € que faltan SON parte del saldo.

El extracto trae, de cada una de las 98 operaciones, la fecha, el importe, el
ISIN y las participaciones, así que se reconstruyen desde él igual que la caja.
Lo que no trae —nombre corto, tipo de activo, renta fija o variable— se hereda
de lo que ya había registrado para ese mismo ISIN.

Los apuntes de tipo «Operar» NO se registran como movimientos: si además del
apunte de inversión hubiera un gasto, el dinero saldría dos veces.

    python3 generar_tr.py <extracto.pdf> <entrada.json> <salida.json>
"""
import sys, re, json, datetime, random
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from leer_tr import leer, RE_ISIN, RE_CANT

CUENTA = "Trade Republic"
# XF000BTC0017 es el identificador que Trade Republic usa para el bitcoin; no es
# un ISIN real y en Solvento ese activo está dado de alta sin ISIN.
ALIAS_ISIN = {"XF000BTC0017": "-"}
RE_VENTA = re.compile(r"\bSell trade\b", re.I)


def nid(p):
    return p + "".join(random.choice("0123456789abcdef") for _ in range(10))


def main():
    pdf, entrada, salida = sys.argv[1:4]
    d = leer(pdf)
    doc = json.load(open(entrada))
    num = lambda x: float(str(x or 0).replace(",", "."))

    # ── ficha de cada activo, de lo ya registrado y del catálogo ──
    ficha = {}
    for r in doc["inversiones"]:
        k = str(r.get("isin") or "-").strip()
        ficha.setdefault(k, {"nombre": r.get("nombre", ""), "ticker": r.get("ticker", "-"),
                             "activo": r.get("activo", ""), "renta": r.get("renta", "")})
    for a in doc["config"].get("activos", []):
        k = str(a.get("isin") or "-").strip()
        ficha.setdefault(k, {"nombre": a.get("nombre", ""), "ticker": a.get("ticker") or "-",
                             "activo": a.get("activo", ""), "renta": a.get("renta", "")})

    # ── 1. operaciones de inversión, reconstruidas del extracto ──
    viejas = [r for r in doc["inversiones"] if str(r.get("cuenta") or "").strip() == CUENTA]
    doc["inversiones"] = [r for r in doc["inversiones"] if str(r.get("cuenta") or "").strip() != CUENTA]
    ops, sin_ficha = [], set()
    for m in d["movs"]:
        if m["tipo"] != "Operar":
            continue
        mi, mc = RE_ISIN.search(m["concepto"]), RE_CANT.search(m["concepto"])
        if not mi or not mc:
            sin_ficha.add(m["concepto"][:60]); continue
        isin = ALIAS_ISIN.get(mi.group(1), mi.group(1))
        f = ficha.get(isin, {"nombre": mi.group(1), "ticker": "-", "activo": "", "renta": ""})
        venta = RE_VENTA.search(m["concepto"]) or m["importe"] > 0
        uds = float(mc.group(1))
        ops.append({
            "fecha": f"{m['fecha']:%d/%m/%Y}",
            "tipo_movimiento": "Venta" if venta else "Compra",
            "nombre": f["nombre"], "ticker": f["ticker"], "isin": isin,
            "renta": f["renta"], "activo": f["activo"], "cuenta": CUENTA, "valor": "",
            # Convenio de Solvento: la venta lleva coste y unidades en negativo
            "coste": f"{-m['importe']:.2f}", "unidades": f"{-uds if venta else uds:.8f}".rstrip("0").rstrip("."),
            "id": nid("i"),
        })
    doc["inversiones"] += ops

    # ── 2. la caja: todo lo que NO es «Operar» ──
    doc["movimientos"] = [m for m in doc["movimientos"]
                          if str(m.get("cuenta_origen") or "") != CUENTA
                          and str(m.get("cuenta_destino") or "") != CUENTA]
    nuevos = 0
    for m in d["movs"]:
        if m["tipo"] == "Operar" or not m["fecha"]:
            continue
        entra = m["importe"] > 0
        doc["movimientos"].append({
            "id": nid("m"), "marca_temporal": datetime.datetime.now().strftime("%d/%m/%Y %H:%M:%S"),
            "fecha": f"{m['fecha']:%d/%m/%Y}", "tipo": "Ingreso" if entra else "Gasto",
            "importe": f"{abs(m['importe']):.2f}",
            "cuenta_origen": "" if entra else CUENTA, "cuenta_destino": CUENTA if entra else "",
            "tipo_ingreso": "", "tipo_gasto": "",
            "tipo_prestamo": "", "persona_prestamo": "",
            "detalle": f"{m['tipo']} · {m['concepto']}"[:160],
            "imp_ref": f"TR|{m['fecha']:%Y%m%d}|{m['importe']:.2f}",
        })
        nuevos += 1

    json.dump(doc, open(salida, "w"), ensure_ascii=False, indent=2)

    # ── 3. §2: el saldo tiene que ser el que declara el extracto ──
    saldo = 0.0
    for m in doc["movimientos"]:
        imp = abs(num(m.get("importe")))
        o, dd = str(m.get("cuenta_origen") or ""), str(m.get("cuenta_destino") or "")
        if m.get("tipo") == "Ingreso" and dd == CUENTA: saldo += imp
        elif m.get("tipo") == "Gasto" and o == CUENTA: saldo -= imp
        elif m.get("tipo") == "Traspaso":
            if o == CUENTA: saldo -= imp
            if dd == CUENTA: saldo += imp
    for r in doc["inversiones"]:
        if str(r.get("cuenta") or "") != CUENTA: continue
        if (r.get("tipo_movimiento") or "Compra") in ("Traspaso", "Herencia"): continue
        saldo -= num(r.get("coste"))
    saldo = round(saldo, 2)
    obj = d["resumen"]["final"]

    print(f"operaciones de inversión   {len(viejas):>4} → {len(ops):>4}")
    print(f"movimientos de caja        {nuevos:>11}")
    for t in ("Tarjeta", "Transferencia", "Interés", "Rentabilidad", "Regalo"):
        n = sum(1 for m in d["movs"] if m["tipo"] == t)
        if n: print(f"   {t:16} {n:>4}")
    if sin_ficha:
        print(f"   ⚠ {len(sin_ficha)} operaciones sin ISIN o sin participaciones legibles")
    print(f"\n§2 CUADRE   extracto {obj:>10,.2f} €   reconstruido {saldo:>10,.2f} €   "
          f"{'✓ EXACTO' if abs(saldo - obj) < 0.005 else f'✗ descuadre {saldo - obj:+.2f} €'}".replace(",", " "))
    print(f"\nescrito: {salida}")


if __name__ == "__main__":
    main()
