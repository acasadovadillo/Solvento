/*
 * Solvento — El tema (claro, oscuro o el del sistema) y el color de acento.
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

  // ── El color de acento ──────────────────────────────────────────────
  // Al revés que el tema, el acento es de la CUENTA: se guarda cifrado en
  // config.acento y la acompaña a cualquier dispositivo (como en Ironrack). Por
  // eso la pantalla de entrada va siempre con el de Solvento —todavía no se
  // sabe quién entra— y el de cada uno se pone al abrir sus datos.
  //
  // Con el predeterminado no se toca nada: valen los colores de openclaw.css,
  // calculados a mano. Con otro, se sacan de él los mismos tonos, en las mismas
  // proporciones, para los dos temas, y se añaden en un <style> al final de la
  // página, que gana a las hojas de estilo.
  const ACENTO_SOLVENTO = "#1aac8c";
  const ACENTOS = [
    { nombre: "Verde azulado", color: ACENTO_SOLVENTO },
    { nombre: "Coral", color: "#ff5c5c" },
    { nombre: "Salmón", color: "#ff8067" },
    { nombre: "Ámbar", color: "#f6b94b" },
    { nombre: "Menta", color: "#50c99c" },
    { nombre: "Turquesa", color: "#31b9b0" },
    { nombre: "Azul", color: "#599cf3" },
    { nombre: "Lavanda", color: "#a78bf7" },
    { nombre: "Rosa", color: "#f572b4" },
    { nombre: "Pizarra", color: "#8795a7" },
  ];
  const acentoValido = (c) => /^#[0-9a-f]{6}$/i.test(String(c || ""));

  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const hex = (r, g, b) => "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
  function luminancia(h) {
    const v = rgb(h).map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }
  const contrasteBlanco = (h) => 1.05 / (luminancia(h) + 0.05);
  // Oscurecer hasta que se lea con blanco (texto blanco encima, o el color sobre
  // fondo blanco): 4,5:1, como el #11806a del botón y el #0f7c64 del tema claro.
  function oscurecerHasta(h, minimo) {
    let [r, g, b] = rgb(h), c = h;
    for (let i = 0; i < 60 && contrasteBlanco(c) < minimo; i++) { r *= 0.97; g *= 0.97; b *= 0.97; c = hex(r, g, b); }
    return c;
  }
  // El acento al p (0–1) sobre un fondo, mezclando en sRGB como color-mix()
  function mezcla(h, p, fondo) {
    const a = rgb(h), f = rgb(fondo);
    return hex(...a.map((v, i) => f[i] + (v - f[i]) * p));
  }

  let acentoActual = ACENTO_SOLVENTO;
  function acento(color) {
    const c = acentoValido(color) ? String(color).toLowerCase() : ACENTO_SOLVENTO;
    acentoActual = c;
    let st = document.getElementById("acento-cuenta");
    if (c === ACENTO_SOLVENTO) { if (st) st.remove(); return c; }
    if (!st) { st = document.createElement("style"); st.id = "acento-cuenta"; }
    document.head.appendChild(st);           // siempre la última, para ganar
    // Proporciones medidas en los rojos de OpenClaw: activo al 11 % y su borde
    // al 25 % sobre el fondo; insignia al 10 % y su borde al 42 % sobre la
    // tarjeta. En claro, sobre blanco: 10,5 %, 32 % y 42 %.
    const legible = oscurecerHasta(c, 4.5);
    st.textContent =
      `:root{--acento:${c};--acento-fondo:${mezcla(c, 0.11, "#0e1015")};--acento-borde:${mezcla(c, 0.25, "#0e1015")};` +
      `--insignia-fondo:${mezcla(c, 0.10, "#161920")};--insignia-borde:${mezcla(c, 0.42, "#161920")};` +
      `--primario-bg:${legible};--primario-t:#ffffff;}` +
      `:root[data-tema="claro"]{--acento:${legible};--acento-fondo:${mezcla(c, 0.105, "#ffffff")};--acento-borde:${mezcla(c, 0.32, "#ffffff")};` +
      `--insignia-fondo:${mezcla(c, 0.105, "#ffffff")};--insignia-borde:${mezcla(c, 0.42, "#ffffff")};` +
      `--primario-bg:${legible};--primario-t:#ffffff;}`;
    return c;
  }

  aplicar();
  if (sistema && sistema.addEventListener) sistema.addEventListener("change", aplicar);
  // Y por si el sistema cambió mientras la pestaña estaba de fondo —el móvil
  // que pasa a oscuro al anochecer— se vuelve a mirar al volver a ella.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) aplicar(); });
  window.addEventListener("focus", aplicar);

  window.SolventoTema = {
    poner, actual: guardado, efectivo: () => efectivo(guardado()), VALIDOS,
    acento, acentoActual: () => acentoActual, acentoValido, ACENTOS, ACENTO_SOLVENTO,
  };
})();
