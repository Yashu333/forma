// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ServiceWorkerRegister, { UPDATE_CHECK_INTERVAL_MS, UPDATE_MESSAGE } from "./ServiceWorkerRegister";
import {
  FakeContainer,
  FakeRegistration,
  FakeWorker,
  fakeCacheStorage,
  restoreBrowserStubs,
  stubReload,
  stubServiceWorker,
  stubVisibility,
} from "../../tests/ui/pwa-stubs";

// docs/mobile-pwa/SPEC.md, P2 and decisions 5 and 6: register in production,
// offer a waiting update, reload only when the user asks; no worker in dev.

const TOAST = "A new version of Forma is ready";

/** The always-mounted live region (the toast itself has no role). */
const liveRegion = () => screen.getByRole("status");

/** The toast is on screen and announced. */
function expectToast() {
  expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  expect(liveRegion()).toHaveTextContent(TOAST);
}

/** No toast, nothing announced (the empty live region stays mounted). */
function expectNoToast() {
  expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
  expect(liveRegion()).toHaveTextContent(/^$/);
}

let sw: FakeContainer;

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  sw = stubServiceWorker();
});

afterEach(() => {
  vi.unstubAllEnvs();
  restoreBrowserStubs();
});

/** Renders and waits for register() to resolve. */
async function renderRegistered() {
  const utils = render(<ServiceWorkerRegister />);
  await waitFor(() => expect(sw.register).toHaveBeenCalled());
  await act(async () => {
    await sw.register.mock.results[0].value;
  });
  return utils;
}

/** An update: a new worker installs while an old one controls the page. */
async function installUpdate(reg: FakeRegistration = sw.registration) {
  let w!: FakeWorker;
  act(() => {
    w = reg.startInstall();
  });
  act(() => {
    reg.installing = null;
    reg.waiting = w;
    w.setState("installed");
  });
  return w;
}

