import { afterEach, describe, expect, it, vi } from "vitest";

// The install prompt capture (docs/mobile-pwa/SPEC.md, decision 7): listens
// from module load, keeps the event, forgets it once used or installed.

type Mod = typeof import("./install-prompt");

async function load(): Promise<{ mod: Mod; win: EventTarget }> {
  vi.resetModules();
  const win = new EventTarget();
  vi.stubGlobal("window", win);
  return { mod: await import("./install-prompt"), win };
}

function promptEvent() {
  return new Event("beforeinstallprompt", { cancelable: true });
}

afterEach(() => vi.unstubAllGlobals());

describe("install-prompt", () => {
  it("does nothing on the server (no window)", async () => {
    vi.resetModules();
    const mod = await import("./install-prompt");
    expect(mod.getDeferredPrompt()).toBeNull();
    expect(mod.wasInstalled()).toBe(false);
  });

  it("keeps the event from module load and stops the browser's own infobar", async () => {
    const { mod, win } = await load();
    const listener = vi.fn();
    mod.subscribeInstallPrompt(listener);
    const e = promptEvent();
    win.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(mod.getDeferredPrompt()).toBe(e);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("forgets a used prompt, but only that one", async () => {
    const { mod, win } = await load();
    const first = promptEvent();
    win.dispatchEvent(first);
    const second = promptEvent();
    win.dispatchEvent(second);
    mod.consumeDeferredPrompt(first as never); // stale: ignored
    expect(mod.getDeferredPrompt()).toBe(second);
    mod.consumeDeferredPrompt(second as never);
    expect(mod.getDeferredPrompt()).toBeNull();
  });

  it("appinstalled clears the prompt and is remembered", async () => {
    const { mod, win } = await load();
    const listener = vi.fn();
    const unsubscribe = mod.subscribeInstallPrompt(listener);
    win.dispatchEvent(promptEvent());
    win.dispatchEvent(new Event("appinstalled"));
    expect(mod.getDeferredPrompt()).toBeNull();
    expect(mod.wasInstalled()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    win.dispatchEvent(promptEvent());
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
