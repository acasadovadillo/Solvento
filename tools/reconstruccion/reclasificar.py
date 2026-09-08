#!/usr/bin/env python3
"""
Convierte en traspaso una línea que el banco llama pago.

A veces el dinero sale de una cuenta hacia fuera y vuelve al bolsillo por otro
camino: un Bizum a alguien de confianza para que lo saque de su cajero es, en el
fondo, sacar dinero propio. El banco solo puede escribir «PAGO BIZUM A…», y si se
deja así el gasto queda inflado por dinero que nunca se gastó, y encima queda
imputado a una persona a la que no se le regaló nada.

Cada línea del archivo señala un movimiento concreto —fecha, importe y un trozo
del concepto— y dice entre qué dos cuentas fue en realidad:

    fecha<TAB>importe<TAB>patrón<TAB>origen<TAB>destino<TAB>detalle

Se ejecuta después de emparejar (para que no lo deshaga) y antes del ajuste de
efectivo, porque cambia cuánto dinero había en el bolsillo.

    python3 reclasificar.py <entrada.json> <salida.json> <reclasificaciones.tsv>
"""
import sys, re, json


def main():
    entrada, salida, ruta = sys.argv[1:4]
    doc = json.load(open(entrada))
    cuentas = {c["cuenta"] for c in doc["config"]["cuentas"]}
    num = lambda x: abs(float(str(x or 0).replace(",", ".")))
    hechas, avisos = 0, []

    for n, linea in enumerate(open(ruta, encoding="utf-8"), 1):
        linea = linea.rstrip("\n")
        if not linea.strip() or linea.lstrip().startswith("#"):
            continue
        p = (linea.split("\t") + [""] * 6)[:6]
        fecha, importe, patron, origen, destino, detalle = (x.strip() for x in p)
        if origen not in cuentas or destino not in cuentas:
            avisos.append(f"línea {n}: «{origen}» o «{destino}» no es una cuenta"); continue
        rx = re.compile(patron, re.I) if patron else None
        candidatos = [m for m in doc["movimientos"]
                      if m.get("fecha") == fecha and abs(num(m.get("importe")) - num(importe)) < 0.005
                      and (not rx or rx.search(str(m.get("detalle") or "") + " " + str(m.get("detalle_banco") or "")))]
        if len(candidatos) != 1:
            avisos.append(f"línea {n}: {len(candidatos)} movimientos encajan con "
                          f"{fecha} {importe} «{patron}», hacen falta exactamente 1"); continue
        m = candidatos[0]
        m["tipo"] = "Traspaso"
        m["cuenta_origen"], m["cuenta_destino"] = origen, destino
        m["tipo_gasto"] = m["tipo_ingreso"] = ""
        m.pop("centro", None)
        if detalle:
            m["detalle"] = detalle
        hechas += 1
        print(f"   {fecha:>10} {num(importe):>9,.2f}  {origen} → {destino}   {detalle[:40]}".replace(",", " "))

    json.dump(doc, open(salida, "w"), ensure_ascii=False, indent=2)
    for a in avisos:
        print(f"   ⚠ {a}")
    print(f"reclasificadas a traspaso: {hechas}")


if __name__ == "__main__":
    main()
