// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Sidebar from "./Sidebar";
import { mockApi } from "../../tests/ui/fixtures";
import { FakeWorker, restoreBrowserStubs, stubServiceWorker } from "../../tests/ui/pwa-stubs";
import { clearRuntimeCaches } from "@/lib/pwa/sw-client";

// Sign-out clears the offline page copies before leaving (docs/mobile-pwa/SPEC.md,
// P2 and decision 3), so a shared phone never shows the last user's pages.

const h = vi.hoisted(() => ({ order: [] as string[], push: (() => {}) as (url: string) => void }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: h.push, replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signOut: async () => {
        h.order.push("supabase.signOut");
      },
    },
  }),
}));
// The real helper by default; single tests swap in a stand-in.
vi.mock("@/lib/pwa/sw-client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/pwa/sw-client")>();
  return { ...real, clearRuntimeCaches: vi.fn(real.clearRuntimeCaches) };
});

const clear = vi.mocked(clearRuntimeCaches);
let realClear: typeof clearRuntimeCaches;

beforeEach(async () => {
  h.order = [];
  h.push = vi.fn((url: string) => {
    h.order.push(`push ${url}`);
  });
  realClear = (await vi.importActual<typeof import("@/lib/pwa/sw-client")>("@/lib/pwa/sw-client")).clearRuntimeCaches;
  clear.mockReset();
  clear.mockImplementation(async (...args) => {
    h.order.push("clearRuntimeCaches");
    return realClear(...args);
  });
  mockApi({ "GET /api/groups": [] });
});

afterEach(() => restoreBrowserStubs());

async function clickSignOut() {
  render(<Sidebar userId="u1" userEmail="me@example.com" />);
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  await userEvent.setup().click(screen.getByRole("button", { name: "Sign out" }));
}

describe("Sidebar: sign out", () => {
  it("signs out, clears the runtime caches, then goes to /login", async () => {
    await clickSignOut();
    await waitFor(() => expect(h.push).toHaveBeenCalledWith("/login"));
    expect(h.order).toEqual(["supabase.signOut", "clearRuntimeCaches", "push /login"]);
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("does not navigate until the caches are cleared", async () => {
    let finish!: () => void;
    clear.mockImplementation(() => new Promise<void>((r) => (finish = r)));
    await clickSignOut();
    await waitFor(() => expect(clear).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(h.push).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(h.push).toHaveBeenCalledWith("/login"));
  });

  it("asks the controlling worker to clear its page caches", async () => {
    const worker = new FakeWorker("activated");
    worker.postMessage.mockImplementation((_msg: unknown, ports: MessagePort[]) => {
      ports[0].postMessage({ type: "RUNTIME_CACHES_CLEARED" });
    });
    stubServiceWorker().controller = worker;
    await clickSignOut();
    await waitFor(() => expect(h.push).toHaveBeenCalledWith("/login"));
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "CLEAR_RUNTIME_CACHES" }, [expect.anything()]);
  });

  it("still signs out after 1 s when the worker never answers", async () => {
    const worker = new FakeWorker("activated");
    stubServiceWorker().controller = worker;
    const start = Date.now();
    await clickSignOut();
    await waitFor(() => expect(h.push).toHaveBeenCalledWith("/login"), { timeout: 3000 });
    expect(Date.now() - start).toBeGreaterThanOrEqual(900);
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
  });

  it("still signs out with no service worker support", async () => {
    expect("serviceWorker" in navigator).toBe(false);
    await clickSignOut();
    await waitFor(() => expect(h.push).toHaveBeenCalledWith("/login"));
  });
});
