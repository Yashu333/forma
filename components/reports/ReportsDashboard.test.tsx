// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ReportsDashboard from "./ReportsDashboard";
import type { ReportsData } from "./types";
import type { FrogReport } from "@/lib/frog/reports";
import { DATE, deferred, freezeNow, httpError, mockApi } from "../../tests/ui/fixtures";

const NOW = "2026-10-24T08:00:00Z";
const REPORTS = "GET /api/reports";
const FROG = "GET /api/reports/frog";

const shift = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function reports(o: Partial<ReportsData> = {}): ReportsData {
  const days = Array.from({ length: 7 }, (_, i) => ({ date: shift(DATE, i - 6), completed: i, created: 1 }));
  return {
    range: { days: 7, start: "2026-10-18T00:00:00.000Z", end: "2026-10-24T12:00:00.000Z", bucketDays: 1 },
    groups: [
      { id: "g1", name: "Work", color: "#7C6EF8" },
      { id: "g2", name: "Home", color: "#34D399" },
    ],
    kpis: { throughput: 12, avgCycleTime: 2.2, wip: 3, completionRate: 75, createdInWindow: 8, totalTasks: 20 },
    days,
    cfd: days.map((d) => ({ date: d.date, done: d.completed, inProgress: 2 })),
    byPriority: [
      { priority: "URGENT", total: 1, done: 1 },
      { priority: "HIGH", total: 4, done: 2 },
      { priority: "MEDIUM", total: 10, done: 6 },
      { priority: "LOW", total: 5, done: 3 },
    ],
    byProject: [
      { id: "g1", name: "Work", color: "#7C6EF8", total: 12, done: 8, wip: 2, completedInWindow: 6 },
      { id: "g2", name: "Home", color: "#34D399", total: 8, done: 4, wip: 1, completedInWindow: 2 },
    ],
    completedTasks: [],
    recentActivity: [{ id: "a1", action: "created", createdAt: "2026-10-23T10:00:00.000Z", taskTitle: "Buy milk", projectName: "Home", projectColor: "#34D399" }],
    ...o,
  };
}

function frogReport(o: Partial<FrogReport> = {}): FrogReport {
  return {
    stats: { plannedDays: 4, eatenDays: 3, eatenRate: 0.75, beforeNoonRate: 2 / 3, current: 2, longest: 3 },
    daily: Array.from({ length: 7 }, (_, i) => ({ date: shift(DATE, i - 6), planned: i > 2, eaten: i > 3, beforeNoon: i === 4 })),
    abcdeCompleted: { A: 2, B: 1, C: 0, D: 0, E: 0, none: 4 },
    reflections: [{ date: "2026-10-23", rating: 4, wentWell: "Good focus", improve: null, frogTitle: "Ship it", eaten: true }],
    ...o,
  };
}

async function setup(opts: { data?: ReportsData; frog?: unknown } = {}) {
  freezeNow(NOW);
  const api = mockApi({ [REPORTS]: opts.data ?? reports(), [FROG]: opts.frog ?? frogReport() });
  render(<ReportsDashboard />);
  return api;
}

