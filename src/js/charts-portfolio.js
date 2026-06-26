let pfActive = [];
window.pfDefaultDateText = "";

const PF_DAYS_MAP = { "5d": 8, "1mo": 35, "3mo": 95, "6mo": 185, "1y": 370, "5y": Infinity };

function renderPfAxes(data, minY, maxY) {
  const g = document.getElementById("pf-axes");
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
  const n = data.length, step = Math.max(1, Math.floor(n / 5));
  const idxs = [];
  for (let i = 0; i < n; i += step) idxs.push(i);
  if (idxs[idxs.length - 1] !== n - 1) idxs.push(n - 1);
  idxs.forEach(i => {
    html += `<text x="${data[i].x.toFixed(1)}" y="295" text-anchor="middle" font-size="9" fill="#6b7280">${data[i].f}</text>`;
  });
  g.innerHTML = html;
}

function renderPfChart(data) {
  if (!data.length) return;
  pfActive = data;
  const minX = Math.min(...data.map(d => d.t)), maxX = Math.max(...data.map(d => d.t));
  const minY = Math.min(...data.map(d => d.v)), maxY = Math.max(...data.map(d => d.v));
  const rx = maxX === minX ? 1 : maxX - minX, ry = maxY === minY ? 1 : maxY - minY;
  data.forEach(d => { d.x = 70 + (d.t - minX) / rx * 910; d.y = 260 - (d.v - minY) / ry * 220; });
  let pl = `M ${data[0].x} ${data[0].y}`;
  for (let i = 1; i < data.length; i++) pl += ` L ${data[i].x} ${data[i].y}`;
  document.getElementById("pf-chart-line").setAttribute("d", pl);
  document.getElementById("pf-chart-area").setAttribute("d", pl + ` L ${data[data.length - 1].x} 280 L ${data[0].x} 280 Z`);
  const ref = document.getElementById("pf-ref-line");
  if (ref) { ref.setAttribute("y1", data[0].y); ref.setAttribute("y2", data[0].y); ref.style.display = "block"; }
  document.getElementById("pf-lbl-start").textContent = data[0].f;
  document.getElementById("pf-lbl-end").textContent = data[data.length - 1].f;
  const dateEl = document.getElementById("pf-date-display");
  dateEl.textContent = `${data[0].f} — ${data[data.length - 1].f}`;
  window.pfDefaultDateText = dateEl.textContent;
  const diff = data[data.length - 1].v - data[0].v, pct = (diff / data[0].v * 100);
  const signo = diff >= 0 ? "+" : "", color = diff >= 0 ? "#10b981" : "#ef4444";
  const rendEl = document.getElementById("pf-rendimiento-display");
  rendEl.textContent = `${signo}${diff.toFixed(2).replace(".", ",")} (${signo}${pct.toFixed(2).replace(".", ",")}%)`;
  rendEl.style.color = color;
  rendEl.style.background = diff >= 0 ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)";
  document.getElementById("pf-chart-line").setAttribute("stroke", color);
  document.getElementById("pf-grad-stop0").setAttribute("stop-color", color);
  document.getElementById("pf-dot").style.background = color;
  renderPfAxes(data, minY, maxY);
}

function clearPfChart() {
  const ref = document.getElementById("pf-ref-line"); if (ref) ref.style.display = "none";
  ["pf-chart-line", "pf-chart-area"].forEach(id => document.getElementById(id).setAttribute("d", ""));
  document.getElementById("pf-axes").innerHTML = "";
  document.getElementById("pf-lbl-start").textContent = "";
  document.getElementById("pf-lbl-end").textContent = "";
  document.getElementById("pf-rendimiento-display").textContent = "—";
  document.getElementById("pf-date-display").textContent = "Sin datos disponibles.";
}

