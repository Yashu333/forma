import { describe, expect, it } from "vitest";
import type { Abcde, Priority } from "@/types";
import { ABCDE_LETTERS, ABCDE_META, compareTasks, formatAbcde, openAtasks } from "./abcde";

type T = {
  id: string;
  abcde?: Abcde | null;
  abcdeRank?: number | null;
  priority: Priority;
  order: number;
};

const task = (id: string, over: Partial<T> = {}): T => ({ id, priority: "MEDIUM", order: 0, ...over });
const ids = (ts: T[]) => ts.map((t) => t.id);
const sorted = (ts: T[]) => [...ts].sort(compareTasks);

// Relative luminance / contrast ratio per WCAG 2.x.
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("ABCDE_META", () => {
  it("has an entry for every letter, in order", () => {
    expect(ABCDE_LETTERS).toEqual(["A", "B", "C", "D", "E"]);
    expect(Object.keys(ABCDE_META)).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("gives each letter a label, a description and a hex colour", () => {
    for (const l of ABCDE_LETTERS) {
      expect(ABCDE_META[l].label.length).toBeGreaterThan(0);
      expect(ABCDE_META[l].description.length).toBeGreaterThan(0);
      expect(ABCDE_META[l].color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("uses distinct colours", () => {
    expect(new Set(ABCDE_LETTERS.map((l) => ABCDE_META[l].color)).size).toBe(5);
  });

  it("reads on the dark --card background (#282A42) at WCAG AA for text", () => {
    for (const l of ABCDE_LETTERS) {
      expect(contrast(ABCDE_META[l].color, "#282A42"), l).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("is red-ish, orange, blue, purple and grey as specified", () => {
    const hue = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max === min) return -1; // grey
      const d = max - min;
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (h * 60 + 360) % 360;
    };
    const A = hue(ABCDE_META.A.color);
    const B = hue(ABCDE_META.B.color);
    const C = hue(ABCDE_META.C.color);
    const D = hue(ABCDE_META.D.color);
    expect(A < 15 || A > 345).toBe(true);
    expect(B).toBeGreaterThan(15);
    expect(B).toBeLessThan(45);
    expect(C).toBeGreaterThan(200);
    expect(C).toBeLessThan(230);
    expect(D).toBeGreaterThan(250);
    expect(D).toBeLessThan(280);
    // Grey: low saturation.
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(ABCDE_META.E.color.slice(i, i + 2), 16));
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(40);
  });
});

describe("compareTasks", () => {
  it("orders by letter A to E", () => {
    const ts = [task("e", { abcde: "E" }), task("c", { abcde: "C" }), task("a", { abcde: "A" }), task("d", { abcde: "D" }), task("b", { abcde: "B" })];
    expect(ids(sorted(ts))).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("puts unlabelled tasks (null and undefined) after every letter", () => {
    const ts = [task("none"), task("undef", { abcde: undefined }), task("e", { abcde: "E" }), task("a", { abcde: "A" })];
    expect(ids(sorted(ts))).toEqual(["a", "e", "none", "undef"]);
  });

  it("letter beats rank, priority and order", () => {
    const a = task("a", { abcde: "A", abcdeRank: 9, priority: "LOW", order: 99 });
    const b = task("b", { abcde: "B", abcdeRank: 1, priority: "URGENT", order: 0 });
    expect(compareTasks(a, b)).toBeLessThan(0);
    expect(compareTasks(b, a)).toBeGreaterThan(0);
  });

  it("orders by rank within a letter, with unranked last", () => {
    const ts = [
      task("a-unranked", { abcde: "A" }),
      task("a-3", { abcde: "A", abcdeRank: 3 }),
      task("a-1", { abcde: "A", abcdeRank: 1 }),
      task("a-2", { abcde: "A", abcdeRank: 2 }),
    ];
    expect(ids(sorted(ts))).toEqual(["a-1", "a-2", "a-3", "a-unranked"]);
  });

  it("ranks compare numerically, not as strings", () => {
    const ts = [task("a-10", { abcde: "A", abcdeRank: 10 }), task("a-2", { abcde: "A", abcdeRank: 2 })];
    expect(ids(sorted(ts))).toEqual(["a-2", "a-10"]);
  });

  it("treats rank 0 as a real rank, ahead of unranked", () => {
    const ts = [task("none", { abcde: "A" }), task("zero", { abcde: "A", abcdeRank: 0 })];
    expect(ids(sorted(ts))).toEqual(["zero", "none"]);
  });

  it("only compares rank within the same letter", () => {
    const ts = [task("b-1", { abcde: "B", abcdeRank: 1 }), task("a-5", { abcde: "A", abcdeRank: 5 })];
    expect(ids(sorted(ts))).toEqual(["a-5", "b-1"]);
  });

  it("falls back to priority URGENT to LOW when letter and rank tie", () => {
    const ts = [
      task("low", { abcde: "B", priority: "LOW" }),
      task("urgent", { abcde: "B", priority: "URGENT" }),
      task("medium", { abcde: "B", priority: "MEDIUM" }),
      task("high", { abcde: "B", priority: "HIGH" }),
    ];
    expect(ids(sorted(ts))).toEqual(["urgent", "high", "medium", "low"]);
  });

  it("uses priority to order unlabelled tasks too", () => {
    const ts = [task("low", { priority: "LOW" }), task("urgent", { priority: "URGENT" })];
    expect(ids(sorted(ts))).toEqual(["urgent", "low"]);
  });

  it("falls back to board order last", () => {
    const ts = [
      task("third", { abcde: "C", abcdeRank: 1, priority: "HIGH", order: 3 }),
      task("first", { abcde: "C", abcdeRank: 1, priority: "HIGH", order: 1 }),
      task("second", { abcde: "C", abcdeRank: 1, priority: "HIGH", order: 2.5 }),
    ];
    expect(ids(sorted(ts))).toEqual(["first", "second", "third"]);
  });

  it("handles negative and fractional order values", () => {
    const ts = [task("pos", { order: 0.5 }), task("neg", { order: -2 })];
    expect(ids(sorted(ts))).toEqual(["neg", "pos"]);
  });

  it("returns 0 for a full tie and keeps input order (stable sort)", () => {
    const a = task("a", { abcde: "A", abcdeRank: 1, order: 1 });
    const b = task("b", { abcde: "A", abcdeRank: 1, order: 1 });
    expect(compareTasks(a, b)).toBe(0);
    expect(ids(sorted([a, b]))).toEqual(["a", "b"]);
    expect(ids(sorted([b, a]))).toEqual(["b", "a"]);
  });

  it("is antisymmetric and consistent across a mixed list", () => {
    const ts = [
      task("1", { abcde: "A", abcdeRank: 1 }),
      task("2", { abcde: "A" }),
      task("3", { abcde: "B", priority: "URGENT" }),
      task("4", { priority: "URGENT" }),
      task("5", { abcde: "E", abcdeRank: 2 }),
      task("6", { abcde: null, abcdeRank: 1 }),
    ];
    for (const x of ts) {
      for (const y of ts) {
        expect(Math.sign(compareTasks(x, y)) + Math.sign(compareTasks(y, x))).toBe(0);
      }
    }
  });

  it("ignores a rank on an unlabelled task relative to a labelled one", () => {
    const ts = [task("none", { abcdeRank: 1 }), task("e", { abcde: "E" })];
    expect(ids(sorted(ts))).toEqual(["e", "none"]);
  });

  it("returns an empty array unchanged and doesn't need a second element", () => {
    expect(sorted([])).toEqual([]);
    expect(ids(sorted([task("only")]))).toEqual(["only"]);
  });
});

describe("formatAbcde", () => {
  it("formats letter plus rank", () => {
    expect(formatAbcde({ abcde: "A", abcdeRank: 1 })).toBe("A-1");
    expect(formatAbcde({ abcde: "C", abcdeRank: 12 })).toBe("C-12");
  });

  it("formats a bare letter when unranked", () => {
    expect(formatAbcde({ abcde: "B", abcdeRank: null })).toBe("B");
    expect(formatAbcde({ abcde: "E" })).toBe("E");
    expect(formatAbcde({ abcde: "D", abcdeRank: undefined })).toBe("D");
  });

  it("returns an empty string with no letter, even if a rank is set", () => {
    expect(formatAbcde({ abcde: null, abcdeRank: null })).toBe("");
    expect(formatAbcde({ abcde: null, abcdeRank: 3 })).toBe("");
    expect(formatAbcde({})).toBe("");
  });
});

describe("openAtasks", () => {
  type O = { id: string; abcde?: Abcde | null; completedAt?: Date | string | null };

  it("keeps only A tasks that aren't completed", () => {
    const ts: O[] = [
      { id: "open-a", abcde: "A", completedAt: null },
      { id: "done-a", abcde: "A", completedAt: new Date("2026-10-23T09:00:00Z") },
      { id: "done-a-json", abcde: "A", completedAt: "2026-10-23T09:00:00.000Z" },
      { id: "open-b", abcde: "B", completedAt: null },
      { id: "unlabelled", abcde: null },
      { id: "open-a-undefined", abcde: "A" },
    ];
    expect(openAtasks(ts).map((t) => t.id)).toEqual(["open-a", "open-a-undefined"]);
  });

  it("returns an empty array for empty input", () => {
    expect(openAtasks([])).toEqual([]);
  });

  it("returns an empty array when there are no A tasks", () => {
    expect(openAtasks([{ id: "b", abcde: "B" }, { id: "x" }] as O[])).toEqual([]);
  });

  it("returns the original objects and doesn't mutate the input", () => {
    const a: O = { id: "a", abcde: "A" };
    const input: O[] = [a, { id: "c", abcde: "C" }];
    const out = openAtasks(input);
    expect(out[0]).toBe(a);
    expect(input).toHaveLength(2);
  });
});
