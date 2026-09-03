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
  const TOKEN_KEY = "solvento_gh_token";
  const SHA_KEY = "solvento_data_sha";

  const apiUrl = () => `https://api.github.com/repos/${SYNC.owner}/${SYNC.repo}/contents/${SYNC.path}`;

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
    localStorage.setItem(TOKEN_KEY, JSON.stringify(await C.encryptString(token, password)));
  }
  async function loadToken(password) {
    const s = localStorage.getItem(TOKEN_KEY);
    if (!s) return null;
    try { return await C.decryptString(JSON.parse(s), password); } catch (e) { return null; }
  }
  const hasToken = () => !!localStorage.getItem(TOKEN_KEY);
  const clearToken = () => localStorage.removeItem(TOKEN_KEY);

  const getSha = () => localStorage.getItem(SHA_KEY) || null;
  const setSha = (s) => { if (s) localStorage.setItem(SHA_KEY, s); };

  // ── Alto nivel ──
  // Lee el bloque cifrado del repo (público). Devuelve {blob, sha} o null (404).
  async function fetchRemoteBlob(token) {
    const res = await ghGet(token);
    if (!res) return null;
    setSha(res.sha);
    return { blob: JSON.parse(res.content), sha: res.sha };
  }

  // Cifra el doc y lo sube al repo. Devuelve el nuevo sha.
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
    try {
      return await intentar(sha);
    } catch (e) {
      if (e.code !== "CONFLICT") throw e;
      const cur = await ghGet(token);           // sha fresco y reintento
      return await intentar(cur ? cur.sha : null);
    }
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
    fetchRemoteBlob, push, pushTickers, getSha, setSha,
  };
})();
