// @vitest-environment jsdom
// lib/use-media-query.ts: the switch between phone and desktop markup (P5).
import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { useMediaQuery } from "@/lib/use-media-query";
import { restoreBrowserStubs, stubMatchMedia } from "../../tests/ui/pwa-stubs";

const PHONE = "(width < 40rem)";

function Probe({ query = PHONE }: { query?: string }) {
  return <span data-testid="probe">{useMediaQuery(query) ? "match" : "no match"}</span>;
}

afterEach(() => restoreBrowserStubs());

describe("useMediaQuery", () => {
  it("is false where matchMedia doesn't exist (jsdom), so the desktop markup is the default", () => {
    expect(typeof window.matchMedia).toBe("undefined");
    render(<Probe />);
    expect(screen.getByTestId("probe")).toHaveTextContent("no match");
  });

  it("server-renders as false even when the query would match in the browser", () => {
    stubMatchMedia([PHONE]);
    expect(renderToString(<Probe />)).toContain("no match");
  });

  it("is true when the query matches on mount", () => {
    const mm = stubMatchMedia([PHONE]);
    render(<Probe />);
    expect(screen.getByTestId("probe")).toHaveTextContent(/^match$/);
    expect(mm.matchMedia).toHaveBeenCalledWith(PHONE);
  });

  it("follows change events both ways", () => {
    const mm = stubMatchMedia([]);
    render(<Probe />);
    expect(screen.getByTestId("probe")).toHaveTextContent("no match");
    act(() => mm.list(PHONE).set(true));
    expect(screen.getByTestId("probe")).toHaveTextContent(/^match$/);
    act(() => mm.list(PHONE).set(false));
    expect(screen.getByTestId("probe")).toHaveTextContent("no match");
  });

  it("removes its change listener on unmount", () => {
    const mm = stubMatchMedia([]);
    const list = mm.list(PHONE);
    const added: unknown[] = [];
    const removed: unknown[] = [];
    const add = list.addEventListener.bind(list);
    const remove = list.removeEventListener.bind(list);
    list.addEventListener = ((type: string, fn: EventListener) => { added.push(fn); add(type, fn); }) as typeof list.addEventListener;
    list.removeEventListener = ((type: string, fn: EventListener) => { removed.push(fn); remove(type, fn); }) as typeof list.removeEventListener;

    const { unmount } = render(<Probe />);
    expect(added.length).toBeGreaterThan(0);
    unmount();
    expect(removed).toEqual(added);
    // A change after unmount reaches no one (and doesn't throw).
    expect(() => list.set(true)).not.toThrow();
  });

  it("resubscribes when the query changes", () => {
    const mm = stubMatchMedia(["(width < 64rem)"]);
    const { rerender } = render(<Probe query={PHONE} />);
    expect(screen.getByTestId("probe")).toHaveTextContent("no match");
    rerender(<Probe query="(width < 64rem)" />);
    expect(screen.getByTestId("probe")).toHaveTextContent(/^match$/);
    act(() => mm.list("(width < 64rem)").set(false));
    expect(screen.getByTestId("probe")).toHaveTextContent("no match");
  });
});
