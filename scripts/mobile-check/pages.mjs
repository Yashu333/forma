// The pages and open states the mobile harness visits (SPEC P0).
// `auth: false` pages are checked signed out (the proxy sends a signed-in user
// away from /login and /signup). `open` runs after the page settles and must
// leave the state to check on screen.

/** Opens the command palette through its public event (the sidebar rows use the same one). */
async function openPalette(page) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("open-command-palette", { detail: { mode: "search" } })));
  try {
    await page.locator('[role="dialog"]').first().waitFor({ state: "visible", timeout: 3000 });
  } catch {
    // Fallback: the keyboard shortcut.
    await page.keyboard.press("Control+k");
    await page.locator('[role="dialog"]').first().waitFor({ state: "visible", timeout: 5000 });
  }
}

/** Opens the sidebar drawer: the hamburger today, the bottom tab bar's More from P3 on. */
async function openDrawer(page) {
  const candidates = [
    page.locator('nav[aria-label="Primary"]').getByRole("button", { name: /^more$/i }),
    page.getByRole("button", { name: "Toggle sidebar" }),
    page.getByRole("button", { name: /open (the )?(sidebar|menu)/i }),
  ];
  for (const c of candidates) {
    const el = c.first();
    if ((await el.count()) && (await el.isVisible())) {
      await el.click();
      await page.waitForTimeout(400); // slide-in transition
      return;
    }
  }
  throw new Error("no visible control opens the sidebar drawer");
}

/**
 * @param {{ groupId: string, taskId: string }} ids
 */
export function pageList(ids) {
  return [
    { key: "login", path: "/login", auth: false },
    { key: "signup", path: "/signup", auth: false },
    { key: "dashboard", path: "/dashboard" },
    { key: "today", path: "/today" },
    { key: "today-label", path: "/today/label" },
    { key: "today-new", path: "/today/new" },
    { key: "group", path: `/group/${ids.groupId}` },
    { key: "calendar-month", path: "/calendar?view=month" },
    { key: "calendar-week", path: "/calendar?view=week" },
    { key: "calendar-day", path: "/calendar?view=day" },
    { key: "habits", path: "/habits" },
    { key: "review", path: "/review" },
    { key: "reports", path: "/reports" },
    { key: "pomodoro", path: "/pomodoro" },
    {
      key: "task-detail",
      path: `/group/${ids.groupId}?task=${ids.taskId}`,
      open: (page) => page.locator('[role="dialog"][aria-label="Task details"]').waitFor({ state: "visible", timeout: 10000 }),
    },
    { key: "command-palette", path: "/dashboard", open: openPalette },
    { key: "sidebar-drawer", path: "/dashboard", open: openDrawer },
  ];
}
