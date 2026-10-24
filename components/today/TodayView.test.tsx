// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import TodayView from "./TodayView";
import { DATE, TZ, candidate, deferred, freezeNow, httpError, mockApi, payload, task, unplanned } from "../../tests/ui/fixtures";

const NOW = "2026-10-24T08:00:00Z"; // 10:00 in Europe/Berlin

describe("TodayView: loading", () => {
  it("shows a skeleton while the first request is in flight", async () => {
    freezeNow(NOW);
    const gate = deferred<unknown>();
    mockApi({ "GET /api/today": () => gate.promise, "GET /api/today/candidates": [] });
    render(<TodayView />);

    const skeleton = await screen.findByLabelText("Loading today");
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("heading", { name: /plan my day/i })).not.toBeInTheDocument();

    await act(async () => gate.resolve(unplanned()));
    expect(await screen.findByRole("heading", { name: "Plan my day" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Loading today")).not.toBeInTheDocument();
  });

  it("asks for the browser's local date and time zone, and for the candidates", async () => {
    freezeNow(NOW);
    const api = mockApi({ "GET /api/today": unplanned(), "GET /api/today/candidates": [] });
    render(<TodayView />);
    await screen.findByRole("heading", { name: "Plan my day" });

    const [today] = api.to("GET /api/today");
    expect(today.query.get("date")).toBe(DATE);
    expect(today.query.get("tz")).toBe(TZ);
    expect(api.to("GET /api/today/candidates")).toHaveLength(1);
  });

  it("uses the LOCAL date, not the UTC one (00:30 on the 25th in Berlin is still the 24th in UTC)", async () => {
    freezeNow("2026-10-24T22:30:00Z"); // 00:30 on the 25th in Berlin
    const api = mockApi({ "GET /api/today": unplanned({ date: "2026-10-25" }), "GET /api/today/candidates": [] });
    render(<TodayView />);
    await screen.findByRole("heading", { name: "Plan my day" });
    expect(api.to("GET /api/today")[0].query.get("date")).toBe("2026-10-25");
  });

  it("server-renders the skeleton and hydrates it without a mismatch", async () => {
    freezeNow(NOW);
    mockApi({ "GET /api/today": unplanned(), "GET /api/today/candidates": [] });
    const html = renderToString(<TodayView />);
    // The server has no browser clock: nothing date-dependent may be in the markup.
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("Plan my day");

    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, <TodayView />);
    });
    expect(await screen.findByRole("heading", { name: "Plan my day" })).toBeInTheDocument();
    expect(errors).not.toHaveBeenCalled();
    act(() => root.unmount());
    container.remove();
  });
});

