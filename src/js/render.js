/*
 * Solvento v2 — Render (Fase 2, resumen). Construye el modelo con SolventoModel
 * y pinta patrimonio, cartera, caja e inmuebles desde los datos descifrados.
 * Las gráficas (evolución, treemap, donuts) llegan en el siguiente incremento.
 */
(function () {
  "use strict";
  const CFG = window.SolventoConfig;

  const eurFmt = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
  const fmtEur = (x) => (isFinite(x) ? eurFmt.format(x) : "—");
  const fmtPct = (x) => (isFinite(x) ? (x >= 0 ? "+" : "") + x.toFixed(2).replace(".", ",") + "%" : "—");
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const green = "#10b981", red = "#ef4444";
  const rc = (x) => (isFinite(x) && x < 0 ? red : green);

  function logoImg(nombre, isin, size) {
    const src = CFG.assetLogo(nombre, isin);
    const s = size || 22;
    return src
      ? `<img src="${src}" alt="" style="width:${s}px;height:${s}px;object-fit:contain;border-radius:5px;flex-shrink:0;">`
      : `<span style="display:inline-block;width:${s}px;height:${s}px;flex-shrink:0;"></span>`;
  }

  function heroPatrimonio(m) {
    const seg = (pct, color, label) =>
      `<div title="${label}: ${pct.toFixed(1)}%" style="width:${Math.max(0, pct).toFixed(2)}%;background:${color};"></div>`;
    return `
      <div style="margin-bottom:0.35rem;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;font-weight:700;">Patrimonio neto</div>
      <div style="font-size:2.4rem;font-weight:800;letter-spacing:-0.02em;color:#fff;margin-bottom:1.1rem;">${fmtEur(m.patrimonioNeto)}</div>
      <div style="height:6px;border-radius:4px;overflow:hidden;display:flex;margin-bottom:1.25rem;background:#12141d;">
        ${seg(m.pctLiquidez, "#3b82f6", "Caja")}${seg(m.ratioInv, "#10b981", "Cartera")}${seg(m.ratioInm, "#a16207", "Inmuebles")}
      </div>
      <div class="stat-grid">
        ${hubCard("Caja", fmtEur(m.patrimonioLiquido), m.pctLiquidez, "#3b82f6", m.saldos.length + " cuentas")}
        ${hubCard("Cartera", fmtEur(m.inv.total), m.ratioInv, "#10b981", m.inv.hayRentabilidad ? fmtPct(m.inv.rentPct) : "—", rc(m.inv.rentPct))}
        ${hubCard("Inmuebles", fmtEur(m.inm.total), m.ratioInm, "#a16207", m.inm.n + " inmuebles")}
      </div>`;
  }

  function hubCard(titulo, valor, pct, color, sub, subColor) {
    return `
      <div class="stat" style="border-left:3px solid ${color};">
        <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;font-weight:700;color:${color};margin-bottom:0.5rem;">${titulo}</div>
        <div style="font-size:1.5rem;font-weight:800;color:#fff;letter-spacing:-0.02em;">${valor}</div>
        <div style="font-size:0.8rem;color:${subColor || "#9ca3af"};font-weight:600;margin-top:0.2rem;">${sub}</div>
        <div style="font-size:0.75rem;color:#6b7280;margin-top:0.15rem;">${pct.toFixed(2)}% del patrimonio</div>
      </div>`;
  }

  function tablaCartera(inv) {
    const TD = "padding:0.7rem 0.9rem;border-bottom:1px solid #2a2d3a;";
    const rows = inv.assets.map((a) => {
      const rentCell = (a.coste > 0 && isFinite(a.importe))
        ? `<div style="color:${rc(a.ganancia)};font-weight:600;">${a.ganancia >= 0 ? "+" : ""}${fmtEur(a.ganancia)}</div>
           <div style="color:${rc(a.rentPct)};font-size:0.78rem;">${fmtPct(a.rentPct)}${isFinite(a.cagr) && a.coste >= 100 ? " · CAGR " + a.cagr.toFixed(1) + "%" : ""}</div>`
        : `<span style="color:#4b5563;">—</span>`;
      return `<tr>
        <td style="${TD}">
          <div style="display:flex;align-items:center;gap:0.6rem;">
            ${logoImg(a.nombre, a.isin)}
            <div>
              <div style="font-weight:600;color:#fff;font-size:0.9rem;">${esc(a.nombre)}</div>
              <div style="font-size:0.74rem;color:#6b7280;">${esc(a.tipo)}${a.isin && a.isin !== "-" ? ' · <span style="font-family:ui-monospace,monospace;">' + esc(a.isin) + "</span>" : ""}</div>
            </div>
          </div>
        </td>
        <td style="${TD}text-align:right;color:#fff;font-weight:600;white-space:nowrap;">${fmtEur(a.importe)}</td>
        <td style="${TD}text-align:right;color:#9ca3af;white-space:nowrap;">${a.coste ? fmtEur(a.coste) : "—"}</td>
        <td style="${TD}text-align:right;white-space:nowrap;">${rentCell}</td>
        <td style="${TD}text-align:right;color:#3b82f6;font-weight:600;">${a.pct.toFixed(2)}%</td>
      </tr>`;
    }).join("");
    return `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
          <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:700;">Cartera</div>
          <div style="font-size:0.82rem;color:#9ca3af;">Invertido ${fmtEur(inv.totalCoste)} · ${inv.hayRentabilidad ? '<span style="color:' + rc(inv.totalGanancia) + ';font-weight:600;">' + (inv.totalGanancia >= 0 ? "+" : "") + fmtEur(inv.totalGanancia) + " (" + fmtPct(inv.rentPct) + ")</span>" : "—"}</div>
        </div>
        <div style="overflow-x:auto;">
          <table>
            <thead><tr><th>Activo</th><th style="text-align:right;">Valor actual</th><th style="text-align:right;">Invertido</th><th style="text-align:right;">Rentabilidad</th><th style="text-align:right;">Peso</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  }

  function tablaCuentas(saldos) {
    const TD = "padding:0.7rem 0.9rem;border-bottom:1px solid #2a2d3a;";
    const rows = saldos.map((s) => {
      const icon = s.logo
        ? `<img src="${s.logo}" alt="" style="width:20px;height:20px;object-fit:contain;border-radius:4px;">`
        : `<span style="font-size:1.1rem;">${s.emoji || ""}</span>`;
      return `<tr>
        <td style="${TD}"><div style="display:flex;align-items:center;gap:0.6rem;"><span style="width:9px;height:9px;border-radius:50%;background:${s.accent};flex-shrink:0;"></span>${icon}<span style="color:#fff;font-weight:600;">${esc(s.cuenta)}</span></div></td>
        <td style="${TD}text-align:right;color:#fff;font-weight:600;white-space:nowrap;">${fmtEur(s.saldo)}</td>
        <td style="${TD}text-align:right;color:#9ca3af;">${s.pct.toFixed(2)}%</td>
      </tr>`;
    }).join("");
    return `
      <div class="card">
        <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:700;margin-bottom:1rem;">Caja · cuentas</div>
        <div style="overflow-x:auto;"><table>
          <thead><tr><th>Cuenta</th><th style="text-align:right;">Saldo</th><th style="text-align:right;">Peso</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>`;
  }

  function tablaInmuebles(inm) {
    const TD = "padding:0.7rem 0.9rem;border-bottom:1px solid #2a2d3a;";
    const rows = inm.items.map((r) => `<tr>
        <td style="${TD}"><div style="display:flex;align-items:center;gap:0.6rem;"><span style="width:9px;height:9px;border-radius:50%;background:${r.accent};flex-shrink:0;"></span><div><div style="color:#fff;font-weight:600;">${esc(r.nombre)}</div><div style="font-size:0.74rem;color:#6b7280;">${esc(r.tipo)}</div></div></div></td>
        <td style="${TD}text-align:right;color:#fff;font-weight:600;white-space:nowrap;">${fmtEur(r.importe)}</td>
      </tr>`).join("");
    return `
      <div class="card">
        <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:700;margin-bottom:1rem;">Inmuebles</div>
        <div style="overflow-x:auto;"><table>
          <thead><tr><th>Inmueble</th><th style="text-align:right;">Tasación</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>`;
  }

  function render(doc, prices) {
    const m = window.SolventoModel.build(doc, prices);
    window.__MODEL = m; // para verificación
    const cont = document.getElementById("app-content");
    const avisoPrecios = prices ? "" :
      `<div style="max-width:1100px;margin:0 auto 1rem;padding:0.6rem 1rem;background:#3f2d0a;border:1px solid #a16207;border-radius:10px;font-size:0.82rem;color:#fbbf24;">⏳ Cargando precios de mercado… (la cartera se valora en cuanto lleguen)</div>`;
    cont.innerHTML =
      avisoPrecios +
      `<div class="card" style="margin-bottom:1.25rem;">${heroPatrimonio(m)}</div>` +
      `<div style="margin-bottom:1.25rem;">${tablaCartera(m.inv)}</div>` +
      `<div style="margin-bottom:1.25rem;">${tablaCuentas(m.saldos)}</div>` +
      tablaInmuebles(m.inm);
  }

  window.SolventoRender = { render };
})();
