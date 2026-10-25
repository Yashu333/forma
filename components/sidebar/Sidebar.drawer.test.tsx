// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Sidebar from "./Sidebar";
import BottomTabBar from "@/components/mobile/BottomTabBar";
import { closeSidebar, isSidebarOpen, openSidebar } from "@/lib/sidebar-drawer";
import { OPEN_PALETTE_EVENT } from "@/components/command/CommandPalette";
import { mockApi } from "../../tests/ui/fixtures";
import { restoreBrowserStubs, stubMatchMedia, stubUserAgent, UA } from "../../tests/ui/pwa-stubs";

// docs/mobile-pwa/SPEC.md, P3: under lg the sidebar is a drawer that opens
// only from the tab bar's More (the floating hamburger is gone). It closes on
// Escape, on a backdrop tap and on navigation. The install row sits in its footer.

const nav = vi.hoisted(() => ({ pathname: "/dashboard" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signOut: vi.fn() } }),
}));

beforeEach(() => {
  nav.pathname = "/dashboard";
  mockApi({ "GET /api/groups": [] });
  stubMatchMedia();
  stubUserAgent(UA.desktopChrome);
});

afterEach(() => {
  act(() => closeSidebar());
  restoreBrowserStubs();
});

function Shell() {
  return (
    <>
      <Sidebar userId="u1" userEmail="me@example.com" />
      <BottomTabBar />
    </>
  );
}

async function renderShell() {
  const utils = render(<Shell />);
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  return utils;
}

const drawer = () => document.getElementById("app-sidebar")!;
const backdrop = () => document.querySelector<HTMLElement>('div[class*="bg-background/70"]');
const more = () => within(screen.getByRole("navigation", { name: "Primary" })).getByRole("button", { name: "More" });

function expectOpen(open: boolean) {
  expect(isSidebarOpen()).toBe(open);
  expect(drawer()).toHaveClass(open ? "max-lg:translate-x-0" : "max-lg:-translate-x-full");
  expect(drawer()).not.toHaveClass(open ? "max-lg:-translate-x-full" : "max-lg:translate-x-0");
  if (open) expect(backdrop()).toBeInTheDocument();
  else expect(backdrop()).toBeNull();
  expect(more()).toHaveAttribute("aria-expanded", String(open));
}

describe("Sidebar drawer", () => {
  it("starts closed, with no hamburger button any more", async () => {
    await renderShell();
    expectOpen(false);
    expect(screen.queryByRole("button", { name: "Toggle sidebar" })).not.toBeInTheDocument();
    expect(drawer().tagName).toBe("ASIDE");
    // desktop: static and always shown
    expect(drawer()).toHaveClass("lg:static", "lg:translate-x-0");
  });

  it("is the element More controls", async () => {
    await renderShell();
    expect(more()).toHaveAttribute("aria-controls", drawer().id);
  });

  it("opens from the store", async () => {
    await renderShell();
    act(() => openSidebar());
    expectOpen(true);
  });

  it("opens from More", async () => {
    await renderShell();
    await userEvent.setup().click(more());
    expectOpen(true);
  });

  it("closes on Escape", async () => {
    await renderShell();
    const user = userEvent.setup();
    await user.click(more());
    expectOpen(true);
    await user.keyboard("{Escape}");
    expectOpen(false);
  });

  it("closes on a backdrop tap", async () => {
    await renderShell();
    const user = userEvent.setup();
    await user.click(more());
    await user.click(backdrop()!);
    expectOpen(false);
  });

  it("closes on navigation", async () => {
    const { rerender } = await renderShell();
    act(() => openSidebar());
    expectOpen(true);
    nav.pathname = "/habits";
    rerender(<Shell />);
    expectOpen(false);
  });

  it("stays open while the path doesn't change", async () => {
    const { rerender } = await renderShell();
    act(() => openSidebar());
    rerender(<Shell />);
    expectOpen(true);
  });

  it("keeps the notch and home indicator clear under lg", async () => {
    await renderShell();
    expect(drawer()).toHaveClass("max-lg:pt-safe", "max-lg:pb-safe");
  });
});

