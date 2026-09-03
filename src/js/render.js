/*
 * Solvento v2 — Render (Fase 2): navegación por pestañas + páginas
 * (Patrimonio, Caja, Cartera, Inmuebles, Pasivos) con donuts, treemap y panel
 * de asignación, pintado desde el modelo (datos descifrados + prices.json).
 * Las gráficas de EVOLUCIÓN temporal llegan en el siguiente incremento (necesitan
 * histórico de precios).
 */
(function () {
  "use strict";
  const CFG = window.SolventoConfig;
  const R_DONUT = 15.91549430918954;

  const eurFmt = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
  const fmtEur = (x) => (isFinite(x) ? eurFmt.format(x) : "—");
  const fmtPct = (x) => (isFinite(x) ? (x >= 0 ? "+" : "") + x.toFixed(2).replace(".", ",") + "%" : "—");
  const pct1 = (x) => (isFinite(x) ? x.toFixed(1) : "0");
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const GREEN = "#10b981", RED = "#ef4444";
  const rc = (x) => (isFinite(x) && x < 0 ? RED : GREEN);
  const parseFechaES = (s) => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(s || "")); return m ? new Date(+m[3], +m[2] - 1, +m[1]) : new Date(0); };
  const addBtn = (label, onclick) => `<button onclick="${onclick}" style="background:#1e2130;border:1px solid #2a2d3a;border-radius:8px;color:#e5e7eb;font-size:0.8rem;font-weight:600;padding:0.4rem 0.75rem;cursor:pointer;font-family:inherit;white-space:nowrap;">${label}</button>`;
  const delBtn = (onclick) => `<button onclick="event.stopPropagation();${onclick}" title="Borrar" style="background:none;border:none;color:#6b7280;cursor:pointer;font-size:0.9rem;padding:0.2rem 0.4rem;">✕</button>`;
  const editBtn = (onclick) => `<button onclick="event.stopPropagation();${onclick}" title="Editar" style="background:none;border:none;color:#6b7280;cursor:pointer;font-size:0.85rem;padding:0.2rem 0.4rem;">✎</button>`;
  const rowActions = (edit, del) => `<td style="text-align:right;width:1%;white-space:nowrap;">${editBtn(edit)}${delBtn(del)}</td>`;

  function logoImg(nombre, isin, size) {
    const src = CFG.assetLogo(nombre, isin);
    const s = size || 22;
    return src
      ? `<img src="${src}" alt="" style="width:${s}px;height:${s}px;object-fit:contain;border-radius:5px;flex-shrink:0;">`
      : `<span style="display:inline-block;width:${s}px;height:${s}px;flex-shrink:0;"></span>`;
  }

  // ── Donut SVG (mismo método que la v1) ──
  function donut(items, centerValue, centerLabel) {
    const total = items.reduce((s, x) => s + (x.value > 0 ? x.value : 0), 0);
    let acum = 0;
    const sectors = items.map((it) => {
      const pct = total > 0 ? it.value / total * 100 : 0;
      const rot = acum * 3.6;
      acum += pct;
      return `<circle class="sector" cx="21" cy="21" r="${R_DONUT}" fill="transparent" stroke="${it.accent}" stroke-width="3"
        stroke-dasharray="${pct.toFixed(4)} ${(100 - pct).toFixed(4)}" stroke-dashoffset="25"
        style="transform:rotate(${rot.toFixed(2)}deg);transform-origin:center;"><title>${esc(it.label)}: ${fmtEur(it.value)} (${pct.toFixed(1)}%)</title></circle>`;
    }).join("");
    return `<div class="chart-wrapper">
        <svg class="donut" viewBox="0 0 42 42">${sectors}</svg>
        <div class="donut-center">
          <span style="font-size:1rem;font-weight:700;color:#fff;">${centerValue}</span>
          <span style="font-size:0.55rem;color:#6b7280;text-transform:uppercase;margin-top:0.2rem;">${esc(centerLabel)}</span>
        </div>
      </div>`;
  }
  function legend(items, total, targets) {
    return items.map((it) => {
      const p = total > 0 ? it.value / total * 100 : 0;
      let badge = "";
      if (targets && targets[it.label] != null) {
        const dev = p - targets[it.label];
        const dc = dev >= 0 ? GREEN : RED;
        badge = `<span style="font-size:0.68rem;color:${dc};background:${dc}22;padding:0.1rem 0.4rem;border-radius:4px;font-weight:600;margin-left:0.3rem;" title="Objetivo: ${targets[it.label].toFixed(0)}%">${dev >= 0 ? "+" : ""}${dev.toFixed(1)}pp</span>`;
      }
      return `<div style="display:flex;align-items:center;justify-content:space-between;gap:1.5rem;font-size:0.85rem;width:100%;max-width:280px;margin:0.3rem 0;">
        <div style="display:flex;align-items:center;gap:0.5rem;"><span style="width:9px;height:9px;background:${it.accent};border-radius:50%;flex-shrink:0;"></span><span style="color:#9ca3af;font-weight:500;">${esc(it.label)}</span>${badge}</div>
        <span style="text-align:right;"><span style="color:#fff;font-weight:600;display:block;line-height:1.2;">${fmtPct(p)}</span><span style="color:#6b7280;font-size:0.72rem;display:block;line-height:1.2;">${fmtEur(it.value)}</span></span>
      </div>`;
    }).join("");
  }
  function donutPanel(titulo, items, centerValue, centerLabel, total, targets) {
    return `<div class="v2-wrap"><div class="dashboard-panel">
      <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;margin-bottom:1.25rem;">${esc(titulo)}</div>
      <div style="display:flex;flex-direction:row;align-items:center;justify-content:center;gap:2rem;flex-wrap:wrap;">
        ${donut(items, centerValue, centerLabel)}
        <div style="display:flex;flex-direction:column;align-items:stretch;">${legend(items, total, targets)}</div>
      </div>
    </div></div>`;
  }

  // ── Treemap (squarify + color por rentabilidad), texto ajustado en runtime ──
  function squarify(values, x, y, w, h) {
    if (!values.length) return [];
    if (values.length === 1) return [[x, y, w, h]];
    const total = values.reduce((s, v) => s + v, 0);
    const area = w * h;
    let vals = total > 0 ? values.map((v) => v / total * area) : values.slice();
    const worst = (row, side) => {
      const rs = row.reduce((s, v) => s + v, 0);
      if (rs <= 0 || side <= 0) return Infinity;
      const s = rs / side;
      return Math.max(...row.map((v) => Math.max((s * s) / v, v / (s * s))));
    };
    const result = [];
    let remaining = vals.slice(), rx = x, ry = y, rw = w, rh = h;
    while (remaining.length) {
      const side = Math.min(rw, rh);
      let row = [remaining[0]], i = 1;
      while (i < remaining.length) {
        const trial = row.concat(remaining[i]);
        if (worst(trial, side) <= worst(row, side)) { row = trial; i++; } else break;
      }
      remaining = remaining.slice(row.length);
      const rsum = row.reduce((s, v) => s + v, 0);
      if (rw >= rh) {
        const cw = rh > 0 ? rsum / rh : 0; let cy = ry;
        for (const v of row) { const ch = cw > 0 ? v / cw : 0; result.push([rx, cy, cw, ch]); cy += ch; }
        rx += cw; rw -= cw;
      } else {
        const rowH = rw > 0 ? rsum / rw : 0; let cx = rx;
        for (const v of row) { const cwi = rowH > 0 ? v / rowH : 0; result.push([cx, ry, cwi, rowH]); cx += cwi; }
        ry += rowH; rh -= rowH;
      }
    }
    return result;
  }
  function colorTreemap(rentPct) {
    if (!isFinite(rentPct)) return "#3a3d4a";
    const capped = Math.max(-15, Math.min(15, rentPct));
    const t = Math.abs(capped) / 15;
    const [c0, c1] = capped >= 0 ? [[134, 239, 172], [22, 163, 74]] : [[252, 165, 165], [220, 38, 38]];
    const rgb = c0.map((c, i) => Math.round(c + (c1[i] - c0[i]) * t));
    return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  }
  function treemapPanel(assets) {
    const vis = assets.filter((a) => isFinite(a.importe) && a.pct > 0);
    if (!vis.length) return "";
    const rects = squarify(vis.map((a) => a.importe), 0, 0, 100, 100);
    const tiles = vis.map((a, i) => {
      const [tx, ty, tw, th] = rects[i];
      const color = colorTreemap(a.rentPct);
      const hover = !isFinite(a.rentPct) ? "#4b5563" : (a.rentPct >= 0 ? "#16a34a" : "#dc2626");
      const rentStr = isFinite(a.rentPct) ? (a.rentPct >= 0 ? "+" : "") + a.rentPct.toFixed(1) + "%" : "—";
      return `<div class="tm-tile" data-name="${esc(a.nombre)}" data-rent="${rentStr}" data-weight="${a.pct.toFixed(2).replace(".", ",")}%"
        data-bg="${color}" data-hover-bg="${hover}"
        style="position:absolute;left:${tx.toFixed(3)}%;top:${ty.toFixed(3)}%;width:${tw.toFixed(3)}%;height:${th.toFixed(3)}%;background:${color};border:1px solid #12141d;box-sizing:border-box;overflow:hidden;cursor:default;transition:background 0.15s;">
        <div class="tm-label" style="height:100%;box-sizing:border-box;padding:0.4rem 0.55rem;display:flex;flex-direction:column;justify-content:flex-end;">
          <div class="tm-name" style="font-weight:700;color:#0f1115;"></div>
          <div class="tm-rent" style="font-weight:700;color:#0f1115cc;margin-top:0.1rem;"></div>
        </div></div>`;
    }).join("");
    return `<div class="v2-wrap"><div class="dashboard-panel">
      <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;margin-bottom:1rem;">Mapa de la cartera · tamaño = peso, color = rentabilidad</div>
      <div class="tm-container" style="position:relative;width:100%;height:420px;border-radius:10px;overflow:hidden;">${tiles}
        <div class="tm-tooltip" style="position:absolute;display:none;background:#000;color:#fff;font-size:0.78rem;font-weight:600;padding:0.45rem 0.7rem;border-radius:6px;border:1px solid #2a2d3a;pointer-events:none;white-space:nowrap;z-index:20;box-shadow:0 4px 14px rgba(0,0,0,0.4);"></div>
      </div></div></div>`;
  }

  // ── Panel de asignación actual vs objetivo (RV/RF) ──
  function asignacionPanel(inv) {
    const OBJ = CFG.objetivo();
    const CATC = CFG.CAT_COLORES;
    const base = Object.keys(OBJ).reduce((s, c) => s + (inv.porCat[c] || 0), 0);
    const costeCat = {};
    inv.assets.forEach((a) => { if (OBJ[a.categoria] != null && isFinite(a.coste)) costeCat[a.categoria] = (costeCat[a.categoria] || 0) + a.coste; });
    const barra = (kind) => {
      const labels = [], segs = [];
      for (const cat in OBJ) {
        const pct = kind === "obj" ? OBJ[cat] : (base > 0 ? (inv.porCat[cat] || 0) / base * 100 : 0);
        const color = CATC[cat] || "#6b7280";
        labels.push(`<span style="color:${color};">${esc(cat)} · ${pct1(pct)}%</span>`);
        segs.push(`<div title="${esc(cat)}: ${pct1(pct)}%" style="width:${pct.toFixed(2)}%;background:${color};transition:width 0.4s;"></div>`);
      }
      return `<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:0.3rem 1rem;font-size:0.72rem;font-weight:600;margin-bottom:0.35rem;">${labels.join("")}</div>
        <div style="height:8px;border-radius:4px;overflow:hidden;display:flex;background:#12141d;">${segs.join("")}</div>`;
    };
    const tiles = Object.keys(OBJ).map((cat) => {
      const color = CATC[cat] || "#6b7280";
      const val = inv.porCat[cat] || 0;
      const coste = costeCat[cat] || 0;
      const rent = coste > 0 ? (val / coste - 1) * 100 : NaN;
      const gan = coste > 0 ? val - coste : NaN;
      const rentHtml = isFinite(rent)
        ? `<div style="font-size:1.45rem;font-weight:700;color:${rc(rent)};letter-spacing:-0.02em;">${fmtPct(rent)}</div><div style="font-size:0.78rem;color:#6b7280;margin-top:0.25rem;">${gan >= 0 ? "+" : ""}${fmtEur(gan)} de ganancia · ${fmtEur(val)} actuales</div>`
        : `<div style="font-size:1.45rem;font-weight:700;color:#6b7280;">—</div><div style="font-size:0.78rem;color:#6b7280;margin-top:0.25rem;">${fmtEur(val)} actuales</div>`;
      return `<div style="border-left:3px solid ${color};padding-left:1rem;"><div style="font-size:0.72rem;color:${color};text-transform:uppercase;letter-spacing:0.06em;font-weight:700;margin-bottom:0.35rem;">Rentabilidad ${esc(cat)}</div>${rentHtml}</div>`;
    }).join("");
    return `<div class="v2-wrap"><div class="dashboard-panel">
      <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;margin-bottom:1.25rem;">Asignación · actual vs objetivo</div>
      <div style="display:grid;grid-template-columns:64px 1fr;gap:1.1rem 1.25rem;align-items:center;margin-bottom:1.75rem;">
        <span style="font-size:0.72rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Objetivo</span><div>${barra("obj")}</div>
        <span style="font-size:0.72rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Actual</span><div>${barra("pct")}</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:1.5rem;">${tiles}</div>
    </div></div>`;
  }

  function header(title, subtitle) {
    return `<div class="header-block"><h2 class="section-title">${esc(title)}</h2><div class="section-subtitle">${subtitle}</div></div>`;
  }
  function propBar(m) {
    const seg = (p, c, l) => `<div title="${l}: ${pct1(p)}%" style="width:${Math.max(0, p).toFixed(2)}%;background:${c};"></div>`;
    return `<div class="v2-prop-bar">${seg(m.pctLiquidez, "#3b82f6", "Caja")}${seg(m.ratioInv, "#10b981", "Cartera")}${seg(m.ratioInm, "#a16207", "Inmuebles")}</div>`;
  }
  // Tarjeta del panel de Patrimonio. Si se le pasa `pagina`, es clicable y
  // navega a esa sección (con realce al pasar el cursor y una flecha de pista).
  function hubCard(titulo, valor, pct, color, sub, subColor, pagina) {
    const clicable = pagina
      ? ` role="link" tabindex="0" onclick="v2Tab('${pagina}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();v2Tab('${pagina}');}"`
        + ` onmouseover="this.style.background='#1e2130'" onmouseout="this.style.background=''"`
        + ` title="Ir a ${esc(titulo)}"`
      : "";
    const flecha = pagina
      ? `<span style="color:${color};font-weight:700;margin-left:0.35rem;">&nbsp;→</span>`
      : "";
    return `<div class="dashboard-panel" style="border-left:3px solid ${color};${pagina ? "cursor:pointer;transition:background 0.2s;" : ""}"${clicable}>
      <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;font-weight:700;color:${color};margin-bottom:0.6rem;">${esc(titulo)}</div>
      <div style="font-size:1.7rem;font-weight:800;color:#fff;letter-spacing:-0.02em;">${valor}</div>
      <div style="font-size:0.82rem;color:${subColor || "#9ca3af"};font-weight:600;margin-top:0.3rem;">${sub}</div>
      <div style="font-size:0.78rem;color:#6b7280;margin-top:0.15rem;">${pct.toFixed(2)}% del patrimonio${flecha}</div>
    </div>`;
  }

  let CURRENT_DOC = null;

  // ── Listados con búsqueda y filtros (Fase 5) ────────────────────────
  // El estado vive fuera del render para que los filtros sobrevivan a un
  // repintado (p.ej. tras guardar). Y al teclear se repinta SOLO la lista: si
  // se repintara la página entera, el buscador perdería el foco en cada letra.
  const PAGINA = 30;
  const MOV = { q: "", tipo: "", cuenta: "", cat: "", desde: "", hasta: "", limite: PAGINA };
  const OPS = { q: "", tipo: "", desde: "", hasta: "", limite: 40 };
  let OPS_BANCO = "";

  const estiloFiltro = "background:#12141d;border:1px solid #2a2d3a;border-radius:8px;color:#e5e7eb;font-size:0.82rem;padding:0.4rem 0.6rem;outline:none;font-family:inherit;";
  const selFiltro = (id, opts, val, onchange) =>
    `<select id="${id}" onchange="${onchange}" style="${estiloFiltro}">` +
    opts.map((o) => `<option value="${esc(o[0])}" ${o[0] === val ? "selected" : ""}>${esc(o[1])}</option>`).join("") + `</select>`;
  const enRango = (f, desde, hasta) => {
    const t = parseFechaES(f).getTime();
    if (desde && t < new Date(desde + "T00:00:00").getTime()) return false;
    if (hasta && t > new Date(hasta + "T23:59:59").getTime()) return false;
    return true;
  };
  const contiene = (texto, q) => !q || String(texto || "").toLowerCase().includes(q.toLowerCase());

  function movimientosFiltrados() {
    const mov = (CURRENT_DOC && CURRENT_DOC.movimientos) || [];
    return mov.filter((r) => {
      if (MOV.tipo && r.tipo !== MOV.tipo) return false;
      if (MOV.cuenta && r.cuenta_origen !== MOV.cuenta && r.cuenta_destino !== MOV.cuenta) return false;
      if (MOV.cat && r.tipo_gasto !== MOV.cat && r.tipo_ingreso !== MOV.cat) return false;
      if (!enRango(r.fecha, MOV.desde, MOV.hasta)) return false;
      if (MOV.q && !contiene([r.detalle, r.tipo_gasto, r.tipo_ingreso, r.persona_prestamo,
                              r.cuenta_origen, r.cuenta_destino, r.importe, r.fecha].join(" "), MOV.q)) return false;
      return true;
    }).sort((a, b) => parseFechaES(b.fecha) - parseFechaES(a.fecha));
  }

  function movimientosTabla() {
    const total = ((CURRENT_DOC && CURRENT_DOC.movimientos) || []).length;
    const todos = movimientosFiltrados();
    const visibles = todos.slice(0, MOV.limite);
    const suma = todos.reduce((s, r) => {
      const v = Number(r.importe) || 0;
      return s + (r.tipo === "Ingreso" ? v : (r.tipo === "Gasto" ? -v : 0));
    }, 0);
    const rows = visibles.map((r) => {
      const signo = r.tipo === "Ingreso" ? "+" : (r.tipo === "Gasto" ? "−" : "");
      const color = r.tipo === "Ingreso" ? GREEN : (r.tipo === "Gasto" ? RED : "#9ca3af");
      const det = esc(r.detalle || r.tipo_gasto || r.tipo_ingreso || "—");
      const cta = esc([r.cuenta_origen, r.cuenta_destino].filter(Boolean).join(" → "));
      return `<tr class="table-row">
        <td style="text-align:left;color:#9ca3af;font-size:0.82rem;white-space:nowrap;">${esc(r.fecha)}</td>
        <td style="text-align:left;"><span style="color:${color};font-weight:600;font-size:0.8rem;">${esc(r.tipo)}</span> <span style="color:#e5e7eb;">${det}</span>
          ${cta ? `<div style="color:#4b5563;font-size:0.72rem;">${cta}</div>` : ""}</td>
        <td style="text-align:right;color:${color};font-weight:600;white-space:nowrap;">${signo}${fmtEur(Number(r.importe))}</td>
        ${rowActions(`v2EditMov('${r.id}')`, `v2DelMov('${r.id}')`)}</tr>`;
    }).join("");
    const quedan = todos.length - visibles.length;
    return `<div style="font-size:0.78rem;color:#6b7280;margin:0.35rem 0 0.5rem;">
        ${todos.length}${todos.length !== total ? " de " + total : ""} ${todos.length === 1 ? "movimiento" : "movimientos"}
        ${suma ? `· saldo del filtro <b style="color:${suma >= 0 ? GREEN : RED};">${suma >= 0 ? "+" : ""}${fmtEur(suma)}</b>` : ""}</div>
      <table class="minimal-table"><tbody>${rows || '<tr><td style="color:#6b7280;padding:1rem;">Ningún movimiento coincide con el filtro</td></tr>'}</tbody></table>
      ${quedan > 0 ? `<div style="text-align:center;margin-top:0.75rem;">${addBtn("Ver " + Math.min(quedan, PAGINA) + " más (quedan " + quedan + ")", "v2MovMas()")}</div>` : ""}`;
  }

  function movimientosList() {
    const mov = (CURRENT_DOC && CURRENT_DOC.movimientos) || [];
    const cuentas = [["", "Todas las cuentas"]].concat(CFG.cuentas().map((c) => [c.cuenta, c.cuenta]));
    const cats = [["", "Todas las categorías"]].concat(
      Array.from(new Set(mov.flatMap((r) => [r.tipo_gasto, r.tipo_ingreso]).filter((x) => x && String(x).trim())))
        .sort().map((c) => [c, c]));
    const tipos = [["", "Todos los tipos"], ["Gasto", "Gastos"], ["Ingreso", "Ingresos"], ["Traspaso", "Traspasos"], ["Préstamo", "Préstamos"]];
    return `<div class="v2-wrap" style="padding-bottom:2rem;"><div class="table-container">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;flex-wrap:wrap;gap:0.5rem;">
        <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Movimientos</div>
        ${addBtn("＋ Movimiento", "v2AddMov()")}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center;">
        <input id="v2-mov-q" type="search" value="${esc(MOV.q)}" placeholder="Buscar por concepto, categoría, persona…"
               oninput="v2MovFiltro()" style="${estiloFiltro}flex:1;min-width:190px;">
        ${selFiltro("v2-mov-tipo", tipos, MOV.tipo, "v2MovFiltro()")}
        ${selFiltro("v2-mov-cuenta", cuentas, MOV.cuenta, "v2MovFiltro()")}
        ${selFiltro("v2-mov-cat", cats, MOV.cat, "v2MovFiltro()")}
        <input id="v2-mov-desde" type="date" value="${esc(MOV.desde)}" onchange="v2MovFiltro()" title="Desde" style="${estiloFiltro}">
        <input id="v2-mov-hasta" type="date" value="${esc(MOV.hasta)}" onchange="v2MovFiltro()" title="Hasta" style="${estiloFiltro}">
        ${addBtn("Limpiar", "v2MovLimpiar()")}
      </div>
      <div id="v2-mov-lista">${movimientosTabla()}</div>
    </div></div>`;
  }

  function operacionesFiltradas(banco) {
    let inv = (CURRENT_DOC && CURRENT_DOC.inversiones) || [];
    if (banco) inv = inv.filter((r) => String(r.cuenta || "").trim() === banco);
    return inv.filter((r) => {
      if (OPS.tipo && (r.tipo_movimiento || "Compra") !== OPS.tipo) return false;
      if (!enRango(r.fecha, OPS.desde, OPS.hasta)) return false;
      if (OPS.q && !contiene([r.nombre, r.isin, r.cuenta, r.fecha].join(" "), OPS.q)) return false;
      return true;
    }).sort((a, b) => parseFechaES(b.fecha) - parseFechaES(a.fecha));
  }

  function operacionesTabla(banco) {
    const MC = { Compra: GREEN, Venta: RED, Traspaso: "#3b82f6" };
    const todas = operacionesFiltradas(banco);
    const visibles = todas.slice(0, OPS.limite);
    const rows = visibles.map((r) => {
      const mov = r.tipo_movimiento || "Compra";
      const c = MC[mov] || "#6b7280";
      const coste = Number(r.coste);
      return `<tr class="table-row">
        <td style="text-align:left;color:#9ca3af;font-size:0.82rem;white-space:nowrap;">${esc(r.fecha)}</td>
        <td style="text-align:left;"><div style="display:flex;align-items:center;gap:0.5rem;">${logoImg(r.nombre, r.isin, 18)}<span style="color:#fff;font-weight:600;font-size:0.85rem;">${esc(r.nombre)}</span><span style="color:${c};font-size:0.7rem;font-weight:700;background:${c}22;padding:0.1rem 0.4rem;border-radius:4px;">${esc(mov)}</span></div></td>
        <td style="text-align:right;color:${coste < 0 ? RED : "#e5e7eb"};font-weight:600;white-space:nowrap;">${fmtEur(coste)}</td>
        <td style="text-align:right;color:#9ca3af;font-size:0.82rem;white-space:nowrap;">${r.unidades !== "" && r.unidades != null ? Number(r.unidades).toLocaleString("es-ES", { maximumFractionDigits: 6 }) : "—"}</td>
        ${rowActions(`v2EditInv('${r.id}')`, `v2DelInv('${r.id}')`)}</tr>`;
    }).join("");
    const quedan = todas.length - visibles.length;
    const invertido = todas.reduce((s, r) => s + (Number(r.coste) || 0), 0);
    return `<div style="font-size:0.78rem;color:#6b7280;margin:0.35rem 0 0.5rem;">
        ${todas.length} ${todas.length === 1 ? "operación" : "operaciones"} · neto invertido <b style="color:#e5e7eb;">${fmtEur(invertido)}</b></div>
      <table class="minimal-table"><tbody>${rows || '<tr><td style="color:#6b7280;padding:1rem;">Ninguna operación coincide con el filtro</td></tr>'}</tbody></table>
      ${quedan > 0 ? `<div style="text-align:center;margin-top:0.75rem;">${addBtn("Ver 40 más (quedan " + quedan + ")", "v2OpsMas()")}</div>` : ""}`;
  }

  function operacionesList(banco) {
    OPS_BANCO = banco || "";
    const tipos = [["", "Todos los tipos"], ["Compra", "Compras"], ["Venta", "Ventas"], ["Traspaso", "Traspasos"]];
    return `<div class="v2-wrap" style="padding-bottom:2rem;"><div class="table-container">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;flex-wrap:wrap;gap:0.5rem;">
        <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Historial de operaciones</div>
        <div style="display:flex;gap:0.5rem;">${addBtn("＋ NAV", "v2AddNav()")}${addBtn("＋ Operación", "v2AddInv()")}</div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center;">
        <input id="v2-ops-q" type="search" value="${esc(OPS.q)}" placeholder="Buscar por activo o ISIN…"
               oninput="v2OpsFiltro()" style="${estiloFiltro}flex:1;min-width:190px;">
        ${selFiltro("v2-ops-tipo", tipos, OPS.tipo, "v2OpsFiltro()")}
        <input id="v2-ops-desde" type="date" value="${esc(OPS.desde)}" onchange="v2OpsFiltro()" title="Desde" style="${estiloFiltro}">
        <input id="v2-ops-hasta" type="date" value="${esc(OPS.hasta)}" onchange="v2OpsFiltro()" title="Hasta" style="${estiloFiltro}">
        ${addBtn("Limpiar", "v2OpsLimpiar()")}
      </div>
      <div id="v2-ops-lista">${operacionesTabla(banco)}</div>
    </div></div>`;
  }

  function chartPanel(titulo, containerId) {
    return `<div class="v2-wrap"><div class="dashboard-panel">
      <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;margin-bottom:1.25rem;">${esc(titulo)}</div>
      <div id="${containerId}"></div>
    </div></div>`;
  }

  // ── Páginas ──
  function pagePatrimonio(m) {
    return header("Patrimonio", fmtEur(m.patrimonioNeto)) +
      propBar(m) +
      `<div class="v2-hub-grid">
        ${hubCard("Caja", fmtEur(m.patrimonioLiquido), m.pctLiquidez, "#3b82f6", m.saldosCaja.length + " cuentas", null, "caja")}
        ${hubCard("Cartera", fmtEur(m.carteraTotal), m.ratioInv, "#10b981", m.inv.hayRentabilidad ? fmtPct(m.inv.rentPct) : "—", rc(m.inv.rentPct), "cartera")}
        ${hubCard("Inmuebles", fmtEur(m.inm.total), m.ratioInm, "#a16207", m.inm.n + " inmuebles", null, "inmuebles")}
        ${hubCard("Pasivos", fmtEur(m.pas.total), m.ratioPas, "#6b7280",
                  m.pas.n ? m.pas.n + (m.pas.n === 1 ? " deuda" : " deudas") : "Sin deudas registradas", null, "pasivos")}
      </div>` +
      chartPanel("Evolución del patrimonio neto", "v2-chart-patrimonio") +
      donutPanel("Distribución del patrimonio",
        [{ label: "Caja", value: m.patrimonioLiquido, accent: "#3b82f6" },
         { label: "Cartera", value: m.carteraTotal, accent: "#10b981" },
         { label: "Inmuebles", value: m.inm.total, accent: "#a16207" }],
        fmtEur(m.patrimonioNeto), "Neto", m.patrimonioNeto);
  }

  function tablaCartera(inv) {
    const rows = inv.assets.map((a) => {
      const rentCell = (a.coste > 0 && isFinite(a.importe))
        ? `<div style="color:${rc(a.ganancia)};font-weight:600;">${a.ganancia >= 0 ? "+" : ""}${fmtEur(a.ganancia)}</div><div style="color:${rc(a.rentPct)};font-size:0.78rem;">${fmtPct(a.rentPct)}${isFinite(a.cagr) && a.coste >= 100 ? " · CAGR " + a.cagr.toFixed(1) + "%" : ""}</div>`
        : `<span style="color:#4b5563;">—</span>`;
      return `<tr class="table-row">
        <td style="text-align:left;"><div style="display:flex;align-items:center;gap:0.6rem;">${logoImg(a.nombre, a.isin)}<div><div style="font-weight:600;color:#fff;font-size:0.9rem;">${esc(a.nombre)}</div><div style="font-size:0.74rem;color:#6b7280;">${esc(a.tipo)}${a.isin && a.isin !== "-" ? ' · <span style="font-family:ui-monospace,monospace;">' + esc(a.isin) + "</span>" : ""}</div></div></div></td>
        <td style="text-align:right;color:#fff;font-weight:600;white-space:nowrap;">${fmtEur(a.importe)}</td>
        <td style="text-align:right;color:#9ca3af;white-space:nowrap;">${a.coste ? fmtEur(a.coste) : "—"}</td>
        <td style="text-align:right;white-space:nowrap;">${rentCell}</td>
        <td style="text-align:right;color:#3b82f6;font-weight:600;">${a.pct.toFixed(2)}%</td></tr>`;
    }).join("");
    return `<div class="v2-wrap" style="padding-bottom:2rem;"><div class="table-container">
      <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Cartera</div>
      <table class="minimal-table"><thead><tr><th style="text-align:left;">Activo</th><th style="text-align:right;">Valor actual</th><th style="text-align:right;">Invertido</th><th style="text-align:right;">Rentabilidad</th><th style="text-align:right;">Peso</th></tr></thead><tbody>${rows}</tbody></table>
    </div></div>`;
  }

  // ── Fase 9: reporte mes a mes por activo + comparativa de rentabilidad ──
  // Cada fila un activo, cada columna un mes, con la rentabilidad ACUMULADA
  // desde el inicio hasta el cierre de ese mes ("de principio a mes").
  function tablaMensual(an) {
    if (!an || !an.meses.length || !an.filas.length) return "";
    const MAX = 14;                                   // últimos ~14 meses (cabe en pantalla)
    const desde = Math.max(0, an.meses.length - MAX);
    const meses = an.meses.slice(desde);
    const cab = meses.map((t, k) => {
      const esUlt = desde + k === an.meses.length - 1;
      const lbl = new Date(t).toLocaleDateString("es-ES", { month: "short", year: "2-digit" });
      return `<th style="text-align:right;white-space:nowrap;${esUlt ? "color:#fff;" : ""}">${esc(esUlt ? "Hoy" : lbl)}</th>`;
    }).join("");

    const celda = (c) => {
      if (!c) return `<td style="text-align:right;color:#374151;">—</td>`;
      const col = c.rentPct >= 0 ? GREEN : RED;
      return `<td style="text-align:right;color:${col};font-weight:600;white-space:nowrap;" title="Valor ${fmtEur(c.valor)} · Invertido ${fmtEur(c.coste)}">${fmtPct(c.rentPct)}</td>`;
    };

    const filas = an.filas.map((f) => {
      const cs = f.celdas.slice(desde);
      return `<tr class="table-row"><td style="text-align:left;position:sticky;left:0;background:#12141d;z-index:1;">
        <div style="display:flex;align-items:center;gap:0.5rem;min-width:200px;">${logoImg(f.nombre, f.isin, 20)}
          <span style="color:#e5e7eb;font-weight:600;font-size:0.82rem;">${esc(f.nombre.length > 32 ? f.nombre.slice(0, 31) + "…" : f.nombre)}</span></div></td>
        ${cs.map(celda).join("")}</tr>`;
    }).join("");

    const tot = an.total.slice(desde);
    const filaTotal = `<tr style="border-top:2px solid #2a2d3a;"><td style="text-align:left;position:sticky;left:0;background:#12141d;z-index:1;">
      <span style="color:#fff;font-weight:800;font-size:0.82rem;">Total cartera</span></td>
      ${tot.map((c) => (c ? `<td style="text-align:right;color:${c.rentPct >= 0 ? GREEN : RED};font-weight:800;white-space:nowrap;" title="Valor ${fmtEur(c.valor)} · Invertido ${fmtEur(c.coste)}">${fmtPct(c.rentPct)}</td>` : `<td style="text-align:right;color:#374151;">—</td>`)).join("")}</tr>`;

    return `<div class="v2-wrap"><div class="dashboard-panel">
      <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;margin-bottom:0.35rem;">Reporte mensual por activo</div>
      <div style="font-size:0.75rem;color:#4b5563;margin-bottom:1rem;">Rentabilidad acumulada desde el inicio hasta el cierre de cada mes. Pasa el cursor por una celda para ver valor e invertido.</div>
      <div style="overflow-x:auto;"><table class="minimal-table" style="min-width:100%;">
        <thead><tr><th style="text-align:left;position:sticky;left:0;background:#12141d;z-index:2;">Activo</th>${cab}</tr></thead>
        <tbody>${filas}${filaTotal}</tbody></table></div>
    </div></div>`;
  }

  function comparativaPanel() {
    return `<div class="v2-wrap"><div class="dashboard-panel">
      <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;margin-bottom:0.35rem;">Comparativa de rentabilidad</div>
      <div style="font-size:0.75rem;color:#4b5563;margin-bottom:1rem;">Rentabilidad acumulada de cada activo a lo largo del tiempo.</div>
      <div id="v2-chart-comparativa"></div>
    </div></div>`;
  }

  // ── Cartera: sub-navegación por bróker (Agregado / TR / MyInvestor / Bankinter) ──
  let CARTERA_TAB = "agregado";
  let CARTERA_CTX = null;   // {m, prices} para re-renderizar al cambiar de pestaña

  function subNavCartera() {
    const tabs = [{ id: "agregado", label: "Agregado" }]
      .concat(CFG.brokers().map((b) => ({ id: b.cuenta, label: b.cuenta })));
    return `<div class="v2-wrap" style="margin-top:0.5rem;"><div style="display:flex;gap:0.25rem;border-bottom:1px solid #2a2d3a;overflow-x:auto;">` +
      tabs.map((t) => {
        const on = CARTERA_TAB === t.id;
        const idJs = String(t.id).replace(/'/g, "\\'");
        return `<button onclick="v2CarteraTab('${idJs}')" style="background:none;border:none;border-bottom:2px solid ${on ? "#fff" : "transparent"};color:${on ? "#fff" : "#6b7280"};font-weight:${on ? 700 : 500};font-size:0.88rem;padding:0.5rem 1rem 0.6rem;cursor:pointer;font-family:inherit;white-space:nowrap;margin-bottom:-1px;">${esc(t.label)}</button>`;
      }).join("") + `</div></div>`;
  }

  // Efectivo de un bróker: el saldo de su cuenta, o 0 fijo (Bankinter, cuenta figurativa)
  function efectivoBroker(m, cuenta) {
    const cfg = CFG.brokers().find((b) => b.cuenta === cuenta);
    if (!cfg) return { valor: 0, etiqueta: "Efectivo" };
    if (cfg.cartera === "cero") return { valor: 0, etiqueta: cfg.etiquetaEfectivo || "Cuenta Broker", fijo: true };
    const s = (m.saldos || []).find((x) => x.cuenta === cuenta);
    return { valor: s ? s.saldo : 0, etiqueta: cfg.etiquetaEfectivo || "Efectivo sin invertir" };
  }

  function tarjetaEfectivo(m, cuenta) {
    const cta = CFG.cuentas().find((c) => c.cuenta === cuenta) || {};
    const ef = efectivoBroker(m, cuenta);
    const icon = cta.logo ? `<img src="${cta.logo}" alt="" style="width:20px;height:20px;object-fit:contain;border-radius:4px;">` : `<span style="font-size:1.05rem;">${cta.emoji || ""}</span>`;
    return `<div class="dashboard-panel" style="border-left:3px solid ${cta.accent || "#6b7280"};">
      <div style="display:flex;align-items:center;gap:0.55rem;margin-bottom:0.6rem;">${icon}
        <span style="font-size:0.72rem;color:${cta.accent || "#9ca3af"};text-transform:uppercase;letter-spacing:0.06em;font-weight:700;">${esc(cuenta)}</span></div>
      <div style="font-size:1.4rem;font-weight:800;color:#fff;letter-spacing:-0.02em;">${fmtEur(ef.valor)}</div>
      <div style="font-size:0.76rem;color:#6b7280;margin-top:0.25rem;">${esc(ef.etiqueta)}${ef.fijo ? " · sin efectivo propio" : ""}</div>
    </div>`;
  }

  // Recalcula los pesos (%) de un subconjunto de activos sobre su propio total
  function conPesos(assets) {
    const total = assets.reduce((s, a) => s + (isFinite(a.importe) ? a.importe : 0), 0);
    return assets.map((a) => Object.assign({}, a, { pct: total ? (isFinite(a.importe) ? a.importe / total * 100 : 0) : 0 }));
  }

  function heroCartera(valor, inv, subtitulo) {
    return `<div class="v2-wrap"><div class="hero-card">
      <div class="hero-main"><span class="hero-item-label">${esc(subtitulo || "Valor actual")}</span><span class="hero-value">${fmtEur(valor)}</span></div>
      <div class="hero-breakdown">
        <div class="hero-item"><span class="hero-item-label">Invertido</span><span class="hero-item-value">${inv.totalCoste ? fmtEur(inv.totalCoste) : "—"}</span></div>
        <div class="hero-item"><span class="hero-item-label">Ganancia</span><span class="hero-item-value" style="color:${rc(inv.totalGanancia)};">${inv.totalCoste ? (inv.totalGanancia >= 0 ? "+" : "") + fmtEur(inv.totalGanancia) : "—"}</span></div>
        <div class="hero-item"><span class="hero-item-label">Rentabilidad</span><span class="hero-item-value" style="color:${rc(inv.rentPct)};">${inv.totalCoste ? fmtPct(inv.rentPct) : "—"}${isFinite(inv.portfolioCagr) ? '<span style="display:block;font-size:0.65rem;color:#9ca3af;font-weight:500;margin-top:0.15rem;">CAGR ' + (inv.portfolioCagr >= 0 ? "+" : "") + inv.portfolioCagr.toFixed(1) + '% p.a.</span>' : ""}</span></div>
      </div></div></div>`;
  }

  function donutTipos(assets, total) {
    const porTipo = {};
    assets.forEach((a) => { if (isFinite(a.importe)) porTipo[a.tipo] = (porTipo[a.tipo] || 0) + a.importe; });
    const items = Object.keys(porTipo).map((t) => ({ label: t, value: porTipo[t], accent: CFG.TIPO_COLORES[t] || "#6b7280" })).sort((a, b) => b.value - a.value);
    return items.length ? donutPanel("Distribución por activos", items, fmtEur(total), "Activos", total) : "";
  }

  // Contenido de la pestaña activa (se re-renderiza al cambiar de bróker)
  function carteraInner(m, prices) {
    const inv = m.inv;
    const aviso = prices ? "" : `<div class="v2-wrap"><div style="padding:0.6rem 1rem;background:#3f2d0a;border:1px solid #a16207;border-radius:10px;font-size:0.82rem;color:#fbbf24;">⏳ Cargando precios de mercado…</div></div>`;

    if (CARTERA_TAB === "agregado") {
      const tarjetas = `<div class="v2-wrap"><div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;margin-bottom:1rem;">Cuentas de bróker</div>
        <div class="v2-hub-grid">${CFG.brokers().map((b) => tarjetaEfectivo(m, b.cuenta)).join("")}</div></div>`;
      return aviso + heroCartera(m.carteraTotal, inv, "Valor total (posiciones + efectivo)") + tarjetas +
        chartPanel("Evolución de la cartera", "v2-chart-cartera") +
        asignacionPanel(inv) +
        donutTipos(inv.assets, inv.total) +
        treemapPanel(inv.assets) +
        tablaCartera(inv) +
        comparativaPanel() +
        tablaMensual(window.__ANALITICA) +
        operacionesList();
    }

    // Vista de un bróker concreto
    const banco = CARTERA_TAB;
    const assets = conPesos(inv.assets.filter((a) => a.banco === banco));
    const posiciones = assets.reduce((s, a) => s + (isFinite(a.importe) ? a.importe : 0), 0);
    const ef = efectivoBroker(m, banco);
    const coste = assets.reduce((s, a) => s + (isFinite(a.coste) ? a.coste : 0), 0);
    const ganancia = posiciones - coste;
    const invBanco = {
      assets, total: posiciones, totalCoste: coste, totalGanancia: coste > 0 ? ganancia : 0,
      rentPct: coste > 0 ? (posiciones / coste - 1) * 100 : NaN, portfolioCagr: NaN, hayRentabilidad: coste > 0,
    };
    const sinDatos = !assets.length
      ? `<div class="v2-wrap"><div class="dashboard-panel" style="text-align:center;color:#6b7280;padding:2.5rem;">Sin posiciones en ${esc(banco)}</div></div>` : "";
    return aviso + heroCartera(posiciones + ef.valor, invBanco, "Valor en " + banco) +
      `<div class="v2-wrap"><div class="v2-hub-grid">${tarjetaEfectivo(m, banco)}</div></div>` +
      sinDatos + donutTipos(assets, posiciones) + treemapPanel(assets) +
      tablaCartera(invBanco) + operacionesList(banco);
  }

  function pageCartera(m, prices) {
    CARTERA_CTX = { m, prices };
    return header("Cartera", fmtEur(m.carteraTotal)) + subNavCartera() +
      `<div id="v2-cartera-inner">${carteraInner(m, prices)}</div>`;
  }

  function pageCaja(m) {
    const cuentas = m.saldosCaja || m.saldos;
    const items = cuentas.filter((s) => s.saldo !== 0).map((s) => ({ label: s.cuenta, value: s.saldo, accent: s.accent }));
    const rows = cuentas.map((s) => {
      const icon = s.logo ? `<img src="${s.logo}" alt="" style="width:20px;height:20px;object-fit:contain;border-radius:4px;">` : `<span style="font-size:1.1rem;">${s.emoji || ""}</span>`;
      const cuentaJs = String(s.cuenta).replace(/'/g, "\\'");
      return `<tr class="table-row"><td style="text-align:left;"><div style="display:flex;align-items:center;gap:0.6rem;"><span style="width:9px;height:9px;border-radius:50%;background:${s.accent};flex-shrink:0;"></span>${icon}<button onclick="v2VerCuenta('${cuentaJs}')" title="Ver los movimientos de ${esc(s.cuenta)}" style="background:none;border:none;padding:0;color:#fff;font-weight:600;font-family:inherit;font-size:inherit;cursor:pointer;text-align:left;">${esc(s.cuenta)}</button></div></td><td style="text-align:right;color:#fff;font-weight:600;white-space:nowrap;">${fmtEur(s.saldo)}</td><td style="text-align:right;color:#9ca3af;">${s.pct.toFixed(2)}%</td><td style="text-align:right;width:1%;"><button onclick="v2Cuadrar('${cuentaJs}',${s.saldo})" title="Cuadrar con el saldo real del banco" style="background:none;border:none;color:#6b7280;cursor:pointer;font-size:0.9rem;padding:0.2rem 0.4rem;">⚖️</button></td></tr>`;
    }).join("");
    return header("Caja", fmtEur(m.patrimonioLiquido)) +
      donutPanel("Distribución de la caja", items, fmtEur(m.patrimonioLiquido), "Total", m.patrimonioLiquido) +
      `<div class="v2-wrap"><div class="table-container"><table class="minimal-table"><thead><tr><th style="text-align:left;">Cuenta</th><th style="text-align:right;">Saldo</th><th style="text-align:right;">Peso</th><th></th></tr></thead><tbody>${rows}</tbody></table>
        <div style="font-size:0.75rem;color:#4b5563;margin-top:0.75rem;">⚖️ Cuadra el saldo con el de tu banco: Solvento crea el movimiento de ajuste exacto.</div>
      </div></div>` +
      movimientosList();
  }

  function pageInmuebles(m) {
    const inm = m.inm;
    const porTipo = {};
    inm.items.forEach((r) => { if (isFinite(r.importe)) porTipo[r.tipo] = (porTipo[r.tipo] || 0) + r.importe; });
    const items = Object.keys(porTipo).map((t) => ({ label: t, value: porTipo[t], accent: CFG.TIPO_COLORES_INMUEBLE[t] || CFG.INMUEBLE_ACCENT_DEFAULT })).sort((a, b) => b.value - a.value);
    const rows = inm.items.map((r) => `<tr class="table-row"><td style="text-align:left;"><div style="display:flex;align-items:center;gap:0.6rem;"><span style="width:9px;height:9px;border-radius:50%;background:${r.accent};flex-shrink:0;"></span><div><div style="color:#fff;font-weight:600;">${esc(r.nombre)}</div><div style="font-size:0.74rem;color:#6b7280;">${esc(r.tipo)}</div></div></div></td><td style="text-align:right;color:#fff;font-weight:600;white-space:nowrap;">${fmtEur(r.importe)}</td>${rowActions(`v2EditInm('${r.id}')`, `v2DelInm('${r.id}')`)}</tr>`).join("");
    return header("Inmuebles", fmtEur(inm.total)) +
      donutPanel("Distribución por tipo", items, fmtEur(inm.total), "Total", inm.total) +
      `<div class="v2-wrap" style="padding-bottom:2rem;"><div class="table-container">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;flex-wrap:wrap;gap:0.5rem;">
          <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Inmuebles</div>
          ${addBtn("＋ Inmueble", "v2AddInm()")}
        </div>
        <table class="minimal-table"><thead><tr><th style="text-align:left;">Inmueble</th><th style="text-align:right;">Tasación</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }

  function pagePasivos(m) {
    const pas = (m && m.pas) || { items: [], n: 0, total: 0 };
    if (!pas.n) {
      return header("Pasivos", fmtEur(0)) +
        `<div class="v2-wrap"><div class="dashboard-panel" style="text-align:center;padding:3rem;">
          <div style="color:#6b7280;font-size:0.95rem;font-weight:600;margin-bottom:0.5rem;">Sin deudas registradas</div>
          <div style="color:#374151;font-size:0.85rem;max-width:420px;margin:0 auto 1.25rem;">Hipotecas, préstamos, tarjetas… Lo que registres aquí se descuenta de tu patrimonio neto.</div>
          ${addBtn("＋ Deuda", "v2AddPas()")}
        </div></div>`;
    }
    const rows = pas.items.map((d) => `<tr class="table-row">
      <td style="text-align:left;"><span style="color:#fff;font-weight:600;">${esc(d.nombre)}</span>${d.entidad ? `<div style="color:#6b7280;font-size:0.78rem;">${esc(d.entidad)}</div>` : ""}</td>
      <td style="text-align:left;color:#9ca3af;">${esc(d.tipo)}</td>
      <td style="text-align:right;color:#fff;font-weight:600;white-space:nowrap;">${fmtEur(d.importe)}</td>
      <td style="text-align:right;color:#9ca3af;">${(pas.total ? d.importe / pas.total * 100 : 0).toFixed(2)}%</td>
      ${rowActions(`v2EditPas('${d.id}')`, `v2DelPas('${d.id}')`)}</tr>`).join("");
    return header("Pasivos", fmtEur(pas.total)) +
      `<div class="v2-wrap"><div class="table-container">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;flex-wrap:wrap;gap:0.5rem;">
          <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Deudas</div>
          ${addBtn("＋ Deuda", "v2AddPas()")}
        </div>
        <table class="minimal-table">
        <thead><tr><th style="text-align:left;">Deuda</th><th style="text-align:left;">Tipo</th><th style="text-align:right;">Importe</th><th style="text-align:right;">Peso</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div></div>`;
  }

  // ── Página Gastos (Fase 6) ──────────────────────────────────────────
  // Responde a "¿en qué se me va el dinero?" con lo que ya registras. El mes
  // elegido se guarda fuera del render para que sobreviva a un repintado.
  let GASTO_MES = null;   // null = el último mes con actividad

  function barrasIngresoGasto(g) {
    const ult = g.meses.slice(-12);
    if (!ult.length) return "";
    const tope = Math.max(...ult.map((m) => Math.max(m.ingresos, m.gastos))) || 1;
    const cols = ult.map((m) => {
      const hi = (m.ingresos / tope * 100).toFixed(1), hg = (m.gastos / tope * 100).toFixed(1);
      const activo = m.ym === mesElegido(g).ym;
      return `<button onclick="v2GastoMes('${m.ym}')" title="${esc(m.label)} · ingresos ${fmtEur(m.ingresos)} · gastos ${fmtEur(m.gastos)}"
        style="flex:1;min-width:0;background:none;border:none;cursor:pointer;font-family:inherit;padding:0;display:flex;flex-direction:column;align-items:center;gap:0.35rem;">
        <div style="display:flex;align-items:flex-end;gap:2px;height:110px;width:100%;justify-content:center;">
          <div style="width:42%;max-width:16px;height:${hi}%;background:${GREEN};border-radius:2px 2px 0 0;opacity:${activo ? 1 : 0.55};"></div>
          <div style="width:42%;max-width:16px;height:${hg}%;background:${RED};border-radius:2px 2px 0 0;opacity:${activo ? 1 : 0.55};"></div>
        </div>
        <div style="font-size:0.62rem;color:${activo ? "#fff" : "#4b5563"};font-weight:${activo ? 700 : 500};white-space:nowrap;">${esc(m.label.split(" ")[0])}</div>
      </button>`;
    }).join("");
    return `<div class="v2-wrap"><div class="dashboard-panel">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;margin-bottom:1rem;">
        <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Ingresos y gastos por mes</div>
        <div style="display:flex;gap:0.9rem;font-size:0.75rem;">
          <span style="color:#9ca3af;"><span style="display:inline-block;width:9px;height:9px;background:${GREEN};border-radius:2px;margin-right:0.3rem;"></span>Ingresos</span>
          <span style="color:#9ca3af;"><span style="display:inline-block;width:9px;height:9px;background:${RED};border-radius:2px;margin-right:0.3rem;"></span>Gastos</span>
        </div>
      </div>
      <div style="display:flex;gap:0.3rem;align-items:flex-end;">${cols}</div>
      <div style="font-size:0.72rem;color:#4b5563;margin-top:0.75rem;">Pulsa un mes para verlo en detalle.</div>
    </div></div>`;
  }

  const mesElegido = (g) => {
    if (!g.meses.length) return { ym: "", label: "—", ingresos: 0, gastos: 0, ahorro: 0, tasa: NaN, catGasto: {}, catIngreso: {} };
    return g.meses.find((m) => m.ym === GASTO_MES) || g.meses[g.meses.length - 1];
  };

  function tablaCategorias(g, mes, presupuesto) {
    const cats = Object.entries(mes.catGasto).sort((a, b) => b[1] - a[1]);
    if (!cats.length) return `<div class="v2-wrap"><div class="dashboard-panel" style="text-align:center;color:#6b7280;padding:2.5rem;">Sin gastos registrados en ${esc(mes.label)}</div></div>`;
    // Media de esa categoría en los meses anteriores, para saber si te has pasado
    const previos = g.meses.filter((m) => m.ym < mes.ym).slice(-6);
    const mediaDe = (c) => previos.length ? previos.reduce((s, m) => s + (m.catGasto[c] || 0), 0) / previos.length : NaN;

    const rows = cats.map(([c, v]) => {
      const pres = Number(presupuesto[c]);
      const media = mediaDe(c);
      let barra = "";
      if (isFinite(pres) && pres > 0) {
        const pct = Math.min(100, v / pres * 100);
        const col = v > pres ? RED : (v > pres * 0.85 ? "#f59e0b" : GREEN);
        barra = `<div style="margin-top:0.35rem;height:5px;background:#232733;border-radius:3px;overflow:hidden;">
            <div style="width:${pct.toFixed(1)}%;height:100%;background:${col};"></div></div>
          <div style="font-size:0.7rem;color:${v > pres ? RED : "#6b7280"};margin-top:0.2rem;">
            ${v > pres ? `Te has pasado ${fmtEur(v - pres)} del presupuesto` : `Te quedan ${fmtEur(pres - v)} de ${fmtEur(pres)}`}</div>`;
      }
      const cmp = isFinite(media) && media > 0
        ? `<span style="color:${v > media * 1.15 ? RED : (v < media * 0.85 ? GREEN : "#6b7280")};font-size:0.72rem;">
             ${v > media ? "+" : ""}${((v / media - 1) * 100).toFixed(0)}% vs media</span>` : "";
      const cJs = String(c).replace(/'/g, "\\'");
      return `<tr class="table-row">
        <td style="text-align:left;"><div style="color:#e5e7eb;font-weight:600;">${esc(c)}</div>${barra}</td>
        <td style="text-align:right;color:#fff;font-weight:600;white-space:nowrap;">${fmtEur(v)}<div>${cmp}</div></td>
        <td style="text-align:right;color:#9ca3af;white-space:nowrap;">${(mes.gastos ? v / mes.gastos * 100 : 0).toFixed(1)}%</td>
        <td style="text-align:right;width:1%;"><button onclick="v2Presupuesto('${cJs}')" title="Poner presupuesto" style="background:none;border:none;color:#6b7280;cursor:pointer;font-size:0.85rem;padding:0.2rem 0.4rem;">🎯</button></td>
      </tr>`;
    }).join("");
    return `<div class="v2-wrap"><div class="table-container">
      <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;margin-bottom:0.35rem;">Gasto por categoría · ${esc(mes.label)}</div>
      <div style="font-size:0.75rem;color:#4b5563;margin-bottom:0.5rem;">🎯 pon un presupuesto a una categoría y te aviso cuando te pases.</div>
      <table class="minimal-table"><tbody>${rows}</tbody></table>
    </div></div>`;
  }

  function pageGastos(m) {
    const g = window.__GASTOS || { meses: [], media: { ingresos: 0, gastos: 0, meses: 0 }, categorias: [] };
    if (!g.meses.length) {
      return header("Gastos", fmtEur(0)) +
        `<div class="v2-wrap"><div class="dashboard-panel" style="text-align:center;color:#6b7280;padding:3rem;">
          Aún no hay gastos ni ingresos que analizar. Registra movimientos y aquí verás en qué se te va el dinero.</div></div>`;
    }
    const mes = mesElegido(g);
    const pres = (CURRENT_DOC && CURRENT_DOC.config && CURRENT_DOC.config.presupuesto) || {};
    const vsMedia = g.media.gastos ? (mes.gastos / g.media.gastos - 1) * 100 : NaN;
    const hero = `<div class="v2-wrap"><div class="hero-card">
      <div class="hero-main"><span class="hero-item-label">Gasto de ${esc(mes.label)}</span><span class="hero-value">${fmtEur(mes.gastos)}</span>
        ${isFinite(vsMedia) ? `<span style="display:block;font-size:0.78rem;color:${vsMedia > 0 ? RED : GREEN};font-weight:600;margin-top:0.3rem;">
          ${vsMedia >= 0 ? "+" : ""}${vsMedia.toFixed(0)}% respecto a tu media de ${g.media.meses} meses</span>` : ""}</div>
      <div class="hero-breakdown">
        <div class="hero-item"><span class="hero-item-label">Ingresos</span><span class="hero-item-value" style="color:${GREEN};">${fmtEur(mes.ingresos)}</span></div>
        <div class="hero-item"><span class="hero-item-label">Ahorro</span><span class="hero-item-value" style="color:${rc(mes.ahorro)};">${mes.ahorro >= 0 ? "+" : ""}${fmtEur(mes.ahorro)}</span></div>
        <div class="hero-item"><span class="hero-item-label">Tasa de ahorro</span><span class="hero-item-value" style="color:${rc(mes.tasa)};">${isFinite(mes.tasa) ? mes.tasa.toFixed(1).replace(".", ",") + "%" : "—"}</span></div>
      </div></div></div>`;
    return header("Gastos", fmtEur(mes.gastos)) + hero +
      barrasIngresoGasto(g) +
      tablaCategorias(g, mes, pres);
  }

  // ── Navegación ──
  function showPage(id) {
    document.querySelectorAll("#app .page").forEach((p) => p.classList.remove("active"));
    const pg = document.getElementById("v2-page-" + id);
    if (pg) pg.classList.add("active");
    document.querySelectorAll('.nav-tab, .bottom-nav-item').forEach((b) => b.classList.toggle("active", b.dataset.page === id));
    window.scrollTo({ top: 0, behavior: "auto" });
    if (id === "cartera") layoutTreemaps();
  }
  window.v2Tab = showPage;
  // El botón flotante añade lo que corresponde a la página que estás viendo,
  // para registrar sin tener que ir a buscar el formulario.
  const ALTA_POR_PAGINA = {
    patrimonio: () => F() && F().openMovimiento(),
    caja:       () => F() && F().openMovimiento(),
    gastos:     () => F() && F().openMovimiento(),
    cartera:    () => F() && F().openInversion(),
    inmuebles:  () => F() && F().openInmueble(),
    pasivos:    () => F() && F().openPasivo(),
  };
  window.v2AddAqui = function () {
    const activa = document.querySelector("#app .page.active");
    const id = activa ? activa.id.replace("v2-page-", "") : "patrimonio";
    (ALTA_POR_PAGINA[id] || ALTA_POR_PAGINA.patrimonio)();
  };

  // ── Treemap: ajustar texto al tamaño real + hover (port de la v1) ──
  function layoutTreemaps() {
    document.querySelectorAll(".tm-tile").forEach((tile) => {
      const w = tile.offsetWidth, h = tile.offsetHeight;
      const label = tile.querySelector(".tm-label"), nameEl = tile.querySelector(".tm-name"), rentEl = tile.querySelector(".tm-rent");
      if (!label) return;
      if (w < 44 || h < 28) { label.style.display = "none"; return; }
      label.style.display = "flex";
      const fs = Math.max(0.62, Math.min(1.0, Math.min(w, h) / 85));
      nameEl.style.fontSize = fs.toFixed(2) + "rem"; nameEl.style.lineHeight = "1.2";
      if (h >= 56 && w >= 90) { nameEl.style.whiteSpace = "normal"; nameEl.style.display = "-webkit-box"; nameEl.style.webkitLineClamp = "2"; nameEl.style.webkitBoxOrient = "vertical"; nameEl.style.overflow = "hidden"; }
      else { nameEl.style.whiteSpace = "nowrap"; nameEl.style.display = "block"; nameEl.style.overflow = "hidden"; nameEl.style.textOverflow = "ellipsis"; }
      nameEl.textContent = tile.dataset.name;
      const showR = h >= 46; rentEl.style.display = showR ? "block" : "none";
      if (showR) { rentEl.style.fontSize = (fs * 0.82).toFixed(2) + "rem"; rentEl.textContent = tile.dataset.rent; }
    });
  }
  function bindTreemapHover() {
    document.querySelectorAll(".tm-container").forEach((container) => {
      const tip = container.querySelector(".tm-tooltip");
      if (!tip) return;
      container.querySelectorAll(".tm-tile").forEach((tile) => {
        tile.addEventListener("mouseenter", () => {
          tile.style.background = tile.dataset.hoverBg;
          tip.textContent = `${tile.dataset.name} · ${tile.dataset.weight} · ${tile.dataset.rent}`;
          tip.style.display = "block";
          const cw = container.clientWidth, ch = container.clientHeight;
          const tipW = tip.offsetWidth, tipH = tip.offsetHeight;
          let left = tile.offsetLeft + tile.offsetWidth / 2 - tipW / 2;
          left = Math.max(4, Math.min(left, cw - tipW - 4));
          let top = tile.offsetTop - tipH - 8;
          if (top < 4) top = tile.offsetTop + tile.offsetHeight + 8;
          top = Math.max(4, Math.min(top, ch - tipH - 4));
          tip.style.left = left + "px"; tip.style.top = top + "px";
        });
        tile.addEventListener("mouseleave", () => { tile.style.background = tile.dataset.bg; tip.style.display = "none"; });
      });
    });
  }

  // ── Entrada ──
  function render(doc, prices) {
    CURRENT_DOC = doc;
    window.__PRICES = prices;
    CFG.usarDoc(doc);          // cuentas/activos/objetivo salen de tus datos
    const m = window.SolventoModel.build(doc, prices);
    window.__MODEL = m;
    try { window.__ANALITICA = window.SolventoModel.buildAnalitica(doc, prices); }
    catch (e) { window.__ANALITICA = null; }
    try { window.__GASTOS = window.SolventoModel.buildGastos(doc); }
    catch (e) { window.__GASTOS = null; }
    document.getElementById("v2-page-patrimonio").innerHTML = pagePatrimonio(m);
    document.getElementById("v2-page-caja").innerHTML = pageCaja(m);
    document.getElementById("v2-page-gastos").innerHTML = pageGastos(m);
    document.getElementById("v2-page-cartera").innerHTML = pageCartera(m, prices);
    document.getElementById("v2-page-inmuebles").innerHTML = pageInmuebles(m);
    document.getElementById("v2-page-pasivos").innerHTML = pagePasivos(m);
    bindTreemapHover();
    // Gráficas de evolución (patrimonio neto + cartera)
    if (window.SolventoModel.buildSeries && window.SolventoCharts) {
      const series = window.SolventoModel.buildSeries(doc, prices);
      window.__SERIES = series;
      const cp = document.getElementById("v2-chart-patrimonio");
      if (cp) window.SolventoCharts.mount(cp, series.patrimonio, { color: "#10b981", id: "patr" });
      const cc = document.getElementById("v2-chart-cartera");
      if (cc) window.SolventoCharts.mount(cc, series.cartera, { color: "#8b5cf6", id: "cart" });
      montarComparativa();
    }
    // ajustar treemap si la pestaña Cartera está activa; y en cualquier resize
    if (document.getElementById("v2-page-cartera").classList.contains("active")) layoutTreemaps();
    if (!render._resizeBound) { render._resizeBound = true; window.addEventListener("resize", layoutTreemaps); }
  }

  // Filtros: se repinta solo la lista para no perder el foco del buscador
  const valDe = (id) => { const e = document.getElementById(id); return e ? e.value : ""; };
  const pintarMov = () => { const c = document.getElementById("v2-mov-lista"); if (c) c.innerHTML = movimientosTabla(); };
  const pintarOps = () => { const c = document.getElementById("v2-ops-lista"); if (c) c.innerHTML = operacionesTabla(OPS_BANCO); };
  window.v2MovFiltro = () => {
    MOV.q = valDe("v2-mov-q"); MOV.tipo = valDe("v2-mov-tipo"); MOV.cuenta = valDe("v2-mov-cuenta");
    MOV.cat = valDe("v2-mov-cat"); MOV.desde = valDe("v2-mov-desde"); MOV.hasta = valDe("v2-mov-hasta");
    MOV.limite = PAGINA;                 // al cambiar el filtro se vuelve al principio
    pintarMov();
  };
  window.v2MovMas = () => { MOV.limite += PAGINA; pintarMov(); };
  window.v2MovLimpiar = () => {
    Object.assign(MOV, { q: "", tipo: "", cuenta: "", cat: "", desde: "", hasta: "", limite: PAGINA });
    render(CURRENT_DOC, window.__PRICES);   // repintado completo para vaciar los campos
  };
  window.v2OpsFiltro = () => {
    OPS.q = valDe("v2-ops-q"); OPS.tipo = valDe("v2-ops-tipo");
    OPS.desde = valDe("v2-ops-desde"); OPS.hasta = valDe("v2-ops-hasta");
    OPS.limite = 40;
    pintarOps();
  };
  window.v2OpsMas = () => { OPS.limite += 40; pintarOps(); };
  window.v2OpsLimpiar = () => {
    Object.assign(OPS, { q: "", tipo: "", desde: "", hasta: "", limite: 40 });
    render(CURRENT_DOC, window.__PRICES);
  };
  // Clic en una cuenta de Caja: ver solo sus movimientos
  window.v2VerCuenta = (cuenta) => {
    Object.assign(MOV, { q: "", tipo: "", cuenta, cat: "", desde: "", hasta: "", limite: PAGINA });
    render(CURRENT_DOC, window.__PRICES);
    showPage("caja");
    const l = document.getElementById("v2-mov-lista");
    if (l) l.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // Acciones de formularios (globales para onclick)
  const F = () => window.SolventoForms;
  window.v2AddMov = () => F() && F().openMovimiento();
  window.v2AddInv = () => F() && F().openInversion();
  window.v2AddInm = () => F() && F().openInmueble();
  window.v2AddNav = () => F() && F().openNav();
  window.v2Cuadrar = (cuenta, saldo) => F() && F().openCuadrar(cuenta, saldo);
  window.v2AddPas = () => F() && F().openPasivo();
  window.v2Ajustes = () => F() && F().openAjustes();
  window.v2GastoMes = (ym) => {
    GASTO_MES = ym;
    document.getElementById("v2-page-gastos").innerHTML = pageGastos(window.__MODEL);
  };
  window.v2Presupuesto = (cat) => F() && F().openPresupuesto(cat);
  window.v2Password = () => F() && F().openPassword();
  window.v2CfgCuenta = (i) => F() && F().openCuentaCfg(i);
  window.v2CfgDelCuenta = (i) => F() && F().borrarCuentaCfg(i);
  window.v2CfgActivo = (i) => F() && F().openActivoCfg(i);
  window.v2CfgDelActivo = (i) => F() && F().borrarActivoCfg(i);
  window.v2CfgObjetivo = () => F() && F().openObjetivoCfg();
  window.v2EditPas = (id) => F() && F().editPasivo(id);
  window.v2DelPas = (id) => { if (F() && confirm("¿Borrar esta deuda?")) F().deletePasivo(id); };
  window.v2CarteraTab = (id) => {
    CARTERA_TAB = id;
    const pg = document.getElementById("v2-page-cartera");
    if (!pg || !CARTERA_CTX) return;
    pg.innerHTML = pageCartera(CARTERA_CTX.m, CARTERA_CTX.prices);
    afterCarteraRender();
  };

  // Tras pintar la Cartera: montar la gráfica (solo en Agregado) y el treemap
  function afterCarteraRender() {
    bindTreemapHover();
    layoutTreemaps();
    const cc = document.getElementById("v2-chart-cartera");
    if (cc && window.__SERIES && window.SolventoCharts) {
      window.SolventoCharts.mount(cc, window.__SERIES.cartera, { color: "#8b5cf6", id: "cart" });
    }
    montarComparativa();
  }

  function montarComparativa() {
    const el = document.getElementById("v2-chart-comparativa");
    const an = window.__ANALITICA;
    if (el && an && an.comparativa && window.SolventoCharts && window.SolventoCharts.mountMulti) {
      window.SolventoCharts.mountMulti(el, an.comparativa, { meses: an.meses });
    }
  }
  window.v2EditMov = (id) => F() && F().editMovimiento(id);
  window.v2EditInv = (id) => F() && F().editInversion(id);
  window.v2EditInm = (id) => F() && F().editInmueble(id);
  window.v2DelMov = (id) => { if (F() && confirm("¿Borrar este movimiento?")) F().deleteMovimiento(id); };
  window.v2DelInv = (id) => { if (F() && confirm("¿Borrar esta operación?")) F().deleteInversion(id); };
  window.v2DelInm = (id) => { if (F() && confirm("¿Borrar este inmueble?")) F().deleteInmueble(id); };

  window.SolventoRender = { render, showPage };
})();
