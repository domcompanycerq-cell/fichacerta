// Service worker do CMV Certo: permite instalar o app e abrir a tela mesmo sem internet.
// Arquivos do app: rede primeiro (para sempre pegar a versão nova), cache como reserva.
// A API (/api/...) nunca é guardada em cache: os dados vêm sempre do servidor.
const CACHE = "cmv-certo-v4"; // troque o número quando mudar a lista de arquivos
const ARQUIVOS = ["/", "/index.html", "/style.css", "/calc.js", "/ui.js", "/app.js", "/manifest.webmanifest", "/icons/icon-192.png", "/fonts/archivo.woff2", "/fonts/figtree.woff2", "/fonts/plexmono-500.woff2", "/fonts/plexmono-600.woff2", "/img/acesso.webp"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const proibido = /no-store|private/.test(r.headers.get("cache-control") || "");
        if (r.ok && r.type === "basic" && !proibido) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); }
        return r;
      })
      .catch(() => caches.match(e.request).then((r) => r || (e.request.mode === "navigate" ? caches.match("/index.html") : Response.error())))
  );
});
