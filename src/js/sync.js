/*
 * Solvento — Sincronización con GitHub (Fase 3).
 *
 * El bloque cifrado de cada cuenta vive en un repositorio. Si es público, LEERLO
 * no requiere token; si es PRIVADO («privado»: true en perfil.json, que es como
 * está ahora: datos-cifrados), hace falta el token hasta para leer, y se lee
 * siempre por la API. ESCRIBIRLO usa un token fine-grained (Contents: Read and
 * write) que se guarda CIFRADO en localStorage con la contraseña del usuario y
 * solo se descifra a memoria tras el login. El token nunca se versiona ni se
 * registra en logs.
 *
 * Lo que es de la app y no de una cuenta —la lista de símbolos para los precios
 * y los valores liquidativos subidos— va al repositorio de la app (perfil.json
 * → «app»), que es público, no al de los datos.
 */
(function () {
  "use strict";
  const C = window.SolventoCrypto;
  const SYNC = window.SolventoConfig.SYNC;
  // Cada cuenta, su token y su sha: el token de una organización no puede
  // escribir en el repositorio de otra ni al revés.
  const TOKEN_KEY = () => (window.SolventoPerfil ? window.SolventoPerfil.claveToken() : "solvento_gh_token");
  const SHA_KEY = () => (window.SolventoPerfil ? window.SolventoPerfil.claveSha() : "solvento_data_sha");

  // Las direcciones pasan por entorno.js: en desarrollo van al servidor local y
  // una de GitHub se bloquea antes de salir.
  const E = window.SolventoEntorno;
  const privado = () => !!SYNC.privado;
  const apiUrl = () => E.url(`${E.base.api}/repos/${SYNC.owner}/${SYNC.repo}/contents/${SYNC.path}`);
  // La API de contenidos NO devuelve el cuerpo de un fichero de más de 1 MB:
  // contesta con encoding "none" y content vacío. El bloque cifrado pasó de ese
  // tamaño al reconstruir la contabilidad, así que la lectura pública dejó de
  // funcionar sin avisar: quien ya tenía copia local seguía como si nada y un
  // dispositivo nuevo se encontraba la pantalla de importar. El contenido se
  // lee por «raw», que no tiene ese límite; la API se sigue usando para el sha,
  // que es lo que hace falta para escribir.
  // En un repositorio privado, raw no sirve: se pide en bruto a la API, con el
  // token (leerPublicado).
  const rawUrl = () => E.url(`${E.base.raw}/${SYNC.owner}/${SYNC.repo}/${SYNC.branch}/${SYNC.path}`);
  // El repositorio de la app (perfil.json → «app»); sin él, el de los datos.
  const app = () => (window.SolventoPerfil && window.SolventoPerfil.app && window.SolventoPerfil.app()) || SYNC;
  const rawApp = () => { const a = app(); return E.url(`${E.base.raw}/${a.owner}/${a.repo}/${a.branch || "main"}/`); };
  const fallo = (msg, code) => { const e = new Error(msg); e.code = code; return e; };

  // JSON (ASCII/UTF-8) ⇄ base64 respetando UTF-8
  const b64enc = (str) => btoa(unescape(encodeURIComponent(str)));
  const b64dec = (b64) => decodeURIComponent(escape(atob(String(b64).replace(/\s/g, ""))));

  async function ghGet(token) {
    if (privado() && !token) throw fallo("Falta el token de GitHub: tus datos están en un repositorio privado", "SIN_TOKEN");
    const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    if (token) headers.Authorization = "Bearer " + token;
    const r = await fetch(apiUrl() + "?ref=" + encodeURIComponent(SYNC.branch) + "&_=" + Date.now(), { headers, cache: "no-store" });
    if (r.status === 401) throw fallo("El token de GitHub no vale o ha caducado", "AUTH");
    if (r.status === 403) throw fallo("El token de GitHub no tiene permiso sobre el repositorio de datos", "AUTH");
    if (r.status === 404) return null;
    if (!r.ok) throw new Error("GitHub GET " + r.status);
    const j = await r.json();
    return { sha: j.sha, content: b64dec(j.content) };
  }

  async function ghPut(token, contentStr, sha, message) {
    const body = { message: message || "Solvento: actualizar datos cifrados", content: b64enc(contentStr), branch: SYNC.branch };
    if (sha) body.sha = sha;
    const r = await fetch(apiUrl(), {
      method: "PUT",
      headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + token, "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" },
      body: JSON.stringify(body),
    });
    if (r.status === 409 || r.status === 422) { const e = new Error("conflicto: el fichero cambió en el repo"); e.code = "CONFLICT"; throw e; }
    if (r.status === 401 || r.status === 403) { const e = new Error("token inválido o sin permisos"); e.code = "AUTH"; throw e; }
    // En un repositorio privado, un token que no llega a él recibe 404, no 403:
    // es el token de antes, de cuando los datos estaban en Solvento.
    if (r.status === 404 && privado()) throw fallo("el token no da acceso al repositorio de tus datos", "AUTH");
    if (!r.ok) throw new Error("GitHub PUT " + r.status);
    const j = await r.json();
    return j.content && j.content.sha;
  }

  // ── Token (cifrado con la contraseña) ──
  async function storeToken(token, password) {
    localStorage.setItem(TOKEN_KEY(), JSON.stringify(await C.encryptString(token, password)));
  }
  async function loadToken(password) {
    const s = localStorage.getItem(TOKEN_KEY());
    if (!s) return null;
    try { return await C.decryptString(JSON.parse(s), password); } catch (e) { return null; }
  }
  const hasToken = () => !!localStorage.getItem(TOKEN_KEY());
  const clearToken = () => localStorage.removeItem(TOKEN_KEY());

  const getSha = () => localStorage.getItem(SHA_KEY()) || null;
  const setSha = (s) => { if (s) localStorage.setItem(SHA_KEY(), s); };

  // ── Alto nivel ──
  // Lee el bloque cifrado del repo (público). Devuelve {blob, sha} o null (404).
  async function fetchRemoteBlob(token) {
    const res = await ghGet(token);
    if (!res) return null;
    setSha(res.sha);
    let blob = null;
    if (res.content) { try { blob = JSON.parse(res.content); } catch (e) { blob = null; } }
    if (!blob) blob = await fetchBlobRaw(token);
    if (!blob) throw new Error("No se ha podido leer el bloque cifrado del repositorio");
    return { blob, sha: res.sha };
  }

  // El texto del archivo tal como está publicado, sin límite de tamaño. En un
  // repositorio público, por raw; en uno privado, por la API pidiéndolo en
  // bruto, con el token. Devuelve { status, texto }.
  async function leerPublicado(token) {
    if (privado()) {
      if (!token) return { status: 0, texto: null };
      const r = await fetch(apiUrl() + "?ref=" + encodeURIComponent(SYNC.branch) + "&_=" + Date.now(), {
        cache: "no-store",
        headers: { Accept: "application/vnd.github.raw", Authorization: "Bearer " + token, "X-GitHub-Api-Version": "2022-11-28" },
      });
      return { status: r.status, texto: r.ok ? await r.text() : null };
    }
    const r = await fetch(rawUrl() + "?_=" + Date.now(), { cache: "no-store" });
    return { status: r.status, texto: r.ok ? await r.text() : null };
  }

  // ¿Llega este token al repositorio de datos? En uno privado, GitHub responde
  // 404 tanto si el archivo no existe como si el token no tiene acceso: antes
  // de dar una cuenta por nueva, se pregunta aquí. true, o lanza AUTH/SIN_ACCESO.
  async function acceso(token) {
    const r = await fetch(E.url(`${E.base.api}/repos/${SYNC.owner}/${SYNC.repo}`) + "?_=" + Date.now(), {
      cache: "no-store", headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + token, "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (r.status === 401) throw fallo("El token de GitHub no vale o ha caducado", "AUTH");
    if (r.status === 403 || r.status === 404) throw fallo("El token no da acceso al repositorio de tus datos (" + SYNC.owner + "/" + SYNC.repo + ")", "SIN_ACCESO");
    if (!r.ok) throw new Error("GitHub respondió " + r.status);
    return true;
  }

  // El bloque, sin límite de tamaño (ver leerPublicado).
  async function fetchBlobRaw(token) {
    try {
      const r = await leerPublicado(token);
      return r.texto ? JSON.parse(r.texto) : null;
    } catch (e) { return null; }
  }

  // Comprueba que lo que acaba de subirse se puede volver a leer.
  //
  // Un guardado que "sale bien" solo demuestra que GitHub aceptó unos bytes. Lo
  // que importa es lo contrario: que esos bytes, releídos y descifrados, siguen
  // siendo tus movimientos. Así que se baja lo publicado y se descifra con la
  // misma contraseña, que es la única prueba que vale.
  //
  // El CDN de raw.githubusercontent puede servir todavía la versión anterior
  // durante unos segundos. Eso NO es un fallo del guardado, así que se
  // distingue: si el texto no coincide se reintenta, y si sigue sin coincidir se
  // dice que no se ha podido comprobar (grave: false), no que esté roto.
  async function verificarGuardado(contentStr, doc, password, token) {
    for (let intento = 0; intento < 3; intento++) {
      if (intento) await new Promise((r) => setTimeout(r, 1500 * intento));
      let texto;
      try {
        const r = await leerPublicado(token);
        if (!r.texto) continue;
        texto = r.texto;
      } catch (e) { continue; }
      if (texto !== contentStr) continue;      // el CDN va con retraso; se reintenta
      try {
        const vuelta = await C.decryptDoc(JSON.parse(texto), password);
        const subidos = (doc.movimientos || []).length;
        const leidos = (vuelta.movimientos || []).length;
        if (subidos !== leidos) {
          return { ok: false, grave: true, motivo: "subiste " + subidos + " movimientos y se leen " + leidos };
        }
        return { ok: true, movimientos: leidos };
      } catch (e) {
        return { ok: false, grave: true, motivo: "lo guardado no se puede descifrar" };
      }
    }
    return { ok: false, grave: false, motivo: "GitHub aún servía la versión anterior" };
  }

  /*
   * Comprobar lo que hay publicado AHORA, sin guardar nada.
   *
   * No sirve volver a cifrar el documento y comparar los bytes, que es lo que
   * hace la comprobación de después de guardar: cada cifrado lleva su propia
   * sal y su propio IV, así que el mismo documento produce un texto distinto
   * cada vez. Comparar eso daría siempre «no coincide».
   *
   * Lo que se comprueba es lo que de verdad importa: que lo publicado se
   * descargue, se descifre con tu contraseña y tenga dentro lo mismo que tienes
   * aquí. Es la única prueba de que tus datos están a salvo fuera de este
   * dispositivo.
   */
  const CONTENIDOS = ["movimientos", "inversiones", "propiedades", "pasivos", "cobros"];
  async function comprobarPublicado(doc, password, token) {
    let texto;
    try {
      if (privado() && !token) return { ok: false, grave: false, motivo: "sin token no se puede leer tu repositorio privado" };
      const r = await leerPublicado(token);
      if (r.status === 404) return { ok: false, grave: false, motivo: "en GitHub todavía no hay nada guardado" };
      if (!r.texto) return { ok: false, grave: false, motivo: "GitHub respondió " + r.status };
      texto = r.texto;
    } catch (e) {
      return { ok: false, grave: false, motivo: "no se pudo hablar con GitHub" };
    }
    let vuelta;
    try {
      vuelta = await C.decryptDoc(JSON.parse(texto), password);
    } catch (e) {
      // Descifrar con TU contraseña y fallar es lo único de verdad grave: o el
      // fichero está corrupto o lo escribió otra cuenta encima.
      return { ok: false, grave: true, motivo: "lo publicado no se puede descifrar con tu contraseña" };
    }
    const n = (d, k) => ((d && d[k]) || []).length;
    const desfases = CONTENIDOS
      .map((k) => ({ que: k, aqui: n(doc, k), alla: n(vuelta, k) }))
      .filter((x) => x.aqui !== x.alla);
    if (desfases.length) {
      const d = desfases[0];
      return { ok: false, grave: false, desfase: true, desfases,
               motivo: "aquí tienes " + d.aqui + " " + d.que + " y lo publicado tiene " + d.alla };
    }
    return { ok: true, movimientos: n(vuelta, "movimientos") };
  }

  // Cifra el doc y lo sube al repo. Devuelve { sha, verificacion }.
  //
  // El sha identifica la versión del fichero en GitHub y se cachea en este
  // navegador. Si el fichero cambió por otra vía (otro dispositivo, o un commit
  // por git), ese sha queda obsoleto y GitHub rechaza la escritura con un 409.
  // Antes eso dejaba el guardado en local para siempre; ahora se auto-repara:
  // se relee el sha actual y se reintenta una vez (last-write-wins, que es lo
  // acordado para un único usuario).
  async function push(doc, password, token, message) {
    const blob = await C.encryptDoc(doc, password);
    const contentStr = JSON.stringify(blob);

    // La copia local ya NO se pisa aquí. Mientras esto subía, pudo llegar otro
    // cambio que ya está guardado en este navegador; escribir encima el bloque
    // que se acaba de subir —más viejo— lo perdía en cuanto se recargaba. Quien
    // llama decide si el bloque subido es el último y puede quedarse de copia.
    async function intentar(sha) {
      const newSha = await ghPut(token, contentStr, sha, message);
      setSha(newSha);
      return newSha;
    }

    let sha = getSha();
    if (!sha) { const cur = await ghGet(token); if (cur) sha = cur.sha; } // ya existía
    let nuevoSha;
    try {
      nuevoSha = await intentar(sha);
    } catch (e) {
      if (e.code !== "CONFLICT") throw e;
      const cur = await ghGet(token);           // sha fresco y reintento
      nuevoSha = await intentar(cur ? cur.sha : null);
    }
    // La comprobación NO se espera: descifrar un documento entero son unos
    // segundos, y el guardado ya está hecho. Va en segundo plano y la pantalla
    // se actualiza cuando termine. Nunca falla hacia fuera: lo que no se pudo
    // comprobar se cuenta como no comprobado, no como roto.
    const verificacion = verificarGuardado(contentStr, doc, password, token)
      .catch((e) => ({ ok: false, grave: false, motivo: e.message || "no se pudo comprobar" }));
    return { sha: nuevoSha, verificacion, blob };
  }


  // ── Lista pública de tickers ──
  // Cuando das de alta un activo, su ticker debe llegar al proceso que descarga
  // precios (que corre en GitHub y no puede leer tus datos cifrados). Se publica
  // en tickers.json, que no es información nueva: prices.json ya expone
  // exactamente los mismos símbolos. Sin valores, sin cantidades.
  const TICKERS_PATH = "tickers.json";
  // Va al repositorio de la app (público), donde corre el proceso de precios.
  const tickersUrl = () => { const a = app(); return E.url(`${E.base.api}/repos/${a.owner}/${a.repo}/contents/${TICKERS_PATH}`); };

  async function pushTickers(tickers, token) {
    const contenido = JSON.stringify(
      { generated: new Date().toISOString(), tickers: tickers.slice().sort() }, null, 1);
    const headers = { Accept: "application/vnd.github+json", Authorization: "Bearer " + token,
                      "X-GitHub-Api-Version": "2022-11-28" };
    let sha = null;
    const rama = app().branch || "main";
    const cur = await fetch(tickersUrl() + "?ref=" + encodeURIComponent(rama) + "&_=" + Date.now(), { headers });
    if (cur.ok) sha = (await cur.json()).sha;
    const body = { message: "Solvento: actualizar lista de activos", content: b64enc(contenido), branch: rama };
    if (sha) body.sha = sha;
    const r = await fetch(tickersUrl(), {
      method: "PUT",
      headers: Object.assign({ "Content-Type": "application/json" }, headers),
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error("GitHub PUT tickers " + r.status);
    return true;
  }

  // Escribir un archivo cualquiera del repositorio de la app —los valores
  // liquidativos subidos, que son públicos—. Si ya existe se pisa con su sha,
  // y si no, se crea.
  async function ghPutArchivo(token, ruta, contentStr, message) {
    const a = app(), rama = a.branch || "main";
    const url = E.url(`${E.base.api}/repos/${a.owner}/${a.repo}/contents/${ruta}`);
    const headers = { Accept: "application/vnd.github+json", Authorization: "Bearer " + token,
                      "X-GitHub-Api-Version": "2022-11-28" };
    let sha = null;
    const cur = await fetch(url + "?ref=" + encodeURIComponent(rama) + "&_=" + Date.now(), { headers });
    if (cur.ok) sha = (await cur.json()).sha;
    const body = { message: message || "Solvento: actualizar " + ruta, content: b64enc(contentStr), branch: rama };
    if (sha) body.sha = sha;
    const r = await fetch(url, { method: "PUT", headers: Object.assign({ "Content-Type": "application/json" }, headers), body: JSON.stringify(body) });
    if (r.status === 401 || r.status === 403) { const e = new Error("el token no vale o no puede escribir"); e.code = "AUTH"; throw e; }
    if (!r.ok) throw new Error("GitHub PUT " + ruta + " " + r.status);
    return true;
  }

  window.SolventoSync = {
    ghPutArchivo,
    ghGet, ghPut, storeToken, loadToken, hasToken, clearToken,
    fetchRemoteBlob, fetchBlobRaw, push, pushTickers, getSha, setSha, verificarGuardado, comprobarPublicado,
    acceso, privado, rawApp,
  };
})();
