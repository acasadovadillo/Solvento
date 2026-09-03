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
    if (!DB.state.token) pintarEstado("sintoken", "Añade tu token en 🔄 Sincronizar y el guardado será automático");
    else if (hayPendiente()) reintentarPendiente();
    else pintarEstado("ok", "Tus cambios se guardan solos en GitHub");
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

  // ── Estado del guardado (visible en la navbar) ──
  // "pendiente" se recuerda entre sesiones: si una subida falla, el aviso no se
  // pierde al recargar y se reintenta sola en cuanto se pueda.
  const PENDIENTE_KEY = "solvento_sync_pendiente";
  const hayPendiente = () => localStorage.getItem(PENDIENTE_KEY) === "1";
  const marcarPendiente = (v) => {
    if (v) localStorage.setItem(PENDIENTE_KEY, "1");
    else localStorage.removeItem(PENDIENTE_KEY);
  };
  function pintarEstado(estado, detalle) {
    const el = $("sync-estado");
    if (!el) return;
    const mapa = {
      guardando: ["⏳ Guardando…", "#9ca3af"],
      ok:        ["✓ Sincronizado", "#10b981"],
      pendiente: ["⚠ Sin subir", "#fbbf24"],
      sintoken:  ["⚠ Sin sincronizar", "#fbbf24"],
    };
    const [txt, col] = mapa[estado] || ["", "#6b7280"];
    el.textContent = txt;
    el.style.color = col;
    el.title = detalle || "Estado del guardado";
  }

  // Cifra y guarda en este dispositivo (siempre, pase lo que pase con la red).
  async function guardarLocal() {
    try { DB.storeBlob(await C.encryptDoc(DB.state.doc, DB.state.password)); } catch (_) {}
  }

  // Sube a GitHub. Devuelve true si lo consiguió.
  async function subir(mensaje) {
    if (!DB.state.token) return false;
    pintarEstado("guardando");
    try {
      await SYNC.push(DB.state.doc, DB.state.password, DB.state.token, mensaje || "Solvento: cambios desde la web");
      marcarPendiente(false);
      pintarEstado("ok", "Tus cambios están guardados en GitHub");
      return true;
    } catch (e) {
      await guardarLocal();
      marcarPendiente(true);
      const auth = e.code === "AUTH";
      pintarEstado("pendiente", auth
        ? "El token no vale o ha caducado: ponlo de nuevo en 🔄 Sincronizar"
        : "No se pudo subir (" + e.message + "). Se reintentará solo.");
      toast(auth ? "El token no vale o ha caducado · ponlo de nuevo en 🔄" : "Sin conexión con GitHub · se reintentará solo", "#fbbf24");
      return false;
    }
  }

  // Guardar el documento tras una edición: cifra, guarda local y sube si se puede.
  async function saveDoc() {
    if (!DB.state.doc || !DB.state.password) return;
    render();
    await guardarLocal();
    if (!DB.state.token) {
      marcarPendiente(true);
      pintarEstado("sintoken", "Guardado en este dispositivo. Añade tu token en 🔄 Sincronizar para subirlo solo.");
      toast("Guardado en este dispositivo · añade tu token para subirlo", "#fbbf24");
      return;
    }
    if (await subir()) toast("Guardado y sincronizado ✓", "#10b981");
  }

  // Si quedaron cambios sin subir (fallo de red, token caducado, sha obsoleto),
  // se reintenta al desbloquear, al recuperar la conexión y al volver a la pestaña.
  async function reintentarPendiente() {
    if (!hayPendiente() || !DB.state.doc || !DB.state.token) return;
    if (await subir("Solvento: subir cambios pendientes")) toast("Cambios pendientes subidos ✓", "#10b981");
  }
  function lock() {
    pintarEstado("");
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
  function openSync() {
    $("sync-modal").style.display = "flex";
    setError("sync-status", "");
    // Precargar el token que ya está guardado en este dispositivo, para que se
    // vea que no hace falta volver a pegarlo. Va en un campo de contraseña, así
    // que se muestra con puntos (seguro ante capturas de pantalla).
    const inp = $("sync-token");
    if (inp && DB.state.token) { inp.value = DB.state.token; inp.type = "password"; }
    updateSyncUi();
  }
  function alternarVerToken() {
    const inp = $("sync-token"), btn = $("sync-token-ver");
    if (!inp) return;
    const oculto = inp.type === "password";
    inp.type = oculto ? "text" : "password";
    if (btn) btn.textContent = oculto ? "🙈" : "👁";
  }
  function closeSync() { $("sync-modal").style.display = "none"; }

  async function saveToken() {
    const t = $("sync-token").value.trim();
    if (!t) { setError("sync-status", "Pega tu token de GitHub"); return; }
    await SYNC.storeToken(t, DB.state.password);
    DB.state.token = t;
    $("sync-token").type = "password";   // se queda puesto, pero oculto
    updateSyncUi();
    setError("sync-status", "Token guardado ✓ · a partir de ahora se guarda solo", "#10b981");
    if (hayPendiente()) await reintentarPendiente(); else pintarEstado("ok");
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
    $("sync-token-ver").addEventListener("click", alternarVerToken);
    $("sync-push").addEventListener("click", doPush);
    $("sync-pull").addEventListener("click", doPull);
    $("sync-export").addEventListener("click", doExport);
    $("sync-import").addEventListener("change", doImport);
    // Reintentar lo pendiente al recuperar conexión o al volver a la pestaña
    window.addEventListener("online", reintentarPendiente);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) reintentarPendiente(); });
    fetch("prices.json?" + Date.now())
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => { PRICES = p; render(); })
      .catch(() => {});
    window.addEventListener("online", reintentarPendiente);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) reintentarPendiente(); });
    startBoot();
  }

  window.SolventoBoot = { lock, openSync, saveDoc, toast };
  document.addEventListener("DOMContentLoaded", init);
})();
