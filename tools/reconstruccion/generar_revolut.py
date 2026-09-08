#!/usr/bin/env python3
"""
Da de alta Revolut como cuenta y reconstruye sus movimientos.

Es una cuenta compartida con su pareja: cada uno aporta la mitad, pero el dinero
se considera de los dos y no se usa sin acuerdo mutuo, así que entra ENTERO en
el patrimonio. Es decisión suya y es coherente: si la cuenta sube 100 €, hay
100 € más de patrimonio disponible, aunque la mitad la haya puesto ella.

El extracto empieza en enero de 2026 con saldo cero, y eso resuelve una duda que
venía de antes: los 390 € que salieron hacia Revolut en 2025 y no volvieron no
están «en» ninguna parte, ya estaban gastados. Se quedan como gasto, que es lo
que fueron.

    python3 generar_revolut.py <carpeta_csv> <entrada.json> <salida.json>
"""
import sys, csv, json, datetime, random
from pathlib import Path

CUENTA = "Revolut"


def nid():
    return "m" + "".join(random.choice("0123456789abcdef") for _ in range(10))


def main():
    carpeta, entrada, salida = sys.argv[1:4]
    filas = []
    for ruta in sorted(Path(carpeta).glob("*.csv")):
        with open(ruta, encoding="utf-8-sig", newline="") as fh:
            for r in csv.DictReader(fh):
                if (r.get("State") or "").upper() not in ("COMPLETADO", "COMPLETED"):
                    continue
                # La fecha buena es la de FINALIZACIÓN: una recarga por open
                # banking se ordena un día y se liquida otro, y es al liquidarse
                # cuando el saldo cambia aquí y cuando sale el cargo del otro
                # banco. Con la fecha de inicio, el cargo de Bankinter del 10/08
                # quedaba más cerca de otra salida distinta y se emparejaba mal.
                f = (r.get("Fecha de finalización") or r.get("Completed Date")
                     or r.get("Fecha de inicio") or r.get("Started Date") or "")[:10]
                if not f:
                    continue
                a, m, d = (int(x) for x in f.split("-"))
                imp = float(r.get("Importe") or r.get("Amount") or 0)
                com = float(r.get("Comisión") or r.get("Fee") or 0)
                filas.append({"fecha": datetime.date(a, m, d),
                              "concepto": (r.get("Descripción") or r.get("Description") or "").strip(),
                              "importe": round(imp - com, 2),
                              "saldo": float(r.get("Saldo") or r.get("Balance") or 0)})
    filas.sort(key=lambda x: (x["fecha"], x["saldo"]))
    if not filas:
        print("no hay movimientos completados en el extracto"); return

    # La cadena de saldos del propio extracto, como a los demás bancos
    rotos = [k for k in range(1, len(filas))
             if abs(round(filas[k - 1]["saldo"] + filas[k]["importe"], 2) - filas[k]["saldo"]) > 0.005]
    apertura = round(filas[0]["saldo"] - filas[0]["importe"], 2)

    doc = json.load(open(entrada))
    cuentas = doc["config"]["cuentas"]
    if not any(c.get("cuenta") == CUENTA for c in cuentas):
        cuentas.append({"cuenta": CUENTA, "accent": "#191c1f", "emoji": "💳",
                        "nota": "Compartida con Hafsa · el saldo entero cuenta como patrimonio"})

    doc["movimientos"] = [m for m in doc["movimientos"]
                          if str(m.get("cuenta_origen") or "") != CUENTA
                          and str(m.get("cuenta_destino") or "") != CUENTA]
    for f in filas:
        entra = f["importe"] > 0
        doc["movimientos"].append({
            "id": nid(), "marca_temporal": datetime.datetime.now().strftime("%d/%m/%Y %H:%M:%S"),
            "fecha": f"{f['fecha']:%d/%m/%Y}", "tipo": "Ingreso" if entra else "Gasto",
            "importe": f"{abs(f['importe']):.2f}",
            "cuenta_origen": "" if entra else CUENTA, "cuenta_destino": CUENTA if entra else "",
            "tipo_ingreso": "", "tipo_gasto": "", "tipo_prestamo": "", "persona_prestamo": "",
            "detalle": f["concepto"], "detalle_banco": f["concepto"],
            "imp_ref": f"Revolut|{f['fecha']:%Y%m%d}|{f['importe']:.2f}"})

    json.dump(doc, open(salida, "w"), ensure_ascii=False, indent=2)

    num = lambda x: abs(float(str(x or 0).replace(",", ".")))
    saldo = 0.0
    for m in doc["movimientos"]:
        i = num(m.get("importe"))
        o, d = str(m.get("cuenta_origen") or ""), str(m.get("cuenta_destino") or "")
        if m.get("tipo") == "Ingreso" and d == CUENTA: saldo += i
        elif m.get("tipo") == "Gasto" and o == CUENTA: saldo -= i
        elif m.get("tipo") == "Traspaso":
            if o == CUENTA: saldo -= i
            if d == CUENTA: saldo += i
    saldo, obj = round(saldo, 2), filas[-1]["saldo"]
    print(f"{len(filas)} movimientos · {filas[0]['fecha']:%d/%m/%Y} → {filas[-1]['fecha']:%d/%m/%Y}")
    print(f"cadena de saldos: {len(rotos)} enlaces rotos" + ("  ✓" if not rotos else "  ⚠"))
    print(f"saldo de apertura implícito: {apertura:,.2f} €".replace(",", " "))
    print(f"\n§2 CUADRE   extracto {obj:>9,.2f} €   reconstruido {saldo:>9,.2f} €   "
          f"{'✓ EXACTO' if abs(saldo - obj) < 0.005 else f'✗ descuadre {saldo - obj:+.2f} €'}".replace(",", " "))


if __name__ == "__main__":
    main()
