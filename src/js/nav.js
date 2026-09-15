/*
 * Solvento — Valores liquidativos subidos por ti.
 *
 * Hasta ahora el precio de cada activo llegaba de fuera: un proceso descarga
 * de Yahoo lo que cotiza y lo deja en prices.json, y lo que no cotiza se
 * escribía a mano en un formulario, un valor cada vez. Aquí se le da la vuelta:
 * el histórico de valores liquidativos lo traes TÚ —de la gestora, del bróker,
 * de donde lo publiquen— en un archivo de dos columnas, fecha y valor, y ese
 * archivo manda. Yahoo se queda de respaldo para lo que no hayas subido.
 *
 * Cada activo tiene su archivo, con nombre fijo para que no haya que llevar
 * un índice de qué hay:
 *
 *     nav/historical-nav_<ticker>_<isin>.csv
 *
 * y dentro, «fecha,valor» con la fecha en ISO y el valor con punto: el formato
 * en el que se guarda es siempre el mismo, sea cual sea el formato en el que
 * llegó. Un valor liquidativo es un dato público del mercado, no dice nada de
 * ti, así que viaja en claro y cualquiera podría reutilizarlo.
 *
 * Los archivos viven en el repositorio, junto al bloque cifrado, y se leen por
 * raw.githubusercontent como todo lo demás.
 */
