#!/usr/bin/env python3
"""
Solvento v2 — Genera prices.json PÚBLICO (sin datos personales).

Descarga el precio actual (en EUR) de cada activo con ticker de Yahoo Finance y
lo escribe en prices.json. Los precios NO son secretos: este fichero se versiona
en el repo y la web lo lee sin autenticación, evitando el CORS de Yahoo en el
navegador. Los fondos sin ticker (Bankinter, Fidelity) se valoran con su NAV, que
ya viaja dentro del documento cifrado (db.nav), así que no aparecen aquí.

En la Fase 2 esto se ejecuta a mano; en una fase posterior lo hará la GitHub
Action diaria en lugar de reconstruir el HTML.
"""
import json
import math
import urllib.request
from datetime import datetime, timezone

# yf_ticker → moneda de cotización (el resto cotiza en EUR)
YF_TICKERS = ["IUAA.L", "IWDA.AS", "CSPX.AS", "HEMA.L", "IGLN.L",
              "BTC-EUR", "AAPL", "0P000168OI.F", "SSAC.AS"]

# La app escribe tickers.json cuando das de alta un activo desde Ajustes, para
# que sus precios se descarguen sin tocar este fichero. Si no existe (o está
# mal), se usa la lista de arriba. No es dato personal: prices.json ya publica
# exactamente los mismos tickers.
def tickers():
    try:
        with open("tickers.json", encoding="utf-8") as f:
            t = json.load(f).get("tickers")
        t = [x for x in t if isinstance(x, str) and x.strip()]
        if t:
            print(f"   Usando tickers.json ({len(t)} activos)")
            return t
    except FileNotFoundError:
        pass
    except Exception as e:
        print(f"   tickers.json ilegible ({e}); uso la lista interna")
    return YF_TICKERS
MONEDA = {"IUAA.L": "USD", "AAPL": "USD"}  # AGGG.L cotiza en USD pese al sufijo .L


def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def fetch_fx():
    """EUR por 1 unidad de divisa (USD→EUR, GBP→EUR)."""
    fx = {"USD": 0.926, "GBP": 1.168}
    for div, sym in (("USD", "USDEUR=X"), ("GBP", "GBPEUR=X")):
        try:
            d = _get(f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?interval=1d&range=5d")
            p = d["chart"]["result"][0]["meta"].get("regularMarketPrice")
            if p:
                fx[div] = float(p)
        except Exception:
            pass
    return fx


def _to_eur(price, cur, fx):
    if cur == "GBp":
        return price / 100 * fx.get("GBP", 1.168)
    if cur != "EUR":
        return price * fx.get(cur, 1.0)
    return price


def fetch_precio_eur(ticker, fx):
    """Último precio en EUR (misma lógica que fetch_precio_actual_eur de la v1)."""
    try:
        d = _get(f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=5d")
        result = d["chart"]["result"][0]
        closes = [v for v in result["indicators"]["quote"][0]["close"] if v is not None]
        if not closes:
            return None
        return round(_to_eur(closes[-1], result["meta"].get("currency", "EUR"), fx), 6)
    except Exception:
        return None


# Histórico desde 2023-01-01 (las primeras inversiones son de oct-2024; con margen)
_HIST_PERIOD1 = 1672531200

def fetch_hist_eur(ticker, fx):
    """Serie diaria [[ts_ms, precio_eur], ...] en EUR (FX actual, como la v1)."""
    try:
        d = _get(f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
                 f"?interval=1d&period1={_HIST_PERIOD1}&period2={int(datetime.now(timezone.utc).timestamp())}")
        result = d["chart"]["result"][0]
        ts = result["timestamp"]
        cl = result["indicators"]["quote"][0]["close"]
        cur = result["meta"].get("currency", "EUR")
        out = []
        for t, v in zip(ts, cl):
            if v is not None:
                out.append([t * 1000, round(_to_eur(v, cur, fx), 4)])
        return out
    except Exception:
        return []


def main():
    fx = fetch_fx()
    eur, hist = {}, {}
    for t in tickers():
        p = fetch_precio_eur(t, fx)
        eur[t] = p
        h = fetch_hist_eur(t, fx)
        hist[t] = h
        print(f"   {t:14s} → {('%.4f €' % p) if p else 'sin precio':>12s}  · histórico {len(h)} puntos")
    doc = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "fx_eur": fx,
        "eur": eur,
        "hist": hist,
    }
    with open("prices.json", "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
    import os
    print(f"✅ prices.json generado ({sum(1 for v in eur.values() if v)} precios · "
          f"{sum(len(v) for v in hist.values())} puntos históricos · {os.path.getsize('prices.json')//1024} KB · FX {fx})")


if __name__ == "__main__":
    main()
