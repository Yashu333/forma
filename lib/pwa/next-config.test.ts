import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";

// next.config.ts headers() for the service worker (docs/mobile-pwa/SPEC.md, P1).
describe("next.config.ts headers()", () => {
  it("is defined", () => {
    expect(typeof nextConfig.headers).toBe("function");
  });

  it("serves /sw.js uncached, as JavaScript, locked to same-origin scripts", async () => {
    const rules = await nextConfig.headers!();
    const sw = rules.filter((rule) => rule.source === "/sw.js");
    expect(sw).toHaveLength(1);
    const headers = Object.fromEntries(sw[0].headers.map(({ key, value }) => [key.toLowerCase(), value]));
    expect(headers).toEqual({
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-cache, no-store, must-revalidate",
      "content-security-policy": "default-src 'self'; script-src 'self'",
    });
  });

  it("doesn't put the service worker's strict CSP on any other path", async () => {
    const rules = await nextConfig.headers!();
    const withCsp = rules.filter((rule) =>
      rule.headers.some(({ key }) => key.toLowerCase() === "content-security-policy"),
    );
    expect(withCsp.map((rule) => rule.source)).toEqual(["/sw.js"]);
  });
});
