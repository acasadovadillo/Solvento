/*
 * Solvento — Service worker: hace que la app abra al instante y funcione sin
 * conexión.
 *
 * Reglas por tipo de petición, en orden de importancia:
 *
 *   1. api.github.com  → NUNCA se toca la caché. Es donde viven tus datos
 *      cifrados; servir una copia vieja provocaría conflictos de sha y podría
 *      hacerte perder cambios. Siempre red.
 *   2. El HTML         → primero la red, y si no hay, la caché. Así una versión
 *      nueva de la app te llega en cuanto la despliego, pero sigue abriendo en
 *      el metro.
 *   3. CSS/JS/imágenes → primero la caché. Llevan ?v=NN en la URL, así que cada
 *      versión es un recurso distinto: si cambia, la URL cambia y se descarga.
 *   4. prices.json     → primero la red (los precios interesan frescos), con la
 *      última copia como respaldo.
 */
const VERSION = "solvento-v2";
const BASE = ["./", "./index.html", "./img/logo-solvento.png",
              "./img/app/icon-192.png", "./img/app/icon-512.png"];

// Los CSS y JS llevan ?v=NN en la URL, que cambia en cada despliegue. En vez de
// mantener esa lista a mano (y arriesgarme a olvidar uno, dejando la app rota
// sin conexión), el service worker lee el propio index.html y descubre de ahí
// qué recursos cargar. Así la precarga siempre coincide con la versión servida.
async function recursosDelHtml() {
  try {
    const res = await fetch("./index.html", { cache: "no-cache" });
    if (!res.ok) return [];
    const html = await res.text();
    const urls = [];
    const re = /(?:src|href)="((?:src\/|img\/)[^"]+)"/g;
    let m;
    while ((m = re.exec(html))) urls.push("./" + m[1]);
    return [...new Set(urls)];
  } catch (e) { return []; }
}

self.addEventListener("install", (ev) => {
  ev.waitUntil((async () => {
    const c = await caches.open(VERSION);
    const todo = BASE.concat(await recursosDelHtml());
    // Si algún recurso falla, no queremos tumbar la instalación entera.
    await Promise.allSettled(todo.map((u) => c.add(u)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Guarda una copia sin romper la respuesta que ya va de camino al navegador.
function guardar(req, res) {
  if (res && res.ok && res.type === "basic") {
    const copia = res.clone();
    caches.open(VERSION).then((c) => c.put(req, copia)).catch(() => {});
  }
  return res;
}

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  if (req.method !== "GET") return;                       // altas y guardados van directos
  const url = new URL(req.url);

  // 1. Datos cifrados y API: jamás desde caché
  if (url.hostname === "api.github.com" || url.hostname.endsWith("githubusercontent.com")) return;

  // 2. Navegación: red primero, caché de respaldo
  if (req.mode === "navigate") {
    ev.respondWith(
      fetch(req).then((r) => guardar(req, r))
        .catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  // 4. Precios: red primero, última copia si no hay conexión
  if (url.pathname.endsWith("/prices.json")) {
    ev.respondWith(
      fetch(req).then((r) => guardar(req, r)).catch(() => caches.match(req))
    );
    return;
  }

  // 3. Estáticos versionados: caché primero
  if (url.origin === self.location.origin) {
    ev.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((r) => guardar(req, r)))
    );
  }
});
