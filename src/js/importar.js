/*
 * Solvento v2 — Importador de extractos bancarios.
 *
 * No hay un lector por banco: se lee el archivo, se adivina qué columna es cada
 * cosa mirando los DATOS (no solo la cabecera, que cada banco escribe a su
 * manera) y tú corriges el mapeo si hace falta. Así vale para cualquier export.
 *
 * El cotejo compara cada línea del extracto con lo ya registrado en esa cuenta y
 * la clasifica en: ya registrada, nueva, difiere (cuadra el dinero pero cambia el
 * concepto) y —al revés— lo que Solvento tiene y el extracto no trae. Nada se
 * escribe hasta que lo confirmas: el importador solo propone.
 *
 * Regla acordada: ante dudas manda el extracto. Por eso lo que "difiere" se
 * actualiza con lo que dice el banco, y los sobrantes se marcan para que decidas
 * uno a uno (no se borran solos: un ajuste inventado que ya sobra y un
 * movimiento legítimo que el banco no exporta se parecen demasiado).
 */
(function () {
  "use strict";
  const CFG = window.SolventoConfig;

  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const eurFmt = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
  const fmtEur = (x) => (isFinite(x) ? eurFmt.format(x) : "—");
  const newId = (p) => p + Math.random().toString(16).slice(2, 12);
  const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

  // ── Números y fechas tal y como los escriben los bancos españoles ──────────

  // "1.234,56" · "-1.234,56" · "1,234.56" · "(1.234,56)" · "1234,56 €"
  function numES(v) {
    if (typeof v === "number") return isFinite(v) ? v : NaN;
    let s = String(v == null ? "" : v).replace(/[\s ]|€|EUR/gi, "").trim();
    if (!s) return NaN;
    const neg = /^\(.*\)$/.test(s) || s.startsWith("-");
    s = s.replace(/^[-+(]+/, "").replace(/\)+$/, "");
    const c = s.lastIndexOf(","), p = s.lastIndexOf(".");
    // El separador decimal es el último que aparece; el otro es de millares
    if (c > p) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
    const n = parseFloat(s);
    if (!isFinite(n)) return NaN;
    return neg ? -n : n;
  }

  // Devuelve dd/mm/aaaa, que es como guarda Solvento las fechas
  function fechaES(v) {
    if (v instanceof Date && !isNaN(v)) {
      const p = (n) => String(n).padStart(2, "0");
      return `${p(v.getDate())}/${p(v.getMonth() + 1)}/${v.getFullYear()}`;
    }
    const s = String(v == null ? "" : v).trim();
    let m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/.exec(s);
    if (m) {
      let a = m[3];
      if (a.length === 2) a = (Number(a) > 70 ? "19" : "20") + a;
      return `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}/${a}`;
    }
    m = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/.exec(s);
    if (m) return `${m[3].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[1]}`;
    return "";
  }
  const aTS = (es) => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(es || ""));
    return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : NaN;
  };

  // Para comparar conceptos: sin acentos, sin dobles espacios, en mayúsculas
  const normCon = (s) => String(s == null ? "" : s)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

  // Clave estable de una línea del extracto. Se guarda en el movimiento creado,
  // de modo que reimportar el mismo archivo no duplica nada aunque después hayas
  // editado el concepto a mano.
  const refDe = (cuenta, fecha, importe, concepto) =>
    [cuenta, fecha, round2(importe).toFixed(2), normCon(concepto).slice(0, 40)].join("|");

  // ── 1. Lectura del archivo ────────────────────────────────────────────────

  // Los bancos españoles siguen exportando en windows-1252. Se intenta UTF-8 en
  // estricto y, si el archivo no lo es, se reintenta en 1252 en vez de dejar
  // "Ingresó" convertido en un jeroglífico.
  function decodificar(buf) {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); }
    catch (e) { return new TextDecoder("windows-1252").decode(buf); }
  }

  function detectarSeparador(texto) {
    const lineas = texto.split(/\r?\n/).filter((l) => l.trim()).slice(0, 10);
    const cuenta = (ch) => lineas.reduce((s, l) => s + (l.split(ch).length - 1), 0);
    const cand = [[";", cuenta(";")], [",", cuenta(",")], ["\t", cuenta("\t")], ["|", cuenta("|")]];
    cand.sort((a, b) => b[1] - a[1]);
    return cand[0][1] > 0 ? cand[0][0] : ";";
  }

  // CSV con comillas, saltos de línea dentro de campo y "" como comilla escapada
  function parsearCSV(texto, sep) {
    const filas = [];
    let fila = [], campo = "", dentro = false;
    for (let i = 0; i < texto.length; i++) {
      const ch = texto[i];
      if (dentro) {
        if (ch === '"') {
          if (texto[i + 1] === '"') { campo += '"'; i++; }
          else dentro = false;
        } else campo += ch;
        continue;
      }
      if (ch === '"') { dentro = true; continue; }
      if (ch === sep) { fila.push(campo); campo = ""; continue; }
      if (ch === "\n") { fila.push(campo); filas.push(fila); fila = []; campo = ""; continue; }
      if (ch === "\r") continue;
      campo += ch;
    }
    if (campo || fila.length) { fila.push(campo); filas.push(fila); }
    return filas.map((f) => f.map((c) => String(c).trim())).filter((f) => f.some((c) => c !== ""));
  }

  // El .xlsx solo carga su librería cuando de verdad abres un .xlsx: la app no
  // debe engordar 900 kB por una función que casi siempre se usa con CSV.
  let cargandoXLSX = null;
  function cargarXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (cargandoXLSX) return cargandoXLSX;
    cargandoXLSX = new Promise((ok, err) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      s.onload = () => (window.XLSX ? ok(window.XLSX) : err(new Error("XLSX no se cargó")));
      s.onerror = () => err(new Error("No se pudo descargar el lector de Excel (¿sin conexión?)"));
      document.head.appendChild(s);
    });
    return cargandoXLSX;
  }

  function leerArchivo(file) {
    return new Promise((ok, err) => {
      const fr = new FileReader();
      fr.onerror = () => err(new Error("No se pudo leer el archivo"));
      fr.onload = () => {
        const buf = fr.result;
        if (/\.xlsx?$/i.test(file.name)) {
          cargarXLSX().then((XLSX) => {
            const wb = XLSX.read(new Uint8Array(buf), { type: "array", cellDates: true });
            const hoja = wb.Sheets[wb.SheetNames[0]];
            const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: "" });
            ok(filas.map((f) => f.map((c) => (c instanceof Date ? c : String(c == null ? "" : c).trim())))
                    .filter((f) => f.some((c) => c !== "")));
          }).catch(err);
          return;
        }
        const texto = decodificar(buf);
        ok(parsearCSV(texto, detectarSeparador(texto)));
      };
      fr.readAsArrayBuffer(file);
    });
  }

  // ── 2. Adivinar qué es cada columna ───────────────────────────────────────

  const esFecha = (v) => !!fechaES(v);
  const esNum = (v) => isFinite(numES(v));

  // La cabecera es la fila que más parece una cabecera: texto en casi todas las
  // celdas y, debajo, filas que sí traen fechas y números. Muchos extractos
  // empiezan con dos o tres líneas de membrete que hay que saltarse.
  function detectarCabecera(filas) {
    const PISTAS = /fecha|concepto|descripc|importe|saldo|movimiento|operac|cargo|abono|debe|haber|divisa|referencia|valor/i;
    let mejor = 0, mejorPunt = -1;
    for (let i = 0; i < Math.min(filas.length, 15); i++) {
      const f = filas[i];
      const llenas = f.filter((c) => c !== "").length;
      if (llenas < 2) continue;
      let punt = f.filter((c) => PISTAS.test(String(c))).length * 3;
      punt += llenas;
      // Penaliza si la propia fila ya son datos (trae fechas o importes)
      if (f.some(esFecha)) punt -= 4;
      if (punt > mejorPunt) { mejorPunt = punt; mejor = i; }
    }
    return mejor;
  }

  // Se decide por los datos y se afina con la cabecera: el tipo de una columna
  // lo dice lo que contiene, no cómo la haya querido llamar el banco.
  function adivinarColumnas(cabecera, datos) {
    const n = cabecera.length;
    const col = (j) => datos.map((f) => (f[j] == null ? "" : f[j])).filter((v) => String(v) !== "");
    const frac = (j, test) => { const c = col(j); return c.length ? c.filter(test).length / c.length : 0; };
    const tipo = [], nombre = cabecera.map((c) => String(c || "").toLowerCase());
    for (let j = 0; j < n; j++) {
      if (frac(j, esFecha) >= 0.8) tipo[j] = "fecha";
      else if (frac(j, esNum) >= 0.8) tipo[j] = "num";
      else tipo[j] = "texto";
    }
    const buscar = (tp, re, excluir) => {
      for (let j = 0; j < n; j++) {
        if (tipo[j] !== tp || (excluir && excluir.indexOf(j) >= 0)) continue;
        if (re.test(nombre[j])) return j;
      }
      return -1;
    };
    const primera = (tp, excluir) => {
      for (let j = 0; j < n; j++) if (tipo[j] === tp && !(excluir && excluir.indexOf(j) >= 0)) return j;
      return -1;
    };
    // Fecha: la contable/operación manda sobre la de valor, que es otra cosa
    let fecha = buscar("fecha", /oper|contab/);
    if (fecha < 0) fecha = buscar("fecha", /fecha|date/);
    if (fecha < 0) fecha = primera("fecha");

    // Saldo primero, para no confundirlo con el importe (los dos son números)
    let saldo = buscar("num", /saldo|balance/);
    let debe = buscar("num", /debe|cargo|salida|d[ée]bito/, [saldo]);
    let haber = buscar("num", /haber|abono|entrada|cr[ée]dito|ingreso/, [saldo, debe]);
    let importe = buscar("num", /importe|cantidad|amount|movimiento/, [saldo, debe, haber]);
    if (importe < 0 && !(debe >= 0 && haber >= 0)) importe = primera("num", [saldo]);
    // Con debe y haber separados el importe sale de restarlos, no de una columna
    if (debe >= 0 && haber >= 0) importe = -1; else { debe = -1; haber = -1; }

    // Concepto: la columna de texto con las celdas más largas
    let concepto = -1, largo = -1;
    for (let j = 0; j < n; j++) {
      if (tipo[j] !== "texto") continue;
      const c = col(j), l = c.reduce((s, v) => s + String(v).length, 0) / (c.length || 1);
      if (l > largo) { largo = l; concepto = j; }
    }
    return { fecha, concepto, importe, saldo, debe, haber };
  }

  // Convierte las filas crudas en líneas con sentido, según el mapeo
  function lineasDe(datos, mapa, cuenta) {
    const out = [];
    datos.forEach((f, i) => {
      const fecha = fechaES(f[mapa.fecha]);
      let importe;
      if (mapa.debe >= 0 && mapa.haber >= 0) {
        const d = numES(f[mapa.debe]) || 0, h = numES(f[mapa.haber]) || 0;
        importe = round2(h - Math.abs(d));
      } else importe = round2(numES(f[mapa.importe]));
      if (!fecha || !isFinite(importe) || importe === 0) return;   // línea sin dinero o sin fecha
      const concepto = String(f[mapa.concepto] == null ? "" : f[mapa.concepto]).replace(/\s+/g, " ").trim();
      const saldo = mapa.saldo >= 0 ? numES(f[mapa.saldo]) : NaN;
      out.push({ i, fecha, ts: aTS(fecha), importe, concepto, saldo, ref: refDe(cuenta, fecha, importe, concepto) });
    });
    return out.sort((a, b) => a.ts - b.ts);
  }

  // ── 3. Cotejo contra lo ya registrado ─────────────────────────────────────

  const esMovInv = (m) => {
    const t = String(m.tipo_gasto || m.tipo_ingreso || "").trim().toLowerCase();
    return t === "inversiones" && String(m.tipo || "") === "Gasto";
  };

  // Cuánto mueve un movimiento en ESTA cuenta (+ entra, − sale, null si no la toca)
  function efectoEnCuenta(m, cuenta) {
    const imp = Math.abs(parseFloat(m.importe)) || 0;
    const o = String(m.cuenta_origen || "").trim(), d = String(m.cuenta_destino || "").trim();
    switch (m.tipo) {
      case "Ingreso":  return d === cuenta ? imp : null;
      case "Gasto":    return o === cuenta ? -imp : null;
      case "Traspaso": return o === cuenta ? -imp : (d === cuenta ? imp : null);
      case "Préstamo":
        if (m.tipo_prestamo === "Dinero prestado") return o === cuenta ? -imp : null;
        return d === cuenta ? imp : null;
      default: return null;
    }
  }

  // Las operaciones de inversión también mueven el efectivo de la cuenta del
  // bróker. Entran en el cotejo como candidatas —para no duplicar una compra que
  // el extracto trae— pero nunca se proponen para borrar: no son movimientos.
  function candidatasInversion(doc, cuenta) {
    return (doc.inversiones || []).filter((r) => String(r.cuenta || "").trim() === cuenta
        && (r.tipo_movimiento || "Compra") !== "Traspaso" && isFinite(parseFloat(r.coste)))
      .map((r) => ({ tipo: "inversion", id: r.id, fecha: r.fecha, ts: aTS(r.fecha),
                     efecto: round2(-parseFloat(r.coste)), texto: (r.nombre || r.ticker || "operación") }));
  }

  function candidatasMovimiento(doc, cuenta) {
    return (doc.movimientos || []).filter((m) => !esMovInv(m) && efectoEnCuenta(m, cuenta) != null)
      .map((m) => ({ tipo: "mov", id: m.id, mov: m, fecha: m.fecha, ts: aTS(m.fecha),
                     efecto: round2(efectoEnCuenta(m, cuenta)), texto: m.detalle || m.tipo_gasto || m.tipo_ingreso || m.tipo }));
  }

  /*
   * Empareja líneas del extracto con apuntes ya registrados. Dos pasadas:
   * primero por la referencia guardada al importar (exacta, sobrevive a que
   * después edites el concepto) y luego por dinero y fecha cercana, cogiendo
   * siempre la pareja más próxima en el tiempo para que dos importes iguales del
   * mismo mes no se crucen.
   */
  function cotejar(lineas, doc, cuenta, ventana) {
    const cands = candidatasMovimiento(doc, cuenta).concat(candidatasInversion(doc, cuenta));
    const usadas = new Set();
    const res = { iguales: [], nuevas: [], difieren: [], sobrantes: [] };

    const porRef = new Map();
    cands.forEach((c) => { if (c.mov && c.mov.imp_ref) porRef.set(c.mov.imp_ref, c); });

    const pendientes = [];
    lineas.forEach((l) => {
      const c = porRef.get(l.ref);
      if (c && !usadas.has(c.id)) { usadas.add(c.id); res.iguales.push({ linea: l, cand: c }); }
      else pendientes.push(l);
    });

    pendientes.forEach((l) => {
      let mejor = null, mejorD = Infinity;
      cands.forEach((c) => {
        if (usadas.has(c.id)) return;
        if (Math.abs(c.efecto - l.importe) > 0.005) return;
        const d = Math.abs(c.ts - l.ts) / 86400000;
        if (!isFinite(d) || d > ventana) return;
        if (d < mejorD) { mejorD = d; mejor = c; }
      });
      if (!mejor) { res.nuevas.push(l); return; }
      usadas.add(mejor.id);
      // Manda el extracto: si el concepto o la fecha no coinciden, se actualizan
      const distinto = mejor.tipo === "mov"
        && (normCon(mejor.texto) !== normCon(l.concepto) || mejor.fecha !== l.fecha);
      (distinto ? res.difieren : res.iguales).push({ linea: l, cand: mejor });
    });

    // Lo que Solvento tiene dentro del rango del archivo y el extracto no trae
    if (lineas.length) {
      const t0 = lineas[0].ts, t1 = lineas[lineas.length - 1].ts;
      cands.forEach((c) => {
        if (usadas.has(c.id)) return;
        if (!isFinite(c.ts) || c.ts < t0 || c.ts > t1) return;
        res.sobrantes.push(c);
      });
    }
    return res;
  }

  // ── 4. Traspasos ──────────────────────────────────────────────────────────

  const RE_EFECTIVO = /REINTEGRO|CAJERO|DISPOSICION|RETIRADA|EFECTIVO|ATM/;

  function cuentaEfectivo() {
    const c = CFG.cuentas().find((x) => /efectivo|caja|cash/i.test(x.cuenta));
    return c ? c.cuenta : null;
  }

  /*
   * Un traspaso deja dos rastros: la salida en una cuenta y la entrada en otra.
   * Si se importa cada extracto por separado, eso son dos apuntes sueltos y el
   * patrimonio no cambia pero la contabilidad miente. Aquí se proponen dos casos:
   *   pareja  la línea nueva casa con un movimiento ya registrado en OTRA cuenta,
   *           mismo importe y signo opuesto → un único Traspaso, y el suelto se va
   *   efectivo un reintegro/cajero → Traspaso de la cuenta a Efectivo
   * Ninguno se aplica solo: son propuestas con su casilla.
   */
  function proponerTraspasos(nuevas, doc, cuenta, ventana) {
    const props = [];
    const efectivo = cuentaEfectivo();
    const otras = (doc.movimientos || []).filter((m) => !esMovInv(m) && (m.tipo === "Ingreso" || m.tipo === "Gasto"))
      .map((m) => {
        const co = m.tipo === "Ingreso" ? String(m.cuenta_destino || "") : String(m.cuenta_origen || "");
        return { m, cuenta: co, ts: aTS(m.fecha), efecto: m.tipo === "Ingreso" ? Math.abs(+m.importe) : -Math.abs(+m.importe) };
      }).filter((x) => x.cuenta && x.cuenta !== cuenta);

    const tomadas = new Set();
    nuevas.forEach((l) => {
      let par = null, mejorD = Infinity;
      otras.forEach((x) => {
        if (tomadas.has(x.m.id)) return;
        if (Math.abs(x.efecto + l.importe) > 0.005) return;    // signos opuestos
        const d = Math.abs(x.ts - l.ts) / 86400000;
        if (!isFinite(d) || d > ventana) return;
        if (d < mejorD) { mejorD = d; par = x; }
      });
      if (par) {
        tomadas.add(par.m.id);
        props.push({ clase: "pareja", linea: l, otro: par,
          origen: l.importe < 0 ? cuenta : par.cuenta, destino: l.importe < 0 ? par.cuenta : cuenta });
        return;
      }
      if (efectivo && efectivo !== cuenta && l.importe < 0 && RE_EFECTIVO.test(normCon(l.concepto))) {
        props.push({ clase: "efectivo", linea: l, origen: cuenta, destino: efectivo });
      }
    });
    return props;
  }

  // ── 5. Cuadre ─────────────────────────────────────────────────────────────

  /*
   * Dos comprobaciones distintas y las dos importan:
   *   variación  la suma del extracto tiene que ser el cambio de saldo que
   *              Solvento registra en ese mismo rango. Es comprobable siempre y
   *              dice si el import deja EL TRAMO exacto.
   *   saldo final  el saldo del banco al final del extracto contra el de Solvento
   *              a esa fecha. Solo cuadra si además toda la historia anterior está
   *              bien, así que es lo que delata los vacíos de antes del archivo.
   */
  function cuadre(lineas, doc, cuenta, plan) {
    if (!lineas.length) return null;
    const t0 = lineas[0].ts, t1 = lineas[lineas.length - 1].ts;
    const sumaExtracto = round2(lineas.reduce((s, l) => s + l.importe, 0));

    const movs = (doc.movimientos || []).slice();
    plan.crear.forEach((m) => movs.push(m));
    const borrar = new Set(plan.borrar);
    const vivos = movs.filter((m) => !borrar.has(m.id));

    const efectoRango = (hasta, desde) => {
      let t = 0;
      vivos.forEach((m) => {
        if (esMovInv(m)) return;
        const e = efectoEnCuenta(m, cuenta);
        if (e == null) return;
        const ts = aTS(m.fecha);
        if (!isFinite(ts) || ts > hasta || (desde != null && ts < desde)) return;
        t += e;
      });
      (doc.inversiones || []).forEach((r) => {
        if (String(r.cuenta || "").trim() !== cuenta) return;
        if ((r.tipo_movimiento || "Compra") === "Traspaso") return;
        const ts = aTS(r.fecha), c = parseFloat(r.coste);
        if (!isFinite(ts) || !isFinite(c) || ts > hasta || (desde != null && ts < desde)) return;
        t -= c;
      });
      return round2(t);
    };

    const variacionSolvento = efectoRango(t1, t0);
    const saldoSolvento = efectoRango(t1, null);
    const saldoBanco = lineas.reduce((v, l) => (isFinite(l.saldo) ? l.saldo : v), NaN);

    return {
      sumaExtracto, variacionSolvento,
      variacionOk: Math.abs(sumaExtracto - variacionSolvento) < 0.005,
      saldoBanco, saldoSolvento,
      saldoOk: isFinite(saldoBanco) ? Math.abs(saldoBanco - saldoSolvento) < 0.005 : null,
      desde: lineas[0].fecha, hasta: lineas[lineas.length - 1].fecha,
    };
  }

  // ── 6. Del cotejo al plan de cambios ──────────────────────────────────────

  function movDeLinea(l, cuenta, extra) {
    const base = {
      id: newId("m"), marca_temporal: new Date().toLocaleString("es-ES"),
      fecha: l.fecha, importe: String(Math.abs(l.importe)),
      cuenta_origen: "", cuenta_destino: "", tipo_ingreso: "", tipo_gasto: "",
      tipo_prestamo: "", persona_prestamo: "", detalle: l.concepto, imp_ref: l.ref,
    };
    if (extra && extra.traspaso) {
      base.tipo = "Traspaso"; base.cuenta_origen = extra.origen; base.cuenta_destino = extra.destino;
    } else if (l.importe > 0) { base.tipo = "Ingreso"; base.cuenta_destino = cuenta; }
    else { base.tipo = "Gasto"; base.cuenta_origen = cuenta; }
    return base;
  }

  // ── 7. Interfaz ───────────────────────────────────────────────────────────

  const S = { filas: null, nombre: "", cabecera: 0, mapa: null, cuenta: "", ventana: 3,
              cotejo: null, props: null, sel: null, aviso: "" };

  const DOC = () => (window.SolventoDB && window.SolventoDB.state.doc) || null;

  const chip = (txt, col) => `<span style="display:inline-block;background:${col}22;color:${col};border-radius:999px;
    padding:0.15rem 0.6rem;font-size:0.72rem;font-weight:700;margin-right:0.4rem;">${esc(txt)}</span>`;
  const bot = (txt, on, extra) => `<button onclick="${on}" style="background:#1e2130;border:1px solid #3a3d4a;border-radius:8px;
    color:#e5e7eb;font-family:inherit;font-size:0.82rem;font-weight:600;padding:0.5rem 0.9rem;cursor:pointer;${extra || ""}">${esc(txt)}</button>`;
  const sel = (id, pares, val) => `<select id="${id}" style="background:#12141d;border:1px solid #2a2d3a;border-radius:8px;
    color:#e5e7eb;font-family:inherit;font-size:0.82rem;padding:0.4rem 0.5rem;">
    ${pares.map((p) => `<option value="${esc(p[0])}" ${String(p[0]) === String(val) ? "selected" : ""}>${esc(p[1])}</option>`).join("")}</select>`;

  function pintar() {
    const cont = document.getElementById("aj-import");
    if (!cont) return;
    let html = `<p style="font-size:0.85rem;color:#9ca3af;margin:0 0 1rem;">
      Carga el CSV o el Excel que te descargas del banco. Solvento compara línea a línea con lo que ya tienes
      registrado en esa cuenta y te enseña qué falta, qué sobra y qué no cuadra. <b>No se escribe nada hasta que lo confirmas.</b></p>`;

    if (S.aviso) html += `<div style="background:#3f1d1d;border:1px solid #7f1d1d;color:#fecaca;border-radius:10px;
      padding:0.7rem 0.9rem;font-size:0.82rem;margin-bottom:1rem;">${esc(S.aviso)}</div>`;

    const cuentas = CFG.cuentas().map((c) => [c.cuenta, c.cuenta]);
    html += `<div style="display:flex;gap:0.75rem;align-items:flex-end;flex-wrap:wrap;margin-bottom:1.25rem;">
      <div><div style="font-size:0.72rem;color:#6b7280;font-weight:700;text-transform:uppercase;margin-bottom:0.3rem;">Cuenta del extracto</div>
        ${sel("imp-cuenta", cuentas, S.cuenta || cuentas[0] && cuentas[0][0])}</div>
      <div><div style="font-size:0.72rem;color:#6b7280;font-weight:700;text-transform:uppercase;margin-bottom:0.3rem;">Margen de fechas</div>
        ${sel("imp-ventana", [[0, "el mismo día"], [1, "±1 día"], [3, "±3 días"], [7, "±7 días"]], S.ventana)}</div>
      <div><div style="font-size:0.72rem;color:#6b7280;font-weight:700;text-transform:uppercase;margin-bottom:0.3rem;">Archivo</div>
        <input type="file" id="imp-file" accept=".csv,.txt,.xls,.xlsx" style="font-size:0.82rem;color:#9ca3af;"></div>
    </div>`;

    if (S.filas) html += vistaMapeo() + (S.cotejo ? vistaCotejo() : "");
    cont.innerHTML = html;

    const f = document.getElementById("imp-file");
    if (f) f.addEventListener("change", (ev) => { const x = ev.target.files[0]; if (x) abrir(x); });
    const c = document.getElementById("imp-cuenta");
    if (c) c.addEventListener("change", () => { S.cuenta = c.value; recalcular(); });
    const v = document.getElementById("imp-ventana");
    if (v) v.addEventListener("change", () => { S.ventana = Number(v.value); recalcular(); });
    ["fecha", "concepto", "importe", "saldo", "debe", "haber"].forEach((rol) => {
      const e = document.getElementById("imp-col-" + rol);
      if (e) e.addEventListener("change", () => { S.mapa[rol] = Number(e.value); recalcular(); });
    });
  }

  function abrir(file) {
    S.aviso = "";
    leerArchivo(file).then((filas) => {
      if (!filas.length) throw new Error("El archivo no tiene filas");
      S.filas = filas; S.nombre = file.name;
      S.cabecera = detectarCabecera(filas);
      S.mapa = adivinarColumnas(filas[S.cabecera], filas.slice(S.cabecera + 1, S.cabecera + 60));
      if (!S.cuenta) S.cuenta = (CFG.cuentas()[0] || {}).cuenta || "";
      recalcular();
    }).catch((e) => { S.aviso = e.message || String(e); S.filas = null; pintar(); });
  }

  function recalcular() {
    const doc = DOC();
    if (!S.filas || !doc) { pintar(); return; }
    const datos = S.filas.slice(S.cabecera + 1);
    const lineas = lineasDe(datos, S.mapa, S.cuenta);
    if (!lineas.length) {
      S.cotejo = null; S.aviso = "Con este mapeo no sale ninguna línea con fecha e importe. Revisa qué columna es cada cosa.";
      pintar(); return;
    }
    S.aviso = "";
    S.lineas = lineas;
    S.cotejo = cotejar(lineas, doc, S.cuenta, S.ventana);
    S.props = proponerTraspasos(S.cotejo.nuevas, doc, S.cuenta, S.ventana);
    // Por defecto: crear todo lo nuevo, aceptar los traspasos propuestos,
    // actualizar lo que difiere (manda el extracto) y NO borrar nada.
    S.sel = {
      nuevas: new Set(S.cotejo.nuevas.map((l) => l.ref)),
      props: new Set(S.props.map((_, i) => i)),
      difieren: new Set(S.cotejo.difieren.map((d) => d.cand.id)),
      borrar: new Set(),
    };
    pintar();
  }

  function vistaMapeo() {
    const cab = S.filas[S.cabecera] || [];
    const opts = [[-1, "— ninguna —"]].concat(cab.map((c, j) => [j, `${j + 1}. ${String(c || "(sin título)").slice(0, 28)}`]));
    const filaSel = (rol, etiqueta) => `<div><div style="font-size:0.7rem;color:#6b7280;font-weight:700;margin-bottom:0.25rem;">${etiqueta}</div>
      ${sel("imp-col-" + rol, opts, S.mapa[rol])}</div>`;
    const ejemplo = (S.lineas || []).slice(0, 3).map((l) =>
      `<tr><td style="padding:0.3rem 0.6rem;color:#9ca3af;">${esc(l.fecha)}</td>
        <td style="padding:0.3rem 0.6rem;color:#e5e7eb;">${esc(l.concepto.slice(0, 60))}</td>
        <td style="padding:0.3rem 0.6rem;text-align:right;color:${l.importe < 0 ? "#ef4444" : "#10b981"};font-weight:600;">${fmtEur(l.importe)}</td>
        <td style="padding:0.3rem 0.6rem;text-align:right;color:#6b7280;">${isFinite(l.saldo) ? fmtEur(l.saldo) : ""}</td></tr>`).join("");
    return `<div style="border:1px solid #232733;border-radius:12px;padding:1rem;margin-bottom:1.25rem;">
      <div style="font-size:0.8rem;color:#e5e7eb;font-weight:700;margin-bottom:0.15rem;">${esc(S.nombre)}</div>
      <div style="font-size:0.76rem;color:#6b7280;margin-bottom:0.9rem;">
        ${S.filas.length} filas · ${(S.lineas || []).length} líneas con fecha e importe.
        Si algo no cuadra, corrige aquí qué columna es cada cosa.</div>
      <div style="display:flex;gap:0.6rem;flex-wrap:wrap;margin-bottom:0.9rem;">
        ${filaSel("fecha", "Fecha")}${filaSel("concepto", "Concepto")}${filaSel("importe", "Importe")}
        ${filaSel("debe", "Cargo")}${filaSel("haber", "Abono")}${filaSel("saldo", "Saldo")}</div>
      ${ejemplo ? `<table style="width:100%;font-size:0.78rem;border-collapse:collapse;">${ejemplo}</table>` : ""}
    </div>`;
  }

  function lista(titulo, color, n, cuerpo, abierta) {
    if (!n) return "";
    return `<details ${abierta ? "open" : ""} style="border:1px solid #232733;border-radius:12px;padding:0.75rem 1rem;margin-bottom:0.75rem;">
      <summary style="cursor:pointer;font-size:0.85rem;font-weight:700;color:#e5e7eb;">${chip(String(n), color)}${esc(titulo)}</summary>
      <div style="margin-top:0.75rem;max-height:340px;overflow:auto;">${cuerpo}</div></details>`;
  }

  const filaLinea = (l, marca, extra) => `<div style="display:flex;align-items:center;gap:0.6rem;padding:0.35rem 0;border-bottom:1px solid #1e2130;font-size:0.8rem;">
    ${marca || ""}<span style="color:#6b7280;width:82px;flex-shrink:0;">${esc(l.fecha)}</span>
    <span style="flex:1;color:#e5e7eb;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(l.concepto || "(sin concepto)")}</span>
    <span style="color:${l.importe < 0 ? "#ef4444" : "#10b981"};font-weight:600;white-space:nowrap;">${fmtEur(l.importe)}</span>
    ${extra || ""}</div>`;

  function vistaCotejo() {
    const c = S.cotejo, p = S.props;
    const enTraspaso = new Set(p.filter((_, i) => S.sel.props.has(i)).map((x) => x.linea.ref));

    const sueltas = c.nuevas.filter((l) => !enTraspaso.has(l.ref));
    const cuerpoNuevas = sueltas.map((l) =>
      filaLinea(l, `<input type="checkbox" data-nueva="${esc(l.ref)}" ${S.sel.nuevas.has(l.ref) ? "checked" : ""}>`)).join("")
      || `<div style="color:#6b7280;font-size:0.8rem;">Todas las líneas nuevas se van a registrar como traspasos.</div>`;

    const cuerpoProps = p.map((x, i) => filaLinea(x.linea,
      `<input type="checkbox" data-prop="${i}" ${S.sel.props.has(i) ? "checked" : ""}>`,
      `<span style="color:#8b5cf6;font-size:0.74rem;font-weight:600;white-space:nowrap;">${esc(x.origen)} → ${esc(x.destino)}${x.clase === "pareja" ? " · funde el suelto" : ""}</span>`)).join("");

    const cuerpoDif = c.difieren.map((d) => filaLinea(d.linea,
      `<input type="checkbox" data-dif="${esc(d.cand.id)}" ${S.sel.difieren.has(d.cand.id) ? "checked" : ""}>`,
      `<span style="color:#6b7280;font-size:0.74rem;white-space:nowrap;">era: ${esc(String(d.cand.texto).slice(0, 30))} · ${esc(d.cand.fecha)}</span>`)).join("");

    const cuerpoSobra = c.sobrantes.map((x) => `<div style="display:flex;align-items:center;gap:0.6rem;padding:0.35rem 0;border-bottom:1px solid #1e2130;font-size:0.8rem;">
      ${x.tipo === "mov" ? `<input type="checkbox" data-borrar="${esc(x.id)}" ${S.sel.borrar.has(x.id) ? "checked" : ""}>` : `<span title="Es una operación de inversión, no un movimiento" style="width:13px;">🔒</span>`}
      <span style="color:#6b7280;width:82px;flex-shrink:0;">${esc(x.fecha)}</span>
      <span style="flex:1;color:#e5e7eb;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(x.texto)}</span>
      <span style="color:${x.efecto < 0 ? "#ef4444" : "#10b981"};font-weight:600;">${fmtEur(x.efecto)}</span></div>`).join("");

    const plan = planDe();
    const q = cuadre(S.lineas, DOC(), S.cuenta, plan);
    const linea = (ok, txt) => `<div style="font-size:0.82rem;color:${ok ? "#10b981" : "#f59e0b"};font-weight:600;margin-top:0.3rem;">${ok ? "✓" : "⚠"} ${txt}</div>`;
    const cajaCuadre = q ? `<div style="border:1px solid ${q.variacionOk && q.saldoOk !== false ? "#14532d" : "#78350f"};
        background:${q.variacionOk && q.saldoOk !== false ? "#0d1f16" : "#1f1608"};border-radius:12px;padding:0.9rem 1rem;margin:1rem 0;">
      <div style="font-size:0.78rem;color:#9ca3af;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">Cuadre · ${esc(q.desde)} a ${esc(q.hasta)}</div>
      ${linea(q.variacionOk, `El extracto suma ${fmtEur(q.sumaExtracto)} y Solvento se movería ${fmtEur(q.variacionSolvento)} en ese tramo`
        + (q.variacionOk ? "" : ` · faltan ${fmtEur(round2(q.sumaExtracto - q.variacionSolvento))}`))}
      ${q.saldoOk == null
        ? `<div style="font-size:0.82rem;color:#6b7280;margin-top:0.3rem;">· El archivo no trae columna de saldo, así que no se puede comprobar el saldo final contra el del banco.</div>`
        : linea(q.saldoOk, `Saldo del banco al ${esc(q.hasta)}: ${fmtEur(q.saldoBanco)} · Solvento quedaría en ${fmtEur(q.saldoSolvento)}`
            + (q.saldoOk ? "" : ` · descuadre de ${fmtEur(round2(q.saldoBanco - q.saldoSolvento))}, que viene de antes del archivo`))}
    </div>` : "";

    return `<div>
      ${lista("líneas nuevas, se van a registrar", "#10b981", sueltas.length, cuerpoNuevas, true)}
      ${lista("traspasos propuestos", "#8b5cf6", p.length, cuerpoProps, true)}
      ${lista("difieren · se actualizan con lo que dice el banco", "#f59e0b", c.difieren.length, cuerpoDif, false)}
      ${lista("están en Solvento y el extracto no los trae", "#ef4444", c.sobrantes.length, cuerpoSobra, true)}
      ${lista("ya registradas, no se tocan", "#6b7280", c.iguales.length, c.iguales.map((x) => filaLinea(x.linea)).join(""), false)}
      ${cajaCuadre}
      <div style="font-size:0.78rem;color:#6b7280;margin-bottom:0.75rem;">
        Se crearán <b style="color:#e5e7eb;">${plan.crear.length}</b> movimientos,
        se actualizarán <b style="color:#e5e7eb;">${plan.actualizar.length}</b> y
        se borrarán <b style="color:${plan.borrar.length ? "#ef4444" : "#e5e7eb"};">${plan.borrar.length}</b>.
        Antes de aplicar, exporta una copia en Seguridad: esto no tiene deshacer.</div>
      ${bot("Aplicar los cambios", "SolventoImport.aplicar()", "background:#166534;border-color:#166534;color:#fff;")}
      ${bot("Descartar", "SolventoImport.limpiar()", "margin-left:0.5rem;")}
    </div>`;
  }

  // Traduce las casillas marcadas en la lista de cambios a ejecutar
  function planDe() {
    const crear = [], borrar = [], actualizar = [];
    if (!S.cotejo) return { crear, borrar, actualizar };
    const props = S.props.filter((_, i) => S.sel.props.has(i));
    const enTraspaso = new Set(props.map((x) => x.linea.ref));

    props.forEach((x) => {
      crear.push(movDeLinea(x.linea, S.cuenta, { traspaso: true, origen: x.origen, destino: x.destino }));
      if (x.clase === "pareja") borrar.push(x.otro.m.id);   // el apunte suelto lo sustituye el traspaso
    });
    S.cotejo.nuevas.forEach((l) => {
      if (enTraspaso.has(l.ref) || !S.sel.nuevas.has(l.ref)) return;
      crear.push(movDeLinea(l, S.cuenta));
    });
    S.cotejo.difieren.forEach((d) => {
      if (!S.sel.difieren.has(d.cand.id) || d.cand.tipo !== "mov") return;
      actualizar.push({ id: d.cand.id, fecha: d.linea.fecha, detalle: d.linea.concepto, imp_ref: d.linea.ref });
    });
    S.cotejo.sobrantes.forEach((x) => { if (x.tipo === "mov" && S.sel.borrar.has(x.id)) borrar.push(x.id); });
    return { crear, borrar, actualizar };
  }

  function aplicar() {
    const doc = DOC();
    if (!doc || !S.cotejo) return;
    const plan = planDe();
    const q = cuadre(S.lineas, doc, S.cuenta, plan);
    const aviso = q && !q.variacionOk
      ? `El tramo importado no cuadra: el extracto suma ${fmtEur(q.sumaExtracto)} y Solvento se movería ${fmtEur(q.variacionSolvento)}. ¿Aplico igualmente?`
      : `Se van a crear ${plan.crear.length}, actualizar ${plan.actualizar.length} y borrar ${plan.borrar.length}. ¿Sigo?`;
    if (!window.confirm(aviso)) return;

    const borrar = new Set(plan.borrar);
    doc.movimientos = (doc.movimientos || []).filter((m) => !borrar.has(m.id));
    plan.actualizar.forEach((u) => {
      const m = doc.movimientos.find((x) => x.id === u.id);
      if (m) { m.fecha = u.fecha; m.detalle = u.detalle; m.imp_ref = u.imp_ref; }
    });
    plan.crear.forEach((m) => doc.movimientos.push(m));

    limpiar();
    if (window.SolventoBoot) window.SolventoBoot.saveDoc();
  }

  function limpiar() {
    S.filas = null; S.cotejo = null; S.props = null; S.lineas = null; S.aviso = "";
    pintar();
  }

  // Las casillas se delegan: la lista se repinta entera en cada cambio
  document.addEventListener("change", (ev) => {
    const t = ev.target;
    if (!t || t.type !== "checkbox" || !document.getElementById("aj-import")) return;
    const meter = (set, k) => (t.checked ? set.add(k) : set.delete(k));
    if (t.dataset.nueva != null) meter(S.sel.nuevas, t.dataset.nueva);
    else if (t.dataset.prop != null) meter(S.sel.props, Number(t.dataset.prop));
    else if (t.dataset.dif != null) meter(S.sel.difieren, t.dataset.dif);
    else if (t.dataset.borrar != null) meter(S.sel.borrar, t.dataset.borrar);
    else return;
    pintar();
  });

  window.SolventoImport = {
    pintar, aplicar, limpiar,
    // El motor se expone aparte de la interfaz para poder probarlo suelto
    _numES: numES, _fechaES: fechaES, _normCon: normCon, _refDe: refDe,
    _parsearCSV: parsearCSV, _detectarSeparador: detectarSeparador,
    _detectarCabecera: detectarCabecera, _adivinarColumnas: adivinarColumnas,
    _lineasDe: lineasDe, _cotejar: cotejar, _proponerTraspasos: proponerTraspasos,
    _cuadre: cuadre, _movDeLinea: movDeLinea, _efectoEnCuenta: efectoEnCuenta,
    _leerArchivo: leerArchivo, _planDe: planDe, _S: S,
  };
})();
