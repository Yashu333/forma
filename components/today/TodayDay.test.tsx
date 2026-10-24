// @vitest-environment jsdom
// The Today view (TodayDay + FrogCard), exercised through TodayView with a small
// fake server behind `fetch`, so optimistic updates and the silent refetch run
// exactly as they do in the browser.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task, TodayFrog, TodayPayload, TodayTask } from "@/types";
import TodayView from "./TodayView";
import {
  DATE,
  GROUP_HOME,
  GROUP_NODONE,
  GROUP_WORK,
  candidate,
  deferred,
  freezeNow,
  httpError,
  mockApi,
  payload,
  plan,
  task,
} from "../../tests/ui/fixtures";

const fire = vi.hoisted(() => vi.fn());
vi.mock("@/components/board/ConfettiCelebration", async () => {
  const React = await import("react");
  return {
    default: React.forwardRef(function FakeConfetti(_props: object, ref: React.Ref<{ fire: () => void }>) {
      React.useImperativeHandle(ref, () => ({ fire }));
      return null;
    }),
  };
});

const NOW = "2026-10-24T08:00:00Z"; // 10:00 in Europe/Berlin
const ATE_AT = "2026-10-24T07:42:00.000Z"; // 9:42 in Europe/Berlin (CEST)

beforeEach(() => {
  fire.mockClear();
  freezeNow(NOW);
});

/**
 * A fake server: GET /api/today answers from `state`, PATCH /api/tasks/:id moves a task into Done.
 * Like the real one, archiving takes the task off the list but leaves the plan's
 * frog untouched, so the next GET still returns the archived task as `frog`.
 */
function server(tasks: TodayTask[], opts: { frogId?: string | null; frog?: TodayFrog | null; streak?: number; patchError?: string } = {}) {
  const state = { tasks: tasks.map((t) => ({ ...t })), archived: [] as TodayTask[], frogId: opts.frogId ?? null, frog: opts.frog };
  const build = (): TodayPayload => {
    const frogRow = state.frogId ? [...state.tasks, ...state.archived].find((t) => t.id === state.frogId) : undefined;
    return payload({
      tasks: state.tasks.map((t) => ({ ...t })),
      frog: state.frog !== undefined ? state.frog && { ...state.frog, ...(state.tasks.find((t) => t.id === state.frog!.id) ?? {}) } : frogRow ? { ...frogRow, subtasks: [] } : null,
      frogId: state.frogId,
      streak: { current: opts.streak ?? 0, longest: opts.streak ?? 0 },
    });
  };
  const routes: Record<string, unknown> = {
    "GET /api/today": () => build(),
    "GET /api/today/candidates": [],
  };
  for (const t of tasks) {
    routes[`PATCH /api/tasks/${t.id}`] = (call: { body: unknown }) => {
      if (opts.patchError) return httpError(500, opts.patchError);
      const body = call.body as { statusId?: string; archived?: boolean };
      const row = state.tasks.find((x) => x.id === t.id)!;
      if (body.archived) {
        state.tasks = state.tasks.filter((x) => x.id !== t.id);
        state.archived.push({ ...row, archivedAt: ATE_AT } as TodayTask);
        return { ...row, archivedAt: ATE_AT };
      }
      row.statusId = body.statusId!;
      row.completedAt = ATE_AT;
      return { ...row };
    };
  }
  return { state, build, routes };
}

async function renderToday(s: ReturnType<typeof server>, extra: Record<string, unknown> = {}) {
  const api = mockApi({ ...s.routes, ...extra } as Parameters<typeof mockApi>[0]);
  const user = userEvent.setup();
  render(<TodayView />);
  await screen.findByRole("heading", { name: "Today" });
  return { api, user };
}

const listRows = () => within(screen.getByRole("heading", { name: "Today's list" }).parentElement!.nextElementSibling as HTMLElement).getAllByRole("listitem");
// A list row by its title (the frog card repeats the frog's title, so look only inside the list).
const row = (title: string) => {
  const found = listRows().find((li) => within(li).queryByRole("link", { name: title }));
  if (!found) throw new Error(`No list row titled "${title}"`);
  return found;
};
const rowTitles = () => listRows().map((li) => within(li).getAllByRole("link")[0].textContent);
const frogCard = () => screen.getByLabelText("Today's frog", { selector: "div" });
const sub = (id: string, order: number, o: Partial<Task> = {}): Task => ({
  id,
  title: id,
  groupId: GROUP_WORK.id,
  statusId: "s-todo",
  priority: "MEDIUM",
  order,
  createdBy: "u1",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  completedAt: null,
  ...o,
});
const frogWith = (t: TodayTask, subtasks: Task[]): TodayFrog => ({ ...t, subtasks });

