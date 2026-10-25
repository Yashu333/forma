import { describe, expect, it } from "vitest";
import { activeTab } from "./mobile-tabs";

describe("activeTab", () => {
  it("Today for /today and its sub-pages", () => {
    expect(activeTab("/today")).toBe("today");
    expect(activeTab("/today/label")).toBe("today");
    expect(activeTab("/today/new")).toBe("today");
  });

  it("Board for the dashboard and every project board", () => {
    expect(activeTab("/dashboard")).toBe("board");
    expect(activeTab("/group/abc")).toBe("board");
  });

  it("Calendar for /calendar", () => {
    expect(activeTab("/calendar")).toBe("calendar");
  });

  it("none for the pages only the drawer lists", () => {
    for (const p of ["/habits", "/review", "/reports", "/pomodoro", "/"]) expect(activeTab(p)).toBeNull();
  });

  it("does not match look-alike paths", () => {
    expect(activeTab("/todayish")).toBeNull();
    expect(activeTab("/dashboards")).toBeNull();
    expect(activeTab("/group")).toBeNull();
    expect(activeTab("/calendars")).toBeNull();
  });
});
