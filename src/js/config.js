/*
 * Solvento v2 — Configuración (NO es dato personal, vive en código).
 * Portado 1:1 de las constantes de generate.py: cuentas, activos conocidos,
 * mapa ISIN→ticker Yahoo, colores y objetivo de asignación.
 */
(function () {
  "use strict";

  // broker:true → su efectivo es de la cuenta de bróker (remunerada) y se muestra
  // en la página Cartera, no en Caja.
  const CUENTAS = [
    { cuenta: "Bankinter",      accent: "#FF6200", logo: "img/account-logo-bankinter.png" },
    { cuenta: "Santander",      accent: "#ec0000", logo: "img/account-logo-santander.png" },
    { cuenta: "Trade Republic", accent: "#ffffff", logo: "img/account-logo-trade-republic.png", broker: true },
    { cuenta: "MyInvestor",     accent: "#e12363", logo: "img/account-logo-myinvestor.png", broker: true },
    { cuenta: "Efectivo",       accent: "#2d9e5f", logo: null, emoji: "💵" },
  ];

  // Brókers de la página Cartera (sub-navegación). Bankinter tiene una
  // "Cuenta Broker" figurativa: siempre 0 €, solo agrupa sus fondos — el dinero
  // de sus compras sale de la cuenta corriente de Bankinter (que vive en Caja).
  const BROKERS = [
    { cuenta: "Trade Republic", efectivo: "cuenta" },
    { cuenta: "MyInvestor",     efectivo: "cuenta" },
    { cuenta: "Bankinter",      efectivo: "cero", etiquetaEfectivo: "Cuenta Broker" },
  ];

  // Activos conocidos (con ticker de Yahoo, o yf_ticker null si se valoran por NAV).
  // Los fondos Bankinter Premium/Horizonte NO están aquí: se derivan de los datos
  // y se valoran con su NAV (db.nav). yf_ticker null + sin NAV ⇒ "N/D".
  const ACTIVOS = [
    { nombre: "US Aggregate Bond USD (Acc)",     isin: "IE00BYXYYM63", categoria: "Renta fija",     tipo: "ETF",                banco: "Trade Republic", yf: "AGGG.L" },
    { nombre: "Core MSCI World USD (Acc)",       isin: "IE00B4L5Y983", categoria: "Renta variable", tipo: "ETF",                banco: "Trade Republic", yf: "IWDA.AS" },
    { nombre: "Core S&P 500 USD (Acc)",          isin: "IE00B5BMR087", categoria: "Renta variable", tipo: "ETF",                banco: "Trade Republic", yf: "CSPX.AS" },
    { nombre: "MSCI Emerging Markets USD (Acc)", isin: "IE000KCS7J59", categoria: "Renta variable", tipo: "ETF",                banco: "Trade Republic", yf: "EMIM.AS" },
    { nombre: "Physical Gold USD (Acc)",         isin: "IE00B4ND3602", categoria: "Renta variable", tipo: "ETF",                banco: "Trade Republic", yf: "PHAU.AS" },
    { nombre: "Bitcoin",                         isin: "-",            categoria: "Renta variable", tipo: "Criptoactivo",       banco: "Trade Republic", yf: "BTC-EUR" },
    { nombre: "Apple",                           isin: "US0378331005", categoria: "Renta variable", tipo: "Acciones",           banco: "Trade Republic", yf: "AAPL" },
    { nombre: "Renta 4 Multigestión Numantia Patrimonio Global FI", isin: "ES0173311103", categoria: "Renta variable", tipo: "Fondo de inversión", banco: "MyInvestor", yf: "0P000168OI.F" },
    { nombre: "Fidelity S&P 500 Index Fund P-ACC-EUR",              isin: "IE00BYX5MX67", categoria: "Renta variable", tipo: "Fondo de inversión", banco: "MyInvestor", yf: null },
    { nombre: "MSCI ACWI USD (Acc)",             isin: "IE00B6R52259", categoria: "Renta variable", tipo: "ETF",                banco: "Trade Republic", yf: "SSAC.AS" },
  ];

  const OBJETIVO_ASIGNACION = { "Renta variable": 60.0, "Renta fija": 40.0 };

  const CAT_COLORES = { "Renta variable": "#3b82f6", "Renta fija": "#10b981" };
  const TIPO_COLORES = { "ETF": "#8b5cf6", "Criptoactivo": "#f59e0b", "Acciones": "#ec4899", "Fondo de inversión": "#14b8a6" };
  const TIPO_COLORES_INMUEBLE = { "Apartamento": "#a16207", "Plaza de garaje": "#78716c", "Terreno rústico": "#65a30d" };
  const INMUEBLE_ACCENT_DEFAULT = "#a16207";

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
  const SYNC = { owner: "acasadovadillo", repo: "Solvento", branch: "main", path: "data.enc" };

  window.SolventoConfig = {
    CUENTAS, BROKERS, ACTIVOS, OBJETIVO_ASIGNACION,
    CAT_COLORES, TIPO_COLORES, TIPO_COLORES_INMUEBLE, INMUEBLE_ACCENT_DEFAULT,
    assetLogo, SYNC,
  };
})();
