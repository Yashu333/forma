// Page-side helpers for talking to the service worker (public/sw.js).

/** Message types public/sw.js understands. */
export const SW_MESSAGES = {
  skipWaiting: "SKIP_WAITING",
  clearRuntimeCaches: "CLEAR_RUNTIME_CACHES",
} as const;

/** Prefix of the caches that hold a signed-in user's pages. */
const PAGES_CACHE_PREFIX = "forma-pages-";

/**
 * Sign-out (docs/mobile-pwa/SPEC.md, decision 3): asks the active service
 * worker to delete its runtime page caches and waits for its reply, at most
 * `timeoutMs`. With no service worker running (none registered, or a
 * shift-reload that bypassed it) it deletes them from the page instead.
 * Never rejects: sign-out goes ahead either way.
 */
export async function clearRuntimeCaches(timeoutMs = 1000): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([askWorker(), timeout]);
  } catch {
    // Sign-out must not fail because of the cache.
  } finally {
    clearTimeout(timer);
  }
}

async function askWorker(): Promise<void> {
  const sw = navigator.serviceWorker;
  const worker = sw.controller ?? (await sw.getRegistration())?.active ?? null;
  if (!worker) {
    await deletePageCaches();
    return;
  }
  const channel = new MessageChannel();
  await new Promise<void>((resolve) => {
    channel.port1.onmessage = () => resolve();
    worker.postMessage({ type: SW_MESSAGES.clearRuntimeCaches }, [channel.port2]);
  });
  channel.port1.close();
}

async function deletePageCaches(): Promise<void> {
  if (typeof caches === "undefined") return;
  const names = await caches.keys();
  await Promise.all(names.filter((n) => n.startsWith(PAGES_CACHE_PREFIX)).map((n) => caches.delete(n)));
}
