// Service worker do J.A.R.V.I.S. — guarda a interface para abrir rápido e funcionar sem internet.
// Altera CACHE_VERSION sempre que quiseres forçar a atualização dos ficheiros guardados.
const CACHE_VERSION = "jarvis-v1";
const SHELL = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // API: sempre pela rede (dados em tempo real, nunca em cache)
  if (url.origin === location.origin && url.pathname.startsWith("/api/")) return;

  // Tipos de letra do Google: cache primeiro (não mudam)
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok || res.type === "opaque") cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // Interface: rede primeiro (para receber atualizações), cache se estiver offline
  if (url.origin === location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(req)) ?? (req.mode === "navigate" ? caches.match("/") : Response.error())),
    );
  }
});
