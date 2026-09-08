#!/usr/bin/env python3
"""
Reparte por meses el efectivo retirado del que no quedó registro.

Efectivo es la única cuenta sin extracto: entra por los reintegros de cajero,
que sí constan, y sale en gastos del día a día que casi nunca se apuntan. El
resultado es un saldo que no existe en el bolsillo — dinero gastado sin registrar.

Se reparte mes a mes en vez de con un único apunte, y con el importe que de
verdad quedó sin justificar cada mes en lugar de una media. Así Balance refleja
un gasto creíble en cada mes y no un pico falso en una fecha que no es ninguna.

El arrastre importa: si un mes se justifica MÁS efectivo del que se sacó —porque
se gastó el del mes anterior— ese sobrante se descuenta del mes siguiente en vez
de crear un ajuste negativo, que no significaría nada. Así la suma de los ajustes
es exactamente el saldo pendiente, al céntimo.

    python3 ajustar_efectivo.py <entrada.json> <salida.json> [dd/mm/aaaa hoy]
"""
import sys, re, json, datetime, random, collections, calendar

CUENTA = "Efectivo"
CATEGORIA = "Gasto de ajuste"
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
         "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


def nid():
    return "m" + "".join(random.choice("0123456789abcdef") for _ in range(10))


def fecha(s):
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", str(s or ""))
    return datetime.date(int(m.group(3)), int(m.group(2)), int(m.group(1))) if m else None


def main():
    entrada, salida = sys.argv[1:3]
    hoy = fecha(sys.argv[3]) if len(sys.argv) > 3 else datetime.date.today()
    doc = json.load(open(entrada))
    num = lambda x: abs(float(str(x or 0).replace(",", ".")))

    ent, sal = collections.Counter(), collections.Counter()
    for m in doc["movimientos"]:
        o, d = str(m.get("cuenta_origen") or ""), str(m.get("cuenta_destino") or "")
        f = fecha(m.get("fecha"))
        if not f:
            continue
        ym = (f.year, f.month)
        if d == CUENTA and m.get("tipo") in ("Traspaso", "Ingreso"):
            ent[ym] += num(m["importe"])
        elif o == CUENTA and m.get("tipo") in ("Gasto", "Traspaso", "Préstamo"):
            sal[ym] += num(m["importe"])

    if not ent:
        print("no hay entradas de efectivo: nada que repartir"); return
    inicio, fin = min(ent), max(max(ent), (hoy.year, hoy.month))
    # todos los meses del hueco, incluidos los que no tuvieron retiradas
    todos = []
    a, m = inicio
    while (a, m) <= fin:
        todos.append((a, m))
        m += 1
        if m == 13: a, m = a + 1, 1

    nuevos, arrastre, total = [], 0.0, 0.0
    for (a, m) in todos:
        neto = round(ent[(a, m)] - sal[(a, m)] + arrastre, 2)
        if neto <= 0.005:
            arrastre = neto          # se justificó de más: se descuenta del mes que viene
            continue
        arrastre = 0.0
        ultimo = calendar.monthrange(a, m)[1]
        dia = hoy.day if (a, m) == (hoy.year, hoy.month) else ultimo
        nuevos.append({
            "id": nid(), "marca_temporal": datetime.datetime.now().strftime("%d/%m/%Y %H:%M:%S"),
            "fecha": f"{dia:02d}/{m:02d}/{a}", "tipo": "Gasto", "importe": f"{neto:.2f}",
            "cuenta_origen": CUENTA, "cuenta_destino": "",
            "tipo_ingreso": "", "tipo_gasto": CATEGORIA,
            "tipo_prestamo": "", "persona_prestamo": "",
            "detalle": (f"Gasto de ajuste · efectivo sacado en {MESES[m-1]} de {a} "
                        f"del que no quedó registro. Reparto mensual del descuadre "
                        f"de la cuenta de Efectivo, no un gasto concreto."),
            "imp_ref": f"ajuste-efectivo|{a}{m:02d}"})
        total += neto

    # Si al final sobra arrastre negativo, se descuenta del último ajuste para que
    # la suma sea exactamente el saldo y la cuenta quede en cero.
    if arrastre < -0.005 and nuevos:
        ult = nuevos[-1]
        ult["importe"] = f"{num(ult['importe']) + arrastre:.2f}"
        total += arrastre

    doc["movimientos"] = [m for m in doc["movimientos"]
                          if not str(m.get("imp_ref") or "").startswith("ajuste-efectivo|")]
    doc["movimientos"] += nuevos
    json.dump(doc, open(salida, "w"), ensure_ascii=False, indent=2)

    saldo = 0.0
    for m in doc["movimientos"]:
        o, d = str(m.get("cuenta_origen") or ""), str(m.get("cuenta_destino") or "")
        i = num(m.get("importe"))
        if d == CUENTA and m.get("tipo") in ("Traspaso", "Ingreso"): saldo += i
        elif o == CUENTA and m.get("tipo") in ("Gasto", "Traspaso", "Préstamo"): saldo -= i

    print(f"hueco: {MESES[inicio[1]-1]} de {inicio[0]} → {MESES[fin[1]-1]} de {fin[0]}  "
          f"({len(todos)} meses, {len(nuevos)} con ajuste)")
    print(f"repartido: {total:,.2f} €\n".replace(",", " "))
    for x in nuevos:
        print(f"   {x['fecha']}   {num(x['importe']):>9,.2f} €".replace(",", " "))
    print(f"\nEfectivo queda en {round(saldo,2):,.2f} €  "
          f"{'✓' if abs(saldo) < 0.005 else '✗ debería ser 0,00'}".replace(",", " "))


if __name__ == "__main__":
    main()
