// Forma service worker (docs/mobile-pwa/SPEC.md, P2 and decisions 2, 3, 6).
//
// Plain JS with no build step and no imports. It only uses standard service
// worker globals (self, caches, fetch, URL, Response, setTimeout,
// clearTimeout), so tests can load it in a node:vm context with stubs.
//
// What it caches:
// - forma-static-v<N>: the offline page with the CSS, JS and font files it
//   links to, the icons, the manifest (all precached on install), plus every
//   /_next/static/, /icons/ and font file fetched later (cache first).
// - forma-pages-v<N>: the last-seen HTML of app pages, only served when the
//   network fails (network first). Deleted on sign-out, and whenever /login or
//   /signup loads (a 200 there means there's no session).
// Never cached: /api, /auth, /login, /signup, RSC requests, non-GET requests.
//
// Versioning:
// - Any edit to this file must bump CACHE_VERSION. Activate then drops every
//   cache from older versions.
// - /icons/* and /manifest.webmanifest are cache first and their URLs are not
//   hashed: changing an icon or the manifest also needs a bump, or installed
//   apps keep the old one.
// - App deploys don't touch this file, so they never show the update toast
//   (pages are network first and pick up the new build anyway). The offline
//   page stays at the build it was precached from, and old /_next/static/
//   chunks pile up in forma-static until the next bump.

const CACHE_VERSION = 1;
const STATIC_CACHE = `forma-static-v${CACHE_VERSION}`;
const PAGES_CACHE = `forma-pages-v${CACHE_VERSION}`;
const OFFLINE_URL = "/offline";
const PRECACHE_URLS = [
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/manifest.webmanifest",
];
// Long enough that a slow but working connection gets the fresh page; only a
// connection that is up but moves no data falls back to the stored copy.
const NAV_TIMEOUT_MS = 8000;

// Bumped on every page-cache clear, so a navigation that started before a
// sign-out doesn't store its page after the clear.
let clearGen = 0;

// ── Routing ──────────────────────────────────────────────────────────────────

// Routes:
// - "passthrough": don't call respondWith; the browser fetches as if there
//   were no service worker.
// - "cache-first": static assets (forma-static).
// - "network-first": page navigations; the last good HTML is kept in
//   forma-pages and served, else the offline page, when the network fails.
// - "network-only": navigations to /login and /signup. Never stored; a 200
//   clears forma-pages (no session); the offline page is served only when the
//   network fails.
function routeFor(url, request) {
  // 1. Not GET, or not same-origin.
  if (request.method !== "GET") return "passthrough";
  if (url.origin !== self.location.origin) return "passthrough";
  // Devtools quirk: only-if-cached is only valid with mode same-origin.
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") return "passthrough";

  // 2. Data, auth and RSC requests: never cached.
  const path = url.pathname;
  if (
    under(path, "/api") ||
    under(path, "/auth") ||
    path.startsWith("/_next/data/") ||
    path === "/sw.js" ||
    request.headers.get("RSC") !== null ||
    url.searchParams.has("_rsc")
  ) {
    return "passthrough";
  }
  if (under(path, "/login") || under(path, "/signup")) {
    return request.mode === "navigate" ? "network-only" : "passthrough";
  }

  // 3. Static assets.
  if (
    path.startsWith("/_next/static/") ||
    path.startsWith("/icons/") ||
    path === "/manifest.webmanifest" ||
    request.destination === "font" ||
    /\.(?:woff2?|ttf|otf|eot)$/i.test(path)
  ) {
    return "cache-first";
  }

  // 4. Page navigations.
  if (request.mode === "navigate") return "network-first";

  // 5. Everything else.
  return "passthrough";
}

// "/api" matches /api and /api/..., not /apis.
function under(path, prefix) {
  return path === prefix || path.startsWith(prefix + "/");
}

// The /_next/static/ files a page's HTML links to (stylesheets, scripts,
// preloaded fonts), so the offline page renders styled with no network.
function assetUrlsIn(html) {
  const urls = new Set();
  const re = /(?:src|href)="(\/_next\/static\/[^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) urls.add(m[1].replace(/&amp;/g, "&"));
  return [...urls];
}

self.__formaRouteFor = routeFor;
self.__formaSW = {
  routeFor,
  assetUrlsIn,
  CACHE_VERSION,
  STATIC_CACHE,
  PAGES_CACHE,
  OFFLINE_URL,
  PRECACHE_URLS,
  NAV_TIMEOUT_MS,
};

