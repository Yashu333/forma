import { afterEach, describe, expect, it, vi } from "vitest";
import { clearRuntimeCaches, SW_MESSAGES } from "./sw-client";

// Sign-out's cache clearing (docs/mobile-pwa/SPEC.md, P2 and decision 3):
// ask the worker, wait at most 1 s, and never fail the sign-out.

type Posted = { message: unknown; port: MessagePort };

/** A worker that answers on the transferred port (or never, or throws). */
function fakeWorker(mode: "reply" | "silent" | "throw" = "reply") {
  const posted: Posted[] = [];
  return {
    posted,
    postMessage: vi.fn((message: unknown, transfer: MessagePort[]) => {
      if (mode === "throw") throw new Error("InvalidStateError");
      const port = transfer[0];
      posted.push({ message, port });
      if (mode === "reply") port.postMessage({ type: "RUNTIME_CACHES_CLEARED" });
    }),
  };
}

function fakeCaches(names: string[]) {
  const store = new Set(names);
  return {
    store,
    keys: vi.fn(async () => [...store]),
    delete: vi.fn(async (n: string) => store.delete(n)),
  };
}

function stubSW(sw: { controller?: unknown; getRegistration?: () => Promise<unknown> }) {
  const container = {
    controller: sw.controller ?? null,
    getRegistration: vi.fn(sw.getRegistration ?? (async () => undefined)),
  };
  vi.stubGlobal("navigator", { serviceWorker: container });
  return container;
}

function track(p: Promise<unknown>) {
  const t = { settled: false, rejected: false };
  p.then(
    () => (t.settled = true),
    () => {
      t.settled = true;
      t.rejected = true;
    },
  );
  return t;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("clearRuntimeCaches", () => {
  it("does nothing without service worker support", async () => {
    const caches = fakeCaches(["forma-pages-v1"]);
    vi.stubGlobal("caches", caches);
    vi.stubGlobal("navigator", { userAgent: "old browser" });
    await expect(clearRuntimeCaches()).resolves.toBeUndefined();
    expect(caches.keys).not.toHaveBeenCalled();
    expect(caches.store.has("forma-pages-v1")).toBe(true);
  });

  it("does nothing on the server (no navigator)", async () => {
    vi.stubGlobal("navigator", undefined);
    await expect(clearRuntimeCaches()).resolves.toBeUndefined();
  });

  it("asks the controlling worker over a message port and resolves on its reply", async () => {
    const worker = fakeWorker("reply");
    const sw = stubSW({ controller: worker });
    const start = Date.now();
    await clearRuntimeCaches();
    expect(Date.now() - start).toBeLessThan(500); // the reply, not the 1 s cap
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(worker.posted[0].message).toEqual({ type: SW_MESSAGES.clearRuntimeCaches });
    expect(SW_MESSAGES.clearRuntimeCaches).toBe("CLEAR_RUNTIME_CACHES");
    expect(sw.getRegistration).not.toHaveBeenCalled();
  });

  it("waits for the reply before resolving", async () => {
    const worker = fakeWorker("silent");
    stubSW({ controller: worker });
    const t = track(clearRuntimeCaches());
    await new Promise((r) => setTimeout(r, 50));
    expect(t.settled).toBe(false);
    worker.posted[0].port.postMessage({ type: "RUNTIME_CACHES_CLEARED" });
    await vi.waitFor(() => expect(t.settled).toBe(true), { timeout: 500 });
    expect(t.rejected).toBe(false);
    worker.posted[0].port.close();
  });

  it("with no controller (shift-reload), asks the registration's active worker", async () => {
    const worker = fakeWorker("reply");
    const sw = stubSW({ controller: null, getRegistration: async () => ({ active: worker }) });
    await clearRuntimeCaches();
    expect(sw.getRegistration).toHaveBeenCalled();
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
  });

  it("with no worker at all, deletes forma-pages-* from the page and keeps the rest", async () => {
    const caches = fakeCaches(["forma-pages-v1", "forma-pages-v0", "forma-static-v1", "other-app"]);
    vi.stubGlobal("caches", caches);
    stubSW({ controller: null, getRegistration: async () => ({ active: null }) });
    await clearRuntimeCaches();
    expect([...caches.store].sort()).toEqual(["forma-static-v1", "other-app"]);

    const caches2 = fakeCaches(["forma-pages-v1"]);
    vi.stubGlobal("caches", caches2);
    stubSW({ controller: null, getRegistration: async () => undefined });
    await clearRuntimeCaches();
    expect([...caches2.store]).toEqual([]);
  });

  it("with no worker and no Cache API, still resolves", async () => {
    vi.stubGlobal("caches", undefined);
    stubSW({ controller: null });
    await expect(clearRuntimeCaches()).resolves.toBeUndefined();
  });

  it("gives up after 1 s when the worker never replies", async () => {
    vi.useFakeTimers();
    const worker = fakeWorker("silent");
    stubSW({ controller: worker });
    const t = track(clearRuntimeCaches());
    await vi.advanceTimersByTimeAsync(999);
    expect(t.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.settled).toBe(true);
    expect(t.rejected).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    worker.posted[0].port.close();
  });

  it("honours a custom timeout", async () => {
    vi.useFakeTimers();
    const worker = fakeWorker("silent");
    stubSW({ controller: worker });
    const t = track(clearRuntimeCaches(200));
    await vi.advanceTimersByTimeAsync(199);
    expect(t.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.settled).toBe(true);
    worker.posted[0].port.close();
  });

  it("clears its timer when the reply comes first", async () => {
    vi.useFakeTimers();
    stubSW({ controller: fakeWorker("reply") });
    const t = track(clearRuntimeCaches());
    await vi.waitFor(() => expect(t.settled).toBe(true));
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["getRegistration rejects", () => stubSW({ controller: null, getRegistration: async () => Promise.reject(new Error("SecurityError")) })],
    ["postMessage throws", () => stubSW({ controller: fakeWorker("throw") })],
    [
      "caches.keys rejects",
      () => {
        vi.stubGlobal("caches", { keys: async () => Promise.reject(new Error("blocked")), delete: async () => true });
        stubSW({ controller: null });
      },
    ],
  ])("never rejects: %s", async (_name, setup) => {
    setup();
    await expect(clearRuntimeCaches()).resolves.toBeUndefined();
  });
});
