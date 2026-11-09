// Pedel-appens service worker: gør, at appen kan åbnes uden net (appens egne filer gemmes).
// Data fra bookingsystemet (/api/*) går ALTID direkte til nettet - de gemmes af appen selv (se api.js).
const VERSION = "pedel-shell-v1";
const SHELL = ["./", "index.html", "manifest.webmanifest", "icon.svg", "css/app.css", "js/app.js", "js/api.js", "js/ui.js", "js/util.js", "js/form.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  // Netværket først (så nye versioner af appen slår igennem med det samme), med de gemte filer som reserve, når der ikke er net.
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const res = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000))]);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === "navigate") { const shell = await cache.match("index.html"); if (shell) return shell; }
      return Response.error();
    }
  })());
});
