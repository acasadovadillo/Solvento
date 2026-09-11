/*
 * Solvento — Formularios para registrar/editar desde la web (Fase 4/4b).
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
  // Para los avisos de confirmación: aquí no hace falta la maquinaria de render.
  const eur = (x) => (Number(String(x).replace(",", ".")) || 0)
    .toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  const uniq = (arr) => Array.from(new Set(arr.filter((x) => x && String(x).trim())));
  const absStr = (v) => { const n = Math.abs(parseFloat(v)); return isFinite(n) ? String(n) : ""; };

  function ensureModal() {
    let m = document.getElementById("form-modal");
    if (m) return m;
    m = document.createElement("div");
    m.id = "form-modal";
    m.style.cssText = "display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:1200;align-items:center;justify-content:center;padding:1.5rem;";
    m.innerHTML = '<div class="modal-card" style="background:var(--f2);border:1px solid var(--b1);border-radius:14px;padding:1.5rem;width:100%;max-width:480px;max-height:90vh;overflow-y:auto;"></div>';
    m.addEventListener("mousedown", (e) => { if (e.target === m) close(); });
    document.body.appendChild(m);
    return m;
  }
  function close() { const m = document.getElementById("form-modal"); if (m) m.style.display = "none"; }

  const styleInput = "width:100%;background:var(--f1);border:1px solid var(--b2);border-radius:10px;color:var(--t1);font-size:0.9rem;padding:0.6rem 0.8rem;outline:none;font-family:inherit;";
  const styleLabel = "display:block;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:var(--t2);font-weight:700;margin:0.85rem 0 0.3rem;";
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
      eco.style.cssText = "font-size:0.75rem;color:var(--t2);margin-top:0.15rem;";
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

  // En modo lectura los formularios ni se abren: es más honesto que dejar
  // rellenar uno entero para decir al final que no se guarda nada.
  function soloLectura() {
    const B = window.SolventoBoot;
    if (B && B.esInvitado && B.esInvitado()) { B.avisoLectura(); return true; }
    return false;
  }

  // Devuelve true si el formulario llegó a abrirse: quien tenga que cablear algo
  // después (los selectores de árbol) necesita saber que hay a qué agarrarse.
  function shell(titulo, bodyHtml, onSubmit, despues) {
    if (soloLectura()) return false;
    const m = ensureModal();
    m.querySelector(".modal-card").innerHTML =
      `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
        <div style="font-size:1.1rem;font-weight:800;color:var(--t0);">${esc(titulo)}</div>
        <button id="ff-close" style="border:none;background:none;color:var(--t1b);font-size:1.1rem;cursor:pointer;">✕</button>
      </div>
      <form id="ff-form">${bodyHtml}
        <div id="ff-error" style="display:none;color:var(--rojo);font-size:0.82rem;font-weight:600;margin-top:0.75rem;"></div>
        <button type="submit" class="primary" style="width:100%;margin-top:1.25rem;background:var(--primario-bg);color:var(--primario-t);border:none;border-radius:10px;font-size:0.92rem;font-weight:700;padding:0.7rem;cursor:pointer;font-family:inherit;">Guardar</button>
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
    return true;
  }
  const G = (id) => document.getElementById(id).value.trim();
  const upsert = (arr, rec) => { const i = arr.findIndex((x) => x.id === rec.id); if (i >= 0) arr[i] = rec; else arr.push(rec); };

  // ── Movimiento ──
  function openMovimiento(existing, antesDeGuardar) {
    if (soloLectura()) return;
    const doc = DB.state.doc, e = existing || {};
    // Una tarjeta de crédito no es una cuenta, pero sus compras salen de ella y
    // hay que poder elegirla. Y si el movimiento viene de un sitio que ya no
    // está en ninguna lista, se añade también: el desplegable enseñaba la
    // primera opción y al guardar la escribía encima, así que abrir un apunte
    // para cambiarle la categoría le cambiaba la cuenta sin decir nada.
    const donde = uniq(CUENTAS()
      .concat((doc.pasivos || []).map((d) => d.nombre || d.concepto))
      .concat([e.cuenta_origen, e.cuenta_destino]));
    // "Inversiones" ya no es una categoría de movimiento (las compras se
    // registran como operaciones, que mueven el efectivo solas).
    const noInv = (arr) => arr.filter((c) => String(c).trim().toLowerCase() !== "inversiones");
    // Catálogo + lo que ya exista en el histórico, por si algo no está dado de alta
    const catGasto = noInv(uniq(categoriasCfg().concat((doc.movimientos || []).map((m) => m.tipo_gasto)))).sort();
    const catIngreso = noInv(uniq(categoriasIngresoCfg().concat((doc.movimientos || []).map((m) => m.tipo_ingreso)))).sort();
    const centros = uniq(((doc.config || {}).centros || []).concat((doc.movimientos || []).map((m) => m.centro)));
    const body =
      field("m-fecha", "Fecha", input("m-fecha", "date", toISO(e.fecha || hoyES()))) +
      field("m-tipo", "Tipo", select("m-tipo", ["Gasto", "Ingreso", "Traspaso", "Préstamo"], e.tipo || "Gasto")) +
      field("m-importe", "Importe (€)", input("m-importe", "number", e.importe, 'step="0.01" min="0"')) +
      field("m-origen", "Cuenta origen", select("m-origen", donde, e.cuenta_origen || donde[0])) +
      field("m-destino", "Cuenta destino", select("m-destino", donde, e.cuenta_destino || donde[0])) +
      // El recibo de una tarjeta se registra aquí, como un traspaso más, y hasta
      // ahora se guardaba a ciegas: si el importe no era exactamente lo que la
      // tarjeta debía, la deuda quedaba arrastrando un resto y nadie se enteraba
      // hasta mirar el acumulado meses después. Este panel lo dice mientras se
      // escribe, y ofrece la cifra exacta.
      `<div id="m-liq"></div>` +
      field("m-catg", "Categoría de gasto", selectorArbol("m-catg", e.tipo_gasto)) +
      field("m-cati", "Categoría de ingreso", selectorArbol("m-cati", e.tipo_ingreso)) +
      // El centro de coste es el segundo eje: la categoría dice QUÉ se compró y
      // el centro, PARA QUÉ o para quién. Sin él, «cuánto me cuesta Poza de la
      // Sal» solo se puede responder metiendo el destino dentro de la categoría,
      // que es justo lo que rompe la otra pregunta.
      field("m-centro", "Centro de coste", selectorArbol("m-centro", e.centro)) +
      field("m-tpres", "Tipo de préstamo", select("m-tpres", ["Dinero prestado", "Devolución", "Incobrable"], e.tipo_prestamo || "Dinero prestado")) +
      field("m-persona", "Persona", input("m-persona", "text", e.persona_prestamo)) +
      field("m-detalle", "Detalle", input("m-detalle", "text", e.detalle)) +
      // Lo que dijo el banco, tal cual, y dónde estaba. Tu redacción explica QUÉ
      // fue; esto prueba de dónde salió, y hasta ahora había que abrir el PDF
      // del extracto para verlo. No se puede editar a propósito: es la fuente.
      ((e.detalle_banco || e.imp_ref)
        ? `<div style="background:var(--f1);border:1px solid var(--b1);border-radius:10px;
                 padding:0.6rem 0.8rem;margin-top:0.9rem;">
             <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--t3);font-weight:700;">Según el banco</div>
             ${e.detalle_banco ? `<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:0.78rem;color:var(--t1b);margin-top:0.3rem;word-break:break-word;">${esc(e.detalle_banco)}</div>` : ""}
             ${e.imp_ref ? `<div style="font-size:0.7rem;color:var(--t3);margin-top:0.3rem;">Extracto: ${esc(e.imp_ref)}</div>` : ""}
           </div>`
        : "");
    shell(e.id ? "Editar movimiento" : "Nuevo movimiento", body, () => {
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
        // Un incobrable no mueve dinero: cierra el saldo y ya. Por eso no lleva
        // cuenta, y por eso ni los saldos ni la serie lo tienen en cuenta.
        if (rec.tipo_prestamo === "Dinero prestado") rec.cuenta_origen = G("m-origen");
        else if (rec.tipo_prestamo === "Devolución") rec.cuenta_destino = G("m-destino");
      }
      // Lo que se crea desde aquí queda dado de alta: si no, la categoría nueva
      // solo existiría mientras exista el movimiento que la estrenó, y al
      // borrarlo desaparecería del desplegable con él.
      if (rec.tipo_gasto) registrarRuta(categoriasCfg(), rec.tipo_gasto);
      if (rec.tipo_ingreso) registrarRuta(categoriasIngresoCfg(), rec.tipo_ingreso);
      if (rec.centro) {
        doc.config = doc.config || {};
        doc.config.centros = doc.config.centros || [];
        registrarRuta(doc.config.centros, rec.centro);
      }
      upsert(doc.movimientos, rec);
      // Un gancho para quien abrió el formulario por algo: cobrar un pendiente
      // crea el ingreso y cierra la línea, y las dos cosas tienen que viajar en
      // el mismo guardado o una podría subir sin la otra.
      if (antesDeGuardar) antesDeGuardar(rec);
      return null;
    });
    wireArbol("m-catg", catGasto, "— Elige categoría —");
    wireArbol("m-cati", catIngreso, "— Elige categoría —");
    wireArbol("m-centro", centros, "— Sin imputar —",
              (k) => (k === 0 ? "+ Nuevo centro…" : "+ Nuevo centro dentro…"));
    wireMovVisibility();
    wireLiquidacion(doc, e);
  }

  // ── La liquidación de una tarjeta, mientras se escribe ────────────────────
  // Un traspaso cuyo destino es una tarjeta de crédito no es un traspaso normal:
  // no cambia dinero de bolsillo, paga una deuda. Aquí se comprueba lo único que
  // hay que comprobar —que el importe sea lo que la tarjeta debe ese día— y se
  // enseña de dónde sale esa cifra. Vale para cualquier tarjeta: la lista sale
  // de los pasivos, no de un nombre escrito en el código.
  function wireLiquidacion(doc, e) {
    const caja = document.getElementById("m-liq");
    if (!caja) return;
    const M = window.SolventoModel;
    const el = (id) => document.getElementById(id);
    const tarjetas = M.tarjetas(doc);

    function pintar() {
      const r = M.revisarLiquidacion(doc, {
        id: e.id, tipo: el("m-tipo").value, importe: el("m-importe").value,
        fecha: fromISO(el("m-fecha").value), cuenta_destino: el("m-destino").value,
      });
      if (!r) { caja.innerHTML = ""; return; }
      const sin = !r.importe;
      // Verde cuando la deja a cero; ámbar cuando no, con la diferencia exacta:
      // esa cifra es la que se va a buscar al extracto.
      const c = sin ? "var(--t2)" : (r.cuadra ? "var(--verde)" : "var(--ambar)");
      const veredicto = sin
        ? "Escribe el importe del recibo."
        : r.cuadra
          ? "✓ Cuadra: deja la tarjeta a 0,00 €."
          : (r.diferencia > 0 ? "Sobran " : "Faltan ") + eur(Math.abs(r.diferencia)) +
            ". La tarjeta quedaría en " + eur(r.saldoDespues) + ".";
      const origen = el("m-origen").value;
      caja.innerHTML = `<div style="border:1px solid color-mix(in srgb, ${c} 33%, transparent);background:color-mix(in srgb, ${c} 7%, transparent);border-radius:10px;padding:0.7rem 0.85rem;margin-top:0.9rem;">
        <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.05em;color:${c};font-weight:700;">
          Liquidación de ${esc(r.tarjeta.nombre)}</div>
        <div style="font-size:0.82rem;color:var(--t1);margin-top:0.35rem;">
          Pendiente el ${esc(fromISO(el("m-fecha").value) || "ese día")}:
          <b>${esc(eur(r.pendiente))}</b></div>
        <div style="font-size:0.74rem;color:var(--t2);margin-top:0.2rem;">
          ${r.n} ${r.n === 1 ? "cargo" : "cargos"} por ${esc(eur(r.cargado))}${
            Math.abs(r.arrastre) > 0.005
              ? ` · ${r.arrastre > 0 ? "arrastra" : "a favor"} ${esc(eur(Math.abs(r.arrastre)))} del ciclo anterior`
              : ""}</div>
        <div style="font-size:0.8rem;color:${c};font-weight:600;margin-top:0.45rem;">${esc(veredicto)}</div>
        ${!r.cuadra && r.pendiente > 0
          ? `<button type="button" id="m-liq-usar" style="margin-top:0.55rem;background:none;border:1px solid ${c};
               border-radius:8px;color:${c};font-size:0.76rem;font-weight:600;font-family:inherit;
               padding:0.3rem 0.65rem;cursor:pointer;">Usar ${esc(eur(r.pendiente))}</button>`
          : ""}
        ${r.tarjeta.cuenta && origen !== r.tarjeta.cuenta
          ? `<div style="font-size:0.74rem;color:var(--ambar);margin-top:0.45rem;">
               Esta tarjeta se cobra en <b>${esc(r.tarjeta.cuenta)}</b>, y el origen dice ${esc(origen || "—")}.</div>`
          : ""}</div>`;
      const usar = el("m-liq-usar");
      if (usar) usar.addEventListener("click", () => { el("m-importe").value = r.pendiente; pintar(); });
    }

    // Elegir la tarjeta ya dice por dónde se cobra: el origen se rellena solo.
    el("m-destino").addEventListener("change", () => {
      const t = tarjetas.find((x) => x.nombre === el("m-destino").value);
      const o = el("m-origen");
      if (t && t.cuenta && Array.from(o.options).some((x) => x.value === t.cuenta)) o.value = t.cuenta;
      pintar();
    });
    ["m-tipo", "m-importe", "m-fecha", "m-origen"].forEach((id) =>
      el(id).addEventListener("input", pintar));
    el("m-tipo").addEventListener("change", pintar);
    pintar();
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
    if (soloLectura()) return;
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
      `<div style="font-size:0.85rem;color:var(--t1b);margin:0.5rem 0 0.25rem;">Saldo según Solvento: <b style="color:var(--t0);">${saldoActual.toFixed(2).replace(".", ",")} €</b></div>` +
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
  const TARJETA = "Tarjeta de crédito";
  const PASIVO_TIPOS = ["Hipoteca", "Préstamo personal", "Préstamo coche",
                        TARJETA, "Deuda con particular", "Otro"];
  function openPasivo(existing) {
    const doc = DB.state.doc, e = existing || {};
    if (!Array.isArray(doc.pasivos)) doc.pasivos = [];
    const body =
      field("d-nombre", "Concepto", input("d-nombre", "text", e.nombre, 'placeholder="Hipoteca de la vivienda"')) +
      field("d-tipo", "Tipo", select("d-tipo", PASIVO_TIPOS, e.tipo || PASIVO_TIPOS[0])) +
      field("d-entidad", "Entidad", datalist("d-entidad", CUENTAS(), e.entidad)) +
      // Por dónde se cobra. En una tarjeta no es un dato de adorno: es lo que
      // permite que el recibo del mes sepa de qué cuenta sale el dinero, y que
      // mañana una tarjeta de otro banco funcione igual sin tocar nada.
      field("d-cuenta", "Cuenta de cargo", selectKV("d-cuenta",
        [["", "— Ninguna —"]].concat(CUENTAS().map((c) => [c, c])), e.cuenta || "")) +
      field("d-importe", "Pendiente de pagar (€)", input("d-importe", "number", e.importe, 'step="0.01" min="0" placeholder="120000"')) +
      `<div class="ff-nota" id="d-nota" style="font-size:0.75rem;color:var(--t2);margin-top:0.5rem;">Anota lo que <b>te queda por pagar</b> hoy, no el importe original. Se descuenta de tu patrimonio neto.</div>`;
    shell(existing ? "Editar deuda" : "Nueva deuda", body, () => {
      const nombre = G("d-nombre");
      if (!nombre) return "Indica el concepto de la deuda";
      const tipo = G("d-tipo");
      const importe = parseFloat(G("d-importe"));
      // Una tarjeta no lleva su saldo escrito a mano: lo dicen sus compras y sus
      // recibos, y cada mes es otro. Escribirlo aquí sería congelarlo.
      const calculada = tipo === TARJETA && !isFinite(importe);
      if (!calculada && (!isFinite(importe) || importe <= 0)) return "Introduce el importe pendiente";
      const rec = {
        id: e.id || newId("d"), nombre, tipo,
        entidad: G("d-entidad"), cuenta: G("d-cuenta"),
      };
      if (!calculada) rec.importe = String(importe);
      upsert(doc.pasivos, rec);
      return null;
    });
    wirePasivoVisibility();
  }
  // El formulario cambia de sentido según el tipo: una hipoteca se declara y una
  // tarjeta se calcula sola.
  function wirePasivoVisibility() {
    const tipoEl = document.getElementById("d-tipo");
    if (!tipoEl) return;
    const impEl = document.getElementById("d-importe");
    const nota = document.getElementById("d-nota");
    const lbl = document.querySelector('.ff[data-for="d-importe"] label');
    const cuenta = document.querySelector('.ff[data-for="d-cuenta"]');
    function upd() {
      const t = tipoEl.value === TARJETA;
      if (cuenta) cuenta.style.display = t ? "" : "none";
      if (lbl) lbl.textContent = t ? "Pendiente de pagar (€) — opcional" : "Pendiente de pagar (€)";
      if (impEl) impEl.placeholder = t ? "Déjalo vacío: se calcula solo" : "120000";
      if (nota) {
        nota.innerHTML = t
          ? `Déjalo <b>vacío</b> y el saldo lo calculan sus movimientos: cada compra suma y cada recibo la salda.
             La <b>cuenta de cargo</b> es de donde sale el dinero el día del recibo.`
          : `Anota lo que <b>te queda por pagar</b> hoy, no el importe original. Se descuenta de tu patrimonio neto.`;
      }
    }
    tipoEl.addEventListener("change", upd); upd();
  }
  // ── Cobro pendiente ──
  // Lo que te deben y todavía no ha entrado: una cuota de alquiler a medias, un
  // trabajo facturado sin cobrar. No se apunta como movimiento porque el dinero
  // no se ha movido; se apunta aquí y, cuando llegue, se convierte en ingreso.
  function openCobro(existing) {
    if (soloLectura()) return;
    const doc = DB.state.doc, e = existing || {};
    if (!Array.isArray(doc.cobros)) doc.cobros = [];
    const personas = uniq((doc.cobros || []).map((c) => c.persona)
      .concat((doc.movimientos || []).map((m) => m.persona_prestamo)).filter(Boolean));
    const catIngreso = uniq(categoriasIngresoCfg().concat((doc.movimientos || []).map((m) => m.tipo_ingreso)));
    const centros = uniq(((doc.config || {}).centros || []).concat((doc.movimientos || []).map((m) => m.centro)));
    const body =
      field("c-persona", "Quién te lo debe", datalist("c-persona", personas, e.persona)) +
      field("c-concepto", "Concepto", input("c-concepto", "text", e.concepto, 'placeholder="Parte de la cuota de julio"')) +
      field("c-importe", "Importe pendiente (€)", input("c-importe", "number", e.importe, 'step="0.01" min="0"')) +
      field("c-fecha", "Desde cuándo", input("c-fecha", "date", toISO(e.fecha || hoyES()))) +
      field("c-cat", "Categoría de ingreso", selectorArbol("c-cat", e.categoria)) +
      field("c-centro", "Centro de coste", selectorArbol("c-centro", e.centro)) +
      `<div style="font-size:0.75rem;color:var(--t2);margin-top:0.5rem;">
         Esto <b>no toca tu caja ni tu patrimonio</b>: el dinero no ha entrado todavía. La categoría y el
         centro son los que llevará el ingreso el día que lo cobres.</div>`;
    if (!shell(existing ? "Editar cobro pendiente" : "Nuevo cobro pendiente", body, () => {
      const importe = parseFloat(G("c-importe"));
      if (!isFinite(importe) || importe <= 0) return "Introduce el importe que te deben";
      const persona = G("c-persona");
      if (!persona) return "Indica quién te lo debe";
      upsert(doc.cobros, {
        id: e.id || newId("c"), persona, concepto: G("c-concepto"),
        importe: String(importe), fecha: fromISO(G("c-fecha")) || hoyES(),
        categoria: G("c-cat"), centro: G("c-centro"),
      });
      return null;
    })) return;
    wireArbol("c-cat", catIngreso, "— Elige categoría —");
    wireArbol("c-centro", centros, "— Sin imputar —",
              (k) => (k === 0 ? "+ Nuevo centro…" : "+ Nuevo centro dentro…"));
  }

  // Cobrarlo es crear el ingreso de verdad —con su fecha, su cuenta, su
  // categoría y su centro— y cerrar la línea. Se abre el formulario de siempre
  // con todo puesto: lo único que hay que decir es en qué cuenta entró.
  function cobrarCobro(id) {
    if (soloLectura()) return;
    const doc = DB.state.doc;
    const c = (doc.cobros || []).find((x) => x.id === id);
    if (!c) return;
    openMovimiento({
      tipo: "Ingreso", importe: c.importe, fecha: hoyES(),
      detalle: c.concepto ? `${c.concepto} · ${c.persona}` : `Cobro de ${c.persona}`,
      tipo_ingreso: c.categoria || "", centro: c.centro || "",
    }, () => {
      doc.cobros = (doc.cobros || []).filter((x) => x.id !== id);
    });
  }

  // Dar algo por incobrable no lo borra: lo aparta. Deja de contar en tu
  // patrimonio —que es el efecto real de no ir a cobrarlo— pero queda escrito,
  // porque perder dinero también es un dato, y siempre se puede deshacer.
  function marcarIncobrable(id, deshacer) {
    if (soloLectura()) return;
    const doc = DB.state.doc;
    const c = (doc.cobros || []).find((x) => x.id === id);
    if (!c) return;
    if (deshacer) {
      delete c.incobrable; delete c.fecha_incobrable;
    } else {
      const cuanto = eur(c.importe);
      if (!confirm(`¿Dar por perdidos ${cuanto} de ${c.persona}?\n\nDejarán de contar en tu patrimonio. ` +
                   "Queda apuntado y se puede deshacer.")) return;
      c.incobrable = true; c.fecha_incobrable = hoyES();
    }
    if (window.SolventoBoot) window.SolventoBoot.saveDoc();
  }

  // Lo mismo para un préstamo, que no es una línea sino un saldo: se cierra con
  // un apunte de «Incobrable» que no mueve ninguna cuenta.
  function darPrestamoPorIncobrable(persona, saldo) {
    if (soloLectura()) return;
    const doc = DB.state.doc;
    const imp = Math.abs(Number(saldo) || 0);
    if (!(imp > 0)) return;
    if (!confirm(`¿Dar por perdidos ${eur(imp)} que te debe ${persona}?\n\n` +
                 "No mueve ninguna cuenta: solo deja de contar en tu patrimonio. Se puede borrar luego.")) return;
    if (!Array.isArray(doc.movimientos)) doc.movimientos = [];
    doc.movimientos.push({
      id: newId("m"), marca_temporal: new Date().toLocaleString("es-ES"),
      fecha: hoyES(), tipo: "Préstamo", importe: String(imp),
      tipo_prestamo: "Incobrable", persona_prestamo: persona,
      cuenta_origen: "", cuenta_destino: "", tipo_gasto: "", tipo_ingreso: "",
      detalle: `Dado por incobrable · ${persona}`,
    });
    if (window.SolventoBoot) window.SolventoBoot.saveDoc();
  }

  // Una partida del presupuesto anual. Se guarda en la configuración del
  // documento, no en un movimiento: lo aprobado en asamblea no es dinero que se
  // haya movido, es una intención con la que se compara lo que se mueve.
  function openPartida(anio, tipo, nombre) {
    if (soloLectura()) return;
    const doc = DB.state.doc;
    if (!doc.config) doc.config = {};
    if (!doc.config.presupuesto_anual) doc.config.presupuesto_anual = {};
    const anual = doc.config.presupuesto_anual[String(anio)] || (doc.config.presupuesto_anual[String(anio)] = {});
    const clave = (n) => (tipo === "ingreso" ? "+" + n : n);
    const esIngreso = tipo === "ingreso";
    // Las partidas son categorías de primer nivel: así es como se aprueban.
    const raices = (lista) => uniq(lista.map((c) => String(c).split(SEP_RUTA)[0].trim()));
    const sugerencias = esIngreso
      ? raices(categoriasIngresoCfg().concat((doc.movimientos || []).map((m) => m.tipo_ingreso)))
      : raices(categoriasCfg().concat((doc.movimientos || []).map((m) => m.tipo_gasto)));
    const actual = nombre ? anual[clave(nombre)] : "";
    const body =
      field("pa-nombre", esIngreso ? "Partida de ingreso" : "Partida de gasto",
            datalist("pa-nombre", sugerencias, nombre || "")) +
      field("pa-importe", "Aprobado para " + anio + " (€)",
            input("pa-importe", "number", actual, 'step="0.01" min="0" placeholder="0"')) +
      `<div style="font-size:0.75rem;color:var(--t2);margin-top:0.5rem;">
         Es lo que se aprobó, no lo que se ha gastado: eso lo cuentan los movimientos del año.
         Déjalo vacío para quitar la partida.</div>`;
    shell(nombre ? "Partida · " + nombre : "Nueva partida", body, () => {
      const n = G("pa-nombre");
      if (!n) return "Indica la partida";
      // Si se renombra, la vieja no se queda por ahí sumando en paralelo.
      if (nombre && nombre !== n) delete anual[clave(nombre)];
      const v = G("pa-importe");
      if (v === "") delete anual[clave(n)];
      else {
        const num = parseFloat(v);
        if (!isFinite(num) || num < 0) return "Introduce un importe válido";
        anual[clave(n)] = num;
      }
      return null;
    }, () => {
      const pg = document.getElementById("v2-page-presupuesto");
      if (pg && window.SolventoRender) window.SolventoRender.render(DB.state.doc, window.__PRICES || {});
    });
  }

  // ── Ajustes: cuentas, activos y objetivo de asignación ──────────────
  // Todo esto vivía en el código. Ahora se guarda en tu documento cifrado, así
  // que puedes abrir una cuenta o dar de alta un ETF sin que yo toque nada.
  // La primera vez que editas algo, se copia la configuración actual a tus datos
  // y a partir de ahí manda la tuya.
  // Ajustes edita listas, así que lo primero es que existan. Se materializa lo
  // que la aplicación YA está usando —las cuentas de tus movimientos, los
  // activos de tus operaciones—, no el catálogo del código: abrir Ajustes no
  // puede ser la puerta por la que a alguien le entran seis bancos ajenos.
  function cfgEditable() {
    const doc = DB.state.doc;
    if (!doc.config) doc.config = {};
    CFG.usarDoc(doc);
    const copia = (x) => JSON.parse(JSON.stringify(x));
    if (!doc.config.cuentas)  doc.config.cuentas  = copia(CFG.cuentas());
    if (!doc.config.activos)  doc.config.activos  = copia(CFG.activos());
    if (!doc.config.objetivo) doc.config.objetivo = Object.assign({}, CFG.OBJETIVO_DEFECTO);
    CFG.usarDoc(doc);
    return doc.config;
  }

  const filaAjuste = (izq, der, acciones) =>
    `<div style="display:flex;align-items:center;gap:0.6rem;padding:0.55rem 0;border-bottom:1px solid var(--b1);">
      <div style="flex:1;min-width:0;"><div style="color:var(--t1);font-weight:600;font-size:0.88rem;">${izq}</div>
        <div style="color:var(--t2);font-size:0.75rem;">${der}</div></div>${acciones}</div>`;
  const miniBtn = (txt, onclick, color) =>
    `<button type="button" onclick="${onclick}" style="background:none;border:none;color:${color || "var(--t2)"};cursor:pointer;font-size:0.85rem;padding:0.2rem 0.35rem;font-family:inherit;">${txt}</button>`;


  // Fragmentos que rellena la página de Ajustes. Se devuelven como HTML para
  // que render.js los coloque en su sección, en vez de vivir en un modal.
  const refrescarAjustes = () => { if (window.v2AjPintar) window.v2AjPintar(); };

  function fragmentosAjustes() {
    const c = cfgEditable();
    const obj = c.objetivo;
    const cuentas = c.cuentas.map((x, i) => filaAjuste(
      `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${esc(x.accent || "var(--t2)")};margin-right:0.4rem;"></span>${esc(x.cuenta)}`,
      [x.cartera === "cero" ? "aparece en Cartera sin efectivo propio"
                            : (x.cartera ? "agrupa posiciones en Cartera" : "")].filter(Boolean).join(" · ") || "cuenta de efectivo",
      miniBtn("✎", `v2CfgCuenta(${i})`) + miniBtn("✕", `v2CfgDelCuenta(${i})`)
    )).join("") + `<div style="margin-top:0.9rem;">${miniBtn("＋ Añadir cuenta", "v2CfgCuenta(-1)", "var(--azul)")}</div>`;

    const activos = c.activos.map((x, i) => filaAjuste(
      esc(x.nombre),
      `${esc(x.isin || "-")} · ${esc(x.banco || "")}${x.yf ? " · " + esc(x.yf) : " · sin precio automático"}`,
      miniBtn("✎", `v2CfgActivo(${i})`) + miniBtn("✕", `v2CfgDelActivo(${i})`)
    )).join("") + `<div style="margin-top:0.9rem;">${miniBtn("＋ Añadir activo", "v2CfgActivo(-1)", "var(--azul)")}</div>`;

    const objetivo = filaAjuste("Renta variable / Renta fija",
      `${(+obj["Renta variable"] || 0).toFixed(0)}% / ${(+obj["Renta fija"] || 0).toFixed(0)}%`,
      miniBtn("✎", "v2CfgObjetivo()"));

    const categorias = catalogoArbol(categoriasCfg(), {
      nueva: "v2CatNueva", renombrar: "v2CatRenombrar", borrar: "v2CatBorrar",
    }) + `<div style="margin-top:0.9rem;">${miniBtn("＋ Añadir categoría", "v2CatNueva('')", "var(--azul)")}</div>`;

    const categoriasIngreso = catalogoArbol(categoriasIngresoCfg(), {
      nueva: "v2CatIngNueva", renombrar: "v2CatIngRenombrar", borrar: "v2CatIngBorrar",
    }) + `<div style="margin-top:0.9rem;">${miniBtn("＋ Añadir categoría de ingreso", "v2CatIngNueva('')", "var(--azul)")}</div>`;

    const centros = catalogoArbol(centrosCfg(), {
      nueva: "v2CenNueva", renombrar: "v2CenRenombrar", borrar: "v2CenBorrar",
    }) + `<div style="margin-top:0.9rem;">${miniBtn("＋ Añadir centro", "v2CenNueva('')", "var(--azul)")}</div>`;

    // Las páginas del menú. «Presupuesto» solo se ofrece a quien la tiene: en
    // una cuenta personal no existe, y una casilla para esconder algo que no
    // está sería una forma rara de contar una mentira.
    const esOrg = !!(window.SolventoPerfil && window.SolventoPerfil.esOrganizacion());
    const menu = CFG.PAGINAS.filter((p) => !p.org || esOrg).map((p) => {
      const visible = p.fijo || CFG.paginaVisible(p.id);
      const control = p.fijo
        ? `<span style="color:var(--t3);font-size:0.74rem;white-space:nowrap;">siempre visible</span>`
        : `<label style="display:inline-flex;align-items:center;gap:0.4rem;cursor:pointer;
             color:${visible ? "var(--t1)" : "var(--t2)"};font-size:0.78rem;font-weight:600;white-space:nowrap;">
             <input type="checkbox" ${visible ? "checked" : ""}
                    onchange="v2MenuVer('${p.id}', this.checked)"
                    style="width:15px;height:15px;accent-color:var(--azul);cursor:pointer;margin:0;">
             ${visible ? "En el menú" : "Oculta"}</label>`;
      return filaAjuste(esc(p.nombre), esc(p.nota || ""), control);
    }).join("");

    return { cuentas, activos, objetivo, categorias, categoriasIngreso, centros, menu };
  }

  // Mostrar u ocultar una sección del menú. Se aplica en el acto —el menú es lo
  // que se está mirando— y luego se guarda, porque es configuración y tiene que
  // seguir puesta en el próximo dispositivo.
  async function verPagina(id, visible) {
    if (soloLectura()) return;
    const c = cfgEditable();
    const fuera = new Set(CFG.menuOculto());
    if (visible) fuera.delete(id); else fuera.add(id);
    c.menu_oculto = Array.from(fuera);
    if (window.SolventoRender && window.SolventoRender.aplicarMenu) window.SolventoRender.aplicarMenu();
    refrescarAjustes();
    if (window.SolventoBoot && window.SolventoBoot.saveDoc) await window.SolventoBoot.saveDoc();
  }

  // Cuando el logo todavía no está en img/, en vez de una imagen rota se pinta
  // la inicial sobre el color de la marca. Así el catálogo funciona desde el
  // primer día y cada PNG que llega mejora lo que ya había.
  function marcaBanco(b, tam) {
    const px = tam || 22;
    if (b.emoji) return `<span style="width:${px}px;height:${px}px;display:flex;align-items:center;
      justify-content:center;font-size:${px * 0.8}px;flex-shrink:0;">${b.emoji}</span>`;
    const src = CFG.logoBanco(b);
    if (src) return `<img src="${esc(src)}" alt="" style="width:${px}px;height:${px}px;object-fit:contain;
      border-radius:6px;flex-shrink:0;">`;
    // Todavía sin PNG: la inicial sobre el color de la marca, que se reconoce
    // igual y no deja el catálogo lleno de imágenes rotas.
    const inicial = esc(String(b.nombre).trim().charAt(0).toUpperCase());
    return `<span style="width:${px}px;height:${px}px;border-radius:6px;flex-shrink:0;display:inline-flex;
      align-items:center;justify-content:center;background:${esc(b.accent)};color:var(--blanco);
      font-weight:800;font-size:${px * 0.5}px;">${inicial}</span>`;
  }

  // El catálogo de bancos. Elegir uno rellena el nombre y el color; lo que no
  // esté en la lista se escribe a mano, que para eso el nombre sigue siendo un
  // campo de texto.
  function selectorBancos() {
    const fichas = CFG.BANCOS.map((b) => {
      const js = JSON.stringify(b).replace(/"/g, "&quot;");
      return `<button type="button" onclick="v2ElegirBanco(${js})" title="${esc(b.nombre)}"
        style="display:flex;align-items:center;gap:0.5rem;background:var(--f1);border:1px solid var(--b2);border-radius:9px;
        padding:0.4rem 0.55rem;cursor:pointer;font-family:inherit;font-size:0.8rem;color:var(--t1);text-align:left;">
        ${marcaBanco(b)}<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(b.nombre)}</span></button>`;
    }).join("");
    return `<div class="ff">
      <label style="${styleLabel}">Elige dónde tienes el dinero</label>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:0.4rem;
        max-height:230px;overflow-y:auto;padding:0.15rem;">${fichas}</div>
      <div style="font-size:0.75rem;color:var(--t2);margin-top:0.4rem;">
        ¿No está el tuyo? Escríbelo abajo y listo.</div>
    </div>`;
  }

  function openCuentaCfg(i) {
    const c = cfgEditable();
    const e = i >= 0 ? c.cuentas[i] : {};
    const body =
      (i >= 0 ? "" : selectorBancos()) +
      field("c-nombre", "Nombre", input("c-nombre", "text", e.cuenta, 'placeholder="Revolut"')) +
      field("c-color", "Color", input("c-color", "color", e.accent || "var(--azul)")) +
      // Aquí había un «¿Dónde cuenta su efectivo?». No tenía respuesta posible:
      // TODO el efectivo vive en Caja, esté en una cuenta corriente o en un
      // bróker remunerado. Que desde esa cuenta se pueda invertir no lo
      // convierte en inversión mientras siga sin invertir. La pregunta que sí
      // decide algo es la de abajo: si esa cuenta agrupa posiciones en Cartera.
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
      const elegido = CFG.BANCOS.find((b) => b.nombre === nombre);
      const rec = Object.assign({}, e, {
        cuenta: nombre, accent: G("c-color"),
        // Si el nombre coincide con uno del catálogo, se queda con su marca; si
        // se escribió a mano, ni logo ni emoji: un círculo de color y su nombre.
        logo: elegido ? CFG.logoBanco(elegido) : (e.logo || null),
        emoji: elegido ? (elegido.emoji || undefined) : e.emoji,
        cartera: cartera === "no" ? null : cartera,
        etiquetaEfectivo: G("c-etiqueta") || undefined,
      });
      delete rec.broker;
      if (i >= 0) {
        // Si se renombra, arrastrar el cambio a los datos que la referencian
        const antes = c.cuentas[i].cuenta;
        if (antes !== nombre) renombrarCuenta(antes, nombre);
        c.cuentas[i] = rec;
      } else c.cuentas.push(rec);
      return null;
    }, refrescarAjustes);
  }

  function elegirBanco(b) {
    const n = document.getElementById("c-nombre"), col = document.getElementById("c-color");
    if (n) n.value = b.nombre;
    if (col && b.accent) col.value = b.accent;
    if (n) n.focus();
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
      `<div style="font-size:0.75rem;color:var(--t2);margin-top:0.5rem;">El ticker es lo que da el precio automático. Compruébalo en finance.yahoo.com y verifica que el precio se parece a lo que pagaste por unidad: un ticker equivocado infla la rentabilidad sin avisar. Déjalo vacío si el activo se valora por su valor liquidativo.</div>`;
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
      `<div style="font-size:0.75rem;color:var(--t2);margin-top:0.5rem;">Es el reparto al que quieres tender. La página Cartera te muestra cuánto te desvías.</div>`;
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


  // ── Catálogo en árbol para Ajustes ───────────────────────────────────────
  // Sirve igual para categorías y para centros, y llega hasta donde llegue la
  // ruta más profunda. Antes solo pintaba dos niveles, así que una categoría de
  // tres —«Vivienda > Suministros > Luz»— existía en los movimientos y no se
  // podía tocar desde aquí.
  function catalogoArbol(rutas, acc) {
    const hijasDe = (padre) => {
      const base = padre ? partesRuta(padre).length : 0;
      const dentro = padre ? rutas.filter((r) => r === padre || r.indexOf(padre + SEP_RUTA) === 0) : rutas;
      return uniq(dentro.map((r) => partesRuta(r).slice(0, base + 1).join(SEP_RUTA)))
        .filter((r) => r && r !== padre)
        .sort((a, b) => a.localeCompare(b, "es"));
    };
    const pinta = (padre, prof) => hijasDe(padre).map((ruta) => {
      const nombre = partesRuta(ruta).slice(-1)[0];
      const js = String(ruta).replace(/'/g, "\\'");
      return `<div style="display:flex;align-items:center;gap:0.4rem;border-bottom:1px solid var(--b1);
                  padding:0.35rem 0 0.35rem ${(prof * 1.4).toFixed(1)}rem;">
          <div style="flex:1;color:${prof ? "var(--t1b)" : "var(--t1)"};font-weight:${prof ? 400 : 600};
               font-size:${prof ? "0.84rem" : "0.9rem"};">${esc(nombre)}</div>
          ${miniBtn("＋", `${acc.nueva}('${js}')`, "var(--azul)")}${miniBtn("✎", `${acc.renombrar}('${js}')`)}${miniBtn("✕", `${acc.borrar}('${js}')`)}
        </div>` + pinta(ruta, prof + 1);
    }).join("");
    return pinta("", 0) || `<div style="color:var(--t2);font-size:0.84rem;padding:0.5rem 0;">Todavía no hay ninguno.</div>`;
  }

  // Renombrar no es cambiar una etiqueta: la ruta está escrita tal cual dentro de
  // cada movimiento, así que cambiarla solo en el catálogo dejaría dos donde
  // había una, y la mitad de la historia colgando de la vieja.
  function renombrarRuta(titulo, ruta, lista, arrastrar) {
    if (soloLectura()) return;
    const partes = partesRuta(ruta);
    const viejo = partes[partes.length - 1];
    const body =
      `<div style="font-size:0.8rem;color:var(--t1b);margin:0.5rem 0 0;">${esc(ruta)}</div>` +
      field("rn-nombre", "Nuevo nombre", input("rn-nombre", "text", viejo)) +
      `<div id="rn-aviso" style="font-size:0.75rem;color:var(--t2);margin-top:0.5rem;"></div>`;
    shell(titulo, body, () => {
      const n = G("rn-nombre");
      if (!n) return "Escribe un nombre";
      if (n.includes(">")) return 'El nombre no puede llevar el símbolo ">"';
      if (n === viejo) return null;
      const nueva = partes.slice(0, -1).concat(n).join(SEP_RUTA);
      if (lista.some((r) => r.toLowerCase() === nueva.toLowerCase())) return "Ya existe otra con ese nombre";
      // La rama entera se mueve con su padre: al renombrar «Suministros», su Luz
      // y su Gas tienen que seguir colgando de ella.
      const cambia = (v) => (v === ruta || String(v || "").indexOf(ruta + SEP_RUTA) === 0)
        ? nueva + String(v).slice(ruta.length) : v;
      for (let i = 0; i < lista.length; i++) lista[i] = cambia(lista[i]);
      arrastrar(cambia);
      return null;
    }, refrescarAjustes);
    // Decir cuántos apuntes se van a tocar antes de tocarlos
    const aviso = document.getElementById("rn-aviso");
    if (aviso) {
      let n = 0;
      arrastrar((v) => { if (v === ruta || String(v || "").indexOf(ruta + SEP_RUTA) === 0) n++; return v; }, true);
      aviso.textContent = n
        ? `Se actualizarán ${n} apunte${n === 1 ? "" : "s"} que la usan.`
        : "No hay ningún apunte usándola todavía.";
    }
  }

  // Las categorías de ingreso no tenían catálogo: vivían solo dentro de los
  // movimientos que ya las usaban. Se sacan de ahí la primera vez y a partir de
  // entonces se mantienen como las de gasto, que es lo que permite renombrarlas
  // sin perseguir apunte por apunte.
  function categoriasIngresoCfg() {
    const doc = DB.state.doc;
    if (!doc.config) doc.config = {};
    if (!doc.config.categorias_ingreso) {
      doc.config.categorias_ingreso = uniq((doc.movimientos || []).map((m) => m.tipo_ingreso)).sort();
    }
    return doc.config.categorias_ingreso;
  }

  // Renombrar una categoría toca los dos campos a propósito: gasto e ingreso
  // comparten espacio de nombres, y una ruta como «Rentas > Alquileres» puede
  // aparecer en los dos lados de un reparto de gastos.
  const arrastrarCategoria = (doc) => (cambia, soloContar) => {
    (doc.movimientos || []).forEach((m) => {
      const g = cambia(m.tipo_gasto), i = cambia(m.tipo_ingreso);
      if (!soloContar) { if (g !== m.tipo_gasto) m.tipo_gasto = g; if (i !== m.tipo_ingreso) m.tipo_ingreso = i; }
    });
    if (soloContar) return;
    ["presupuesto", "clasificacion"].forEach((clave) => {
      const mapa = (doc.config || {})[clave];
      if (!mapa) return;
      Object.keys(mapa).forEach((k) => {
        const nuevo = cambia(k);
        if (nuevo !== k) { mapa[nuevo] = mapa[k]; delete mapa[k]; }
      });
    });
  };

  function openCategoriaIngresoNueva(padre) {
    const lista = categoriasIngresoCfg();
    const body =
      (padre ? `<div style="font-size:0.8rem;color:var(--t1b);margin:0.5rem 0 0;">Dentro de <b style="color:var(--t0);">${esc(padre)}</b></div>` : "") +
      field("ki-nombre", padre ? "Nombre de la subcategoría" : "Nombre de la categoría",
            input("ki-nombre", "text", "", padre ? 'placeholder="Alquileres"' : 'placeholder="Rentas"'));
    shell(padre ? "Nueva subcategoría de ingreso" : "Nueva categoría de ingreso", body, () => {
      const n = G("ki-nombre");
      if (!n) return "Escribe un nombre";
      if (n.includes(">")) return 'El nombre no puede llevar el símbolo ">"';
      const completa = padre ? `${padre}${SEP_RUTA}${n}` : n;
      if (lista.some((c) => c.toLowerCase() === completa.toLowerCase())) return "Esa categoría ya existe";
      registrarRuta(lista, completa);
      lista.sort();
      return null;
    }, refrescarAjustes);
  }

  function renombrarCategoriaIngresoCfg(cat) {
    renombrarRuta("Renombrar categoría de ingreso", cat, categoriasIngresoCfg(), arrastrarCategoria(DB.state.doc));
  }

  function borrarCategoriaIngresoCfg(cat) {
    const doc = DB.state.doc;
    const lista = categoriasIngresoCfg();
    const dentro = (v) => v === cat || String(v || "").indexOf(cat + SEP_RUTA) === 0;
    const usos = (doc.movimientos || []).filter((m) => dentro(m.tipo_ingreso)).length;
    const aviso = usos
      ? `"${cat}" se usa en ${usos} ingreso${usos === 1 ? "" : "s"}. Quitarla del catálogo no los cambia: seguirán con esa categoría. ¿Seguir?`
      : `¿Quitar "${cat}" del catálogo?`;
    if (!confirm(aviso)) return;
    doc.config.categorias_ingreso = lista.filter((c) => !dentro(c));
    if (window.SolventoBoot) window.SolventoBoot.saveDoc().then(refrescarAjustes);
  }

  function openCategoriaNueva(madre) {
    const cats = categoriasCfg();
    const body =
      (madre ? `<div style="font-size:0.8rem;color:var(--t1b);margin:0.5rem 0 0;">Subcategoría dentro de <b style="color:var(--t0);">${esc(madre)}</b></div>` : "") +
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
    // Cuenta la rama entera, no solo las hijas directas: borrar «Vivienda»
    // afecta también a lo que cuelga de sus suministros. Y cuenta solo gastos:
    // este es el catálogo de gastos, y avisar de los ingresos que comparten
    // nombre haría creer que se van a quedar sin categoría.
    const dentro = (v) => v === cat || String(v || "").indexOf(cat + SEP_RUTA) === 0;
    const usos = (doc.movimientos || []).filter((m) => m.tipo === "Gasto" && dentro(m.tipo_gasto)).length;
    const aviso = usos
      ? `"${cat}" se usa en ${usos} gasto${usos === 1 ? "" : "s"}. Quitarla del catálogo no los cambia: seguirán con esa categoría. ¿Seguir?`
      : `¿Quitar "${cat}" del catálogo de gastos?`;
    if (!confirm(aviso)) return;
    // Al borrar una madre se van con ella sus subcategorías del catálogo
    doc.config.categorias = cats.filter((c) => !dentro(c));
    if (window.SolventoBoot) window.SolventoBoot.saveDoc().then(refrescarAjustes);
  }

  // ── Centros de coste ─────────────────────────────────────────────────────
  // El segundo eje también necesita catálogo: hasta ahora solo existía en los
  // movimientos que ya lo usaban, así que uno recién inventado no aparecía en
  // ningún desplegable hasta que alguien volvía a escribirlo igual.
  function centrosCfg() {
    const doc = DB.state.doc;
    if (!doc.config) doc.config = {};
    if (!doc.config.centros) {
      doc.config.centros = uniq((doc.movimientos || []).map((m) => m.centro)
        .concat((doc.propiedades || doc.inmuebles || []).map((r) => r.centro))).sort();
    }
    return doc.config.centros;
  }

  function openCentroNuevo(padre) {
    const lista = centrosCfg();
    const body =
      (padre ? `<div style="font-size:0.8rem;color:var(--t1b);margin:0.5rem 0 0;">Dentro de <b style="color:var(--t0);">${esc(padre)}</b></div>` : "") +
      field("cn-nombre", padre ? "Nombre del centro de dentro" : "Nombre del centro",
            input("cn-nombre", "text", "", padre ? 'placeholder="Garaje"' : 'placeholder="Inmuebles"'));
    shell(padre ? "Nuevo centro dentro" : "Nuevo centro de coste", body, () => {
      const n = G("cn-nombre");
      if (!n) return "Escribe un nombre";
      if (n.includes(">")) return 'El nombre no puede llevar el símbolo ">"';
      const completa = padre ? `${padre}${SEP_RUTA}${n}` : n;
      if (lista.some((c) => c.toLowerCase() === completa.toLowerCase())) return "Ese centro ya existe";
      registrarRuta(lista, completa);
      lista.sort();
      return null;
    }, refrescarAjustes);
  }

  // Los movimientos y las propiedades llevan el centro escrito dentro, así que
  // renombrarlo o borrarlo tiene que pasar por ellos.
  const arrastrarCentro = (doc) => (cambia, soloContar) => {
    (doc.movimientos || []).forEach((m) => {
      const v = cambia(m.centro);
      if (!soloContar && v !== m.centro) m.centro = v;
    });
    (doc.propiedades || doc.inmuebles || []).forEach((r) => {
      const v = cambia(r.centro);
      if (!soloContar && v !== r.centro) r.centro = v;
    });
  };

  function renombrarCentroCfg(centro) {
    const doc = DB.state.doc;
    renombrarRuta("Renombrar centro de coste", centro, centrosCfg(), arrastrarCentro(doc));
  }

  function borrarCentroCfg(centro) {
    const doc = DB.state.doc;
    const lista = centrosCfg();
    const dentro = (v) => v === centro || String(v || "").indexOf(centro + SEP_RUTA) === 0;
    const usos = (doc.movimientos || []).filter((m) => dentro(m.centro)).length
               + (doc.propiedades || doc.inmuebles || []).filter((r) => dentro(r.centro)).length;
    const aviso = usos
      ? `"${centro}" se usa en ${usos} apunte${usos === 1 ? "" : "s"}. Quitarlo del catálogo no los cambia: seguirán imputados ahí. ¿Seguir?`
      : `¿Quitar "${centro}" del catálogo?`;
    if (!confirm(aviso)) return;
    doc.config.centros = lista.filter((c) => !dentro(c));
    if (window.SolventoBoot) window.SolventoBoot.saveDoc().then(refrescarAjustes);
  }

  function renombrarCategoriaCfg(cat) {
    renombrarRuta("Renombrar categoría", cat, categoriasCfg(), arrastrarCategoria(DB.state.doc));
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
      `<div style="font-size:0.75rem;color:var(--t2);margin-top:0.5rem;">El reparto clásico es 50/30/20, pero puedes ajustarlo a lo que te encaje. Los tres deben sumar 100.</div>`;
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
      `<div style="font-size:0.75rem;color:var(--t2);margin-top:0.5rem;">Cuando el gasto del mes supere este tope, la categoría se marca en rojo. Déjalo vacío para quitar el presupuesto.</div>`;
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
  function openPropiedad(existing) {
    if (soloLectura()) return;
    const doc = DB.state.doc, e = existing || {};
    if (!Array.isArray(doc.propiedades)) doc.propiedades = doc.inmuebles || [];
    const tipos = Object.keys(CFG.TIPO_COLORES_INMUEBLE);
    const body =
      field("p-nombre", "Nombre o dirección", input("p-nombre", "text", e.nombre || e.direccion, 'placeholder="Reloj Omega Seamaster"')) +
      field("p-tipo", "Tipo", select("p-tipo", tipos, e.tipo || tipos[0])) +
      `<div id="p-porpeso" style="display:none;">
        ${field("p-metal", "Metal", selectKV("p-metal", [["oro", "Oro"], ["plata", "Plata"]], String(e.metal || "oro")))}
        ${field("p-peso", "Peso (gramos)", input("p-peso", "number", e.peso_g, 'step="0.01" min="0" placeholder="31.1"'))}
        <div style="font-size:0.75rem;color:var(--t2);margin-top:0.4rem;">El valor se calcula solo con el precio del metal, que se actualiza a diario.</div>
      </div>` +
      `<div id="p-portasacion">
        ${field("p-valor", "Valor actual (€)", input("p-valor", "number", e.valor != null ? e.valor : e.tasacion, 'step="0.01" min="0"'))}
      </div>` +
      field("p-compra", "Valor de compra (€)", input("p-compra", "number", e.valor_compra, 'step="0.01" min="0"')) +
      field("p-fecha", "Fecha de adquisición", input("p-fecha", "date", toISO(e.fecha_adquisicion))) +
      `<label style="display:flex;gap:0.5rem;align-items:center;font-size:0.85rem;color:var(--t1b);margin-top:0.9rem;cursor:pointer;">
         <input type="checkbox" id="p-alq" ${e.alquilada ? "checked" : ""}> Está alquilada</label>` +
      // El centro de coste es lo que une la ficha con la contabilidad: sin él,
      // los recibos de la comunidad y el alquiler cobrado están en los datos
      // pero no hay forma de saber que son de ESTE piso.
      field("p-centro", "Centro de coste", selectorArbol("p-centro", e.centro)) +
      // Ya no se preguntan importes. La renta sube, un mes no se cobra, llega una
      // derrama: cualquier cifra escrita aquí envejece el mismo día. Lo que se
      // ha cobrado y pagado por este inmueble está en los movimientos que llevan
      // su centro, y de ahí se saca.
      `<div id="p-alquiler" style="display:none;font-size:0.78rem;color:var(--t2);
            background:var(--f1);border:1px solid var(--b1);border-radius:10px;padding:0.7rem 0.85rem;margin-top:0.6rem;">
        La renta y los gastos salen de tus movimientos, no de un importe escrito aquí:
        se suman los ingresos y los gastos de los últimos doce meses imputados a su centro de coste.
        <div id="p-alquiler-aviso" style="color:var(--ambar);margin-top:0.4rem;"></div>
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
      upsert(doc.propiedades, rec);
      return null;
    });
    // Los campos se muestran según lo que hayas elegido
    const refrescar = () => {
      const porPeso = CFG.TIPOS_POR_PESO.includes(document.getElementById("p-tipo").value);
      document.getElementById("p-porpeso").style.display = porPeso ? "block" : "none";
      document.getElementById("p-portasacion").style.display = porPeso ? "none" : "block";
      document.getElementById("p-alquiler").style.display = document.getElementById("p-alq").checked ? "block" : "none";
      // Sin centro no hay nada que cruzar, y conviene decirlo aquí y no cuando
      // la ficha aparezca vacía en la página de Propiedades.
      const aviso = document.getElementById("p-alquiler-aviso");
      if (aviso) {
        aviso.textContent = document.getElementById("p-centro").value
          ? "" : "Elige antes su centro de coste: sin él no se le puede imputar ningún cobro.";
      }
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
    document.getElementById("p-centro").addEventListener("change", refrescar);
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

  // ── Imputar un centro a varios movimientos de golpe ──────────────────────
  // Cuarenta y tres apuntes sueltos no se arreglan uno a uno, y reimportar el
  // documento entero para eso es desproporcionado y pisa lo que hayas tocado
  // desde la web. Se filtra en la lista y se imputan todos juntos.
  function openImputarCentro(lista) {
    if (soloLectura()) return;
    const doc = DB.state.doc;
    const afectados = (lista || []).filter((m) => m.tipo === "Gasto" || m.tipo === "Ingreso");
    if (!afectados.length) {
      window.SolventoBoot && window.SolventoBoot.toast("No hay gastos ni ingresos en el filtro");
      return;
    }
    const suma = afectados.reduce((t, m) => t + Math.abs(parseFloat(String(m.importe).replace(",", ".")) || 0), 0);
    const conCentro = afectados.filter((m) => String(m.centro || "").trim()).length;
    const centros = uniq(centrosCfg()
      .concat((doc.movimientos || []).map((m) => m.centro))
      .concat((doc.propiedades || doc.inmuebles || []).map((r) => r.centro)));
    const body =
      `<div style="background:var(--f1);border:1px solid var(--b1);border-radius:10px;padding:0.7rem 0.85rem;
            font-size:0.82rem;color:var(--t1b);margin:0.5rem 0 0;">
        Vas a imputar <b style="color:var(--t0);">${afectados.length}</b> movimiento${afectados.length === 1 ? "" : "s"}
        (${esc(suma.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))} €) al centro que elijas.
        ${conCentro ? `<div style="color:var(--ambar);margin-top:0.4rem;">${conCentro} ya tiene${conCentro === 1 ? "" : "n"} centro y se sobrescribirá${conCentro === 1 ? "" : "n"}.</div>` : ""}
      </div>` +
      field("ic-centro", "Centro de coste", selectorArbol("ic-centro", ""));
    shell("Imputar en bloque", body, () => {
      const centro = G("ic-centro");
      if (!centro) return "Elige un centro";
      if (!confirm(`¿Imputar ${afectados.length} movimiento${afectados.length === 1 ? "" : "s"} a "${centro}"?`)) {
        return "Cancelado: no se ha cambiado nada";
      }
      afectados.forEach((m) => { m.centro = centro; });
      doc.config = doc.config || {};
      doc.config.centros = doc.config.centros || [];
      registrarRuta(doc.config.centros, centro);
      return null;
    });
    wireArbol("ic-centro", centros, "— Elige centro —",
              (k) => (k === 0 ? "+ Nuevo centro…" : "+ Nuevo centro dentro…"));
  }

  // ── Revisión: marcar lo que ya has mirado ────────────────────────────────
  function marcarRevisado(clave) {
    if (soloLectura()) return;
    const doc = DB.state.doc;
    if (!doc.config) doc.config = {};
    if (!Array.isArray(doc.config.revision_ok)) doc.config.revision_ok = [];
    if (!doc.config.revision_ok.includes(clave)) doc.config.revision_ok.push(clave);
    if (window.SolventoBoot) window.SolventoBoot.saveDoc().then(refrescarAjustes);
  }

  // Pasa la corrección de textos a los apuntes ya guardados. Solo toca lo que
  // sabe traducir: lo que no está en la tabla se queda como está y se sigue
  // viendo en la revisión, para arreglarlo a mano en su movimiento.
  function arreglarTextos() {
    if (soloLectura()) return;
    const doc = DB.state.doc;
    const M = window.SolventoModel;
    const cambios = [];
    (doc.movimientos || []).forEach((m) => {
      ["detalle", "detalle_banco"].forEach((campo) => {
        const antes = m[campo];
        if (!antes) return;
        const despues = M.arreglarTexto(antes);
        if (despues !== antes) cambios.push({ m, campo, antes, despues });
      });
    });
    if (!cambios.length) {
      alert("No hay ningún texto que yo sepa arreglar. Los que salen en el aviso hay que corregirlos a mano, en su movimiento.");
      return;
    }
    const muestra = cambios.slice(0, 5).map((c) => `  ${c.antes}\n  → ${c.despues}`).join("\n\n");
    if (!confirm(`Voy a corregir ${cambios.length} ${cambios.length === 1 ? "texto" : "textos"}:\n\n${muestra}` +
                 (cambios.length > 5 ? `\n\n…y ${cambios.length - 5} más.` : "") + "\n\n¿Adelante?")) return;
    cambios.forEach((c) => { c.m[c.campo] = c.despues; });
    if (window.SolventoBoot) window.SolventoBoot.saveDoc().then(refrescarAjustes);
  }

  function restaurarRevisiones() {
    if (soloLectura()) return;
    const doc = DB.state.doc;
    const n = ((doc.config || {}).revision_ok || []).length;
    if (!n || !confirm(`¿Volver a revisar los ${n} avisos que diste por buenos?`)) return;
    doc.config.revision_ok = [];
    if (window.SolventoBoot) window.SolventoBoot.saveDoc().then(refrescarAjustes);
  }

  // ── Borrado ──
  function del(collection, id) {
    if (soloLectura()) return;
    const doc = DB.state.doc;
    doc[collection] = (doc[collection] || []).filter((m) => m.id !== id);
    if (window.SolventoBoot && window.SolventoBoot.saveDoc) window.SolventoBoot.saveDoc();
  }
  const findById = (coll, id) => (DB.state.doc[coll] || []).find((x) => x.id === id);

  window.SolventoForms = {
    openMovimiento, openInversion, openPropiedad, openNav, openCuadrar, openPasivo, openImputarCentro,
    fragmentosAjustes, verPagina, marcarRevisado, restaurarRevisiones, arreglarTextos, openCobro, cobrarCobro, marcarIncobrable, darPrestamoPorIncobrable, openPartida, openPresupuesto, openRegla, openCategoriaNueva, borrarCategoriaCfg, renombrarCategoriaCfg,
    openCategoriaIngresoNueva, borrarCategoriaIngresoCfg, renombrarCategoriaIngresoCfg,
    openCentroNuevo, borrarCentroCfg, renombrarCentroCfg, openCuentaCfg, borrarCuentaCfg, elegirBanco, openActivoCfg, borrarActivoCfg, openObjetivoCfg,
    editMovimiento: (id) => openMovimiento(findById("movimientos", id)),
    editInversion: (id) => openInversion(findById("inversiones", id)),
    editPropiedad: (id) => openPropiedad(findById("propiedades", id) || findById("inmuebles", id)),
    editPasivo: (id) => openPasivo(findById("pasivos", id)),
    deleteMovimiento: (id) => del("movimientos", id),
    editCobro: (id) => openCobro(((DB.state.doc || {}).cobros || []).find((x) => x.id === id)),
    deleteCobro: (id) => del("cobros", id),
    deleteInversion: (id) => del("inversiones", id),
    deletePropiedad: (id) => del("propiedades", id),
    deletePasivo: (id) => del("pasivos", id),
  };
})();
