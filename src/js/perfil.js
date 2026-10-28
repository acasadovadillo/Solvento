/*
 * Solvento — Cuentas: de quién son estos datos y dónde viven.
 *
 * Una cuenta es un usuario, un nombre, un tipo (persona u organización) y un
 * almacén: el sitio del que se lee y al que se escribe su bloque cifrado.
 *
 * El catálogo vive en `perfil.json` (en el repositorio de la app; los datos,
 * en el privado datos-cifrados), NO en el código:
 *
 *   { "cuentas": [
 *       { "usuario": "alberto", "nombre": "Alberto", "tipo": "persona",
 *         "almacen": { "owner": "…", "repo": "datos-cifrados", "branch": "main",
 *                      "path": "Solvento/alberto-solvento.enc", "privado": true } },
 *       { "usuario": "abies", "nombre": "ABIES", "tipo": "organizacion",
 *         "almacen": { "owner": "…", "repo": "datos-cifrados", "branch": "main",
 *                      "path": "Solvento/abies-solvento.enc", "privado": true } } ] }
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
  const E = window.SolventoEntorno;
  const K_ACTUAL = "solvento_cuenta";
  const PRINCIPAL = "principal";

  // En desarrollo, una cuenta que no se puede abrir: la que queda si falta
  // perfil.dev.json o si ninguna de sus cuentas es de desarrollo. No apunta a
  // ningún sitio real y ningún nombre de usuario la abre.
  const CERRADA = { id: PRINCIPAL, usuario: "\u0000sin-cuenta-de-desarrollo", nombre: "", tipo: "persona",
                    almacen: { owner: "dev", repo: "sin-perfil-dev", branch: "dev", path: "ninguna.enc", privado: false, dev: true } };
  // Sin perfil.json: una cuenta, la de siempre, con la configuración del código.
  // En desarrollo, nunca: la de siempre es la de producción.
  let catalogo = E && !E.prod ? [CERRADA]
    : [{ id: PRINCIPAL, usuario: "", nombre: "", tipo: "persona", almacen: Object.assign({}, CFG.SYNC) }];
  // El repositorio de la app: donde se publica la lista de símbolos para el
  // proceso de precios. Los datos ya no viven ahí, sino en un repositorio
  // privado; sin decir nada, el mismo de los datos, como antes.
  let app = null;
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
  // Cualquier otra llave de este navegador que sea de una cuenta y no de todas.
  const claveDe = (base) => base + sufijo();
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
      // «privado» siempre explícito: SYNC se reutiliza entre cuentas y no
      // puede quedarse con el de la anterior.
      almacen: Object.assign({}, CFG.SYNC, { privado: false }, c.almacen || {}),
    };
  }

  async function cargar() {
    if (cargado) return actual();
    cargado = true;
    try {
      const r = await fetch((E ? E.perfil : "perfil.json") + "?" + Date.now(), { cache: "no-store" });
      if (r.ok) {
        const p = await r.json();
        if (p && typeof p === "object") {
          const lista = Array.isArray(p.cuentas) && p.cuentas.length
            ? p.cuentas
            : [{ usuario: p.usuario, nombre: p.nombre, tipo: p.tipo, almacen: p.almacen }];
          // En desarrollo, solo valen las cuentas de desarrollo: una que diga
          // otra cosa se descarta y se avisa, en vez de abrirla.
          const validas = lista.filter((c) => {
            const motivo = E && E.almacenNoValido(c.almacen);
            if (motivo) E.aviso("cuenta «" + (c.usuario || "?") + "» descartada: " + motivo);
            return !motivo;
          });
          if (validas.length) catalogo = validas.map(normalizarCuenta);
          if (p.app && p.app.repo && !(E && E.almacenNoValido(p.app))) app = Object.assign({ branch: "main" }, p.app);
        }
      } else if (E && !E.prod) {
        E.aviso("falta " + E.perfil + ": no hay cuentas de desarrollo");
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
    document.title = (E && !E.prod ? "[DEV] " : "") + (nombre ? nombre + " · Solvento" : "Solvento");
  }
  function entrar(si) { dentro = si !== false; aplicar(); }

  window.SolventoPerfil = {
    cargar, aplicar, entrar, usar, cuentas, actual, porUsuario, esOrganizacion,
    claveBlob, claveToken, claveSha, claveDe,
    app: () => app,
    datos: () => actual(),
    PRINCIPAL,
  };
})();
