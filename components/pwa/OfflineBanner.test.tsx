// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import OfflineBanner from "./OfflineBanner";
import { restoreBrowserStubs, stubOnLine } from "../../tests/ui/pwa-stubs";

// docs/mobile-pwa/SPEC.md, P2: a thin bar while navigator.onLine is false.

const TEXT = "You're offline. Changes won't save until you reconnect.";

afterEach(() => restoreBrowserStubs());

describe("OfflineBanner", () => {
  it("renders nothing while online", () => {
    stubOnLine(true);
    const { container } = render(<OfflineBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the offline message while offline", () => {
    stubOnLine(false);
    render(<OfflineBanner />);
    const bar = screen.getByRole("status");
    expect(bar).toHaveTextContent(TEXT);
  });

  it("appears on the offline event and goes away on the online event", () => {
    const net = stubOnLine(true);
    render(<OfflineBanner />);
    expect(screen.queryByText(TEXT)).toBeNull();

    act(() => net.go(false));
    expect(screen.getByText(TEXT)).toBeInTheDocument();

    act(() => net.go(true));
    expect(screen.queryByText(TEXT)).toBeNull();

    act(() => net.go(false));
    expect(screen.getByText(TEXT)).toBeInTheDocument();
  });

  it("stops listening after unmount", () => {
    const net = stubOnLine(true);
    const { unmount } = render(<OfflineBanner />);
    unmount();
    expect(() => net.go(false)).not.toThrow();
  });

  it("assumes online in the server render", () => {
    stubOnLine(false);
    expect(renderToString(<OfflineBanner />)).toBe("");
  });
});
