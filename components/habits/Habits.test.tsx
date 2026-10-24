// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import HabitsCard from "./HabitsCard";
import HabitsPage from "./HabitsPage";
import type { HabitDTO } from "./api";
import { freezeNow, httpError, mockApi, type Api } from "../../tests/ui/fixtures";

// Saturday 24 October 2026
const TODAY = "2026-10-24";

function habit(o: Partial<HabitDTO> & { id: string; name: string }): HabitDTO {
  return {
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    order: 0,
    createdKey: "2026-09-01",
    checks: [],
    streak: { current: 0, longest: 0 },
    rate: { scheduled: 0, done: 0 },
    scheduledToday: true,
    ...o,
  };
}

let api: Api;
beforeEach(() => {
  freezeNow("2026-10-24T08:00:00Z");
});

describe("HabitsCard (on Today)", () => {
  function setup(habits: HabitDTO[], extra: Record<string, unknown> = {}) {
    api = mockApi({
      "GET /api/habits": { habits, archived: [] },
      "PUT /api/habits/h1/checks/2026-10-24": { ok: true },
      "DELETE /api/habits/h1/checks/2026-10-24": { ok: true },
      ...extra,
    });
    render(<HabitsCard />);
  }

  it("lists the habits scheduled today and counts the ticked ones", async () => {
    setup([
      habit({ id: "h1", name: "Read", checks: [TODAY], streak: { current: 4, longest: 9 } }),
      habit({ id: "h2", name: "Run" }),
      habit({ id: "h3", name: "Weekday only", weekdays: [1, 2, 3, 4, 5], scheduledToday: false }),
    ]);
    expect(await screen.findByRole("checkbox", { name: "Read, today" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Run, today" })).not.toBeChecked();
    expect(screen.queryByText("Weekday only")).not.toBeInTheDocument();
    expect(screen.getByText("1 of 2 today")).toBeInTheDocument();
    expect(screen.getByLabelText("4-day streak")).toHaveTextContent("4");
  });

  it("asks for today's date and zone", async () => {
    setup([habit({ id: "h1", name: "Read" })]);
    await screen.findByText("Read");
    const call = api.to("GET /api/habits")[0];
    expect(call.query.get("today")).toBe(TODAY);
    expect(call.query.get("tz")).toBe("Europe/Berlin");
  });

  it("ticking is instant and saves for today; unticking does the reverse", async () => {
    // A small stand-in server, so the refresh after each save agrees with it.
    let ticked = false;
    setup([], {
      "GET /api/habits": () => ({ habits: [habit({ id: "h1", name: "Read", checks: ticked ? [TODAY] : [] })], archived: [] }),
      "PUT /api/habits/h1/checks/2026-10-24": () => { ticked = true; return { ok: true }; },
      "DELETE /api/habits/h1/checks/2026-10-24": () => { ticked = false; return { ok: true }; },
    });
    const user = userEvent.setup();
    const box = await screen.findByRole("checkbox", { name: "Read, today" });
    await user.click(box);
    expect(box).toBeChecked();
    await waitFor(() => expect(api.to("PUT /api/habits/h1/checks/2026-10-24")).toHaveLength(1));
    expect(api.to("PUT /api/habits/h1/checks/2026-10-24")[0].query.get("today")).toBe(TODAY);
    await waitFor(() => expect(api.to("GET /api/habits")).toHaveLength(2)); // refreshed
    expect(screen.getByRole("checkbox", { name: "Read, today" })).toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: "Read, today" }));
    await waitFor(() => expect(api.to("DELETE /api/habits/h1/checks/2026-10-24")).toHaveLength(1));
  });

  it("puts the tick back and says why when saving fails", async () => {
    setup([habit({ id: "h1", name: "Read" })], { "PUT /api/habits/h1/checks/2026-10-24": httpError(500, "Couldn't save that tick") });
    const user = userEvent.setup();
    const box = await screen.findByRole("checkbox", { name: "Read, today" });
    await user.click(box);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save that tick");
    expect(box).not.toBeChecked();
  });

  it("with no habits it points to the habits page", async () => {
    setup([]);
    expect(await screen.findByRole("link", { name: /track a daily habit/i })).toHaveAttribute("href", "/habits");
  });

  it("when none are scheduled today it says so", async () => {
    setup([habit({ id: "h3", name: "Weekdays", weekdays: [1], scheduledToday: false })]);
    expect(await screen.findByText(/none of your habits are scheduled today/i)).toBeInTheDocument();
  });

  it("a failed load shows the error with a retry", async () => {
    setup([], { "GET /api/habits": httpError(500, "Habits are down") });
    const user = userEvent.setup();
    expect(await screen.findByRole("alert")).toHaveTextContent("Habits are down");
    api.on("GET /api/habits", { habits: [habit({ id: "h1", name: "Read" })], archived: [] });
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Read")).toBeInTheDocument();
  });

  it("links to the manage page", async () => {
    setup([habit({ id: "h1", name: "Read" })]);
    expect(await screen.findByRole("link", { name: "Manage" })).toHaveAttribute("href", "/habits");
  });
});

