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
  register = vi.fn<(url: string, options?: RegistrationOptions) => Promise<FakeRegistration>>(
    async () => this.registration,
  );
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

// ── matchMedia (jsdom has none) ──────────────────────────────────────────────

export class FakeMediaQueryList extends EventTarget {
  onchange: ((e: Event) => void) | null = null;
  constructor(public media: string, public matches: boolean) {
    super();
  }
  addListener(fn: (e: Event) => void) { this.addEventListener("change", fn); }
  removeListener(fn: (e: Event) => void) { this.removeEventListener("change", fn); }
  /** Flip the result and fire `change`, like a browser does. */
  set(matches: boolean) {
    this.matches = matches;
    const e = Object.assign(new Event("change"), { matches, media: this.media });
    this.dispatchEvent(e);
  }
}

/** Stubs window.matchMedia; `matching` lists the queries that match. Returns one shared list per query. */
export function stubMatchMedia(matching: string[] = []) {
  const lists = new Map<string, FakeMediaQueryList>();
  const matchMedia = vi.fn((q: string) => {
    let l = lists.get(q);
    if (!l) lists.set(q, (l = new FakeMediaQueryList(q, matching.includes(q))));
    return l as unknown as MediaQueryList;
  });
  defineOwn(window, "matchMedia", { value: matchMedia, writable: true });
  return {
    matchMedia,
    /** The list for a query (created on first use). */
    list(q: string) {
      return matchMedia(q) as unknown as FakeMediaQueryList;
    },
  };
}

// ── navigator.userAgent / maxTouchPoints / standalone ────────────────────────

export const UA = {
  desktopChrome:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
  ipadSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
};

export function stubUserAgent(ua: string, maxTouchPoints = 0) {
  defineOwn(navigator, "userAgent", { get: () => ua });
  defineOwn(navigator, "maxTouchPoints", { get: () => maxTouchPoints });
}

/** iOS Safari's non-standard navigator.standalone (true when launched from the home screen). */
export function stubNavigatorStandalone(value: boolean) {
  defineOwn(navigator, "standalone", { get: () => value });
}
