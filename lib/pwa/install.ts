// Install entry point helpers (docs/mobile-pwa/SPEC.md, decision 7). Pure, so
// they run in unit tests; the component passes in the browser's values.

/**
 * True for Safari on an iPhone, iPod or iPad, where the only way to install
 * is Share, then "Add to Home Screen". iPadOS Safari reports a Mac user agent,
 * so a "Macintosh" with a touch screen counts as an iPad. Other iOS browsers
 * (Chrome, Firefox, Edge, Opera, the Google app, DuckDuckGo) and in-app web
 * views are left out: they name themselves or lack Safari's "Version/" token.
 */
export function isIosSafari(userAgent: string, maxTouchPoints: number): boolean {
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  if (!ios) return false;
  if (!/Version\/[\d.]+.*Safari\//.test(userAgent)) return false;
  return !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|DuckDuckGo|Ddg\/|FBAN|FBAV|Instagram|Line\//.test(userAgent);
}

/** True when the app already runs installed (home-screen icon, no browser bar). */
export function isStandalone(
  navigatorStandalone: boolean | undefined,
  matchesDisplayModeStandalone: boolean,
): boolean {
  return navigatorStandalone === true || matchesDisplayModeStandalone;
}
