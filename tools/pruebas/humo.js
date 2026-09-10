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

// ── La tarjeta de crédito ────────────────────────────────────────────────────
// Comprar con una tarjeta no saca dinero: crea deuda. El dinero sale una vez al
// mes, cuando llega el recibo. Y ese recibo, que es el movimiento que más se
// malinterpreta de toda la aplicación, no te empobrece ni un céntimo: baja la
// caja y baja la deuda exactamente lo mismo.
var tjs = M.tarjetas(doc);
comprobar("la tarjeta se reconoce y sabe por qué cuenta se cobra",
  tjs.length === 1 && tjs[0].cuenta === "Banco Uno", JSON.stringify(tjs));

// En el documento de ejemplo la tarjeta está saldada, así que el ciclo vivo se
// monta aquí: dos compras de septiembre sin recibo todavía. Es exactamente la
// situación en la que se abre el formulario del recibo.
var TJ = tjs[0].nombre;
var conCargos = JSON.parse(JSON.stringify(doc));
conCargos.movimientos.push(
  { id: "m-prueba-c1", fecha: "04/09/2026", tipo: "Gasto", importe: "60.20",
    cuenta_origen: TJ, cuenta_destino: "", tipo_gasto: "Compras", detalle: "Compra de prueba" },
  { id: "m-prueba-c2", fecha: "18/09/2026", tipo: "Gasto", importe: "42.10",
    cuenta_origen: TJ, cuenta_destino: "", tipo_gasto: "Compras", detalle: "Compra de prueba" });
var mc = M.build(conCargos, precios);

var ciclo = M.cicloTarjeta(TJ, conCargos.movimientos, null, null);
var enPasivos = mc.pas.items.filter(function (x) { return x.nombre === TJ; })[0];
comprobar("lo pendiente en la tarjeta es su saldo en pasivos",
  cerca(ciclo.pendiente, 102.30) && cerca(ciclo.pendiente, enPasivos.importe),
  ciclo.pendiente + " vs " + (enPasivos && enPasivos.importe));
comprobar("lo pendiente es el arrastre más lo cargado en el ciclo",
  cerca(ciclo.pendiente, ciclo.arrastre + ciclo.cargado) && ciclo.n === 2);
comprobar("comprar con la tarjeta no toca la caja, sube la deuda",
  cerca(mc.patrimonioLiquido, m.patrimonioLiquido) &&
  cerca(mc.pas.total, m.pas.total + 102.30),
  "caja " + mc.patrimonioLiquido + " vs " + m.patrimonioLiquido);

var recibo = { id: "m-prueba-recibo", fecha: "30/09/2026", tipo: "Traspaso",
               importe: String(ciclo.pendiente), cuenta_origen: "Banco Uno",
               cuenta_destino: TJ, detalle: "Recibo de prueba" };
var rev2 = M.revisarLiquidacion(conCargos, recibo);
comprobar("el recibo por lo pendiente cuadra y deja la tarjeta a cero",
  rev2 && rev2.cuadra && cerca(rev2.saldoDespues, 0), rev2 && JSON.stringify(rev2.diferencia));
comprobar("un recibo de más avisa de la diferencia exacta",
  cerca(M.revisarLiquidacion(conCargos, Object.assign({}, recibo,
        { importe: String(ciclo.pendiente + 35) })).diferencia, 35));
comprobar("un traspaso entre cuentas normales no es una liquidación",
  M.revisarLiquidacion(conCargos, { tipo: "Traspaso", importe: "10", fecha: "30/09/2026",
                                    cuenta_origen: "Banco Uno", cuenta_destino: "Banco Dos" }) === null);

