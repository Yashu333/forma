// @vitest-environment jsdom
// lib/pwa/use-standalone.ts: is the page running as the installed app? (P6)
import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STANDALONE_QUERY, newTabProps, useStandalone } from "@/lib/pwa/use-standalone";
import { restoreBrowserStubs, stubMatchMedia, stubNavigatorStandalone } from "../../tests/ui/pwa-stubs";

function Probe() {
  return <span data-testid="probe">{useStandalone() ? "installed" : "browser"}</span>;
}
const probe = () => screen.getByTestId("probe");

afterEach(() => restoreBrowserStubs());

describe("useStandalone", () => {
  it("is false in a browser tab, and where matchMedia doesn't exist (jsdom)", () => {
    expect(typeof window.matchMedia).toBe("undefined");
    render(<Probe />);
    expect(probe()).toHaveTextContent("browser");
  });

  it("is true under display-mode: standalone", () => {
    const mm = stubMatchMedia([STANDALONE_QUERY]);
    render(<Probe />);
    expect(probe()).toHaveTextContent("installed");
    expect(mm.matchMedia).toHaveBeenCalledWith("(display-mode: standalone)");
  });

  it("is true on an iPhone launched from the home screen (navigator.standalone)", () => {
    stubMatchMedia([]);
    stubNavigatorStandalone(true);
    render(<Probe />);
    expect(probe()).toHaveTextContent("installed");
  });

  it("server-renders as false even when the app is installed", () => {
    stubMatchMedia([STANDALONE_QUERY]);
    expect(renderToString(<Probe />)).toContain("browser");
  });

  it("follows display-mode changes both ways", () => {
    const mm = stubMatchMedia([]);
    render(<Probe />);
    expect(probe()).toHaveTextContent("browser");
    act(() => mm.list(STANDALONE_QUERY).set(true));
    expect(probe()).toHaveTextContent("installed");
    act(() => mm.list(STANDALONE_QUERY).set(false));
    expect(probe()).toHaveTextContent("browser");
  });

  it("removes its change listener on unmount", () => {
    const mm = stubMatchMedia([]);
    const list = mm.list(STANDALONE_QUERY);
    const added = vi.spyOn(list, "addEventListener");
    const removed = vi.spyOn(list, "removeEventListener");
    const { unmount } = render(<Probe />);
    expect(added).toHaveBeenCalledWith("change", expect.any(Function));
    unmount();
    expect(removed).toHaveBeenCalledWith("change", added.mock.calls[0][1]);
  });
});

describe("newTabProps", () => {
  it("opens a new tab in the browser, with rel only when given", () => {
    expect(newTabProps(false, "noopener")).toEqual({ target: "_blank", rel: "noopener" });
    expect(newTabProps(false)).toEqual({ target: "_blank" });
  });

  it("stays in the installed app: no target, no rel", () => {
    expect(newTabProps(true, "noopener")).toEqual({});
    expect(newTabProps(true)).toEqual({});
  });
});
