// evoData is injected inline by generate.R before this script loads
const svgChart = document.getElementById("patrimonio-svg-chart");
const vLine = document.getElementById("interactive-v-line");
const iDot = document.getElementById("interactive-dot");
const valorDisplay = document.getElementById("evo-valor-display");
const dateDisplay = document.getElementById("evo-date-display");
const rendDisplay = document.getElementById("evo-rendimiento-display");
const evoDateTooltip = document.getElementById("evo-date-tooltip");

function renderChartAxes(data, minY, maxY, gid) {
  const g = document.getElementById(gid || "chart-axes");
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

function changeTimeframe(period) {
  if (!evoData || !evoData.length) return;
  const maxT = Math.max(...evoData.map(d => d.t)), day = 86400000;
  let cutoff = 0;
  if (period === "1D") cutoff = maxT - 1 * day;
  else if (period === "1W") cutoff = maxT - 7 * day;
  else if (period === "1M") cutoff = maxT - 30 * day;
  else if (period === "YTD") { const y = new Date(maxT).getFullYear(); cutoff = new Date(y, 0, 1).getTime(); }
  else if (period === "1Y") cutoff = maxT - 365 * day;
  const filtered = evoData.filter(d => d.t >= cutoff);
  if (!filtered.length) return;
  const minX = Math.min(...filtered.map(d => d.t)), maxX = Math.max(...filtered.map(d => d.t));
  const minY = Math.min(...filtered.map(d => d.v)), maxY = Math.max(...filtered.map(d => d.v));
  const rx = maxX === minX ? 1 : maxX - minX, ry = maxY === minY ? 1 : maxY - minY;
  filtered.forEach(d => { d.x = 70 + (d.t - minX) / rx * 910; d.y = 260 - (d.v - minY) / ry * 220; });
  let pl = `M ${filtered[0].x} ${filtered[0].y}`;
  for (let i = 1; i < filtered.length; i++) pl += ` L ${filtered[i].x} ${filtered[i].y}`;
  document.getElementById("chart-line").setAttribute("d", pl);
  document.getElementById("chart-area").setAttribute("d", pl + ` L ${filtered[filtered.length - 1].x} 280 L ${filtered[0].x} 280 Z`);
  const refLine = document.getElementById("evo-ref-line");
  if (refLine) { refLine.setAttribute("y1", filtered[0].y); refLine.setAttribute("y2", filtered[0].y); }
  document.getElementById("lbl-start-date").textContent = filtered[0].f;
  document.getElementById("lbl-end-date").textContent = filtered[filtered.length - 1].f;
  renderChartAxes(filtered, minY, maxY);
  const dd = document.getElementById("evo-date-display");
  dd.textContent = period === "MAX" ? `Desde el inicio (${filtered[0].f})` : `${filtered[0].f} — ${filtered[filtered.length - 1].f}`;
  window.evoDefaultDateText = dd.textContent;
  const diff = filtered[filtered.length - 1].v - filtered[0].v;
  const pct = filtered[0].v ? (diff / Math.abs(filtered[0].v) * 100) : 0;
  const signo = diff >= 0 ? "+" : "", color = diff >= 0 ? "#10b981" : "#ef4444";
  rendDisplay.textContent = `${signo}${formatEur(diff)} (${signo}${pct.toFixed(2).replace(".", ",")}%)`;
  rendDisplay.style.color = color;
  rendDisplay.style.background = diff >= 0 ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)";
  document.getElementById("chart-line").setAttribute("stroke", color);
  document.getElementById("chart-area-grad-stop0").setAttribute("stop-color", color);
  document.getElementById("interactive-dot").style.background = color;
  window.activeEvoData = filtered;
}

const evoPeriodSelect = document.getElementById("evo-period-select");
if (evoPeriodSelect) evoPeriodSelect.addEventListener("change", () => changeTimeframe(evoPeriodSelect.value));
window.activeEvoData = evoData;
window.evoDefaultDateText = dateDisplay ? dateDisplay.textContent : "";

