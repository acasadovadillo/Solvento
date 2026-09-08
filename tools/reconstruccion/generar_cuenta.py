#!/usr/bin/env python3
"""
Reconstruye UNA cuenta a partir de su extracto y devuelve el documento entero.

Reglas aplicadas (las acordadas con el usuario):
  §1 manda el extracto      fecha e importe salen del banco, siempre
  §2 nada entra sin cuadrar  al final el saldo calculado tiene que ser el del banco
  §4 solo es traspaso si las dos patas son cuentas propias

Decisiones que merecen explicación:

  · Un traspaso es un único apunte que mueve DOS cuentas, así que sustituirlo por
    un gasto suelto deja a la otra cuenta sin su mitad. Se conserva SOLO si la
    otra cuenta no tiene extracto —Efectivo, que no lo tiene y nunca lo tendrá—.
    Si la otra cuenta también se va a reconstruir, se deja como apunte de una
    sola pata: la otra saldrá de su propio extracto y el paso de emparejado las
    volverá a unir al final, cuando estén las dos. Conservarlo aquí y
    reconstruir después la otra cuenta era justamente lo que descuadraba
    Bankinter en 332,70 €.

  · El concepto del banco («Transaccion Contactless En...») es peor que el que
    escribió el usuario («Cena con Laura por ayudarme con la mudanza»). Manda el
    extracto en los hechos —fecha e importe—, no en la descripción: si había un
    detalle escrito a mano, se conserva. Pero el del banco se guarda aparte, en
    detalle_banco, y no por completismo: conservar solo la redacción propia
    borraba la palabra que identificaba un traspaso. «Compra Decathlon» era en
    realidad una transferencia a Trade Republic con la que después se pagó el
    Decathlon, y sin el texto del banco no había forma de verlo.

  · Las retiradas de cajero se convierten en traspaso a Efectivo aquí mismo y no
    esperan a la fase de traspasos: su contrapartida es Efectivo, que no tiene
    extracto, así que esperar no aportaría ninguna información nueva. Dejarlas
    como gasto inflaría el gasto real y dejaría Efectivo vacío.

  · Las transferencias entre cuentas propias SÍ esperan: su otra mitad está en el
    extracto del otro banco, que todavía no tenemos.
"""
import sys, re, json, datetime, collections
from pathlib import Path
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from cotejar import leer_xls_santander, fecha, efecto, es_inversion


def leer_extracto(ruta):
    """Un .xls es el extracto de Santander; una carpeta, los PDF de Bankinter."""
    p = Path(ruta)
    if p.is_file():
        return leer_xls_santander(str(p))
    from leer_bankinter import leer_todo
    meses = leer_todo(p)
    filas, n = [], 0
    for d in meses:
        for m in d["movs"]:
            n += 1
            filas.append({"linea": n, "fecha": m["fecha"], "concepto": m["concepto"],
                          "importe": m["importe"], "saldo": m["saldo"]})
    # El saldo de partida real de la cuenta, que en Bankinter es 0: la cuenta se
    # abre dentro del periodo, así que no hay que inventar ningún saldo inicial.
    filas[0]["saldo_apertura"] = meses[0]["cc"][0] or 0.0
    return filas

# El Santander llama «reintegro contra cuenta en ATM» a sacar dinero en un cajero
# ajeno. Sin esto, esos 20 € figuraban como un gasto sin comercio en vez de como
# dinero que se pasó al bolsillo.
RE_CAJERO = re.compile(r"retirada de efectivo|cajero autom|disposicion de efectivo"
                       r"|reintegro.*\batm\b|reintegro (de|en) caj", re.I)
RE_PROPIA = re.compile(r"transferencia .*alberto casado", re.I)


def _descendente(filas):
    """¿El extracto va del presente al pasado? Santander sí, Bankinter no."""
    return filas[0]["fecha"] > filas[-1]["fecha"]


def nuevo_id(p="m"):
    import random
    return p + "".join(random.choice("0123456789abcdef") for _ in range(10))


def base(fecha_es, importe, detalle, ref, banco=""):
    return {"id": nuevo_id(), "marca_temporal": datetime.datetime.now().strftime("%d/%m/%Y %H:%M:%S"),
            "fecha": fecha_es, "importe": f"{abs(importe):.2f}", "tipo": "", "detalle_banco": banco,
            "cuenta_origen": "", "cuenta_destino": "", "tipo_ingreso": "", "tipo_gasto": "",
            "tipo_prestamo": "", "persona_prestamo": "", "detalle": detalle, "imp_ref": ref}


