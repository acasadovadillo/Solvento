// Bitcoin: set by charts-btc.js via Binance WebSocket (element id: mkt-BTC)
// All other assets: prices embedded at HTML build time by generate.py (Yahoo Finance via Python)

function loadMarketPrices() {
  if (typeof latestPrices === "undefined") return;
  for (const [ticker, price] of Object.entries(latestPrices)) {
    const el = document.getElementById("mkt-" + ticker.replace(/[^A-Za-z0-9]/g, "_"));
    if (!el) continue;
    const sym = (typeof tickerCurrency !== "undefined" && tickerCurrency[ticker]) || "";
    el.textContent = new Intl.NumberFormat("es-ES", {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    }).format(price) + " " + sym;
  }
}

loadMarketPrices();
