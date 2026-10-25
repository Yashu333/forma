import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

// public/sw.js event handlers (docs/mobile-pwa/SPEC.md, P2): install,
// activate, message and fetch, run in a node:vm context against an in-memory
// CacheStorage and a stub fetch. Routing itself is in sw-route.test.ts.

const ORIGIN = "https://forma.test";
const STATIC = "forma-static-v1";
const PAGES = "forma-pages-v1";

// ── Fakes ────────────────────────────────────────────────────────────────────

type ResOpts = { status?: number; type?: string; contentType?: string; headers?: Record<string, string> };

/** A Response whose `type` (and, for opaque redirects, `status`) is what a browser would report. */
function res(body: string, o: ResOpts = {}): Response {
  const status = o.status ?? 200;
  const headers = new Headers(o.headers ?? {});
  if (o.contentType !== undefined) headers.set("Content-Type", o.contentType);
  const real = new Response(status === 0 || status === 204 ? null : body, {
    status: status === 0 ? 200 : status,
    headers,
  });
  const type = o.type ?? "basic";
  Object.defineProperty(real, "type", { value: type });
  if (status === 0) {
    Object.defineProperty(real, "status", { value: 0 });
    Object.defineProperty(real, "ok", { value: false });
  }
  return real;
}
const html = (body: string, o: ResOpts = {}) => res(body, { contentType: "text/html; charset=utf-8", ...o });

function keyOf(req: string | { url: string }): string {
  return new URL(typeof req === "string" ? req : req.url, ORIGIN).href;
}

class FakeCache {
  entries = new Map<string, Response>();
  constructor(private fetchFn: (url: string) => Promise<Response>) {}
  async match(req: string | { url: string }) {
    const hit = this.entries.get(keyOf(req));
    return hit ? hit.clone() : undefined;
  }
  async put(req: string | { url: string }, response: Response) {
    this.entries.set(keyOf(req), response);
  }
  // Like the real addAll: all or nothing, rejects on a non-OK answer.
  async addAll(urls: string[]) {
    const got = await Promise.all(
      urls.map(async (u) => {
        const r = await this.fetchFn(u);
        if (!r.ok) throw new TypeError(`addAll: ${u} answered ${r.status}`);
        return [u, r] as const;
      }),
    );
    for (const [u, r] of got) await this.put(u, r);
  }
  keys() {
    return [...this.entries.keys()].map((k) => k.replace(ORIGIN, ""));
  }
}

class FakeCacheStorage {
  store = new Map<string, FakeCache>();
  constructor(private fetchFn: (url: string) => Promise<Response>) {}
  async open(name: string) {
    let c = this.store.get(name);
    if (!c) this.store.set(name, (c = new FakeCache(this.fetchFn)));
    return c;
  }
  async keys() {
    return [...this.store.keys()];
  }
  async delete(name: string) {
    return this.store.delete(name);
  }
  async has(name: string) {
    return this.store.has(name);
  }
}

type Req = { url: string; method: string; mode: string; destination: string; cache: string; headers: Headers };
function request(url: string, o: Partial<Omit<Req, "headers">> & { headers?: Record<string, string> } = {}): Req {
  return {
    url: new URL(url, ORIGIN).href,
    method: o.method ?? "GET",
    mode: o.mode ?? "cors",
    destination: o.destination ?? "",
    cache: o.cache ?? "default",
    headers: new Headers(o.headers ?? {}),
  };
}
const navRequest = (url: string) => request(url, { mode: "navigate", destination: "document" });

type Handler = (event: unknown) => void;

