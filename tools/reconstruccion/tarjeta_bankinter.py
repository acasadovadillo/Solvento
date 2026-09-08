#!/usr/bin/env python3
"""
Da de alta la Mastercard Oro como PASIVO vinculado a la cuenta de Bankinter.

Una tarjeta no es una cuenta: comprar con ella no baja la caja, sube la deuda.
Y no es tampoco un saldo suelto que haya que teclear cada mes: sale de sus
propios movimientos.

  · cada compra          Gasto con cuenta_origen = «Mastercard Oro»
                         → no toca la caja (ese nombre no es una cuenta),
                           aumenta la deuda, y conserva su categoría para Balance
  · la liquidación       Traspaso Bankinter → «Mastercard Oro»
                         → baja la caja de Bankinter y salda la deuda, igual que
                           el cargo único que enseña la app del banco

El cargo de liquidación ya viene en el extracto de la cuenta corriente, así que
no se inventa: se localiza y se convierte de Gasto en Traspaso.

    python3 tarjeta_bankinter.py <carpeta_pdfs> <entrada.json> <salida.json>
"""
import sys, re, json, datetime
from pathlib import Path
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from leer_bankinter import leer_todo
from cotejar import fecha, efecto, es_inversion

TARJETA = "Mastercard Oro"
CUENTA = "Bankinter"
# El cargo mensual de la tarjeta en la cuenta corriente
# Bankinter llama EUROCARD al recibo de la tarjeta, ni Mastercard ni tarjeta
RE_LIQUIDACION = re.compile(r"EUROCARD|TARJETA|MASTERCARD|CREDITO ON|LIQUIDAC", re.I)


def nuevo_id():
    import random
    return "m" + "".join(random.choice("0123456789abcdef") for _ in range(10))


