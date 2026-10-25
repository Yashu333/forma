// @vitest-environment jsdom
// The calendar on phones and tablets (docs/mobile-pwa/SPEC.md, P5): the compact
// month grid under sm (dots and a tap-to-show day list) and the Unscheduled
// tray as a bottom sheet under lg. useMediaQuery is false in jsdom, so each
// test stubs matchMedia for the screen size it's about.
import { createElement } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CalendarView from "./CalendarView";
import MonthGrid from "./MonthGrid";
import WeekAgenda, { DayCard } from "./WeekAgenda";
import { centerOnPointer } from "@/lib/dnd-touch";
import { monthGrid, type CalItem, type CalRecurring, type CalTask, type CalendarPayload } from "./types";
import { freezeNow, mockApi, type Api } from "../../tests/ui/fixtures";
import { restoreBrowserStubs, stubMatchMedia } from "../../tests/ui/pwa-stubs";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/calendar",
}));

// The calendar's DndContext, passed through unchanged; its props are kept so a
// test can call the drag handlers directly (jsdom can't do a real drag).
const dnd = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: (props: Parameters<typeof actual.DndContext>[0]) => {
      dnd.props = props as unknown as Record<string, unknown>;
      return createElement(actual.DndContext, props);
    },
  };
});

/** The queries the calendar uses: under sm (compact month) and under lg (tray sheet). */
const UNDER_SM = "(width < 40rem)";
const UNDER_LG = "(width < 64rem)";
const phone = () => stubMatchMedia([UNDER_SM, UNDER_LG]);
const tablet = () => stubMatchMedia([UNDER_LG]);

// Saturday 24 October 2026, 10:00 in Berlin. October's grid runs Mon 28 Sep to Sun 8 Nov.
const WORK = { id: "g-work", name: "Work", color: "#7C6EF8" };
const HOME = { id: "g-home", name: "Home", color: "#34D399" };

function calTask(o: Partial<CalTask> & { id: string; title: string }): CalTask {
  return {
    groupId: WORK.id, statusId: "s-todo", priority: "MEDIUM", order: 0, dueDate: null, repeat: null,
    plannedFor: null, scheduledAt: null, blockMinutes: null,
    abcde: null, abcdeRank: null, completedAt: null, group: WORK, done: false, ...o,
  };
}

function payload(o: Partial<CalendarPayload> = {}): CalendarPayload {
  return {
    tasks: [], overdue: [], unscheduled: [], recurring: [], blocks: [], planned: [], frogs: {},
    statusesByGroup: { [WORK.id]: [{ id: "s-todo", name: "To Do", groupId: WORK.id, order: 0, celebrate: false }] },
    ...o,
  };
}

const taskItem = (t: CalTask): CalItem => ({ kind: "task", task: t });
const ghostItem = (rec: CalRecurring, date: string): CalItem => ({ kind: "ghost", rec, date });

/** Six tasks on Wed 21 (two projects, one done), one on Fri 30, a repeat's next occurrence on Mon 2 Nov. */
function monthItems() {
  const wed = [
    calTask({ id: "w1", title: "Standup", group: WORK }),
    calTask({ id: "w2", title: "Groceries", group: HOME, groupId: HOME.id }),
    calTask({ id: "w3", title: "Report", group: WORK, done: true }),
    calTask({ id: "w4", title: "Laundry", group: HOME, groupId: HOME.id }),
    calTask({ id: "w5", title: "Fifth thing", group: WORK }),
    calTask({ id: "w6", title: "Sixth thing", group: HOME, groupId: HOME.id }),
  ];
  const gym: CalRecurring = { id: "r1", title: "Gym", repeat: { freq: "week", interval: 1 }, dueDate: "2026-10-26T06:00:00.000Z", group: WORK };
  return new Map<string, CalItem[]>([
    ["2026-10-21", wed.map(taskItem)],
    ["2026-10-30", [taskItem(calTask({ id: "f1", title: "Friday task" }))]],
    ["2026-11-02", [ghostItem(gym, "2026-11-02")]],
  ]);
}