function loadSW() {
  const handlers: Record<string, Handler> = {};
  const fetchMock = vi.fn<(input: unknown, init?: unknown) => Promise<Response>>(async (input) => {
    throw new TypeError(`Failed to fetch ${String(input)}`);
  });
  const doFetch = (input: unknown, init?: unknown) => fetchMock(input, init);
  const caches = new FakeCacheStorage((url) => doFetch(url));
  const clients = { claim: vi.fn(async () => {}) };
  const skipWaiting = vi.fn(async () => {});
  const ctx: Record<string, unknown> = {
    URL,
    Response,
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: Handler) => {
      handlers[type] = fn;
    },
    caches,
    fetch: doFetch,
    // Looked up at call time so vi.useFakeTimers() applies inside the vm.
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (t: ReturnType<typeof setTimeout>) => clearTimeout(t),
    clients,
    skipWaiting,
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, "../../public/sw.js"), "utf8"), ctx);

  /** Dispatches an ExtendableEvent; `done()` waits for every waitUntil promise. */
  function dispatch(type: string, extra: Record<string, unknown> = {}) {
    const pending: Promise<unknown>[] = [];
    let responded: Promise<Response> | undefined;
    const event = {
      ...extra,
      waitUntil: vi.fn((p: Promise<unknown>) => {
        pending.push(Promise.resolve(p));
      }),
      respondWith: vi.fn((p: Promise<Response>) => {
        responded = Promise.resolve(p);
      }),
    };
    handlers[type](event);
    return {
      event,
      get response() {
        return responded;
      },
      async done() {
        // waitUntil can be called again while earlier promises run.
        let n = -1;
        while (n !== pending.length) {
          n = pending.length;
          await Promise.allSettled(pending);
        }
        return Promise.all(pending);
      },
    };
  }

  const sw = ctx.__formaSW as { PRECACHE_URLS: string[]; NAV_TIMEOUT_MS: number; CACHE_VERSION: number };
  return { handlers, fetchMock, caches, clients, skipWaiting, dispatch, sw };
}

