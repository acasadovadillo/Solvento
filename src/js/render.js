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
    const OBJ = CFG.OBJETIVO_ASIGNACION;
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
  function hubCard(titulo, valor, pct, color, sub, subColor) {
    return `<div class="dashboard-panel" style="border-left:3px solid ${color};">
      <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;font-weight:700;color:${color};margin-bottom:0.6rem;">${esc(titulo)}</div>
      <div style="font-size:1.7rem;font-weight:800;color:#fff;letter-spacing:-0.02em;">${valor}</div>
      <div style="font-size:0.82rem;color:${subColor || "#9ca3af"};font-weight:600;margin-top:0.3rem;">${sub}</div>
      <div style="font-size:0.78rem;color:#6b7280;margin-top:0.15rem;">${pct.toFixed(2)}% del patrimonio</div>
    </div>`;
  }

  let CURRENT_DOC = null;

  function movimientosList() {
    const mov = (CURRENT_DOC && CURRENT_DOC.movimientos) || [];
    const rows = mov.slice().sort((a, b) => parseFechaES(b.fecha) - parseFechaES(a.fecha)).slice(0, 30).map((r) => {
      const signo = r.tipo === "Ingreso" ? "+" : (r.tipo === "Gasto" ? "−" : "");
      const color = r.tipo === "Ingreso" ? GREEN : (r.tipo === "Gasto" ? RED : "#9ca3af");
      const det = esc(r.detalle || r.tipo_gasto || r.tipo_ingreso || "—");
      return `<tr class="table-row">
        <td style="text-align:left;color:#9ca3af;font-size:0.82rem;white-space:nowrap;">${esc(r.fecha)}</td>
        <td style="text-align:left;"><span style="color:${color};font-weight:600;font-size:0.8rem;">${esc(r.tipo)}</span> <span style="color:#e5e7eb;">${det}</span></td>
        <td style="text-align:right;color:${color};font-weight:600;white-space:nowrap;">${signo}${fmtEur(Number(r.importe))}</td>
        ${rowActions(`v2EditMov('${r.id}')`, `v2DelMov('${r.id}')`)}</tr>`;
    }).join("");
    return `<div class="v2-wrap" style="padding-bottom:2rem;"><div class="table-container">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;flex-wrap:wrap;gap:0.5rem;">
        <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Movimientos recientes</div>
        ${addBtn("＋ Movimiento", "v2AddMov()")}
      </div>
      <table class="minimal-table"><tbody>${rows || '<tr><td style="color:#6b7280;padding:1rem;">Sin movimientos</td></tr>'}</tbody></table>
    </div></div>`;
  }

  function operacionesList(banco) {
    let inv = (CURRENT_DOC && CURRENT_DOC.inversiones) || [];
    if (banco) inv = inv.filter((r) => String(r.cuenta || "").trim() === banco);
    const MC = { Compra: GREEN, Venta: RED, Traspaso: "#3b82f6" };
    const rows = inv.slice().sort((a, b) => parseFechaES(b.fecha) - parseFechaES(a.fecha)).slice(0, 40).map((r) => {
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
    return `<div class="v2-wrap" style="padding-bottom:2rem;"><div class="table-container">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;flex-wrap:wrap;gap:0.5rem;">
        <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Historial de operaciones</div>
        <div style="display:flex;gap:0.5rem;">${addBtn("＋ NAV", "v2AddNav()")}${addBtn("＋ Operación", "v2AddInv()")}</div>
      </div>
      <table class="minimal-table"><tbody>${rows || '<tr><td style="color:#6b7280;padding:1rem;">Sin operaciones</td></tr>'}</tbody></table>
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
        ${hubCard("Caja", fmtEur(m.patrimonioLiquido), m.pctLiquidez, "#3b82f6", m.saldos.length + " cuentas")}
        ${hubCard("Cartera", fmtEur(m.carteraTotal), m.ratioInv, "#10b981", m.inv.hayRentabilidad ? fmtPct(m.inv.rentPct) : "—", rc(m.inv.rentPct))}
        ${hubCard("Inmuebles", fmtEur(m.inm.total), m.ratioInm, "#a16207", m.inm.n + " inmuebles")}
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

  // ── Cartera: sub-navegación por bróker (Agregado / TR / MyInvestor / Bankinter) ──
  let CARTERA_TAB = "agregado";
  let CARTERA_CTX = null;   // {m, prices} para re-renderizar al cambiar de pestaña

  function subNavCartera() {
    const tabs = [{ id: "agregado", label: "Agregado" }]
      .concat(CFG.BROKERS.map((b) => ({ id: b.cuenta, label: b.cuenta })));
    return `<div class="v2-wrap" style="margin-top:0.5rem;"><div style="display:flex;gap:0.25rem;border-bottom:1px solid #2a2d3a;overflow-x:auto;">` +
      tabs.map((t) => {
        const on = CARTERA_TAB === t.id;
        const idJs = String(t.id).replace(/'/g, "\\'");
        return `<button onclick="v2CarteraTab('${idJs}')" style="background:none;border:none;border-bottom:2px solid ${on ? "#fff" : "transparent"};color:${on ? "#fff" : "#6b7280"};font-weight:${on ? 700 : 500};font-size:0.88rem;padding:0.5rem 1rem 0.6rem;cursor:pointer;font-family:inherit;white-space:nowrap;margin-bottom:-1px;">${esc(t.label)}</button>`;
      }).join("") + `</div></div>`;
  }

  // Efectivo de un bróker: el saldo de su cuenta, o 0 fijo (Bankinter, cuenta figurativa)
  function efectivoBroker(m, cuenta) {
    const cfg = CFG.BROKERS.find((b) => b.cuenta === cuenta);
    if (!cfg) return { valor: 0, etiqueta: "Efectivo" };
    if (cfg.efectivo === "cero") return { valor: 0, etiqueta: cfg.etiquetaEfectivo || "Cuenta Broker", fijo: true };
    const s = (m.saldos || []).find((x) => x.cuenta === cuenta);
    return { valor: s ? s.saldo : 0, etiqueta: cfg.etiquetaEfectivo || "Efectivo sin invertir" };
  }

  function tarjetaEfectivo(m, cuenta) {
    const cta = CFG.CUENTAS.find((c) => c.cuenta === cuenta) || {};
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
        <div class="v2-hub-grid">${CFG.BROKERS.map((b) => tarjetaEfectivo(m, b.cuenta)).join("")}</div></div>`;
      return aviso + heroCartera(m.carteraTotal, inv, "Valor total (posiciones + efectivo)") + tarjetas +
        chartPanel("Evolución de la cartera", "v2-chart-cartera") +
        asignacionPanel(inv) +
        donutTipos(inv.assets, inv.total) +
        treemapPanel(inv.assets) +
        tablaCartera(inv) +
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
      return `<tr class="table-row"><td style="text-align:left;"><div style="display:flex;align-items:center;gap:0.6rem;"><span style="width:9px;height:9px;border-radius:50%;background:${s.accent};flex-shrink:0;"></span>${icon}<span style="color:#fff;font-weight:600;">${esc(s.cuenta)}</span></div></td><td style="text-align:right;color:#fff;font-weight:600;white-space:nowrap;">${fmtEur(s.saldo)}</td><td style="text-align:right;color:#9ca3af;">${s.pct.toFixed(2)}%</td><td style="text-align:right;width:1%;"><button onclick="v2Cuadrar('${cuentaJs}',${s.saldo})" title="Cuadrar con el saldo real del banco" style="background:none;border:none;color:#6b7280;cursor:pointer;font-size:0.9rem;padding:0.2rem 0.4rem;">⚖️</button></td></tr>`;
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

  function pagePasivos() {
    return header("Pasivos", "0,00 €") +
      `<div class="v2-wrap"><div class="dashboard-panel" style="text-align:center;color:#6b7280;padding:3rem;">Sin deudas registradas</div></div>`;
  }

  // ── Navegación ──
  function showPage(id) {
    document.querySelectorAll("#app .page").forEach((p) => p.classList.remove("active"));
    const pg = document.getElementById("v2-page-" + id);
    if (pg) pg.classList.add("active");
    document.querySelectorAll('.nav-tab, .mobile-nav-item').forEach((b) => b.classList.toggle("active", b.dataset.page === id));
    window.scrollTo({ top: 0, behavior: "auto" });
    if (id === "cartera") layoutTreemaps();
  }
  window.v2Tab = showPage;
  window.v2ToggleMobileNav = function () {
    const panel = document.getElementById("mobile-nav-panel");
    const btn = document.getElementById("nav-hamburger");
    const open = panel.classList.toggle("open");
    btn.classList.toggle("open", open);
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
    const m = window.SolventoModel.build(doc, prices);
    window.__MODEL = m;
    document.getElementById("v2-page-patrimonio").innerHTML = pagePatrimonio(m);
    document.getElementById("v2-page-caja").innerHTML = pageCaja(m);
    document.getElementById("v2-page-cartera").innerHTML = pageCartera(m, prices);
    document.getElementById("v2-page-inmuebles").innerHTML = pageInmuebles(m);
    document.getElementById("v2-page-pasivos").innerHTML = pagePasivos();
    bindTreemapHover();
    // Gráficas de evolución (patrimonio neto + cartera)
    if (window.SolventoModel.buildSeries && window.SolventoCharts) {
      const series = window.SolventoModel.buildSeries(doc, prices);
      window.__SERIES = series;
      const cp = document.getElementById("v2-chart-patrimonio");
      if (cp) window.SolventoCharts.mount(cp, series.patrimonio, { color: "#10b981", id: "patr" });
      const cc = document.getElementById("v2-chart-cartera");
      if (cc) window.SolventoCharts.mount(cc, series.cartera, { color: "#8b5cf6", id: "cart" });
    }
    // ajustar treemap si la pestaña Cartera está activa; y en cualquier resize
    if (document.getElementById("v2-page-cartera").classList.contains("active")) layoutTreemaps();
    if (!render._resizeBound) { render._resizeBound = true; window.addEventListener("resize", layoutTreemaps); }
  }

  // Acciones de formularios (globales para onclick)
  const F = () => window.SolventoForms;
  window.v2AddMov = () => F() && F().openMovimiento();
  window.v2AddInv = () => F() && F().openInversion();
  window.v2AddInm = () => F() && F().openInmueble();
  window.v2AddNav = () => F() && F().openNav();
  window.v2Cuadrar = (cuenta, saldo) => F() && F().openCuadrar(cuenta, saldo);
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
  }
  window.v2EditMov = (id) => F() && F().editMovimiento(id);
  window.v2EditInv = (id) => F() && F().editInversion(id);
  window.v2EditInm = (id) => F() && F().editInmueble(id);
  window.v2DelMov = (id) => { if (F() && confirm("¿Borrar este movimiento?")) F().deleteMovimiento(id); };
  window.v2DelInv = (id) => { if (F() && confirm("¿Borrar esta operación?")) F().deleteInversion(id); };
  window.v2DelInm = (id) => { if (F() && confirm("¿Borrar este inmueble?")) F().deleteInmueble(id); };

  window.SolventoRender = { render, showPage };
})();
