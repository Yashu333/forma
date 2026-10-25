// Page-side helpers for talking to the service worker (public/sw.js).

/** Message types public/sw.js understands. */
export const SW_MESSAGES = {
  skipWaiting: "SKIP_WAITING",
  clearRuntimeCaches: "CLEAR_RUNTIME_CACHES",
} as const;

/** Prefix of the caches that hold a signed-in user's pages. */
const PAGES_CACHE_PREFIX = "forma-pages-";

/**
 * Sign-out (docs/mobile-pwa/SPEC.md, decision 3): deletes the runtime page
 * caches. It asks the active service worker to delete them and waits for its
 * reply, at most `timeoutMs`; at the same time it deletes them from the page
 * (Cache Storage is shared with the window), so they are gone even if the
 * worker is slow, stopped or missing. Never rejects: sign-out goes ahead
 * either way.
 */
export async function clearRuntimeCaches(timeoutMs = 1000): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const channel = new MessageChannel();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    // allSettled: one side failing must not cut the other short.
    await Promise.race([Promise.allSettled([askWorker(channel), deletePageCaches()]), timeout]);
  } catch {
    // Sign-out must not fail because of the cache.
  } finally {
    clearTimeout(timer);
    channel.port1.close();
  }
}

async function askWorker(channel: MessageChannel): Promise<void> {
  const sw = navigator.serviceWorker;
  const worker = sw.controller ?? (await sw.getRegistration())?.active ?? null;
  if (!worker) return;
  await new Promise<void>((resolve) => {
    channel.port1.onmessage = () => resolve();
    worker.postMessage({ type: SW_MESSAGES.clearRuntimeCaches }, [channel.port2]);
  });
}

async function deletePageCaches(): Promise<void> {
  if (typeof caches === "undefined") return;
  const names = await caches.keys();
  await Promise.all(names.filter((n) => n.startsWith(PAGES_CACHE_PREFIX)).map((n) => caches.delete(n)));
}
