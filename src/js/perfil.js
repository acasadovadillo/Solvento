/*
 * Solvento — De quién es este Solvento.
 *
 * La misma aplicación sirve a una persona y a una asociación, y lo que las
 * distingue no es el código: es un archivo, `perfil.json`, que vive junto a los
 * datos y dice tres cosas.
 *
 *   {
 *     "nombre":  "ABIES",
 *     "tipo":    "organizacion",          // o "persona" (lo de siempre)
 *     "almacen": { "owner": "…", "repo": "…", "branch": "main", "path": "data.enc" }
 *   }
 *
 * Sin ese archivo, todo se comporta como siempre: una persona, y los datos donde
 * dice la configuración del código. Con él, la misma aplicación desplegada en
 * otro sitio guarda en otro sitio y enseña otras páginas.
 *
 * Esto es a propósito la pieza más pequeña posible: el día que los bloques
 * cifrados vivan en un servidor en vez de en un repositorio, cambia el
 * «almacen» de este archivo y no cambia nada más.
 */
(function () {
  "use strict";

  const CFG = window.SolventoConfig;
  const POR_DEFECTO = { nombre: "", tipo: "persona" };
  let perfil = Object.assign({}, POR_DEFECTO);
  let cargado = false;

  const esOrganizacion = () => perfil.tipo === "organizacion";

  async function cargar() {
    if (cargado) return perfil;
    cargado = true;
    try {
      const r = await fetch("perfil.json?" + Date.now(), { cache: "no-store" });
      if (r.ok) {
        const p = await r.json();
        if (p && typeof p === "object") {
          perfil = Object.assign({}, POR_DEFECTO, p);
          // SYNC es el mismo objeto que ya tiene sync.js en la mano, así que se
          // le cambian los campos en vez de sustituirlo: sustituirlo dejaría a
          // sync.js apuntando al de antes.
          if (p.almacen) Object.assign(CFG.SYNC, p.almacen);
        }
      }
    } catch (e) { /* sin perfil.json: una persona, y a trabajar */ }
    aplicar();
    return perfil;
  }

  // El tipo se marca en el <body>: a partir de ahí, el CSS enseña u oculta lo
  // que solo tiene sentido en una organización, sin que cada vista tenga que
  // preguntar.
  function aplicar() {
    document.body.classList.toggle("es-organizacion", esOrganizacion());
    if (perfil.nombre) {
      const el = document.getElementById("perfil-nombre");
      if (el) { el.textContent = perfil.nombre; el.hidden = false; }
      document.title = perfil.nombre + " · Solvento";
    }
  }

  window.SolventoPerfil = { cargar, aplicar, datos: () => perfil, esOrganizacion };
})();
