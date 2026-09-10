/*
 * Prueba de humo del motor de cálculo. Sin navegador y sin datos reales.
 *
 * No comprueba que la aplicación se vea bien —para eso está el banco de
 * pruebas—, sino que las cuentas cuadran entre sí. Son invariantes: cosas que
 * TIENEN que cumplirse pase lo que pase, y que si un día dejan de cumplirse
 * significan que algo se ha roto aunque la pantalla parezca normal.
 *
 *   jsc tools/pruebas/humo.js        (macOS)
 *   node tools/pruebas/humo.js
 */
var RAIZ = (function () {
  var p = typeof arguments !== "undefined" ? "" : "";
  return p;
})();

var leer, salir;
if (typeof read === "function") {            // JavaScriptCore
  leer = read; salir = function (c) { if (c) throw new Error("fallo"); };
} else {                                     // Node
  var fs = require("fs");
  leer = function (f) { return fs.readFileSync(f, "utf8"); };
  salir = function (c) { process.exit(c); };
  global.print = console.log;
}

var base = "";
var window = {}, document = {}, localStorage = { getItem: function () { return null; }, setItem: function () {} };
eval(leer(base + "src/js/config.js"));
var doc = JSON.parse(leer(base + "tools/pruebas/datos-ejemplo.json"));
window.SolventoConfig.usarDoc(doc);
eval(leer(base + "src/js/model.js"));
var precios = {};
try { precios = JSON.parse(leer(base + "prices.json")); } catch (e) {}

var M = window.SolventoModel;
var fallos = [];
function comprobar(nombre, condicion, detalle) {
  if (condicion) { print("  ✓ " + nombre); return; }
  fallos.push(nombre + (detalle ? " — " + detalle : ""));
  print("  ✗ " + nombre + (detalle ? " — " + detalle : ""));
}
var cerca = function (a, b) { return Math.abs(a - b) < 0.02; };

print("Prueba de humo · documento de ejemplo\n");

var m = M.build(doc, precios);
comprobar("el modelo se construye", m && isFinite(m.patrimonioNeto), "patrimonio=" + (m && m.patrimonioNeto));
comprobar("el patrimonio es la suma de sus partes",
  cerca(m.patrimonioNeto, m.patrimonioLiquido + m.carteraTotal + m.inm.total + m.cobrar.total - m.pas.total));
comprobar("ninguna cuenta sale con saldo no numérico",
  m.saldos.every(function (c) { return isFinite(c.saldo); }));

var s = M.buildSeries(doc, precios);
comprobar("hay tres series y miden lo mismo",
  s.caja.length === s.cartera.length && s.cartera.length === s.patrimonio.length);
comprobar("la serie de caja termina en el saldo de caja",
  cerca(s.caja[s.caja.length - 1][1], m.patrimonioLiquido),
  s.caja[s.caja.length - 1][1] + " vs " + m.patrimonioLiquido);

var f = M.flujoMensual(doc);
var suma = f.meses.reduce(function (t, x) { return t + x.neto; }, 0);
comprobar("la suma de los flujos mensuales es la caja de hoy",
  cerca(suma, m.patrimonioLiquido), suma.toFixed(2) + " vs " + m.patrimonioLiquido);

var g = M.buildGastos(doc);
comprobar("cada mes cuadra ingresos menos gastos con su ahorro",
  g.meses.every(function (x) { return cerca(x.ingresos - x.gastos, x.ahorro); }));

var arbol = M.arbolCategorias(g.meses[g.meses.length - 1].catGasto);
var sumaRamas = arbol.reduce(function (t, n) { return t + n.total; }, 0);
comprobar("el árbol de categorías suma el gasto del mes",
  cerca(sumaRamas, g.meses[g.meses.length - 1].gastos));

var centros = M.resumenCentros(doc.movimientos);
comprobar("los centros incluyen lo que cuelga de ellos",
  centros["Inmuebles"] && centros["Inmuebles"].gasto >= (centros["Inmuebles > El Piso"] || {}).gasto);

var pres = M.resumenPrestamos(doc.movimientos);
comprobar("un préstamo devuelto queda saldado", pres.teDeben === 0, "te deben " + pres.teDeben);

comprobar("no hay movimientos sin identificar", M.pendientes(doc.movimientos).n === 0);

var rev = M.revision(doc, precios);
comprobar("la revisión no encuentra errores en los datos de ejemplo",
  rev.errores === 0, rev.avisos.filter(function (a) { return a.nivel === "error"; }).map(function (a) { return a.titulo; }).join(", "));

// Un derecho de cobro es un activo, pero no es caja: sube el patrimonio
// exactamente su importe y no toca ni un céntimo de las cuentas.
var cobros = M.cobrosPendientes(doc);
var sinCobros = JSON.parse(JSON.stringify(doc)); sinCobros.cobros = [];
var msc = M.build(sinCobros, precios);
comprobar("un cobro pendiente suma al patrimonio y no a la caja",
  cobros.total > 0 && cerca(msc.patrimonioNeto + cobros.total, m.patrimonioNeto) &&
  cerca(msc.patrimonioLiquido, m.patrimonioLiquido),
  "cobros=" + cobros.total);

// La promesa grande del balance: prestar dinero no te empobrece, lo cambia de
// sitio. Si esto deja de cumplirse, es que lo que te deben ha dejado de contar.
var conPrestamo = JSON.parse(JSON.stringify(doc));
conPrestamo.movimientos.push({
  id: "m-prueba-prestamo", fecha: "01/09/2026", tipo: "Préstamo", importe: "500",
  tipo_prestamo: "Dinero prestado", persona_prestamo: "Alguien Nuevo",
  cuenta_origen: "Banco Uno", cuenta_destino: ""
});
var mp = M.build(conPrestamo, precios);
comprobar("prestar dinero no cambia el patrimonio, lo cambia de sitio",
  cerca(mp.patrimonioNeto, m.patrimonioNeto) && cerca(mp.patrimonioLiquido, m.patrimonioLiquido - 500),
  "neto " + mp.patrimonioNeto + " vs " + m.patrimonioNeto);

// Y su contrario: dar algo por incobrable sí es una pérdida, y tiene que verse.
var conPerdida = JSON.parse(JSON.stringify(conPrestamo));
conPerdida.movimientos.push({
  id: "m-prueba-perdida", fecha: "02/09/2026", tipo: "Préstamo", importe: "500",
  tipo_prestamo: "Incobrable", persona_prestamo: "Alguien Nuevo",
  cuenta_origen: "", cuenta_destino: ""
});
var mi = M.build(conPerdida, precios);
comprobar("dar un préstamo por incobrable resta del patrimonio y no toca la caja",
  cerca(mi.patrimonioNeto, m.patrimonioNeto - 500) && cerca(mi.patrimonioLiquido, mp.patrimonioLiquido),
  "neto " + mi.patrimonioNeto);

print("");
if (fallos.length) { print(fallos.length + " comprobación(es) fallidas"); salir(1); }
print("todo en orden");
