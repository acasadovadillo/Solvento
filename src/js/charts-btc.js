let btcRaw = [], btcActive = [], btcMaxCached = null;
window.btcDefaultDateText = "";

function initBtcWebSocket() {
  const mktEl = document.getElementById("mkt-BTC");
  try {
    const ws = new WebSocket("wss://stream.binance.com:9443/ws/btceur@trade");
    ws.onmessage = e => {
      const price = parseFloat(JSON.parse(e.data).p);
      if (mktEl) mktEl.textContent = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(price) + " €";
    };
    ws.onerror = () => { if (mktEl) mktEl.textContent = "Sin conexión"; };
    ws.onclose = () => setTimeout(initBtcWebSocket, 5000);
  } catch (e) { if (mktEl) mktEl.textContent = "Sin conexión"; }
}

function parseBtcPrices(data, intraday) {
  return data.prices.map(p => ({
    t: p[0], v: p[1],
    f: intraday
      ? new Date(p[0]).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
      : new Date(p[0]).toLocaleDateString("es-ES"),
    vf: new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(p[1])
  }));
}

function loadBtcHistory() {
  fetch("https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=eur&days=365&interval=daily")
    .then(r => r.json())
    .then(data => { btcRaw = parseBtcPrices(data, false); renderBtc(30); })
    .catch(() => { document.getElementById("btc-date-display").textContent = "Error al cargar histórico."; });
}

function renderBtcAxes(data, minY, maxY) {
  const g = document.getElementById("btc-axes");
  if (!g) return;
  const ry = maxY === minY ? 1 : maxY - minY;
  let html = "";
  for (let i = 0; i < 5; i++) {
    const frac = i / 4;
    const val = minY + ry * frac;
    const yp = (260 - frac * 220).toFixed(1);
    const lbl = Math.abs(val) >= 1000
      ? (val / 1000).toFixed(1).replace(".", ",") + "k"
      : Math.round(val).toString();
    html += `<line x1="70" y1="${yp}" x2="980" y2="${yp}" stroke="#2a2d3a" stroke-width="1" stroke-dasharray="3 3"/>`;
    html += `<text x="984" y="${(parseFloat(yp) + 4).toFixed(1)}" text-anchor="start" font-size="10" fill="#6b7280">${lbl}</text>`;
  }
  const n = data.length;
  const step = Math.max(1, Math.floor(n / 5));
  const idxs = [];
  for (let i = 0; i < n; i += step) idxs.push(i);
  if (idxs[idxs.length - 1] !== n - 1) idxs.push(n - 1);
  idxs.forEach(i => {
    html += `<text x="${data[i].x.toFixed(1)}" y="295" text-anchor="middle" font-size="9" fill="#6b7280">${data[i].f}</text>`;
  });
  g.innerHTML = html;
}

function renderBtc(days) {
  if (!btcRaw.length) return;
  const maxT = Math.max(...btcRaw.map(d => d.t));
  btcActive = btcRaw.filter(d => d.t >= maxT - days * 86400000);
  if (!btcActive.length) return;
  const minX = Math.min(...btcActive.map(d => d.t)), maxX = Math.max(...btcActive.map(d => d.t));
  const minY = Math.min(...btcActive.map(d => d.v)), maxY = Math.max(...btcActive.map(d => d.v));
  const rx = maxX === minX ? 1 : maxX - minX, ry = maxY === minY ? 1 : maxY - minY;
  btcActive.forEach(d => { d.x = 70 + (d.t - minX) / rx * 910; d.y = 260 - (d.v - minY) / ry * 220; });
  let pl = `M ${btcActive[0].x} ${btcActive[0].y}`;
  for (let i = 1; i < btcActive.length; i++) pl += ` L ${btcActive[i].x} ${btcActive[i].y}`;
  document.getElementById("btc-chart-line").setAttribute("d", pl);
  document.getElementById("btc-chart-area").setAttribute("d", pl + ` L ${btcActive[btcActive.length - 1].x} 280 L ${btcActive[0].x} 280 Z`);
  const btcRef = document.getElementById("btc-ref-line");
  if (btcRef) { btcRef.setAttribute("y1", btcActive[0].y); btcRef.setAttribute("y2", btcActive[0].y); btcRef.style.display = "block"; }
  document.getElementById("btc-lbl-start").textContent = btcActive[0].f;
  document.getElementById("btc-lbl-end").textContent = btcActive[btcActive.length - 1].f;
  const btcDate = document.getElementById("btc-date-display");
  btcDate.textContent = `${btcActive[0].f} — ${btcActive[btcActive.length - 1].f}`;
  window.btcDefaultDateText = btcDate.textContent;
  const diff = btcActive[btcActive.length - 1].v - btcActive[0].v, pct = (diff / btcActive[0].v * 100);
  const signo = diff >= 0 ? "+" : "", color = diff >= 0 ? "#10b981" : "#ef4444";
  const rendEl = document.getElementById("btc-rendimiento-display");
  rendEl.textContent = `${signo}${formatEur(diff)} (${signo}${pct.toFixed(2).replace(".", ",")}%)`;
  rendEl.style.color = color;
  rendEl.style.background = diff >= 0 ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)";
  document.getElementById("btc-chart-line").setAttribute("stroke", color);
  document.getElementById("btc-grad-stop0").setAttribute("stop-color", color);
  document.getElementById("btc-dot").style.background = color;
  renderBtcAxes(btcActive, minY, maxY);
}

