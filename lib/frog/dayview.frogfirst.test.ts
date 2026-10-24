// M7 edge cases for the frog-first lock: isFrogLockActive / isRowLocked.
// Pure logic, no clock: every date below is explicit.
import { describe, expect, it } from "vitest";
import { activeFrog, isFrogEaten, isFrogLockActive, isRowLocked } from "./dayview";

const DATE = "2026-10-24";
const BERLIN = "Europe/Berlin"; // CEST (UTC+2) until Sun 25 Oct 2026 03:00 local, then CET (UTC+1)
const open = { completedAt: null, archivedAt: null, group: { doneStatusId: "done" } };
type Args = Parameters<typeof isFrogLockActive>[0];
const lock = (over: Partial<Args> = {}) =>
  isFrogLockActive({ frogFirstMode: true, reviewed: false, frog: open, planDate: DATE, tz: BERLIN, ...over });

describe("isFrogLockActive: the one way to be locked, and every way out", () => {
  it("is exactly `true` / `false` (a real boolean, never a truthy value)", () => {
    expect(lock()).toBe(true);
    expect(lock({ frogFirstMode: false })).toBe(false);
    expect(lock({ frog: null })).toBe(false);
  });

  it("truth table over the four switches: only (on, open, live uneaten frog, Done column) locks", () => {
    const frogs = {
      none: null,
      undefined: undefined,
      uneaten: open,
      eaten: { ...open, completedAt: "2026-10-24T07:42:00Z" },
      eliminated: { ...open, archivedAt: "2026-10-24T07:00:00Z" },
      noDone: { ...open, group: { doneStatusId: null } },
    } as const;
    let locked = 0;
    for (const mode of [false, true])
      for (const reviewed of [false, true])
        for (const [name, frog] of Object.entries(frogs)) {
          const expected = mode && !reviewed && name === "uneaten";
          expect(lock({ frogFirstMode: mode, reviewed, frog }), `${name} mode=${mode} reviewed=${reviewed}`).toBe(expected);
          if (expected) locked++;
        }
    expect(locked).toBe(1);
  });

  it("tolerates a payload from a server that doesn't send the flag yet (undefined / null): off", () => {
    expect(lock({ frogFirstMode: undefined as unknown as boolean })).toBe(false);
    expect(lock({ frogFirstMode: null as unknown as boolean })).toBe(false);
  });

  it("an eliminated frog that is ALSO completed counts as eaten, not eliminated: no lock either way", () => {
    expect(lock({ frog: { ...open, archivedAt: "2026-10-24T09:00:00Z", completedAt: "2026-10-24T07:42:00Z" } })).toBe(false);
  });

  it("archived with an archivedAt but no completedAt is 'no frog' (activeFrog agrees)", () => {
    const f = { ...open, archivedAt: "2026-10-24T09:00:00Z" };
    expect(activeFrog(f)).toBeNull();
    expect(lock({ frog: f })).toBe(false);
  });

  describe("local-day boundaries and DST (Europe/Berlin, DST ends on the 25th)", () => {
    it.each([
      ["00:00:00 local on the plan date", "2026-10-23T22:00:00Z"],
      ["12:00 local", "2026-10-24T10:00:00Z"],
      ["23:59:59 local on the plan date (21:59:59Z)", "2026-10-24T21:59:59Z"],
      ["the day before (23:30 local on the 23rd)", "2026-10-23T21:30:00Z"],
    ])("eaten at %s: unlocked", (_l, completedAt) => {
      expect(isFrogEaten({ completedAt }, DATE, BERLIN)).toBe(true);
      expect(lock({ frog: { ...open, completedAt } })).toBe(false);
    });

    it.each([
      ["00:00:00 local on the 25th (22:00:00Z)", "2026-10-24T22:00:00Z"],
      ["00:30 local on the 25th, the night DST ends", "2026-10-24T22:30:00Z"],
      ["two days later", "2026-10-26T09:00:00Z"],
    ])("finished only at %s: not 'eaten' for this date, yet nothing left to eat, so no permanent lock", (_l, completedAt) => {
      expect(isFrogEaten({ completedAt }, DATE, BERLIN)).toBe(false);
      expect(lock({ frog: { ...open, completedAt } })).toBe(false);
    });

    it("the same instant is the 24th in New York and the 25th in Berlin: the zone decides 'eaten', never the lock", () => {
      const completedAt = "2026-10-25T01:30:00Z"; // 01:30Z = 03:30 CEST(25th) = 21:30 EDT (24th)
      expect(isFrogEaten({ completedAt }, DATE, "America/New_York")).toBe(true);
      expect(isFrogEaten({ completedAt }, DATE, BERLIN)).toBe(false);
      expect(lock({ tz: "America/New_York", frog: { ...open, completedAt } })).toBe(false);
      expect(lock({ tz: BERLIN, frog: { ...open, completedAt } })).toBe(false);
    });
  });

  it("an uneaten frog doesn't need a valid tz (nothing is converted), so a bad zone can't throw here", () => {
    expect(lock({ tz: "Not/AZone" })).toBe(true);
  });

  it("the plan date doesn't matter for an uneaten frog: a past or future day locks the same", () => {
    expect(lock({ planDate: "2020-01-01" })).toBe(true);
    expect(lock({ planDate: "2099-12-31" })).toBe(true);
  });

  it("an empty-string completedAt is treated as not completed (falsy), like null", () => {
    expect(lock({ frog: { ...open, completedAt: "" } })).toBe(true);
  });

  it("a frog with no group, or a group with an undefined doneStatusId, still locks (only an explicit null opts out)", () => {
    expect(lock({ frog: { completedAt: null } })).toBe(true);
    expect(lock({ frog: { completedAt: null, group: {} as { doneStatusId: string | null } } })).toBe(true);
  });

  it("an empty-string doneStatusId is a (weird) non-null id: locks", () => {
    expect(lock({ frog: { ...open, group: { doneStatusId: "" } } })).toBe(true);
  });

  it("doesn't mutate its input", () => {
    const frog = Object.freeze({ ...open, group: Object.freeze({ doneStatusId: "done" }) });
    const args = Object.freeze({ frogFirstMode: true, reviewed: false, frog, planDate: DATE, tz: BERLIN });
    expect(isFrogLockActive(args)).toBe(true);
    expect(frog).toEqual(open);
  });

  it("is deterministic: same input, same answer, no clock", () => {
    const answers = new Set(Array.from({ length: 5 }, () => lock()));
    expect(answers).toEqual(new Set([true]));
  });
});

