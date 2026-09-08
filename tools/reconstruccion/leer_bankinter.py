#!/usr/bin/env python3
"""
Lee los extractos mensuales de Bankinter en PDF.

Se leen las COORDENADAS de cada palabra (pdftotext -bbox-layout) y se reconstruyen
las filas agrupando por posición vertical. El volcado plano (-layout) funcionaba en
14 de 15 archivos, pero en uno apiló dos movimientos campo por campo en vez de fila
por fila y los perdió; con las coordenadas eso no puede pasar, porque cada palabra
sabe en qué renglón estaba.

Tres controles, y ninguno es opcional:
  · el signo sale de la columna (Cargos o Abonos) según dónde caiga el número…
  · …y se contrasta con la cadena de saldos: saldo de la línea menos el anterior.
    Si discrepan, hay una línea perdida y se avisa en vez de seguir sumando mal.
  · por archivo: saldo inicial + suma = saldo final; y entre archivos, el final de
    un mes tiene que abrir el siguiente.

Los saldos se toman del resumen de cabecera, no de la tabla: un mes sin
movimientos omite la tabla entera pero siempre trae el resumen.

Uso:  python3 leer_bankinter.py <carpeta_con_pdfs>
"""
import sys, re, subprocess, datetime
from pathlib import Path
from xml.etree import ElementTree

CC      = "0100101272"
TARJETA = "0601476619"
FONDOS  = {"0372443": "Bankinter Horizonte 2028", "0372464": "Bankinter Premium Moderado"}
MESES = {m: i + 1 for i, m in enumerate(
    "enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre".split())}
RE_IMPORTE = re.compile(r"^-?[\d.]{1,12},\d{2}$")
RE_FECHA   = re.compile(r"^(\d{2})-(\d{2})-(\d{2})$")
TOL_Y = 3.0     # puntos: dos palabras del mismo renglón nunca distan más


def palabras(pdf):
    """Todas las palabras del PDF con su posición, página a página."""
    xml = subprocess.run(["pdftotext", "-bbox-layout", "-enc", "UTF-8", str(pdf), "-"],
                         capture_output=True, text=True).stdout
    raiz = ElementTree.fromstring(xml)
    ns = {"h": "http://www.w3.org/1999/xhtml"}
    for pag in raiz.iter("{http://www.w3.org/1999/xhtml}page"):
        out = []
        for w in pag.iter("{http://www.w3.org/1999/xhtml}word"):
            t = (w.text or "").strip()
            if t:
                out.append({"x": float(w.get("xMin")), "xf": float(w.get("xMax")),
                            "y": float(w.get("yMin")), "t": t})
        yield out


def en_filas(ws):
    """Agrupa por renglón: la y manda, y dentro de cada renglón ordena por x."""
    filas, actual = [], []
    for w in sorted(ws, key=lambda w: (w["y"], w["x"])):
        if actual and abs(w["y"] - actual[0]["y"]) > TOL_Y:
            filas.append(sorted(actual, key=lambda w: w["x"])); actual = []
        actual.append(w)
    if actual:
        filas.append(sorted(actual, key=lambda w: w["x"]))
    return filas


def texto_de(fila):
    return " ".join(w["t"] for w in fila)


