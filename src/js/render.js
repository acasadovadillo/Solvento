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

  // ── Páginas ──
  function pagePatrimonio(m) {
    return header("Patrimonio", fmtEur(m.patrimonioNeto)) +
      propBar(m) +
      `<div class="v2-hub-grid">
        ${hubCard("Caja", fmtEur(m.patrimonioLiquido), m.pctLiquidez, "#3b82f6", m.saldos.length + " cuentas")}
        ${hubCard("Cartera", fmtEur(m.inv.total), m.ratioInv, "#10b981", m.inv.hayRentabilidad ? fmtPct(m.inv.rentPct) : "—", rc(m.inv.rentPct))}
        ${hubCard("Inmuebles", fmtEur(m.inm.total), m.ratioInm, "#a16207", m.inm.n + " inmuebles")}
      </div>` +
      donutPanel("Distribución del patrimonio",
        [{ label: "Caja", value: m.patrimonioLiquido, accent: "#3b82f6" },
         { label: "Cartera", value: m.inv.total, accent: "#10b981" },
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

  function pageCartera(m, prices) {
    const inv = m.inv;
    const heroSub = `${fmtEur(inv.total)}`;
    const heroCard = `<div class="v2-wrap"><div class="hero-card">
      <div class="hero-main"><span class="hero-item-label">Valor actual</span><span class="hero-value">${fmtEur(inv.total)}</span></div>
      <div class="hero-breakdown">
        <div class="hero-item"><span class="hero-item-label">Invertido</span><span class="hero-item-value">${inv.hayRentabilidad ? fmtEur(inv.totalCoste) : "—"}</span></div>
        <div class="hero-item"><span class="hero-item-label">Ganancia</span><span class="hero-item-value" style="color:${rc(inv.totalGanancia)};">${inv.hayRentabilidad ? (inv.totalGanancia >= 0 ? "+" : "") + fmtEur(inv.totalGanancia) : "—"}</span></div>
        <div class="hero-item"><span class="hero-item-label">Rentabilidad</span><span class="hero-item-value" style="color:${rc(inv.rentPct)};">${inv.hayRentabilidad ? fmtPct(inv.rentPct) : "—"}${isFinite(inv.portfolioCagr) ? '<span style="display:block;font-size:0.65rem;color:#9ca3af;font-weight:500;margin-top:0.15rem;">CAGR ' + (inv.portfolioCagr >= 0 ? "+" : "") + inv.portfolioCagr.toFixed(1) + '% p.a.</span>' : ""}</span></div>
      </div></div></div>`;
    // donut por tipo de activo
    const porTipo = {};
    inv.assets.forEach((a) => { if (isFinite(a.importe)) porTipo[a.tipo] = (porTipo[a.tipo] || 0) + a.importe; });
    const tipoItems = Object.keys(porTipo).map((t) => ({ label: t, value: porTipo[t], accent: CFG.TIPO_COLORES[t] || "#6b7280" })).sort((a, b) => b.value - a.value);
    const avisoPrecios = prices ? "" : `<div class="v2-wrap"><div style="padding:0.6rem 1rem;background:#3f2d0a;border:1px solid #a16207;border-radius:10px;font-size:0.82rem;color:#fbbf24;">⏳ Cargando precios de mercado…</div></div>`;
    return header("Cartera", heroSub.replace(fmtEur(inv.total), "")) + avisoPrecios + heroCard +
      asignacionPanel(inv) +
      donutPanel("Distribución por activos", tipoItems, fmtEur(inv.total), "Activos", inv.total) +
      treemapPanel(inv.assets) +
      tablaCartera(inv);
  }

  function pageCaja(m) {
    const items = m.saldos.filter((s) => s.saldo !== 0).map((s) => ({ label: s.cuenta, value: s.saldo, accent: s.accent }));
    const rows = m.saldos.map((s) => {
      const icon = s.logo ? `<img src="${s.logo}" alt="" style="width:20px;height:20px;object-fit:contain;border-radius:4px;">` : `<span style="font-size:1.1rem;">${s.emoji || ""}</span>`;
      return `<tr class="table-row"><td style="text-align:left;"><div style="display:flex;align-items:center;gap:0.6rem;"><span style="width:9px;height:9px;border-radius:50%;background:${s.accent};flex-shrink:0;"></span>${icon}<span style="color:#fff;font-weight:600;">${esc(s.cuenta)}</span></div></td><td style="text-align:right;color:#fff;font-weight:600;white-space:nowrap;">${fmtEur(s.saldo)}</td><td style="text-align:right;color:#9ca3af;">${s.pct.toFixed(2)}%</td></tr>`;
    }).join("");
    return header("Caja", fmtEur(m.patrimonioLiquido)) +
      donutPanel("Distribución de la caja", items, fmtEur(m.patrimonioLiquido), "Total", m.patrimonioLiquido) +
      `<div class="v2-wrap" style="padding-bottom:2rem;"><div class="table-container"><table class="minimal-table"><thead><tr><th style="text-align:left;">Cuenta</th><th style="text-align:right;">Saldo</th><th style="text-align:right;">Peso</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }

  function pageInmuebles(m) {
    const inm = m.inm;
    const porTipo = {};
    inm.items.forEach((r) => { if (isFinite(r.importe)) porTipo[r.tipo] = (porTipo[r.tipo] || 0) + r.importe; });
    const items = Object.keys(porTipo).map((t) => ({ label: t, value: porTipo[t], accent: CFG.TIPO_COLORES_INMUEBLE[t] || CFG.INMUEBLE_ACCENT_DEFAULT })).sort((a, b) => b.value - a.value);
    const rows = inm.items.map((r) => `<tr class="table-row"><td style="text-align:left;"><div style="display:flex;align-items:center;gap:0.6rem;"><span style="width:9px;height:9px;border-radius:50%;background:${r.accent};flex-shrink:0;"></span><div><div style="color:#fff;font-weight:600;">${esc(r.nombre)}</div><div style="font-size:0.74rem;color:#6b7280;">${esc(r.tipo)}</div></div></div></td><td style="text-align:right;color:#fff;font-weight:600;white-space:nowrap;">${fmtEur(r.importe)}</td></tr>`).join("");
    return header("Inmuebles", fmtEur(inm.total)) +
      donutPanel("Distribución por tipo", items, fmtEur(inm.total), "Total", inm.total) +
      `<div class="v2-wrap" style="padding-bottom:2rem;"><div class="table-container"><table class="minimal-table"><thead><tr><th style="text-align:left;">Inmueble</th><th style="text-align:right;">Tasación</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
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
    const m = window.SolventoModel.build(doc, prices);
    window.__MODEL = m;
    document.getElementById("v2-page-patrimonio").innerHTML = pagePatrimonio(m);
    document.getElementById("v2-page-caja").innerHTML = pageCaja(m);
    document.getElementById("v2-page-cartera").innerHTML = pageCartera(m, prices);
    document.getElementById("v2-page-inmuebles").innerHTML = pageInmuebles(m);
    document.getElementById("v2-page-pasivos").innerHTML = pagePasivos();
    bindTreemapHover();
    // ajustar treemap si la pestaña Cartera está activa; y en cualquier resize
    if (document.getElementById("v2-page-cartera").classList.contains("active")) layoutTreemaps();
    if (!render._resizeBound) { render._resizeBound = true; window.addEventListener("resize", layoutTreemaps); }
  }

  window.SolventoRender = { render, showPage };
})();
