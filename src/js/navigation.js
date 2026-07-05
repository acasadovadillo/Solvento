function formatEur(val) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(val);
}

function showPage(id) {
  const current = document.querySelector(".page.active");
  const alreadyActive = current && current.id === "page-" + id;
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  const pg = document.getElementById("page-" + id);
  if (pg) pg.classList.add("active");
  document.querySelectorAll(".nav-tab").forEach(b => b.classList.remove("active"));
  const tab = document.getElementById("nav-tab-" + id);
  if (tab) tab.classList.add("active");
  document.querySelectorAll(".mobile-nav-item").forEach(b => b.classList.remove("active"));
  const mb = document.getElementById("mnav-" + id);
  if (mb) mb.classList.add("active");
  window.location.hash = id;
  if (alreadyActive) window.scrollTo({ top: 0, behavior: "smooth" });
}

function navTab(id) {
  showPage(id);
  document.querySelectorAll('.mobile-nav-item').forEach(b => b.classList.remove('active'));
  const mb = document.getElementById('mnav-' + id);
  if (mb) mb.classList.add('active');
}

function toggleMobileNav() {
  const panel = document.getElementById('mobile-nav-panel');
  const btn   = document.getElementById('nav-hamburger');
  const open  = panel.classList.toggle('open');
  btn.classList.toggle('open', open);
}

(function () {
  const hash = window.location.hash.replace("#", "");
  if (hash) showPage(hash);
})();

// ── Movimientos: estado único de filtros (cuenta + búsqueda + paginación) ──
let movCuentaActiva = "__all__";
const MOV_PAGE = 50;
let movLimit = MOV_PAGE;

function aplicarFiltrosMov(reset) {
  if (reset) movLimit = MOV_PAGE;
  const q = (document.getElementById("mov-search")?.value || "").toLowerCase().trim();
  let matched = 0, shown = 0;
  document.querySelectorAll("#mov-tbody tr").forEach(tr => {
    let ok;
    if (movCuentaActiva === "__all__") {
      // In Todos, hide the destination-side of traspasos to avoid double-counting
      ok = tr.dataset.traspasoDir !== "entrada";
    } else {
      ok = (tr.dataset.cuentas || "").split("|").includes(movCuentaActiva);
    }
    if (ok && q) ok = (tr.dataset.search || "").includes(q);
    if (ok) {
      matched++;
      const visible = matched <= movLimit;
      tr.style.display = visible ? "" : "none";
      if (visible) shown++;
    } else {
      tr.style.display = "none";
    }
  });
  const empty = document.getElementById("mov-empty");
  if (empty) empty.style.display = matched === 0 ? "" : "none";
  const moreWrap = document.getElementById("mov-more-wrap");
  if (moreWrap) {
    const rest = matched - shown;
    moreWrap.style.display = rest > 0 ? "" : "none";
    const moreCount = document.getElementById("mov-more-count");
    if (moreCount) moreCount.textContent = rest + " restantes";
  }
}

function movMostrarMas() {
  movLimit += MOV_PAGE;
  aplicarFiltrosMov(false);
}

function _setCmovTabActiva(cuenta) {
  const target = cuenta === "__all__" ? "Todos" : cuenta;
  document.querySelectorAll(".cmov-tab").forEach(b => {
    const active = b.textContent.trim() === target;
    b.style.borderBottom = active ? "2px solid #ffffff" : "2px solid transparent";
    b.style.color = active ? "#ffffff" : "#6b7280";
    b.style.fontWeight = active ? "700" : "400";
  });
}