describe("ServiceWorkerRegister: production", () => {
  it("registers /sw.js for the whole origin, bypassing the HTTP cache for updates", async () => {
    await renderRegistered();
    expect(sw.register).toHaveBeenCalledTimes(1);
    expect(sw.register).toHaveBeenCalledWith("/sw.js", { scope: "/", updateViaCache: "none" });
    expectNoToast();
  });

  it("shows nothing on the first install (no controller yet)", async () => {
    const first = new FakeWorker("installing");
    sw.registration.installing = first;
    await renderRegistered();
    act(() => first.setState("installed"));
    act(() => first.setState("activated"));
    expectNoToast();

    // Same through updatefound.
    await installUpdate();
    expectNoToast();
  });

  it("shows the update toast when a new worker is installed and a controller exists", async () => {
    sw.controller = new FakeWorker("activated");
    await renderRegistered();
    expectNoToast();

    const region = liveRegion();
    const w = await installUpdate();
    expectToast();
    // The same, always-mounted region announces it; it doesn't wrap the buttons.
    expect(liveRegion()).toBe(region);
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region.querySelector("button")).toBeNull();
    expect(region).toHaveClass("sr-only");
    expect(UPDATE_MESSAGE).toBe(TOAST);
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    // Never activates on its own (decision 6).
    expect(w.postMessage).not.toHaveBeenCalled();
  });

  it("does not show the toast while the new worker is still installing", async () => {
    sw.controller = new FakeWorker("activated");
    await renderRegistered();
    let w!: FakeWorker;
    act(() => {
      w = sw.registration.startInstall();
    });
    expectNoToast();
    act(() => w.setState("redundant")); // the install failed
    expectNoToast();
  });

  it("offers an update that was already waiting when the page loaded", async () => {
    sw.controller = new FakeWorker("activated");
    sw.registration.waiting = new FakeWorker("installed");
    await renderRegistered();
    expectToast();
  });

  it("offers an update whose install was already under way when the page loaded", async () => {
    sw.controller = new FakeWorker("activated");
    const w = new FakeWorker("installing");
    sw.registration.installing = w;
    await renderRegistered();
    expectNoToast();
    act(() => w.setState("installed"));
    expectToast();
  });

  it("Reload posts SKIP_WAITING to the waiting worker and reloads once, on controllerchange", async () => {
    const reload = stubReload();
    sw.controller = new FakeWorker("activated");
    await renderRegistered();
    const w = await installUpdate();

    await userEvent.setup().click(screen.getByRole("button", { name: "Reload" }));
    expect(w.postMessage).toHaveBeenCalledTimes(1);
    expect(w.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(reload).not.toHaveBeenCalled(); // not before the new worker takes over

    act(() => {
      sw.controller = w;
      sw.dispatchEvent(new Event("controllerchange"));
    });
    expect(reload).toHaveBeenCalledTimes(1);
    act(() => {
      sw.dispatchEvent(new Event("controllerchange"));
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("Reload reloads straight away when another tab already activated the new worker", async () => {
    const reload = stubReload();
    sw.controller = new FakeWorker("activated");
    await renderRegistered();
    const w = await installUpdate();
    w.state = "activated";
    await userEvent.setup().click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("never reloads without the user (controllerchange alone does nothing)", async () => {
    const reload = stubReload();
    sw.controller = new FakeWorker("activated");
    await renderRegistered();
    await installUpdate();
    act(() => {
      sw.dispatchEvent(new Event("controllerchange"));
    });
    expect(reload).not.toHaveBeenCalled();
  });

  it("a double tap on Reload sends one SKIP_WAITING, disables the button and reloads once", async () => {
    const reload = stubReload();
    sw.controller = new FakeWorker("activated");
    await renderRegistered();
    const w = await installUpdate();
    const add = vi.spyOn(sw, "addEventListener");

    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: "Reload" });
    await user.click(button);
    expect(button).toBeDisabled();
    await user.click(button);
    act(() => {
      button.click(); // even bypassing the disabled state
    });
    expect(w.postMessage).toHaveBeenCalledTimes(1);
    expect(add.mock.calls.filter(([type]) => type === "controllerchange")).toHaveLength(1);

    act(() => {
      sw.controller = w;
      sw.dispatchEvent(new Event("controllerchange"));
      sw.dispatchEvent(new Event("controllerchange"));
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("a newer update after Reload was pressed (the old one never took over) can be reloaded again", async () => {
    const reload = stubReload();
    sw.controller = new FakeWorker("activated");
    await renderRegistered();
    const first = await installUpdate();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Reload" }));
    expect(screen.getByRole("button", { name: "Reload" })).toBeDisabled();
    expect(first.postMessage).toHaveBeenCalledTimes(1);

    // The first one is replaced before it activates; a newer worker installs.
    first.state = "redundant";
    const second = await installUpdate();
    expectToast();
    const button = screen.getByRole("button", { name: "Reload" });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(second.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    act(() => {
      sw.controller = second;
      sw.dispatchEvent(new Event("controllerchange"));
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("Reload reloads straight away when the waiting worker became redundant", async () => {
    const reload = stubReload();
    sw.controller = new FakeWorker("activated");
    await renderRegistered();
    const w = await installUpdate();
    w.state = "redundant";
    await userEvent.setup().click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(w.postMessage).not.toHaveBeenCalled();
  });

  it("Dismiss hides the toast without activating the update; a newer update shows it again", async () => {
    const reload = stubReload();
    sw.controller = new FakeWorker("activated");
    await renderRegistered();
    const w = await installUpdate();

    await userEvent.setup().click(screen.getByRole("button", { name: "Dismiss" }));
    expectNoToast();
    expect(w.postMessage).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();

    await installUpdate();
    expectToast();
  });

  it("checks for an update when the app comes back to the front, at most every 30 min", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const vis = stubVisibility("visible");
    await renderRegistered();

    act(() => vis.set("hidden"));
    act(() => vis.set("visible"));
    expect(sw.registration.update).not.toHaveBeenCalled(); // register() just checked

    now += UPDATE_CHECK_INTERVAL_MS;
    act(() => vis.set("hidden"));
    expect(sw.registration.update).not.toHaveBeenCalled(); // not while hidden
    act(() => vis.set("visible"));
    expect(sw.registration.update).toHaveBeenCalledTimes(1);

    now += UPDATE_CHECK_INTERVAL_MS - 1;
    act(() => vis.set("hidden"));
    act(() => vis.set("visible"));
    expect(sw.registration.update).toHaveBeenCalledTimes(1);

    now += 1;
    act(() => vis.set("hidden"));
    act(() => vis.set("visible"));
    expect(sw.registration.update).toHaveBeenCalledTimes(2);
    expect(UPDATE_CHECK_INTERVAL_MS).toBe(30 * 60 * 1000);
  });

  it("survives a failing update check", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const vis = stubVisibility("visible");
    sw.registration.update.mockRejectedValue(new Error("offline"));
    await renderRegistered();
    now += UPDATE_CHECK_INTERVAL_MS;
    act(() => vis.set("visible"));
    expect(sw.registration.update).toHaveBeenCalledTimes(1);
    await act(async () => {});
  });

  it("works on without a service worker when register() fails", async () => {
    sw.register.mockRejectedValue(new Error("SecurityError"));
    const { container } = render(<ServiceWorkerRegister />);
    await waitFor(() => expect(sw.register).toHaveBeenCalled());
    await act(async () => {});
    expect(container.querySelector("button")).toBeNull();
    expectNoToast();
  });

  it("stops listening after unmount", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const vis = stubVisibility("visible");
    sw.controller = new FakeWorker("activated");
    const { unmount } = await renderRegistered();
    const removed = vi.spyOn(sw.registration, "removeEventListener");
    unmount();
    now += UPDATE_CHECK_INTERVAL_MS;
    vis.set("visible");
    expect(sw.registration.update).not.toHaveBeenCalled();
    expect(removed).toHaveBeenCalledWith("updatefound", expect.any(Function));
  });
});

describe("ServiceWorkerRegister: cleanup", () => {
  it("removes its statechange listeners from the workers it watched on unmount", async () => {
    sw.controller = new FakeWorker("activated");
    const early = new FakeWorker("installing");
    sw.registration.installing = early;
    const { unmount } = await renderRegistered();
    let later!: FakeWorker;
    act(() => {
      later = sw.registration.startInstall();
    });
    const removedEarly = vi.spyOn(early, "removeEventListener");
    const removedLater = vi.spyOn(later, "removeEventListener");
    unmount();
    expect(removedEarly).toHaveBeenCalledWith("statechange", expect.any(Function));
    expect(removedLater).toHaveBeenCalledWith("statechange", expect.any(Function));
    // And a late install no longer reaches React.
    later.setState("installed");
  });
});

describe("ServiceWorkerRegister: development", () => {
  it("never registers, unregisters every worker and deletes only forma-* caches", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const a = new FakeRegistration();
    const b = new FakeRegistration();
    sw.registrations = [a, b];
    const caches = fakeCacheStorage(["forma-static-v1", "forma-pages-v1", "forma-static-v0", "other-app"]);

    const { container } = render(<ServiceWorkerRegister />);
    await waitFor(() => expect(caches.store.size).toBe(1));
    expect([...caches.store]).toEqual(["other-app"]);
    expect(a.unregister).toHaveBeenCalledTimes(1);
    expect(b.unregister).toHaveBeenCalledTimes(1);
    expect(sw.register).not.toHaveBeenCalled();
    expect(container.querySelector("button")).toBeNull();
    expectNoToast();
  });

  it("unregisters even without the Cache API, and survives a failure", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const a = new FakeRegistration();
    sw.registrations = [a];
    render(<ServiceWorkerRegister />);
    await waitFor(() => expect(a.unregister).toHaveBeenCalled());

    sw.getRegistrations.mockRejectedValue(new Error("SecurityError"));
    render(<ServiceWorkerRegister />);
    await waitFor(() => expect(sw.getRegistrations).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(sw.register).not.toHaveBeenCalled();
  });
});

describe("ServiceWorkerRegister: no support", () => {
  it("renders nothing and does not throw without navigator.serviceWorker", async () => {
    restoreBrowserStubs();
    expect("serviceWorker" in navigator).toBe(false);
    const { container } = render(<ServiceWorkerRegister />);
    await act(async () => {});
    expect(container.querySelector("button")).toBeNull();
    expectNoToast();
  });
});
