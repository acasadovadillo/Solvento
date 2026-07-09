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
  if (typeof layoutTreemaps === "function") layoutTreemaps();
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
  showPage("movimientos");
  window.scrollTo({ top: 0, behavior: "auto" });
  movCuentaActiva = cuenta || "__all__";
  _setCmovTabActiva(movCuentaActiva);
  aplicarFiltrosMov(true);
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

// ── Historial de aportaciones: filtro por activo + navegación desde Cartera ──
function _aplicarFiltroAportaciones() {
  const flt = document.getElementById("apor-filter");
  const cnt = document.getElementById("apor-count");
  if (!flt) return;
  const val = flt.value;
  const rows = document.querySelectorAll("#apor-table tbody tr[data-nombre]");
  let visible = 0, visibleCost = 0;
  rows.forEach(row => {
    const show = !val || row.dataset.nombre === val;
    row.style.display = show ? "" : "none";
    if (show) { visible++; visibleCost += parseFloat(row.dataset.coste || 0); }
  });
  if (cnt) {
    if (val) {
      const c = visibleCost.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      cnt.textContent = visible + " movimientos · " + c + " € invertido";
    } else {
      cnt.textContent = cnt.dataset.total || cnt.textContent;
    }
  }
}

(function () {
  const flt = document.getElementById("apor-filter");
  const cnt = document.getElementById("apor-count");
  if (cnt) cnt.dataset.total = cnt.textContent;
  if (flt) flt.addEventListener("change", _aplicarFiltroAportaciones);
})();

function showAportaciones(nombre) {
  showPage("aportaciones");
  window.scrollTo({ top: 0, behavior: "auto" });
  const flt = document.getElementById("apor-filter");
  if (flt) {
    flt.value = nombre || "";
    _aplicarFiltroAportaciones();
  }
}

// ── Explorar activos: cartera + catálogo de mercado + búsqueda global Yahoo ──
let explorarTipoActivo = 'cartera';
let _yahooTimer = null;
let _yahooCtrl = null;

function explorarSetTipo(btn, tipo) {
  explorarTipoActivo = tipo;
  const search = document.getElementById('explorar-search');
  if (search) search.value = '';
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
  const q = (document.getElementById('explorar-search')?.value || '').toLowerCase().trim();
  let visible = 0;
  // Tarjetas de la cartera: visibles en su pestaña, o en cualquier pestaña si hay búsqueda
  document.querySelectorAll('.asset-card').forEach(card => {
    const show = q
      ? (card.dataset.search || '').includes(q)
      : explorarTipoActivo === 'cartera';
    card.style.display = show ? '' : 'none';
    if (show) visible++;
  });
  // Tarjetas del catálogo de mercado (display flex, no block)
  document.querySelectorAll('.mercado-card').forEach(card => {
    const show = q
      ? (card.dataset.search || '').includes(q)
      : card.dataset.tipo === explorarTipoActivo;
    card.style.display = show ? 'flex' : 'none';
    if (show) visible++;
  });
  // Búsqueda en vivo en Yahoo Finance (debounce 450 ms)
  const yWrap = document.getElementById('yahoo-results');
  if (_yahooTimer) clearTimeout(_yahooTimer);
  if (q.length >= 2) {
    _yahooTimer = setTimeout(() => _yahooBuscar(q), 450);
  } else if (yWrap) {
    yWrap.style.display = 'none';
    const yg = document.getElementById('yahoo-grid');
    if (yg) yg.innerHTML = '';
  }
  const empty = document.getElementById('explorar-empty');
  if (empty) empty.style.display = visible === 0 ? '' : 'none';
}

