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

  // ── Saldos por cuenta (solo las cuentas configuradas cuentan al patrimonio) ──
  function computeSaldos(movimientos) {
    const bal = {};
    CFG.CUENTAS.forEach((c) => (bal[c.cuenta] = 0));
    const isC = (c) => c && c !== "-" && (c in bal);
    for (const m of movimientos || []) {
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
    const saldos = CFG.CUENTAS.map((c) => ({ cuenta: c.cuenta, accent: c.accent, logo: c.logo, emoji: c.emoji, saldo: round2(bal[c.cuenta]) }));
    const patrimonioLiquido = round2(saldos.reduce((s, x) => s + x.saldo, 0));
    saldos.forEach((s) => (s.pct = patrimonioLiquido ? s.saldo / patrimonioLiquido * 100 : 0));
    saldos.sort((a, b) => b.saldo - a.saldo);
    return { saldos, patrimonioLiquido };
  }

  // ── Registro de activos: conocidos + derivados de los datos ──
  function buildRegistry(inversiones) {
    const byJk = {};
    CFG.ACTIVOS.forEach((a) => (byJk[jkOf(a.nombre, a.isin)] = a));
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
    const { saldos, patrimonioLiquido } = computeSaldos(db.movimientos);
    const inv = valuate(db, prices);
    const inm = valuateInmuebles(db.inmuebles);
    const patrimonioNeto = round2(patrimonioLiquido + inv.total + inm.total);
    const ratioInv = patrimonioNeto ? inv.total / patrimonioNeto * 100 : 0;
    const ratioInm = patrimonioNeto ? inm.total / patrimonioNeto * 100 : 0;
    const pctLiquidez = 100 - ratioInv - ratioInm;
    return { saldos, patrimonioLiquido, inv, inm, patrimonioNeto, ratioInv, ratioInm, pctLiquidez };
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
    const cuentas = new Set(CFG.CUENTAS.map((c) => c.cuenta));
    const isC = (c) => c && c !== "-" && cuentas.has(c);
    const deltaByDate = {};
    for (const m of db.movimientos || []) {
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

  window.SolventoModel = { build, buildSeries, _internals: { computeSaldos, valuate, valuateInmuebles, parseFechaES, round2 } };
})();
