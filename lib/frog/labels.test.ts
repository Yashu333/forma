import { describe, expect, it } from "vitest";
import type { Abcde } from "@/types";
import { applyLabels, inLetter, labelCode, tapLetter, type Labelled } from "./labels";

const t = (id: string, abcde: Abcde | null = null, abcdeRank: number | null = null): Labelled => ({ id, abcde, abcdeRank });
const codes = (tasks: Labelled[]) => Object.fromEntries(tasks.map((x) => [x.id, labelCode(x)]));
// Applies a tap and returns the resulting labels, the way the screen does.
const tap = (tasks: Labelled[], id: string, l: Abcde) => applyLabels(tasks, tapLetter(tasks, id, l));

describe("labelCode", () => {
  it("A1 / A / empty", () => {
    expect(labelCode(t("x", "A", 1))).toBe("A1");
    expect(labelCode(t("x", "B", 12))).toBe("B12");
    expect(labelCode(t("x", "C"))).toBe("C");
    expect(labelCode(t("x"))).toBe("");
  });
});

describe("inLetter", () => {
  it("ranked by rank, then unranked in list order; other letters left out", () => {
    const list = [t("u1", "A"), t("a2", "A", 2), t("b1", "B", 1), t("a1", "A", 1), t("u2", "A")];
    expect(inLetter(list, "A").map((x) => x.id)).toEqual(["a1", "a2", "u1", "u2"]);
    expect(inLetter(list, "E")).toEqual([]);
  });
});

describe("tapLetter", () => {
  it("numbers letters in tap order: A1, A2, then B1", () => {
    let list = [t("x"), t("y"), t("z")];
    list = tap(list, "y", "A");
    list = tap(list, "x", "A");
    list = tap(list, "z", "B");
    expect(codes(list)).toEqual({ y: "A1", x: "A2", z: "B1" });
  });

  it("tapping the same letter clears it and closes the gap", () => {
    let list = [t("a", "A", 1), t("b", "A", 2), t("c", "A", 3)];
    list = tap(list, "a", "A");
    expect(codes(list)).toEqual({ a: "", b: "A1", c: "A2" });
  });

  it("moving to another letter goes to its end and renumbers the old letter", () => {
    let list = [t("a", "A", 1), t("b", "A", 2), t("c", "A", 3), t("d", "B", 1)];
    list = tap(list, "b", "B");
    expect(codes(list)).toEqual({ a: "A1", c: "A2", d: "B1", b: "B2" });
  });

  it("returns only the tasks that change", () => {
    const list = [t("a", "A", 1), t("b", "A", 2), t("c")];
    expect(tapLetter(list, "c", "A")).toEqual([{ id: "c", abcde: "A", abcdeRank: 3 }]);
  });

  it("fixes gaps, duplicates and unranked tasks in the letters it touches", () => {
    const list = [t("a", "A", 4), t("b", "A", 4), t("c", "A"), t("n")];
    const changes = tapLetter(list, "n", "A");
    expect(codes(applyLabels(list, changes))).toEqual({ a: "A1", b: "A2", c: "A3", n: "A4" });
  });

  it("leaves letters it doesn't touch alone", () => {
    const list = [t("b", "B", 7), t("x")];
    expect(tapLetter(list, "x", "A")).toEqual([{ id: "x", abcde: "A", abcdeRank: 1 }]);
  });

  it("an unknown id changes nothing", () => {
    expect(tapLetter([t("a", "A", 1)], "nope", "B")).toEqual([]);
  });
});

describe("applyLabels", () => {
  it("keeps other fields and the list order; never mutates the input", () => {
    const list = [{ ...t("a"), title: "A" }, { ...t("b"), title: "B" }];
    const out = applyLabels(list, [{ id: "b", abcde: "C", abcdeRank: 1 }]);
    expect(out).toEqual([{ ...t("a"), title: "A" }, { id: "b", abcde: "C", abcdeRank: 1, title: "B" }]);
    expect(list[1].abcde).toBeNull();
  });
});
