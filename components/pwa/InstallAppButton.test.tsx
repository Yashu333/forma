// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  restoreBrowserStubs,
  stubMatchMedia,
  stubNavigatorStandalone,
  stubUserAgent,
  UA,
} from "../../tests/ui/pwa-stubs";

// docs/mobile-pwa/SPEC.md, decision 7: a quiet "Install app" row, shown only
// when the browser offered `beforeinstallprompt`, or on iOS Safari when not
// installed (then a how-to dialog). Never in standalone mode.
//
// The deferred prompt lives in module state in lib/pwa/install-prompt (it
// listens from module load), so every test imports fresh copies of both.

const STANDALONE = "(display-mode: standalone)";

type Choice = { outcome: "accepted" | "dismissed"; platform: string };

/** A Chromium-style `beforeinstallprompt` event. */
function installPromptEvent(choice: Choice = { outcome: "accepted", platform: "web" }) {
  const e = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
    prompt: ReturnType<typeof vi.fn>;
    userChoice: Promise<Choice>;
  };
  e.prompt = vi.fn(async () => {});
  e.userChoice = Promise.resolve(choice);
  return e;
}

async function freshComponent() {
  vi.resetModules();
  return (await import("./InstallAppButton")).default;
}

let media: ReturnType<typeof stubMatchMedia>;

beforeEach(() => {
  media = stubMatchMedia();
  stubUserAgent(UA.desktopChrome);
});

afterEach(() => restoreBrowserStubs());

const row = () => screen.queryByRole("button", { name: "Install app" });

