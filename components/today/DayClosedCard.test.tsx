// @vitest-environment jsdom
// The "Day closed" summary card. Tomorrow's frog comes from a quiet GET for
// tomorrow's date; every failure mode of that request must leave the card intact.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TodayCompletedTask, TodayPayload } from "@/types";
import DayClosedCard from "./DayClosedCard";
import { TZ, deferred, freezeNow, httpError, mockApi, payload, plan, task, unplanned } from "../../tests/ui/fixtures";

const ATE_AT = "2026-10-24T07:42:00.000Z";
const TOMORROW = "2026-10-25";
const REVIEWED = "2026-10-24T18:00:00.000Z";

beforeEach(() => {
  freezeNow("2026-10-24T18:30:00Z");
});

const done = (id: string): TodayCompletedTask => ({
  id,
  title: id,
  abcde: null,
  abcdeRank: null,
  completedAt: ATE_AT,
  group: { id: "g", name: "G", color: "#fff" },
});

/** A closed day. */
function closedDay(o: Partial<TodayPayload> & { frogId?: string | null } = {}): TodayPayload {
  return payload({ plan: plan({ reviewedAt: REVIEWED }), ...o });
}

/** Tomorrow's payload with a frog. */
const tomorrowWith = (title: string, extra: object = {}): TodayPayload => {
  const t = task({ id: "tf", title, plannedFor: TOMORROW });
  return payload({ date: TOMORROW, plan: plan({ date: TOMORROW, frogTaskId: "tf", plannedAt: null }), tasks: [t], frog: { ...t, subtasks: [], ...extra } });
};

function renderCard(p: TodayPayload, handler: unknown = unplanned({ date: TOMORROW })) {
  const api = mockApi({ "GET /api/today": handler as never });
  const onEdit = vi.fn();
  const user = userEvent.setup();
  const view = render(<DayClosedCard payload={p} tz={TZ} onEdit={onEdit} />);
  return { api, onEdit, user, ...view };
}

const rows = () => Object.fromEntries(Array.from(document.querySelectorAll("dl > div")).map((d) => [d.querySelector("dt")!.textContent, d.querySelector("dd")!.textContent]));

