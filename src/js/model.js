/*
 * Solvento — Motor de cálculo (port de la analítica de generate.py).
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
  /*
   * Operaciones que NO mueven efectivo de ninguna cuenta:
   *   Traspaso  el dinero va de un fondo a otro sin pasar por la caja
   *   Herencia  la posición ya era tuya cuando empezaste a registrar. No la
   *             compraste con dinero de ninguna cuenta de Solvento, así que
   *             restar su coste de una cuenta la dejaría en negativo por algo
   *             que nunca salió de ella.
   * En los dos casos la posición y su coste SÍ cuentan en la cartera: lo que no
   * cuenta es la salida de caja.
   */
  const SIN_EFECTIVO = new Set(["Traspaso", "Herencia"]);

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
      if (SIN_EFECTIVO.has(r.tipo_movimiento || "Compra")) continue;
      const coste = num(r.coste);
      const cuenta = String(r.cuenta || "").trim();
      if (isFinite(coste) && isC(cuenta)) bal[cuenta] -= coste; // Compra(+coste)→resta, Venta(−coste)→suma
    }
    const saldos = CFG.cuentas().map((c) => ({
      cuenta: c.cuenta, accent: c.accent, logo: c.logo, emoji: c.emoji,
      cartera: c.cartera || null, saldo: round2(bal[c.cuenta]),
    }));
    // TODO el efectivo es Caja, esté donde esté. El saldo de un bróker es dinero
    // que puedes sacar, no una inversión: contarlo como Cartera deformaba su
    // valor y su rentabilidad. Se ignora a propósito el antiguo campo `broker`,
    // que puede seguir guardado en la configuración de quien ya editó cuentas.
    const saldosCaja = saldos;
    // Solo informativo: cuánto tienes sin invertir en cada bróker (pólvora seca).
    const saldosBroker = saldos.filter((s) => s.cartera === "efectivo");
    const patrimonioLiquido = round2(saldos.reduce((s, x) => s + x.saldo, 0));
    const efectivoBroker = round2(saldosBroker.reduce((s, x) => s + x.saldo, 0));
    saldosCaja.forEach((s) => (s.pct = patrimonioLiquido ? s.saldo / patrimonioLiquido * 100 : 0));
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
          // Un activo que no está en el catálogo del usuario puede seguir
          // teniendo ticker conocido: los fondos heredados entraron por los
          // datos, no dándolos de alta a mano, y sin esto se quedaban sin precio.
          banco: r.cuenta || "", yf: CFG.tickerConocido ? CFG.tickerConocido(r.isin) : null, derived: true,
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
  // ── Propiedades ──────────────────────────────────────────────────────
  // Ya no son solo inmuebles: caben coche, arte, relojes o metales. Tres formas
  // de valorar, según lo que tengas:
  //   · por tasación (un piso, un cuadro): el valor lo pones tú
  //   · por peso (oro, plata): gramos × precio del metal, que se actualiza solo
  //   · alquilada: además calcula lo que renta al año sobre lo que te costó
  //
  // Se lee tanto el formato nuevo como el antiguo (direccion/tasacion), así que
  // los inmuebles que ya tenías siguen valiendo sin migrar nada.
  // Los movimientos entran aquí porque el alquiler de verdad no es el número que
  // escribiste una vez, sino lo que se ha cobrado y pagado por ese inmueble. La
  // ficha solo dice si está alquilado; las cifras salen de la caja.
  function valuatePropiedades(propiedades, prices, movimientos) {
    const metales = (prices && prices.metales) || {};
    // Ventana de doce meses: recoge un alquiler que se cobra una vez al año,
    // absorbe el mes que se pagó la derrama y no arrastra lo de hace tres años.
    const hace12 = new Date(); hace12.setFullYear(hace12.getFullYear() - 1);
    const real = movimientos ? resumenCentros(movimientos, hace12) : {};
    const arr = (propiedades || []).map((r) => {
      const nombre = r.nombre || r.direccion || "Sin nombre";
      const tipo = r.tipo || "Otro";
      const peso = num(r.peso_g);
      const metal = String(r.metal || "").toLowerCase();
      const precioGramo = metales[metal];

      // El peso manda cuando lo hay: es el valor de mercado, no una estimación
      let importe, porPeso = false;
      if (isFinite(peso) && peso > 0 && precioGramo) {
        importe = round2(peso * precioGramo);
        porPeso = true;
      } else {
        importe = num(r.valor != null ? r.valor : r.tasacion);
      }

      const coste = num(r.valor_compra);
      const fechaCompra = parseFechaES(r.fecha_adquisicion);
      const ganancia = (isFinite(importe) && isFinite(coste)) ? round2(importe - coste) : NaN;
      const rentPct = (coste > 0 && isFinite(importe)) ? (importe / coste - 1) * 100 : NaN;

      // Alquiler: rentabilidad anual sobre lo pagado (bruta y neta de gastos).
      // Manda lo cobrado de verdad en el último año; los importes escritos a mano
      // quedan de respaldo para un inmueble recién dado de alta o sin centro,
      // porque enseñar cero donde aún no hay datos parecería un dato.
      const centro = String(r.centro || "").trim();
      const suyo = centro ? real[centro] : null;
      const hayReal = !!suyo && (suyo.ingreso > 0 || suyo.gasto > 0);
      const rentaManual = num(r.renta_mensual), gastosManual = num(r.gastos_mensuales) || 0;
      const alquilada = !!r.alquilada && (hayReal ? suyo.ingreso > 0 : isFinite(rentaManual) && rentaManual > 0);
      const renta = hayReal ? round2(suyo.ingreso / 12) : rentaManual;
      const gastos = hayReal ? round2(suyo.gasto / 12) : gastosManual;
      const rentaAnual = alquilada ? round2(hayReal ? suyo.ingreso : rentaManual * 12) : NaN;
      const netoAnual = alquilada ? round2(hayReal ? suyo.ingreso - suyo.gasto : (rentaManual - gastosManual) * 12) : NaN;
      const base = coste > 0 ? coste : importe;   // sin precio de compra, sobre el valor actual
      const yieldBruto = alquilada && base > 0 ? rentaAnual / base * 100 : NaN;
      const yieldNeto  = alquilada && base > 0 ? netoAnual / base * 100 : NaN;

      return {
        id: r.id, nombre, tipo, importe, coste, fechaCompra, ganancia, rentPct,
        cagr: cagr(importe, coste, fechaCompra, 0.25),
        accent: CFG.TIPO_COLORES_INMUEBLE[tipo] || CFG.INMUEBLE_ACCENT_DEFAULT,
        porPeso, peso, metal, precioGramo,
        alquilada, renta, gastos, rentaAnual, netoAnual, yieldBruto, yieldNeto,
        baseYield: base,
        centro, fuenteRenta: hayReal ? "real" : "manual",
      };
    });
    arr.sort((a, b) => (isFinite(b.importe) ? b.importe : 0) - (isFinite(a.importe) ? a.importe : 0));
    const total = round2(arr.reduce((s, x) => s + (isFinite(x.importe) ? x.importe : 0), 0));
    const totalCoste = round2(arr.reduce((s, x) => s + (isFinite(x.coste) && x.coste > 0 ? x.coste : 0), 0));
    const alquiladas = arr.filter((x) => x.alquilada);
    const rentaAnualTotal = round2(alquiladas.reduce((s, x) => s + (x.netoAnual || 0), 0));
    return { items: arr, total, totalCoste, n: arr.length, alquiladas: alquiladas.length, rentaAnualTotal };
  }

  // ── Modelo completo ──
  function build(db, prices) {
    const { saldos, saldosCaja, saldosBroker, patrimonioLiquido, efectivoBroker } =
      computeSaldos(db.movimientos, db.inversiones);
    const inv = valuate(db, prices);
    const inm = valuatePropiedades(db.propiedades || db.inmuebles, prices, db.movimientos);
    // La Cartera incluye el efectivo sin invertir de los brókers.
    // La Cartera es solo lo invertido; el efectivo de bróker ya cuenta en Caja.
    const carteraTotal = inv.total;
    const pas = valuatePasivos(db.pasivos, db.movimientos);
    // Patrimonio NETO = lo que tienes menos lo que debes.
    const cobrar = porCobrar(db);
    const patrimonioNeto = round2(patrimonioLiquido + carteraTotal + inm.total + cobrar.total - pas.total);
    // El BRUTO es lo que tienes, sin descontar lo que debes. Los pesos de caja,
    // cartera y propiedades se miden sobre él y no sobre el neto: son la leyenda
    // del reparto de los activos, y unas partes que no suman 100 % en un reparto
    // no son un matiz, son un error de lectura.
    const patrimonioBruto = round2(patrimonioLiquido + carteraTotal + inm.total + cobrar.total);
    const ratioInv = patrimonioBruto ? carteraTotal / patrimonioBruto * 100 : 0;
    const ratioInm = patrimonioBruto ? inm.total / patrimonioBruto * 100 : 0;
    const ratioCobrar = patrimonioBruto ? cobrar.total / patrimonioBruto * 100 : 0;
    // Este no es una parte del reparto: dice cuánto pesa la deuda sobre lo que
    // tienes, que es la cifra que importa de una deuda.
    const ratioPas = patrimonioBruto ? pas.total / patrimonioBruto * 100 : 0;
    const pctLiquidez = 100 - ratioInv - ratioInm - ratioCobrar;
    return { saldos, saldosCaja, saldosBroker, patrimonioLiquido, efectivoBroker,
             inv, inm, pas, cobrar, carteraTotal, patrimonioNeto, patrimonioBruto,
             ratioInv, ratioInm, ratioPas, ratioCobrar, pctLiquidez };
  }


  // ── Pasivos (deudas: hipotecas, préstamos, tarjetas…) ──
  // Aún no hay formulario para darlos de alta, pero el cálculo ya es real: en
  // cuanto el documento tenga db.pasivos, la tarjeta y la página los reflejan y
  // el patrimonio neto los descuenta.
  // Una deuda puede llevar su saldo escrito a mano (una hipoteca, que se
  // actualiza de tarde en tarde) o CALCULARSE de sus movimientos, que es lo que
  // conviene a una tarjeta de crédito: cada compra la aumenta y la liquidación
  // de fin de mes la salda, sin que haya que mantener la cifra a mano.
  //
  // Una tarjeta no es una cuenta: comprar con ella no baja la caja, sube la
  // deuda. Por eso sus movimientos NO entran en computeSaldos —el nombre de la
  // deuda no está entre las cuentas— y solo el cargo de la liquidación, que sí
  // sale de una cuenta real, mueve el efectivo.
  function saldoDeMovimientos(nombre, movimientos) {
    let debe = 0;
    for (const m of movimientos || []) {
      const imp = Math.abs(num(m.importe)) || 0;
      const o = String(m.cuenta_origen || "").trim();
      const d = String(m.cuenta_destino || "").trim();
      if (m.tipo === "Gasto" && o === nombre) debe += imp;          // compra: más deuda
      else if (m.tipo === "Ingreso" && d === nombre) debe -= imp;   // abono o devolución
      else if (m.tipo === "Traspaso" && d === nombre) debe -= imp;  // liquidación: la salda
      else if (m.tipo === "Traspaso" && o === nombre) debe += imp;
    }
    return round2(debe);
  }

  function valuatePasivos(pasivos, movimientos) {
    const items = (pasivos || [])
      .map((r) => {
        const nombre = r.nombre || r.concepto || "Deuda";
        const calculado = r.calcular === false ? null : saldoDeMovimientos(nombre, movimientos);
        return {
          id: r.id,
          nombre,
          tipo: r.tipo || "Préstamo",
          entidad: r.entidad || "",
          cuenta: r.cuenta || "",            // cuenta a la que está vinculada, si lo está
          importe: calculado != null && r.importe == null ? calculado : num(r.importe ?? r.pendiente ?? r.saldo),
        };
      })
      // Una deuda a cero sigue existiendo: una tarjeta saldada este mes vuelve a
      // tener saldo el que viene. Antes desaparecía de la lista y con ella la
      // única forma de mirar por qué su saldo es el que es.
      .filter((x) => isFinite(x.importe) && x.importe >= 0)
      .sort((a, b) => b.importe - a.importe);
    const vivas = items.filter((x) => x.importe > 0.005);
    return { items, vivas, n: vivas.length, total: round2(vivas.reduce((s, x) => s + x.importe, 0)) };
  }


  // ── Tarjetas de crédito ──────────────────────────────────────────────────
  // Una tarjeta de crédito no es una cuenta y por eso se porta distinto que
  // todo lo demás: comprar con ella no saca dinero de ningún sitio, crea deuda.
  // El dinero sale una sola vez, de golpe, el día que el banco pasa el recibo.
  //
  // Ese recibo es un traspaso, pero no uno cualquiera: los otros llevan dinero
  // de un bolsillo tuyo a otro y no cambian nada; este va de una cuenta a una
  // DEUDA y la deja en cero. Merece llamarse por su nombre —liquidación— y
  // comprobarse: si el importe no coincide con lo que la tarjeta debe ese día,
  // o falta un cargo o sobra otro, y la deuda se queda arrastrando un resto que
  // nadie sabe explicar tres meses después.
  //
  // Nada de esto está escrito para una tarjeta concreta: sale de los pasivos de
  // tipo «Tarjeta de crédito» y de la cuenta por la que se cobra cada una, así
  // que la Mastercard que se carga en Bankinter y la que mañana se cargue en
  // otro banco funcionan igual sin tocar una línea.
  function tarjetas(db) {
    const cuentas = new Set(CFG.cuentas().map((c) => c.cuenta));
    return ((db && db.pasivos) || [])
      .filter((r) => (r.tipo || "") === "Tarjeta de crédito")
      .map((r) => {
        // De dónde sale el dinero cuando llega el recibo. Se declara en la
        // deuda; si no está, se prueba con la entidad, que muchas veces ES la
        // cuenta —«Bankinter»— y así las tarjetas de siempre ya vienen atadas.
        const cuenta = [r.cuenta, r.entidad].map((x) => String(x || "").trim())
          .find((x) => cuentas.has(x)) || "";
        return { id: r.id, nombre: r.nombre || r.concepto || "Tarjeta", cuenta, entidad: r.entidad || "" };
      })
      .filter((t) => t.nombre);
  }

  // La tarjeta que salda este movimiento, si es que salda alguna.
  function tarjetaDeLiquidacion(db, m) {
    if (!m || m.tipo !== "Traspaso") return null;
    const d = String(m.cuenta_destino || "").trim();
    return tarjetas(db).find((t) => t.nombre === d) || null;
  }

  /*
   * Lo que la tarjeta debe el día `hasta`, y de qué viene.
   *
   *   pendiente  lo que hay que pagar para dejarla a cero: EL importe del recibo
   *   arrastre   lo que quedó vivo después del recibo anterior
   *   cargado    lo comprado en este ciclo (pendiente − arrastre)
   *   cargos     esos movimientos, para poder enseñarlos
   *
   * El arrastre entra en el pendiente, y tiene que entrar: si una compra del
   * día 29 el banco la mete en el recibo del mes siguiente, ese resto es deuda
   * viva hasta que se pague. Es el desfase del ciclo, y no es un error: es
   * cómo funciona una tarjeta.
   *
   * `excluir` es el id del propio recibo cuando se está editando. Sin eso, el
   * pendiente cambiaría cada vez que se toca el importe y jamás cuadraría.
   */
  function cicloTarjeta(nombre, movimientos, hasta, excluir) {
    const limite = hasta ? parseFechaES(hasta) : null;
    const lista = (movimientos || [])
      .filter((m) => {
        if (excluir && m.id === excluir) return false;
        const o = String(m.cuenta_origen || "").trim();
        const d = String(m.cuenta_destino || "").trim();
        if (o !== nombre && d !== nombre) return false;
        if (!limite) return true;
        const f = parseFechaES(m.fecha);
        return f && f <= limite;
      })
      .sort((a, b) => (parseFechaES(a.fecha) || 0) - (parseFechaES(b.fecha) || 0));

    let pendiente = 0, arrastre = 0, desde = "";
    let cargos = [];
    for (const m of lista) {
      const imp = Math.abs(num(m.importe)) || 0;
      const o = String(m.cuenta_origen || "").trim();
      const d = String(m.cuenta_destino || "").trim();
      const suma = (m.tipo === "Gasto" && o === nombre) || (m.tipo === "Traspaso" && o === nombre);
      pendiente = round2(pendiente + (suma ? imp : -imp));
      // Cada recibo cierra un ciclo y abre el siguiente con lo que quede.
      if (m.tipo === "Traspaso" && d === nombre) { desde = m.fecha; arrastre = pendiente; cargos = []; }
      else cargos.push(m);
    }
    return { nombre, pendiente, arrastre: round2(arrastre), cargado: round2(pendiente - arrastre),
             desde, cargos, n: cargos.length };
  }

  // ¿Cuadra este recibo con lo que la tarjeta debe? La respuesta que necesita
  // el formulario: sin adornos y con la diferencia exacta, que es lo único que
  // sirve para ir a buscar lo que falta.
  function revisarLiquidacion(db, mov) {
    const t = tarjetaDeLiquidacion(db, mov);
    if (!t) return null;
    const c = cicloTarjeta(t.nombre, (db || {}).movimientos, mov.fecha, mov.id);
    const importe = Math.abs(num(mov.importe)) || 0;
    const diferencia = round2(importe - c.pendiente);
    return Object.assign({ tarjeta: t, importe, diferencia,
                           cuadra: Math.abs(diferencia) < 0.005,
                           saldoDespues: round2(c.pendiente - importe) }, c);
  }

  // ── Cobros pendientes ────────────────────────────────────────────────────
  // Un derecho de cobro no es un movimiento: el dinero todavía no se ha movido.
  // Una cuota de alquiler que alguien te debe no puede registrarse como préstamo
  // —eso sacaría de tu caja un dinero que nunca salió— ni como ingreso —eso
  // metería uno que nunca entró—. Así que vive aparte, no toca ningún saldo y no
  // suma al patrimonio: es una lista de lo que esperas cobrar, y cuando cobras
  // se convierte en el ingreso de verdad y desaparece de aquí.
  function cobrosPendientes(db) {
    const items = ((db && db.cobros) || [])
      .map((c) => ({
        id: c.id, persona: c.persona || "", concepto: c.concepto || "",
        fecha: c.fecha || "", importe: num(c.importe),
        centro: c.centro || "", categoria: c.categoria || "", incobrable: !!c.incobrable,
      }))
      .filter((c) => isFinite(c.importe) && c.importe > 0)
      .sort((a, b) => parseFechaES(a.fecha) - parseFechaES(b.fecha));
    // Lo dado por incobrable deja de sumar, pero no se borra: perder dinero
    // también es información, y borrarlo sería fingir que nunca lo esperaste.
    const vivos = items.filter((c) => !c.incobrable);
    const perdidos = items.filter((c) => c.incobrable);
    const porPersona = {};
    vivos.forEach((c) => { porPersona[c.persona || "—"] = (porPersona[c.persona || "—"] || 0) + c.importe; });
    return { items: vivos, perdidos, n: vivos.length, porPersona,
             totalPerdido: round2(perdidos.reduce((s, c) => s + c.importe, 0)),
             total: round2(vivos.reduce((s, c) => s + c.importe, 0)) };
  }

  // Lo que te deben, junto: los cobros pendientes y el saldo vivo de lo que has
  // prestado. Es una clase de activo como la tesorería o la cartera —un derecho
  // de cobro—, y contarlo arregla de paso un disparate: hasta ahora, prestar
  // 500 € te empobrecía 500 €, como si los hubieras quemado. No: cambian de
  // sitio, de la cuenta a lo que te deben, y tu patrimonio no se mueve.
  function porCobrar(db) {
    const c = cobrosPendientes(db);
    const p = resumenPrestamos((db || {}).movimientos);
    return {
      cobros: c.total, prestamos: p.teDeben,
      total: round2(c.total + p.teDeben),
      n: c.n + p.vivos.length,
    };
  }

  // ── Categorías con jerarquía ─────────────────────────────────────────
  // Las categorías se guardan en el movimiento como texto: "Educación" o
  // "Educación > Formaciones". Mantener ese formato tiene una ventaja grande:
  // no hay que migrar nada y lo que ya escribiste sigue valiendo. La jerarquía
  // se deduce partiendo por ">".
  const SEP = ">";

  /*
   * Una categoría es una RUTA de la profundidad que haga falta:
   * "Vivienda > Suministros > Luz". partirCategoria sigue devolviendo madre e
   * hija —la madre es el primer nivel y la hija todo lo que cuelga— porque es
   * lo que espera la tabla de Balance y así un catálogo de tres niveles ya
   * funciona sin tocar la interfaz. rutaCategoria da los niveles sueltos, y
   * arbolCategorias construye el árbol completo para cuando la vista lo pinte.
   */
  function rutaCategoria(c) {
    const t = String(c || "").trim();
    if (!t) return ["Sin categoría"];
    const partes = t.split(SEP).map((x) => x.trim()).filter(Boolean);
    return partes.length ? partes : ["Sin categoría"];
  }

  function arbolCategorias(totales) {
    const raiz = { nombre: "", completa: "", total: 0, propio: 0, hijas: [], _idx: {} };
    for (const c in totales) {
      const ruta = rutaCategoria(c);
      let nodo = raiz;
      raiz.total += totales[c];
      ruta.forEach((paso, i) => {
        let hijo = nodo._idx[paso];
        if (!hijo) {
          hijo = nodo._idx[paso] = { nombre: paso, completa: ruta.slice(0, i + 1).join(" " + SEP + " "),
                                     nivel: i, total: 0, propio: 0, hijas: [], _idx: {} };
          nodo.hijas.push(hijo);
        }
        hijo.total += totales[c];
        // "propio" es lo imputado a ESTE nivel, sin contar lo de sus hijas
        if (i === ruta.length - 1) hijo.propio += totales[c];
        nodo = hijo;
      });
    }
    const limpiar = (n) => {
      delete n._idx;
      n.total = round2(n.total); n.propio = round2(n.propio);
      n.hijas.sort((a, b) => b.total - a.total);
      n.hijas.forEach(limpiar);
      return n;
    };
    return limpiar(raiz).hijas;
  }

  /*
   * Eje analítico: a qué centro de coste se imputa cada gasto. Es un eje
   * INDEPENDIENTE de la categoría, no un nivel más de ella. Si el destino
   * viviera dentro de la categoría —"Vivienda > Poza de la Sal > Luz"— no se
   * podría preguntar ni cuánto se gasta en luz en total ni cuánto cuesta Poza
   * de la Sal, que son justo las dos preguntas de la contabilidad analítica.
   */
  function arbolCentros(movimientos, desde, hasta) {
    const totales = {};
    for (const m of movimientos || []) {
      if (m.tipo !== "Gasto" || esMovInversion(m)) continue;
      const f = parseFechaES(m.fecha);
      if (!f || (desde && f < desde) || (hasta && f > hasta)) continue;
      const c = String(m.centro || "").trim() || "Sin imputar";
      totales[c] = (totales[c] || 0) + Math.abs(num(m.importe) || 0);
    }
    return arbolCategorias(totales);
  }

  function partirCategoria(c) {
    const t = String(c || "").trim();
    if (!t) return { madre: "Sin categoría", hija: null, completa: "Sin categoría" };
    const i = t.indexOf(SEP);
    if (i < 0) return { madre: t, hija: null, completa: t };
    const madre = t.slice(0, i).trim(), hija = t.slice(i + 1).trim();
    return { madre: madre || "Sin categoría", hija: hija || null, completa: t };
  }

  // Agrupa el gasto de un mes por categoría madre, con sus hijas dentro.
  function agruparCategorias(catGasto) {
    const madres = {};
    for (const c in catGasto) {
      const { madre, hija, completa } = partirCategoria(c);
      const m = madres[madre] || (madres[madre] = { nombre: madre, total: 0, hijas: [] });
      m.total += catGasto[c];
      m.hijas.push({ nombre: hija || madre, completa, total: catGasto[c], esPropia: !hija });
    }
    return Object.values(madres)
      .map((m) => { m.hijas.sort((a, b) => b.total - a.total); m.total = round2(m.total); return m; })
      .sort((a, b) => b.total - a.total);
  }

  // ── Regla 50/30/20 ───────────────────────────────────────────────────
  // Cada categoría se marca como necesaria (luz, alquiler, comida) o como deseo
  // (ropa, cenas fuera). El ahorro NO se clasifica: es lo que sobra, y como
  // comprar un fondo es una operación y no un gasto, el dinero que va a
  // inversión ya cuenta aquí como ahorro sin hacer nada más.
  //
  // Una subcategoría hereda la marca de su madre salvo que tenga la suya, así
  // que basta clasificar "Ocio" para que caigan todas sus hijas.
  const REGLA_DEFECTO = { necesario: 50, deseo: 30, ahorro: 20 };

  function clasificarCategoria(cat, clasificacion) {
    if (!clasificacion) return null;
    if (clasificacion[cat]) return clasificacion[cat];
    const { madre } = partirCategoria(cat);
    return clasificacion[madre] || null;
  }

  // Reparto del mes según la regla, sobre los ingresos (que es la base del 50/30/20)
  function repartoRegla(mes, clasificacion) {
    let necesario = 0, deseo = 0, sinClasificar = 0;
    for (const c in mes.catGasto) {
      const k = clasificarCategoria(c, clasificacion);
      if (k === "necesario") necesario += mes.catGasto[c];
      else if (k === "deseo") deseo += mes.catGasto[c];
      else sinClasificar += mes.catGasto[c];
    }
    const ahorro = mes.ingresos - mes.gastos;
    const base = mes.ingresos;
    const pct = (v) => (base > 0 ? v / base * 100 : NaN);
    return {
      necesario: round2(necesario), deseo: round2(deseo),
      sinClasificar: round2(sinClasificar), ahorro: round2(ahorro),
      pctNecesario: pct(necesario), pctDeseo: pct(deseo),
      pctSinClasificar: pct(sinClasificar), pctAhorro: pct(ahorro),
      base: round2(base),
    };
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

  // ── Cuánto cuesta y cuánto renta cada centro ─────────────────────────────
  // Devuelve un índice ruta → {gasto, ingreso, neto} con lo que cuelga debajo ya
  // sumado: preguntar por «Inmuebles > Almazara» tiene que responder por su
  // vivienda y su garaje a la vez, que es como se piensa en un inmueble.
  function resumenCentros(movimientos, desde, hasta) {
    const gastos = {}, ingresos = {};
    for (const m of movimientos || []) {
      if (m.tipo !== "Gasto" && m.tipo !== "Ingreso") continue;
      if (esAjuste(m) || esMovInversion(m)) continue;
      const f = parseFechaES(m.fecha);
      if (!f || (desde && f < desde) || (hasta && f > hasta)) continue;
      const imp = Math.abs(num(m.importe) || 0);
      if (!isFinite(imp) || imp <= 0) continue;
      const c = String(m.centro || "").trim() || "Sin imputar";
      const donde = m.tipo === "Gasto" ? gastos : ingresos;
      donde[c] = (donde[c] || 0) + imp;
    }
    const idx = {};
    const volcar = (nodos, campo) => nodos.forEach((n) => {
      (idx[n.completa] = idx[n.completa] || { gasto: 0, ingreso: 0 })[campo] = n.total;
      volcar(n.hijas, campo);
    });
    volcar(arbolCategorias(gastos), "gasto");
    volcar(arbolCategorias(ingresos), "ingreso");
    for (const k in idx) idx[k].neto = round2(idx[k].ingreso - idx[k].gasto);
    return idx;
  }

  // ── Lo que falta por identificar ─────────────────────────────────────────
  // Durante la reconstrucción, un apunte sin identificar paraba todo hasta saber
  // qué era: una categoría inventada es peor que ninguna, porque contamina el
  // reparto y no se distingue de las buenas. Esa red vivía en los scripts; aquí
  // es lo mismo, para que un apunte raro no se quede meses sin que nadie lo vea.
  const RE_PENDIENTE = /pendiente de identificar/i;
  function pendientes(movimientos) {
    const items = (movimientos || []).filter((m) => {
      if (m.tipo !== "Gasto" && m.tipo !== "Ingreso") return false;
      const cat = String((m.tipo === "Gasto" ? m.tipo_gasto : m.tipo_ingreso) || "").trim();
      return !cat || RE_PENDIENTE.test(cat);
    });
    return { items, n: items.length,
             importe: round2(items.reduce((t, m) => t + Math.abs(num(m.importe) || 0), 0)) };
  }
  const esPendiente = (m) => {
    if (m.tipo !== "Gasto" && m.tipo !== "Ingreso") return false;
    const cat = String((m.tipo === "Gasto" ? m.tipo_gasto : m.tipo_ingreso) || "").trim();
    return !cat || RE_PENDIENTE.test(cat);
  };

  // ── Préstamos entre personas ─────────────────────────────────────────────
  // «Dinero prestado» sale de una cuenta y crea una deuda a favor; «Devolución»
  // la salda. El saldo por persona es la resta, pero solo significa algo si las
  // dos patas están registradas: si el adelanto se apuntó como un gasto normal
  // —pagar la gasolina con la tarjeta y ya— la devolución se queda sola y el
  // saldo sale negativo, que leído literalmente diría que les debes tú. Por eso
  // se cuentan aparte las devoluciones huérfanas en vez de disimularlas.
  function resumenPrestamos(movimientos) {
    const por = {};
    for (const m of movimientos || []) {
      if (m.tipo !== "Préstamo") continue;
      const nombre = String(m.persona_prestamo || "").trim() || "Sin nombre";
      const p = por[nombre] || (por[nombre] = { nombre, prestado: 0, devuelto: 0, perdido: 0, movimientos: [] });
      const imp = Math.abs(num(m.importe) || 0);
      // Dar algo por incobrable cierra el saldo, pero no es dinero devuelto: si
      // se contara como devolución, la persona parecería haber pagado.
      if (m.tipo_prestamo === "Devolución") p.devuelto += imp;
      else if (m.tipo_prestamo === "Incobrable") p.perdido += imp;
      else p.prestado += imp;
      p.movimientos.push(m);
    }
    const personas = Object.values(por).map((p) => {
      p.prestado = round2(p.prestado); p.devuelto = round2(p.devuelto); p.perdido = round2(p.perdido);
      p.saldo = round2(p.prestado - p.devuelto - p.perdido);
      // Le devolvieron más de lo que consta prestado: falta el apunte del
      // adelanto, no es que la persona haya pagado de más.
      p.huerfano = p.saldo < -0.005;
      p.movimientos.sort((a, b) => (parseFechaES(a.fecha) || 0) - (parseFechaES(b.fecha) || 0));
      return p;
    }).sort((a, b) => b.saldo - a.saldo || a.nombre.localeCompare(b.nombre, "es"));
    const vivos = personas.filter((p) => p.saldo > 0.005);
    return {
      personas, vivos,
      teDeben: round2(vivos.reduce((t, p) => t + p.saldo, 0)),
      prestado: round2(personas.reduce((t, p) => t + p.prestado, 0)),
      devuelto: round2(personas.reduce((t, p) => t + p.devuelto, 0)),
      perdido: round2(personas.reduce((t, p) => t + p.perdido, 0)),
      huerfanos: personas.filter((p) => p.huerfano).length,
    };
  }

  // ── Revisión de salud ────────────────────────────────────────────────────
  // Lo que rompe una contabilidad no suele avisar. Un movimiento cambia de
  // cuenta al editarlo, una devolución se apunta dos veces, un pasivo se queda
  // en negativo: nada de eso da error, simplemente pasa, y se descubre semanas
  // después cuadrando a mano. Esto lo busca a propósito.
  // ── Texto mal codificado ─────────────────────────────────────────────────
  // Los PDF de Bankinter traen la Í rota y pdftotext la convierte en
  // interrogación: «CURENERG?A». leer_bankinter.py ya lo arregla al importar,
  // pero eso no toca lo que se guardó antes de que existiera esa corrección.
  // Esta tabla es la misma de allí, y aquí actúa sobre los apuntes ya guardados.
  const CORRECCIONES = { "CURENERG?A": "CURENERGÍA" };
  // Una interrogación entre dos letras nunca es una pregunta: es una letra que
  // no sobrevivió a la conversión del PDF.
  const RE_MAL = /[A-Za-zÀ-ÖØ-öø-ÿ]\?[A-Za-zÀ-ÖØ-öø-ÿ]/;
  const estaMal = (t) => RE_MAL.test(String(t || ""));

  function arreglarTexto(texto) {
    let t = String(texto || "");
    for (const malo in CORRECCIONES) {
      const bueno = CORRECCIONES[malo];
      let i = t.toUpperCase().indexOf(malo);
      while (i >= 0) {
        const original = t.slice(i, i + malo.length);
        // Se respeta cómo venía escrito: el mismo concepto aparece en
        // mayúsculas en unos extractos y capitalizado en otros.
        const puesto = original === original.toUpperCase()
          ? bueno
          : bueno.charAt(0) + bueno.slice(1).toLowerCase();
        t = t.slice(0, i) + puesto + t.slice(i + malo.length);
        i = t.toUpperCase().indexOf(malo, i + puesto.length);
      }
    }
    return t;
  }

  // Los que se pueden arreglar solos y los que habrá que mirar a mano.
  function textosMalCodificados(movs) {
    const out = [];
    for (const m of movs || []) {
      const campos = ["detalle", "detalle_banco"].filter((c) => estaMal(m[c]));
      if (!campos.length) continue;
      out.push({ id: m.id, campos, texto: String(m.detalle || m.detalle_banco || ""),
                 sabemos: campos.some((c) => arreglarTexto(m[c]) !== m[c]) });
    }
    return out;
  }

  function revision(db, prices) {
    const avisos = [];
    // Lo que ya has mirado y está bien no vuelve a preguntarse. Sin esto, un
    // aviso con diez falsos positivos se ignora entero a los tres días, y con él
    // se ignoran los verdaderos.
    const descartados = new Set(((db.config || {}).revision_ok) || []);
    let descartadosN = 0;
    const movs = (db.movimientos || []);
    const cuentas = new Set(CFG.cuentas().map((c) => c.cuenta));
    const pasivos = new Set((db.pasivos || []).map((d) => d.nombre || d.concepto));
    const hoy = new Date(); hoy.setHours(23, 59, 59, 999);
    // Cada hallazgo lleva una clave estable para poder descartarlo: los errores
    // no se descartan —hay que arreglarlos— y los avisos sí, porque son juicios
    // y el que sabe si dos cafés del mismo día son dos cafés eres tú.
    const mete = (nivel, titulo, detalle, items, accion) => {
      const vivos = (items || []).filter((x) => {
        if (nivel === "error" || !x.clave) return true;
        if (descartados.has(x.clave)) { descartadosN++; return false; }
        return true;
      });
      if (!vivos.length) return;
      avisos.push({ nivel, titulo, detalle, n: vivos.length, items: vivos, accion: accion || null });
    };
    const etiqueta = (m) => `${m.fecha} · ${(m.detalle || m.tipo_gasto || m.tipo_ingreso || m.tipo || "").slice(0, 44)}`;

    // Una deuda negativa no significa nada: significa que le falta un cargo o le
    // sobra un pago. Y como el patrimonio no puede restar una deuda negativa, se
    // esconde, así que sin esto no se entera nadie.
    const pasNeg = (db.pasivos || [])
      .filter((r) => r.calcular !== false && r.importe == null)
      .filter((r) => saldoDeMovimientos(r.nombre || r.concepto, movs) < -0.005)
      .map((r) => ({ texto: `${r.nombre || r.concepto}: ${round2(saldoDeMovimientos(r.nombre || r.concepto, movs))} €` }));
    mete("error", "Una deuda ha quedado en negativo",
         "Le falta algún cargo o le sobra algún pago. Mientras esté así no aparece en Pasivos y tu patrimonio sale inflado.", pasNeg);

    // Movimientos que apuntan a un sitio que ya no existe
    const huerfanos = movs.filter((m) => {
      const cs = [m.cuenta_origen, m.cuenta_destino].map((x) => String(x || "").trim()).filter(Boolean);
      return cs.some((c) => c !== "-" && !cuentas.has(c) && !pasivos.has(c));
    }).map((m) => ({ texto: etiqueta(m) }));
    mete("error", "Movimientos en una cuenta que no existe",
         "Su cuenta no está dada de alta ni es un pasivo, así que su dinero no entra en ningún saldo.", huerfanos);

    // Traspasos mal formados: si le falta una pata, el dinero se evapora
    const traspasosMal = movs.filter((m) => m.tipo === "Traspaso" &&
      (!String(m.cuenta_origen || "").trim() || !String(m.cuenta_destino || "").trim() ||
       String(m.cuenta_origen).trim() === String(m.cuenta_destino).trim())).map((m) => ({ texto: etiqueta(m) }));
    mete("error", "Traspasos con origen y destino mal puestos",
         "Un traspaso mueve dinero entre dos cuentas distintas: sin una de las dos, el dinero desaparece de un lado sin llegar al otro.", traspasosMal);

    const importesMal = movs.filter((m) => !(num(m.importe) > 0)).map((m) => ({ texto: etiqueta(m) }));
    mete("error", "Movimientos sin importe válido", "Un importe vacío, cero o negativo no se puede sumar.", importesMal);

    // Duplicados. Mismo día y mismo importe pasa constantemente —dos cafés, dos
    // bizums—, así que además tienen que compartir una palabra DISTINTIVA: una
    // que casi no aparezca en el resto de conceptos. «Bizum», «contactless» o el
    // número de la tarjeta salen en cientos de apuntes y no dicen nada; el
    // nombre de un comercio raro, sí. Así se detecta la fianza contada dos veces
    // en dos cuentas distintas sin sepultarlo en falsos positivos.
    const palabras = (m) => {
      const t = ((m.detalle || "") + " " + (m.detalle_banco || ""))
        .toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      return new Set(t.match(/[a-z]{5,}/g) || []);
    };
    const gastosIngresos = movs.filter((m) => m.tipo === "Gasto" || m.tipo === "Ingreso");
    const frecuencia = {};
    const suyas = gastosIngresos.map((m) => {
      const p = palabras(m);
      p.forEach((w) => { frecuencia[w] = (frecuencia[w] || 0) + 1; });
      return p;
    });
    const tope = Math.max(3, Math.round(gastosIngresos.length * 0.02));
    const porClave = {};
    gastosIngresos.forEach((m, i) => {
      const k = [m.fecha, round2(num(m.importe)), m.tipo].join("|");
      (porClave[k] = porClave[k] || []).push(i);
    });
    const dupes = [];
    for (const k in porClave) {
      const idx = porClave[k];
      for (let a = 0; a < idx.length; a++) {
        for (let b = a + 1; b < idx.length; b++) {
          const comunes = Array.from(suyas[idx[a]]).filter((w) => suyas[idx[b]].has(w) && frecuencia[w] <= tope);
          if (comunes.length) {
            const ids = [gastosIngresos[idx[a]].id, gastosIngresos[idx[b]].id].sort().join("|");
            dupes.push({ clave: "dup:" + ids,
                         texto: `${etiqueta(gastosIngresos[idx[a]])}  ·  y  ${String(gastosIngresos[idx[b]].detalle || "").slice(0, 34)}` });
          }
        }
      }
    }
    mete("aviso", "Posibles apuntes duplicados",
         "Mismo día, mismo importe y un concepto que se parece. A veces es casualidad; otras es el mismo dinero contado dos veces.", dupes);

    const futuros = movs.filter((m) => { const f = parseFechaES(m.fecha); return f && f > hoy; })
      .map((m) => ({ clave: "fut:" + m.id, texto: etiqueta(m) }));
    mete("aviso", "Movimientos con fecha futura", "Puede ser una fecha mal tecleada.", futuros);

    // Una cuenta corriente en negativo casi siempre es una imputación mal puesta
    const saldos = computeSaldos(movs, db.inversiones).saldos.filter((c) => c.saldo < -0.005)
      .map((c) => ({ clave: "neg:" + c.cuenta, texto: `${c.cuenta}: ${c.saldo.toFixed(2)} €` }));
    mete("aviso", "Cuentas con saldo negativo",
         "Salvo que tengas descubierto de verdad, suele significar que un gasto está cargado en la cuenta equivocada.", saldos);

    // Categorías o centros gemelos: los que solo se distinguen por tildes,
    // mayúsculas o espacios de más terminan siendo dos líneas donde hay una.
    const normal = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
    const gemelas = (lista) => {
      const por = {};
      Array.from(new Set(lista)).forEach((c) => { (por[normal(c)] = por[normal(c)] || []).push(c); });
      return Object.values(por).filter((v) => v.length > 1)
        .map((v) => ({ clave: "gem:" + normal(v[0]), texto: v.join("  ·  ") }));
    };
    mete("aviso", "Categorías que solo se distinguen por una tilde o un espacio",
         "Se cuentan como dos y parten en dos el gasto de la misma cosa.",
         gemelas(movs.flatMap((m) => [m.tipo_gasto, m.tipo_ingreso]).filter(Boolean)));
    mete("aviso", "Centros de coste gemelos", "Lo mismo, en el otro eje.",
         gemelas(movs.map((m) => m.centro).filter(Boolean)));

    // Letras que no sobrevivieron al PDF. No afecta a ninguna cuenta: solo se lee
    // mal, y por eso es aviso y no error.
    const malCodificados = textosMalCodificados(movs);
    const arreglables = malCodificados.filter((x) => x.sabemos).length;
    mete("aviso", "Texto con letras mal codificadas",
         "Un PDF con la Í rota deja «CURENERG?A» en el concepto. No cambia ninguna cifra, solo se lee mal.",
         malCodificados.map((x) => ({ clave: "moji:" + x.id, texto: x.texto.slice(0, 60) })),
         arreglables ? { fn: "v2ArreglarTextos()",
                         texto: arreglables === malCodificados.length
                           ? (arreglables === 1 ? "Arreglarlo" : "Arreglarlos")
                           : (arreglables === 1 ? "Arreglar el que sé"
                                                : "Arreglar los " + arreglables + " que sé") } : null);

    // Un activo con posición que no se puede valorar arrastra el patrimonio
    const inv = valuate(db, prices);
    const sinPrecio = (inv.assets || []).filter((a) => a.unidades > 1e-9 && !isFinite(a.importe))
      .map((a) => ({ texto: a.nombre }));
    mete("error", "Activos que no se pueden valorar",
         "Tienen posición abierta pero ni precio de mercado ni valor liquidativo, así que no suman en la cartera.", sinPrecio);

    const errores = avisos.filter((a) => a.nivel === "error").length;
    return { avisos, errores, total: avisos.length, descartados: descartadosN };
  }

  // ── Presupuesto anual (organizaciones) ───────────────────────────────────
  // Una asociación no presupuesta por meses, presupuesta el año: en la asamblea
  // se aprueba lo que se espera ingresar y lo que se piensa gastar, y durante
  // doce meses la pregunta es siempre la misma —cuánto llevamos ejecutado—.
  // Esto la responde: lo aprobado contra lo que dicen los movimientos.
  function presupuestoAnual(db, anio) {
    const aprobado = (((db.config || {}).presupuesto_anual || {})[String(anio)]) || {};
    const gasto = {}, ingreso = {};
    for (const m of db.movimientos || []) {
      const f = parseFechaES(m.fecha);
      if (!f || f.getFullYear() !== Number(anio)) continue;
      const imp = Math.abs(num(m.importe) || 0);
      if (m.tipo === "Gasto" && m.tipo_gasto) gasto[m.tipo_gasto] = (gasto[m.tipo_gasto] || 0) + imp;
      else if (m.tipo === "Ingreso" && m.tipo_ingreso) ingreso[m.tipo_ingreso] = (ingreso[m.tipo_ingreso] || 0) + imp;
    }
    // Lo ejecutado se acumula en la raíz de la categoría, que es el nivel al que
    // se aprueban las partidas: «Actividades», no «Actividades > Charlas > Sala».
    const raiz = (c) => String(c).split(SEP)[0].trim();
    const porRaiz = (obj) => {
      const out = {};
      for (const k in obj) out[raiz(k)] = round2((out[raiz(k)] || 0) + obj[k]);
      return out;
    };
    const eG = porRaiz(gasto), eI = porRaiz(ingreso);
    const linea = (nombre, tipo) => {
      const ejecutado = tipo === "ingreso" ? (eI[nombre] || 0) : (eG[nombre] || 0);
      const previsto = num((aprobado[tipo === "ingreso" ? "+" + nombre : nombre]) || 0) || 0;
      return { nombre, tipo, previsto: round2(previsto), ejecutado: round2(ejecutado),
               resto: round2(previsto - ejecutado),
               pct: previsto > 0 ? ejecutado / previsto * 100 : (ejecutado > 0 ? Infinity : 0) };
    };
    const nombresG = Array.from(new Set(Object.keys(eG).concat(
      Object.keys(aprobado).filter((k) => k[0] !== "+")))).sort((a, b) => a.localeCompare(b, "es"));
    const nombresI = Array.from(new Set(Object.keys(eI).concat(
      Object.keys(aprobado).filter((k) => k[0] === "+").map((k) => k.slice(1))))).sort((a, b) => a.localeCompare(b, "es"));
    const gastos = nombresG.map((n) => linea(n, "gasto"));
    const ingresos = nombresI.map((n) => linea(n, "ingreso"));
    const suma = (arr, campo) => round2(arr.reduce((t, x) => t + x[campo], 0));
    return {
      anio: Number(anio), gastos, ingresos,
      totales: {
        previstoGasto: suma(gastos, "previsto"), ejecutadoGasto: suma(gastos, "ejecutado"),
        previstoIngreso: suma(ingresos, "previsto"), ejecutadoIngreso: suma(ingresos, "ejecutado"),
      },
    };
  }

  // Los años que tienen algo escrito, para el selector de la página.
  function aniosConDatos(db) {
    const set = new Set();
    for (const m of db.movimientos || []) {
      const f = parseFechaES(m.fecha);
      if (f) set.add(f.getFullYear());
    }
    Object.keys((db.config || {}).presupuesto_anual || {}).forEach((a) => set.add(Number(a)));
    const hoy = new Date().getFullYear();
    set.add(hoy);
    return Array.from(set).filter((a) => a > 1990 && a < 2200).sort((a, b) => b - a);
  }

  // ── Flujo de caja mensual ────────────────────────────────────────────────
  // No es lo mismo que ingresos y gastos: aquí entra TODO lo que mueve el dinero
  // de las cuentas —incluidas las compras de inversión, que sacan dinero de la
  // caja aunque no sean un gasto, y los ajustes de efectivo, que sí se gastaron—
  // y quedan fuera los traspasos entre cuentas propias, que no son ni entrada ni
  // salida. La suma de los netos mensuales tiene que dar el saldo de caja de
  // hoy: si no lo diera, una de las dos cifras estaría mintiendo.
  function flujoMensual(db) {
    const cuentas = new Set(CFG.cuentas().map((c) => c.cuenta));
    const isC = (c) => c && c !== "-" && cuentas.has(c);
    const porMes = {};
    const mes = (f) => `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}`;
    const anota = (ym, campo, valor) => {
      const m = porMes[ym] || (porMes[ym] = { ym, entradas: 0, salidas: 0 });
      m[campo] += valor;
    };
    for (const m of db.movimientos || []) {
      if (esMovInversion(m)) continue;
      const f = parseFechaES(m.fecha); if (!f) continue;
      const imp = Math.abs(num(m.importe) || 0);
      const o = String(m.cuenta_origen || "").trim(), d = String(m.cuenta_destino || "").trim();
      const ym = mes(f);
      switch (m.tipo) {
        case "Ingreso": if (isC(d)) anota(ym, "entradas", imp); break;
        case "Gasto": if (isC(o)) anota(ym, "salidas", imp); break;
        case "Préstamo":
          if (m.tipo_prestamo === "Dinero prestado" && isC(o)) anota(ym, "salidas", imp);
          else if (m.tipo_prestamo === "Devolución" && isC(d)) anota(ym, "entradas", imp);
          break;
        case "Traspaso":
          // Entre dos cuentas propias no es ni entrada ni salida. Pero pagar el
          // recibo de la tarjeta también es un traspaso, y ahí el dinero sale de
          // verdad: la tarjeta es un pasivo, no una cuenta. Sin esto, los 4.734 €
          // de recibos de la Eurocard no aparecían por ninguna parte y la suma de
          // los netos no daba el saldo de caja.
          if (isC(o) && !isC(d)) anota(ym, "salidas", imp);
          else if (isC(d) && !isC(o)) anota(ym, "entradas", imp);
          break;
        default: break;
      }
    }
    for (const r of db.inversiones || []) {
      if (SIN_EFECTIVO.has(r.tipo_movimiento || "Compra")) continue;
      const f = parseFechaES(r.fecha); if (!f) continue;
      const coste = num(r.coste);
      if (!isFinite(coste) || !isC(String(r.cuenta || "").trim())) continue;
      // Una venta devuelve dinero a la cuenta: su coste viene en negativo
      if (coste >= 0) anota(mes(f), "salidas", coste); else anota(mes(f), "entradas", -coste);
    }
    const etiqueta = (ym) => {
      const [a, mm] = ym.split("-");
      return new Date(+a, +mm - 1, 1).toLocaleDateString("es-ES", { month: "short", year: "numeric" });
    };
    const meses = Object.values(porMes).sort((a, b) => a.ym.localeCompare(b.ym)).map((m) => ({
      ym: m.ym, label: etiqueta(m.ym),
      entradas: round2(m.entradas), salidas: round2(m.salidas), neto: round2(m.entradas - m.salidas),
    }));
    const n = Math.min(12, meses.length) || 1;
    const ult = meses.slice(-n);
    return {
      meses,
      media: {
        entradas: round2(ult.reduce((t, m) => t + m.entradas, 0) / n),
        salidas: round2(ult.reduce((t, m) => t + m.salidas, 0) / n),
        neto: round2(ult.reduce((t, m) => t + m.neto, 0) / n),
        n,
      },
    };
  }

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
      const mes = porMes[ym] || (porMes[ym] = { ym, ingresos: 0, gastos: 0, catGasto: {}, catIngreso: {},
                                                cenGasto: {}, cenIngreso: {} });
      // El centro de coste es el segundo eje y se acumula en paralelo: la misma
      // cifra contada por lo que se compró y por para qué se compró.
      const centro = String(m.centro || "").trim() || "Sin imputar";
      if (m.tipo === "Gasto") {
        mes.gastos += imp;
        const c = String(m.tipo_gasto || "").trim() || "Sin categoría";
        mes.catGasto[c] = (mes.catGasto[c] || 0) + imp;
        mes.cenGasto[centro] = (mes.cenGasto[centro] || 0) + imp;
      } else {
        mes.ingresos += imp;
        const c = String(m.tipo_ingreso || "").trim() || "Sin categoría";
        mes.catIngreso[c] = (mes.catIngreso[c] || 0) + imp;
        mes.cenIngreso[centro] = (mes.cenIngreso[centro] || 0) + imp;
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
        cenGasto: m.cenGasto, cenIngreso: m.cenIngreso,
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
    // ── Dos comparativas, porque responden a preguntas distintas ──
    //
    // "Mi rentabilidad": cuánto has ganado sobre lo que pagaste. Es tu resultado
    // real, pero NO sirve para comparar activos entre sí: uno comprado hace dos
    // años parte de un acumulado que otro de hace dos meses no puede tener.
    //
    // "Comportamiento": cuánto se ha movido el precio de cada activo desde que
    // lo tienes, con todas las líneas arrancando en 0 %. Esto sí compara, que es
    // para lo que sirve una comparativa.
    const comparativa = filas.map((f) => ({
      key: f.jk, label: f.nombre, isin: f.isin,
      puntos: meses.map((t, i) => (f.celdas[i] ? [t, f.celdas[i].rentPct] : [t, null])),
    }));
    comparativa.unshift({
      key: "__total", label: "Total cartera", isin: "-", destacada: true,
      puntos: meses.map((t, i) => (total[i] ? [t, total[i].rentPct] : [t, null])),
    });

    // Comportamiento del precio, rebasado a 0 % en el primer mes con dato
    function serieComportamiento(jk, etiqueta, isin, destacada) {
      const ptl = priceTL[jk];
      if (!ptl || ptl.length < 2) return null;
      // Solo desde que la tienes: antes de comprarla, su precio no te afectaba
      const desde = unitsTL[jk] ? unitsTL[jk][0][0] : ptl[0][0];
      let base = null;
      const puntos = meses.map((t) => {
        if (t < desde) return [t, null];
        const p = antesDe(ptl, t);
        if (p == null || !(p > 0)) return [t, null];
        if (base == null) base = p;
        return [t, (p / base - 1) * 100];
      });
      return puntos.some((x) => x[1] != null) ? { key: jk, label: etiqueta, isin, destacada, puntos } : null;
    }
    const comportamiento = filas
      .map((f) => serieComportamiento(f.jk, f.nombre, f.isin, false))
      .filter(Boolean);

    return { meses, filas, total, comparativa, comportamiento };
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
    // Efecto en efectivo de las operaciones (Compra resta, Venta suma; traspaso y
    // herencia, neutros): mantiene la continuidad del patrimonio.
    for (const r of db.inversiones || []) {
      if (SIN_EFECTIVO.has(r.tipo_movimiento || "Compra")) continue;
      const f = parseFechaES(r.fecha); if (!f) continue;
      const coste = num(r.coste);
      if (isFinite(coste) && isC(String(r.cuenta || "").trim())) {
        const t = f.getTime();
        deltaByDate[t] = (deltaByDate[t] || 0) - coste;
      }
    }
    // Lo que te deben, a lo largo del tiempo. Se lleva por persona y se suman
    // solo los saldos positivos, igual que en la tabla: a quien te ha devuelto
    // más de lo que consta prestado no se le debe un negativo, es que falta el
    // apunte del adelanto. Un cobro pendiente cuenta desde su fecha.
    const eventos = [];
    for (const m of db.movimientos || []) {
      if (m.tipo !== "Préstamo") continue;
      const f = parseFechaES(m.fecha); if (!f) continue;
      const imp = Math.abs(num(m.importe) || 0);
      const quien = String(m.persona_prestamo || "").trim() || "Sin nombre";
      const signo = m.tipo_prestamo === "Devolución" || m.tipo_prestamo === "Incobrable" ? -1 : 1;
      eventos.push({ t: f.getTime(), quien, delta: signo * imp });
      deltaByDate[f.getTime()] = deltaByDate[f.getTime()] || 0;   // que la fecha exista en la serie
    }
    const cobrosVivos = ((db.cobros || []).filter((c) => !c.incobrable))
      .map((c) => { const f = parseFechaES(c.fecha); return f ? { t: f.getTime(), v: num(c.importe) } : null; })
      .filter((x) => x && isFinite(x.v) && x.v > 0);
    cobrosVivos.forEach((c) => { deltaByDate[c.t] = deltaByDate[c.t] || 0; });
    eventos.sort((a, b) => a.t - b.t);
    const saldoQuien = {};
    let iEv = 0;
    function cobrarEn(t) {
      while (iEv < eventos.length && eventos[iEv].t <= t) {
        const e = eventos[iEv++];
        saldoQuien[e.quien] = (saldoQuien[e.quien] || 0) + e.delta;
      }
      let vivo = 0;
      for (const q in saldoQuien) if (saldoQuien[q] > 0.005) vivo += saldoQuien[q];
      return vivo + cobrosVivos.reduce((s, c) => s + (c.t <= t ? c.v : 0), 0);
    }

    // Las fechas se cierran aquí, cuando ya están todas: los préstamos y los
    // cobros añaden las suyas, y una serie a la que le falta una fecha dibuja un
    // escalón donde no lo hay.
    const dates = Object.keys(deltaByDate).map(Number).sort((a, b) => a - b);

    const inmCompra = (db.inmuebles || [])
      .map((r) => { const f = parseFechaES(r.fecha_adquisicion); return f ? { t: f.getTime(), v: num(r.tasacion) } : null; })
      .filter((x) => x && isFinite(x.v));
    const inmEn = (t) => inmCompra.reduce((s, x) => s + (x.t <= t ? x.v : 0), 0);

    // La caja se acumulaba ya para el patrimonio, pero no se devolvía, y era la
    // única de las tres que no se podía ver por separado. Es la que dice si el
    // mes se cerró con más dinero disponible o con menos, que es otra pregunta
    // distinta de cuánto vale todo lo que tienes.
    let liq = 0; const caja = [], cartera = [], patrimonio = [];
    for (const t of dates) {
      liq += deltaByDate[t];
      const cv = round2(invEn(t));
      caja.push([t, round2(liq)]);
      cartera.push([t, cv]);
      patrimonio.push([t, round2(liq + cv + inmEn(t) + cobrarEn(t))]);
    }
    return { caja, cartera, patrimonio };
  }

  window.SolventoModel = { build, buildSeries, buildAnalitica, buildGastos, resumenCentros, pendientes, esPendiente, resumenPrestamos, revision, arreglarTexto, textosMalCodificados, cobrosPendientes, porCobrar, tarjetas, tarjetaDeLiquidacion, cicloTarjeta, revisarLiquidacion, presupuestoAnual, aniosConDatos, flujoMensual, partirCategoria, rutaCategoria, agruparCategorias, arbolCategorias, arbolCentros, repartoRegla, clasificarCategoria, REGLA_DEFECTO, _internals: { computeSaldos, valuate, valuatePropiedades, parseFechaES, round2 } };
})();
