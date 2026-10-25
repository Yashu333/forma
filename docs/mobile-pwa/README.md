# Forma on the phone

Forma is a progressive web app: it installs to a phone's home screen and opens full screen, with its own icon and no browser bar. It's the same app, auth and API as on desktop. The build plan is in `SPEC.md` and the decisions made along the way are in `PROGRESS.md`.

## Install it

**Android (Chrome):** open Forma and sign in, then use the Chrome menu (⋮) → **Install app**. When Chrome offers installation, the sidebar footer also shows an **Install app** row (open it from **More** in the tab bar), which brings up the same prompt.

**iPhone and iPad (Safari):** open Forma in Safari, tap **Share**, then **Add to Home Screen**. In Safari, the **Install app** row in the sidebar footer shows these steps in a small dialog.

The row never shows inside the installed app. Safari can't tell that Forma was added to the home screen, so it keeps showing there in a Safari tab. A long press on the home-screen icon shows three shortcuts: **Today**, **Quick add** (opens Today with the add box ready, via `/today?capture=1`) and **Calendar**.

## Updates

- Pages always come from the network when it's there, so an app deploy shows up on the next page load. No action needed.
- The **"A new version of Forma is ready"** toast with a **Reload** button appears only when `public/sw.js` itself changes. Forma never reloads by itself, so nothing typed is lost.
- App deploys don't change `sw.js`, so they don't show the toast. Bump `CACHE_VERSION` at the top of `public/sw.js` whenever you change `sw.js`, the icons in `public/icons/` or the manifest (`app/manifest.ts`). Icons and the manifest are cached under fixed URLs, so without a bump installed apps keep the old ones. A bump also clears old cached chunks.
- `CACHE_VERSION` 1 is the first shipped version. The manifest and the icons changed during the mobile build without a bump because nothing had shipped yet, so anyone who installed a preview of that branch should uninstall it or clear the site's data.
- The icons are generated: change `app/favicon.svg`, then run `node scripts/generate-icons.mjs` and commit `public/icons/`.

## Offline

What it does:

- The app opens without a connection. Pages you've visited show their last copy, and any other page shows a "You're offline" screen that reloads itself when the connection comes back.
- A bar at the top says "You're offline. Changes won't save until you reconnect."

What it doesn't do:

- No offline editing, queued changes or background sync. Anything you change while offline isn't saved.
- No offline copy of your data. Only the HTML of pages you've opened is kept, and only as a fallback.
- Nothing from `/api`, `/auth`, `/login` or `/signup` is ever cached. Signing out clears the stored pages, so a shared phone doesn't show the last person's tasks.
- The service worker only runs in production builds. `next dev` removes any old registration.

## Mobile check harness

`npm run test:mobile` builds the app, signs in a test user and checks every page at 390×844 (iPhone 14) and 360×740 (small Android) in Chromium. A page fails if it scrolls sideways; controls smaller than 32×32 px are listed as warnings. Screenshots go to `.mobile-shots/<viewport>/<page>.png` and details to `.mobile-shots/report.json`.

It needs:

- local Postgres with the test database: run `bash scripts/test-db.sh` first (it empties `forma_test`, so don't run the integration tests at the same time);
- the preinstalled Playwright Chromium (`require("playwright")`); don't run `playwright install` or add it to `package.json`;
- nothing from Supabase: a mock auth server on `127.0.0.1:54399` answers for the test user, and every off-machine request is blocked.

It builds into the normal `.next`, with the Supabase URL pointing at the mock auth server, so after a harness run do `npm run build` before `npm start`.

Useful flags: `--only today,calendar-month` checks some pages, `--skip-build` reuses the last harness build, and `--verbose` lists each small target. Run with `--help` for the page names.

**Tip, desktop must not change:** to prove a change leaves desktop alone, build the base commit in a git worktree and your tree side by side, start both with the same mock auth and seed, screenshot the same pages at 1280×800 from each, and count differing pixels (expect 0). Comparing every element's layout box as well catches changes hidden below the fold.

## Check on a real phone

Chromium in the harness reports every safe-area inset as 0 and can't install apps, so check these by hand before a release:

- iPhone with a notch or Dynamic Island: nothing hides under the status bar or the home indicator, in the tab bar, the open drawer, task detail, the command palette and the calendar's Unscheduled sheet.
- iPhone: the status bar is black-translucent (the app draws under it, with light status text), not an opaque bar.
- Android: install from the Chrome menu and from the **Install app** row; the icon, name and splash colour look right; the three shortcuts work, and **Quick add** opens the add box.
- iPhone: Add to Home Screen from Safari's Share sheet; the app opens full screen at Today.
- Updates: after a `CACHE_VERSION` bump, the toast appears on the installed app and **Reload** brings in the new version.
- Offline: turn on airplane mode, open the app, see the offline screen or the last copy of a page; turn it off and the page reloads.
- Pomodoro from the installed app (the sidebar, a task's Focus, the frog card): it opens inside the app, signed in, not in Safari or a browser tab.
- Android shortcut icons: they're `any`-purpose only (no maskable version), so a launcher may put them on a white disc. Check they still read well.
- iPad with a pen: a board card and a calendar task can be dragged with the pen (on a screen that can't sense a hovering pen, after a short hold, like a finger); a finger swipe on a card still scrolls.