function showMovimientos(cuenta) {
  showPage("cuentas");
  const badge = document.getElementById("mov-filter-badge");
  const label = document.getElementById("mov-filter-label");
  const saldoEl = document.getElementById("mov-filter-saldo");
  movCuentaActiva = cuenta || "__all__";
  _setCmovTabActiva(movCuentaActiva);
  if (cuenta) {
    if (badge) badge.style.display = "inline-flex";
    if (label) label.textContent = cuenta + " · ";
    if (saldoEl && typeof saldosCuentas !== "undefined" && saldosCuentas[cuenta] !== undefined) {
      saldoEl.textContent = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(saldosCuentas[cuenta]) + " €";
    }
  } else {
    if (badge) badge.style.display = "none";
  }
  aplicarFiltrosMov(true);
  setTimeout(() => {
    const sec = document.getElementById("mov-section");
    if (sec) sec.scrollIntoView({ behavior: "smooth" });
  }, 50);
}

function filterCuentasMov(btn, cuenta) {
  movCuentaActiva = cuenta;
  _setCmovTabActiva(cuenta);
  const badge = document.getElementById("mov-filter-badge");
  if (badge) badge.style.display = "none";
  aplicarFiltrosMov(true);
}

function movFiltrar() {
  aplicarFiltrosMov(true);
}

// Estado inicial: oculta la cara "entrada" de los traspasos y aplica paginación
aplicarFiltrosMov(true);

let explorarTipoActivo = '__all__';

function explorarSetTipo(btn, tipo) {
  explorarTipoActivo = tipo;
  document.querySelectorAll('.explorar-tab').forEach(b => {
    b.style.borderBottom = '2px solid transparent';
    b.style.color = '#6b7280';
    b.style.fontWeight = '400';
  });
  btn.style.borderBottom = '2px solid #ffffff';
  btn.style.color = '#ffffff';
  btn.style.fontWeight = '700';
  explorarFiltrar();
}

function explorarFiltrar() {
  const q = (document.getElementById('explorar-search')?.value || '').toLowerCase();
  let visible = 0;
  document.querySelectorAll('.asset-card').forEach(card => {
    const matchTipo   = explorarTipoActivo === '__all__' || card.dataset.tipo === explorarTipoActivo;
    const matchSearch = !q || (card.dataset.search || '').includes(q);
    card.style.display = matchTipo && matchSearch ? '' : 'none';
    if (matchTipo && matchSearch) visible++;
  });
  const empty = document.getElementById('explorar-empty');
  if (empty) empty.style.display = visible === 0 ? '' : 'none';
}


let _cotRangoActivo = '1M';

function cotChip(btn) {
  document.getElementById('cot-ticker').value = btn.dataset.tv;
  cotizacionesBuscar();
}

function cotizacionesBuscar() {
  const raw = (document.getElementById('cot-ticker')?.value || '').trim();
  if (!raw) return;
  _cotMostrarGrafico(raw.toUpperCase(), _cotRangoActivo);
}

function cotRango(btn, rango) {
  _cotRangoActivo = rango;
  document.querySelectorAll('.cot-range-tab').forEach(b => {
    b.style.borderBottom = '2px solid transparent';
    b.style.color = '#6b7280';
    b.style.fontWeight = '400';
  });
  btn.style.borderBottom = '2px solid #ffffff';
  btn.style.color = '#ffffff';
  btn.style.fontWeight = '700';
  const ticker = (document.getElementById('cot-ticker')?.value || '').trim().toUpperCase();
  if (ticker) _cotMostrarGrafico(ticker, rango);
}

function _cotMostrarGrafico(symbol, range) {
  const placeholder = document.getElementById('cot-placeholder');
  const container = document.getElementById('cot-tv-container');
  if (!container) return;
  if (placeholder) placeholder.style.display = 'none';
  container.style.display = '';
  container.innerHTML = '';

  const intervalMap = { '1M': 'D', '6M': 'D', '12M': 'W', '60M': 'W', 'ALL': 'M' };

  function buildWidget() {
    new TradingView.widget({
      autosize: true,
      symbol: symbol,
      interval: intervalMap[range] || 'D',
      range: range,
      timezone: 'Europe/Madrid',
      theme: 'dark',
      style: '1',
      locale: 'es',
      enable_publishing: false,
      allow_symbol_change: true,
      hide_side_toolbar: false,
      container_id: 'cot-tv-container',
    });
  }

  if (typeof TradingView !== 'undefined') {
    buildWidget();
  } else {
    const s = document.createElement('script');
    s.src = 'https://s3.tradingview.com/tv.js';
    s.onload = buildWidget;
    document.head.appendChild(s);
  }
}