describe("DayClosedCard: summary", () => {
  it("is a labelled section with a heading and the Edit review button", () => {
    renderCard(closedDay());
    const card = screen.getByRole("region", { name: "Day closed" });
    expect(within(card).getByRole("heading", { name: "Day closed" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: /edit review/i })).toBeInTheDocument();
  });

  it("frog eaten: says so", () => {
    const frog = task({ id: "f", title: "F", completedAt: ATE_AT });
    renderCard(closedDay({ tasks: [frog], frogId: "f", completedToday: [done("f")] }));
    expect(rows()["Today's frog"]).toBe("Eaten 🐸");
  });

  it("frog not eaten", () => {
    renderCard(closedDay({ tasks: [task({ id: "f" })], frogId: "f" }));
    expect(rows()["Today's frog"]).toBe("Not eaten");
  });

  it("no frog (none planned, or eliminated)", () => {
    renderCard(closedDay({ plan: plan({ reviewedAt: REVIEWED, frogTaskId: null }) }));
    expect(rows()["Today's frog"]).toBe("No frog today");
  });

  it("an eliminated frog (archived, uneaten) reads as no frog", () => {
    const f = { ...task({ id: "f" }), subtasks: [], archivedAt: "2026-10-24T10:00:00.000Z" };
    renderCard(closedDay({ plan: plan({ reviewedAt: REVIEWED, frogTaskId: "f" }), frog: f }));
    expect(rows()["Today's frog"]).toBe("No frog today");
  });

  it("a frog eaten on an earlier day than the plan date counts as eaten, one eaten later doesn't", () => {
    const early = task({ id: "f", completedAt: "2026-10-20T10:00:00.000Z" });
    const { unmount } = renderCard(closedDay({ tasks: [early], frogId: "f" }));
    expect(rows()["Today's frog"]).toBe("Eaten 🐸");
    unmount();
    const late = task({ id: "f", completedAt: "2026-10-27T10:00:00.000Z" });
    renderCard(closedDay({ tasks: [late], frogId: "f" }));
    expect(rows()["Today's frog"]).toBe("Not eaten");
  });

  it("counts the tasks done today", () => {
    renderCard(closedDay({ completedToday: [done("a"), done("b"), done("c")] }));
    expect(rows()["Tasks done"]).toBe("3");
  });

  it("zero tasks done reads 0", () => {
    renderCard(closedDay());
    expect(rows()["Tasks done"]).toBe("0");
  });

  it("shows the streak line, in amber when running, muted with a gentle line when not", () => {
    const { unmount } = renderCard(closedDay({ streak: { current: 4, longest: 9 } }));
    const line = screen.getByText("4-day frog streak");
    expect(line).toHaveStyle({ color: "#FBBF24" });
    unmount();
    renderCard(closedDay({ streak: { current: 0, longest: 9 } }));
    expect(screen.getByText(/no frog streak yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/🔥/)).not.toBeInTheDocument();
  });

  it("Edit review calls onEdit", async () => {
    const { user, onEdit } = renderCard(closedDay());
    await user.click(screen.getByRole("button", { name: /edit review/i }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("a long frog title in the tomorrow row wraps rather than overflowing", async () => {
    const long = "T".repeat(300);
    renderCard(closedDay(), tomorrowWith(long));
    const dd = (await screen.findByText(long)) as HTMLElement;
    expect(dd.className).toContain("break-words");
    expect(dd.className).toContain("min-w-0");
  });
});

describe("DayClosedCard: tomorrow's frog", () => {
  it("asks for tomorrow's date with the same tz, once, and shows the frog's title", async () => {
    const { api } = renderCard(closedDay(), tomorrowWith("Write the report"));
    expect(await screen.findByText("Write the report")).toBeInTheDocument();
    expect(rows()["Tomorrow's frog"]).toBe("Write the report");
    const calls = api.to("GET /api/today");
    expect(calls).toHaveLength(1);
    expect(calls[0].query.get("date")).toBe(TOMORROW);
    expect(calls[0].query.get("tz")).toBe(TZ);
  });

  it("has no tomorrow row while the request is in flight, and fills it in afterwards", async () => {
    const gate = deferred<unknown>();
    renderCard(closedDay(), () => gate.promise);
    expect(rows()["Tomorrow's frog"]).toBeUndefined();
    await act(async () => gate.resolve(tomorrowWith("Late frog")));
    expect(await screen.findByText("Late frog")).toBeInTheDocument();
  });

  it("no row when tomorrow has no plan / no frog", async () => {
    const api = renderCard(closedDay(), unplanned({ date: TOMORROW })).api;
    await waitFor(() => expect(api.to("GET /api/today")).toHaveLength(1));
    await act(async () => {});
    expect(rows()["Tomorrow's frog"]).toBeUndefined();
  });

  it("ignores an archived, uneaten tomorrow frog (eliminated since)", async () => {
    const api = renderCard(closedDay(), tomorrowWith("Gone", { archivedAt: "2026-10-24T19:00:00.000Z" })).api;
    await waitFor(() => expect(api.to("GET /api/today")).toHaveLength(1));
    await act(async () => {});
    expect(screen.queryByText("Gone")).not.toBeInTheDocument();
  });

  it("is quiet when the request fails with an HTTP error", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { api } = renderCard(closedDay(), httpError(500, "Database is on fire"));
    await waitFor(() => expect(api.to("GET /api/today")).toHaveLength(1));
    await act(async () => {});
    expect(rows()["Tomorrow's frog"]).toBeUndefined();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/on fire/)).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Day closed" })).toBeInTheDocument();
    expect(errors).not.toHaveBeenCalled();
  });

  it("is quiet when the request rejects (network failure)", async () => {
    const { api } = renderCard(closedDay(), () => {
      throw new Error("Failed to fetch");
    });
    await waitFor(() => expect(api.to("GET /api/today")).toHaveLength(1));
    await act(async () => {});
    expect(rows()["Tomorrow's frog"]).toBeUndefined();
    expect(screen.queryByText(/failed to fetch/i)).not.toBeInTheDocument();
  });

  it("ignores an answer for a different date", async () => {
    const wrong = { ...tomorrowWith("Wrong day"), date: "2026-10-30" };
    const { api } = renderCard(closedDay(), wrong);
    await waitFor(() => expect(api.to("GET /api/today")).toHaveLength(1));
    await act(async () => {});
    expect(screen.queryByText("Wrong day")).not.toBeInTheDocument();
  });

  it("ignores an answer that arrives for today's date", async () => {
    const { api } = renderCard(closedDay(), closedDay({ tasks: [task({ id: "tf", title: "Today's own frog" })], frogId: "tf" }));
    await waitFor(() => expect(api.to("GET /api/today")).toHaveLength(1));
    await act(async () => {});
    expect(screen.queryByText("Today's own frog")).not.toBeInTheDocument();
  });

  it("computes tomorrow across a month and year end", async () => {
    const p = closedDay({ date: "2026-12-31" });
    const { api } = renderCard(p, (call: { query: URLSearchParams }) => tomorrowWith(`frog for ${call.query.get("date")}`));
    await waitFor(() => expect(api.to("GET /api/today")).toHaveLength(1));
    expect(api.to("GET /api/today")[0].query.get("date")).toBe("2027-01-01");
  });

  it("a late answer after unmount neither throws nor warns", async () => {
    const gate = deferred<unknown>();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = renderCard(closedDay(), () => gate.promise);
    unmount();
    await act(async () => gate.resolve(tomorrowWith("After unmount")));
    expect(errors).not.toHaveBeenCalled();
  });

  it("re-saving the review (a new reviewedAt) refreshes tomorrow's frog", async () => {
    let title = "First frog";
    const api = mockApi({ "GET /api/today": () => tomorrowWith(title) });
    const p = closedDay();
    const { rerender } = render(<DayClosedCard payload={p} tz={TZ} onEdit={() => {}} />);
    expect(await screen.findByText("First frog")).toBeInTheDocument();
    title = "Second frog";
    rerender(<DayClosedCard payload={{ ...p, plan: { ...p.plan!, reviewedAt: "2026-10-24T19:00:00.000Z" } }} tz={TZ} onEdit={() => {}} />);
    expect(await screen.findByText("Second frog")).toBeInTheDocument();
    expect(screen.queryByText("First frog")).not.toBeInTheDocument();
    expect(api.to("GET /api/today")).toHaveLength(2);
  });

  it("an older answer that lands after a newer one is dropped", async () => {
    const slow = deferred<unknown>();
    let n = 0;
    mockApi({ "GET /api/today": () => (++n === 1 ? slow.promise : tomorrowWith("Newer frog")) });
    const p = closedDay();
    const { rerender } = render(<DayClosedCard payload={p} tz={TZ} onEdit={() => {}} />);
    rerender(<DayClosedCard payload={{ ...p, plan: { ...p.plan!, reviewedAt: "2026-10-24T19:00:00.000Z" } }} tz={TZ} onEdit={() => {}} />);
    expect(await screen.findByText("Newer frog")).toBeInTheDocument();
    await act(async () => slow.resolve(tomorrowWith("Older frog")));
    expect(screen.queryByText("Older frog")).not.toBeInTheDocument();
    expect(screen.getByText("Newer frog")).toBeInTheDocument();
  });

  it("does not show the previous day's tomorrow-frog after the date changes", async () => {
    mockApi({ "GET /api/today": (call: { query: URLSearchParams }) => (call.query.get("date") === TOMORROW ? tomorrowWith("Frog of the 25th") : unplanned({ date: call.query.get("date")! })) });
    const p = closedDay();
    const { rerender } = render(<DayClosedCard payload={p} tz={TZ} onEdit={() => {}} />);
    expect(await screen.findByText("Frog of the 25th")).toBeInTheDocument();
    rerender(<DayClosedCard payload={{ ...p, date: "2026-11-02" }} tz={TZ} onEdit={() => {}} />);
    expect(screen.queryByText("Frog of the 25th")).not.toBeInTheDocument();
  });
});
