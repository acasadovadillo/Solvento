/*
 * Solvento v2 — Motor de cálculo (port de la analítica de generate.py).
 *
 * Entrada: documento descifrado (db) + precios públicos (prices.json).
 * Salida: modelo con saldos por cuenta, valoración de la cartera con
 * rentabilidad, valoración de inmuebles y patrimonio neto.
 *
 * Fiel a la v1: los saldos salen de movimientos (todos los gastos restan, incl.
 * "Inversiones"); la cartera agrega coste/unidades CON SIGNO (Venta/Traspaso en
 * negativo) y valora con precio Yahoo (EUR) o, si no hay ticker, con el último
 * NAV (db.nav); los inmuebles usan la tasación.
 */
(function () {
  "use strict";
  const CFG = window.SolventoConfig;

  const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
  const num = (x) => { const n = parseFloat(x); return isFinite(n) ? n : NaN; };
  function parseFechaES(s) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(s || "").trim());
    return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
  }
  const NOW = new Date();
  function cagr(importe, coste, fecha, minAnos) {
    if (!(coste > 0) || !isFinite(importe) || !fecha) return NaN;
    const anos = (NOW - fecha) / (365.25 * 864e5);
    if (anos < (minAnos == null ? 0.01 : minAnos)) return NaN;
    return (Math.pow(importe / coste, 1 / anos) - 1) * 100;
  }

  const jkOf = (nombre, isin) => {
    const s = String(isin || "").trim();
    return (s && s !== "-" && s !== "nan") ? s : String(nombre || "").trim();
  };

  // ¿Es un viejo apunte de "Inversiones" en Movimientos? (doble contabilidad de
  // la v1). Se ignora en el cálculo de caja porque ahora el efecto en efectivo
  // lo aporta la propia operación de inversión (Compra/Venta). Las filas se
  // conservan en el histórico, no se borran.
  // Solo los GASTOS "Inversiones" son el doble apunte de la v1 (una compra ya
  // resta vía su operación). Los INGRESOS no se excluyen: aunque alguno esté
  // etiquetado así (p.ej. el interés de la cuenta remunerada), es dinero real
  // que entra en la cuenta.
  const esMovInversion = (m) =>
    String(m.tipo_gasto || "").trim().toLowerCase() === "inversiones";

  // ── Saldos por cuenta (solo las cuentas configuradas cuentan al patrimonio) ──
  // Fase 6: una Compra resta del efectivo de su cuenta, una Venta suma, y un
  // Traspaso entre fondos es neutro. Así comprar un fondo descuenta el dinero
  // automáticamente, sin doble apunte.
  function computeSaldos(movimientos, inversiones) {
    const bal = {};
    CFG.cuentas().forEach((c) => (bal[c.cuenta] = 0));
    const isC = (c) => c && c !== "-" && (c in bal);
    for (const m of movimientos || []) {
      if (esMovInversion(m)) continue; // el efectivo lo mueve la operación, no este apunte
      const imp = num(m.importe) || 0;
      const o = String(m.cuenta_origen || "").trim();
      const d = String(m.cuenta_destino || "").trim();
      switch (m.tipo) {
        case "Ingreso":  if (isC(d)) bal[d] += imp; break;
        case "Gasto":    if (isC(o)) bal[o] -= imp; break;
        case "Traspaso": if (isC(o)) bal[o] -= imp; if (isC(d)) bal[d] += imp; break;
        case "Préstamo":
          if (m.tipo_prestamo === "Dinero prestado" && isC(o)) bal[o] -= imp;
          else if (m.tipo_prestamo === "Devolución" && isC(d)) bal[d] += imp;
          break;
      }
    }
    // Efecto en efectivo de las operaciones de inversión (Compra/Venta).
    for (const r of inversiones || []) {
      if ((r.tipo_movimiento || "Compra") === "Traspaso") continue; // fondo→fondo, neutro
      const coste = num(r.coste);
      const cuenta = String(r.cuenta || "").trim();
      if (isFinite(coste) && isC(cuenta)) bal[cuenta] -= coste; // Compra(+coste)→resta, Venta(−coste)→suma
    }
    const saldos = CFG.cuentas().map((c) => ({
      cuenta: c.cuenta, accent: c.accent, logo: c.logo, emoji: c.emoji,
      broker: !!c.broker, saldo: round2(bal[c.cuenta]),
    }));
    // Caja = solo cuentas NO bróker. El efectivo de los brókers (remunerado)
    // forma parte de la Cartera, no de la Caja.
    const saldosCaja = saldos.filter((s) => !s.broker);
    const saldosBroker = saldos.filter((s) => s.broker);
    const patrimonioLiquido = round2(saldosCaja.reduce((s, x) => s + x.saldo, 0));
    const efectivoBroker = round2(saldosBroker.reduce((s, x) => s + x.saldo, 0));
    saldosCaja.forEach((s) => (s.pct = patrimonioLiquido ? s.saldo / patrimonioLiquido * 100 : 0));
    saldosBroker.forEach((s) => (s.pct = efectivoBroker ? s.saldo / efectivoBroker * 100 : 0));
    saldos.sort((a, b) => b.saldo - a.saldo);
    saldosCaja.sort((a, b) => b.saldo - a.saldo);
    saldosBroker.sort((a, b) => b.saldo - a.saldo);
    return { saldos, saldosCaja, saldosBroker, patrimonioLiquido, efectivoBroker };
  }

  // ── Registro de activos: conocidos + derivados de los datos ──
  function buildRegistry(inversiones) {
    const byJk = {};
    CFG.activos().forEach((a) => (byJk[jkOf(a.nombre, a.isin)] = a));
    for (const r of inversiones || []) {
      const jk = jkOf(r.nombre, r.isin);
      if (!byJk[jk]) {
        byJk[jk] = {
          nombre: r.nombre, isin: (r.isin || "-").trim(),
          categoria: r.renta || "Renta variable", tipo: r.activo || "Fondo de inversión",
          banco: r.cuenta || "", yf: null, derived: true,
        };
      }
    }
    return byJk;
  }

  // ── Último NAV por ISIN (ordena por fecha; las hojas mezclan asc/desc) ──
  function lastNavByIsin(nav) {
    const out = {};
    for (const isin in (nav || {})) {
      let best = null, bestF = null;
      for (const p of nav[isin]) {
        const f = parseFechaES(p.fecha), v = num(p.precio);
        if (f && isFinite(v) && (!bestF || f > bestF)) { bestF = f; best = v; }
      }
      if (best != null) out[isin] = best;
    }
    return out;
  }

  // ── Valoración de la cartera ──
  function valuate(db, prices) {
    const byJk = buildRegistry(db.inversiones);
    const navLast = lastNavByIsin(db.nav);
    const eur = (prices && prices.eur) || {};

    // Agregar coste/unidades CON SIGNO por activo (solo filas con coste numérico)
    const agg = {};
    for (const r of db.inversiones || []) {
      const coste = num(r.coste);
      if (!isFinite(coste)) continue;
      const jk = jkOf(r.nombre, r.isin);
      const uds = num(r.unidades);
      const f = parseFechaES(r.fecha);
      const a = agg[jk] || (agg[jk] = { coste: 0, unidades: 0, fechaPrimera: null, n: 0 });
      a.coste += coste;
      a.unidades += isFinite(uds) ? uds : 0;
      a.n += 1;
      if (f && (!a.fechaPrimera || f < a.fechaPrimera)) a.fechaPrimera = f;
    }

    const assets = [];
    for (const jk in agg) {
      const meta = byJk[jk] || { nombre: jk, isin: "-", categoria: "Renta variable", tipo: "", banco: "", yf: null };
      const a = agg[jk];
      let importe = NaN, fuente = "manual", precioUnit = NaN;
      if (meta.yf && eur[meta.yf] != null && isFinite(a.unidades)) {
        precioUnit = eur[meta.yf]; importe = round2(precioUnit * a.unidades); fuente = "yf";
      } else if (navLast[meta.isin] != null && isFinite(a.unidades)) {
        precioUnit = navLast[meta.isin]; importe = round2(precioUnit * a.unidades); fuente = "nav";
      }
      const coste = round2(a.coste);
      const ganancia = isFinite(importe) ? round2(importe - coste) : NaN;
      const rentPct = (coste > 0 && isFinite(importe)) ? (importe / coste - 1) * 100 : NaN;
      assets.push({
        nombre: meta.nombre, isin: meta.isin, categoria: meta.categoria, tipo: meta.tipo,
        banco: meta.banco, coste, unidades: a.unidades, importe, ganancia, rentPct,
        cagr: cagr(importe, coste, a.fechaPrimera), fechaPrimera: a.fechaPrimera,
        n: a.n, fuente, precioUnit,
      });
    }
    assets.sort((x, y) => (isFinite(y.importe) ? y.importe : -Infinity) - (isFinite(x.importe) ? x.importe : -Infinity));

    const total = round2(assets.reduce((s, a) => s + (isFinite(a.importe) ? a.importe : 0), 0));
    const totalCoste = round2(assets.reduce((s, a) => s + (isFinite(a.coste) ? a.coste : 0), 0));
    const totalGanancia = totalCoste > 0 ? round2(total - totalCoste) : 0;
    const rentPct = totalCoste > 0 ? (total / totalCoste - 1) * 100 : NaN;
    assets.forEach((a) => (a.pct = total ? (isFinite(a.importe) ? a.importe / total * 100 : 0) : 0));

    // CAGR de la cartera (desde la primera aportación con coste)
    let fechaPrimera = null;
    assets.forEach((a) => { if (a.fechaPrimera && (!fechaPrimera || a.fechaPrimera < fechaPrimera)) fechaPrimera = a.fechaPrimera; });
    const portfolioCagr = cagr(total, totalCoste, fechaPrimera, 0.25);

    // Asignación por categoría (RV/RF) actual vs objetivo
    const porCat = {};
    assets.forEach((a) => { if (isFinite(a.importe)) porCat[a.categoria] = (porCat[a.categoria] || 0) + a.importe; });

    return { assets, total, totalCoste, totalGanancia, rentPct, portfolioCagr, hayRentabilidad: totalCoste > 0, porCat };
  }

  // ── Inmuebles ──
  function valuateInmuebles(inmuebles) {
    const arr = (inmuebles || []).map((r) => {
      const importe = num(r.tasacion);
      const coste = num(r.valor_compra);
      const fechaCompra = parseFechaES(r.fecha_adquisicion);
      const ganancia = (isFinite(importe) && isFinite(coste)) ? round2(importe - coste) : NaN;
      const rentPct = (coste > 0 && isFinite(importe)) ? (importe / coste - 1) * 100 : NaN;
      const accent = CFG.TIPO_COLORES_INMUEBLE[r.tipo] || CFG.INMUEBLE_ACCENT_DEFAULT;
      return { id: r.id, nombre: r.direccion, tipo: r.tipo, importe, coste, fechaCompra, ganancia, rentPct, cagr: cagr(importe, coste, fechaCompra, 0.25), accent };
    });
    arr.sort((a, b) => (isFinite(b.importe) ? b.importe : 0) - (isFinite(a.importe) ? a.importe : 0));
    const total = round2(arr.reduce((s, x) => s + (isFinite(x.importe) ? x.importe : 0), 0));
    const totalCoste = round2(arr.reduce((s, x) => s + (isFinite(x.coste) && x.coste > 0 ? x.coste : 0), 0));
    return { items: arr, total, totalCoste, n: arr.length };
  }

  // ── Modelo completo ──
  function build(db, prices) {
    const { saldos, saldosCaja, saldosBroker, patrimonioLiquido, efectivoBroker } =
      computeSaldos(db.movimientos, db.inversiones);
    const inv = valuate(db, prices);
    const inm = valuateInmuebles(db.inmuebles);
    // La Cartera incluye el efectivo sin invertir de los brókers.
    const carteraTotal = round2(inv.total + efectivoBroker);
    const pas = valuatePasivos(db.pasivos);
    // Patrimonio NETO = lo que tienes menos lo que debes.
    const patrimonioNeto = round2(patrimonioLiquido + carteraTotal + inm.total - pas.total);
    const ratioInv = patrimonioNeto ? carteraTotal / patrimonioNeto * 100 : 0;
    const ratioInm = patrimonioNeto ? inm.total / patrimonioNeto * 100 : 0;
    const ratioPas = patrimonioNeto ? pas.total / patrimonioNeto * 100 : 0;
    const pctLiquidez = 100 - ratioInv - ratioInm;
    return { saldos, saldosCaja, saldosBroker, patrimonioLiquido, efectivoBroker,
             inv, inm, pas, carteraTotal, patrimonioNeto,
             ratioInv, ratioInm, ratioPas, pctLiquidez };
  }


  // ── Pasivos (deudas: hipotecas, préstamos, tarjetas…) ──
  // Aún no hay formulario para darlos de alta, pero el cálculo ya es real: en
  // cuanto el documento tenga db.pasivos, la tarjeta y la página los reflejan y
  // el patrimonio neto los descuenta.
  function valuatePasivos(pasivos) {
    const items = (pasivos || [])
      .map((r) => ({
        id: r.id,
        nombre: r.nombre || r.concepto || "Deuda",
        tipo: r.tipo || "Préstamo",
        entidad: r.entidad || "",
        importe: num(r.importe ?? r.pendiente ?? r.saldo),
      }))
      .filter((x) => isFinite(x.importe) && x.importe > 0)
      .sort((a, b) => b.importe - a.importe);
    return { items, n: items.length, total: round2(items.reduce((s, x) => s + x.importe, 0)) };
  }

  // ── Análisis de gastos (Fase 6) ──────────────────────────────────────
  // Agrega ingresos y gastos por mes y categoría a partir de lo que ya
  // registras. Qué se deja fuera, y por qué:
  //   · Traspasos y préstamos: mueven dinero entre tus cuentas o hacia terceros,
  //     pero no son gasto ni ingreso de verdad.
  //   · Gastos de categoría "Inversiones": el dinero no se va, cambia de forma
  //     (lo mueve la operación de compra).
  //   · Cualquier apunte "de ajuste": son cuadres contables, no consumo real;
  //     contarlos dispararía el gasto de un mes por un motivo ficticio.
  const esAjuste = (m) =>
    /ajuste/i.test(String(m.tipo_gasto || "")) || /ajuste/i.test(String(m.tipo_ingreso || ""));

  function buildGastos(db) {
    const porMes = {};
    const mesDe = (f) => {
      const d = parseFechaES(f);
      return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` : null;
    };
    for (const m of db.movimientos || []) {
      if (m.tipo !== "Gasto" && m.tipo !== "Ingreso") continue;   // fuera traspasos y préstamos
      if (esAjuste(m) || esMovInversion(m)) continue;
      const ym = mesDe(m.fecha);
      const imp = num(m.importe);
      if (!ym || !isFinite(imp) || imp <= 0) continue;
      const mes = porMes[ym] || (porMes[ym] = { ym, ingresos: 0, gastos: 0, catGasto: {}, catIngreso: {} });
      if (m.tipo === "Gasto") {
        mes.gastos += imp;
        const c = String(m.tipo_gasto || "").trim() || "Sin categoría";
        mes.catGasto[c] = (mes.catGasto[c] || 0) + imp;
      } else {
        mes.ingresos += imp;
        const c = String(m.tipo_ingreso || "").trim() || "Sin categoría";
        mes.catIngreso[c] = (mes.catIngreso[c] || 0) + imp;
      }
    }
    const etiqueta = (ym) => {
      const [a, mm] = ym.split("-");
      return new Date(+a, +mm - 1, 1).toLocaleDateString("es-ES", { month: "short", year: "numeric" });
    };
    const meses = Object.values(porMes).sort((a, b) => a.ym.localeCompare(b.ym)).map((m) => {
      const ahorro = round2(m.ingresos - m.gastos);
      return {
        ym: m.ym, label: etiqueta(m.ym),
        ingresos: round2(m.ingresos), gastos: round2(m.gastos), ahorro,
        tasa: m.ingresos > 0 ? ahorro / m.ingresos * 100 : NaN,
        catGasto: m.catGasto, catIngreso: m.catIngreso,
      };
    });
    // Media de los últimos 12 meses con actividad, para comparar un mes con "lo normal"
    const ult = meses.slice(-12);
    const media = ult.length ? {
      ingresos: round2(ult.reduce((s, x) => s + x.ingresos, 0) / ult.length),
      gastos: round2(ult.reduce((s, x) => s + x.gastos, 0) / ult.length),
      meses: ult.length,
    } : { ingresos: 0, gastos: 0, meses: 0 };
    const categorias = Array.from(new Set(meses.flatMap((m) => Object.keys(m.catGasto)))).sort();
    return { meses, media, categorias };
  }

  // ── Analítica por activo: líneas temporales de unidades, coste y precio ──
  function _timelinesPorActivo(db, prices) {
    const byJk = buildRegistry(db.inversiones);
    const hist = (prices && prices.hist) || {};
    const rowsByJk = {};
    for (const r of db.inversiones || []) {
      const coste = num(r.coste); if (!isFinite(coste)) continue;
      const f = parseFechaES(r.fecha); if (!f) continue;
      const jk = jkOf(r.nombre, r.isin);
      (rowsByJk[jk] = rowsByJk[jk] || []).push({ t: f.getTime(), u: num(r.unidades) || 0, c: coste });
    }
    const unitsTL = {}, costTL = {};
    for (const jk in rowsByJk) {
      const rows = rowsByJk[jk].sort((a, b) => a.t - b.t);
      let ru = 0, rc = 0; const tu = [], tc = [];
      for (const r of rows) { ru += r.u; rc += r.c; tu.push([r.t, ru]); tc.push([r.t, rc]); }
      unitsTL[jk] = tu; costTL[jk] = tc;
    }
    const priceTL = {};
    for (const jk in unitsTL) {
      const meta = byJk[jk];
      if (meta && meta.yf && hist[meta.yf] && hist[meta.yf].length) {
        priceTL[jk] = hist[meta.yf];
      } else if (meta && db.nav && db.nav[meta.isin]) {
        priceTL[jk] = db.nav[meta.isin]
          .map((p) => { const f = parseFechaES(p.fecha); return f ? [f.getTime(), num(p.precio)] : null; })
          .filter((x) => x && isFinite(x[1])).sort((a, b) => a[0] - b[0]);
      }
    }
    return { byJk, unitsTL, costTL, priceTL };
  }

  // Reporte mes a mes de la cartera: cada fila un activo, cada columna un mes,
  // con la rentabilidad ACUMULADA desde el inicio hasta el cierre de ese mes.
  // Devuelve además la serie de rentabilidad por activo para la comparativa.
  function buildAnalitica(db, prices) {
    const { byJk, unitsTL, costTL, priceTL } = _timelinesPorActivo(db, prices);
    const jks = Object.keys(unitsTL);
    const vacio = { meses: [], filas: [], total: [], comparativa: [] };
    if (!jks.length) return vacio;

    const antesDe = (arr, t) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i][0] <= t) return arr[i][1]; return null; };

    // Cierres de mes desde la primera operación hasta hoy (el último punto es hoy)
    let t0 = Infinity;
    jks.forEach((jk) => { t0 = Math.min(t0, unitsTL[jk][0][0]); });
    const ahora = Date.now();
    const meses = [];
    const cur = new Date(t0); cur.setDate(1); cur.setHours(0, 0, 0, 0);
    for (let guard = 0; guard < 600; guard++) {
      const fin = new Date(cur.getFullYear(), cur.getMonth() + 1, 0, 23, 59, 59).getTime();
      if (fin >= ahora) { meses.push(ahora); break; }
      meses.push(fin);
      cur.setMonth(cur.getMonth() + 1);
    }

    function celda(jk, t) {
      const u = antesDe(unitsTL[jk], t);
      const c = antesDe(costTL[jk], t);
      if (u == null || u <= 1e-9 || c == null || c <= 0) return null;  // sin posición ese mes
      const ptl = priceTL[jk];
      if (!ptl || !ptl.length) return null;
      let precio = antesDe(ptl, t);
      if (precio == null) precio = ptl[0][1];
      const valor = round2(u * precio);
      return { valor, coste: round2(c), rentPct: (valor / c - 1) * 100 };
    }

    const filas = jks.map((jk) => {
      const meta = byJk[jk] || {};
      const celdas = meses.map((t) => celda(jk, t));
      return {
        jk, nombre: meta.nombre || jk, isin: meta.isin || "-",
        categoria: meta.categoria, banco: meta.banco, celdas,
        activo: celdas.some((c) => c),
      };
    }).filter((f) => f.activo)
      .sort((a, b) => {
        const ua = a.celdas[a.celdas.length - 1], ub = b.celdas[b.celdas.length - 1];
        return (ub ? ub.valor : -1) - (ua ? ua.valor : -1);
      });

    // Fila "Total cartera": se calcula sobre TODOS los activos (no solo los que
    // tienen posición abierta) y con el coste CON SIGNO, igual que el resto de la
    // app — así la última columna coincide exactamente con la rentabilidad del
    // panel de Cartera, incluyendo el efecto de traspasos y ventas ya cerradas.
    const total = meses.map((t) => {
      let v = 0, c = 0;
      for (const jk of jks) {
        const cc = antesDe(costTL[jk], t);
        if (cc == null) continue;              // el activo aún no existía ese mes
        c += cc;
        const u = antesDe(unitsTL[jk], t);
        const ptl = priceTL[jk];
        if (u != null && u > 1e-9 && ptl && ptl.length) {
          let precio = antesDe(ptl, t);
          if (precio == null) precio = ptl[0][1];
          v += u * precio;
        }
      }
      return c > 0 ? { valor: round2(v), coste: round2(c), rentPct: (v / c - 1) * 100 } : null;
    });

    // Comparativa: una línea de rentabilidad (%) por activo, más el total
    const comparativa = filas.map((f) => ({
      key: f.jk, label: f.nombre, isin: f.isin,
      puntos: meses.map((t, i) => (f.celdas[i] ? [t, f.celdas[i].rentPct] : [t, null])),
    }));
    comparativa.unshift({
      key: "__total", label: "Total cartera", isin: "-", destacada: true,
      puntos: meses.map((t, i) => (total[i] ? [t, total[i].rentPct] : [t, null])),
    });

    return { meses, filas, total, comparativa };
  }

  // ── Series de evolución temporal (patrimonio neto y cartera) ──
  // Muestrea en las fechas de movimiento (como la v1): en cada fecha, el valor
  // de la cartera = Σ unidades_acumuladas(fecha) × precio(fecha), con precio del
  // histórico Yahoo (prices.hist) o del NAV (db.nav); el patrimonio neto añade
  // el líquido acumulado y la tasación de inmuebles ya adquiridos.
  function buildSeries(db, prices) {
    const byJk = buildRegistry(db.inversiones);
    const hist = (prices && prices.hist) || {};

    // Unidades acumuladas por activo (ordenadas por fecha)
    const rowsByJk = {};
    for (const r of db.inversiones || []) {
      if (!isFinite(num(r.coste))) continue;
      const f = parseFechaES(r.fecha); if (!f) continue;
      const jk = jkOf(r.nombre, r.isin);
      (rowsByJk[jk] = rowsByJk[jk] || []).push({ t: f.getTime(), u: num(r.unidades) || 0 });
    }
    const unitsTL = {};
    for (const jk in rowsByJk) {
      const rows = rowsByJk[jk].sort((a, b) => a.t - b.t);
      let run = 0; const tl = [];
      for (const r of rows) { run += r.u; tl.push([r.t, run]); }
      unitsTL[jk] = tl;
    }
    // Serie de precios por activo: histórico Yahoo (EUR) o histórico NAV
    const priceTL = {};
    for (const jk in unitsTL) {
      const meta = byJk[jk];
      if (meta && meta.yf && hist[meta.yf] && hist[meta.yf].length) {
        priceTL[jk] = hist[meta.yf];
      } else if (meta && db.nav && db.nav[meta.isin]) {
        priceTL[jk] = db.nav[meta.isin]
          .map((p) => { const f = parseFechaES(p.fecha); return f ? [f.getTime(), num(p.precio)] : null; })
          .filter((x) => x && isFinite(x[1])).sort((a, b) => a[0] - b[0]);
      }
    }
    const atOrBefore = (arr, t, col) => { // último elemento con arr[i][0] <= t
      for (let i = arr.length - 1; i >= 0; i--) if (arr[i][0] <= t) return arr[i][col];
      return null;
    };
    function invEn(t) {
      let total = 0;
      for (const jk in unitsTL) {
        const u = atOrBefore(unitsTL[jk], t, 1);
        if (!u || u <= 0) continue;
        const ptl = priceTL[jk]; if (!ptl || !ptl.length) continue;
        let price = atOrBefore(ptl, t, 1);
        if (price == null) price = ptl[0][1]; // fallback: precio más antiguo conocido
        total += u * price;
      }
      return total;
    }

    // Deltas de líquido por fecha (mismas cuentas que el saldo) + acumulado
    const cuentas = new Set(CFG.cuentas().map((c) => c.cuenta));
    const isC = (c) => c && c !== "-" && cuentas.has(c);
    const deltaByDate = {};
    for (const m of db.movimientos || []) {
      if (esMovInversion(m)) continue; // el efectivo lo mueve la operación
      const f = parseFechaES(m.fecha); if (!f) continue;
      const t = f.getTime(); const imp = num(m.importe) || 0;
      const o = String(m.cuenta_origen || "").trim(), d = String(m.cuenta_destino || "").trim();
      let delta = 0;
      switch (m.tipo) {
        case "Ingreso":  if (isC(d)) delta = imp; break;
        case "Gasto":    if (isC(o)) delta = -imp; break;
        case "Traspaso": if (isC(o)) delta -= imp; if (isC(d)) delta += imp; break;
        case "Préstamo":
          if (m.tipo_prestamo === "Dinero prestado" && isC(o)) delta -= imp;
          else if (m.tipo_prestamo === "Devolución" && isC(d)) delta += imp;
          break;
      }
      deltaByDate[t] = (deltaByDate[t] || 0) + delta;
    }
    // Efecto en efectivo de las operaciones (Compra resta, Venta suma, Traspaso neutro):
    // mantiene la continuidad del patrimonio (el dinero pasa de caja a posiciones).
    for (const r of db.inversiones || []) {
      if ((r.tipo_movimiento || "Compra") === "Traspaso") continue;
      const f = parseFechaES(r.fecha); if (!f) continue;
      const coste = num(r.coste);
      if (isFinite(coste) && isC(String(r.cuenta || "").trim())) {
        const t = f.getTime();
        deltaByDate[t] = (deltaByDate[t] || 0) - coste;
      }
    }
    const dates = Object.keys(deltaByDate).map(Number).sort((a, b) => a - b);

    const inmCompra = (db.inmuebles || [])
      .map((r) => { const f = parseFechaES(r.fecha_adquisicion); return f ? { t: f.getTime(), v: num(r.tasacion) } : null; })
      .filter((x) => x && isFinite(x.v));
    const inmEn = (t) => inmCompra.reduce((s, x) => s + (x.t <= t ? x.v : 0), 0);

    let liq = 0; const cartera = [], patrimonio = [];
    for (const t of dates) {
      liq += deltaByDate[t];
      const cv = round2(invEn(t));
      cartera.push([t, cv]);
      patrimonio.push([t, round2(liq + cv + inmEn(t))]);
    }
    return { cartera, patrimonio };
  }

  window.SolventoModel = { build, buildSeries, buildAnalitica, buildGastos, _internals: { computeSaldos, valuate, valuateInmuebles, parseFechaES, round2 } };
})();
