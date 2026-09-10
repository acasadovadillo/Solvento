/*
 * Solvento v2 — Configuración (NO es dato personal, vive en código).
 * Portado 1:1 de las constantes de generate.py: cuentas, activos conocidos,
 * mapa ISIN→ticker Yahoo, colores y objetivo de asignación.
 */
(function () {
  "use strict";

  // TODO el efectivo vive en Caja, también el que está en un bróker: aunque la
  // cuenta esté remunerada, es dinero líquido que puedes sacar y no está
  // invertido en ningún producto. Meterlo en Cartera deformaba su valor y su
  // rentabilidad.
  //
  // `cartera` indica que esa cuenta agrupa posiciones en la sub-navegación de
  // Cartera: "efectivo" si además tiene saldo propio que enseñar como pólvora
  // seca, "cero" si es figurativa (la Cuenta Broker de Bankinter).
  const CUENTAS_DEFECTO = [
    { cuenta: "Bankinter",      accent: "#FF6200", logo: "img/account-logo-bankinter.png", cartera: "cero", etiquetaEfectivo: "Cuenta Broker" },
    { cuenta: "Santander",      accent: "#ec0000", logo: "img/account-logo-santander.png" },
    { cuenta: "Trade Republic", accent: "#ffffff", logo: "img/account-logo-trade-republic.png", cartera: "efectivo" },
    { cuenta: "MyInvestor",     accent: "#e12363", logo: "img/account-logo-myinvestor.png", cartera: "efectivo" },
    { cuenta: "Revolut",        accent: "#191c1f", logo: "img/account-logo-revolut.png" },
    { cuenta: "Efectivo",       accent: "#2d9e5f", logo: null, emoji: "💵" },
  ];


  // Activos conocidos con su ticker de Yahoo. El ticker no es un dato personal
  // —dice qué se cotiza, no cuánto tienes— y por eso vive aquí, en el código.
  //
  // Los fondos que no cotizan en bolsa también tienen símbolo en Yahoo: los «0P…»
  // son las fichas de fondo, y un fondo europeo suele estar además listado en
  // Stuttgart con su propio ISIN. Vale la pena buscarlo antes de dejar un activo
  // en NAV manual: el valor liquidativo escrito a mano deja de actualizarse en
  // cuanto uno se olvida, y entonces la cartera vale lo que valía aquel día.
  const ACTIVOS_DEFECTO = [
    { nombre: "US Aggregate Bond USD (Acc)",     isin: "IE00BYXYYM63", categoria: "Renta fija",     tipo: "ETF",                banco: "Trade Republic", yf: "IUAA.L" },
    { nombre: "Core MSCI World USD (Acc)",       isin: "IE00B4L5Y983", categoria: "Renta variable", tipo: "ETF",                banco: "Trade Republic", yf: "IWDA.AS" },
    { nombre: "Core S&P 500 USD (Acc)",          isin: "IE00B5BMR087", categoria: "Renta variable", tipo: "ETF",                banco: "Trade Republic", yf: "CSPX.AS" },
    { nombre: "MSCI Emerging Markets USD (Acc)", isin: "IE000KCS7J59", categoria: "Renta variable", tipo: "ETF",                banco: "Trade Republic", yf: "HEMA.L" },
    { nombre: "Physical Gold USD (Acc)",         isin: "IE00B4ND3602", categoria: "Renta variable", tipo: "ETF",                banco: "Trade Republic", yf: "IGLN.L" },
    { nombre: "Bitcoin",                         isin: "-",            categoria: "Renta variable", tipo: "Criptoactivo",       banco: "Trade Republic", yf: "BTC-EUR" },
    { nombre: "Apple",                           isin: "US0378331005", categoria: "Renta variable", tipo: "Acciones",           banco: "Trade Republic", yf: "AAPL" },
    { nombre: "Renta 4 Multigestión Numantia Patrimonio Global FI", isin: "ES0173311103", categoria: "Renta variable", tipo: "Fondo de inversión", banco: "MyInvestor", yf: "0P000168OI.F" },
    // Cotiza en Stuttgart: da precio del día, pero no serie histórica. La
    // valoración de hoy sale de ahí y la gráfica sigue apoyándose en el NAV.
    { nombre: "Fidelity S&P 500 Index Fund P-ACC-EUR",              isin: "IE00BYX5MX67", categoria: "Renta variable", tipo: "Fondo de inversión", banco: "MyInvestor", yf: "IE00BYX5MX67.SG" },
    { nombre: "Bankinter Horizonte 2028 Cl R",                      isin: "ES0159038001", categoria: "Renta fija",     tipo: "Fondo de inversión", banco: "Bankinter",  yf: "0P0001M4BN.F" },
    { nombre: "Bankinter Premium Moderado R",                       isin: "ES0164586036", categoria: "Renta variable", tipo: "Fondo de inversión", banco: "Bankinter",  yf: "0P0001MV1P.F" },
    { nombre: "MSCI ACWI USD (Acc)",             isin: "IE00B6R52259", categoria: "Renta variable", tipo: "ETF",                banco: "Trade Republic", yf: "SSAC.AS" },
  ];

  const OBJETIVO_DEFECTO = { "Renta variable": 60.0, "Renta fija": 40.0 };

  const CAT_COLORES = { "Renta variable": "#3b82f6", "Renta fija": "#10b981" };
  const TIPO_COLORES = { "ETF": "#8b5cf6", "Criptoactivo": "#f59e0b", "Acciones": "#ec4899", "Fondo de inversión": "#14b8a6" };
  // Tipos de propiedad: inmuebles y todo lo demás que tenga valor
  const TIPO_COLORES_INMUEBLE = {
    "Apartamento": "#a16207", "Plaza de garaje": "#78716c", "Terreno rústico": "#65a30d",
    "Casa": "#b45309", "Local": "#92400e",
    "Vehículo": "#0ea5e9", "Obra de arte": "#d946ef", "Reloj": "#f59e0b",
    "Metal precioso": "#eab308", "Coleccionable": "#8b5cf6", "Otro": "#6b7280",
  };
  // Tipos de deuda. Tonos cálidos, distintos entre sí y sin robarle el rojo a
  // las cifras en negativo: aquí el color identifica un tipo, no una alarma.
  const TIPO_COLORES_PASIVO = {
    "Hipoteca": "#b91c1c", "Préstamo personal": "#ea580c", "Préstamo coche": "#d97706",
    "Tarjeta de crédito": "#e11d48", "Deuda con particular": "#9333ea", "Otro": "#6b7280",
  };
  const PASIVO_ACCENT_DEFAULT = "#9f1239";

  // Los que se valoran por peso piden gramos y metal en vez de tasación
  const TIPOS_POR_PESO = ["Metal precioso"];
  const INMUEBLE_ACCENT_DEFAULT = "#a16207";

  // Paleta para la comparativa de rentabilidad (una línea por activo).
  // Tonos bien separados para que se distingan sobre fondo oscuro.
  const SERIE_COLORES = ["#3b82f6", "#f59e0b", "#ec4899", "#14b8a6", "#a78bfa",
                         "#84cc16", "#f87171", "#22d3ee", "#fb923c", "#c084fc",
                         "#4ade80", "#e879f9"];

  const ASSET_LOGO_BY_ISIN = {
    "IE00BYXYYM63": "asset-etf-logo-us-bond.png",
    "IE00B4L5Y983": "asset-etf-logo-msci-world.png",
    "IE00B5BMR087": "asset-etf-logo-sp500.png",
    "IE000KCS7J59": "asset-etf-logo-msci-emerging-markets.png",
    "IE00B4ND3602": "asset-etf-logo-gold.png",
    "US0378331005": "asset-logo-apple.png",
    "ES0164586036": "asset-logo-bankinter.png",
    "ES0159038001": "asset-logo-bankinter.png",
    "ES0173311103": "asset-fund-logo-numantia.png",
    "IE00BYX5MX67": "asset-fund-logo-sp500.png",
    "IE00B6R52259": "asset-etf-logo-msci-world.png",
  };
  // Fallback por palabra clave cuando no hay ISIN (Bitcoin) o no está mapeado.
  const ASSET_LOGO_KEYWORDS = [["bitcoin", "asset-logo-bitcoin.png"], ["bankinter", "asset-logo-bankinter.png"]];

  function assetLogo(nombre, isin) {
    let f = ASSET_LOGO_BY_ISIN[String(isin || "").trim()];
    if (!f) {
      const n = String(nombre || "").toLowerCase();
      for (const [kw, file] of ASSET_LOGO_KEYWORDS) if (n.includes(kw)) { f = file; break; }
    }
    return f ? "img/" + f : null;
  }

  // Sincronización: dónde vive el bloque cifrado (data.enc) en GitHub.
  // El repo es público, así que LEER data.enc no necesita token; ESCRIBIR sí
  // (token fine-grained con permiso Contents: Read/Write solo en este repo).
  const SYNC = { owner: "acasadovadillo", repo: "Solvento", branch: "main", path: "alberto-data.enc" };


  // ── Configuración editable ──────────────────────────────────────────
  // Cuentas, activos y objetivo de asignación viven en TU documento cifrado
  // (doc.config), no en el código. Lo de arriba es solo el valor de partida:
  // en cuanto edites algo desde Ajustes, manda tu versión. Así puedes abrir una
  // cuenta o dar de alta un ETF sin tocar código.
  let DOC = null;
  const usarDoc = (doc) => { DOC = doc; };
  const cfgDoc = () => (DOC && DOC.config) || {};

  // Los logos son cosméticos y viven en el código, no en el documento cifrado.
  // Una cuenta dada de alta desde fuera de la web —un script de importación, por
  // ejemplo— no los trae, y sin este relleno se quedaría sin marca aunque el
  // archivo estuviera en img/. Solo se completa lo que falta: lo que diga tu
  // documento manda siempre.
  const cuentas = () => {
    const propias = cfgDoc().cuentas;
    if (!propias) return CUENTAS_DEFECTO;
    return propias.map((c) => {
      if (c.logo) return c;
      const d = CUENTAS_DEFECTO.find((x) => x.cuenta === c.cuenta);
      return d && d.logo ? Object.assign({}, c, { logo: d.logo }) : c;
    });
  };
  // El ticker se completa igual que el logo de una cuenta: si tu activo no trae
  // ninguno y el catálogo del código conoce uno para ese ISIN, se usa. Así un
  // fondo que se dio de alta cuando no le encontramos símbolo deja de depender
  // del NAV escrito a mano sin que tengas que tocar nada.
  const tickerConocido = (isin) => {
    const s = String(isin || "").trim();
    if (!s || s === "-") return null;
    const a = ACTIVOS_DEFECTO.find((x) => x.isin === s);
    return (a && a.yf) || null;
  };
  const activos = () => {
    const propios = cfgDoc().activos;
    if (!propios) return ACTIVOS_DEFECTO;
    return propios.map((a) => (a.yf ? a : Object.assign({}, a, { yf: tickerConocido(a.isin) })));
  };
  const objetivo = () => cfgDoc().objetivo || OBJETIVO_DEFECTO;
  // Los brókers de la sub-navegación de Cartera se deducen de las cuentas:
  // aparece ahí toda cuenta con `cartera` ("efectivo" si tiene saldo propio,
  // "cero" si es figurativa como la Cuenta Broker de Bankinter).
  const brokers  = () => cuentas().filter((c) => c.cartera);

  window.SolventoConfig = {
    usarDoc, cuentas, activos, objetivo, brokers, tickerConocido,
    CUENTAS_DEFECTO, ACTIVOS_DEFECTO, OBJETIVO_DEFECTO,
    CAT_COLORES, TIPO_COLORES, TIPO_COLORES_INMUEBLE, TIPOS_POR_PESO, INMUEBLE_ACCENT_DEFAULT, SERIE_COLORES,
    TIPO_COLORES_PASIVO, PASIVO_ACCENT_DEFAULT,
    assetLogo, SYNC,
  };
})();
