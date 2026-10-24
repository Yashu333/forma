// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CalendarView from "./CalendarView";
import RepeatPicker from "@/components/task/RepeatPicker";
import { monthGrid, rescheduleIso, weekDays, type CalTask, type CalendarPayload } from "./types";
import type { RepeatRule } from "@/lib/recurrence/rule";
import { freezeNow, httpError, mockApi, type Api } from "../../tests/ui/fixtures";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/calendar",
}));

// Saturday 24 October 2026, 10:00 in Berlin. October's grid runs Mon 28 Sep to Sun 8 Nov.
const WORK = { id: "g-work", name: "Work", color: "#7C6EF8" };

function calTask(o: Partial<CalTask> & { id: string; title: string }): CalTask {
  return {
    groupId: WORK.id, statusId: "s-todo", priority: "MEDIUM", dueDate: null, repeat: null,
    abcde: null, abcdeRank: null, completedAt: null, group: WORK, done: false, ...o,
  };
}

function payload(o: Partial<CalendarPayload> = {}): CalendarPayload {
  return {
    tasks: [], overdue: [], unscheduled: [], recurring: [],
    statusesByGroup: { [WORK.id]: [{ id: "s-todo", name: "To Do", groupId: WORK.id, order: 0, celebrate: false }, { id: "s-done", name: "Done", groupId: WORK.id, order: 1, celebrate: true }] },
    ...o,
  };
}

let api: Api;
function setup(p: CalendarPayload = payload(), extra: Record<string, unknown> = {}) {
  api = mockApi({
    "GET /api/calendar": p,
    "GET /api/tasks/t1": { id: "t1", title: "Dentist", groupId: WORK.id, statusId: "s-todo", priority: "MEDIUM", order: 0, createdBy: "u1", createdAt: "", updatedAt: "", dueDate: "2026-10-21T08:30:00.000Z", subtasks: [], comments: [], focus: { totalSec: 0, sessions: 0 } },
    ...extra,
  });
  return render(<CalendarView userId="u1" />);
}

beforeEach(() => {
  freezeNow("2026-10-24T08:00:00Z");
  localStorage.clear();
  // jsdom is 1024 wide by default: the month view is the desktop default
});

describe("grid helpers", () => {
  it("monthGrid has six Monday-first weeks around the month", () => {
    const g = monthGrid("2026-10-24");
    expect(g).toHaveLength(42);
    expect(g[0]).toBe("2026-09-28");
    expect(g[41]).toBe("2026-11-08");
  });
  it("monthGrid starts the Monday of the first week even when the 1st is a Monday", () => {
    expect(monthGrid("2026-06-15")[0]).toBe("2026-06-01");
  });
  it("weekDays is Monday to Sunday", () => {
    expect(weekDays("2026-10-25")).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
  });
  it("rescheduleIso keeps the time of day, and gives an undated task the next full hour", () => {
    const moved = new Date(rescheduleIso(calTask({ id: "a", title: "a", dueDate: new Date(2026, 9, 21, 10, 30).toISOString() }), "2026-10-29"));
    expect([moved.getFullYear(), moved.getMonth(), moved.getDate(), moved.getHours(), moved.getMinutes()]).toEqual([2026, 9, 29, 10, 30]);
    const fresh = new Date(rescheduleIso(calTask({ id: "b", title: "b" }), "2026-10-29"));
    expect([fresh.getDate(), fresh.getHours(), fresh.getMinutes()]).toEqual([29, 11, 0]); // 10:00 now
  });
});

