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
    // Si elegiste que el token viaje con tus datos, en un dispositivo nuevo se
    // recoge de ahí y no hay que volver a pegarlo.
    if (!DB.state.token && doc && doc.config && doc.config.token) {
      DB.state.token = doc.config.token;
      try { await SYNC.storeToken(DB.state.token, password); } catch (e) {}
    }
    updateSyncUi();
    if (!DB.state.token) pintarEstado("sintoken", "Añade tu token en 🔄 Sincronizar y el guardado será automático");
    else if (hayPendiente()) reintentarPendiente();
    else pintarEstado("ok", "Tus cambios se guardan solos en GitHub");
    avisarCopiaSiToca();
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

  // Si cambian los activos, el proceso que descarga precios necesita enterarse.
  // Solo se sube cuando la lista cambia de verdad, para no gastar llamadas.
  const TICKERS_KEY = "solvento_tickers_subidos";
  async function sincronizarTickers() {
    if (!DB.state.token || !DB.state.doc) return;
    const activos = (DB.state.doc.config && DB.state.doc.config.activos) || [];
    if (!activos.length) return;                       // sin config propia, manda la del código
    const lista = activos.map((a) => a.yf).filter(Boolean).sort();
    const firma = lista.join(",");
    if (!firma || localStorage.getItem(TICKERS_KEY) === firma) return;
    try {
      await SYNC.pushTickers(lista, DB.state.token);
      localStorage.setItem(TICKERS_KEY, firma);
    } catch (e) { /* se reintentará en el siguiente guardado */ }
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
    if (await subir()) { toast("Guardado y sincronizado ✓", "#10b981"); sincronizarTickers(); }
  }

  // Si quedaron cambios sin subir (fallo de red, token caducado, sha obsoleto),
  // se reintenta al desbloquear, al recuperar la conexión y al volver a la pestaña.
  async function reintentarPendiente() {
    if (!hayPendiente() || !DB.state.doc || !DB.state.token) return;
    if (await subir("Solvento: subir cambios pendientes")) toast("Cambios pendientes subidos ✓", "#10b981");
  }
  function lock() {
    pintarEstado("");
    quitarBandaCopia();
    DB.state.doc = null; DB.state.password = null; DB.state.token = null;
    $("app").style.display = "none";
    document.documentElement.style.overflow = "hidden";
    startBoot();
  }

  // ── Cambiar la contraseña ───────────────────────────────────────────
  // La operación más delicada de la app: si falla a medias, te quedas fuera de
  // tus propios datos. Por eso el orden es paranoico: primero se comprueba la
  // contraseña actual, después se cifra con la nueva y se VUELVE A DESCIFRAR
  // para confirmar que el resultado se puede abrir, y solo entonces se sustituye
  // nada. Si la subida a GitHub falla, en este dispositivo ya vale la nueva y
  // queda pendiente de subir (se avisa, porque los demás dispositivos seguirán
  // pidiendo la vieja hasta que suba).
  async function cambiarPassword(actual, nueva) {
    const blob = DB.getStoredBlob();
    if (!blob) throw new Error("no hay datos en este dispositivo");

    // 1. ¿Es correcta la actual?
    let doc;
    try { doc = await C.decryptDoc(blob, actual); }
    catch (e) { const err = new Error("La contraseña actual no es correcta"); err.code = "ACTUAL"; throw err; }

    // 2. Cifrar con la nueva y comprobar que se puede volver a abrir
    const nuevoBlob = await C.encryptDoc(doc, nueva);
    const comprobacion = await C.decryptDoc(nuevoBlob, nueva);
    if (!comprobacion || typeof comprobacion !== "object") throw new Error("la comprobación del cifrado falló");

    // 3. Recifrar el token con la nueva contraseña (si lo había)
    const token = DB.state.token;

    // 4. Sustituir de verdad
    DB.storeBlob(nuevoBlob);
    DB.state.password = nueva;
    DB.state.doc = doc;
    if (token) await SYNC.storeToken(token, nueva);

    // 5. Subir, para que los demás dispositivos usen ya la nueva
    let subido = false;
    if (token) subido = await subir("Solvento: cambio de contraseña");
    else marcarPendiente(true);
    return { subido };
  }

  // ── Recordatorio de copia de seguridad ──────────────────────────────
  // Sin contraseña no hay recuperación posible, así que una copia cifrada
  // guardada aparte es la única red de seguridad real.
  const COPIA_KEY = "solvento_ultima_copia";
  const DIAS_AVISO = 30;
  function marcarCopiaHecha() { localStorage.setItem(COPIA_KEY, String(Date.now())); quitarBandaCopia(); }
  // Un aviso de 3 segundos es demasiado fugaz para algo que evita perderlo todo:
  // se muestra como banda fija hasta que hagas la copia o la descartes.
  function avisarCopiaSiToca() {
    const ultima = Number(localStorage.getItem(COPIA_KEY)) || 0;
    const dias = ultima ? (Date.now() - ultima) / 864e5 : Infinity;
    if (dias < DIAS_AVISO) { quitarBandaCopia(); return; }
    if ($("v2-banda-copia")) return;
    const b = document.createElement("div");
    b.id = "v2-banda-copia";
    b.style.cssText = "background:#3f2d0a;border-bottom:1px solid #a16207;color:#fbbf24;font-size:0.82rem;font-weight:600;padding:0.6rem 1rem;display:flex;align-items:center;justify-content:center;gap:0.75rem;flex-wrap:wrap;text-align:center;";
    b.innerHTML =
      `<span>${ultima ? `Hace ${Math.floor(dias)} días de tu última copia de seguridad.` : "Aún no has hecho ninguna copia de seguridad."}
        Sin tu contraseña no hay forma de recuperar los datos.</span>
       <button id="v2-copia-ya" style="background:#fbbf24;color:#1a1200;border:none;border-radius:7px;font-size:0.78rem;font-weight:700;padding:0.35rem 0.8rem;cursor:pointer;font-family:inherit;">Exportar copia</button>
       <button id="v2-copia-luego" style="background:none;border:none;color:#a16207;font-size:0.78rem;cursor:pointer;font-family:inherit;">Ahora no</button>`;
    const app = $("app");
    app.insertBefore(b, app.firstChild);
    $("v2-copia-ya").addEventListener("click", () => { doExport(); quitarBandaCopia(); });
    $("v2-copia-luego").addEventListener("click", () => {
      // Se recuerda dentro de una semana, no en cada arranque
      localStorage.setItem(COPIA_KEY, String(Date.now() - (DIAS_AVISO - 7) * 864e5));
      quitarBandaCopia();
    });
  }
  function quitarBandaCopia() { const b = $("v2-banda-copia"); if (b) b.remove(); }

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

  // El token puede viajar dentro del documento cifrado (opcional, lo decides tú
  // con la casilla del modal). Así un dispositivo nuevo no tiene que pegarlo.
  function aplicarTokenViajero(t) {
    const cb = $("sync-token-viaja");
    if (!cb || !DB.state.doc) return;
    if (!DB.state.doc.config) DB.state.doc.config = {};
    if (cb.checked) DB.state.doc.config.token = t != null ? t : DB.state.token;
    else delete DB.state.doc.config.token;
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
    const cb = $("sync-token-viaja");
    if (cb) cb.checked = !!(DB.state.doc && DB.state.doc.config && DB.state.doc.config.token);
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
    aplicarTokenViajero(t);
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
    marcarCopiaHecha();
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
    $("sync-token-viaja").addEventListener("change", () => { aplicarTokenViajero(); saveDoc(); });
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

  window.SolventoBoot = { lock, openSync, saveDoc, toast, cambiarPassword };
  document.addEventListener("DOMContentLoaded", init);
})();
