import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

// public/sw.js routing rules (docs/mobile-pwa/SPEC.md, P2), loaded in a vm
// context with only the globals its top level touches.
const ORIGIN = "https://forma.test";

type Req = { method?: string; mode?: string; destination?: string; cache?: string; headers?: Record<string, string> };
type SW = {
  routeFor: (url: URL, request: unknown) => string;
  assetUrlsIn: (html: string) => string[];
};

function loadSW(): SW {
  const ctx: Record<string, unknown> = {
    URL,
    location: { origin: ORIGIN },
    addEventListener: () => {},
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, "../../public/sw.js"), "utf8"), ctx);
  return ctx.__formaSW as SW;
}

const sw = loadSW();

function route(url: string, req: Req = {}) {
  const headers = new Headers(req.headers ?? {});
  return sw.routeFor(new URL(url, ORIGIN), {
    method: req.method ?? "GET",
    mode: req.mode ?? "cors",
    destination: req.destination ?? "",
    cache: req.cache ?? "default",
    headers,
  });
}

const nav: Req = { mode: "navigate", destination: "document" };

describe("sw.js routeFor", () => {
  it("passes through non-GET and cross-origin requests", () => {
    expect(route("/dashboard", { ...nav, method: "POST" })).toBe("passthrough");
    expect(route("/_next/static/chunks/a.js", { method: "HEAD" })).toBe("passthrough");
    expect(route("https://example.supabase.co/auth/v1/user")).toBe("passthrough");
    expect(route("https://fonts.example.com/a.woff2", { destination: "font" })).toBe("passthrough");
  });

  it("never caches data, auth or RSC requests", () => {
    for (const url of ["/api/tasks", "/api", "/auth/callback", "/_next/data/x/today.json", "/sw.js"]) {
      expect(route(url, nav), url).toBe("passthrough");
      expect(route(url), url).toBe("passthrough");
    }
    expect(route("/today", { headers: { RSC: "1" } })).toBe("passthrough");
    expect(route("/today?_rsc=abc")).toBe("passthrough");
    expect(route("/today?_rsc=abc", nav)).toBe("passthrough");
  });

  it("serves /login and /signup navigations from the network only", () => {
    expect(route("/login", nav)).toBe("network-only");
    expect(route("/signup", nav)).toBe("network-only");
    expect(route("/login")).toBe("passthrough");
    expect(route("/signup", { headers: { rsc: "1" } })).toBe("passthrough");
  });

  it("matches path prefixes on segment boundaries", () => {
    expect(route("/apis", nav)).toBe("network-first");
    expect(route("/loginx", nav)).toBe("network-first");
    expect(route("/authors", nav)).toBe("network-first");
  });

  it("serves static assets cache first", () => {
    expect(route("/_next/static/chunks/main.js")).toBe("cache-first");
    expect(route("/_next/static/media/font.woff2")).toBe("cache-first");
    expect(route("/icons/icon-192.png")).toBe("cache-first");
    expect(route("/fonts/x.woff2")).toBe("cache-first");
    expect(route("/some/font", { destination: "font" })).toBe("cache-first");
  });

  it("serves page navigations network first", () => {
    expect(route("/dashboard", nav)).toBe("network-first");
    expect(route("/group/abc?x=1", nav)).toBe("network-first");
    expect(route("/offline", nav)).toBe("network-first");
  });

  it("passes through every non-GET method, even for static files", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      expect(route("/today", { ...nav, method }), method).toBe("passthrough");
      expect(route("/icons/icon-192.png", { method }), method).toBe("passthrough");
    }
  });

  it("passes through cross-origin requests of every kind", () => {
    expect(route("https://other.test/today", nav)).toBe("passthrough");
    expect(route("https://other.test/_next/static/chunks/a.js")).toBe("passthrough");
    expect(route("http://forma.test/today", nav)).toBe("passthrough"); // other scheme
    expect(route("https://forma.test:8443/today", nav)).toBe("passthrough"); // other port
  });

  it("checks rule 2 before the static and navigation rules", () => {
    for (const url of [
      "/api/tasks/1?x=2",
      "/api/files/report.woff2",
      "/auth",
      "/auth/confirm?token=x",
      "/_next/data/build/group/abc.json",
      "/sw.js?v=2",
    ]) {
      expect(route(url, nav), url).toBe("passthrough");
      expect(route(url, { destination: "font" }), url).toBe("passthrough");
    }
    expect(route("/_next/static/chunks/a.js?_rsc=1")).toBe("passthrough");
    expect(route("/icons/icon-192.png", { headers: { RSC: "1" } })).toBe("passthrough");
    expect(route("/dashboard", { ...nav, headers: { RSC: "1", "Next-Router-Prefetch": "1" } })).toBe("passthrough");
    expect(route("/dashboard?_rsc=")).toBe("passthrough");
  });

  it("treats /login and /signup subpaths and query strings the same way", () => {
    expect(route("/login?next=%2Ftoday", nav)).toBe("network-only");
    expect(route("/login/", nav)).toBe("network-only");
    expect(route("/signup/confirm", nav)).toBe("network-only");
    expect(route("/login?_rsc=1", nav)).toBe("passthrough");
    expect(route("/signup", { destination: "font" })).toBe("passthrough");
  });

  it("caches the font file types and the static folders only", () => {
    for (const f of ["a.woff", "a.woff2", "a.ttf", "a.otf", "a.eot", "A.WOFF2"]) {
      expect(route(`/fonts/${f}`), f).toBe("cache-first");
    }
    expect(route("/_next/static/css/app.css", nav)).toBe("cache-first");
    expect(route("/_next/staticx/a.js")).toBe("passthrough");
    expect(route("/iconsx/a.png")).toBe("passthrough");
    expect(route("/_next/image?url=%2Ficons%2Fa.png")).toBe("passthrough");
  });

  it("passes everything else through", () => {
    expect(route("/manifest.webmanifest")).toBe("passthrough");
    expect(route("/favicon.svg")).toBe("passthrough");
    expect(route("/dashboard")).toBe("passthrough");
    expect(route("/_next/image?url=x")).toBe("passthrough");
    expect(route("/dashboard", { mode: "no-cors", cache: "only-if-cached" })).toBe("passthrough");
  });
});

describe("sw.js assetUrlsIn", () => {
  it("lists the /_next/static/ files a page links to, once each", () => {
    const html = `
      <link rel="preload" href="/_next/static/media/a.woff2" as="font"/>
      <link rel="stylesheet" href="/_next/static/chunks/app.css?dpl=1&amp;v=2"/>
      <script src="/_next/static/chunks/main.js" async></script>
      <script src="/_next/static/chunks/main.js" async></script>
      <link rel="icon" href="/favicon.svg"/>
      <script>self.__next_f.push([1,"/_next/static/chunks/inline.js"])</script>`;
    expect(sw.assetUrlsIn(html)).toEqual([
      "/_next/static/media/a.woff2",
      "/_next/static/chunks/app.css?dpl=1&v=2",
      "/_next/static/chunks/main.js",
    ]);
  });
});