const _YAHOO_SUFIJO_TV = {
  MC: 'BME', AS: 'EURONEXT', PA: 'EURONEXT', BR: 'EURONEXT', LS: 'EURONEXT',
  L: 'LSE', DE: 'XETR', F: 'XETR', MI: 'MIL', SW: 'SIX',
  CO: 'OMXCOP', ST: 'OMXSTO', HE: 'OMXHEX', TO: 'TSX', HK: 'HKEX', T: 'TSE',
};
const _YAHOO_INDICE_TV = {
  '^GSPC': 'SP:SPX', '^NDX': 'NASDAQ:NDX', '^IXIC': 'NASDAQ:IXIC', '^DJI': 'DJ:DJI',
  '^RUT': 'TVC:RUT', '^VIX': 'TVC:VIX', '^IBEX': 'TVC:IBEX35', '^STOXX50E': 'TVC:SX5E',
  '^GDAXI': 'XETR:DAX', '^FCHI': 'TVC:CAC40', '^FTSE': 'TVC:UKX', '^N225': 'TVC:NI225', '^HSI': 'TVC:HSI',
};

function _yahooATV(symbol, quoteType) {
  if (_YAHOO_INDICE_TV[symbol]) return _YAHOO_INDICE_TV[symbol];
  if (quoteType === 'CRYPTOCURRENCY') {
    const base = symbol.replace(/-USD$/, '').replace(/-EUR$/, '');
    return 'CRYPTO:' + base + 'USD';
  }
  const m = symbol.match(/^(.+)\.([A-Z]+)$/);
  if (m && _YAHOO_SUFIJO_TV[m[2]]) return _YAHOO_SUFIJO_TV[m[2]] + ':' + m[1].replace(/-/g, '_');
  return symbol.replace(/\^/, '');
}

async function _yahooBuscar(q) {
  const wrap = document.getElementById('yahoo-results');
  const grid = document.getElementById('yahoo-grid');
  const spinner = document.getElementById('yahoo-spinner');
  if (!wrap || !grid) return;
  if (_yahooCtrl) _yahooCtrl.abort();
  _yahooCtrl = new AbortController();
  wrap.style.display = '';
  if (spinner) spinner.style.display = 'inline-block';
  try {
    const url = 'https://corsproxy.io/?url=' + encodeURIComponent(
      'https://query1.finance.yahoo.com/v1/finance/search?q=' + encodeURIComponent(q) +
      '&quotesCount=8&newsCount=0&listsCount=0'
    );
    const r = await fetch(url, { signal: _yahooCtrl.signal });
    const j = await r.json();
    const quotes = (j.quotes || []).filter(x => x.symbol && (x.shortname || x.longname));
    // Evitar duplicar lo que ya está visible del catálogo
    const enCatalogo = new Set();
    document.querySelectorAll('.mercado-card').forEach(c => {
      if (c.style.display !== 'none') {
        const sym = (c.dataset.tv || '').split(':')[1];
        if (sym) enCatalogo.add(sym.toUpperCase());
      }
    });
    const TYPE_ES = { EQUITY: 'Acción', ETF: 'ETF', INDEX: 'Índice', CRYPTOCURRENCY: 'Cripto', MUTUALFUND: 'Fondo', CURRENCY: 'Divisa', FUTURE: 'Futuro' };
    grid.innerHTML = quotes
      .filter(x => !enCatalogo.has(x.symbol.split('.')[0].toUpperCase()))
      .map(x => {
        const nombre = x.shortname || x.longname;
        const tipo = TYPE_ES[x.quoteType] || x.quoteType || '';
        const tv = _yahooATV(x.symbol, x.quoteType);
        const lbl = x.symbol.replace(/[^A-Za-z0-9]/g, '').substring(0, 4).toUpperCase() || '?';
        return `<div onclick="mercadoVerGrafica('${tv.replace(/'/g, '')}')"` +
          ` style="background:#1a1d27;border:1px solid #2a2d3a;border-radius:16px;padding:1.1rem 1.3rem;cursor:pointer;display:flex;align-items:center;gap:0.9rem;transition:border-color 0.2s;"` +
          ` onmouseover="this.style.borderColor='#3b4257'" onmouseout="this.style.borderColor='#2a2d3a'">` +
          `<div style="width:42px;height:42px;border-radius:10px;background:rgba(59,130,246,0.15);border:1px solid #3b82f640;display:flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:800;color:#3b82f6;font-family:ui-monospace,monospace;flex-shrink:0;">${lbl}</div>` +
          `<div style="min-width:0;flex-grow:1;">` +
          `<div style="color:#fff;font-weight:700;font-size:0.88rem;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${nombre.replace(/</g, '&lt;')}</div>` +
          `<div style="color:#6b7280;font-size:0.72rem;margin-top:0.15rem;">${(x.exchDisp || '').replace(/</g, '&lt;')} · <span style="font-family:ui-monospace,monospace;">${x.symbol}</span></div>` +
          `</div>` +
          `<span style="font-size:0.68rem;font-weight:700;color:#3b82f6;background:rgba(59,130,246,0.15);padding:0.2rem 0.55rem;border-radius:20px;white-space:nowrap;flex-shrink:0;border:1px solid #3b82f635;">${tipo}</span>` +
          `</div>`;
      }).join('');
    if (!grid.innerHTML) wrap.style.display = 'none';
  } catch (e) {
    if (e.name !== 'AbortError') wrap.style.display = 'none';
  } finally {
    if (spinner) spinner.style.display = 'none';
  }
}

