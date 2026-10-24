// @vitest-environment jsdom
// The "Close the day" flow, rendered on its own with `fetch` mocked. The POST body
// is run through the real parseReviewPost so a client/server mismatch fails here.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TodayCompletedTask, TodayPayload, TodayTask } from "@/types";
import { MAX_REVIEW_TEXT, parseReviewPost } from "@/lib/frog/review";
import CloseDayFlow from "./CloseDayFlow";
import {
  DATE,
  GROUP_HOME,
  TZ,
  deferred,
  freezeNow,
  httpError,
  mockApi,
  payload,
  plan,
  task,
} from "../../tests/ui/fixtures";

const NOW = "2026-10-24T18:00:00Z"; // 20:00 in Europe/Berlin
const ATE_AT = "2026-10-24T07:42:00.000Z";

beforeEach(() => {
  freezeNow(NOW);
});

const done = (id: string, title: string, o: Partial<TodayCompletedTask> = {}): TodayCompletedTask => ({
  id,
  title,
  abcde: null,
  abcdeRank: null,
  completedAt: ATE_AT,
  group: { id: "g-work", name: "Work", color: "#7C6EF8" },
  ...o,
});
const open = (id: string, o: Partial<TodayTask> = {}) => task({ id, title: id.toUpperCase(), ...o });
const doneTask = (id: string, o: Partial<TodayTask> = {}) => task({ id, title: id.toUpperCase(), completedAt: ATE_AT, ...o });

/** The server's answer to a review: the day, closed. */
const closed = (p: TodayPayload): TodayPayload => ({ ...p, plan: { ...(p.plan ?? plan()), reviewedAt: "2026-10-24T18:00:00.000Z" } });

interface Setup {
  payload: TodayPayload;
  reply?: unknown;
}

function setup({ payload: p, reply }: Setup) {
  const api = mockApi({ "POST /api/today/review": reply ?? closed(p) });
  const onSaved = vi.fn();
  const onCancel = vi.fn();
  const user = userEvent.setup();
  const view = render(<CloseDayFlow payload={p} tz={TZ} onSaved={onSaved} onCancel={onCancel} />);
  return { api, onSaved, onCancel, user, ...view };
}

const stepper = () => within(screen.getByRole("list", { name: "Steps" })).getAllByRole("listitem");
const stepNames = () => stepper().map((li) => li.textContent);
const current = () => stepper().find((li) => li.getAttribute("aria-current") === "step")?.textContent;
const cont = () => screen.getByRole("button", { name: /continue/i });
const saveBtn = () => screen.getByRole("button", { name: /save and close the day|saving|try again/i });
const body = (api: ReturnType<typeof mockApi>) => api.to("POST /api/today/review").at(-1)!.body as Record<string, unknown>;

async function goTo(user: ReturnType<typeof userEvent.setup>, step: string) {
  for (let i = 0; i < 4 && current() !== step; i++) await user.click(cont());
  expect(current()).toBe(step);
}

// A day with three unfinished tasks, a frog and one done task.
const rich = () =>
  payload({
    tasks: [
      open("a", { abcde: "A", abcdeRank: 1 }),
      open("b", { abcde: "B" }),
      open("c"),
      doneTask("d", { abcde: "C" }),
    ],
    frogId: "a",
    completedToday: [done("d", "D", { abcde: "C" })],
    streak: { current: 2, longest: 5 },
  });