function loadPf(range) {
  const sel = document.getElementById("portfolio-select");
  const asset = sel ? sel.value : "";
  const isIntraday = range === "1d";
  let parsed = [];

  if (isIntraday) {
    const src = (typeof portfolioIntradayData !== "undefined" && portfolioIntradayData[asset]) ? portfolioIntradayData[asset] : [];
    parsed = src.map(([t, v]) => ({
      t, v,
      f: new Date(t).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }),
      vf: v.toFixed(2).replace(".", ",")
    }));
  } else {
    const src = (typeof portfolioHistoryData !== "undefined" && portfolioHistoryData[asset]) ? portfolioHistoryData[asset] : [];
    const daysBack = PF_DAYS_MAP[range] ?? 35;
    const cutoff = daysBack === Infinity ? 0 : Date.now() - daysBack * 86400000;
    const useLongFmt = (range === "6mo" || range === "1y" || range === "5y");
    parsed = src
      .filter(([t]) => t >= cutoff)
      .map(([t, v]) => ({
        t, v,
        f: useLongFmt
          ? new Date(t).toLocaleDateString("es-ES", { month: "short", year: "2-digit" })
          : new Date(t).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" }),
        vf: v.toFixed(2).replace(".", ",")
      }));
  }

  const monedaEl = document.getElementById("portfolio-moneda");
  if (monedaEl && typeof portfolioCurrency !== "undefined") {
    monedaEl.textContent = portfolioCurrency[asset] || "—";
  }

  if (parsed.length) {
    renderPfChart(parsed);
  } else {
    clearPfChart();
  }
}

document.querySelectorAll(".tf-btn-pf").forEach(b => b.addEventListener("click", e => {
  document.querySelectorAll(".tf-btn-pf").forEach(x => x.classList.remove("active"));
  e.target.classList.add("active");
  loadPf(e.target.dataset.range);
}));

const pfSel = document.getElementById("portfolio-select");
if (pfSel) {
  pfSel.addEventListener("change", () => {
    const activeBtn = document.querySelector(".tf-btn-pf.active");
    loadPf(activeBtn ? activeBtn.dataset.range : "1mo");
  });
}

const pfSvg = document.getElementById("pf-svg-chart");
if (pfSvg) {
  pfSvg.addEventListener("mousemove", e => {
    if (!pfActive.length) return;
    const rect = pfSvg.getBoundingClientRect(), mx = ((e.clientX - rect.left) / rect.width) * 1000;
    let cl = pfActive[0], minD = Math.abs(cl.x - mx);
    for (let i = 1; i < pfActive.length; i++) { const d = Math.abs(pfActive[i].x - mx); if (d < minD) { minD = d; cl = pfActive[i]; } }
    document.getElementById("pf-v-line").setAttribute("x1", cl.x);
    document.getElementById("pf-v-line").setAttribute("x2", cl.x);
    document.getElementById("pf-v-line").style.display = "block";
    const dot = document.getElementById("pf-dot");
    dot.style.left = (cl.x / 1000 * 100) + "%"; dot.style.top = (cl.y / 300 * 100) + "%"; dot.style.display = "block";
    const vd = document.getElementById("pf-valor-display"), rd = document.getElementById("pf-rendimiento-display"), dd = document.getElementById("pf-date-display");
    if (vd) { vd.textContent = cl.vf; vd.style.display = "inline-block"; }
    if (dd) dd.textContent = cl.f;
    if (rd) rd.style.display = "none";
  });
  pfSvg.addEventListener("mouseleave", () => {
    document.getElementById("pf-v-line").style.display = "none";
    document.getElementById("pf-dot").style.display = "none";
    const vd = document.getElementById("pf-valor-display"), rd = document.getElementById("pf-rendimiento-display"), dd = document.getElementById("pf-date-display");
    if (vd) { vd.textContent = ""; vd.style.display = "none"; }
    if (dd) dd.textContent = window.pfDefaultDateText;
    if (rd) rd.style.display = "inline-block";
  });
}

loadPf("1mo");
