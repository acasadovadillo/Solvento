/*
 * Solvento v2 — Formularios para registrar/editar desde la web (Fase 4/4b).
 * Alta y EDICIÓN de movimientos, operaciones de inversión, inmuebles y valores
 * liquidativos (NAV). Al guardar, muta el documento en memoria y llama a
 * SolventoBoot.saveDoc() (cifra + guarda local + sube a GitHub si hay token).
 */
(function () {
  "use strict";
  const CFG = window.SolventoConfig;
  const DB = window.SolventoDB;

  // En vivo: si añades o renombras una cuenta, los formularios lo reflejan
  const CUENTAS = () => CFG.cuentas().map((c) => c.cuenta);
  const ACTIVO_TIPOS = ["ETF", "Fondo de inversión", "Acciones", "Criptoactivo"];
  const RENTAS = ["Renta variable", "Renta fija"];
  const INMUEBLE_TIPOS = Object.keys(CFG.TIPO_COLORES_INMUEBLE);

  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const hoyES = () => { const d = new Date(); const p = (n) => String(n).padStart(2, "0"); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`; };
  const toISO = (es) => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(es || "")); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : ""; };
  const fromISO = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); return m ? `${m[3]}/${m[2]}/${m[1]}` : ""; };
  const newId = (p) => p + Math.random().toString(16).slice(2, 12);
  const uniq = (arr) => Array.from(new Set(arr.filter((x) => x && String(x).trim())));
  const absStr = (v) => { const n = Math.abs(parseFloat(v)); return isFinite(n) ? String(n) : ""; };

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
  const field = (id, label, inputHtml) => `<div class="ff" data-for="${id}"><label style="${styleLabel}" for="${id}">${esc(label)}</label>${inputHtml}</div>`;
  const input = (id, type, val, extra) => `<input id="${id}" type="${type}" value="${esc(val == null ? "" : val)}" style="${styleInput}" ${extra || ""}>`;
  const select = (id, opts, val) => `<select id="${id}" style="${styleInput}">${opts.map((o) => `<option ${o === val ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
  const selectKV = (id, pairs, val) => `<select id="${id}" style="${styleInput}">${pairs.map((p) => `<option value="${esc(p[0])}" ${p[0] === val ? "selected" : ""}>${esc(p[1])}</option>`).join("")}</select>`;
  const datalist = (id, opts, val) => `<input id="${id}" list="${id}-dl" value="${esc(val || "")}" style="${styleInput}"><datalist id="${id}-dl">${uniq(opts).map((o) => `<option value="${esc(o)}">`).join("")}</datalist>`;

  function shell(titulo, bodyHtml, onSubmit, despues) {
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
      if (despues) despues();
    });
  }
  const G = (id) => document.getElementById(id).value.trim();
  const upsert = (arr, rec) => { const i = arr.findIndex((x) => x.id === rec.id); if (i >= 0) arr[i] = rec; else arr.push(rec); };

  // ── Movimiento ──
  function openMovimiento(existing) {
    const doc = DB.state.doc, e = existing || {};
    // "Inversiones" ya no es una categoría de movimiento (las compras se
    // registran como operaciones, que mueven el efectivo solas).
    const noInv = (arr) => arr.filter((c) => String(c).trim().toLowerCase() !== "inversiones");
    const catGasto = noInv(uniq((doc.movimientos || []).map((m) => m.tipo_gasto)));
    const catIngreso = noInv(uniq((doc.movimientos || []).map((m) => m.tipo_ingreso)));
    const body =
      field("m-fecha", "Fecha", input("m-fecha", "date", toISO(e.fecha || hoyES()))) +
      field("m-tipo", "Tipo", select("m-tipo", ["Gasto", "Ingreso", "Traspaso", "Préstamo"], e.tipo || "Gasto")) +
      field("m-importe", "Importe (€)", input("m-importe", "number", e.importe, 'step="0.01" min="0"')) +
      field("m-origen", "Cuenta origen", select("m-origen", CUENTAS(), e.cuenta_origen || CUENTAS()[0])) +
      field("m-destino", "Cuenta destino", select("m-destino", CUENTAS(), e.cuenta_destino || CUENTAS()[0])) +
      field("m-catg", "Categoría de gasto", datalist("m-catg", catGasto, e.tipo_gasto)) +
      field("m-cati", "Categoría de ingreso", datalist("m-cati", catIngreso, e.tipo_ingreso)) +
      field("m-tpres", "Tipo de préstamo", select("m-tpres", ["Dinero prestado", "Devolución"], e.tipo_prestamo || "Dinero prestado")) +
      field("m-persona", "Persona", input("m-persona", "text", e.persona_prestamo)) +
      field("m-detalle", "Detalle", input("m-detalle", "text", e.detalle));
    shell(existing ? "Editar movimiento" : "Nuevo movimiento", body, () => {
      const tipo = G("m-tipo"), importe = parseFloat(G("m-importe"));
      if (!isFinite(importe) || importe <= 0) return "Introduce un importe válido";
      const rec = {
        id: e.id || newId("m"), marca_temporal: e.marca_temporal || new Date().toLocaleString("es-ES"),
        fecha: fromISO(G("m-fecha")) || hoyES(), tipo, importe: String(importe),
        cuenta_origen: "", cuenta_destino: "", tipo_ingreso: "", tipo_gasto: "",
        tipo_prestamo: "", persona_prestamo: "", detalle: G("m-detalle"),
      };
      if (tipo === "Gasto") { rec.cuenta_origen = G("m-origen"); rec.tipo_gasto = G("m-catg"); }
      else if (tipo === "Ingreso") { rec.cuenta_destino = G("m-destino"); rec.tipo_ingreso = G("m-cati"); }
      else if (tipo === "Traspaso") {
        rec.cuenta_origen = G("m-origen"); rec.cuenta_destino = G("m-destino");
        if (rec.cuenta_origen === rec.cuenta_destino) return "Origen y destino no pueden ser la misma cuenta";
      } else if (tipo === "Préstamo") {
        rec.tipo_prestamo = G("m-tpres"); rec.persona_prestamo = G("m-persona");
        if (rec.tipo_prestamo === "Dinero prestado") rec.cuenta_origen = G("m-origen"); else rec.cuenta_destino = G("m-destino");
      }
      upsert(doc.movimientos, rec);
      return null;
    });
    wireMovVisibility();
  }
  function wireMovVisibility() {
    const tipoEl = document.getElementById("m-tipo"), tpresEl = document.getElementById("m-tpres");
    function upd() {
      const t = tipoEl.value, tp = tpresEl.value;
      const show = (id, on) => { const el = document.querySelector(`.ff[data-for="${id}"]`); if (el) el.style.display = on ? "" : "none"; };
      show("m-origen", t === "Gasto" || t === "Traspaso" || (t === "Préstamo" && tp === "Dinero prestado"));
      show("m-destino", t === "Ingreso" || t === "Traspaso" || (t === "Préstamo" && tp === "Devolución"));
      show("m-catg", t === "Gasto"); show("m-cati", t === "Ingreso");
      show("m-tpres", t === "Préstamo"); show("m-persona", t === "Préstamo");
    }
    tipoEl.addEventListener("change", upd); tpresEl.addEventListener("change", upd); upd();
  }

  // ── Operación de inversión (Compra / Venta) ──
  function openInversion(existing) {
    const doc = DB.state.doc, e = existing || {};
    const conocidos = {};
    CFG.activos().forEach((a) => (conocidos[a.nombre] = a));
    (doc.inversiones || []).forEach((r) => { if (r.nombre && !conocidos[r.nombre]) conocidos[r.nombre] = { nombre: r.nombre, isin: r.isin, categoria: r.renta, tipo: r.activo, banco: r.cuenta }; });
    const body =
      field("i-fecha", "Fecha", input("i-fecha", "date", toISO(e.fecha || hoyES()))) +
      field("i-tipo", "Operación", select("i-tipo", ["Compra", "Venta"], e.tipo_movimiento || "Compra")) +
      field("i-nombre", "Activo", datalist("i-nombre", Object.keys(conocidos), e.nombre)) +
      field("i-isin", "ISIN", input("i-isin", "text", e.isin && e.isin !== "-" ? e.isin : "")) +
      field("i-renta", "Categoría", select("i-renta", RENTAS, e.renta || "Renta variable")) +
      field("i-activo", "Tipo de activo", select("i-activo", ACTIVO_TIPOS, e.activo || "ETF")) +
      field("i-cuenta", "Cuenta / bróker", select("i-cuenta", CUENTAS(), e.cuenta || CUENTAS()[0])) +
      field("i-importe", "Importe (€)", input("i-importe", "number", absStr(e.coste), 'step="0.01" min="0"')) +
      field("i-unidades", "Unidades / participaciones", input("i-unidades", "number", absStr(e.unidades), 'step="any" min="0"'));
    shell(existing ? "Editar operación" : "Nueva operación", body, () => {
      const nombre = G("i-nombre");
      if (!nombre) return "Indica el nombre del activo";
      const importe = parseFloat(G("i-importe"));
      if (!isFinite(importe) || importe <= 0) return "Introduce un importe válido";
      const uds = parseFloat(G("i-unidades"));
      const signo = G("i-tipo") === "Venta" ? -1 : 1;
      upsert(doc.inversiones, {
        id: e.id || newId("i"), fecha: fromISO(G("i-fecha")) || hoyES(),
        tipo_movimiento: G("i-tipo"), nombre, ticker: e.ticker || "-", isin: G("i-isin") || "-",
        renta: G("i-renta"), activo: G("i-activo"), cuenta: G("i-cuenta"),
        valor: "", coste: String(signo * importe), unidades: isFinite(uds) ? String(signo * uds) : "",
      });
      return null;
    });
    const nEl = document.getElementById("i-nombre");
    nEl.addEventListener("change", () => {
      const a = conocidos[nEl.value.trim()]; if (!a) return;
      if (a.isin && a.isin !== "-") document.getElementById("i-isin").value = a.isin;
      if (a.categoria) document.getElementById("i-renta").value = a.categoria;
      if (a.tipo) document.getElementById("i-activo").value = a.tipo;
      if (a.banco) document.getElementById("i-cuenta").value = a.banco;
    });
  }

  // ── Cuadrar saldo de una cuenta con el banco ──
  // Crea el movimiento de ajuste exacto (Ingreso/Gasto de ajuste) para que el
  // saldo de Solvento coincida con el real. Útil cuando hay huecos en el
  // histórico o desfases acumulados.
  function openCuadrar(cuenta, saldoActual) {
    const doc = DB.state.doc;
    const body =
      `<div style="font-size:0.85rem;color:#9ca3af;margin:0.5rem 0 0.25rem;">Saldo según Solvento: <b style="color:#fff;">${saldoActual.toFixed(2).replace(".", ",")} €</b></div>` +
      field("c-real", "Saldo real en el banco (€)", input("c-real", "number", "", 'step="0.01"')) +
      field("c-fecha", "Fecha del ajuste", input("c-fecha", "date", toISO(hoyES()))) +
      field("c-detalle", "Detalle", input("c-detalle", "text", "Ajuste de saldo"));
    shell("Cuadrar " + cuenta, body, () => {
      const real = parseFloat(G("c-real"));
      if (!isFinite(real)) return "Introduce el saldo real de la cuenta";
      const diff = Math.round((real - saldoActual) * 100) / 100;
      if (Math.abs(diff) < 0.01) return "El saldo ya coincide: no hace falta ajuste";
      const tipo = diff > 0 ? "Ingreso" : "Gasto";
      doc.movimientos.push({
        id: newId("m"), marca_temporal: new Date().toLocaleString("es-ES"),
        fecha: fromISO(G("c-fecha")) || hoyES(), tipo, importe: String(Math.abs(diff)),
        cuenta_origen: tipo === "Gasto" ? cuenta : "",
        cuenta_destino: tipo === "Ingreso" ? cuenta : "",
        tipo_ingreso: tipo === "Ingreso" ? "Ingreso de ajuste" : "",
        tipo_gasto: tipo === "Gasto" ? "Gasto de ajuste" : "",
        tipo_prestamo: "", persona_prestamo: "",
        detalle: G("c-detalle") || "Ajuste de saldo",
      });
      return null;
    });
  }

  // ── Pasivo (deuda) ──
  const PASIVO_TIPOS = ["Hipoteca", "Préstamo personal", "Préstamo coche",
                        "Tarjeta de crédito", "Deuda con particular", "Otro"];
  function openPasivo(existing) {
    const doc = DB.state.doc, e = existing || {};
    if (!Array.isArray(doc.pasivos)) doc.pasivos = [];
    const body =
      field("d-nombre", "Concepto", input("d-nombre", "text", e.nombre, 'placeholder="Hipoteca de la vivienda"')) +
      field("d-tipo", "Tipo", select("d-tipo", PASIVO_TIPOS, e.tipo || PASIVO_TIPOS[0])) +
      field("d-entidad", "Entidad", datalist("d-entidad", CUENTAS(), e.entidad)) +
      field("d-importe", "Pendiente de pagar (€)", input("d-importe", "number", e.importe, 'step="0.01" min="0" placeholder="120000"')) +
      `<div style="font-size:0.75rem;color:#6b7280;margin-top:0.5rem;">Anota lo que <b>te queda por pagar</b> hoy, no el importe original. Se descuenta de tu patrimonio neto.</div>`;
    shell(existing ? "Editar deuda" : "Nueva deuda", body, () => {
      const nombre = G("d-nombre");
      if (!nombre) return "Indica el concepto de la deuda";
      const importe = parseFloat(G("d-importe"));
      if (!isFinite(importe) || importe <= 0) return "Introduce el importe pendiente";
      upsert(doc.pasivos, {
        id: e.id || newId("d"), nombre, tipo: G("d-tipo"),
        entidad: G("d-entidad"), importe: String(importe),
      });
      return null;
    });
  }
  // ── Ajustes: cuentas, activos y objetivo de asignación ──────────────
  // Todo esto vivía en el código. Ahora se guarda en tu documento cifrado, así
  // que puedes abrir una cuenta o dar de alta un ETF sin que yo toque nada.
  // La primera vez que editas algo, se copia la configuración actual a tus datos
  // y a partir de ahí manda la tuya.
  function cfgEditable() {
    const doc = DB.state.doc;
    if (!doc.config) doc.config = {};
    if (!doc.config.cuentas)  doc.config.cuentas  = JSON.parse(JSON.stringify(CFG.CUENTAS_DEFECTO));
    if (!doc.config.activos)  doc.config.activos  = JSON.parse(JSON.stringify(CFG.ACTIVOS_DEFECTO));
    if (!doc.config.objetivo) doc.config.objetivo = Object.assign({}, CFG.OBJETIVO_DEFECTO);
    CFG.usarDoc(doc);
    return doc.config;
  }

  const filaAjuste = (izq, der, acciones) =>
    `<div style="display:flex;align-items:center;gap:0.6rem;padding:0.55rem 0;border-bottom:1px solid #232733;">
      <div style="flex:1;min-width:0;"><div style="color:#e5e7eb;font-weight:600;font-size:0.88rem;">${izq}</div>
        <div style="color:#6b7280;font-size:0.75rem;">${der}</div></div>${acciones}</div>`;
  const miniBtn = (txt, onclick, color) =>
    `<button type="button" onclick="${onclick}" style="background:none;border:none;color:${color || "#6b7280"};cursor:pointer;font-size:0.85rem;padding:0.2rem 0.35rem;font-family:inherit;">${txt}</button>`;

  function openAjustes() {
    const c = cfgEditable();
    const obj = c.objetivo;
    const cuentasHtml = c.cuentas.map((x, i) => filaAjuste(
      `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${esc(x.accent || "#6b7280")};margin-right:0.4rem;"></span>${esc(x.cuenta)}`,
      [x.broker ? "efectivo en Cartera" : "efectivo en Caja",
       x.cartera === "cero" ? "aparece en Cartera sin saldo" : (x.cartera ? "bróker en Cartera" : "")].filter(Boolean).join(" · "),
      miniBtn("✎", `v2CfgCuenta(${i})`) + miniBtn("✕", `v2CfgDelCuenta(${i})`)
    )).join("");
    const activosHtml = c.activos.map((x, i) => filaAjuste(
      esc(x.nombre),
      `${esc(x.isin || "-")} · ${esc(x.banco || "")}${x.yf ? " · " + esc(x.yf) : " · sin precio automático"}`,
      miniBtn("✎", `v2CfgActivo(${i})`) + miniBtn("✕", `v2CfgDelActivo(${i})`)
    )).join("");

    const body =
      `<div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:#6b7280;font-weight:700;margin:0.5rem 0 0.3rem;">Cuentas</div>
       ${cuentasHtml}
       <div style="margin:0.6rem 0 1.4rem;">${miniBtn("＋ Añadir cuenta", "v2CfgCuenta(-1)", "#3b82f6")}</div>

       <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:#6b7280;font-weight:700;margin:0.5rem 0 0.3rem;">Activos</div>
       ${activosHtml}
       <div style="margin:0.6rem 0 1.4rem;">${miniBtn("＋ Añadir activo", "v2CfgActivo(-1)", "#3b82f6")}</div>

       <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:#6b7280;font-weight:700;margin:0.5rem 0 0.5rem;">Objetivo de asignación</div>
       ${filaAjuste("Renta variable / Renta fija",
                    `${(+obj["Renta variable"] || 0).toFixed(0)}% / ${(+obj["Renta fija"] || 0).toFixed(0)}%`,
                    miniBtn("✎", "v2CfgObjetivo()"))}`;

    const m = ensureModal();
    m.querySelector(".modal-card").innerHTML =
      `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
        <div style="font-size:1.1rem;font-weight:800;color:#fff;">Ajustes</div>
        <button id="ff-close" style="border:none;background:none;color:#9ca3af;font-size:1.1rem;cursor:pointer;">✕</button>
      </div>
      <div style="font-size:0.78rem;color:#6b7280;margin-bottom:0.75rem;">Tus cuentas, activos y objetivo. Se guardan cifrados con el resto de tus datos.</div>
      ${body}`;
    m.style.display = "flex";
    document.getElementById("ff-close").addEventListener("click", close);
  }

  function openCuentaCfg(i) {
    const c = cfgEditable();
    const e = i >= 0 ? c.cuentas[i] : {};
    const body =
      field("c-nombre", "Nombre", input("c-nombre", "text", e.cuenta, 'placeholder="Revolut"')) +
      field("c-color", "Color", input("c-color", "color", e.accent || "#3b82f6")) +
      field("c-donde", "¿Dónde cuenta su efectivo?",
        selectKV("c-donde", [["caja", "En Caja (cuenta corriente)"], ["cartera", "En Cartera (bróker remunerado)"]],
                 e.broker ? "cartera" : "caja")) +
      field("c-cartera", "¿Aparece en la pestaña Cartera?",
        selectKV("c-cartera", [["no", "No"], ["efectivo", "Sí, con su efectivo"], ["cero", "Sí, pero sin efectivo propio"]],
                 e.cartera || "no")) +
      field("c-etiqueta", "Etiqueta en Cartera", input("c-etiqueta", "text", e.etiquetaEfectivo, 'placeholder="Cuenta Broker"'));
    shell(i >= 0 ? "Editar cuenta" : "Nueva cuenta", body, () => {
      const nombre = G("c-nombre");
      if (!nombre) return "Indica el nombre de la cuenta";
      const repetida = c.cuentas.some((x, k) => k !== i && x.cuenta === nombre);
      if (repetida) return "Ya tienes una cuenta con ese nombre";
      const cartera = G("c-cartera");
      const rec = Object.assign({}, e, {
        cuenta: nombre, accent: G("c-color"),
        broker: G("c-donde") === "cartera",
        cartera: cartera === "no" ? null : cartera,
        etiquetaEfectivo: G("c-etiqueta") || undefined,
      });
      if (i >= 0) {
        // Si se renombra, arrastrar el cambio a los datos que la referencian
        const antes = c.cuentas[i].cuenta;
        if (antes !== nombre) renombrarCuenta(antes, nombre);
        c.cuentas[i] = rec;
      } else c.cuentas.push(rec);
      return null;
    }, openAjustes);
  }

  // Renombrar una cuenta sin romper el histórico que la menciona
  function renombrarCuenta(antes, ahora) {
    const doc = DB.state.doc;
    (doc.movimientos || []).forEach((m) => {
      if (m.cuenta_origen === antes) m.cuenta_origen = ahora;
      if (m.cuenta_destino === antes) m.cuenta_destino = ahora;
    });
    (doc.inversiones || []).forEach((r) => { if (r.cuenta === antes) r.cuenta = ahora; });
    ((doc.config && doc.config.activos) || []).forEach((a) => { if (a.banco === antes) a.banco = ahora; });
  }

  function borrarCuentaCfg(i) {
    const c = cfgEditable();
    const nombre = c.cuentas[i] && c.cuentas[i].cuenta;
    const doc = DB.state.doc;
    const usos = (doc.movimientos || []).filter((m) => m.cuenta_origen === nombre || m.cuenta_destino === nombre).length
               + (doc.inversiones || []).filter((r) => r.cuenta === nombre).length;
    if (usos && !confirm(`"${nombre}" aparece en ${usos} registros. Si la borras, esos importes dejarán de contar en tu patrimonio. ¿Seguir?`)) return;
    if (!usos && !confirm(`¿Borrar la cuenta "${nombre}"?`)) return;
    c.cuentas.splice(i, 1);
    if (window.SolventoBoot) window.SolventoBoot.saveDoc().then(openAjustes);
  }

  function openActivoCfg(i) {
    const c = cfgEditable();
    const e = i >= 0 ? c.activos[i] : {};
    const body =
      field("a-nombre", "Nombre", input("a-nombre", "text", e.nombre, 'placeholder="Vanguard FTSE All-World"')) +
      field("a-isin", "ISIN", input("a-isin", "text", e.isin, 'placeholder="IE00BK5BQT80"')) +
      field("a-renta", "Categoría", select("a-renta", RENTAS, e.categoria || RENTAS[0])) +
      field("a-tipo", "Tipo", select("a-tipo", ACTIVO_TIPOS, e.tipo || ACTIVO_TIPOS[0])) +
      field("a-banco", "Cuenta / bróker", select("a-banco", CUENTAS(), e.banco || CUENTAS()[0])) +
      field("a-yf", "Ticker de Yahoo Finance", input("a-yf", "text", e.yf, 'placeholder="VWCE.DE"')) +
      `<div style="font-size:0.75rem;color:#6b7280;margin-top:0.5rem;">El ticker es lo que da el precio automático. Compruébalo en finance.yahoo.com y verifica que el precio se parece a lo que pagaste por unidad: un ticker equivocado infla la rentabilidad sin avisar. Déjalo vacío si el activo se valora por su valor liquidativo.</div>`;
    shell(i >= 0 ? "Editar activo" : "Nuevo activo", body, () => {
      const nombre = G("a-nombre");
      if (!nombre) return "Indica el nombre del activo";
      const rec = Object.assign({}, e, {
        nombre, isin: G("a-isin") || "-", categoria: G("a-renta"),
        tipo: G("a-tipo"), banco: G("a-banco"), yf: G("a-yf") || null,
      });
      if (i >= 0) c.activos[i] = rec; else c.activos.push(rec);
      return null;
    }, openAjustes);
  }

  function borrarActivoCfg(i) {
    const c = cfgEditable();
    const a = c.activos[i];
    if (!a || !confirm(`¿Quitar "${a.nombre}" de tus activos? Las operaciones que ya tengas registradas no se borran.`)) return;
    c.activos.splice(i, 1);
    if (window.SolventoBoot) window.SolventoBoot.saveDoc().then(openAjustes);
  }

  function openObjetivoCfg() {
    const c = cfgEditable();
    const o = c.objetivo;
    const body =
      field("o-rv", "Renta variable (%)", input("o-rv", "number", o["Renta variable"], 'step="1" min="0" max="100"')) +
      field("o-rf", "Renta fija (%)", input("o-rf", "number", o["Renta fija"], 'step="1" min="0" max="100"')) +
      `<div style="font-size:0.75rem;color:#6b7280;margin-top:0.5rem;">Es el reparto al que quieres tender. La página Cartera te muestra cuánto te desvías.</div>`;
    shell("Objetivo de asignación", body, () => {
      const rv = parseFloat(G("o-rv")), rf = parseFloat(G("o-rf"));
      if (!isFinite(rv) || !isFinite(rf)) return "Introduce ambos porcentajes";
      if (Math.abs(rv + rf - 100) > 0.01) return `Los dos deben sumar 100 % (ahora suman ${(rv + rf).toFixed(0)} %)`;
      c.objetivo = { "Renta variable": rv, "Renta fija": rf };
      return null;
    }, openAjustes);
  }

  // ── Inmueble ──
  function openInmueble(existing) {
    const doc = DB.state.doc, e = existing || {};
    const body =
      field("p-dir", "Dirección / nombre", input("p-dir", "text", e.direccion)) +
      field("p-tipo", "Tipo", datalist("p-tipo", INMUEBLE_TIPOS, e.tipo || INMUEBLE_TIPOS[0])) +
      field("p-tasacion", "Tasación / valor de mercado (€)", input("p-tasacion", "number", e.tasacion, 'step="0.01" min="0"')) +
      field("p-ftas", "Fecha de tasación", input("p-ftas", "date", toISO(e.fecha_tasacion || hoyES()))) +
      field("p-compra", "Valor de compra (€)", input("p-compra", "number", e.valor_compra, 'step="0.01" min="0"')) +
      field("p-fadq", "Fecha de adquisición", input("p-fadq", "date", toISO(e.fecha_adquisicion || hoyES()))) +
      field("p-uds", "Unidades", input("p-uds", "number", e.unidades_compra || "1", 'step="1" min="1"'));
    shell(existing ? "Editar inmueble" : "Nuevo inmueble", body, () => {
      if (!G("p-dir")) return "Indica la dirección o nombre";
      const tas = parseFloat(G("p-tasacion"));
      if (!isFinite(tas) || tas < 0) return "Introduce una tasación válida";
      upsert(doc.inmuebles, {
        id: e.id || newId("p"), direccion: G("p-dir"), tipo: G("p-tipo"),
        tasacion: G("p-tasacion"), fecha_tasacion: fromISO(G("p-ftas")),
        fecha_adquisicion: fromISO(G("p-fadq")), valor_compra: G("p-compra") || "0",
        unidades_compra: G("p-uds") || "1",
      });
      return null;
    });
  }

  // ── Valor liquidativo (NAV) de un fondo manual ──
  function openNav() {
    const doc = DB.state.doc;
    doc.nav = doc.nav || {};
    const funds = {};
    CFG.activos().forEach((a) => { if (!a.yf && a.isin && a.isin !== "-") funds[a.isin] = a.nombre; });
    (doc.inversiones || []).forEach((r) => { if (r.isin && r.isin !== "-" && !funds[r.isin]) funds[r.isin] = r.nombre; });
    Object.keys(doc.nav).forEach((isin) => { if (!funds[isin]) funds[isin] = isin; });
    const pairs = Object.keys(funds).map((isin) => [isin, funds[isin]]);
    if (!pairs.length) { window.SolventoBoot && window.SolventoBoot.toast("No hay fondos que usen NAV manual"); return; }
    const body =
      field("n-fondo", "Fondo", selectKV("n-fondo", pairs, pairs[0][0])) +
      field("n-fecha", "Fecha", input("n-fecha", "date", toISO(hoyES()))) +
      field("n-precio", "Valor liquidativo (€)", input("n-precio", "number", "", 'step="any" min="0"'));
    shell("Nuevo valor liquidativo (NAV)", body, () => {
      const isin = G("n-fondo"), precio = parseFloat(G("n-precio"));
      if (!isFinite(precio) || precio <= 0) return "Introduce un valor liquidativo válido";
      doc.nav[isin] = doc.nav[isin] || [];
      doc.nav[isin].push({ fecha: fromISO(G("n-fecha")) || hoyES(), precio: String(precio) });
      return null;
    });
  }

  // ── Borrado ──
  function del(collection, id) {
    const doc = DB.state.doc;
    doc[collection] = (doc[collection] || []).filter((m) => m.id !== id);
    if (window.SolventoBoot && window.SolventoBoot.saveDoc) window.SolventoBoot.saveDoc();
  }
  const findById = (coll, id) => (DB.state.doc[coll] || []).find((x) => x.id === id);

  window.SolventoForms = {
    openMovimiento, openInversion, openInmueble, openNav, openCuadrar, openPasivo,
    openAjustes, openCuentaCfg, borrarCuentaCfg, openActivoCfg, borrarActivoCfg, openObjetivoCfg,
    editMovimiento: (id) => openMovimiento(findById("movimientos", id)),
    editInversion: (id) => openInversion(findById("inversiones", id)),
    editInmueble: (id) => openInmueble(findById("inmuebles", id)),
    editPasivo: (id) => openPasivo(findById("pasivos", id)),
    deleteMovimiento: (id) => del("movimientos", id),
    deleteInversion: (id) => del("inversiones", id),
    deleteInmueble: (id) => del("inmuebles", id),
    deletePasivo: (id) => del("pasivos", id),
  };
})();
