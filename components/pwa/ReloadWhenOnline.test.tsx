// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReloadWhenOnline, { RELOAD_DELAY_MS } from "./ReloadWhenOnline";
import { restoreBrowserStubs, stubOnLine, stubReload } from "../../tests/ui/pwa-stubs";

// The offline page reloads itself 1 s after the browser is back online, if it
// still is then.

let reload: ReturnType<typeof stubReload>;

beforeEach(() => {
  vi.useFakeTimers();
  reload = stubReload();
});

afterEach(() => restoreBrowserStubs());

describe("ReloadWhenOnline", () => {
  it("renders nothing and does not reload on its own", () => {
    stubOnLine(true);
    const { container } = render(<ReloadWhenOnline />);
    expect(container).toBeEmptyDOMElement();
    vi.advanceTimersByTime(60_000);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads 1 s after the online event", () => {
    const net = stubOnLine(false);
    render(<ReloadWhenOnline />);
    net.go(true);
    vi.advanceTimersByTime(RELOAD_DELAY_MS - 1);
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(RELOAD_DELAY_MS).toBe(1000);
  });

  it("does not reload when the connection dropped again within that second", () => {
    const net = stubOnLine(false);
    render(<ReloadWhenOnline />);
    net.go(true);
    vi.advanceTimersByTime(500);
    net.go(false);
    vi.advanceTimersByTime(5000);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads once for a flapping connection, 1 s after the last online event", () => {
    const net = stubOnLine(false);
    render(<ReloadWhenOnline />);
    net.go(true);
    vi.advanceTimersByTime(600);
    net.go(false);
    net.go(true);
    vi.advanceTimersByTime(600);
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(reload).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload after unmount (the user already navigated away)", () => {
    const net = stubOnLine(false);
    const { unmount } = render(<ReloadWhenOnline />);
    net.go(true);
    vi.advanceTimersByTime(500);
    unmount();
    vi.advanceTimersByTime(5000);
    net.go(true);
    vi.advanceTimersByTime(5000);
    expect(reload).not.toHaveBeenCalled();
  });
});
