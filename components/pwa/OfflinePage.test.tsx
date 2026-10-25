// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import OfflinePage, { metadata } from "@/app/offline/page";
import { restoreBrowserStubs, stubOnLine, stubReload } from "../../tests/ui/pwa-stubs";

// app/offline/page.tsx (docs/mobile-pwa/SPEC.md, P2): static, no auth, no data.

afterEach(() => restoreBrowserStubs());

describe("Offline page", () => {
  it("renders the mark, the copy and a Retry link without fetching anything", () => {
    const { container } = render(<OfflinePage />);
    expect(screen.getByRole("heading", { level: 1, name: "You're offline" })).toBeInTheDocument();
    expect(screen.getByText("Forma will reload when you're back online.")).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull(); // the F mark
    expect(fetch).not.toHaveBeenCalled();
  });

  it("Retry is a real link to the same URL, so it works without JS", () => {
    render(<OfflinePage />);
    // (dom-testing-library's role query skips href="", which browsers treat
    // as a normal link, so look it up by text.)
    const retry = screen.getByText("Retry");
    expect(retry.tagName).toBe("A");
    expect(retry.getAttribute("href")).toBe("");
    // The server HTML (what the worker precaches) keeps the empty href too.
    expect(renderToStaticMarkup(<OfflinePage />)).toMatch(/<a href=""[^>]*>Retry<\/a>/);
  });

  it("reloads by itself 1 s after coming back online", () => {
    vi.useFakeTimers();
    const reload = stubReload();
    const net = stubOnLine(false);
    render(<OfflinePage />);
    net.go(true);
    vi.advanceTimersByTime(1000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("has its own title and is not indexed", () => {
    expect(metadata.title).toBe("Offline · Forma");
    expect(metadata.robots).toEqual({ index: false });
  });
});
