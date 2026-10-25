// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Sidebar from "./Sidebar";
import BottomTabBar from "@/components/mobile/BottomTabBar";
import { closeSidebar, isSidebarOpen, openSidebar } from "@/lib/sidebar-drawer";
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
