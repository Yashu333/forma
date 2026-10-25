// Fixtures and a tiny `fetch` router for the component tests.
import { vi } from "vitest";
import type { DailyPlan, Priority, TodayCandidate, TodayFrog, TodayPayload, TodayTask } from "@/types";

export const DATE = "2026-10-24";
export const TZ = "Europe/Berlin";

export const GROUP_WORK = { id: "g-work", name: "Work", color: "#7C6EF8", doneStatusId: "s-work-done" };
export const GROUP_HOME = { id: "g-home", name: "Home", color: "#34D399", doneStatusId: "s-home-done" };
/** A project without a Done column. */
export const GROUP_NODONE = { id: "g-nodone", name: "Inbox", color: "#FB923C", doneStatusId: null };

type Overrides<T> = Partial<T> & { id: string };

export function task(o: Overrides<TodayTask> & { title?: string }): TodayTask {
  return {
    title: o.id,
    groupId: o.group?.id ?? GROUP_WORK.id,
    statusId: "s-todo",
    priority: "MEDIUM" as Priority,
    order: 0,
    createdBy: "u1",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    abcde: null,
    abcdeRank: null,
    plannedFor: DATE,
    completedAt: null,
    group: GROUP_WORK,
    ...o,
  };
}

export function candidate(o: Partial<TodayCandidate> & { id: string }): TodayCandidate {
  const group = o.group ?? { id: GROUP_WORK.id, name: GROUP_WORK.name, color: GROUP_WORK.color };
  return {
    title: o.id,
    groupId: group.id,
    statusId: "s-todo",
    priority: "MEDIUM",
    order: 0,
    abcde: null,
    abcdeRank: null,
    plannedFor: null,
    dueDate: null,
    ...o,
    group,
  };
}

export function plan(o: Partial<DailyPlan> = {}): DailyPlan {
  return {
    id: "plan1",
    userId: "u1",
    date: DATE,
    frogTaskId: null,
    plannedAt: "2026-10-24T05:00:00.000Z",
    reviewedAt: null,
    createdAt: "2026-10-24T05:00:00.000Z",
    updatedAt: "2026-10-24T05:00:00.000Z",
    ...o,
  };
}

/** A planned, not-yet-reviewed day. `frog` defaults to the task named by plan.frogTaskId, if any. */
export function payload(o: Partial<TodayPayload> & { frogId?: string | null } = {}): TodayPayload {
  const { frogId, ...rest } = o;
  const tasks = rest.tasks ?? [];
  const frogTask = frogId ? tasks.find((t) => t.id === frogId) : undefined;
  const frog: TodayFrog | null =
    rest.frog !== undefined ? rest.frog : frogTask ? { ...frogTask, subtasks: [] } : null;
  return {
    date: DATE,
    plan: plan({ frogTaskId: frogId ?? null }),
    completedToday: [],
    openA: tasks.filter((t) => t.abcde === "A" && !t.completedAt).length,
    streak: { current: 0, longest: 0 },
    frogFirstMode: false,
    ...rest,
    tasks,
    frog,
  };
}

/** The payload of a day nobody has planned yet. */
export function unplanned(o: Partial<TodayPayload> = {}): TodayPayload {
  return payload({ plan: null, tasks: [], ...o });
}

/**
 * Fakes only the clock (and, with `intervals`, setInterval), leaving setTimeout
 * and microtasks real so Testing Library's waitFor/findBy keep working.
 */
export function freezeNow(iso: string, opts: { intervals?: boolean } = {}) {
  vi.useFakeTimers({ toFake: opts.intervals ? ["Date", "setInterval", "clearInterval"] : ["Date"] });
  vi.setSystemTime(new Date(iso));
}

// ── fetch router ─────────────────────────────────────────────────────────────

export interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

type Reply = unknown;
// (A plain `unknown` here would erase the callback's parameter type, hence the explicit union.)
type Handler = ((call: Call) => unknown) | object | string | number | boolean | null;

/** Makes a handler answer with an HTTP error. */
export const httpError = (status: number, error: string) => ({ __status: status, body: { error } });

export interface Api {
  calls: Call[];
  /** Calls whose key ("PUT /api/today") matches. */
  to(key: string): Call[];
  /** Replaces or adds a handler. */
  on(key: string, handler: Handler): void;
}

/**
 * Stubs global `fetch`. Keys are "METHOD /path" without the query string
 * (GET when the method is omitted from the request). A handler returns the JSON
 * body (200), `httpError(...)`, or a function of the call that does either.
 * Unrouted requests reject so a forgotten route fails the test.
 */
export function mockApi(handlers: Record<string, Handler>): Api {
  // Today loads a habits card, the weekly-review nudge and the rough sheet in the background, and
  // Reports a focus-time section.
  // They are not what these tests are about, so they answer "nothing" unless a test routes them.
  const table = new Map<string, Handler>(Object.entries({
    "GET /api/habits": { habits: [], archived: [] },
    "GET /api/reports/focus": { totalSec: 0, sessions: 0, daily: [], byProject: [], topTasks: [], untrackedSec: 0 },
    "GET /api/review/status": { weekStart: "2026-10-19", nudge: false, thisWeekFocus: null },
    "GET /api/today/note": { note: null, previous: null },
    ...handlers,
  }));
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const call: Call = {
      method,
      path: url.pathname,
      query: url.searchParams,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const handler = table.get(`${method} ${url.pathname}`);
    if (handler === undefined) throw new Error(`Unrouted fetch: ${method} ${url.pathname}`);
    const reply: Reply = typeof handler === "function" ? await handler(call) : handler;
    if (reply && typeof reply === "object" && "__status" in reply) {
      const r = reply as { __status: number; body: unknown };
      return new Response(JSON.stringify(r.body), { status: r.__status, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify(reply), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return {
    calls,
    to: (key) => calls.filter((c) => `${c.method} ${c.path}` === key),
    on: (key, handler) => void table.set(key, handler),
  };
}

/** A promise you resolve by hand, to hold a request open. */
export function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
