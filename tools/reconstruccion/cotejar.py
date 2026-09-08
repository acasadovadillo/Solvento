#!/usr/bin/env python3
"""
Coteja un extracto bancario contra lo registrado hoy en Solvento.

No escribe nada: solo dice qué hay en el extracto que no está en Solvento, qué
hay en Solvento que el extracto no trae, y cuánto se parece cada pareja. La
decisión de qué se hace con cada grupo es del siguiente paso.

El emparejamiento es por importe exacto y fecha cercana, quedándose con la
pareja más próxima en el tiempo: dos importes iguales el mismo mes son
indistinguibles de otro modo, y cruzarlos falsearía las categorías heredadas.

    python3 cotejar.py <extracto.xls> <solvento.json> <NombreDeCuenta> [dias]
"""
import sys, re, json, datetime, collections

VENTANA = 3   # días de margen entre la fecha del banco y la registrada


def leer_xls_santander(ruta):
    """Extracto de Santander: cabecera en la fila 8, fechas como texto."""
    import xlrd
    wb = xlrd.open_workbook(ruta)
    sh = wb.sheet_by_index(0)

    def celda(i, j):
        c = sh.cell(i, j)
        return xlrd.xldate.xldate_as_datetime(c.value, wb.datemode) if c.ctype == 3 else c.value

    # La cabecera se busca, no se da por hecha: el banco puede mover el membrete
    cab = next(i for i in range(sh.nrows)
               if "FECHA OPERAC" in str(celda(i, 0)).upper())
    filas = []
    for i in range(cab + 1, sh.nrows):
        con, imp, sal = celda(i, 2), celda(i, 3), celda(i, 4)
        if con == "" and imp == "":
            continue
        filas.append({"linea": i + 1, "fecha": fecha(celda(i, 0)),
                      "concepto": str(con).strip(),
                      "importe": round(float(imp), 2), "saldo": round(float(sal), 2)})
    return filas


def fecha(v):
    if isinstance(v, datetime.datetime):
        return v.date()
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", str(v).strip())
    return datetime.date(int(m.group(3)), int(m.group(2)), int(m.group(1))) if m else None


def cadena_de_saldos(filas):
    """El extracto tiene que ser coherente consigo mismo antes de compararlo
    con nada: si su propia cadena de saldos no cierra, está mal leído."""
    orden = sorted(filas, key=lambda f: f["linea"])
    rotos = []
    for k in range(len(orden) - 1):
        esperado = round(orden[k + 1]["saldo"] + orden[k]["importe"], 2)
        if abs(esperado - orden[k]["saldo"]) > 0.005:
            rotos.append(orden[k])
    return rotos


def efecto(m, cuenta):
    """Lo que un movimiento de Solvento mueve en esta cuenta (+entra, -sale)."""
    imp = abs(float(str(m.get("importe") or 0).replace(",", ".")))
    o = str(m.get("cuenta_origen") or "").strip()
    d = str(m.get("cuenta_destino") or "").strip()
    t = m.get("tipo")
    if t == "Ingreso":
        return imp if d == cuenta else None
    if t == "Gasto":
        return -imp if o == cuenta else None
    if t == "Traspaso":
        return -imp if o == cuenta else (imp if d == cuenta else None)
    if t == "Préstamo":
        if m.get("tipo_prestamo") == "Dinero prestado":
            return -imp if o == cuenta else None
        return imp if d == cuenta else None
    return None


def es_inversion(m):
    t = str(m.get("tipo_gasto") or m.get("tipo_ingreso") or "").strip().lower()
    return t == "inversiones" and m.get("tipo") == "Gasto"


def main():
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(1)
    ext, docj, cuenta = sys.argv[1], sys.argv[2], sys.argv[3]
    ventana = int(sys.argv[4]) if len(sys.argv) > 4 else VENTANA

    filas = leer_xls_santander(ext)
    rotos = cadena_de_saldos(filas)
    print(f"EXTRACTO · {len(filas)} líneas · "
          f"{min(f['fecha'] for f in filas):%d/%m/%Y} → {max(f['fecha'] for f in filas):%d/%m/%Y}")
    print(f"   cadena de saldos: {len(rotos)} enlaces rotos"
          + ("  ⚠ NO SE PUEDE CONTINUAR" if rotos else "  ✓"))
    if rotos:
        sys.exit(2)

    doc = json.load(open(docj))
    movs = [m for m in doc["movimientos"]
            if not es_inversion(m) and efecto(m, cuenta) is not None]
    for m in movs:
        m["_f"] = fecha(m.get("fecha"))
        m["_e"] = round(efecto(m, cuenta), 2)
    movs = [m for m in movs if m["_f"]]
    print(f"SOLVENTO · {len(movs)} movimientos en «{cuenta}» · "
          f"{min(m['_f'] for m in movs):%d/%m/%Y} → {max(m['_f'] for m in movs):%d/%m/%Y}")

    # Emparejamiento voraz por cercanía de fecha
    usados, parejas, sueltas = set(), [], []
    for f in sorted(filas, key=lambda x: x["fecha"]):
        mejor, mejor_d = None, 10 ** 9
        for m in movs:
            if id(m) in usados or abs(m["_e"] - f["importe"]) > 0.005:
                continue
            dd = abs((m["_f"] - f["fecha"]).days)
            if dd > ventana or dd >= mejor_d:
                continue
            mejor, mejor_d = m, dd
        if mejor is None:
            sueltas.append(f)
        else:
            usados.add(id(mejor))
            parejas.append((f, mejor))

    ini, fin = min(f["fecha"] for f in filas), max(f["fecha"] for f in filas)
    sobrantes = [m for m in movs if id(m) not in usados and ini <= m["_f"] <= fin]

    print(f"\nCOTEJO (margen ±{ventana} días)")
    print(f"   casan            {len(parejas):>5}   conservan su categoría")
    print(f"   solo el extracto {len(sueltas):>5}   altas nuevas")
    print(f"   solo Solvento    {len(sobrantes):>5}   a revisar uno a uno")

    porm = collections.Counter(f"{f['fecha']:%Y-%m}" for f in sueltas)
    print("\n   altas nuevas por mes:")
    for ym in sorted(porm):
        print(f"      {ym}  {porm[ym]:>4}")

    print("\n   lo que solo está en Solvento:")
    for m in sorted(sobrantes, key=lambda x: x["_f"])[:15]:
        txt = m.get("detalle") or m.get("tipo_gasto") or m.get("tipo_ingreso") or "(sin concepto)"
        print(f"      {m['_f']:%d/%m/%Y}  {m['_e']:>10,.2f}  {txt[:52]}".replace(",", " "))
    if len(sobrantes) > 15:
        print(f"      … y {len(sobrantes) - 15} más")

    saldo_banco = min(filas, key=lambda f: f["linea"])["saldo"]
    saldo_solv = round(sum(m["_e"] for m in movs), 2)
    print(f"\nSALDO   banco {saldo_banco:>12,.2f} €   Solvento {saldo_solv:>12,.2f} €   "
          f"diferencia {saldo_banco - saldo_solv:>10,.2f} €".replace(",", " "))


if __name__ == "__main__":
    main()
