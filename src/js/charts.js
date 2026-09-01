/*
 * Solvento v2 — Gráfica de línea interactiva (evolución temporal).
 * SolventoCharts.mount(container, series, {color, id}) donde series = [[t_ms, v]].
 *
 * Incluye:
 *   · Selector de periodo (1M/3M/6M/1A/MAX).
 *   · Área + línea, rejilla y etiquetas de valor.
 *   · Hover con línea vertical, punto y tooltip (fecha + valor).
 *   · ZOOM POR ARRASTRE: pulsa y arrastra sobre el eje de fechas (o sobre la
 *     propia gráfica) para quedarte con ese intervalo. Se puede encadenar para
 *     afinar, y "✕" o cualquier periodo lo restablece.
 */
(function () {
  "use strict";
  const eurFmt = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
  const fmtEur = (x) => (isFinite(x) ? eurFmt.format(x) : "—");
  const fmtK = (x) => (Math.abs(x) >= 1000 ? (x / 1000).toFixed(1).replace(".", ",") + "k" : String(Math.round(x)));
  const fmtDate = (t) => new Date(t).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
  // Etiqueta corta del eje: con día si el tramo es corto, mes+año si es largo
  const fmtTick = (t, spanDias) => new Date(t).toLocaleDateString("es-ES",
    spanDias <= 120 ? { day: "2-digit", month: "short" } : { month: "short", year: "2-digit" });

  const PERIODS = [["1M", 30], ["3M", 91], ["6M", 182], ["1A", 365], ["MAX", Infinity]];
  const PLOT = { x0: 10, x1: 940, y0: 20, y1: 270, W: 1000, H: 300 };
  const MIN_DRAG_PX = 8;   // por debajo de esto se considera un clic, no una selección

  function mount(container, series, opts) {
    opts = opts || {};
    const color = opts.color || "#10b981";
    series = (series || []).filter((p) => isFinite(p[0]) && isFinite(p[1]));
    if (series.length < 2) { container.innerHTML = '<div style="color:#6b7280;padding:2rem;text-align:center;font-size:0.85rem;">Sin datos suficientes para la gráfica</div>'; return; }

    const state = { period: "MAX", custom: null };
    const uid = opts.id || "x";

    container.innerHTML =
      `<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:0.75rem;margin-bottom:1rem;">
         <div>
           <div class="ch-badge" style="display:inline-block;font-size:1.05rem;font-weight:700;padding:0.3rem 0.75rem;border-radius:6px;"></div>
           <div class="ch-val" style="font-size:1.5rem;font-weight:800;color:#fff;letter-spacing:-0.02em;margin-top:0.35rem;"></div>
         </div>
         <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;justify-content:flex-end;">
           <span class="ch-custom" style="display:none;align-items:center;gap:0.4rem;background:#1e2130;border:1px solid #4b5563;border-radius:6px;padding:0.25rem 0.35rem 0.25rem 0.6rem;font-size:0.72rem;color:#e5e7eb;font-weight:600;white-space:nowrap;">
             <span class="ch-custom-lbl"></span>
             <button class="ch-custom-x" title="Quitar el zoom" style="background:none;border:none;color:#9ca3af;cursor:pointer;font-size:0.8rem;padding:0 0.15rem;line-height:1;font-family:inherit;">✕</button>
           </span>
           <div class="ch-periods" style="display:flex;gap:0.25rem;">
             ${PERIODS.map(([lbl]) => `<button data-p="${lbl}" style="background:transparent;border:1px solid #2a2d3a;border-radius:6px;color:#9ca3af;font-size:0.78rem;font-weight:600;padding:0.3rem 0.6rem;cursor:pointer;font-family:inherit;">${lbl}</button>`).join("")}
           </div>
         </div>
       </div>
       <div class="ch-plot" style="position:relative;width:100%;touch-action:pan-y;">
         <svg viewBox="0 0 ${PLOT.W} ${PLOT.H}" width="100%" height="240" preserveAspectRatio="none" style="overflow:visible;display:block;cursor:crosshair;">
           <defs><linearGradient id="ch-grad-${uid}" x1="0" y1="0" x2="0" y2="1">
             <stop offset="0%" stop-color="${color}" stop-opacity="0.25"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/>
           </linearGradient></defs>
           <g class="ch-grid"></g>
           <path class="ch-area" fill="url(#ch-grad-${uid})"/>
           <path class="ch-line" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
           <line class="ch-vline" x1="0" y1="${PLOT.y0}" x2="0" y2="${PLOT.y1}" stroke="#6b7280" stroke-width="1" stroke-dasharray="3 3" style="display:none;"/>
           <rect class="ch-hit" x="0" y="0" width="${PLOT.W}" height="${PLOT.H}" fill="transparent"/>
         </svg>
         <div class="ch-sel" style="position:absolute;top:0;bottom:0;background:rgba(139,92,246,0.16);border-left:1px solid #8b5cf6;border-right:1px solid #8b5cf6;pointer-events:none;display:none;"></div>
         <div class="ch-dot" style="position:absolute;width:10px;height:10px;border-radius:50%;background:${color};border:2px solid #12141d;transform:translate(-50%,-50%);pointer-events:none;display:none;"></div>
         <div class="ch-tip" style="position:absolute;background:#000;color:#fff;font-size:0.72rem;font-weight:600;padding:0.3rem 0.55rem;border-radius:6px;border:1px solid #2a2d3a;pointer-events:none;white-space:nowrap;display:none;z-index:5;"></div>
       </div>
       <div class="ch-axis" title="Arrastra sobre las fechas para ampliar ese periodo"
            style="position:relative;height:26px;margin-top:0.35rem;cursor:ew-resize;user-select:none;touch-action:pan-y;border-top:1px solid #2a2d3a;">
         <div class="ch-axis-sel" style="position:absolute;top:0;bottom:0;background:rgba(139,92,246,0.25);pointer-events:none;display:none;"></div>
         <div class="ch-ticks" style="position:absolute;inset:0;font-size:0.72rem;color:#4b5563;font-weight:500;"></div>
       </div>
       <div class="ch-hint" style="font-size:0.68rem;color:#374151;margin-top:0.3rem;">Arrastra sobre el eje de fechas para ampliar un periodo</div>`;

    const svg = container.querySelector("svg");
    const areaEl = container.querySelector(".ch-area");
    const lineEl = container.querySelector(".ch-line");
    const gridEl = container.querySelector(".ch-grid");
    const vline = container.querySelector(".ch-vline");
    const dot = container.querySelector(".ch-dot");
    const tip = container.querySelector(".ch-tip");
    const badge = container.querySelector(".ch-badge");
    const valEl = container.querySelector(".ch-val");
    const plotEl = container.querySelector(".ch-plot");
    const axisEl = container.querySelector(".ch-axis");
    const ticksEl = container.querySelector(".ch-ticks");
    const selPlot = container.querySelector(".ch-sel");
    const selAxis = container.querySelector(".ch-axis-sel");
    const chipEl = container.querySelector(".ch-custom");
    const chipLbl = container.querySelector(".ch-custom-lbl");
    let view = [];

    function xAt(i) { return PLOT.x0 + (view.length <= 1 ? 0 : i / (view.length - 1) * (PLOT.x1 - PLOT.x0)); }
    let vmin = 0, vmax = 1;
    function yAt(v) { return PLOT.y1 - (vmax === vmin ? 0.5 : (v - vmin) / (vmax - vmin)) * (PLOT.y1 - PLOT.y0); }
    const pctOf = (x) => x / PLOT.W * 100;

    function drawTicks() {
      const span = (view[view.length - 1][0] - view[0][0]) / 864e5;
      const n = Math.max(2, Math.min(5, view.length));
      let html = "";
      for (let k = 0; k < n; k++) {
        const i = Math.round(k / (n - 1) * (view.length - 1));
        const p = Math.max(2, Math.min(98, pctOf(xAt(i))));
        html += `<span style="position:absolute;top:5px;left:${p.toFixed(2)}%;transform:translateX(-50%);white-space:nowrap;">${fmtTick(view[i][0], span)}</span>`;
      }
      ticksEl.innerHTML = html;
    }

    function draw() {
      if (state.custom) {
        view = series.filter((p) => p[0] >= state.custom.t0 && p[0] <= state.custom.t1);
        if (view.length < 2) { state.custom = null; state.period = "MAX"; }
      }
      if (!state.custom) {
        const days = (PERIODS.find((p) => p[0] === state.period) || PERIODS[4])[1];
        const cutoff = days === Infinity ? -Infinity : Date.now() - days * 864e5;
        view = series.filter((p) => p[0] >= cutoff);
        if (view.length < 2) view = series.slice(-2);
      }
      vmin = Math.min(...view.map((p) => p[1]));
      vmax = Math.max(...view.map((p) => p[1]));
      if (vmax === vmin) { vmax += 1; vmin -= 1; }
      const pts = view.map((p, i) => [xAt(i), yAt(p[1])]);
      const d = "M " + pts.map((q) => q[0].toFixed(2) + " " + q[1].toFixed(2)).join(" L ");
      lineEl.setAttribute("d", d);
      areaEl.setAttribute("d", d + ` L ${PLOT.x1} ${PLOT.y1} L ${PLOT.x0} ${PLOT.y1} Z`);
      let g = "";
      for (let k = 0; k < 5; k++) {
        const f = k / 4, yy = PLOT.y1 - f * (PLOT.y1 - PLOT.y0), vv = vmin + f * (vmax - vmin);
        g += `<line x1="${PLOT.x0}" y1="${yy.toFixed(1)}" x2="${PLOT.x1}" y2="${yy.toFixed(1)}" stroke="#2a2d3a" stroke-width="1" stroke-dasharray="3 3"/>`;
        g += `<text x="${PLOT.x1 + 6}" y="${(yy + 4).toFixed(1)}" font-size="10" fill="#6b7280">${fmtK(vv)}</text>`;
      }
      gridEl.innerHTML = g;
      drawTicks();
      const first = view[0][1], last = view[view.length - 1][1];
      const diff = last - first, pct = first !== 0 ? diff / Math.abs(first) * 100 : 0;
      const up = diff >= 0;
      badge.style.color = up ? "#10b981" : "#ef4444";
      badge.style.background = up ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)";
      badge.textContent = `${up ? "+" : ""}${fmtEur(diff)} (${up ? "+" : ""}${pct.toFixed(2).replace(".", ",")}%)`;
      valEl.textContent = fmtEur(last);
      // chip de periodo personalizado
      chipEl.style.display = state.custom ? "inline-flex" : "none";
      if (state.custom) chipLbl.textContent = `${fmtDate(view[0][0])} – ${fmtDate(view[view.length - 1][0])}`;
      container.querySelectorAll(".ch-periods button").forEach((b) => {
        const on = !state.custom && b.dataset.p === state.period;
        b.style.color = on ? "#fff" : "#9ca3af";
        b.style.borderColor = on ? "#4b5563" : "#2a2d3a";
        b.style.background = on ? "#1e2130" : "transparent";
      });
    }

    container.querySelectorAll(".ch-periods button").forEach((b) => {
      b.addEventListener("click", () => { state.period = b.dataset.p; state.custom = null; hideHover(); draw(); });
    });
    container.querySelector(".ch-custom-x").addEventListener("click", () => {
      state.custom = null; state.period = "MAX"; hideHover(); draw();
    });

    // ── Hover ──
    function hideHover() { vline.style.display = "none"; dot.style.display = "none"; tip.style.display = "none"; }
    function pxFrom(ev, el) {
      const rect = el.getBoundingClientRect();
      return (ev.clientX - rect.left) / rect.width * PLOT.W;
    }
    const idxFromPx = (px) => Math.max(0, Math.min(view.length - 1,
      Math.round((px - PLOT.x0) / (PLOT.x1 - PLOT.x0) * (view.length - 1))));

    function onMove(ev) {
      if (drag) return;                      // durante la selección no hay hover
      const i = idxFromPx(pxFrom(ev, svg));
      const cx = xAt(i), cy = yAt(view[i][1]);
      vline.setAttribute("x1", cx); vline.setAttribute("x2", cx); vline.style.display = "";
      dot.style.display = "block"; dot.style.left = pctOf(cx) + "%"; dot.style.top = (cy / PLOT.H * 100) + "%";
      tip.style.display = "block";
      tip.innerHTML = `${fmtDate(view[i][0])} · <b>${fmtEur(view[i][1])}</b>`;
      tip.style.left = Math.max(6, Math.min(94, pctOf(cx))) + "%";
      tip.style.top = "0px";
      tip.style.transform = "translate(-50%,-110%)";
    }
    svg.addEventListener("mousemove", onMove);
    svg.addEventListener("mouseleave", hideHover);

    // ── Selección de intervalo por arrastre (eje de fechas y gráfica) ──
    let drag = null;
    function pintarSel() {
      const a = Math.min(drag.a, drag.b), b = Math.max(drag.a, drag.b);
      const l = pctOf(a) + "%", w = pctOf(b - a) + "%";
      [selPlot, selAxis].forEach((el) => { el.style.display = "block"; el.style.left = l; el.style.width = w; });
    }
    function ocultarSel() { [selPlot, selAxis].forEach((el) => (el.style.display = "none")); }

    function empezar(ev, el) {
      if (ev.button != null && ev.button !== 0) return;
      drag = { a: pxFrom(ev, el), b: pxFrom(ev, el), el };
      hideHover(); pintarSel();
      try { el.setPointerCapture(ev.pointerId); } catch (e) {}
      ev.preventDefault();
    }
    function mover(ev) { if (!drag) return; drag.b = pxFrom(ev, drag.el); pintarSel(); }
    function soltar() {
      if (!drag) return;
      const a = Math.min(drag.a, drag.b), b = Math.max(drag.a, drag.b);
      const suficiente = (b - a) >= MIN_DRAG_PX;
      drag = null; ocultarSel();
      if (!suficiente) return;                 // fue un clic, no una selección
      const ia = idxFromPx(a), ib = idxFromPx(b);
      if (ib - ia < 1) return;                 // menos de dos puntos: no se puede graficar
      state.custom = { t0: view[ia][0], t1: view[ib][0] };
      state.period = null;
      draw();
    }
    [axisEl, plotEl].forEach((el) => {
      el.addEventListener("pointerdown", (ev) => empezar(ev, el));
      el.addEventListener("pointermove", mover);
      el.addEventListener("pointerup", soltar);
      el.addEventListener("pointercancel", () => { drag = null; ocultarSel(); });
    });

    draw();
  }

  window.SolventoCharts = { mount };
})();
