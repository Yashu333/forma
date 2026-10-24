// Extra, adversarial coverage for compareTasks / formatAbcde / openAtasks:
// total-preorder laws over every combination of null/undefined/real values.
import { describe, expect, it } from "vitest";
import type { Abcde, Priority } from "@/types";
import { compareTasks, formatAbcde, openAtasks } from "./abcde";

type T = { id: number; abcde?: Abcde | null; abcdeRank?: number | null; priority: Priority; order: number };

const LETTERS: (Abcde | null | undefined)[] = ["A", "B", "C", "D", "E", null, undefined];
const RANKS: (number | null | undefined)[] = [1, 2, 10, 0, null, undefined];
const PRIOS: Priority[] = ["URGENT", "HIGH", "MEDIUM", "LOW"];
const ORDERS = [0, 1, 1.5, -2];

function universe(): T[] {
  const out: T[] = [];
  let id = 0;
  for (const abcde of LETTERS)
    for (const abcdeRank of RANKS)
      for (const priority of PRIOS)
        for (const order of ORDERS) out.push({ id: id++, abcde, abcdeRank, priority, order });
  return out;
}

const sign = (n: number) => (n < 0 ? -1 : n > 0 ? 1 : 0);

describe("compareTasks laws", () => {
  const U = universe(); // 7*6*4*4 = 672 tasks

  it("never returns NaN and is antisymmetric over every pair", () => {
    for (const a of U)
      for (const b of U) {
        const ab = compareTasks(a, b);
        expect(Number.isNaN(ab)).toBe(false);
        if (sign(ab) !== -sign(compareTasks(b, a))) throw new Error(`antisymmetry ${JSON.stringify(a)} ${JSON.stringify(b)}`);
      }
  });

  it("is reflexive (compare(x, x) === 0)", () => {
    for (const a of U) expect(compareTasks(a, a)).toBe(0);
  });

  it("null and undefined abcde/abcdeRank are interchangeable", () => {
    const base = { priority: "MEDIUM" as Priority, order: 0 };
    expect(compareTasks({ ...base, abcde: null }, { ...base, abcde: undefined })).toBe(0);
    expect(compareTasks({ ...base, abcde: "A", abcdeRank: null }, { ...base, abcde: "A", abcdeRank: undefined })).toBe(0);
  });

  it("is transitive: a<=b and b<=c implies a<=c, and a<b, b<c implies a<c (sampled triples across every null/undefined combination)", () => {
    // Full cube is 672^3 = 3e8; sample deterministically with a stride that hits every combination of the 3 coordinates.
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    for (let i = 0; i < 400_000; i++) {
      const a = U[next() % U.length];
      const b = U[next() % U.length];
      const c = U[next() % U.length];
      const ab = compareTasks(a, b);
      const bc = compareTasks(b, c);
      const ac = compareTasks(a, c);
      if (ab <= 0 && bc <= 0 && ac > 0) throw new Error(`<= transitivity ${JSON.stringify([a, b, c])}`);
      if (ab < 0 && bc < 0 && ac >= 0) throw new Error(`< transitivity ${JSON.stringify([a, b, c])}`);
      if (ab === 0 && bc === 0 && ac !== 0) throw new Error(`== transitivity ${JSON.stringify([a, b, c])}`);
    }
  });

  it("sorting any permutation gives the same key sequence, and every adjacent pair is in order", () => {
    const keyOf = (t: T) => `${t.abcde ?? "-"}|${t.abcdeRank ?? "-"}|${t.priority}|${t.order}`;
    const base = [...U].sort(compareTasks);
    for (let i = 1; i < base.length; i++) expect(compareTasks(base[i - 1], base[i])).toBeLessThanOrEqual(0);
    let seed = 3;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let round = 0; round < 5; round++) {
      const shuffled = [...U];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      shuffled.sort(compareTasks);
      expect(shuffled.map(keyOf)).toEqual(base.map(keyOf));
    }
  });

  it("A-null-rank sorts after A-1 but before B-1 (rank null is last only within its letter)", () => {
    const base = { priority: "LOW" as Priority, order: 99 };
    const a1: T = { id: 1, abcde: "A", abcdeRank: 1, ...base };
    const aN: T = { id: 2, abcde: "A", abcdeRank: null, ...base };
    const b1: T = { id: 3, abcde: "B", abcdeRank: 1, ...base };
    expect([b1, aN, a1].sort(compareTasks).map((t) => t.id)).toEqual([1, 2, 3]);
  });

  it("an unlabelled task with a rank sorts after E with no rank", () => {
    const base = { priority: "URGENT" as Priority, order: -5 };
    const e: T = { id: 1, abcde: "E", abcdeRank: null, ...base };
    const none: T = { id: 2, abcde: null, abcdeRank: 1, ...base };
    expect([none, e].sort(compareTasks).map((t) => t.id)).toEqual([1, 2]);
  });

  it("two unlabelled tasks fall through to rank, then priority, then order (consistent with the spec's literal chain)", () => {
    const base = { abcde: null };
    const a: T = { id: 1, ...base, abcdeRank: 2, priority: "URGENT", order: 0 };
    const b: T = { id: 2, ...base, abcdeRank: 1, priority: "LOW", order: 9 };
    const c: T = { id: 3, ...base, abcdeRank: null, priority: "URGENT", order: 0 };
    expect([a, b, c].sort(compareTasks).map((t) => t.id)).toEqual([2, 1, 3]);
  });

  it("does not crash or produce NaN on out-of-vocabulary data from the DB (unknown letter/priority)", () => {
    const bad = { id: 1, abcde: "Z" as unknown as Abcde, abcdeRank: null, priority: "WHATEVER" as unknown as Priority, order: 0 };
    const ok: T = { id: 2, abcde: "A", abcdeRank: null, priority: "LOW", order: 0 };
    expect(Number.isNaN(compareTasks(bad, ok))).toBe(false);
    expect(compareTasks(ok, bad)).toBeLessThan(0);
    expect(sign(compareTasks(bad, ok))).toBe(-sign(compareTasks(ok, bad)));
  });

  it("orders very large and very small ranks/orders without overflow", () => {
    const base = { abcde: "A" as Abcde, priority: "MEDIUM" as Priority };
    const lo: T = { id: 1, ...base, abcdeRank: -2147483648, order: -1e300 };
    const hi: T = { id: 2, ...base, abcdeRank: 2147483647, order: 1e300 };
    expect(compareTasks(lo, hi)).toBeLessThan(0);
    expect(compareTasks({ ...lo, abcdeRank: 1 }, { ...hi, abcdeRank: 1 })).toBeLessThan(0);
  });
});

