// @vitest-environment node
// M6's client components must not reach a server-only module (the DB, Supabase's
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
  return { seen: [...seen].map((f) => path.relative(ROOT, f)), bad };
}

describe("client components do not reach server-only modules", () => {
  it.each([
    "components/reports/FrogSection.tsx",
    "components/reports/ReportsDashboard.tsx",
    "components/dashboard/TodaysFrogCard.tsx",
    "components/today/FrogCard.tsx",
  ])("%s", (entry) => {
    const { seen, bad } = closure(entry);
    expect(bad).toEqual([]);
    expect(seen.length).toBeGreaterThan(1); // the walker really followed imports
  });

  it("the walker would notice a violation (sanity check on lib/frog/today.server.ts)", () => {
    const { bad } = closure("lib/frog/today.server.ts");
    expect(bad.length).toBeGreaterThan(0);
  });

  it("the report route may import the DB (it is server code), but reports.ts itself must stay pure", () => {
    expect(closure("lib/frog/reports.ts").bad).toEqual([]);
  });

  it("FrogSection and TodaysFrogCard are 'use client' modules", () => {
    for (const f of ["components/reports/FrogSection.tsx", "components/dashboard/TodaysFrogCard.tsx"]) {
      expect(readFileSync(path.join(ROOT, f), "utf8").trimStart().startsWith('"use client"')).toBe(true);
    }
  });
});