// ── Gráfica de patrimonio neto (página Patrimonio): selector de periodo (desplegable) ──
function changeNetoTimeframe(period) {
  if (typeof netoHistData === "undefined" || !netoHistData.length) return;
  const maxT = Math.max(...netoHistData.map(d => d.t)), day = 86400000;
  let cutoff = 0;
  if (period === "1D") cutoff = maxT - 1 * day;
  else if (period === "1W") cutoff = maxT - 7 * day;
  else if (period === "1M") cutoff = maxT - 30 * day;
  else if (period === "YTD") { const y = new Date(maxT).getFullYear(); cutoff = new Date(y, 0, 1).getTime(); }
  else if (period === "1Y") cutoff = maxT - 365 * day;
  const filtered = netoHistData.filter(d => d.t >= cutoff).map(d => Object.assign({}, d));
  if (!filtered.length) return;
  const minX = Math.min(...filtered.map(d => d.t)), maxX = Math.max(...filtered.map(d => d.t));
  const minY = Math.min(...filtered.map(d => d.v)), maxY = Math.max(...filtered.map(d => d.v));
  const rx = maxX === minX ? 1 : maxX - minX, ry = maxY === minY ? 1 : maxY - minY;
  filtered.forEach(d => { d.x = 70 + (d.t - minX) / rx * 910; d.y = 260 - (d.v - minY) / ry * 220; });
  let pl = `M ${filtered[0].x} ${filtered[0].y}`;
  for (let i = 1; i < filtered.length; i++) pl += ` L ${filtered[i].x} ${filtered[i].y}`;
  document.getElementById("neto-chart-line").setAttribute("d", pl);
  document.getElementById("neto-chart-area").setAttribute("d", pl + ` L ${filtered[filtered.length - 1].x} 280 L ${filtered[0].x} 280 Z`);
  renderChartAxes(filtered, minY, maxY, "neto-chart-axes");
  const s0 = document.getElementById("neto-lbl-start"), s1 = document.getElementById("neto-lbl-end");
  if (s0) s0.textContent = filtered[0].f;
  if (s1) s1.textContent = filtered[filtered.length - 1].f;
  const diff = filtered[filtered.length - 1].v - filtered[0].v;
  const pct = filtered[0].v ? (diff / Math.abs(filtered[0].v) * 100) : 0;
  const signo = diff >= 0 ? "+" : "", color = diff >= 0 ? "#10b981" : "#ef4444";
  const rd = document.getElementById("neto-rend-display");
  if (rd) {
    rd.textContent = `${signo}${formatEur(diff)} (${signo}${pct.toFixed(2).replace(".", ",")}%)`;
    rd.style.color = color;
    rd.style.background = diff >= 0 ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)";
  }
  document.getElementById("neto-chart-line").setAttribute("stroke", color);
  document.querySelectorAll("#neto-area-grad stop").forEach(s => s.setAttribute("stop-color", color));
  const netoDot = document.getElementById("neto-dot");
  if (netoDot) netoDot.style.background = color;
  const dd = document.getElementById("neto-date-display");
  if (dd) {
    dd.textContent = period === "MAX" ? `Desde el inicio (${filtered[0].f})` : `${filtered[0].f} — ${filtered[filtered.length - 1].f}`;
    window.netoDefaultDateText = dd.textContent;
  }
  window.activeNetoData = filtered;
}
const netoPeriodSelect = document.getElementById("neto-period-select");
if (netoPeriodSelect) netoPeriodSelect.addEventListener("change", () => changeNetoTimeframe(netoPeriodSelect.value));
if (typeof netoHistData !== "undefined") window.activeNetoData = netoHistData;

if (svgChart && evoData.length) {
  svgChart.addEventListener("mousemove", e => {
    const rect = svgChart.getBoundingClientRect(), mx = ((e.clientX - rect.left) / rect.width) * 1000;
    const data = window.activeEvoData || evoData;
    let cl = data[0], minD = Math.abs(cl.x - mx);
    for (let i = 1; i < data.length; i++) { let d = Math.abs(data[i].x - mx); if (d < minD) { minD = d; cl = data[i]; } }
    vLine.setAttribute("x1", cl.x); vLine.setAttribute("x2", cl.x); vLine.style.display = "block";
    iDot.style.left = (cl.x / 1000 * 100) + "%"; iDot.style.top = (cl.y / 300 * 100) + "%"; iDot.style.display = "block";
    if (valorDisplay) { valorDisplay.textContent = cl.vf + " €"; valorDisplay.style.display = "inline-block"; }
    if (rendDisplay) rendDisplay.style.display = "none";
    if (evoDateTooltip) {
      const bx = cl.x / 1000 * rect.width;
      evoDateTooltip.textContent = cl.f;
      evoDateTooltip.style.left = Math.max(45, Math.min(rect.width * 0.984 - 46, bx)) + "px";
      evoDateTooltip.style.top = (268 / 300 * rect.height) + "px";
      evoDateTooltip.style.display = "";
    }
  });
  svgChart.addEventListener("mouseleave", () => {
    vLine.style.display = "none"; iDot.style.display = "none";
    if (valorDisplay) { valorDisplay.textContent = ""; valorDisplay.style.display = "none"; }
    if (rendDisplay) rendDisplay.style.display = "inline-block";
    if (evoDateTooltip) evoDateTooltip.style.display = "none";
  });
}