describe("ReportsDashboard with the Frog section", () => {
  it("still renders all of its existing parts, plus the Frog section after them", async () => {
    await setup();
    await screen.findByText("Throughput");
    expect(screen.getByRole("heading", { name: /^reports$/i })).toBeInTheDocument();
    for (const t of ["Completed", "Avg cycle time", "In progress", "Completion rate"]) expect(screen.getAllByText(t).length).toBeGreaterThan(0);
    for (const t of ["Throughput", "Cumulative flow", "By priority", "By project", "Recent activity"]) expect(screen.getByText(t)).toBeInTheDocument();
    expect(screen.getByText("Buy milk")).toBeInTheDocument();

    const frog = await screen.findByRole("region", { name: /eat that frog/i });
    await within(frog).findByText("Current streak");
    const recent = screen.getByText("Recent activity");
    // The Frog section comes after the last existing card in document order.
    expect(recent.compareDocumentPosition(frog) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the existing KPI numbers are unchanged", async () => {
    await setup();
    await screen.findByText("Throughput");
    const tile = (label: string) => screen.getAllByText(label, { selector: "span[style*='uppercase']" })[0].closest(".rounded-2xl") as HTMLElement;
    expect(tile("Completed")).toHaveTextContent("12in 30d");
    expect(tile("Completion rate")).toHaveTextContent("75%");
    expect(tile("In progress")).toHaveTextContent("3active");
  });

  it("requests /api/reports and /api/reports/frog with the same default range", async () => {
    const api = await setup();
    await screen.findByText("Current streak");
    expect(api.to(REPORTS)).toHaveLength(1);
    expect(api.to(REPORTS)[0].query.get("days")).toBe("30");
    expect(api.to(FROG)).toHaveLength(1);
    expect(api.to(FROG)[0].query.get("days")).toBe("30");
  });

  it("the page's range selector drives both: 7 days, 90 days, All time", async () => {
    const api = await setup();
    await screen.findByText("Current streak");
    for (const [label, days] of [["7 days", "7"], ["90 days", "90"], ["All time", "all"]] as const) {
      await userEvent.click(screen.getByRole("button", { name: label }));
      await waitFor(() => expect(api.to(FROG).at(-1)!.query.get("days")).toBe(days));
      await waitFor(() => expect(api.to(REPORTS).at(-1)!.query.get("days")).toBe(days));
    }
    expect(screen.getByText("One square per day, all time")).toBeInTheDocument();
  });

  it("picking a project filters the old charts but not the frog stats, and says so", async () => {
    const api = await setup();
    await screen.findByText("Current streak");
    expect(screen.queryByText(/project filter above/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /all projects/i }));
    await userEvent.click(await screen.findByRole("button", { name: /^Work$/ }));
    await waitFor(() => expect(api.to(REPORTS).at(-1)!.query.get("groupId")).toBe("g1"));
    expect(await screen.findByText(/project filter above/)).toBeInTheDocument();
    // The frog endpoint never got the project and was not refetched for it.
    expect(api.to(FROG)).toHaveLength(1);
    expect(api.to(FROG)[0].query.has("groupId")).toBe(false);
    // And back to all projects: the note is gone.
    await userEvent.click(screen.getByRole("button", { name: /work/i }));
    await userEvent.click(await screen.findByRole("button", { name: /all projects/i }));
    await waitFor(() => expect(screen.queryByText(/project filter above/)).not.toBeInTheDocument());
  });

  it("a failing frog request does not take the rest of the page down", async () => {
    await setup({ frog: httpError(500, "frog route exploded") });
    expect(await screen.findByRole("alert")).toHaveTextContent("frog route exploded");
    expect(screen.getByText("Throughput")).toBeInTheDocument();
    expect(screen.getByText("Recent activity")).toBeInTheDocument();
    expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);
  });

  it("the Frog section's skeleton does not block the existing charts", async () => {
    freezeNow(NOW);
    const gate = deferred<unknown>();
    mockApi({ [REPORTS]: reports(), [FROG]: () => gate.promise });
    render(<ReportsDashboard />);
    expect(await screen.findByText("Throughput")).toBeInTheDocument();
    expect(await screen.findByRole("status", { name: /loading frog stats/i })).toBeInTheDocument();
    await act(async () => gate.resolve(frogReport()));
    expect(await screen.findByText("Current streak")).toBeInTheDocument();
  });

  it("does not fetch frog stats before the main report has loaded (the section mounts with the data)", async () => {
    freezeNow(NOW);
    const gate = deferred<unknown>();
    const api = mockApi({ [REPORTS]: () => gate.promise, [FROG]: frogReport() });
    render(<ReportsDashboard />);
    expect(await screen.findByText("Loading reports…")).toBeInTheDocument();
    expect(api.to(FROG)).toHaveLength(0);
    await act(async () => gate.resolve(reports()));
    await screen.findByText("Current streak");
    expect(api.to(FROG)).toHaveLength(1);
  });

  it("while the main report refetches for a new range the task report is dimmed, not replaced", async () => {
    freezeNow(NOW);
    const gate = deferred<unknown>();
    mockApi({ [REPORTS]: (c) => (c.query.get("days") === "30" ? reports() : gate.promise), [FROG]: frogReport() });
    render(<ReportsDashboard />);
    await screen.findByText("Current streak");
    await userEvent.click(screen.getByRole("button", { name: "7 days" }));
    expect(screen.getByText("Throughput")).toBeInTheDocument();
    expect(screen.getByText("Current streak")).toBeInTheDocument();
    await act(async () => gate.resolve(reports()));
  });

  it("an empty project (no tasks) shows the empty state AND the Frog section below it, once", async () => {
    const api = await setup({ data: reports({ kpis: { throughput: 0, avgCycleTime: 0, wip: 0, completionRate: 0, createdInWindow: 0, totalTasks: 0 } }) });
    const empty = await screen.findByText("No data to report yet");
    const frog = await screen.findByRole("region", { name: /eat that frog/i });
    await within(frog).findByText("Current streak");
    expect(screen.getAllByRole("region", { name: /eat that frog/i })).toHaveLength(1);
    expect(empty.compareDocumentPosition(frog) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(api.to(FROG)).toHaveLength(1);
  });

  it("when /api/reports fails the Frog section is still shown (below the empty state)", async () => {
    const api = await setup({ data: httpError(500, "reports exploded") as unknown as ReportsData });
    const empty = await screen.findByText("No data to report yet");
    const frog = await screen.findByRole("region", { name: /eat that frog/i });
    await within(frog).findByText("Current streak");
    expect(empty.compareDocumentPosition(frog) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(api.to(FROG)).toHaveLength(1);
  });

  it("changing the project filter neither remounts, refetches nor dims the Frog section", async () => {
    freezeNow(NOW);
    const gate = deferred<unknown>();
    const api = mockApi({ [REPORTS]: (c) => (c.query.get("groupId") === "g1" ? gate.promise : reports()), [FROG]: frogReport() });
    render(<ReportsDashboard />);
    const before = await screen.findByRole("region", { name: /eat that frog/i });
    await within(before).findByText("Current streak");

    await userEvent.click(screen.getByRole("button", { name: /all projects/i }));
    await userEvent.click(await screen.findByRole("button", { name: /^Work$/ }));
    await waitFor(() => expect(api.to(REPORTS).at(-1)!.query.get("groupId")).toBe("g1"));
    // The task report is mid-refetch (dimmed); the Frog section is the same element, fully opaque, and not busy.
    const during = screen.getByRole("region", { name: /eat that frog/i });
    expect(during).toBe(before);
    expect(during.querySelector("[aria-busy]")).toHaveAttribute("aria-busy", "false");
    expect((during.querySelector("[aria-busy]") as HTMLElement).style.opacity).toBe("1");
    expect(during.closest("[style*='opacity']")).toBeNull();

    await act(async () => gate.resolve(reports()));
    await screen.findByText(/project filter above/);
    expect(screen.getByRole("region", { name: /eat that frog/i })).toBe(before);
    expect(api.to(FROG)).toHaveLength(1);
  });

  it("the Reports title is still the only h1 and the Frog heading is an h2 inside its region", async () => {
    await setup();
    await screen.findByText("Current streak");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { name: /eat that frog/i, level: 2 })).toBeInTheDocument();
  });

  it("does not log React warnings (keys, act, hydration)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await setup();
    await screen.findByText("Current streak");
    expect(errors).not.toHaveBeenCalled();
  });
});
