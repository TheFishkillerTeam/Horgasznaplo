// Horgásznapló – service worker: az app offline is elindul.
// Új verzió feltöltésekor a CACHE_VERSION számát növeld meg!
const CACHE_VERSION = "horgasznaplo-v3";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./config.js",
  "./supabase.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon-180.png",
  "./vendor/leaflet/leaflet.js",
  "./vendor/leaflet/leaflet.css",
  "./vendor/leaflet/images/marker-icon.png",
  "./vendor/leaflet/images/marker-icon-2x.png",
  "./vendor/leaflet/images/marker-shadow.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Csak a saját fájlokat kezeljük; az adatbázis és az időjárás mindig hálózaton megy.
  if (url.origin !== self.location.origin) return;

  // Hálózat előbb (friss verzió); ha nincs net vagy 4 mp alatt nem válaszol: tárolt példány.
  const fromCache = () =>
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match("./index.html"));

  const network = fetch(req).then((res) => {
    if (res && res.ok) {
      const copy = res.clone();
      caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
    }
    return res;
  });
  network.catch(() => {}); // a hibát lent kezeljük

  const timeout = new Promise((resolve) => setTimeout(resolve, 4000)).then(() =>
    caches.match(req, { ignoreSearch: true })
  );

  event.respondWith(
    Promise.race([network, timeout])
      .then((res) => res || network)
      .catch(fromCache)
  );
});
