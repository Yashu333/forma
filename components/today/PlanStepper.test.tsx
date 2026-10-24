// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TodayCandidate, TodayPayload } from "@/types";
import { parseTodayPut } from "@/lib/frog/today";
import PlanStepper from "./PlanStepper";
import {
  DATE,
  GROUP_HOME,
  TZ,
  candidate,
  deferred,
  freezeNow,
  httpError,
  mockApi,
  payload,
  task,
  unplanned,
} from "../../tests/ui/fixtures";

const HOME = { id: GROUP_HOME.id, name: GROUP_HOME.name, color: GROUP_HOME.color };

function setup(opts: { payload?: TodayPayload; candidates?: TodayCandidate[]; editing?: boolean } = {}) {
  freezeNow("2026-10-24T08:00:00Z");
  const onSaved = vi.fn();
  const onCancel = vi.fn();
  const user = userEvent.setup();
  render(
    <PlanStepper
      payload={opts.payload ?? unplanned()}
      candidates={opts.candidates ?? []}
      tz={TZ}
      editing={opts.editing ?? false}
      onSaved={onSaved}
      onCancel={onCancel}
    />,
  );
  return { user, onSaved, onCancel };
}

type User = ReturnType<typeof userEvent.setup>;
// The accessible name also contains badges ("Alpha C-2"), so a string matches the start.
const check = (user: User, title: RegExp | string) =>
  user.click(screen.getByRole("checkbox", { name: typeof title === "string" ? new RegExp(`^${title}( |$)`) : title }));
const next = (user: User) => user.click(screen.getByRole("button", { name: /label them|choose your frog/i }));
const letter = (user: User, title: string, l: string) => {
  const row = screen.getByText(title).closest("li") as HTMLElement;
  return user.click(within(row).getByRole("button", { name: new RegExp(`^${l}:`) }));
};
const rowOf = (title: string) => screen.getByText(title).closest("li") as HTMLElement;
const orderOnScreen = () =>
  within(screen.getAllByRole("list").find((l) => !l.getAttribute("aria-label") && l.querySelector("[aria-pressed]"))!)
    .getAllByRole("listitem")
    .map((li) => li.querySelector(".break-words")?.textContent);

const manyCandidates = (n: number) => Array.from({ length: n }, (_, i) => candidate({ id: `c${i}`, title: `Task ${i}`, order: i }));

