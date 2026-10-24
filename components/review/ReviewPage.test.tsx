// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import ReviewPage from "./ReviewPage";
import ReviewNudge from "./ReviewNudge";
import type { ReviewData } from "./api";
import { freezeNow, httpError, mockApi, type Api } from "../../tests/ui/fixtures";

// Saturday 24 October 2026: the week under review is Mon 19 Oct, next week starts Mon 26 Oct.
const WEEK = "2026-10-19";
const NEXT_DATES = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"];
const WORK = { id: "g-work", name: "Work", color: "#7C6EF8" };
const HOME = { id: "g-home", name: "Home", color: "#34D399" };

function data(o: Partial<ReviewData> = {}): ReviewData {
  return {
    weekStart: WEEK,
    weekEnd: "2026-10-25",
    nextWeekStart: "2026-10-26",
    review: null,
    stats: {
      tasksDone: 3,
      frogs: {
        planned: 2,
        eaten: 1,
        days: ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"].map((date, i) => ({
          date, planned: i < 2, eaten: i === 0, title: i < 2 ? `Frog ${i}` : null,
        })),
      },
      focusSec: 2 * 3600 + 25 * 60,
      focusSessions: 6,
      habits: { scheduled: 10, done: 7 },
      avgRating: 3.5,
      ratedDays: 2,
    },
    done: [
      { id: "d1", title: "Ship the report", completedAt: "2026-10-20T10:00:00Z", group: WORK },
      { id: "d2", title: "Fix the tap", completedAt: "2026-10-21T10:00:00Z", group: HOME },
    ],
    dailyNotes: [{ date: "2026-10-19", wentWell: "Got focus time", improve: "Start earlier", rating: 4 }],
    slipped: [
      { id: "s1", title: "Call the bank", dueDate: "2026-10-21T09:00:00Z", plannedFor: null, abcde: null, abcdeRank: null, time: "09:00", group: HOME },
      { id: "s2", title: "Write spec", dueDate: null, plannedFor: "2026-10-22", abcde: "A", abcdeRank: 1, time: null, group: WORK },
    ],
    nextWeek: { dates: NEXT_DATES, frogs: Object.fromEntries(NEXT_DATES.map((d) => [d, null])) },
    candidates: [
      { id: "c1", title: "Plan launch", abcde: null, abcdeRank: null, group: WORK },
      { id: "c2", title: "Book flights", abcde: null, abcdeRank: null, group: HOME },
    ],
    ...o,
  };
}

let api: Api;
beforeEach(() => {
  freezeNow("2026-10-24T08:00:00Z");
});

function setup(d: ReviewData = data(), extra: Record<string, unknown> = {}) {
  api = mockApi({ "GET /api/review": d, "POST /api/review": { ok: true }, ...extra });
  render(<ReviewPage />);
}

