// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CommandPalette from "./CommandPalette";
import { freezeNow, httpError, mockApi, type Api } from "../../tests/ui/fixtures";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/dashboard",
}));

const GROUPS = [
  { id: "g-work", name: "Work", color: "#7C6EF8" },
  { id: "g-personal", name: "Personal", color: "#34D399" },
];
const CAPTURED = { id: "t-new", title: "x", groupId: "g-personal", group: { id: "g-personal", name: "Personal", color: "#34D399" } };

let api: Api;
beforeEach(() => {
  // Saturday 24 October 2026, 10:00 in Berlin
  freezeNow("2026-10-24T08:00:00Z");
  router.push.mockClear();
  api = mockApi({
    "GET /api/groups": GROUPS,
    "POST /api/capture": CAPTURED,
    "GET /api/search": [],
  });
});

async function open(keys: string) {
  const user = userEvent.setup();
  render(<CommandPalette />);
  await user.keyboard(keys);
  return user;
}

describe("opening and closing", () => {
  it("is closed to begin with, with a floating add button for phones", () => {
    render(<CommandPalette />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add task" })).toBeInTheDocument();
  });

  it("Ctrl+K opens search", async () => {
    await open("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog", { name: "Search" });
    expect(within(dialog).getByRole("combobox", { name: /search tasks and pages/i })).toHaveFocus();
  });

  it("Q opens add", async () => {
    await open("q");
    const dialog = await screen.findByRole("dialog", { name: "Add task" });
    expect(within(dialog).getByRole("textbox", { name: "New task" })).toHaveFocus();
  });

  it("Q typed into a text box does not open the palette", async () => {
    const user = userEvent.setup();
    render(<><input aria-label="Notes" /><CommandPalette /></>);
    await user.click(screen.getByLabelText("Notes"));
    await user.keyboard("quick");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Notes")).toHaveValue("quick");
  });

  it("Ctrl+Q and other combinations do not open it", async () => {
    await open("{Control>}q{/Control}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("the floating button opens add mode", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    await user.click(screen.getByRole("button", { name: "Add task" }));
    expect(await screen.findByRole("dialog", { name: "Add task" })).toBeInTheDocument();
  });

  it("Escape closes it and focus goes back to where it was", async () => {
    const user = userEvent.setup();
    render(<><button>Before</button><CommandPalette /></>);
    screen.getByRole("button", { name: "Before" }).focus();
    await user.keyboard("{Control>}k{/Control}");
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Before" })).toHaveFocus();
  });

  it("Ctrl+K again closes it", async () => {
    const user = await open("{Control>}k{/Control}");
    await screen.findByRole("dialog");
    await user.keyboard("{Control>}k{/Control}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("an open-command-palette event opens it in the requested mode with text", async () => {
    render(<CommandPalette />);
    act(() => {
      window.dispatchEvent(new CustomEvent("open-command-palette", { detail: { mode: "add", text: "2026-10-30 " } }));
    });
    expect(await screen.findByRole("textbox", { name: "New task" })).toHaveValue("2026-10-30 ");
  });

  it("Tab in the text box flips between add and search", async () => {
    const user = await open("q");
    await screen.findByRole("dialog", { name: "Add task" });
    await user.keyboard("{Tab}");
    expect(await screen.findByRole("dialog", { name: "Search" })).toBeInTheDocument();
    await user.keyboard("{Tab}");
    expect(await screen.findByRole("dialog", { name: "Add task" })).toBeInTheDocument();
  });

  it("the page behind it is not reachable by Tab: focus stays inside the dialog", async () => {
    const user = userEvent.setup();
    render(<><button>Behind</button><CommandPalette /></>);
    await user.keyboard("q");
    const dialog = await screen.findByRole("dialog");
    for (let i = 0; i < 8; i++) await user.tab();
    expect(dialog.contains(document.activeElement) || document.activeElement === document.body).toBe(true);
    expect(screen.getByRole("button", { name: "Behind" })).not.toHaveFocus();
  });
});

describe("add mode", () => {
  async function addMode() {
    const user = await open("q");
    const input = await screen.findByRole("textbox", { name: "New task" });
    // wait for the project list
    await waitFor(() => expect(within(screen.getByRole("dialog")).getByRole("combobox", { name: "Project" })).toBeInTheDocument());
    return { user, input };
  }
  const body = () => api.to("POST /api/capture")[0].body as Record<string, unknown>;

  it("shows what it understood while you type", async () => {
    const { user } = await addMode();
    await user.type(screen.getByRole("textbox", { name: "New task" }), "call dentist tmr 3pm #pers !high");
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("call dentist")).toBeInTheDocument();
    expect(within(dialog).getByText("Sun 25 Oct")).toBeInTheDocument();
    expect(within(dialog).getByText("3:00 pm")).toBeInTheDocument();
    expect(within(dialog).getByText("High")).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: "Project" })).toHaveValue("g-personal");
  });

  it("Enter saves the parsed task, clears the box and keeps going", async () => {
    const { user, input } = await addMode();
    const created = vi.fn();
    window.addEventListener("task-created", created);
    await user.type(input, "call dentist tmr 3pm #pers !high");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(api.to("POST /api/capture")).toHaveLength(1));
    expect(body()).toEqual({
      title: "call dentist",
      groupId: "g-personal",
      priority: "HIGH",
      dueDate: new Date(2026, 9, 25, 15, 0).toISOString(),
      repeat: null,
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Added to Personal");
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(created).toHaveBeenCalledTimes(1);
    window.removeEventListener("task-created", created);
  });

  it("Shift+Enter saves and closes", async () => {
    const { user, input } = await addMode();
    await user.type(input, "buy milk");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.to("POST /api/capture")).toHaveLength(1);
  });

  it("plans for today and sends the repeat rule", async () => {
    const { user, input } = await addMode();
    await user.type(input, "stretch every mon, wed @today");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(api.to("POST /api/capture")).toHaveLength(1));
    expect(body()).toMatchObject({
      title: "stretch",
      plannedFor: "2026-10-24",
      repeat: { freq: "week", interval: 1, weekdays: [1, 3] },
    });
  });

  it("uses the project picked in the dropdown", async () => {
    const { user, input } = await addMode();
    await user.selectOptions(screen.getByRole("combobox", { name: "Project" }), "g-personal");
    await user.type(input, "water plants");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(api.to("POST /api/capture")).toHaveLength(1));
    expect(body().groupId).toBe("g-personal");
  });

  it("an empty title asks for one and sends nothing", async () => {
    const { user, input } = await addMode();
    await user.type(input, "#work !low");
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Add a title");
    expect(api.to("POST /api/capture")).toHaveLength(0);
  });

  it("a failure shows the server's message and keeps what you typed", async () => {
    api.on("POST /api/capture", httpError(400, "This project has no open column to add the task to"));
    const { user, input } = await addMode();
    await user.type(input, "buy milk");
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("no open column");
    expect(input).toHaveValue("buy milk");
  });

  it("removing a chip puts the words back in the title and out of the request", async () => {
    const { user, input } = await addMode();
    await user.type(input, "plan trip tmr");
    await user.click(screen.getByRole("button", { name: "Remove date" }));
    expect(within(screen.getByRole("dialog")).getByText("plan trip tmr")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    // (focus moved to the chip button; send from the input)
    await user.click(input);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(api.to("POST /api/capture")).toHaveLength(1));
    expect(body()).toMatchObject({ title: "plan trip tmr", dueDate: null });
  });

  it("with no projects it says so", async () => {
    api.on("GET /api/groups", []);
    await open("q");
    expect(await screen.findByText(/create a project first/i)).toBeInTheDocument();
  });
});

