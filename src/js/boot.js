/*
 * Solvento v2 — Arranque, login que descifra y sincronización con GitHub.
 *
 * Arranque:
 *   · Hay bloque cifrado local → login (contraseña → descifra → desbloquea).
 *   · No hay local pero SÍ en el repo (data.enc, lectura pública) → se adopta y
 *     se pide la contraseña. Esto hace que funcione en cualquier dispositivo.
 *   · Nada en local ni en el repo → importación inicial desde data.json.
 *
 * La contraseña y el token se guardan SOLO en memoria (DB.state) durante la
 * sesión; se borran al bloquear. El token, además, se guarda cifrado con la
 * contraseña en localStorage para no re-pedirlo en cada visita.
 */
(function () {
  "use strict";
  const C = window.SolventoCrypto;
  const DB = window.SolventoDB;
  const SYNC = window.SolventoSync;

  const $ = (id) => document.getElementById(id);
  let PRICES = null;

  function setError(elId, msg, color) {
    const el = $(elId); if (!el) return;
    el.textContent = msg || "";
    el.style.display = msg ? "block" : "none";
    el.style.color = color || "#ef4444";
  }
  function panel(name) {
    $("login-form").style.display = name === "login" ? "flex" : "none";
    $("import-form").style.display = name === "import" ? "flex" : "none";
    $("boot-checking").style.display = name === "checking" ? "flex" : "none";
  }

  // ── Desbloqueo / bloqueo ──
  async function unlock(doc, password) {
    DB.state.doc = doc;
    DB.state.password = password;
    $("boot-overlay").style.display = "none";
    document.documentElement.style.overflow = "";
    $("app").style.display = "block";
    render();
    try { DB.state.token = await SYNC.loadToken(password); } catch (e) { DB.state.token = null; }
    updateSyncUi();
  }
  function render() {
    if (DB.state.doc && window.SolventoRender) window.SolventoRender.render(DB.state.doc, PRICES);
  }

  let _toastTimer = null;
  function toast(msg, color) {
    let t = $("v2-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "v2-toast";
      t.style.cssText = "position:fixed;left:50%;bottom:1.5rem;transform:translateX(-50%);background:#12141d;border:1px solid #2a2d3a;color:#e5e7eb;font-size:0.85rem;font-weight:600;padding:0.6rem 1.1rem;border-radius:10px;z-index:1300;box-shadow:0 6px 20px rgba(0,0,0,0.5);display:none;";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.color = color || "#e5e7eb";
    t.style.display = "block";
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { t.style.display = "none"; }, 3500);
  }

  // Guardar el documento tras una edición: cifra + guarda local + sube si hay token.
  async function saveDoc() {
    if (!DB.state.doc || !DB.state.password) return;
    render();
    if (DB.state.token) {
      toast("Guardando en GitHub…", "#9ca3af");
      try {
        await SYNC.push(DB.state.doc, DB.state.password, DB.state.token, "Solvento: cambios desde la web");
        toast("Guardado y sincronizado ✓", "#10b981");
      } catch (e) {
        try { DB.storeBlob(await C.encryptDoc(DB.state.doc, DB.state.password)); } catch (_) {}
        toast("Guardado en el dispositivo (sync falló: " + e.message + ")", "#fbbf24");
      }
    } else {
      try { DB.storeBlob(await C.encryptDoc(DB.state.doc, DB.state.password)); } catch (_) {}
      toast("Guardado en este dispositivo · sincroniza para subirlo", "#fbbf24");
    }
  }
  function lock() {
    DB.state.doc = null; DB.state.password = null; DB.state.token = null;
    $("app").style.display = "none";
    document.documentElement.style.overflow = "hidden";
    startBoot();
  }

  // ── Login / importación ──
  async function handleLogin(ev) {
    ev.preventDefault();
    const pw = $("login-pass").value;
    const blob = DB.getStoredBlob();
    if (!blob) { startBoot(); return; }
    setError("login-error", "Descifrando…", "#9ca3af");
    try {
      const doc = await C.decryptDoc(blob, pw);
      unlock(doc, pw);
    } catch (e) {
      setError("login-error", e.code === "BAD_PASSWORD" ? "Contraseña incorrecta" : ("Error: " + e.message));
      $("login-pass").value = "";
    }
  }
  async function handleImport(ev) {
    ev.preventDefault();
    const p1 = $("imp-pass").value, p2 = $("imp-pass2").value;
    if (p1.length < 6) { setError("imp-error", "La contraseña debe tener al menos 6 caracteres"); return; }
    if (p1 !== p2) { setError("imp-error", "Las contraseñas no coinciden"); return; }
    setError("imp-error", "Cargando y cifrando…", "#9ca3af");
    try {
      const res = await fetch("data.json?" + Date.now());
      if (!res.ok) throw new Error("no hay datos en este sitio. Configúralo desde tu equipo (localhost) con tu contraseña y pulsa 🔄 → Guardar en GitHub.");
      const doc = await res.json();
      const blob = await C.encryptDoc(doc, p1);
      DB.storeBlob(blob);
      unlock(doc, p1);
    } catch (e) {
      setError("imp-error", "No se pudo importar: " + e.message);
    }
  }

  async function startBoot() {
    document.documentElement.style.overflow = "hidden";
    $("boot-overlay").style.display = "flex";
    setError("login-error", ""); setError("imp-error", "");
    if (DB.hasData()) { panel("login"); $("login-pass").value = ""; $("login-pass").focus(); return; }
    // Sin bloque local: ¿existe en el repo? (lectura pública, sin token)
    panel("checking");
    let remote = null;
    try { remote = await SYNC.fetchRemoteBlob(null); } catch (e) { remote = null; }
    if (remote) {
      DB.storeBlob(remote.blob);
      panel("login"); $("login-pass").value = ""; $("login-pass").focus();
    } else {
      panel("import"); $("imp-pass").value = ""; $("imp-pass2").value = ""; $("imp-pass").focus();
    }
  }

  // ── Sincronización (UI) ──
  function updateSyncUi() {
    const has = SYNC.hasToken();
    const st = $("sync-token-status");
    if (st) { st.textContent = has ? "✅ Token guardado (cifrado) en este dispositivo" : "Sin token — necesario para guardar en GitHub"; st.style.color = has ? "#10b981" : "#6b7280"; }
  }
  function openSync() { $("sync-modal").style.display = "flex"; setError("sync-status", ""); updateSyncUi(); }
  function closeSync() { $("sync-modal").style.display = "none"; }

  async function saveToken() {
    const t = $("sync-token").value.trim();
    if (!t) { setError("sync-status", "Pega tu token de GitHub"); return; }
    await SYNC.storeToken(t, DB.state.password);
    DB.state.token = t;
    $("sync-token").value = "";
    updateSyncUi();
    setError("sync-status", "Token guardado ✓", "#10b981");
  }
  async function doPush() {
    if (!DB.state.token) { setError("sync-status", "Primero añade tu token"); return; }
    setError("sync-status", "Subiendo a GitHub…", "#9ca3af");
    try {
      await SYNC.push(DB.state.doc, DB.state.password, DB.state.token);
      setError("sync-status", "Guardado en GitHub ✓", "#10b981");
    } catch (e) {
      setError("sync-status", e.code === "CONFLICT" ? "El fichero cambió en el repo; usa 'Traer de GitHub' primero" : ("Error: " + e.message));
    }
  }
  async function doPull() {
    setError("sync-status", "Trayendo de GitHub…", "#9ca3af");
    try {
      const remote = await SYNC.fetchRemoteBlob(DB.state.token);
      if (!remote) { setError("sync-status", "No hay datos en el repo todavía"); return; }
      const doc = await C.decryptDoc(remote.blob, DB.state.password);
      DB.state.doc = doc; DB.storeBlob(remote.blob); render();
      setError("sync-status", "Actualizado desde GitHub ✓", "#10b981");
    } catch (e) {
      setError("sync-status", e.code === "BAD_PASSWORD" ? "La copia del repo usa otra contraseña" : ("Error: " + e.message));
    }
  }
  function doExport() {
    const blob = DB.getStoredBlob();
    if (!blob) { setError("sync-status", "No hay datos para exportar"); return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(blob)], { type: "application/octet-stream" }));
    a.download = "solvento-data.enc";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
    setError("sync-status", "Copia cifrada descargada ✓", "#10b981");
  }
  async function doImport(ev) {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    setError("sync-status", "Importando copia…", "#9ca3af");
    try {
      const blob = JSON.parse(await file.text());
      const doc = await C.decryptDoc(blob, DB.state.password);
      DB.state.doc = doc; DB.storeBlob(blob); render();
      setError("sync-status", "Copia importada ✓", "#10b981");
    } catch (e) {
      setError("sync-status", e.code === "BAD_PASSWORD" ? "Esa copia usa otra contraseña" : "Archivo no válido");
    }
    ev.target.value = "";
  }

  function init() {
    $("login-form").addEventListener("submit", handleLogin);
    $("import-form").addEventListener("submit", handleImport);
    $("logout-btn").addEventListener("click", lock);
    $("sync-btn").addEventListener("click", openSync);
    $("sync-close").addEventListener("click", closeSync);
    $("sync-save-token").addEventListener("click", saveToken);
    $("sync-push").addEventListener("click", doPush);
    $("sync-pull").addEventListener("click", doPull);
    $("sync-export").addEventListener("click", doExport);
    $("sync-import").addEventListener("change", doImport);
    fetch("prices.json?" + Date.now())
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => { PRICES = p; render(); })
      .catch(() => {});
    startBoot();
  }

  window.SolventoBoot = { lock, openSync, saveDoc, toast };
  document.addEventListener("DOMContentLoaded", init);
})();
