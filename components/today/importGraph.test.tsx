// @vitest-environment node
// M7: the Today page's client components (incl. the frog-first toggle and its fetch layer) must not reach a server-only module (the DB, Supabase's
// server client, next/headers...) through their imports, or the production build
// breaks (or worse, bundles server code). Walks the static import graph.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

const FORBIDDEN = [
  /(^|\/)today\.server$/,
  /^@\/lib\/db$/,
  /^@\/lib\/supabase\/server$/,
  /^next\/headers$/,
  /^server-only$/,
  /^@prisma\/client$/,
  /^pg$/,
  /^@prisma\/adapter-pg$/,
  /^next\/server$/,
];

function resolveFile(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? path.join(ROOT, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return null;
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

/** Value imports only: `import type` and `export type` are erased and cannot pull code in. */
function valueImports(src: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^;'"]*?)\s*from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[4] !== undefined) {
      if (m[2]) continue; // import type / export type
      // `import { type A, type B } from` still emits nothing, but it is rare; treat as a value import (conservative).
      out.push(m[4]);
    } else if (m[5]) out.push(m[5]);
    else if (m[6]) out.push(m[6]);
  }
  return out;
}

function closure(entry: string) {
  const seen = new Set<string>();
  const bad: string[] = [];
  const stack = [path.join(ROOT, entry)];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of valueImports(readFileSync(file, "utf8"))) {
      if (FORBIDDEN.some((re) => re.test(spec))) bad.push(`${path.relative(ROOT, file)} imports ${spec}`);
      const next = resolveFile(file, spec);
      if (next) {
        if (FORBIDDEN.some((re) => re.test(path.relative(ROOT, next).replace(/\.tsx?$/, "")))) bad.push(`${path.relative(ROOT, file)} -> ${path.relative(ROOT, next)}`);
        stack.push(next);
      }
    }
  }
  // Forward slashes on every OS (path.relative gives backslashes on Windows).
  return { seen: [...seen].map((f) => path.relative(ROOT, f).split(path.sep).join("/")), bad };
}

describe("M7: the Today page's client code does not reach server-only modules", () => {
  it.each([
    "components/today/FrogFirstToggle.tsx",
    "components/today/TodayDay.tsx",
    "components/today/TodayView.tsx",
    "components/today/api.ts",
    "lib/frog/dayview.ts",
    "types/index.ts",
  ])("%s", (entry) => {
    const { seen, bad } = closure(entry);
    expect(bad).toEqual([]);
    expect(seen.length).toBeGreaterThanOrEqual(1);
  });

  it("TodayView's closure really includes the toggle, the lock logic and the fetch layer", () => {
    const { seen } = closure("components/today/TodayView.tsx");
    for (const f of ["components/today/FrogFirstToggle.tsx", "lib/frog/dayview.ts", "components/today/api.ts"]) expect(seen).toContain(f);
  });

  it("the walker would notice a violation (the payload builder that reads the DB)", () => {
    expect(closure("lib/frog/today.server.ts").bad.length).toBeGreaterThan(0);
  });

  it("the toggle and the Today components are 'use client' modules; dayview.ts is plain logic with no directive and no React", () => {
    for (const f of ["components/today/FrogFirstToggle.tsx", "components/today/TodayDay.tsx", "components/today/TodayView.tsx"]) {
      expect(readFileSync(path.join(ROOT, f), "utf8").trimStart().startsWith('"use client"')).toBe(true);
    }
    const dayview = readFileSync(path.join(ROOT, "lib/frog/dayview.ts"), "utf8");
    expect(dayview).not.toMatch(/from\s+["']react["']/);
    expect(dayview.trimStart().startsWith('"use client"')).toBe(false);
  });

  it("the PUT route's Prisma access stays in app/api (no client file imports it)", () => {
    for (const f of ["components/today/TodayDay.tsx", "components/today/FrogFirstToggle.tsx", "components/today/api.ts"]) {
      expect(closure(f).seen.some((s) => s.startsWith("app/api/"))).toBe(false);
    }
  });
});
