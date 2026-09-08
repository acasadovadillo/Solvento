#!/usr/bin/env python3
"""
Clasifica los movimientos en los dos ejes: categoría y centro de coste.

Las REGLAS no viven aquí. El repositorio es público, y una tabla con los
comercios de alguien —su estanco, su bar, su supermercado— dice dónde vive y qué
hace. El motor es genérico y las reglas se pasan en un archivo aparte que se
queda en el equipo.

Formato del archivo de reglas, separado por tabuladores y en orden de prioridad
(gana la primera que encaje):

    patrón<TAB>categoría<TAB>centro<TAB>dirección

La dirección puede ser «in» (solo ingresos), «out» (solo gastos) o quedar vacía
(cualquiera). Hace falta más de lo que parece: un Bizum recibido de un inquilino
es alquiler y uno enviado a esa misma persona es un reparto de gastos, y sin
distinguirlos la misma regla clasificaría mal la mitad.

El patrón es una expresión regular sobre el concepto, sin distinguir mayúsculas.
La categoría y el centro pueden llevar la profundidad que haga falta con «>», y
cualquiera de los dos puede dejarse vacío para no tocar ese eje.

Lo que ninguna regla caza se queda SIN categoría a propósito: una categoría
inventada es peor que ninguna, porque contamina el reparto y no se distingue de
las buenas.

    python3 categorizar.py <entrada.json> <salida.json> <reglas.tsv> [--aplicar]
"""
import sys, re, json, collections


def cargar(ruta):
    reglas = []
    for n, linea in enumerate(open(ruta, encoding="utf-8"), 1):
        linea = linea.rstrip("\n")
        if not linea.strip() or linea.lstrip().startswith("#"):
            continue
        partes = linea.split("\t")
        if len(partes) < 2:
            print(f"   ⚠ regla {n} mal formada, se ignora: {linea[:60]}")
            continue
        pat, cat = partes[0].strip(), partes[1].strip()
        centro = partes[2].strip() if len(partes) > 2 else ""
        direccion = partes[3].strip().lower() if len(partes) > 3 else ""
        reglas.append({"n": n, "re": re.compile(pat, re.I), "pat": pat, "cat": cat,
                       "centro": centro, "dir": direccion, "casan": 0, "importe": 0.0})
    return reglas


def main():
    entrada, salida, ruta_reglas = sys.argv[1:4]
    aplicar = "--aplicar" in sys.argv
    doc = json.load(open(entrada))
    reglas = cargar(ruta_reglas)
    num = lambda x: abs(float(str(x or 0).replace(",", ".")))

    tocados = sin_regla = ya_tenian = 0
    importe_sin = 0.0
    ejemplos_sin = collections.Counter()

    for m in doc["movimientos"]:
        if m.get("tipo") not in ("Gasto", "Ingreso"):
            continue
        texto = str(m.get("detalle") or "")
        campo = "tipo_gasto" if m.get("tipo") == "Gasto" else "tipo_ingreso"
        tenia = bool(str(m.get(campo) or "").strip())
        sentido = "in" if m.get("tipo") == "Ingreso" else "out"
        regla = next((r for r in reglas
                      if (not r["dir"] or r["dir"] == sentido) and r["re"].search(texto)), None)
        if not regla:
            if not tenia:
                sin_regla += 1
                importe_sin += num(m.get("importe"))
                ejemplos_sin[texto[:52]] += 1
            continue
        regla["casan"] += 1
        regla["importe"] += num(m.get("importe"))
        if tenia and not regla["cat"]:
            ya_tenian += 1
        if aplicar:
            # La categoría propia manda sobre la regla: lo que clasificaste a
            # mano es mejor información que un patrón.
            if regla["cat"] and not tenia:
                m[campo] = regla["cat"]
            if regla["centro"]:
                m["centro"] = regla["centro"]
            tocados += 1

    if aplicar:
        json.dump(doc, open(salida, "w"), ensure_ascii=False, indent=2)

    print(f"{len(reglas)} reglas cargadas\n")
    print(f"{'mov':>5}{'importe':>12}   regla")
    for r in sorted(reglas, key=lambda r: -r["importe"]):
        if not r["casan"]:
            print(f"{'—':>5}{'':>12}   ⚠ no caza nada: {r['pat'][:44]}")
            continue
        marca = {"in": " ↓", "out": " ↑", "": "  "}[r["dir"]]
        print(f"{r['casan']:>5}{r['importe']:>12,.2f}{marca}  {r['cat'] or '(solo centro)':38} "
              f"{r['centro'] or ''}".replace(",", " "))

    gastos = [m for m in doc["movimientos"] if m.get("tipo") == "Gasto"]
    con = sum(1 for m in gastos if str(m.get("tipo_gasto") or "").strip())
    cen = sum(1 for m in gastos if str(m.get("centro") or "").strip())
    print(f"\ngastos con categoría   {con:>5} de {len(gastos)}  ({con/len(gastos)*100:.0f} %)")
    print(f"gastos con centro      {cen:>5} de {len(gastos)}  ({cen/len(gastos)*100:.0f} %)")
    print(f"\nsin regla: {sin_regla} movimientos · {importe_sin:,.2f} €".replace(",", " "))
    for t, n in ejemplos_sin.most_common(12):
        print(f"   {n:>4}  {t}")
    if aplicar:
        print(f"\nescrito: {salida}")
    else:
        print("\n(ensayo: no se ha escrito nada. Añade --aplicar cuando la tabla te valga)")


if __name__ == "__main__":
    main()