document.querySelectorAll(".tf-btn-btc").forEach(b => b.addEventListener("click", e => {
  document.querySelectorAll(".tf-btn-btc").forEach(x => x.classList.remove("active"));
  e.target.classList.add("active");
  const daysRaw = e.target.dataset.days;
  const days = parseInt(daysRaw);
  if (daysRaw === "max") {
    if (!btcMaxCached && typeof btcMaxData !== "undefined" && btcMaxData.length > 0) {
      btcMaxCached = btcMaxData.map(([t, v]) => ({
        t,
        v,
        f: new Date(t).toLocaleDateString("es-ES"),
        vf: new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
      }));
    }
    if (btcMaxCached) btcRaw = btcMaxCached;
    renderBtc(999999);
  } else if (days === 1) {
    document.getElementById("btc-date-display").textContent = "Cargando datos intradiarios...";
    fetch("https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=eur&days=1")
      .then(r => r.json())
      .then(data => {
        const intraday = parseBtcPrices(data, true);
        if (!intraday.length) return;
        const minX = Math.min(...intraday.map(d => d.t)), maxX = Math.max(...intraday.map(d => d.t));
        const minY = Math.min(...intraday.map(d => d.v)), maxY = Math.max(...intraday.map(d => d.v));
        const rx = maxX === minX ? 1 : maxX - minX, ry = maxY === minY ? 1 : maxY - minY;
        intraday.forEach(d => { d.x = 70 + (d.t - minX) / rx * 910; d.y = 260 - (d.v - minY) / ry * 220; });
        let pl = `M ${intraday[0].x} ${intraday[0].y}`;
        for (let i = 1; i < intraday.length; i++) pl += ` L ${intraday[i].x} ${intraday[i].y}`;
        const diff = intraday[intraday.length - 1].v - intraday[0].v, pct = (diff / intraday[0].v * 100);
        const signo = diff >= 0 ? "+" : "", color = diff >= 0 ? "#10b981" : "#ef4444";
        document.getElementById("btc-chart-line").setAttribute("d", pl);
        document.getElementById("btc-chart-line").setAttribute("stroke", color);
        document.getElementById("btc-chart-area").setAttribute("d", pl + ` L ${intraday[intraday.length - 1].x} 280 L ${intraday[0].x} 280 Z`);
        document.getElementById("btc-grad-stop0").setAttribute("stop-color", color);
        document.getElementById("btc-dot").style.background = color;
        const btcDate = document.getElementById("btc-date-display");
        btcDate.textContent = `Hoy (${intraday[0].f} — ${intraday[intraday.length - 1].f})`;
        window.btcDefaultDateText = btcDate.textContent;
        document.getElementById("btc-lbl-start").textContent = intraday[0].f;
        document.getElementById("btc-lbl-end").textContent = intraday[intraday.length - 1].f;
        const rendEl = document.getElementById("btc-rendimiento-display");
        rendEl.textContent = `${signo}${formatEur(diff)} (${signo}${pct.toFixed(2).replace(".", ",")}%)`;
        rendEl.style.color = color;
        rendEl.style.background = diff >= 0 ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)";
        btcActive = intraday;
        renderBtcAxes(intraday, minY, maxY);
        const btcRef = document.getElementById("btc-ref-line");
        if (btcRef) { btcRef.setAttribute("y1", intraday[0].y); btcRef.setAttribute("y2", intraday[0].y); btcRef.style.display = "block"; }
      }).catch(() => { document.getElementById("btc-date-display").textContent = "Error al cargar datos intradiarios."; });
  } else {
    renderBtc(days);
  }
}));

const btcSvg = document.getElementById("btc-svg-chart");
if (btcSvg) {
  btcSvg.addEventListener("mousemove", e => {
    if (!btcActive.length) return;
    const rect = btcSvg.getBoundingClientRect(), mx = ((e.clientX - rect.left) / rect.width) * 1000;
    let cl = btcActive[0], minD = Math.abs(cl.x - mx);
    for (let i = 1; i < btcActive.length; i++) { let d = Math.abs(btcActive[i].x - mx); if (d < minD) { minD = d; cl = btcActive[i]; } }
    document.getElementById("btc-v-line").setAttribute("x1", cl.x);
    document.getElementById("btc-v-line").setAttribute("x2", cl.x);
    document.getElementById("btc-v-line").style.display = "block";
    const btcDot = document.getElementById("btc-dot");
    btcDot.style.left = (cl.x / 1000 * 100) + "%"; btcDot.style.top = (cl.y / 300 * 100) + "%"; btcDot.style.display = "block";
    const vd = document.getElementById("btc-valor-display"), rd = document.getElementById("btc-rendimiento-display"), dd2 = document.getElementById("btc-date-display");
    if (vd) { vd.textContent = cl.vf + " €"; vd.style.display = "inline-block"; }
    if (dd2) dd2.textContent = cl.f;
    if (rd) rd.style.display = "none";
  });
  btcSvg.addEventListener("mouseleave", () => {
    document.getElementById("btc-v-line").style.display = "none";
    document.getElementById("btc-dot").style.display = "none";
    const vd = document.getElementById("btc-valor-display"), rd = document.getElementById("btc-rendimiento-display"), dd2 = document.getElementById("btc-date-display");
    if (vd) { vd.textContent = ""; vd.style.display = "none"; }
    if (dd2) dd2.textContent = window.btcDefaultDateText;
    if (rd) rd.style.display = "inline-block";
  });
}

initBtcWebSocket();
loadBtcHistory();