// ── Evolución de la cartera de inversiones ──
(function () {
  if (typeof invHistData === "undefined" || !invHistData.length) return;

  let invCompareActive = false;
  let activePeriod = "MAX";
  const hasBench = typeof benchInvHistData !== "undefined" && benchInvHistData.length > 0;

  function renderInvAxes(data, minY, maxY) {
    const g = document.getElementById("inv-chart-axes");
    if (!g) return;
    const ry = maxY === minY ? 1 : maxY - minY;
    let html = "";
    for (let i = 0; i < 5; i++) {
      const frac = i / 4, val = minY + ry * frac, yp = (260 - frac * 220).toFixed(1);
      const lbl = Math.abs(val) >= 1000 ? (val / 1000).toFixed(1).replace(".", ",") + "k" : Math.round(val).toString();
      html += `<line x1="70" y1="${yp}" x2="980" y2="${yp}" stroke="#2a2d3a" stroke-width="1" stroke-dasharray="3 3"/>`;
      html += `<text x="984" y="${(parseFloat(yp) + 4).toFixed(1)}" text-anchor="start" font-size="10" fill="#6b7280">${lbl}</text>`;
    }
    const n = data.length, step = Math.max(1, Math.floor(n / 5));
    const idxs = [];
    for (let i = 0; i < n; i += step) idxs.push(i);
    if (idxs[idxs.length - 1] !== n - 1) idxs.push(n - 1);
    idxs.forEach(i => { html += `<text x="${data[i].x.toFixed(1)}" y="295" text-anchor="middle" font-size="9" fill="#6b7280">${data[i].f}</text>`; });
    g.innerHTML = html;
  }

  function changeInvTimeframe(period, btnEl) {
    activePeriod = period;
    document.querySelectorAll(".tf-btn-inv").forEach(b => b.classList.remove("active"));
    if (btnEl) btnEl.classList.add("active");
    const maxT = Math.max(...invHistData.map(d => d.t)), day = 86400000;
    let cutoff = 0;
    if (period === "1D") cutoff = maxT - day;
    else if (period === "1W") cutoff = maxT - 7 * day;
    else if (period === "1M") cutoff = maxT - 30 * day;
    else if (period === "YTD") { const y = new Date(maxT).getFullYear(); cutoff = new Date(y, 0, 1).getTime(); }
    else if (period === "1Y") cutoff = maxT - 365 * day;

    const filtered = invHistData.filter(d => d.t >= cutoff);
    if (!filtered.length) return;

    const benchFiltered = (invCompareActive && hasBench)
      ? benchInvHistData.filter(d => d.t >= cutoff) : [];

    const minX = Math.min(...filtered.map(d => d.t)), maxX = Math.max(...filtered.map(d => d.t));
    const rx = maxX === minX ? 1 : maxX - minX;

    let minY, maxY;
    if (benchFiltered.length) {
      const allV = [...filtered.map(d => d.v), ...benchFiltered.map(d => d.v)];
      minY = Math.min(...allV); maxY = Math.max(...allV);
    } else {
      minY = Math.min(...filtered.map(d => d.v)); maxY = Math.max(...filtered.map(d => d.v));
    }
    const ry = maxY === minY ? 1 : maxY - minY;

    filtered.forEach(d => { d.x = 70 + (d.t - minX) / rx * 910; d.y = 260 - (d.v - minY) / ry * 220; });
    let pl = `M ${filtered[0].x} ${filtered[0].y}`;
    for (let i = 1; i < filtered.length; i++) pl += ` L ${filtered[i].x} ${filtered[i].y}`;
    document.getElementById("inv-chart-line").setAttribute("d", pl);
    document.getElementById("inv-chart-area").setAttribute("d", pl + ` L ${filtered[filtered.length - 1].x} 280 L ${filtered[0].x} 280 Z`);

    const benchLine = document.getElementById("inv-bench-line");
    if (benchLine) {
      if (benchFiltered.length) {
        benchFiltered.forEach(d => { d.x = 70 + (d.t - minX) / rx * 910; d.y = 260 - (d.v - minY) / ry * 220; });
        let bp = `M ${benchFiltered[0].x} ${benchFiltered[0].y}`;
        for (let i = 1; i < benchFiltered.length; i++) bp += ` L ${benchFiltered[i].x} ${benchFiltered[i].y}`;
        benchLine.setAttribute("d", bp);
        benchLine.style.display = "block";
      } else {
        benchLine.style.display = "none";
      }
    }
    window.activeBenchInvData = benchFiltered;

    const refLine = document.getElementById("inv-ref-line");
    if (refLine) { refLine.setAttribute("y1", filtered[0].y); refLine.setAttribute("y2", filtered[0].y); }
    document.getElementById("inv-lbl-start").textContent = filtered[0].f;
    document.getElementById("inv-lbl-end").textContent = filtered[filtered.length - 1].f;
    renderInvAxes(filtered, minY, maxY);

    const dd = document.getElementById("inv-date-display");
    dd.textContent = period === "MAX" ? `Desde el inicio (${filtered[0].f})` : `${filtered[0].f} — ${filtered[filtered.length - 1].f}`;
    window.invDefaultDateText = dd.textContent;

    const diff = filtered[filtered.length - 1].v - filtered[0].v;
    const pct = filtered[0].v ? (diff / Math.abs(filtered[0].v) * 100) : 0;
    const signo = diff >= 0 ? "+" : "", color = diff >= 0 ? "#10b981" : "#ef4444";
    const rd = document.getElementById("inv-rend-display");
    if (rd) {
      rd.textContent = `${signo}${formatEur(diff)} (${signo}${pct.toFixed(2).replace(".", ",")}%)`;
      rd.style.color = color; rd.style.background = diff >= 0 ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)";
    }
    document.getElementById("inv-chart-line").setAttribute("stroke", color);
    document.getElementById("inv-area-grad-stop0").setAttribute("stop-color", color);
    const dot = document.getElementById("inv-dot");
    if (dot) dot.style.background = color;

    // Benchmark return badge
    const brd = document.getElementById("inv-bench-rend-display");
    if (brd) {
      if (benchFiltered.length) {
        const bdiff = benchFiltered[benchFiltered.length - 1].v - benchFiltered[0].v;
        const bpct = benchFiltered[0].v ? (bdiff / Math.abs(benchFiltered[0].v) * 100) : 0;
        const bsigno = bdiff >= 0 ? "+" : "";
        brd.textContent = `MSCI ${bsigno}${formatEur(bdiff)} (${bsigno}${bpct.toFixed(2).replace(".", ",")}%)`;
        brd.style.display = "inline-block";
      } else {
        brd.style.display = "none";
      }
    }

    window.activeInvData = filtered;
  }

  document.querySelectorAll(".tf-btn-inv").forEach(b => b.addEventListener("click", e => changeInvTimeframe(e.target.dataset.period, e.target)));

  const compareBtn = document.getElementById("inv-compare-btn");
  if (compareBtn && hasBench) {
    compareBtn.addEventListener("click", () => {
      invCompareActive = !invCompareActive;
      compareBtn.classList.toggle("active", invCompareActive);
      const activeBtn = document.querySelector(".tf-btn-inv.active");
      changeInvTimeframe(activePeriod, activeBtn);
    });
  } else if (compareBtn) {
    compareBtn.style.display = "none";
  }

  window.activeInvData = invHistData;
  window.activeBenchInvData = [];
  const invSvg = document.getElementById("inv-svg-chart");
  const invVLine = document.getElementById("inv-v-line");
  const invDot = document.getElementById("inv-dot");
  const invValor = document.getElementById("inv-valor-display");
  const invDate = document.getElementById("inv-date-display");
  const invRend = document.getElementById("inv-rend-display");
  window.invDefaultDateText = invDate ? invDate.textContent : "";

  if (invSvg) {
    invSvg.addEventListener("mousemove", e => {
      const rect = invSvg.getBoundingClientRect(), mx = ((e.clientX - rect.left) / rect.width) * 1000;
      const data = window.activeInvData || invHistData;
      let cl = data[0], minD = Math.abs(cl.x - mx);
      for (let i = 1; i < data.length; i++) { const d = Math.abs(data[i].x - mx); if (d < minD) { minD = d; cl = data[i]; } }
      invVLine.setAttribute("x1", cl.x); invVLine.setAttribute("x2", cl.x); invVLine.style.display = "block";
      invDot.style.left = (cl.x / 1000 * 100) + "%"; invDot.style.top = (cl.y / 300 * 100) + "%"; invDot.style.display = "block";
      if (invValor) { invValor.textContent = cl.vf + " €"; invValor.style.display = "inline-block"; }
      if (invDate) invDate.textContent = cl.f;
      if (invRend) invRend.style.display = "none";
      const brd = document.getElementById("inv-bench-rend-display");
      if (brd && invCompareActive) brd.style.display = "none";
    });
    invSvg.addEventListener("mouseleave", () => {
      invVLine.style.display = "none"; invDot.style.display = "none";
      if (invValor) { invValor.textContent = ""; invValor.style.display = "none"; }
      if (invDate) invDate.textContent = window.invDefaultDateText;
      if (invRend) invRend.style.display = "inline-block";
      const brd = document.getElementById("inv-bench-rend-display");
      if (brd && invCompareActive && (window.activeBenchInvData || []).length) brd.style.display = "inline-block";
    });
  }
})();