describe("FrogCard", () => {
  it("shows the frog as the hero: title (linked to its project), badge, project chip, Ate it", async () => {
    const frog = task({ id: "f", title: "Ship the release", abcde: "A", abcdeRank: 1 });
    await renderToday(server([frog], { frogId: "f" }));
    const card = frogCard();
    expect(within(card).getByText("Today's frog", { selector: "span" })).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Ship the release" })).toHaveAttribute("href", "/group/g-work");
    expect(within(card).getByText("A-1")).toBeInTheDocument();
    expect(within(card).getByText("Work")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Ate it" })).toBeEnabled();
  });

  it("shows subtask progress and the next unfinished bite (by order)", async () => {
    const t = task({ id: "f", title: "Big thing" });
    const frog = frogWith(t, [
      sub("Third", 3),
      sub("First (done)", 1, { completedAt: "2026-10-24T06:00:00.000Z" }),
      sub("Second", 2),
    ]);
    await renderToday(server([t], { frogId: "f", frog }));
    const card = frogCard();
    expect(within(card).getByText("1 of 3 bites done")).toBeInTheDocument();
    expect(card).toHaveTextContent("Next bite: Second");
  });

  it("counts a subtask in the Done column as done even without completedAt", async () => {
    const t = task({ id: "f", title: "Big thing" });
    const frog = frogWith(t, [sub("A", 1, { statusId: "s-work-done" }), sub("B", 2)]);
    await renderToday(server([t], { frogId: "f", frog }));
    expect(within(frogCard()).getByText("1 of 2 bites done")).toBeInTheDocument();
    expect(frogCard()).toHaveTextContent("Next bite: B");
  });

  it("uses the singular for one bite and drops 'Next bite' when all are done", async () => {
    const t = task({ id: "f", title: "Big thing" });
    const frog = frogWith(t, [sub("Only", 1, { completedAt: "2026-10-24T06:00:00.000Z" })]);
    await renderToday(server([t], { frogId: "f", frog }));
    expect(within(frogCard()).getByText("1 of 1 bite done")).toBeInTheDocument();
    expect(frogCard()).not.toHaveTextContent("Next bite");
  });

  it("shows no progress block for a frog without subtasks", async () => {
    const frog = task({ id: "f", title: "Simple" });
    await renderToday(server([frog], { frogId: "f" }));
    expect(frogCard()).not.toHaveTextContent(/bites? done/);
    expect(frogCard()).not.toHaveTextContent("Next bite");
  });

  it("'Ate it' PATCHes the Done status, flips to 'Eaten at 9:42' in the local time zone and fires confetti", async () => {
    const frog = task({ id: "f", title: "Ship the release", abcde: "A" });
    const s = server([frog], { frogId: "f" });
    const { api, user } = await renderToday(s);
    await user.click(within(frogCard()).getByRole("button", { name: "Ate it" }));

    expect(await within(frogCard()).findByText("Eaten at 9:42")).toBeInTheDocument();
    const [patch] = api.to("PATCH /api/tasks/f");
    expect(patch.body).toEqual({ statusId: "s-work-done" });
    expect(within(frogCard()).queryByRole("button", { name: "Ate it" })).not.toBeInTheDocument();
    expect(within(frogCard()).getByText("Frog eaten")).toBeInTheDocument();
    expect(fire).toHaveBeenCalledTimes(1);
    // the list row is checked and locked, openA dropped
    const box = within(row("Ship the release")).getByRole("checkbox");
    expect(box).toHaveAttribute("aria-checked", "true");
    expect(box).toBeDisabled();
    expect(screen.getByText("1 of 1 done")).toBeInTheDocument();
  });

  it("flipping to the eaten state does not make React warn about conflicting style properties", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const frog = task({ id: "f", title: "Ship the release" });
    const { user } = await renderToday(server([frog], { frogId: "f" }));
    await user.click(within(frogCard()).getByRole("button", { name: "Ate it" }));
    await within(frogCard()).findByText("Eaten at 9:42");
    expect(errors.mock.calls.map((c) => String(c[0]))).toEqual([]);
  });

  it("formats the eaten time in the user's zone (CEST is UTC+2), not in UTC", async () => {
    const frog = task({ id: "f", title: "Late frog", completedAt: "2026-10-24T06:05:00.000Z" });
    await renderToday(server([frog], { frogId: "f" }));
    expect(within(frogCard()).getByText("Eaten at 8:05")).toBeInTheDocument();
  });

  it("names the day when the frog was eaten on an earlier day", async () => {
    const frog = task({ id: "f", title: "Early frog", completedAt: "2026-10-23T21:30:00.000Z" }); // 23:30 on the 23rd in Berlin
    await renderToday(server([frog], { frogId: "f" }));
    expect(within(frogCard()).getByText("Eaten on 2026-10-23 at 23:30")).toBeInTheDocument();
  });

  it("shows 'Eating…' disabled while the request is in flight, and a double click sends one PATCH", async () => {
    const gate = deferred();
    const frog = task({ id: "f", title: "Ship the release" });
    const s = server([frog], { frogId: "f" });
    const patch = s.routes["PATCH /api/tasks/f"] as (c: { body: unknown }) => unknown;
    const { api, user } = await renderToday(s, {
      "PATCH /api/tasks/f": async (call: { body: unknown }) => {
        await gate.promise;
        return patch(call);
      },
    });
    await user.dblClick(within(frogCard()).getByRole("button", { name: "Ate it" }));
    const eating = await within(frogCard()).findByRole("button", { name: "Eating…" });
    expect(eating).toBeDisabled();
    expect(api.to("PATCH /api/tasks/f")).toHaveLength(1);
    expect(fire).not.toHaveBeenCalled();
    await act(async () => gate.resolve());
    expect(await within(frogCard()).findByText("Eaten at 9:42")).toBeInTheDocument();
  });

  it("shows the error and keeps the button when marking done fails; no confetti", async () => {
    const frog = task({ id: "f", title: "Ship the release" });
    const { user } = await renderToday(server([frog], { frogId: "f", patchError: "Server exploded" }));
    await user.click(within(frogCard()).getByRole("button", { name: "Ate it" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Server exploded");
    expect(within(frogCard()).getByRole("button", { name: "Ate it" })).toBeEnabled();
    expect(fire).not.toHaveBeenCalled();
    // the error can be dismissed
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("is disabled with the tooltip text when the project has no Done column, and sends nothing", async () => {
    const frog = task({ id: "f", title: "Inbox thing", group: GROUP_NODONE });
    const { api, user } = await renderToday(server([frog], { frogId: "f" }));
    const btn = within(frogCard()).getByRole("button", { name: "Ate it" });
    expect(btn).toBeDisabled();
    expect(btn.closest("span")).toHaveAttribute("title", "This project has no Done column");
    expect(within(frogCard()).getByText(/This project has no Done column\./)).toBeInTheDocument();
    expect(within(frogCard()).getByRole("link", { name: "Open the board" })).toHaveAttribute("href", "/group/g-nodone");
    await user.click(btn);
    expect(api.to("PATCH /api/tasks/f")).toHaveLength(0);
  });

  it("is already in the eaten state on load when the frog is done", async () => {
    const frog = task({ id: "f", title: "Done early", completedAt: "2026-10-24T05:07:00.000Z" });
    await renderToday(server([frog], { frogId: "f" }));
    expect(within(frogCard()).getByText("Eaten at 7:07")).toBeInTheDocument();
    expect(within(frogCard()).getByRole("link", { name: "Done early" })).toHaveStyle({ textDecoration: "line-through" });
  });

  it("with no frog shows a prompt that opens the plan editor", async () => {
    const t = task({ id: "t1", title: "Something" });
    const { user } = await renderToday(server([t], { frogId: null }));
    expect(screen.getByText(/No frog chosen for today/)).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Edit your plan" })[0]);
    expect(screen.getByRole("heading", { name: "Edit your plan" })).toBeInTheDocument();
  });

  it("marks the frog's row in the list and fires confetti when it is checked off from the list", async () => {
    const frog = task({ id: "f", title: "Ship the release" });
    const other = task({ id: "o", title: "Other", order: 1 });
    const { user } = await renderToday(server([frog, other], { frogId: "f" }));
    expect(within(row("Ship the release")).getByTitle("Today's frog")).toBeInTheDocument();
    expect(within(row("Other")).queryByTitle("Today's frog")).not.toBeInTheDocument();
    await user.click(within(row("Other")).getByRole("checkbox"));
    await waitFor(() => expect(within(row("Other")).getByRole("checkbox")).toBeDisabled());
    expect(fire).not.toHaveBeenCalled();
    await user.click(within(row("Ship the release")).getByRole("checkbox"));
    await waitFor(() => expect(fire).toHaveBeenCalledTimes(1));
  });
});

describe("TodayDay: header", () => {
  it("shows the date, the Edit plan button and an enabled Close the day", async () => {
    await renderToday(server([task({ id: "t1", title: "Task" })]));
    expect(screen.getByText("Saturday, October 24")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /edit plan/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /close the day/i })).toBeEnabled();
  });

  it("clicking Close the day opens the review flow without calling the server", async () => {
    const { api, user } = await renderToday(server([task({ id: "t1", title: "Task" })]));
    const before = api.calls.length;
    await user.click(screen.getByRole("button", { name: /close the day/i }));
    expect(api.calls).toHaveLength(before);
    expect(screen.getByRole("heading", { name: "Close the day" })).toBeInTheDocument();
  });

  it("shows the streak chip only while the current streak is above zero", async () => {
    const t = task({ id: "t1", title: "Task" });
    await renderToday(server([t], { streak: 4 }));
    expect(screen.getByText("🔥 4-day frog streak")).toBeInTheDocument();
  });

  it("shows '1-day' for a streak of one", async () => {
    await renderToday(server([task({ id: "t1", title: "Task" })], { streak: 1 }));
    expect(screen.getByText("🔥 1-day frog streak")).toBeInTheDocument();
  });

  it("shows no streak chip at zero", async () => {
    await renderToday(server([task({ id: "t1", title: "Task" })], { streak: 0 }));
    expect(screen.queryByText(/frog streak/)).not.toBeInTheDocument();
  });

  it("an empty plan says so and offers Edit your plan", async () => {
    const { user } = await renderToday(server([]));
    expect(screen.getByText("Nothing planned for today.")).toBeInTheDocument();
    expect(screen.getByText("0 of 0 done")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Edit your plan" })[0]);
    expect(screen.getByRole("heading", { name: "Edit your plan" })).toBeInTheDocument();
  });
});

describe("TodayDay: Edit plan", () => {
  it("opens at Pick with the current selections, and saves with finalize:true", async () => {
    const a = task({ id: "a", title: "Alpha", abcde: "A", abcdeRank: 1 });
    const b = task({ id: "b", title: "Bravo", order: 1, completedAt: "2026-10-24T06:00:00.000Z" });
    const s = server([a, b], { frogId: "a" });
    const { api, user } = await renderToday(s, {
      "GET /api/today/candidates": [
        { id: "a", title: "Alpha", groupId: "g-work", statusId: "s", priority: "MEDIUM", order: 0, abcde: "A", abcdeRank: 1, plannedFor: DATE, dueDate: null, group: { id: "g-work", name: "Work", color: "#7C6EF8" } },
        { id: "z", title: "Zulu", groupId: "g-home", statusId: "s", priority: "MEDIUM", order: 0, abcde: null, abcdeRank: null, plannedFor: null, dueDate: null, group: { id: "g-home", name: "Home", color: "#34D399" } },
      ],
      "PUT /api/today": () => s.build(),
    });
    await user.click(screen.getByRole("button", { name: /edit plan/i }));
    expect(screen.getByRole("heading", { name: "What will you work on today?" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /^Alpha/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /^Bravo/ })).toBeChecked(); // done, still planned
    expect(screen.getByRole("checkbox", { name: /^Zulu/ })).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: /label them/i }));
    await user.click(screen.getByRole("button", { name: /choose your frog/i }));
    await user.click(screen.getByRole("button", { name: "Save plan" }));
    await screen.findByRole("heading", { name: "Today" });
    const body = api.to("PUT /api/today")[0].body as { finalize: boolean; taskIds: string[]; frogTaskId: string };
    expect(body.finalize).toBe(true);
    expect([...body.taskIds].sort()).toEqual(["a", "b"]);
    expect(body.frogTaskId).toBe("a");
  });
});

describe("TodayDay: the list", () => {
  it("shows rows in the server's (compareTasks) order with badge, project chip and a link to the project", async () => {
    const tasks = [
      task({ id: "a1", title: "Alpha one", abcde: "A", abcdeRank: 1, order: 5 }),
      task({ id: "a2", title: "Alpha two", abcde: "A", abcdeRank: 2, order: 1 }),
      task({ id: "b", title: "Bravo", abcde: "B", order: 0, group: GROUP_HOME }),
      task({ id: "n", title: "No letter", order: 0 }),
    ];
    await renderToday(server(tasks));
    expect(rowTitles()).toEqual(["Alpha one", "Alpha two", "Bravo", "No letter"]);
    expect(within(row("Alpha one")).getByText("A-1")).toBeInTheDocument();
    expect(within(row("Bravo")).getByText("B")).toBeInTheDocument();
    expect(within(row("Bravo")).getByText("Home")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Bravo" })).toHaveAttribute("href", "/group/g-home");
    expect(screen.getByText("0 of 4 done")).toBeInTheDocument();
  });

  it("shows a 'Delegate' tag on D tasks only", async () => {
    const tasks = [
      task({ id: "d", title: "Hand off", abcde: "D" }),
      task({ id: "c", title: "Nice", abcde: "C", order: 1 }),
    ];
    await renderToday(server(tasks));
    expect(within(row("Hand off")).getByText("Delegate")).toBeInTheDocument();
    expect(within(row("Nice")).queryByText("Delegate")).not.toBeInTheDocument();
  });

  it("marking done sends PATCH {statusId: doneStatusId}, then locks the checkbox and offers 'Reopen on board'", async () => {
    const tasks = [task({ id: "t1", title: "Do it", group: GROUP_HOME })];
    const { api, user } = await renderToday(server(tasks));
    const box = within(row("Do it")).getByRole("checkbox");
    expect(box).toHaveAttribute("aria-checked", "false");
    await user.click(box);
    await waitFor(() => expect(within(row("Do it")).getByRole("checkbox")).toHaveAttribute("aria-checked", "true"));
    expect(api.to("PATCH /api/tasks/t1")[0].body).toEqual({ statusId: "s-home-done" });
    expect(within(row("Do it")).getByRole("checkbox")).toBeDisabled();
    expect(within(row("Do it")).getByRole("link", { name: "Reopen on board" })).toHaveAttribute("href", "/group/g-home");
    // clicking a locked checkbox sends nothing
    await user.click(within(row("Do it")).getByRole("checkbox"));
    expect(api.to("PATCH /api/tasks/t1")).toHaveLength(1);
  });

  it("a task loaded as done is locked from the start", async () => {
    const tasks = [task({ id: "t1", title: "Already done", completedAt: "2026-10-24T05:00:00.000Z" })];
    const { api, user } = await renderToday(server(tasks));
    const box = within(row("Already done")).getByRole("checkbox");
    expect(box).toHaveAttribute("aria-checked", "true");
    expect(box).toBeDisabled();
    await user.click(box);
    expect(api.to("PATCH /api/tasks/t1")).toHaveLength(0);
  });

  it("disables the checkbox (with a tooltip) when the project has no Done column", async () => {
    const tasks = [task({ id: "t1", title: "Inbox thing", group: GROUP_NODONE })];
    await renderToday(server(tasks));
    const box = within(row("Inbox thing")).getByRole("checkbox");
    expect(box).toBeDisabled();
    expect(box.closest("span")).toHaveAttribute("title", "This project has no Done column");
  });

  it("silently refreshes after a change so the streak shows up", async () => {
    const tasks = [task({ id: "f", title: "Frog", abcde: "A" })];
    const s = server(tasks, { frogId: "f", streak: 0 });
    const { api, user } = await renderToday(s);
    expect(screen.queryByText(/frog streak/)).not.toBeInTheDocument();
    // The server now counts today: the next GET carries the new streak.
    api.on("GET /api/today", () => ({ ...s.build(), streak: { current: 3, longest: 3 } }));
    await user.click(within(frogCard()).getByRole("button", { name: "Ate it" }));
    expect(await screen.findByText("🔥 3-day frog streak")).toBeInTheDocument();
    expect(api.to("GET /api/today")).toHaveLength(2);
  });

  it("keeps the optimistic state when the silent refresh fails", async () => {
    const tasks = [task({ id: "t1", title: "Do it" })];
    const s = server(tasks);
    const { api, user } = await renderToday(s);
    api.on("GET /api/today", () => httpError(500, "boom"));
    await user.click(within(row("Do it")).getByRole("checkbox"));
    await waitFor(() => expect(api.to("GET /api/today")).toHaveLength(2));
    expect(within(row("Do it")).getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("TodayDay: A-first rule", () => {
  const mixed = () => [
    task({ id: "a", title: "Alpha", abcde: "A", abcdeRank: 1 }),
    task({ id: "b", title: "Bravo", abcde: "B", order: 1 }),
    task({ id: "c", title: "Charlie", abcde: "C", order: 2 }),
    task({ id: "d", title: "Delta", abcde: "D", order: 3 }),
    task({ id: "e", title: "Echo", abcde: "E", order: 4 }),
    task({ id: "n", title: "Nolabel", order: 5 }),
  ];

  it("shows 'A tasks first' on B and C rows only while an A task is open", async () => {
    await renderToday(server(mixed()));
    for (const t of ["Bravo", "Charlie"]) expect(within(row(t)).getByText("A tasks first")).toBeInTheDocument();
    for (const t of ["Alpha", "Delta", "Echo", "Nolabel"]) expect(within(row(t)).queryByText("A tasks first")).not.toBeInTheDocument();
  });

  it("shows no hint when no A task is open", async () => {
    const tasks = mixed().filter((t) => t.id !== "a");
    await renderToday(server(tasks));
    expect(screen.queryByText("A tasks first")).not.toBeInTheDocument();
  });

  it("shows no hint when the only A task is already done", async () => {
    const tasks = mixed().map((t) => (t.id === "a" ? { ...t, completedAt: "2026-10-24T05:00:00.000Z" } : t));
    await renderToday(server(tasks));
    expect(screen.queryByText("A tasks first")).not.toBeInTheDocument();
  });

  it("the hint disappears once the last A task is done", async () => {
    const { user } = await renderToday(server(mixed()));
    expect(screen.getAllByText("A tasks first")).toHaveLength(2);
    await user.click(within(row("Alpha")).getByRole("checkbox"));
    await waitFor(() => expect(screen.queryByText("A tasks first")).not.toBeInTheDocument());
  });

  it("checking a B while one A is open shows the singular notice, and still completes the task (non-blocking)", async () => {
    const { api, user } = await renderToday(server(mixed()));
    await user.click(within(row("Bravo")).getByRole("checkbox"));
    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent("1 A-task still open — the book says finish those first.");
    expect(api.to("PATCH /api/tasks/b")).toHaveLength(1);
    expect(within(row("Bravo")).getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
  });

  it("uses the plural for two open A tasks, for a C task too", async () => {
    const tasks = [...mixed(), task({ id: "a2", title: "Alpha two", abcde: "A", abcdeRank: 2, order: 9 })];
    const { user } = await renderToday(server(tasks));
    await user.click(within(row("Charlie")).getByRole("checkbox"));
    expect(await screen.findByRole("status")).toHaveTextContent("2 A-tasks still open — the book says finish those first.");
  });

  it("shows no notice for checking an A, D, E-less or unlabelled task, or when no A is open", async () => {
    const { user } = await renderToday(server(mixed()));
    for (const [title, id] of [["Delta", "d"], ["Nolabel", "n"], ["Alpha", "a"]] as const) {
      await user.click(within(row(title)).getByRole("checkbox"));
      await waitFor(() => expect(within(row(title)).getByRole("checkbox")).toHaveAttribute("aria-checked", "true"));
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(id).toBeTruthy();
    }
    // all A's done now: a B has no notice
    await user.click(within(row("Bravo")).getByRole("checkbox"));
    await waitFor(() => expect(within(row("Bravo")).getByRole("checkbox")).toHaveAttribute("aria-checked", "true"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("the notice can be dismissed and is replaced by the next check-off's outcome", async () => {
    const { user } = await renderToday(server(mixed()));
    await user.click(within(row("Bravo")).getByRole("checkbox"));
    await screen.findByRole("status");
    await user.click(within(screen.getByRole("status")).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await user.click(within(row("Charlie")).getByRole("checkbox"));
    await screen.findByRole("status");
    await user.click(within(row("Nolabel")).getByRole("checkbox"));
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });
});

describe("TodayDay: Eliminate (E tasks)", () => {
  const withE = () => [
    task({ id: "a", title: "Alpha", abcde: "A" }),
    task({ id: "e", title: "Echo", abcde: "E", order: 1 }),
    task({ id: "x", title: "Plain", abcde: "C", order: 2 }),
  ];

  it("only E tasks that are not done have an Eliminate button", async () => {
    const tasks = [...withE(), task({ id: "e2", title: "Old echo", abcde: "E", order: 3, completedAt: "2026-10-24T05:00:00.000Z" })];
    await renderToday(server(tasks));
    expect(within(row("Echo")).getByRole("button", { name: "Eliminate" })).toBeInTheDocument();
    expect(within(row("Old echo")).queryByRole("button", { name: "Eliminate" })).not.toBeInTheDocument();
    expect(within(row("Alpha")).queryByRole("button", { name: "Eliminate" })).not.toBeInTheDocument();
    expect(within(row("Plain")).queryByRole("button", { name: "Eliminate" })).not.toBeInTheDocument();
  });

  it("opens a ConfirmDialog first and sends nothing until it is confirmed", async () => {
    const { api, user } = await renderToday(server(withE()));
    await user.click(within(row("Echo")).getByRole("button", { name: "Eliminate" }));
    expect(screen.getByText("Eliminate this task?")).toBeInTheDocument();
    expect(screen.getByText(/"Echo" will be archived/)).toBeInTheDocument();
    expect(api.to("PATCH /api/tasks/e")).toHaveLength(0);
  });

  it("on confirm sends PATCH {archived:true} ALONE and removes the row", async () => {
    const { api, user } = await renderToday(server(withE()));
    await user.click(within(row("Echo")).getByRole("button", { name: "Eliminate" }));
    const dialog = screen.getByText("Eliminate this task?").closest("div.fixed") as HTMLElement;
    await user.click(within(dialog).getByRole("button", { name: "Eliminate" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "Echo" })).not.toBeInTheDocument());
    const [patch] = api.to("PATCH /api/tasks/e");
    expect(patch.body).toStrictEqual({ archived: true });
    expect(screen.queryByText("Eliminate this task?")).not.toBeInTheDocument();
    expect(screen.getByText("0 of 2 done")).toBeInTheDocument();
  });

  it("Cancel closes the dialog and does nothing", async () => {
    const { api, user } = await renderToday(server(withE()));
    const before = api.calls.length;
    await user.click(within(row("Echo")).getByRole("button", { name: "Eliminate" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Eliminate this task?")).not.toBeInTheDocument();
    expect(api.calls).toHaveLength(before);
    expect(screen.getByRole("link", { name: "Echo" })).toBeInTheDocument();
  });

  it("Escape also cancels", async () => {
    const { api, user } = await renderToday(server(withE()));
    const before = api.calls.length;
    await user.click(within(row("Echo")).getByRole("button", { name: "Eliminate" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByText("Eliminate this task?")).not.toBeInTheDocument();
    expect(api.calls).toHaveLength(before);
  });

  it("eliminating the frog clears the frog card", async () => {
    const tasks = [task({ id: "e", title: "Echo", abcde: "E" }), task({ id: "a", title: "Alpha", abcde: "A", order: 1 })];
    const { user } = await renderToday(server(tasks, { frogId: "e" }));
    expect(within(frogCard()).getByRole("link", { name: "Echo" })).toBeInTheDocument();
    await user.click(within(row("Echo")).getByRole("button", { name: "Eliminate" }));
    const dialog = screen.getByText("Eliminate this task?").closest("div.fixed") as HTMLElement;
    await user.click(within(dialog).getByRole("button", { name: "Eliminate" }));
    expect(await screen.findByText(/No frog chosen for today/)).toBeInTheDocument();
  });

  it("an archived, uneaten frog that the refresh returns stays out of the frog card (no 'Ate it')", async () => {
    const tasks = [task({ id: "e", title: "Echo", abcde: "E" }), task({ id: "a", title: "Alpha", abcde: "A", order: 1 })];
    const s = server(tasks, { frogId: "e" });
    const { api, user } = await renderToday(s);
    await user.click(within(row("Echo")).getByRole("button", { name: "Eliminate" }));
    const dialog = screen.getByText("Eliminate this task?").closest("div.fixed") as HTMLElement;
    await user.click(within(dialog).getByRole("button", { name: "Eliminate" }));
    // The silent refetch must have run, and it really did hand back the archived frog.
    await waitFor(() => expect(api.to("GET /api/today")).toHaveLength(2));
    const refetched = s.build();
    expect(refetched.frog).toMatchObject({ id: "e", archivedAt: ATE_AT, completedAt: null });
    expect(refetched.plan?.frogTaskId).toBe("e");
    expect(await screen.findByText(/No frog chosen for today/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ate it" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Today's frog", { selector: "div" })).not.toBeInTheDocument();
  });

  it("an archived frog that comes back from a plain load is not shown either", async () => {
    const archivedFrog = { ...task({ id: "e", title: "Echo", abcde: "E" }), archivedAt: ATE_AT, subtasks: [] } as TodayFrog;
    await renderToday(server([task({ id: "a", title: "Alpha", abcde: "A" })], { frogId: "e", frog: archivedFrog }));
    expect(screen.getByText(/No frog chosen for today/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ate it" })).not.toBeInTheDocument();
  });

  it("an archived AND eaten frog still shows as eaten", async () => {
    const eaten = { ...task({ id: "e", title: "Echo", abcde: "A", completedAt: ATE_AT }), archivedAt: "2026-10-24T07:50:00.000Z", subtasks: [] } as TodayFrog;
    await renderToday(server([task({ id: "a", title: "Alpha", abcde: "B", order: 1 })], { frogId: "e", frog: eaten }));
    const card = frogCard();
    expect(within(card).getByText("Frog eaten")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Echo" })).toBeInTheDocument();
    expect(card).toHaveTextContent("Eaten at 9:42");
    expect(within(card).queryByRole("button", { name: "Ate it" })).not.toBeInTheDocument();
    expect(screen.queryByText(/No frog chosen for today/)).not.toBeInTheDocument();
  });

  it("shows the error and keeps the row when archiving fails", async () => {
    const { user } = await renderToday(server(withE(), { patchError: "Cannot archive" }));
    await user.click(within(row("Echo")).getByRole("button", { name: "Eliminate" }));
    const dialog = screen.getByText("Eliminate this task?").closest("div.fixed") as HTMLElement;
    await user.click(within(dialog).getByRole("button", { name: "Eliminate" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot archive");
    expect(screen.getByRole("link", { name: "Echo" })).toBeInTheDocument();
  });
});

describe("TodayDay: races between optimistic updates and the silent refetch", () => {
  it("a slow refresh that answers after a newer one must not overwrite it (out-of-order responses)", async () => {
    const x = task({ id: "x", title: "Xray" });
    const y = task({ id: "y", title: "Yankee", order: 1 });
    const s = server([x, y]);
    const { api, user } = await renderToday(s);

    // Hold both refreshes open and answer them out of order.
    const refreshes: ReturnType<typeof deferred<TodayPayload>>[] = [];
    api.on("GET /api/today", () => {
      const d = deferred<TodayPayload>();
      refreshes.push(d);
      return d.promise;
    });

    await user.click(within(row("Xray")).getByRole("checkbox")); // PATCH x, refresh #1 (sees only x done)
    await waitFor(() => expect(refreshes).toHaveLength(1));
    const afterX = s.build();
    await user.click(within(row("Yankee")).getByRole("checkbox")); // PATCH y, refresh #2 (sees both)
    await waitFor(() => expect(refreshes).toHaveLength(2));
    const afterBoth = s.build();

    await act(async () => refreshes[1].resolve(afterBoth)); // newer answer arrives first
    await act(async () => refreshes[0].resolve(afterX)); // the stale answer arrives last
    expect(within(row("Xray")).getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
    // Yankee IS done on the server; the screen must not go back to "open".
    expect(within(row("Yankee")).getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
  });

  it("a refresh that was in flight when the date rolled over does not overwrite the new day", async () => {
    freezeNow("2026-10-24T21:58:00Z", { intervals: true }); // 23:58 on the 24th in Berlin
    const x = task({ id: "x", title: "Xray" });
    const s = server([x]);
    const api = mockApi({
      ...s.routes,
      "GET /api/today": (call: { query: URLSearchParams }) =>
        call.query.get("date") === DATE ? s.build() : payload({ date: "2026-10-25", plan: null, tasks: [], frog: null }),
    } as Parameters<typeof mockApi>[0]);
    const user = userEvent.setup();
    render(<TodayView />);
    await screen.findByRole("heading", { name: "Today" });

    const old = deferred<TodayPayload>();
    api.on("GET /api/today", (call) => (call.query.get("date") === DATE ? old.promise : payload({ date: "2026-10-25", plan: null, tasks: [], frog: null })));
    await user.click(within(row("Xray")).getByRole("checkbox")); // starts a refresh for the 24th
    await waitFor(() => expect(api.to("GET /api/today")).toHaveLength(2));

    vi.setSystemTime(new Date("2026-10-24T22:01:00Z"));
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(await screen.findByRole("heading", { name: "Plan my day" })).toBeInTheDocument();
    await act(async () => old.resolve(s.build()));
    expect(screen.getByRole("heading", { name: "Plan my day" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Today's list" })).not.toBeInTheDocument();
  });
});

// ── M5: Close the day, through TodayView with a fake server ─────────────────────

describe("TodayDay: close the day", () => {
  const REVIEWED_AT = "2026-10-24T18:00:00.000Z";

  /** A server that also understands POST /api/today/review (moves tasks like the real one). */
  function reviewServer(tasks: TodayTask[], opts: { frogId?: string | null; streak?: number; reviewed?: boolean } = {}) {
    const s = server(tasks, { frogId: opts.frogId ?? null, streak: opts.streak });
    const state = { reviewed: opts.reviewed ?? false, rating: null as number | null, wentWell: null as string | null, improve: null as string | null };
    const build = (): TodayPayload => {
      const p = s.build();
      return state.reviewed ? { ...p, plan: { ...p.plan!, reviewedAt: REVIEWED_AT, rating: state.rating, wentWell: state.wentWell, improve: state.improve } } : p;
    };
    s.routes["GET /api/today"] = (call: { query: URLSearchParams }) =>
      call.query.get("date") === DATE ? build() : payload({ date: call.query.get("date")!, plan: null, tasks: [], frog: null });
    s.routes["POST /api/today/review"] = (call: { body: unknown }) => {
      const b = call.body as { moves: { taskId: string; action: string }[]; rating: number | null; wentWell: string; improve: string };
      for (const m of b.moves) {
        // moved off today's list, whatever the action; the plan's frog row is still returned, like the real server does
        s.state.archived.push(...s.state.tasks.filter((t) => t.id === m.taskId));
        s.state.tasks = s.state.tasks.filter((t) => t.id !== m.taskId);
      }
      Object.assign(state, { reviewed: true, rating: b.rating, wentWell: b.wentWell || null, improve: b.improve || null });
      return build();
    };
    return { ...s, build, review: state };
  }

  const cont = () => screen.getByRole("button", { name: /continue/i });
  const save = () => screen.getByRole("button", { name: /save and close the day/i });
  const open3 = () => [task({ id: "a", title: "Alpha", abcde: "A", abcdeRank: 1 }), task({ id: "b", title: "Bravo", order: 1 }), task({ id: "c", title: "Charlie", order: 2 })];

  it("before the day is reviewed: the Close the day button, no summary card", async () => {
    await renderToday(reviewServer(open3(), { frogId: "a" }));
    expect(screen.getByRole("button", { name: "Close the day" })).toBeEnabled();
    expect(screen.queryByRole("region", { name: "Day closed" })).not.toBeInTheDocument();
  });

  it("once plan.reviewedAt is set: the Day closed card (once), Edit review, and no Close the day button", async () => {
    const t = [task({ id: "a", title: "Alpha" })];
    await renderToday(reviewServer(t, { frogId: "a", reviewed: true }));
    expect(screen.getAllByRole("region", { name: "Day closed" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: /edit review/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close the day" })).not.toBeInTheDocument();
    // the Today view is still there under the card
    expect(screen.getByRole("heading", { name: "Today's list" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /edit plan/i })).toBeEnabled();
  });

  it("the card's tomorrow line comes from a quiet GET for tomorrow", async () => {
    const s = reviewServer([task({ id: "a", title: "Alpha" })], { frogId: "a", reviewed: true });
    const tf = task({ id: "tf", title: "Tomorrow's pick", plannedFor: "2026-10-25" });
    s.routes["GET /api/today"] = (call: { query: URLSearchParams }) =>
      call.query.get("date") === DATE ? s.build() : payload({ date: "2026-10-25", plan: plan({ date: "2026-10-25", frogTaskId: "tf", plannedAt: null }), tasks: [tf], frog: { ...tf, subtasks: [] } });
    const { api } = await renderToday(s);
    expect(await screen.findByText("Tomorrow's pick")).toBeInTheDocument();
    expect(api.to("GET /api/today").map((c) => c.query.get("date"))).toEqual([DATE, "2026-10-25"]);
  });

  it("Close the day opens the flow without calling the server; Cancel returns to the Today view unchanged", async () => {
    const { api, user } = await renderToday(reviewServer(open3(), { frogId: "a" }));
    const before = api.calls.length;
    await user.click(screen.getByRole("button", { name: "Close the day" }));
    expect(screen.getByRole("heading", { name: "Close the day" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Today's list" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Today's list" })).toBeInTheDocument();
    expect(api.calls).toHaveLength(before);
    expect(screen.queryByRole("region", { name: "Day closed" })).not.toBeInTheDocument();
  });

  it("saving swaps the flow for the Day closed card with the server's payload, and refreshes the candidates", async () => {
    const s = reviewServer(open3(), { frogId: "a", streak: 3 });
    const { api, user } = await renderToday(s);
    await user.click(screen.getByRole("button", { name: "Close the day" }));
    await user.click(cont()); // Unfinished
    await user.click(within(screen.getByRole("radiogroup", { name: "What to do with Charlie" })).getByRole("radio", { name: "Backlog" }));
    await user.click(cont()); // Reflect
    await user.click(screen.getByRole("radio", { name: /4 of 5/ }));
    await user.type(screen.getByLabelText("What went well?"), "A calm day");
    await user.click(cont()); // Frog
    await user.click(save());

    const card = await screen.findByRole("region", { name: "Day closed" });
    expect(within(card).getByText("Not eaten")).toBeInTheDocument();
    expect(within(card).getByText("🔥 3-day frog streak")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Close the day" })).not.toBeInTheDocument();
    // the moved tasks left today's list (the server's payload replaced the old one)
    expect(screen.queryByRole("link", { name: "Charlie" })).not.toBeInTheDocument();
    expect(api.to("POST /api/today/review")).toHaveLength(1);
    expect(api.to("POST /api/today/review")[0].body).toMatchObject({ date: DATE, rating: 4, wentWell: "A calm day", tomorrowFrogTaskId: "a" });
    await waitFor(() => expect(api.to("GET /api/today/candidates")).toHaveLength(2));
  });

  it("Edit review reopens the flow prefilled with the saved reflection; Cancel goes back to the card", async () => {
    const s = reviewServer([task({ id: "a", title: "Alpha", completedAt: ATE_AT })], { frogId: "a", reviewed: true });
    s.review.rating = 5;
    s.review.wentWell = "Went great";
    s.review.improve = "Nothing";
    const { user } = await renderToday(s);
    await user.click(screen.getByRole("button", { name: /edit review/i }));
    expect(screen.getByRole("heading", { name: "Edit your review" })).toBeInTheDocument();
    await user.click(cont());
    expect(screen.getByRole("radio", { name: /5 of 5/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("What went well?")).toHaveValue("Went great");
    expect(screen.getByLabelText("What would you do differently tomorrow?")).toHaveValue("Nothing");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("region", { name: "Day closed" })).toBeInTheDocument();
  });

  it("an edited review that is saved shows the card again with the new values and one card only", async () => {
    const s = reviewServer([task({ id: "a", title: "Alpha", completedAt: ATE_AT })], { frogId: "a", reviewed: true });
    const { api, user } = await renderToday(s);
    await user.click(screen.getByRole("button", { name: /edit review/i }));
    await user.click(cont());
    await user.click(screen.getByRole("radio", { name: /2 of 5/ }));
    await user.click(save());
    await waitFor(() => expect(api.to("POST /api/today/review")).toHaveLength(1));
    expect(await screen.findByRole("button", { name: /edit review/i })).toBeInTheDocument();
    expect(screen.getAllByRole("region", { name: "Day closed" })).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: /your review/i })).not.toBeInTheDocument();
  });

  it("a failed save keeps the flow open with the error and the user's input; nothing else on the page changes", async () => {
    const s = reviewServer(open3(), { frogId: "a" });
    s.routes["POST /api/today/review"] = httpError(500, "Review exploded");
    const { user } = await renderToday(s);
    await user.click(screen.getByRole("button", { name: "Close the day" }));
    await user.click(cont());
    await user.click(cont());
    await user.type(screen.getByLabelText("What went well?"), "keep me");
    await user.click(cont());
    await user.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent("Review exploded");
    expect(screen.getByRole("heading", { name: "Close the day" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Day closed" })).not.toBeInTheDocument();
  });

  it("the open flow survives a silent refresh arriving from an earlier action", async () => {
    const s = reviewServer(open3(), { frogId: "a" });
    const { api, user } = await renderToday(s);
    const gate = deferred<TodayPayload>();
    api.on("GET /api/today", () => gate.promise);
    await user.click(within(row("Charlie")).getByRole("checkbox")); // PATCH + a refresh that stays open
    await waitFor(() => expect(api.to("GET /api/today")).toHaveLength(2));
    await user.click(screen.getByRole("button", { name: "Close the day" }));
    await user.click(cont()); // Unfinished
    await user.click(within(screen.getByRole("radiogroup", { name: "What to do with Bravo" })).getByRole("radio", { name: "Archive" }));
    await act(async () => gate.resolve(s.build())); // the refresh lands mid-flow (task c now done)
    expect(screen.getByRole("heading", { name: "Close the day" })).toBeInTheDocument();
    expect(within(screen.getByRole("radiogroup", { name: "What to do with Bravo" })).getByRole("radio", { name: "Archive" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("radiogroup", { name: "What to do with Charlie" })).not.toBeInTheDocument(); // finished
  });

  it("an older in-flight refresh is dropped after the review: the closed day isn't reverted", async () => {
    const s = reviewServer(open3(), { frogId: "a" });
    const { api, user } = await renderToday(s);
    const stale = deferred<TodayPayload>();
    api.on("GET /api/today", (call) => (call.query.get("date") === DATE && api.to("GET /api/today").length === 2 ? stale.promise : s.build()));
    await user.click(within(row("Charlie")).getByRole("checkbox")); // refresh #2 is held open
    await waitFor(() => expect(api.to("GET /api/today")).toHaveLength(2));
    const unreviewed = s.build(); // what that old request saw: not reviewed

    await user.click(screen.getByRole("button", { name: "Close the day" }));
    await user.click(cont());
    await user.click(cont());
    await user.click(cont());
    await user.click(save());
    expect(await screen.findByRole("region", { name: "Day closed" })).toBeInTheDocument();

    await act(async () => stale.resolve(unreviewed));
    expect(screen.getByRole("region", { name: "Day closed" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close the day" })).not.toBeInTheDocument();
  });

  it("a candidates refresh that fails after the review is ignored", async () => {
    const s = reviewServer(open3(), { frogId: "a" });
    const { api, user } = await renderToday(s);
    let n = 0;
    api.on("GET /api/today/candidates", () => (++n >= 1 ? httpError(500, "candidates down") : []));
    await user.click(screen.getByRole("button", { name: "Close the day" }));
    for (let i = 0; i < 3; i++) await user.click(cont());
    await user.click(save());
    expect(await screen.findByRole("region", { name: "Day closed" })).toBeInTheDocument();
    expect(screen.queryByText(/candidates down/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("after the review, Edit plan offers the refreshed candidates (moved and archived tasks included/excluded)", async () => {
    const s = reviewServer(open3(), { frogId: "a" });
    const api = mockApi({
      ...s.routes,
      "GET /api/today/candidates": () => [candidate({ id: "b", title: "Bravo" })],
    } as Parameters<typeof mockApi>[0]);
    const user = userEvent.setup();
    render(<TodayView />);
    await screen.findByRole("heading", { name: "Today" });
    api.on("GET /api/today/candidates", [candidate({ id: "z", title: "Zebra from the backlog" })]);
    await user.click(screen.getByRole("button", { name: "Close the day" }));
    for (let i = 0; i < 3; i++) await user.click(cont());
    await user.click(save());
    await screen.findByRole("region", { name: "Day closed" });
    await waitFor(() => expect(api.to("GET /api/today/candidates")).toHaveLength(2));
    await user.click(screen.getByRole("button", { name: /edit plan/i }));
    expect(screen.getByRole("checkbox", { name: /zebra from the backlog/i })).toBeInTheDocument();
  });

  it("a midnight rollover while the flow is open discards it (the new day shows)", async () => {
    freezeNow("2026-10-24T21:58:00Z", { intervals: true }); // 23:58 in Berlin
    const s = reviewServer(open3(), { frogId: "a" });
    const api = mockApi({
      ...s.routes,
      "GET /api/today": (call: { query: URLSearchParams }) =>
        call.query.get("date") === DATE ? s.build() : payload({ date: "2026-10-25", plan: null, tasks: [], frog: null }),
    } as Parameters<typeof mockApi>[0]);
    const user = userEvent.setup();
    render(<TodayView />);
    await screen.findByRole("heading", { name: "Today" });
    await user.click(screen.getByRole("button", { name: "Close the day" }));
    await user.click(cont());
    await user.click(within(screen.getByRole("radiogroup", { name: "What to do with Bravo" })).getByRole("radio", { name: "Archive" }));
    expect(screen.getByRole("heading", { name: "Close the day" })).toBeInTheDocument();

    vi.setSystemTime(new Date("2026-10-24T22:01:00Z"));
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(await screen.findByRole("heading", { name: "Plan my day" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Close the day" })).not.toBeInTheDocument();
    expect(api.to("POST /api/today/review")).toHaveLength(0);
  });

  it("a rollover during an in-flight save: the old day's answer does not replace the new day", async () => {
    freezeNow("2026-10-24T21:58:00Z", { intervals: true });
    const s = reviewServer(open3(), { frogId: "a" });
    const hold = deferred<TodayPayload>();
    const api = mockApi({
      ...s.routes,
      "GET /api/today": (call: { query: URLSearchParams }) =>
        call.query.get("date") === DATE ? s.build() : payload({ date: "2026-10-25", plan: null, tasks: [], frog: null }),
      "POST /api/today/review": () => hold.promise,
    } as Parameters<typeof mockApi>[0]);
    const user = userEvent.setup();
    render(<TodayView />);
    await screen.findByRole("heading", { name: "Today" });
    await user.click(screen.getByRole("button", { name: "Close the day" }));
    for (let i = 0; i < 3; i++) await user.click(cont());
    await user.click(save());
    await waitFor(() => expect(api.to("POST /api/today/review")).toHaveLength(1));
    vi.setSystemTime(new Date("2026-10-24T22:01:00Z"));
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(await screen.findByRole("heading", { name: "Plan my day" })).toBeInTheDocument();
    await act(async () => hold.resolve(s.build()));
    expect(screen.getByRole("heading", { name: "Plan my day" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Day closed" })).not.toBeInTheDocument();
  });
});