describe("Sidebar drawer: focus, visibility and Escape", () => {
  it("is invisible under lg while closed (out of the tab order), visible once open; desktop untouched", async () => {
    await renderShell();
    expect(drawer()).toHaveClass("max-lg:invisible");
    expect(drawer().className).not.toMatch(/(^|\s)(lg:)?invisible(\s|$)/);
    act(() => openSidebar());
    expect(drawer()).not.toHaveClass("max-lg:invisible");
  });

  it("moves focus into the drawer when More opens it", async () => {
    await renderShell();
    await userEvent.setup().click(more());
    expect(drawer().contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(drawer().querySelector("a[href]"));
  });

  it("gives focus back to More when Escape closes it", async () => {
    await renderShell();
    const user = userEvent.setup();
    await user.click(more());
    await user.keyboard("{Escape}");
    expectOpen(false);
    expect(more()).toHaveFocus();
  });

  it("gives focus back to More when a backdrop tap closes it", async () => {
    await renderShell();
    const user = userEvent.setup();
    await user.click(more());
    await user.click(backdrop()!);
    expectOpen(false);
    expect(more()).toHaveFocus();
  });

  it("Escape in the new-project field closes the field, not the drawer", async () => {
    await renderShell();
    const user = userEvent.setup();
    await user.click(more());
    await user.click(within(drawer()).getAllByRole("button", { name: "New project" })[0]);
    expect(within(drawer()).getByRole("textbox", { name: "Project name" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(within(drawer()).queryByRole("textbox", { name: "Project name" })).not.toBeInTheDocument();
    expectOpen(true);
  });

  it("Escape in the display-name field cancels the edit, not the drawer", async () => {
    await renderShell();
    const user = userEvent.setup();
    await user.click(more());
    await user.click(within(drawer()).getByRole("button", { name: "Edit display name" }));
    await user.keyboard("{Escape}");
    expect(within(drawer()).queryByRole("textbox", { name: "Display name" })).not.toBeInTheDocument();
    expectOpen(true);
  });

  it("Escape in the iOS install dialog closes the dialog, not the drawer", async () => {
    stubUserAgent(UA.iphoneSafari, 5);
    await renderShell();
    const user = userEvent.setup();
    await user.click(more());
    await user.click(within(drawer()).getByRole("button", { name: "Install app" }));
    expect(screen.getByRole("dialog", { name: "Install Forma" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Install Forma" })).not.toBeInTheDocument();
    expectOpen(true);
  });

  it.each([
    [/^Search/, "search"],
    ["Add task", "add"],
  ])("%s in the drawer closes it and opens the palette (%s)", async (name, mode) => {
    const seen: unknown[] = [];
    const onOpen = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    try {
      await renderShell();
      const user = userEvent.setup();
      await user.click(more());
      await user.click(within(drawer()).getByRole("button", { name }));
      expectOpen(false);
      expect(seen).toEqual([{ mode, text: "" }]);
      // the palette's opener is More, so focus lands somewhere visible when it closes
      expect(more()).toHaveFocus();
    } finally {
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    }
  });
});

describe("Sidebar footer: install row", () => {
  it("has no install row when the browser offers nothing", async () => {
    await renderShell();
    expect(within(drawer()).queryByRole("button", { name: "Install app" })).not.toBeInTheDocument();
  });

  it("shows the install row above the account on iOS Safari", async () => {
    stubUserAgent(UA.iphoneSafari, 5);
    await renderShell();
    const install = within(drawer()).getByRole("button", { name: "Install app" });
    const signOut = within(drawer()).getByRole("button", { name: "Sign out" });
    expect(install.compareDocumentPosition(signOut) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// docs/mobile-pwa/SPEC.md, P6 (P3 review finding): while the drawer is open
// under lg, the page and the tab bar behind the backdrop are inert, so Tab
// can't wander behind it. At lg the sidebar is in flow and nothing is inert.
describe("Sidebar drawer: the page behind is inert while it's open", () => {
  const UNDER_LG = "(width < 64rem)";

  function PageShell() {
    return (
      <>
        <Sidebar userId="u1" userEmail="me@example.com" />
        <main>
          <button type="button">Behind</button>
        </main>
        <BottomTabBar />
      </>
    );
  }

  async function renderPage() {
    const utils = render(<PageShell />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    return utils;
  }

  const main = () => document.querySelector("main")!;
  const tabBar = () => screen.getByRole("navigation", { name: "Primary", hidden: true });

  it("makes main and the tab bar inert under lg while open, and releases them on close", async () => {
    stubMatchMedia([UNDER_LG]);
    await renderPage();
    expect(main()).not.toHaveAttribute("inert");
    expect(tabBar()).not.toHaveAttribute("inert");
    const user = userEvent.setup();
    await user.click(more());
    expect(main()).toHaveAttribute("inert");
    expect(tabBar()).toHaveAttribute("inert");
    expect(drawer()).not.toHaveAttribute("inert");
    await user.keyboard("{Escape}");
    expectOpen(false);
    expect(main()).not.toHaveAttribute("inert");
    expect(tabBar()).not.toHaveAttribute("inert");
  });

  it.each([
    ["Escape", async (user: ReturnType<typeof userEvent.setup>) => user.keyboard("{Escape}")],
    ["a backdrop tap", async (user: ReturnType<typeof userEvent.setup>) => user.click(backdrop()!)],
  ])("still gives focus back to More after %s (More was inert a moment before)", async (_how, close) => {
    stubMatchMedia([UNDER_LG]);
    await renderPage();
    const user = userEvent.setup();
    await user.click(more());
    expect(tabBar()).toHaveAttribute("inert");
    await close(user);
    expectOpen(false);
    expect(more()).toHaveFocus();
  });

  it("releases everything when it closes on navigation", async () => {
    stubMatchMedia([UNDER_LG]);
    const { rerender } = await renderPage();
    act(() => openSidebar());
    expect(main()).toHaveAttribute("inert");
    nav.pathname = "/habits";
    rerender(<PageShell />);
    expectOpen(false);
    expect(main()).not.toHaveAttribute("inert");
    expect(tabBar()).not.toHaveAttribute("inert");
  });

  it("releases the page when the window grows to lg with the drawer still open", async () => {
    const mq = stubMatchMedia([UNDER_LG]);
    await renderPage();
    act(() => openSidebar());
    expect(main()).toHaveAttribute("inert");
    act(() => mq.list(UNDER_LG).set(false));
    expect(main()).not.toHaveAttribute("inert");
    expect(tabBar()).not.toHaveAttribute("inert");
  });

  it("releases everything when the drawer unmounts while open (e.g. the shell goes away)", async () => {
    stubMatchMedia([UNDER_LG]);
    function Page({ withSidebar }: { withSidebar: boolean }) {
      return (
        <>
          {withSidebar && <Sidebar userId="u1" userEmail="me@example.com" />}
          <main>
            <button type="button">Behind</button>
          </main>
          <BottomTabBar />
        </>
      );
    }
    const { rerender } = render(<Page withSidebar />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await userEvent.setup().click(more());
    expect(main()).toHaveAttribute("inert");
    expect(tabBar()).toHaveAttribute("inert");
    rerender(<Page withSidebar={false} />);
    expect(main()).not.toHaveAttribute("inert");
    expect(tabBar()).not.toHaveAttribute("inert");
    // The page is usable again: its button takes focus.
    screen.getByRole("button", { name: "Behind" }).focus();
    expect(screen.getByRole("button", { name: "Behind" })).toHaveFocus();
  });

  it("puts the nav-chrome class (the standalone no-select rule's hook) on the drawer", async () => {
    await renderPage();
    expect(drawer()).toHaveClass("nav-chrome");
  });

  it("never makes anything inert at lg", async () => {
    stubMatchMedia([]);
    await renderPage();
    act(() => openSidebar());
    expect(main()).not.toHaveAttribute("inert");
    expect(tabBar()).not.toHaveAttribute("inert");
  });

  it("leaves an element that was already inert as it was", async () => {
    stubMatchMedia([UNDER_LG]);
    await renderPage();
    main().setAttribute("inert", "");
    act(() => openSidebar());
    act(() => closeSidebar());
    expect(main()).toHaveAttribute("inert");
    main().removeAttribute("inert");
  });

  it("moves focus into the drawer without scrolling", async () => {
    stubMatchMedia([UNDER_LG]);
    await renderPage();
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    try {
      await userEvent.setup().click(more());
      const first = drawer().querySelector("a[href]");
      const call = focus.mock.contexts.findIndex((el) => el === first);
      expect(call).toBeGreaterThanOrEqual(0);
      expect(focus.mock.calls[call][0]).toEqual({ preventScroll: true });
    } finally {
      focus.mockRestore();
    }
  });
});
