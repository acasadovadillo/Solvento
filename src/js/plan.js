/*
 * Solvento — Traer el presupuesto desde la hoja de cálculo.
 *
 * El presupuesto nació en un Excel de cinco hojas —gastos, ingresos, balance,
 * ocio e inversión— y no tiene sentido volver a teclearlo línea a línea. Esto
 * lee el .xlsx en el navegador, sin subirlo a ningún sitio, y lo convierte en
 * el presupuesto de Solvento.
 *
 * Un .xlsx es un ZIP de XML. Se lee el índice del ZIP, se descomprime cada
 * parte con DecompressionStream —el navegador ya sabe hacerlo— y de cada hoja
 * se toman los VALORES que guardó la hoja, no sus fórmulas: lo que se trae es
 * lo que se ve, no cómo se calculó, que eso ya lo calcula Solvento.
 *
 * Las hojas se reconocen por su nombre y las columnas por su cabecera
 * («Nombre», «Importe», «Frecuencia»…), no por su posición: si una columna se
 * mueve de sitio, sigue funcionando.
 */
(function () {
  "use strict";

  // ── ZIP ────────────────────────────────────────────────────────────────────
  async function leerZip(buffer) {
    const dv = new DataView(buffer), u8 = new Uint8Array(buffer);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("no es un archivo .xlsx");
    const n = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    const partes = {};
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const metodo = dv.getUint16(p + 10, true);
      const comprimido = dv.getUint32(p + 20, true);
      const lNombre = dv.getUint16(p + 28, true), lExtra = dv.getUint16(p + 30, true), lComent = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const nombre = dec.decode(u8.subarray(p + 46, p + 46 + lNombre));
      partes[nombre] = { metodo, comprimido, local };
      p += 46 + lNombre + lExtra + lComent;
    }
    const leer = async (nombre) => {
      const e = partes[nombre];
      if (!e) return null;
      const ini = e.local + 30 + dv.getUint16(e.local + 26, true) + dv.getUint16(e.local + 28, true);
      const datos = u8.subarray(ini, ini + e.comprimido);
      if (e.metodo === 0) return dec.decode(datos);
      if (e.metodo !== 8) throw new Error("compresión no soportada");
      const flujo = new Blob([datos]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return await new Response(flujo).text();
    };
    return { partes, leer };
  }

  // ── XLSX: hojas como tablas de valores ──────────────────────────────────────
  const xml = (t) => new DOMParser().parseFromString(t, "application/xml");
  const colNum = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64); return n; };
  const texto = (nodo) => Array.from(nodo.getElementsByTagName("t")).map((t) => t.textContent).join("");

  async function leerXlsx(buffer) {
    const zip = await leerZip(buffer);
    const compartidas = [];
    const ss = await zip.leer("xl/sharedStrings.xml");
    if (ss) Array.from(xml(ss).getElementsByTagName("si")).forEach((si) => compartidas.push(texto(si)));
    const libro = xml(await zip.leer("xl/workbook.xml"));
    const rels = xml(await zip.leer("xl/_rels/workbook.xml.rels"));
    const destino = {};
    Array.from(rels.getElementsByTagName("Relationship")).forEach((r) => { destino[r.getAttribute("Id")] = r.getAttribute("Target"); });
    const hojas = {};
    for (const h of Array.from(libro.getElementsByTagName("sheet"))) {
      const rid = h.getAttribute("r:id") || h.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
      let ruta = destino[rid] || "";
      ruta = ruta.startsWith("/") ? ruta.slice(1) : "xl/" + ruta.replace(/^\.\//, "");
      const cont = await zip.leer(ruta);
      if (!cont) continue;
      const celdas = {};                       // fila → { col → valor }
      Array.from(xml(cont).getElementsByTagName("c")).forEach((c) => {
        const ref = c.getAttribute("r"), tipo = c.getAttribute("t");
        const v = c.getElementsByTagName("v")[0];
        let valor = null;
        if (tipo === "s" && v) valor = compartidas[+v.textContent];
        else if (tipo === "inlineStr") valor = texto(c);
        else if (tipo === "str" && v) valor = v.textContent;
        else if (tipo === "b" && v) valor = v.textContent === "1";
        else if (tipo === "e") valor = null;                    // #REF!, #DIV/0!…
        else if (v) valor = parseFloat(v.textContent);
        if (valor === null || valor === "" || (typeof valor === "number" && !isFinite(valor))) return;
        const fila = +ref.replace(/[A-Z]+/g, "");
        (celdas[fila] = celdas[fila] || {})[colNum(ref)] = valor;
      });
      hojas[h.getAttribute("name")] = celdas;
    }
    return hojas;
  }

  // ── Del libro al presupuesto ───────────────────────────────────────────────
  const norm = (s) => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  const esNum = (x) => typeof x === "number" && isFinite(x);
  const filas = (hoja) => Object.keys(hoja).map(Number).sort((a, b) => a - b);
  const hojaCon = (hojas, palabra) => {
    const k = Object.keys(hojas).find((n) => norm(n).indexOf(palabra) >= 0);
    return k ? hojas[k] : null;
  };
  // La fila de cabecera: la primera que tiene todas las palabras pedidas.
  function cabecera(hoja, palabras) {
    for (const f of filas(hoja)) {
      const cols = {};
      Object.keys(hoja[f]).forEach((c) => { cols[norm(hoja[f][c])] = +c; });
      if (palabras.every((p) => Object.keys(cols).some((k) => k.indexOf(p) === 0))) {
        const col = (p) => cols[Object.keys(cols).find((k) => k.indexOf(p) === 0)];
        return { fila: f, col };
      }
    }
    return null;
  }
  const nuevoId = (p) => p + Math.random().toString(16).slice(2, 10);

  // Gastos e ingresos: Nombre, Importe, Frecuencia. En gastos, la columna de
  // la izquierda de «Nombre» es el grupo, y vale para las filas de debajo
  // hasta que aparece otro.
  function lineas(hoja, conGrupo) {
    if (!hoja) return [];
    const h = cabecera(hoja, ["nombre", "importe", "frecuencia"]);
    if (!h) return [];
    const cN = h.col("nombre"), cI = h.col("importe"), cF = h.col("frecuencia");
    let grupo = "";
    const out = [];
    filas(hoja).filter((f) => f > h.fila).forEach((f) => {
      const r = hoja[f];
      if (conGrupo && r[cN - 1] != null && String(r[cN - 1]).trim()) grupo = String(r[cN - 1]).trim();
      const nombre = r[cN] != null ? String(r[cN]).trim() : "";
      if (!nombre) return;
      const importe = esNum(r[cI]) ? r[cI] : 0;
      const frecuencia = esNum(r[cF]) && r[cF] > 0 ? r[cF] : 1;
      const x = { id: nuevoId(conGrupo ? "g" : "i"), nombre, importe, frecuencia };
      if (conGrupo) x.grupo = grupo;
      out.push(x);
    });
    return out;
  }

  function pctAhorro(hoja) {
    if (!hoja) return null;
    for (const f of filas(hoja)) for (const c of Object.keys(hoja[f])) {
      if (norm(hoja[f][c]).indexOf("% de ahorro") >= 0 || norm(hoja[f][c]) === "% ahorro") {
        const v = hoja[f][+c + 1];
        if (esNum(v)) return v > 1 ? v / 100 : v;
      }
    }
    return null;
  }

  function ocio(hoja) {
    if (!hoja) return [];
    const h = cabecera(hoja, ["ocio", "cantidad"]);
    if (!h) return [];
    const cN = h.col("ocio"), cC = h.col("cantidad");
    return filas(hoja).filter((f) => f >= h.fila + 1).map((f) => hoja[f])
      .filter((r) => r[cN] != null && String(r[cN]).trim())
      .map((r) => ({ id: nuevoId("o"), nombre: String(r[cN]).trim(), importe: esNum(r[cC]) ? r[cC] : 0 }));
  }

  // Inversión: la aportación, y una tabla de productos bajo la cabecera
  // «Producto». Una fila con texto en la columna de la izquierda y sin
  // producto es el título de una clase —Renta variable, Renta fija—.
  function inversion(hoja) {
    if (!hoja) return null;
    let aportacion = null;
    for (const f of filas(hoja)) for (const c of Object.keys(hoja[f])) {
      if (norm(hoja[f][c]).indexOf("aportacion") === 0) {
        const der = Object.keys(hoja[f]).map(Number).filter((x) => x > +c).sort((a, b) => a - b);
        const v = der.map((x) => hoja[f][x]).find(esNum);
        if (v != null) aportacion = v;
      }
    }
    const h = cabecera(hoja, ["producto"]);
    const productos = [];
    if (h) {
      const cP = h.col("producto");
      const fila0 = hoja[h.fila];
      const colDe = (p) => { const k = Object.keys(fila0).find((c) => norm(fila0[c]).indexOf(p) === 0); return k ? +k : null; };
      const cRed = colDe("redondeo"), cRent = colDe("5a"), cObj = colDe("% total");
      // La cabecera «Producto» puede estar sobre la columna del tipo (ETF,
      // CRYPTO) con el nombre a su derecha —una celda combinada—, o sobre el
      // nombre con el tipo a su izquierda. Se mira dónde hay texto debajo.
      const debajo = filas(hoja).filter((x) => x > h.fila);
      const texto = (v) => typeof v === "string" && v.trim() && norm(v) !== "total";
      const nombreDerecha = debajo.some((f) => texto(hoja[f][cP + 1]));
      const cN = nombreDerecha ? cP + 1 : cP, cT = cN - 1;
      let clase = "";
      for (const f of debajo) {
        const r = hoja[f];
        const izq = r[cT] != null ? String(r[cT]).trim() : "";
        const prod = r[cN] != null ? String(r[cN]).trim() : "";
        if (norm(izq) === "total" || norm(prod) === "total") break;
        if (!prod) { if (izq) clase = izq; continue; }
        // El porcentaje del producto está dos columnas a la derecha de su
        // nombre, o en la de al lado cuando es el único de su clase y esa
        // columna guarda a la vez el total de la clase.
        const pct = esNum(r[cN + 2]) ? r[cN + 2] : (esNum(r[cN + 1]) ? r[cN + 1] : 0);
        productos.push({
          id: nuevoId("p"), clase, tipo: izq, nombre: prod, pct,
          objetivo: cObj && esNum(r[cObj]) ? r[cObj] : null,
          redondeo: cRed && esNum(r[cRed]) ? r[cRed] : null,
          rent5a: cRent && esNum(r[cRent]) ? r[cRent] : null,
        });
      }
    }
    return { aportacion, productos };
  }

  async function importarXlsx(buffer) {
    const hojas = await leerXlsx(buffer);
    const plan = {
      gastos: lineas(hojaCon(hojas, "gasto"), true),
      ingresos: lineas(hojaCon(hojas, "ingreso"), false),
      pct_ahorro: pctAhorro(hojaCon(hojas, "balance")),
      ocio: ocio(hojaCon(hojas, "ocio")),
      inversion: inversion(hojaCon(hojas, "inversion")) || { aportacion: null, productos: [] },
    };
    if (plan.pct_ahorro == null) plan.pct_ahorro = 0.5;
    if (!plan.gastos.length && !plan.ingresos.length && !plan.ocio.length && !plan.inversion.productos.length) {
      throw new Error("no he encontrado hojas de gastos, ingresos, ocio ni inversión");
    }
    return plan;
  }

  window.SolventoPlan = { importarXlsx, leerXlsx };
})();
