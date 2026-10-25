// Stubs for the browser APIs jsdom lacks (navigator.serviceWorker, a
// settable navigator.onLine, document.visibilityState, location.reload).
// Each install returns nothing; restoreBrowserStubs() puts everything back.
import { vi } from "vitest";

const restores: (() => void)[] = [];

function defineOwn(target: object, key: string, desc: PropertyDescriptor) {
  const had = Object.prototype.hasOwnProperty.call(target, key);
  const prev = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, ...desc });
  restores.push(() => {
    if (had && prev) Object.defineProperty(target, key, prev);
    else delete (target as Record<string, unknown>)[key];
  });
}

export function restoreBrowserStubs() {
  while (restores.length) restores.pop()!();
}

// ── navigator.onLine ─────────────────────────────────────────────────────────

export function stubOnLine(initial: boolean) {
  let value = initial;
  defineOwn(navigator, "onLine", { get: () => value });
  return {
    set(v: boolean) {
      value = v;
    },
    /** Flip the value and fire the matching window event, like a browser does. */
    go(v: boolean) {
      value = v;
      window.dispatchEvent(new Event(v ? "online" : "offline"));
    },
  };
}

// ── location.reload ──────────────────────────────────────────────────────────

export function stubReload() {
  const reload = vi.fn();
  const real = window.location;
  const fake = Object.create(null) as Record<string, unknown>;
  for (const k of ["href", "origin", "pathname", "search", "hash", "host", "hostname", "protocol"]) {
    fake[k] = (real as unknown as Record<string, unknown>)[k];
  }
  fake.reload = reload;
  defineOwn(window, "location", { get: () => fake });
  return reload;
}

// ── document.visibilityState ─────────────────────────────────────────────────

export function stubVisibility(initial: DocumentVisibilityState) {
  let value = initial;
  defineOwn(document, "visibilityState", { get: () => value });
  return {
    set(v: DocumentVisibilityState) {
      value = v;
      document.dispatchEvent(new Event("visibilitychange"));
    },
  };
}

// ── navigator.serviceWorker ──────────────────────────────────────────────────

export class FakeWorker extends EventTarget {
  postMessage = vi.fn();
  constructor(public state: ServiceWorkerState = "installing") {
    super();
  }
  setState(s: ServiceWorkerState) {
    this.state = s;
    this.dispatchEvent(new Event("statechange"));
  }
}

export class FakeRegistration extends EventTarget {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  active: FakeWorker | null = null;
  update = vi.fn(async () => {});
  unregister = vi.fn(async () => true);
  /** A new version starts installing, as after an update check. */
  startInstall() {
    const w = new FakeWorker("installing");
    this.installing = w;
    this.dispatchEvent(new Event("updatefound"));
    return w;
  }
}

export class FakeContainer extends EventTarget {
  controller: FakeWorker | null = null;
  registration = new FakeRegistration();
  registrations: FakeRegistration[] = [];
  register = vi.fn(async (..._args: unknown[]) => this.registration);
  getRegistrations = vi.fn(async () => this.registrations);
  getRegistration = vi.fn(async () => this.registration);
}

export function stubServiceWorker(container = new FakeContainer()) {
  defineOwn(navigator, "serviceWorker", { value: container, writable: true });
  return container;
}

export function fakeCacheStorage(names: string[]) {
  const store = new Set(names);
  const caches = {
    store,
    keys: vi.fn(async () => [...store]),
    delete: vi.fn(async (n: string) => store.delete(n)),
  };
  vi.stubGlobal("caches", caches);
  return caches;
}