describe("TodayView: errors", () => {
  it("shows the server's message and a Retry button that reloads", async () => {
    freezeNow(NOW);
    let fail = true;
    const api = mockApi({
      "GET /api/today": () => (fail ? httpError(500, "Database is on fire") : unplanned()),
      "GET /api/today/candidates": [],
    });
    const user = userEvent.setup();
    render(<TodayView />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load today");
    expect(alert).toHaveTextContent("Database is on fire");
    expect(screen.queryByLabelText("Loading today")).not.toBeInTheDocument();

    fail = false;
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByRole("heading", { name: "Plan my day" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(api.to("GET /api/today")).toHaveLength(2);
  });

  it("shows the skeleton again while a retry is in flight", async () => {
    freezeNow(NOW);
    const gate = deferred<unknown>();
    let first = true;
    mockApi({
      "GET /api/today": () => {
        if (first) {
          first = false;
          return httpError(500, "nope");
        }
        return gate.promise;
      },
      "GET /api/today/candidates": [],
    });
    const user = userEvent.setup();
    render(<TodayView />);
    await user.click(await screen.findByRole("button", { name: /retry/i }));
    expect(await screen.findByLabelText("Loading today")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => gate.resolve(unplanned()));
    expect(await screen.findByRole("heading", { name: "Plan my day" })).toBeInTheDocument();
  });

  it("an error from the candidates request fails the whole load", async () => {
    freezeNow(NOW);
    mockApi({ "GET /api/today": unplanned(), "GET /api/today/candidates": httpError(401, "Unauthorized") });
    render(<TodayView />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unauthorized");
  });

  it("falls back to a generic message when the error body is not JSON", async () => {
    freezeNow(NOW);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>Bad gateway</html>", { status: 502 })),
    );
    render(<TodayView />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load today's plan");
  });

  it("shows a network failure (fetch rejects) as an error too", async () => {
    freezeNow(NOW);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    render(<TodayView />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to fetch");
  });
});

describe("TodayView: the three data states", () => {
  const candidates = [
    candidate({ id: "c1", title: "Write report" }),
    candidate({ id: "c2", title: "Fix bike", group: { id: "g-home", name: "Home", color: "#34D399" } }),
  ];

  it("no plan: shows Plan my day at the Pick step", async () => {
    freezeNow(NOW);
    mockApi({ "GET /api/today": unplanned(), "GET /api/today/candidates": candidates });
    render(<TodayView />);
    expect(await screen.findByRole("heading", { name: "Plan my day" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "What will you work on today?" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /write report/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Today" })).not.toBeInTheDocument();
  });

  it("a plan row without plannedAt (e.g. made by a review) still shows the stepper", async () => {
    freezeNow(NOW);
    const t = task({ id: "c1", title: "Write report" });
    mockApi({
      "GET /api/today": payload({ tasks: [t], plan: { ...payload().plan!, plannedAt: null, frogTaskId: "c1" } }),
      "GET /api/today/candidates": candidates,
    });
    render(<TodayView />);
    expect(await screen.findByRole("heading", { name: "Plan my day" })).toBeInTheDocument();
    // "Plan my day", not "Edit your plan": nothing was saved through the morning flow yet.
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /write report/i })).toBeChecked();
  });

  it("planned: shows the Today view", async () => {
    freezeNow(NOW);
    const t = task({ id: "t1", title: "Write report", abcde: "A", abcdeRank: 1 });
    mockApi({ "GET /api/today": payload({ tasks: [t], frogId: "t1" }), "GET /api/today/candidates": [] });
    render(<TodayView />);
    expect(await screen.findByRole("heading", { name: "Today" })).toBeInTheDocument();
    expect(screen.getByText("Saturday, October 24")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Today's list" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Plan my day" })).not.toBeInTheDocument();
  });

  it("Edit plan opens the stepper (Edit your plan) and Cancel goes back", async () => {
    freezeNow(NOW);
    const t = task({ id: "t1", title: "Write report", abcde: "A", abcdeRank: 1 });
    mockApi({ "GET /api/today": payload({ tasks: [t], frogId: "t1" }), "GET /api/today/candidates": [] });
    const user = userEvent.setup();
    render(<TodayView />);
    await user.click(await screen.findByRole("button", { name: /edit plan/i }));
    expect(screen.getByRole("heading", { name: "Edit your plan" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("heading", { name: "Today" })).toBeInTheDocument();
  });

  it("saving from Edit plan returns to the Today view with the saved plan and refreshes the candidates", async () => {
    freezeNow(NOW);
    const t1 = task({ id: "t1", title: "Write report", abcde: "A", abcdeRank: 1 });
    const t2 = task({ id: "t2", title: "Fix bike", group: { id: "g-home", name: "Home", color: "#34D399", doneStatusId: "s-home-done" } });
    const api = mockApi({
      "GET /api/today": payload({ tasks: [t1], frogId: "t1" }),
      "GET /api/today/candidates": [candidate({ id: "t1", title: "Write report" }), candidate({ id: "t2", title: "Fix bike" })],
      "PUT /api/today": payload({ tasks: [t1, t2], frogId: "t2" }),
    });
    const user = userEvent.setup();
    render(<TodayView />);
    await user.click(await screen.findByRole("button", { name: /edit plan/i }));
    await user.click(screen.getByRole("checkbox", { name: /fix bike/i }));
    await user.click(screen.getByRole("button", { name: /label them/i }));
    await user.click(screen.getByRole("button", { name: /choose your frog/i }));
    await user.click(screen.getByRole("radio", { name: /fix bike/i }));
    await user.click(screen.getByRole("button", { name: "Save plan" }));

    expect(await screen.findByRole("heading", { name: "Today" })).toBeInTheDocument();
    expect(screen.getAllByText("Fix bike").length).toBeGreaterThan(0); // frog card + list row
    await waitFor(() => expect(api.to("GET /api/today/candidates")).toHaveLength(2));
    expect(api.to("PUT /api/today")).toHaveLength(1);
  });
});

describe("TodayView: date rollover", () => {
  const planned = (date: string, title: string) =>
    payload({ date, plan: { ...payload().plan!, date }, tasks: [task({ id: `t-${date}`, title, plannedFor: date })] });

  async function setup() {
    freezeNow("2026-10-24T21:59:00Z", { intervals: true }); // 23:59 on the 24th in Berlin
    const api = mockApi({
      "GET /api/today": (call) => {
        const d = call.query.get("date")!;
        return d === "2026-10-24" ? planned(d, "Yesterday's task") : unplanned({ date: d });
      },
      "GET /api/today/candidates": [],
    });
    render(<TodayView />);
    await screen.findByText("Yesterday's task");
    expect(api.to("GET /api/today")).toHaveLength(1);
    return api;
  }

  const midnightPasses = () => vi.setSystemTime(new Date("2026-10-24T22:01:00Z")); // 00:01 on the 25th

  it("reloads for the new date when the window regains focus", async () => {
    const api = await setup();
    midnightPasses();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(await screen.findByRole("heading", { name: "Plan my day" })).toBeInTheDocument();
    expect(screen.queryByText("Yesterday's task")).not.toBeInTheDocument();
    expect(api.to("GET /api/today").map((c) => c.query.get("date"))).toEqual(["2026-10-24", "2026-10-25"]);
    expect(screen.getByText("Sunday, October 25")).toBeInTheDocument();
  });

  it("reloads when the tab becomes visible again", async () => {
    const api = await setup();
    midnightPasses();
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(await screen.findByRole("heading", { name: "Plan my day" })).toBeInTheDocument();
    expect(api.to("GET /api/today").at(-1)?.query.get("date")).toBe("2026-10-25");
  });

  it("notices midnight on its own through the one-minute timer", async () => {
    const api = await setup();
    await act(async () => {
      vi.advanceTimersByTime(2 * 60_000); // the fake clock moves too: 00:01 on the 25th
    });
    expect(await screen.findByRole("heading", { name: "Plan my day" })).toBeInTheDocument();
    expect(api.to("GET /api/today").at(-1)?.query.get("date")).toBe("2026-10-25");
  });

  it("shows the skeleton, not the old day, while the new day loads", async () => {
    const api = await setup();
    const gate = deferred<unknown>();
    api.on("GET /api/today", () => gate.promise);
    midnightPasses();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(await screen.findByLabelText("Loading today")).toBeInTheDocument();
    expect(screen.queryByText("Yesterday's task")).not.toBeInTheDocument();
    await act(async () => gate.resolve(unplanned({ date: "2026-10-25" })));
    expect(await screen.findByRole("heading", { name: "Plan my day" })).toBeInTheDocument();
  });

  it("does not reload on focus or visibility changes while the date is unchanged", async () => {
    const api = await setup();
    act(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(30_000);
    });
    expect(api.to("GET /api/today")).toHaveLength(1);
    expect(screen.getByText("Yesterday's task")).toBeInTheDocument();
  });

  it("ignores a late answer for the old date", async () => {
    freezeNow("2026-10-24T21:59:00Z", { intervals: true });
    const slowOld = deferred<unknown>();
    mockApi({
      "GET /api/today": (call) => (call.query.get("date") === "2026-10-24" ? slowOld.promise : unplanned({ date: "2026-10-25" })),
      "GET /api/today/candidates": [],
    });
    render(<TodayView />);
    await screen.findByLabelText("Loading today");
    midnightPasses();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(await screen.findByRole("heading", { name: "Plan my day" })).toBeInTheDocument();
    // The old request finally answers.
    await act(async () => slowOld.resolve(planned("2026-10-24", "Yesterday's task")));
    expect(screen.queryByText("Yesterday's task")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Plan my day" })).toBeInTheDocument();
  });

  it("stops listening when unmounted", async () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const api = await setup();
    // render() was inside setup(); unmount through the DOM cleanup that RTL runs.
    const { cleanup } = await import("@testing-library/react");
    cleanup();
    expect(remove).toHaveBeenCalledWith("focus", expect.any(Function));
    midnightPasses();
    act(() => {
      window.dispatchEvent(new Event("focus"));
      vi.advanceTimersByTime(120_000);
    });
    expect(api.to("GET /api/today")).toHaveLength(1);
    expect(within(document.body).queryByText("Yesterday's task")).not.toBeInTheDocument();
  });
});