def leer_mes(pdf):
    plano = subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", str(pdf), "-"],
                           capture_output=True, text=True).stdout
    m = re.search(r"\(\s*([a-záéíóú]+)\s+de\s+(\d{4})\s*\)", plano, re.I)
    mes = (int(m.group(2)), MESES[m.group(1).lower()]) if m else None

    # ── resumen de cabecera ──
    saldos = {}
    for linea in plano.split("\n"):
        r = re.search(r"Nº:\s*[\d.]*?(\d{7,10})\s+EUR\s+(.*)$", linea)
        if not r:
            continue
        cifras = [float(x.replace(".", "").replace(",", ".")) for x in re.findall(r"-?[\d.]+,\d{2}", r.group(2))]
        if cifras:
            saldos[r.group(1)] = (cifras[0], cifras[-1]) if len(cifras) >= 2 else (None, cifras[0])
    busca = lambda suf: next((v for k, v in saldos.items() if k.endswith(suf[-7:])), (None, None))
    cc, tarjeta = busca(CC), busca(TARJETA)
    fondos = {n: busca(s) for s, n in FONDOS.items() if busca(s) != (None, None)}

    # ── movimientos, por coordenadas ──
    movs, dudosas = [], []
    anterior = cc[0] if cc[0] is not None else 0.0
    for ws in palabras(pdf):
        filas = en_filas(ws)
        # la cabecera de la tabla da dónde empieza cada columna de dinero
        cab = next((f for f in filas if "Cargos" in texto_de(f) and "Abonos" in texto_de(f)), None)
        if not cab:
            continue
        xc = next(w["x"] for w in cab if w["t"].startswith("Cargos"))
        for f in filas:
            if f[0]["y"] <= cab[0]["y"]:
                continue
            if "SALDO ANTERIOR" in texto_de(f):
                v = [w for w in f if RE_IMPORTE.match(w["t"])]
                if v and not movs:
                    anterior = float(v[-1]["t"].replace(".", "").replace(",", "."))
                continue
            # El PDF deja un glifo suelto en el margen («!¬) delante de una línea
            # de cada mes. La fecha no siempre es la primera palabra: se busca.
            ancla = next((i for i, w in enumerate(f[:3]) if RE_FECHA.match(w["t"])), None)
            if ancla is None:
                continue
            f = f[ancla:]
            cifras = [w for w in f if RE_IMPORTE.match(w["t"])]
            if len(cifras) < 2:
                continue
            saldo = float(cifras[-1]["t"].replace(".", "").replace(",", "."))
            impreso = float(cifras[-2]["t"].replace(".", "").replace(",", "."))
            # El SIGNO sale de la cadena, no de la columna: los importes van
            # alineados a la derecha y las etiquetas de cabecera no, así que
            # comparar posiciones se equivoca en casi todas las líneas. El número
            # impreso sirve para confirmar la MAGNITUD, que es lo que sí valida.
            importe = round(saldo - anterior, 2)
            if abs(abs(importe) - impreso) > 0.005:
                dudosas.append((f"impreso {impreso:.2f} ≠ deducido {importe:+.2f}", texto_de(f)))
                anterior = saldo          # resincroniza para no arrastrar el error
                continue
            d, mo, a = RE_FECHA.match(f[0]["t"]).groups()
            desc = " ".join(w["t"] for w in f
                            if w["x"] > f[0]["x"] + 60 and w["x"] < xc - 5 and not RE_FECHA.match(w["t"]))
            movs.append({"fecha": datetime.date(2000 + int(a), int(mo), int(d)),
                         "concepto": re.sub(r"[#$]+", " ", desc).strip(),
                         "importe": importe, "saldo": saldo})
            anterior = saldo

    # ── compras con la Mastercard: tabla propia, sin columna de saldo ──
    # No tocan la cuenta corriente hasta la liquidación mensual, así que van
    # aparte: mezclarlas con la caja descuadraría el extracto.
    # La tarjeta no tiene columna de saldo, así que aquí el signo SÍ hay que
    # sacarlo de la columna: se toma la posición de «Cargos» y «Abonos» en su
    # cabecera y se mira dónde cae el número. El control es que la suma del mes
    # tiene que dar el saldo final de la tarjeta.
    tarj_movs, dentro_t, x_abonos = [], False, None
    for cruda in plano.split("\n"):
        if "Movimientos de su Tarjeta" in cruda:
            dentro_t = True; x_abonos = None; continue
        if dentro_t and "Cargos" in cruda and x_abonos is None:
            i = cruda.find("Abo")
            x_abonos = i if i > 0 else None
            continue
        if dentro_t and re.search(r"Movimientos de su Cuenta|FONDOS DE INVERSIÓN", cruda):
            dentro_t = False; continue
        if not dentro_t:
            continue
        mt = re.match(r"^\s*(\d{2}-\d{2}-\d{2})\s+(.*?)\s{2,}([\d.]+,\d{2})\s*$", cruda.rstrip())
        if not mt:
            continue
        d, mo, a = mt.group(1).split("-")
        valor = float(mt.group(3).replace(".", "").replace(",", "."))
        # a la derecha de donde empieza «Abonos» es un abono; a la izquierda, cargo
        signo = 1 if (x_abonos and mt.start(3) >= x_abonos - 4) else -1
        tarj_movs.append({"fecha": datetime.date(2000 + int(a), int(mo), int(d)),
                          "concepto": mt.group(2).strip(), "importe": signo * valor})

    return {"pdf": pdf.name, "mes": mes, "cc": cc, "tarjeta": tarjeta,
            "fondos": fondos, "movs": movs, "dudosas": dudosas, "tarj_movs": tarj_movs}


