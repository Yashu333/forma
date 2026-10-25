// Chromium's install prompt, captured on every page (docs/mobile-pwa/SPEC.md,
// decision 7). The browser fires `beforeinstallprompt` once per page load and
// often before React hydrates, so this module listens as soon as it loads. It
// is imported by ServiceWorkerRegister (root layout), so the event is caught
// on /login, /signup and /offline too, and Chrome's own mini-infobar never
// shows. InstallAppButton (sidebar footer) reads it through subscribe/getters.

/** Chromium's install prompt event (not in the TypeScript DOM lib). */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // keep Chrome's own mini-infobar away; the sidebar row offers it
    deferredPrompt = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installed = true;
    emit();
  });
}

/** The stored prompt, if the browser offered one and it hasn't been used. */
export function getDeferredPrompt(): BeforeInstallPromptEvent | null {
  return deferredPrompt;
}

/** True once the browser reported `appinstalled` in this page's life. */
export function wasInstalled(): boolean {
  return installed;
}

/** Forget a prompt after it was shown (each event can prompt only once). */
export function consumeDeferredPrompt(evt: BeforeInstallPromptEvent) {
  if (deferredPrompt !== evt) return;
  deferredPrompt = null;
  emit();
}

export function subscribeInstallPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