/** A fetch answer the test settles by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

function track<T>(p: Promise<T>) {
  const t = { settled: false, value: undefined as T | undefined };
  p.then(
    (v) => {
      t.settled = true;
      t.value = v;
    },
    () => {
      t.settled = true;
    },
  );
  return t;
}

async function textOf(r: Response | undefined) {
  expect(r).toBeDefined();
  return r!.clone().text();
}

afterEach(() => {
  vi.useRealTimers();
});

// ── Install ──────────────────────────────────────────────────────────────────

const OFFLINE_HTML = `<!DOCTYPE html><html><head>
<link rel="preload" href="/_next/static/media/font-a.woff2" as="font" crossorigin=""/>
<link rel="stylesheet" href="/_next/static/css/app.css?dpl=x&amp;v=1" data-precedence="next"/>
</head><body><main>You're offline</main>
<script src="/_next/static/chunks/webpack.js" async=""></script>
<script src="/_next/static/chunks/main-app.js" async=""></script>
</body></html>`;

function installFetch(sw: ReturnType<typeof loadSW>, overrides: Record<string, () => Response> = {}) {
  sw.fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (overrides[url]) return overrides[url]();
    if (url === "/offline") return html(OFFLINE_HTML);
    return res(`body of ${url}`, { contentType: "application/octet-stream" });
  });
}

describe("sw.js install", () => {
  it("precaches the offline page, the icons, the manifest and the files the offline page links to", async () => {
    const sw = loadSW();
    installFetch(sw);
    const d = sw.dispatch("install");
    expect(d.event.waitUntil).toHaveBeenCalledTimes(1);
    await d.done();

    expect([...sw.caches.store.keys()]).toEqual([STATIC]);
    const cached = sw.caches.store.get(STATIC)!.keys().sort();
    expect(cached).toEqual(
      [
        "/icons/icon-192.png",
        "/icons/icon-512.png",
        "/icons/maskable-512.png",
        "/icons/apple-touch-icon.png",
        "/manifest.webmanifest",
        "/offline",
        "/_next/static/media/font-a.woff2",
        "/_next/static/css/app.css?dpl=x&v=1",
        "/_next/static/chunks/webpack.js",
        "/_next/static/chunks/main-app.js",
      ].sort(),
    );
    expect(sw.sw.PRECACHE_URLS).toEqual([
      "/icons/icon-192.png",
      "/icons/icon-512.png",
      "/icons/maskable-512.png",
      "/icons/apple-touch-icon.png",
      "/manifest.webmanifest",
    ]);
    // The stored offline page is the HTML itself, intact.
    expect(await textOf(await sw.caches.store.get(STATIC)!.match("/offline"))).toBe(OFFLINE_HTML);
  });

  it("fetches /offline past the HTTP cache, and never caches a page or calls skipWaiting", async () => {
    const sw = loadSW();
    installFetch(sw);
    await sw.dispatch("install").done();
    expect(sw.fetchMock).toHaveBeenCalledWith("/offline", { cache: "no-cache" });
    expect(sw.caches.store.has(PAGES)).toBe(false);
    expect(sw.skipWaiting).not.toHaveBeenCalled();
    expect(sw.clients.claim).not.toHaveBeenCalled();
  });

  it("fails the install when /offline does not answer 200 (the old worker stays)", async () => {
    const sw = loadSW();
    installFetch(sw, { "/offline": () => html("oops", { status: 500 }) });
    await expect(sw.dispatch("install").done()).rejects.toThrow(/offline.*500/);
    expect(sw.caches.store.get(STATIC)!.keys()).not.toContain("/offline");
  });

  it("fails the install when a file the offline page links to is missing, before storing the offline page", async () => {
    const sw = loadSW();
    installFetch(sw, { "/_next/static/chunks/main-app.js": () => res("nope", { status: 404 }) });
    await expect(sw.dispatch("install").done()).rejects.toThrow();
    // No offline HTML pointing at files that aren't there.
    expect(sw.caches.store.get(STATIC)!.keys()).not.toContain("/offline");
  });

  it("stores the offline page only after every file it links to", async () => {
    const sw = loadSW();
    installFetch(sw);
    const cache = await sw.caches.open(STATIC);
    const order: string[] = [];
    const put = cache.put.bind(cache);
    cache.put = async (req, response) => {
      order.push(keyOf(req).replace(ORIGIN, ""));
      return put(req, response);
    };
    await sw.dispatch("install").done();
    expect(order.at(-1)).toBe("/offline");
    expect(order.filter((u) => u.startsWith("/_next/static/"))).toHaveLength(4);
  });

  it("fails the install when an icon is missing", async () => {
    const sw = loadSW();
    installFetch(sw, { "/icons/maskable-512.png": () => res("nope", { status: 404 }) });
    await expect(sw.dispatch("install").done()).rejects.toThrow();
  });
});

// ── Activate ─────────────────────────────────────────────────────────────────

describe("sw.js activate", () => {
  it("deletes only older forma-* caches, never other apps' caches, then claims clients", async () => {
    const sw = loadSW();
    const names = [
      "forma-static-v0",
      "forma-pages-v0",
      "forma-static-v1",
      "forma-pages-v1",
      "forma-something-old",
      "workbox-precache-v2",
      "other-app",
      "formative-v1",
      "forma",
    ];
    for (const n of names) await sw.caches.open(n);
    const order: string[] = [];
    const del = sw.caches.delete.bind(sw.caches);
    sw.caches.delete = async (n: string) => {
      order.push(`delete ${n}`);
      return del(n);
    };
    sw.clients.claim.mockImplementation(async () => {
      order.push("claim");
    });

    const d = sw.dispatch("activate");
    expect(d.event.waitUntil).toHaveBeenCalledTimes(1);
    await d.done();

    expect([...sw.caches.store.keys()].sort()).toEqual(
      ["forma-static-v1", "forma-pages-v1", "workbox-precache-v2", "other-app", "formative-v1", "forma"].sort(),
    );
    expect(order.slice(0, -1).sort()).toEqual(
      ["delete forma-static-v0", "delete forma-pages-v0", "delete forma-something-old"].sort(),
    );
    expect(order.at(-1)).toBe("claim");
    expect(sw.clients.claim).toHaveBeenCalledTimes(1);
  });

  it("claims clients with nothing to delete", async () => {
    const sw = loadSW();
    await sw.dispatch("activate").done();
    expect(sw.clients.claim).toHaveBeenCalledTimes(1);
  });
});

// ── Messages ─────────────────────────────────────────────────────────────────

describe("sw.js messages", () => {
  it("SKIP_WAITING calls skipWaiting", () => {
    const sw = loadSW();
    sw.dispatch("message", { data: { type: "SKIP_WAITING" } });
    expect(sw.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it("ignores unknown or empty messages", () => {
    const sw = loadSW();
    for (const data of [null, undefined, "SKIP_WAITING", { type: "OTHER" }, {}]) {
      const d = sw.dispatch("message", { data });
      expect(d.event.waitUntil).not.toHaveBeenCalled();
    }
    expect(sw.skipWaiting).not.toHaveBeenCalled();
  });

  it("CLEAR_RUNTIME_CACHES deletes only forma-pages-* and replies on the port once they're gone", async () => {
    const sw = loadSW();
    for (const n of ["forma-static-v1", "forma-pages-v1", "forma-pages-v0", "other-app", "other-pages-v1"]) {
      await sw.caches.open(n);
    }
    const seenAtReply: string[][] = [];
    const port = {
      postMessage: vi.fn(() => {
        seenAtReply.push([...sw.caches.store.keys()]);
      }),
    };
    const source = { postMessage: vi.fn() };
    const d = sw.dispatch("message", { data: { type: "CLEAR_RUNTIME_CACHES" }, ports: [port], source });
    expect(d.event.waitUntil).toHaveBeenCalledTimes(1);
    expect(port.postMessage).not.toHaveBeenCalled();
    await d.done();

    expect([...sw.caches.store.keys()].sort()).toEqual(["forma-static-v1", "other-app", "other-pages-v1"].sort());
    expect(port.postMessage).toHaveBeenCalledTimes(1);
    expect(port.postMessage).toHaveBeenCalledWith({ type: "RUNTIME_CACHES_CLEARED" });
    expect(seenAtReply[0].sort()).toEqual(["forma-static-v1", "other-app", "other-pages-v1"].sort());
    expect(source.postMessage).not.toHaveBeenCalled();
    expect(sw.skipWaiting).not.toHaveBeenCalled();
  });

  it("CLEAR_RUNTIME_CACHES with no port replies to the sender", async () => {
    const sw = loadSW();
    await sw.caches.open(PAGES);
    const source = { postMessage: vi.fn() };
    await sw.dispatch("message", { data: { type: "CLEAR_RUNTIME_CACHES" }, ports: [], source }).done();
    expect(sw.caches.store.has(PAGES)).toBe(false);
    expect(source.postMessage).toHaveBeenCalledWith({ type: "RUNTIME_CACHES_CLEARED" });
  });

  it("CLEAR_RUNTIME_CACHES with nobody to reply to still clears", async () => {
    const sw = loadSW();
    await sw.caches.open(PAGES);
    await sw.dispatch("message", { data: { type: "CLEAR_RUNTIME_CACHES" } }).done();
    expect(sw.caches.store.has(PAGES)).toBe(false);
  });
});

// ── Fetch: which requests get a response from the worker ─────────────────────

describe("sw.js fetch handler dispatch", () => {
  it("does not call respondWith for pass-through requests", () => {
    const sw = loadSW();
    const passthrough = [
      request("/dashboard", { method: "POST", mode: "navigate" }),
      request("/api/tasks", { method: "PATCH" }),
      request("https://example.supabase.co/rest/v1/x"),
      request("https://other.test/page", { mode: "navigate" }),
      navRequest("/api/tasks"),
      navRequest("/auth/callback?code=x"),
      request("/login"),
      request("/signup"),
      request("/_next/data/build/today.json"),
      request("/today", { headers: { RSC: "1" } }),
      request("/today?_rsc=1a2b"),
      navRequest("/sw.js"),
      request("/favicon.svg"),
      request("/dashboard"),
    ];
    for (const r of passthrough) {
      const d = sw.dispatch("fetch", { request: r });
      expect(d.event.respondWith, `${r.method} ${r.url} (${r.mode})`).not.toHaveBeenCalled();
    }
    expect(sw.fetchMock).not.toHaveBeenCalled();
  });

  it("responds to static assets, page navigations and /login, /signup navigations", () => {
    const sw = loadSW();
    sw.fetchMock.mockImplementation(async () => html("x"));
    for (const r of [
      request("/_next/static/chunks/a.js"),
      request("/icons/icon-192.png"),
      request("/manifest.webmanifest"),
      request("/x.woff2", { destination: "font" }),
      navRequest("/dashboard"),
      navRequest("/login"),
      navRequest("/signup?next=/today"),
    ]) {
      const d = sw.dispatch("fetch", { request: r });
      expect(d.event.respondWith, r.url).toHaveBeenCalledTimes(1);
    }
  });
});

// ── Fetch: static assets (cache first) ───────────────────────────────────────

describe("sw.js static assets (cache first)", () => {
  it("serves a stored file without touching the network", async () => {
    const sw = loadSW();
    const c = await sw.caches.open(STATIC);
    await c.put("/_next/static/chunks/a.js", res("cached js"));
    const d = sw.dispatch("fetch", { request: request("/_next/static/chunks/a.js") });
    expect(await textOf(await d.response)).toBe("cached js");
    expect(sw.fetchMock).not.toHaveBeenCalled();
  });

  it("fetches and stores a missing file", async () => {
    const sw = loadSW();
    sw.fetchMock.mockImplementation(async () => res("fresh js", { contentType: "text/javascript" }));
    const r = request("/_next/static/chunks/b.js");
    const d = sw.dispatch("fetch", { request: r });
    expect(await textOf(await d.response)).toBe("fresh js");
    await d.done();
    expect(sw.fetchMock).toHaveBeenCalledWith(r, undefined);
    expect(await textOf(await sw.caches.store.get(STATIC)!.match(r))).toBe("fresh js");
    expect(sw.caches.store.has(PAGES)).toBe(false);
  });

  it("does not store an error or non-basic answer", async () => {
    for (const answer of [() => res("nope", { status: 404 }), () => res("x", { type: "opaque", status: 0 })]) {
      const sw = loadSW();
      sw.fetchMock.mockImplementation(async () => answer());
      const d = sw.dispatch("fetch", { request: request("/icons/missing.png") });
      await d.response;
      await d.done();
      expect(sw.caches.store.get(STATIC)!.keys()).toEqual([]);
    }
  });
});

// ── Fetch: page navigations (network first) ──────────────────────────────────

describe("sw.js navigations (network first)", () => {
  async function seed(sw: ReturnType<typeof loadSW>, { page, offline }: { page?: [string, string]; offline?: boolean }) {
    if (page) await (await sw.caches.open(PAGES)).put(page[0], html(page[1]));
    if (offline) await (await sw.caches.open(STATIC)).put("/offline", html("OFFLINE PAGE"));
  }

  it("serves the network answer and stores a copy of good HTML for that URL", async () => {
    const sw = loadSW();
    sw.fetchMock.mockImplementation(async () => html("fresh today"));
    const r = navRequest("/today?view=list");
    const d = sw.dispatch("fetch", { request: r });
    expect(await textOf(await d.response)).toBe("fresh today");
    await d.done();
    expect(sw.fetchMock).toHaveBeenCalledWith(r, undefined);
    expect(sw.caches.store.get(PAGES)!.keys()).toEqual(["/today?view=list"]);
    expect(await textOf(await sw.caches.store.get(PAGES)!.match(r))).toBe("fresh today");
  });

  it.each([
    ["a 404", () => html("not found", { status: 404 })],
    ["a 500", () => html("server error", { status: 500 })],
    ["a JSON answer", () => res("{}", { contentType: "application/json" })],
    ["an answer with no Content-Type", () => res("x")],
    ["a 307 redirect to /login", () => res("", { status: 307, headers: { Location: "/login" } })],
    ["an opaque redirect (redirect: manual)", () => res("", { status: 0, type: "opaqueredirect" })],
    ["a cors answer", () => html("x", { type: "cors" })],
  ])("returns %s unchanged and does not store it", async (_name, answer) => {
    const sw = loadSW();
    await seed(sw, { page: ["/today", "OLD today"], offline: true });
    const sent = answer();
    sw.fetchMock.mockImplementation(async () => sent);
    const d = sw.dispatch("fetch", { request: navRequest("/today") });
    expect(await d.response).toBe(sent);
    await d.done();
    // The earlier good copy is still the one stored.
    expect(await textOf(await sw.caches.store.get(PAGES)!.match("/today"))).toBe("OLD today");
    expect(sw.caches.store.get(PAGES)!.keys()).toEqual(["/today"]);
  });

  it("serves the stored copy of that URL when the network fails", async () => {
    const sw = loadSW();
    await seed(sw, { page: ["/today", "stored today"], offline: true });
    const d = sw.dispatch("fetch", { request: navRequest("/today") });
    expect(await textOf(await d.response)).toBe("stored today");
  });

  it("serves the offline page when the network fails and that URL was never stored", async () => {
    const sw = loadSW();
    await seed(sw, { page: ["/today", "stored today"], offline: true });
    const d = sw.dispatch("fetch", { request: navRequest("/calendar") });
    expect(await textOf(await d.response)).toBe("OFFLINE PAGE");
  });

  it("answers with a network error when nothing is stored at all", async () => {
    const sw = loadSW();
    const d = sw.dispatch("fetch", { request: navRequest("/calendar") });
    const r = await d.response;
    expect(r!.type).toBe("error");
  });

  it("serves /login and /signup from the network and never stores them", async () => {
    const sw = loadSW();
    sw.fetchMock.mockImplementation(async () => html("login form"));
    for (const url of ["/login", "/signup", "/login?next=/today"]) {
      const d = sw.dispatch("fetch", { request: navRequest(url) });
      expect(await textOf(await d.response)).toBe("login form");
      await d.done();
    }
    expect(sw.caches.store.has(PAGES)).toBe(false);
  });

  it("serves the offline page for /login when the network fails, never a stored copy", async () => {
    const sw = loadSW();
    await seed(sw, { page: ["/login", "STALE LOGIN"], offline: true });
    const d = sw.dispatch("fetch", { request: navRequest("/login") });
    expect(await textOf(await d.response)).toBe("OFFLINE PAGE");
  });
});

// ── Fetch: the 8 s navigation timeout ────────────────────────────────────────

describe("sw.js navigation timeout", () => {
  it("is 8 seconds", () => {
    expect(loadSW().sw.NAV_TIMEOUT_MS).toBe(8000);
  });

  it("waits for the network until 8 s, then serves the stored copy; the late answer still refreshes it", async () => {
    vi.useFakeTimers();
    const sw = loadSW();
    await seed2(sw, "/today", "stored today");
    const net = deferred<Response>();
    sw.fetchMock.mockImplementation(() => net.promise);
    const d = sw.dispatch("fetch", { request: navRequest("/today") });
    const t = track(d.response!);

    await vi.advanceTimersByTimeAsync(5000);
    expect(t.settled).toBe(false); // the old 5 s timeout no longer applies
    await vi.advanceTimersByTimeAsync(2999);
    expect(t.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.settled).toBe(true);
    expect(await textOf(t.value)).toBe("stored today");

    // The network answers later: the worker is kept alive and stores it.
    net.resolve(html("late today"));
    await d.done();
    expect(await textOf(await sw.caches.store.get(PAGES)!.match("/today"))).toBe("late today");
  });

  it("keeps waiting past 8 s when nothing is stored, and serves the network answer", async () => {
    vi.useFakeTimers();
    const sw = loadSW();
    await (await sw.caches.open(STATIC)).put("/offline", html("OFFLINE PAGE"));
    const net = deferred<Response>();
    sw.fetchMock.mockImplementation(() => net.promise);
    const d = sw.dispatch("fetch", { request: navRequest("/calendar") });
    const t = track(d.response!);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(t.settled).toBe(false);
    net.resolve(html("slow calendar"));
    await vi.advanceTimersByTimeAsync(0);
    expect(await textOf(await d.response)).toBe("slow calendar");
    await d.done();
    expect(await textOf(await sw.caches.store.get(PAGES)!.match("/calendar"))).toBe("slow calendar");
  });

  it("serves the offline page when the network fails after the timeout with nothing stored", async () => {
    vi.useFakeTimers();
    const sw = loadSW();
    await (await sw.caches.open(STATIC)).put("/offline", html("OFFLINE PAGE"));
    const net = deferred<Response>();
    sw.fetchMock.mockImplementation(() => net.promise);
    const d = sw.dispatch("fetch", { request: navRequest("/calendar") });
    const t = track(d.response!);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.settled).toBe(false);
    net.reject(new TypeError("Failed to fetch"));
    expect(await textOf(await d.response)).toBe("OFFLINE PAGE");
  });

  it("never serves a stored copy for /login on timeout: it waits for the network", async () => {
    vi.useFakeTimers();
    const sw = loadSW();
    await seed2(sw, "/login", "STALE LOGIN");
    const net = deferred<Response>();
    sw.fetchMock.mockImplementation(() => net.promise);
    const d = sw.dispatch("fetch", { request: navRequest("/login") });
    const t = track(d.response!);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.settled).toBe(false);
    net.resolve(html("login form"));
    expect(await textOf(await d.response)).toBe("login form");
  });

  it("clears its timer when the network answers first", async () => {
    vi.useFakeTimers();
    const sw = loadSW();
    sw.fetchMock.mockImplementation(async () => html("fast"));
    const d = sw.dispatch("fetch", { request: navRequest("/today") });
    await d.response;
    await d.done();
    expect(vi.getTimerCount()).toBe(0);
  });

  async function seed2(sw: ReturnType<typeof loadSW>, url: string, body: string) {
    await (await sw.caches.open(PAGES)).put(url, html(body));
    await (await sw.caches.open(STATIC)).put("/offline", html("OFFLINE PAGE"));
  }
});

// ── Fetch: the manifest (cache first) ────────────────────────────────────────

describe("sw.js manifest", () => {
  it("serves the precached manifest without the network", async () => {
    const sw = loadSW();
    await (await sw.caches.open(STATIC)).put("/manifest.webmanifest", res("{\"name\":\"Forma\"}"));
    const d = sw.dispatch("fetch", { request: request("/manifest.webmanifest", { destination: "manifest" }) });
    expect(await textOf(await d.response)).toBe("{\"name\":\"Forma\"}");
    expect(sw.fetchMock).not.toHaveBeenCalled();
  });
});

// ── Fetch: /login or /signup loading means there is no session ───────────────

describe("sw.js clears the page copies when /login or /signup loads", () => {
  async function seedPages(sw: ReturnType<typeof loadSW>) {
    await (await sw.caches.open("forma-pages-v0")).put("/today", html("old version's today"));
    await (await sw.caches.open(PAGES)).put("/dashboard", html("last user's dashboard"));
    await (await sw.caches.open(STATIC)).put("/offline", html("OFFLINE PAGE"));
    await sw.caches.open("other-app");
  }

  it.each(["/login", "/signup", "/login?next=/today"])(
    "a 200 for %s deletes forma-pages-* (expired session, signed out elsewhere) and keeps the rest",
    async (url) => {
      const sw = loadSW();
      await seedPages(sw);
      sw.fetchMock.mockImplementation(async () => html("login form"));
      const d = sw.dispatch("fetch", { request: navRequest(url) });
      expect(await textOf(await d.response)).toBe("login form");
      await d.done();
      expect([...sw.caches.store.keys()].sort()).toEqual([STATIC, "other-app"].sort());
    },
  );

  it.each([
    ["a redirect away (signed in: the proxy sends you to /dashboard)", () => res("", { status: 0, type: "opaqueredirect" })],
    ["a 500", () => html("server error", { status: 500 })],
    ["a network failure", () => Promise.reject(new TypeError("Failed to fetch"))],
  ])("keeps them on %s", async (_name, answer) => {
    const sw = loadSW();
    await seedPages(sw);
    sw.fetchMock.mockImplementation(async () => answer());
    const d = sw.dispatch("fetch", { request: navRequest("/login") });
    await d.response;
    await d.done();
    expect(sw.caches.store.has(PAGES)).toBe(true);
    expect(sw.caches.store.has("forma-pages-v0")).toBe(true);
  });

  it("does not clear for a 200 on a normal page", async () => {
    const sw = loadSW();
    await seedPages(sw);
    sw.fetchMock.mockImplementation(async () => html("fresh today"));
    await sw.dispatch("fetch", { request: navRequest("/today") }).done();
    expect(await textOf(await sw.caches.store.get(PAGES)!.match("/dashboard"))).toBe("last user's dashboard");
  });
});

// ── Fetch: a page in flight during sign-out is not stored ────────────────────

describe("sw.js navigation racing a sign-out", () => {
  it("does not store a page whose request started before CLEAR_RUNTIME_CACHES", async () => {
    const sw = loadSW();
    await (await sw.caches.open(PAGES)).put("/dashboard", html("old dashboard"));
    const net = deferred<Response>();
    sw.fetchMock.mockImplementation(() => net.promise);
    const d = sw.dispatch("fetch", { request: navRequest("/today") });

    await sw.dispatch("message", { data: { type: "CLEAR_RUNTIME_CACHES" } }).done();
    expect(sw.caches.store.has(PAGES)).toBe(false);

    net.resolve(html("today, signed in"));
    expect(await textOf(await d.response)).toBe("today, signed in"); // still shown
    await d.done();
    expect(sw.caches.store.get(PAGES)?.keys() ?? []).toEqual([]);
  });

  it("stores pages again for navigations that start after the clear", async () => {
    const sw = loadSW();
    await sw.dispatch("message", { data: { type: "CLEAR_RUNTIME_CACHES" } }).done();
    sw.fetchMock.mockImplementation(async () => html("next user's today"));
    await sw.dispatch("fetch", { request: navRequest("/today") }).done();
    expect(await textOf(await sw.caches.store.get(PAGES)!.match("/today"))).toBe("next user's today");
  });

  it("does not store a page in flight while /login cleared the caches", async () => {
    const sw = loadSW();
    const slow = deferred<Response>();
    sw.fetchMock.mockImplementation(async (input) => {
      const url = (input as { url: string }).url;
      return url.endsWith("/login") ? html("login form") : slow.promise;
    });
    const page = sw.dispatch("fetch", { request: navRequest("/today") });
    await sw.dispatch("fetch", { request: navRequest("/login") }).done();
    slow.resolve(html("today"));
    await page.done();
    expect(sw.caches.store.get(PAGES)?.keys() ?? []).toEqual([]);
  });
});
