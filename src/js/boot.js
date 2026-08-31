/*
 * Solvento v2 — Arranque: login que DESCIFRA (o importación inicial).
 *
 * Flujo:
 *   · Si ya hay un bloque cifrado guardado → pantalla de login (contraseña →
 *     descifra → desbloquea).
 *   · Si no lo hay (primera vez en este dispositivo) → importación inicial:
 *     carga data.json, el usuario elige contraseña, el navegador cifra y guarda
 *     el bloque. La contraseña NUNCA se guarda ni sale del navegador.
 *
 * Tras desbloquear se muestra una vista mínima en solo-lectura que prueba que
 * los datos reales están disponibles. El render completo (analítica, gráficas)
 * es la Fase 2.
 */
(function () {
  "use strict";
  const C = window.SolventoCrypto;
  const DB = window.SolventoDB;

  const $ = (id) => document.getElementById(id);
  let PRICES = null; // prices.json (público); puede llegar tras el desbloqueo

  // ── Desbloqueo ──
  function unlock(doc) {
    DB.state.doc = doc;
    $("boot-overlay").style.display = "none";
    document.documentElement.style.overflow = "";
    $("app").style.display = "block";
    render();
  }

  function render() {
    if (DB.state.doc && window.SolventoRender) {
      window.SolventoRender.render(DB.state.doc, PRICES);
    }
  }

  function lock() {
    DB.state.doc = null;
    $("app").style.display = "none";
    document.documentElement.style.overflow = "hidden";
    startBoot();
  }

  // ── Handlers ──
  function setError(elId, msg, color) {
    const el = $(elId);
    el.textContent = msg || "";
    el.style.display = msg ? "block" : "none";
    el.style.color = color || "#ef4444";
  }

  async function handleLogin(ev) {
    ev.preventDefault();
    const pw = $("login-pass").value;
    const blob = DB.getStoredBlob();
    if (!blob) { startBoot(); return; }
    setError("login-error", "Descifrando…", "#9ca3af");
    try {
      const doc = await C.decryptDoc(blob, pw);
      unlock(doc);
    } catch (e) {
      setError("login-error", e.code === "BAD_PASSWORD" ? "Contraseña incorrecta" : ("Error: " + e.message));
      $("login-pass").value = "";
    }
  }

  async function handleImport(ev) {
    ev.preventDefault();
    const p1 = $("imp-pass").value;
    const p2 = $("imp-pass2").value;
    if (p1.length < 6) { setError("imp-error", "La contraseña debe tener al menos 6 caracteres"); return; }
    if (p1 !== p2) { setError("imp-error", "Las contraseñas no coinciden"); return; }
    setError("imp-error", "Cargando y cifrando…", "#9ca3af");
    try {
      const res = await fetch("data.json?" + Date.now());
      if (!res.ok) throw new Error("no se encontró data.json (ejecuta tools/csv_to_json.py)");
      const doc = await res.json();
      const blob = await C.encryptDoc(doc, p1);
      DB.storeBlob(blob);
      unlock(doc);
    } catch (e) {
      setError("imp-error", "No se pudo importar: " + e.message);
    }
  }

  function startBoot() {
    document.documentElement.style.overflow = "hidden";
    $("boot-overlay").style.display = "flex";
    const primeraVez = !DB.hasData();
    $("login-form").style.display = primeraVez ? "none" : "flex";
    $("import-form").style.display = primeraVez ? "flex" : "none";
    setError("login-error", "");
    setError("imp-error", "");
    if (primeraVez) { $("imp-pass").value = ""; $("imp-pass2").value = ""; $("imp-pass").focus(); }
    else { $("login-pass").value = ""; $("login-pass").focus(); }
  }

  function init() {
    $("login-form").addEventListener("submit", handleLogin);
    $("import-form").addEventListener("submit", handleImport);
    const lb = $("logout-btn");
    if (lb) lb.addEventListener("click", lock);
    // Precios públicos: en paralelo; si llegan tras el desbloqueo, re-render.
    fetch("prices.json?" + Date.now())
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => { PRICES = p; render(); })
      .catch(() => {});
    startBoot();
  }

  window.SolventoBoot = { lock };
  document.addEventListener("DOMContentLoaded", init);
})();
