/* Service worker minimal : l'app est toujours servie depuis le réseau (les données sont sur le serveur) ;
   le cache ne sert que de secours si le réseau tombe, et ne contient jamais l'API. */
const CACHE = "foxdrive-shell-v1";
self.addEventListener("install", e => { self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api") || url.pathname.startsWith("/webhooks")) return;
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(() => { }); }
    return res;
  }).catch(() => caches.match(req).then(r => r || caches.match("/"))));
});
