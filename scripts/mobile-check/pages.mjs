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

/** Opens the sidebar drawer from the bottom tab bar's More (P3 removed the hamburger). */
async function openDrawer(page) {
  const more = page.locator('nav[aria-label="Primary"]').getByRole("button", { name: /^more$/i });
  await more.click({ timeout: 5000 });
  await page.locator('nav[aria-label="Primary"] button[aria-controls="app-sidebar"][aria-expanded="true"]').waitFor({ timeout: 3000 });
  await page.waitForTimeout(400); // slide-in transition
}

/** Opens the task detail sheet (the page's `?task=` param), then a pill's popover. `pill(sheet)` finds the pill. */
function openTaskPopover(pill, popover) {
  return async (page) => {
    const sheet = page.locator('[role="dialog"][aria-label="Task details"]');
    await sheet.waitFor({ state: "visible", timeout: 10000 });
    await page.waitForTimeout(300); // slide-in animation
    await pill(sheet).first().click({ timeout: 5000 });
    await page.locator(popover).first().waitFor({ state: "visible", timeout: 3000 });
    await page.waitForTimeout(350); // open animation
  };
}

/** Today → "Close the day" (the flow takes over the page). */
async function openCloseDay(page) {
  await page.getByRole("button", { name: "Close the day" }).click({ timeout: 10000 });
  await page.getByRole("list", { name: "Steps" }).waitFor({ state: "visible", timeout: 5000 });
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
    // P4: the due-date picker and the ABCDE menu must stay inside the screen.
    {
      key: "task-detail-date",
      path: `/group/${ids.groupId}?task=${ids.taskId}`,
      open: openTaskPopover((sheet) => sheet.locator('button[aria-haspopup="dialog"]'), '[role="dialog"][aria-label="Choose due date"]'),
    },
    {
      key: "task-detail-abcde",
      path: `/group/${ids.groupId}?task=${ids.taskId}`,
      open: openTaskPopover((sheet) => sheet.getByRole("button", { name: /^(ABCDE|[A-E] · )/ }), '[role="dialog"][aria-label="Task details"] .dropdown-menu'),
    },
    { key: "today-close", path: "/today", open: openCloseDay },
    { key: "command-palette", path: "/dashboard", open: openPalette },
    { key: "sidebar-drawer", path: "/dashboard", open: openDrawer },
  ];
}
