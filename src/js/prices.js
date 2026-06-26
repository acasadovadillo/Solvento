const YF_TICKERS = ["AGGG.L", "IWDA.AS", "CSPX.L", "IEMA.AS", "SGLN.L", "AAPL"];

function mktElemId(ticker) {
  return "mkt-" + ticker.replace(/[^A-Za-z0-9]/g, "_");
}

async function fetchYahooPrice(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const d = await r.json();
    const meta = d?.chart?.result?.[0]?.meta;
    return meta?.regularMarketPrice ?? meta?.chartPreviousClose ?? null;
  } catch (e) { return null; }
}

async function loadMarketPrices() {
  for (const ticker of YF_TICKERS) {
    const el = document.getElementById(mktElemId(ticker));
    if (!el) continue;
    const price = await fetchYahooPrice(ticker);
    if (price !== null) {
      const sym = ticker.endsWith(".AS") ? "€" : (ticker.endsWith(".L") ? "p" : "$");
      el.textContent = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(price) + " " + sym;
    }
  }
}

loadMarketPrices();
setInterval(loadMarketPrices, 60000);
