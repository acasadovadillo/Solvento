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

  // ── Selector jerárquico ───────────────────────────────────────────────────
  // Una categoría es una ruta: «Vivienda > Suministros > Luz». Escribirla a mano
  // obliga a acordarse de la jerarquía entera y a teclear los «>» en su sitio, y
  // basta una tilde o un espacio de más para crear una categoría gemela que
  // luego aparece dos veces en el árbol. Aquí se elige nivel a nivel: cada
  // desplegable ofrece solo los hijos del que tiene encima, y solo se escribe
  // cuando de verdad se está creando algo nuevo.
  const SEP_RUTA = " > ";
  const partesRuta = (v) => String(v || "").split(">").map((x) => x.trim()).filter(Boolean);

  function arbolDeRutas(rutas) {
    const raiz = {};
    uniq(rutas).forEach((r) => {
      let n = raiz;
      partesRuta(r).forEach((seg) => { n = (n[seg] = n[seg] || {}); });
    });
    return raiz;
  }

  function selectorArbol(id, valor) {
    return `<div id="${id}-wrap" style="display:flex;flex-direction:column;gap:0.4rem;"></div>` +
           `<input type="hidden" id="${id}" value="${esc(valor || "")}">`;
  }

  function wireArbol(id, rutas, placeholder, nombra) {
    // Cómo se llama lo que se crea en cada nivel: una categoría tiene
    // subcategorías y un centro de coste tiene centros dentro, y el desplegable
    // debe decirlo con las palabras de cada uno.
    const comoSeLlama = nombra || ((k) => (k === 0 ? "+ Nueva categoría…" : "+ Nueva subcategoría…"));
    const arbol = arbolDeRutas(rutas);
    const hidden = document.getElementById(id), wrap = document.getElementById(id + "-wrap");
    if (!hidden || !wrap) return;
    // Lo que ya tenía el movimiento marca el camino de partida, aunque sea una
    // categoría que no esté en el catálogo: se edita lo que hay, no lo que
    // debería haber.
    let camino = partesRuta(hidden.value).map((v) => ({ valor: v, nueva: false }));

    const nodoDe = (prof) => {
      let n = arbol;
      for (let i = 0; i < prof; i++) {
        if (!n || camino[i] == null || camino[i].nueva) return null;
        n = n[camino[i].valor];
      }
      return n || null;
    };
    const sincronizar = () => {
      hidden.value = camino.map((c) => c.valor).filter(Boolean).join(SEP_RUTA);
      hidden.dispatchEvent(new Event("change", { bubbles: true }));
    };

    function pintar() {
      wrap.innerHTML = "";
      for (let k = 0; k <= camino.length; k++) {
        const padre = nodoDe(k);
        const hijos = padre ? Object.keys(padre).sort((a, b) => a.localeCompare(b, "es")) : [];
        // Siempre se ofrece un nivel más, aunque esté vacío: es la puerta para
        // colgar algo nuevo debajo. Sin ella, una categoría recién creada no
        // podría tener hijas nunca, y el árbol solo crecería a lo ancho.
        const fila = document.createElement("div");
        fila.style.cssText = "display:flex;gap:0.4rem;align-items:center;";
        const sel = document.createElement("select");
        sel.style.cssText = styleInput;
        const actual = camino[k];
        const vacio = k === 0 ? (placeholder || "— Elige —") : "— (nada más) —";
        const items = [["", vacio]].concat(hijos.map((h) => [h, h]));
        items.push(["__nueva__", comoSeLlama(k)]);
        items.forEach(([v, t]) => {
          const o = document.createElement("option");
          o.value = v; o.textContent = t;
          if (actual && (actual.nueva ? v === "__nueva__" : v === actual.valor)) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener("change", () => {
          const v = sel.value;
          camino = camino.slice(0, k);
          if (v === "__nueva__") camino.push({ valor: "", nueva: true });
          else if (v) camino.push({ valor: v, nueva: false });
          sincronizar(); pintar();
        });
        fila.appendChild(sel);
        if (actual && actual.nueva) {
          const txt = document.createElement("input");
          txt.type = "text"; txt.value = actual.valor; txt.placeholder = "nombre";
          txt.style.cssText = styleInput;
          // Se escribe sin repintar para no perder el cursor; al salir del campo
          // ya se puede colgar otro nivel debajo.
          txt.addEventListener("input", () => { camino[k].valor = txt.value.trim(); sincronizar(); });
          txt.addEventListener("change", () => { sincronizar(); pintar(); });
          fila.appendChild(txt);
        }
        wrap.appendChild(fila);
        if (actual && actual.nueva && !actual.valor) break;
      }
      const eco = document.createElement("div");
      eco.style.cssText = "font-size:0.75rem;color:#6b7280;margin-top:0.15rem;";
      eco.textContent = hidden.value || "sin asignar";
      wrap.appendChild(eco);
    }
    pintar();
  }

  // Da de alta la ruta y todas sus ramas intermedias: quien crea
  // «Mascotas > Veterinario» crea también «Mascotas», y sin ella la hija sería
  // huérfana y el árbol no sabría dónde colgarla.
  function registrarRuta(lista, ruta) {
    if (!Array.isArray(lista)) return;
    const partes = partesRuta(ruta);
    for (let i = 1; i <= partes.length; i++) {
      const acumulada = partes.slice(0, i).join(SEP_RUTA);
      if (!lista.includes(acumulada)) lista.push(acumulada);
    }
  }

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
    // Catálogo + lo que ya exista en el histórico, por si algo no está dado de alta
    const catGasto = noInv(uniq(categoriasCfg().concat((doc.movimientos || []).map((m) => m.tipo_gasto)))).sort();
    const catIngreso = noInv(uniq((doc.movimientos || []).map((m) => m.tipo_ingreso)));
    const centros = uniq(((doc.config || {}).centros || []).concat((doc.movimientos || []).map((m) => m.centro)));
    const body =
      field("m-fecha", "Fecha", input("m-fecha", "date", toISO(e.fecha || hoyES()))) +
      field("m-tipo", "Tipo", select("m-tipo", ["Gasto", "Ingreso", "Traspaso", "Préstamo"], e.tipo || "Gasto")) +
      field("m-importe", "Importe (€)", input("m-importe", "number", e.importe, 'step="0.01" min="0"')) +
      field("m-origen", "Cuenta origen", select("m-origen", CUENTAS(), e.cuenta_origen || CUENTAS()[0])) +
      field("m-destino", "Cuenta destino", select("m-destino", CUENTAS(), e.cuenta_destino || CUENTAS()[0])) +
      field("m-catg", "Categoría de gasto", selectorArbol("m-catg", e.tipo_gasto)) +
      field("m-cati", "Categoría de ingreso", selectorArbol("m-cati", e.tipo_ingreso)) +
      // El centro de coste es el segundo eje: la categoría dice QUÉ se compró y
      // el centro, PARA QUÉ o para quién. Sin él, «cuánto me cuesta Poza de la
      // Sal» solo se puede responder metiendo el destino dentro de la categoría,
      // que es justo lo que rompe la otra pregunta.
      field("m-centro", "Centro de coste", selectorArbol("m-centro", e.centro)) +
      field("m-tpres", "Tipo de préstamo", select("m-tpres", ["Dinero prestado", "Devolución"], e.tipo_prestamo || "Dinero prestado")) +
      field("m-persona", "Persona", input("m-persona", "text", e.persona_prestamo)) +
      field("m-detalle", "Detalle", input("m-detalle", "text", e.detalle));
    shell(existing ? "Editar movimiento" : "Nuevo movimiento", body, () => {
      const tipo = G("m-tipo"), importe = parseFloat(G("m-importe"));
      if (!isFinite(importe) || importe <= 0) return "Introduce un importe válido";
      // Se parte del movimiento que había, no de cero: un apunte reconstruido
      // lleva el concepto literal del banco y su referencia en el extracto, y
      // editarle el importe no puede hacer que se pierda de dónde salió.
      const rec = Object.assign({}, e, {
        id: e.id || newId("m"), marca_temporal: e.marca_temporal || new Date().toLocaleString("es-ES"),
        fecha: fromISO(G("m-fecha")) || hoyES(), tipo, importe: String(importe),
        cuenta_origen: "", cuenta_destino: "", tipo_ingreso: "", tipo_gasto: "",
        tipo_prestamo: "", persona_prestamo: "", detalle: G("m-detalle"),
      });
      const centro = G("m-centro");
      if (centro) rec.centro = centro; else delete rec.centro;
      if (tipo === "Gasto") { rec.cuenta_origen = G("m-origen"); rec.tipo_gasto = G("m-catg"); }
      else if (tipo === "Ingreso") { rec.cuenta_destino = G("m-destino"); rec.tipo_ingreso = G("m-cati"); }
      else if (tipo === "Traspaso") {
        rec.cuenta_origen = G("m-origen"); rec.cuenta_destino = G("m-destino");
        if (rec.cuenta_origen === rec.cuenta_destino) return "Origen y destino no pueden ser la misma cuenta";
      } else if (tipo === "Préstamo") {
        rec.tipo_prestamo = G("m-tpres"); rec.persona_prestamo = G("m-persona");
        if (rec.tipo_prestamo === "Dinero prestado") rec.cuenta_origen = G("m-origen"); else rec.cuenta_destino = G("m-destino");
      }
      // Lo que se crea desde aquí queda dado de alta: si no, la categoría nueva
      // solo existiría mientras exista el movimiento que la estrenó, y al
      // borrarlo desaparecería del desplegable con él.
      if (rec.tipo_gasto) registrarRuta(categoriasCfg(), rec.tipo_gasto);
      if (rec.centro) {
        doc.config = doc.config || {};
        doc.config.centros = doc.config.centros || [];
        registrarRuta(doc.config.centros, rec.centro);
      }
      upsert(doc.movimientos, rec);
      return null;
    });
    wireArbol("m-catg", catGasto, "— Elige categoría —");
    wireArbol("m-cati", catIngreso, "— Elige categoría —");
    wireArbol("m-centro", centros, "— Sin imputar —",
              (k) => (k === 0 ? "+ Nuevo centro…" : "+ Nuevo centro dentro…"));
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
      // El centro solo tiene sentido donde hay gasto o ingreso: un traspaso
      // entre cuentas propias no es de nadie, es dinero cambiándose de sitio.
      show("m-centro", t === "Gasto" || t === "Ingreso");
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
      field("i-tipo", "Operación", select("i-tipo", ["Compra", "Venta", "Traspaso", "Herencia"], e.tipo_movimiento || "Compra")) +
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


  // Fragmentos que rellena la página de Ajustes. Se devuelven como HTML para
  // que render.js los coloque en su sección, en vez de vivir en un modal.
  const refrescarAjustes = () => { if (window.v2AjPintar) window.v2AjPintar(); };

  function fragmentosAjustes() {
    const c = cfgEditable();
    const obj = c.objetivo;
    const cuentas = c.cuentas.map((x, i) => filaAjuste(
      `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${esc(x.accent || "#6b7280")};margin-right:0.4rem;"></span>${esc(x.cuenta)}`,
      [x.cartera === "cero" ? "aparece en Cartera sin efectivo propio"
                            : (x.cartera ? "agrupa posiciones en Cartera" : "")].filter(Boolean).join(" · ") || "cuenta de efectivo",
      miniBtn("✎", `v2CfgCuenta(${i})`) + miniBtn("✕", `v2CfgDelCuenta(${i})`)
    )).join("") + `<div style="margin-top:0.9rem;">${miniBtn("＋ Añadir cuenta", "v2CfgCuenta(-1)", "#3b82f6")}</div>`;

    const activos = c.activos.map((x, i) => filaAjuste(
      esc(x.nombre),
      `${esc(x.isin || "-")} · ${esc(x.banco || "")}${x.yf ? " · " + esc(x.yf) : " · sin precio automático"}`,
      miniBtn("✎", `v2CfgActivo(${i})`) + miniBtn("✕", `v2CfgDelActivo(${i})`)
    )).join("") + `<div style="margin-top:0.9rem;">${miniBtn("＋ Añadir activo", "v2CfgActivo(-1)", "#3b82f6")}</div>`;

    const objetivo = filaAjuste("Renta variable / Renta fija",
      `${(+obj["Renta variable"] || 0).toFixed(0)}% / ${(+obj["Renta fija"] || 0).toFixed(0)}%`,
      miniBtn("✎", "v2CfgObjetivo()"));

    const cats = categoriasCfg();
    const madres = uniq(cats.map(madreDe)).sort();
    const categorias = madres.map((m) => {
      const hijas = cats.filter((x) => madreDe(x) === m && hijaDe(x));
      const jsM = String(m).replace(/'/g, "\\'");
      const filasHijas = hijas.map((h) => {
        const jsH = String(h).replace(/'/g, "\\'");
        return `<div style="display:flex;align-items:center;gap:0.5rem;padding:0.35rem 0 0.35rem 1.4rem;border-bottom:1px solid #1e222c;">
          <div style="flex:1;color:#9ca3af;font-size:0.84rem;">${esc(hijaDe(h))}</div>${miniBtn("✕", `v2CatBorrar('${jsH}')`)}</div>`;
      }).join("");
      return `<div style="padding:0.5rem 0;border-bottom:1px solid #232733;">
        <div style="display:flex;align-items:center;gap:0.5rem;">
          <div style="flex:1;color:#e5e7eb;font-weight:600;font-size:0.9rem;">${esc(m)}</div>
          ${miniBtn("＋ sub", `v2CatNueva('${jsM}')`, "#3b82f6")}${miniBtn("✕", `v2CatBorrar('${jsM}')`)}</div>
        ${filasHijas}</div>`;
    }).join("") + `<div style="margin-top:0.9rem;">${miniBtn("＋ Añadir categoría", "v2CatNueva('')", "#3b82f6")}</div>`;

    return { cuentas, activos, objetivo, categorias };
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
    }, refrescarAjustes);
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
    if (window.SolventoBoot) window.SolventoBoot.saveDoc().then(refrescarAjustes);
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
    }, refrescarAjustes);
  }

  function borrarActivoCfg(i) {
    const c = cfgEditable();
    const a = c.activos[i];
    if (!a || !confirm(`¿Quitar "${a.nombre}" de tus activos? Las operaciones que ya tengas registradas no se borran.`)) return;
    c.activos.splice(i, 1);
    if (window.SolventoBoot) window.SolventoBoot.saveDoc().then(refrescarAjustes);
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
    }, refrescarAjustes);
  }

  // ── Categorías de gasto (con subcategorías) ──────────────────────────
  // Se guardan como lista de textos completos: "Educación" o
  // "Educación > Formaciones". Mantener ese formato evita migrar nada: lo que
  // ya escribiste sigue funcionando y el catálogo solo sirve para ofrecértelo
  // ordenado al registrar, en vez de escribirlo a mano cada vez.
  function categoriasCfg() {
    const doc = DB.state.doc;
    if (!doc.config) doc.config = {};
    if (!doc.config.categorias) {
      // Se siembra con lo que ya venías usando
      doc.config.categorias = uniq((doc.movimientos || [])
        .map((m) => m.tipo_gasto)
        .filter((c) => c && String(c).trim().toLowerCase() !== "inversiones")).sort();
    }
    return doc.config.categorias;
  }
  const madreDe = (c) => { const i = String(c).indexOf(">"); return i < 0 ? String(c).trim() : String(c).slice(0, i).trim(); };
  const hijaDe  = (c) => { const i = String(c).indexOf(">"); return i < 0 ? null : String(c).slice(i + 1).trim(); };


  function openCategoriaNueva(madre) {
    const cats = categoriasCfg();
    const body =
      (madre ? `<div style="font-size:0.8rem;color:#9ca3af;margin:0.5rem 0 0;">Subcategoría dentro de <b style="color:#fff;">${esc(madre)}</b></div>` : "") +
      field("k-nombre", madre ? "Nombre de la subcategoría" : "Nombre de la categoría",
            input("k-nombre", "text", "", madre ? 'placeholder="Formaciones"' : 'placeholder="Educación"'));
    shell(madre ? "Nueva subcategoría" : "Nueva categoría", body, () => {
      const n = G("k-nombre");
      if (!n) return "Escribe un nombre";
      if (n.includes(">")) return 'El nombre no puede llevar el símbolo ">"';
      const completa = madre ? `${madre} > ${n}` : n;
      if (cats.some((c) => c.toLowerCase() === completa.toLowerCase())) return "Esa categoría ya existe";
      cats.push(completa);
      cats.sort();
      return null;
    }, refrescarAjustes);
  }

  function borrarCategoriaCfg(cat) {
    const doc = DB.state.doc;
    const cats = categoriasCfg();
    const usos = (doc.movimientos || []).filter((m) => m.tipo_gasto === cat || madreDe(m.tipo_gasto || "") === cat).length;
    const aviso = usos
      ? `"${cat}" se usa en ${usos} movimiento${usos === 1 ? "" : "s"}. Quitarla del catálogo no los cambia: seguirán con esa categoría. ¿Seguir?`
      : `¿Quitar "${cat}" del catálogo?`;
    if (!confirm(aviso)) return;
    // Al borrar una madre se van con ella sus subcategorías del catálogo
    doc.config.categorias = cats.filter((c) => c !== cat && madreDe(c) !== cat);
    if (window.SolventoBoot) window.SolventoBoot.saveDoc().then(refrescarAjustes);
  }

  // ── Objetivos de la regla 50/30/20 ──
  function openRegla() {
    const doc = DB.state.doc;
    if (!doc.config) doc.config = {};
    const r = doc.config.regla || CFG_MODELO().REGLA_DEFECTO;
    const body =
      field("r-nec", "Necesario (%)", input("r-nec", "number", r.necesario, 'step="1" min="0" max="100"')) +
      field("r-des", "Deseos (%)", input("r-des", "number", r.deseo, 'step="1" min="0" max="100"')) +
      field("r-aho", "Ahorro e inversión (%)", input("r-aho", "number", r.ahorro, 'step="1" min="0" max="100"')) +
      `<div style="font-size:0.75rem;color:#6b7280;margin-top:0.5rem;">El reparto clásico es 50/30/20, pero puedes ajustarlo a lo que te encaje. Los tres deben sumar 100.</div>`;
    shell("Objetivos del reparto", body, () => {
      const n = parseFloat(G("r-nec")), d = parseFloat(G("r-des")), a = parseFloat(G("r-aho"));
      if (![n, d, a].every(isFinite)) return "Introduce los tres porcentajes";
      if (Math.abs(n + d + a - 100) > 0.01) return `Los tres deben sumar 100 % (ahora suman ${(n + d + a).toFixed(0)} %)`;
      doc.config.regla = { necesario: n, deseo: d, ahorro: a };
      return null;
    });
  }
  const CFG_MODELO = () => window.SolventoModel;

  // ── Presupuesto por categoría ──
  // Un tope mensual para una categoría de gasto. Se guarda con el resto de tu
  // configuración, así que viaja contigo a cualquier dispositivo.
  function openPresupuesto(cat) {
    const doc = DB.state.doc;
    if (!doc.config) doc.config = {};
    if (!doc.config.presupuesto) doc.config.presupuesto = {};
    const actual = doc.config.presupuesto[cat];
    const body =
      field("g-tope", `Tope mensual para "${esc(cat)}" (€)`, input("g-tope", "number", actual, 'step="1" min="0" placeholder="300"')) +
      `<div style="font-size:0.75rem;color:#6b7280;margin-top:0.5rem;">Cuando el gasto del mes supere este tope, la categoría se marca en rojo. Déjalo vacío para quitar el presupuesto.</div>`;
    shell("Presupuesto", body, () => {
      const v = G("g-tope");
      if (v === "") delete doc.config.presupuesto[cat];
      else {
        const n = parseFloat(v);
        if (!isFinite(n) || n < 0) return "Introduce un importe válido";
        doc.config.presupuesto[cat] = n;
      }
      return null;
    });
  }

  // ── Cambiar la contraseña ──
  function openPassword() {
    const body =
      `<div style="background:#3f2d0a;border:1px solid #a16207;border-radius:10px;padding:0.7rem 0.9rem;font-size:0.8rem;color:#fbbf24;margin:0.5rem 0 0.25rem;">
         Antes de seguir, exporta una copia cifrada (🔄 → Exportar copia). Si algo va mal, es tu única red de seguridad.
       </div>` +
      field("pw-actual", "Contraseña actual", input("pw-actual", "password", "", 'autocomplete="current-password"')) +
      field("pw-nueva", "Contraseña nueva", input("pw-nueva", "password", "", 'autocomplete="new-password"')) +
      field("pw-nueva2", "Repite la nueva", input("pw-nueva2", "password", "", 'autocomplete="new-password"')) +
      `<div style="font-size:0.75rem;color:#6b7280;margin-top:0.5rem;">Tus datos se descifran con la actual y se vuelven a cifrar con la nueva. Tendrás que usar la nueva en <b>todos</b> tus dispositivos, también en el móvil.</div>`;
    shell("Cambiar contraseña", body, () => {
      const actual = document.getElementById("pw-actual").value;
      const n1 = document.getElementById("pw-nueva").value;
      const n2 = document.getElementById("pw-nueva2").value;
      if (!actual) return "Escribe tu contraseña actual";
      if (n1.length < 6) return "La nueva debe tener al menos 6 caracteres";
      if (n1 !== n2) return "Las dos nuevas no coinciden";
      if (n1 === actual) return "La nueva es igual que la actual";
      // El cambio real es asíncrono: se lanza aquí y se informa por aviso
      window.SolventoBoot.cambiarPassword(actual, n1).then((r) => {
        window.SolventoBoot.toast(
          r.subido ? "Contraseña cambiada y subida ✓ · úsala ya en todos tus dispositivos"
                   : "Contraseña cambiada en este dispositivo · pendiente de subir: los demás seguirán pidiendo la anterior",
          r.subido ? "#10b981" : "#fbbf24");
      }).catch((e) => {
        window.SolventoBoot.toast(e.code === "ACTUAL" ? "La contraseña actual no es correcta" : ("No se pudo cambiar: " + e.message), "#ef4444");
      });
      return null;
    });
  }

  // ── Inmueble ──
  function openPropiedad(existing) {
    const doc = DB.state.doc, e = existing || {};
    if (!Array.isArray(doc.propiedades)) doc.propiedades = doc.inmuebles || [];
    const tipos = Object.keys(CFG.TIPO_COLORES_INMUEBLE);
    const body =
      field("p-nombre", "Nombre o dirección", input("p-nombre", "text", e.nombre || e.direccion, 'placeholder="Reloj Omega Seamaster"')) +
      field("p-tipo", "Tipo", select("p-tipo", tipos, e.tipo || tipos[0])) +
      `<div id="p-porpeso" style="display:none;">
        ${field("p-metal", "Metal", selectKV("p-metal", [["oro", "Oro"], ["plata", "Plata"]], String(e.metal || "oro")))}
        ${field("p-peso", "Peso (gramos)", input("p-peso", "number", e.peso_g, 'step="0.01" min="0" placeholder="31.1"'))}
        <div style="font-size:0.75rem;color:#6b7280;margin-top:0.4rem;">El valor se calcula solo con el precio del metal, que se actualiza a diario.</div>
      </div>` +
      `<div id="p-portasacion">
        ${field("p-valor", "Valor actual (€)", input("p-valor", "number", e.valor != null ? e.valor : e.tasacion, 'step="0.01" min="0"'))}
      </div>` +
      field("p-compra", "Valor de compra (€)", input("p-compra", "number", e.valor_compra, 'step="0.01" min="0"')) +
      field("p-fecha", "Fecha de adquisición", input("p-fecha", "date", toISO(e.fecha_adquisicion))) +
      `<label style="display:flex;gap:0.5rem;align-items:center;font-size:0.85rem;color:#9ca3af;margin-top:0.9rem;cursor:pointer;">
         <input type="checkbox" id="p-alq" ${e.alquilada ? "checked" : ""}> Está alquilada</label>` +
      // El centro de coste es lo que une la ficha con la contabilidad: sin él,
      // los recibos de la comunidad y el alquiler cobrado están en los datos
      // pero no hay forma de saber que son de ESTE piso.
      field("p-centro", "Centro de coste", selectorArbol("p-centro", e.centro)) +
      `<div id="p-alquiler" style="display:none;">
        ${field("p-renta", "Renta mensual (€)", input("p-renta", "number", e.renta_mensual, 'step="0.01" min="0"'))}
        ${field("p-gastos", "Gastos mensuales (€)", input("p-gastos", "number", e.gastos_mensuales, 'step="0.01" min="0" placeholder="comunidad, IBI, seguro…"'))}
        <div style="font-size:0.75rem;color:#6b7280;margin-top:0.4rem;">Con esto calculo la rentabilidad del alquiler sobre lo que pagaste.</div>
      </div>`;
    shell(existing ? "Editar propiedad" : "Nueva propiedad", body, () => {
      const nombre = G("p-nombre");
      if (!nombre) return "Indica el nombre o la dirección";
      const tipo = G("p-tipo");
      const porPeso = CFG.TIPOS_POR_PESO.includes(tipo);
      // Se parte de lo que había, como en los movimientos: editar el valor de
      // una propiedad no puede borrarle campos que este formulario no enseña.
      const rec = Object.assign({}, e, {
        id: e.id || newId("p"), nombre, tipo,
        valor_compra: G("p-compra"), fecha_adquisicion: fromISO(G("p-fecha")),
        alquilada: document.getElementById("p-alq").checked,
        renta_mensual: G("p-renta"), gastos_mensuales: G("p-gastos"),
      });
      const centro = G("p-centro");
      if (centro) rec.centro = centro; else delete rec.centro;
      if (rec.centro) {
        doc.config = doc.config || {};
        doc.config.centros = doc.config.centros || [];
        registrarRuta(doc.config.centros, rec.centro);
      }
      if (porPeso) {
        const peso = parseFloat(G("p-peso"));
        if (!isFinite(peso) || peso <= 0) return "Introduce el peso en gramos";
        rec.metal = G("p-metal"); rec.peso_g = String(peso);
      } else {
        const v = parseFloat(G("p-valor"));
        if (!isFinite(v) || v < 0) return "Introduce un valor válido";
        rec.valor = String(v);
      }
      if (rec.alquilada && !(parseFloat(rec.renta_mensual) > 0)) return "Indica la renta mensual del alquiler";
      upsert(doc.propiedades, rec);
      return null;
    });
    // Los campos se muestran según lo que hayas elegido
    const refrescar = () => {
      const porPeso = CFG.TIPOS_POR_PESO.includes(document.getElementById("p-tipo").value);
      document.getElementById("p-porpeso").style.display = porPeso ? "block" : "none";
      document.getElementById("p-portasacion").style.display = porPeso ? "none" : "block";
      document.getElementById("p-alquiler").style.display = document.getElementById("p-alq").checked ? "block" : "none";
    };
    // Se ofrecen los centros que ya existen, con los de inmuebles delante por ser
    // los únicos que tienen sentido aquí, pero sin impedir crear uno nuevo.
    const centros = uniq(((doc.config || {}).centros || [])
      .concat((doc.movimientos || []).map((m) => m.centro))
      .concat((doc.propiedades || []).map((r) => r.centro)));
    wireArbol("p-centro", centros, "— Sin imputar —",
              (k) => (k === 0 ? "+ Nuevo centro…" : "+ Nuevo centro dentro…"));
    document.getElementById("p-tipo").addEventListener("change", refrescar);
    document.getElementById("p-alq").addEventListener("change", refrescar);
    refrescar();
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
    openMovimiento, openInversion, openPropiedad, openNav, openCuadrar, openPasivo,
    fragmentosAjustes, openPresupuesto, openRegla, openPassword, openCategoriaNueva, borrarCategoriaCfg, openCuentaCfg, borrarCuentaCfg, openActivoCfg, borrarActivoCfg, openObjetivoCfg,
    editMovimiento: (id) => openMovimiento(findById("movimientos", id)),
    editInversion: (id) => openInversion(findById("inversiones", id)),
    editPropiedad: (id) => openPropiedad(findById("propiedades", id) || findById("inmuebles", id)),
    editPasivo: (id) => openPasivo(findById("pasivos", id)),
    deleteMovimiento: (id) => del("movimientos", id),
    deleteInversion: (id) => del("inversiones", id),
    deletePropiedad: (id) => del("propiedades", id),
    deletePasivo: (id) => del("pasivos", id),
  };
})();
