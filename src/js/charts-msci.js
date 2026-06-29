let msciActive = [];
window.msciDefaultDateText = "";

function renderMsciAxes(data, minY, maxY) {
  const g = document.getElementById("msci-axes");
  if (!g) return;
  const ry = maxY === minY ? 1 : maxY - minY;
  let html = "";
  for (let i = 0; i < 5; i++) {
    const frac = i / 4;
    const val = minY + ry * frac;
    const yp = (260 - frac * 220).toFixed(1);
    const lbl = Math.abs(val) >= 1000
      ? (val / 1000).toFixed(1).replace(".", ",") + "k"
      : val.toFixed(2).replace(".", ",");
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

function renderMsciChart(data) {
  if (!data.length) return;
  msciActive = data;
  const minX = Math.min(...data.map(d => d.t)), maxX = Math.max(...data.map(d => d.t));
  const minY = Math.min(...data.map(d => d.v)), maxY = Math.max(...data.map(d => d.v));
  const rx = maxX === minX ? 1 : maxX - minX;
  const ry = maxY === minY ? 1 : maxY - minY;
  data.forEach(d => { d.x = 70 + (d.t - minX) / rx * 910; d.y = 260 - (d.v - minY) / ry * 220; });
  let pl = `M ${data[0].x} ${data[0].y}`;
  for (let i = 1; i < data.length; i++) pl += ` L ${data[i].x} ${data[i].y}`;
  document.getElementById("msci-chart-line").setAttribute("d", pl);
  document.getElementById("msci-chart-area").setAttribute("d", pl + ` L ${data[data.length - 1].x} 280 L ${data[0].x} 280 Z`);
  const msciRef = document.getElementById("msci-ref-line");
  if (msciRef) { msciRef.setAttribute("y1", data[0].y); msciRef.setAttribute("y2", data[0].y); msciRef.style.display = "block"; }
  document.getElementById("msci-lbl-start").textContent = data[0].f;
  document.getElementById("msci-lbl-end").textContent = data[data.length - 1].f;
  const msciDate = document.getElementById("msci-date-display");
  msciDate.textContent = `${data[0].f} — ${data[data.length - 1].f}`;
  window.msciDefaultDateText = msciDate.textContent;
  const diff = data[data.length - 1].v - data[0].v, pct = (diff / data[0].v * 100);
  const signo = diff >= 0 ? "+" : "", color = diff >= 0 ? "#10b981" : "#ef4444";
  const rendEl = document.getElementById("msci-rendimiento-display");
  rendEl.textContent = `${signo}${diff.toFixed(2).replace(".", ",")} € (${signo}${pct.toFixed(2).replace(".", ",")}%)`;
  rendEl.style.color = color;
  rendEl.style.background = diff >= 0 ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)";
  document.getElementById("msci-chart-line").setAttribute("stroke", color);
  document.getElementById("msci-grad-stop0").setAttribute("stop-color", color);
  document.getElementById("msci-dot").style.background = color;
  renderMsciAxes(data, minY, maxY);
}

function clearMsciChart() {
  const ref = document.getElementById("msci-ref-line"); if (ref) ref.style.display = "none";
  document.getElementById("msci-chart-line").setAttribute("d", "");
  document.getElementById("msci-chart-area").setAttribute("d", "");
  document.getElementById("msci-axes").innerHTML = "";
  document.getElementById("msci-lbl-start").textContent = "";
  document.getElementById("msci-lbl-end").textContent = "";
  document.getElementById("msci-rendimiento-display").textContent = "—";
  document.getElementById("msci-date-display").textContent = "Sin datos disponibles.";
}

const DAYS_MAP = { "5d": 8, "1mo": 35, "3mo": 95, "6mo": 185, "1y": 370, "5y": Infinity };

function loadMsci(range, interval) {
  const isIntraday = interval === "5m";
  let parsed = [];

  if (isIntraday) {
    const src = (typeof msciIntradayData !== "undefined") ? msciIntradayData : [];
    parsed = src.map(([t, v]) => ({
      t, v,
      f: new Date(t).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }),
      vf: v.toFixed(2).replace(".", ",")
    }));
  } else {
    const src = (typeof msciHistoryData !== "undefined") ? msciHistoryData : [];
    const daysBack = DAYS_MAP[range] ?? 35;
    const cutoff = daysBack === Infinity ? 0 : Date.now() - daysBack * 86400000;
    const useLongFmt = (range === "6mo" || range === "1y" || range === "5y");
    const filtered = src.filter(([t]) => t >= cutoff);
    parsed = filtered.map(([t, v]) => ({
      t, v,
      f: useLongFmt
        ? new Date(t).toLocaleDateString("es-ES", { month: "short", year: "2-digit" })
        : new Date(t).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" }),
      vf: v.toFixed(2).replace(".", ",")
    }));
  }

  if (parsed.length) {
    renderMsciChart(parsed);
  } else {
    clearMsciChart();
  }
}

document.querySelectorAll(".tf-btn-msci").forEach(b => b.addEventListener("click", e => {
  document.querySelectorAll(".tf-btn-msci").forEach(x => x.classList.remove("active"));
  e.target.classList.add("active");
  loadMsci(e.target.dataset.range, e.target.dataset.interval);
}));

const msciSvg = document.getElementById("msci-svg-chart");
if (msciSvg) {
  msciSvg.addEventListener("mousemove", e => {
    if (!msciActive.length) return;
    const rect = msciSvg.getBoundingClientRect(), mx = ((e.clientX - rect.left) / rect.width) * 1000;
    let cl = msciActive[0], minD = Math.abs(cl.x - mx);
    for (let i = 1; i < msciActive.length; i++) { let d = Math.abs(msciActive[i].x - mx); if (d < minD) { minD = d; cl = msciActive[i]; } }
    document.getElementById("msci-v-line").setAttribute("x1", cl.x);
    document.getElementById("msci-v-line").setAttribute("x2", cl.x);
    document.getElementById("msci-v-line").style.display = "block";
    const msciDot = document.getElementById("msci-dot");
    msciDot.style.left = (cl.x / 1000 * 100) + "%"; msciDot.style.top = (cl.y / 300 * 100) + "%"; msciDot.style.display = "block";
    const vd = document.getElementById("msci-valor-display"), rd = document.getElementById("msci-rendimiento-display"), dd2 = document.getElementById("msci-date-display");
    if (vd) { vd.textContent = cl.vf + " €"; vd.style.display = "inline-block"; }
    if (dd2) dd2.textContent = cl.f;
    if (rd) rd.style.display = "none";
  });
  msciSvg.addEventListener("mouseleave", () => {
    document.getElementById("msci-v-line").style.display = "none";
    document.getElementById("msci-dot").style.display = "none";
    const vd = document.getElementById("msci-valor-display"), rd = document.getElementById("msci-rendimiento-display"), dd2 = document.getElementById("msci-date-display");
    if (vd) { vd.textContent = ""; vd.style.display = "none"; }
    if (dd2) dd2.textContent = window.msciDefaultDateText;
    if (rd) rd.style.display = "inline-block";
  });
}

loadMsci("1mo", "1d");
