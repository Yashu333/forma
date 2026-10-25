# Forma on the phone: installable PWA + mobile layout

Branch: `feature/mobile-pwa` (from `main` at `2f756df`).

## Goal

Forma installs to a phone's home screen and opens like a native app: its own icon, full screen with no browser bar, a fast start from cache, a clear screen when the connection drops, and every page usable with one thumb at 360–430px wide. Same codebase, same Supabase auth, same API. Desktop stays exactly as it is at `lg` (1024px) and up.

## Non-goals (record ideas here, don't build them)

- Push notifications (need VAPID keys, a subscriptions table and a sender; a later feature).
- Offline writes, background sync, or an offline copy of the data. Offline means "the app opens and says you're offline", not "you can work offline".
- App store wrappers (TWA, Capacitor).
- Visual redesign. The Ember design system in `CLAUDE.md` still rules: tokens only, no gradients or glows, sentence case, one outline rule.

## Product decisions (final)

1. **No PWA library.** Hand-written `public/sw.js` as in the Next.js PWA guide (`node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md`). Serwist and next-pwa hook into webpack; this app builds with Turbopack.
2. **Never cache data.** The service worker never caches `/api/*`, `/auth/*`, `/login`, `/signup`, or any non-GET request. It caches static assets and the offline page, plus the last-seen HTML of app pages only as an offline fallback (network first).
3. **Sign-out clears the caches.** A shared phone must not show the last user's pages. Sign-out tells the service worker to delete every runtime cache before redirecting.
4. **Under `lg`, navigation moves to a bottom tab bar:** Today, Board (dashboard), Add (opens the command palette in add mode), Calendar, More (opens the existing sidebar drawer). The floating top-left hamburger goes away under `lg`; the drawer stays.
5. **The service worker runs in production builds only.** In `next dev` it is not registered, and any old registration is removed so dev never serves stale code.
6. **An update shows a toast:** "A new version of Forma is ready" with a Reload button. Never auto-reload while the user may be typing.
7. **Install entry point:** a quiet "Install app" row in the sidebar footer. It appears only when the browser offered `beforeinstallprompt`, or on iOS Safari when not already installed (then it opens a small dialog: Share, then "Add to Home Screen"). It never appears in standalone mode. No pop-up banners.
8. **Theme:** `theme_color` and `background_color` are both `#1D1B19` (the `background` token; manifest and viewport can't read CSS variables, so this is the one allowed raw hex, with a comment). `display: "standalone"`, `orientation: "portrait"`, `start_url: "/today"`, `scope: "/"`, `id: "/"`.

## Milestones

Each milestone ends green on the Gate (`WORKFLOW.md`) and is committed separately.

### P0: Mobile check harness (tooling)

The team's eyes on a phone screen. Without it, nobody can see the layout work.

- `scripts/mobile-check.mjs` plus the npm script `test:mobile`. It:
  - runs against a production build (`next build && next start` on a free port) using the local `forma_test` DB from `scripts/test-db.sh`;
  - starts a tiny **mock Supabase auth server** on localhost (answers `GET /auth/v1/user` with a fixed test user, plus anything else `@supabase/ssr` calls on a normal page load), points `NEXT_PUBLIC_SUPABASE_URL` at it, and sets the matching `sb-<ref>-auth-token` session cookie in the browser so app pages render signed in. Read `node_modules/@supabase/ssr` and `@supabase/auth-js` to get the cookie name and format right; never call real Supabase;
  - seeds the test user's data (a project with a few tasks across statuses, A–E labels, a frog for today, a habit, a calendar block) directly in `forma_test`;
  - uses the preinstalled Playwright (`require('playwright')` works from any directory; do **not** run `playwright install` or add it to package.json) at two viewports: 390×844 (iPhone 14, `isMobile`, `hasTouch`, DPR 3) and 360×740 (small Android);
  - visits every page: `/login`, `/signup`, `/dashboard`, `/today`, `/today/label`, `/today/new`, `/group/<id>`, `/calendar` (month, week, day), `/habits`, `/review`, `/reports`, `/pomodoro`, plus open states: task detail, command palette, sidebar drawer;
  - asserts **no horizontal page overflow** (`scrollWidth <= innerWidth + 1` on the document and on `main`), and reports any visible interactive element smaller than 32×32 CSS px as a warning, not a failure (the target is 44 px; some dense controls are allowed down to 32);
  - saves screenshots to `.mobile-shots/<viewport>/<page>.png` (add `.mobile-shots/` to `.gitignore`) and prints a pass/fail table;
  - takes `--only <page>` to check one page.
- Record the starting results in `PROGRESS.md` (which pages overflow today). P0 doesn't fix anything.
- If signed-in pages can't be rendered after a real effort, ship the harness for the public pages, write the blocker in `PROGRESS.md`, and carry on: later milestones then rely on code review plus jsdom tests.

### P1: Installable app

- `app/manifest.ts` (`MetadataRoute.Manifest`): name "Forma", short_name "Forma", the description from `app/layout.tsx`, the decisions in item 8 above, `categories: ["productivity"]`, and icons below. Read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/manifest.md`.
- Icons from `app/favicon.svg` (orange rounded square with the dark F), generated by `scripts/generate-icons.mjs` with `sharp` (already installed through Next) and committed to `public/icons/`:
  - `icon-192.png`, `icon-512.png` (`purpose: "any"`);
  - `maskable-512.png` (`purpose: "maskable"`): full-bleed orange background with the F scaled into the central 80% safe zone;
  - `apple-touch-icon.png` 180×180, no transparency, no rounded corners (iOS rounds them).
- `app/layout.tsx` metadata: `manifest`, `appleWebApp: { capable: true, title: "Forma", statusBarStyle: "black-translucent" }`, apple-touch icon, `formatDetection: { telephone: false }`. Viewport: keep `themeColor` and `colorScheme`, add `viewportFit: "cover"`. Don't disable zoom.
- `proxy.ts` matcher: let `manifest.webmanifest`, `sw.js`, `icons/*` and `offline` through without the auth redirect (otherwise a signed-out phone gets the login page HTML as its manifest).
- `next.config.ts` `headers()`: `/sw.js` gets `Cache-Control: no-cache, no-store, must-revalidate`, `Content-Type: application/javascript; charset=utf-8`, and `Content-Security-Policy: default-src 'self'; script-src 'self'`, as in the guide.
- Tests: unit test for the manifest object (required fields, icon files exist on disk with the stated pixel sizes); a test of the proxy matcher config.

### P2: Service worker, offline page, updates

- `app/offline/page.tsx`: static, no auth, no data. The F mark, "You're offline", "Forma will reload when you're back online", and a Retry button. Ember styling.
- `public/sw.js` (plain JS, no build step). Versioned cache names (`forma-static-v<N>`, `forma-pages-v<N>`); bump `<N>` in one constant.
  - `install`: precache `/offline`, the icons and the manifest. Don't call `skipWaiting()` on install (see updates).
  - `activate`: delete caches from older versions; `clients.claim()`.
  - `fetch` routing, in this order:
    1. not GET, or not same-origin → pass through (don't call `respondWith`);
    2. `/api/`, `/auth/`, `/login`, `/signup`, `/_next/data/`, any request with an `RSC` header or `_rsc` param, `/sw.js` → pass through, never cached;
    3. `/_next/static/`, `/icons/`, fonts → cache first, then network (and store);
    4. navigations (`request.mode === "navigate"`) → network first with a 5 s timeout; store a clone of successful 200 HTML in `forma-pages`; on failure serve the cached copy of that URL, else `/offline`;
    5. everything else → pass through.
  - `message` handler: `{ type: "SKIP_WAITING" }` → `skipWaiting()`; `{ type: "CLEAR_RUNTIME_CACHES" }` → delete `forma-pages-*` and reply when done.
  - Put the routing decision in a pure function `routeFor(url, request)` in the same file, exposed for tests (for example `self.__formaRouteFor`), so tests can load `sw.js` in a `vm` context with stub globals and check every rule.
- `components/pwa/ServiceWorkerRegister.tsx` (client), mounted once in `app/layout.tsx`:
  - production: `navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })`; check for updates on `visibilitychange` back to visible (at most once per 30 min);
  - when a new worker is `installed` and a controller already exists, show the update toast (decision 6); Reload posts `SKIP_WAITING`, then reloads once on `controllerchange`;
  - development: unregister any existing registration and clear `forma-*` caches.
- Sign-out (`components/sidebar/Sidebar.tsx` `signOut`): before redirecting, post `CLEAR_RUNTIME_CACHES` to the active worker and wait for the reply (at most 1 s).
- `components/pwa/OfflineBanner.tsx`: a thin bar at the top of the app shell while `navigator.onLine` is false: "You're offline. Changes won't save until you reconnect." Uses `useSyncExternalStore` on `online`/`offline` events.
- Tests: SW routing for every rule above (vm), cache-version cleanup, the message handlers; UI tests for the update toast flow and the offline banner (stub `navigator.serviceWorker`).

### P3: Mobile app shell

- `app/(app)/layout.tsx`: `h-screen` → `h-dvh`; drop the `pl-12 lg:pl-0` hack; respect safe areas (`env(safe-area-inset-*)`): top inset on the shell, bottom inset under the tab bar. Add small utilities in `globals.css` (for example `.pt-safe`, `.pb-safe`, `.pb-tabbar`).
- `components/mobile/BottomTabBar.tsx` (decision 4), shown `lg:hidden`, fixed to the bottom, `surface` background with a `border` top edge, 5 items, each at least 44 px tall, icon plus short label. The active item uses the orange active state; Add is the one primary action. `aria-current="page"` on the active tab; `nav` with `aria-label="Primary"`.
- Sidebar: under `lg` the drawer opens only from More (expose an open/close store like the command palette does, for example `openSidebar()`); remove the floating hamburger under `lg`. Desktop unchanged.
- `main` gets bottom padding equal to the tab bar height plus the safe area under `lg`, so nothing hides behind the bar.
- Mount `OfflineBanner` in the shell.
- Install entry point (decision 7): `components/pwa/InstallAppButton.tsx` and the iOS instructions dialog, in the sidebar footer.
- Global mobile CSS in `globals.css`: under `lg`, text inputs, selects and textareas use at least 16px font (stops iOS zoom on focus); `-webkit-tap-highlight-color: transparent`; `overscroll-behavior-y: none` on the shell so the page doesn't rubber-band behind the tab bar.
- Command palette under `sm`: full width, pinned to the top with the safe-area inset, list height limited so it fits above the keyboard (`max-h-[50dvh]`).
- Tests: UI tests for BottomTabBar (active tab, Add opens the palette in add mode, More opens the drawer), InstallAppButton (hidden in standalone, shown on `beforeinstallprompt`, iOS dialog). Mobile harness: the shell has no overflow on any page.

### P4: Page pass A (daily flow)

Make every listed screen work at 360px with no horizontal overflow, readable text, and comfortable tap targets. Don't change desktop rendering at `lg` and up.

- `/dashboard`: cards stack in one column; the frog card and habits card stay full width.
- `/today`, `/today/label`, `/today/new`, the Close the day flow, Day closed card, Rough sheet: the plan stepper wraps or scrolls inside its own row; row actions are visible without hover (no hover-only controls on touch: use `@media (hover: hover)` or always-visible under `lg`); A–E pickers are at least 36 px.
- Task detail (`components/task/TaskDetail.tsx`): under `md` it opens as a full-screen sheet (full height with `dvh`, safe-area padding, a sticky header with close), and its dropdown menus stay inside the viewport.
- Dialogs and menus (`components/ui/dialog.tsx`, `ConfirmDialog`, `DatePicker`, dropdowns): never wider than the viewport minus 16px gutters; date picker fits at 360px.
- Tests: extend the existing component tests only where behaviour changes (for example task detail sheet mode); the harness checks overflow for every page in this pass.

### P5: Page pass B (planning and insight)

- Board (`/group/[id]`, `KanbanBoard`, `Column`, `TaskCard`): columns scroll horizontally with CSS scroll snap, each column about 85vw (max 320px) so the next one peeks in; vertical scrolling stays inside columns; the touch drag delay stays (200ms) so scrolling isn't mistaken for dragging; card actions visible without hover.
- Calendar: month grid fits 360px (compact day cells, dot indicators instead of chips under `sm` if needed); week agenda and day planner use `dvh` heights (`DayPlanner` uses `calc(100vh-12rem)` today); the tray works as a bottom sheet under `sm`.
- `/habits`, `/review`, `/reports` (charts scale to the container width, legends wrap), `/login`, `/signup` (`min-h-dvh`, safe areas).
- `/pomodoro`: only `100vh` → `100dvh` and safe-area padding. No logic changes, no Spotify changes.
- Tests: same approach as P4.

### P6: Polish and final sweep

- Manifest `shortcuts`: Today (`/today`), Quick add (`/today?capture=1`, which opens the command palette in add mode; add that query handling to `CommandPalette` and drop the param from the URL afterwards), Calendar (`/calendar`). Shortcut icons: 96×96 PNGs, generated by the same script.
- Standalone niceties: under `display-mode: standalone`, no text selection on nav chrome; links that leave the origin open in the system browser (`target="_blank" rel="noopener"` where they don't already).
- Full harness sweep: every page, both viewports, zero overflow; fix what's left. Paste the final table into `PROGRESS.md`.
- `docs/mobile-pwa/README.md`: how to install on Android and iOS, how updates arrive, what offline does and doesn't do, how to run `npm run test:mobile`, and how to bump the SW cache version.