describe("search mode", () => {
  const results = [
    { id: "t1", title: "Buy milk", parentTaskId: null, parentTitle: null, done: false, group: GROUPS[0] },
    { id: "s1", title: "Milk the cow", parentTaskId: "p1", parentTitle: "Farm", done: true, group: GROUPS[1] },
  ];

  async function searchMode() {
    const user = await open("{Control>}k{/Control}");
    const input = await screen.findByRole("combobox", { name: /search tasks and pages/i });
    return { user, input };
  }

  it("lists pages and projects before you type", async () => {
    await searchMode();
    const list = screen.getByRole("listbox");
    for (const name of ["Dashboard", "Today", "Calendar", "Habits", "Weekly review", "Reports", "Pomodoro"]) {
      expect(within(list).getByText(name)).toBeInTheDocument();
    }
    await waitFor(() => expect(within(list).getByText("Work")).toBeInTheDocument());
  });

  it("typing filters the pages", async () => {
    const { user, input } = await searchMode();
    await user.type(input, "cal");
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options.map((o) => o.textContent?.trim())).toEqual(["Calendar"]);
  });

  it("finds tasks after a short pause, subtasks with their parent, done ones flagged", async () => {
    api.on("GET /api/search", results);
    const { user, input } = await searchMode();
    await user.type(input, "milk");
    expect(await screen.findByRole("option", { name: /milk the cow/i })).toBeInTheDocument();
    expect(api.to("GET /api/search").every((c) => c.query.get("q") !== null)).toBe(true);
    const list = screen.getByRole("listbox");
    expect(within(list).getByText(/in Farm/)).toBeInTheDocument();
    expect(within(list).getByText("Done")).toBeInTheDocument();
  });

  it("does not search for a single character", async () => {
    const { user, input } = await searchMode();
    await user.type(input, "m");
    await new Promise((r) => setTimeout(r, 300));
    expect(api.to("GET /api/search")).toHaveLength(0);
  });

  it("debounces: typing fast sends one request for the final text", async () => {
    api.on("GET /api/search", results);
    const { user, input } = await searchMode();
    await user.type(input, "milk", { delay: 10 });
    await screen.findByRole("option", { name: /milk the cow/i });
    const queries = api.to("GET /api/search").map((c) => c.query.get("q"));
    expect(queries[queries.length - 1]).toBe("milk");
    expect(queries.length).toBeLessThanOrEqual(2);
  });

  it("arrow keys move the selection and Enter opens the task on its board", async () => {
    api.on("GET /api/search", results);
    const { user, input } = await searchMode();
    await user.type(input, "milk");
    await screen.findByRole("option", { name: /milk the cow/i });
    // the selection starts on the first row; there are no page matches for "milk"
    await user.keyboard("{Enter}");
    expect(router.push).toHaveBeenCalledWith("/group/g-work?task=t1");
  });

  it("a subtask opens through its parent", async () => {
    api.on("GET /api/search", results);
    const { user, input } = await searchMode();
    await user.type(input, "milk");
    await screen.findByRole("option", { name: /milk the cow/i });
    await user.keyboard("{ArrowDown}{Enter}");
    expect(router.push).toHaveBeenCalledWith("/group/g-personal?task=p1");
  });

  it("clicking a page navigates and closes", async () => {
    const { user } = await searchMode();
    await user.click(within(screen.getByRole("listbox")).getByText("Calendar"));
    expect(router.push).toHaveBeenCalledWith("/calendar");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Pomodoro opens in a new tab", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { user } = await searchMode();
    await user.click(within(screen.getByRole("listbox")).getByText("Pomodoro"));
    expect(open).toHaveBeenCalledWith("/pomodoro", "_blank", "noopener");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("with nothing found it offers to add the text as a task", async () => {
    const { user, input } = await searchMode();
    await user.type(input, "zzzz thing");
    expect(await screen.findByText("No tasks match")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("textbox", { name: "New task" })).toHaveValue("zzzz thing");
  });

  it("shows a failed search instead of results", async () => {
    api.on("GET /api/search", httpError(500, "Search failed badly"));
    const { user, input } = await searchMode();
    await user.type(input, "milk");
    expect(await screen.findByRole("alert")).toHaveTextContent("Search failed badly");
  });

  it("exposes the listbox pattern: the input names the selected option", async () => {
    const { input } = await searchMode();
    const active = input.getAttribute("aria-activedescendant");
    expect(active).toBeTruthy();
    expect(document.getElementById(active!)).toHaveAttribute("aria-selected", "true");
  });
});
