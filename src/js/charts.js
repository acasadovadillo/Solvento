/*
 * Solvento — Gráfica de línea interactiva (evolución temporal).
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
    const color = opts.color || "var(--verde)";
    series = (series || []).filter((p) => isFinite(p[0]) && isFinite(p[1]));
    if (series.length < 2) { container.innerHTML = '<div style="color:var(--t2);padding:2rem;text-align:center;font-size:0.85rem;">Sin datos suficientes para la gráfica</div>'; return; }

    const state = { period: "MAX", custom: null };
    const uid = opts.id || "x";

    container.innerHTML =
      `<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:0.75rem;margin-bottom:1rem;">
         <div>
           <div class="ch-badge" style="display:inline-block;font-size:1.05rem;font-weight:700;padding:0.3rem 0.75rem;border-radius:6px;"></div>
           <div class="ch-val" style="font-size:1.5rem;font-weight:800;color:var(--t0);letter-spacing:-0.02em;margin-top:0.35rem;"></div>
         </div>
         <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;justify-content:flex-end;">
           <span class="ch-custom" style="display:none;align-items:center;gap:0.4rem;background:var(--f4);border:1px solid var(--t3);border-radius:6px;padding:0.25rem 0.35rem 0.25rem 0.6rem;font-size:0.72rem;color:var(--t1);font-weight:600;white-space:nowrap;">
             <span class="ch-custom-lbl"></span>
             <button class="ch-custom-x" title="Quitar el zoom" style="background:none;border:none;color:var(--t1b);cursor:pointer;font-size:0.8rem;padding:0 0.15rem;line-height:1;font-family:inherit;">✕</button>
           </span>
           <div class="ch-periods" style="display:flex;gap:0.25rem;">
             ${PERIODS.map(([lbl]) => `<button data-p="${lbl}" style="background:transparent;border:1px solid var(--b2);border-radius:6px;color:var(--t1b);font-size:0.78rem;font-weight:600;padding:0.3rem 0.6rem;cursor:pointer;font-family:inherit;">${lbl}</button>`).join("")}
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
           <line class="ch-vline" x1="0" y1="${PLOT.y0}" x2="0" y2="${PLOT.y1}" stroke="var(--t2)" stroke-width="1" stroke-dasharray="3 3" style="display:none;"/>
           <rect class="ch-hit" x="0" y="0" width="${PLOT.W}" height="${PLOT.H}" fill="transparent"/>
         </svg>
         <div class="ch-sel" style="position:absolute;top:0;bottom:0;background:rgba(139,92,246,0.16);border-left:1px solid var(--violeta);border-right:1px solid var(--violeta);pointer-events:none;display:none;"></div>
         <div class="ch-dot" style="position:absolute;width:10px;height:10px;border-radius:50%;background:${color};border:2px solid var(--f1);transform:translate(-50%,-50%);pointer-events:none;display:none;"></div>
         <div class="ch-tip" style="position:absolute;background:var(--tip-bg);color:var(--tip-t);font-size:0.72rem;font-weight:600;padding:0.3rem 0.55rem;border-radius:6px;border:1px solid var(--b2);pointer-events:none;white-space:nowrap;display:none;z-index:5;"></div>
       </div>
       <div class="ch-axis" title="Arrastra sobre las fechas para ampliar ese periodo"
            style="position:relative;height:26px;margin-top:0.35rem;cursor:ew-resize;user-select:none;touch-action:pan-y;border-top:1px solid var(--b2);">
         <div class="ch-axis-sel" style="position:absolute;top:0;bottom:0;background:rgba(139,92,246,0.25);pointer-events:none;display:none;"></div>
         <div class="ch-ticks" style="position:absolute;inset:0;font-size:0.72rem;color:var(--t3);font-weight:500;"></div>
       </div>
       <div class="ch-hint" style="font-size:0.68rem;color:var(--t4);margin-top:0.3rem;">Arrastra sobre el eje de fechas para ampliar un periodo</div>`;

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
        g += `<line x1="${PLOT.x0}" y1="${yy.toFixed(1)}" x2="${PLOT.x1}" y2="${yy.toFixed(1)}" stroke="var(--b2)" stroke-width="1" stroke-dasharray="3 3"/>`;
        g += `<text x="${PLOT.x1 + 6}" y="${(yy + 4).toFixed(1)}" font-size="10" fill="var(--t2)">${fmtK(vv)}</text>`;
      }
      gridEl.innerHTML = g;
      drawTicks();
      const first = view[0][1], last = view[view.length - 1][1];
      const diff = last - first, pct = first !== 0 ? diff / Math.abs(first) * 100 : 0;
      const up = diff >= 0;
      badge.style.color = up ? "var(--verde)" : "var(--rojo)";
      badge.style.background = up ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)";
      badge.textContent = `${up ? "+" : ""}${fmtEur(diff)} (${up ? "+" : ""}${pct.toFixed(2).replace(".", ",")}%)`;
      valEl.textContent = fmtEur(last);
      // chip de periodo personalizado
      chipEl.style.display = state.custom ? "inline-flex" : "none";
      if (state.custom) chipLbl.textContent = `${fmtDate(view[0][0])} – ${fmtDate(view[view.length - 1][0])}`;
      container.querySelectorAll(".ch-periods button").forEach((b) => {
        const on = !state.custom && b.dataset.p === state.period;
        b.style.color = on ? "var(--t0)" : "var(--t1b)";
        b.style.borderColor = on ? "var(--t3)" : "var(--b2)";
        b.style.background = on ? "var(--f4)" : "transparent";
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
      if (!rect.width) return null;          // aún sin layout: evita dividir por 0
      return (ev.clientX - rect.left) / rect.width * PLOT.W;
    }
    const idxFromPx = (px) => {
      if (px == null || !isFinite(px)) return 0;
      const i = Math.round((px - PLOT.x0) / (PLOT.x1 - PLOT.x0) * (view.length - 1));
      return isFinite(i) ? Math.max(0, Math.min(view.length - 1, i)) : 0;
    };

    function onMove(ev) {
      if (drag) return;                      // durante la selección no hay hover
      const px = pxFrom(ev, svg);
      if (px == null) return;
      const i = idxFromPx(px);
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
      const px = pxFrom(ev, el);
      if (px == null) return;
      drag = { a: px, b: px, el };
      hideHover(); pintarSel();
      try { el.setPointerCapture(ev.pointerId); } catch (e) {}
      ev.preventDefault();
    }
    function mover(ev) { if (!drag) return; const px = pxFrom(ev, drag.el); if (px == null) return; drag.b = px; pintarSel(); }
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

/*
 * Solvento — Comparativa multi-línea de rentabilidad.
 * SolventoCharts.mountMulti(container, series, {meses}) donde
 * series = [{key, label, puntos: [[t, pct|null]], destacada}].
 * Una línea por activo, con leyenda clicable para mostrar/ocultar cada uno.
 *
 * Mismo zoom por arrastre que la gráfica de evolución: se arrastra sobre el eje
 * de meses (o sobre la propia gráfica) y la ventana se estrecha a ese tramo. La
 * escala vertical se recalcula con lo que queda dentro, así que un tramo plano
 * se despliega en vez de seguir aplastado; "✕" devuelve la serie entera.
 */
