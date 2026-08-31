/*
 * Solvento v2 — Formularios para registrar desde la web (Fase 4).
 * Alta de movimientos (Ingreso/Gasto/Traspaso/Préstamo) y de operaciones de
 * inversión (Compra/Venta). Al guardar, muta el documento en memoria y llama a
 * SolventoBoot.saveDoc() (cifra + guarda local + sube a GitHub si hay token).
 */
(function () {
  "use strict";
  const CFG = window.SolventoConfig;
  const DB = window.SolventoDB;

  const CUENTAS = CFG.CUENTAS.map((c) => c.cuenta);
  const ACTIVO_TIPOS = ["ETF", "Fondo de inversión", "Acciones", "Criptoactivo"];
  const RENTAS = ["Renta variable", "Renta fija"];

  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const hoyES = () => { const d = new Date(); const p = (n) => String(n).padStart(2, "0"); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`; };
  const toISO = (es) => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(es || "")); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : ""; };
  const fromISO = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); return m ? `${m[3]}/${m[2]}/${m[1]}` : ""; };
  const newId = (p) => p + Math.random().toString(16).slice(2, 12);
  const uniq = (arr) => Array.from(new Set(arr.filter((x) => x && String(x).trim())));

  // ── Modal genérico (se crea una vez) ──
  function ensureModal() {
    let m = document.getElementById("form-modal");
    if (m) return m;
    m = document.createElement("div");
    m.id = "form-modal";
    m.style.cssText = "display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:1200;align-items:center;justify-content:center;padding:1.5rem;";
    m.innerHTML = '<div class="modal-card" style="background:#171a24;border:1px solid #232733;border-radius:14px;padding:1.5rem;width:100%;max-width:480px;max-height:90vh;overflow-y:auto;"></div>';
    m.addEventListener("mousedown", (e) => { if (e.target === m) close(); });
    document.body.appendChild(m);
    return m;
  }
  function close() { const m = document.getElementById("form-modal"); if (m) m.style.display = "none"; }

  const styleInput = "width:100%;background:#12141d;border:1px solid #2a2d3a;border-radius:10px;color:#e5e7eb;font-size:0.9rem;padding:0.6rem 0.8rem;outline:none;font-family:inherit;";
  const styleLabel = "display:block;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:#6b7280;font-weight:700;margin:0.85rem 0 0.3rem;";

  function field(id, label, inputHtml) {
    return `<div class="ff" data-for="${id}"><label style="${styleLabel}" for="${id}">${esc(label)}</label>${inputHtml}</div>`;
  }
  const input = (id, type, val, extra) => `<input id="${id}" type="${type}" value="${esc(val || "")}" style="${styleInput}" ${extra || ""}>`;
  const select = (id, opts, val) => `<select id="${id}" style="${styleInput}">${opts.map((o) => `<option ${o === val ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
  const datalist = (id, opts, val) => `<input id="${id}" list="${id}-dl" value="${esc(val || "")}" style="${styleInput}"><datalist id="${id}-dl">${uniq(opts).map((o) => `<option value="${esc(o)}">`).join("")}</datalist>`;

  function shell(titulo, bodyHtml, onSubmit) {
    const m = ensureModal();
    m.querySelector(".modal-card").innerHTML =
      `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
        <div style="font-size:1.1rem;font-weight:800;color:#fff;">${esc(titulo)}</div>
        <button id="ff-close" style="border:none;background:none;color:#9ca3af;font-size:1.1rem;cursor:pointer;">✕</button>
      </div>
      <form id="ff-form">${bodyHtml}
        <div id="ff-error" style="display:none;color:#ef4444;font-size:0.82rem;font-weight:600;margin-top:0.75rem;"></div>
        <button type="submit" class="primary" style="width:100%;margin-top:1.25rem;background:#fff;color:#000;border:none;border-radius:10px;font-size:0.92rem;font-weight:700;padding:0.7rem;cursor:pointer;font-family:inherit;">Guardar</button>
      </form>`;
    m.style.display = "flex";
    document.getElementById("ff-close").addEventListener("click", close);
    document.getElementById("ff-form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const err = onSubmit();
      if (err) { const e = document.getElementById("ff-error"); e.textContent = err; e.style.display = "block"; return; }
      close();
      if (window.SolventoBoot && window.SolventoBoot.saveDoc) await window.SolventoBoot.saveDoc();
    });
  }

  // ── Movimiento ──
  function openMovimiento() {
    const doc = DB.state.doc;
    const catGasto = uniq((doc.movimientos || []).map((m) => m.tipo_gasto));
    const catIngreso = uniq((doc.movimientos || []).map((m) => m.tipo_ingreso));
    const body =
      field("m-fecha", "Fecha", input("m-fecha", "date", toISO(hoyES()))) +
      field("m-tipo", "Tipo", select("m-tipo", ["Gasto", "Ingreso", "Traspaso", "Préstamo"], "Gasto")) +
      field("m-importe", "Importe (€)", input("m-importe", "number", "", 'step="0.01" min="0"')) +
      field("m-origen", "Cuenta origen", select("m-origen", CUENTAS, CUENTAS[0])) +
      field("m-destino", "Cuenta destino", select("m-destino", CUENTAS, CUENTAS[0])) +
      field("m-catg", "Categoría de gasto", datalist("m-catg", catGasto)) +
      field("m-cati", "Categoría de ingreso", datalist("m-cati", catIngreso)) +
      field("m-tpres", "Tipo de préstamo", select("m-tpres", ["Dinero prestado", "Devolución"], "Dinero prestado")) +
      field("m-persona", "Persona", input("m-persona", "text", "")) +
      field("m-detalle", "Detalle", input("m-detalle", "text", ""));

    shell("Nuevo movimiento", body, () => {
      const g = (id) => document.getElementById(id).value.trim();
      const tipo = g("m-tipo");
      const importe = parseFloat(g("m-importe"));
      if (!isFinite(importe) || importe <= 0) return "Introduce un importe válido";
      const rec = {
        id: newId("m"), marca_temporal: new Date().toLocaleString("es-ES"),
        fecha: fromISO(g("m-fecha")) || hoyES(), tipo, importe: String(importe),
        cuenta_origen: "", cuenta_destino: "", tipo_ingreso: "", tipo_gasto: "",
        tipo_prestamo: "", persona_prestamo: "", detalle: g("m-detalle"),
      };
      if (tipo === "Gasto") { rec.cuenta_origen = g("m-origen"); rec.tipo_gasto = g("m-catg"); }
      else if (tipo === "Ingreso") { rec.cuenta_destino = g("m-destino"); rec.tipo_ingreso = g("m-cati"); }
      else if (tipo === "Traspaso") {
        rec.cuenta_origen = g("m-origen"); rec.cuenta_destino = g("m-destino");
        if (rec.cuenta_origen === rec.cuenta_destino) return "Origen y destino no pueden ser la misma cuenta";
      } else if (tipo === "Préstamo") {
        rec.tipo_prestamo = g("m-tpres"); rec.persona_prestamo = g("m-persona");
        if (rec.tipo_prestamo === "Dinero prestado") rec.cuenta_origen = g("m-origen");
        else rec.cuenta_destino = g("m-destino");
      }
      doc.movimientos.push(rec);
      return null;
    });
    wireMovVisibility();
  }
  function wireMovVisibility() {
    const tipoEl = document.getElementById("m-tipo");
    const tpresEl = document.getElementById("m-tpres");
    function upd() {
      const t = tipoEl.value, tp = tpresEl.value;
      const show = (id, on) => { const el = document.querySelector(`.ff[data-for="${id}"]`); if (el) el.style.display = on ? "" : "none"; };
      show("m-origen", t === "Gasto" || t === "Traspaso" || (t === "Préstamo" && tp === "Dinero prestado"));
      show("m-destino", t === "Ingreso" || t === "Traspaso" || (t === "Préstamo" && tp === "Devolución"));
      show("m-catg", t === "Gasto");
      show("m-cati", t === "Ingreso");
      show("m-tpres", t === "Préstamo");
      show("m-persona", t === "Préstamo");
    }
    tipoEl.addEventListener("change", upd);
    tpresEl.addEventListener("change", upd);
    upd();
  }

  // ── Operación de inversión (Compra / Venta) ──
  function openInversion() {
    const doc = DB.state.doc;
    const conocidos = {};
    CFG.ACTIVOS.forEach((a) => (conocidos[a.nombre] = a));
    (doc.inversiones || []).forEach((r) => { if (r.nombre && !conocidos[r.nombre]) conocidos[r.nombre] = { nombre: r.nombre, isin: r.isin, categoria: r.renta, tipo: r.activo, banco: r.cuenta }; });
    const nombres = Object.keys(conocidos);

    const body =
      field("i-fecha", "Fecha", input("i-fecha", "date", toISO(hoyES()))) +
      field("i-tipo", "Operación", select("i-tipo", ["Compra", "Venta"], "Compra")) +
      field("i-nombre", "Activo", datalist("i-nombre", nombres)) +
      field("i-isin", "ISIN", input("i-isin", "text", "")) +
      field("i-renta", "Categoría", select("i-renta", RENTAS, "Renta variable")) +
      field("i-activo", "Tipo de activo", select("i-activo", ACTIVO_TIPOS, "ETF")) +
      field("i-cuenta", "Cuenta / bróker", select("i-cuenta", CUENTAS, "Trade Republic")) +
      field("i-importe", "Importe (€)", input("i-importe", "number", "", 'step="0.01" min="0"')) +
      field("i-unidades", "Unidades / participaciones", input("i-unidades", "number", "", 'step="any" min="0"'));

    shell("Nueva operación", body, () => {
      const g = (id) => document.getElementById(id).value.trim();
      const nombre = g("i-nombre");
      if (!nombre) return "Indica el nombre del activo";
      const importe = parseFloat(g("i-importe"));
      if (!isFinite(importe) || importe <= 0) return "Introduce un importe válido";
      const uds = parseFloat(g("i-unidades"));
      const signo = g("i-tipo") === "Venta" ? -1 : 1;
      const rec = {
        id: newId("i"), fecha: fromISO(g("i-fecha")) || hoyES(),
        tipo_movimiento: g("i-tipo"), nombre, ticker: "-", isin: g("i-isin") || "-",
        renta: g("i-renta"), activo: g("i-activo"), cuenta: g("i-cuenta"),
        valor: "", coste: String(signo * importe),
        unidades: isFinite(uds) ? String(signo * uds) : "",
      };
      doc.inversiones.push(rec);
      return null;
    });

    // Autocompletar ISIN/categoría/tipo/cuenta al elegir un activo conocido
    const nEl = document.getElementById("i-nombre");
    nEl.addEventListener("change", () => {
      const a = conocidos[nEl.value.trim()];
      if (!a) return;
      if (a.isin && a.isin !== "-") document.getElementById("i-isin").value = a.isin;
      if (a.categoria) document.getElementById("i-renta").value = a.categoria;
      if (a.tipo) document.getElementById("i-activo").value = a.tipo;
      if (a.banco) document.getElementById("i-cuenta").value = a.banco;
    });
  }

  // ── Borrado ──
  function deleteMovimiento(id) {
    const doc = DB.state.doc;
    doc.movimientos = (doc.movimientos || []).filter((m) => m.id !== id);
    if (window.SolventoBoot && window.SolventoBoot.saveDoc) window.SolventoBoot.saveDoc();
  }
  function deleteInversion(id) {
    const doc = DB.state.doc;
    doc.inversiones = (doc.inversiones || []).filter((m) => m.id !== id);
    if (window.SolventoBoot && window.SolventoBoot.saveDoc) window.SolventoBoot.saveDoc();
  }

  window.SolventoForms = { openMovimiento, openInversion, deleteMovimiento, deleteInversion };
})();
