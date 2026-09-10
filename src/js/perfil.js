/*
 * Solvento — Cuentas: de quién son estos datos y dónde viven.
 *
 * Una cuenta es un usuario, un nombre, un tipo (persona u organización) y un
 * almacén: el sitio del que se lee y al que se escribe su bloque cifrado.
 *
 * El catálogo vive en `perfil.json`, junto a los datos, NO en el código:
 *
 *   { "cuentas": [
 *       { "usuario": "alberto", "nombre": "Alberto", "tipo": "persona",
 *         "almacen": { "owner": "…", "repo": "…", "branch": "main", "path": "data.enc" } },
 *       { "usuario": "abies", "nombre": "ABIES", "tipo": "organizacion",
 *         "almacen": { "owner": "…", "repo": "…", "branch": "main", "path": "data.enc" } } ] }
 *
 * El login solo pide usuario y contraseña, como cualquier login: el usuario dice
 * QUÉ cuenta abrir y la contraseña la abre. Dónde guarda cada una es
 * configuración, y la configuración no se le pregunta a nadie al entrar.
 *
 * Esto es a propósito la misma forma que tendrá con un servidor detrás: hoy la
 * tabla de cuentas es un archivo y mañana la contesta el backend. Cambia de
 * dónde sale la tabla; no cambia el login ni el resto de la aplicación.
 *
 * Cada cuenta tiene sus propias llaves en el navegador —su bloque, su token y su
 * sha—. La primera del catálogo conserva las de siempre, sin sufijo, para que
 * nada de lo que ya había se mueva de sitio.
 */
(function () {
  "use strict";

  const CFG = window.SolventoConfig;
  const K_ACTUAL = "solvento_cuenta";
  const PRINCIPAL = "principal";

  // Sin perfil.json: una cuenta, la de siempre, con la configuración del código.
  let catalogo = [{ id: PRINCIPAL, usuario: "", nombre: "", tipo: "persona",
                    almacen: Object.assign({}, CFG.SYNC) }];
  let actualId = PRINCIPAL;
  let cargado = false;

  const normal = (s) => String(s == null ? "" : s).trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const cuentas = () => catalogo;
  const buscar = (id) => catalogo.find((c) => c.id === id) || catalogo[0];
  const actual = () => buscar(actualId);
  const esOrganizacion = () => actual().tipo === "organizacion";
  // Sin catálogo declarado, cualquier usuario abre la única cuenta que hay: es
  // un despliegue de una sola persona y no tiene a quién confundir.
  const porUsuario = (u) => (catalogo.length === 1 && !catalogo[0].usuario)
    ? catalogo[0]
    : catalogo.find((c) => normal(c.usuario) === normal(u));

  // Las llaves del navegador. La primera cuenta usa las de toda la vida: si
  // cambiaran, el bloque cifrado que ya está guardado dejaría de encontrarse.
  const sufijo = () => (actualId === PRINCIPAL ? "" : ":" + actualId);
  const claveBlob = () => "solvento_data_enc" + sufijo();
  const claveToken = () => "solvento_gh_token" + sufijo();
  const claveSha = () => "solvento_data_sha" + sufijo();

  function normalizarCuenta(c, i) {
    const id = i === 0 ? PRINCIPAL : (normal(c.usuario || c.nombre || "").replace(/[^a-z0-9]+/g, "-") || "cuenta" + i);
    return {
      id,
      usuario: c.usuario || "",
      nombre: c.nombre || c.usuario || "",
      tipo: c.tipo === "organizacion" ? "organizacion" : "persona",
      almacen: Object.assign({}, CFG.SYNC, c.almacen || {}),
    };
  }

  async function cargar() {
    if (cargado) return actual();
    cargado = true;
    try {
      const r = await fetch("perfil.json?" + Date.now(), { cache: "no-store" });
      if (r.ok) {
        const p = await r.json();
        if (p && typeof p === "object") {
          const lista = Array.isArray(p.cuentas) && p.cuentas.length
            ? p.cuentas
            : [{ usuario: p.usuario, nombre: p.nombre, tipo: p.tipo, almacen: p.almacen }];
          catalogo = lista.map(normalizarCuenta);
        }
      }
    } catch (e) { /* sin perfil.json: la cuenta de siempre, y a trabajar */ }
    const guardada = localStorage.getItem(K_ACTUAL);
    usar(guardada && buscar(guardada).id === guardada ? guardada : catalogo[0].id);
    return actual();
  }

  // Cambiar de cuenta es cambiar de almacén y de llaves. Nada más: los datos de
  // una y otra no se tocan nunca porque viven en sitios distintos.
  function usar(id) {
    actualId = buscar(id).id;
    localStorage.setItem(K_ACTUAL, actualId);
    // SYNC es el mismo objeto que sync.js tiene en la mano: se le cambian los
    // campos en vez de sustituirlo, o seguiría apuntando al de antes.
    Object.assign(CFG.SYNC, actual().almacen);
    aplicar();
    return actual();
  }

  // El tipo se marca en el <body>: a partir de ahí el CSS enseña u oculta lo que
  // solo tiene sentido en una organización, sin que cada vista pregunte.
  // El nombre de la cuenta no se enseña hasta que se ha entrado: en la pantalla
  // de login, un «Alberto» en la pestaña le dice a cualquiera que pase por
  // delante de quién es este Solvento.
  let dentro = false;
  function aplicar() {
    const c = actual();
    document.body.classList.toggle("es-organizacion", c.tipo === "organizacion");
    const el = document.getElementById("perfil-nombre");
    const nombre = dentro ? (c.nombre || "") : "";
    if (el) { el.textContent = nombre; el.hidden = !nombre; }
    document.title = nombre ? nombre + " · Solvento" : "Solvento";
  }
  function entrar(si) { dentro = si !== false; aplicar(); }

  window.SolventoPerfil = {
    cargar, aplicar, entrar, usar, cuentas, actual, porUsuario, esOrganizacion,
    claveBlob, claveToken, claveSha,
    datos: () => actual(),
    PRINCIPAL,
  };
})();