(function () {
  "use strict";
  const CFG = window.SolventoConfig;
  const CARPETA = "nav/";
  const DIAS_AVISO = 7;

  // La clave de un activo: su ISIN, y si no lo tiene, su nombre. Es la misma
  // que usa el modelo para juntar operaciones.
  const claveDe = (a) => {
    const isin = String(a.isin || "").trim();
    return isin && isin !== "-" ? isin : String(a.nombre || "").trim();
  };
  const limpio = (s) => String(s || "").trim().replace(/[^A-Za-z0-9.\-]+/g, "-").replace(/^-+|-+$/g, "");
  function archivoDe(a) {
    const isin = String(a.isin || "").trim();
    const ticker = limpio(a.yf || a.ticker || a.nombre) || "activo";
    return CARPETA + "historical-nav_" + ticker + (isin && isin !== "-" ? "_" + limpio(isin) : "") + ".csv";
  }

  // ── Leer lo que venga ──────────────────────────────────────────────────────
  // Dos columnas, fecha y valor, y todo lo demás da igual: separador «;», «,»
  // o tabulador; fecha como 02/01/2024, 2024-01-02 o 02-01-2024; el valor con
  // coma o con punto; una cabecera si la hay; comillas si las hay. Es lo que
  // sale de cualquier gestora o de cualquier hoja de cálculo sin tener que
  // retocarlo antes.
  function leerFecha(s) {
    s = String(s || "").trim().replace(/"/g, "");
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
    m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/.exec(s);
    if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1]);
    return null;
  }
  function leerValor(s) {
    s = String(s || "").trim().replace(/"/g, "").replace(/\s|€/g, "");
    // «1.234,56» → 1234.56 ; «1,234.56» → 1234.56 ; «13,94» → 13.94 ; «13.94» → 13.94
    if (/,\d{1,2}$/.test(s) && /\./.test(s)) s = s.replace(/\./g, "").replace(",", ".");
    else if (/\.\d{1,2}$/.test(s) && /,/.test(s)) s = s.replace(/,/g, "");
    else s = s.replace(",", ".");
    const v = parseFloat(s);
    return isFinite(v) && v > 0 ? v : null;
  }
  function parsear(texto) {
    const porFecha = {};
    String(texto || "").split(/\r?\n/).forEach((linea) => {
      if (!linea.trim()) return;
      const sep = linea.indexOf(";") >= 0 ? ";" : (linea.indexOf("\t") >= 0 ? "\t" : ",");
      const partes = linea.split(sep);
      if (partes.length < 2) return;
      // Con coma como separador y coma decimal, «02/01/2024,13,94» son tres
      // trozos: la fecha es el primero y el valor, el resto pegado.
      const fecha = leerFecha(partes[0]);
      const valor = leerValor(sep === "," && partes.length > 2 ? partes.slice(1).join(",") : partes[1]);
      if (fecha == null || valor == null) return;      // cabecera, o basura
      porFecha[fecha] = valor;                          // la última línea de un día manda
    });
    return Object.keys(porFecha).map((t) => [+t, porFecha[t]]).sort((a, b) => a[0] - b[0]);
  }
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const serializar = (serie) => "fecha,valor\n" + serie.map((p) => iso(p[0]) + "," + p[1]).join("\n") + "\n";

  // Juntar lo subido con lo que ya había: por fecha, y lo nuevo pisa.
  function fusionar(vieja, nueva) {
    const m = {};
    (vieja || []).forEach((p) => { m[p[0]] = p[1]; });
    (nueva || []).forEach((p) => { m[p[0]] = p[1]; });
    return Object.keys(m).map((t) => [+t, m[t]]).sort((a, b) => a[0] - b[0]);
  }

  // ── Cargar lo que hay publicado ────────────────────────────────────────────
  // Un archivo por activo, en paralelo. El que no exista da 404 y no pasa nada:
  // ese activo sigue con Yahoo o con lo escrito a mano.
  const rawBase = () => `https://raw.githubusercontent.com/${CFG.SYNC.owner}/${CFG.SYNC.repo}/${CFG.SYNC.branch}/`;
  let CARGADO = {};      // clave → { serie, ultimo, n, archivo, activo }
  async function cargar(activos) {
    const lista = (activos || []).filter((a) => claveDe(a));
    const res = await Promise.all(lista.map(async (a) => {
      const archivo = archivoDe(a);
      try {
        const r = await fetch(rawBase() + archivo + "?_=" + Date.now(), { cache: "no-store" });
        if (!r.ok) return null;
        const serie = parsear(await r.text());
        if (!serie.length) return null;
        return { clave: claveDe(a), serie, ultimo: serie[serie.length - 1][0], n: serie.length, archivo, activo: a };
      } catch (e) { return null; }
    }));
    // Lo que acabas de subir no se pierde porque la copia pública de GitHub
    // tarde unos segundos en refrescarse: lo que ya está en memoria se junta
    // con lo que llega, y si lo tuyo es más nuevo, lo tuyo se queda.
    const nuevo = {};
    res.forEach((x) => { if (x) nuevo[x.clave] = x; });
    Object.keys(CARGADO).forEach((k) => {
      const mem = CARGADO[k], red = nuevo[k];
      if (!red) { nuevo[k] = mem; return; }
      const serie = fusionar(red.serie, mem.serie);
      nuevo[k] = Object.assign({}, red, { serie, ultimo: serie[serie.length - 1][0], n: serie.length });
    });
    CARGADO = nuevo;
    return CARGADO;
  }
  const todo = () => CARGADO;
  const de = (clave) => CARGADO[clave] || null;

  // Lo que el modelo necesita: la serie [[t, valor]…] y el último valor.
  function aplicarA(prices) {
    prices = prices || {};
    prices.nav = {};
    Object.keys(CARGADO).forEach((k) => { prices.nav[k] = CARGADO[k].serie; });
    return prices;
  }

  // ── Subir un archivo ───────────────────────────────────────────────────────
  async function importar(activo, texto, token) {
    const nueva = parsear(texto);
    if (!nueva.length) throw new Error("no he encontrado ninguna línea con fecha y valor");
    const clave = claveDe(activo);
    const previa = CARGADO[clave] ? CARGADO[clave].serie : [];
    const serie = fusionar(previa, nueva);
    const archivo = archivoDe(activo);
    await window.SolventoSync.ghPutArchivo(token, archivo, serializar(serie),
      "Solvento: valores liquidativos de " + (activo.nombre || clave));
    CARGADO[clave] = { clave, serie, ultimo: serie[serie.length - 1][0], n: serie.length, archivo, activo };
    return { nuevas: nueva.length, total: serie.length, ultimo: serie[serie.length - 1][0] };
  }

  // ── Frescura ───────────────────────────────────────────────────────────────
  // Cuántos días lleva un activo sin un valor nuevo, venga de donde venga: de
  // lo subido, de Yahoo o de lo escrito a mano. Siete o más, y se avisa.
  function ultimaFecha(activo, prices, db) {
    const clave = claveDe(activo);
    if (CARGADO[clave]) return CARGADO[clave].ultimo;
    const hist = prices && prices.hist && activo.yf ? prices.hist[activo.yf] : null;
    if (hist && hist.length) return hist[hist.length - 1][0];
    const nav = db && db.nav && activo.isin ? db.nav[activo.isin] : null;
    if (nav && nav.length) {
      let t = null;
      nav.forEach((p) => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(p.fecha || ""); if (m) { const x = Date.UTC(+m[3], +m[2] - 1, +m[1]); if (t == null || x > t) t = x; } });
      return t;
    }
    return null;
  }
  function frescura(activo, prices, db) {
    const t = ultimaFecha(activo, prices, db);
    if (t == null) return { dias: null, aviso: true, fecha: null };
    const dias = Math.floor((Date.now() - t) / 86400000);
    return { dias, aviso: dias >= DIAS_AVISO, fecha: iso(t), fuente: CARGADO[claveDe(activo)] ? "subido" : (activo.yf && prices && prices.hist && prices.hist[activo.yf] ? "yahoo" : "manual") };
  }

  window.SolventoNav = { claveDe, archivoDe, parsear, serializar, fusionar, cargar, todo, de, aplicarA, importar, frescura, ultimaFecha, DIAS_AVISO, CARPETA };
})();
