/*
 * Solvento v2 — Render (Fase 2): navegación por pestañas + páginas
 * (Patrimonio, Caja, Balance, Cartera, Propiedades, Pasivos) con donuts, treemap
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
  const delBtn = (onclick) => `<button class="fila-acc" onclick="event.stopPropagation();${onclick}" title="Borrar" style="background:none;border:none;color:#6b7280;cursor:pointer;font-size:0.9rem;padding:0.2rem 0.4rem;">✕</button>`;
  const editBtn = (onclick) => `<button class="fila-acc" onclick="event.stopPropagation();${onclick}" title="Editar" style="background:none;border:none;color:#6b7280;cursor:pointer;font-size:0.85rem;padding:0.2rem 0.4rem;">✎</button>`;
  const rowActions = (edit, del) => `<td style="text-align:right;width:1%;white-space:nowrap;">${editBtn(edit)}${delBtn(del)}</td>`;

  function logoImg(nombre, isin, size) {
    const src = CFG.assetLogo(nombre, isin);
    const s = size || 22;
    return src
      ? `<img src="${src}" alt="" style="width:${s}px;height:${s}px;object-fit:contain;border-radius:5px;flex-shrink:0;">`
      : `<span style="display:inline-block;width:${s}px;height:${s}px;flex-shrink:0;"></span>`;
  }

  // ── Donut SVG (mismo método que la v1) ──
  function donut(items, centerValue, centerLabel, id) {
    const total = items.reduce((s, x) => s + (x.value > 0 ? x.value : 0), 0);
    let acum = 0;
    // Sin <title>: las cifras salen en el globo, no en el tooltip del navegador
    const sectors = items.map((it, i) => {
      const pct = total > 0 ? it.value / total * 100 : 0;
      const rot = acum * 3.6;
      acum += pct;
      return `<circle class="sector rep-seg" data-label="${esc(it.label)}" data-pct="${fmtPct(pct)}" data-eur="${fmtEur(it.value)}"
        onmouseenter="v2Reparto('${id}',${i})" onmouseleave="v2Reparto('${id}',null)"
        cx="21" cy="21" r="${R_DONUT}" fill="transparent" stroke="${it.accent}" stroke-width="3"
        stroke-dasharray="${pct.toFixed(4)} ${(100 - pct).toFixed(4)}" stroke-dashoffset="25"
        style="transform:rotate(${rot.toFixed(2)}deg);transform-origin:center;"></circle>`;
    }).join("");
    return `<div class="chart-wrapper rep" id="rep-${id}" data-tipo="circular" onmouseleave="v2Reparto('${id}',null)">
        <svg class="donut" viewBox="0 0 42 42">${sectors}</svg>
        <div class="donut-center">
          <span style="font-size:1rem;font-weight:700;color:#fff;">${centerValue}</span>
          <span style="font-size:0.55rem;color:#6b7280;text-transform:uppercase;margin-top:0.2rem;">${esc(centerLabel)}</span>
        </div>
        <div class="rep-tip" hidden></div>
      </div>`;
  }
  // fila = true: los ítems se ciñen a su contenido para poder ir uno al lado de
  // otro; en columna conservan el ancho fijo que alinea las cifras a la derecha.
  function legend(items, total, targets, fila, idPanel) {
    // Ni porcentaje ni importe: los pone el globo al apuntar, aquí o en la gráfica
    const estiloItem = fila
      ? "display:flex;align-items:center;gap:0.55rem;font-size:0.85rem;"
      : "display:flex;align-items:center;gap:0.55rem;font-size:0.9rem;margin:0.42rem 0;";
    return items.map((it, i) => {
      const p = total > 0 ? it.value / total * 100 : 0;
      let badge = "";
      if (targets && targets[it.label] != null) {
        const dev = p - targets[it.label];
        const dc = dev >= 0 ? GREEN : RED;
        badge = `<span style="font-size:0.68rem;color:${dc};background:${dc}22;padding:0.1rem 0.4rem;border-radius:4px;font-weight:600;margin-left:0.3rem;" title="Objetivo: ${targets[it.label].toFixed(0)}%">${dev >= 0 ? "+" : ""}${dev.toFixed(1)}pp</span>`;
      }
      const punto = `<span style="width:9px;height:9px;background:${it.accent};border-radius:50%;flex-shrink:0;"></span>`;
      const nombre = `<span style="color:#9ca3af;font-weight:500;">${esc(it.label)}</span>`;
      return `<div class="leg-it" style="${estiloItem}"
        onmouseenter="v2Reparto('${idPanel}',${i})" onmouseleave="v2Reparto('${idPanel}',null)">${punto}${nombre}${badge}</div>`;
    }).join("");
  }

  // ── Panel de distribución con vista intercambiable ───────────────────
  // Un único componente para "cómo se reparte esto", usado en Patrimonio, Caja,
  // Cartera y Propiedades. Dos vistas de los mismos datos: barra apilada con
  // etiquetas dentro, o gráfico circular. La elección se recuerda por panel.
  //
  // Los saldos NEGATIVOS (una cuenta en descubierto) no se pueden repartir en
  // una tarta: darían un porcentaje negativo y un trazo inválido en el SVG. Se
  // excluyen del reparto y se avisa aparte, en vez de dibujar algo sin sentido.
  const VISTA = {};
  const vistaDe = (id) => VISTA[id] || "barra";

  function repartoValido(items) {
    const positivos = items.filter((i) => i.value > 0);
    const negativos = items.filter((i) => i.value < 0);
    return { positivos, negativos, total: positivos.reduce((a, i) => a + i.value, 0) };
  }

  // La barra no lleva texto dentro: los nombres los pone la leyenda y las cifras
  // salen al pasar por encima, en un globo, junto con el tramo resaltado.
  function barraDistribucion(items, total, id) {
    const segs = items.map((it, i) => {
      const p = total > 0 ? it.value / total * 100 : 0;
      return `<div class="bd-seg rep-seg" data-label="${esc(it.label)}" data-pct="${fmtPct(p)}" data-eur="${fmtEur(it.value)}"
        onmouseenter="v2Reparto('${id}',${i})" onmouseleave="v2Reparto('${id}',null)"
        style="width:${p.toFixed(2)}%;background:${it.accent};"></div>`;
    }).join("");
    return `<div class="bd rep" id="rep-${id}" data-tipo="barra" onmouseleave="v2Reparto('${id}',null)">
      <div class="bd-bar">${segs}</div>
      <div class="rep-tip" hidden></div>
    </div>`;
  }

  // Iconos del selector de vista: una barra de distribución segmentada y un anillo
  // partido en dos arcos. Trazados mínimos para que se lean bien a 14 px.
  const ICONO_VISTA = {
    barra: `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
      <rect x="1" y="5" width="6.2" height="6" rx="1.4"/><rect x="8.2" y="5" width="3.9" height="6" rx="1.4"/><rect x="13.1" y="5" width="1.9" height="6" rx="0.95"/></svg>`,
    circular: `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M7.6 8.4 L13.2 8.4 A5.6 5.6 0 1 1 7.6 2.8 Z"/><path d="M8.5 7.5 L8.5 1.9 A5.6 5.6 0 0 1 14.1 7.5 Z"/></svg>`,
  };

  function selectorVista(id) {
    const v = vistaDe(id);
    const btn = (modo, txt) => `<button onclick="v2Vista('${id}','${modo}')" title="Ver en ${txt.toLowerCase()}"
      aria-label="Ver en ${txt.toLowerCase()}" aria-pressed="${v === modo}"
      style="background:${v === modo ? "#2a2d3a" : "transparent"};border:1px solid ${v === modo ? "#4b5563" : "#2a2d3a"};
      color:${v === modo ? "#fff" : "#9ca3af"};border-radius:6px;
      display:inline-flex;align-items:center;justify-content:center;line-height:0;
      padding:0.32rem 0.55rem;cursor:pointer;font-family:inherit;">${ICONO_VISTA[modo]}</button>`;
    return `<div style="display:flex;gap:0.25rem;">${btn("barra", "Barra")}${btn("circular", "Circular")}</div>`;
  }

  function cuerpoVista(id, items, centroValor, centroEtiqueta, targets, sinLeyenda) {
    const { positivos, negativos, total } = repartoValido(items);
    if (!positivos.length) {
      return `<div style="color:#6b7280;text-align:center;padding:2rem;font-size:0.85rem;">Nada que repartir todavía</div>`;
    }
    const aviso = negativos.length
      ? `<div style="font-size:0.75rem;color:#fbbf24;margin-top:0.9rem;">
           ${negativos.map((n) => esc(n.label) + " está en negativo (" + fmtEur(n.value) + ")").join(" · ")}, así que no entra en el reparto.</div>`
      : "";
    // Donde el color ya está explicado fuera (las tarjetas del patrimonio, el
    // punto de las tablas de Caja y Propiedades) la leyenda solo repetiría; los
    // nombres siguen saliendo en el globo al apuntar.
    const leyendaCol = sinLeyenda ? "" : `<div class="leg-col" id="leg-${id}">${legend(positivos, total, targets, false, id)}</div>`;
    const leyendaFila = sinLeyenda ? "" : `<div class="leg-fila" id="leg-${id}">${legend(positivos, total, targets, true, id)}</div>`;
    const cuerpo = vistaDe(id) === "circular"
      ? `<div style="display:flex;align-items:center;justify-content:center;gap:2.5rem;flex-wrap:wrap;">
           ${donut(positivos, centroValor, centroEtiqueta, id)}${leyendaCol}
         </div>`
      : `${barraDistribucion(positivos, total, id)}${leyendaFila}`;
    return cuerpo + aviso;
  }

  // opts: { sinLeyenda, desnudo }. "desnudo" saca la gráfica de la tarjeta gris y
  // se lleva por delante el título: quedan la gráfica y el selector, suelto arriba
  // a la derecha. Solo tiene sentido donde el título no dice nada que no diga ya
  // la página, como la distribución dentro de la propia página de Patrimonio.
  function vistaPanel(id, titulo, items, centroValor, centroEtiqueta, targets, opts) {
    opts = opts || {};
    const cuerpo = `<div id="vista-${id}">${cuerpoVista(id, items, centroValor, centroEtiqueta, targets, opts.sinLeyenda)}</div>`;
    if (opts.desnudo) {
      return `<div class="v2-wrap" style="margin-top:2rem;">
        <div style="display:flex;justify-content:flex-end;margin-bottom:0.85rem;">${selectorVista(id)}</div>
        ${cuerpo}
      </div>`;
    }
    return `<div class="v2-wrap"><div class="dashboard-panel">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:0.75rem;flex-wrap:wrap;margin-bottom:1.1rem;">
        <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">${esc(titulo)}</div>
        ${selectorVista(id)}
      </div>
      ${cuerpo}
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
      <div class="tm-container" style="position:relative;width:100%;height:clamp(200px,42vw,320px);border-radius:10px;overflow:hidden;">${tiles}
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
  // Tarjeta del panel de Patrimonio. Si se le pasa `pagina`, es clicable y
  // navega a esa sección (con realce al pasar el cursor y una flecha de pista).
  function hubCard(titulo, valor, pct, color, sub, subColor, pagina, reparto) {
    // Al señalar la tarjeta se resalta su tramo en la gráfica de reparto, que es
    // lo que ata los colores de una con los de la otra. Sin globo: la tarjeta ya
    // enseña el importe y el porcentaje.
    const enlace = reparto
      ? ` onmouseenter="v2Reparto('${reparto}','${String(titulo).replace(/'/g, "\\'")}',true)" onmouseleave="v2Reparto('${reparto}',null)"`
      : "";
    const clicable = pagina
      ? ` role="link" tabindex="0" onclick="v2Tab('${pagina}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();v2Tab('${pagina}');}"`
        + ` onmouseover="this.style.background='#1e2130'" onmouseout="this.style.background=''"`
        + ` title="Ir a ${esc(titulo)}"`
      : "";
    const flecha = pagina
      ? `<span style="color:${color};font-weight:700;margin-left:0.35rem;">&nbsp;→</span>`
      : "";
    return `<div class="dashboard-panel" style="border-left:3px solid ${color};${pagina ? "cursor:pointer;transition:background 0.2s;" : ""}"${clicable}${enlace}>
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
  const MOV = { q: "", tipo: "", cuenta: "", cat: "", desde: "", hasta: "", pend: false, sinCentro: false, limite: PAGINA };
  const OPS = { q: "", tipo: "", desde: "", hasta: "", limite: 40 };
  let OPS_BANCO = "";

  // Un <select> se estira hasta la más larga de sus opciones, y la lista de
  // categorías tiene rutas de tres niveles: en el móvil ese desplegable medía
  // 361 px en una pantalla de 375 y se salía por la derecha. Con el máximo al
  // ancho disponible se encoge y recorta el texto, que se lee entero al abrirlo.
  const estiloFiltro = "background:#12141d;border:1px solid #2a2d3a;border-radius:8px;color:#e5e7eb;font-size:0.82rem;padding:0.4rem 0.6rem;outline:none;font-family:inherit;max-width:100%;min-width:0;";
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
      if (MOV.pend && !window.SolventoModel.esPendiente(r)) return false;
      // «Sin centro» solo tiene sentido donde el centro tiene sentido: un
      // traspaso no es de nadie y saldría siempre en la lista, escondiendo lo
      // que de verdad falta por imputar.
      if (MOV.sinCentro && !((r.tipo === "Gasto" || r.tipo === "Ingreso") && !String(r.centro || "").trim())) return false;
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
    const rows = visibles.map((r) => {
      const signo = r.tipo === "Ingreso" ? "+" : (r.tipo === "Gasto" ? "−" : "");
      const color = r.tipo === "Ingreso" ? GREEN : (r.tipo === "Gasto" ? RED : "#9ca3af");
      const det = esc(r.detalle || r.tipo_gasto || r.tipo_ingreso || "—");
      const cta = esc([r.cuenta_origen, r.cuenta_destino].filter(Boolean).join(" → "));
      // La palabra «Gasto» o «Ingreso» delante del concepto repetía lo que ya
      // dice el color del importe. Se queda como title de la fila, para quien
      // navegue con lector de pantalla o pase el ratón por encima.
      return `<tr class="table-row" title="${esc(r.tipo)}">
        <td style="text-align:left;color:#9ca3af;font-size:0.82rem;white-space:nowrap;">${esc(r.fecha)}</td>
        <td style="text-align:left;"><span style="color:#e5e7eb;">${det}</span>
          ${cta ? `<div style="color:#4b5563;font-size:0.72rem;">${cta}</div>` : ""}</td>
        <td style="text-align:right;color:${color};font-weight:600;white-space:nowrap;">${signo}${fmtEur(Number(r.importe))}</td>
        ${rowActions(`v2EditMov('${r.id}')`, `v2DelMov('${r.id}')`)}</tr>`;
    }).join("");
    const quedan = todos.length - visibles.length;
    // Imputar en bloque solo se ofrece cuando hay un filtro puesto: sobre la
    // lista entera sería una forma cómoda de estropearlo todo de una vez.
    const hayFiltro = MOV.q || MOV.tipo || MOV.cuenta || MOV.cat || MOV.desde || MOV.hasta || MOV.pend || MOV.sinCentro;
    return `<div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;flex-wrap:wrap;margin:0.35rem 0 0.5rem;">
        <div style="font-size:0.78rem;color:#6b7280;">
          ${todos.length}${todos.length !== total ? " de " + total : ""} ${todos.length === 1 ? "movimiento" : "movimientos"}</div>
        ${hayFiltro && todos.length ? `<button onclick="v2MovImputar()"
          style="background:none;border:1px solid #2a2d3a;border-radius:8px;color:#9ca3af;font-size:0.76rem;
          font-family:inherit;padding:0.25rem 0.6rem;cursor:pointer;white-space:nowrap;">
          Imputar centro a estos ${todos.length}</button>` : ""}
      </div>
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
        ${(function () {
          const p = window.SolventoModel.pendientes((CURRENT_DOC || {}).movimientos);
          if (!p.n && !MOV.pend) return "";
          return `<button onclick="v2MovPendientes()" title="Movimientos sin categoría o marcados como pendientes"
            style="background:${MOV.pend ? "#f59e0b" : "none"};border:1px solid #f59e0b;border-radius:8px;
            color:${MOV.pend ? "#12141d" : "#f59e0b"};font-size:0.8rem;font-weight:600;padding:0.4rem 0.75rem;
            cursor:pointer;font-family:inherit;white-space:nowrap;">⚠ ${p.n} sin identificar</button>`;
        })()}
        ${(function () {
          const mov = (CURRENT_DOC || {}).movimientos || [];
          const n = mov.filter((m) => (m.tipo === "Gasto" || m.tipo === "Ingreso") && !String(m.centro || "").trim()).length;
          if (!n && !MOV.sinCentro) return "";
          return `<button onclick="v2MovSinCentro()" title="Gastos e ingresos sin centro de coste"
            style="background:${MOV.sinCentro ? "#3b82f6" : "none"};border:1px solid #3b82f6;border-radius:8px;
            color:${MOV.sinCentro ? "#fff" : "#3b82f6"};font-size:0.8rem;font-weight:600;padding:0.4rem 0.75rem;
            cursor:pointer;font-family:inherit;white-space:nowrap;">⊘ ${n} sin centro</button>`;
        })()}
        ${addBtn("Limpiar", "v2MovLimpiar()")}
      </div>
      <div id="v2-mov-lista">${movimientosTabla()}</div>
    </div></div>`;
  }

  function filaOperacion(r) {
    const MC = { Compra: GREEN, Venta: RED, Traspaso: "#3b82f6" };
    const mov = r.tipo_movimiento || "Compra";
    const c = MC[mov] || "#6b7280";
    const coste = Number(r.coste);
    return `<tr class="table-row">
      <td style="text-align:left;color:#9ca3af;font-size:0.82rem;white-space:nowrap;">${esc(r.fecha)}</td>
      <td style="text-align:left;"><div style="display:flex;align-items:center;gap:0.5rem;">${logoImg(r.nombre, r.isin, 18)}<span style="color:#fff;font-weight:600;font-size:0.85rem;">${esc(r.nombre)}</span><span style="color:${c};font-size:0.7rem;font-weight:700;background:${c}22;padding:0.1rem 0.4rem;border-radius:4px;">${esc(mov)}</span></div></td>
      <td style="text-align:right;color:${coste < 0 ? RED : "#e5e7eb"};font-weight:600;white-space:nowrap;">${fmtEur(coste)}</td>
      <td style="text-align:right;color:#9ca3af;font-size:0.82rem;white-space:nowrap;">${r.unidades !== "" && r.unidades != null ? Number(r.unidades).toLocaleString("es-ES", { maximumFractionDigits: 6 }) : "—"}</td>
      ${rowActions(`v2EditInv('${r.id}')`, `v2DelInv('${r.id}')`)}</tr>`;
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
    const rows = visibles.map((r) => filaOperacion(r)).join("");
    const quedan = todas.length - visibles.length;
    const invertido = todas.reduce((s, r) => s + (Number(r.coste) || 0), 0);
    return `<div style="font-size:0.78rem;color:#6b7280;margin:0.35rem 0 0.5rem;">
        ${todas.length} ${todas.length === 1 ? "operación" : "operaciones"} · neto invertido <b style="color:#e5e7eb;">${fmtEur(invertido)}</b></div>
      <table class="minimal-table"><tbody>${rows || '<tr><td style="color:#6b7280;padding:1rem;">Ninguna operación coincide con el filtro</td></tr>'}</tbody></table>
      ${quedan > 0 ? `<div style="text-align:center;margin-top:0.75rem;">${addBtn("Ver 40 más (quedan " + quedan + ")", "v2OpsMas()")}</div>` : ""}`;
  }

  // `completa` distingue el listado embebido en Cartera (solo lo reciente, con
  // un enlace a la página entera) de la página dedicada, con todos los filtros.
  function operacionesList(banco, completa) {
    OPS_BANCO = banco || "";
    if (!completa) {
      const todas = operacionesFiltradas(banco);
      const recientes = todas.slice(0, 8);
      const filas = recientes.map((r) => filaOperacion(r)).join("");
      return `<div class="v2-wrap" style="padding-bottom:2rem;"><div class="table-container">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;flex-wrap:wrap;gap:0.5rem;">
          <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Últimas operaciones</div>
          <div style="display:flex;gap:0.5rem;">${addBtn("＋ NAV", "v2AddNav()")}${addBtn("＋ Operación", "v2AddInv()")}</div>
        </div>
        <table class="minimal-table"><tbody>${filas || '<tr><td style="color:#6b7280;padding:1rem;">Sin operaciones</td></tr>'}</tbody></table>
        <div style="margin-top:1rem;">${addBtn("Ver todas las operaciones (" + todas.length + ") →", "v2Tab('operaciones')")}</div>
      </div></div>`;
    }
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
    // El reparto va pegado a la cifra total, justo antes de las cuatro tarjetas:
    // se lee como el desglose de ese número, y las tarjetas son la leyenda.
    return header("Patrimonio", fmtEur(m.patrimonioNeto)) +
      vistaPanel("patrimonio", "Distribución del patrimonio",
        [{ label: "Caja", value: m.patrimonioLiquido, accent: "#3b82f6" },
         { label: "Cartera", value: m.carteraTotal, accent: "#10b981" },
         { label: "Propiedades", value: m.inm.total, accent: "#a16207" }],
        fmtEur(m.patrimonioNeto), "Neto", null, { sinLeyenda: true, desnudo: true }) +
      `<div class="v2-hub-grid" style="margin-top:1.5rem;">
        ${hubCard("Caja", fmtEur(m.patrimonioLiquido), m.pctLiquidez, "#3b82f6", m.saldosCaja.length + " cuentas", null, "caja", "patrimonio")}
        ${hubCard("Cartera", fmtEur(m.carteraTotal), m.ratioInv, "#10b981", m.inv.hayRentabilidad ? fmtPct(m.inv.rentPct) : "—", rc(m.inv.rentPct), "cartera", "patrimonio")}
        ${hubCard("Propiedades", fmtEur(m.inm.total), m.ratioInm, "#a16207", m.inm.n + (m.inm.n === 1 ? " propiedad" : " propiedades"), null, "propiedades", "patrimonio")}
        ${hubCard("Pasivos", fmtEur(m.pas.total), m.ratioPas, "#6b7280",
                  m.pas.n ? m.pas.n + (m.pas.n === 1 ? " deuda" : " deudas") : "Sin deudas registradas", null, "pasivos", "patrimonio")}
      </div>` +
      chartPanel("Evolución del patrimonio neto", "v2-chart-patrimonio");
  }

  // Una posición está cerrada cuando ya no queda nada de ella (vendida o
  // traspasada por completo). Su "invertido" sale negativo, que despista: no es
  // un error, es lo que recuperaste de más — la ganancia realizada.
  const esCerrada = (a) => isFinite(a.importe) && a.importe < 1 && a.coste <= 0;

  function tablaCartera(inv) {
    // Las cerradas van al final: ya no forman parte de lo que tienes
    const orden = inv.assets.slice().sort((a, b) => (esCerrada(a) ? 1 : 0) - (esCerrada(b) ? 1 : 0));
    const rows = orden.map((a) => {
      if (esCerrada(a)) {
        const realizado = -a.coste;   // coste neto negativo = dinero recuperado de más
        return `<tr class="table-row" style="opacity:0.55;">
          <td style="text-align:left;"><div style="display:flex;align-items:center;gap:0.6rem;">${logoImg(a.nombre, a.isin)}<div><div style="font-weight:600;color:#9ca3af;font-size:0.9rem;">${esc(a.nombre)}</div><div style="font-size:0.74rem;color:#6b7280;">${esc(a.tipo)} · <span style="color:#6b7280;font-weight:600;">Cerrada</span></div></div></div></td>
          <td style="text-align:right;color:#6b7280;white-space:nowrap;">—</td>
          <td style="text-align:right;color:#6b7280;white-space:nowrap;">—</td>
          <td style="text-align:right;white-space:nowrap;"><div style="color:${realizado >= 0 ? GREEN : RED};font-weight:600;">${realizado >= 0 ? "+" : ""}${fmtEur(realizado)}</div><div style="color:#6b7280;font-size:0.74rem;">realizado</div></td>
          <td style="text-align:right;color:#4b5563;">—</td></tr>`;
      }
      const rentCell = (a.coste > 0 && isFinite(a.importe))
        ? `<div style="color:${rc(a.ganancia)};font-weight:600;">${a.ganancia >= 0 ? "+" : ""}${fmtEur(a.ganancia)}</div><div style="color:${rc(a.rentPct)};font-size:0.78rem;">${fmtPct(a.rentPct)}${isFinite(a.cagr) && a.coste >= 100 ? '<span class="col-secundaria"> · CAGR ' + a.cagr.toFixed(1) + "%</span>" : ""}</div>`
        : `<span style="color:#4b5563;">—</span>`;
      return `<tr class="table-row">
        <td style="text-align:left;"><div style="display:flex;align-items:center;gap:0.6rem;">${logoImg(a.nombre, a.isin)}<div><div style="font-weight:600;color:#fff;font-size:0.9rem;">${esc(a.nombre)}</div><div style="font-size:0.74rem;color:#6b7280;">${esc(a.tipo)}${a.isin && a.isin !== "-" ? ' · <span style="font-family:ui-monospace,monospace;">' + esc(a.isin) + "</span>" : ""}</div></div></div></td>
        <td style="text-align:right;color:#fff;font-weight:600;white-space:nowrap;">${fmtEur(a.importe)}</td>
        <td style="text-align:right;color:#9ca3af;white-space:nowrap;">${a.coste ? fmtEur(a.coste) : "—"}</td>
        <td style="text-align:right;white-space:nowrap;">${rentCell}</td>
        <td class="col-secundaria" style="text-align:right;color:#3b82f6;font-weight:600;">${a.pct.toFixed(2)}%</td></tr>`;
    }).join("");
    return `<div class="v2-wrap" style="padding-bottom:2rem;"><div class="table-container">
      <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Cartera</div>
      <table class="minimal-table"><thead><tr><th style="text-align:left;">Activo</th><th style="text-align:right;">Valor actual</th><th style="text-align:right;">Invertido</th><th style="text-align:right;">Rentabilidad</th><th class="col-secundaria" style="text-align:right;">Peso</th></tr></thead><tbody>${rows}</tbody></table>
      <div style="margin-top:1rem;">${addBtn("Ver reporte mensual de activos →", "v2Tab('reporte')")}</div>
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

  // Dos preguntas distintas, dos series. Por defecto se muestra la que de verdad
  // compara: el comportamiento del precio con todas las líneas partiendo de 0 %.
  let COMP_MODO = "comportamiento";
  let COMP_VENTANA = null;   // zoom del eje de meses, para no perderlo al repintar
  // Iconos del selector: varias líneas (el mercado, comparado) frente a una
  // silueta (lo tuyo). La frase de debajo sigue explicando en palabras qué
  // se está viendo, que es lo que de verdad desambigua los dos modos.
  const ICONO_COMP = {
    comportamiento: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      <path d="M2 8.6 L6 4.6 L9.5 6.6 L14 2.2"/><path d="M2 14 L6 12 L9.5 13.6 L14 10"/></svg>`,
    mia: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      <circle cx="8" cy="5.3" r="2.7"/><path d="M2.9 13.9 a5.1 5.1 0 0 1 10.2 0"/></svg>`,
  };
  function comparativaPanel() {
    const btn = (modo, txt, ayuda) => `<button onclick="v2CompModo('${modo}')" title="${esc(txt)}: ${esc(ayuda)}"
      aria-label="${esc(txt)}" aria-pressed="${COMP_MODO === modo}"
      style="background:${COMP_MODO === modo ? "#2a2d3a" : "transparent"};border:1px solid ${COMP_MODO === modo ? "#4b5563" : "#2a2d3a"};
      color:${COMP_MODO === modo ? "#fff" : "#9ca3af"};border-radius:6px;
      display:inline-flex;align-items:center;justify-content:center;line-height:0;
      padding:0.32rem 0.55rem;cursor:pointer;font-family:inherit;">${ICONO_COMP[modo]}</button>`;
    const explicacion = COMP_MODO === "comportamiento"
      ? "Cuánto se ha movido el precio de cada activo desde que lo tienes. Todas parten de 0 %, así que se pueden comparar entre sí."
      : "Cuánto has ganado sobre lo que pagaste por cada uno. Es tu resultado real, pero no compara: un activo comprado hace años parte de un acumulado que otro reciente no puede tener.";
    return `<div class="v2-wrap" id="v2-comparativa"><div class="dashboard-panel">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.35rem;">
        <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Comparativa de rentabilidad</div>
        <div style="display:flex;gap:0.25rem;">
          ${btn("comportamiento", "Comportamiento", "Compara cómo se ha movido cada activo")}
          ${btn("mia", "Mi rentabilidad", "Lo que has ganado sobre lo que pagaste")}
        </div>
      </div>
      <div style="font-size:0.75rem;color:#4b5563;margin-bottom:1rem;">${esc(explicacion)}</div>
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
    return { valor: s ? s.saldo : 0, etiqueta: cfg.etiquetaEfectivo || "Sin invertir · cuenta en Caja" };
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
    return items.length ? vistaPanel("activos", "Distribución por activos", items, fmtEur(total), "Activos") : "";
  }

  // Contenido de la pestaña activa (se re-renderiza al cambiar de bróker)
  function carteraInner(m, prices) {
    const inv = m.inv;
    const aviso = prices ? "" : `<div class="v2-wrap"><div style="padding:0.6rem 1rem;background:#3f2d0a;border:1px solid #a16207;border-radius:10px;font-size:0.82rem;color:#fbbf24;">⏳ Cargando precios de mercado…</div></div>`;

    if (CARTERA_TAB === "agregado") {
      const tarjetas = `<div class="v2-wrap"><div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;margin-bottom:0.3rem;">Efectivo disponible para invertir</div>
        <div style="font-size:0.75rem;color:#4b5563;margin-bottom:1rem;">Dinero que tienes en cada bróker sin invertir. Cuenta como Caja, no como Cartera: puedes sacarlo cuando quieras.</div>
        <div class="v2-hub-grid">${CFG.brokers().map((b) => tarjetaEfectivo(m, b.cuenta)).join("")}</div></div>`;
      return aviso + heroCartera(m.carteraTotal, inv, "Valor invertido") + tarjetas +
        chartPanel("Evolución de la cartera", "v2-chart-cartera") +
        asignacionPanel(inv) +
        donutTipos(inv.assets, inv.total) +
        treemapPanel(inv.assets) +
        tablaCartera(inv) +
        comparativaPanel() +
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
    return aviso + heroCartera(posiciones, invBanco, "Invertido en " + banco) +
      `<div class="v2-wrap"><div class="v2-hub-grid">${tarjetaEfectivo(m, banco)}</div></div>` +
      sinDatos + donutTipos(assets, posiciones) + treemapPanel(assets) +
      tablaCartera(invBanco) + operacionesList(banco);
  }

  function pageCartera(m, prices) {
    CARTERA_CTX = { m, prices };
    return header("Cartera", fmtEur(m.carteraTotal)) + subNavCartera() +
      `<div id="v2-cartera-inner">${carteraInner(m, prices)}</div>`;
  }

  // ── Flujo de caja mensual ────────────────────────────────────────────────
  // La gráfica de arriba enseña el saldo; esto enseña el movimiento. Son la
  // misma historia contada de dos maneras, y por eso la suma de los netos da
  // exactamente el saldo de hoy: si no lo diera, una de las dos mentiría.
  function panelFlujo(m) {
    const f = window.SolventoModel.flujoMensual(CURRENT_DOC || {});
    if (!f.meses.length) return "";
    const varios = new Set(f.meses.map((x) => x.ym.slice(0, 4))).size > 1;
    const tope = Math.max(...f.meses.map((x) => Math.max(x.entradas, x.salidas))) || 1;
    const cols = f.meses.map((x) => {
      const he = (x.entradas / tope * 100).toFixed(1), hs = (x.salidas / tope * 100).toFixed(1);
      const enero = x.ym.slice(5) === "01";
      return `<div title="${esc(x.label)} · entra ${fmtEur(x.entradas)} · sale ${fmtEur(x.salidas)} · neto ${x.neto >= 0 ? "+" : "−"}${fmtEur(Math.abs(x.neto))}"
        style="flex:1 0 auto;min-width:34px;display:flex;flex-direction:column;align-items:center;gap:0.35rem;
        ${enero && varios ? "border-left:1px solid #2a2d3a;" : ""}">
        <div style="display:flex;align-items:flex-end;gap:2px;height:96px;width:100%;justify-content:center;">
          <div style="width:42%;max-width:15px;height:${he}%;background:${GREEN};border-radius:2px 2px 0 0;opacity:0.75;"></div>
          <div style="width:42%;max-width:15px;height:${hs}%;background:${RED};border-radius:2px 2px 0 0;opacity:0.75;"></div>
        </div>
        <div style="font-size:0.6rem;color:${x.neto >= 0 ? GREEN : RED};font-weight:600;white-space:nowrap;">
          ${x.neto >= 0 ? "+" : "−"}${Math.abs(Math.round(x.neto))}</div>
        <div style="font-size:0.62rem;color:#4b5563;white-space:nowrap;">${esc(x.label.split(" ")[0])}${varios ? `<span style="display:block;font-size:0.56rem;color:#374151;">${x.ym.slice(2, 4)}</span>` : ""}</div>
      </div>`;
    }).join("");
    const med = f.media;
    return `<div class="v2-wrap"><div class="dashboard-panel">
      <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:0.75rem;margin-bottom:1rem;">
        <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Entra y sale por mes</div>
        <div style="font-size:0.78rem;color:#9ca3af;">
          Media de ${med.n} meses · entra <b style="color:${GREEN};">${esc(fmtEur(med.entradas))}</b>
          · sale <b style="color:${RED};">${esc(fmtEur(med.salidas))}</b>
          · queda <b style="color:${rc(med.neto)};">${med.neto >= 0 ? "+" : "−"}${esc(fmtEur(Math.abs(med.neto)))}</b></div>
      </div>
      <div style="display:flex;gap:0.3rem;align-items:flex-end;overflow-x:auto;padding-bottom:0.25rem;">${cols}</div>
      <div style="font-size:0.72rem;color:#4b5563;margin-top:0.75rem;">
        Sin traspasos entre tus cuentas, que no son ni entrada ni salida. Sí cuentan las compras de inversión y los
        recibos de la tarjeta: ese dinero sale de la caja. Por eso la suma de los ${f.meses.length} netos es
        exactamente tu caja de hoy, ${esc(fmtEur(m.patrimonioLiquido))}.</div>
    </div></div>`;
  }

  function pageCaja(m) {
    const cuentas = m.saldosCaja || m.saldos;
    const items = cuentas.filter((s) => s.saldo !== 0).map((s) => ({ label: s.cuenta, value: s.saldo, accent: s.accent }));
    const rows = cuentas.map((s) => {
      const icon = s.logo ? `<img src="${s.logo}" alt="" style="width:20px;height:20px;object-fit:contain;border-radius:4px;">` : `<span style="font-size:1.1rem;">${s.emoji || ""}</span>`;
      const cuentaJs = String(s.cuenta).replace(/'/g, "\\'");
      // Las deudas vinculadas a esta cuenta cuelgan de ella: una tarjeta de
      // crédito no es una cuenta, pero se paga desde una y conviene verla ahí.
      const deudas = ((m.pas && m.pas.items) || []).filter((d) => d.cuenta === s.cuenta);
      const colgando = deudas.length
        ? `<div style="font-size:0.74rem;color:#6b7280;margin-top:0.2rem;padding-left:1.55rem;">
             pasivos → <button onclick="v2Tab('pasivos')" title="Ver en Pasivos"
               style="background:none;border:none;padding:0;color:#9ca3af;font-family:inherit;font-size:inherit;cursor:pointer;text-decoration:underline dotted;">
               ${deudas.length} ${deudas.length === 1 ? "deuda" : "deudas"}</button>
             · <span style="color:#ef4444;font-weight:600;">−${esc(fmtEur(deudas.reduce((t, d) => t + d.importe, 0)).replace("-", ""))}</span></div>`
        : "";
      return `<tr class="table-row" onmouseenter="v2Reparto('caja','${cuentaJs}',true)" onmouseleave="v2Reparto('caja',null)"><td style="text-align:left;"><div style="display:flex;align-items:center;gap:0.6rem;"><span style="width:9px;height:9px;border-radius:50%;background:${s.accent};flex-shrink:0;"></span>${icon}<button onclick="v2VerCuenta('${cuentaJs}')" title="Ver los movimientos de ${esc(s.cuenta)}" style="background:none;border:none;padding:0;color:#fff;font-weight:600;font-family:inherit;font-size:inherit;cursor:pointer;text-align:left;">${esc(s.cuenta)}</button>${colgando ? "" : ""}</div>${colgando}</td><td style="text-align:right;color:#fff;font-weight:600;white-space:nowrap;">${fmtEur(s.saldo)}</td><td class="col-secundaria" style="text-align:right;color:#9ca3af;">${s.pct.toFixed(2)}%</td><td style="text-align:right;width:1%;"><button onclick="v2Cuadrar('${cuentaJs}',${s.saldo})" title="Cuadrar con el saldo real del banco" style="background:none;border:none;color:#6b7280;cursor:pointer;font-size:0.9rem;padding:0.2rem 0.4rem;">⚖️</button></td></tr>`;
    }).join("");
    return header("Caja", fmtEur(m.patrimonioLiquido)) +
      vistaPanel("caja", "Distribución de la caja", items, fmtEur(m.patrimonioLiquido), "Total", null,
                 { sinLeyenda: true, desnudo: true }) +
      `<div class="v2-wrap"><div class="table-container"><table class="minimal-table"><thead><tr><th style="text-align:left;">Cuenta</th><th style="text-align:right;">Saldo</th><th class="col-secundaria" style="text-align:right;">Peso</th><th></th></tr></thead><tbody>${rows}</tbody></table>
        <div style="font-size:0.75rem;color:#4b5563;margin-top:0.75rem;">⚖️ Cuadra el saldo con el de tu banco: Solvento crea el movimiento de ajuste exacto.</div>
      </div></div>` +
      chartPanel("Evolución de la caja", "v2-chart-caja") +
      panelFlujo(m) +
      movimientosList();
  }

  function pagePropiedades(m) {
    const inm = m.inm;
    // Los costes reales se calculan una vez para toda la página, no por fila.
    const CENTROS_REAL = window.SolventoModel.resumenCentros((CURRENT_DOC || {}).movimientos);
    const items = {};
    inm.items.forEach((r) => { if (isFinite(r.importe)) items[r.tipo] = (items[r.tipo] || 0) + r.importe; });
    const donutItems = Object.keys(items).map((t) => ({ label: t, value: items[t], accent: CFG.TIPO_COLORES_INMUEBLE[t] || CFG.INMUEBLE_ACCENT_DEFAULT }));

    const rows = inm.items.map((r) => {
      const detalle = r.porPeso
        ? `${Number(r.peso).toLocaleString("es-ES", { maximumFractionDigits: 2 })} g de ${esc(r.metal)} · ${fmtEur(r.precioGramo)}/g`
        : esc(r.tipo);
      const alquiler = r.alquilada
        ? `<div style="font-size:0.74rem;color:${GREEN};margin-top:0.15rem;">
             Alquilada · ${fmtEur(r.renta)}/mes${r.fuenteRenta === "real" ? " de media" : ""}${isFinite(r.yieldNeto) ? " · " + (r.yieldNeto < 0 ? "−" : "") + Math.abs(r.yieldNeto).toFixed(1).replace(".", ",") + "% neto anual" : ""}
             <span style="color:#6b7280;">${r.fuenteRenta === "real" ? "· últimos 12 meses" : "· previsión escrita a mano"}</span></div>`
        : "";
      // Lo que de verdad ha costado y rentado, contado de los movimientos que
      // llevan su centro. La renta mensual de la ficha es una previsión; esto es
      // lo que pasó: comunidad, suministros, derramas y los meses que no cobró.
      const real = r.centro ? CENTROS_REAL[r.centro] : null;
      // Cobrar por un inmueble que no consta alquilado es una contradicción, y
      // callarla dejaría la renta fuera del panel de alquileres sin explicación.
      const sinMarcar = !r.alquilada && real && real.ingreso > 0
        ? `<div style="font-size:0.72rem;color:#f59e0b;margin-top:0.2rem;">
             Cobras ${esc(fmtEur(real.ingreso))} por él y no está marcado como alquilado.
             <button onclick="v2EditProp('${String(r.id).replace(/'/g, "\\'")}')" style="background:none;border:none;padding:0;color:inherit;font-family:inherit;font-size:inherit;cursor:pointer;text-decoration:underline dotted;">Marcarlo</button></div>`
        : "";
      const realLinea = real && (real.gasto || real.ingreso)
        ? `<div style="font-size:0.74rem;color:#6b7280;margin-top:0.25rem;">
             Real acumulado ${real.gasto ? `· <span style="color:${RED};">−${esc(fmtEur(real.gasto))}</span>` : ""}
             ${real.ingreso ? ` · <span style="color:${GREEN};">+${esc(fmtEur(real.ingreso))}</span>` : ""}
             ${real.ingreso && real.gasto ? ` · <b style="color:${rc(real.neto)};">${real.neto >= 0 ? "+" : "−"}${esc(fmtEur(Math.abs(real.neto)))}</b>` : ""}
             ${isFinite(r.importe) && r.importe > 0 && real.ingreso
               ? ` · ${(real.neto < 0 ? "−" : "")}${Math.abs(real.neto / r.importe * 100).toFixed(1).replace(".", ",")}% sobre su valor` : ""}
           </div>`
        : (r.centro ? "" : `<div style="font-size:0.72rem;color:#4b5563;margin-top:0.25rem;">
             Sin centro de coste: sus gastos no se le imputan.
             <button onclick="v2EditProp('${String(r.id).replace(/'/g, "\\'")}')" style="background:none;border:none;padding:0;color:#3b82f6;font-family:inherit;font-size:inherit;cursor:pointer;text-decoration:underline dotted;">Asignarlo</button></div>`);
      const revalorizacion = (r.coste > 0 && isFinite(r.ganancia))
        ? `<div style="color:${rc(r.ganancia)};font-weight:600;">${r.ganancia >= 0 ? "+" : ""}${fmtEur(r.ganancia)}</div><div style="color:${rc(r.rentPct)};font-size:0.76rem;">${fmtPct(r.rentPct)}</div>`
        : `<span style="color:#4b5563;">—</span>`;
      // El reparto es por tipo, así que la fila resalta el tramo del suyo: varias
      // propiedades del mismo tipo encienden el mismo tramo, que es lo correcto.
      const tipoJs = String(r.tipo).replace(/'/g, "\\'");
      return `<tr class="table-row" onmouseenter="v2Reparto('propiedades','${tipoJs}',true)" onmouseleave="v2Reparto('propiedades',null)">
        <td style="text-align:left;"><div style="display:flex;align-items:center;gap:0.6rem;">
          <span style="width:9px;height:9px;border-radius:50%;background:${r.accent};flex-shrink:0;"></span>
          <div><div style="color:#fff;font-weight:600;">${esc(r.nombre)}</div>
            <div style="font-size:0.74rem;color:#6b7280;">${detalle}</div>${alquiler}${realLinea}${sinMarcar}</div></div></td>
        <td style="text-align:right;color:#fff;font-weight:600;white-space:nowrap;">${fmtEur(r.importe)}</td>
        <td class="col-secundaria" style="text-align:right;color:#9ca3af;white-space:nowrap;">${r.coste > 0 ? fmtEur(r.coste) : "—"}</td>
        <td style="text-align:right;white-space:nowrap;">${revalorizacion}</td>
        ${rowActions(`v2EditProp('${r.id}')`, `v2DelProp('${r.id}')`)}</tr>`;
    }).join("");

    const rentaPanel = inm.alquiladas
      ? `<div class="v2-wrap"><div class="dashboard-panel">
          <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;margin-bottom:0.75rem;">Alquileres</div>
          <div style="display:flex;gap:2rem;flex-wrap:wrap;">
            <div><div style="font-size:0.75rem;color:#6b7280;">En alquiler</div><div style="font-size:1.3rem;font-weight:800;color:#fff;">${inm.alquiladas}</div></div>
            <div><div style="font-size:0.75rem;color:#6b7280;">Renta neta al año</div><div style="font-size:1.3rem;font-weight:800;color:${rc(inm.rentaAnualTotal)};">${fmtEur(inm.rentaAnualTotal)}</div></div>
          </div></div></div>`
      : "";

    return header("Propiedades", fmtEur(inm.total)) +
      (donutItems.length ? vistaPanel("propiedades", "Distribución por tipo", donutItems, fmtEur(inm.total), "Total", null,
                                      { sinLeyenda: true, desnudo: true }) : "") +
      rentaPanel +
      `<div class="v2-wrap" style="padding-bottom:2rem;"><div class="table-container">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;flex-wrap:wrap;gap:0.5rem;">
          <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Propiedades</div>
          ${addBtn("＋ Propiedad", "v2AddProp()")}
        </div>
        <table class="minimal-table"><thead><tr><th style="text-align:left;">Propiedad</th><th style="text-align:right;">Valor actual</th><th class="col-secundaria" style="text-align:right;">Compra</th><th style="text-align:right;">Revalorización</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td style="color:#6b7280;padding:1rem;">Sin propiedades</td></tr>'}</tbody></table>
      </div></div>`;
  }

  // Lo que te deben es la otra cara de lo que debes, así que vive en la misma
  // página: una deuda no cambia de naturaleza por mirarla desde el otro lado.
  function panelPrestamos() {
    const r = window.SolventoModel.resumenPrestamos((CURRENT_DOC || {}).movimientos);
    if (!r.personas.length) return "";
    const fila = (p) => {
      const jsN = String(p.nombre).replace(/'/g, "\\'");
      const abierta = PRESTAMOS[p.nombre];
      const saldoTxt = p.saldo > 0.005
        ? `<span style="color:${GREEN};font-weight:700;">${esc(fmtEur(p.saldo))}</span>`
        : (p.huerfano ? `<span style="color:#f59e0b;font-weight:600;">sin registrar</span>`
                      : `<span style="color:#6b7280;">saldado</span>`);
      const detalle = abierta ? p.movimientos.map((m) => {
        const presta = m.tipo_prestamo !== "Devolución";
        return `<tr class="table-row" style="background:#14171f;">
          <td style="text-align:left;padding-left:2.2rem;color:#9ca3af;font-size:0.82rem;">
            ${esc(m.fecha)} · ${esc(String(m.detalle || "").slice(0, 60))}</td>
          <td style="text-align:right;color:${presta ? RED : GREEN};white-space:nowrap;font-size:0.85rem;">
            ${presta ? "prestado " : "devuelto "}${esc(fmtEur(Math.abs(Number(String(m.importe).replace(",", ".")) || 0)))}</td>
          <td colspan="2"></td></tr>`;
      }).join("") : "";
      return `<tr class="table-row">
        <td style="text-align:left;">
          <button onclick="v2PrestamoToggle('${jsN}')" style="background:none;border:none;color:#e5e7eb;font-weight:600;
            font-family:inherit;font-size:0.9rem;cursor:pointer;padding:0;text-align:left;">
            <span style="color:#6b7280;font-size:0.7rem;">${abierta ? "▾" : "▸"}</span> ${esc(p.nombre)}</button>
          ${p.huerfano ? `<div style="color:#6b7280;font-size:0.72rem;padding-left:0.9rem;">
             te devolvió ${esc(fmtEur(p.devuelto))} de un adelanto que no está registrado como préstamo</div>` : ""}</td>
        <td style="text-align:right;color:#9ca3af;white-space:nowrap;">${p.prestado ? esc(fmtEur(p.prestado)) : "—"}</td>
        <td style="text-align:right;color:#9ca3af;white-space:nowrap;">${p.devuelto ? esc(fmtEur(p.devuelto)) : "—"}</td>
        <td style="text-align:right;white-space:nowrap;">${saldoTxt}</td></tr>` + detalle;
    };
    const aviso = r.huerfanos
      ? `<div style="font-size:0.75rem;color:#6b7280;margin-top:0.6rem;">
           ${r.huerfanos} persona${r.huerfanos === 1 ? "" : "s"} te ${r.huerfanos === 1 ? "ha" : "han"} devuelto dinero
           sin que conste el adelanto: se pagó con la tarjeta y quedó como un gasto normal, así que Solvento no puede
           decir cuánto queda pendiente. Para que lo sepa, el adelanto hay que registrarlo como
           <b style="color:#9ca3af;">Préstamo · Dinero prestado</b>.</div>`
      : "";
    return `<div class="v2-wrap"><div class="table-container">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.5rem;">
        <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Préstamos entre personas</div>
        <div style="font-size:0.8rem;color:#9ca3af;">Te deben <b style="color:${r.teDeben ? GREEN : "#6b7280"};">${esc(fmtEur(r.teDeben))}</b></div>
      </div>
      <table class="minimal-table">
        <thead><tr><th style="text-align:left;">Persona</th><th style="text-align:right;">Prestado</th>
          <th style="text-align:right;">Devuelto</th><th style="text-align:right;">Pendiente</th></tr></thead>
        <tbody>${r.personas.map(fila).join("")}</tbody></table>
      ${aviso}
    </div></div>`;
  }

  // Lo descartado no desaparece del todo: se dice cuántos son y se puede volver
  // a mirarlos, porque un «está bien» de hace seis meses puede haber dejado de
  // serlo y esconder cosas para siempre es como no revisar.
  const pieRevisados = (r) => (r.descartados
    ? `<div style="font-size:0.78rem;color:#4b5563;margin-top:0.75rem;display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
         ${r.descartados} ${r.descartados === 1 ? "aviso marcado como revisado" : "avisos marcados como revisados"}
         <button onclick="v2RevRestaurar()" style="background:none;border:1px solid #2a2d3a;border-radius:6px;color:#6b7280;
           font-family:inherit;font-size:0.72rem;padding:0.15rem 0.45rem;cursor:pointer;">Volver a mirarlos</button></div>`
    : "");

  // La revisión se pinta entera aunque no haya nada: cuando todo está bien, eso
  // también es información, y es la única forma de saber que se ha mirado.
  function panelRevision() {
    let r;
    try { r = window.SolventoModel.revision(CURRENT_DOC, window.__PRICES || {}); }
    catch (e) { return `<div style="color:#ef4444;font-size:0.85rem;">No se ha podido revisar: ${esc(e.message)}</div>`; }
    if (!r.total) {
      return `<div style="background:#0f2a1c;border:1px solid #10b981;border-radius:12px;padding:1rem 1.15rem;">
        <div style="color:${GREEN};font-weight:700;font-size:0.95rem;">Todo en orden</div>
        <div style="color:#6b7280;font-size:0.82rem;margin-top:0.25rem;">
          Ninguna cuenta en negativo, ningún apunte huérfano, ninguna deuda imposible y ningún duplicado a la vista.</div></div>`
        + pieRevisados(r);
    }
    const bloque = (a) => {
      const err = a.nivel === "error";
      const col = err ? RED : "#f59e0b";
      const muestra = a.items.slice(0, 8).map((x) => {
        const boton = x.clave
          ? `<button onclick="v2RevOk('${String(x.clave).replace(/'/g, "\\'")}')" title="Marcarlo como revisado: no volverá a salir"
               style="background:none;border:1px solid #2a2d3a;border-radius:6px;color:#6b7280;font-family:inherit;
               font-size:0.68rem;padding:0 0.35rem;margin-left:0.4rem;cursor:pointer;white-space:nowrap;">está bien</button>`
          : "";
        return `<li style="margin:0.15rem 0;">${esc(x.texto)}${boton}</li>`;
      }).join("");
      return `<div style="background:${err ? "#2b1414" : "#2a2109"};border:1px solid ${col};border-radius:12px;
             padding:0.85rem 1rem;margin-bottom:0.75rem;">
        <div style="display:flex;justify-content:space-between;gap:0.75rem;align-items:baseline;flex-wrap:wrap;">
          <div style="color:${col};font-weight:700;font-size:0.9rem;">${esc(a.titulo)}</div>
          <div style="color:${col};font-size:0.78rem;font-weight:600;">${a.n}</div>
        </div>
        <div style="color:#9ca3af;font-size:0.8rem;margin-top:0.2rem;">${esc(a.detalle)}</div>
        <ul style="color:#6b7280;font-size:0.78rem;margin:0.5rem 0 0;padding-left:1.1rem;">${muestra}</ul>
        ${a.items.length > 8 ? `<div style="color:#4b5563;font-size:0.75rem;margin-top:0.3rem;">…y ${a.items.length - 8} más</div>` : ""}
      </div>`;
    };
    const resumen = `<div style="font-size:0.85rem;color:#9ca3af;margin-bottom:0.75rem;">
      ${r.errores ? `<b style="color:${RED};">${r.errores} ${r.errores === 1 ? "cosa" : "cosas"} que hay que arreglar</b> · ` : ""}
      ${r.total - r.errores} ${r.total - r.errores === 1 ? "aviso" : "avisos"} para mirar cuando puedas.</div>`;
    return resumen + r.avisos.sort((a, b) => (a.nivel === "error" ? 0 : 1) - (b.nivel === "error" ? 0 : 1)).map(bloque).join("") + pieRevisados(r);
  }

  function pagePasivos(m) {
    const pas = (m && m.pas) || { items: [], n: 0, total: 0 };
    if (!pas.n) {
      return header("Pasivos", fmtEur(0)) +
        `<div class="v2-wrap"><div class="dashboard-panel" style="text-align:center;padding:3rem;">
          <div style="color:#6b7280;font-size:0.95rem;font-weight:600;margin-bottom:0.5rem;">Sin deudas registradas</div>
          <div style="color:#374151;font-size:0.85rem;max-width:420px;margin:0 auto 1.25rem;">Hipotecas, préstamos, tarjetas… Lo que registres aquí se descuenta de tu patrimonio neto.</div>
          ${addBtn("＋ Deuda", "v2AddPas()")}
        </div></div>` + panelPrestamos();
    }
    const rows = pas.items.map((d) => `<tr class="table-row">
      <td style="text-align:left;"><span style="color:#fff;font-weight:600;">${esc(d.nombre)}</span>${d.entidad ? `<div style="color:#6b7280;font-size:0.78rem;">${esc(d.entidad)}</div>` : ""}</td>
      <td style="text-align:left;color:#9ca3af;">${esc(d.tipo)}</td>
      <td style="text-align:right;color:#fff;font-weight:600;white-space:nowrap;">${fmtEur(d.importe)}</td>
      <td class="col-secundaria" style="text-align:right;color:#9ca3af;">${(pas.total ? d.importe / pas.total * 100 : 0).toFixed(2)}%</td>
      ${rowActions(`v2EditPas('${d.id}')`, `v2DelPas('${d.id}')`)}</tr>`).join("");
    return header("Pasivos", fmtEur(pas.total)) +
      `<div class="v2-wrap"><div class="table-container">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;flex-wrap:wrap;gap:0.5rem;">
          <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Deudas</div>
          ${addBtn("＋ Deuda", "v2AddPas()")}
        </div>
        <table class="minimal-table">
        <thead><tr><th style="text-align:left;">Deuda</th><th style="text-align:left;">Tipo</th><th style="text-align:right;">Importe</th><th class="col-secundaria" style="text-align:right;">Peso</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div></div>` + panelPrestamos();
  }

  // ── Página Gastos (Fase 6) ──────────────────────────────────────────
  // Responde a "¿en qué se me va el dinero?" con lo que ya registras. El mes
  // elegido se guarda fuera del render para que sobreviva a un repintado.
  let GASTO_MES = null;   // null = el último mes con actividad

  function barrasIngresoGasto(g) {
    // Todos los meses, no los últimos doce: con el histórico reconstruido hay
    // años enteros que quedaban fuera y no había forma de llegar a ellos. Si no
    // caben, la tira se desplaza en horizontal en lugar de recortar datos.
    const ult = g.meses;
    if (!ult.length) return "";
    // Con meses de varios años, "oct" a secas no distingue octubre de 2025 del
    // de 2026: se añade el año cuando el histórico cruza más de uno.
    const varios = new Set(ult.map((m) => m.ym.slice(0, 4))).size > 1;
    const tope = Math.max(...ult.map((m) => Math.max(m.ingresos, m.gastos))) || 1;
    const cols = ult.map((m) => {
      const hi = (m.ingresos / tope * 100).toFixed(1), hg = (m.gastos / tope * 100).toFixed(1);
      const activo = m.ym === mesElegido(g).ym;
      const enero = m.ym.slice(5) === "01";
      return `<button onclick="v2GastoMes('${m.ym}')" title="${esc(m.label)} · ingresos ${fmtEur(m.ingresos)} · gastos ${fmtEur(m.gastos)}"
        style="flex:1 0 auto;min-width:34px;background:none;border:none;cursor:pointer;font-family:inherit;padding:0;display:flex;flex-direction:column;align-items:center;gap:0.35rem;
        ${enero && varios ? "border-left:1px solid #2a2d3a;" : ""}">
        <div style="display:flex;align-items:flex-end;gap:2px;height:110px;width:100%;justify-content:center;">
          <div style="width:42%;max-width:16px;height:${hi}%;background:${GREEN};border-radius:2px 2px 0 0;opacity:${activo ? 1 : 0.55};"></div>
          <div style="width:42%;max-width:16px;height:${hg}%;background:${RED};border-radius:2px 2px 0 0;opacity:${activo ? 1 : 0.55};"></div>
        </div>
        <div style="font-size:0.62rem;color:${activo ? "#fff" : "#4b5563"};font-weight:${activo ? 700 : 500};white-space:nowrap;">${esc(m.label.split(" ")[0])}${varios ? `<span style="display:block;font-size:0.56rem;color:${activo ? "#9ca3af" : "#374151"};">${m.ym.slice(2, 4)}</span>` : ""}</div>
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
      <div style="display:flex;gap:0.3rem;align-items:flex-end;overflow-x:auto;padding-bottom:0.25rem;">${cols}</div>
      <div style="font-size:0.72rem;color:#4b5563;margin-top:0.75rem;">Pulsa un mes para verlo en detalle${ult.length > 14 ? " · desplaza para ver los más antiguos" : ""}. ${ult.length} meses con actividad.</div>
    </div></div>`;
  }

  const mesElegido = (g) => {
    if (!g.meses.length) return { ym: "", label: "—", ingresos: 0, gastos: 0, ahorro: 0, tasa: NaN, catGasto: {}, catIngreso: {} };
    return g.meses.find((m) => m.ym === GASTO_MES) || g.meses[g.meses.length - 1];
  };

  // ── Panel 50/30/20 ───────────────────────────────────────────────────
  const COL_REGLA = { necesario: "#3b82f6", deseo: "#a855f7", ahorro: "#10b981", sin: "#4b5563" };
  function panelRegla(mes) {
    const cls = (CURRENT_DOC && CURRENT_DOC.config && CURRENT_DOC.config.clasificacion) || {};
    const meta = (CURRENT_DOC && CURRENT_DOC.config && CURRENT_DOC.config.regla) || window.SolventoModel.REGLA_DEFECTO;
    const r = window.SolventoModel.repartoRegla(mes, cls);
    if (!(r.base > 0)) {
      return `<div class="v2-wrap"><div class="dashboard-panel" style="color:#6b7280;font-size:0.85rem;">
        Sin ingresos registrados en ${esc(mes.label)}, así que no se puede repartir el 50/30/20.</div></div>`;
    }
    const fila = (clave, etiqueta, real, objetivo, importe) => {
      const desvio = real - objetivo;
      // En gastos pasarse es malo; en ahorro, quedarse corto
      const bien = clave === "ahorro" ? desvio >= -1 : desvio <= 1;
      return `<div style="margin-bottom:1rem;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:0.5rem;margin-bottom:0.3rem;">
          <div style="font-size:0.85rem;color:#e5e7eb;font-weight:600;">${esc(etiqueta)}
            <span style="color:#6b7280;font-weight:500;">· objetivo ${objetivo}%</span></div>
          <div style="text-align:right;white-space:nowrap;">
            <b style="color:${bien ? GREEN : "#fbbf24"};font-size:0.95rem;">${isFinite(real) ? real.toFixed(0) : "—"}%</b>
            <span style="color:#6b7280;font-size:0.78rem;"> · ${fmtEur(importe)}</span></div>
        </div>
        <div style="position:relative;height:9px;background:#232733;border-radius:5px;overflow:hidden;">
          <div style="width:${Math.max(0, Math.min(100, real)).toFixed(1)}%;height:100%;background:${COL_REGLA[clave]};"></div>
          <div style="position:absolute;left:${objetivo}%;top:-3px;bottom:-3px;width:2px;background:#e5e7eb;opacity:0.7;" title="Objetivo ${objetivo}%"></div>
        </div>
        <div style="font-size:0.72rem;color:${bien ? "#6b7280" : "#fbbf24"};margin-top:0.25rem;">
          ${!isFinite(real) ? "" : bien ? "Dentro de objetivo"
            : (clave === "ahorro" ? `Te faltan ${Math.abs(desvio).toFixed(0)} puntos para llegar`
                                  : `Te pasas ${desvio.toFixed(0)} puntos del objetivo`)}</div>
      </div>`;
    };
    const aviso = r.sinClasificar > 0
      ? `<div style="font-size:0.78rem;color:#fbbf24;margin-top:0.25rem;">
           ${fmtEur(r.sinClasificar)} sin clasificar (${r.pctSinClasificar.toFixed(0)}%). Marca cada categoría como necesaria o deseo en la tabla de abajo para que el reparto cuadre.</div>`
      : "";
    return `<div class="v2-wrap"><div class="dashboard-panel">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.35rem;">
        <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Regla 50/30/20 · ${esc(mes.label)}</div>
        ${addBtn("Ajustar objetivos", "v2Regla()")}
      </div>
      <div style="font-size:0.75rem;color:#4b5563;margin-bottom:1.1rem;">Sobre tus ingresos del mes (${fmtEur(r.base)}). Lo que va a inversión cuenta como ahorro.</div>
      ${fila("necesario", "Necesario", r.pctNecesario, meta.necesario, r.necesario)}
      ${fila("deseo", "Deseos", r.pctDeseo, meta.deseo, r.deseo)}
      ${fila("ahorro", "Ahorro e inversión", r.pctAhorro, meta.ahorro, r.ahorro)}
      ${aviso}
    </div></div>`;
  }

  // Chip para clasificar una categoría con un clic
  function chipClase(cat, heredada) {
    const cls = (CURRENT_DOC && CURRENT_DOC.config && CURRENT_DOC.config.clasificacion) || {};
    const propia = cls[cat] || null;
    const efectiva = propia || heredada;
    const txt = efectiva === "necesario" ? "Necesario" : (efectiva === "deseo" ? "Deseo" : "Sin clasificar");
    const col = efectiva === "necesario" ? COL_REGLA.necesario : (efectiva === "deseo" ? COL_REGLA.deseo : COL_REGLA.sin);
    const js = String(cat).replace(/'/g, "\\'");
    return `<button onclick="v2Clase('${js}')" title="Clic para cambiar entre necesario, deseo y sin clasificar"
      style="background:${col}22;border:1px solid ${col}55;color:${col};border-radius:999px;font-size:0.66rem;font-weight:700;
      padding:0.1rem 0.45rem;cursor:pointer;font-family:inherit;white-space:nowrap;${!propia && heredada ? "opacity:0.6;" : ""}">${txt}</button>`;
  }

  // Categorías desplegadas por madre: "Educación > Formaciones" se agrupa bajo
  // "Educación", que suma sus hijas. Los presupuestos valen en los dos niveles.
  const ABIERTAS = {};
  // Los centros de coste se miran en otro plazo que los gastos: cuánto cuesta un
  // piso no se responde con un mes suelto, sino con el año. Por eso este panel
  // lleva su propio rango en vez de heredar el mes de arriba.
  const CENTROS = { rango: "12m", abiertas: {} };
  const PRESTAMOS = {};
  function tablaCategorias(g, mes, presupuesto) {
    // El árbol entero, no dos niveles: «Vivienda > Suministros > Luz» se
    // despliega hasta donde llegue. Cada nodo lleva su total (con las hijas
    // dentro) y lo suyo propio, que es lo imputado a ese nivel exacto.
    const arbol = window.SolventoModel.arbolCategorias(mes.catGasto);
    if (!arbol.length) return `<div class="v2-wrap"><div class="dashboard-panel" style="text-align:center;color:#6b7280;padding:2.5rem;">Sin gastos registrados en ${esc(mes.label)}</div></div>`;
    const cls = (CURRENT_DOC && CURRENT_DOC.config && CURRENT_DOC.config.clasificacion) || {};
    const previos = g.meses.filter((m) => m.ym < mes.ym).slice(-6);
    // La media de una rama suma todo lo que cuelga de ella, a cualquier
    // profundidad: comparar «Vivienda» contra su media sin contar los
    // suministros de dentro daría un porcentaje que no significa nada.
    const mediaDe = (clave) => {
      if (!previos.length) return NaN;
      const prefijo = clave + " > ";
      return previos.reduce((s, m) => {
        let t = 0;
        for (const c in m.catGasto) if (c === clave || c.indexOf(prefijo) === 0) t += m.catGasto[c];
        return s + t;
      }, 0) / previos.length;
    };

    const barraPresupuesto = (v, pres) => {
      if (!(isFinite(pres) && pres > 0)) return "";
      const pct = Math.min(100, v / pres * 100);
      const col = v > pres ? RED : (v > pres * 0.85 ? "#f59e0b" : GREEN);
      return `<div style="margin-top:0.35rem;height:5px;background:#232733;border-radius:3px;overflow:hidden;max-width:16rem;">
          <div style="width:${pct.toFixed(1)}%;height:100%;background:${col};"></div></div>
        <div style="font-size:0.7rem;color:${v > pres ? RED : "#6b7280"};margin-top:0.2rem;">
          ${v > pres ? `Te has pasado ${fmtEur(v - pres)} del presupuesto` : `Te quedan ${fmtEur(pres - v)} de ${fmtEur(pres)}`}</div>`;
    };
    const comparativa = (v, media) => (isFinite(media) && media > 0
      ? `<span style="color:${v > media * 1.15 ? RED : (v < media * 0.85 ? GREEN : "#6b7280")};font-size:0.72rem;">
           ${v > media ? "+" : ""}${((v / media - 1) * 100).toFixed(0)}% vs media</span>` : "");

    // Cada nivel se hunde un poco y baja de tono: la jerarquía se ve sin leer.
    const TONO = ["#e5e7eb", "#c3c8d2", "#9ca3af", "#8b93a1"];
    const FONDO = ["", "#14171f", "#12151c", "#111318"];
    const tono = (p) => TONO[Math.min(p, TONO.length - 1)];
    const fondo = (p) => FONDO[Math.min(p, FONDO.length - 1)];

    function fila(n, padre, prof) {
      const jsC = String(n.completa).replace(/'/g, "\\'");
      const hijas = n.hijas || [];
      const abierta = ABIERTAS[n.completa];
      const base = padre ? padre.total : mes.gastos;
      const pct = base ? n.total / base * 100 : 0;
      const heredada = padre ? window.SolventoModel.clasificarCategoria(padre.completa, cls) : null;
      const flecha = hijas.length
        ? `<button onclick="v2CatToggle('${jsC}')" aria-expanded="${abierta ? "true" : "false"}"
             style="background:none;border:none;color:#6b7280;cursor:pointer;font-size:0.7rem;padding:0;width:1rem;font-family:inherit;">${abierta ? "▾" : "▸"}</button>`
        : '<span style="width:1rem;display:inline-block;"></span>';
      let html = `<tr class="table-row"${fondo(prof) ? ` style="background:${fondo(prof)};"` : ""}>
        <td style="text-align:left;padding-left:${(0.75 + prof * 1.35).toFixed(2)}rem;">
          <div style="display:flex;align-items:flex-start;gap:0.5rem;">${flecha}
            <div style="flex:1;">
              <div style="color:${tono(prof)};font-weight:${prof ? 500 : 600};font-size:${prof ? "0.85rem" : "0.92rem"};display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
                ${esc(n.nombre)} ${chipClase(n.completa, heredada)}</div>
              ${barraPresupuesto(n.total, Number(presupuesto[n.completa]))}</div>
          </div></td>
        <td style="text-align:right;color:${prof ? tono(prof) : "#fff"};font-weight:600;white-space:nowrap;">${fmtEur(n.total)}
          ${prof === 0 ? `<div>${comparativa(n.total, mediaDe(n.completa))}</div>` : ""}</td>
        <td style="text-align:right;color:#6b7280;white-space:nowrap;">${pct.toFixed(1)}%</td>
        <td style="text-align:right;width:1%;"><button onclick="v2Presupuesto('${jsC}')" title="Poner presupuesto"
          style="background:none;border:none;color:#6b7280;cursor:pointer;font-size:0.85rem;padding:0.2rem 0.4rem;">🎯</button></td></tr>`;
      if (!hijas.length || !abierta) return html;
      // Lo imputado a la rama misma, sin bajar más: sin esta línea, la suma de
      // las hijas no cuadraría con el total de arriba y parecería un error.
      if (n.propio > 0.005) {
        html += `<tr class="table-row" style="background:${fondo(prof + 1)};">
          <td style="text-align:left;padding-left:${(0.75 + (prof + 1) * 1.35 + 1.5).toFixed(2)}rem;color:#6b7280;font-size:0.82rem;font-style:italic;">directamente en ${esc(n.nombre)}</td>
          <td style="text-align:right;color:${tono(prof + 1)};white-space:nowrap;">${fmtEur(n.propio)}</td>
          <td style="text-align:right;color:#6b7280;white-space:nowrap;">${(n.total ? n.propio / n.total * 100 : 0).toFixed(1)}%</td>
          <td></td></tr>`;
      }
      return html + hijas.map((h) => fila(h, n, prof + 1)).join("");
    }

    const filas = arbol.map((n) => fila(n, null, 0)).join("");
    const hondura = (function medir(ns, p) {
      return ns.reduce((mx, n) => Math.max(mx, n.hijas && n.hijas.length ? medir(n.hijas, p + 1) : p), p);
    })(arbol, 1);

    return `<div class="v2-wrap"><div class="table-container">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.35rem;">
        <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Gasto por categoría · ${esc(mes.label)}</div>
        ${hondura > 1 ? `<button onclick="v2CatTodas()" style="background:none;border:1px solid #2a2d3a;border-radius:8px;color:#9ca3af;font-size:0.75rem;font-family:inherit;padding:0.25rem 0.6rem;cursor:pointer;">Desplegar todo</button>` : ""}
      </div>
      <div style="font-size:0.75rem;color:#4b5563;margin-bottom:0.5rem;">▸ despliega los ${hondura} niveles · 🎯 pon un presupuesto y te aviso cuando te pases.</div>
      <table class="minimal-table"><tbody>${filas}</tbody></table>
    </div></div>`;
  }

  // ── Segundo eje: para qué o para quién ───────────────────────────────────
  // La categoría dice QUÉ se compró; el centro, a qué proyecto, inmueble o
  // persona se imputa. Aquí importa el neto, no solo el gasto: un piso que cuesta
  // 8.219 € y renta 11.472 € no es un gasto de 8.219 €, es una renta de 3.253 €.
  function tablaCentros(g) {
    const rangos = [["mes", "Este mes"], ["12m", "Últimos 12 meses"], ["todo", "Todo"]];
    const meses = CENTROS.rango === "mes" ? [mesElegido(g)]
                : CENTROS.rango === "12m" ? g.meses.slice(-12) : g.meses;
    const gasto = {}, ingreso = {};
    meses.forEach((m) => {
      for (const c in (m.cenGasto || {})) gasto[c] = (gasto[c] || 0) + m.cenGasto[c];
      for (const c in (m.cenIngreso || {})) ingreso[c] = (ingreso[c] || 0) + m.cenIngreso[c];
    });
    // Un centro que solo cobra —una finca alquilada sin gastos ese año— también
    // tiene que salir en la lista, así que entra con gasto cero.
    const totales = Object.assign({}, gasto);
    for (const c in ingreso) if (!(c in totales)) totales[c] = 0;
    const arbolG = window.SolventoModel.arbolCategorias(totales);
    const idxI = (function indexar(ns, mapa) {
      ns.forEach((n) => { mapa[n.completa] = n.total; indexar(n.hijas, mapa); });
      return mapa;
    })(window.SolventoModel.arbolCategorias(ingreso), {});
    if (!arbolG.length) return "";

    const totalGasto = Object.keys(gasto).reduce((t, c) => t + gasto[c], 0);
    const totalIngreso = Object.keys(ingreso).reduce((t, c) => t + ingreso[c], 0);
    const TONO = ["#e5e7eb", "#c3c8d2", "#9ca3af", "#8b93a1"];
    const FONDO = ["", "#14171f", "#12151c", "#111318"];
    const tono = (p) => TONO[Math.min(p, TONO.length - 1)];

    function fila(n, padre, prof) {
      const jsC = String(n.completa).replace(/'/g, "\\'");
      const hijas = n.hijas || [];
      const abierta = CENTROS.abiertas[n.completa];
      const ing = idxI[n.completa] || 0;
      const neto = ing - n.total;
      const base = padre ? padre.total : totalGasto;
      const flecha = hijas.length
        ? `<button onclick="v2CentroToggle('${jsC}')" aria-expanded="${abierta ? "true" : "false"}"
             style="background:none;border:none;color:#6b7280;cursor:pointer;font-size:0.7rem;padding:0;width:1rem;font-family:inherit;">${abierta ? "▾" : "▸"}</button>`
        : '<span style="width:1rem;display:inline-block;"></span>';
      let html = `<tr class="table-row"${FONDO[Math.min(prof, 3)] ? ` style="background:${FONDO[Math.min(prof, 3)]};"` : ""}>
        <td style="text-align:left;padding-left:${(0.75 + prof * 1.35).toFixed(2)}rem;">
          <div style="display:flex;align-items:center;gap:0.5rem;">${flecha}
            <span style="color:${tono(prof)};font-weight:${prof ? 500 : 600};font-size:${prof ? "0.85rem" : "0.92rem"};">${esc(n.nombre)}</span></div></td>
        <td style="text-align:right;color:${tono(prof)};white-space:nowrap;">${n.total ? fmtEur(n.total) : "—"}</td>
        <td style="text-align:right;color:${ing ? GREEN : "#4b5563"};white-space:nowrap;">${ing ? fmtEur(ing) : "—"}</td>
        <td style="text-align:right;color:${ing ? rc(neto) : tono(prof)};font-weight:600;white-space:nowrap;">${ing ? (neto >= 0 ? "+" : "−") + fmtEur(Math.abs(neto)) : "−" + fmtEur(n.total)}</td>
        <td class="col-secundaria" style="text-align:right;color:#6b7280;white-space:nowrap;">${(base ? n.total / base * 100 : 0).toFixed(1)}%</td></tr>`;
      if (!hijas.length || !abierta) return html;
      if (n.propio > 0.005) {
        html += `<tr class="table-row" style="background:${FONDO[Math.min(prof + 1, 3)]};">
          <td style="text-align:left;padding-left:${(0.75 + (prof + 1) * 1.35 + 1.5).toFixed(2)}rem;color:#6b7280;font-size:0.82rem;font-style:italic;">directamente en ${esc(n.nombre)}</td>
          <td style="text-align:right;color:${tono(prof + 1)};white-space:nowrap;">${fmtEur(n.propio)}</td>
          <td colspan="3"></td></tr>`;
      }
      return html + hijas.map((h) => fila(h, n, prof + 1)).join("");
    }

    const filas = arbolG.map((n) => fila(n, null, 0)).join("");
    const netoTotal = totalIngreso - totalGasto;
    return `<div class="v2-wrap"><div class="table-container">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.35rem;">
        <div style="font-size:0.82rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Por centro de coste</div>
        <div style="display:flex;gap:0.3rem;">
          ${rangos.map(([v, t]) => `<button onclick="v2CentroRango('${v}')"
             style="background:${CENTROS.rango === v ? "#232733" : "none"};border:1px solid #2a2d3a;border-radius:8px;
             color:${CENTROS.rango === v ? "#fff" : "#9ca3af"};font-size:0.72rem;font-family:inherit;padding:0.2rem 0.55rem;cursor:pointer;">${t}</button>`).join("")}
        </div>
      </div>
      <div style="font-size:0.75rem;color:#4b5563;margin-bottom:0.5rem;">
        Para qué o para quién, no en qué. ${totalIngreso ? `Neto del periodo: <span style="color:${rc(netoTotal)};font-weight:600;">${netoTotal >= 0 ? "+" : "−"}${fmtEur(Math.abs(netoTotal))}</span>.` : ""}</div>
      <table class="minimal-table">
        <thead><tr>
          <th style="text-align:left;">Centro</th><th style="text-align:right;">Gasto</th>
          <th style="text-align:right;">Ingreso</th><th style="text-align:right;">Neto</th>
          <th class="col-secundaria" style="text-align:right;">Peso</th>
        </tr></thead><tbody>${filas}</tbody></table>
    </div></div>`;
  }

  function pageBalance(m) {
    const g = window.__GASTOS || { meses: [], media: { ingresos: 0, gastos: 0, meses: 0 }, categorias: [] };
    if (!g.meses.length) {
      return header("Balance", fmtEur(0)) +
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
    const grupos = window.SolventoModel.agruparCategorias(mes.catGasto);
    const itemsCat = grupos.map((gr, i) => ({
      label: gr.nombre, value: gr.total,
      accent: CFG.SERIE_COLORES[i % CFG.SERIE_COLORES.length],
    }));
    // El aviso va antes que nada: si hay dinero sin identificar, todo lo que
    // viene debajo —el reparto, las medias, el árbol— está contado con él dentro
    // y conviene saberlo antes de leerlo.
    const pend = window.SolventoModel.pendientes((CURRENT_DOC || {}).movimientos);
    const avisoPend = pend.n
      ? `<div class="v2-wrap"><div style="background:#3f2d0a;border:1px solid #a16207;border-radius:12px;
             padding:0.85rem 1rem;display:flex;align-items:center;gap:0.85rem;flex-wrap:wrap;">
          <div style="flex:1;min-width:14rem;">
            <div style="color:#fbbf24;font-weight:700;font-size:0.9rem;">
              ${pend.n} movimiento${pend.n === 1 ? "" : "s"} sin identificar · ${esc(fmtEur(pend.importe))}</div>
            <div style="color:#d9a441;font-size:0.78rem;margin-top:0.15rem;">
              Sin categoría no entran en el reparto ni en el árbol: ese dinero se gastó, pero no se sabe en qué.</div>
          </div>
          <button onclick="v2MovPendientes()" style="background:#fbbf24;border:none;border-radius:8px;color:#12141d;
            font-size:0.82rem;font-weight:700;padding:0.45rem 0.8rem;cursor:pointer;font-family:inherit;white-space:nowrap;">
            Verlos</button>
        </div></div>`
      : "";
    return header("Balance", fmtEur(mes.ahorro)) + avisoPend + hero +
      panelRegla(mes) +
      barrasIngresoGasto(g) +
      (itemsCat.length ? vistaPanel("categorias", "En qué se va el dinero · " + mes.label,
                                    itemsCat, fmtEur(mes.gastos), "Gasto") : "") +
      tablaCategorias(g, mes, pres) +
      tablaCentros(g);
  }

  // ── Páginas de detalle (sin pestaña propia) ──────────────────────────
  // No entran en la barra de navegación: se llega a ellas desde un botón y se
  // vuelve con el enlace de arriba. Así las tablas largas no estorban en la
  // página principal pero siguen a un clic.
  const volverA = (pagina, texto) =>
    `<div class="v2-wrap" style="margin-bottom:0.5rem;">
       <button onclick="v2Tab('${pagina}')" style="background:none;border:none;color:#3b82f6;font-size:0.85rem;font-weight:600;cursor:pointer;font-family:inherit;padding:0;">← ${esc(texto)}</button>
     </div>`;

  function pageOperaciones(m) {
    return volverA("cartera", "Volver a Cartera") +
      header("Todas las operaciones", "") +
      operacionesList("", true);
  }

  function pageReporte(m) {
    return volverA("cartera", "Volver a Cartera") +
      header("Reporte mensual por activo", "") +
      (tablaMensual(window.__ANALITICA) ||
        `<div class="v2-wrap"><div class="dashboard-panel" style="text-align:center;color:#6b7280;padding:3rem;">Todavía no hay meses que reportar.</div></div>`);
  }

  // ── Menú de usuario ──────────────────────────────────────────────────
  // Recoge lo que antes ocupaba tres huecos en la barra: el estado del guardado,
  // Ajustes y Bloquear. Se cierra al pulsar fuera o con Escape, como se espera
  // de un desplegable.
  function cerrarUserMenu() {
    const m = document.getElementById("user-menu"), b = document.getElementById("user-btn");
    if (m) m.hidden = true;
    if (b) b.setAttribute("aria-expanded", "false");
  }
  window.v2UserMenu = () => {
    const m = document.getElementById("user-menu"), b = document.getElementById("user-btn");
    if (!m) return;
    const abrir = m.hidden;
    m.hidden = !abrir;
    b.setAttribute("aria-expanded", String(abrir));
  };
  window.v2UserIr = (pagina) => { cerrarUserMenu(); showPage(pagina); };
  document.addEventListener("click", (ev) => {
    if (!ev.target.closest || !ev.target.closest(".user-wrap")) cerrarUserMenu();
  });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") cerrarUserMenu(); });

  // ── Navegación ──
  function showPage(id) {
    document.querySelectorAll("#app .page").forEach((p) => p.classList.remove("active"));
    const pg = document.getElementById("v2-page-" + id);
    if (pg) pg.classList.add("active");
    document.querySelectorAll('.bottom-nav-item, .sn-item').forEach((b) => b.classList.toggle("active", b.dataset.page === id));
    if (window.v2Sidebar) window.v2Sidebar(false);   // navegar cierra el panel lateral
    window.scrollTo({ top: 0, behavior: "auto" });
    if (id === "cartera") layoutTreemaps();
  }
  // Resalta un tramo de la barra de distribución y saca sus cifras en un globo.
  // Se dispara igual desde el tramo que desde su entrada de la leyenda.
  // Resalta un tramo del reparto (segmento de la barra o sector del dónut) y saca
  // sus cifras en un globo. Se dispara igual desde la gráfica, desde su entrada de
  // la leyenda o desde la tarjeta correspondiente.
  //   ref      índice, o el nombre del tramo (las tarjetas no saben en qué
  //            posición ha quedado el suyo: el reparto deja fuera los negativos)
  //   sinGlobo resaltar sin sacar las cifras, para cuando quien pregunta ya las
  //            enseña —la tarjeta— y el globo saldría lejos del cursor
  window.v2Reparto = function (id, ref, sinGlobo) {
    const wrap = document.getElementById("rep-" + id);
    if (!wrap) return;
    const tip = wrap.querySelector(".rep-tip");
    const segs = wrap.querySelectorAll(".rep-seg");
    const leg = document.getElementById("leg-" + id);
    const items = leg ? leg.querySelectorAll(".leg-it") : [];
    let i = ref;
    if (typeof ref === "string") {
      i = [...segs].findIndex((s) => s.dataset.label === ref);
      if (i < 0) i = null;             // lo que no está repartido no resalta nada
    }
    if (i == null) {
      wrap.classList.remove("act");
      segs.forEach((s) => s.classList.remove("on"));
      if (leg) { leg.classList.remove("act"); items.forEach((s) => s.classList.remove("on")); }
      tip.hidden = true;
      return;
    }
    const seg = segs[i];
    if (!seg) return;
    wrap.classList.add("act");
    segs.forEach((s, k) => s.classList.toggle("on", k === i));
    if (leg) { leg.classList.add("act"); items.forEach((s, k) => s.classList.toggle("on", k === i)); }
    tip.innerHTML = `<div style="color:#9ca3af;">${esc(seg.dataset.label)}</div>
      <div style="margin-top:0.1rem;"><b>${esc(seg.dataset.pct)}</b> <span style="color:#6b7280;">·</span> <span style="color:#9ca3af;">${esc(seg.dataset.eur)}</span></div>`;
    if (sinGlobo) { tip.hidden = true; return; }
    tip.hidden = false;
    if (wrap.dataset.tipo === "circular") {
      // El dónut es pequeño y redondo: el globo va centrado encima, y quien
      // señala el sector concreto es el propio resalte.
      tip.style.left = "50%";
      return;
    }
    // En la barra el globo se centra sobre el tramo, recortado contra los bordes
    // para que un tramo diminuto pegado al margen no lo saque fuera del panel.
    const ancho = wrap.getBoundingClientRect().width;
    const centro = seg.offsetLeft + seg.offsetWidth / 2;
    const medio = tip.getBoundingClientRect().width / 2;
    tip.style.left = Math.max(medio, Math.min(ancho - medio, centro)) + "px";
  };

  window.v2Tab = showPage;

  // Panel lateral de secciones, que se abre desde el logo. Sin argumento
  // alterna; con true/false fuerza el estado.
  window.v2Sidebar = function (abrir) {
    const sb = document.getElementById("sidebar");
    const bd = document.getElementById("sidebar-backdrop");
    if (!sb || !bd) return;
    const ver = abrir == null ? !sb.classList.contains("open") : !!abrir;
    sb.classList.toggle("open", ver);
    bd.classList.toggle("open", ver);
    const btn = document.getElementById("brand-btn");
    if (btn) btn.setAttribute("aria-expanded", ver ? "true" : "false");
    if (ver) { const p = sb.querySelector(".sn-item.active") || sb.querySelector(".sn-item"); if (p) p.focus(); }
  };
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") window.v2Sidebar(false);
  });
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
    document.getElementById("v2-page-balance").innerHTML = pageBalance(m);
    document.getElementById("v2-page-cartera").innerHTML = pageCartera(m, prices);
    document.getElementById("v2-page-propiedades").innerHTML = pagePropiedades(m);
    document.getElementById("v2-page-pasivos").innerHTML = pagePasivos(m);
    document.getElementById("v2-page-operaciones").innerHTML = pageOperaciones(m);
    document.getElementById("v2-page-reporte").innerHTML = pageReporte(m);
    if (window.v2AjPintar) window.v2AjPintar();
    bindTreemapHover();
    // Gráficas de evolución (patrimonio neto + cartera)
    if (window.SolventoModel.buildSeries && window.SolventoCharts) {
      const series = window.SolventoModel.buildSeries(doc, prices);
      window.__SERIES = series;
      const cp = document.getElementById("v2-chart-patrimonio");
      if (cp) window.SolventoCharts.mount(cp, series.patrimonio, { color: "#10b981", id: "patr" });
      const cc = document.getElementById("v2-chart-cartera");
      if (cc) window.SolventoCharts.mount(cc, series.cartera, { color: "#8b5cf6", id: "cart" });
      // Azul, el mismo color con el que la caja aparece en el reparto del
      // patrimonio y en su tarjeta: la gráfica se reconoce sin leer el título.
      const cj = document.getElementById("v2-chart-caja");
      if (cj) window.SolventoCharts.mount(cj, series.caja, { color: "#3b82f6", id: "caja" });
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
  window.v2MovSinCentro = () => {
    MOV.sinCentro = !MOV.sinCentro; MOV.limite = PAGINA;
    render(CURRENT_DOC, window.__PRICES);
    v2Tab("caja");
  };
  // Se imputan TODOS los que casan con el filtro, no solo los que se ven: la
  // lista se pagina y quedarse en los primeros cincuenta sería una trampa.
  window.v2MovImputar = () => {
    if (!F()) return;
    F().openImputarCentro(movimientosFiltrados());
  };
  window.v2MovPendientes = () => {
    MOV.pend = !MOV.pend; MOV.limite = PAGINA;
    render(CURRENT_DOC, window.__PRICES);
    v2Tab("caja");
    const l = document.getElementById("v2-mov-lista");
    if (l) l.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  window.v2MovLimpiar = () => {
    Object.assign(MOV, { q: "", tipo: "", cuenta: "", cat: "", desde: "", hasta: "", pend: false, sinCentro: false, limite: PAGINA });
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
  window.v2AddProp = () => F() && F().openPropiedad();
  window.v2AddNav = () => F() && F().openNav();
  window.v2Cuadrar = (cuenta, saldo) => F() && F().openCuadrar(cuenta, saldo);
  window.v2AddPas = () => F() && F().openPasivo();
  // Página de Ajustes: la parte estática vive en el HTML (para que sus
  // manejadores no se pierdan al repintar) y aquí solo se rellenan las listas.
  window.v2AjPintar = () => {
    if (!F() || !CURRENT_DOC) return;
    const fr = F().fragmentosAjustes();
    const poner = (id, html) => { const e = document.getElementById(id); if (e) e.innerHTML = html; };
    poner("aj-cuentas", fr.cuentas);
    poner("aj-activos", fr.activos);
    poner("aj-objetivo", fr.objetivo);
    poner("aj-categorias", fr.categorias);
    poner("aj-categorias-ingreso", fr.categoriasIngreso);
    poner("aj-centros", fr.centros);
    poner("aj-revision", panelRevision());
  };
  window.v2AjSec = (sec) => {
    document.querySelectorAll(".aj-sec").forEach((e) => e.classList.toggle("active", e.id === "aj-sec-" + sec));
    document.querySelectorAll(".aj-tab").forEach((b) => b.classList.toggle("active", b.dataset.sec === sec));
  };
  window.v2GastoMes = (ym) => {
    GASTO_MES = ym;
    document.getElementById("v2-page-balance").innerHTML = pageBalance(window.__MODEL);
  };
  window.v2Presupuesto = (cat) => F() && F().openPresupuesto(cat);
  window.v2Clase = (cat) => {
    const doc = CURRENT_DOC;
    if (!doc.config) doc.config = {};
    if (!doc.config.clasificacion) doc.config.clasificacion = {};
    const ciclo = { necesario: "deseo", deseo: "", "": "necesario" };
    const actual = doc.config.clasificacion[cat] || "";
    const siguiente = ciclo[actual];
    if (siguiente) doc.config.clasificacion[cat] = siguiente;
    else delete doc.config.clasificacion[cat];
    if (window.SolventoBoot) window.SolventoBoot.saveDoc();
  };
  window.v2Regla = () => F() && F().openRegla();
  // Abrir rama a rama un árbol de tres niveles es tedioso cuando lo que quieres
  // es buscar algo: este botón lo abre entero y lo vuelve a cerrar.
  window.v2CatTodas = () => {
    const g = window.__GASTOS; if (!g) return;
    const abiertas = Object.keys(ABIERTAS).filter((k) => ABIERTAS[k]).length;
    Object.keys(ABIERTAS).forEach((k) => delete ABIERTAS[k]);
    if (!abiertas) {
      const mes = mesElegido(g);
      const marcar = (ns) => ns.forEach((n) => { if (n.hijas && n.hijas.length) { ABIERTAS[n.completa] = true; marcar(n.hijas); } });
      marcar(window.SolventoModel.arbolCategorias(mes.catGasto));
    }
    render(CURRENT_DOC, window.__PRICES);
  };
  window.v2CentroToggle = (nombre) => {
    CENTROS.abiertas[nombre] = !CENTROS.abiertas[nombre];
    render(CURRENT_DOC, window.__PRICES);
  };
  window.v2PrestamoToggle = (nombre) => {
    PRESTAMOS[nombre] = !PRESTAMOS[nombre];
    document.getElementById("v2-page-pasivos").innerHTML = pagePasivos(window.__MODEL);
  };
  window.v2RevOk = (clave) => F() && F().marcarRevisado(clave);
  window.v2RevRestaurar = () => F() && F().restaurarRevisiones();
  window.v2CentroRango = (r) => { CENTROS.rango = r; render(CURRENT_DOC, window.__PRICES); };
  window.v2CatToggle = (nombre) => {
    ABIERTAS[nombre] = !ABIERTAS[nombre];
    document.getElementById("v2-page-balance").innerHTML = pageBalance(window.__MODEL);
  };
  window.v2Password = () => F() && F().openPassword();
  window.v2CompModo = (modo) => {
    COMP_MODO = modo;
    // Solo cambia esta gráfica, así que se repinta solo su panel. Antes se
    // hacía un render() completo seguido de showPage(), y ese showPage subía
    // la ventana al principio: alternar entre los dos modos te sacaba del
    // gráfico que estabas mirando.
    const panel = document.getElementById("v2-comparativa");
    if (!panel) { render(CURRENT_DOC, window.__PRICES); return; }
    panel.outerHTML = comparativaPanel();
    montarComparativa();
  };
  window.v2Vista = (id, modo) => {
    VISTA[id] = modo;
    // Repintado completo: cada panel reconstruye su cuerpo con la vista elegida
    render(CURRENT_DOC, window.__PRICES);
  };
  window.v2CfgCuenta = (i) => F() && F().openCuentaCfg(i);
  window.v2CfgDelCuenta = (i) => F() && F().borrarCuentaCfg(i);
  window.v2CfgActivo = (i) => F() && F().openActivoCfg(i);
  window.v2CfgDelActivo = (i) => F() && F().borrarActivoCfg(i);
  window.v2CfgObjetivo = () => F() && F().openObjetivoCfg();
  window.v2CatNueva = (madre) => F() && F().openCategoriaNueva(madre);
  window.v2CatBorrar = (cat) => F() && F().borrarCategoriaCfg(cat);
  window.v2CatRenombrar = (cat) => F() && F().renombrarCategoriaCfg(cat);
  window.v2CatIngNueva = (padre) => F() && F().openCategoriaIngresoNueva(padre);
  window.v2CatIngBorrar = (cat) => F() && F().borrarCategoriaIngresoCfg(cat);
  window.v2CatIngRenombrar = (cat) => F() && F().renombrarCategoriaIngresoCfg(cat);
  window.v2CenNueva = (padre) => F() && F().openCentroNuevo(padre);
  window.v2CenBorrar = (c) => F() && F().borrarCentroCfg(c);
  window.v2CenRenombrar = (c) => F() && F().renombrarCentroCfg(c);
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
    if (!el || !an || !window.SolventoCharts || !window.SolventoCharts.mountMulti) return;
    let series = COMP_MODO === "comportamiento" ? (an.comportamiento || []) : (an.comparativa || []);
    if (!series.length) series = an.comparativa || [];
    // Referencia de mercado: sirve para saber si lo estás haciendo mejor o peor
    // que comprar el índice, que es la comparación que de verdad importa.
    if (COMP_MODO === "comportamiento") {
      const ref = referenciaMercado(an.meses);
      if (ref) series = [ref].concat(series);
    }
    window.SolventoCharts.mountMulti(el, series.map((s) => Object.assign({}, s)), {
      meses: an.meses,
      ventana: COMP_VENTANA,
      onVentana: (v) => { COMP_VENTANA = v; },
    });
  }

  // MSCI World como índice de referencia, desde el histórico público de precios.
  function referenciaMercado(meses) {
    const hist = (window.__PRICES && window.__PRICES.hist && window.__PRICES.hist["IWDA.AS"]) || null;
    if (!hist || hist.length < 2 || !meses.length) return null;
    const antesDe = (t) => { for (let i = hist.length - 1; i >= 0; i--) if (hist[i][0] <= t) return hist[i][1]; return null; };
    let base = null;
    const puntos = meses.map((t) => {
      const p = antesDe(t);
      if (p == null || !(p > 0)) return [t, null];
      if (base == null) base = p;
      return [t, (p / base - 1) * 100];
    });
    return puntos.some((x) => x[1] != null)
      ? { key: "__ref", label: "MSCI World (referencia)", isin: "-", destacada: true, puntos }
      : null;
  }
  window.v2EditMov = (id) => F() && F().editMovimiento(id);
  window.v2EditInv = (id) => F() && F().editInversion(id);
  window.v2EditProp = (id) => F() && F().editPropiedad(id);
  window.v2DelMov = (id) => { if (F() && confirm("¿Borrar este movimiento?")) F().deleteMovimiento(id); };
  window.v2DelInv = (id) => { if (F() && confirm("¿Borrar esta operación?")) F().deleteInversion(id); };
  window.v2DelProp = (id) => { if (F() && confirm("¿Borrar esta propiedad?")) F().deletePropiedad(id); };

  window.SolventoRender = { render, showPage };
})();
