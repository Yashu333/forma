// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { LabelTask } from "@/types";
import LabelTasks from "./LabelTasks";
import { httpError, mockApi } from "../../tests/ui/fixtures";

const WORK = { id: "g-work", name: "Work", color: "#7C6EF8" };
const HOME = { id: "g-home", name: "Home", color: "#34D399" };

const lt = (o: Partial<LabelTask> & { id: string }): LabelTask => ({
  title: o.id,
  abcde: null,
  abcdeRank: null,
  plannedFor: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  group: WORK,
  ...o,
});

const row = (title: string) => screen.getByText(title).closest("li") as HTMLElement;
const letter = (title: string, l: string) => within(row(title)).getByRole("button", { name: new RegExp(`^${l},`) });
const section = (name: RegExp) => screen.getByRole("region", { name });

describe("LabelTasks", () => {
  it("shows unlabelled tasks first, then each letter with its codes", async () => {
    mockApi({
      "GET /api/abcde": {
        tasks: [lt({ id: "n", title: "New idea" }), lt({ id: "a2", title: "Second", abcde: "A", abcdeRank: 2 }), lt({ id: "a1", title: "First", abcde: "A", abcdeRank: 1 })],
        projects: [WORK],
      },
    });
    render(<LabelTasks />);
    const unl = await screen.findByRole("region", { name: /not labelled yet/i });
    expect(within(unl).getByText("New idea")).toBeInTheDocument();
    const a = section(/A · Must do/);
    const items = within(a).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([expect.stringContaining("A1First"), expect.stringContaining("A2Second")]);
  });

  it("tapping A gives the next A number and saves it", async () => {
    const api = mockApi({
      "GET /api/abcde": { tasks: [lt({ id: "x", title: "Write report" }), lt({ id: "a1", title: "Existing", abcde: "A", abcdeRank: 1 })], projects: [WORK] },
      "PATCH /api/abcde": { tasks: [] },
    });
    render(<LabelTasks />);
    await screen.findByText("Write report");
    await userEvent.click(letter("Write report", "A"));
    expect(within(section(/A · Must do/)).getByText("A2")).toBeInTheDocument();
    expect(letter("Write report", "A")).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(api.to("PATCH /api/abcde")).toHaveLength(1));
    expect(api.to("PATCH /api/abcde")[0].body).toEqual({ updates: [{ id: "x", abcde: "A", abcdeRank: 2 }] });
  });

  it("tapping the current letter again clears it and renumbers the rest", async () => {
    const api = mockApi({
      "GET /api/abcde": { tasks: [lt({ id: "a1", title: "One", abcde: "A", abcdeRank: 1 }), lt({ id: "a2", title: "Two", abcde: "A", abcdeRank: 2 })], projects: [WORK] },
      "PATCH /api/abcde": { tasks: [] },
    });
    render(<LabelTasks />);
    await screen.findByText("One");
    await userEvent.click(letter("One", "A"));
    await waitFor(() => expect(api.to("PATCH /api/abcde")).toHaveLength(1));
    expect(api.to("PATCH /api/abcde")[0].body).toEqual({
      updates: [{ id: "a2", abcde: "A", abcdeRank: 1 }, { id: "a1", abcde: null, abcdeRank: null }],
    });
    expect(within(section(/not labelled yet/i)).getByText("One")).toBeInTheDocument();
    expect(within(section(/A · Must do/)).getByText("A1")).toBeInTheDocument();
  });

  it("the arrows reorder within a letter", async () => {
    const api = mockApi({
      "GET /api/abcde": { tasks: [lt({ id: "a1", title: "One", abcde: "B", abcdeRank: 1 }), lt({ id: "a2", title: "Two", abcde: "B", abcdeRank: 2 })], projects: [WORK] },
      "PATCH /api/abcde": { tasks: [] },
    });
    render(<LabelTasks />);
    await screen.findByText("Two");
    expect(screen.getByRole("button", { name: "Move B1 up" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Move B2 up" }));
    await waitFor(() => expect(api.to("PATCH /api/abcde")).toHaveLength(1));
    const titles = within(section(/B · Should do/)).getAllByRole("listitem").map((li) => li.textContent);
    expect(titles).toEqual([expect.stringContaining("B1Two"), expect.stringContaining("B2One")]);
  });

  it("adds a task to the chosen project and keeps the input ready for the next one", async () => {
    const api = mockApi({
      "GET /api/abcde": { tasks: [], projects: [WORK, HOME] },
      "POST /api/abcde": (call) => lt({ id: "new", title: (call.body as { title: string }).title, group: HOME, createdAt: "2026-10-24T09:00:00.000Z" }),
    });
    render(<LabelTasks />);
    const input = await screen.findByLabelText("New task");
    expect(screen.getByText("No open tasks yet. Add one above.")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Project"), "g-home");
    await userEvent.type(input, "  Call the bank {Enter}");
    await screen.findByText("Call the bank");
    expect(api.to("POST /api/abcde")[0].body).toEqual({ title: "Call the bank", groupId: "g-home" });
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    expect(within(section(/not labelled yet/i)).getByText("Home")).toBeInTheDocument();
  });

  it("Add is disabled for an empty title", async () => {
    mockApi({ "GET /api/abcde": { tasks: [], projects: [WORK] } });
    render(<LabelTasks />);
    await screen.findByLabelText("New task");
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("New task"), "   ");
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
  });

  it("a failed add shows the error and keeps the text", async () => {
    mockApi({
      "GET /api/abcde": { tasks: [], projects: [WORK] },
      "POST /api/abcde": httpError(400, "This project has no columns"),
    });
    render(<LabelTasks />);
    await userEvent.type(await screen.findByLabelText("New task"), "Something{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("This project has no columns");
    expect(screen.getByLabelText("New task")).toHaveValue("Something");
  });

  it("a failed save shows the error and reloads what's stored", async () => {
    let loads = 0;
    mockApi({
      "GET /api/abcde": () => {
        loads += 1;
        return { tasks: [lt({ id: "x", title: "Task" })], projects: [WORK] };
      },
      "PATCH /api/abcde": httpError(500, "Couldn't save those labels"),
    });
    render(<LabelTasks />);
    await screen.findByText("Task");
    await userEvent.click(letter("Task", "C"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save those labels");
    await waitFor(() => expect(letter("Task", "C")).toHaveAttribute("aria-pressed", "false"));
    expect(loads).toBe(2);
  });

  it("with no projects, points to the dashboard instead of the add form", async () => {
    mockApi({ "GET /api/abcde": { tasks: [], projects: [] } });
    render(<LabelTasks />);
    expect(await screen.findByText("Create a project first, then add tasks here.")).toBeInTheDocument();
    expect(screen.queryByLabelText("New task")).not.toBeInTheDocument();
  });

  it("a failed load offers Retry", async () => {
    let fail = true;
    mockApi({
      "GET /api/abcde": () => (fail ? httpError(500, "Boom") : { tasks: [lt({ id: "x", title: "Back" })], projects: [WORK] }),
    });
    render(<LabelTasks />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Boom");
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Back")).toBeInTheDocument();
  });
});
