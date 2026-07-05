#!/usr/bin/env python3
# generate.py — versión 3.0 (Python)
# Genera index.html a partir de data/movimientos.csv y data/inversiones.csv

import json
import math
import re
import urllib.request
from datetime import date, datetime
from pathlib import Path

import pandas as pd

# ════════════════════════════════════════════════════
# 1) CONFIGURACIÓN
# ════════════════════════════════════════════════════

CSV_PATH          = Path("data/movimientos.csv")
INVERSIONES_PATH  = Path("data/inversiones.csv")
HTML_PATH         = Path("index.html")
PRICES_CACHE_PATH = Path("data/prices_cache.json")

CUENTAS_CONFIG = [
    {"cuenta": "Bankinter",      "icono": '<img src="img/logo-bankinter.png" style="width:20px;height:20px;object-fit:contain;vertical-align:middle;">', "accent": "#FF6200"},
    {"cuenta": "Santander",      "icono": '<img src="img/logo-santander.png" style="width:20px;height:20px;object-fit:contain;vertical-align:middle;">', "accent": "#ec0000"},
    {"cuenta": "Trade Republic", "icono": '<img src="img/logo-trade-republic.png" style="width:20px;height:20px;object-fit:contain;vertical-align:middle;">', "accent": "#ffffff"},
    {"cuenta": "Efectivo",       "icono": "💵", "accent": "#2d9e5f"},
]

CATEGORIA_COLORES = {
    "Alimentación":        "#10b981",
    "Ocio":                "#8b5cf6",
    "Transporte":          "#3b82f6",
    "Fumar":               "#6b7280",
    "Salud":               "#ef4444",
    "Inmuebles":           "#f59e0b",
    "Suscripciones":       "#14b8a6",
    "Regalos":             "#ec4899",
    "Impuestos":           "#f97316",
    "Educación":           "#a78bfa",
    "Ropa":                "#fb7185",
    "Peluquería":          "#fbbf24",
    "ABIES":               "#6ee7b7",
    "Comisiones bancarias":"#9ca3af",
    "Gasto de ajuste":     "#374151",
}

ISIN_YF_MAP = {
    "IE00BYXYYM63": "AGGG.L",
    "IE00B4L5Y983": "IWDA.AS",
    "IE00B5BMR087": "CSPX.AS",
    "IE000KCS7J59": "EMIM.AS",
    "IE00B4ND3602": "PHAU.AS",
}

CAT_COLORES_INV  = {"Renta variable": "#3b82f6", "Renta fija": "#10b981"}
TIPO_COLORES_INV = {"ETF": "#8b5cf6", "Criptoactivo": "#f59e0b",
                    "Acciones": "#ec4899", "Fondo de inversión": "#14b8a6"}

R_DONUT = 15.91549430918954

PORTFOLIO_ASSETS = [
    {"nombre": "Oro Físico",             "ticker": "PHAU.AS", "moneda": "EUR"},
    {"nombre": "S&P 500",                "ticker": "CSPX.AS", "moneda": "EUR"},
    {"nombre": "MSCI Emerging Markets",  "ticker": "EMIM.AS", "moneda": "EUR"},
    {"nombre": "MSCI World",             "ticker": "IWDA.AS", "moneda": "EUR"},
    {"nombre": "US Aggregate Bond",      "ticker": "AGGG.L",  "moneda": "USD"},
    {"nombre": "Bitcoin",                "ticker": "BTC-EUR", "moneda": "EUR"},
    {"nombre": "Apple",                  "ticker": "AAPL",    "moneda": "USD"},
]

# ════════════════════════════════════════════════════
# 2) FUNCIONES AUXILIARES
# ════════════════════════════════════════════════════

def fmt_eur(x):
    if x is None or (isinstance(x, float) and math.isnan(x)):
        x = 0.0
    x = float(x)
    neg = x < 0
    abs_x = abs(x)
    # Formato español: separador miles ".", decimal ","
    entero = int(abs_x)
    decimales = round((abs_x - entero) * 100)
    if decimales == 100:
        entero += 1
        decimales = 0
    entero_str = f"{entero:,}".replace(",", ".")
    s = f"{entero_str},{decimales:02d} €"
    return f"-{s}" if neg else s

def fmt_pct(x):
    if x is None or (isinstance(x, float) and math.isnan(x)):
        x = 0.0
    return f"{float(x):.2f}".replace(".", ",") + "%"

def html_escape(s):
    if not isinstance(s, str):
        s = str(s) if s is not None else ""
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")

def color_cat(cat):
    return CATEGORIA_COLORES.get(cat, "#64748b")

def floor_month(d):
    return date(d.year, d.month, 1)

def parse_date(s):
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(str(s).strip(), fmt).date()
        except ValueError:
            continue
    return None

def fetch_daily_history(ticker):
    period2 = int(datetime.now().timestamp())
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
           f"?interval=1d&period1=946684800&period2={period2}")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
        result = data["chart"]["result"][0]
        ts = result["timestamp"]
        cl = result["indicators"]["quote"][0]["close"]
        return [[t * 1000, round(v, 4)] for t, v in zip(ts, cl) if v is not None]
    except Exception:
        return []

def fetch_intraday(ticker):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=5m&range=1d"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
        result = data["chart"]["result"][0]
        ts = result["timestamp"]
        cl = result["indicators"]["quote"][0]["close"]
        return [[t * 1000, round(v, 4)] for t, v in zip(ts, cl) if v is not None]
    except Exception:
        return []

def fetch_msci_history():
    period2 = int(datetime.now().timestamp())
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/IWDA.AS"
        f"?interval=1d&period1=1253862000&period2={period2}"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
        result = data["chart"]["result"][0]
        timestamps = result["timestamp"]
        closes = result["indicators"]["quote"][0]["close"]
        return [[t * 1000, round(v, 4)] for t, v in zip(timestamps, closes) if v is not None]
    except Exception:
        return []

def fetch_msci_intraday():
    url = "https://query1.finance.yahoo.com/v8/finance/chart/IWDA.AS?interval=5m&range=1d"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
        result = data["chart"]["result"][0]
        timestamps = result["timestamp"]
        closes = result["indicators"]["quote"][0]["close"]
        return [[t * 1000, round(v, 4)] for t, v in zip(timestamps, closes) if v is not None]
    except Exception:
        return []

def fetch_btc_history_max():
    period2 = int(datetime.now().timestamp())
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/BTC-EUR"
        f"?interval=1d&period1=1388534400&period2={period2}"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
        result = data["chart"]["result"][0]
        timestamps = result["timestamp"]
        closes = result["indicators"]["quote"][0]["close"]
        return [[t * 1000, round(v, 2)] for t, v in zip(timestamps, closes) if v is not None]
    except Exception:
        return []

# ── Caché de precios (fallback si Yahoo Finance no responde) ──
try:
    _PCACHE = json.loads(PRICES_CACHE_PATH.read_text(encoding="utf-8")) if PRICES_CACHE_PATH.exists() else {}
except Exception:
    _PCACHE = {}
_PCACHE.setdefault("prices", {})
_PCACHE.setdefault("fx", {})
_price_sources = {}  # {yf_ticker: "live" | "cache:YYYY-MM-DD" | "error"}