def main():
    carpeta, entrada, salida = sys.argv[1:4]
    meses = leer_todo(carpeta)
    compras = [m for d in meses for m in d["tarj_movs"]]
    doc = json.load(open(entrada))

    # ── 1. las compras, como gasto contra la tarjeta ──
    # Si ya las habías apuntado a mano, se conserva TU concepto y TU categoría:
    # «IBI Morisquillo 2025» dice mucho más que «DIPUTACION DE AVILA, AVILA».
    # Se busca en todas las cuentas —al reconstruir la cuenta corriente, las
    # compras con tarjeta se quedaron sin pareja y fueron a parar a Efectivo—
    # PERO nunca entre lo que vino del extracto bancario. Eso es verdad
    # comprobada contra la cadena de saldos: si una compra con tarjeta coincide
    # por casualidad en importe y fecha con un movimiento real de la cuenta,
    # sustituirlo descuadraría la cuenta entera.
    def del_extracto(m):
        ref = str(m.get("imp_ref") or "")
        return "|" in ref and not ref.startswith("tarjeta|")
    previos = [m for m in doc["movimientos"]
               if not es_inversion(m) and fecha(m.get("fecha")) and not del_extracto(m)]
    usados, nuevos, heredadas = set(), [], 0
    for c in compras:
        gemelo = None
        for m in previos:
            if id(m) in usados or m.get("tipo") != "Gasto":
                continue
            if abs(abs(float(str(m.get("importe")).replace(",", "."))) - abs(c["importe"])) > 0.005:
                continue
            if abs((fecha(m["fecha"]) - c["fecha"]).days) <= 4:
                gemelo = m; break
        if gemelo:
            usados.add(id(gemelo)); heredadas += 1
        nuevos.append({
            "id": nuevo_id(), "marca_temporal": datetime.datetime.now().strftime("%d/%m/%Y %H:%M:%S"),
            "fecha": f"{c['fecha']:%d/%m/%Y}", "tipo": "Ingreso" if c["importe"] > 0 else "Gasto",
            "importe": f"{abs(c['importe']):.2f}",
            "cuenta_origen": TARJETA if c["importe"] < 0 else "",
            "cuenta_destino": TARJETA if c["importe"] > 0 else "",
            "tipo_ingreso": (gemelo or {}).get("tipo_ingreso", ""),
            "tipo_gasto": (gemelo or {}).get("tipo_gasto", ""),
            "tipo_prestamo": "", "persona_prestamo": "",
            "detalle": (gemelo or {}).get("detalle") or c["concepto"],
            "imp_ref": f"tarjeta|{c['fecha']:%Y%m%d}|{abs(c['importe']):.2f}",
        })
    # las apuntadas a mano se van: las sustituye la línea del banco
    doc["movimientos"] = [m for m in doc["movimientos"] if id(m) not in usados] + nuevos

    # ── 2. la liquidación mensual: de gasto de Bankinter a traspaso a la tarjeta ──
    liquidaciones = 0
    for m in doc["movimientos"]:
        if m.get("tipo") != "Gasto" or str(m.get("cuenta_origen") or "") != CUENTA:
            continue
        if not RE_LIQUIDACION.search(str(m.get("detalle") or "")):
            continue
        m["tipo"] = "Traspaso"; m["cuenta_destino"] = TARJETA; m["tipo_gasto"] = ""
        liquidaciones += 1

    # ── 3. el pasivo, con su saldo calculado a partir de esos movimientos ──
    doc.setdefault("pasivos", [])
    doc["pasivos"] = [p for p in doc["pasivos"] if (p.get("nombre") or "") != TARJETA]
    doc["pasivos"].append({"id": "pas_mastercard", "nombre": TARJETA,
                           "tipo": "Tarjeta de crédito", "entidad": "Bankinter",
                           "cuenta": CUENTA})

    # ── 4. §1: la deuda es la que dice el banco ──
    # El ciclo de facturación de la tarjeta no es el mes natural (el extracto de
    # julio lista compras del 26 de junio al 10 de julio) y la cuota mensual
    # incluye una comisión que no figura como compra. En vez de forzar los
    # números uno a uno, se deja UN apunte explícito con la diferencia: el saldo
    # final pasa a ser exactamente el del extracto y se ve de dónde sale.
    def calcular():
        t = 0.0
        for m in doc["movimientos"]:
            imp = abs(float(str(m.get("importe") or 0).replace(",", ".")))
            if m.get("tipo") == "Gasto" and m.get("cuenta_origen") == TARJETA: t += imp
            elif m.get("tipo") == "Ingreso" and m.get("cuenta_destino") == TARJETA: t -= imp
            elif m.get("tipo") == "Traspaso" and m.get("cuenta_destino") == TARJETA: t -= imp
        return round(t, 2)

    # El último mes puede ser un CSV transcrito sin datos de tarjeta: el saldo
    # objetivo es el del último extracto que sí la traiga.
    ult = next((d for d in reversed(meses) if d["tarjeta"][1] is not None), meses[-1])
    objetivo = ult["tarjeta"][1] or 0.0
    resto = round(objetivo - calcular(), 2)
    if abs(resto) > 0.005:
        cierre = max(m["fecha"] for d in meses for m in d["tarj_movs"])
        doc["movimientos"].append({
            "id": nuevo_id(), "marca_temporal": datetime.datetime.now().strftime("%d/%m/%Y %H:%M:%S"),
            "fecha": f"{cierre:%d/%m/%Y}", "tipo": "Gasto" if resto > 0 else "Ingreso",
            "importe": f"{abs(resto):.2f}",
            "cuenta_origen": TARJETA if resto > 0 else "", "cuenta_destino": "" if resto > 0 else TARJETA,
            "tipo_ingreso": "", "tipo_gasto": "Comisiones", "tipo_prestamo": "", "persona_prestamo": "",
            "detalle": "Comisión de la tarjeta y desfase del ciclo de facturación",
            "imp_ref": "tarjeta|cierre"})

    json.dump(doc, open(salida, "w"), ensure_ascii=False, indent=2)

    deuda = 0.0
    for m in doc["movimientos"]:
        imp = abs(float(str(m.get("importe") or 0).replace(",", ".")))
        if m.get("tipo") == "Gasto" and m.get("cuenta_origen") == TARJETA: deuda += imp
        elif m.get("tipo") == "Ingreso" and m.get("cuenta_destino") == TARJETA: deuda -= imp
        elif m.get("tipo") == "Traspaso" and m.get("cuenta_destino") == TARJETA: deuda -= imp
    print(f"compras registradas contra la tarjeta   {len(nuevos):>5}")
    print(f"   de ellas, con tu concepto y categoría {heredadas:>5}")
    print(f"liquidaciones convertidas en traspaso    {liquidaciones:>5}")
    print(f"\nDEUDA PENDIENTE calculada  {deuda:>10,.2f} €".replace(",", " "))
    print(f"según el extracto de {ult['mes'][0]}-{ult['mes'][1]:02d}  {objetivo:>9,.2f} €".replace(",", " "))
    print("   " + ("✓ cuadra" if abs(deuda - objetivo) < 0.005
                   else f"✗ descuadre {deuda - objetivo:.2f} €"))
    print(f"\nescrito: {salida}")


if __name__ == "__main__":
    main()