function mercadoVerGrafica(tvSymbol) {
  if (!tvSymbol) return;
  const tvBtn = document.querySelector('.chart-engine-btn[data-engine="tv"]');
  if (tvBtn && !tvBtn.classList.contains('active')) setChartEngine(tvBtn, 'tv');
  const input = document.getElementById('cot-ticker');
  if (input) input.value = tvSymbol;
  cotizacionesBuscar();
  const box = document.getElementById('cot-chart-box');
  if (box) setTimeout(() => box.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
}

// ── Gráfica de activos: alternar entre motor Solvento (propio) y TradingView ──
function setChartEngine(btn, engine) {
  document.querySelectorAll('.chart-engine-btn').forEach(b => {
    const active = b === btn;
    b.classList.toggle('active', active);
    b.style.background = active ? '#2a2d3a' : 'none';
    b.style.color = active ? '#fff' : '#6b7280';
    b.style.fontWeight = active ? '700' : '500';
  });
  const solvento = document.getElementById('engine-solvento');
  const tv = document.getElementById('engine-tv');
  const moneda = document.getElementById('portfolio-moneda');
  if (solvento) solvento.style.display = engine === 'solvento' ? '' : 'none';
  if (tv) tv.style.display = engine === 'tv' ? '' : 'none';
  if (moneda) moneda.style.display = engine === 'solvento' ? '' : 'none';
  if (engine === 'tv') _syncTvToSelectedAsset();
}

function _syncTvToSelectedAsset() {
  const sel = document.getElementById('portfolio-select');
  const nombre = sel ? sel.value : '';
  const tvSymbol = (typeof portfolioTvMap !== 'undefined') ? portfolioTvMap[nombre] : undefined;
  const input = document.getElementById('cot-ticker');
  if (tvSymbol) {
    if (input) input.value = tvSymbol;
    cotizacionesBuscar();
  } else {
    if (input) input.value = '';
    const container = document.getElementById('cot-tv-container');
    if (container) { container.style.display = 'none'; container.innerHTML = ''; }
    const placeholder = document.getElementById('cot-placeholder');
    if (placeholder) {
      placeholder.style.display = '';
      placeholder.innerHTML =
        '<div style="font-size:3rem;margin-bottom:1rem;opacity:0.5;">📉</div>' +
        '<div style="font-size:0.95rem;color:#6b7280;margin-bottom:0.35rem;">Sin cotización pública en TradingView</div>' +
        '<div style="font-size:0.8rem;color:#374151;">Este fondo no cotiza en bolsa (usa el valor liquidativo del banco)</div>';
    }
  }
}

(function () {
  const sel = document.getElementById('portfolio-select');
  if (!sel) return;
  sel.addEventListener('change', () => {
    const tvBtn = document.querySelector('.chart-engine-btn[data-engine="tv"]');
    if (tvBtn && tvBtn.classList.contains('active')) _syncTvToSelectedAsset();
  });
})();

// Estado inicial: pestaña "Mi cartera"
explorarFiltrar();


let _cotRangoActivo = '1M';

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

// ── Mapa de la Cartera (treemap): ajusta texto al tamaño REAL en píxeles de
// cada recuadro, ya que el mismo % de área puede repartirse en una franja
// fina y larga o en un recuadro compacto — un umbral en % no basta. ──
function layoutTreemaps() {
  document.querySelectorAll(".tm-tile").forEach(tile => {
    const w = tile.offsetWidth, h = tile.offsetHeight;
    const label = tile.querySelector(".tm-label");
    const nameEl = tile.querySelector(".tm-name");
    const rentEl = tile.querySelector(".tm-rent");
    if (!label || !nameEl || !rentEl) return;
    if (w < 44 || h < 28) {
      label.style.display = "none";
      return;
    }
    label.style.display = "flex";
    const fs = Math.max(0.62, Math.min(1.0, Math.min(w, h) / 85));
    nameEl.style.fontSize = fs.toFixed(2) + "rem";
    nameEl.style.lineHeight = "1.2";
    const multiLine = h >= 56 && w >= 90;
    if (multiLine) {
      nameEl.style.whiteSpace = "normal";
      nameEl.style.display = "-webkit-box";
      nameEl.style.webkitLineClamp = "2";
      nameEl.style.webkitBoxOrient = "vertical";
      nameEl.style.overflow = "hidden";
    } else {
      nameEl.style.whiteSpace = "nowrap";
      nameEl.style.display = "block";
      nameEl.style.overflow = "hidden";
      nameEl.style.textOverflow = "ellipsis";
    }
    nameEl.textContent = tile.dataset.name;
    const showRent = h >= 46;
    rentEl.style.display = showRent ? "block" : "none";
    if (showRent) {
      rentEl.style.fontSize = (fs * 0.82).toFixed(2) + "rem";
      rentEl.textContent = tile.dataset.rent;
    }
  });
}
document.querySelectorAll(".tm-container").forEach(c => {
  new ResizeObserver(layoutTreemaps).observe(c);
});
layoutTreemaps();

// Hover: intensifica el color (verde/rojo fuerte) y muestra un tooltip con
// nombre, peso y rentabilidad, posicionado sobre el recuadro (o debajo si no
// cabe arriba) y sin salirse de los límites del mapa.
function bindTreemapHover() {
  document.querySelectorAll(".tm-container").forEach(container => {
    const tip = container.querySelector(".tm-tooltip");
    if (!tip) return;
    container.querySelectorAll(".tm-tile").forEach(tile => {
      tile.addEventListener("mouseenter", () => {
        tile.style.background = tile.dataset.hoverBg;
        tip.textContent = `${tile.dataset.name} · ${tile.dataset.weight} · ${tile.dataset.rent}`;
        tip.style.display = "block";
        const cw = container.clientWidth, ch = container.clientHeight;
        const tx = tile.offsetLeft, ty = tile.offsetTop, tw = tile.offsetWidth, th = tile.offsetHeight;
        const tipW = tip.offsetWidth, tipH = tip.offsetHeight;
        let left = tx + tw / 2 - tipW / 2;
        left = Math.max(4, Math.min(left, cw - tipW - 4));
        let top = ty - tipH - 8;
        if (top < 4) top = ty + th + 8;
        top = Math.max(4, Math.min(top, ch - tipH - 4));
        tip.style.left = left + "px";
        tip.style.top = top + "px";
      });
      tile.addEventListener("mouseleave", () => {
        tile.style.background = tile.dataset.bg;
        tip.style.display = "none";
      });
    });
  });
}
bindTreemapHover();