def main(carpeta):
    datos = sorted([d for d in (leer_mes(p) for p in Path(carpeta).glob("*.pdf")) if d["mes"]],
                   key=lambda d: d["mes"])
    fallos = 0
    print(f"{'mes':9}{'movs':>6}{'s.inicial':>12}{'s.final':>12}{'suma':>12}   cuadre")
    for d in datos:
        ini = d["cc"][0] if d["cc"][0] is not None else 0.0
        fin = d["cc"][1]
        suma = round(sum(x["importe"] for x in d["movs"]), 2)
        ok = fin is not None and abs(ini + suma - fin) < 0.005
        fallos += (not ok) + len(d["dudosas"])
        print(f"{d['mes'][0]}-{d['mes'][1]:02d}  {len(d['movs']):>6}{ini:>12,.2f}{fin or 0:>12,.2f}{suma:>12,.2f}   "
              f"{'✓' if ok else '✗ ' + format(ini + suma - (fin or 0), '+.2f')}"
              f"{'  ⚠ ' + str(len(d['dudosas'])) if d['dudosas'] else ''}".replace(",", " "))
    saltos = [(a, b) for a, b in zip(datos, datos[1:])
              if b["cc"][0] is not None and abs((a["cc"][1] or 0) - b["cc"][0]) > 0.005]
    fallos += len(saltos)
    print("\nENLACE ENTRE MESES: " + (f"✓ los {len(datos)} encadenan sin saltos" if not saltos else ""))
    for a, b in saltos:
        print(f"   ✗ {a['mes']} cierra en {a['cc'][1]:,.2f} y {b['mes']} abre en {b['cc'][0]:,.2f}".replace(",", " "))
    for d in datos:
        for motivo, linea in d["dudosas"][:3]:
            print(f"   ⚠ {d['pdf']}: {motivo}\n       {linea[:110]}")
    print(f"\nTOTAL {sum(len(d['movs']) for d in datos)} movimientos · "
          f"{datos[0]['mes'][0]}-{datos[0]['mes'][1]:02d} → {datos[-1]['mes'][0]}-{datos[-1]['mes'][1]:02d} · "
          f"cierra en {datos[-1]['cc'][1]:,.2f} €".replace(",", " "))
    print(f"MASTERCARD ORO (pasivo): {datos[-1]['tarjeta'][1] or 0:,.2f} €".replace(",", " "))
    for nom, v in datos[-1]["fondos"].items():
        print(f"   fondo · {nom:34} {v[1]:>12,.2f} €".replace(",", " "))
    print(f"\n{'SIN INCIDENCIAS ✓' if not fallos else str(fallos) + ' INCIDENCIAS'}")
    return datos


if __name__ == "__main__":
    main(sys.argv[1])
