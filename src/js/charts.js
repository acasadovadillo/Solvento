/*
 * Solvento v2 — Gráfica de línea interactiva (evolución temporal).
 * SolventoCharts.mount(container, series, {color, label}) donde series = [[t_ms, v]].
 * Incluye selector de periodo (1M/3M/6M/1A/MAX), área+línea, y hover con línea
 * vertical, punto y tooltip (fecha + valor + variación desde el inicio del periodo).
 */
(function () {
  "use strict";
  const eurFmt = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
  const fmtEur = (x) => (isFinite(x) ? eurFmt.format(x) : "—");
  const fmtK = (x) => (Math.abs(x) >= 1000 ? (x / 1000).toFixed(1).replace(".", ",") + "k" : String(Math.round(x)));
  const fmtDate = (t) => new Date(t).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });

  const PERIODS = [
    ["1M", 30], ["3M", 91], ["6M", 182], ["1A", 365], ["MAX", Infinity],
  ];
  const PLOT = { x0: 10, x1: 940, y0: 20, y1: 270, W: 1000, H: 300 };

  function mount(container, series, opts) {
    opts = opts || {};
    const color = opts.color || "#10b981";
    series = (series || []).filter((p) => isFinite(p[0]) && isFinite(p[1]));
    if (series.length < 2) { container.innerHTML = '<div style="color:#6b7280;padding:2rem;text-align:center;font-size:0.85rem;">Sin datos suficientes para la gráfica</div>'; return; }

    const state = { period: "MAX" };

    container.innerHTML =
      `<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:0.75rem;margin-bottom:1rem;">
         <div>
           <div class="ch-badge" style="display:inline-block;font-size:1.05rem;font-weight:700;padding:0.3rem 0.75rem;border-radius:6px;"></div>
           <div class="ch-val" style="font-size:1.5rem;font-weight:800;color:#fff;letter-spacing:-0.02em;margin-top:0.35rem;"></div>
         </div>
         <div class="ch-periods" style="display:flex;gap:0.25rem;">
           ${PERIODS.map(([lbl]) => `<button data-p="${lbl}" style="background:transparent;border:1px solid #2a2d3a;border-radius:6px;color:#9ca3af;font-size:0.78rem;font-weight:600;padding:0.3rem 0.6rem;cursor:pointer;font-family:inherit;">${lbl}</button>`).join("")}
         </div>
       </div>
       <div class="ch-plot" style="position:relative;width:100%;">
         <svg viewBox="0 0 ${PLOT.W} ${PLOT.H}" width="100%" height="240" preserveAspectRatio="none" style="overflow:visible;display:block;cursor:crosshair;">
           <defs><linearGradient id="ch-grad-${opts.id || "x"}" x1="0" y1="0" x2="0" y2="1">
             <stop offset="0%" stop-color="${color}" stop-opacity="0.25"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/>
           </linearGradient></defs>
           <g class="ch-grid"></g>
           <path class="ch-area" fill="url(#ch-grad-${opts.id || "x"})"/>
           <path class="ch-line" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
           <line class="ch-vline" x1="0" y1="${PLOT.y0}" x2="0" y2="${PLOT.y1}" stroke="#6b7280" stroke-width="1" stroke-dasharray="3 3" style="display:none;"/>
           <rect class="ch-hit" x="0" y="0" width="${PLOT.W}" height="${PLOT.H}" fill="transparent"/>
         </svg>
         <div class="ch-dot" style="position:absolute;width:10px;height:10px;border-radius:50%;background:${color};border:2px solid #12141d;transform:translate(-50%,-50%);pointer-events:none;display:none;"></div>
         <div class="ch-tip" style="position:absolute;background:#000;color:#fff;font-size:0.72rem;font-weight:600;padding:0.3rem 0.55rem;border-radius:6px;border:1px solid #2a2d3a;pointer-events:none;white-space:nowrap;display:none;transform:transl(-50%,0);z-index:5;"></div>
       </div>
       <div class="ch-xlabels" style="display:flex;justify-content:space-between;margin-top:0.5rem;font-size:0.72rem;color:#4b5563;font-weight:500;"><span class="ch-x0"></span><span class="ch-x1"></span></div>`;

    const svg = container.querySelector("svg");
    const areaEl = container.querySelector(".ch-area");
    const lineEl = container.querySelector(".ch-line");
    const gridEl = container.querySelector(".ch-grid");
    const vline = container.querySelector(".ch-vline");
    const dot = container.querySelector(".ch-dot");
    const tip = container.querySelector(".ch-tip");
    const badge = container.querySelector(".ch-badge");
    const valEl = container.querySelector(".ch-val");
    let view = [];

    function xAt(i) { return PLOT.x0 + (view.length <= 1 ? 0 : i / (view.length - 1) * (PLOT.x1 - PLOT.x0)); }
    let vmin = 0, vmax = 1;
    function yAt(v) { return PLOT.y1 - (vmax === vmin ? 0.5 : (v - vmin) / (vmax - vmin)) * (PLOT.y1 - PLOT.y0); }

    function draw() {
      const now = Date.now();
      const days = PERIODS.find((p) => p[0] === state.period)[1];
      const cutoff = days === Infinity ? -Infinity : now - days * 864e5;
      view = series.filter((p) => p[0] >= cutoff);
      if (view.length < 2) view = series.slice(-2);
      vmin = Math.min(...view.map((p) => p[1]));
      vmax = Math.max(...view.map((p) => p[1]));
      if (vmax === vmin) { vmax += 1; vmin -= 1; }
      const pts = view.map((p, i) => [xAt(i), yAt(p[1])]);
      const d = "M " + pts.map((q) => q[0].toFixed(2) + " " + q[1].toFixed(2)).join(" L ");
      lineEl.setAttribute("d", d);
      areaEl.setAttribute("d", d + ` L ${PLOT.x1} ${PLOT.y1} L ${PLOT.x0} ${PLOT.y1} Z`);
      // grid + y labels (5)
      let g = "";
      for (let k = 0; k < 5; k++) {
        const f = k / 4, yy = PLOT.y1 - f * (PLOT.y1 - PLOT.y0), vv = vmin + f * (vmax - vmin);
        g += `<line x1="${PLOT.x0}" y1="${yy.toFixed(1)}" x2="${PLOT.x1}" y2="${yy.toFixed(1)}" stroke="#2a2d3a" stroke-width="1" stroke-dasharray="3 3"/>`;
        g += `<text x="${PLOT.x1 + 6}" y="${(yy + 4).toFixed(1)}" font-size="10" fill="#6b7280">${fmtK(vv)}</text>`;
      }
      gridEl.innerHTML = g;
      container.querySelector(".ch-x0").textContent = fmtDate(view[0][0]);
      container.querySelector(".ch-x1").textContent = fmtDate(view[view.length - 1][0]);
      const first = view[0][1], last = view[view.length - 1][1];
      const diff = last - first, pct = first !== 0 ? diff / Math.abs(first) * 100 : 0;
      const up = diff >= 0;
      badge.style.color = up ? "#10b981" : "#ef4444";
      badge.style.background = up ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)";
      badge.textContent = `${up ? "+" : ""}${fmtEur(diff)} (${up ? "+" : ""}${pct.toFixed(2).replace(".", ",")}%)`;
      valEl.textContent = fmtEur(last);
      container.querySelectorAll(".ch-periods button").forEach((b) => {
        const on = b.dataset.p === state.period;
        b.style.color = on ? "#fff" : "#9ca3af";
        b.style.borderColor = on ? "#4b5563" : "#2a2d3a";
        b.style.background = on ? "#1e2130" : "transparent";
      });
    }

    container.querySelectorAll(".ch-periods button").forEach((b) => {
      b.addEventListener("click", () => { state.period = b.dataset.p; hideHover(); draw(); });
    });

    function hideHover() { vline.style.display = "none"; dot.style.display = "none"; tip.style.display = "none"; }
    function onMove(ev) {
      const rect = svg.getBoundingClientRect();
      const px = (ev.clientX - rect.left) / rect.width * PLOT.W;
      // índice más cercano
      let i = Math.round((px - PLOT.x0) / (PLOT.x1 - PLOT.x0) * (view.length - 1));
      i = Math.max(0, Math.min(view.length - 1, i));
      const cx = xAt(i), cy = yAt(view[i][1]);
      vline.setAttribute("x1", cx); vline.setAttribute("x2", cx); vline.style.display = "";
      dot.style.display = "block"; dot.style.left = (cx / PLOT.W * 100) + "%"; dot.style.top = (cy / PLOT.H * 100) + "%";
      tip.style.display = "block";
      tip.innerHTML = `${fmtDate(view[i][0])} · <b>${fmtEur(view[i][1])}</b>`;
      const leftPct = Math.max(6, Math.min(94, cx / PLOT.W * 100));
      tip.style.left = leftPct + "%"; tip.style.top = "0px";
      tip.style.transform = "translate(-50%,-110%)";
    }
    svg.addEventListener("mousemove", onMove);
    svg.addEventListener("mouseleave", hideHover);

    draw();
  }

  window.SolventoCharts = { mount };
})();