describe("ReviewPage", () => {
  it("loads the week under review: this week when it is Saturday", async () => {
    setup();
    await screen.findByText("Ship the report");
    const call = api.to("GET /api/review")[0];
    expect(call.query.get("weekStart")).toBe(WEEK);
    expect(call.query.get("today")).toBe("2026-10-24");
    expect(call.query.get("tz")).toBe("Europe/Berlin");
    expect(screen.getByText(/Week of 19 Oct \(this week\)/)).toBeInTheDocument();
  });

  it("shows the week in numbers", async () => {
    setup();
    await screen.findByText("Ship the report");
    const tiles = screen.getByRole("region", { name: "The week in numbers" });
    expect(within(tiles).getByText("Tasks done").nextSibling).toHaveTextContent("3");
    expect(within(tiles).getByText("Frogs eaten").nextSibling).toHaveTextContent("1 of 2");
    expect(within(tiles).getByText("Focus time").nextSibling).toHaveTextContent("2h 25m");
    expect(within(tiles).getByText("Habits").nextSibling).toHaveTextContent("70%");
    expect(within(tiles).getByText("Average day").nextSibling).toHaveTextContent("3.5 of 5");
  });

  it("falls back gracefully with no habits or ratings", async () => {
    setup(data({ stats: { ...data().stats, habits: null, avgRating: null, ratedDays: 0, focusSessions: 0, focusSec: 0 } }));
    await screen.findByText("Ship the report");
    const tiles = screen.getByRole("region", { name: "The week in numbers" });
    expect(within(tiles).getByText("Habits").nextSibling).toHaveTextContent("None");
    expect(within(tiles).getByText("Average day").nextSibling).toHaveTextContent("None");
    expect(within(tiles).getByText("Focus time").nextSibling).toHaveTextContent("0m");
  });

  it("groups what got done by project and shows the daily notes", async () => {
    setup();
    await screen.findByText("Ship the report");
    expect(screen.getByText("Fix the tap")).toBeInTheDocument();
    expect(screen.getByText("Got focus time")).toBeInTheDocument();
    expect(screen.getByText("Start earlier")).toBeInTheDocument();
  });

  it("collapses a long done list to 10 until you ask for more", async () => {
    const done = Array.from({ length: 14 }, (_, i) => ({ id: `d${i}`, title: `Done ${i}`, completedAt: "2026-10-20T10:00:00Z", group: WORK }));
    setup(data({ done }));
    const user = userEvent.setup();
    await screen.findByText("Done 0");
    expect(screen.queryByText("Done 13")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show all 14" }));
    expect(screen.getByText("Done 13")).toBeInTheDocument();
  });

  it("with nothing slipped it says so", async () => {
    setup(data({ slipped: [] }));
    expect(await screen.findByText(/nothing slipped/i)).toBeInTheDocument();
  });

  it("saves the moves, the reflection and the frogs in one request", async () => {
    setup();
    const user = userEvent.setup();
    await screen.findByText("Call the bank");

    const bank = screen.getByRole("radiogroup", { name: "What to do with Call the bank" });
    await user.click(within(bank).getByRole("radio", { name: "Next week" }));
    const spec = screen.getByRole("radiogroup", { name: "What to do with Write spec" });
    await user.click(within(spec).getByRole("radio", { name: "Archive" }));

    await user.click(screen.getByRole("radio", { name: "4 of 5, Good" }));
    await user.type(screen.getByLabelText("Biggest win"), "Shipped it");
    await user.type(screen.getByLabelText("What got in the way"), "Meetings");
    await user.type(screen.getByLabelText("One focus for next week"), "Launch");

    await user.selectOptions(screen.getByLabelText("Mon 26 Oct"), "c1");
    await user.selectOptions(screen.getByLabelText("Tue 27 Oct"), "c2");

    await user.click(screen.getByRole("button", { name: "Save review" }));
    await waitFor(() => expect(api.to("POST /api/review")).toHaveLength(1));
    const body = api.to("POST /api/review")[0].body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(body).toMatchObject({
      weekStart: WEEK, today: "2026-10-24", tz: "Europe/Berlin",
      moves: [{ taskId: "s1", action: "nextWeek" }, { taskId: "s2", action: "archive" }],
      win: "Shipped it", obstacle: "Meetings", focus: "Launch", rating: 4,
    });
    expect(body.frogs).toEqual([
      { date: "2026-10-26", taskId: "c1" },
      { date: "2026-10-27", taskId: "c2" },
      ...NEXT_DATES.slice(2).map((date) => ({ date, taskId: null })),
    ]);
  });

  it("does not send tasks you left on Keep", async () => {
    setup();
    const user = userEvent.setup();
    await screen.findByText("Call the bank");
    await user.click(screen.getByRole("button", { name: "Save review" }));
    await waitFor(() => expect(api.to("POST /api/review")).toHaveLength(1));
    expect((api.to("POST /api/review")[0].body as { moves: unknown[] }).moves).toEqual([]);
  });

  it("a task picked as one day's frog is not offered on the other days", async () => {
    setup();
    const user = userEvent.setup();
    await screen.findByText("Call the bank");
    await user.selectOptions(screen.getByLabelText("Mon 26 Oct"), "c1");
    const tuesday = screen.getByLabelText("Tue 27 Oct");
    expect(within(tuesday).queryByRole("option", { name: "Plan launch" })).not.toBeInTheDocument();
    expect(within(tuesday).getByRole("option", { name: "Book flights" })).toBeInTheDocument();
    // and the day that picked it still shows it
    expect(within(screen.getByLabelText("Mon 26 Oct")).getByRole("option", { name: "Plan launch" })).toBeInTheDocument();
  });

  it("starts from a frog already set for next week, even if it is missing from the pick list", async () => {
    const frogs = Object.fromEntries(NEXT_DATES.map((d) => [d, null])) as ReviewData["nextWeek"]["frogs"];
    frogs["2026-10-28"] = { id: "x9", title: "Already chosen", planned: true };
    setup(data({ nextWeek: { dates: NEXT_DATES, frogs } }));
    await screen.findByText("Call the bank");
    expect(screen.getByLabelText("Wed 28 Oct")).toHaveValue("x9");
    expect(screen.getByText("Day already planned")).toBeInTheDocument();
  });

  it("shows the saved summary with an Edit button once reviewed, and Edit brings the form back with the old answers", async () => {
    setup(data({
      review: { win: "Big win", obstacle: null, focus: "Ship v2", rating: 5, reviewedAt: "2026-10-24T09:00:00Z" },
      nextWeek: { dates: NEXT_DATES, frogs: { ...Object.fromEntries(NEXT_DATES.map((d) => [d, null])), "2026-10-26": { id: "c1", title: "Plan launch", planned: false } } as ReviewData["nextWeek"]["frogs"] },
    }));
    const user = userEvent.setup();
    expect(await screen.findByText(/Review saved · 1 frog set for next week/)).toBeInTheDocument();
    expect(screen.getByText(/Focus for next week/)).toHaveTextContent("Ship v2");
    expect(screen.queryByRole("button", { name: "Save review" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit review" }));
    expect(screen.getByLabelText("Biggest win")).toHaveValue("Big win");
    expect(screen.getByRole("radio", { name: "5 of 5, Great" })).toBeChecked();
    expect(screen.getByLabelText("Mon 26 Oct")).toHaveValue("c1");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText(/Review saved/)).toBeInTheDocument();
  });

  it("shows the server's message when saving fails, keeps the form, and lets you try again", async () => {
    setup(data(), { "POST /api/review": httpError(400, "A task can not be a frog and also go to the backlog or archive") });
    const user = userEvent.setup();
    await screen.findByText("Call the bank");
    await user.type(screen.getByLabelText("Biggest win"), "Mine");
    await user.click(screen.getByRole("button", { name: "Save review" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("can not be a frog");
    expect(screen.getByLabelText("Biggest win")).toHaveValue("Mine");
    expect(screen.getByRole("button", { name: "Save review" })).toBeEnabled();
  });

  it("a failed load shows the error with a retry", async () => {
    setup(data(), { "GET /api/review": httpError(500, "Review is down") });
    const user = userEvent.setup();
    expect(await screen.findByRole("alert")).toHaveTextContent("Review is down");
    api.on("GET /api/review", data());
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Ship the report")).toBeInTheDocument();
  });

  it("goes back a week, and cannot go past the current one", async () => {
    setup();
    const user = userEvent.setup();
    await screen.findByText("Ship the report");
    expect(screen.getByRole("button", { name: "Next week" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Previous week" }));
    await waitFor(() => expect(api.to("GET /api/review")).toHaveLength(2));
    expect(api.to("GET /api/review")[1].query.get("weekStart")).toBe("2026-10-12");
    expect(await screen.findByText(/Week of 12 Oct/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next week" })).toBeEnabled();
  });

  it("on a Wednesday it reviews the week that just ended", async () => {
    freezeNow("2026-10-21T08:00:00Z");
    setup(data({ weekStart: "2026-10-12" }));
    await screen.findByText("Call the bank");
    expect(api.to("GET /api/review")[0].query.get("weekStart")).toBe("2026-10-12");
  });

  it("the rating group supports arrow keys", async () => {
    setup();
    const user = userEvent.setup();
    await screen.findByText("Call the bank");
    await user.click(screen.getByRole("radio", { name: "2 of 5, Meh" }));
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "3 of 5, Okay" })).toBeChecked();
  });
});

describe("ReviewNudge (on Today)", () => {
  function nudge(status: Record<string, unknown>) {
    api = mockApi({ "GET /api/review/status": { weekStart: WEEK, nudge: false, thisWeekFocus: null, ...status } });
    render(<ReviewNudge />);
  }

  it("always links to the review", async () => {
    nudge({});
    expect(await screen.findByRole("link", { name: /weekly review/i })).toHaveAttribute("href", "/review");
  });

  it("says the review is due on review days", async () => {
    nudge({ nudge: true });
    expect(await screen.findByText(/your weekly review is due/i)).toBeInTheDocument();
  });

  it("shows last week's one focus", async () => {
    nudge({ thisWeekFocus: "Ship v2" });
    expect(await screen.findByText("Ship v2")).toBeInTheDocument();
    expect(screen.getByText(/this week:/i)).toBeInTheDocument();
  });

  it("still shows the link when the status cannot be loaded", async () => {
    api = mockApi({ "GET /api/review/status": httpError(500, "nope") });
    render(<ReviewNudge />);
    expect(await screen.findByRole("link", { name: /weekly review/i })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("sends today's date", async () => {
    nudge({});
    await screen.findByRole("link");
    expect(api.to("GET /api/review/status")[0].query.get("today")).toBe("2026-10-24");
  });
});
