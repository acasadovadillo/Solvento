/*
 * Solvento — En qué entorno se está ejecutando la aplicación.
 *
 * Producción es UNA dirección: acasadovadillo.github.io. Cualquier otra
 * (localhost, la IP del Mac en la wifi, un servidor de pruebas…) es desarrollo,
 * y en desarrollo esta aplicación no puede tocar nada de producción:
 *
 *   · lee el catálogo de cuentas de perfil.dev.json, no de perfil.json
 *   · guarda y lee los datos en el servidor local (tools/dev/servidor.py), que
 *     imita la API de GitHub sobre la carpeta dev-data/, con datos de prueba
 *   · toda URL que vaya a GitHub se rechaza antes de salir, aunque algún día un
 *     cambio la escriba a mano
 *
 * Se decide por exclusión a propósito: si producción fuera «localhost no», un
 * despliegue en otra dirección se creería producción. Así, lo único que puede
 * hablar con los datos reales es la web publicada.
 *
 * Va antes que nada: config, sync, perfil y nav preguntan aquí.
 */
(function () {
  "use strict";

  const PRODUCCION = ["acasadovadillo.github.io"];
  const PROHIBIDOS = ["github.com", "githubusercontent.com"];

  const esProduccion = (host) => PRODUCCION.indexOf(String(host || "").toLowerCase()) >= 0;
  // El dominio de una URL. Sin el objeto URL a propósito: así funciona igual
  // en el navegador y en la prueba de humo. Una ruta relativa es de aquí mismo.
  const hostDe = (url) => {
    const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^/:?#]+)/i.exec(String(url || "").trim());
    if (m) return m[1].toLowerCase();
    return typeof location !== "undefined" ? String(location.hostname).toLowerCase() : "";
  };
  const esDeGithub = (url) => {
    const h = hostDe(url);
    return PROHIBIDOS.some((p) => h === p || h.endsWith("." + p));
  };

  // Sin `location` (la prueba de humo, fuera del navegador) es desarrollo.
  const host = typeof location !== "undefined" ? location.hostname : "";
  const prod = esProduccion(host);
  const origen = typeof location !== "undefined" ? location.origin : "http://localhost";

  // Dónde están los servicios. En desarrollo, el servidor local responde en
  // /__dev/api como la API de contenidos de GitHub y en /__dev/raw como raw.
  const base = prod
    ? { api: "https://api.github.com", raw: "https://raw.githubusercontent.com" }
    : { api: origen + "/__dev/api", raw: origen + "/__dev/raw" };

  // Última barrera: en desarrollo, una URL de GitHub no sale. Lanza en vez de
  // devolver algo, para que se vea el fallo y no pase en silencio.
  function url(u) {
    if (!prod && esDeGithub(u)) {
      const e = new Error("Entorno de desarrollo: bloqueada una llamada a producción (" + hostDe(u) + ")");
      e.code = "PRODUCCION_BLOQUEADA";
      throw e;
    }
    return u;
  }

  // Una cuenta de desarrollo tiene que decirlo (dev: true) y no puede apuntar
  // al repositorio real. Devuelve el motivo si no vale, o null si vale.
  function almacenNoValido(almacen) {
    if (prod) return null;
    if (!almacen || almacen.dev !== true) return "la cuenta no está marcada como de desarrollo (dev: true)";
    if (String(almacen.repo || "").toLowerCase() === "solvento") return "la cuenta apunta al repositorio de producción";
    // En desarrollo, solo repositorios de desarrollo (…-dev): aunque todo vaya
    // al servidor local, que no se confundan si algún día se copia el perfil.
    if (!/-dev$/i.test(String(almacen.repo || ""))) return "la cuenta no apunta a un repositorio de desarrollo (…-dev)";
    return null;
  }

  // Que se vea siempre dónde se está.
  function marcar() {
    if (prod || typeof document === "undefined" || !document.documentElement) return;
    document.documentElement.setAttribute("data-entorno", "desarrollo");
    if (document.title && document.title.indexOf("[DEV]") !== 0) document.title = "[DEV] " + document.title;
    if (!document.body || document.getElementById("banda-entorno")) return;
    const b = document.createElement("div");
    b.id = "banda-entorno";
    b.textContent = "DESARROLLO · datos de prueba";
    b.setAttribute("role", "status");
    b.style.cssText = "position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:5000;pointer-events:none;" +
      "background:#b45309;color:#fff;font:700 11px/1 system-ui,sans-serif;letter-spacing:0.08em;" +
      "padding:4px 10px;border-radius:0 0 8px 8px;box-shadow:0 1px 4px rgba(0,0,0,0.3);white-space:nowrap;";
    document.body.appendChild(b);
  }
  // Un problema del entorno se dice en la propia banda, que siempre está a la vista.
  function aviso(texto) {
    if (prod) return;
    if (typeof console !== "undefined") console.error("[entorno] " + texto);
    const b = typeof document !== "undefined" && document.getElementById && document.getElementById("banda-entorno");
    if (b) { b.textContent = "DESARROLLO · ⚠ " + texto; b.style.background = "#b91c1c"; }
    else if (typeof document !== "undefined" && document.addEventListener) {
      document.addEventListener("DOMContentLoaded", () => aviso(texto));
    }
  }
  if (typeof document !== "undefined" && document.addEventListener) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", marcar);
    else marcar();
  }

  window.SolventoEntorno = {
    prod, nombre: prod ? "produccion" : "desarrollo",
    perfil: prod ? "perfil.json" : "perfil.dev.json",
    base, url, almacenNoValido, esProduccion, esDeGithub, aviso,
  };
})();
