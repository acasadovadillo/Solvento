/*
 * Solvento v2 — Sincronización con GitHub (Fase 3).
 *
 * El bloque cifrado (data.enc) vive en el repo. LEERLO es público (no requiere
 * token); ESCRIBIRLO usa un token fine-grained (Contents: Read/Write en este
 * repo) que se guarda CIFRADO en localStorage con la contraseña del usuario y
 * solo se descifra a memoria tras el login. El token nunca se versiona ni se
 * registra en logs.
 */
(function () {
  "use strict";
  const C = window.SolventoCrypto;
  const SYNC = window.SolventoConfig.SYNC;
  // Cada cuenta, su token y su sha: el token de una organización no puede
  // escribir en el repositorio de otra ni al revés.
  const TOKEN_KEY = () => (window.SolventoPerfil ? window.SolventoPerfil.claveToken() : "solvento_gh_token");
  const SHA_KEY = () => (window.SolventoPerfil ? window.SolventoPerfil.claveSha() : "solvento_data_sha");

  const apiUrl = () => `https://api.github.com/repos/${SYNC.owner}/${SYNC.repo}/contents/${SYNC.path}`;
  // La API de contenidos NO devuelve el cuerpo de un fichero de más de 1 MB:
  // contesta con encoding "none" y content vacío. El bloque cifrado pasó de ese
  // tamaño al reconstruir la contabilidad, así que la lectura pública dejó de
  // funcionar sin avisar: quien ya tenía copia local seguía como si nada y un
  // dispositivo nuevo se encontraba la pantalla de importar. El contenido se
  // lee por «raw», que no tiene ese límite; la API se sigue usando para el sha,
  // que es lo que hace falta para escribir.
  const rawUrl = () => `https://raw.githubusercontent.com/${SYNC.owner}/${SYNC.repo}/${SYNC.branch}/${SYNC.path}`;

  // JSON (ASCII/UTF-8) ⇄ base64 respetando UTF-8
  const b64enc = (str) => btoa(unescape(encodeURIComponent(str)));
  const b64dec = (b64) => decodeURIComponent(escape(atob(String(b64).replace(/\s/g, ""))));

  async function ghGet(token) {
    const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    if (token) headers.Authorization = "Bearer " + token;
    const r = await fetch(apiUrl() + "?ref=" + encodeURIComponent(SYNC.branch) + "&_=" + Date.now(), { headers });
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
    if (!blob) blob = await fetchBlobRaw();
    if (!blob) throw new Error("No se ha podido leer el bloque cifrado del repositorio");
    return { blob, sha: res.sha };
  }

  // Lectura pública sin límite de tamaño. Sirve para cualquier repo público;
  // si el tuyo fuera privado, esta vía no responde y la única sería la API.
  async function fetchBlobRaw() {
    try {
      const r = await fetch(rawUrl() + "?_=" + Date.now(), { cache: "no-store" });
      if (!r.ok) return null;
      return JSON.parse(await r.text());
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
  async function verificarGuardado(contentStr, doc, password) {
    for (let intento = 0; intento < 3; intento++) {
      if (intento) await new Promise((r) => setTimeout(r, 1500 * intento));
      let texto;
      try {
        const r = await fetch(rawUrl() + "?_=" + Date.now(), { cache: "no-store" });
        if (!r.ok) continue;
        texto = await r.text();
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

    async function intentar(sha) {
      const newSha = await ghPut(token, contentStr, sha, message);
      setSha(newSha);
      window.SolventoDB.storeBlob(blob); // cache local al día
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
    const verificacion = verificarGuardado(contentStr, doc, password)
      .catch((e) => ({ ok: false, grave: false, motivo: e.message || "no se pudo comprobar" }));
    return { sha: nuevoSha, verificacion };
  }


  // ── Lista pública de tickers ──
  // Cuando das de alta un activo, su ticker debe llegar al proceso que descarga
  // precios (que corre en GitHub y no puede leer tus datos cifrados). Se publica
  // en tickers.json, que no es información nueva: prices.json ya expone
  // exactamente los mismos símbolos. Sin valores, sin cantidades.
  const TICKERS_PATH = "tickers.json";
  const tickersUrl = () => `https://api.github.com/repos/${SYNC.owner}/${SYNC.repo}/contents/${TICKERS_PATH}`;

  async function pushTickers(tickers, token) {
    const contenido = JSON.stringify(
      { generated: new Date().toISOString(), tickers: tickers.slice().sort() }, null, 1);
    const headers = { Accept: "application/vnd.github+json", Authorization: "Bearer " + token,
                      "X-GitHub-Api-Version": "2022-11-28" };
    let sha = null;
    const cur = await fetch(tickersUrl() + "?ref=" + encodeURIComponent(SYNC.branch) + "&_=" + Date.now(), { headers });
    if (cur.ok) sha = (await cur.json()).sha;
    const body = { message: "Solvento: actualizar lista de activos", content: b64enc(contenido), branch: SYNC.branch };
    if (sha) body.sha = sha;
    const r = await fetch(tickersUrl(), {
      method: "PUT",
      headers: Object.assign({ "Content-Type": "application/json" }, headers),
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error("GitHub PUT tickers " + r.status);
    return true;
  }

  window.SolventoSync = {
    ghGet, ghPut, storeToken, loadToken, hasToken, clearToken,
    fetchRemoteBlob, fetchBlobRaw, push, pushTickers, getSha, setSha, verificarGuardado,
  };
})();