describe("PlanStepper: Pick", () => {
  it("groups candidates by project, in the order projects first appear", () => {
    setup({
      candidates: [
        candidate({ id: "a", title: "Write report" }),
        candidate({ id: "b", title: "Fix bike", group: HOME }),
        candidate({ id: "c", title: "Email boss" }),
      ],
    });
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["Work", "Home"]);
    const work = screen.getByRole("heading", { level: 3, name: "Work" }).closest("div")!.parentElement!;
    expect(within(work).getAllByRole("checkbox").map((c) => c.getAttribute("aria-label") ?? c.closest("label")?.textContent)).toHaveLength(2);
    expect(within(work).getByText("0/2")).toBeInTheDocument();
  });

  it("starts with every task already planned for today checked, done ones included", () => {
    setup({
      payload: payload({
        tasks: [
          task({ id: "p1", title: "Carried over" }),
          task({ id: "p2", title: "Eaten frog", completedAt: "2026-10-24T06:00:00.000Z", group: GROUP_HOME }),
        ],
        frogId: "p2",
      }),
      editing: true,
      // candidates exclude done tasks, so the eaten frog is NOT in this list
      candidates: [candidate({ id: "p1", title: "Carried over" }), candidate({ id: "x", title: "Backlog thing" })],
    });
    expect(screen.getByRole("checkbox", { name: /carried over/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /backlog thing/i })).not.toBeChecked();
    const eaten = screen.getByRole("checkbox", { name: /eaten frog/i });
    expect(eaten).toBeChecked();
    expect(within(eaten.closest("label")!).getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Eaten frog")).toHaveStyle({ textDecoration: "line-through" });
    expect(screen.getByText(/picked/)).toHaveTextContent("2 tasks picked");
  });

  it("shows a live count with singular and plural", async () => {
    const { user } = setup({ candidates: manyCandidates(3) });
    expect(screen.getByText(/picked/)).toHaveTextContent("0 tasks picked");
    await check(user, "Task 0");
    expect(screen.getByText(/picked/)).toHaveTextContent("1 task picked");
    await check(user, "Task 1");
    expect(screen.getByText(/picked/)).toHaveTextContent("2 tasks picked");
    await check(user, "Task 1"); // uncheck
    expect(screen.getByText(/picked/)).toHaveTextContent("1 task picked");
  });

  it("only shows the 'fewer tasks' hint above 7 tasks", async () => {
    const hint = "Fewer, more important tasks beat a long list.";
    const { user } = setup({ candidates: manyCandidates(9) });
    for (let i = 0; i < 7; i++) await check(user, `Task ${i}`);
    expect(screen.getByText(/picked/)).toHaveTextContent("7 tasks picked");
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
    await check(user, "Task 7");
    expect(screen.getByText(hint)).toBeInTheDocument();
    await check(user, "Task 7");
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
  });

  it("cannot go on with zero tasks, and can with one", async () => {
    const { user } = setup({ candidates: manyCandidates(2) });
    const go = screen.getByRole("button", { name: /label them/i });
    expect(go).toBeDisabled();
    await user.click(go);
    expect(screen.getByRole("heading", { name: "What will you work on today?" })).toBeInTheDocument();
    await check(user, "Task 0");
    expect(go).toBeEnabled();
    await check(user, "Task 0");
    expect(go).toBeDisabled();
  });

  it("explains why it cannot go on past the API's 200-task cap", () => {
    const tasks = Array.from({ length: 201 }, (_, i) => task({ id: `t${i}`, title: `Planned ${i}`, order: i }));
    setup({ payload: payload({ tasks, frogId: "t0" }), editing: true });
    expect(screen.getByText(/201 tasks picked/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /label them/i })).toBeDisabled();
    expect(screen.getByText("A day can hold at most 200 tasks.")).toBeInTheDocument();
  });

  it("says so when there is nothing to plan", () => {
    setup();
    expect(screen.getByText("You have no open tasks to plan.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /label them/i })).toBeDisabled();
  });

  it("uses real labelled checkboxes that work from the keyboard", async () => {
    const { user } = setup({ candidates: manyCandidates(2) });
    await user.tab(); // first focusable control
    expect(screen.getByRole("checkbox", { name: "Task 0" })).toHaveFocus();
    await user.keyboard(" ");
    expect(screen.getByRole("checkbox", { name: "Task 0" })).toBeChecked();
  });

  it("marks the current step", () => {
    setup({ candidates: manyCandidates(1) });
    const steps = screen.getByRole("list", { name: "Steps" });
    expect(within(steps).getByText("Pick").closest("li")).toHaveAttribute("aria-current", "step");
    expect(within(steps).getByText("Label").closest("li")).not.toHaveAttribute("aria-current");
  });
});

describe("PlanStepper: Label", () => {
  const two = [candidate({ id: "a", title: "Alpha", order: 1 }), candidate({ id: "b", title: "Bravo", order: 2 }), candidate({ id: "c", title: "Charlie", order: 3 })];

  async function toLabel(user: User, titles = ["Alpha", "Bravo", "Charlie"]) {
    for (const t of titles) await check(user, t);
    await next(user);
  }

  it("shows only picked tasks, each with A-E toggle buttons and the letter legend", async () => {
    const { user } = setup({ candidates: two });
    await toLabel(user, ["Alpha", "Bravo"]);
    expect(screen.getByRole("heading", { name: "Label by consequence" })).toBeInTheDocument();
    expect(screen.queryByText("Charlie")).not.toBeInTheDocument();
    for (const t of ["Alpha", "Bravo"]) {
      const buttons = within(rowOf(t)).getAllByRole("button");
      expect(buttons.map((b) => b.textContent)).toEqual(["A", "B", "C", "D", "E"]);
      buttons.forEach((b) => expect(b).toHaveAttribute("aria-pressed", "false"));
    }
    const legend = screen.getByRole("list", { name: "What the letters mean" });
    expect(within(legend).getAllByRole("listitem")).toHaveLength(5);
    expect(legend).toHaveTextContent("Must do");
    expect(legend).toHaveTextContent("Eliminate");
  });

  it("aria-pressed follows the chosen letter; picking another letter moves it", async () => {
    const { user } = setup({ candidates: two });
    await toLabel(user, ["Alpha"]);
    await letter(user, "Alpha", "B");
    const pressed = () => within(rowOf("Alpha")).getAllByRole("button", { pressed: true }).map((b) => b.textContent);
    expect(pressed()).toEqual(["B"]);
    await letter(user, "Alpha", "D");
    expect(pressed()).toEqual(["D"]);
  });

  it("tapping the active letter clears it", async () => {
    const { user } = setup({ candidates: two });
    await toLabel(user, ["Alpha"]);
    await letter(user, "Alpha", "A");
    expect(within(rowOf("Alpha")).getByRole("button", { name: /^A:/ })).toHaveAttribute("aria-pressed", "true");
    await letter(user, "Alpha", "A");
    expect(within(rowOf("Alpha")).queryAllByRole("button", { pressed: true })).toHaveLength(0);
    // and the rank controls vanish with the letter
    expect(within(rowOf("Alpha")).queryByRole("button", { name: "Rank higher" })).not.toBeInTheDocument();
  });

  it("re-sorts live with compareTasks (letter A first, unlabelled last)", async () => {
    const { user } = setup({ candidates: two });
    await toLabel(user);
    expect(orderOnScreen()).toEqual(["Alpha", "Bravo", "Charlie"]); // board order
    await letter(user, "Charlie", "A");
    expect(orderOnScreen()).toEqual(["Charlie", "Alpha", "Bravo"]);
    await letter(user, "Bravo", "B");
    expect(orderOnScreen()).toEqual(["Charlie", "Bravo", "Alpha"]);
    await letter(user, "Charlie", "E");
    expect(orderOnScreen()).toEqual(["Bravo", "Charlie", "Alpha"]);
    await letter(user, "Charlie", "E"); // clear again
    expect(orderOnScreen()).toEqual(["Bravo", "Alpha", "Charlie"]);
  });

  it("rank up/down renumbers the letter group A-1, A-2... and re-sorts", async () => {
    const { user } = setup({ candidates: two });
    await toLabel(user);
    for (const t of ["Alpha", "Bravo", "Charlie"]) await letter(user, t, "A");
    expect(orderOnScreen()).toEqual(["Alpha", "Bravo", "Charlie"]);

    await user.click(within(rowOf("Charlie")).getByRole("button", { name: "Rank higher" }));
    expect(orderOnScreen()).toEqual(["Alpha", "Charlie", "Bravo"]);
    // badges: A-1, A-2, A-3 in the new order
    const badges = () => orderOnScreen().map((t) => within(rowOf(t!)).getAllByText(/^A-\d$/)[0].textContent);
    expect(badges()).toEqual(["A-1", "A-2", "A-3"]);

    await user.click(within(rowOf("Alpha")).getByRole("button", { name: "Rank lower" }));
    expect(orderOnScreen()).toEqual(["Charlie", "Alpha", "Bravo"]);
    expect(badges()).toEqual(["A-1", "A-2", "A-3"]);
  });

  it("disables 'Rank higher' on the first and 'Rank lower' on the last of a letter", async () => {
    const { user } = setup({ candidates: two });
    await toLabel(user);
    await letter(user, "Alpha", "A");
    await letter(user, "Bravo", "A");
    expect(within(rowOf("Alpha")).getByRole("button", { name: "Rank higher" })).toBeDisabled();
    expect(within(rowOf("Alpha")).getByRole("button", { name: "Rank lower" })).toBeEnabled();
    expect(within(rowOf("Bravo")).getByRole("button", { name: "Rank lower" })).toBeDisabled();
    // a lone task of its own letter can't move at all
    await letter(user, "Charlie", "C");
    expect(within(rowOf("Charlie")).getByRole("button", { name: "Rank higher" })).toBeDisabled();
    expect(within(rowOf("Charlie")).getByRole("button", { name: "Rank lower" })).toBeDisabled();
  });

  it("changing the letter drops the old rank", async () => {
    const { user } = setup({ candidates: two });
    await toLabel(user, ["Alpha", "Bravo"]);
    await letter(user, "Alpha", "A");
    await letter(user, "Bravo", "A");
    await user.click(within(rowOf("Bravo")).getByRole("button", { name: "Rank higher" }));
    expect(within(rowOf("Bravo")).getByText("A-1")).toBeInTheDocument();
    await letter(user, "Bravo", "B");
    expect(within(rowOf("Bravo")).getByRole("button", { name: /^B:/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(rowOf("Bravo")).queryByText("A-1")).not.toBeInTheDocument();
    expect(within(rowOf("Bravo")).queryByText(/^[A-E]-\d$/)).not.toBeInTheDocument();
  });

  it("a task that already had a letter starts with it pressed", async () => {
    const { user } = setup({ candidates: [candidate({ id: "a", title: "Alpha", abcde: "C", abcdeRank: 2 })] });
    await check(user, "Alpha");
    await next(user);
    expect(within(rowOf("Alpha")).getByRole("button", { name: /^C:/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(rowOf("Alpha")).getAllByText("C-2").length).toBeGreaterThan(0);
  });

  it("Back returns to Pick with the selection intact", async () => {
    const { user } = setup({ candidates: two });
    await toLabel(user, ["Alpha", "Bravo"]);
    await user.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByRole("checkbox", { name: /^Alpha/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /^Bravo/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /^Charlie/ })).not.toBeChecked();
  });

  it("keeps labels when stepping Back and forth", async () => {
    const { user } = setup({ candidates: two });
    await toLabel(user, ["Alpha"]);
    await letter(user, "Alpha", "B");
    await user.click(screen.getByRole("button", { name: /back/i }));
    await next(user);
    expect(within(rowOf("Alpha")).getByRole("button", { name: /^B:/ })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("PlanStepper: Frog and Save", () => {
  const cands = [
    candidate({ id: "a", title: "Alpha", order: 1 }),
    candidate({ id: "b", title: "Bravo", order: 2 }),
    candidate({ id: "c", title: "Charlie", order: 3, group: HOME }),
  ];
  async function toFrog(user: User, titles = ["Alpha", "Bravo", "Charlie"]) {
    for (const t of titles) await check(user, t);
    await next(user); // Label
    await next(user); // Frog
  }
  const radios = () => screen.getAllByRole("radio");
  const chosen = () => screen.getAllByRole("radio", { checked: true }).map((r) => r.textContent);

  it("shows the book quote", async () => {
    const { user } = setup({ candidates: cands });
    await toFrog(user, ["Alpha"]);
    expect(screen.getByText("“If you have to eat a frog, eat it first thing in the morning.”")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Today's frog" })).toBeInTheDocument();
  });

  it("suggests the A-1 task and preselects it", async () => {
    const { user } = setup({ candidates: cands });
    for (const t of ["Alpha", "Bravo", "Charlie"]) await check(user, t);
    await next(user);
    await letter(user, "Charlie", "A");
    await letter(user, "Bravo", "A");
    await user.click(within(rowOf("Bravo")).getByRole("button", { name: "Rank higher" })); // Bravo A-1, Charlie A-2
    await next(user);
    expect(radios().map((r) => r.querySelector(".break-words")?.textContent)).toEqual(["Bravo", "Charlie", "Alpha"]);
    const bravo = screen.getByRole("radio", { name: /bravo/i });
    expect(within(bravo).getByText("Suggested")).toBeInTheDocument();
    expect(bravo).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByText("Suggested")).toHaveLength(1);
  });

  it("suggests the first task when nothing is labelled A", async () => {
    const { user } = setup({ candidates: cands });
    await toFrog(user);
    expect(within(radios()[0]).getByText("Suggested")).toBeInTheDocument();
    expect(radios()[0]).toHaveTextContent("Alpha");
    expect(chosen()).toHaveLength(1);
  });

  it("tapping a task chooses it (and only it) as the frog, from the keyboard too", async () => {
    const { user } = setup({ candidates: cands });
    await toFrog(user);
    await user.click(screen.getByRole("radio", { name: /charlie/i }));
    expect(screen.getByRole("radio", { name: /charlie/i })).toHaveAttribute("aria-checked", "true");
    expect(chosen()).toHaveLength(1);
    screen.getByRole("radio", { name: /bravo/i }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("radio", { name: /bravo/i })).toHaveAttribute("aria-checked", "true");
    expect(chosen()).toHaveLength(1);
  });

  it("the chosen frog falls back to the suggestion when it leaves the selection", async () => {
    const { user } = setup({ candidates: cands });
    await toFrog(user);
    await user.click(screen.getByRole("radio", { name: /charlie/i }));
    await user.click(screen.getByRole("button", { name: /back/i }));
    await user.click(screen.getByRole("button", { name: /back/i }));
    await check(user, "Charlie"); // un-pick the frog
    await next(user);
    await next(user);
    expect(screen.queryByRole("radio", { name: /charlie/i })).not.toBeInTheDocument();
    expect(chosen()).toHaveLength(1);
    expect(radios()[0]).toHaveAttribute("aria-checked", "true");
    expect(within(radios()[0]).getByText("Suggested")).toBeInTheDocument();
  });

  it("Save is enabled as soon as the suggestion is preselected and says 'Save my plan'", async () => {
    const { user } = setup({ candidates: cands });
    await toFrog(user, ["Alpha"]);
    expect(screen.getByRole("button", { name: "Save my plan" })).toBeEnabled();
  });

  it("Save sends PUT /api/today with finalize:true and a body the real parseTodayPut accepts", async () => {
    const saved = payload({ tasks: [task({ id: "a", title: "Alpha" })], frogId: "a" });
    const api = mockApi({ "PUT /api/today": saved });
    const { user, onSaved } = setup({ candidates: cands });
    await toFrog(user);
    await user.click(screen.getByRole("radio", { name: /charlie/i }));
    await user.click(screen.getByRole("button", { name: "Save my plan" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onSaved).toHaveBeenCalledWith(saved);
    expect(api.to("PUT /api/today")).toHaveLength(1);
    const call = api.to("PUT /api/today")[0];
    const body = call.body as Record<string, unknown>;
    expect(body).toMatchObject({ date: DATE, tz: TZ, finalize: true, frogTaskId: "c" });
    expect(body.taskIds).toEqual(["a", "b", "c"]);

    const parsed = parseTodayPut(call.body);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.finalize).toBe(true);
      expect(parsed.value.taskIds).toContain(parsed.value.frogTaskId);
    }
  });

  it("sends JSON with the right content type", async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify(payload()), { status: 200 }));
    const { user } = setup({ candidates: cands });
    vi.stubGlobal("fetch", fetchSpy);
    await toFrog(user, ["Alpha"]);
    await user.click(screen.getByRole("button", { name: "Save my plan" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/today");
    expect(init.method).toBe("PUT");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
  });

  it("sends full-state ranks for changed tasks only, and none when nothing changed", async () => {
    const api = mockApi({ "PUT /api/today": payload() });
    const { user } = setup({
      candidates: [
        candidate({ id: "a", title: "Alpha", order: 1, abcde: "B", abcdeRank: 1 }), // untouched
        candidate({ id: "b", title: "Bravo", order: 2 }), // gets A
        candidate({ id: "c", title: "Charlie", order: 3, abcde: "C" }), // letter cleared
      ],
    });
    for (const t of ["Alpha", "Bravo", "Charlie"]) await check(user, t);
    await next(user);
    await letter(user, "Bravo", "A");
    await letter(user, "Charlie", "C"); // clears C
    await next(user);
    await user.click(screen.getByRole("button", { name: "Save my plan" }));
    await waitFor(() => expect(api.to("PUT /api/today")).toHaveLength(1));
    const body = api.to("PUT /api/today")[0].body as { ranks: Record<string, unknown>; taskIds: string[] };
    expect(body.ranks).toEqual({
      b: { abcde: "A", abcdeRank: null },
      c: { abcde: null, abcdeRank: null },
    });
    expect(parseTodayPut(api.to("PUT /api/today")[0].body).ok).toBe(true);
  });

  it("sends ranks as full state when tasks were ranked (A-1, A-2)", async () => {
    const api = mockApi({ "PUT /api/today": payload() });
    const { user } = setup({ candidates: cands });
    for (const t of ["Alpha", "Bravo"]) await check(user, t);
    await next(user);
    await letter(user, "Alpha", "A");
    await letter(user, "Bravo", "A");
    await user.click(within(rowOf("Bravo")).getByRole("button", { name: "Rank higher" }));
    await next(user);
    await user.click(screen.getByRole("button", { name: "Save my plan" }));
    await waitFor(() => expect(api.to("PUT /api/today")).toHaveLength(1));
    const call = api.to("PUT /api/today")[0];
    const body = call.body as { ranks: Record<string, unknown>; frogTaskId: string };
    expect(body.ranks).toEqual({ b: { abcde: "A", abcdeRank: 1 }, a: { abcde: "A", abcdeRank: 2 } });
    expect(body.frogTaskId).toBe("b"); // A-1 was suggested
    expect(parseTodayPut(call.body).ok).toBe(true);
  });

  it("an unselected task never appears in taskIds or ranks", async () => {
    const api = mockApi({ "PUT /api/today": payload() });
    const { user } = setup({ candidates: cands });
    await check(user, "Alpha");
    await next(user);
    await letter(user, "Alpha", "A");
    await next(user);
    await user.click(screen.getByRole("button", { name: "Save my plan" }));
    await waitFor(() => expect(api.to("PUT /api/today")).toHaveLength(1));
    const body = api.to("PUT /api/today")[0].body as { taskIds: string[]; ranks: Record<string, unknown> };
    expect(body.taskIds).toEqual(["a"]);
    expect(Object.keys(body.ranks)).toEqual(["a"]);
  });

  it("Edit plan: the whole selection goes into taskIds, done tasks included", async () => {
    const api = mockApi({ "PUT /api/today": payload() });
    const eaten = task({ id: "p2", title: "Eaten frog", completedAt: "2026-10-24T06:00:00.000Z", abcde: "A", abcdeRank: 1, group: GROUP_HOME });
    const open = task({ id: "p1", title: "Carried over", abcde: "B" });
    const { user, onCancel } = setup({
      payload: payload({ tasks: [eaten, open], frogId: "p2" }),
      editing: true,
      candidates: [candidate({ id: "p1", title: "Carried over", abcde: "B" }), candidate({ id: "x", title: "Backlog thing" })],
    });
    expect(screen.getByRole("heading", { name: "Edit your plan" })).toBeInTheDocument();
    await next(user);
    await next(user);
    // the saved frog is still the frog (even though it is done), not the suggestion
    expect(screen.getByRole("radio", { name: /eaten frog/i })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("button", { name: "Save plan" }));
    await waitFor(() => expect(api.to("PUT /api/today")).toHaveLength(1));
    const call = api.to("PUT /api/today")[0];
    const body = call.body as { taskIds: string[]; frogTaskId: string; finalize: boolean; ranks: object };
    expect([...body.taskIds].sort()).toEqual(["p1", "p2"]);
    expect(body.frogTaskId).toBe("p2");
    expect(body.finalize).toBe(true);
    expect(body.ranks).toEqual({});
    expect(parseTodayPut(call.body).ok).toBe(true);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("Edit plan: a saved frog that was archived (not in tasks or candidates) falls back to the suggestion", async () => {
    const api = mockApi({ "PUT /api/today": payload() });
    const open = task({ id: "p1", title: "Carried over", abcde: "B" });
    const { user } = setup({
      // the plan still names "gone", which was eliminated: it is in no list
      payload: payload({ tasks: [open], plan: { ...payload().plan!, frogTaskId: "gone" }, frog: null }),
      editing: true,
      candidates: [candidate({ id: "p1", title: "Carried over", abcde: "B" })],
    });
    await next(user);
    await next(user);
    expect(screen.getByRole("radio", { name: /carried over/i })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("button", { name: "Save plan" }));
    await waitFor(() => expect(api.to("PUT /api/today")).toHaveLength(1));
    expect((api.to("PUT /api/today")[0].body as { frogTaskId: string }).frogTaskId).toBe("p1");
  });

  it("names each Label row's controls after its task (role=group), without renaming the buttons", async () => {
    const { user } = setup({ candidates: [candidate({ id: "a", title: "Alpha" }), candidate({ id: "b", title: "Bravo", order: 1 })] });
    await check(user, "Alpha");
    await check(user, "Bravo");
    await next(user);
    const group = screen.getByRole("group", { name: "Alpha" });
    expect(within(group).getByRole("button", { name: "A: Must do" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Bravo" })).toBeInTheDocument();
    // the row is still a list item, so the list semantics are intact
    expect(screen.getByRole("group", { name: "Alpha" }).closest("li")).not.toBeNull();
  });

  it("scrolls the top of the stepper into view when the step changes, but not on first render", async () => {
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      const { user } = setup({ candidates: [candidate({ id: "a", title: "Alpha" })] });
      expect(scrollIntoView).not.toHaveBeenCalled();
      await check(user, "Alpha");
      await next(user);
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      await next(user);
      expect(scrollIntoView).toHaveBeenCalledTimes(2);
      await user.click(screen.getByRole("button", { name: "Back" }));
      expect(scrollIntoView).toHaveBeenCalledTimes(3);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("Edit plan shows Cancel, which calls onCancel without saving", async () => {
    const api = mockApi({});
    const { user, onCancel } = setup({ payload: payload({ tasks: [task({ id: "p1", title: "Carried" })], frogId: "p1" }), editing: true });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(api.calls).toHaveLength(0);
  });

  it("shows the server's error, stays on the step and lets you try again", async () => {
    let fail = true;
    const api = mockApi({ "PUT /api/today": () => (fail ? httpError(404, "Not found") : payload()) });
    const { user, onSaved } = setup({ candidates: cands });
    await toFrog(user, ["Alpha"]);
    await user.click(screen.getByRole("button", { name: "Save my plan" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not found");
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save my plan" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /back/i })).toBeEnabled();

    fail = false;
    await user.click(screen.getByRole("button", { name: "Save my plan" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(api.to("PUT /api/today")).toHaveLength(2);
  });

  it("falls back to a generic message on a network error", async () => {
    const { user } = setup({ candidates: cands });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    await toFrog(user, ["Alpha"]);
    await user.click(screen.getByRole("button", { name: "Save my plan" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to fetch");
  });

  it("disables Save and Back while saving, and a double click sends one request", async () => {
    const gate = deferred<unknown>();
    const api = mockApi({ "PUT /api/today": () => gate.promise });
    const { user, onSaved } = setup({ candidates: cands });
    await toFrog(user, ["Alpha"]);
    const save = screen.getByRole("button", { name: "Save my plan" });
    await user.dblClick(save);
    const saving = await screen.findByRole("button", { name: "Saving…" });
    expect(saving).toBeDisabled();
    expect(screen.getByRole("button", { name: /back/i })).toBeDisabled();
    expect(api.to("PUT /api/today")).toHaveLength(1);
    gate.resolve(payload());
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });
});
