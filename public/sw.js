// Pawnie's service worker: makes the app installable, keeps the Stockfish files (several MB) and the hashed
// build assets cached, and falls back to the cached app shell when the network is down. Data always comes
// live from Convex, which doesn't go through here (it's a websocket to another origin).
const CACHE = "pawnie-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request, fallback) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(fallback ?? request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(fallback ?? request);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // every page is the same app shell
  if (request.mode === "navigate") return event.respondWith(networkFirst(request, "/index.html"));
  // file names that change whenever their content does
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/engine/") || url.pathname.startsWith("/icons/")) {
    return event.respondWith(cacheFirst(request));
  }
  if (url.pathname === "/openings.json") return event.respondWith(networkFirst(request));
});
