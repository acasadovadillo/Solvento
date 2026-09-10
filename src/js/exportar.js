/*
 * Solvento — Llevarte los datos a una hoja de cálculo (.xlsx y .csv).
 *
 * Todo pasa en tu navegador: el archivo se arma aquí y se descarga desde aquí.
 * Nada sale a ningún servidor, igual que el resto de la aplicación.
 *
 * Por qué el .xlsx se escribe a mano, sin librería: un .xlsx es un ZIP con unos
 * cuantos XML dentro, y eso cabe en este archivo. Traerse una librería de medio
 * mega para escribir seis hojas significaría un recurso más que cachear, una
 * dependencia externa que auditar y una app que deja de funcionar sin conexión.
 * No compensa.
 *
 * Ojo con lo que sale por esta puerta: estos archivos van SIN CIFRAR. Son para
 * mirar y borrar, no para guardar.
 */
(function () {
  "use strict";

  const M = () => window.SolventoModel;
  const num = (x) => {
    const n = Number(String(x == null ? "" : x).replace(",", ".").trim());
    return isFinite(n) ? n : null;
  };

  // ── ZIP (método «store», sin comprimir) ───────────────────────────────────
  const TABLA_CRC = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  const utf8 = (s) => new TextEncoder().encode(s);

  function zip(archivos) {
    const partes = [], central = [];
    let offset = 0;
    const ahora = new Date();
    const hora = ((ahora.getHours() << 11) | (ahora.getMinutes() << 5) | (ahora.getSeconds() >> 1)) & 0xFFFF;
    const fecha = (((ahora.getFullYear() - 1980) << 9) | ((ahora.getMonth() + 1) << 5) | ahora.getDate()) & 0xFFFF;

    for (const a of archivos) {
      const nombre = utf8(a.nombre), datos = a.datos;
      const crc = crc32(datos);
      const cab = new DataView(new ArrayBuffer(30));
      cab.setUint32(0, 0x04034b50, true);   // firma local
      cab.setUint16(4, 20, true);           // versión necesaria
      cab.setUint16(6, 0x0800, true);       // nombres en UTF-8
      cab.setUint16(8, 0, true);            // sin comprimir
      cab.setUint16(10, hora, true); cab.setUint16(12, fecha, true);
      cab.setUint32(14, crc, true);
      cab.setUint32(18, datos.length, true); cab.setUint32(22, datos.length, true);
      cab.setUint16(26, nombre.length, true); cab.setUint16(28, 0, true);
      partes.push(new Uint8Array(cab.buffer), nombre, datos);

      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true);   // firma de directorio
      cen.setUint16(4, 20, true); cen.setUint16(6, 20, true);
      cen.setUint16(8, 0x0800, true); cen.setUint16(10, 0, true);
      cen.setUint16(12, hora, true); cen.setUint16(14, fecha, true);
      cen.setUint32(16, crc, true);
      cen.setUint32(20, datos.length, true); cen.setUint32(24, datos.length, true);
      cen.setUint16(28, nombre.length, true);
      cen.setUint32(42, offset, true);
      central.push(new Uint8Array(cen.buffer), nombre);
      offset += 30 + nombre.length + datos.length;
    }

    const tamCentral = central.reduce((s, x) => s + x.length, 0);
    const fin = new DataView(new ArrayBuffer(22));
    fin.setUint32(0, 0x06054b50, true);
    fin.setUint16(8, archivos.length, true); fin.setUint16(10, archivos.length, true);
    fin.setUint32(12, tamCentral, true); fin.setUint32(16, offset, true);
    return new Blob(partes.concat(central, [new Uint8Array(fin.buffer)]),
                    { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  // ── XLSX ──────────────────────────────────────────────────────────────────
  const xmlEsc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // XML no admite caracteres de control; si se cuela uno, Excel da el archivo por corrupto.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

  const col = (i) => {              // 0 → A, 26 → AA
    let s = "";
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  };

  // Fecha de Excel: días desde el 30/12/1899. Se escribe como número con
  // formato de fecha para que la hoja pueda ordenar y agrupar por meses; en
  // texto, «05/07/2026» es una cadena y no se puede sumar por trimestres.
  function serieFecha(txt) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(txt || "").trim());
    if (!m) return null;
    const d = Date.UTC(+m[3], +m[2] - 1, +m[1]);
    return Math.round((d - Date.UTC(1899, 11, 30)) / 86400000);
  }

  // Tipos de celda: 1 = fecha, 2 = dinero, 0 = texto.
  function celda(ref, valor, tipo) {
    if (valor == null || valor === "") return "";
    if (tipo === 1) {
      const s = serieFecha(valor);
      if (s == null) return `<c r="${ref}" t="inlineStr"><is><t>${xmlEsc(valor)}</t></is></c>`;
      return `<c r="${ref}" s="1"><v>${s}</v></c>`;
    }
    if (tipo === 2) {
      const n = num(valor);
      if (n == null) return "";
      return `<c r="${ref}" s="2"><v>${n}</v></c>`;
    }
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(valor)}</t></is></c>`;
  }

  function hoja(cabeceras, filas, tipos) {
    const fila0 = `<row r="1">${cabeceras.map((c, i) => celda(col(i) + "1", c, 0)).join("")}</row>`;
    const cuerpo = filas.map((f, r) =>
      `<row r="${r + 2}">${f.map((v, i) => celda(col(i) + (r + 2), v, tipos[i] || 0)).join("")}</row>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>${fila0}${cuerpo}</sheetData></worksheet>`;
  }

  function libro(hojas) {
    const rels = hojas.map((h, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("");
    const archivos = [
      { nombre: "[Content_Types].xml", datos: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${hojas.map((h, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}
</Types>`) },
      { nombre: "_rels/.rels", datos: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`) },
      { nombre: "xl/workbook.xml", datos: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${hojas.map((h, i) => `<sheet name="${xmlEsc(h.nombre)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>
</workbook>`) },
      { nombre: "xl/_rels/workbook.xml.rels", datos: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}
<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`) },
      // Dos formatos: fecha corta y dinero con dos decimales. Nada más: esto es
      // una exportación para trabajar, no un informe maquetado.
      { nombre: "xl/styles.xml", datos: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>
<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`) },
    ];
    hojas.forEach((h, i) => archivos.push({ nombre: `xl/worksheets/sheet${i + 1}.xml`, datos: utf8(h.xml) }));
    return zip(archivos);
  }

  // ── Qué se lleva cada hoja ────────────────────────────────────────────────
  function hojasDelDoc(doc) {
    const hojas = [];
    const mete = (nombre, cabeceras, tipos, filas) => {
      hojas.push({ nombre, xml: hoja(cabeceras, filas, tipos) });
    };

    mete("Movimientos",
      ["Fecha", "Tipo", "Importe", "Cuenta origen", "Cuenta destino", "Categoría de gasto",
       "Categoría de ingreso", "Centro de coste", "Tipo de préstamo", "Persona", "Detalle",
       "Según el banco", "Referencia"],
      [1, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      (doc.movimientos || []).map((m) => [m.fecha, m.tipo, m.importe, m.cuenta_origen, m.cuenta_destino,
        m.tipo_gasto, m.tipo_ingreso, m.centro, m.tipo_prestamo, m.persona_prestamo, m.detalle,
        m.detalle_banco, m.imp_ref]));

    mete("Operaciones",
      ["Fecha", "Operación", "Activo", "ISIN", "Unidades", "Coste (€)", "Cuenta"],
      [1, 0, 0, 0, 2, 2, 0],
      (doc.inversiones || []).map((r) => [r.fecha, r.tipo_movimiento || "Compra", r.nombre, r.isin,
        r.unidades, r.coste, r.cuenta]));

    mete("Propiedades",
      ["Nombre", "Tipo", "Valor actual (€)", "Compra (€)", "Fecha de compra", "Centro de coste", "Alquilada"],
      [0, 0, 2, 2, 1, 0, 0],
      (doc.propiedades || doc.inmuebles || []).map((r) => [r.nombre || r.concepto, r.tipo,
        r.tasacion != null ? r.tasacion : r.valor, r.coste, r.fecha_adquisicion, r.centro,
        r.alquilada ? "Sí" : "No"]));

    mete("Pasivos", ["Deuda", "Tipo", "Entidad", "Pendiente (€)"], [0, 0, 0, 2],
      (doc.pasivos || []).map((d) => [d.nombre || d.concepto, d.tipo, d.entidad, d.importe]));

    mete("Cobros pendientes",
      ["Quién", "Concepto", "Importe (€)", "Desde", "Categoría de ingreso", "Centro de coste", "Incobrable"],
      [0, 0, 2, 1, 0, 0, 0],
      (doc.cobros || []).map((c) => [c.persona, c.concepto, c.importe, c.fecha, c.categoria, c.centro,
        c.incobrable ? "Sí" : ""]));

    // Una hoja de cierre con las cifras que la aplicación calcula, para que el
    // que abra el Excel no tenga que rehacerlas a mano para cuadrar.
    try {
      const m = M().build(doc, window.__PRICES || {});
      const filas = m.saldos.map((s) => [s.cuenta, s.saldo]);
      filas.push([], ["Caja", m.patrimonioLiquido], ["Cartera", m.carteraTotal],
                 ["Propiedades", m.inm.total], ["Por cobrar", (m.cobrar || {}).total || 0],
                 ["Pasivos", -m.pas.total], [], ["Patrimonio neto", m.patrimonioNeto]);
      mete("Saldos", ["Concepto", "Importe (€)"], [0, 2], filas);
    } catch (e) { /* si el modelo falla, el resto de hojas siguen valiendo */ }

    return hojas;
  }

  // ── CSV ───────────────────────────────────────────────────────────────────
  // Punto y coma y coma decimal: es lo que espera un Excel en español. Y el BOM
  // por delante, porque sin él las tildes salen rotas al abrirlo con doble clic.
  function csvMovimientos(doc) {
    const cab = ["Fecha", "Tipo", "Importe", "Cuenta origen", "Cuenta destino", "Categoría de gasto",
                 "Categoría de ingreso", "Centro de coste", "Tipo de préstamo", "Persona", "Detalle",
                 "Según el banco", "Referencia"];
    const campo = (v) => {
      const s = String(v == null ? "" : v);
      return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const importe = (v) => { const n = num(v); return n == null ? "" : n.toFixed(2).replace(".", ","); };
    const filas = (doc.movimientos || []).map((m) => [m.fecha, m.tipo, importe(m.importe),
      m.cuenta_origen, m.cuenta_destino, m.tipo_gasto, m.tipo_ingreso, m.centro, m.tipo_prestamo,
      m.persona_prestamo, m.detalle, m.detalle_banco, m.imp_ref].map(campo).join(";"));
    return "﻿" + [cab.map(campo).join(";")].concat(filas).join("\r\n") + "\r\n";
  }

  // ── Descarga ──────────────────────────────────────────────────────────────
  function bajar(blob, nombre) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const hoy = () => {
    const d = new Date(), p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  function aviso(doc) {
    const n = (doc.movimientos || []).length;
    return window.confirm(
      `Vas a descargar ${n} movimientos SIN CIFRAR, en un archivo que cualquiera puede abrir.\n\n` +
      "Es para trabajar con ellos en una hoja de cálculo. Bórralo cuando termines.\n\n¿Sigo?");
  }

  function aExcel() {
    const doc = window.SolventoDB && window.SolventoDB.state.doc;
    if (!doc) return null;
    if (!aviso(doc)) return false;
    bajar(libro(hojasDelDoc(doc)), `solvento-${hoy()}.xlsx`);
    return true;
  }
  function aCsv() {
    const doc = window.SolventoDB && window.SolventoDB.state.doc;
    if (!doc) return null;
    if (!aviso(doc)) return false;
    bajar(new Blob([csvMovimientos(doc)], { type: "text/csv;charset=utf-8" }),
          `solvento-movimientos-${hoy()}.csv`);
    return true;
  }

  window.SolventoExportar = { aExcel, aCsv, _internals: { zip, libro, hojasDelDoc, csvMovimientos, serieFecha } };
})();