var conRecibo = JSON.parse(JSON.stringify(conCargos));
conRecibo.movimientos.push(recibo);
var mr = M.build(conRecibo, precios);
comprobar("pagar el recibo de la tarjeta no cambia el patrimonio: baja la caja y baja la deuda",
  cerca(mr.patrimonioNeto, mc.patrimonioNeto) &&
  cerca(mr.patrimonioLiquido, mc.patrimonioLiquido - ciclo.pendiente) &&
  cerca(mr.pas.total, mc.pas.total - ciclo.pendiente),
  "neto " + mr.patrimonioNeto + " vs " + mc.patrimonioNeto);
var salidasDe = function (d) {
  var mes = M.flujoMensual(d).meses.filter(function (x) { return x.ym === "2026-09"; })[0];
  return mes ? mes.salidas : 0;
};
comprobar("y el recibo sale de la caja el mes en que se paga",
  cerca(salidasDe(conRecibo), salidasDe(conCargos) + ciclo.pendiente),
  salidasDe(conRecibo) + " vs " + salidasDe(conCargos));

// Lo comprado después del recibo es del ciclo siguiente, no del que se paga:
// ese desfase es cómo funciona una tarjeta, no un error que haya que parchear.
var conPosterior = JSON.parse(JSON.stringify(conRecibo));
conPosterior.movimientos.push({ id: "m-prueba-post", fecha: "02/10/2026", tipo: "Gasto",
  importe: "40", cuenta_origen: TJ, cuenta_destino: "", tipo_gasto: "Compras" });
comprobar("una compra posterior al recibo no entra en el recibo",
  cerca(M.cicloTarjeta(TJ, conPosterior.movimientos, "30/09/2026", "m-prueba-recibo").pendiente, ciclo.pendiente) &&
  cerca(M.cicloTarjeta(TJ, conPosterior.movimientos, null, null).pendiente, 40));

// Y el caso que dispara todo esto: un recibo por MÁS de lo que la tarjeta debe
// la deja en negativo y arrastra ese saldo a favor al ciclo siguiente.
var conExceso = JSON.parse(JSON.stringify(conCargos));
conExceso.movimientos.push(Object.assign({}, recibo, { importe: String(ciclo.pendiente + 35) }));
var cx = M.cicloTarjeta(TJ, conExceso.movimientos, null, null);
comprobar("pagar de más deja la tarjeta a favor y se arrastra al ciclo siguiente",
  cerca(cx.pendiente, -35) && cerca(cx.arrastre, -35), "pendiente " + cx.pendiente);

// ── El menú lateral ─────────────────────────────────────────────────────────
// El catálogo de páginas y el HTML tienen que hablar del mismo sitio: si un id
// se renombra en un lado y no en el otro, la entrada del menú deja de llevar a
// ninguna parte —o la casilla de Ajustes esconde algo que no existe— y no se
// nota hasta que alguien la pulsa.
var html = leer(base + "index.html");
var rotas = [];
window.SolventoConfig.PAGINAS.forEach(function (p) {
  if (html.indexOf('id="v2-page-' + p.id + '"') < 0) rotas.push(p.id + " no tiene página");
  if (html.indexOf('data-page="' + p.id + '"') < 0) rotas.push(p.id + " no tiene entrada en el menú");
});
comprobar("cada página del menú existe y cada entrada lleva a una página",
  rotas.length === 0, rotas.join(" · "));
// Lo guardado se filtra contra el catálogo. Sin esto, un documento editado a
// mano —o traído de una versión con otras páginas— podría dejarte sin portada
// y sin forma de volver a ella.
var C = window.SolventoConfig;
C.usarDoc({ config: { menu_oculto: ["patrimonio", "cartera", "inventada"] } });
var oculto = C.menuOculto();
comprobar("del menú guardado solo sobrevive lo que se puede ocultar de verdad",
  oculto.length === 1 && oculto[0] === "cartera" && C.paginaVisible("patrimonio"),
  oculto.join(", "));
C.usarDoc(doc);

print("");
if (fallos.length) { print(fallos.length + " comprobación(es) fallidas"); salir(1); }
print("todo en orden");
