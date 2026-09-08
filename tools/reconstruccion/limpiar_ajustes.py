#!/usr/bin/env python3
"""
Retira los tapahuecos que ningún extracto puede desmentir.

Los de las cuentas con extracto ya los quita su generador: si el banco no trae
un apunte, ese apunte no ocurrió. Pero Efectivo no tiene extracto y nunca lo
tendrá, así que los ajustes que viven ahí sobreviven a todo el proceso.

El patrón es deliberadamente estrecho. Un filtro por la palabra «ajuste» se
llevaría por delante cobros reales cuyo concepto la contiene —«Bizum de Laura
Colorado Concepto Ajuste…»—, así que solo se retira lo que es inequívocamente
andamiaje: actualizar el HTML, comprobar si la web funciona, gasto estimado,
saldo aproximado.

    python3 limpiar_ajustes.py <entrada.json> <salida.json>
"""
import sys, json, re

# «html» a secas basta y es seguro: ningún gasto de verdad menciona el HTML de
# la web. Buscar la frase entera fallaba con «Ajuste para que el HTML quede bien
# actualizado», que no dice «actualizar el html» sino otra cosa parecida.
ANDAMIAJE = re.compile(
    r"\bhtml\b|para ver si la web|gasto estimado no registrado|"
    r"ajuste de saldo|ajuste desconocido|saldo aproximado|saldo en cuenta inicial|"
    r"pull test|push test", re.I)


def main():
    entrada, salida = sys.argv[1:3]
    doc = json.load(open(entrada))
    num = lambda x: abs(float(str(x or 0).replace(",", ".")))
    fuera = [m for m in doc["movimientos"] if ANDAMIAJE.search(str(m.get("detalle") or ""))]
    doc["movimientos"] = [m for m in doc["movimientos"] if m not in fuera]
    json.dump(doc, open(salida, "w"), ensure_ascii=False, indent=2)
    print(f"tapahuecos retirados: {len(fuera)} · {sum(num(m['importe']) for m in fuera):,.2f} €".replace(",", " "))
    for m in fuera:
        cta = m.get("cuenta_origen") or m.get("cuenta_destino") or "-"
        print(f"   {str(m.get('fecha')):11} {m.get('tipo'):9} {num(m['importe']):>9,.2f}  {cta:14} "
              f"{str(m.get('detalle'))[:46]}".replace(",", " "))


if __name__ == "__main__":
    main()