describe("isRowLocked: truth table and shapes", () => {
  const task = (over: { id?: string; completedAt?: string | Date | null } = {}) => ({ id: "t", completedAt: null, ...over });

  it("lockActive × is-the-frog × done: only (on, other, open) locks", () => {
    for (const lockActive of [false, true])
      for (const isFrog of [false, true])
        for (const done of [false, true]) {
          const got = isRowLocked({
            lockActive,
            task: task({ id: isFrog ? "f" : "t", completedAt: done ? "2026-10-24T07:00:00Z" : null }),
            frogId: "f",
          });
          expect(got, `lock=${lockActive} frog=${isFrog} done=${done}`).toBe(lockActive && !isFrog && !done);
        }
  });

  it("a Date instance as completedAt counts as done", () => {
    expect(isRowLocked({ lockActive: true, task: task({ completedAt: new Date("2026-10-24T07:00:00Z") }), frogId: "f" })).toBe(false);
  });

  it("an omitted completedAt counts as open", () => {
    expect(isRowLocked({ lockActive: true, task: { id: "t" }, frogId: "f" })).toBe(true);
  });

  it("frogId undefined or null: no row is the frog, so every open row locks", () => {
    expect(isRowLocked({ lockActive: true, task: task(), frogId: undefined })).toBe(true);
    expect(isRowLocked({ lockActive: true, task: task(), frogId: null })).toBe(true);
  });

  it("an empty frogId doesn't match a row with an empty id by accident only when ids really are equal", () => {
    expect(isRowLocked({ lockActive: true, task: task({ id: "" }), frogId: "" })).toBe(false);
    expect(isRowLocked({ lockActive: true, task: task({ id: "a" }), frogId: "A" })).toBe(true); // ids are case-sensitive
  });

  it("returns an exact boolean", () => {
    expect(isRowLocked({ lockActive: true, task: task(), frogId: "f" })).toBe(true);
    expect(isRowLocked({ lockActive: false, task: task(), frogId: "f" })).toBe(false);
  });

  it("with a list: the locked set is every open row but the frog's", () => {
    const rows = [task({ id: "f" }), task({ id: "a" }), task({ id: "b", completedAt: "2026-10-24T05:00:00Z" }), task({ id: "c" })];
    const lockedIds = rows.filter((r) => isRowLocked({ lockActive: true, task: r, frogId: "f" })).map((r) => r.id);
    expect(lockedIds).toEqual(["a", "c"]);
    expect(rows.filter((r) => isRowLocked({ lockActive: false, task: r, frogId: "f" }))).toEqual([]);
  });

  it("eating the frog unlocks all rows: lock goes inactive, every row is free", () => {
    const rows = [task({ id: "a" }), task({ id: "c" })];
    const frog = { ...open, completedAt: "2026-10-24T07:42:00Z" };
    const active = isFrogLockActive({ frogFirstMode: true, reviewed: false, frog, planDate: DATE, tz: BERLIN });
    expect(rows.some((r) => isRowLocked({ lockActive: active, task: r, frogId: "f" }))).toBe(false);
  });
});