describe("CloseDayFlow: steps", () => {
  it("shows Done, Unfinished, Reflect and Frog when there are open tasks going to tomorrow", () => {
    setup({ payload: rich() });
    expect(stepNames()).toEqual(["1Done", "2Unfinished", "3Reflect", "4Frog"]);
    expect(current()).toBe("1Done");
    expect(screen.getByRole("heading", { name: "Close the day" })).toBeInTheDocument();
    expect(screen.getByText("Saturday, October 24")).toBeInTheDocument();
  });

  it("hides Unfinished and Frog when nothing is open, and says why", () => {
    setup({ payload: payload({ tasks: [doneTask("d")], completedToday: [done("d", "D")] }) });
    expect(stepNames()).toEqual(["1Done", "2Reflect"]);
    expect(screen.getByText(/nothing is left unfinished/i)).toBeInTheDocument();
  });

  it("hides Unfinished and Frog for a day with no tasks at all", () => {
    setup({ payload: payload({ tasks: [] }) });
    expect(stepNames()).toEqual(["1Done", "2Reflect"]);
  });

  it("the last step of a flow with nothing open is Reflect, with the Save button", async () => {
    const { user } = setup({ payload: payload({ tasks: [doneTask("d")], completedToday: [done("d", "D")] }) });
    expect(screen.queryByRole("button", { name: /save and close/i })).not.toBeInTheDocument();
    await user.click(cont());
    expect(current()).toBe("2Reflect");
    expect(saveBtn()).toHaveTextContent("Save and close the day");
    expect(screen.queryByRole("button", { name: /continue/i })).not.toBeInTheDocument();
  });

  it("the Frog step drops out of the stepper as soon as no task is going to tomorrow", async () => {
    const { user } = setup({ payload: rich() });
    await goTo(user, "2Unfinished");
    for (const t of ["A", "B", "C"]) {
      await user.click(within(screen.getByRole("radiogroup", { name: `What to do with ${t}` })).getByRole("radio", { name: "Backlog" }));
    }
    expect(stepNames()).toEqual(["Done", "2Unfinished", "3Reflect"]); // (the finished first step shows a check mark)
    await user.click(cont());
    expect(current()).toBe("3Reflect");
    expect(saveBtn()).toBeInTheDocument();
  });

  it("the stepper marks earlier steps done, the current one active, with a check mark", async () => {
    const { user } = setup({ payload: rich() });
    await user.click(cont());
    expect(current()).toBe("2Unfinished");
    // the first step swaps its number for a check icon
    expect(stepper()[0].textContent).toBe("Done");
    expect(stepper()[0].querySelector("svg")).not.toBeNull();
    expect(stepper().filter((li) => li.getAttribute("aria-current") === "step")).toHaveLength(1);
  });

  it("Back is hidden on the first step; Cancel is always there", async () => {
    const { user } = setup({ payload: rich() });
    expect(screen.queryByRole("button", { name: /back/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    await user.click(cont());
    expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("Back goes one step at a time and keeps what was chosen", async () => {
    const { user } = setup({ payload: rich() });
    await goTo(user, "2Unfinished");
    await user.click(within(screen.getByRole("radiogroup", { name: "What to do with B" })).getByRole("radio", { name: "Archive" }));
    await user.click(cont()); // Reflect
    await user.type(screen.getByLabelText("What went well?"), "Shipped");
    await user.click(screen.getByRole("radio", { name: /4 of 5/ }));
    await user.click(screen.getByRole("button", { name: /back/i }));
    expect(current()).toBe("2Unfinished");
    expect(within(screen.getByRole("radiogroup", { name: "What to do with B" })).getByRole("radio", { name: "Archive" })).toHaveAttribute("aria-checked", "true");
    await user.click(cont());
    expect(screen.getByLabelText("What went well?")).toHaveValue("Shipped");
    expect(screen.getByRole("radio", { name: /4 of 5/ })).toHaveAttribute("aria-checked", "true");
  });

  it("Cancel calls onCancel and sends nothing", async () => {
    const { user, onCancel, api } = setup({ payload: rich() });
    await goTo(user, "3Reflect");
    await user.type(screen.getByLabelText("What went well?"), "unsaved");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(api.calls).toHaveLength(0);
  });
});

describe("CloseDayFlow: Done today", () => {
  it("nothing completed, frog still open", () => {
    setup({ payload: payload({ tasks: [open("a")], frogId: "a" }) });
    expect(screen.getByText(/nothing got ticked off today, and the frog is still waiting/i)).toBeInTheDocument();
    expect(screen.getByText("0 tasks")).toBeInTheDocument();
    expect(screen.queryByText("D")).not.toBeInTheDocument(); // no done rows
  });

  it("nothing completed and no frog", () => {
    setup({ payload: payload({ tasks: [open("a")], plan: plan({ frogTaskId: null }) }) });
    expect(screen.getByText("Nothing got ticked off today. Tomorrow is a fresh start.")).toBeInTheDocument();
  });

  it("frog eaten: the celebration, the frog first with its emoji and an accessible 'Today's frog' label", () => {
    const frog = doneTask("f", { abcde: "A", abcdeRank: 1 });
    setup({
      payload: payload({ tasks: [frog, open("x")], frogId: "f", completedToday: [done("x", "Other"), done("f", "F", { abcde: "A", abcdeRank: 1 })] }),
    });
    expect(screen.getByText(/you ate the frog/i)).toBeInTheDocument();
    expect(screen.getByText("2 tasks")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem").filter((li) => li.className.includes("rounded-2xl"));
    expect(items[0]).toHaveTextContent("Today's frog: F");
    expect(items[0]).toHaveTextContent("🐸");
    expect(items[1]).toHaveTextContent("Other");
    expect(within(items[0]).getByText("A-1")).toBeInTheDocument();
    expect(within(items[0]).getByText("Work")).toBeInTheDocument();
  });

  it("frog not eaten but other tasks done", () => {
    setup({ payload: payload({ tasks: [open("a")], frogId: "a", completedToday: [done("x", "X"), done("y", "Y")] }) });
    expect(screen.getByText(/2 tasks done today\. The frog is still waiting/)).toBeInTheDocument();
  });

  it("one task done, no frog: singular copy", () => {
    setup({ payload: payload({ tasks: [], completedToday: [done("x", "X")] }) });
    expect(screen.getByText("1 task done today. Nicely done.")).toBeInTheDocument();
    expect(screen.getByText("1 task")).toBeInTheDocument();
  });

  it("an eliminated frog (archived, never eaten) reads as 'no frog'", () => {
    const frog = { ...open("f"), subtasks: [], archivedAt: "2026-10-24T10:00:00.000Z" };
    setup({ payload: payload({ tasks: [open("x")], plan: plan({ frogTaskId: "f" }), frog, completedToday: [done("y", "Y")] }) });
    expect(screen.getByText("1 task done today. Nicely done.")).toBeInTheDocument();
  });

  it("an eaten frog that was archived afterwards still counts as eaten", () => {
    const frog = { ...doneTask("f"), subtasks: [], archivedAt: "2026-10-24T17:00:00.000Z" };
    setup({ payload: payload({ tasks: [], plan: plan({ frogTaskId: "f" }), frog, completedToday: [done("f", "F")] }) });
    expect(screen.getByText(/you ate the frog/i)).toBeInTheDocument();
  });

  it("a frog finished on a later day than the plan's date is not eaten for this day", () => {
    const frog = { ...doneTask("f"), completedAt: "2026-10-26T09:00:00.000Z", subtasks: [] };
    setup({ payload: payload({ tasks: [open("x")], plan: plan({ frogTaskId: "f" }), frog }) });
    expect(screen.getByText(/the frog is still waiting/i)).toBeInTheDocument();
  });

  it("long titles wrap instead of overflowing (break-words) and the row can shrink (min-w-0)", () => {
    const long = "W".repeat(300);
    setup({ payload: payload({ tasks: [], completedToday: [done("x", long)] }) });
    const p = screen.getByText(long);
    expect(p.className).toContain("break-words");
    expect(p.parentElement!.className).toContain("min-w-0");
  });
});

describe("CloseDayFlow: Unfinished", () => {
  it("lists every open task (and no done one) with Tomorrow preselected", async () => {
    const { user } = setup({ payload: rich() });
    await goTo(user, "2Unfinished");
    expect(screen.getAllByRole("radiogroup").map((g) => g.getAttribute("aria-label"))).toEqual(["What to do with A", "What to do with B", "What to do with C"]);
    for (const g of screen.getAllByRole("radiogroup")) {
      expect(within(g).getAllByRole("radio").map((r) => [r.textContent, r.getAttribute("aria-checked")])).toEqual([
        ["Tomorrow", "true"],
        ["Backlog", "false"],
        ["Archive", "false"],
      ]);
    }
    expect(screen.queryByText("D")).not.toBeInTheDocument();
    expect(screen.getByText("3 to tomorrow, 0 to backlog, 0 to archive")).toBeInTheDocument();
  });

  it("shows each task's badge and project", async () => {
    const { user } = setup({ payload: payload({ tasks: [open("a", { abcde: "A", abcdeRank: 2, group: GROUP_HOME })] }) });
    await goTo(user, "2Unfinished");
    expect(screen.getByText("A-2")).toBeInTheDocument();
    expect(screen.getByText("Home")).toBeInTheDocument();
  });

  it("choosing updates the tally live", async () => {
    const { user } = setup({ payload: rich() });
    await goTo(user, "2Unfinished");
    await user.click(within(screen.getByRole("radiogroup", { name: "What to do with A" })).getByRole("radio", { name: "Backlog" }));
    await user.click(within(screen.getByRole("radiogroup", { name: "What to do with C" })).getByRole("radio", { name: "Archive" }));
    expect(screen.getByText("1 to tomorrow, 1 to backlog, 1 to archive")).toBeInTheDocument();
  });

  it("arrow keys move the choice within one task's group only", async () => {
    const { user } = setup({ payload: rich() });
    await goTo(user, "2Unfinished");
    const groupB = screen.getByRole("radiogroup", { name: "What to do with B" });
    within(groupB).getByRole("radio", { name: "Tomorrow" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(within(groupB).getByRole("radio", { name: "Backlog" })).toHaveFocus();
    expect(within(groupB).getByRole("radio", { name: "Backlog" })).toHaveAttribute("aria-checked", "true");
    await user.keyboard("{ArrowRight}{ArrowRight}"); // Archive, then wraps to Tomorrow
    expect(within(groupB).getByRole("radio", { name: "Tomorrow" })).toHaveFocus();
    // A and C untouched
    for (const t of ["A", "C"]) {
      expect(within(screen.getByRole("radiogroup", { name: `What to do with ${t}` })).getByRole("radio", { name: "Tomorrow" })).toHaveAttribute("aria-checked", "true");
    }
  });

  it("each group is a single tab stop", async () => {
    const { user } = setup({ payload: rich() });
    await goTo(user, "2Unfinished");
    await user.click(within(screen.getByRole("radiogroup", { name: "What to do with A" })).getByRole("radio", { name: "Archive" }));
    const stops = screen.getAllByRole("radio").filter((r) => r.getAttribute("tabindex") === "0").map((r) => r.textContent);
    expect(stops).toEqual(["Archive", "Tomorrow", "Tomorrow"]);
  });

  it("the choices have 3 columns that fit 375px (grid-cols-3, no fixed widths)", async () => {
    const { user } = setup({ payload: rich() });
    await goTo(user, "2Unfinished");
    const g = screen.getAllByRole("radiogroup")[0];
    expect(g.className).toContain("grid-cols-3");
    expect(g.outerHTML).not.toMatch(/w-\[\d+px\]|min-w-\[\d+/);
  });
});

describe("CloseDayFlow: Reflect", () => {
  async function toReflect(p = rich()) {
    const r = setup({ payload: p });
    await goTo(r.user, "3Reflect");
    return r;
  }

  it("has five rating radios with words, none chosen by default, one tab stop", async () => {
    await toReflect();
    const group = screen.getByRole("radiogroup", { name: "How did today go?" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("aria-label"))).toEqual(["1 of 5, Rough", "2 of 5, Meh", "3 of 5, Okay", "4 of 5, Good", "5 of 5, Great"]);
    expect(radios.filter((r) => r.getAttribute("aria-checked") === "true")).toHaveLength(0);
    expect(radios.filter((r) => r.getAttribute("tabindex") === "0")).toEqual([radios[0]]);
    expect(screen.queryByRole("button", { name: /clear rating/i })).not.toBeInTheDocument();
  });

  it("click picks a rating; arrow keys move it; the roving tab stop follows", async () => {
    const { user } = await toReflect();
    await user.click(screen.getByRole("radio", { name: /3 of 5/ }));
    expect(screen.getByRole("radio", { name: /3 of 5/ })).toHaveAttribute("aria-checked", "true");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: /4 of 5/ })).toHaveFocus();
    expect(screen.getByRole("radio", { name: /4 of 5/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /3 of 5/ })).toHaveAttribute("tabindex", "-1");
    await user.keyboard("{ArrowDown}{ArrowDown}"); // 5 then wrap to 1
    expect(screen.getByRole("radio", { name: /1 of 5/ })).toHaveFocus();
    await user.keyboard("{ArrowLeft}"); // wrap back to 5
    expect(screen.getByRole("radio", { name: /5 of 5/ })).toHaveAttribute("aria-checked", "true");
  });

  it("'Clear rating' appears once chosen and puts it back to nothing", async () => {
    const { user } = await toReflect();
    await user.click(screen.getByRole("radio", { name: /2 of 5/ }));
    await user.click(screen.getByRole("button", { name: /clear rating/i }));
    expect(within(screen.getByRole("radiogroup", { name: "How did today go?" })).queryAllByRole("radio", { checked: true })).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /clear rating/i })).not.toBeInTheDocument();
  });

  it("the two textareas are labelled, empty, 2000-capped and show a live counter", async () => {
    const { user } = await toReflect();
    const well = screen.getByLabelText("What went well?");
    const improve = screen.getByLabelText("What would you do differently tomorrow?");
    for (const el of [well, improve]) {
      expect(el.tagName).toBe("TEXTAREA");
      expect(el).toHaveValue("");
      expect(el).toHaveAttribute("maxlength", String(MAX_REVIEW_TEXT));
    }
    expect(screen.getAllByText("0 / 2000")).toHaveLength(2);
    await user.type(well, "abc");
    expect(screen.getByText("3 / 2000")).toBeInTheDocument();
    expect(screen.getByText("0 / 2000")).toBeInTheDocument();
  });

  it("typing stops at the 2000-character limit", async () => {
    const { user } = await toReflect();
    const well = screen.getByLabelText("What went well?");
    await user.click(well);
    await user.paste("x".repeat(2500));
    expect((well as HTMLTextAreaElement).value.length).toBeLessThanOrEqual(MAX_REVIEW_TEXT);
  });

  it("text over the limit (bypassing maxlength) shows an alert and blocks Save", async () => {
    // nothing open: Reflect is the second and last step
    const { user, api } = setup({ payload: payload({ tasks: [doneTask("d")], completedToday: [done("d", "D")] }) });
    await user.click(cont());
    const well = screen.getByLabelText("What went well?");
    fireEvent.change(well, { target: { value: "x".repeat(MAX_REVIEW_TEXT + 1) } });
    expect(screen.getByRole("alert")).toHaveTextContent(/at most 2000/);
    expect(saveBtn()).toBeDisabled();
    await user.click(saveBtn());
    expect(api.calls).toHaveLength(0);
    // fixing it re-enables Save
    fireEvent.change(well, { target: { value: "x".repeat(MAX_REVIEW_TEXT) } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(saveBtn()).toBeEnabled();
  });

  it("an over-long text blocks Continue to the Frog step too", async () => {
    const { user } = await toReflect();
    fireEvent.change(screen.getByLabelText("What would you do differently tomorrow?"), { target: { value: "y".repeat(MAX_REVIEW_TEXT + 5) } });
    expect(cont()).toBeDisabled();
    await user.click(cont());
    expect(current()).toBe("3Reflect");
  });

  it("padding doesn't count: 2000 characters plus trailing spaces is fine", async () => {
    await toReflect();
    fireEvent.change(screen.getByLabelText("What went well?"), { target: { value: `${"x".repeat(MAX_REVIEW_TEXT)}     ` } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(cont()).toBeEnabled();
  });

  it("is prefilled from the stored plan when the review is edited", () => {
    const p = payload({
      tasks: [doneTask("d")],
      completedToday: [done("d", "D")],
      plan: plan({ reviewedAt: "2026-10-24T18:00:00.000Z", rating: 4, wentWell: "Went fine", improve: "Start earlier" }),
    });
    const { user } = setup({ payload: p });
    expect(screen.getByRole("heading", { name: "Edit your review" })).toBeInTheDocument();
    return user.click(cont()).then(() => {
      expect(screen.getByRole("radio", { name: /4 of 5/ })).toHaveAttribute("aria-checked", "true");
      expect(screen.getByLabelText("What went well?")).toHaveValue("Went fine");
      expect(screen.getByLabelText("What would you do differently tomorrow?")).toHaveValue("Start earlier");
      expect(screen.getByRole("button", { name: /clear rating/i })).toBeInTheDocument();
    });
  });

  it("a plan with no reflection leaves the form empty", async () => {
    await toReflect(payload({ tasks: [open("a")], plan: plan({ rating: null, wentWell: null, improve: null }) }));
    expect(screen.getByLabelText("What went well?")).toHaveValue("");
  });
});

describe("CloseDayFlow: Tomorrow's frog", () => {
  async function toFrog(p = rich()) {
    const r = setup({ payload: p });
    await goTo(r.user, "4Frog");
    return r;
  }
  const frogRadios = () => within(screen.getByRole("radiogroup", { name: "Tomorrow's frog" })).getAllByRole("radio");

  it("offers only the tasks going to tomorrow, in list order, plus Skip; the first is preselected", async () => {
    await toFrog();
    expect(frogRadios().map((r) => r.textContent)).toEqual(["🐸AA-1Work", "BBWork", "CWork", "Skip: I'll choose tomorrow"]);
    expect(frogRadios().map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false", "false", "false"]);
    expect(screen.getByRole("heading", { name: /tomorrow's frog/i })).toBeInTheDocument();
  });

  it("tasks moved to the backlog or archive aren't offered", async () => {
    const { user } = setup({ payload: rich() });
    await goTo(user, "2Unfinished");
    await user.click(within(screen.getByRole("radiogroup", { name: "What to do with A" })).getByRole("radio", { name: "Backlog" }));
    await user.click(within(screen.getByRole("radiogroup", { name: "What to do with B" })).getByRole("radio", { name: "Archive" }));
    await goTo(user, "4Frog");
    expect(frogRadios().map((r) => r.textContent)).toEqual(["🐸CWork", "Skip: I'll choose tomorrow"]);
    expect(frogRadios()[0]).toHaveAttribute("aria-checked", "true"); // the suggestion follows the list
  });

  it("choosing another task or Skip is exclusive, with arrow-key support", async () => {
    const { user } = await toFrog();
    await user.click(frogRadios()[1]);
    expect(frogRadios().map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true", "false", "false"]);
    await user.keyboard("{ArrowDown}{ArrowDown}"); // C, then Skip
    expect(frogRadios()[3]).toHaveFocus();
    expect(frogRadios().map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "false", "false", "true"]);
    await user.keyboard("{ArrowDown}"); // wraps to A
    expect(frogRadios()[0]).toHaveAttribute("aria-checked", "true");
  });

  it("a pick that stops being a candidate falls back to the suggestion", async () => {
    const { user } = await toFrog();
    await user.click(frogRadios()[1]); // B
    await user.click(screen.getByRole("button", { name: /back/i })); // Reflect
    await user.click(screen.getByRole("button", { name: /back/i })); // Unfinished
    await user.click(within(screen.getByRole("radiogroup", { name: "What to do with B" })).getByRole("radio", { name: "Archive" }));
    await goTo(user, "4Frog");
    expect(frogRadios()[0]).toHaveAttribute("aria-checked", "true"); // A again
  });

  it("an explicit Skip stays Skip when the user goes back and forth", async () => {
    const { user } = await toFrog();
    await user.click(frogRadios()[3]);
    await user.click(screen.getByRole("button", { name: /back/i }));
    await user.click(cont());
    expect(frogRadios()[3]).toHaveAttribute("aria-checked", "true");
  });

  it("the last step shows Save and close the day, not Continue", async () => {
    await toFrog();
    expect(saveBtn()).toHaveTextContent("Save and close the day");
    expect(screen.queryByRole("button", { name: /continue/i })).not.toBeInTheDocument();
  });
});

describe("CloseDayFlow: saving", () => {
  it("POSTs a body the real server parser accepts, with every choice in it", async () => {
    const { user, api, onSaved } = setup({ payload: rich() });
    await goTo(user, "2Unfinished");
    await user.click(within(screen.getByRole("radiogroup", { name: "What to do with B" })).getByRole("radio", { name: "Backlog" }));
    await user.click(within(screen.getByRole("radiogroup", { name: "What to do with C" })).getByRole("radio", { name: "Backlog" }));
    await user.click(cont());
    await user.click(screen.getByRole("radio", { name: /5 of 5/ }));
    await user.type(screen.getByLabelText("What went well?"), "  Shipped the thing  ");
    await user.type(screen.getByLabelText("What would you do differently tomorrow?"), "Start earlier");
    await user.click(cont());
    await user.click(saveBtn());

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const [call] = api.to("POST /api/today/review");
    expect(call.method).toBe("POST");
    expect(call.body).toEqual({
      date: DATE,
      tz: TZ,
      moves: [
        { taskId: "a", action: "tomorrow" },
        { taskId: "b", action: "backlog" },
        { taskId: "c", action: "backlog" },
      ],
      wentWell: "Shipped the thing",
      improve: "Start earlier",
      rating: 5,
      tomorrowFrogTaskId: "a",
    });
    const parsed = parseReviewPost(call.body);
    expect(parsed.ok).toBe(true);
    // the server's payload is handed on as-is
    expect(onSaved.mock.calls[0][0].plan.reviewedAt).toBe("2026-10-24T18:00:00.000Z");
  });

  it("a day with nothing open sends no moves and no frog, but the reflection", async () => {
    const { user, api } = setup({ payload: payload({ tasks: [doneTask("d")], completedToday: [done("d", "D")] }) });
    await user.click(cont());
    await user.click(screen.getByRole("radio", { name: /3 of 5/ }));
    await user.click(saveBtn());
    await waitFor(() => expect(api.to("POST /api/today/review")).toHaveLength(1));
    expect(body(api)).toEqual({ date: DATE, tz: TZ, moves: [], wentWell: "", improve: "", rating: 3, tomorrowFrogTaskId: null });
    expect(parseReviewPost(body(api)).ok).toBe(true);
  });

  it("Skip sends tomorrowFrogTaskId null (leave tomorrow's plan alone)", async () => {
    const { user, api } = setup({ payload: rich() });
    await goTo(user, "4Frog");
    await user.click(screen.getByRole("radio", { name: /skip/i }));
    await user.click(saveBtn());
    await waitFor(() => expect(api.to("POST /api/today/review")).toHaveLength(1));
    expect(body(api).tomorrowFrogTaskId).toBeNull();
    expect((body(api).moves as unknown[]).length).toBe(3);
    expect(parseReviewPost(body(api)).ok).toBe(true);
  });

  it("without touching the frog step, the preselected first candidate is sent", async () => {
    const { user, api } = setup({ payload: rich() });
    await goTo(user, "4Frog");
    await user.click(saveBtn());
    await waitFor(() => expect(api.to("POST /api/today/review")).toHaveLength(1));
    expect(body(api).tomorrowFrogTaskId).toBe("a");
  });

  it("the frog the user picked is sent", async () => {
    const { user, api } = setup({ payload: rich() });
    await goTo(user, "4Frog");
    await user.click(screen.getByRole("radio", { name: /^B/ }));
    await user.click(saveBtn());
    await waitFor(() => expect(api.to("POST /api/today/review")).toHaveLength(1));
    expect(body(api).tomorrowFrogTaskId).toBe("b");
  });

  it("when everything goes to the backlog or archive, no frog is sent, and the body still validates", async () => {
    const { user, api } = setup({ payload: rich() });
    await goTo(user, "2Unfinished");
    for (const [t, a] of [["A", "Backlog"], ["B", "Backlog"], ["C", "Backlog"]]) {
      await user.click(within(screen.getByRole("radiogroup", { name: `What to do with ${t}` })).getByRole("radio", { name: a }));
    }
    await user.click(cont()); // Reflect, the last step
    await user.click(saveBtn());
    await waitFor(() => expect(api.to("POST /api/today/review")).toHaveLength(1));
    expect(body(api).tomorrowFrogTaskId).toBeNull();
    expect(parseReviewPost(body(api)).ok).toBe(true);
  });

  it("an edited review of a closed day keeps its stored reflection when the form isn't touched", async () => {
    const p = payload({
      tasks: [],
      plan: plan({ reviewedAt: "2026-10-24T18:00:00.000Z", rating: 2, wentWell: "Kept", improve: "Also kept" }),
    });
    const { user, api } = setup({ payload: p });
    await user.click(cont());
    await user.click(saveBtn());
    await waitFor(() => expect(api.to("POST /api/today/review")).toHaveLength(1));
    expect(body(api)).toMatchObject({ rating: 2, wentWell: "Kept", improve: "Also kept", moves: [], tomorrowFrogTaskId: null });
  });

  it("clearing the rating on an edit sends null (clear), and an emptied text sends '' (stored as null)", async () => {
    const p = payload({ tasks: [], plan: plan({ reviewedAt: "2026-10-24T18:00:00.000Z", rating: 2, wentWell: "Kept" }) });
    const { user, api } = setup({ payload: p });
    await user.click(cont());
    await user.click(screen.getByRole("button", { name: /clear rating/i }));
    await user.clear(screen.getByLabelText("What went well?"));
    await user.click(saveBtn());
    await waitFor(() => expect(api.to("POST /api/today/review")).toHaveLength(1));
    expect(body(api)).toMatchObject({ rating: null, wentWell: "" });
    const parsed = parseReviewPost(body(api));
    expect(parsed.ok && [parsed.value.rating, parsed.value.wentWell]).toEqual([null, null]);
  });

  it("sends the date of the payload (not 'now') and the tz it was given", async () => {
    freezeNow("2026-10-26T12:00:00Z"); // the clock has moved on, the payload is for the 24th
    const { user, api } = setup({ payload: payload({ tasks: [] }) });
    await user.click(cont());
    await user.click(saveBtn());
    await waitFor(() => expect(api.to("POST /api/today/review")).toHaveLength(1));
    expect(body(api)).toMatchObject({ date: DATE, tz: TZ });
  });

  describe("the archive confirmation", () => {
    async function toSave(archive: string[] = ["B"]) {
      const r = setup({ payload: rich() });
      await goTo(r.user, "2Unfinished");
      for (const t of archive) {
        await r.user.click(within(screen.getByRole("radiogroup", { name: `What to do with ${t}` })).getByRole("radio", { name: "Archive" }));
      }
      await goTo(r.user, "4Frog");
      return r;
    }

    it("is not asked when nothing is archived", async () => {
      const { user, api } = setup({ payload: rich() });
      await goTo(user, "4Frog");
      await user.click(saveBtn());
      expect(screen.queryByText(/^Archive \d/)).not.toBeInTheDocument();
      await waitFor(() => expect(api.to("POST /api/today/review")).toHaveLength(1));
    });

    it("is asked on Save, with the count, and nothing is sent until it is confirmed", async () => {
      const { user, api, onSaved } = await toSave(["B", "C"]);
      await user.click(saveBtn());
      expect(screen.getByText("Archive 2 tasks?")).toBeInTheDocument();
      expect(screen.getByText(/hidden from the board/i)).toBeInTheDocument();
      expect(api.calls).toHaveLength(0);
      await user.click(screen.getByRole("button", { name: "Archive and close" }));
      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(api.to("POST /api/today/review")).toHaveLength(1);
      expect(screen.queryByText("Archive 2 tasks?")).not.toBeInTheDocument();
    });

    it("says '1 task' for one", async () => {
      const { user } = await toSave(["B"]);
      await user.click(saveBtn());
      expect(screen.getByText("Archive 1 task?")).toBeInTheDocument();
    });

    it("Cancel and Escape dismiss it without saving, and the flow stays on its last step", async () => {
      const { user, api } = await toSave();
      await user.click(saveBtn());
      await user.click(within(screen.getByText("Archive 1 task?").closest("div.fixed") as HTMLElement).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByText("Archive 1 task?")).not.toBeInTheDocument();
      expect(current()).toBe("4Frog");
      await user.click(saveBtn());
      expect(screen.getByText("Archive 1 task?")).toBeInTheDocument();
      await user.keyboard("{Escape}");
      expect(screen.queryByText("Archive 1 task?")).not.toBeInTheDocument();
      expect(api.calls).toHaveLength(0);
    });

    it("is NOT asked again when retrying after a server error", async () => {
      const { user, api } = await toSave();
      api.on("POST /api/today/review", httpError(500, "Boom"));
      await user.click(saveBtn());
      await user.click(screen.getByRole("button", { name: "Archive and close" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Boom");
      expect(api.to("POST /api/today/review")).toHaveLength(1);

      api.on("POST /api/today/review", closed(rich()));
      await user.click(screen.getByRole("button", { name: "Try again" }));
      expect(screen.queryByText("Archive 1 task?")).not.toBeInTheDocument();
      await waitFor(() => expect(api.to("POST /api/today/review")).toHaveLength(2));
    });

    it("is asked again when the set of archived tasks changes after an error", async () => {
      const { user, api } = await toSave(["B"]);
      api.on("POST /api/today/review", httpError(500, "Boom"));
      await user.click(saveBtn());
      await user.click(screen.getByRole("button", { name: "Archive and close" }));
      await screen.findByRole("alert");
      // back to Unfinished, archive one more
      await user.click(screen.getByRole("button", { name: /back/i }));
      await user.click(screen.getByRole("button", { name: /back/i }));
      await user.click(within(screen.getByRole("radiogroup", { name: "What to do with C" })).getByRole("radio", { name: "Archive" }));
      await goTo(user, "4Frog");
      await user.click(saveBtn());
      expect(screen.getByText("Archive 2 tasks?")).toBeInTheDocument();
    });
  });

  describe("errors, retry and double submit", () => {
    it("shows the server's message inline with role=alert, keeps every choice, and offers Try again", async () => {
      const { user, api, onSaved } = setup({ payload: rich(), reply: httpError(404, "Not found") });
      await goTo(user, "3Reflect");
      await user.type(screen.getByLabelText("What went well?"), "Keep me");
      await goTo(user, "4Frog");
      await user.click(saveBtn());
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Not found");
      expect(onSaved).not.toHaveBeenCalled();
      expect(saveBtn()).toHaveTextContent("Try again");
      expect(saveBtn()).toBeEnabled();
      expect(current()).toBe("4Frog");

      api.on("POST /api/today/review", closed(rich()));
      await user.click(saveBtn());
      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
      expect(api.to("POST /api/today/review")).toHaveLength(2);
      expect(body(api).wentWell).toBe("Keep me");
      expect(body(api)).toEqual(api.to("POST /api/today/review")[0].body);
    });

    it("the error clears when a retry starts", async () => {
      const gate = deferred<unknown>();
      const { user, api } = setup({ payload: rich(), reply: httpError(500, "Boom") });
      await goTo(user, "4Frog");
      await user.click(saveBtn());
      await screen.findByRole("alert");
      api.on("POST /api/today/review", () => gate.promise);
      await user.click(saveBtn());
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      await act(async () => gate.resolve(closed(rich())));
    });

    it("a network failure shows its message; a non-JSON error body falls back to a generic one", async () => {
      const { user, api } = setup({ payload: rich() });
      await goTo(user, "4Frog");
      api.on("POST /api/today/review", () => {
        throw new Error("Failed to fetch");
      });
      await user.click(saveBtn());
      expect(await screen.findByRole("alert")).toHaveTextContent("Failed to fetch");
    });

    it("a long error message wraps (break-words)", async () => {
      const { user } = setup({ payload: rich(), reply: httpError(500, "E".repeat(400)) });
      await goTo(user, "4Frog");
      await user.click(saveBtn());
      expect((await screen.findByRole("alert")).className).toContain("break-words");
    });

    it("double submit: a second click while saving sends nothing and Back/Cancel are disabled", async () => {
      const gate = deferred<unknown>();
      const { user, api, onSaved, onCancel } = setup({ payload: rich(), reply: undefined });
      api.on("POST /api/today/review", () => gate.promise);
      await goTo(user, "4Frog");
      await user.click(saveBtn());
      expect(saveBtn()).toHaveTextContent("Saving…");
      expect(saveBtn()).toBeDisabled();
      await user.click(saveBtn());
      await user.dblClick(saveBtn());
      expect(screen.getByRole("button", { name: /back/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(onCancel).not.toHaveBeenCalled();
      expect(api.to("POST /api/today/review")).toHaveLength(1);
      await act(async () => gate.resolve(closed(rich())));
      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
      expect(api.to("POST /api/today/review")).toHaveLength(1);
    });

    it("two clicks in the same tick (before React re-renders) still send one request", async () => {
      const { user, api } = setup({ payload: rich() });
      await goTo(user, "4Frog");
      const btn = saveBtn();
      act(() => {
        btn.click();
        btn.click();
      });
      await waitFor(() => expect(api.to("POST /api/today/review")).toHaveLength(1));
    });

    it("double submit through the archive dialog: double-clicking the confirm sends one request", async () => {
      const { user, api } = setup({ payload: rich() });
      await goTo(user, "2Unfinished");
      await user.click(within(screen.getByRole("radiogroup", { name: "What to do with B" })).getByRole("radio", { name: "Archive" }));
      await goTo(user, "4Frog");
      await user.click(saveBtn());
      await user.dblClick(screen.getByRole("button", { name: "Archive and close" }));
      await waitFor(() => expect(api.to("POST /api/today/review")).toHaveLength(1));
      await new Promise((r) => setTimeout(r, 20));
      expect(api.to("POST /api/today/review")).toHaveLength(1);
    });

    it("can save again after a success if the flow is still mounted (the guard is released)", async () => {
      const { user, api } = setup({ payload: rich() });
      await goTo(user, "4Frog");
      await user.click(saveBtn());
      await waitFor(() => expect(api.to("POST /api/today/review")).toHaveLength(1));
      await user.click(saveBtn());
      await waitFor(() => expect(api.to("POST /api/today/review")).toHaveLength(2));
    });

    it("unmounting while the request is in flight doesn't throw or warn", async () => {
      const gate = deferred<unknown>();
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      const { user, api, unmount } = setup({ payload: rich() });
      api.on("POST /api/today/review", () => gate.promise);
      await goTo(user, "4Frog");
      await user.click(saveBtn());
      unmount();
      await act(async () => gate.reject(new Error("late failure")));
      expect(errors).not.toHaveBeenCalled();
    });
  });
});

describe("CloseDayFlow: markup", () => {
  it("has no horizontal-overflow traps at phone width: wrapping button row, truncating chips, no fixed widths", async () => {
    const { user, container } = setup({ payload: rich() });
    await goTo(user, "4Frog");
    const html = container.innerHTML;
    expect(html).not.toMatch(/\bw-\[\d{3,}px\]|min-w-\[\d{3,}/);
    expect(html).toContain("flex-wrap");
    expect(container.firstElementChild!.className).toContain("max-w-3xl");
  });

  it("the stepper doesn't wrap its labels into overlap: connectors shrink on phones (w-3 sm:w-8)", () => {
    const { container } = setup({ payload: rich() });
    expect(container.innerHTML).toContain("w-3 sm:w-8");
  });

  it("every control has an accessible name", async () => {
    const { user } = setup({ payload: rich() });
    for (let i = 0; i < 4; i++) {
      for (const b of screen.getAllByRole("button")) expect(b).toHaveAccessibleName();
      for (const r of screen.queryAllByRole("radio")) expect(r).toHaveAccessibleName();
      for (const r of screen.queryAllByRole("textbox")) expect(r).toHaveAccessibleName();
      if (current() === "4Frog") break;
      await user.click(cont());
    }
  });

  it("the page scrolls to the top of each new step (not on the first render)", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const { user } = setup({ payload: rich() });
    expect(scroll).not.toHaveBeenCalled();
    await user.click(cont());
    expect(scroll).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: /back/i }));
    expect(scroll).toHaveBeenCalledTimes(2);
    // @ts-expect-error cleanup of the jsdom stub
    delete Element.prototype.scrollIntoView;
  });
});

describe("CloseDayFlow: payload changes while open", () => {
  it("a refreshed payload (same tasks) keeps the user's choices", async () => {
    const p = rich();
    const { user, rerender, onSaved, onCancel } = setup({ payload: p });
    await goTo(user, "2Unfinished");
    await user.click(within(screen.getByRole("radiogroup", { name: "What to do with B" })).getByRole("radio", { name: "Archive" }));
    rerender(<CloseDayFlow payload={{ ...p, tasks: p.tasks.map((t) => ({ ...t })), streak: { current: 3, longest: 5 } }} tz={TZ} onSaved={onSaved} onCancel={onCancel} />);
    expect(within(screen.getByRole("radiogroup", { name: "What to do with B" })).getByRole("radio", { name: "Archive" })).toHaveAttribute("aria-checked", "true");
    expect(current()).toBe("2Unfinished");
  });

  it("a task that was finished elsewhere while the flow is open disappears from Unfinished and from the body", async () => {
    const p = rich();
    const { user, rerender, onSaved, onCancel, api } = setup({ payload: p });
    await goTo(user, "2Unfinished");
    const finished = { ...p, tasks: p.tasks.map((t) => (t.id === "c" ? { ...t, completedAt: ATE_AT } : t)), completedToday: [...p.completedToday, done("c", "C")] };
    rerender(<CloseDayFlow payload={finished} tz={TZ} onSaved={onSaved} onCancel={onCancel} />);
    expect(screen.queryByRole("radiogroup", { name: "What to do with C" })).not.toBeInTheDocument();
    await goTo(user, "4Frog");
    await user.click(saveBtn());
    await waitFor(() => expect(api.to("POST /api/today/review")).toHaveLength(1));
    expect((body(api).moves as { taskId: string }[]).map((m) => m.taskId)).toEqual(["a", "b"]);
  });

  it("if every open task is finished while on the Unfinished step, the flow doesn't get stuck on a missing step", async () => {
    const p = rich();
    const { user, rerender, onSaved, onCancel } = setup({ payload: p });
    await goTo(user, "2Unfinished");
    const allDone = { ...p, tasks: p.tasks.map((t) => ({ ...t, completedAt: ATE_AT })) };
    rerender(<CloseDayFlow payload={allDone} tz={TZ} onSaved={onSaved} onCancel={onCancel} />);
    // the Unfinished step no longer exists; some step is shown and the stepper has an active step
    expect(stepper().filter((li) => li.getAttribute("aria-current") === "step")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /continue|save and close/i })).toBeInTheDocument();
  });
});
