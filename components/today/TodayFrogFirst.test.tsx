// @vitest-environment jsdom
// M7: frog-first mode on the Today view. Everything runs through TodayView with a
// small fake server behind `fetch` (GET /api/today carries `frogFirstMode`,
// PUT /api/user-settings changes it), so the optimistic save, the rollback, the
// refresh sequencing and the lock behave exactly as they do in the browser.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task, TodayFrog, TodayPayload, TodayTask } from "@/types";
import TodayView from "./TodayView";
import TodayDay from "./TodayDay";
import {
  DATE,
  GROUP_HOME,
  GROUP_NODONE,
  GROUP_WORK,
  deferred,
  freezeNow,
  httpError,
  mockApi,
  payload,
  plan,
  task,
  unplanned,
  TZ,
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
const ATE_AT = "2026-10-24T07:42:00.000Z";
const LATER_DAY = "2026-10-26T09:00:00.000Z";
const REVIEWED_AT = "2026-10-24T18:00:00.000Z";
const BANNER = "Frog first mode is on — eat your frog to unlock the rest of your list.";
const LOCK_TITLE = "Eat your frog first";

beforeEach(() => {
  fire.mockClear();
  freezeNow(NOW);
});

// ── fake server ─────────────────────────────────────────────────────────────────

type Scenario = "none" | "archived-uneaten" | "eaten" | "uneaten" | "eaten-later-day" | "no-done-column";

interface World {
  tasks: TodayTask[];
  frog: TodayFrog | null;
}

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

/** Open row (own project has a Done column), done row, E row, and a frog depending on the scenario. */
function world(scenario: Scenario): World {
  const open = task({ id: "o", title: "Open row", abcde: "C", order: 1, group: GROUP_HOME, groupId: GROUP_HOME.id });
  const done = task({ id: "d", title: "Done row", abcde: "B", order: 2, completedAt: "2026-10-24T05:00:00.000Z" });
  const echo = task({ id: "e", title: "Echo row", abcde: "E", order: 3 });
  const frogBase = { id: "f", title: "The frog", abcde: "A" as const, abcdeRank: 1, order: 0 };
  const rest = [open, done, echo];
  switch (scenario) {
    case "none":
      return { tasks: rest, frog: null };
    case "archived-uneaten": {
      // The server still returns an archived frog; it is off the list.
      const f = { ...task(frogBase), archivedAt: "2026-10-24T07:00:00.000Z" } as TodayTask;
      return { tasks: rest, frog: { ...f, subtasks: [] } };
    }
    case "eaten": {
      const f = task({ ...frogBase, completedAt: ATE_AT });
      return { tasks: [f, ...rest], frog: { ...f, subtasks: [] } };
    }
    case "eaten-later-day": {
      const f = task({ ...frogBase, completedAt: LATER_DAY });
      return { tasks: [f, ...rest], frog: { ...f, subtasks: [] } };
    }
    case "no-done-column": {
      const f = task({ ...frogBase, group: GROUP_NODONE, groupId: GROUP_NODONE.id });
      return { tasks: [f, ...rest], frog: { ...f, subtasks: [] } };
    }
    case "uneaten": {
      const f = task(frogBase);
      return { tasks: [f, ...rest], frog: { ...f, subtasks: [sub("Write the intro", 0), sub("Send it", 1)] } };
    }
  }
}

interface ServerOpts {
  mode?: boolean;
  reviewed?: boolean;
  /** Overrides what PUT /api/user-settings does (default: stores the flag and returns the whole row). */
  settingsReply?: (call: { body: unknown }) => unknown;
}

function server(w: World, opts: ServerOpts = {}) {
  const state = {
    tasks: w.tasks.map((t) => ({ ...t })),
    archived: [] as TodayTask[],
    frog: w.frog ? { ...w.frog } : null,
    mode: opts.mode ?? false,
    reviewed: opts.reviewed ?? false,
  };
  const build = (): TodayPayload => {
    const f = state.frog && { ...state.frog, ...([...state.tasks, ...state.archived].find((t) => t.id === state.frog!.id) ?? {}) };
    return payload({
      tasks: state.tasks.map((t) => ({ ...t })),
      frog: f,
      frogId: state.frog?.id ?? null,
      frogFirstMode: state.mode,
      plan: plan({ frogTaskId: state.frog?.id ?? null, reviewedAt: state.reviewed ? REVIEWED_AT : null }),
    });
  };
  const routes: Record<string, unknown> = {
    "GET /api/today": () => build(),
    "GET /api/today/candidates": [],
    "PUT /api/user-settings": (call: { body: unknown }) => {
      if (opts.settingsReply) return opts.settingsReply(call);
      state.mode = (call.body as { frogFirstMode: boolean }).frogFirstMode;
      return { id: "s1", userId: "u1", focusMins: 25, shortMins: 5, longMins: 15, sessionsBeforeLong: 4, autoStartBreaks: false, autoStartFocus: false, frogFirstMode: state.mode };
    },
  };
  for (const t of [...w.tasks, ...(w.frog ? [w.frog] : [])]) {
    routes[`PATCH /api/tasks/${t.id}`] = (call: { body: unknown }) => {
      const body = call.body as { statusId?: string; archived?: boolean };
      const r = state.tasks.find((x) => x.id === t.id)!;
      if (body.archived) {
        state.tasks = state.tasks.filter((x) => x.id !== t.id);
        state.archived.push({ ...r, archivedAt: ATE_AT } as TodayTask);
        return { ...r, archivedAt: ATE_AT };
      }
      r.statusId = body.statusId!;
      r.completedAt = ATE_AT;
      return { ...r };
    };
  }
  return { state, build, routes };
}

async function renderToday(s: ReturnType<typeof server>, extra: Record<string, unknown> = {}) {
  const api = mockApi({ ...s.routes, ...extra } as Parameters<typeof mockApi>[0]);
  const user = userEvent.setup();
  const view = render(<TodayView />);
  await screen.findByRole("heading", { name: "Today" });
  return { api, user, ...view };
}

const listRows = () =>
  within(screen.getByRole("heading", { name: "Today's list" }).parentElement!.parentElement!.querySelector("ul") as HTMLElement).getAllByRole("listitem");
const row = (title: string) => {
  const found = listRows().find((li) => within(li).queryByRole("link", { name: title }));
  if (!found) throw new Error(`No list row titled "${title}"`);
  return found;
};
const hasRow = (title: string) => listRows().some((li) => within(li).queryByRole("link", { name: title }));
const box = (title: string) => within(row(title)).getByRole("checkbox");
const frogCard = () => screen.getByLabelText("Today's frog", { selector: "div" });
const sw = () => screen.getByRole("switch");
const banner = () => screen.queryByText(BANNER);
const putCalls = (api: ReturnType<typeof mockApi>) => api.to("PUT /api/user-settings");

/** Row's Eliminate button, then the confirm dialog's Eliminate. */
async function eliminate(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(within(row(title)).getByRole("button", { name: "Eliminate" }));
  const dialog = screen.getByText("Eliminate this task?").closest("div.fixed") as HTMLElement;
  await user.click(within(dialog).getByRole("button", { name: "Eliminate" }));
}

function expectLocked(title: string) {
  const c = box(title);
  expect(c).toBeDisabled();
  expect(c).toHaveAttribute("aria-disabled", "true");
  expect(c).toHaveAttribute("aria-checked", "false");
  expect(c.parentElement).toHaveAttribute("title", LOCK_TITLE);
  expect(c).toHaveAccessibleName(`${LOCK_TITLE}: ${title}`);
  expect(row(title).style.opacity).toBe("0.6");
}
function expectEnabled(title: string) {
  const c = box(title);
  expect(c).toBeEnabled();
  expect(c).toHaveAttribute("aria-disabled", "false");
  expect(c.parentElement).toHaveAttribute("title", "Mark as done");
  expect(row(title).style.opacity).toBe("1");
}

// ── the lock matrix ─────────────────────────────────────────────────────────────

describe("frog-first lock matrix", () => {
  const scenarios: Scenario[] = ["none", "archived-uneaten", "eaten", "uneaten", "eaten-later-day", "no-done-column"];
  const cases = scenarios.flatMap((scenario) =>
    [false, true].flatMap((mode) => [false, true].map((closed) => ({ scenario, mode, closed, locked: mode && !closed && scenario === "uneaten" }))),
  );

  it.each(cases)("scenario=$scenario mode=$mode closed=$closed -> locked=$locked", async ({ scenario, mode, closed, locked }) => {
    const w = world(scenario);
    const { api } = await renderToday(server(w, { mode, reviewed: closed }));

    // the toggle is always there on the Today view, and shows the persisted mode (also on a closed day)
    expect(sw()).toHaveAttribute("aria-checked", String(mode));
    // loading the page must never write the setting
    expect(putCalls(api)).toHaveLength(0);

    // the banner is exactly the locked state
    expect(banner() !== null).toBe(locked);

    // open row
    if (locked) expectLocked("Open row");
    else expectEnabled("Open row");

    // done row: never counted as locked, never dimmed by the lock
    const done = box("Done row");
    expect(done).toBeDisabled();
    expect(done).toHaveAttribute("aria-checked", "true");
    expect(done.parentElement).toHaveAttribute("title", "Done. Reopen it from the project board.");
    expect(row("Done row").style.opacity).toBe("0.7");
    expect(within(row("Done row")).getByRole("link", { name: "Reopen on board" })).toHaveAttribute("href", "/group/g-work");

    // E row: the checkbox follows the lock, the Eliminate button never does
    if (locked) expectLocked("Echo row");
    else expectEnabled("Echo row");
    expect(within(row("Echo row")).getByRole("button", { name: "Eliminate" })).toBeEnabled();

    // the frog's own row
    if (scenario === "uneaten") {
      expectEnabled("The frog");
      expect(row("The frog").style.opacity).toBe("1");
    } else if (scenario === "no-done-column") {
      const f = box("The frog");
      expect(f).toBeDisabled();
      expect(f.parentElement).toHaveAttribute("title", "This project has no Done column");
      expect(row("The frog").style.opacity).toBe("1"); // not dimmed
    } else if (scenario === "eaten" || scenario === "eaten-later-day") {
      expect(box("The frog")).toHaveAttribute("aria-checked", "true");
      expect(row("The frog").style.opacity).toBe("0.7");
    } else {
      expect(hasRow("The frog")).toBe(false);
    }

    // the frog card is never touched by the lock
    if (scenario === "uneaten") {
      if (!closed) expect(within(frogCard()).getByRole("button", { name: "Ate it" })).toBeEnabled();
      else expect(within(frogCard()).getByText("Not eaten today.")).toBeInTheDocument();
      expect(within(frogCard()).getByText("Write the intro")).toBeInTheDocument(); // next bite (subtask) is shown
      expect(within(frogCard()).getByText("0 of 2 bites done")).toBeInTheDocument();
    }
  });

  it("covers every cell: 24 combinations, exactly 1 of which locks the list for an open day with mode on", () => {
    expect(cases).toHaveLength(24);
    expect(cases.filter((c) => c.locked)).toHaveLength(1);
  });

  it("a locked E-row in a project WITHOUT a Done column still says 'Eat your frog first' (the lock wins over the no-Done-column hint)", async () => {
    const w = world("uneaten");
    w.tasks.push(task({ id: "n", title: "Nodone row", abcde: "E", order: 4, group: GROUP_NODONE, groupId: GROUP_NODONE.id }));
    await renderToday(server(w, { mode: true }));
    expectLocked("Nodone row");
  });

  it("unlocked rows in a project without a Done column keep their own tooltip (mode off)", async () => {
    const w = world("uneaten");
    w.tasks.push(task({ id: "n", title: "Nodone row", order: 4, group: GROUP_NODONE, groupId: GROUP_NODONE.id }));
    await renderToday(server(w, { mode: false }));
    expect(box("Nodone row").parentElement).toHaveAttribute("title", "This project has no Done column");
    expect(box("Nodone row")).toBeDisabled();
  });

  it("a locked row stays locked when 0 rows are open besides the frog (banner still shown; list is just the frog)", async () => {
    const f = task({ id: "f", title: "The frog", abcde: "A" });
    await renderToday(server({ tasks: [f], frog: { ...f, subtasks: [] } }, { mode: true }));
    expect(banner()).toBeInTheDocument();
    expectEnabled("The frog");
  });

  it("clicking a locked checkbox sends nothing", async () => {
    const { api, user } = await renderToday(server(world("uneaten"), { mode: true }));
    await user.click(box("Open row"));
    await user.click(box("Echo row"));
    expect(api.calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("the locked checkbox can't be reached by keyboard activation either", async () => {
    const { api, user } = await renderToday(server(world("uneaten"), { mode: true }));
    box("Open row").focus();
    await user.keyboard("{Enter} ");
    expect(api.calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("the 'A tasks first' hint and the A-first notice are unaffected by the lock", async () => {
    const w = world("uneaten");
    w.tasks[w.tasks.findIndex((t) => t.id === "o")] = task({ id: "o", title: "Open row", abcde: "B", order: 1, group: GROUP_HOME, groupId: GROUP_HOME.id });
    const s = server(w, { mode: true });
    s.state.mode = true;
    await renderToday(s);
    expect(within(row("Open row")).getByText("A tasks first")).toBeInTheDocument();
  });

  it("the banner is one paragraph with the exact text, between the list heading and the list", async () => {
    await renderToday(server(world("uneaten"), { mode: true }));
    const b = banner()!;
    expect(b.closest("p")).toHaveTextContent(BANNER);
    const heading = screen.getByRole("heading", { name: "Today's list" });
    const ul = listRows()[0].closest("ul")!;
    expect(heading.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(b.compareDocumentPosition(ul) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the banner wraps at narrow widths (min-w-0 / break-words on its text)", async () => {
    await renderToday(server(world("uneaten"), { mode: true }));
    expect(banner()!.className).toContain("break-words");
    expect(banner()!.className).toContain("min-w-0");
  });

  it("an empty list with the lock on shows the empty state, and the banner isn't shown without a frog", async () => {
    await renderToday(server({ tasks: [], frog: null }, { mode: true }));
    expect(banner()).not.toBeInTheDocument();
    expect(screen.getByText("Nothing planned for today.")).toBeInTheDocument();
  });
});

// ── what stays usable while locked ──────────────────────────────────────────────

describe("while the list is locked", () => {
  it("Eliminate still works on an E row (confirm dialog, PATCH {archived:true}, row gone, lock stays on)", async () => {
    const { api, user } = await renderToday(server(world("uneaten"), { mode: true }));
    await user.click(within(row("Echo row")).getByRole("button", { name: "Eliminate" }));
    expect(screen.getByText("Eliminate this task?")).toBeInTheDocument();
    const dialog = screen.getByText("Eliminate this task?").closest("div.fixed") as HTMLElement;
    await user.click(within(dialog).getByRole("button", { name: "Eliminate" }));
    await waitFor(() => expect(hasRow("Echo row")).toBe(false));
    expect(api.to("PATCH /api/tasks/e")[0].body).toEqual({ archived: true });
    expect(banner()).toBeInTheDocument();
    expectLocked("Open row");
  });

  it("eliminating the frog itself unlocks the rest (an eliminated frog counts as no frog)", async () => {
    const w = world("uneaten");
    // make the frog an E task so it has an Eliminate button
    w.tasks[0] = { ...w.tasks[0], abcde: "E" };
    w.frog = { ...w.frog!, abcde: "E" };
    const { user } = await renderToday(server(w, { mode: true }));
    expect(banner()).toBeInTheDocument();
    await eliminate(user, "The frog");
    await waitFor(() => expect(hasRow("The frog")).toBe(false));
    await waitFor(() => expect(banner()).not.toBeInTheDocument());
    expectEnabled("Open row");
  });

  it("'Reopen on board' for a done row is a real link to the project, still present", async () => {
    await renderToday(server(world("uneaten"), { mode: true }));
    const link = within(row("Done row")).getByRole("link", { name: "Reopen on board" });
    expect(link).toHaveAttribute("href", "/group/g-work");
  });

  it("the frog's own row checkbox works: it eats the frog, fires confetti and unlocks the list", async () => {
    const { api, user } = await renderToday(server(world("uneaten"), { mode: true }));
    await user.click(box("The frog"));
    expect(api.to("PATCH /api/tasks/f")[0].body).toEqual({ statusId: "s-work-done", tz: TZ });
    await waitFor(() => expect(banner()).not.toBeInTheDocument());
    expect(fire).toHaveBeenCalledTimes(1);
    expectEnabled("Open row");
    expectEnabled("Echo row");
  });

  it("the other links and the card's controls (title link, Edit plan, Close the day) are not affected", async () => {
    await renderToday(server(world("uneaten"), { mode: true }));
    expect(within(row("Open row")).getByRole("link", { name: "Open row" })).toHaveAttribute("href", "/group/g-home");
    expect(screen.getByRole("button", { name: /Edit plan/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Close the day" })).toBeEnabled();
  });
});

describe("'Ate it' unlocks everything at once", () => {
  it("immediately (before the silent refresh answers) and it stays unlocked after the refresh", async () => {
    const s = server(world("uneaten"), { mode: true });
    const { api, user } = await renderToday(s);
    const refresh = deferred<TodayPayload>();
    api.on("GET /api/today", () => refresh.promise);

    await user.click(within(frogCard()).getByRole("button", { name: "Ate it" }));
    await within(frogCard()).findByText("Eaten at 9:42");
    expect(api.to("PATCH /api/tasks/f")[0].body).toEqual({ statusId: "s-work-done", tz: TZ });
    // the refresh is still pending: the optimistic update alone must unlock the page
    expect(banner()).not.toBeInTheDocument();
    expectEnabled("Open row");
    expectEnabled("Echo row");
    expect(sw()).toHaveAttribute("aria-checked", "true"); // the mode itself stays on

    await act(async () => refresh.resolve(s.build()));
    expect(banner()).not.toBeInTheDocument();
    expectEnabled("Open row");
    expect(sw()).toHaveAttribute("aria-checked", "true");
    expect(api.to("PUT /api/user-settings")).toHaveLength(0); // eating never rewrites the setting
  });

  it("rows can be checked off right after the frog is eaten", async () => {
    const { api, user } = await renderToday(server(world("uneaten"), { mode: true }));
    await user.click(within(frogCard()).getByRole("button", { name: "Ate it" }));
    await within(frogCard()).findByText("Eaten at 9:42");
    await user.click(box("Open row"));
    await waitFor(() => expect(box("Open row")).toHaveAttribute("aria-checked", "true"));
    expect(api.to("PATCH /api/tasks/o")[0].body).toEqual({ statusId: "s-home-done", tz: TZ });
  });

  it("a failed 'Ate it' keeps the lock", async () => {
    const s = server(world("uneaten"), { mode: true });
    const { api, user } = await renderToday(s);
    api.on("PATCH /api/tasks/f", httpError(500, "nope"));
    await user.click(within(frogCard()).getByRole("button", { name: "Ate it" }));
    expect(await screen.findByText("nope")).toBeInTheDocument();
    expect(banner()).toBeInTheDocument();
    expectLocked("Open row");
  });

  it("with the mode OFF nothing changes when the frog is eaten (no banner at any point)", async () => {
    const { user } = await renderToday(server(world("uneaten"), { mode: false }));
    expect(banner()).not.toBeInTheDocument();
    await user.click(within(frogCard()).getByRole("button", { name: "Ate it" }));
    await within(frogCard()).findByText("Eaten at 9:42");
    expect(banner()).not.toBeInTheDocument();
  });

  it("reopening the frog on the board (a later load with completedAt null) re-locks the list", async () => {
    const s = server(world("eaten"), { mode: true });
    const { api } = await renderToday(s);
    expect(banner()).not.toBeInTheDocument();
    // someone moved the frog out of Done on the board; the window regains focus-less refresh via an edit
    s.state.tasks = s.state.tasks.map((t) => (t.id === "f" ? { ...t, completedAt: null } : t));
    s.state.frog = { ...s.state.frog!, completedAt: null };
    api.on("GET /api/today", () => s.build());
    const user = userEvent.setup();
    // an Eliminate on the E row triggers a silent refresh that carries the new truth
    await eliminate(user, "Echo row");
    await waitFor(() => expect(banner()).toBeInTheDocument());
    expectLocked("Open row");
  });
});

// ── the toggle: optimistic save, rollback ───────────────────────────────────────

describe("the toggle", () => {
  it("shows up under the header on the Today view, once, as a switch labelled with its purpose", async () => {
    await renderToday(server(world("uneaten")));
    expect(screen.getAllByRole("switch")).toHaveLength(1);
    expect(sw()).toHaveAccessibleName("Frog first: dim other tasks until the frog is eaten");
    expect(sw()).toHaveAttribute("aria-checked", "false");
  });

  it("is not on the planning screen (no plan yet), the skeleton or the error screen", async () => {
    mockApi({ "GET /api/today": unplanned(), "GET /api/today/candidates": [] });
    const { unmount } = render(<TodayView />);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument(); // skeleton
    await screen.findByRole("heading", { name: "Plan my day" });
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    unmount();

    mockApi({ "GET /api/today": httpError(500, "down"), "GET /api/today/candidates": [] });
    render(<TodayView />);
    await screen.findByText("Couldn't load today");
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("is not in the Plan stepper that 'Edit plan' opens, and is back after Cancel", async () => {
    const { user } = await renderToday(server(world("uneaten")));
    await user.click(screen.getByRole("button", { name: /Edit plan/ }));
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(sw()).toBeInTheDocument();
  });

  it("is not in the Close-the-day flow, and is back after Cancel", async () => {
    const { user } = await renderToday(server(world("uneaten")));
    await user.click(screen.getByRole("button", { name: "Close the day" }));
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(sw()).toBeInTheDocument();
  });

  it("flips optimistically (before the server answers), locks at once, and sends exactly {frogFirstMode:true}", async () => {
    const hold = deferred<unknown>();
    const s = server(world("uneaten"), { settingsReply: () => hold.promise });
    const { api, user } = await renderToday(s);
    expect(banner()).not.toBeInTheDocument();

    await user.click(sw());
    expect(sw()).toHaveAttribute("aria-checked", "true");
    expect(banner()).toBeInTheDocument();
    expectLocked("Open row");
    expect(putCalls(api)).toHaveLength(1);
    expect(putCalls(api)[0].body).toEqual({ frogFirstMode: true });

    // verbatim request: PUT, JSON header, only that one key
    const [url, init] = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls.find(([u]) => String(u) === "/api/user-settings")!;
    expect(url).toBe("/api/user-settings");
    expect(init.method).toBe("PUT");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(init.body).toBe('{"frogFirstMode":true}');

    await act(async () => hold.resolve({ frogFirstMode: true }));
    expect(sw()).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(banner()).toBeInTheDocument();
  });

  it("turning it back off sends {frogFirstMode:false} and unlocks at once", async () => {
    const s = server(world("uneaten"), { mode: true });
    const { api, user } = await renderToday(s);
    expect(banner()).toBeInTheDocument();
    await user.click(sw());
    expect(sw()).toHaveAttribute("aria-checked", "false");
    expect(banner()).not.toBeInTheDocument();
    expectEnabled("Open row");
    await waitFor(() => expect(putCalls(api)).toHaveLength(1));
    expect(putCalls(api)[0].body).toEqual({ frogFirstMode: false });
    expect(s.state.mode).toBe(false);
  });

  it("on, off, on: three PUTs with alternating bodies, never any other fields", async () => {
    const { api, user } = await renderToday(server(world("uneaten")));
    for (let i = 0; i < 3; i++) {
      await user.click(sw());
      await waitFor(() => expect(putCalls(api)).toHaveLength(i + 1));
      // wait for the save to settle so the next click isn't ignored
      await waitFor(() => expect(sw()).toHaveAttribute("aria-checked", String(i % 2 === 0)));
      await act(async () => {});
    }
    expect(putCalls(api).map((c) => c.body)).toEqual([{ frogFirstMode: true }, { frogFirstMode: false }, { frogFirstMode: true }]);
  });

  it("works from the keyboard (Space and Enter)", async () => {
    const { api, user } = await renderToday(server(world("uneaten")));
    sw().focus();
    await user.keyboard(" ");
    await waitFor(() => expect(sw()).toHaveAttribute("aria-checked", "true"));
    await waitFor(() => expect(putCalls(api)).toHaveLength(1));
    await act(async () => {});
    await user.keyboard("{Enter}");
    await waitFor(() => expect(sw()).toHaveAttribute("aria-checked", "false"));
    await waitFor(() => expect(putCalls(api)).toHaveLength(2));
  });

  it("keeps keyboard focus on the switch across the save", async () => {
    const { user } = await renderToday(server(world("uneaten")));
    sw().focus();
    await user.keyboard(" ");
    await waitFor(() => expect(sw()).toHaveAttribute("aria-checked", "true"));
    await act(async () => {});
    expect(sw()).toHaveFocus();
  });

  it("clicks while a save is in flight are ignored: one PUT, state follows the first click", async () => {
    const hold = deferred<unknown>();
    const { api, user } = await renderToday(server(world("uneaten"), { settingsReply: () => hold.promise }));
    await user.click(sw());
    await user.click(sw());
    await user.dblClick(sw());
    await user.keyboard("{Enter}");
    expect(putCalls(api)).toHaveLength(1);
    expect(sw()).toHaveAttribute("aria-checked", "true");
    await act(async () => hold.resolve({}));
    expect(putCalls(api)).toHaveLength(1);
    expect(sw()).toHaveAttribute("aria-checked", "true");
    // once settled, the next click is honoured again
    await user.click(sw());
    await waitFor(() => expect(putCalls(api)).toHaveLength(2));
    expect(putCalls(api)[1].body).toEqual({ frogFirstMode: false });
  });

  it("a double click on a fast server: first click saves, the second is either ignored or a clean off (never two 'on' PUTs)", async () => {
    const { api, user } = await renderToday(server(world("uneaten")));
    await user.dblClick(sw());
    await waitFor(() => expect(putCalls(api).length).toBeGreaterThan(0));
    await act(async () => {});
    const bodies = putCalls(api).map((c) => (c.body as { frogFirstMode: boolean }).frogFirstMode);
    for (let i = 1; i < bodies.length; i++) expect(bodies[i]).toBe(!bodies[i - 1]);
    expect(sw()).toHaveAttribute("aria-checked", String(bodies.length % 2 === 1));
  });
});

describe("the toggle: failures roll back", () => {
  it("a 500 with a message: flips back, unlocks/relocks accordingly, and shows the server's message inline", async () => {
    const s = server(world("uneaten"), { settingsReply: () => httpError(500, "Database is down") });
    const { user } = await renderToday(s);
    await user.click(sw());
    expect(await screen.findByRole("alert")).toHaveTextContent("Database is down");
    expect(sw()).toHaveAttribute("aria-checked", "false");
    expect(banner()).not.toBeInTheDocument();
    expectEnabled("Open row");
  });

  it("failing while turning OFF restores ON, the lock and the banner", async () => {
    const s = server(world("uneaten"), { mode: true, settingsReply: () => httpError(401, "Unauthorized") });
    const { user } = await renderToday(s);
    await user.click(sw());
    expect(await screen.findByRole("alert")).toHaveTextContent("Unauthorized");
    expect(sw()).toHaveAttribute("aria-checked", "true");
    expect(banner()).toBeInTheDocument();
    expectLocked("Open row");
  });

  it("a 400 for a bad value shows the route's message", async () => {
    const s = server(world("uneaten"), { settingsReply: () => httpError(400, "frogFirstMode must be a boolean") });
    const { user } = await renderToday(s);
    await user.click(sw());
    expect(await screen.findByRole("alert")).toHaveTextContent("frogFirstMode must be a boolean");
  });

  it("a non-JSON error body falls back to a generic message", async () => {
    const s = server(world("uneaten"));
    const api = mockApi({ ...s.routes, "PUT /api/user-settings": () => ({ __status: 502, body: "not json" }) } as never);
    // a JSON-encoded string body: no `error` key -> fallback text
    const user = userEvent.setup();
    render(<TodayView />);
    await screen.findByRole("heading", { name: "Today" });
    await user.click(sw());
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save that setting");
    expect(api.to("PUT /api/user-settings")).toHaveLength(1);
  });

  it("a network failure (fetch rejects) rolls back and shows the error's message", async () => {
    const s = server(world("uneaten"), {
      settingsReply: () => {
        throw new Error("Failed to fetch");
      },
    });
    const { user } = await renderToday(s);
    await user.click(sw());
    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to fetch");
    expect(sw()).toHaveAttribute("aria-checked", "false");
  });

  it("the error is cleared when the next attempt starts, and the next attempt works after a failure (not stuck 'saving')", async () => {
    let fail = true;
    const s = server(world("uneaten"), {
      settingsReply: () => (fail ? httpError(500, "boom") : { frogFirstMode: true }),
    });
    const { api, user } = await renderToday(s);
    await user.click(sw());
    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
    fail = false;
    await user.click(sw());
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(sw()).toHaveAttribute("aria-checked", "true");
    expect(putCalls(api)).toHaveLength(2);
    expect(putCalls(api).map((c) => c.body)).toEqual([{ frogFirstMode: true }, { frogFirstMode: true }]);
  });

  it("the error is announced as an alert and sits outside the switch", async () => {
    const { user } = await renderToday(server(world("uneaten"), { settingsReply: () => httpError(500, "boom") }));
    await user.click(sw());
    const alert = await screen.findByRole("alert");
    expect(sw()).not.toContainElement(alert);
    expect(sw()).toHaveAccessibleName("Frog first: dim other tasks until the frog is eaten");
  });

  it("a failed save does not touch the rest of the page (no row error, no notice)", async () => {
    const { user } = await renderToday(server(world("uneaten"), { settingsReply: () => httpError(500, "boom") }));
    await user.click(sw());
    await screen.findByRole("alert");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("rollback happens against the latest payload, not a stale one (another edit made while saving survives)", async () => {
    const hold = deferred<unknown>();
    const s = server(world("none"), { settingsReply: () => hold.promise });
    const { user } = await renderToday(s);
    await user.click(sw()); // optimistic on, save pending
    await user.click(box("Open row")); // mode on but no frog, so the row is free: mark it done meanwhile
    await waitFor(() => expect(box("Open row")).toHaveAttribute("aria-checked", "true"));
    await act(async () => hold.resolve(httpError(500, "late failure")));
    expect(await screen.findByRole("alert")).toHaveTextContent("late failure");
    expect(sw()).toHaveAttribute("aria-checked", "false");
    expect(box("Open row")).toHaveAttribute("aria-checked", "true"); // the done edit wasn't rolled back with it
  });
});

// ── races with the silent refresh ───────────────────────────────────────────────

describe("the toggle versus the silent refresh", () => {
  it("an older in-flight refresh answers AFTER the toggle: it is dropped and the toggle stays", async () => {
    const s = server(world("none"));
    const { api, user } = await renderToday(s);
    const refresh = deferred<TodayPayload>();
    api.on("GET /api/today", () => refresh.promise);

    await user.click(box("Open row")); // PATCH, then a refresh that is held open
    await waitFor(() => expect(api.to("GET /api/today")).toHaveLength(2));
    const stale = s.build(); // frogFirstMode: false

    await user.click(sw()); // toggles ON (server stores it right away)
    await waitFor(() => expect(putCalls(api)).toHaveLength(1));
    await waitFor(() => expect(sw()).toHaveAttribute("aria-checked", "true"));
    await act(async () => {});

    await act(async () => refresh.resolve(stale));
    expect(sw()).toHaveAttribute("aria-checked", "true");
  });

  it("a refresh that started while the save was in flight and answers after it succeeded is dropped too", async () => {
    const hold = deferred<unknown>();
    const s = server(world("none"), { settingsReply: () => hold.promise });
    const { api, user } = await renderToday(s);
    const refresh = deferred<TodayPayload>();

    await user.click(sw()); // ON, save pending
    api.on("GET /api/today", () => refresh.promise);
    await user.click(box("Open row")); // refresh starts while the save is pending
    await waitFor(() => expect(api.to("GET /api/today")).toHaveLength(2));
    const stale = { ...s.build(), frogFirstMode: false }; // the server hadn't stored the flag yet

    await act(async () => hold.resolve({ frogFirstMode: true })); // save succeeds
    await act(async () => refresh.resolve(stale)); // the stale answer lands afterwards
    expect(sw()).toHaveAttribute("aria-checked", "true");
    expect(box("Open row")).toHaveAttribute("aria-checked", "true");
  });

  it("a refresh that answers while the save is still in flight can't leave the toggle off once the save succeeds", async () => {
    const hold = deferred<unknown>();
    const s = server(world("none"), { settingsReply: () => hold.promise });
    const { api, user } = await renderToday(s);
    await user.click(sw()); // ON, save pending
    await user.click(box("Open row")); // PATCH + refresh; the default GET handler answers with the OLD flag
    await waitFor(() => expect(api.to("GET /api/today")).toHaveLength(2));
    await act(async () => {});
    await act(async () => hold.resolve({ frogFirstMode: true }));
    expect(sw()).toHaveAttribute("aria-checked", "true");
  });

  it("a refresh that answers while the save is still in flight can't leave the toggle on after a FAILED save", async () => {
    const hold = deferred<unknown>();
    const s = server(world("none"), { settingsReply: () => hold.promise });
    const { api, user } = await renderToday(s);
    await user.click(sw());
    await user.click(box("Open row"));
    await waitFor(() => expect(api.to("GET /api/today")).toHaveLength(2));
    await act(async () => {});
    await act(async () => hold.resolve(httpError(500, "nope")));
    expect(await screen.findByRole("alert")).toHaveTextContent("nope");
    expect(sw()).toHaveAttribute("aria-checked", "false");
  });

  it("a refresh that carries the server's truth (changed in another tab) is applied when nothing local happened since", async () => {
    const s = server(world("none"), { mode: false });
    const { api, user } = await renderToday(s);
    s.state.mode = true; // another tab turned it on
    await eliminate(user, "Echo row");
    await waitFor(() => expect(sw()).toHaveAttribute("aria-checked", "true"));
    expect(putCalls(api)).toHaveLength(0);
  });
});

// ── persistence: reload, rollover ───────────────────────────────────────────────

describe("persisted mode", () => {
  it("a reload (fresh mount) shows the mode from the payload, without reading /api/user-settings", async () => {
    const s = server(world("uneaten"), { mode: false });
    const first = await renderToday(s);
    await first.user.click(sw());
    await waitFor(() => expect(s.state.mode).toBe(true));
    first.unmount();

    const api = mockApi(s.routes as never);
    render(<TodayView />);
    await screen.findByRole("heading", { name: "Today" });
    expect(sw()).toHaveAttribute("aria-checked", "true");
    expect(banner()).toBeInTheDocument();
    expect(api.calls.every((c) => c.path !== "/api/user-settings")).toBe(true);
  });

  it("the date rollover loads the new day's payload and keeps the persisted mode (on and off)", async () => {
    for (const mode of [true, false]) {
      freezeNow("2026-10-24T21:59:00Z", { intervals: true }); // 23:59 on the 24th in Berlin
      const day = (d: string) =>
        payload({
          date: d,
          plan: plan({ date: d, frogTaskId: "f" }),
          tasks: [task({ id: "f", title: `Frog ${d}`, plannedFor: d, abcde: "A" }), task({ id: "o", title: `Open ${d}`, plannedFor: d, order: 1 })],
          frogId: "f",
          frogFirstMode: mode,
        });
      mockApi({ "GET /api/today": (c) => day(c.query.get("date")!), "GET /api/today/candidates": [] });
      const { unmount } = render(<TodayView />);
      await screen.findAllByText("Frog 2026-10-24");
      expect(sw()).toHaveAttribute("aria-checked", String(mode));
      expect(banner() !== null).toBe(mode);

      vi.setSystemTime(new Date("2026-10-24T22:01:00Z"));
      act(() => {
        window.dispatchEvent(new Event("focus"));
      });
      await screen.findAllByText("Frog 2026-10-25");
      expect(sw()).toHaveAttribute("aria-checked", String(mode));
      expect(banner() !== null).toBe(mode);
      unmount();
    }
  });

  it("a toggle saved on one day is still what the next day's load says (the server is the source of truth)", async () => {
    freezeNow("2026-10-24T21:59:00Z", { intervals: true });
    const s = server(world("uneaten"));
    const api = mockApi({
      ...s.routes,
      "GET /api/today": (c: { query: URLSearchParams }) =>
        c.query.get("date") === DATE
          ? s.build()
          : payload({ date: "2026-10-25", plan: plan({ date: "2026-10-25" }), tasks: [task({ id: "n", title: "Next day", plannedFor: "2026-10-25" })], frogFirstMode: s.state.mode }),
    } as never);
    const user = userEvent.setup();
    render(<TodayView />);
    await screen.findByRole("heading", { name: "Today" });
    await user.click(sw());
    await waitFor(() => expect(s.state.mode).toBe(true));
    await act(async () => {});
    vi.setSystemTime(new Date("2026-10-24T22:01:00Z"));
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await screen.findByText("Next day");
    expect(sw()).toHaveAttribute("aria-checked", "true");
    expect(putCalls(api)).toHaveLength(1);
  });

  it("an answer for the OLD day that lands after rollover can't change the new day's toggle", async () => {
    freezeNow("2026-10-24T21:58:00Z", { intervals: true });
    const s = server(world("uneaten"));
    const api = mockApi({
      ...s.routes,
      "GET /api/today": (c: { query: URLSearchParams }) =>
        c.query.get("date") === DATE ? s.build() : payload({ date: "2026-10-25", plan: plan({ date: "2026-10-25" }), tasks: [task({ id: "n", title: "Next day", plannedFor: "2026-10-25" })], frogFirstMode: false }),
    } as never);
    const user = userEvent.setup();
    render(<TodayView />);
    await screen.findByRole("heading", { name: "Today" });
    const old = deferred<TodayPayload>();
    api.on("GET /api/today", (c) => (c.query.get("date") === DATE ? old.promise : payload({ date: "2026-10-25", plan: plan({ date: "2026-10-25" }), tasks: [task({ id: "n", title: "Next day", plannedFor: "2026-10-25" })], frogFirstMode: false })));
    await eliminate(user, "Echo row");
    await waitFor(() => expect(api.to("GET /api/today")).toHaveLength(2));
    vi.setSystemTime(new Date("2026-10-24T22:01:00Z"));
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await screen.findByText("Next day");
    await act(async () => old.resolve({ ...s.build(), frogFirstMode: true }));
    expect(sw()).toHaveAttribute("aria-checked", "false");
  });

  it("a toggle that fails after the date rolled over doesn't write into the new day", async () => {
    freezeNow("2026-10-24T21:58:00Z", { intervals: true });
    const hold = deferred<unknown>();
    const s = server(world("uneaten"), { settingsReply: () => hold.promise });
    mockApi({
      ...s.routes,
      "GET /api/today": (c: { query: URLSearchParams }) =>
        c.query.get("date") === DATE ? s.build() : payload({ date: "2026-10-25", plan: plan({ date: "2026-10-25" }), tasks: [task({ id: "n", title: "Next day", plannedFor: "2026-10-25" })], frogFirstMode: false }),
    } as never);
    const user = userEvent.setup();
    render(<TodayView />);
    await screen.findByRole("heading", { name: "Today" });
    await user.click(sw()); // optimistic ON on the 24th, save pending
    vi.setSystemTime(new Date("2026-10-24T22:01:00Z"));
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await screen.findByText("Next day");
    await act(async () => hold.resolve(httpError(500, "late")));
    // The new day's payload said OFF and nothing from the old day's save may flip it.
    expect(sw()).toHaveAttribute("aria-checked", "false");
  });
});

// ── hydration safety ────────────────────────────────────────────────────────────

describe("server render and hydration", () => {
  it("TodayDay with the lock active renders the same on the server and on hydration (no warnings)", async () => {
    const w = world("uneaten");
    const p = payload({ tasks: w.tasks, frog: w.frog, frogId: "f", frogFirstMode: true });
    const props = { payload: p, tz: "Europe/Berlin", onChange: () => {}, onRefresh: () => {}, onEditPlan: () => {}, onReviewed: () => {} };
    const html = renderToString(<TodayDay {...props} />);
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain(BANNER);
    expect(html).toContain('aria-disabled="true"');

    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, <TodayDay {...props} />);
    });
    expect(errors).not.toHaveBeenCalled();
    act(() => root.unmount());
    container.remove();
  });

  it("no frog-first output depends on the clock: same markup rendered at two different times", () => {
    const w = world("uneaten");
    const p = payload({ tasks: w.tasks, frog: w.frog, frogId: "f", frogFirstMode: true });
    const props = { payload: p, tz: "Europe/Berlin", onChange: () => {}, onRefresh: () => {}, onEditPlan: () => {}, onReviewed: () => {} };
    const a = renderToString(<TodayDay {...props} />);
    vi.setSystemTime(new Date("2031-03-03T03:03:00Z"));
    expect(renderToString(<TodayDay {...props} />)).toBe(a);
  });
});

// ── closed day ──────────────────────────────────────────────────────────────────

describe("a closed day", () => {
  it("shows the toggle (it has no effect on this day) and can still save it", async () => {
    const s = server(world("uneaten"), { reviewed: true });
    const { api, user } = await renderToday(s);
    expect(sw()).toBeInTheDocument();
    expect(banner()).not.toBeInTheDocument();
    await user.click(sw());
    expect(sw()).toHaveAttribute("aria-checked", "true");
    expect(banner()).not.toBeInTheDocument(); // still no banner, still no lock
    expectEnabled("Open row");
    await waitFor(() => expect(putCalls(api)).toHaveLength(1));
    expect(putCalls(api)[0].body).toEqual({ frogFirstMode: true });
  });

  it("closing the day while locked lifts the lock (the review's payload says reviewed)", async () => {
    const s = server(world("uneaten"), { mode: true });
    const reviewed = () => ({ ...s.build(), plan: plan({ frogTaskId: "f", reviewedAt: REVIEWED_AT }) });
    const { user } = await renderToday(s, { "POST /api/today/review": () => reviewed() });
    expect(banner()).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close the day" }));
    // step through the flow to the end
    for (let i = 0; i < 6; i++) {
      const save = screen.queryByRole("button", { name: /save and close the day/i });
      if (save) {
        await user.click(save);
        break;
      }
      await user.click(screen.getByRole("button", { name: /continue/i }));
    }
    await screen.findByText(/Day closed/i);
    expect(banner()).not.toBeInTheDocument();
    expect(sw()).toHaveAttribute("aria-checked", "true"); // the review's payload carries the persisted mode
  });
});

// ── misc ────────────────────────────────────────────────────────────────────────

describe("misc", () => {
  it("the page never reads the whole settings row (no GET /api/user-settings)", async () => {
    const { api } = await renderToday(server(world("uneaten"), { mode: true }));
    expect(api.calls.filter((c) => c.path === "/api/user-settings")).toHaveLength(0);
  });

  it("a frog without a Done column, mode on: nothing is locked (the user couldn't unlock it from this page)", async () => {
    await renderToday(server(world("no-done-column"), { mode: true }));
    expect(banner()).not.toBeInTheDocument();
    expectEnabled("Open row");
  });

  it("only one switch, one banner, even with many rows", async () => {
    const w = world("uneaten");
    for (let i = 0; i < 20; i++) w.tasks.push(task({ id: `x${i}`, title: `Extra ${i}`, order: 10 + i, group: GROUP_HOME, groupId: GROUP_HOME.id }));
    await renderToday(server(w, { mode: true }));
    expect(screen.getAllByRole("switch")).toHaveLength(1);
    expect(screen.getAllByText(BANNER)).toHaveLength(1);
    for (let i = 0; i < 20; i++) expectLocked(`Extra ${i}`);
  });
});
