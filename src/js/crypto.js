/*
 * Solvento v2 — Módulo de cifrado zero-knowledge (Web Crypto API).
 *
 * Es el ÚNICO lugar donde se cifra o descifra. Nada de esto sale del navegador:
 * la contraseña nunca se guarda ni se transmite; solo se usa para derivar la
 * clave en memoria. El bloque cifrado (data.enc) puede vivir en un repo público
 * porque sin la contraseña es indescifrable.
 *
 *   Derivación de clave : PBKDF2-HMAC-SHA256, 310.000 iteraciones (OWASP 2023)
 *   Cifrado             : AES-256-GCM (autentica e integra; contraseña errónea → falla)
 *   Formato del blob    : JSON { v, kdf, iter, salt, iv, ct }  (salt/iv/ct en base64)
 *
 * API pública (window.SolventoCrypto):
 *   encryptDoc(obj, password)      → Promise<blob>   cifra un objeto JSON
 *   decryptDoc(blob, password)     → Promise<obj>    descifra; lanza si la contraseña es incorrecta
 *   encryptString(str, password)   → Promise<blob>   (p.ej. para el token de GitHub)
 *   decryptString(blob, password)  → Promise<string>
 */
(function () {
  "use strict";

  const PBKDF2_ITER = 310000;
  const SALT_BYTES = 16;
  const IV_BYTES = 12; // recomendado para AES-GCM

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  // ── base64 ⇄ bytes ──────────────────────────────────────────────
  function bytesToB64(bytes) {
    let bin = "";
    const arr = new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin);
  }
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // ── Derivar clave AES-GCM desde la contraseña ───────────────────
  async function deriveKey(password, salt, iterations) {
    const baseKey = await crypto.subtle.importKey(
      "raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  // ── Cifrado / descifrado de bytes ───────────────────────────────
  async function encryptBytes(plainBytes, password) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const key = await deriveKey(password, salt, PBKDF2_ITER);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plainBytes);
    return {
      v: 1,
      kdf: "PBKDF2-SHA256",
      iter: PBKDF2_ITER,
      salt: bytesToB64(salt),
      iv: bytesToB64(iv),
      ct: bytesToB64(ct),
    };
  }

  async function decryptBytes(blob, password) {
    if (!blob || blob.v !== 1) throw new Error("Formato de bloque cifrado no reconocido");
    const salt = b64ToBytes(blob.salt);
    const iv = b64ToBytes(blob.iv);
    const ct = b64ToBytes(blob.ct);
    const key = await deriveKey(password, salt, blob.iter || PBKDF2_ITER);
    let plain;
    try {
      plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    } catch (e) {
      // GCM no autentica → contraseña incorrecta o datos manipulados
      const err = new Error("Contraseña incorrecta");
      err.code = "BAD_PASSWORD";
      throw err;
    }
    return new Uint8Array(plain);
  }

  // ── API de alto nivel ───────────────────────────────────────────
  async function encryptDoc(obj, password) {
    return encryptBytes(enc.encode(JSON.stringify(obj)), password);
  }
  async function decryptDoc(blob, password) {
    return JSON.parse(dec.decode(await decryptBytes(blob, password)));
  }
  async function encryptString(str, password) {
    return encryptBytes(enc.encode(str), password);
  }
  async function decryptString(blob, password) {
    return dec.decode(await decryptBytes(blob, password));
  }

  window.SolventoCrypto = {
    encryptDoc, decryptDoc, encryptString, decryptString,
    _internals: { bytesToB64, b64ToBytes, PBKDF2_ITER },
  };
})();