describe("InstallAppButton: Chromium install prompt", () => {
  it("renders nothing until the browser offers installation", async () => {
    const InstallAppButton = await freshComponent();
    const { container } = render(<InstallAppButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it("appears when beforeinstallprompt fires, and keeps Chrome's own infobar away", async () => {
    const InstallAppButton = await freshComponent();
    render(<InstallAppButton />);
    const e = installPromptEvent();
    act(() => {
      window.dispatchEvent(e);
    });
    expect(row()).toBeInTheDocument();
    expect(row()).not.toHaveAttribute("aria-haspopup");
    expect(e.defaultPrevented).toBe(true);
  });

  it("catches an event on a page without the sidebar (the root layout loads the capture)", async () => {
    vi.resetModules();
    // ServiceWorkerRegister, in the root layout, imports this on every page.
    await import("@/lib/pwa/install-prompt");
    const e = installPromptEvent();
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    // Later the sidebar chunk loads (same module registry, same capture).
    const InstallAppButton = (await import("./InstallAppButton")).default;
    render(<InstallAppButton />);
    expect(row()).toBeInTheDocument();
  });

  it("remembers an event that fired before the sidebar mounted", async () => {
    const InstallAppButton = await freshComponent();
    window.dispatchEvent(installPromptEvent());
    render(<InstallAppButton />);
    expect(row()).toBeInTheDocument();
  });

  it("shows the browser's prompt on click, then hides the spent row", async () => {
    const InstallAppButton = await freshComponent();
    render(<InstallAppButton />);
    const e = installPromptEvent({ outcome: "accepted", platform: "web" });
    act(() => {
      window.dispatchEvent(e);
    });
    await userEvent.setup().click(row()!);
    expect(e.prompt).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(row()).not.toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("after a dismissal, shows again when the browser offers a fresh event", async () => {
    const InstallAppButton = await freshComponent();
    render(<InstallAppButton />);
    const first = installPromptEvent({ outcome: "dismissed", platform: "web" });
    act(() => {
      window.dispatchEvent(first);
    });
    await userEvent.setup().click(row()!);
    await waitFor(() => expect(row()).not.toBeInTheDocument());

    const second = installPromptEvent();
    act(() => {
      window.dispatchEvent(second);
    });
    expect(row()).toBeInTheDocument();
    await userEvent.setup().click(row()!);
    expect(second.prompt).toHaveBeenCalledTimes(1);
    expect(first.prompt).toHaveBeenCalledTimes(1);
  });

  it("hides the row even when prompt() throws", async () => {
    const InstallAppButton = await freshComponent();
    render(<InstallAppButton />);
    const e = installPromptEvent();
    e.prompt.mockRejectedValue(new DOMException("already shown", "InvalidStateError"));
    act(() => {
      window.dispatchEvent(e);
    });
    await userEvent.setup().click(row()!);
    await waitFor(() => expect(row()).not.toBeInTheDocument());
  });

  it("disappears after appinstalled and stays gone", async () => {
    const InstallAppButton = await freshComponent();
    render(<InstallAppButton />);
    act(() => {
      window.dispatchEvent(installPromptEvent());
    });
    expect(row()).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    expect(row()).not.toBeInTheDocument();
    // a later offer in the same page life does not bring it back
    act(() => {
      window.dispatchEvent(installPromptEvent());
    });
    expect(row()).not.toBeInTheDocument();
  });

  it("renders nothing in the server render, even with an offer pending", async () => {
    const InstallAppButton = await freshComponent();
    window.dispatchEvent(installPromptEvent());
    expect(renderToString(<InstallAppButton />)).toBe("");
  });

  it("does not crash without matchMedia", async () => {
    restoreBrowserStubs();
    stubUserAgent(UA.androidChrome);
    expect(typeof window.matchMedia).toBe("undefined");
    const InstallAppButton = await freshComponent();
    render(<InstallAppButton />);
    act(() => {
      window.dispatchEvent(installPromptEvent());
    });
    expect(row()).toBeInTheDocument();
  });
});

describe("InstallAppButton: standalone (already installed)", () => {
  it("never shows under display-mode: standalone, even with an offer", async () => {
    restoreBrowserStubs();
    stubMatchMedia([STANDALONE]);
    stubUserAgent(UA.androidChrome);
    const InstallAppButton = await freshComponent();
    const { container } = render(<InstallAppButton />);
    act(() => {
      window.dispatchEvent(installPromptEvent());
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("hides when the page switches into standalone", async () => {
    const InstallAppButton = await freshComponent();
    render(<InstallAppButton />);
    act(() => {
      window.dispatchEvent(installPromptEvent());
    });
    expect(row()).toBeInTheDocument();
    act(() => media.list(STANDALONE).set(true));
    expect(row()).not.toBeInTheDocument();
  });

  it("never shows on an iPhone launched from the home screen (navigator.standalone)", async () => {
    stubUserAgent(UA.iphoneSafari, 5);
    stubNavigatorStandalone(true);
    const InstallAppButton = await freshComponent();
    const { container } = render(<InstallAppButton />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("InstallAppButton: iOS Safari", () => {
  async function renderIos(ua = UA.iphoneSafari, touch = 5) {
    stubUserAgent(ua, touch);
    const InstallAppButton = await freshComponent();
    render(
      <>
        <button type="button">Elsewhere</button>
        <InstallAppButton />
      </>,
    );
  }

  it("shows the row on iPhone Safari, as a dialog opener", async () => {
    await renderIos();
    expect(row()).toBeInTheDocument();
    expect(row()).toHaveAttribute("aria-haspopup", "dialog");
  });

  it("shows the row on iPadOS Safari (Mac user agent with touch)", async () => {
    await renderIos(UA.ipadSafari, 5);
    expect(row()).toBeInTheDocument();
  });

  it("does not show on desktop Safari (Mac user agent, no touch)", async () => {
    await renderIos(UA.ipadSafari, 0);
    expect(row()).not.toBeInTheDocument();
  });

  it("does not show in Chrome on iPhone (it cannot add to the home screen the same way)", async () => {
    await renderIos(UA.iphoneChrome);
    expect(row()).not.toBeInTheDocument();
  });

  it("opens the how-to dialog: Share, then Add to Home Screen, focus on Done", async () => {
    await renderIos();
    await userEvent.setup().click(row()!);
    const dialog = screen.getByRole("dialog", { name: "Install Forma" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription(/home screen/i);
    const steps = within(dialog).getAllByRole("listitem").map((li) => li.textContent);
    expect(steps).toEqual(["Tap Share in Safari's toolbar.", "Choose Add to Home Screen."]);
    expect(within(dialog).getByRole("button", { name: "Done" })).toHaveFocus();
  });

  it("renders the dialog into document.body (outside the transformed drawer)", async () => {
    await renderIos();
    await userEvent.setup().click(row()!);
    const dialog = screen.getByRole("dialog", { name: "Install Forma" });
    expect(dialog.parentElement?.parentElement).toBe(document.body);
  });

  it("Escape closes it and focus returns to the Install app row", async () => {
    await renderIos();
    const user = userEvent.setup();
    await user.click(row()!);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(row()).toHaveFocus();
  });

  it("Done and Close both close it and return focus", async () => {
    await renderIos();
    const user = userEvent.setup();
    await user.click(row()!);
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(row()).toHaveFocus();

    await user.click(row()!);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(row()).toHaveFocus();
  });

  it("a tap on the backdrop closes it; a tap inside does not", async () => {
    await renderIos();
    const user = userEvent.setup();
    await user.click(row()!);
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByText("Install Forma"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(dialog.parentElement!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps Tab inside the dialog", async () => {
    await renderIos();
    const user = userEvent.setup();
    await user.click(row()!);
    const dialog = screen.getByRole("dialog");
    const close = within(dialog).getByRole("button", { name: "Close" });
    const done = within(dialog).getByRole("button", { name: "Done" });
    expect(done).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(done).toHaveFocus();
  });
});
