/*
 * Solvento v2 — Arranque, login que descifra y sincronización con GitHub.
 *
 * Arranque:
 *   · Hay bloque cifrado local → login (contraseña → descifra → desbloquea).
 *   · No hay local pero SÍ en el repo (data.enc, lectura pública) → se adopta y
 *     se pide la contraseña. Esto hace que funcione en cualquier dispositivo.
 *   · Nada en local ni en el repo → cuenta nueva: elige contraseña y empieza vacía.
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
    $("pass-form").style.display = name === "pass" ? "flex" : "none";
    $("boot-checking").style.display = name === "checking" ? "flex" : "none";
  }

  // ── Cambiar la contraseña ──
  // Ocupa la pantalla entera, como la de estrenarla: cambiar la llave de todo lo
  // que tienes cifrado no es un detalle que quepa en una ventanita encima de la
  // aplicación. Pide también la de ahora, aunque la sesión ya esté abierta: sin
  // eso, quien pasara por delante de un portátil desbloqueado podría dejarte
  // fuera de tus propios datos con tres teclas.
  function abrirCambioPassword() {
    const c = P() && P().actual();
    const quien = $("pw-cuenta");
    if (quien) {
      quien.textContent = (c && c.nombre) || "";
      quien.hidden = !quien.textContent;
    }
    ["pw-actual", "pw-nueva", "pw-nueva2"].forEach((i) => ($(i).value = ""));
    setError("pw-error", "");
    document.documentElement.style.overflow = "hidden";
    $("boot-overlay").style.display = "flex";
    panel("pass");
    $("pw-actual").focus();
  }
  function cerrarCambioPassword() {
    $("boot-overlay").style.display = "none";
    document.documentElement.style.overflow = "";
    panel("login");
  }
  async function handlePassword(ev) {
    ev.preventDefault();
    const actual = $("pw-actual").value;
    const n1 = $("pw-nueva").value, n2 = $("pw-nueva2").value;
    if (!actual) { setError("pw-error", "Escribe tu contraseña actual"); return; }
    if (n1.length < 6) { setError("pw-error", "La nueva debe tener al menos 6 caracteres"); return; }
    if (n1 !== n2) { setError("pw-error", "Las dos nuevas no coinciden"); return; }
    if (n1 === actual) { setError("pw-error", "La nueva es igual que la actual"); return; }
    setError("pw-error", "Cambiando…", "#9ca3af");
    try {
      const r = await cambiarPassword(actual, n1);
      cerrarCambioPassword();
      toast(r.subido
        ? "Contraseña cambiada y subida ✓ · úsala ya en todos tus dispositivos"
        : "Contraseña cambiada en este dispositivo · pendiente de subir: los demás seguirán pidiendo la anterior",
        r.subido ? "#10b981" : "#fbbf24");
    } catch (e) {
      setError("pw-error", e.code === "ACTUAL" ? "La contraseña actual no es correcta" : ("No se pudo cambiar: " + e.message));
    }
  }

  const P = () => window.SolventoPerfil;
  function alternarVerPass() {
    const inp = $("login-pass"), btn = $("login-ver");
    const ver = inp.type === "password";
    inp.type = ver ? "text" : "password";
    btn.querySelector(".ojo-ver").hidden = ver;
    btn.querySelector(".ojo-tachado").hidden = !ver;
    btn.title = btn.ariaLabel = ver ? "Ocultar la contraseña" : "Ver la contraseña";
    inp.focus();
  }


  // ── Desbloqueo / bloqueo ──
  async function unlock(doc, password) {
    if (P()) P().entrar(true);          // ya se puede decir de quién es esto
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
    pintarLectura();
    if (!DB.state.token) pintarEstado("sintoken", "Añade tu token en ⚙ Ajustes → Sincronización y el guardado será automático");
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
      dudoso:    ["⚠ Sin comprobar", "#fbbf24"],
      roto:      ["✗ Guardado ilegible", "#ef4444"],
    };
    const [txt, col] = mapa[estado] || ["", "#6b7280"];
    el.textContent = txt;
    el.style.color = col;
    el.title = detalle || "Estado del guardado";
    // Punto de aviso sobre el avatar: así se ve que algo pasa sin abrir el menú
    const badge = $("user-badge");
    if (badge) badge.hidden = !(estado === "pendiente" || estado === "sintoken" ||
                                estado === "dudoso" || estado === "roto");
    const btn = $("user-btn");
    if (btn) btn.title = txt ? "Tu cuenta · " + txt : "Tu cuenta";
  }

  // ── Modo lectura ─────────────────────────────────────────────────────────
  // Solvento se comparte enseñando la dirección y la contraseña: quien entra ve
  // los datos, pero sin token de GitHub no puede publicarlos. Antes eso
  // significaba que sus cambios se quedaban en su móvil y a los dos días veía
  // unas cifras que ya no coincidían con las de nadie. Ahora, sin token, la
  // aplicación se abre en modo lectura y lo dice.
  //
  // No es una cerradura —quien tiene la contraseña puede descifrarlo todo, eso
  // es lo que significa zero-knowledge— sino una señal: esto no es tuyo, no lo
  // toques. Contra el despiste, no contra nadie.
  const EDITAR_IGUAL = "solvento_editar_sin_token";
  const esInvitado = () => !SYNC.hasToken() && localStorage.getItem(EDITAR_IGUAL) !== "1";
  function editarIgualmente() {
    localStorage.setItem(EDITAR_IGUAL, "1");
    pintarLectura();
    render();                            // los botones de editar vuelven a su sitio
    toast("Puedes editar en este dispositivo · añade tu token para que se suba", "#fbbf24");
  }
  function pintarLectura() {
    const invitado = esInvitado();
    document.body.classList.toggle("modo-lectura", invitado);
    const nav = document.getElementById("v2-bottom-nav");
    let b = document.getElementById("v2-banner-lectura");
    if (!invitado) {
      if (b) b.remove();
      if (nav) nav.style.bottom = "";     // la barra de pestañas vuelve a su sitio
      return;
    }
    if (!b) {
      b = document.createElement("div");
      b.id = "v2-banner-lectura";
      b.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:1200;background:#2a2109;border-top:1px solid #f59e0b;" +
        "color:#fbbf24;font-size:0.8rem;padding:0.55rem 1rem;display:flex;gap:0.75rem;align-items:center;justify-content:center;flex-wrap:wrap;";
      document.body.appendChild(b);
    }
    b.innerHTML = '<span>Modo lectura · estás viendo unos datos que no se guardan en este dispositivo.</span>' +
      '<button onclick="window.SolventoBoot.editarIgualmente()" style="background:none;border:1px solid #f59e0b;border-radius:6px;' +
      'color:#fbbf24;font-family:inherit;font-size:0.75rem;font-weight:600;padding:0.15rem 0.5rem;cursor:pointer;">Son míos, quiero editar aquí</button>';
    // La barra de pestañas del móvil vive abajo: se le hace sitio.
    if (nav) nav.style.bottom = b.offsetHeight + "px";
  }
  function avisoLectura() {
    toast("Modo lectura: aquí no se guarda nada. Si son tuyos, pulsa «Son míos» abajo.", "#fbbf24");
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
      const r = await SYNC.push(DB.state.doc, DB.state.password, DB.state.token, mensaje || "Solvento: cambios desde la web");
      marcarPendiente(false);
      pintarEstado("ok", "Guardado en GitHub · comprobando que se puede releer…");
      // Que GitHub acepte los bytes no prueba nada; que se vuelvan a leer, sí.
      // Eso tarda unos segundos y no tiene por qué hacerte esperar: la pantalla
      // se corrige sola cuando la comprobación termina.
      Promise.resolve((r && r.verificacion) || { ok: true }).then((v) => {
        if (v.ok) {
          pintarEstado("ok", "Guardado y comprobado: lo subido se vuelve a leer" +
                       (v.movimientos ? " (" + v.movimientos + " movimientos)" : ""));
        } else if (v.grave) {
          pintarEstado("roto", "Se subió, pero al releerlo falla: " + v.motivo +
                       ". No borres nada y comprueba una copia antes de seguir guardando.");
          toast("Lo guardado no se puede releer · " + v.motivo, "#ef4444");
        } else {
          pintarEstado("dudoso", "Se subió, pero no he podido comprobarlo (" + v.motivo +
                       "). Se vuelve a intentar en el próximo guardado.");
        }
      });
      return true;
    } catch (e) {
      await guardarLocal();
      marcarPendiente(true);
      const auth = e.code === "AUTH";
      pintarEstado("pendiente", auth
        ? "El token no vale o ha caducado: ponlo de nuevo en ⚙ Ajustes → Sincronización"
        : "No se pudo subir (" + e.message + "). Se reintentará solo.");
      toast(auth ? "El token no vale o ha caducado · ponlo de nuevo en ⚙ Ajustes" : "Sin conexión con GitHub · se reintentará solo", "#fbbf24");
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
    // La lista sale de los activos YA completados con los tickers que conoce el
    // código, más los que solo existen en tus operaciones: si un fondo no entra
    // aquí, el proceso que descarga precios no sabe que existe y ese fondo se
    // queda con el último valor que alguien escribió a mano.
    const CFG = window.SolventoConfig;
    const symbols = CFG.activos().map((a) => a.yf).filter(Boolean);
    (DB.state.doc.inversiones || []).forEach((r) => {
      const t = CFG.tickerConocido && CFG.tickerConocido(r.isin);
      if (t) symbols.push(t);
    });
    const lista = Array.from(new Set(symbols)).sort();
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
    // Los formularios ya no se abren en modo lectura, pero alguna acción suelta
    // podría llegar hasta aquí: que no se guarde ni se suba nada.
    if (esInvitado()) { render(); avisoLectura(); return; }
    render();
    await guardarLocal();
    if (!DB.state.token) {
      marcarPendiente(true);
      pintarEstado("sintoken", "Guardado en este dispositivo. Añade tu token en ⚙ Ajustes para subirlo solo.");
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
    if (P()) P().entrar(false);
    // El campo del token no se vacía solo al cambiar de cuenta: lo que escribió
    // una seguiría ahí para la siguiente. Se limpia aquí, que es por donde se
    // pasa siempre.
    const tk = $("sync-token");
    if (tk) { tk.value = ""; tk.type = "password"; tk.readOnly = false; }
    const menu = $("user-menu"); if (menu) menu.hidden = true;
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
    const usuario = $("login-user").value.trim();
    const pw = $("login-pass").value;
    // Un usuario que no existe y una contraseña que no vale dan el mismo aviso:
    // decir cuál de las dos ha fallado es decirle a un desconocido qué cuentas
    // hay en esta instalación.
    const malos = () => {
      setError("login-error", "Usuario o contraseña incorrectos");
      $("login-pass").value = "";
    };
    const cuenta = P() && P().porUsuario(usuario);
    if (!cuenta) { malos(); return; }
    P().usar(cuenta.id);

    setError("login-error", "Entrando…", "#9ca3af");
    let blob = DB.getStoredBlob();
    if (!blob) {
      // Primera vez con esta cuenta en este dispositivo: su bloque se lee de su
      // sitio. Es lectura pública y no descifra nada: sin la contraseña, ruido.
      try { const r = await SYNC.fetchRemoteBlob(null); if (r) { blob = r.blob; DB.storeBlob(r.blob); } }
      catch (e) { blob = null; }
    }
    if (!blob) {
      // Cuenta dada de alta que todavía no tiene bloque: es su primera vez, no
      // un error. Se le ofrece elegir contraseña y empezar.
      empezarCuenta(cuenta, pw);
      return;
    }
    try {
      const doc = await C.decryptDoc(blob, pw);
      unlock(doc, pw);
    } catch (e) {
      if (e.code === "BAD_PASSWORD") malos();
      else setError("login-error", "Error: " + e.message);
    }
  }
  // Primera vez de una cuenta: se pasa al panel de empezar con su nombre puesto
  // y, si ya venía escrita una contraseña en el login, se aprovecha.
  function empezarCuenta(cuenta, pw) {
    const quien = $("imp-cuenta");
    if (quien) {
      quien.textContent = cuenta.nombre || cuenta.usuario || "";
      quien.hidden = !quien.textContent;
    }
    panel("import");
    $("imp-pass").value = pw || "";
    $("imp-pass2").value = "";
    ($("imp-pass").value ? $("imp-pass2") : $("imp-pass")).focus();
    setError("imp-error", "");
  }

  async function handleImport(ev) {
    ev.preventDefault();
    const p1 = $("imp-pass").value, p2 = $("imp-pass2").value;
    if (p1.length < 6) { setError("imp-error", "La contraseña debe tener al menos 6 caracteres"); return; }
    if (p1 !== p2) { setError("imp-error", "Las contraseñas no coinciden"); return; }
    setError("imp-error", "Cifrando…", "#9ca3af");
    try {
      // Una cuenta nueva empieza VACÍA, siempre.
      //
      // Antes se adoptaba un data.json si lo había junto a la aplicación: así
      // nació esto, migrando la hoja de cálculo. Con varias cuentas eso pasó de
      // atajo a trampa —quien creara la suya se habría llevado los datos que
      // hubiera en ese archivo, que no son los suyos—, y la migración ya está
      // hecha hace mucho.
      const doc = { movimientos: [], inversiones: [], propiedades: [], pasivos: [], cobros: [], config: {} };
      const blob = await C.encryptDoc(doc, p1);
      DB.storeBlob(blob);
      unlock(doc, p1);
      // Existe en este navegador, pero todavía en ningún otro sitio: sin token,
      // lo que registre se queda aquí, y eso hay que decirlo el primer día.
      if (!DB.state.token) {
        pintarEstado("sintoken", "Tus datos están cifrados en este dispositivo. Añade tu token en ⚙ Ajustes para que se guarden también en la nube.");
        toast("Cuenta creada · añade tu token en ⚙ Ajustes para sincronizar", "#fbbf24");
      }
    } catch (e) {
      setError("imp-error", "No se pudo importar: " + e.message);
    }
  }

  // El bloque cifrado se adoptaba una vez y se quedaba congelado para siempre.
  // En el dispositivo de quien guarda —que tiene token— eso no se nota, porque
  // cada cambio sube y baja; pero en uno sin token —el móvil de alguien a quien
  // le enseñas la web— se seguían viendo los números del día que entró por
  // primera vez, sin ninguna pista de que estaban viejos. Ahora se comprueba el
  // repo en cada arranque.
  //
  // Lo local manda si hay algo sin subir: un cambio hecho aquí y todavía no
  // publicado vale más que la copia del repo, y adoptarla lo borraría.
  async function refrescarBlobRemoto() {
    // Un dispositivo con cambios sin subir se queda con los suyos, pero dejar
    // eso en silencio es lo que convierte «no se actualiza» en un misterio: si
    // además no hay token, esos cambios no se van a poder subir nunca y esta
    // copia no volverá a moverse hasta que alguien lo sepa.
    if (hayPendiente()) {
      setError("login-error", SYNC.hasToken()
        ? "Hay cambios sin subir en este dispositivo: se abre tu copia local, no la del repositorio."
        : "Hay cambios guardados solo aquí y este dispositivo no puede subirlos, así que no se traen los del repositorio. Para volver a ver los datos actualizados, borra los datos del sitio en tu navegador.",
        "#fbbf24");
      return;
    }
    let remote = null;
    try { remote = await SYNC.fetchRemoteBlob(null); } catch (e) { return; }
    if (!remote) return;
    const local = DB.getStoredBlob();
    if (local && JSON.stringify(local) === JSON.stringify(remote.blob)) return;
    DB.storeBlob(remote.blob);
    setError("login-error", "Se ha traído la última versión de tus datos.", "#10b981");
  }

  async function startBoot() {
    document.documentElement.style.overflow = "hidden";
    $("boot-overlay").style.display = "flex";
    setError("login-error", ""); setError("imp-error", "");
    $("login-pass").value = "";
    if (DB.hasData()) {
      panel("login");
      ($("login-user").value ? $("login-pass") : $("login-user")).focus();
      refrescarBlobRemoto();          // en segundo plano, mientras escribes
      return;
    }
    // Sin bloque local: ¿existe en el repo? (lectura pública, sin token)
    panel("checking");
    let remote = null;
    try { remote = await SYNC.fetchRemoteBlob(null); } catch (e) { remote = null; }
    if (remote) {
      DB.storeBlob(remote.blob);
      panel("login"); $("login-user").focus();
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
  // Poner en el campo el token que ya está guardado en este dispositivo, para
  // que se vea que no hace falta volver a pegarlo —y para poder copiarlo con el
  // 👁 cuando haga falta en otra cuenta—. Va en un campo de contraseña, así que
  // se enseña con puntos: seguro ante una captura de pantalla.
  //
  // Antes esto solo pasaba al llegar por el atajo de sincronizar. Entrando por
  // Ajustes, el campo salía vacío mientras al lado ponía «token guardado», que
  // es una contradicción en la cara del que mira.
  function rellenarToken() {
    const inp = $("sync-token");
    if (!inp) return;
    const hay = !!DB.state.token;
    // Sin token, el campo está para escribirlo. Con token, el campo enseña el
    // que hay —oculto, con su ojo— pero NO se puede escribir encima: cambiarlo
    // es una decisión, no un descuido. Y si no hay ninguno, se vacía: si no, el
    // que se escribió en otra cuenta seguiría ahí, escrito y sin guardar.
    inp.value = hay ? DB.state.token : "";
    inp.type = "password";
    inp.readOnly = hay;
    inp.style.opacity = hay ? "0.75" : "";
    inp.title = hay ? "Guardado. Para poner otro, pulsa «Cambiar token»." : "";
    const guardar = $("sync-save-token"), puesto = $("sync-token-puesto");
    if (guardar) guardar.hidden = hay;
    if (puesto) puesto.style.display = hay ? "flex" : "none";
  }

  // Cambiarlo se pide: el campo se vacía y se abre, y hasta que no se guarde el
  // nuevo sigue valiendo el de antes.
  function cambiarToken() {
    const inp = $("sync-token");
    if (!inp) return;
    inp.readOnly = false;
    inp.value = "";
    inp.type = "text";
    inp.style.opacity = "";
    inp.focus();
    const guardar = $("sync-save-token"), puesto = $("sync-token-puesto");
    if (guardar) guardar.hidden = false;
    if (puesto) puesto.style.display = "none";
    setError("sync-status", "Pega el token nuevo y guárdalo. El de antes sigue valiendo hasta entonces.", "#9ca3af");
  }

  function quitarToken() {
    if (!window.confirm("¿Quitar el token de este dispositivo?\n\nDejarás de poder guardar en GitHub desde aquí " +
                        "hasta que pongas otro. Tus datos no se tocan.")) return;
    SYNC.clearToken();
    DB.state.token = null;
    rellenarToken();
    updateSyncUi();
    pintarLectura();
    render();
    pintarEstado("sintoken", "Sin token: lo que guardes se queda en este dispositivo");
    setError("sync-status", "Token quitado de este dispositivo", "#fbbf24");
  }
  function openSync() {
    if (window.v2Tab) window.v2Tab("ajustes");
    if (window.v2AjSec) window.v2AjSec("sync");
    setError("sync-status", "");
    rellenarToken();
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


  async function saveToken() {
    const t = $("sync-token").value.trim();
    if (!t) { setError("sync-status", "Pega tu token de GitHub"); return; }
    await SYNC.storeToken(t, DB.state.password);
    DB.state.token = t;
    aplicarTokenViajero(t);
    rellenarToken();                     // se queda puesto, oculto y bloqueado
    updateSyncUi();
    pintarLectura();                     // con token ya no es un invitado
    render();                            // y vuelven los botones de editar
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

  /*
   * Reconstrucción contable: sacar el documento EN CLARO y volver a meterlo.
   *
   * La copia normal va cifrada, que es como debe viajar. Pero para rehacer las
   * cuentas desde los extractos del banco hace falta poder leer lo que hay y
   * devolver el resultado, y eso el cifrado no lo permite: la clave es la
   * contraseña, que solo tienes tú. Estos dos botones abren esa puerta y por eso
   * avisan de lo que son: un archivo en claro es tu vida financiera en texto
   * plano, y quien lo tenga no necesita ninguna contraseña.
   */
  function doExportClaro() {
    const doc = DB.state.doc;
    if (!doc) { setError("sync-status", "No hay datos que exportar"); return; }
    const n = (doc.movimientos || []).length, i = (doc.inversiones || []).length;
    if (!window.confirm(
      `Vas a descargar ${n} movimientos y ${i} operaciones SIN CIFRAR, en texto legible.\n\n` +
      `Cualquiera que abra ese archivo ve tus finanzas enteras sin necesidad de tu contraseña. ` +
      `Bórralo en cuanto termines de usarlo.\n\n¿Sigo?`)) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }));
    a.download = "solvento-datos-EN-CLARO.json";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
    setError("sync-status", "Descargado en claro · bórralo cuando acabes", "#fbbf24");
  }

  // Reemplaza el documento entero. No es la importación de la primera vez
  // (aquella solo entra cuando no hay nada); esta pisa lo que haya.
  async function doReemplazarClaro(ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!file) return;
    try {
      const nuevo = JSON.parse(await file.text());
      // Se comprueba la forma antes de tocar nada: un JSON cualquiera no vale
      const faltan = ["movimientos", "inversiones"].filter((k) => !Array.isArray(nuevo[k]));
      if (faltan.length) throw new Error("no parece un documento de Solvento (falta " + faltan.join(" y ") + ")");
      const viejo = DB.state.doc || {};
      const cuenta = (d, k) => (Array.isArray(d[k]) ? d[k].length : 0);
      if (!window.confirm(
        `Se va a REEMPLAZAR todo lo que hay en Solvento:\n\n` +
        `  movimientos  ${cuenta(viejo, "movimientos")} → ${cuenta(nuevo, "movimientos")}\n` +
        `  operaciones  ${cuenta(viejo, "inversiones")} → ${cuenta(nuevo, "inversiones")}\n` +
        `  propiedades  ${cuenta(viejo, "inmuebles")} → ${cuenta(nuevo, "inmuebles")}\n\n` +
        `Lo que hay ahora se pierde. ¿Tienes hecha la copia cifrada?`)) return;
      // Se conserva la configuración actual salvo que el archivo traiga la suya:
      // cuentas, activos y objetivo no vienen de los extractos del banco.
      if (!nuevo.config && viejo.config) nuevo.config = viejo.config;
      DB.state.doc = nuevo;
      setError("sync-status", "Reemplazado · guardando…", "#9ca3af");
      await saveDoc();
      setError("sync-status", "Datos reemplazados ✓", "#10b981");
    } catch (e) {
      setError("sync-status", "No se pudo reemplazar: " + (e.message || e));
    }
  }

  async function init() {
    // Antes que nada: de quién es este Solvento y dónde guarda. De eso depende
    // hasta la primera lectura, así que no puede llegar tarde.
    if (window.SolventoPerfil) { try { await window.SolventoPerfil.cargar(); } catch (e) {} }
    $("login-form").addEventListener("submit", handleLogin);
    $("pass-form").addEventListener("submit", handlePassword);
    $("pw-cancelar").addEventListener("click", cerrarCambioPassword);
    $("login-ver").addEventListener("click", alternarVerPass);
    $("cuenta-btn").addEventListener("click", () => { $("login-user").value = ""; lock(); });
    $("import-form").addEventListener("submit", handleImport);
    $("logout-btn").addEventListener("click", lock);
    $("sync-save-token").addEventListener("click", saveToken);
    $("sync-token-ver").addEventListener("click", alternarVerToken);
    $("sync-token-cambiar").addEventListener("click", cambiarToken);
    $("sync-token-quitar").addEventListener("click", quitarToken);
    $("sync-token-viaja").addEventListener("change", () => { aplicarTokenViajero(); saveDoc(); });
    $("sync-push").addEventListener("click", doPush);
    $("sync-pull").addEventListener("click", doPull);
    $("sync-export").addEventListener("click", doExport);
    $("sync-import").addEventListener("change", doImport);
    $("sync-export-claro").addEventListener("click", doExportClaro);
    // La hoja de cálculo la arma otro archivo; aquí solo se enchufan los botones
    // y se cuenta cómo ha ido, que es lo que hace el resto de esta sección.
    const aHoja = (fn, ok) => () => {
      const E = window.SolventoExportar;
      if (!E) { setError("sync-status", "No se ha podido preparar la descarga"); return; }
      const r = fn();
      if (r === null) setError("sync-status", "No hay datos que exportar");
      else if (r) setError("sync-status", ok, "#fbbf24");
    };
    $("export-xlsx").addEventListener("click", aHoja(() => window.SolventoExportar.aExcel(),
      "Excel descargado · sin cifrar, bórralo al acabar"));
    $("export-csv").addEventListener("click", aHoja(() => window.SolventoExportar.aCsv(),
      "CSV descargado · sin cifrar, bórralo al acabar"));
    $("sync-reemplazar").addEventListener("change", doReemplazarClaro);
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

  window.SolventoBoot = { lock, openSync, saveDoc, toast, cambiarPassword, abrirCambioPassword, esInvitado, editarIgualmente, avisoLectura, pintarLectura, rellenarToken };
  document.addEventListener("DOMContentLoaded", init);
})();
