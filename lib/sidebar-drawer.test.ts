import { afterEach, describe, expect, it, vi } from "vitest";
import { closeSidebar, isSidebarOpen, openSidebar, setSidebarOpen, subscribeSidebar } from "./sidebar-drawer";

afterEach(() => closeSidebar());

describe("sidebar drawer store", () => {
  it("starts closed and opens and closes", () => {
    expect(isSidebarOpen()).toBe(false);
    openSidebar();
    expect(isSidebarOpen()).toBe(true);
    closeSidebar();
    expect(isSidebarOpen()).toBe(false);
  });

  it("tells subscribers about changes, once per change", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSidebar(listener);
    openSidebar();
    openSidebar(); // no change, no call
    setSidebarOpen(false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    openSidebar();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