def _fetch_fx_eur(currency):
    """Devuelve cuántos EUR vale 1 unidad de `currency`. Usa caché si falla."""
    if currency in ("EUR", ""):
        return 1.0
    req = urllib.request.Request(
        f"https://query1.finance.yahoo.com/v8/finance/chart/{currency}EUR=X?interval=1d&range=5d",
        headers={"User-Agent": "Mozilla/5.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read())
        closes = [v for v in data["chart"]["result"][0]["indicators"]["quote"][0]["close"] if v is not None]
        rate = closes[-1] if closes else None
        if rate:
            _PCACHE["fx"][currency] = {"rate": rate, "date": str(date.today())}
            return rate
        return None
    except Exception:
        cached = _PCACHE["fx"].get(currency)
        if cached:
            print(f"   FX {currency}/EUR: usando caché del {cached['date']} ({cached['rate']:.4f})")
            return cached["rate"]
        return None

_FX_EUR = {
    "USD": _fetch_fx_eur("USD") or _PCACHE["fx"].get("USD", {}).get("rate") or 0.926,
    "GBP": _fetch_fx_eur("GBP") or _PCACHE["fx"].get("GBP", {}).get("rate") or 1.168,
}

def fetch_precio_actual_eur(ticker):
    """Precio más reciente en EUR. Guarda en caché; usa caché si Yahoo falla."""
    req = urllib.request.Request(
        f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=5d",
        headers={"User-Agent": "Mozilla/5.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as r:
            data = json.loads(r.read())
        result = data["chart"]["result"][0]
        closes = [v for v in result["indicators"]["quote"][0]["close"] if v is not None]
        if not closes:
            raise ValueError("sin cierres")
        price = closes[-1]
        cur = result["meta"].get("currency", "EUR")
        if cur == "GBp":
            price = price / 100 * _FX_EUR.get("GBP", 1.168)
        elif cur != "EUR":
            price = price * _FX_EUR.get(cur, 1.0)
        price = round(price, 6)
        _PCACHE["prices"][ticker] = {"price_eur": price, "date": str(date.today())}
        _price_sources[ticker] = "live"
        return price
    except Exception:
        cached = _PCACHE["prices"].get(ticker)
        if cached:
            print(f"   ⚠️  {ticker}: Yahoo no disponible — usando caché del {cached['date']}")
            _price_sources[ticker] = f"cache:{cached['date']}"
            return cached["price_eur"]
        _price_sources[ticker] = "error"
        return None

def add_donut_fields(df, total, pct_col="pct"):
    """Añade pct, pct_rest, pct_acum, rotacion al dataframe."""
    df = df.copy()
    df["pct"]      = (df["importe"] / total * 100) if total != 0 else 0.0
    df["pct_rest"] = 100.0 - df["pct"]
    df["pct_acum"] = df["pct"].cumsum().shift(1).fillna(0.0)
    df["rotacion"] = df["pct_acum"] * 3.6
    return df

# ════════════════════════════════════════════════════
# 3) LEER Y PROCESAR MOVIMIENTOS
# ════════════════════════════════════════════════════

mov = pd.read_csv(CSV_PATH, encoding="utf-8", dtype=str)
for col in ["tipo", "cuenta_origen", "cuenta_destino", "tipo_prestamo", "tipo_gasto", "tipo_ingreso"]:
    if col in mov.columns:
        mov[col] = mov[col].str.strip()

mov["importe"] = pd.to_numeric(mov["importe"], errors="coerce").fillna(0.0)
mov["fecha"]   = mov["fecha"].apply(parse_date)

# Deltas por cuenta
parts = []

mask = (mov["tipo"] == "Ingreso") & mov["cuenta_destino"].notna() & (mov["cuenta_destino"] != "-")
parts.append(mov[mask][["fecha", "cuenta_destino", "importe"]].rename(columns={"cuenta_destino": "cuenta", "importe": "delta"}))

mask = (mov["tipo"] == "Gasto") & mov["cuenta_origen"].notna() & (mov["cuenta_origen"] != "-")
tmp = mov[mask][["fecha", "cuenta_origen", "importe"]].rename(columns={"cuenta_origen": "cuenta", "importe": "delta"})
tmp["delta"] = -tmp["delta"]
parts.append(tmp)

mask = (mov["tipo"] == "Traspaso") & mov["cuenta_origen"].notna() & (mov["cuenta_origen"] != "-")
tmp = mov[mask][["fecha", "cuenta_origen", "importe"]].rename(columns={"cuenta_origen": "cuenta", "importe": "delta"})
tmp["delta"] = -tmp["delta"]
parts.append(tmp)

mask = (mov["tipo"] == "Traspaso") & mov["cuenta_destino"].notna() & (mov["cuenta_destino"] != "-")
parts.append(mov[mask][["fecha", "cuenta_destino", "importe"]].rename(columns={"cuenta_destino": "cuenta", "importe": "delta"}))

mask = (mov["tipo"] == "Préstamo") & (mov["tipo_prestamo"] == "Dinero prestado") & mov["cuenta_origen"].notna() & (mov["cuenta_origen"] != "-")
tmp = mov[mask][["fecha", "cuenta_origen", "importe"]].rename(columns={"cuenta_origen": "cuenta", "importe": "delta"})
tmp["delta"] = -tmp["delta"]
parts.append(tmp)

mask = (mov["tipo"] == "Préstamo") & (mov["tipo_prestamo"] == "Devolución") & mov["cuenta_destino"].notna() & (mov["cuenta_destino"] != "-")
parts.append(mov[mask][["fecha", "cuenta_destino", "importe"]].rename(columns={"cuenta_destino": "cuenta", "importe": "delta"}))

movimientos_fecha = pd.concat(parts, ignore_index=True)

saldos_crudos = movimientos_fecha.groupby("cuenta")["delta"].sum().round(2).reset_index()
saldos_crudos.columns = ["cuenta", "saldo"]

cuentas_df = pd.DataFrame(CUENTAS_CONFIG)
saldos = cuentas_df.merge(saldos_crudos, on="cuenta", how="left")
saldos["saldo"] = saldos["saldo"].fillna(0.0)
saldos = saldos.sort_values("saldo", ascending=False).reset_index(drop=True)

patrimonio_liquido = round(saldos["saldo"].sum(), 2)

saldos["pct"]      = (saldos["saldo"] / patrimonio_liquido * 100) if patrimonio_liquido != 0 else 0.0
saldos["pct_rest"] = 100.0 - saldos["pct"]
saldos["pct_acum"] = saldos["pct"].cumsum().shift(1).fillna(0.0)
saldos["rotacion"] = saldos["pct_acum"] * 3.6

fecha_actualizacion = date.today().strftime("%d/%m/%Y")

# Evolución diaria
evo = movimientos_fecha.dropna(subset=["fecha"]).copy()
evo = evo.groupby("fecha")["delta"].sum().round(2).reset_index()
evo.columns = ["fecha", "delta_diario"]
evo = evo.sort_values("fecha").reset_index(drop=True)
evo["patrimonio_acum"] = evo["delta_diario"].cumsum().round(2)

n_puntos = len(evo)

if n_puntos > 0:
    val_ini  = evo["patrimonio_acum"].iloc[0]
    val_fin  = evo["patrimonio_acum"].iloc[-1]
    diff_abs = val_fin - val_ini
    diff_pct = (diff_abs / abs(val_ini) * 100) if val_ini != 0 else 0.0
    signo_rend  = "+" if diff_abs >= 0 else ""
    color_trend = "#10b981" if diff_abs >= 0 else "#ef4444"
    color_bg_grad = "rgba(16,185,129,0.15)" if diff_abs >= 0 else "rgba(239,68,68,0.15)"
    fmt_rend    = f"{signo_rend}{fmt_eur(diff_abs)} ({signo_rend}{fmt_pct(diff_pct)})"
    fecha_ini_lbl = evo["fecha"].iloc[0].strftime("%d/%m/%Y")
    fecha_fin_lbl = evo["fecha"].iloc[-1].strftime("%d/%m/%Y")

    min_y = evo["patrimonio_acum"].min()
    max_y = evo["patrimonio_acum"].max()
    range_y = (max_y - min_y) if max_y != min_y else 1.0

    min_x = evo["fecha"].iloc[0].toordinal()
    max_x = evo["fecha"].iloc[-1].toordinal()
    range_x = (max_x - min_x) if max_x != min_x else 1.0

    evo["x_svg"] = 70 + (evo["fecha"].apply(lambda d: d.toordinal()) - min_x) / range_x * 910
    evo["y_svg"] = 260 - (evo["patrimonio_acum"] - min_y) / range_y * 220

    def _path_d(df):
        pts = [f"M {df['x_svg'].iloc[0]:.2f} {df['y_svg'].iloc[0]:.2f}"]
        for i in range(1, len(df)):
            pts.append(f"L {df['x_svg'].iloc[i]:.2f} {df['y_svg'].iloc[i]:.2f}")
        return " ".join(pts)

    path_linea = _path_d(evo)
    path_area  = f"{path_linea} L {evo['x_svg'].iloc[-1]:.2f} 280 L {evo['x_svg'].iloc[0]:.2f} 280 Z"

    # Eje Y
    y_axis_parts = []
    for i in range(5):
        frac = i / 4
        val  = min_y + (max_y - min_y) * frac
        yp   = 260 - frac * 220
        lbl  = f"{val/1000:.1f}".replace(".", ",") + "k" if abs(val) >= 1000 else str(round(val))
        y_axis_parts.append(
            f'<line x1="70" y1="{yp:.1f}" x2="980" y2="{yp:.1f}" stroke="#2a2d3a" stroke-width="1" stroke-dasharray="3 3"/>'
            f'<text x="984" y="{yp+4:.1f}" text-anchor="start" font-size="10" fill="#6b7280">{lbl}</text>'
        )
    y_axis_svg = "\n".join(y_axis_parts)

    # Eje X
    n_ticks = min(6, n_puntos)
    tick_idxs = [round(i * (n_puntos - 1) / (n_ticks - 1)) for i in range(n_ticks)] if n_ticks > 1 else [0]
    tick_idxs = sorted(set(tick_idxs))
    x_axis_parts = []
    for i in tick_idxs:
        row = evo.iloc[i]
        x_axis_parts.append(
            f'<text x="{row["x_svg"]:.1f}" y="295" text-anchor="middle" font-size="9" fill="#6b7280">{row["fecha"].strftime("%d/%m/%y")}</text>'
        )
    x_axis_svg = "\n".join(x_axis_parts)

    # Datos JS
    js_pts = []
    for _, row in evo.iterrows():
        ts  = int(datetime(row["fecha"].year, row["fecha"].month, row["fecha"].day).timestamp() * 1000)
        vf  = fmt_eur(row["patrimonio_acum"]).replace(" €", "")
        lbl = row["fecha"].strftime("%d/%m/%Y")
        js_pts.append(
            f'{{ t: {ts}, v: {row["patrimonio_acum"]:.2f}, f: \'{lbl}\', vf: \'{vf}\', x: {row["x_svg"]:.2f}, y: {row["y_svg"]:.2f} }}'
        )
    js_history_array = "[\n    " + ",\n    ".join(js_pts) + "\n  ]"

    evo_ref_y = f"{evo['y_svg'].iloc[0]:.2f}"
else:
    color_trend = "#6b7280"; color_bg_grad = "rgba(107,114,128,0.1)"
    fmt_rend = "0,00 € (0,00%)"
    fecha_ini_lbl = fecha_fin_lbl = date.today().strftime("%d/%m/%Y")
    path_linea = "M 70 120 L 980 120"
    path_area  = "M 70 120 L 980 120 L 980 280 L 70 280 Z"
    js_history_array = "[]"
    y_axis_svg = ""; x_axis_svg = ""
    evo_ref_y = "120"

# ════════════════════════════════════════════════════
# 4) LEER Y PROCESAR INVERSIONES (PRECIOS EN TIEMPO REAL)
# ════════════════════════════════════════════════════

# ── Metadatos: activos con ticker de Yahoo Finance ──
ACTIVOS_CONFIG = [
    {"Nombre": "US Aggregate Bond USD (Acc)",    "ISIN": "IE00BYXYYM63", "Ticker": "-",    "categoria": "Renta fija",     "tipo": "ETF",              "Banco": "Trade Republic", "yf_ticker": "AGGG.L"},
    {"Nombre": "Core MSCI World USD (Acc)",      "ISIN": "IE00B4L5Y983", "Ticker": "-",    "categoria": "Renta variable", "tipo": "ETF",              "Banco": "Trade Republic", "yf_ticker": "IWDA.AS"},
    {"Nombre": "Core S&P 500 USD (Acc)",         "ISIN": "IE00B5BMR087", "Ticker": "-",    "categoria": "Renta variable", "tipo": "ETF",              "Banco": "Trade Republic", "yf_ticker": "CSPX.AS"},
    {"Nombre": "MSCI Emerging Markets USD (Acc)","ISIN": "IE000KCS7J59", "Ticker": "-",    "categoria": "Renta variable", "tipo": "ETF",              "Banco": "Trade Republic", "yf_ticker": "EMIM.AS"},
    {"Nombre": "Physical Gold USD (Acc)",        "ISIN": "IE00B4ND3602", "Ticker": "-",    "categoria": "Renta variable", "tipo": "ETF",              "Banco": "Trade Republic", "yf_ticker": "PHAU.AS"},
    {"Nombre": "Bitcoin",                        "ISIN": "-",            "Ticker": "BTC",  "categoria": "Renta variable", "tipo": "Criptoactivo",     "Banco": "Trade Republic", "yf_ticker": "BTC-EUR"},
    {"Nombre": "Apple",                          "ISIN": "US0378331005", "Ticker": "AAPL", "categoria": "Renta variable", "tipo": "Acciones",         "Banco": "Trade Republic", "yf_ticker": "AAPL"},
]

# ── Fondos sin ticker público (valor manual en fondos_manuales.csv) ──
_FONDOS_PATH = Path("data/fondos_manuales.csv")
if _FONDOS_PATH.exists():
    for _, _fr in pd.read_csv(_FONDOS_PATH, dtype=str).iterrows():
        ACTIVOS_CONFIG.append({
            "Nombre":       str(_fr.get("Nombre", "")).strip(),
            "ISIN":         str(_fr.get("ISIN", "-")).strip(),
            "Ticker":       "-",
            "categoria":    str(_fr.get("categoria", "Renta variable")).strip(),
            "tipo":         str(_fr.get("tipo", "Fondo de inversión")).strip(),
            "Banco":        str(_fr.get("Banco", "")).strip(),
            "yf_ticker":    None,
            "valor_manual": float(_fr.get("Valor", 0) or 0),
        })

# ── Leer aportaciones (todo inversiones.csv son aportaciones) ──
_df_inv = pd.read_csv(INVERSIONES_PATH, encoding="utf-8", dtype=str)
_df_inv = _df_inv.rename(columns={"Tipo": "categoria", "Activo": "tipo"})
for col in ["tipo", "categoria", "ISIN", "Nombre"]:
    if col in _df_inv.columns:
        _df_inv[col] = _df_inv[col].str.strip()
if "ISIN" not in _df_inv.columns:
    _df_inv["ISIN"] = "-"
else:
    _df_inv["ISIN"] = _df_inv["ISIN"].fillna("-").replace("", "-")
for col in ("Coste", "fecha"):
    if col not in _df_inv.columns:
        _df_inv[col] = ""

_df_inv["_coste_n"] = pd.to_numeric(_df_inv["Coste"], errors="coerce")
inv_apor = _df_inv[_df_inv["_coste_n"].notna()].copy()

# ── Clave de cruce: ISIN o Nombre (Bitcoin no tiene ISIN) ──
def _jk_v(nombre, isin):
    s = str(isin).strip()
    return s if s not in ("-", "", "nan") else str(nombre).strip()

if len(inv_apor) > 0:
    inv_apor["_jk"]         = inv_apor.apply(lambda r: _jk_v(r.get("Nombre", ""), r.get("ISIN", "-")), axis=1)
    inv_apor["_fecha"]      = pd.to_datetime(inv_apor["fecha"].str.strip(), dayfirst=True, errors="coerce")
    inv_apor["_unidades_n"] = pd.to_numeric(inv_apor["Unidades"] if "Unidades" in inv_apor.columns else pd.Series(dtype=str), errors="coerce")
    _coste_agg = inv_apor.groupby("_jk").agg(
        coste_total    =("_coste_n",    "sum"),
        unidades_total =("_unidades_n", "sum"),
        fecha_primera  =("_fecha",      "min"),
        n_aportaciones =("_coste_n",    "count"),
    ).reset_index()
else:
    _coste_agg = pd.DataFrame(columns=["_jk","coste_total","unidades_total","fecha_primera","n_aportaciones"])

# ── Construir inv_raw: precio live × unidades ──
_inv_rows = []
for _a in ACTIVOS_CONFIG:
    _jk = _jk_v(_a["Nombre"], _a["ISIN"])
    _ag = _coste_agg[_coste_agg["_jk"] == _jk]
    _coste  = float(_ag["coste_total"].values[0])    if len(_ag) > 0 else float("nan")
    _unids  = float(_ag["unidades_total"].values[0]) if len(_ag) > 0 else float("nan")
    _fp_raw = _ag["fecha_primera"].values[0]         if len(_ag) > 0 else None
    _fp     = pd.Timestamp(_fp_raw) if _fp_raw is not None and not pd.isnull(_fp_raw) else pd.NaT
    _n_apor = int(_ag["n_aportaciones"].values[0])   if len(_ag) > 0 else 0

    _yft = _a.get("yf_ticker")
    if _yft:
        _precio  = fetch_precio_actual_eur(_yft)
        _importe = round(_precio * _unids, 2) if (_precio and not math.isnan(_unids)) else float("nan")
        _pfuente = _price_sources.get(_yft, "error")
    else:
        _importe = float(_a.get("valor_manual", float("nan")))
        _pfuente = "manual"

    _inv_rows.append({
        "Nombre":         _a["Nombre"],
        "ISIN":           _a["ISIN"],
        "Ticker":         _a.get("Ticker", "-"),
        "categoria":      _a["categoria"],
        "tipo":           _a["tipo"],
        "Banco":          _a["Banco"],
        "importe":        _importe,
        "coste_total":    _coste,
        "unidades_total": _unids,
        "fecha_primera":  _fp,
        "n_aportaciones": _n_apor,
        "ticker_yf":      _yft,
        "_jk":            _jk,
        "precio_fuente":  _pfuente,
    })
    if _yft:
        src_lbl = {"live": "✅ live", "error": "❌ sin precio"}.get(_pfuente, f"⚠️  caché {_pfuente.split(':')[-1]}")
        _p_str  = f"{_precio:.4f} €" if _precio else "—"
        print(f"   {_a['Nombre'][:30]:30s} {_yft:12s} → {_p_str}  [{src_lbl}]")

inv_raw = pd.DataFrame(_inv_rows)
inv_raw["importe"] = pd.to_numeric(inv_raw["importe"], errors="coerce")

# Guardar caché actualizada
try:
    PRICES_CACHE_PATH.write_text(json.dumps(_PCACHE, indent=2, ensure_ascii=False), encoding="utf-8")
    n_live  = sum(1 for v in _price_sources.values() if v == "live")
    n_cache = sum(1 for v in _price_sources.values() if v.startswith("cache:"))
    n_err   = sum(1 for v in _price_sources.values() if v == "error")
    print(f"   Caché: {n_live} live · {n_cache} desde caché · {n_err} sin precio")
except Exception as e:
    print(f"   ⚠️  No se pudo guardar el caché de precios: {e}")

# ── Rentabilidad ──
inv_raw["ganancia"] = inv_raw["importe"] - inv_raw["coste_total"]
inv_raw["rent_pct"] = ((inv_raw["importe"] / inv_raw["coste_total"]) - 1) * 100

_hoy = datetime.now()
def _cagr(r):
    if pd.isna(r["coste_total"]) or r["coste_total"] <= 0 or pd.isnull(r["fecha_primera"]):
        return float("nan")
    _fp = r["fecha_primera"]
    if not isinstance(_fp, pd.Timestamp):
        _fp = pd.Timestamp(_fp)
    anos = ((_hoy - _fp).days) / 365.25
    return (math.pow(r["importe"] / r["coste_total"], 1.0 / anos) - 1) * 100 if anos >= 0.01 else float("nan")

inv_raw["cagr"] = inv_raw.apply(_cagr, axis=1)

# ── Totales ──
total_inversiones  = round(inv_raw["importe"].dropna().sum(), 2)
_coste_validos     = inv_raw["coste_total"].dropna()
total_coste_inv    = round(_coste_validos.sum(), 2) if len(_coste_validos) > 0 else 0.0
total_ganancia_inv = round(total_inversiones - total_coste_inv, 2) if total_coste_inv > 0 else 0.0
total_rent_inv_pct = ((total_inversiones / total_coste_inv) - 1) * 100 if total_coste_inv > 0 else float("nan")
hay_rentabilidad   = total_coste_inv > 0

patrimonio_neto = round(patrimonio_liquido + total_inversiones, 2)
ratio_inv       = (total_inversiones / patrimonio_neto * 100) if patrimonio_neto != 0 else 0.0

inv_raw["pct"] = (inv_raw["importe"] / total_inversiones * 100) if total_inversiones != 0 else 0.0

inv_cat = inv_raw.dropna(subset=["importe"]).groupby("categoria")["importe"].sum().round(2).reset_index()
inv_cat = inv_cat.sort_values("importe", ascending=False).reset_index(drop=True)
inv_cat["accent"] = inv_cat["categoria"].map(CAT_COLORES_INV).fillna("#6b7280")
inv_cat = add_donut_fields(inv_cat, total_inversiones)

inv_tipo = inv_raw.dropna(subset=["importe"]).groupby("tipo")["importe"].sum().round(2).reset_index()
inv_tipo = inv_tipo.sort_values("importe", ascending=False).reset_index(drop=True)
inv_tipo["accent"] = inv_tipo["tipo"].map(TIPO_COLORES_INV).fillna("#64748b")
inv_tipo = add_donut_fields(inv_tipo, total_inversiones)

# ticker_raw para compatibilidad con funciones HTML existentes
inv_raw["ticker_raw"] = inv_raw.apply(
    lambda r: "BTC" if r["Nombre"] == "Bitcoin"
    else str(r.get("Ticker", "") or "").strip().replace("-", ""),
    axis=1
)

inv_activos = inv_raw.dropna(subset=["importe"]).sort_values("importe", ascending=False).reset_index(drop=True)

# ════════════════════════════════════════════════════
# 5) RESUMEN MENSUAL
# ════════════════════════════════════════════════════

mov_con_fecha = mov.dropna(subset=["fecha"]).copy()

ingresos_mes = (
    mov_con_fecha[
        (mov_con_fecha["tipo"] == "Ingreso") &
        ~mov_con_fecha["tipo_ingreso"].fillna("").str.contains("ajuste", case=False)
    ].copy()
)
ingresos_mes["mes"] = ingresos_mes["fecha"].apply(floor_month)
ingresos_mes = ingresos_mes.groupby("mes")["importe"].sum().round(2).reset_index()
ingresos_mes.columns = ["mes", "ingresos"]

_es_inversion = mov_con_fecha["tipo_gasto"].fillna("").str.strip().str.lower() == "inversiones"

gastos_mes = (
    mov_con_fecha[
        (mov_con_fecha["tipo"] == "Gasto") &
        ~mov_con_fecha["tipo_gasto"].fillna("").str.contains("ajuste", case=False) &
        ~_es_inversion
    ].copy()
)
gastos_mes["mes"] = gastos_mes["fecha"].apply(floor_month)
gastos_mes = gastos_mes.groupby("mes")["importe"].sum().round(2).reset_index()
gastos_mes.columns = ["mes", "gastos"]

invertido_mes = (
    mov_con_fecha[
        (mov_con_fecha["tipo"] == "Gasto") & _es_inversion
    ].copy()
)
invertido_mes["mes"] = invertido_mes["fecha"].apply(floor_month)
invertido_mes = invertido_mes.groupby("mes")["importe"].sum().round(2).reset_index()
invertido_mes.columns = ["mes", "invertido"]

resumen_mensual = (
    ingresos_mes
    .merge(gastos_mes,   on="mes", how="outer")
    .merge(invertido_mes, on="mes", how="outer")
    .fillna(0.0)
    .sort_values("mes")
    .reset_index(drop=True)
)
resumen_mensual["balance"]     = resumen_mensual["ingresos"] - resumen_mensual["gastos"]
resumen_mensual["tasa_ahorro"] = resumen_mensual.apply(
    lambda r: (r["balance"] / r["ingresos"] * 100) if r["ingresos"] > 0 else float("nan"), axis=1
)
resumen_mensual["mes_lbl"] = resumen_mensual["mes"].apply(
    lambda d: d.strftime("%b %Y").capitalize()
)

# Meses en español
MES_ES = {"Jan":"Ene","Feb":"Feb","Mar":"Mar","Apr":"Abr","May":"May","Jun":"Jun",
           "Jul":"Jul","Aug":"Ago","Sep":"Sep","Oct":"Oct","Nov":"Nov","Dec":"Dic"}
resumen_mensual["mes_lbl"] = resumen_mensual["mes_lbl"].apply(
    lambda s: MES_ES.get(s[:3], s[:3]) + s[3:]
)

def build_monthly_chart(df):
    if len(df) == 0:
        return '<svg viewBox="0 0 700 220" width="100%"><text x="350" y="110" text-anchor="middle" fill="#6b7280">Sin datos</text></svg>'
    W, H = 700, 220
    PAD_L, PAD_R, PAD_T, PAD_B = 60, 20, 20, 50
    chart_w = W - PAD_L - PAD_R
    chart_h = H - PAD_T - PAD_B
    max_val = max(df["ingresos"].max(), df["gastos"].max(), 1)
    n = len(df)
    bar_group_w = chart_w / n
    bar_w = min(bar_group_w * 0.35, 28)
    gap   = bar_group_w * 0.08

    parts = [f'<svg viewBox="0 0 {W} {H}" width="100%" style="overflow:visible;">']
    for i in range(5):
        y   = PAD_T + chart_h * i / 4
        val = max_val * (1 - i / 4)
        lbl = str(round(val))
        parts.append(
            f'<line x1="{PAD_L}" y1="{y:.1f}" x2="{W-PAD_R}" y2="{y:.1f}" stroke="#2a2d3a" stroke-width="1" stroke-dasharray="3 3"/>'
            f'<text x="{PAD_L-6}" y="{y+4:.1f}" text-anchor="end" font-size="9" fill="#6b7280">{lbl}</text>'
        )
    for i, row in df.iterrows():
        cx = PAD_L + (i + 0.5) * bar_group_w
        h_i = chart_h * row["ingresos"] / max_val
        x_i = cx - bar_w - gap / 2
        y_i = PAD_T + chart_h - h_i
        parts.append(
            f'<rect x="{x_i:.1f}" y="{y_i:.1f}" width="{bar_w:.1f}" height="{h_i:.1f}" fill="#10b981" rx="3" opacity="0.9">'
            f'<title>Ingresos {row["mes_lbl"]}: {fmt_eur(row["ingresos"])}</title></rect>'
        )
        h_g = chart_h * row["gastos"] / max_val
        x_g = cx + gap / 2
        y_g = PAD_T + chart_h - h_g
        parts.append(
            f'<rect x="{x_g:.1f}" y="{y_g:.1f}" width="{bar_w:.1f}" height="{h_g:.1f}" fill="#ef4444" rx="3" opacity="0.9">'
            f'<title>Gastos {row["mes_lbl"]}: {fmt_eur(row["gastos"])}</title></rect>'
        )
        parts.append(
            f'<text x="{cx:.1f}" y="{PAD_T+chart_h+16}" text-anchor="middle" font-size="9" fill="#6b7280">{row["mes_lbl"]}</text>'
        )
    parts.append("</svg>")
    return "".join(parts)

monthly_chart_svg = build_monthly_chart(resumen_mensual)

def tabla_mensual_html(df):
    rows = []
    for _, row in df.iterrows():
        bal_color  = "#10b981" if row["balance"] >= 0 else "#ef4444"
        signo      = "+" if row["balance"] >= 0 else ""
        tasa       = row.get("tasa_ahorro", float("nan"))
        if pd.isna(tasa):
            tasa_td = f'<td style="padding:0.75rem 1rem;border-bottom:1px solid #2a2d3a;text-align:right;color:#4b5563;">—</td>'
        else:
            ta_color = "#10b981" if tasa >= 20 else ("#f59e0b" if tasa >= 0 else "#ef4444")
            tasa_td  = (f'<td style="padding:0.75rem 1rem;border-bottom:1px solid #2a2d3a;text-align:right;">'
                        f'<span style="color:{ta_color};font-weight:700;font-size:0.88rem;">{tasa:.1f}%</span></td>')
        inv_mes = row.get("invertido", 0.0)
        inv_td = (f'<td style="padding:0.75rem 1rem;border-bottom:1px solid #2a2d3a;text-align:right;'
                  f'color:#8b5cf6;font-weight:600;">{fmt_eur(inv_mes)}</td>'
                  if inv_mes > 0 else
                  f'<td style="padding:0.75rem 1rem;border-bottom:1px solid #2a2d3a;text-align:right;'
                  f'color:#4b5563;">—</td>')
        rows.append(f"""
    <tr class="table-row">
      <td style="padding:0.75rem 1rem;border-bottom:1px solid #2a2d3a;color:#ffffff;font-weight:600;">{row["mes_lbl"]}</td>
      <td style="padding:0.75rem 1rem;border-bottom:1px solid #2a2d3a;text-align:right;color:#10b981;font-weight:600;">{fmt_eur(row["ingresos"])}</td>
      <td style="padding:0.75rem 1rem;border-bottom:1px solid #2a2d3a;text-align:right;color:#ef4444;font-weight:600;">{fmt_eur(row["gastos"])}</td>
      {inv_td}
      <td style="padding:0.75rem 1rem;border-bottom:1px solid #2a2d3a;text-align:right;color:{bal_color};font-weight:700;">{signo}{fmt_eur(row["balance"])}</td>
      {tasa_td}
    </tr>""")
    return "\n".join(rows)

# ════════════════════════════════════════════════════
# 6) GASTOS POR CATEGORÍA
# ════════════════════════════════════════════════════

gastos_df = mov_con_fecha[
    (mov_con_fecha["tipo"] == "Gasto") &
    ~mov_con_fecha["tipo_gasto"].fillna("").str.contains("ajuste", case=False) &
    ~(mov_con_fecha["tipo_gasto"].fillna("").str.strip().str.lower() == "inversiones")
].copy()

gastos_df["cat_top"] = (
    gastos_df["tipo_gasto"].fillna("Otros")
    .str.split(">").str[0].str.strip()
    .replace("", "Otros")
)

cat_gastos = gastos_df.groupby("cat_top")["importe"].sum().round(2).reset_index()
cat_gastos.columns = ["cat_top", "importe"]
cat_gastos = cat_gastos.sort_values("importe", ascending=False).reset_index(drop=True)
cat_gastos["accent"] = cat_gastos["cat_top"].apply(color_cat)
total_gastos = round(cat_gastos["importe"].sum(), 2)
cat_gastos["pct"]      = (cat_gastos["importe"] / total_gastos * 100) if total_gastos != 0 else 0.0
cat_gastos["pct_rest"] = 100.0 - cat_gastos["pct"]
cat_gastos["pct_acum"] = cat_gastos["pct"].cumsum().shift(1).fillna(0.0)
cat_gastos["rotacion"] = cat_gastos["pct_acum"] * 3.6

# ════════════════════════════════════════════════════
# 7) GENERADORES SVG / HTML
# ════════════════════════════════════════════════════

def sectors_donut(df, label_col, valor_col):
    parts = []
    for _, r in df.iterrows():
        title = f'{html_escape(str(r[label_col]))}: {fmt_eur(r[valor_col])} ({fmt_pct(r["pct"])})'
        parts.append(
            f'<circle class="sector" cx="21" cy="21" r="{R_DONUT}" fill="transparent" stroke="{r["accent"]}" stroke-width="3"'
            f' stroke-dasharray="{r["pct"]:.4f} {r["pct_rest"]:.4f}" stroke-dashoffset="25"'
            f' style="transform:rotate({r["rotacion"]:.2f}deg);transform-origin:center;">'
            f'<title>{title}</title></circle>'
        )
    return "\n".join(parts)

def legend_donut(df, label_col):
    parts = []
    for _, r in df.iterrows():
        parts.append(f"""
    <div style="display:flex;align-items:center;justify-content:space-between;gap:1.5rem;font-size:0.85rem;width:100%;max-width:260px;margin:0.2rem 0;">
      <div style="display:flex;align-items:center;gap:0.5rem;">
        <span style="width:9px;height:9px;background:{r["accent"]};border-radius:50%;flex-shrink:0;"></span>
        <span style="color:#9ca3af;font-weight:500;">{html_escape(str(r[label_col]))}</span>
      </div>
      <span style="color:#ffffff;font-weight:600;">{fmt_pct(r["pct"])}</span>
    </div>""")
    return "\n".join(parts)

def sectors_patrimonio():
    parts = []
    for _, r in saldos.iterrows():
        title = f'{html_escape(r["cuenta"])}: {fmt_eur(r["saldo"])} ({fmt_pct(r["pct"])})'
        parts.append(
            f'<circle class="sector" cx="21" cy="21" r="{R_DONUT}" fill="transparent" stroke="{r["accent"]}" stroke-width="3"'
            f' stroke-dasharray="{r["pct"]:.4f} {r["pct_rest"]:.4f}" stroke-dashoffset="25"'
            f' style="transform:rotate({r["rotacion"]:.2f}deg);transform-origin:center;">'
            f'<title>{title}</title></circle>'
        )
    return "\n".join(parts)

def legend_patrimonio():
    parts = []
    rows = list(saldos.iterrows())
    for i, (_, r) in enumerate(rows):
        cuenta_js = html_escape(r["cuenta"]).replace("'", "\\'")
        is_first = i == 0
        is_last  = i == len(rows) - 1
        # Use individual margin/padding properties to avoid overriding CSS class's
        # padding-bottom:0.8rem (the space above the border-bottom separator).
        # The shorthand `padding:` would reset all four sides and remove that spacing.
        extra = ""
        if is_first:
            extra += "margin-top:-1.25rem;padding-top:1.25rem;"
        else:
            # CSS .legend-item has padding-bottom:0.8rem but no padding-top, so
            # without this the content sticks to the top edge of its row.
            extra += "padding-top:0.8rem;"
        if is_last:
            extra += "margin-bottom:-1.25rem;padding-bottom:1.25rem;"
        br_t = "13px" if is_first else "8px"
        br_b = "13px" if is_last  else "8px"
        parts.append(f"""
<div class="legend-item" onclick="showMovimientos('{cuenta_js}')" style="cursor:pointer;transition:background 0.15s;margin-left:-1.25rem;margin-right:-1.25rem;padding-left:1.25rem;padding-right:1.25rem;{extra}border-radius:{br_t} {br_t} {br_b} {br_b};" onmouseover="this.style.background='#ffffff0d'" onmouseout="this.style.background='transparent'">
  <div style="display:flex;align-items:center;justify-content:center;width:30px;">{r["icono"]}</div>
  <div style="flex-grow:1;display:flex;flex-direction:column;justify-content:center;">
    <div style="display:flex;align-items:center;gap:0.5rem;">
      <span style="width:10px;height:10px;border-radius:50%;background:{r["accent"]};flex-shrink:0;"></span>
      <span style="color:#ffffff;font-weight:600;font-size:0.95rem;">{html_escape(r["cuenta"])}</span>
    </div>
    <span style="color:#9ca3af;font-size:0.8rem;font-weight:500;margin-left:1.15rem;">{fmt_pct(r["pct"])}</span>
  </div>
  <div style="text-align:right;color:#ffffff;font-weight:700;font-size:1.05rem;">{fmt_eur(r["saldo"])}</div>
</div>""")
    return "\n".join(parts)

def lista_cuentas_simple():
    parts = []
    for _, r in saldos.iterrows():
        cuenta_js = html_escape(r["cuenta"]).replace("'", "\\'")
        parts.append(f"""<div onclick="showMovimientos('{cuenta_js}')" style="display:flex;align-items:center;gap:1rem;padding:0.7rem 2rem;margin:0 -2rem;border-radius:0;cursor:pointer;transition:background 0.15s;border-bottom:1px solid #2a2d3a;" onmouseover="this.style.background='#ffffff08'" onmouseout="this.style.background='transparent'">
  <div style="display:flex;align-items:center;justify-content:center;width:30px;">{r["icono"]}</div>
  <div style="flex-grow:1;">
    <span style="color:#ffffff;font-weight:600;font-size:0.95rem;">{html_escape(r["cuenta"])}</span>
  </div>
  <div style="text-align:right;color:#9ca3af;font-weight:600;font-size:0.85rem;">{fmt_eur(r["saldo"])}</div>
</div>""")
    return "\n".join(parts)

def tabla_movimientos_html():
    df = mov.dropna(subset=["fecha"]).copy()
    sort_cols = ["fecha", "Marca temporal"] if "Marca temporal" in df.columns else ["fecha"]
    df = df.sort_values(sort_cols, ascending=[False] * len(sort_cols))
    TIPO_COLOR = {
        "Ingreso":  ("#10b981", "rgba(16,185,129,0.15)"),
        "Gasto":    ("#ef4444", "rgba(239,68,68,0.15)"),
        "Traspaso": ("#3b82f6", "rgba(59,130,246,0.15)"),
        "Préstamo": ("#f59e0b", "rgba(245,158,11,0.15)"),
    }
    # Compute running balances backwards from current balances
    account_running = {r["cuenta"]: float(r["saldo"]) for _, r in saldos.iterrows()}
    rows = []
    TD = "padding:0.7rem 1rem;border-bottom:1px solid #2a2d3a;"
    for _, r in df.iterrows():
        tipo = str(r.get("tipo", "—"))
        color, bg = TIPO_COLOR.get(tipo, ("#9ca3af", "rgba(156,163,175,0.15)"))
        fecha_str = r["fecha"].strftime("%d/%m/%Y") if pd.notna(r["fecha"]) else "—"
        imp = float(r["importe"]) if pd.notna(r["importe"]) else 0.0
        co = str(r.get("cuenta_origen", "")).strip()
        cd = str(r.get("cuenta_destino", "")).strip()
        co = co if co not in ("", "-", "nan") else ""
        cd = cd if cd not in ("", "-", "nan") else ""
        det_raw = r.get("detalle", "")
        det_txt = html_escape(str(det_raw)) if pd.notna(det_raw) and str(det_raw).strip() not in ("", "-") else "—"
        es_ajuste = str(r.get("tipo_gasto", "")).strip().lower() == "gasto de ajuste" or \
                    str(r.get("tipo_ingreso", "")).strip().lower() == "ingreso de ajuste"
        detalle = (f'<span style="color:#6b7280;font-size:0.78rem;font-weight:600;margin-right:0.3rem;">Ajuste:</span>{det_txt}'
                   if es_ajuste else det_txt)
        search_str = " ".join(filter(None, [
            fecha_str, tipo.lower(),
            str(det_raw).lower() if pd.notna(det_raw) else "",
            co.lower(), cd.lower(),
            str(round(imp, 2)),
        ]))
        td_fecha    = f'<td style="{TD}color:#9ca3af;font-size:0.82rem;white-space:nowrap;">{fecha_str}</td>'
        td_concepto = (f'<td style="{TD}"><div style="display:flex;align-items:center;gap:0.6rem;">'
                       f'<span style="font-size:0.73rem;font-weight:600;color:{color};background:{bg};'
                       f'padding:0.2rem 0.5rem;border-radius:4px;white-space:nowrap;flex-shrink:0;">{html_escape(tipo)}</span>'
                       f'<span style="color:#e5e7eb;font-size:0.87rem;">{detalle}</span>'
                       f'</div></td>')

        if tipo == "Traspaso" and co and cd:
            # Capture both saldos BEFORE undoing so each row shows the account balance after the transfer
            saldo_str_co = fmt_eur(account_running[co]) if co in account_running else "—"
            saldo_str_cd = fmt_eur(account_running[cd]) if cd in account_running else "—"
            if co in account_running:
                account_running[co] += imp
            if cd in account_running:
                account_running[cd] -= imp
            # Salida row: shown in origin tab and Todos (data-traspaso-dir="salida")
            rows.append(
                f'    <tr class="table-row" data-cuentas="{html_escape(co)}" data-traspaso-dir="salida" data-search="{html_escape(search_str)}">\n'
                f'      {td_fecha}\n      {td_concepto}\n'
                f'      <td style="{TD}text-align:right;color:#ef4444;font-weight:600;font-family:ui-monospace,monospace;font-size:0.88rem;white-space:nowrap;">-{fmt_eur(imp)}</td>\n'
                f'      <td style="{TD}text-align:right;color:#9ca3af;font-family:ui-monospace,monospace;font-size:0.85rem;white-space:nowrap;">{saldo_str_co}</td>\n'
                f'    </tr>'
            )
            # Entrada row: shown only in destination tab (data-traspaso-dir="entrada")
            rows.append(
                f'    <tr class="table-row" data-cuentas="{html_escape(cd)}" data-traspaso-dir="entrada" data-search="{html_escape(search_str)}">\n'
                f'      {td_fecha}\n      {td_concepto}\n'
                f'      <td style="{TD}text-align:right;color:#10b981;font-weight:600;font-family:ui-monospace,monospace;font-size:0.88rem;white-space:nowrap;">+{fmt_eur(imp)}</td>\n'
                f'      <td style="{TD}text-align:right;color:#9ca3af;font-family:ui-monospace,monospace;font-size:0.85rem;white-space:nowrap;">{saldo_str_cd}</td>\n'
                f'    </tr>'
            )
        else:
            cuentas_involucradas = "|".join(c for c in [co, cd] if c)
            primary = cd if tipo == "Ingreso" else co
            if not primary:
                primary = co if tipo == "Ingreso" else cd
            saldo_val = account_running.get(primary)
            saldo_str = fmt_eur(saldo_val) if saldo_val is not None else "—"
            # Undo this transaction to reconstruct the balance before it
            if tipo == "Gasto" and co in account_running:
                account_running[co] += imp
            elif tipo == "Ingreso" and cd in account_running:
                account_running[cd] -= imp
            elif tipo == "Préstamo":
                if co in account_running:
                    account_running[co] += imp
                if cd in account_running:
                    account_running[cd] -= imp
            if tipo == "Ingreso":
                imp_str, imp_color = f"+{fmt_eur(imp)}", "#10b981"
            elif tipo == "Gasto":
                imp_str, imp_color = f"-{fmt_eur(imp)}", "#ef4444"
            elif tipo == "Préstamo":
                tipo_prestamo = str(r.get("tipo_prestamo", "")).strip()
                if tipo_prestamo == "Devolución":
                    imp_str, imp_color = f"+{fmt_eur(imp)}", "#10b981"
                else:
                    imp_str, imp_color = f"-{fmt_eur(imp)}", "#ef4444"
            else:
                imp_str, imp_color = fmt_eur(imp), "#9ca3af"
            rows.append(
                f'    <tr class="table-row" data-cuentas="{html_escape(cuentas_involucradas)}" data-search="{html_escape(search_str)}">\n'
                f'      {td_fecha}\n      {td_concepto}\n'
                f'      <td style="{TD}text-align:right;color:{imp_color};font-weight:600;font-family:ui-monospace,monospace;font-size:0.88rem;white-space:nowrap;">{imp_str}</td>\n'
                f'      <td style="{TD}text-align:right;color:#9ca3af;font-family:ui-monospace,monospace;font-size:0.85rem;white-space:nowrap;">{saldo_str}</td>\n'
                f'    </tr>'
            )
    return "\n".join(rows)

def sectors_gastos():
    parts = []
    for _, r in cat_gastos.iterrows():
        title = f'{html_escape(r["cat_top"])}: {fmt_eur(r["importe"])} ({fmt_pct(r["pct"])})'
        parts.append(
            f'<circle class="sector" cx="21" cy="21" r="{R_DONUT}" fill="transparent" stroke="{r["accent"]}" stroke-width="3"'
            f' stroke-dasharray="{r["pct"]:.4f} {r["pct_rest"]:.4f}" stroke-dashoffset="25"'
            f' style="transform:rotate({r["rotacion"]:.2f}deg);transform-origin:center;">'
            f'<title>{title}</title></circle>'
        )
    return "\n".join(parts)

def tabla_gastos():
    rows = []
    for _, r in cat_gastos.iterrows():
        rows.append(f"""
    <tr class="table-row">
      <td style="padding:0.75rem 1rem;border-bottom:1px solid #2a2d3a;text-align:left;">
        <div style="display:flex;align-items:center;gap:0.6rem;">
          <span style="width:10px;height:10px;border-radius:50%;background:{r["accent"]};flex-shrink:0;"></span>
          <span style="color:#ffffff;font-weight:500;font-size:0.9rem;">{html_escape(r["cat_top"])}</span>
        </div>
      </td>
      <td style="padding:0.75rem 1rem;border-bottom:1px solid #2a2d3a;text-align:right;color:#ffffff;font-weight:600;font-size:0.9rem;">{fmt_eur(r["importe"])}</td>
      <td style="padding:0.75rem 1rem;border-bottom:1px solid #2a2d3a;text-align:right;color:#9ca3af;font-size:0.85rem;">{fmt_pct(r["pct"])}</td>
    </tr>""")
    return "\n".join(rows)

def tabla_activos():
    TD = "padding:0.85rem 1rem;border-bottom:1px solid #2a2d3a;"
    rows = []
    for _, r in inv_raw.sort_values("importe", ascending=False).iterrows():
        ticker = r.get("ticker_yf")
        if pd.notna(ticker) and ticker:
            elem_id = "mkt-" + re.sub(r"[^A-Za-z0-9]", "_", str(ticker))
            price_td = (f'<td id="{elem_id}" style="{TD}text-align:right;color:#f59e0b;font-weight:600;'
                        f'font-size:0.9rem;font-family:ui-monospace,monospace;" data-ticker="{ticker}">—</td>')
        else:
            price_td = f'<td style="{TD}text-align:right;color:#4b5563;font-size:0.85rem;">N/D</td>'
        coste_val  = r.get("coste_total")
        ganancia   = r.get("ganancia")
        rent_pct   = r.get("rent_pct")
        cagr_val   = r.get("cagr")
        has_coste  = pd.notna(coste_val) and coste_val > 0
        if has_coste:
            g_color = "#10b981" if ganancia >= 0 else "#ef4444"
            g_signo = "+" if ganancia >= 0 else ""
            coste_td = f'<td style="{TD}text-align:right;color:#9ca3af;font-size:0.88rem;font-family:ui-monospace,monospace;">{fmt_eur(coste_val)}</td>'
            rent_td  = (f'<td style="{TD}text-align:right;">'
                        f'<div style="color:{g_color};font-weight:600;font-size:0.88rem;">{g_signo}{fmt_eur(ganancia)}</div>'
                        f'<div style="color:{g_color};font-size:0.75rem;opacity:0.85;">{g_signo}{rent_pct:.2f}%'
                        + (f' · CAGR {cagr_val:.1f}%' if pd.notna(cagr_val) else '') +
                        f'</div></td>')
        else:
            coste_td = f'<td style="{TD}text-align:right;color:#4b5563;font-size:0.85rem;">—</td>'
            rent_td  = f'<td style="{TD}text-align:right;color:#4b5563;font-size:0.85rem;">—</td>'
        _pf = str(r.get("precio_fuente", "live"))
        if _pf.startswith("cache:"):
            _cd = datetime.strptime(_pf.split(":", 1)[1], "%Y-%m-%d").strftime("%d/%m/%Y")
            _val_td = (f'<td style="{TD}text-align:right;" title="Precio del {_cd} (Yahoo no disponible)">'
                       f'<span style="color:#f59e0b;font-weight:600;font-size:0.9rem;">{fmt_eur(r["importe"])}</span>'
                       f'<span style="display:block;font-size:0.68rem;color:#f59e0b;opacity:0.7;">≈ {_cd}</span>'
                       f'</td>')
        else:
            _val_td = f'<td style="{TD}text-align:right;color:#ffffff;font-weight:600;font-size:0.9rem;">{fmt_eur(r["importe"])}</td>'
        rows.append(
            f'<tr class="table-row">'
            f'<td style="{TD}text-align:left;">'
            f'<div style="font-weight:600;color:#ffffff;font-size:0.9rem;">{html_escape(str(r["Nombre"]))}</div>'
            f'<div style="font-size:0.75rem;color:#6b7280;margin-top:0.15rem;">{html_escape(str(r["tipo"]))}</div>'
            f'</td>'
            f'<td style="{TD}text-align:left;color:#9ca3af;font-size:0.85rem;font-family:ui-monospace,monospace;">{html_escape(str(r["ISIN"]))}</td>'
            f'{_val_td}'
            f'{coste_td}{rent_td}'
            f'<td style="{TD}text-align:right;color:#3b82f6;font-weight:600;font-size:0.9rem;">{fmt_pct(r["pct"])}</td>'
            f'{price_td}'
            f'</tr>'
        )
    return "\n".join(rows)

def tabla_aportaciones():
    if len(inv_apor) == 0:
        return '<tr><td colspan="6" style="padding:1.5rem;text-align:center;color:#6b7280;">Sin aportaciones registradas</td></tr>'
    TIPO_COLOR = {
        "ETF": "#8b5cf6", "Acciones": "#ec4899",
        "Criptoactivo": "#f59e0b", "Fondo de inversión": "#14b8a6",
    }
    TD = "padding:0.7rem 1rem;border-bottom:1px solid #2a2d3a;"
    df = inv_apor.copy()
    if "_fecha" in df.columns:
        df = df.sort_values("_fecha", ascending=False)
    rows = []
    for _, r in df.iterrows():
        nombre   = str(r.get("Nombre", "—"))
        tipo     = str(r.get("tipo", "—"))
        banco    = str(r.get("Banco", "—"))
        coste    = r["_coste_n"]
        fecha_v  = r.get("_fecha")
        fecha_s  = fecha_v.strftime("%d/%m/%Y") if pd.notna(fecha_v) else str(r.get("fecha", "—"))
        unidades = r.get("_unidades_n", float("nan"))
        has_u    = pd.notna(unidades) and unidades > 0
        tipo_color = TIPO_COLOR.get(tipo, "#6b7280")
        tipo_chip  = (f'<span style="font-size:0.68rem;font-weight:600;color:{tipo_color};'
                      f'background:{tipo_color}22;padding:0.15rem 0.45rem;border-radius:4px;'
                      f'margin-top:0.2rem;display:inline-block;">{html_escape(tipo)}</span>')
        if has_u:
            unidades_td = f'<td style="{TD}text-align:right;color:#e5e7eb;font-size:0.85rem;font-family:ui-monospace,monospace;">{unidades:g}</td>'
            precio_td   = f'<td style="{TD}text-align:right;color:#9ca3af;font-size:0.85rem;font-family:ui-monospace,monospace;">{fmt_eur(coste / unidades)}</td>'
        else:
            unidades_td = f'<td style="{TD}text-align:right;color:#4b5563;font-size:0.85rem;">—</td>'
            precio_td   = f'<td style="{TD}text-align:right;color:#4b5563;font-size:0.85rem;">—</td>'
        rows.append(
            f'<tr class="table-row">'
            f'<td style="{TD}text-align:left;color:#9ca3af;font-size:0.82rem;font-family:ui-monospace,monospace;white-space:nowrap;">{fecha_s}</td>'
            f'<td style="{TD}text-align:left;">'
            f'<div style="font-weight:600;color:#ffffff;font-size:0.88rem;">{html_escape(nombre)}</div>'
            f'{tipo_chip}</td>'
            f'<td style="{TD}text-align:left;color:#6b7280;font-size:0.82rem;">{html_escape(banco)}</td>'
            f'<td style="{TD}text-align:right;color:#ffffff;font-weight:600;font-size:0.9rem;font-family:ui-monospace,monospace;">{fmt_eur(coste)}</td>'
            f'{unidades_td}{precio_td}'
            f'</tr>'
        )
    return "\n".join(rows)

def tarjetas_activos_html():
    TIPO_SLUG = {
        "ETF":                "etf",
        "Acciones":           "acciones",
        "Criptoactivo":       "cripto",
        "Fondo de inversión": "fondo",
    }
    TIPO_CONF = {
        "ETF":                ("#8b5cf6", "rgba(139,92,246,0.15)"),
        "Acciones":           ("#ec4899", "rgba(236,72,153,0.15)"),
        "Criptoactivo":       ("#f59e0b", "rgba(245,158,11,0.15)"),
        "Fondo de inversión": ("#14b8a6", "rgba(20,184,166,0.15)"),
    }
    CAT_CONF = {
        "Renta variable": ("#3b82f6", "rgba(59,130,246,0.12)"),
        "Renta fija":     ("#10b981", "rgba(16,185,129,0.12)"),
    }
    cards = []
    for _, r in inv_raw.sort_values("importe", ascending=False).iterrows():
        tipo     = str(r.get("tipo", "—")).strip()
        nombre   = str(r["Nombre"]).strip()
        isin_val = str(r["ISIN"]).strip()
        if isin_val in ("-", "", "nan"):
            isin_val = "—"
        banco    = str(r.get("Banco", "—")).strip()
        cat      = str(r.get("categoria", "—")).strip()
        importe  = float(r["importe"])
        pct      = (importe / total_inversiones * 100) if total_inversiones > 0 else 0.0
        tcolor, tbg = TIPO_CONF.get(tipo, ("#6b7280", "rgba(107,114,128,0.15)"))
        ccolor, cbg = CAT_CONF.get(cat, ("#6b7280", "rgba(107,114,128,0.12)"))
        slug     = TIPO_SLUG.get(tipo, re.sub(r"[^a-z0-9]", "-", tipo.lower()))
        ticker_r = str(r.get("ticker_raw", "")).strip()
        if ticker_r and ticker_r not in ("-", "", "nan"):
            lbl = ticker_r[:4].upper()
        else:
            words = nombre.split()
            lbl = "".join(w[0] for w in words if w and w[0].isalpha())[:3].upper()
        coste_val = r.get("coste_total")
        ganancia  = r.get("ganancia")
        rent_pct  = r.get("rent_pct")
        cagr_val  = r.get("cagr")
        has_coste = pd.notna(coste_val) and float(coste_val) > 0
        _pfc = str(r.get("precio_fuente", "live"))
        if _pfc.startswith("cache:"):
            _cdc = datetime.strptime(_pfc.split(":", 1)[1], "%Y-%m-%d").strftime("%d/%m/%Y")
            _cache_badge = (f'<span title="Precio del {_cdc} (Yahoo no disponible)" '
                            f'style="font-size:0.65rem;color:#f59e0b;background:rgba(245,158,11,0.15);'
                            f'padding:0.1rem 0.4rem;border-radius:3px;font-weight:600;margin-left:0.4rem;">≈ {_cdc}</span>')
        else:
            _cache_badge = ""
        if has_coste:
            g_color  = "#10b981" if float(ganancia) >= 0 else "#ef4444"
            g_signo  = "+" if float(ganancia) >= 0 else ""
            cagr_txt = f" · CAGR {cagr_val:.1f}%" if pd.notna(cagr_val) else ""
            rent_html = (
                f'  <div style="border-top:1px solid #2a2d3a;padding-top:0.6rem;margin-top:0.6rem;'
                f'display:flex;justify-content:space-between;align-items:center;">\n'
                f'    <span style="color:#6b7280;font-size:0.72rem;">Invertido: {fmt_eur(float(coste_val))}</span>\n'
                f'    <span style="color:{g_color};font-weight:700;font-size:0.82rem;">'
                f'{g_signo}{fmt_eur(float(ganancia))} ({g_signo}{float(rent_pct):.2f}%{cagr_txt})</span>\n'
                f'  </div>\n'
            )
        else:
            rent_html = ""
        search_str = f"{nombre.lower()} {isin_val.lower()} {banco.lower()} {tipo.lower()}"
        cards.append(
            f'<div class="asset-card" data-tipo="{slug}" data-search="{html_escape(search_str)}"'
            f' style="background:#1a1d27;border:1px solid #2a2d3a;border-radius:16px;padding:1.25rem 1.5rem;'
            f'transition:border-color 0.2s,box-shadow 0.2s;"'
            f' onmouseover="this.style.borderColor=\'#3b4257\';this.style.boxShadow=\'0 4px 20px rgba(0,0,0,0.4)\'"'
            f' onmouseout="this.style.borderColor=\'#2a2d3a\';this.style.boxShadow=\'none\'">\n'
            f'  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.75rem;margin-bottom:0.9rem;">\n'
            f'    <div style="display:flex;align-items:center;gap:0.75rem;min-width:0;">\n'
            f'      <div style="width:44px;height:44px;border-radius:10px;background:{tbg};border:1px solid {tcolor}40;'
            f'display:flex;align-items:center;justify-content:center;font-size:0.72rem;font-weight:800;'
            f'color:{tcolor};font-family:ui-monospace,monospace;flex-shrink:0;">{html_escape(lbl)}</div>\n'
            f'      <div style="min-width:0;">\n'
            f'        <div style="color:#ffffff;font-weight:700;font-size:0.92rem;line-height:1.3;">{html_escape(nombre)}</div>\n'
            f'        <div style="color:#6b7280;font-size:0.75rem;margin-top:0.1rem;">{html_escape(banco)}</div>\n'
            f'      </div>\n'
            f'    </div>\n'
            f'    <span style="font-size:0.7rem;font-weight:700;color:{tcolor};background:{tbg};'
            f'padding:0.2rem 0.65rem;border-radius:20px;white-space:nowrap;flex-shrink:0;'
            f'border:1px solid {tcolor}35;">{html_escape(tipo)}</span>\n'
            f'  </div>\n'
            f'  <div style="margin-bottom:0.9rem;">\n'
            f'    <span style="font-size:0.72rem;color:{ccolor};background:{cbg};'
            f'padding:0.2rem 0.5rem;border-radius:4px;font-weight:600;">{html_escape(cat)}</span>\n'
            f'  </div>\n'
            f'  <div style="border-top:1px solid #2a2d3a;padding-top:0.75rem;'
            f'display:flex;justify-content:space-between;align-items:flex-end;gap:0.5rem;">\n'
            f'    <span style="color:#4b5563;font-size:0.72rem;font-family:ui-monospace,monospace;'
            f'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">{html_escape(isin_val)}</span>\n'
            f'    <div style="text-align:right;flex-shrink:0;">\n'
            f'      <div style="color:#ffffff;font-weight:700;font-size:0.92rem;">{fmt_eur(importe)}{_cache_badge}</div>\n'
            f'      <div style="color:#3b82f6;font-size:0.72rem;font-weight:600;margin-top:0.1rem;">{fmt_pct(pct)} portafolio</div>\n'
            f'    </div>\n'
            f'  </div>\n'
            f'{rent_html}'
            f'</div>'
        )
    return "\n".join(cards)

# ════════════════════════════════════════════════════
# 8) ESCRIBIR HTML
# ════════════════════════════════════════════════════

pf_hist_parts, pf_intra_parts, pf_cur_parts = [], [], []
latest_prices, ticker_currency_map = {}, {}
_raw_pf_hist = {}
for asset in PORTFOLIO_ASSETS:
    hist  = fetch_daily_history(asset["ticker"])
    intra = fetch_intraday(asset["ticker"])
    _raw_pf_hist[asset["ticker"]] = hist
    n     = asset["nombre"]
    hist_js  = "[" + ",".join(f"[{p[0]},{p[1]}]" for p in hist)  + "]" if hist  else "[]"
    intra_js = "[" + ",".join(f"[{p[0]},{p[1]}]" for p in intra) + "]" if intra else "[]"
    pf_hist_parts.append(f'"{n}":{hist_js}')
    pf_intra_parts.append(f'"{n}":{intra_js}')
    pf_cur_parts.append(f'"{n}":"{asset["moneda"]}"')
    lbl = f"{datetime.fromtimestamp(hist[0][0]/1000).strftime('%d/%m/%Y')} — {datetime.fromtimestamp(hist[-1][0]/1000).strftime('%d/%m/%Y')}" if hist else "sin datos"
    print(f"   {n}: {len(hist)} puntos  {lbl}")
    ticker = asset["ticker"]
    if ticker != "BTC-EUR":
        last_price = intra[-1][1] if intra else (hist[-1][1] if hist else None)
        if last_price is not None:
            latest_prices[ticker] = last_price
        ticker_currency_map[ticker] = "€" if asset["moneda"] == "EUR" else "$"
portfolio_history_js  = "{" + ",".join(pf_hist_parts)  + "}"
portfolio_intraday_js = "{" + ",".join(pf_intra_parts) + "}"
portfolio_currency_js = "{" + ",".join(pf_cur_parts)   + "}"
latest_prices_js    = json.dumps(latest_prices)
ticker_currency_js  = json.dumps(ticker_currency_map)
saldos_cuentas_js   = json.dumps({r["cuenta"]: round(r["saldo"], 2) for _, r in saldos.iterrows()})
build_ts = int(datetime.now().timestamp())

# ── Patrimonio neto histórico (líquido + inversiones) ──────────────────────
# Precio EUR por fecha para cada ticker
_tdp = {}  # {ticker: ([dates], [prices_eur])}
for _pa in PORTFOLIO_ASSETS:
    _tk, _mon = _pa["ticker"], _pa["moneda"]
    _ds, _ps = [], []
    for _ts2, _p in _raw_pf_hist.get(_tk, []):
        _ds.append(datetime.fromtimestamp(_ts2 / 1000).date())
        _ps.append(_p * _FX_EUR.get("USD", 0.926) if _mon == "USD" else _p)
    _tdp[_tk] = (_ds, _ps)

# Unidades acumuladas por jk y fecha
_utl = {}  # {jk: ([dates], [cum_units])}
if len(inv_apor) > 0:
    for _jk2, _grp2 in inv_apor.groupby("_jk"):
        _g2 = _grp2.sort_values("_fecha").dropna(subset=["_fecha"])
        _cd2, _cu2, _run2 = [], [], 0.0
        for _, _r2 in _g2.iterrows():
            _u2 = _r2.get("_unidades_n", 0)
            _run2 += (_u2 if not (isinstance(_u2, float) and math.isnan(_u2)) else 0)
            _cd2.append(_r2["_fecha"].date())
            _cu2.append(_run2)
        _utl[_jk2] = (_cd2, _cu2)

_yft2jk = {a["yf_ticker"]: _jk_v(a["Nombre"], a["ISIN"])
           for a in ACTIVOS_CONFIG if a.get("yf_ticker")}
_bankinter_fix = sum(float(a.get("valor_manual", 0) or 0)
                     for a in ACTIVOS_CONFIG if not a.get("yf_ticker"))

def _inv_en(d):
    total = _bankinter_fix
    for _pa2 in PORTFOLIO_ASSETS:
        _tk2 = _pa2["ticker"]
        _jk3 = _yft2jk.get(_tk2)
        if not _jk3:
            continue
        _tld, _tlu = _utl.get(_jk3, ([], []))
        _units2 = 0.0
        for _i2 in range(len(_tld) - 1, -1, -1):
            if _tld[_i2] <= d:
                _units2 = _tlu[_i2]
                break
        if _units2 <= 0:
            continue
        _dpd, _dpp = _tdp.get(_tk2, ([], []))
        for _i3 in range(len(_dpd) - 1, -1, -1):
            if _dpd[_i3] <= d:
                total += _units2 * _dpp[_i3]
                break
    return total

if n_puntos > 0:
    _neto_vals = [round(row["patrimonio_acum"] + _inv_en(row["fecha"]), 2)
                  for _, row in evo.iterrows()]
    # ── Benchmark: ¿qué pasaría si todo hubiera ido a MSCI World? ──
    _msci_dpd, _msci_dpp = _tdp.get("IWDA.AS", ([], []))
    def _msci_p(d):
        for _i in range(len(_msci_dpd)-1, -1, -1):
            if _msci_dpd[_i] <= d: return _msci_dpp[_i]
        return None

    _bench_vals = []
    for _, _er in evo.iterrows():
        _bv = _bankinter_fix
        for _, _ar in inv_apor.iterrows():
            _afd = _ar.get("_fecha")
            if pd.isna(_afd) or _afd.date() > _er["fecha"]: continue
            _ac = _ar.get("_coste_n", 0)
            if not _ac or math.isnan(_ac): continue
            if str(_ar.get("Banco", "")).strip() == "Bankinter": continue
            _pb = _msci_p(_afd.date()); _pn = _msci_p(_er["fecha"])
            _bv += _ac * (_pn / _pb) if (_pb and _pb > 0 and _pn) else _ac
        _bench_vals.append(round(_bv + _er["patrimonio_acum"], 2))

    # Benchmark stats
    _bench_inv_fin  = _bench_vals[-1] - evo["patrimonio_acum"].iloc[-1]
    bench_rent_pct  = ((_bench_inv_fin / total_coste_inv) - 1) * 100 if total_coste_inv > 0 else float("nan")
    diff_vs_bench   = total_rent_inv_pct - bench_rent_pct if not math.isnan(bench_rent_pct) else float("nan")
    bench_valor     = round(_bench_inv_fin, 2)
    bench_signo     = "+" if bench_rent_pct >= 0 else ""
    diff_signo      = "+" if diff_vs_bench >= 0 else ""
    diff_color      = "#10b981" if diff_vs_bench >= 0 else "#ef4444"

    # Y-axis escala combinada (neto + benchmark)
    _all_vals = _neto_vals + _bench_vals
    _neto_min  = min(_all_vals)
    _neto_max  = max(_all_vals)
    _neto_rng  = (_neto_max - _neto_min) if _neto_max != _neto_min else 1.0
    _neto_y    = [260 - (v - _neto_min) / _neto_rng * 220 for v in _neto_vals]
    _bench_y   = [260 - (v - _neto_min) / _neto_rng * 220 for v in _bench_vals]

    _xs = evo["x_svg"].tolist()
    _neto_pts_svg = [f"M {_xs[0]:.2f} {_neto_y[0]:.2f}"] + \
                    [f"L {_xs[i]:.2f} {_neto_y[i]:.2f}" for i in range(1, len(_neto_vals))]
    neto_path_d = " ".join(_neto_pts_svg)
    neto_area_d = f"{neto_path_d} L {_xs[-1]:.2f} 280 L {_xs[0]:.2f} 280 Z"
    bench_path_d = " ".join(
        [f"M {_xs[0]:.2f} {_bench_y[0]:.2f}"] +
        [f"L {_xs[i]:.2f} {_bench_y[i]:.2f}" for i in range(1, len(_bench_vals))]
    )

    neto_diff   = _neto_vals[-1] - _neto_vals[0]
    neto_signo  = "+" if neto_diff >= 0 else ""
    neto_color  = "#10b981" if neto_diff >= 0 else "#ef4444"
    neto_bg     = "rgba(16,185,129,0.15)" if neto_diff >= 0 else "rgba(239,68,68,0.15)"
    neto_pct    = (neto_diff / abs(_neto_vals[0]) * 100) if _neto_vals[0] != 0 else 0.0
    fmt_neto_rend = f"{neto_signo}{fmt_eur(neto_diff)} ({neto_signo}{fmt_pct(neto_pct)})"

    _ny_parts = []
    for _ni in range(5):
        _nf = _ni / 4
        _nv = _neto_min + (_neto_max - _neto_min) * _nf
        _nyp = 260 - _nf * 220
        _nlbl = (f"{_nv/1000:.1f}".replace(".", ",") + "k") if abs(_nv) >= 1000 else str(round(_nv))
        _ny_parts.append(
            f'<line x1="70" y1="{_nyp:.1f}" x2="980" y2="{_nyp:.1f}" stroke="#2a2d3a" stroke-width="1" stroke-dasharray="3 3"/>'
            f'<text x="984" y="{_nyp+4:.1f}" text-anchor="start" font-size="10" fill="#6b7280">{_nlbl}</text>'
        )
    neto_y_axis_svg = "\n".join(_ny_parts)

    _neto_js = []
    for _ni2, (_, _erow2) in enumerate(evo.iterrows()):
        _nts = int(datetime(_erow2["fecha"].year, _erow2["fecha"].month, _erow2["fecha"].day).timestamp() * 1000)
        _nv2 = _neto_vals[_ni2]
        _neto_js.append(
            f'{{t:{_nts},v:{_nv2:.2f},f:\'{_erow2["fecha"].strftime("%d/%m/%Y")}\','
            f'vf:\'{fmt_eur(_nv2).replace(" €","")}\',x:{_xs[_ni2]:.2f},y:{_neto_y[_ni2]:.2f}}}'
        )
    neto_hist_js = "[" + ",".join(_neto_js) + "]"
else:
    neto_path_d = "M 70 120 L 980 120"
    neto_area_d = "M 70 120 L 980 120 L 980 280 L 70 280 Z"
    bench_path_d = "M 70 120 L 980 120"
    neto_y_axis_svg = ""
    neto_color = "#10b981"; neto_bg = "rgba(16,185,129,0.15)"
    fmt_neto_rend = "0,00 € (0,00%)"
    neto_hist_js = "[]"
    bench_rent_pct = float("nan"); diff_vs_bench = float("nan")
    bench_valor = 0.0; bench_signo = "+"; diff_signo = "+"; diff_color = "#6b7280"

portfolio_options = "\n".join(
    f'            <option value="{a["nombre"]}">{a["nombre"]}</option>'
    for a in PORTFOLIO_ASSETS
)

msci_history = fetch_msci_history()
if msci_history:
    msci_history_js = "[" + ",".join(f"[{p[0]},{p[1]}]" for p in msci_history) + "]"
    print(f"   MSCI histórico:      {len(msci_history)} puntos ({datetime.fromtimestamp(msci_history[0][0]/1000).strftime('%d/%m/%Y')} — {datetime.fromtimestamp(msci_history[-1][0]/1000).strftime('%d/%m/%Y')})")
else:
    msci_history_js = "[]"
    print("   MSCI histórico:      no disponible")

msci_intraday = fetch_msci_intraday()
if msci_intraday:
    msci_intraday_js = "[" + ",".join(f"[{p[0]},{p[1]}]" for p in msci_intraday) + "]"
    print(f"   MSCI intraday:       {len(msci_intraday)} puntos")
else:
    msci_intraday_js = "[]"
    print("   MSCI intraday:       no disponible")

btc_max_points = fetch_btc_history_max()
if btc_max_points:
    btc_max_data_js = "[" + ",".join(f"[{p[0]},{p[1]}]" for p in btc_max_points) + "]"
    print(f"   BTC histórico MAX:   {len(btc_max_points)} puntos ({datetime.fromtimestamp(btc_max_points[0][0]/1000).strftime('%d/%m/%Y')} — {datetime.fromtimestamp(btc_max_points[-1][0]/1000).strftime('%d/%m/%Y')})")
else:
    btc_max_data_js = "[]"
    print("   BTC histórico MAX:   no disponible (se usarán los 365d de CoinGecko)")

_mov_html = tabla_movimientos_html()

html_out = f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Solvento</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>💰</text></svg>">
  <link rel="stylesheet" href="src/css/base.css">
  <link rel="stylesheet" href="src/css/layout.css">
  <link rel="stylesheet" href="src/css/components.css">
</head>
<body>
<nav class="navbar">
  <div class="navbar-brand">
    <h1>💰 Solvento</h1>
    <span class="navbar-date">versión 2.1 · Precios del {fecha_actualizacion}</span>
  </div>
  <select class="nav-select" onchange="showPage(this.value)" aria-label="Sección">
    <option value="patrimonio">Patrimonio</option>
    <option value="cuentas">Cashflow</option>
    <option value="movimientos">Movimientos</option>
    <option value="inversiones">Inversiones</option>
    <option value="explorar">Explorar</option>
  </select>
</nav>

<!-- ══ PÁGINA 1: PATRIMONIO ══ -->
<div class="page active" id="page-patrimonio">
  <div class="hero-card" style="margin-top:1.5rem;">
    <div class="hero-main">
      <span class="hero-label">Patrimonio</span>
      <span class="hero-value">{fmt_eur(patrimonio_neto)}</span>
    </div>
    <div class="hero-breakdown">
      <div class="hero-item">
        <span class="hero-item-label">Líquido</span>
        <span class="hero-item-value">{fmt_eur(patrimonio_liquido)}</span>
      </div>
      <div class="hero-item">
        <span class="hero-item-label">Inversiones</span>
        <span class="hero-item-value">{fmt_eur(total_inversiones)}</span>
      </div>
      <div class="hero-item">
        <span class="hero-item-label">Ratio inv/total</span>
        <span class="hero-item-value">{fmt_pct(ratio_inv)}</span>
      </div>
    </div>
  </div>
  <!-- ══ GRÁFICO PATRIMONIO NETO TOTAL ══ -->
  <div style="max-width:1400px;margin:2rem auto 0;width:100%;">
    <div class="dashboard-panel">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1.5rem;flex-wrap:wrap;gap:1rem;">
        <div>
          <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;margin-bottom:0.5rem;">Evolución del patrimonio neto</div>
          <div style="display:flex;align-items:center;gap:0.8rem;min-height:38px;">
            <div id="neto-rend-display" style="font-size:1.05rem;font-weight:600;color:{neto_color};background:{neto_bg};padding:0.3rem 0.7rem;border-radius:6px;display:inline-block;">{fmt_neto_rend}</div>
            <div style="display:flex;align-items:center;gap:0.4rem;font-size:0.78rem;color:#6b7280;"><span style="display:inline-block;width:18px;height:2px;background:#6b7280;border-top:2px dashed #6b7280;"></span>MSCI World</div>
            <div id="neto-valor-display" style="font-size:1.5rem;font-weight:700;color:#fff;letter-spacing:-0.02em;display:none;"></div>
          </div>
        </div>
        <div style="text-align:right;">
          <div id="neto-date-display" style="font-size:0.82rem;color:#6b7280;font-weight:500;">Desde el inicio ({fecha_ini_lbl})</div>
        </div>
      </div>
      <div style="position:relative;width:100%;flex-grow:1;min-height:220px;">
        <svg id="neto-svg-chart" viewBox="0 0 1000 300" width="100%" height="100%" preserveAspectRatio="none" style="overflow:visible;cursor:crosshair;">
          <defs>
            <linearGradient id="neto-area-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="{neto_color}" stop-opacity="0.2"/>
              <stop offset="100%" stop-color="{neto_color}" stop-opacity="0.0"/>
            </linearGradient>
          </defs>
          <g id="neto-chart-axes">{neto_y_axis_svg}{x_axis_svg}</g>
          <line x1="70" y1="280" x2="980" y2="280" stroke="#2a2d3a" stroke-width="1" stroke-dasharray="4 4"/>
          <path id="neto-chart-area" d="{neto_area_d}" fill="url(#neto-area-grad)"/>
          <path id="bench-chart-line" d="{bench_path_d}" fill="none" stroke="#6b7280" stroke-width="1.8" stroke-dasharray="6 4" stroke-linecap="round" stroke-linejoin="round" opacity="0.7"/>
          <path id="neto-chart-line" d="{neto_path_d}" fill="none" stroke="{neto_color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          <line id="neto-v-line" x1="0" y1="20" x2="0" y2="280" stroke="#4b5563" stroke-width="1" stroke-dasharray="3 3" style="display:none;"/>
        </svg>
        <div id="neto-dot" style="position:absolute;width:10px;height:10px;border-radius:50%;background:{neto_color};border:2px solid #1a1d27;transform:translate(-50%,-50%);pointer-events:none;display:none;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:0.75rem;font-size:0.75rem;color:#4b5563;font-weight:500;padding:0 0.5rem;">
        <span>{fecha_ini_lbl}</span><span>{fecha_fin_lbl}</span>
      </div>
    </div>
  </div>

  <div style="max-width:1400px;margin:2rem auto 0;width:100%;">
    <div class="dashboard-panel" style="padding:1.5rem 2rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;">
        <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Cashflow</div>
        <div style="font-size:1.25rem;color:#ffffff;font-weight:700;letter-spacing:-0.01em;">{fmt_eur(patrimonio_liquido)}</div>
      </div>
      <div class="legend-box" style="border:none;padding:0;background:transparent;gap:0;">{lista_cuentas_simple()}</div>
      <div style="text-align:right;padding-top:0.75rem;">
        <button onclick="showPage('movimientos')" style="background:none;border:none;color:#6b7280;font-size:0.82rem;cursor:pointer;padding:0;transition:color 0.15s;" onmouseover="this.style.color='#e5e7eb'" onmouseout="this.style.color='#6b7280'">Ver todos los movimientos →</button>
      </div>
    </div>
  </div>
  <div class="table-container">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
      <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Inversiones</div>
      <div style="font-size:1.25rem;color:#ffffff;font-weight:700;letter-spacing:-0.01em;">{fmt_eur(total_inversiones)}</div>
    </div>
    <table class="minimal-table">
      <thead><tr>
        <th style="text-align:left;">Activo</th>
        <th style="text-align:left;">ISIN</th>
        <th style="text-align:right;">Valor actual</th>
        <th style="text-align:right;">Invertido</th>
        <th style="text-align:right;">Rentabilidad</th>
        <th style="text-align:right;">Peso</th>
        <th style="text-align:right;">Mercado</th>
      </tr></thead>
      <tbody>{tabla_activos()}</tbody>
    </table>
  </div>
</div>

<!-- ══ PÁGINA 1b: MOVIMIENTOS ══ -->
<div class="page" id="page-movimientos">
  <div class="header-block" style="margin-top:1.5rem;">
    <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap;">
      <button onclick="showPage('patrimonio')" style="background:none;border:none;color:#6b7280;font-size:0.85rem;cursor:pointer;padding:0;transition:color 0.15s;" onmouseover="this.style.color='#e5e7eb'" onmouseout="this.style.color='#6b7280'">← Volver</button>
      <h2 class="section-title" style="margin:0;">Movimientos</h2>
      <div id="mov-filter-badge" style="display:none;align-items:center;gap:0.4rem;background:#2a2d3a;border:1px solid #4b5563;border-radius:20px;padding:0.25rem 0.6rem 0.25rem 0.75rem;font-size:0.78rem;color:#e5e7eb;">
        <span id="mov-filter-label"></span>
        <span id="mov-filter-saldo" style="color:#9ca3af;font-weight:700;"></span>
        <button onclick="showMovimientos(null)" style="background:none;border:none;color:#9ca3af;cursor:pointer;padding:0;line-height:1;font-size:1rem;" title="Limpiar filtro">×</button>
      </div>
    </div>
  </div>
  <div style="max-width:1400px;margin:1.5rem auto 0;width:100%;">
    <div style="margin-bottom:1rem;">
      <input id="mov-search" type="search" placeholder="Buscar movimientos…" oninput="movFiltrar()"
        style="width:100%;max-width:400px;background:#1e2130;border:1px solid #3b4054;border-radius:8px;color:#e5e7eb;font-size:0.85rem;padding:0.5rem 0.85rem;outline:none;font-family:inherit;"
        onfocus="this.style.borderColor='#6b7280'" onblur="this.style.borderColor='#3b4054'">
    </div>
    <div class="dashboard-panel" style="padding:1.5rem 2rem;">
      <table class="minimal-table">
        <thead><tr>
          <th style="text-align:left;">Fecha</th>
          <th style="text-align:left;">Concepto</th>
          <th style="text-align:right;">Importe</th>
          <th style="text-align:right;">Saldo</th>
        </tr></thead>
        <tbody id="mov-tbody">{_mov_html}</tbody>
      </table>
      <p id="mov-empty" style="display:none;text-align:center;color:#6b7280;padding:2rem 0;font-size:0.85rem;">Sin resultados</p>
    </div>
  </div>
</div>

<!-- ══ PÁGINA 2: CUENTAS ══ -->
<div class="page" id="page-cuentas">
  <div class="header-block">
    <h2 class="section-title">Patrimonio líquido</h2>
    <div class="section-subtitle">{fmt_eur(patrimonio_liquido)}</div>
  </div>
  <div class="dashboard-main-grid">
    <div class="dashboard-panel">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1.5rem;flex-wrap:wrap;gap:1rem;">
        <div>
          <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;margin-bottom:0.5rem;">Evolución del balance</div>
          <div style="display:flex;align-items:center;gap:0.8rem;min-height:38px;">
            <div id="evo-rendimiento-display" style="font-size:1.05rem;font-weight:600;color:{color_trend};background:{color_bg_grad};padding:0.3rem 0.7rem;border-radius:6px;display:inline-block;">{fmt_rend}</div>
            <div id="evo-valor-display" style="font-size:1.5rem;font-weight:700;color:#fff;letter-spacing:-0.02em;display:none;"></div>
          </div>
        </div>
        <div style="text-align:right;">
          <div id="evo-date-display" style="font-size:0.82rem;color:#6b7280;font-weight:500;">Desde el inicio ({fecha_ini_lbl})</div>
        </div>
      </div>
      <div class="timeframe-selector">
        <button class="tf-btn" data-period="1D">1D</button>
        <button class="tf-btn" data-period="1W">1W</button>
        <button class="tf-btn" data-period="1M">1M</button>
        <button class="tf-btn" data-period="YTD">1YTD</button>
        <button class="tf-btn" data-period="1Y">1Y</button>
        <button class="tf-btn active" data-period="MAX">MAX</button>
      </div>
      <div style="position:relative;width:100%;flex-grow:1;min-height:220px;">
        <svg id="patrimonio-svg-chart" viewBox="0 0 1000 300" width="100%" height="100%" preserveAspectRatio="none" style="overflow:visible;cursor:crosshair;">
          <defs>
            <linearGradient id="chart-area-grad" x1="0" y1="0" x2="0" y2="1">
              <stop id="chart-area-grad-stop0" offset="0%" stop-color="{color_trend}" stop-opacity="0.25"/>
              <stop id="chart-area-grad-stop1" offset="100%" stop-color="{color_trend}" stop-opacity="0.0"/>
            </linearGradient>
          </defs>
          <g id="chart-axes">
            {y_axis_svg}
            {x_axis_svg}
          </g>
          <line x1="70" y1="280" x2="980" y2="280" stroke="#2a2d3a" stroke-width="1" stroke-dasharray="4 4"/>
          <line id="evo-ref-line" x1="70" y1="{evo_ref_y}" x2="980" y2="{evo_ref_y}" stroke="#4b5563" stroke-width="1.5" stroke-dasharray="6 4"/>
          <path id="chart-area" d="{path_area}" fill="url(#chart-area-grad)"/>
          <path id="chart-line" d="{path_linea}" fill="none" stroke="{color_trend}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          <line id="interactive-v-line" x1="0" y1="20" x2="0" y2="280" stroke="#4b5563" stroke-width="1" stroke-dasharray="3 3" style="display:none;"/>
        </svg>
        <div id="interactive-dot" style="position:absolute;width:10px;height:10px;border-radius:50%;background:{color_trend};border:2px solid #1a1d27;transform:translate(-50%,-50%);pointer-events:none;display:none;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:0.75rem;font-size:0.75rem;color:#4b5563;font-weight:500;padding:0 0.5rem;">
        <span id="lbl-start-date">{fecha_ini_lbl}</span>
        <span id="lbl-end-date">{fecha_fin_lbl}</span>
      </div>
    </div>
    <div class="dashboard-panel">
      <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;margin-bottom:1.5rem;">Distribución de liquidez</div>
      <div style="display:flex;flex-direction:row;align-items:center;justify-content:center;gap:2rem;flex-wrap:wrap;flex-grow:1;">
        <div class="chart-wrapper" style="margin:0;">
          <svg class="donut" viewBox="0 0 42 42">
            {sectors_patrimonio()}
          </svg>
          <div class="donut-center">
            <span style="font-size:1.05rem;font-weight:700;color:#fff;line-height:1.2;word-wrap:break-word;max-width:100px;">{fmt_eur(patrimonio_liquido)}</span>
            <span style="font-size:0.52rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-top:0.2rem;">Total</span>
          </div>
          <div id="dynamic-label" class="chart-label"></div>
        </div>
        <div class="legend-box" style="gap:0;">{legend_patrimonio()}</div>
      </div>
    </div>
  </div>
  <div class="table-container" style="margin-top:2rem;margin-bottom:2rem;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
      <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Ingresos vs Gastos por mes</div>
      <div style="display:flex;gap:1rem;font-size:0.8rem;">
        <div style="display:flex;align-items:center;gap:0.4rem;"><span style="width:10px;height:10px;background:#10b981;border-radius:2px;display:inline-block;"></span><span style="color:#9ca3af;">Ingresos</span></div>
        <div style="display:flex;align-items:center;gap:0.4rem;"><span style="width:10px;height:10px;background:#ef4444;border-radius:2px;display:inline-block;"></span><span style="color:#9ca3af;">Gastos</span></div>
      </div>
    </div>
    {monthly_chart_svg}
    <table class="minimal-table" style="margin-top:1.5rem;">
      <thead><tr>
        <th style="text-align:left;">Mes</th>
        <th style="text-align:right;">Ingresos</th>
        <th style="text-align:right;">Gastos</th>
        <th style="text-align:right;">Invertido</th>
        <th style="text-align:right;">Balance</th>
        <th style="text-align:right;">Ahorro</th>
      </tr></thead>
      <tbody>{tabla_mensual_html(resumen_mensual)}</tbody>
    </table>
  </div>
  <div class="table-container">
    <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;margin-bottom:1.5rem;">Desglose por categoría</div>
    <div class="gastos-layout">
      <div style="display:flex;flex-direction:column;align-items:center;gap:1rem;">
        <div class="chart-wrapper">
          <svg class="donut" viewBox="0 0 42 42">
            {sectors_gastos()}
          </svg>
          <div class="donut-center">
            <span style="font-size:0.9rem;font-weight:700;color:#fff;line-height:1.2;word-wrap:break-word;max-width:100px;">{fmt_eur(total_gastos)}</span>
            <span style="font-size:0.52rem;color:#6b7280;text-transform:uppercase;margin-top:0.2rem;">Total</span>
          </div>
          <div id="gastos-label" class="chart-label"></div>
        </div>
      </div>
      <table class="minimal-table" style="margin-top:0;">
        <thead><tr>
          <th style="text-align:left;">Categoría</th>
          <th style="text-align:right;">Importe</th>
          <th style="text-align:right;">%</th>
        </tr></thead>
        <tbody>{tabla_gastos()}</tbody>
      </table>
    </div>
  </div>
  <div class="table-container">
    <div style="display:flex;gap:0;border-bottom:1px solid #2a2d3a;margin-bottom:1.25rem;overflow-x:auto;">
      <button class="cmov-tab" onclick="filterCuentasMov(this,'__all__')" style="background:none;border:none;border-bottom:2px solid #ffffff;color:#ffffff;font-weight:700;font-size:0.88rem;padding:0.5rem 1rem 0.6rem;cursor:pointer;transition:all 0.15s;white-space:nowrap;margin-bottom:-1px;">Todos</button>
      {"".join(f'<button class="cmov-tab" onclick="filterCuentasMov(this,\'{html_escape(r["cuenta"]).replace(chr(39), chr(92)+chr(39))}\')" style="background:none;border:none;border-bottom:2px solid transparent;color:#6b7280;font-weight:400;font-size:0.88rem;padding:0.5rem 1rem 0.6rem;cursor:pointer;transition:all 0.15s;white-space:nowrap;margin-bottom:-1px;">{html_escape(r["cuenta"])}</button>' for _, r in saldos.iterrows())}
    </div>
    <table class="minimal-table">
      <thead><tr>
        <th style="text-align:left;">Fecha</th>
        <th style="text-align:left;">Concepto</th>
        <th style="text-align:right;">Importe</th>
        <th style="text-align:right;">Saldo</th>
      </tr></thead>
      <tbody id="cuentas-mov-tbody">{_mov_html}</tbody>
    </table>
  </div>
</div>

<!-- ══ PÁGINA 3: INVERSIONES ══ -->
<div class="page" id="page-inversiones">
  <div class="hero-card" style="margin-top:1.5rem;">
    <div class="hero-main">
      <span class="hero-label">Valor actual</span>
      <span class="hero-value">{fmt_eur(total_inversiones)}</span>
    </div>
    <div class="hero-breakdown">
      <div class="hero-item">
        <span class="hero-item-label">Invertido</span>
        <span class="hero-item-value">{fmt_eur(total_coste_inv) if hay_rentabilidad else "—"}</span>
      </div>
      <div class="hero-item">
        <span class="hero-item-label">Ganancia</span>
        <span class="hero-item-value" style="color:{'#10b981' if total_ganancia_inv >= 0 else '#ef4444'};">{('+' if total_ganancia_inv >= 0 else '') + fmt_eur(total_ganancia_inv) if hay_rentabilidad else '—'}</span>
      </div>
      <div class="hero-item">
        <span class="hero-item-label">Rentabilidad</span>
        <span class="hero-item-value" style="color:{'#10b981' if total_rent_inv_pct >= 0 else '#ef4444'};">{('+' if total_rent_inv_pct >= 0 else '') + f'{total_rent_inv_pct:.2f}%' if hay_rentabilidad else '—'}</span>
      </div>
    </div>
  </div>
  <!-- ══ BENCHMARK MSCI WORLD ══ -->
  <div style="max-width:1400px;margin:1.5rem auto 0;width:100%;">
    <div class="dashboard-panel" style="padding:1.5rem 2rem;">
      <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;margin-bottom:1.25rem;">Benchmark · MSCI World (mismo capital, mismas fechas)</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1.5rem;">
        <div>
          <div style="font-size:0.75rem;color:#6b7280;margin-bottom:0.3rem;">Tu cartera</div>
          <div style="font-size:1.4rem;font-weight:700;color:{'#10b981' if total_rent_inv_pct >= 0 else '#ef4444'};">{'+'  if total_rent_inv_pct >= 0 else ''}{total_rent_inv_pct:.2f}%</div>
          <div style="font-size:0.82rem;color:#9ca3af;margin-top:0.15rem;">{fmt_eur(total_inversiones)}</div>
        </div>
        <div>
          <div style="font-size:0.75rem;color:#6b7280;margin-bottom:0.3rem;">MSCI World</div>
          <div style="font-size:1.4rem;font-weight:700;color:{'#10b981' if not math.isnan(bench_rent_pct) and bench_rent_pct >= 0 else '#6b7280'};">{f'{bench_signo}{bench_rent_pct:.2f}%' if not math.isnan(bench_rent_pct) else '—'}</div>
          <div style="font-size:0.82rem;color:#9ca3af;margin-top:0.15rem;">{fmt_eur(bench_valor) if not math.isnan(bench_rent_pct) else '—'}</div>
        </div>
        <div>
          <div style="font-size:0.75rem;color:#6b7280;margin-bottom:0.3rem;">Tu alpha</div>
          <div style="font-size:1.4rem;font-weight:700;color:{diff_color};">{f'{diff_signo}{diff_vs_bench:.2f}%' if not math.isnan(diff_vs_bench) else '—'}</div>
          <div style="font-size:0.82rem;color:#9ca3af;margin-top:0.15rem;">{'sobre el índice' if not math.isnan(diff_vs_bench) else ''}</div>
        </div>
      </div>
    </div>
  </div>

  <div class="chart-container-double">
    <div class="chart-block">
      <div class="chart-block-title">Estrategia de inversión</div>
      <div class="chart-wrapper">
        <svg class="donut" viewBox="0 0 42 42">{sectors_donut(inv_cat, "categoria", "importe")}</svg>
        <div class="donut-center">
          <span style="font-size:1rem;font-weight:700;color:#fff;">{fmt_eur(total_inversiones)}</span>
          <span style="font-size:0.55rem;color:#6b7280;text-transform:uppercase;margin-top:0.2rem;">Total</span>
        </div>
      </div>
      <div style="width:100%;display:flex;flex-direction:column;align-items:center;margin-top:0.5rem;">{legend_donut(inv_cat, "categoria")}</div>
    </div>
    <div class="chart-block">
      <div class="chart-block-title">Distribución por activos</div>
      <div class="chart-wrapper">
        <svg class="donut" viewBox="0 0 42 42">{sectors_donut(inv_tipo, "tipo", "importe")}</svg>
        <div class="donut-center">
          <span style="font-size:1rem;font-weight:700;color:#fff;">{fmt_eur(total_inversiones)}</span>
          <span style="font-size:0.55rem;color:#6b7280;text-transform:uppercase;margin-top:0.2rem;">Activos</span>
        </div>
      </div>
      <div style="width:100%;display:flex;flex-direction:column;align-items:center;margin-top:0.5rem;">{legend_donut(inv_tipo, "tipo")}</div>
    </div>
  </div>
  <div class="table-container">
    <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;margin-bottom:0.5rem;">Inversiones</div>
    <table class="minimal-table">
      <thead><tr>
        <th style="text-align:left;">Activo</th>
        <th style="text-align:left;">ISIN</th>
        <th style="text-align:right;">Valor actual</th>
        <th style="text-align:right;">Invertido</th>
        <th style="text-align:right;">Rentabilidad</th>
        <th style="text-align:right;">Peso</th>
        <th style="text-align:right;">Mercado</th>
      </tr></thead>
      <tbody>{tabla_activos()}</tbody>
    </table>
  </div>
  <!-- ══ GRÁFICA CARTERA ══ -->
  <div style="max-width:1400px;margin:2rem auto 0;width:100%;">
    <div class="dashboard-panel" style="min-height:380px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1.5rem;flex-wrap:wrap;gap:1rem;">
        <div>
          <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.6rem;">
            <select id="portfolio-select" style="background:#12141f;color:#e5e7eb;border:1px solid #2a2d3a;border-radius:6px;padding:0.35rem 0.7rem;font-size:0.85rem;cursor:pointer;outline:none;">
{portfolio_options}
            </select>
            <span id="portfolio-moneda" style="font-size:0.72rem;color:#9ca3af;font-weight:600;background:#2a2d3a;padding:0.2rem 0.45rem;border-radius:4px;letter-spacing:0.04em;">EUR</span>
          </div>
          <div style="display:flex;align-items:center;gap:0.8rem;min-height:38px;">
            <div id="pf-rendimiento-display" style="font-size:1.05rem;font-weight:600;color:#10b981;background:rgba(16,185,129,0.15);padding:0.3rem 0.7rem;border-radius:6px;">--</div>
            <div id="pf-valor-display" style="font-size:1.5rem;font-weight:700;color:#fff;display:none;"></div>
          </div>
        </div>
        <div id="pf-date-display" style="font-size:0.82rem;color:#6b7280;font-weight:500;text-align:right;"></div>
      </div>
      <div class="timeframe-selector">
        <button class="tf-btn-pf" data-range="1d">1D</button>
        <button class="tf-btn-pf" data-range="1w">1W</button>
        <button class="tf-btn-pf active" data-range="1mo">1M</button>
        <button class="tf-btn-pf" data-range="ytd">1YTD</button>
        <button class="tf-btn-pf" data-range="1y">1Y</button>
        <button class="tf-btn-pf" data-range="max">MAX</button>
      </div>
      <div style="position:relative;width:100%;flex-grow:1;min-height:220px;">
        <svg id="pf-svg-chart" viewBox="0 0 1000 300" width="100%" height="100%" preserveAspectRatio="none" style="overflow:visible;cursor:crosshair;">
          <defs>
            <linearGradient id="pf-area-grad" x1="0" y1="0" x2="0" y2="1">
              <stop id="pf-grad-stop0" offset="0%" stop-color="#8b5cf6" stop-opacity="0.25"/>
              <stop id="pf-grad-stop1" offset="100%" stop-color="#8b5cf6" stop-opacity="0.0"/>
            </linearGradient>
          </defs>
          <g id="pf-axes"></g>
          <line x1="70" y1="280" x2="980" y2="280" stroke="#2a2d3a" stroke-width="1" stroke-dasharray="4 4"/>
          <line id="pf-ref-line" x1="70" y1="260" x2="980" y2="260" stroke="#4b5563" stroke-width="1.5" stroke-dasharray="6 4" style="display:none;"/>
          <path id="pf-chart-area" d="" fill="url(#pf-area-grad)"/>
          <path id="pf-chart-line" d="" fill="none" stroke="#8b5cf6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          <line id="pf-v-line" x1="0" y1="20" x2="0" y2="280" stroke="#6b7280" stroke-width="1" stroke-dasharray="3 3" style="display:none;"/>
        </svg>
        <div id="pf-dot" style="position:absolute;width:10px;height:10px;border-radius:50%;background:#8b5cf6;border:2px solid #1a1d27;transform:translate(-50%,-50%);pointer-events:none;display:none;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:0.75rem;font-size:0.75rem;color:#4b5563;font-weight:500;">
        <span id="pf-lbl-start">--</span><span id="pf-lbl-end">--</span>
      </div>
    </div>
  </div>
  <!-- ══ HISTORIAL DE APORTACIONES ══ -->
  <div style="max-width:1400px;margin:2rem auto 0;width:100%;padding-bottom:2rem;">
    <div class="table-container">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
        <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Historial de aportaciones</div>
        <div style="font-size:0.82rem;color:#9ca3af;">{len(inv_apor)} compras · {fmt_eur(total_coste_inv) if hay_rentabilidad else "—"} invertido</div>
      </div>
      <table class="minimal-table">
        <thead><tr>
          <th style="text-align:left;">Fecha</th>
          <th style="text-align:left;">Activo</th>
          <th style="text-align:left;">Banco</th>
          <th style="text-align:right;">Importe</th>
          <th style="text-align:right;">Unidades</th>
          <th style="text-align:right;">Precio/ud</th>
        </tr></thead>
        <tbody>{tabla_aportaciones()}</tbody>
      </table>
    </div>
  </div>
</div>

<!-- ══ PÁGINA 4: EXPLORAR ACTIVOS ══ -->
<div class="page" id="page-explorar">
  <div style="max-width:1400px;margin:0 auto 2rem;">
    <div style="margin-top:1.5rem;margin-bottom:2rem;">
      <h1 style="font-size:2.4rem;font-weight:800;color:#ffffff;line-height:1.1;margin:0 0 0.5rem 0;">
        Explorar <span style="font-style:italic;color:#3b82f6;">activos</span>
      </h1>
      <p style="color:#6b7280;font-size:0.92rem;margin:0;">
        Los {len(inv_raw)} activos de tu portafolio. Busca o filtra para explorarlos.
      </p>
    </div>
    <div style="position:relative;margin-bottom:1.25rem;">
      <svg style="position:absolute;left:1rem;top:50%;transform:translateY(-50%);color:#6b7280;pointer-events:none;" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
      </svg>
      <input id="explorar-search" type="text" placeholder="Buscar por nombre o ISIN..."
        oninput="explorarFiltrar()"
        style="width:100%;box-sizing:border-box;background:#1a1d27;border:1px solid #2a2d3a;border-radius:12px;
               padding:0.75rem 1rem 0.75rem 2.75rem;color:#e5e7eb;font-size:0.9rem;outline:none;
               transition:border-color 0.2s;"
        onfocus="this.style.borderColor='#3b82f6'" onblur="this.style.borderColor='#2a2d3a'">
    </div>
    <div style="display:flex;gap:0;border-bottom:1px solid #2a2d3a;margin-bottom:1.5rem;overflow-x:auto;">
      <button class="explorar-tab" onclick="explorarSetTipo(this,'__all__')"
        style="background:none;border:none;border-bottom:2px solid #ffffff;color:#ffffff;font-weight:700;
               padding:0.6rem 1.1rem;font-size:0.85rem;cursor:pointer;white-space:nowrap;transition:all 0.15s;">Todos</button>
      <button class="explorar-tab" onclick="explorarSetTipo(this,'acciones')"
        style="background:none;border:none;border-bottom:2px solid transparent;color:#6b7280;font-weight:400;
               padding:0.6rem 1.1rem;font-size:0.85rem;cursor:pointer;white-space:nowrap;transition:all 0.15s;">Acciones</button>
      <button class="explorar-tab" onclick="explorarSetTipo(this,'etf')"
        style="background:none;border:none;border-bottom:2px solid transparent;color:#6b7280;font-weight:400;
               padding:0.6rem 1.1rem;font-size:0.85rem;cursor:pointer;white-space:nowrap;transition:all 0.15s;">ETFs</button>
      <button class="explorar-tab" onclick="explorarSetTipo(this,'cripto')"
        style="background:none;border:none;border-bottom:2px solid transparent;color:#6b7280;font-weight:400;
               padding:0.6rem 1.1rem;font-size:0.85rem;cursor:pointer;white-space:nowrap;transition:all 0.15s;">Criptoactivos</button>
      <button class="explorar-tab" onclick="explorarSetTipo(this,'fondo')"
        style="background:none;border:none;border-bottom:2px solid transparent;color:#6b7280;font-weight:400;
               padding:0.6rem 1.1rem;font-size:0.85rem;cursor:pointer;white-space:nowrap;transition:all 0.15s;">Fondos</button>
    </div>
    <div id="explorar-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:1.25rem;">
      {tarjetas_activos_html()}
    </div>
    <div id="explorar-empty" style="display:none;text-align:center;padding:4rem 2rem;">
      <div style="color:#4b5563;font-size:2rem;margin-bottom:0.75rem;">🔍</div>
      <div style="color:#6b7280;font-size:0.92rem;">No se encontraron activos que coincidan.</div>
    </div>

    <hr style="border:0;height:1px;background:linear-gradient(to right,transparent,#2a2d3a,transparent);margin:3rem 0;">

    <div style="margin-bottom:1.5rem;">
      <h2 style="font-size:1.5rem;font-weight:700;color:#ffffff;margin:0 0 0.35rem 0;">Cotizaciones</h2>
      <p style="color:#6b7280;font-size:0.88rem;margin:0;">Busca cualquier activo y consulta su histórico de precio.</p>
    </div>
    <div style="display:flex;gap:0.75rem;align-items:center;margin-bottom:1.25rem;flex-wrap:wrap;">
      <div style="position:relative;flex:1;min-width:200px;max-width:500px;">
        <svg style="position:absolute;left:1rem;top:50%;transform:translateY(-50%);color:#6b7280;pointer-events:none;" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input id="cot-ticker" type="text" placeholder="Ej. AAPL · BTCUSD · EURONEXT:IWDA · SP500…"
          onkeydown="if(event.key==='Enter') cotizacionesBuscar()"
          style="width:100%;box-sizing:border-box;background:#1a1d27;border:1px solid #2a2d3a;border-radius:12px;
                 padding:0.75rem 1rem 0.75rem 2.75rem;color:#e5e7eb;font-size:0.9rem;outline:none;
                 transition:border-color 0.2s;font-family:inherit;"
          onfocus="this.style.borderColor='#3b82f6'" onblur="this.style.borderColor='#2a2d3a'">
      </div>
      <button onclick="cotizacionesBuscar()"
        style="background:#3b82f6;border:none;border-radius:10px;color:#fff;font-size:0.88rem;font-weight:600;
               padding:0.72rem 1.5rem;cursor:pointer;white-space:nowrap;transition:background 0.15s;font-family:inherit;"
        onmouseover="this.style.background='#2563eb'" onmouseout="this.style.background='#3b82f6'">
        Ver gráfico
      </button>
    </div>
    <div style="display:flex;gap:0;border-bottom:1px solid #2a2d3a;margin-bottom:1.5rem;overflow-x:auto;">
      <button class="cot-range-tab" onclick="cotRango(this,'1M')"
        style="background:none;border:none;border-bottom:2px solid #ffffff;color:#ffffff;font-weight:700;
               padding:0.5rem 1rem;font-size:0.82rem;cursor:pointer;white-space:nowrap;transition:all 0.15s;font-family:inherit;">1M</button>
      <button class="cot-range-tab" onclick="cotRango(this,'6M')"
        style="background:none;border:none;border-bottom:2px solid transparent;color:#6b7280;font-weight:400;
               padding:0.5rem 1rem;font-size:0.82rem;cursor:pointer;white-space:nowrap;transition:all 0.15s;font-family:inherit;">6M</button>
      <button class="cot-range-tab" onclick="cotRango(this,'12M')"
        style="background:none;border:none;border-bottom:2px solid transparent;color:#6b7280;font-weight:400;
               padding:0.5rem 1rem;font-size:0.82rem;cursor:pointer;white-space:nowrap;transition:all 0.15s;font-family:inherit;">1A</button>
      <button class="cot-range-tab" onclick="cotRango(this,'60M')"
        style="background:none;border:none;border-bottom:2px solid transparent;color:#6b7280;font-weight:400;
               padding:0.5rem 1rem;font-size:0.82rem;cursor:pointer;white-space:nowrap;transition:all 0.15s;font-family:inherit;">5A</button>
      <button class="cot-range-tab" onclick="cotRango(this,'ALL')"
        style="background:none;border:none;border-bottom:2px solid transparent;color:#6b7280;font-weight:400;
               padding:0.5rem 1rem;font-size:0.82rem;cursor:pointer;white-space:nowrap;transition:all 0.15s;font-family:inherit;">Máx</button>
    </div>
    <div style="border-radius:16px;overflow:hidden;border:1px solid #2a2d3a;min-height:520px;
                display:flex;align-items:center;justify-content:center;background:#13151f;">
      <div id="cot-placeholder" style="text-align:center;color:#4b5563;padding:3rem;">
        <div style="font-size:3rem;margin-bottom:1rem;opacity:0.5;">📈</div>
        <div style="font-size:0.95rem;color:#6b7280;margin-bottom:0.35rem;">Introduce un ticker y pulsa <strong style="color:#9ca3af;">Ver gráfico</strong></div>
        <div style="font-size:0.8rem;color:#374151;">Acciones · ETFs · Índices · Criptomonedas · Divisas</div>
      </div>
      <div id="cot-tv-container" style="display:none;width:100%;height:520px;"></div>
    </div>
    <div style="margin-top:0.9rem;display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;">
      <span style="font-size:0.75rem;color:#4b5563;margin-right:0.25rem;">Mi cartera:</span>
      <button class="cot-chip" data-tv="EURONEXT:IWDA" onclick="cotChip(this)" style="background:#1e2130;border:1px solid #2a2d3a;border-radius:20px;color:#9ca3af;font-size:0.78rem;padding:0.3rem 0.8rem;cursor:pointer;font-family:inherit;transition:all 0.15s;" onmouseover="this.style.borderColor='#4b5563';this.style.color='#e5e7eb'" onmouseout="this.style.borderColor='#2a2d3a';this.style.color='#9ca3af'">MSCI World</button>
      <button class="cot-chip" data-tv="EURONEXT:CSPX" onclick="cotChip(this)" style="background:#1e2130;border:1px solid #2a2d3a;border-radius:20px;color:#9ca3af;font-size:0.78rem;padding:0.3rem 0.8rem;cursor:pointer;font-family:inherit;transition:all 0.15s;" onmouseover="this.style.borderColor='#4b5563';this.style.color='#e5e7eb'" onmouseout="this.style.borderColor='#2a2d3a';this.style.color='#9ca3af'">S&amp;P 500</button>
      <button class="cot-chip" data-tv="EURONEXT:EMIM" onclick="cotChip(this)" style="background:#1e2130;border:1px solid #2a2d3a;border-radius:20px;color:#9ca3af;font-size:0.78rem;padding:0.3rem 0.8rem;cursor:pointer;font-family:inherit;transition:all 0.15s;" onmouseover="this.style.borderColor='#4b5563';this.style.color='#e5e7eb'" onmouseout="this.style.borderColor='#2a2d3a';this.style.color='#9ca3af'">Emerging Markets</button>
      <button class="cot-chip" data-tv="LSE:AGGG" onclick="cotChip(this)" style="background:#1e2130;border:1px solid #2a2d3a;border-radius:20px;color:#9ca3af;font-size:0.78rem;padding:0.3rem 0.8rem;cursor:pointer;font-family:inherit;transition:all 0.15s;" onmouseover="this.style.borderColor='#4b5563';this.style.color='#e5e7eb'" onmouseout="this.style.borderColor='#2a2d3a';this.style.color='#9ca3af'">US Aggregate Bond</button>
      <button class="cot-chip" data-tv="EURONEXT:PHAU" onclick="cotChip(this)" style="background:#1e2130;border:1px solid #2a2d3a;border-radius:20px;color:#9ca3af;font-size:0.78rem;padding:0.3rem 0.8rem;cursor:pointer;font-family:inherit;transition:all 0.15s;" onmouseover="this.style.borderColor='#4b5563';this.style.color='#e5e7eb'" onmouseout="this.style.borderColor='#2a2d3a';this.style.color='#9ca3af'">Oro Físico</button>
      <button class="cot-chip" data-tv="BITSTAMP:BTCUSD" onclick="cotChip(this)" style="background:#1e2130;border:1px solid #2a2d3a;border-radius:20px;color:#9ca3af;font-size:0.78rem;padding:0.3rem 0.8rem;cursor:pointer;font-family:inherit;transition:all 0.15s;" onmouseover="this.style.borderColor='#4b5563';this.style.color='#e5e7eb'" onmouseout="this.style.borderColor='#2a2d3a';this.style.color='#9ca3af'">Bitcoin</button>
      <button class="cot-chip" data-tv="NASDAQ:AAPL" onclick="cotChip(this)" style="background:#1e2130;border:1px solid #2a2d3a;border-radius:20px;color:#9ca3af;font-size:0.78rem;padding:0.3rem 0.8rem;cursor:pointer;font-family:inherit;transition:all 0.15s;" onmouseover="this.style.borderColor='#4b5563';this.style.color='#e5e7eb'" onmouseout="this.style.borderColor='#2a2d3a';this.style.color='#9ca3af'">Apple</button>
    </div>
  </div>
</div>

  <footer>Datos extraídos de Google Sheets &amp; APIs · Actualización automática</footer>
  <script>const evoData = {js_history_array};const netoHistData = {neto_hist_js};const btcMaxData = {btc_max_data_js};const msciHistoryData = {msci_history_js};const msciIntradayData = {msci_intraday_js};const portfolioHistoryData = {portfolio_history_js};const portfolioIntradayData = {portfolio_intraday_js};const portfolioCurrency = {portfolio_currency_js};const latestPrices={latest_prices_js};const tickerCurrency={ticker_currency_js};const saldosCuentas={saldos_cuentas_js};
  (function(){{
    const svg = document.getElementById('neto-svg-chart');
    if (!svg || !netoHistData.length) return;
    const vline = document.getElementById('neto-v-line');
    const dot   = document.getElementById('neto-dot');
    const rdis  = document.getElementById('neto-rend-display');
    const vdis  = document.getElementById('neto-valor-display');
    const ddis  = document.getElementById('neto-date-display');
    function onMove(e) {{
      const rect = svg.getBoundingClientRect();
      const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      const pct = Math.max(0, Math.min(1, cx / rect.width));
      const vbW = 1000, svgX = 70 + pct * (980 - 70);
      let best = netoHistData[0], bd = Infinity;
      for (const p of netoHistData) {{ const d = Math.abs(p.x - svgX); if (d < bd) {{ bd = d; best = p; }} }}
      const bx = best.x / vbW * rect.width, by = best.y / 300 * rect.height;
      vline.setAttribute('x1', best.x); vline.setAttribute('x2', best.x); vline.style.display = '';
      dot.style.left = bx + 'px'; dot.style.top = by + 'px'; dot.style.display = '';
      rdis.style.display = 'none'; vdis.style.display = 'inline-block';
      vdis.textContent = best.vf + ' €';
      ddis.textContent = best.f;
    }}
    function onLeave() {{
      vline.style.display = 'none'; dot.style.display = 'none';
      rdis.style.display = ''; vdis.style.display = 'none';
      ddis.textContent = 'Desde el inicio';
    }}
    svg.addEventListener('mousemove', onMove);
    svg.addEventListener('mouseleave', onLeave);
    svg.addEventListener('touchmove', e => {{ e.preventDefault(); onMove(e); }}, {{passive:false}});
    svg.addEventListener('touchend', onLeave);
  }})();
  </script>
  <script src="src/js/navigation.js?v={build_ts}"></script>
  <script src="src/js/charts-evo.js?v={build_ts}"></script>
  <script src="src/js/charts-btc.js?v={build_ts}"></script>
  <script src="src/js/charts-portfolio.js?v={build_ts}"></script>
  <script src="src/js/prices.js?v={build_ts}"></script>
</body>
</html>"""

HTML_PATH.write_text(html_out, encoding="utf-8")

print(f"✅ HTML generado: {HTML_PATH}")
print(f"   Patrimonio líquido:  {fmt_eur(patrimonio_liquido)}")
print(f"   Total inversiones:   {fmt_eur(total_inversiones)}")
print(f"   Patrimonio neto:     {fmt_eur(patrimonio_neto)}")
print(f"   Total gastos:        {fmt_eur(total_gastos)}")
