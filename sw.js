const CACHE_NAME = "coupon-seva-tracker-v1";
const ASSETS = [
  "index.html",
  "styles.css",
  "app.js",
  "firebase-config.js",
  "excel-upload.js",
  "manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      const url = new URL(event.request.url);
      // Strip query string for cache matching to handle versioned assets
      const strippedUrl = url.origin + url.pathname;
      return caches.match(strippedUrl).then((strippedCached) => {
        if (strippedCached) return strippedCached;
        return fetch(event.request).catch(() => strippedCached);
      });
    })
  );
});