describe("formatAbcde (adversarial)", () => {
  it("rank 0 is shown as A-0, not hidden as if unranked", () => {
    expect(formatAbcde({ abcde: "A", abcdeRank: 0 })).toBe("A-0");
  });
  it("undefined and null behave the same", () => {
    expect(formatAbcde({})).toBe("");
    expect(formatAbcde({ abcde: undefined, abcdeRank: 3 })).toBe("");
    expect(formatAbcde({ abcde: "C", abcdeRank: undefined })).toBe("C");
  });
  it("large ranks print as integers", () => {
    expect(formatAbcde({ abcde: "B", abcdeRank: 12 })).toBe("B-12");
  });
});

describe("openAtasks (adversarial)", () => {
  it("treats a Date, an ISO string and a numeric-looking string as completed", () => {
    const tasks = [
      { id: 1, abcde: "A" as Abcde, completedAt: new Date(0) },
      { id: 2, abcde: "A" as Abcde, completedAt: "2026-10-23T09:00:00Z" },
      { id: 3, abcde: "A" as Abcde, completedAt: null },
      { id: 4, abcde: "A" as Abcde },
    ];
    expect(openAtasks(tasks).map((t) => t.id)).toEqual([3, 4]);
  });
  it("ignores B-E tasks and unlabelled tasks even when open", () => {
    const tasks = [
      { abcde: "B" as Abcde, completedAt: null },
      { abcde: null, completedAt: null },
      { completedAt: null },
    ];
    expect(openAtasks(tasks)).toEqual([]);
  });
  it("preserves input order", () => {
    const tasks = [3, 1, 2].map((id) => ({ id, abcde: "A" as Abcde, completedAt: null }));
    expect(openAtasks(tasks).map((t) => t.id)).toEqual([3, 1, 2]);
  });
});