function renderMonth(o: { month?: string; today?: string; itemsByDay?: Map<string, CalItem[]> } = {}) {
  const month = o.month ?? "2026-10";
  const onOpen = vi.fn();
  const onAdd = vi.fn();
  const onExpand = vi.fn();
  const utils = render(
    <MonthGrid
      days={monthGrid(`${month}-15`)}
      month={month}
      today={o.today ?? "2026-10-24"}
      nowMs={new Date("2026-10-24T08:00:00Z").getTime()}
      itemsByDay={o.itemsByDay ?? monthItems()}
      expandedDay={null}
      onExpand={onExpand}
      onOpen={onOpen}
      onAdd={onAdd}
    />,
  );
  return { ...utils, onOpen, onAdd, onExpand };
}

/** A compact day cell's button, by its accessible label's start ("Wednesday 21 October"). */
const dayButton = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}\\b`) });
/** The dots inside a compact day cell's button. */
const dotsOf = (button: HTMLElement) => Array.from(button.querySelectorAll<HTMLElement>('span[aria-hidden="true"] > span'));

beforeEach(() => {
  freezeNow("2026-10-24T08:00:00Z");
  localStorage.clear();
  dnd.props = null;
});
afterEach(() => restoreBrowserStubs());

describe("MonthGrid on a phone (under sm)", () => {
  it("each of the 42 cells is one button; the chips and per-cell add buttons are gone", () => {
    phone();
    renderMonth();
    const cells = screen.getAllByRole("gridcell");
    expect(cells).toHaveLength(42);
    for (const cell of cells) expect(within(cell).getAllByRole("button")).toHaveLength(1);
    // No task chips inside the grid (the picked day's list below has the rows).
    const grid = screen.getByRole("grid", { name: "Month" });
    expect(within(grid).queryByText("Standup")).not.toBeInTheDocument();
    expect(within(grid).queryByRole("button", { name: /^Add a task/ })).not.toBeInTheDocument();
    expect(within(grid).queryByRole("button", { name: /more$/ })).not.toBeInTheDocument();
  });

  it("labels each day with its full date, today, and how many tasks it has", () => {
    phone();
    renderMonth();
    expect(screen.getByRole("button", { name: "Wednesday 21 October, 6 tasks" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Friday 30 October, 1 task" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Saturday 24 October (today), nothing due" })).toBeInTheDocument();
    // Days around the month are in the grid too.
    expect(screen.getByRole("button", { name: "Monday 28 September, nothing due" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Monday 2 November, 1 task" })).toBeInTheDocument();
    // The visible text is just the date number.
    expect(dayButton("Wednesday 21 October")).toHaveTextContent(/^21$/);
  });

  it("shows a dot per item in its project colour, at most four, done ones faded", () => {
    phone();
    renderMonth();
    const dots = dotsOf(dayButton("Wednesday 21 October"));
    expect(dots).toHaveLength(4);
    // jsdom keeps the hex as rgb()
    expect(dots.map((d) => d.style.background)).toEqual(["rgb(124, 110, 248)", "rgb(52, 211, 153)", "rgb(124, 110, 248)", "rgb(52, 211, 153)"]);
    expect(dots.map((d) => d.style.opacity)).toEqual(["1", "1", "0.4", "1"]);
    expect(dotsOf(dayButton("Friday 30 October"))).toHaveLength(1);
    expect(dotsOf(dayButton("Thursday 22 October"))).toHaveLength(0);
  });

  it("a repeat's next occurrence is a dashed ring, not a filled dot", () => {
    phone();
    renderMonth();
    const [ring] = dotsOf(dayButton("Monday 2 November"));
    expect(ring).toHaveClass("border-dashed");
    expect(ring.style.background).toBe("");
  });

  it("picks today by default and lists it below the grid", () => {
    phone();
    renderMonth();
    expect(dayButton("Saturday 24 October")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
    const day = screen.getByRole("region", { name: "Saturday 24 October" });
    expect(within(day).getByText("Today")).toBeInTheDocument();
    expect(within(day).getByText("Nothing due")).toBeInTheDocument();
  });

  it("picks the 1st when today isn't in the month shown", () => {
    phone();
    renderMonth({ month: "2026-11" });
    expect(dayButton("Sunday 1 November")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "Sunday 1 November" })).toBeInTheDocument();
  });

  it("tapping a day lists all its items below the grid, and they open", async () => {
    phone();
    const { onOpen } = renderMonth();
    const user = userEvent.setup();
    await user.click(dayButton("Wednesday 21 October"));
    expect(dayButton("Wednesday 21 October")).toHaveAttribute("aria-pressed", "true");
    expect(dayButton("Saturday 24 October")).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("region", { name: "Saturday 24 October" })).not.toBeInTheDocument();
    const day = screen.getByRole("region", { name: "Wednesday 21 October" });
    // All six, not just the four with dots.
    for (const title of ["Standup", "Groceries", "Report", "Laundry", "Fifth thing", "Sixth thing"]) {
      expect(within(day).getByText(title)).toBeInTheDocument();
    }
    // A past day has no add button.
    expect(within(day).queryByRole("button", { name: /^Add a task/ })).not.toBeInTheDocument();
    await user.click(within(day).getByRole("button", { name: /Laundry/ }));
    expect(onOpen).toHaveBeenCalledWith("w4");
  });

  it("a picked day from today on has an add button for that date", async () => {
    phone();
    const { onAdd } = renderMonth();
    const user = userEvent.setup();
    await user.click(dayButton("Friday 30 October"));
    const day = screen.getByRole("region", { name: "Friday 30 October" });
    expect(within(day).getByText("Friday task")).toBeInTheDocument();
    await user.click(within(day).getByRole("button", { name: "Add a task for 2026-10-30" }));
    expect(onAdd).toHaveBeenCalledWith("2026-10-30");
  });

  it("a repeat's next occurrence shows in the picked day's list", async () => {
    phone();
    // November's grid, where the 2nd is in the month.
    renderMonth({ month: "2026-11" });
    const user = userEvent.setup();
    await user.click(dayButton("Monday 2 November"));
    const day = screen.getByRole("region", { name: "Monday 2 November" });
    expect(within(day).getByTitle("Next occurrence of a repeating task")).toHaveTextContent("Gym");
  });

  it("tapping a day just outside the month (it shows dots too) lists that day", async () => {
    phone();
    renderMonth();
    const user = userEvent.setup();
    // October's grid ends on Sun 8 Nov; the 2nd has a dot. Tapping it must show something.
    await user.click(dayButton("Monday 2 November"));
    expect(dayButton("Monday 2 November")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "Monday 2 November" })).toBeInTheDocument();
  });

  it("switches to the full grid when the screen grows past sm, and back", () => {
    const mm = phone();
    renderMonth();
    expect(screen.queryByText("Standup")).not.toBeInTheDocument();
    act(() => mm.list(UNDER_SM).set(false));
    expect(screen.getByText("Standup")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+3 more" })).toBeInTheDocument();
    act(() => mm.list(UNDER_SM).set(true));
    expect(screen.queryByText("Standup")).not.toBeInTheDocument();
  });
});

describe("MonthGrid from sm up (the hook is false)", () => {
  it("renders the full grid: chips, '+N more', add buttons, no day list or pressed cells", () => {
    stubMatchMedia([UNDER_LG]); // a tablet: under lg but not under sm
    const { onExpand } = renderMonth();
    const cells = screen.getAllByRole("gridcell");
    expect(cells).toHaveLength(42);
    const wed = screen.getByText("Standup").closest('[role="gridcell"]') as HTMLElement;
    expect(wed).toHaveTextContent(/^21/);
    expect(within(wed).getAllByRole("button").map((b) => b.textContent)).toEqual(["Standup", "Groceries", "Report", "+3 more"]);
    fireEvent.click(within(wed).getByRole("button", { name: "+3 more" }));
    expect(onExpand).toHaveBeenCalledWith("2026-10-21");
    expect(screen.getByRole("button", { name: "Add a task for 2026-10-30" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { pressed: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(screen.getByLabelText("24 (today)")).toBeInTheDocument();
  });

  it("is the same markup with matchMedia missing (jsdom) as with it not matching", () => {
    const missing = renderMonth().container.innerHTML;
    screen.getByText("Standup"); // sanity: the full grid
    document.body.innerHTML = "";
    stubMatchMedia([]);
    const notMatching = renderMonth().container.innerHTML;
    expect(notMatching).toBe(missing);
  });
});

describe("DayCard (the week agenda's day, reused under the phone month grid)", () => {
  it("renders exactly what the week agenda renders for that day", () => {
    const items = monthItems().get("2026-10-21")!;
    const props = { today: "2026-10-24", nowMs: Date.now(), onOpen: vi.fn(), onAdd: vi.fn() };
    const week = render(<WeekAgenda days={["2026-10-21"]} itemsByDay={new Map([["2026-10-21", items]])} {...props} />).container;
    const weekHtml = week.querySelector("section")!.outerHTML;
    document.body.innerHTML = "";
    const card = render(<DayCard dayKey="2026-10-21" items={items} {...props} />).container;
    expect(card.querySelector("section")!.outerHTML).toBe(weekHtml);
  });
});

// ── CalendarView: the Unscheduled tray as a bottom sheet ───────────────────────

let api: Api;
function setupView(p: CalendarPayload = payload(), extra: Record<string, unknown> = {}) {
  api = mockApi({
    "GET /api/calendar": p,
    "GET /api/tasks/u1": { id: "u1", title: "Someday thing", groupId: WORK.id, statusId: "s-todo", priority: "MEDIUM", order: 0, createdBy: "u1", createdAt: "", updatedAt: "", dueDate: null, subtasks: [], comments: [], focus: { totalSec: 0, sessions: 0 } },
    "PATCH /api/tasks/u1": (call: { body: unknown }) => ({ id: "u1", ...(call.body as object) }),
    ...extra,
  });
  return render(<CalendarView userId="u1" />);
}

const unscheduled = () => payload({ unscheduled: [calTask({ id: "u1", title: "Someday thing" }), calTask({ id: "u2", title: "Another idea", group: HOME, groupId: HOME.id })] });
const sheet = () => screen.queryByRole("dialog", { name: "Unscheduled tasks" });

describe("CalendarView on a phone: month", () => {
  it("shows the compact grid with dots, and today's list below it", async () => {
    phone();
    setupView(payload({ tasks: [calTask({ id: "t1", title: "Dentist", dueDate: "2026-10-21T08:30:00.000Z" })] }));
    const wed = await screen.findByRole("button", { name: "Wednesday 21 October, 1 task" });
    expect(dotsOf(wed)).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Saturday 24 October" })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(wed);
    const day = screen.getByRole("region", { name: "Wednesday 21 October" });
    expect(within(day).getByRole("button", { name: /Dentist/ })).toHaveTextContent("10:30 am");
  });

  it("a pick from the edge of one month's grid doesn't carry over to the next month", async () => {
    phone();
    setupView();
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "October 2026" });
    // 2 November is in October's grid and in November's: picked in October...
    await user.click(dayButton("Monday 2 November"));
    expect(dayButton("Monday 2 November")).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Next month" }));
    await screen.findByRole("heading", { name: "November 2026" });
    // ...November starts on its 1st, as any month does.
    expect(dayButton("Sunday 1 November")).toHaveAttribute("aria-pressed", "true");
    expect(dayButton("Monday 2 November")).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    await screen.findByRole("heading", { name: "October 2026" });
    expect(dayButton("Saturday 24 October")).toHaveAttribute("aria-pressed", "true");
  });

  it("moving to another month picks its 1st, and Today picks today again", async () => {
    phone();
    setupView();
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "October 2026" });
    await user.click(screen.getByRole("button", { name: "Next month" }));
    await screen.findByRole("heading", { name: "November 2026" });
    expect(dayButton("Sunday 1 November")).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Today" }));
    await screen.findByRole("heading", { name: "October 2026" });
    expect(dayButton("Saturday 24 October")).toHaveAttribute("aria-pressed", "true");
  });

  it("puts the dragged item under the finger (centerOnPointer) under lg, not on desktop", async () => {
    phone();
    setupView();
    await screen.findByRole("heading", { name: "October 2026" });
    expect(dnd.props?.modifiers).toEqual([centerOnPointer]);
  });

  it("has no modifiers from lg up", async () => {
    setupView();
    await screen.findByRole("heading", { name: "October 2026" });
    expect(dnd.props?.modifiers).toBeUndefined();
  });
});

describe("CalendarView under lg: the Unscheduled sheet", () => {
  it("replaces the side tray with an 'Unscheduled N' button in the header", async () => {
    tablet();
    setupView(unscheduled());
    const button = await screen.findByRole("button", { name: "Unscheduled 2" });
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("complementary", { name: "Unscheduled tasks" })).not.toBeInTheDocument();
    expect(sheet()).not.toBeInTheDocument();
  });

  it("the count is 0 when every task has a date, and the sheet says so", async () => {
    phone();
    setupView();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Unscheduled 0" }));
    expect(within(sheet()!).getByText(/every open task has a date/i)).toBeInTheDocument();
  });

  it("opens as a modal dialog listing the tasks by project, with focus moved into it", async () => {
    phone();
    setupView(unscheduled());
    const user = userEvent.setup();
    const button = await screen.findByRole("button", { name: "Unscheduled 2" });
    await user.click(button);
    const dialog = sheet()!;
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(dialog).toHaveFocus();
    expect(within(dialog).getByRole("heading", { name: "Unscheduled" })).toBeInTheDocument();
    expect(within(dialog).getAllByText("Work").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("Home").length).toBeGreaterThan(0);
    // Full-width rows, not the side tray's small chips.
    expect(within(dialog).getByRole("button", { name: /Someday thing/ })).toHaveClass("px-3", "py-2.5", "text-sm");
    // The filter still works.
    await user.type(within(dialog).getByRole("textbox", { name: /filter/i }), "idea");
    expect(within(dialog).queryByText("Someday thing")).not.toBeInTheDocument();
    expect(within(dialog).getByText("Another idea")).toBeInTheDocument();
  });

  it("Escape closes it and focus returns to the button", async () => {
    phone();
    setupView(unscheduled());
    const user = userEvent.setup();
    const button = await screen.findByRole("button", { name: "Unscheduled 2" });
    await user.click(button);
    expect(sheet()).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(sheet()).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("the Close button and the backdrop close it, focus back on the button", async () => {
    phone();
    setupView(unscheduled());
    const user = userEvent.setup();
    const button = await screen.findByRole("button", { name: "Unscheduled 2" });
    await user.click(button);
    await user.click(within(sheet()!).getByRole("button", { name: "Close" }));
    expect(sheet()).not.toBeInTheDocument();
    expect(button).toHaveFocus();

    await user.click(button);
    const backdrop = sheet()!.parentElement!.querySelector<HTMLElement>('[aria-hidden="true"]')!;
    await user.click(backdrop);
    expect(sheet()).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("Tab wraps inside the sheet, both ways", async () => {
    phone();
    setupView(unscheduled());
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Unscheduled 2" }));
    const dialog = sheet()!;
    const close = within(dialog).getByRole("button", { name: "Close" });
    // Close, the filter, then the task rows: the last row is the last control.
    const rows = within(dialog).getAllByRole("button").filter((b) => b !== close);
    const lastRow = rows[rows.length - 1];
    // From the dialog itself (where focus starts), Shift+Tab goes to the last control.
    expect(dialog).toHaveFocus();
    await user.tab({ shift: true });
    expect(lastRow).toHaveFocus();
    // Tab from the last control wraps to the first (Close).
    await user.tab();
    expect(close).toHaveFocus();
    // Shift+Tab from the first wraps to the last.
    await user.tab({ shift: true });
    expect(lastRow).toHaveFocus();
    // Tabbing forward walks every control and never leaves the sheet.
    for (let i = 0; i < 8; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it("tapping a task closes the sheet and opens the task", async () => {
    phone();
    setupView(unscheduled());
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Unscheduled 2" }));
    await user.click(within(sheet()!).getByRole("button", { name: /Someday thing/ }));
    expect(sheet()).not.toBeInTheDocument();
    expect(await screen.findByRole("dialog", { name: "Task details" })).toBeInTheDocument();
    expect(api.to("GET /api/tasks/u1")).toHaveLength(1);
  });

  it("is open in week view too, and not offered in day view", async () => {
    phone();
    localStorage.setItem("forma.calendar.view", "week");
    setupView(unscheduled());
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "19 Oct – 25 Oct 2026" });
    expect(screen.getByRole("button", { name: "Unscheduled 2" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Day" }));
    expect(screen.queryByRole("button", { name: /^Unscheduled/ })).not.toBeInTheDocument();
  });

  it("while a task is held it fades out but stays mounted; the drop schedules it and closes the sheet", async () => {
    phone();
    setupView(unscheduled());
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Unscheduled 2" }));
    const overlay = sheet()!.parentElement!;
    expect(overlay).not.toHaveClass("opacity-0");

    const active = { id: "task:u1", rect: { current: { initial: null, translated: null } }, data: { current: undefined } };
    const onDragStart = dnd.props!.onDragStart as (e: unknown) => void;
    act(() => onDragStart({ active, activatorEvent: new Event("pointerdown") }));
    expect(sheet()).toBeInTheDocument();
    expect(sheet()!.parentElement).toHaveClass("opacity-0", "pointer-events-none");

    const onDragEnd = dnd.props!.onDragEnd as (e: unknown) => Promise<void>;
    await act(() => onDragEnd({ active, over: { id: "day:2026-10-27" }, delta: { x: 0, y: 0 }, collisions: null, activatorEvent: new Event("pointerdown") }));
    expect(sheet()).not.toBeInTheDocument();
    await waitFor(() => expect(api.to("PATCH /api/tasks/u1")).toHaveLength(1));
    const iso = (api.to("PATCH /api/tasks/u1")[0].body as { dueDate: string }).dueDate;
    expect(new Date(iso).getDate()).toBe(27);
  });

  it("a cancelled drag brings the sheet back", async () => {
    phone();
    setupView(unscheduled());
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Unscheduled 2" }));
    const active = { id: "task:u2", rect: { current: { initial: null, translated: null } }, data: { current: undefined } };
    act(() => (dnd.props!.onDragStart as (e: unknown) => void)({ active, activatorEvent: new Event("pointerdown") }));
    expect(sheet()!.parentElement).toHaveClass("opacity-0");
    act(() => (dnd.props!.onDragCancel as (e: unknown) => void)({ active, over: null }));
    expect(sheet()).toBeInTheDocument();
    expect(sheet()!.parentElement).not.toHaveClass("opacity-0");
  });

  it("growing past lg with the sheet open closes it for good: it doesn't pop up again back under lg", async () => {
    const mm = tablet();
    setupView(unscheduled());
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Unscheduled 2" }));
    expect(sheet()).toBeInTheDocument();
    act(() => mm.list(UNDER_LG).set(false));
    expect(sheet()).not.toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Unscheduled tasks" })).toBeInTheDocument();
    act(() => mm.list(UNDER_LG).set(true));
    expect(sheet()).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unscheduled 2" })).toHaveAttribute("aria-expanded", "false");
  });

  it("from lg up there's no button and the side tray is there as before", async () => {
    stubMatchMedia([]);
    setupView(unscheduled());
    expect(await screen.findByRole("complementary", { name: "Unscheduled tasks" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Unscheduled/ })).not.toBeInTheDocument();
  });
});
