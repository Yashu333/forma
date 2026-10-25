// The bottom tab bar's active tab (docs/mobile-pwa/SPEC.md, decision 4).

export type TabKey = "today" | "board" | "calendar";

/** Which tab is the current page, if any. Add and More are never "active". */
export function activeTab(pathname: string): TabKey | null {
  if (pathname === "/today" || pathname.startsWith("/today/")) return "today";
  if (pathname === "/dashboard" || pathname.startsWith("/group/")) return "board";
  if (pathname === "/calendar" || pathname.startsWith("/calendar/")) return "calendar";
  return null;
}
