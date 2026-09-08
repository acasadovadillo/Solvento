#!/usr/bin/env python3
"""
Añade movimientos que existieron pero que ningún extracto puede probar.

El efectivo no deja rastro. Si alguien te paga 230 € en mano, ese dinero entró de
verdad —y se gastó de verdad—, pero no hay banco que lo diga. La regla §1 impide
inventarse apuntes; esto no los inventa, los declara: cada línea es un hecho que
recuerdas y que aquí queda escrito, fechado y con su motivo, para que dentro de
un año se sepa de dónde salió.

Tiene que ejecutarse ANTES del ajuste de efectivo: el dinero que entra en el
bolsillo cambia cuánto se gastó sin registrar.

Formato del archivo, separado por tabuladores (las líneas con # son comentarios):

    fecha<TAB>tipo<TAB>importe<TAB>cuenta<TAB>categoría<TAB>centro<TAB>detalle

«tipo» es Ingreso o Gasto y «cuenta» la que recibe o paga.

    python3 apuntes_manuales.py <entrada.json> <salida.json> <apuntes.tsv>
"""
import sys, json, random, datetime


def nid():
    return "m" + "".join(random.choice("0123456789abcdef") for _ in range(10))


def main():
    entrada, salida, ruta = sys.argv[1:4]
    doc = json.load(open(entrada))
    cuentas = {c["cuenta"] for c in doc["config"]["cuentas"]}
    nuevos, avisos = [], []
    for n, linea in enumerate(open(ruta, encoding="utf-8"), 1):
        linea = linea.rstrip("\n")
        if not linea.strip() or linea.lstrip().startswith("#"):
            continue
        p = (linea.split("\t") + [""] * 7)[:7]
        fecha, tipo, importe, cuenta, cat, centro, detalle = (x.strip() for x in p)
        if tipo not in ("Ingreso", "Gasto") or not fecha or not importe:
            avisos.append(f"línea {n} mal formada, se ignora: {linea[:50]}"); continue
        if cuenta not in cuentas:
            avisos.append(f"línea {n}: la cuenta «{cuenta}» no existe, se ignora"); continue
        entra = tipo == "Ingreso"
        m = {"id": nid(), "marca_temporal": datetime.datetime.now().strftime("%d/%m/%Y %H:%M:%S"),
             "fecha": fecha, "tipo": tipo, "importe": f"{abs(float(importe.replace(',', '.'))):.2f}",
             "cuenta_origen": "" if entra else cuenta, "cuenta_destino": cuenta if entra else "",
             "tipo_ingreso": cat if entra else "", "tipo_gasto": "" if entra else cat,
             "tipo_prestamo": "", "persona_prestamo": "", "detalle": detalle, "manual": True}
        if centro:
            m["centro"] = centro
        nuevos.append(m)
    doc["movimientos"] = [m for m in doc["movimientos"] if not m.get("manual")] + nuevos
    json.dump(doc, open(salida, "w"), ensure_ascii=False, indent=2)
    for a in avisos:
        print(f"   ⚠ {a}")
    print(f"apuntes declarados a mano: {len(nuevos)}")
    for m in nuevos:
        signo = "+" if m["tipo"] == "Ingreso" else "−"
        cta = m["cuenta_destino"] or m["cuenta_origen"]
        print(f"   {m['fecha']:>10} {cta:12} {signo}{float(m['importe']):>9,.2f}  {m['detalle'][:44]}".replace(",", " "))


if __name__ == "__main__":
    main()
