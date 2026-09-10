/*
 * Solvento — Cuentas: de quién son estos datos y dónde viven.
 *
 * Una cuenta es tres cosas: un nombre, un tipo (persona u organización) y un
 * almacén, que es el sitio del que se lee y al que se escribe su bloque cifrado.
 *
 *   { "nombre": "ABIES", "tipo": "organizacion",
 *     "almacen": { "owner": "…", "repo": "…", "branch": "main", "path": "data.enc" } }
 *
 * La cuenta POR DEFECTO de un despliegue viene en `perfil.json`, junto a los
 * datos. Sin ese archivo, todo se comporta como siempre: una persona y la
 * configuración del código.
 *
 * Las demás cuentas —las que abres tú porque eres el tesorero de una— viven en
 * ESTE dispositivo, no publicadas. Si la lista viajara en perfil.json,
 * cualquiera que abriese la web vería qué organizaciones usan Solvento y dónde
 * guardan. No hay razón para regalar eso.
 *
 * Cada cuenta tiene sus propias llaves en el navegador: su bloque cifrado, su
 * token y su sha. La cuenta por defecto conserva las de siempre, sin sufijo,
 * para que nada de lo que ya había se mueva de sitio.
 */
(function () {
  "use strict";

  const CFG = window.SolventoConfig;
  const K_CUENTAS = "solvento_cuentas";      // las añadidas en este dispositivo
  const K_ACTUAL = "solvento_cuenta";        // en cuál estabas
  const PRINCIPAL = "principal";

  let principal = { id: PRINCIPAL, nombre: "", tipo: "persona", almacen: Object.assign({}, CFG.SYNC) };
  let actualId = PRINCIPAL;
  let cargado = false;

  const leerJSON = (k, porDefecto) => {
    try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? porDefecto : v; }
    catch (e) { return porDefecto; }
  };
  const guardarExtras = (arr) => localStorage.setItem(K_CUENTAS, JSON.stringify(arr));
  const extras = () => (Array.isArray(leerJSON(K_CUENTAS, [])) ? leerJSON(K_CUENTAS, []) : []);

  const cuentas = () => [principal].concat(extras());
  const buscar = (id) => cuentas().find((c) => c.id === id) || principal;
  const actual = () => buscar(actualId);
  const esOrganizacion = () => actual().tipo === "organizacion";

  // Las llaves del navegador. La cuenta por defecto usa las de toda la vida: si
  // cambiaran, el bloque cifrado que ya está guardado dejaría de encontrarse.
  const sufijo = () => (actualId === PRINCIPAL ? "" : ":" + actualId);
  const claveBlob = () => "solvento_data_enc" + sufijo();
  const claveToken = () => "solvento_gh_token" + sufijo();
  const claveSha = () => "solvento_data_sha" + sufijo();

  async function cargar() {
    if (cargado) return actual();
    cargado = true;
    try {
      const r = await fetch("perfil.json?" + Date.now(), { cache: "no-store" });
      if (r.ok) {
        const p = await r.json();
        if (p && typeof p === "object") {
          principal = {
            id: PRINCIPAL,
            nombre: p.nombre || "",
            tipo: p.tipo === "organizacion" ? "organizacion" : "persona",
            almacen: Object.assign({}, CFG.SYNC, p.almacen || {}),
          };
        }
      }
    } catch (e) { /* sin perfil.json: una persona, y a trabajar */ }
    const guardada = localStorage.getItem(K_ACTUAL);
    usar(guardada && buscar(guardada).id === guardada ? guardada : PRINCIPAL);
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

  function alta(c) {
    const id = String(c.id || c.nombre || "").toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!id || id === PRINCIPAL) throw new Error("Ese nombre de cuenta no vale");
    if (extras().some((x) => x.id === id)) throw new Error("Ya hay una cuenta con ese nombre en este dispositivo");
    const cuenta = {
      id, nombre: c.nombre || id,
      tipo: c.tipo === "organizacion" ? "organizacion" : "persona",
      almacen: {
        owner: String(c.almacen.owner || "").trim(),
        repo: String(c.almacen.repo || "").trim(),
        branch: String(c.almacen.branch || "main").trim() || "main",
        path: String(c.almacen.path || "data.enc").trim() || "data.enc",
      },
    };
    if (!cuenta.almacen.owner || !cuenta.almacen.repo) throw new Error("Faltan el usuario y el repositorio de GitHub");
    guardarExtras(extras().concat([cuenta]));
    return cuenta;
  }

  // Quitar una cuenta de este dispositivo NO borra sus datos: siguen en su
  // repositorio, cifrados. Lo que se va es la copia local y el token.
  function borrar(id) {
    if (id === PRINCIPAL) return false;
    guardarExtras(extras().filter((x) => x.id !== id));
    [":" + id].forEach((s) => {
      localStorage.removeItem("solvento_data_enc" + s);
      localStorage.removeItem("solvento_gh_token" + s);
      localStorage.removeItem("solvento_data_sha" + s);
    });
    if (actualId === id) usar(PRINCIPAL);
    return true;
  }

  // El tipo se marca en el <body>: a partir de ahí el CSS enseña u oculta lo que
  // solo tiene sentido en una organización, sin que cada vista pregunte.
  function aplicar() {
    const c = actual();
    document.body.classList.toggle("es-organizacion", c.tipo === "organizacion");
    const el = document.getElementById("perfil-nombre");
    if (el) { el.textContent = c.nombre || ""; el.hidden = !c.nombre; }
    document.title = c.nombre ? c.nombre + " · Solvento" : "Solvento";
  }

  window.SolventoPerfil = {
    cargar, aplicar, usar, alta, borrar, cuentas, actual, esOrganizacion,
    claveBlob, claveToken, claveSha,
    datos: () => actual(),
    PRINCIPAL,
  };
})();
