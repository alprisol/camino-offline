const CACHE_NAME = "camino-offline-v6";
const BASE_URL = self.registration.scope;
const assetUrl = (path = "") => new URL(path, BASE_URL).toString();
const APP_SHELL = assetUrl();
const MAP_ARCHIVE = assetUrl("data/camino.pmtiles");
const CORE_ASSETS = [
  APP_SHELL,
  assetUrl("manifest.webmanifest"),
  assetUrl("data/camino-data.json"),
  MAP_ARCHIVE,
  assetUrl("sprites/light.json"),
  assetUrl("sprites/light.png"),
  assetUrl("sprites/light@2x.json"),
  assetUrl("sprites/light@2x.png"),
  assetUrl("icons/bus-cluster.png"),
  assetUrl("icons/bus-single.png"),
  assetUrl("icons/gps-position.png"),
  assetUrl("icons/santiago-shell.png"),
  assetUrl("fonts/roboto/roboto-latin-variable.woff2"),
  assetUrl("fonts/Noto%20Sans%20Regular/0-255.pbf"),
  assetUrl("fonts/Noto%20Sans%20Regular/256-511.pbf"),
  assetUrl("fonts/Noto%20Sans%20Medium/0-255.pbf"),
  assetUrl("fonts/Noto%20Sans%20Medium/256-511.pbf"),
  assetUrl("fonts/Noto%20Sans%20Italic/0-255.pbf"),
  assetUrl("fonts/Noto%20Sans%20Italic/256-511.pbf")
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CACHE_RESOURCES" || !Array.isArray(event.data.resources)) return;
  const localResources = event.data.resources.filter((url) => {
    try {
      const resource = new URL(url);
      return resource.origin === self.location.origin && resource.href.startsWith(BASE_URL);
    } catch {
      return false;
    }
  });
  const caching = caches
    .open(CACHE_NAME)
    .then((cache) => cache.addAll(localResources))
    .then(() => event.ports[0]?.postMessage({ ok: true }))
    .catch(() => event.ports[0]?.postMessage({ ok: false }));
  event.waitUntil(caching);
});

async function rangedMapResponse(request) {
  const cache = await caches.open(CACHE_NAME);
  let response = await cache.match(MAP_ARCHIVE);
  if (!response) {
    response = await fetch(MAP_ARCHIVE);
    if (response.ok) await cache.put(MAP_ARCHIVE, response.clone());
  }
  const range = request.headers.get("range");
  if (!range || !response?.ok) return response;
  const bytes = await response.arrayBuffer();
  const match = /bytes=(\d+)-(\d+)?/.exec(range);
  if (!match) return response;
  const start = Number(match[1]);
  const end = Math.min(match[2] ? Number(match[2]) : bytes.byteLength - 1, bytes.byteLength - 1);
  return new Response(bytes.slice(start, end + 1), {
    status: 206,
    headers: {
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes ${start}-${end}/${bytes.byteLength}`,
      "Content-Length": String(end - start + 1),
      "Content-Type": "application/octet-stream",
    },
  });
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET") return;

  if (url.href === MAP_ARCHIVE) {
    event.respondWith(rangedMapResponse(event.request));
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(APP_SHELL, copy));
          return response;
        })
        .catch(() => caches.match(APP_SHELL)),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      });
    }),
  );
});
