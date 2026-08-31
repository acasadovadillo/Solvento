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

  // ── Helpers de formato (mínimos; la analítica real llega en Fase 2) ──
  function fmtEur(x) {
    const n = Number(x);
    if (!isFinite(n)) return "—";
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function parseFechaES(s) {
    // "dd/mm/yyyy" → Date (para ordenar); tolera vacío
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(s || "").trim());
    return m ? new Date(+m[3], +m[2] - 1, +m[1]) : new Date(0);
  }

  // ── Desbloqueo + render mínimo ──
  function unlock(doc) {
    DB.state.doc = doc;
    $("boot-overlay").style.display = "none";
    document.documentElement.style.overflow = "";
    $("app").style.display = "block";
    renderReadOnly(doc);
  }

  function lock() {
    DB.state.doc = null;
    $("app").style.display = "none";
    document.documentElement.style.overflow = "hidden";
    startBoot();
  }

  function renderReadOnly(doc) {
    const mov = doc.movimientos || [];
    const inv = doc.inversiones || [];
    const inm = doc.inmuebles || [];
    const navN = Object.keys(doc.nav || {}).length;

    $("stat-mov").textContent = mov.length;
    $("stat-inv").textContent = inv.length;
    $("stat-inm").textContent = inm.length;
    $("stat-nav").textContent = navN;

    // Últimos 10 movimientos por fecha (prueba de que los datos reales están ahí)
    const ultimos = mov.slice().sort((a, b) => parseFechaES(b.fecha) - parseFechaES(a.fecha)).slice(0, 10);
    const TD = "padding:0.6rem 0.9rem;border-bottom:1px solid #2a2d3a;";
    $("mov-tbody").innerHTML = ultimos.map((r) => {
      const signo = r.tipo === "Ingreso" ? "+" : (r.tipo === "Gasto" ? "−" : "");
      const color = r.tipo === "Ingreso" ? "#10b981" : (r.tipo === "Gasto" ? "#ef4444" : "#9ca3af");
      return `<tr>
        <td style="${TD}color:#9ca3af;white-space:nowrap;">${esc(r.fecha)}</td>
        <td style="${TD}"><span style="color:${color};font-weight:600;">${esc(r.tipo)}</span></td>
        <td style="${TD}color:#e5e7eb;">${esc(r.detalle) || "—"}</td>
        <td style="${TD}text-align:right;color:${color};font-weight:600;white-space:nowrap;">${signo}${fmtEur(r.importe)}</td>
      </tr>`;
    }).join("");
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
    const lb = $("lock-btn");
    if (lb) lb.addEventListener("click", lock);
    startBoot();
  }

  window.SolventoBoot = { lock };
  document.addEventListener("DOMContentLoaded", init);
})();
