/*
 * Solvento v2 — Estado en memoria + persistencia local del bloque cifrado.
 *
 * En la Fase 1 el bloque cifrado (data.enc) se guarda en localStorage, así que
 * el login funciona por dispositivo. La sincronización móvil↔Mac (leer/escribir
 * data.enc en el repo de GitHub con el token) llega en la Fase 3.
 *
 * El documento descifrado vive SOLO en memoria (state.doc); nunca se persiste
 * en claro.
 */
(function () {
  "use strict";
  const LS_KEY = "solvento_data_enc";

  const state = { doc: null };

  function getStoredBlob() {
    try {
      const s = localStorage.getItem(LS_KEY);
      return s ? JSON.parse(s) : null;
    } catch (e) {
      return null;
    }
  }
  function storeBlob(blob) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(blob));
      return true;
    } catch (e) {
      return false;
    }
  }
  function clearBlob() {
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
  }
  function hasData() { return !!getStoredBlob(); }

  window.SolventoDB = { LS_KEY, state, getStoredBlob, storeBlob, clearBlob, hasData };
})();
