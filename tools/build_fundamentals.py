#!/usr/bin/env python3
"""
Solvento — Genera fundamentals.json PÚBLICO (sin datos personales).

Descarga de Alpha Vantage los fundamentales de las acciones y el desglose
sectorial de los ETFs. Son datos de mercado, iguales para todo el mundo, así
que el fichero se versiona y la web lo lee sin autenticación.

Por qué Alpha Vantage y no Yahoo: Yahoo cerró el acceso a fundamentales (exige
un "crumb" que bloquea sistemáticamente). Alpha Vantage lo da documentado y con
clave gratuita, y cubre los siete datos pedidos:

    EBITDA, PER 12 meses, PER estimado, capitalización, EV/EBITDA  → OVERVIEW
    deuda total (shortLongTermDebtTotal)                           → BALANCE_SHEET
    valor de empresa                                               → EV/EBITDA × EBITDA
    sector y país                                                  → OVERVIEW
    desglose sectorial de un ETF                                   → ETF_PROFILE

La clave se pasa por la variable de entorno ALPHAVANTAGE_KEY (un secreto del
repositorio). Sin clave, el script no falla: avisa y sale, para que el workflow
de precios siga funcionando igual.

Coste: 2 peticiones por acción y 1 por ETF. El plan gratuito da 25 al día, de
sobra para una cartera personal con una actualización diaria.
"""
import json
import os
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

API = "https://www.alphavantage.co/query"
KEY = os.environ.get("ALPHAVANTAGE_KEY", "").strip()
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
PAUSA = 1.0          # cortesía entre llamadas

# Los ETFs del usuario son UCITS europeos, que Alpha Vantage no cubre. Pero la
# composición sectorial de un fondo la marca su ÍNDICE, no dónde cotice: un
# MSCI World tiene los mismos sectores lo emita quien lo emita. Así que para el
# desglose se consulta un ETF estadounidense que siga el mismo índice.
PROXY_INDICE = {
    "IWDA.AS": ("URTH", "MSCI World"),
    "SSAC.AS": ("ACWI", "MSCI ACWI"),
    "CSPX.AS": ("IVV", "S&P 500"),
    "HEMA.L":  ("IEMG", "MSCI Emerging Markets"),
    "IUAA.L":  ("AGG", "Bloomberg US Aggregate"),
}
# Lo que no es un fondo indexado: se pide como acción
ACCIONES = {"AAPL"}


def _get(params):
    q = "&".join(f"{k}={urllib.parse.quote(str(v))}" for k, v in params.items())
    req = urllib.request.Request(f"{API}?{q}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.loads(r.read())
    # La API responde 200 incluso al agotar el límite; el aviso viene en el cuerpo
    if isinstance(d, dict) and ("Note" in d or "Information" in d):
        raise RuntimeError(d.get("Note") or d.get("Information"))
    return d


def _num(v):
    try:
        f = float(v)
        return f if f == f else None      # descarta NaN
    except (TypeError, ValueError):
        return None


def accion(sym):
    """Fundamentales de una acción. Devuelve None si no hay cobertura."""
    o = _get({"function": "OVERVIEW", "symbol": sym, "apikey": KEY})
    if not o.get("Symbol"):
        return None
    time.sleep(PAUSA)
    deuda = None
    try:
        b = _get({"function": "BALANCE_SHEET", "symbol": sym, "apikey": KEY})
        rep = (b.get("annualReports") or [{}])[0]
        deuda = _num(rep.get("shortLongTermDebtTotal"))
    except Exception:
        pass                              # sin balance, el resto sigue valiendo

    ebitda, evEbitda = _num(o.get("EBITDA")), _num(o.get("EVToEBITDA"))
    return {k: v for k, v in {
        "tipo": "accion",
        "nombre": o.get("Name"),
        "sector": (o.get("Sector") or "").title() or None,
        "pais": o.get("Country") or None,
        "industria": (o.get("Industry") or "").title() or None,
        "ebitda": ebitda,
        "per": _num(o.get("PERatio")),
        "perEstimado": _num(o.get("ForwardPE")),
        "marketCap": _num(o.get("MarketCapitalization")),
        "evEbitda": evEbitda,
        # Alpha Vantage no publica el valor de empresa, pero se deduce exacto
        "ev": round(ebitda * evEbitda) if (ebitda and evEbitda) else None,
        "deudaTotal": deuda,
    }.items() if v is not None}


def fondo(sym):
    """Desglose sectorial de un ETF, vía el índice que replica."""
    proxy, indice = PROXY_INDICE.get(sym, (sym, None))
    d = _get({"function": "ETF_PROFILE", "symbol": proxy, "apikey": KEY})
    sectores = {}
    for s in (d.get("sectors") or []):
        nombre = (s.get("sector") or "").title()
        peso = _num(s.get("weight"))
        if nombre and peso:
            sectores[nombre] = round(peso * 100, 2)
    if not sectores:
        return None
    out = {"tipo": "fondo", "sectores": sectores}
    if indice:
        # Se dice de dónde sale, para no dar por propio un dato aproximado
        out["sectoresDe"] = f"{indice} ({proxy})"
    return out


def tickers():
    try:
        with open("tickers.json", encoding="utf-8") as f:
            t = [x for x in json.load(f).get("tickers", []) if isinstance(x, str)]
        if t:
            return t
    except Exception:
        pass
    return sorted(set(list(PROXY_INDICE) + list(ACCIONES)))


def main():
    if not KEY:
        print("⚠️  Sin ALPHAVANTAGE_KEY: me salto los fundamentales (los precios no se ven afectados).")
        return
    assets, fallos = {}, []
    for t in tickers():
        try:
            dato = accion(t) if t in ACCIONES else fondo(t)
            if dato:
                assets[t] = dato
                detalle = dato.get("sector") or f"{len(dato.get('sectores', {}))} sectores"
                print(f"   {t:14s} → {dato['tipo']:7s} {detalle}")
            else:
                fallos.append(t)
                print(f"   {t:14s} → sin cobertura")
        except Exception as e:
            fallos.append(t)
            print(f"   {t:14s} → {type(e).__name__}: {str(e)[:70]}")
        time.sleep(PAUSA)

    doc = {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "fuente": "Alpha Vantage", "assets": assets}
    with open("fundamentals.json", "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    print(f"✅ fundamentals.json ({len(assets)} activos"
          + (f", {len(fallos)} sin datos: {', '.join(fallos)}" if fallos else "") + ")")


if __name__ == "__main__":
    main()
