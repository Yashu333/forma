// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Sidebar from "./Sidebar";
import { mockApi } from "../../tests/ui/fixtures";
import { STANDALONE_QUERY } from "@/lib/pwa/use-standalone";
import { restoreBrowserStubs, stubMatchMedia, stubNavigatorStandalone } from "../../tests/ui/pwa-stubs";

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
});

async function renderSidebar() {
  render(<Sidebar userId="u1" userEmail="me@example.com" />);
  // the groups fetch resolves after the first render
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  return screen.getByRole("navigation");
}

const ACTIVE = { color: "var(--text-primary)", background: "var(--accent-subtle)" };
const INACTIVE_COLOR = "var(--text-muted)";

describe("Sidebar: Today link", () => {
  it("has a Today link that points at /today", async () => {
    const nav = await renderSidebar();
    const link = screen.getByRole("link", { name: "Today" });
    expect(nav).toContainElement(link);
    expect(link).toHaveAttribute("href", "/today");
    expect(link).not.toHaveAttribute("target"); // same tab, unlike Pomodoro
  });

  it("sits right after Dashboard, with the other pages between it and Pomodoro", async () => {
    const nav = await renderSidebar();
    const names = Array.from(nav.querySelectorAll("a")).map((a) => a.textContent?.trim());
    const i = names.indexOf("Today");
    expect(names[i - 1]).toBe("Dashboard");
    expect(names.slice(i, names.indexOf("Pomodoro"))).toEqual(["Today", "Calendar", "Habits", "Weekly review"]);
  });

  it("is marked active on /today (and Dashboard is not)", async () => {
    nav.pathname = "/today";
    await renderSidebar();
    expect(screen.getByRole("link", { name: "Today" })).toHaveStyle(ACTIVE);
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveStyle({ color: INACTIVE_COLOR });
    expect(screen.getByRole("link", { name: "Reports" })).toHaveStyle({ color: INACTIVE_COLOR });
  });

  it("is not active on other pages", async () => {
    for (const p of ["/dashboard", "/reports", "/group/abc"]) {
      nav.pathname = p;
      const { unmount } = render(<Sidebar userId="u1" userEmail="me@example.com" />);
      expect(screen.getByRole("link", { name: "Today" })).toHaveStyle({ color: INACTIVE_COLOR });
      expect(screen.getByRole("link", { name: "Today" }).style.background).not.toContain("accent-subtle");
      unmount();
    }
  });

  it("uses the same markup as the Dashboard link (classes, icon)", async () => {
    await renderSidebar();
    const today = screen.getByRole("link", { name: "Today" });
    const dash = screen.getByRole("link", { name: "Dashboard" });
    expect(today.className).toBe(dash.className);
    expect(today.querySelector("svg")).not.toBeNull();
  });

  it("highlights on hover when inactive and restores on leave", async () => {
    await renderSidebar();
    const user = userEvent.setup();
    const link = screen.getByRole("link", { name: "Today" });
    await user.hover(link);
    expect(link).toHaveStyle({ color: "var(--text-primary)" });
    await user.unhover(link);
    expect(link).toHaveStyle({ color: INACTIVE_COLOR });
  });

  it("does not disturb the existing links", async () => {
    await renderSidebar();
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: "Pomodoro" })).toHaveAttribute("href", "/pomodoro");
    expect(screen.getByRole("link", { name: "Reports" })).toHaveAttribute("href", "/reports");
  });
});

// docs/mobile-pwa (P6 review): Pomodoro opens in its own tab in the browser, but
// in the installed app a new window would leave it (on iOS for Safari, which
// isn't signed in), so there it opens in place.
describe("Sidebar: Pomodoro link in the installed app", () => {
  afterEach(() => restoreBrowserStubs());

  it("opens in a new tab in a browser tab", async () => {
    await renderSidebar();
    expect(screen.getByRole("link", { name: "Pomodoro" })).toHaveAttribute("target", "_blank");
  });

  it("has no target under display-mode: standalone", async () => {
    stubMatchMedia([STANDALONE_QUERY]);
    await renderSidebar();
    const link = screen.getByRole("link", { name: "Pomodoro" });
    expect(link).toHaveAttribute("href", "/pomodoro");
    expect(link).not.toHaveAttribute("target");
    expect(link).not.toHaveAttribute("rel");
  });

  it("has no target on an iPhone launched from the home screen", async () => {
    stubNavigatorStandalone(true);
    await renderSidebar();
    expect(screen.getByRole("link", { name: "Pomodoro" })).not.toHaveAttribute("target");
  });
});