function bindDonutHover(donut) {
  const wrapper = donut.closest(".chart-wrapper");
  const label = wrapper ? wrapper.querySelector(".chart-label") : null;
  donut.querySelectorAll(".sector").forEach(s => {
    const t = s.querySelector("title");
    if (!t || !label) return;
    s.addEventListener("mouseenter", () => {
      label.textContent = t.textContent;
      label.style.opacity = "1";
      label.style.transform = "translateX(-50%) translateY(-5px)";
    });
    s.addEventListener("mouseleave", () => {
      label.style.opacity = "0";
      label.style.transform = "translateX(-50%)";
    });
  });
}

document.querySelectorAll(".donut").forEach(bindDonutHover);

// ── Tarjetas de Explorar: click → gráfica individual del activo ──
(function () {
  const sel = document.getElementById("portfolio-select");
  if (!sel) return;
  const opciones = new Set(Array.from(sel.options).map(o => o.value));
  document.querySelectorAll(".asset-card").forEach(card => {
    const nombre = card.dataset.nombre;
    if (!nombre || !opciones.has(nombre)) return;
    card.style.cursor = "pointer";
    card.title = "Ver gráfica de " + nombre;
    card.addEventListener("click", () => {
      sel.value = nombre;
      sel.dispatchEvent(new Event("change"));
      const panel = sel.closest(".dashboard-panel");
      if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
})();

// ── Desglose de gastos: filtro por mes (re-render de donut + tabla) ──
function gastosRender(key) {
  if (typeof gastosMensuales === "undefined") return;
  const data = gastosMensuales[key];
  if (!data) return;
  const total = data.reduce((s, d) => s + d[1], 0);
  const fmtPct = p => p.toFixed(2).replace(".", ",") + "%";

  const svg = document.getElementById("gastos-donut");
  if (svg) {
    let off = 0, html = "";
    data.forEach(d => {
      const pct = total > 0 ? d[1] / total * 100 : 0;
      const color = gastosCatColors[d[0]] || "#64748b";
      html += `<circle class="sector" cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="${color}" stroke-width="3"` +
        ` stroke-dasharray="${pct.toFixed(4)} ${(100 - pct).toFixed(4)}" stroke-dashoffset="25"` +
        ` style="transform:rotate(${(off * 3.6).toFixed(2)}deg);transform-origin:center;">` +
        `<title>${d[0]}: ${formatEur(d[1])} (${fmtPct(pct)})</title></circle>`;
      off += pct;
    });
    svg.innerHTML = html;
    bindDonutHover(svg);
  }

  const center = document.getElementById("gastos-total-center");
  if (center) center.textContent = formatEur(total);

  const tb = document.getElementById("gastos-tbody");
  if (tb) {
    const TD = "padding:0.75rem 1rem;border-bottom:1px solid #2a2d3a;";
    tb.innerHTML = data.map(d => {
      const pct = total > 0 ? d[1] / total * 100 : 0;
      const color = gastosCatColors[d[0]] || "#64748b";
      return `<tr class="table-row">` +
        `<td style="${TD}text-align:left;"><div style="display:flex;align-items:center;gap:0.6rem;">` +
        `<span style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;"></span>` +
        `<span style="color:#ffffff;font-weight:500;font-size:0.9rem;">${d[0]}</span>` +
        `</div></td>` +
        `<td style="${TD}text-align:right;color:#ffffff;font-weight:600;font-size:0.9rem;">${formatEur(d[1])}</td>` +
        `<td style="${TD}text-align:right;color:#9ca3af;font-size:0.85rem;">${fmtPct(pct)}</td>` +
        `</tr>`;
    }).join("");
  }
}