def main():
    ext, docj, cuenta, efectivo, salida = sys.argv[1:6]
    # Cuentas que también se reconstruyen desde su propio extracto: con ellas no
    # hay que conservar nada, porque su mitad vendrá de su archivo.
    con_extracto = set((sys.argv[6] if len(sys.argv) > 6 else "").split(",")) - {""}
    filas = leer_extracto(ext)
    doc = json.load(open(docj))

    # ── emparejamiento en dos pasadas: ±3 días y, para lo que quede, ±10 ──
    movs = []
    for m in doc["movimientos"]:
        if es_inversion(m):
            continue
        e = efecto(m, cuenta)
        if e is None:
            continue
        f = fecha(m.get("fecha"))
        if f:
            movs.append({"m": m, "f": f, "e": round(e, 2)})

    usados, pareja, tarde = {}, {}, []
    for ventana in (3, 10):
        for fl in sorted(filas, key=lambda x: x["fecha"]):
            if fl["linea"] in pareja:
                continue
            mejor, md = None, 10 ** 9
            for c in movs:
                if id(c["m"]) in usados or abs(c["e"] - fl["importe"]) > 0.005:
                    continue
                dd = abs((c["f"] - fl["fecha"]).days)
                if dd <= ventana and dd < md:
                    mejor, md = c, dd
            if mejor:
                usados[id(mejor["m"])] = fl["linea"]
                pareja[fl["linea"]] = mejor
                if ventana == 10:
                    tarde.append((fl, mejor, md))

    ini, fin = min(f["fecha"] for f in filas), max(f["fecha"] for f in filas)
    sobrantes = [c for c in movs if id(c["m"]) not in usados and ini <= c["f"] <= fin]

    print(f"segunda pasada (±10 días): {len(tarde)} parejas rescatadas")
    for fl, c, d in tarde:
        print(f"   {c['f']:%d/%m/%Y} → {fl['fecha']:%d/%m/%Y} ({d}d) {fl['importe']:>9.2f}  "
              f"{(c['m'].get('detalle') or '')[:30]:30} | {fl['concepto'][:44]}")

    # ── construir el nuevo conjunto de movimientos ──
    fuera = {id(c["m"]) for c in movs}          # todo lo de esta cuenta sale y se rehace
    resto = [m for m in doc["movimientos"] if id(m) not in fuera]
    nuevos, informe = [], collections.Counter()

    # los traspasos y préstamos que casaron se conservan: mueven otra cuenta
    def otra_pata(m):
        o, d = str(m.get("cuenta_origen") or ""), str(m.get("cuenta_destino") or "")
        return d if o == cuenta else o

    for linea, c in pareja.items():
        if c["m"]["tipo"] in ("Traspaso", "Préstamo") and otra_pata(c["m"]) not in con_extracto:
            fl = next(x for x in filas if x["linea"] == linea)
            mov = dict(c["m"])
            mov["fecha"] = f"{fl['fecha']:%d/%m/%Y}"          # §1: la fecha, del banco
            if str(mov.get("detalle") or "").strip() in ("", "-"):
                mov["detalle"] = fl["concepto"]
            elif mov["detalle"] != fl["concepto"]:
                mov["detalle_banco"] = fl["concepto"]
            mov["imp_ref"] = f"{cuenta}|{fl['linea']}"
            nuevos.append(mov)
            informe["traspaso conservado"] += 1

    for fl in sorted(filas, key=lambda x: x["fecha"]):
        c = pareja.get(fl["linea"])
        if c and c["m"]["tipo"] in ("Traspaso", "Préstamo") and otra_pata(c["m"]) not in con_extracto:
            continue                                          # ya añadido arriba
        detalle = fl["concepto"]
        cat_g = cat_i = ""
        if c:                                                 # hereda lo escrito a mano
            viejo = str(c["m"].get("detalle") or "").strip()
            if viejo not in ("", "-"):
                detalle = viejo
            cat_g, cat_i = c["m"].get("tipo_gasto", ""), c["m"].get("tipo_ingreso", "")
            informe["actualizado del extracto"] += 1
        else:
            informe["alta nueva"] += 1
        mov = base(f"{fl['fecha']:%d/%m/%Y}", fl["importe"], detalle, f"{cuenta}|{fl['linea']}",
                    fl["concepto"] if detalle != fl["concepto"] else "")
        if fl["importe"] < 0 and RE_CAJERO.search(fl["concepto"]):
            mov["tipo"] = "Traspaso"; mov["cuenta_origen"] = cuenta; mov["cuenta_destino"] = efectivo
            informe["cajero → traspaso a Efectivo"] += 1
        elif fl["importe"] >= 0:
            mov["tipo"] = "Ingreso"; mov["cuenta_destino"] = cuenta; mov["tipo_ingreso"] = cat_i
        else:
            mov["tipo"] = "Gasto"; mov["cuenta_origen"] = cuenta; mov["tipo_gasto"] = cat_g
        if RE_PROPIA.search(fl["concepto"]):
            informe["pendiente de emparejar en la fase 4"] += 1
        nuevos.append(mov)

    # ── los sobrantes: a Efectivo si tienen concepto propio, fuera si son tapahuecos ──
    detalle_sobrantes = []
    RE_TAPA = re.compile(r"ajuste|actualizar el html|saldo\s.*inicial|cuadr|"
                         r"gasto estimado|no registrado|aproximado", re.I)
    for c in sobrantes:
        m, txt = dict(c["m"]), str(c["m"].get("detalle") or "").strip()
        if RE_TAPA.search(txt) or txt in ("", "-"):
            informe["tapahuecos eliminado"] += 1
            detalle_sobrantes.append((c, "ELIMINADO"))
            continue
        # gasto o préstamo real que el banco no tiene: se pagó en efectivo
        if m["tipo"] in ("Gasto", "Préstamo"):
            m["cuenta_origen"] = efectivo
        elif m["tipo"] == "Ingreso":
            m["cuenta_destino"] = efectivo
        nuevos.append(m)
        informe["movido a Efectivo"] += 1
        detalle_sobrantes.append((c, "→ Efectivo"))

    doc["movimientos"] = resto + nuevos

    # ── §2: el saldo inicial que falta, y la comprobación ──
    # El más antiguo es el de MAYOR número de línea, no el de menor fecha: el
    # extracto va del presente al pasado y el primer día trae varias líneas
    # empatadas, entre las que la fecha no sabe cuál fue primero.
    # El más antiguo es el primero de la cadena. Santander numera del presente al
    # pasado y Bankinter al revés, así que se decide por la fecha y, en empate,
    # por el extremo de la numeración que corresponda.
    antiguo = min(filas, key=lambda f: (f["fecha"], -f["linea"] if _descendente(filas) else f["linea"]))
    if "saldo_apertura" in filas[0]:
        antiguo = dict(antiguo, saldo=filas[0]["saldo_apertura"], importe=0.0)
    saldo_ini = round(antiguo["saldo"] - antiguo["importe"], 2)
    if abs(saldo_ini) > 0.005:
        ap = base(f"{antiguo['fecha'] - datetime.timedelta(days=1):%d/%m/%Y}", saldo_ini,
                  f"Saldo inicial en {cuenta} (primer extracto disponible)", f"{cuenta}|inicial")
        ap["tipo"] = "Ingreso" if saldo_ini > 0 else "Gasto"
        ap["cuenta_destino" if saldo_ini > 0 else "cuenta_origen"] = cuenta
        doc["movimientos"].append(ap)

    calc = round(sum(e for e in (efecto(m, cuenta) for m in doc["movimientos"]
                                 if not es_inversion(m)) if e is not None), 2)
    # El saldo de cierre es el del movimiento más reciente: al principio de la
    # numeración en Santander, que va del presente al pasado, y al final en
    # Bankinter, que va al revés.
    banco = (min if _descendente(filas) else max)(filas, key=lambda f: f["linea"])["saldo"]

    if detalle_sobrantes:
        print("\nLO QUE SOLO ESTÁ EN SOLVENTO (el extracto no lo trae)")
        for c, destino in detalle_sobrantes:
            print(f"   {c['f']:%d/%m/%Y} {c['m']['tipo']:9} {c['e']:>10,.2f}  {destino:12} "
                  f"{(c['m'].get('detalle') or c['m'].get('tipo_gasto') or '(sin concepto)')[:44]}".replace(",", " "))
    print("\nRESUMEN")
    for k, v in informe.most_common():
        print(f"   {k:34} {v:>5}")
    print(f"   {'saldo inicial añadido':34} {saldo_ini:>9,.2f} €".replace(",", " "))
    print(f"\n§2 CUADRE   banco {banco:>10,.2f} €   reconstruido {calc:>10,.2f} €   "
          f"{'✓ EXACTO' if abs(banco - calc) < 0.005 else f'✗ descuadre {banco-calc:.2f} €'}".replace(",", " "))
    json.dump(doc, open(salida, "w"), ensure_ascii=False, indent=2)
    print(f"\nescrito: {salida}   ({len(doc['movimientos'])} movimientos en total)")


if __name__ == "__main__":
    main()
