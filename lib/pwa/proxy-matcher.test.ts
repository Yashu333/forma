import { describe, expect, it, vi } from "vitest";
// Next's own matcher compiler and runtime matcher (the functions `next build`
// and the server use for proxy.ts), so this tests the real behaviour of the
// path-to-regexp source plus the suffixes Next adds, not a re-implementation.
// getMiddlewareMatchers is exported at runtime but missing from Next's .d.ts.
import * as staticInfo from "next/dist/build/analysis/get-page-static-info";
import { getMiddlewareRouteMatcher } from "next/dist/shared/lib/router/utils/middleware-route-matcher";

type ProxyMatcher = Parameters<typeof getMiddlewareRouteMatcher>[0][number];
const { getMiddlewareMatchers } = staticInfo as unknown as {
  getMiddlewareMatchers: (matcher: string | string[], nextConfig: object) => ProxyMatcher[];
};

// proxy.ts imports the Supabase session helper; the matcher test doesn't need it.
vi.mock("@/lib/supabase/middleware", () => ({ updateSession: vi.fn() }));
const { config } = await import("@/proxy");

const runsProxy = getMiddlewareRouteMatcher(getMiddlewareMatchers(config.matcher, {}));
const matches = (pathname: string) => runsProxy(pathname, { headers: {} } as never, {});

describe("proxy.ts matcher", () => {
  it.each([
    "/manifest.webmanifest",
    "/sw.js",
    "/icons/icon-192.png",
    "/icons/maskable-512.png",
    "/icons/apple-touch-icon.png",
    "/offline",
  ])("lets the PWA file %s through without the auth proxy", (pathname) => {
    expect(matches(pathname)).toBe(false);
  });

  it.each(["/_next/static/chunks/app.js", "/_next/image", "/favicon.ico", "/favicon.svg", "/logo.png"])(
    "still skips static file %s",
    (pathname) => {
      expect(matches(pathname)).toBe(false);
    },
  );

  it.each([
    "/",
    "/dashboard",
    "/today",
    "/calendar",
    "/api/tasks",
    "/api/tasks/abc",
    "/login",
    "/auth/callback",
    // Lookalikes of the excluded names must still be guarded.
    "/offline-notes",
    "/offline/x",
    "/sw.jsx",
    "/group/sw.js",
    "/manifest.webmanifest.bak",
    "/iconsx",
  ])("runs the auth proxy on %s", (pathname) => {
    expect(matches(pathname)).toBe(true);
  });
});