(function () {
  "use strict";
  const CFG = window.SolventoConfig;
  const fmtPct = (x) => (isFinite(x) ? (x >= 0 ? "+" : "") + x.toFixed(2).replace(".", ",") + "%" : "—");
  const fmtMes = (t) => new Date(t).toLocaleDateString("es-ES", { month: "short", year: "2-digit" });
  const fmtDia = (t) => new Date(t).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const P = { x0: 10, x1: 940, y0: 16, y1: 264, W: 1000, H: 300 };

  const MIN_DRAG = 8;   // en unidades del viewBox: por debajo es un clic, no una selección

  function mountMulti(container, series, opts) {
    opts = opts || {};
    series = (series || []).filter((s) => s.puntos && s.puntos.length);
    if (!series.length) {
      container.innerHTML = '<div style="color:var(--t2);padding:2rem;text-align:center;font-size:0.85rem;">Sin datos suficientes para comparar</div>';
      return;
    }
    const pal = CFG.SERIE_COLORES;
    series.forEach((s, i) => { s.color = s.destacada ? "var(--t0)" : pal[i % pal.length]; });
    const n = series[0].puntos.length;
    const hidden = new Set();
    // Ventana de meses visible. Arrastrando se estrecha; el ✕ la devuelve entera.
    // Puede venir dada (opts.ventana) para no perder el zoom al remontar la
    // gráfica, y se avisa de cada cambio por opts.onVentana.
    let i0 = 0, i1 = n - 1;
    if (opts.ventana && n > 1) {
      const a = Math.max(0, Math.min(n - 2, opts.ventana[0] | 0));
      const b = Math.max(a + 1, Math.min(n - 1, opts.ventana[1] | 0));
      i0 = a; i1 = b;
    }
    const avisarVentana = () => {
      if (typeof opts.onVentana === "function") opts.onVentana(i0 > 0 || i1 < n - 1 ? [i0, i1] : null);
    };

    container.innerHTML =
      `<div class="cm-plot" style="position:relative;width:100%;touch-action:pan-y;cursor:ew-resize;">
         <svg viewBox="0 0 ${P.W} ${P.H}" width="100%" height="260" preserveAspectRatio="none" style="overflow:visible;display:block;">
           <g class="cm-grid"></g>
           <g class="cm-lines"></g>
           <line class="cm-vline" x1="0" y1="${P.y0}" x2="0" y2="${P.y1}" stroke="var(--t2)" stroke-width="1" stroke-dasharray="3 3" style="display:none;"/>
           <rect class="cm-hit" x="0" y="0" width="${P.W}" height="${P.H}" fill="transparent"/>
         </svg>
         <div class="cm-sel" style="position:absolute;top:0;bottom:0;background:rgba(139,92,246,0.18);border-left:1px solid rgba(139,92,246,0.6);border-right:1px solid rgba(139,92,246,0.6);pointer-events:none;display:none;"></div>
         <div class="cm-tip" style="position:absolute;background:var(--tip-bg);color:var(--tip-t);font-size:0.72rem;padding:0.45rem 0.6rem;border-radius:8px;border:1px solid var(--b2);pointer-events:none;white-space:nowrap;display:none;z-index:6;line-height:1.5;"></div>
       </div>
       <div class="cm-xwrap" title="Arrastra sobre las fechas para ampliar ese periodo"
            style="position:relative;margin-top:0.4rem;padding:0.15rem 0;cursor:ew-resize;touch-action:pan-y;">
         <div class="cm-x" style="display:flex;justify-content:space-between;font-size:0.72rem;color:var(--t3);font-weight:500;"></div>
         <div class="cm-x-sel" style="position:absolute;top:0;bottom:0;background:rgba(139,92,246,0.25);pointer-events:none;display:none;"></div>
       </div>
       <div class="cm-leg" style="display:flex;flex-wrap:wrap;gap:0.4rem;margin-top:1rem;"></div>
       <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;margin-top:0.7rem;">
         <span class="cm-zoom" style="display:none;align-items:center;gap:0.4rem;background:var(--f4);border:1px solid var(--t3);border-radius:6px;padding:0.22rem 0.3rem 0.22rem 0.6rem;font-size:0.7rem;color:var(--t1);font-weight:600;white-space:nowrap;">
           <span class="cm-zoom-lbl"></span>
           <button class="cm-zoom-x" title="Quitar el zoom" style="background:none;border:none;color:var(--t1b);cursor:pointer;font-size:0.78rem;padding:0 0.15rem;line-height:1;font-family:inherit;">✕</button>
         </span>
         <button class="cm-todos" style="background:none;border:1px solid var(--b2);border-radius:6px;color:var(--t1b);font-size:0.7rem;font-weight:600;padding:0.22rem 0.6rem;cursor:pointer;font-family:inherit;">Ver todos</button>
         <span style="font-size:0.68rem;color:var(--t4);">Clic para ocultar · doble clic para ver solo uno · arrastra para ampliar</span>
       </div>`;

    const svg = container.querySelector("svg");
    const gridEl = container.querySelector(".cm-grid");
    const linesEl = container.querySelector(".cm-lines");
    const vline = container.querySelector(".cm-vline");
    const tip = container.querySelector(".cm-tip");
    const legEl = container.querySelector(".cm-leg");
    const xEl = container.querySelector(".cm-x");
    const plotEl = container.querySelector(".cm-plot");
    const xwrapEl = container.querySelector(".cm-xwrap");
    const selPlot = container.querySelector(".cm-sel");
    const selAxis = container.querySelector(".cm-x-sel");
    const zoomEl = container.querySelector(".cm-zoom");
    const zoomLbl = container.querySelector(".cm-zoom-lbl");

    // El eje X ya no recorre siempre la serie entera, sino la ventana [i0, i1]
    const xAt = (i) => P.x0 + (i1 <= i0 ? 0 : (i - i0) / (i1 - i0) * (P.x1 - P.x0));
    let vmin = -1, vmax = 1;
    const yAt = (v) => P.y1 - (vmax === vmin ? 0.5 : (v - vmin) / (vmax - vmin)) * (P.y1 - P.y0);

    function visibles() { return series.filter((s) => !hidden.has(s.key)); }
    const valorEn = (s, i) => {
      const p = s.puntos[i];
      const v = p ? p[1] : null;
      return v != null && isFinite(v) ? v : null;
    };

    function draw() {
      const vis = visibles();
      const vals = [];
      // La escala vertical se calcula solo con lo que entra en la ventana: al
      // ampliar un tramo plano, ese tramo se despliega en vez de quedar aplastado.
      vis.forEach((s) => { for (let i = i0; i <= i1; i++) { const v = valorEn(s, i); if (v != null) vals.push(v); } });
      if (!vals.length) { vmin = -1; vmax = 1; } else {
        vmin = Math.min(...vals); vmax = Math.max(...vals);
        const pad = (vmax - vmin) * 0.08 || 1;
        vmin -= pad; vmax += pad;
      }
      // rejilla + eje Y en %
      let g = "";
      for (let k = 0; k < 5; k++) {
        const f = k / 4, yy = P.y1 - f * (P.y1 - P.y0), vv = vmin + f * (vmax - vmin);
        g += `<line x1="${P.x0}" y1="${yy.toFixed(1)}" x2="${P.x1}" y2="${yy.toFixed(1)}" stroke="var(--b2)" stroke-width="1" stroke-dasharray="3 3"/>`;
        g += `<text x="${P.x1 + 6}" y="${(yy + 4).toFixed(1)}" font-size="10" fill="var(--t2)">${vv.toFixed(0)}%</text>`;
      }
      // línea del 0% (referencia: ni ganas ni pierdes)
      if (vmin < 0 && vmax > 0) {
        const y0 = yAt(0);
        g += `<line x1="${P.x0}" y1="${y0.toFixed(1)}" x2="${P.x1}" y2="${y0.toFixed(1)}" stroke="var(--t2)" stroke-width="1"/>`;
      }
      gridEl.innerHTML = g;
      // líneas (se cortan donde no hay posición)
      linesEl.innerHTML = vis.map((s) => {
        let d = "", abierto = false;
        for (let i = i0; i <= i1; i++) {
          const v = valorEn(s, i);
          if (v == null) { abierto = false; continue; }
          d += (abierto ? " L " : " M ") + xAt(i).toFixed(2) + " " + yAt(v).toFixed(2);
          abierto = true;
        }
        if (!d) return "";
        return `<path d="${d.trim()}" fill="none" stroke="${s.color}" stroke-width="${s.destacada ? 3 : 1.8}"
          stroke-linecap="round" stroke-linejoin="round" opacity="${s.destacada ? 1 : 0.9}"/>`;
      }).join("");
      // Leyenda ordenada por resultado, con la cifra al lado: así se lee quién va
      // mejor sin tener que rastrear las líneas por el gráfico. La cifra es la del
      // final de la ventana, para que concuerde con donde acaba la línea dibujada.
      const ultimoDe = (s) => {
        for (let i = i1; i >= i0; i--) { const v = valorEn(s, i); if (v != null) return v; }
        return null;
      };
      const ordenadas = series.slice().sort((a, b) => {
        if (a.destacada !== b.destacada) return a.destacada ? -1 : 1;
        return (ultimoDe(b) ?? -Infinity) - (ultimoDe(a) ?? -Infinity);
      });
      legEl.innerHTML = ordenadas.map((s) => {
        const off = hidden.has(s.key);
        const v = ultimoDe(s);
        const corta = s.label.length > 24 ? s.label.slice(0, 23) + "…" : s.label;
        return `<button data-k="${esc(s.key)}" title="${esc(s.label)} · clic para ocultar, doble clic para ver solo este"
          style="display:inline-flex;align-items:center;gap:0.4rem;background:${off ? "transparent" : "var(--f4)"};
          border:1px solid ${off ? "var(--b2)" : "var(--b3)"};border-radius:999px;padding:0.28rem 0.7rem;cursor:pointer;font-family:inherit;
          font-size:0.74rem;font-weight:600;color:${off ? "var(--t3)" : "var(--t1)"};${off ? "text-decoration:line-through;" : ""}">
          <span style="width:9px;height:9px;border-radius:50%;background:${s.color};flex-shrink:0;opacity:${off ? 0.35 : 1};"></span>${esc(corta)}
          ${v != null && !off ? `<b style="color:${v >= 0 ? "var(--verde)" : "var(--rojo)"};font-weight:700;">${fmtPct(v)}</b>` : ""}</button>`;
      }).join("");
      legEl.querySelectorAll("button").forEach((b) => {
        const k = b.dataset.k;
        b.addEventListener("click", () => {
          if (hidden.has(k)) hidden.delete(k); else hidden.add(k);
          ocultarTip(); draw();
        });
        // Doble clic: dejar solo ese activo, o restaurar todos si ya estaba solo
        b.addEventListener("dblclick", (ev) => {
          ev.preventDefault();
          const soloEste = series.length - hidden.size === 1 && !hidden.has(k);
          hidden.clear();
          if (!soloEste) series.forEach((s) => { if (s.key !== k) hidden.add(s.key); });
          ocultarTip(); draw();
        });
      });
      const ms = opts.meses || [];
      if (ms.length) xEl.innerHTML = `<span>${fmtMes(ms[i0])}</span><span>${fmtMes(ms[i1])}</span>`;
      const ampliado = i0 > 0 || i1 < n - 1;
      zoomEl.style.display = ampliado ? "inline-flex" : "none";
      if (ampliado && ms.length) zoomLbl.textContent = `${fmtMes(ms[i0])} – ${fmtMes(ms[i1])}`;
    }

    function ocultarTip() { vline.style.display = "none"; tip.style.display = "none"; }

    // ── Hover ──
    svg.addEventListener("mousemove", (ev) => {
      if (drag) return;                      // durante la selección no hay hover
      const vis = visibles();
      if (!vis.length) return;
      const px = pxDesde(ev, svg);
      if (px == null) return;
      const i = idxDesdePx(px);
      const cx = xAt(i);
      vline.setAttribute("x1", cx); vline.setAttribute("x2", cx); vline.style.display = "";
      const ms = opts.meses || [];
      const filas = vis
        .map((s) => ({ s, v: valorEn(s, i) }))
        .filter((x) => x.v != null)
        .sort((a, b) => b.v - a.v)
        .slice(0, 10)
        .map((x) => `<div style="display:flex;gap:0.5rem;justify-content:space-between;">
            <span style="color:${x.s.color};">■</span>
            <span style="flex:1;">${esc(x.s.label.length > 26 ? x.s.label.slice(0, 25) + "…" : x.s.label)}</span>
            <b style="color:${x.v >= 0 ? "var(--verde)" : "var(--rojo)"};">${fmtPct(x.v)}</b></div>`).join("");
      tip.innerHTML = `<div style="color:var(--t1b);margin-bottom:0.3rem;">${ms[i] ? fmtDia(ms[i]) : ""}</div>${filas || '<div style="color:var(--t2);">sin datos</div>'}`;
      tip.style.display = "block";
      const p = Math.max(4, Math.min(96, cx / P.W * 100));
      tip.style.left = p + "%";
      tip.style.top = "0px";
      tip.style.transform = `translate(${p > 55 ? "-100%" : "0"},0)`;
    });
    svg.addEventListener("mouseleave", ocultarTip);

    // ── Selección de intervalo por arrastre (eje de fechas y gráfica) ──
    function pxDesde(ev, el) {
      const rect = el.getBoundingClientRect();
      if (!rect.width) return null;          // aún sin layout: evita dividir por 0
      return (ev.clientX - rect.left) / rect.width * P.W;
    }
    const idxDesdePx = (px) => {
      if (px == null || !isFinite(px)) return i0;
      const k = Math.round((px - P.x0) / (P.x1 - P.x0) * (i1 - i0)) + i0;
      return isFinite(k) ? Math.max(i0, Math.min(i1, k)) : i0;
    };
    const pctOf = (u) => u / P.W * 100;

    let drag = null;
    function pintarSel() {
      const a = Math.min(drag.a, drag.b), b = Math.max(drag.a, drag.b);
      const l = pctOf(a) + "%", w = pctOf(b - a) + "%";
      [selPlot, selAxis].forEach((el) => { el.style.display = "block"; el.style.left = l; el.style.width = w; });
    }
    function ocultarSel() { [selPlot, selAxis].forEach((el) => (el.style.display = "none")); }

    function empezar(ev, el) {
      if (ev.button != null && ev.button !== 0) return;
      if (i1 - i0 < 2) return;               // ya no queda nada que estrechar
      const px = pxDesde(ev, el);
      if (px == null) return;
      drag = { a: px, b: px, el };
      ocultarTip(); pintarSel();
      try { el.setPointerCapture(ev.pointerId); } catch (e) {}
      ev.preventDefault();
    }
    function mover(ev) { if (!drag) return; const px = pxDesde(ev, drag.el); if (px == null) return; drag.b = px; pintarSel(); }
    function soltar() {
      if (!drag) return;
      const a = Math.min(drag.a, drag.b), b = Math.max(drag.a, drag.b);
      const suficiente = (b - a) >= MIN_DRAG;
      drag = null; ocultarSel();
      if (!suficiente) return;               // fue un clic, no una selección
      const ia = idxDesdePx(a), ib = idxDesdePx(b);
      if (ib - ia < 1) return;                // menos de dos meses: no se puede graficar
      i0 = ia; i1 = ib;
      avisarVentana(); ocultarTip(); draw();
    }
    [xwrapEl, plotEl].forEach((el) => {
      el.addEventListener("pointerdown", (ev) => empezar(ev, el));
      el.addEventListener("pointermove", mover);
      el.addEventListener("pointerup", soltar);
      el.addEventListener("pointercancel", () => { drag = null; ocultarSel(); });
    });

    container.querySelector(".cm-zoom-x").addEventListener("click", () => {
      i0 = 0; i1 = n - 1; avisarVentana(); ocultarTip(); draw();
    });

    const btnTodos = container.querySelector(".cm-todos");
    if (btnTodos) btnTodos.addEventListener("click", () => { hidden.clear(); ocultarTip(); draw(); });

    draw();
  }

  window.SolventoCharts.mountMulti = mountMulti;
})();
