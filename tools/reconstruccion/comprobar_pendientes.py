#!/usr/bin/env python3
"""
Puerta final: se niega a dar la reconstrucción por buena si queda algo marcado
como pendiente de identificar.

Existe porque el usuario lo pidió explícitamente para dos movimientos cuyo
motivo no recordaba, y porque es la única forma de que no se cuelen: un apunte
sin categoría se pierde entre doscientos pequeños, pero uno marcado como
pendiente sale aquí y devuelve código de error.

    python3 comprobar_pendientes.py <documento.json>
"""
import sys, json

MARCA = "Pendiente de identificar"


def main():
    doc = json.load(open(sys.argv[1]))
    num = lambda x: abs(float(str(x or 0).replace(",", ".")))
    pend = [m for m in doc["movimientos"]
            if MARCA in str(m.get("tipo_gasto") or "") + str(m.get("tipo_ingreso") or "")]
    if not pend:
        print("sin pendientes de identificar ✓")
        return 0
    total = sum(num(m["importe"]) for m in pend)
    print(f"⚠ {len(pend)} MOVIMIENTOS PENDIENTES DE IDENTIFICAR · {total:,.2f} €".replace(",", " "))
    print("   La reconstrucción NO debe darse por buena hasta saber qué son.\n")
    for m in sorted(pend, key=lambda m: -num(m["importe"])):
        print(f"   {str(m.get('fecha')):11} {m.get('tipo'):8} {num(m['importe']):>9,.2f}  "
              f"{str(m.get('detalle'))[:56]}".replace(",", " "))
    return 1


if __name__ == "__main__":
    sys.exit(main())
