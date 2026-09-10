#!/usr/bin/env python3
"""
Solvento — Genera prices.json PÚBLICO (sin datos personales).

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
        meta = result["meta"]
        cur = meta.get("currency", "EUR")
        # Un listado sin velas no trae ni la clave «close», así que se pregunta
        # con .get: pedirla directamente lanzaba, y el error se comía el precio
        # que sí venía en la cabecera.
        quote = (result.get("indicators", {}).get("quote") or [{}])[0]
        closes = [v for v in (quote.get("close") or []) if v is not None]
        if closes:
            return round(_to_eur(closes[-1], cur, fx), 6)
        # Los fondos apenas se negocian, así que su listado no tiene velas
        # diarias: Yahoo publica la cotización pero no cierra ningún día. Se
        # acepta ese precio siempre que sea de esta semana; si el listado está
        # muerto de verdad, no devolvemos nada y el fondo se sigue valorando con
        # su valor liquidativo, que es preferible a un precio congelado que
        # nadie va a notar.
        precio, cuando = meta.get("regularMarketPrice"), meta.get("regularMarketTime")
        if precio and cuando:
            dias = (datetime.now(timezone.utc).timestamp() - float(cuando)) / 86400
            if dias <= 7:
                return round(_to_eur(float(precio), cur, fx), 6)
        return None
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
        ts = result.get("timestamp") or []
        cl = (result.get("indicators", {}).get("quote") or [{}])[0].get("close") or []
        cur = result["meta"].get("currency", "EUR")
        out = []
        for t, v in zip(ts, cl):
            if v is not None:
                out.append([t * 1000, round(_to_eur(v, cur, fx), 4)])
        return out
    except Exception:
        return []



# Metales preciosos: para valorar por peso lo que se guarda en gramos (una
# moneda de oro, un lingote). Yahoo los cotiza en dólares por onza troy, así
# que se convierte a euros por gramo, que es como se pesa en casa.
ONZA_TROY_EN_GRAMOS = 31.1034768
METALES = {"oro": "GC=F", "plata": "SI=F"}


def fetch_metales(fx):
    """€ por gramo de cada metal. fetch_precio_eur ya devuelve el precio en euros
    (aquí, por onza troy), así que solo queda pasarlo a gramos."""
    out = {}
    for nombre, ticker in METALES.items():
        eur_onza = fetch_precio_eur(ticker, fx)
        if eur_onza:
            out[nombre] = round(eur_onza / ONZA_TROY_EN_GRAMOS, 4)
            print(f"   {nombre:14s} → {out[nombre]:.4f} €/g")
        else:
            print(f"   {nombre:14s} → sin precio")
    return out


def main():
    fx = fetch_fx()
    eur, hist = {}, {}
    for t in tickers():
        p = fetch_precio_eur(t, fx)
        eur[t] = p
        h = fetch_hist_eur(t, fx)
        hist[t] = h
        print(f"   {t:14s} → {('%.4f €' % p) if p else 'sin precio':>12s}  · histórico {len(h)} puntos")
    metales = fetch_metales(fx)
    doc = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "fx_eur": fx,
        "eur": eur,
        "hist": hist,
        "metales": metales,   # € por gramo
    }
    with open("prices.json", "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
    import os
    print(f"✅ prices.json generado ({sum(1 for v in eur.values() if v)} precios · "
          f"{sum(len(v) for v in hist.values())} puntos históricos · {os.path.getsize('prices.json')//1024} KB · FX {fx})")


if __name__ == "__main__":
    main()
