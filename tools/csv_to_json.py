#!/usr/bin/env python3
"""
Solvento v2 — Migración única: CSV (hojas actuales) → documento JSON.

Transforma los CSV que hoy alimentan generate.py en el documento unificado de la
v2. NO cifra nada: el cifrado lo hace SOLO el navegador (Web Crypto) una vez, en
la pantalla de importación inicial. El JSON que produce este script es en CLARO y
debe quedar fuera de git (data.json está en .gitignore).

Uso:
    python tools/csv_to_json.py            # lee data/*.csv → escribe data.json
    python tools/csv_to_json.py --stdout   # imprime el JSON por pantalla

Idempotente: los ids se derivan del contenido de cada fila (hash estable), así
que re-ejecutarlo produce el mismo documento salvo que cambien los datos.
"""
import csv
import hashlib
import json
import sys
from pathlib import Path

DATA = Path("data")

# gid/fichero → ISIN del fondo (históricos de valor liquidativo, un fondo por CSV)
NAV_FILES = {
    "nav_fidelity_sp500.csv":      "IE00BYX5MX67",
    "nav_bankinter_premium.csv":   "ES0164586036",
    "nav_bankinter_horizonte.csv": "ES0159038001",
}


def _rid(prefix, *parts):
    """id estable = prefijo + hash corto del contenido de la fila."""
    h = hashlib.sha1("|".join(str(p) for p in parts).encode("utf-8")).hexdigest()
    return f"{prefix}{h[:10]}"


def _get(row, *candidates, default=""):
    """Primer valor no vacío entre varios nombres de columna posibles."""
    for c in candidates:
        if c in row and str(row[c]).strip() != "":
            return str(row[c]).strip()
    return default


def _read(path):
    if not path.exists():
        print(f"   ⚠️  No existe {path}, se omite", file=sys.stderr)
        return []
    with path.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def build_movimientos():
    out = []
    for r in _read(DATA / "movimientos.csv"):
        rec = {
            "marca_temporal":  _get(r, "Marca temporal"),
            "fecha":           _get(r, "fecha"),
            "tipo":            _get(r, "tipo"),
            "importe":         _get(r, "importe"),
            "cuenta_origen":   _get(r, "cuenta_origen"),
            "cuenta_destino":  _get(r, "cuenta_destino"),
            "tipo_ingreso":    _get(r, "tipo_ingreso"),
            "tipo_gasto":      _get(r, "tipo_gasto"),
            "tipo_prestamo":   _get(r, "tipo_prestamo"),
            "persona_prestamo": _get(r, "persona_prestamo"),
            "detalle":         _get(r, "detalle"),
        }
        rec["id"] = _rid("m", rec["marca_temporal"], rec["fecha"], rec["tipo"],
                         rec["importe"], rec["detalle"], rec["cuenta_origen"],
                         rec["cuenta_destino"])
        out.append(rec)
    return out


def build_inversiones():
    out = []
    for r in _read(DATA / "inversiones.csv"):
        rec = {
            "fecha":           _get(r, "Fecha"),
            "tipo_movimiento": _get(r, "Tipo_Mov", "Tipo_Movimiento", default="Compra"),
            "nombre":          _get(r, "Nombre"),
            "ticker":          _get(r, "Ticker", default="-"),
            "isin":            _get(r, "ISIN", default="-"),
            "renta":           _get(r, "Renta", "Tipo"),
            "activo":          _get(r, "Activo"),
            "cuenta":          _get(r, "Cuenta", "Banco"),
            "valor":           _get(r, "Valor"),
            "coste":           _get(r, "Coste"),
            "unidades":        _get(r, "Unidades"),
        }
        rec["id"] = _rid("i", rec["fecha"], rec["isin"], rec["nombre"],
                         rec["coste"], rec["unidades"], rec["tipo_movimiento"])
        out.append(rec)
    return out


def build_inmuebles():
    out = []
    for r in _read(DATA / "inmuebles.csv"):
        rec = {
            "direccion":       _get(r, "Direccion", "Dirección"),
            "tipo":            _get(r, "Tipo"),
            "tasacion":        _get(r, "Tasacion", "Tasación"),
            "fecha_tasacion":  _get(r, "Fecha_Tasacion", "Fecha_Tasación"),
            "fecha_adquisicion": _get(r, "Fecha_adquisición", "Fecha_adquisicion"),
            "valor_compra":    _get(r, "Valor_compra"),
            "unidades_compra": _get(r, "Unidades_compra", default="1"),
        }
        rec["id"] = _rid("p", rec["direccion"], rec["tipo"], rec["fecha_adquisicion"])
        out.append(rec)
    return out


def build_nav():
    nav = {}
    for fichero, isin in NAV_FILES.items():
        filas = _read(DATA / fichero)
        pts = []
        for r in filas:
            fecha = _get(r, "Fecha")
            precio = _get(r, "Precio", "NAV")
            if fecha and precio:
                pts.append({"fecha": fecha, "precio": precio})
        if pts:
            nav[isin] = pts
    return nav


def main():
    doc = {
        "version": 2,
        "movimientos": build_movimientos(),
        "inversiones": build_inversiones(),
        "inmuebles":   build_inmuebles(),
        "nav":         build_nav(),
    }
    payload = json.dumps(doc, ensure_ascii=False, indent=2)
    if "--stdout" in sys.argv:
        print(payload)
        return
    out = Path("data.json")
    out.write_text(payload, encoding="utf-8")
    print(f"✅ {out} generado")
    print(f"   Movimientos: {len(doc['movimientos'])}")
    print(f"   Inversiones: {len(doc['inversiones'])}")
    print(f"   Inmuebles:   {len(doc['inmuebles'])}")
    print(f"   Fondos NAV:  {len(doc['nav'])} ({sum(len(v) for v in doc['nav'].values())} puntos)")
    print("   ⚠️  data.json es TEXTO EN CLARO — está gitignored; el cifrado lo hace el navegador.")


if __name__ == "__main__":
    main()
