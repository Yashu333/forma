// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { clockSnapshot, parseClock, subscribeClock } from "./clock";

afterEach(() => vi.useRealTimers());

describe("clock", () => {
  it("snapshots 'YYYY-MM-DD|tz' and parses it back", () => {
    const snap = clockSnapshot();
    expect(snap).toMatch(/^\d{4}-\d{2}-\d{2}\|.+$/);
    const clock = parseClock(snap);
    expect(clock.key).toBe(snap);
    expect(`${clock.date}|${clock.tz}`).toBe(snap);
  });

  it("parseClock splits at the separator", () => {
    expect(parseClock("2026-10-24|Europe/Berlin")).toEqual({ date: "2026-10-24", tz: "Europe/Berlin", key: "2026-10-24|Europe/Berlin" });
  });

  it("notifies on focus, visibilitychange and every 60 s, and stops after unsubscribe", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const off = subscribeClock(onChange);
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onChange).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(60_000);
    expect(onChange).toHaveBeenCalledTimes(3);
    off();
    window.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(120_000);
    expect(onChange).toHaveBeenCalledTimes(3);
  });
});
