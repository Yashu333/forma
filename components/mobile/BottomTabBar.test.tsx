// @vitest-environment jsdom
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BottomTabBar from "./BottomTabBar";
import CommandPalette, { OPEN_PALETTE_EVENT } from "@/components/command/CommandPalette";
import { closeSidebar, isSidebarOpen, openSidebar } from "@/lib/sidebar-drawer";
import { mockApi } from "../../tests/ui/fixtures";

// docs/mobile-pwa/SPEC.md, P3 and decision 4: under lg, navigation is a bottom
// tab bar with Today, Board, Add (palette in add mode), Calendar and More
// (opens the sidebar drawer).

const nav = vi.hoisted(() => ({ pathname: "/dashboard" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

beforeEach(() => {
  nav.pathname = "/dashboard";
  mockApi({ "GET /api/groups": [] });
});

afterEach(() => {
  act(() => closeSidebar());
});

function tabBar() {
  return screen.getByRole("navigation", { name: "Primary" });
}

describe("BottomTabBar: structure", () => {
  it("is a navigation landmark labelled Primary with five items in order", () => {
    render(<BottomTabBar />);
    const bar = tabBar();
    const items = within(bar).getAllByRole("listitem");
    expect(items).toHaveLength(5);
    expect(items.map((li) => li.textContent?.trim())).toEqual(["Today", "Board", "Add", "Calendar", "More"]);
  });

  it("links Today, Board and Calendar to their pages", () => {
    render(<BottomTabBar />);
    const bar = tabBar();
    expect(within(bar).getByRole("link", { name: "Today" })).toHaveAttribute("href", "/today");
    expect(within(bar).getByRole("link", { name: "Board" })).toHaveAttribute("href", "/dashboard");
    expect(within(bar).getByRole("link", { name: "Calendar" })).toHaveAttribute("href", "/calendar");
  });

  it("has Add and More as buttons, not links", () => {
    render(<BottomTabBar />);
    const bar = tabBar();
    expect(within(bar).getByRole("button", { name: "Add task" })).toHaveAttribute("type", "button");
    expect(within(bar).getByRole("button", { name: "More" })).toHaveAttribute("type", "button");
    expect(within(bar).getAllByRole("link")).toHaveLength(3);
  });

  it("is hidden from lg up and fixed to the bottom", () => {
    render(<BottomTabBar />);
    expect(tabBar()).toHaveClass("lg:hidden", "fixed", "bottom-0");
  });
});

describe("BottomTabBar: active tab", () => {
  const cases: [string, string | null][] = [
    ["/today", "Today"],
    ["/today/label", "Today"],
    ["/today/new", "Today"],
    ["/dashboard", "Board"],
    ["/group/abc", "Board"],
    ["/calendar", "Calendar"],
    ["/habits", null],
    ["/review", null],
    ["/reports", null],
    ["/pomodoro", null],
  ];

  for (const [pathname, expected] of cases) {
    it(`${pathname} → ${expected ?? "no tab"} is current`, () => {
      nav.pathname = pathname;
      render(<BottomTabBar />);
      const current = within(tabBar())
        .getAllByRole("link")
        .filter((a) => a.getAttribute("aria-current") === "page");
      expect(current.map((a) => a.textContent?.trim())).toEqual(expected ? [expected] : []);
    });
  }

  it("never marks Add or More as current", () => {
    nav.pathname = "/today";
    render(<BottomTabBar />);
    const bar = tabBar();
    expect(within(bar).getByRole("button", { name: "Add task" })).not.toHaveAttribute("aria-current");
    expect(within(bar).getByRole("button", { name: "More" })).not.toHaveAttribute("aria-current");
  });

  it("does not mark a page whose path only starts with a tab's name", () => {
    nav.pathname = "/todayish";
    render(<BottomTabBar />);
    expect(within(tabBar()).getByRole("link", { name: "Today" })).not.toHaveAttribute("aria-current");
  });
});

describe("BottomTabBar: Add", () => {
  it("is an outlined slot, not a second orange action (the page keeps its one primary)", () => {
    render(<BottomTabBar />);
    const add = within(tabBar()).getByRole("button", { name: "Add task" });
    const slot = add.querySelector("span")!;
    expect(slot).toHaveClass("border", "border-border", "text-foreground");
    expect(slot.className).not.toMatch(/\bbg-primary\b|text-primary-foreground/);
    expect(add.querySelector(".bg-primary")).toBeNull();
  });

  it("asks the command palette to open in add mode", async () => {
    const seen: unknown[] = [];
    const onOpen = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    try {
      render(<BottomTabBar />);
      await userEvent.setup().click(within(tabBar()).getByRole("button", { name: "Add task" }));
      expect(seen).toEqual([{ mode: "add", text: "" }]);
    } finally {
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    }
  });

  it("opens the real palette in add mode with the text box focused", async () => {
    render(
      <>
        <BottomTabBar />
        <CommandPalette />
      </>,
    );
    await userEvent.setup().click(within(tabBar()).getByRole("button", { name: "Add task" }));
    const dialog = await screen.findByRole("dialog", { name: "Add task" });
    expect(within(dialog).getByRole("textbox", { name: "New task" })).toHaveFocus();
  });

  it("returns focus to Add when the palette closes", async () => {
    const user = userEvent.setup();
    render(
      <>
        <BottomTabBar />
        <CommandPalette />
      </>,
    );
    const add = within(tabBar()).getByRole("button", { name: "Add task" });
    await user.click(add);
    await screen.findByRole("dialog", { name: "Add task" });
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(add).toHaveFocus();
  });
});

describe("BottomTabBar: More", () => {
  it("opens the sidebar drawer and reports it with aria-expanded", async () => {
    render(<BottomTabBar />);
    const more = within(tabBar()).getByRole("button", { name: "More" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(more).toHaveAttribute("aria-controls", "app-sidebar");

    await userEvent.setup().click(more);
    expect(isSidebarOpen()).toBe(true);
    expect(more).toHaveAttribute("aria-expanded", "true");
  });

  it("follows the drawer store when something else closes or opens it", () => {
    render(<BottomTabBar />);
    const more = within(tabBar()).getByRole("button", { name: "More" });
    act(() => openSidebar());
    expect(more).toHaveAttribute("aria-expanded", "true");
    act(() => closeSidebar());
    expect(more).toHaveAttribute("aria-expanded", "false");
  });
});
