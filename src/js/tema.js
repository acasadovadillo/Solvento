/*
 * Solvento — El tema: claro, oscuro o el del sistema.
 *
 * Se carga en <head>, antes que las hojas de estilo y en línea con la página,
 * a propósito: si se aplicara después de pintar, quien tenga el tema claro
 * vería un fogonazo oscuro en cada carga. Aquí no hay documento ni contraseña
 * todavía, y no hacen falta: el tema es una preferencia del DISPOSITIVO, como
 * el token, no un dato de la cuenta. Vive en localStorage y se aplica también
 * a la pantalla de entrada.
 *
 * «auto» sigue al sistema y se entera si el sistema cambia a media sesión.
 */
(function () {
  "use strict";
  const CLAVE = "solvento_tema";
  const VALIDOS = ["auto", "claro", "oscuro"];
  const sistema = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;

  const guardado = () => {
    try { const v = localStorage.getItem(CLAVE); return VALIDOS.indexOf(v) >= 0 ? v : "auto"; }
    catch (e) { return "auto"; }
  };
  const efectivo = (pref) => pref === "auto" ? (sistema && sistema.matches ? "claro" : "oscuro") : pref;

  function aplicar() {
    const t = efectivo(guardado());
    document.documentElement.setAttribute("data-tema", t);
    // El color de la barra del navegador en el móvil: el del fondo de la página.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t === "claro" ? "#eef0f4" : "#12141d");
  }
  function poner(pref) {
    if (VALIDOS.indexOf(pref) < 0) pref = "auto";
    try { localStorage.setItem(CLAVE, pref); } catch (e) { /* sin almacenamiento: dura la sesión */ }
    aplicar();
  }

  aplicar();
  if (sistema && sistema.addEventListener) sistema.addEventListener("change", aplicar);
  // Y por si el sistema cambió mientras la pestaña estaba de fondo —el móvil
  // que pasa a oscuro al anochecer— se vuelve a mirar al volver a ella.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) aplicar(); });
  window.addEventListener("focus", aplicar);

  window.SolventoTema = { poner, actual: guardado, efectivo: () => efectivo(guardado()), VALIDOS };
})();