describe("CalendarView: month", () => {
  it("asks for the visible grid in the user's zone", async () => {
    setup();
    await screen.findByRole("heading", { name: "October 2026" });
    await waitFor(() => expect(api.to("GET /api/calendar")).toHaveLength(1));
    const q = api.to("GET /api/calendar")[0].query;
    expect([q.get("from"), q.get("to"), q.get("tz")]).toEqual(["2026-09-28", "2026-11-08", "Europe/Berlin"]);
  });

  it("puts each task in its day with its time", async () => {
    setup(payload({ tasks: [calTask({ id: "t1", title: "Dentist", dueDate: "2026-10-21T08:30:00.000Z" })] }));
    const chip = await screen.findByRole("button", { name: /Dentist/ });
    expect(chip).toHaveTextContent("10:30 am");
    expect(chip.closest('[role="gridcell"]')).toHaveTextContent(/^21/);
  });

  it("sorts a day by time and marks done tasks", async () => {
    setup(payload({
      tasks: [
        calTask({ id: "b", title: "Later", dueDate: "2026-10-28T15:00:00.000Z" }),
        calTask({ id: "a", title: "Earlier", dueDate: "2026-10-28T07:00:00.000Z", done: true }),
      ],
    }));
    await screen.findByText("Earlier");
    const cell = screen.getByText("Later").closest('[role="gridcell"]')!;
    const names = within(cell as HTMLElement).getAllByRole("button").map((b) => b.textContent);
    expect(names.findIndex((n) => n?.includes("Earlier"))).toBeLessThan(names.findIndex((n) => n?.includes("Later")));
    expect(screen.getByText("Earlier")).toHaveClass("line-through");
  });

  it("shows three chips then '+N more', which expands the day", async () => {
    const tasks = Array.from({ length: 5 }, (_, i) => calTask({ id: `t${i}`, title: `Task ${i}`, dueDate: `2026-10-28T0${i + 5}:00:00.000Z` }));
    setup(payload({ tasks }));
    const user = userEvent.setup();
    await screen.findByText("Task 0");
    expect(screen.queryByText("Task 4")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "+2 more" }));
    expect(screen.getByText("Task 4")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show less" }));
    expect(screen.queryByText("Task 4")).not.toBeInTheDocument();
  });

  it("faded entries for the next occurrences of a repeating task", async () => {
    const rule: RepeatRule = { freq: "week", interval: 1, weekdays: [1, 3] };
    setup(payload({
      tasks: [calTask({ id: "t1", title: "Gym", dueDate: "2026-10-21T06:00:00.000Z", repeat: rule })],
      recurring: [{ id: "t1", title: "Gym", repeat: rule, dueDate: "2026-10-21T06:00:00.000Z", group: WORK }],
    }));
    await screen.findAllByText("Gym");
    // the real one on the 21st, then Mon 26, Wed 28, Mon 2, Wed 4, Mon 9...
    const ghosts = screen.getAllByTitle("Next occurrence of a repeating task");
    expect(ghosts.length).toBeGreaterThanOrEqual(4);
    expect(ghosts[0].closest('[role="gridcell"]')).toHaveTextContent(/^26/);
  });

  it("moves between months and today", async () => {
    setup();
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "October 2026" });
    await user.click(screen.getByRole("button", { name: "Next month" }));
    expect(await screen.findByRole("heading", { name: "November 2026" })).toBeInTheDocument();
    await waitFor(() => expect(api.to("GET /api/calendar")).toHaveLength(2));
    expect(api.to("GET /api/calendar")[1].query.get("from")).toBe("2026-10-26");
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    expect(await screen.findByRole("heading", { name: "September 2026" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(await screen.findByRole("heading", { name: "October 2026" })).toBeInTheDocument();
  });

  it("crosses the year", async () => {
    setup();
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "October 2026" });
    await user.click(screen.getByRole("button", { name: "Next month" }));
    await user.click(screen.getByRole("button", { name: "Next month" }));
    expect(await screen.findByRole("heading", { name: "December 2026" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next month" }));
    expect(await screen.findByRole("heading", { name: "January 2027" })).toBeInTheDocument();
  });

  it("an add button on today and later days opens quick add with that date, none on past days", async () => {
    setup();
    const seen: unknown[] = [];
    const onOpen = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener("open-command-palette", onOpen);
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "October 2026" });
    expect(screen.queryByRole("button", { name: "Add a task for 2026-10-23" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add a task for 2026-10-30" }));
    expect(seen).toEqual([{ mode: "add", text: "2026-10-30 " }]);
    window.removeEventListener("open-command-palette", onOpen);
  });
});

describe("CalendarView: week, overdue, tray", () => {
  it("switches to the week list, asks for that week, and remembers the choice", async () => {
    setup();
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "October 2026" });
    await user.click(screen.getByRole("button", { name: "Week" }));
    expect(await screen.findByRole("heading", { name: "19 Oct – 25 Oct 2026" })).toBeInTheDocument();
    await waitFor(() => expect(api.to("GET /api/calendar")).toHaveLength(2));
    const q = api.to("GET /api/calendar")[1].query;
    expect([q.get("from"), q.get("to")]).toEqual(["2026-10-19", "2026-10-25"]);
    expect(localStorage.getItem("forma.calendar.view")).toBe("week");
    // seven day sections, today tagged
    expect(screen.getAllByRole("region").filter((r) => r.tagName === "SECTION" && /\d/.test(r.getAttribute("aria-label") ?? ""))).toHaveLength(7);
    expect(within(screen.getByRole("region", { name: "Saturday 24 October" })).getByText("Today")).toBeInTheDocument();
  });

  it("opens in the remembered view", async () => {
    localStorage.setItem("forma.calendar.view", "week");
    setup();
    expect(await screen.findByRole("heading", { name: "19 Oct – 25 Oct 2026" })).toBeInTheDocument();
  });

  it("a day with nothing due says so", async () => {
    localStorage.setItem("forma.calendar.view", "week");
    setup();
    await screen.findByRole("heading", { name: "19 Oct – 25 Oct 2026" });
    expect(screen.getAllByText("Nothing due")).toHaveLength(7);
  });

  it("lists overdue tasks, collapsed in month view and open in week view", async () => {
    const overdue = [calTask({ id: "o1", title: "Pay invoice", dueDate: "2026-10-15T07:00:00.000Z" })];
    setup(payload({ tasks: [], overdue }));
    const user = userEvent.setup();
    const toggle = await screen.findByRole("button", { name: /^overdue \d/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // (it also sits in its own day of the grid, so look inside the panel)
    const panel = screen.getByRole("region", { name: "Overdue tasks" });
    expect(within(panel).queryByText("Pay invoice")).not.toBeInTheDocument();
    await user.click(toggle);
    expect(within(panel).getByText("Pay invoice")).toBeInTheDocument();
    await user.click(toggle);
    await user.click(screen.getByRole("button", { name: "Week" }));
    expect(await screen.findByRole("button", { name: /^overdue \d/i })).toHaveAttribute("aria-expanded", "true");
  });

  it("hides the overdue panel when nothing is overdue", async () => {
    setup();
    await screen.findByRole("heading", { name: "October 2026" });
    expect(screen.queryByRole("button", { name: /^overdue \d/i })).not.toBeInTheDocument();
  });

  it("the unscheduled tray lists open undated tasks by project and filters", async () => {
    setup(payload({ unscheduled: [calTask({ id: "u1", title: "Someday thing" }), calTask({ id: "u2", title: "Another idea" })] }));
    const user = userEvent.setup();
    const tray = await screen.findByRole("complementary", { name: "Unscheduled tasks" });
    expect(within(tray).getByText("Someday thing")).toBeInTheDocument();
    expect(within(tray).getByText("Work")).toBeInTheDocument();
    await user.type(within(tray).getByRole("textbox", { name: /filter/i }), "idea");
    expect(within(tray).queryByText("Someday thing")).not.toBeInTheDocument();
    expect(within(tray).getByText("Another idea")).toBeInTheDocument();
  });

  it("the tray says when everything has a date", async () => {
    setup();
    const tray = await screen.findByRole("complementary", { name: "Unscheduled tasks" });
    expect(within(tray).getByText(/every open task has a date/i)).toBeInTheDocument();
  });
});

describe("CalendarView: opening tasks and errors", () => {
  it("clicking a task opens the task panel", async () => {
    setup(payload({ tasks: [calTask({ id: "t1", title: "Dentist", dueDate: "2026-10-21T08:30:00.000Z" })] }));
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Dentist/ }));
    expect(await screen.findByRole("dialog", { name: "Task details" })).toBeInTheDocument();
    expect(api.to("GET /api/tasks/t1")).toHaveLength(1);
    expect(screen.getByRole("textbox", { name: "Task title" })).toHaveValue("Dentist");
  });

  it("says so when a task cannot be opened", async () => {
    setup(payload({ tasks: [calTask({ id: "t1", title: "Dentist", dueDate: "2026-10-21T08:30:00.000Z" })] }), { "GET /api/tasks/t1": httpError(404, "Not found") });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Dentist/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not found");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a failed load shows the error with a retry", async () => {
    setup(payload(), { "GET /api/calendar": httpError(500, "Calendar is down") });
    const user = userEvent.setup();
    expect(await screen.findByRole("alert")).toHaveTextContent("Calendar is down");
    api.on("GET /api/calendar", payload({ tasks: [calTask({ id: "t1", title: "Back again", dueDate: "2026-10-21T08:30:00.000Z" })] }));
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Back again")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reloads when a task is added from quick capture", async () => {
    setup();
    await screen.findByRole("heading", { name: "October 2026" });
    await waitFor(() => expect(api.to("GET /api/calendar")).toHaveLength(1));
    act(() => { window.dispatchEvent(new CustomEvent("task-created", { detail: {} })); });
    await waitFor(() => expect(api.to("GET /api/calendar")).toHaveLength(2));
  });
});

describe("RepeatPicker", () => {
  const pill = { height: "1.75rem" } as React.CSSProperties;
  function renderPicker(value: RepeatRule | null = null, anchor = "2026-10-24") {
    const onChange = vi.fn();
    render(<RepeatPicker value={value} anchorKey={anchor} onChange={onChange} pillStyle={pill} />);
    return onChange;
  }

  it("says Repeat when nothing is set and shows the rule when one is", () => {
    renderPicker();
    expect(screen.getByRole("button", { name: /repeat/i })).toBeInTheDocument();
  });

  it("shows the label of the current rule", () => {
    renderPicker({ freq: "week", interval: 1, weekdays: [1, 3, 5] });
    expect(screen.getByRole("button", { name: /every mon, wed, fri/i })).toBeInTheDocument();
  });

  it("offers presets built from the due date", async () => {
    const onChange = renderPicker(null, "2026-10-24"); // a Saturday, the 24th
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /repeat/i }));
    expect(screen.getByRole("button", { name: "Every week on Saturday" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Every month on the 24th" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Doesn't repeat" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Every month on the 24th" }));
    expect(onChange).toHaveBeenCalledWith({ freq: "month", interval: 1, day: 24 });
  });

  it("weekdays, daily and yearly presets", async () => {
    const onChange = renderPicker();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /repeat/i }));
    await user.click(screen.getByRole("button", { name: "Weekdays" }));
    expect(onChange).toHaveBeenLastCalledWith({ freq: "week", interval: 1, weekdays: [1, 2, 3, 4, 5] });
    await user.click(screen.getByRole("button", { name: /repeat/i }));
    await user.click(screen.getByRole("button", { name: "Every day" }));
    expect(onChange).toHaveBeenLastCalledWith({ freq: "day", interval: 1 });
    await user.click(screen.getByRole("button", { name: /repeat/i }));
    await user.click(screen.getByRole("button", { name: "Every year" }));
    expect(onChange).toHaveBeenLastCalledWith({ freq: "year", interval: 1 });
  });

  it("'Doesn't repeat' clears the rule", async () => {
    const onChange = renderPicker({ freq: "day", interval: 1 });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /every day/i }));
    await user.click(screen.getByRole("button", { name: "Doesn't repeat" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("custom: every 2 weeks on Tuesday and Thursday", async () => {
    const onChange = renderPicker(null, "2026-10-24");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /repeat/i }));
    await user.click(screen.getByRole("button", { name: "Custom…" }));
    const n = screen.getByRole("spinbutton", { name: "Repeat interval" });
    await user.clear(n);
    await user.type(n, "2");
    await user.selectOptions(screen.getByLabelText("Repeat unit"), "week");
    // starts with the due date's weekday (Saturday) on
    const chips = screen.getByRole("group", { name: "Repeat on" });
    expect(within(chips).getByRole("button", { name: "Sat" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(chips).getByRole("button", { name: "Sat" }));
    await user.click(within(chips).getByRole("button", { name: "Tue" }));
    await user.click(within(chips).getByRole("button", { name: "Thu" }));
    await user.click(screen.getByRole("button", { name: "Set repeat" }));
    expect(onChange).toHaveBeenCalledWith({ freq: "week", interval: 2, weekdays: [2, 4] });
  });

  it("custom: monthly on the last day, and an interval over the limit is clamped", async () => {
    const onChange = renderPicker();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /repeat/i }));
    await user.click(screen.getByRole("button", { name: "Custom…" }));
    await user.selectOptions(screen.getByLabelText("Repeat unit"), "month");
    await user.selectOptions(screen.getByLabelText("Day of the month"), "last");
    const n = screen.getByRole("spinbutton", { name: "Repeat interval" });
    await user.clear(n);
    await user.type(n, "999");
    await user.click(screen.getByRole("button", { name: "Set repeat" }));
    expect(onChange).toHaveBeenCalledWith({ freq: "month", interval: 365, day: "last" });
  });

  it("custom: an empty interval becomes 1, and a week with every day off falls back to the due weekday", async () => {
    const onChange = renderPicker(null, "2026-10-26"); // a Monday
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /repeat/i }));
    await user.click(screen.getByRole("button", { name: "Custom…" }));
    await user.clear(screen.getByRole("spinbutton", { name: "Repeat interval" }));
    await user.selectOptions(screen.getByLabelText("Repeat unit"), "week");
    await user.click(within(screen.getByRole("group", { name: "Repeat on" })).getByRole("button", { name: "Mon" })); // off
    await user.click(screen.getByRole("button", { name: "Set repeat" }));
    expect(onChange).toHaveBeenCalledWith({ freq: "week", interval: 1, weekdays: [1] });
  });

  it("Back returns to the presets without changing anything", async () => {
    const onChange = renderPicker();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /repeat/i }));
    await user.click(screen.getByRole("button", { name: "Custom…" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: "Weekdays" })).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clicking elsewhere closes it", async () => {
    renderPicker();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /repeat/i }));
    expect(screen.getByRole("button", { name: "Weekdays" })).toBeInTheDocument();
    await user.click(document.body);
    expect(screen.queryByRole("button", { name: "Weekdays" })).not.toBeInTheDocument();
  });
});