describe("HabitsPage", () => {
  function setup(habits: HabitDTO[], archived: { id: string; name: string; weekdays: number[] }[] = [], extra: Record<string, unknown> = {}) {
    api = mockApi({
      "GET /api/habits": { habits, archived },
      "POST /api/habits": { id: "new" },
      "PATCH /api/habits/h1": { id: "h1" },
      "DELETE /api/habits/h1": { ok: true },
      "PUT /api/habits/h1/checks/2026-10-20": { ok: true },
      ...extra,
    });
    render(<HabitsPage />);
  }

  it("shows each habit with its streaks and completion", async () => {
    setup([habit({ id: "h1", name: "Read", streak: { current: 12, longest: 30 }, rate: { scheduled: 20, done: 15 } })]);
    expect(await screen.findByText("Read")).toBeInTheDocument();
    expect(screen.getByText("12", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText("30", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText(/75% of scheduled days \(15 of 20\)/)).toBeInTheDocument();
  });

  it("draws five weeks, Monday first, with days after today disabled", async () => {
    setup([habit({ id: "h1", name: "Read", checks: ["2026-10-20"] })]);
    const grid = await screen.findByRole("group", { name: "Last five weeks" });
    const cells = within(grid).getAllByRole("checkbox");
    expect(cells).toHaveLength(35);
    expect(cells[0]).toHaveAccessibleName(/Mon 21 Sep/);
    expect(cells[34]).toHaveAccessibleName(/Sun 25 Oct/);
    expect(cells[34]).toBeDisabled(); // tomorrow
    expect(cells[33]).not.toBeDisabled(); // today
    expect(within(grid).getByRole("checkbox", { name: /Tue 20 Oct: done/ })).toBeChecked();
  });

  it("ticks a past day", async () => {
    setup([habit({ id: "h1", name: "Read" })]);
    const user = userEvent.setup();
    const grid = await screen.findByRole("group", { name: "Last five weeks" });
    await user.click(within(grid).getByRole("checkbox", { name: /Tue 20 Oct/ }));
    await waitFor(() => expect(api.to("PUT /api/habits/h1/checks/2026-10-20")).toHaveLength(1));
  });

  it("adds a habit with the chosen weekdays", async () => {
    setup([]);
    const user = userEvent.setup();
    await user.type(await screen.findByRole("textbox", { name: "New habit" }), "Walk");
    const form = screen.getByRole("textbox", { name: "New habit" }).closest("form")!;
    await user.click(within(form).getByRole("button", { name: "Saturday" })); // toggle off
    await user.click(within(form).getByRole("button", { name: "Sunday" })); // toggle off
    await user.click(within(form).getByRole("button", { name: "Add habit" }));
    await waitFor(() => expect(api.to("POST /api/habits")).toHaveLength(1));
    expect(api.to("POST /api/habits")[0].body).toEqual({ name: "Walk", weekdays: [1, 2, 3, 4, 5] });
    expect(screen.getByRole("textbox", { name: "New habit" })).toHaveValue("");
  });

  it("will not add a blank habit", async () => {
    setup([]);
    await screen.findByRole("textbox", { name: "New habit" });
    expect(screen.getByRole("button", { name: "Add habit" })).toBeDisabled();
  });

  it("at least one weekday always stays on", async () => {
    setup([habit({ id: "h1", name: "Read", weekdays: [3] })]);
    const user = userEvent.setup();
    const card = (await screen.findByText("Read")).closest("li")!;
    await user.click(within(card).getByRole("button", { name: "Wednesday" }));
    expect(api.to("PATCH /api/habits/h1")).toHaveLength(0);
    await user.click(within(card).getByRole("button", { name: "Friday" }));
    await waitFor(() => expect(api.to("PATCH /api/habits/h1")).toHaveLength(1));
    expect(api.to("PATCH /api/habits/h1")[0].body).toEqual({ weekdays: [3, 5] });
  });

  it("renames a habit when you click its name and press Enter", async () => {
    setup([habit({ id: "h1", name: "Read" })]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Read" }));
    const input = screen.getByRole("textbox", { name: "Habit name" });
    await user.clear(input);
    await user.type(input, "Read 20 pages{Enter}");
    await waitFor(() => expect(api.to("PATCH /api/habits/h1")).toHaveLength(1));
    expect(api.to("PATCH /api/habits/h1")[0].body).toEqual({ name: "Read 20 pages" });
  });

  it("Escape cancels a rename", async () => {
    setup([habit({ id: "h1", name: "Read" })]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Read" }));
    await user.type(screen.getByRole("textbox", { name: "Habit name" }), "xyz{Escape}");
    expect(api.to("PATCH /api/habits/h1")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Read" })).toBeInTheDocument();
  });

  it("archives with one click", async () => {
    setup([habit({ id: "h1", name: "Read" })]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Archive Read" }));
    await waitFor(() => expect(api.to("PATCH /api/habits/h1")).toHaveLength(1));
    expect(api.to("PATCH /api/habits/h1")[0].body).toEqual({ archived: true });
  });

  it("asks before deleting, and does not delete if you cancel", async () => {
    setup([habit({ id: "h1", name: "Read" })]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Delete Read" }));
    expect(screen.getByText("Delete habit?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(api.to("DELETE /api/habits/h1")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Delete Read" }));
    await user.click(screen.getByRole("button", { name: "Delete habit" }));
    await waitFor(() => expect(api.to("DELETE /api/habits/h1")).toHaveLength(1));
  });

  it("restores an archived habit", async () => {
    setup([], [{ id: "h1", name: "Old habit", weekdays: [1] }]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /archived/i }));
    await user.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(api.to("PATCH /api/habits/h1")).toHaveLength(1));
    expect(api.to("PATCH /api/habits/h1")[0].body).toEqual({ archived: false });
  });

  it("shows the server's message when something fails, and lets you dismiss it", async () => {
    setup([], [], { "POST /api/habits": httpError(400, "You can track up to 20 habits. Archive one first.") });
    const user = userEvent.setup();
    await user.type(await screen.findByRole("textbox", { name: "New habit" }), "One more");
    await user.click(screen.getByRole("button", { name: "Add habit" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("up to 20 habits");
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("empty state", async () => {
    setup([]);
    expect(await screen.findByText(/no habits yet/i)).toBeInTheDocument();
  });
});