// ── Lifecycle ────────────────────────────────────────────────────────────────

// No skipWaiting() here: a new version waits until the page's update toast
// sends SKIP_WAITING (decision 6).
self.addEventListener("install", (event) => {
  event.waitUntil(precache());
});

async function precache() {
  const cache = await caches.open(STATIC_CACHE);
  await cache.addAll(PRECACHE_URLS);
  // The offline page and the exact CSS/JS/font files that HTML links to,
  // fetched together so they always match each other.
  const res = await fetch(OFFLINE_URL, { cache: "no-cache" });
  if (!res.ok) throw new Error(`precache: ${OFFLINE_URL} answered ${res.status}`);
  const html = await res.clone().text();
  // Its files first: if one fails, the install fails before an offline page
  // pointing at missing files lands in the cache.
  await cache.addAll(assetUrlsIn(html));
  await cache.put(OFFLINE_URL, res);
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = [STATIC_CACHE, PAGES_CACHE];
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith("forma-") && !keep.includes(n)).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  if (type === "SKIP_WAITING") {
    self.skipWaiting();
  } else if (type === "CLEAR_RUNTIME_CACHES") {
    event.waitUntil(
      clearRuntimeCaches().then(() => {
        const reply = { type: "RUNTIME_CACHES_CLEARED" };
        const port = event.ports && event.ports[0];
        if (port) port.postMessage(reply);
        else if (event.source) event.source.postMessage(reply);
      }),
    );
  }
});

// Sign-out (decision 3): the last user's pages go; static files stay.
async function clearRuntimeCaches() {
  clearGen++;
  const names = await caches.keys();
  await Promise.all(names.filter((n) => n.startsWith("forma-pages-")).map((n) => caches.delete(n)));
}

// ── Fetch ────────────────────────────────────────────────────────────────────

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const route = routeFor(new URL(request.url), request);
  if (route === "cache-first") {
    event.respondWith(cacheFirst(event));
  } else if (route === "network-first" || route === "network-only") {
    event.respondWith(navigate(event, route === "network-first"));
  }
  // "passthrough": no respondWith.
});

async function cacheFirst(event) {
  const request = event.request;
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.status === 200 && res.type === "basic") {
    event.waitUntil(cache.put(request, res.clone()).catch(() => {}));
  }
  return res;
}

// Network first. Stores a copy of a good HTML response (when `store`). Falls
// back to the stored copy of this URL, then to the offline page. After
// NAV_TIMEOUT_MS a stored copy is served if there is one; with none, it keeps
// waiting for the network rather than calling a slow connection offline.
// Without `store` (/login, /signup) a 200 means the user has no session (the
// proxy sends signed-in users away from those pages), so the last user's
// pages are deleted: covers an expired session or a sign-out elsewhere.
async function navigate(event, store) {
  const request = event.request;
  const gen = clearGen;
  let after = Promise.resolve();
  const network = fetch(request).then((res) => {
    if (store && isStorableHtml(res)) {
      const copy = res.clone();
      after = caches.open(PAGES_CACHE).then((c) => {
        // A sign-out happened while this page loaded: don't store it.
        if (gen === clearGen) return c.put(request, copy);
      });
    } else if (!store && res.status === 200 && res.type === "basic") {
      after = clearRuntimeCaches();
    }
    return res;
  });
  event.waitUntil(network.then(() => after).catch(() => {}));

  const TIMED_OUT = {};
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), NAV_TIMEOUT_MS);
  });
  try {
    const first = await Promise.race([network, timeout]);
    if (first !== TIMED_OUT) return first;
    const stored = store ? await storedPage(request) : undefined;
    if (stored) return stored;
    return await network;
  } catch {
    const stored = store ? await storedPage(request) : undefined;
    return stored || (await offlinePage()) || Response.error();
  } finally {
    clearTimeout(timer);
  }
}

function isStorableHtml(res) {
  return (
    res.status === 200 &&
    res.type === "basic" &&
    (res.headers.get("Content-Type") || "").includes("text/html")
  );
}

async function storedPage(request) {
  const cache = await caches.open(PAGES_CACHE);
  return cache.match(request, { ignoreVary: true });
}

async function offlinePage() {
  const cache = await caches.open(STATIC_CACHE);
  return cache.match(OFFLINE_URL, { ignoreVary: true });
}
