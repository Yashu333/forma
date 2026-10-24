import { describe, expect, it } from "vitest";
import { dailyFocus, formatDuration } from "./stats";

describe("formatDuration", () => {
  it.each([
    [0, "0m"],
    [-5, "0m"],
    [30, "30s"],
    [59, "59s"],
    [60, "1m"],
    [45 * 60, "45m"],
    [3599, "1h"], // 59.98 minutes rounds up into the hour
    [3600, "1h"],
    [3600 + 60, "1h 1m"],
    [2 * 3600 + 25 * 60, "2h 25m"],
    [10 * 3600, "10h"],
  ])("%i seconds -> %s", (sec, text) => expect(formatDuration(sec)).toBe(text));
});

describe("dailyFocus", () => {
  it("returns one entry per day, oldest first, ending today", () => {
    const out = dailyFocus([], "UTC", "2026-10-24", 3);
    expect(out).toEqual([{ date: "2026-10-22", sec: 0 }, { date: "2026-10-23", sec: 0 }, { date: "2026-10-24", sec: 0 }]);
  });

  it("adds sessions to the day they started", () => {
    const out = dailyFocus(
      [
        { startedAt: "2026-10-24T09:00:00Z", durationSec: 1500 },
        { startedAt: "2026-10-24T10:00:00Z", durationSec: 600 },
        { startedAt: new Date("2026-10-23T12:00:00Z"), durationSec: 300 },
      ],
      "UTC", "2026-10-24", 3,
    );
    expect(out.map((d) => d.sec)).toEqual([0, 300, 2100]);
  });

  it("buckets by the user's local day, not UTC", () => {
    // 03:30Z on the 25th is 23:30 on the 24th in New York
    const out = dailyFocus([{ startedAt: "2026-10-25T03:30:00Z", durationSec: 1500 }], "America/New_York", "2026-10-24", 2);
    expect(out).toEqual([{ date: "2026-10-23", sec: 0 }, { date: "2026-10-24", sec: 1500 }]);
  });

  it("ignores sessions outside the window", () => {
    const out = dailyFocus([{ startedAt: "2026-09-01T09:00:00Z", durationSec: 1500 }, { startedAt: "2026-10-30T09:00:00Z", durationSec: 1500 }], "UTC", "2026-10-24", 7);
    expect(out.every((d) => d.sec === 0)).toBe(true);
  });
});
