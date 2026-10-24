// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import FrogSection from "./FrogSection";
import type { FrogReflection, FrogReport } from "@/lib/frog/reports";
import { DATE, TZ, deferred, freezeNow, httpError, mockApi } from "../../tests/ui/fixtures";

const NOW = "2026-10-24T08:00:00Z"; // 10:00 on 2026-10-24 in Europe/Berlin
const KEY = "GET /api/reports/frog";

const shift = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const strip = (n: number, f: (date: string, i: number) => { planned?: boolean; eaten?: boolean; beforeNoon?: boolean } = () => ({})) =>
  Array.from({ length: n }, (_, i) => {
    const date = shift(DATE, -(n - 1 - i));
    const o = f(date, i);
    return { date, planned: !!(o.planned || o.eaten), eaten: !!o.eaten, beforeNoon: !!o.beforeNoon };
  });

const reflection = (i: number, o: Partial<FrogReflection> = {}): FrogReflection => ({
  date: shift(DATE, -i),
  rating: 3,
  wentWell: `went well ${i}`,
  improve: `improve ${i}`,
  frogTitle: `Frog ${i}`,
  eaten: true,
  ...o,
});

function report(o: Partial<FrogReport> = {}): FrogReport {
  return {
    stats: { plannedDays: 7, eatenDays: 5, eatenRate: 5 / 7, beforeNoonRate: 0.6, current: 3, longest: 4 },
    daily: strip(7, (_d, i) => (i === 0 ? {} : i === 1 ? { planned: true } : i < 5 ? { eaten: true, beforeNoon: true } : { eaten: true })),
    abcdeCompleted: { A: 4, B: 2, C: 1, D: 0, E: 0, none: 3 },
    reflections: [reflection(1)],
    ...o,
  };
}

const empty = (days = 7): FrogReport => ({
  stats: { plannedDays: 0, eatenDays: 0, eatenRate: 0, beforeNoonRate: 0, current: 0, longest: 0 },
  daily: strip(days),
  abcdeCompleted: { A: 0, B: 0, C: 0, D: 0, E: 0, none: 0 },
  reflections: [],
});

const CELL = /: (eaten before noon|eaten|planned, not eaten|no plan)$/;
const cells = () => screen.getAllByRole("img").filter((el) => CELL.test(el.getAttribute("aria-label") ?? ""));
const tile = (label: string) => screen.getByText(label, { selector: "span" }).closest("div.rounded-2xl") as HTMLElement;

async function renderLoaded(r: FrogReport = report(), props: { days?: number | "all"; projectFilterActive?: boolean } = {}) {
  freezeNow(NOW);
  const api = mockApi({ [KEY]: r });
  const view = render(<FrogSection days={props.days ?? 30} projectFilterActive={props.projectFilterActive ?? false} />);
  await screen.findByRole("heading", { name: /eat that frog/i });
  await waitFor(() => expect(screen.queryByRole("status", { name: /loading frog stats/i })).not.toBeInTheDocument());
  return { api, ...view };
}

describe("FrogSection: loading, error, empty", () => {
  it("shows a skeleton while the request is in flight, then the report", async () => {
    freezeNow(NOW);
    const gate = deferred<unknown>();
    mockApi({ [KEY]: () => gate.promise });
    render(<FrogSection days={30} projectFilterActive={false} />);

    const skeleton = await screen.findByRole("status", { name: /loading frog stats/i });
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("Current streak")).not.toBeInTheDocument();
    // The heading is there from the start.
    expect(screen.getByRole("heading", { name: /eat that frog/i })).toBeInTheDocument();

    await act(async () => gate.resolve(report()));
    expect(await screen.findByText("Current streak")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /loading frog stats/i })).not.toBeInTheDocument();
  });

  it("an HTTP error shows its message in an alert with a Retry button that reloads", async () => {
    freezeNow(NOW);
    let calls = 0;
    const api = mockApi({ [KEY]: () => (++calls === 1 ? httpError(500, "Database is down") : report()) });
    render(<FrogSection days={30} projectFilterActive={false} />);

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Couldn't load frog stats")).toBeInTheDocument();
    expect(within(alert).getByText("Database is down")).toBeInTheDocument();
    expect(screen.queryByText("Current streak")).not.toBeInTheDocument();

    await userEvent.click(within(alert).getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("Current streak")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(api.to(KEY)).toHaveLength(2);
  });

  it("Retry shows the skeleton again while the retried request is pending", async () => {
    freezeNow(NOW);
    const gate = deferred<unknown>();
    let calls = 0;
    mockApi({ [KEY]: () => (++calls === 1 ? httpError(500, "nope") : gate.promise) });
    render(<FrogSection days={30} projectFilterActive={false} />);
    await userEvent.click(await screen.findByRole("button", { name: /retry/i }));
    expect(await screen.findByRole("status", { name: /loading frog stats/i })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => gate.resolve(report()));
    expect(await screen.findByText("Longest streak")).toBeInTheDocument();
  });

  it("a non-JSON error body (a 502 page) falls back to the generic message", async () => {
    freezeNow(NOW);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Bad gateway</html>", { status: 502 })));
    render(<FrogSection days={30} projectFilterActive={false} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load frog stats");
    expect(alert).not.toHaveTextContent("Bad gateway");
  });

  it("a network failure shows an error with Retry (not a crash)", async () => {
    freezeNow(NOW);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    render(<FrogSection days={30} projectFilterActive={false} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Failed to fetch");
    expect(within(alert).getByRole("button", { name: /retry/i })).toBeEnabled();
  });

  it("a very long error message wraps instead of overflowing (break-words)", async () => {
    freezeNow(NOW);
    mockApi({ [KEY]: httpError(500, "x".repeat(400)) });
    render(<FrogSection days={30} projectFilterActive={false} />);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("x".repeat(400))).toHaveClass("break-words");
  });

  it("the empty state says 'No frogs in this range yet' and links to /today", async () => {
    await renderLoaded(empty());
    expect(screen.getByRole("heading", { name: "No frogs in this range yet" })).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /plan today/i });
    expect(link).toHaveAttribute("href", "/today");
    expect(screen.queryByText("Current streak")).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: CELL })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NaN|undefined|Infinity/);
  });

  it("the empty state still shows completed-by-ABCDE when tasks were completed", async () => {
    await renderLoaded({ ...empty(), abcdeCompleted: { A: 2, B: 0, C: 0, D: 0, E: 0, none: 1 } });
    expect(screen.getByRole("heading", { name: "No frogs in this range yet" })).toBeInTheDocument();
    expect(screen.getByText("Completed by ABCDE")).toBeInTheDocument();
  });

  it("is not 'empty' when the range has no plans but an older streak exists, nor when only reflections exist", async () => {
    const { unmount } = await renderLoaded({ ...empty(), stats: { ...empty().stats, longest: 5 } });
    expect(screen.queryByRole("heading", { name: "No frogs in this range yet" })).not.toBeInTheDocument();
    expect(tile("Longest streak")).toHaveTextContent("5");
    unmount();
    await renderLoaded({ ...empty(), reflections: [reflection(1)] });
    expect(screen.queryByRole("heading", { name: "No frogs in this range yet" })).not.toBeInTheDocument();
    expect(screen.getByText("Went well:", { exact: false })).toBeInTheDocument();
  });
});

describe("FrogSection: stat tiles", () => {
  it("shows current and longest streak, eaten of planned with a percent, and before-noon percent", async () => {
    await renderLoaded();
    expect(tile("Current streak")).toHaveTextContent("3days");
    expect(tile("Longest streak")).toHaveTextContent("4days");
    expect(tile("Frogs eaten")).toHaveTextContent("5of 7 planned · 71%");
    expect(tile("Before noon")).toHaveTextContent("60%of eaten frogs");
  });

  it("singular 'day' for a streak of 1, plural for 0", async () => {
    await renderLoaded(report({ stats: { plannedDays: 2, eatenDays: 1, eatenRate: 0.5, beforeNoonRate: 1, current: 1, longest: 1 } }));
    expect(tile("Current streak")).toHaveTextContent("1day");
    expect(tile("Current streak")).not.toHaveTextContent("1days");
    expect(tile("Frogs eaten")).toHaveTextContent("1of 2 planned · 50%");
    expect(tile("Before noon")).toHaveTextContent("100%");
  });

  it.each([
    [2 / 3, "67%"],
    [1 / 3, "33%"],
    [0.5, "50%"],
    [0.004, "0%"],
    [0.005, "1%"],
    [1, "100%"],
    [0, "0%"],
  ])("rate %d is shown as %s", async (rate, text) => {
    await renderLoaded(report({ stats: { plannedDays: 3, eatenDays: 1, eatenRate: rate, beforeNoonRate: rate, current: 1, longest: 1 } }));
    expect(tile("Frogs eaten")).toHaveTextContent(`· ${text}`);
    expect(tile("Before noon")).toHaveTextContent(text);
  });

  it("with 0 planned days (but an old streak) there is no NaN anywhere and before-noon shows an em dash", async () => {
    await renderLoaded({ ...empty(), stats: { plannedDays: 0, eatenDays: 0, eatenRate: 0, beforeNoonRate: 0, current: 0, longest: 2 } });
    expect(tile("Frogs eaten")).toHaveTextContent("0of 0 planned");
    expect(tile("Frogs eaten")).not.toHaveTextContent("%");
    expect(tile("Before noon")).toHaveTextContent("—");
    expect(document.body.textContent).not.toMatch(/NaN|Infinity|undefined/);
  });

  it("planned days but nothing eaten: before noon is an em dash, not 0%", async () => {
    await renderLoaded(report({ stats: { plannedDays: 4, eatenDays: 0, eatenRate: 0, beforeNoonRate: 0, current: 0, longest: 0 } }));
    expect(tile("Before noon")).toHaveTextContent("—");
    expect(tile("Frogs eaten")).toHaveTextContent("0of 4 planned · 0%"); // percent only once something was planned
  });
});

describe("FrogSection: calendar", () => {
  it("renders one labelled cell per day, oldest first, in the right state", async () => {
    // days: Oct 18 empty, 19 planned, 20-22 eaten before noon, 23-24 eaten after noon
    await renderLoaded();
    const all = cells();
    expect(all).toHaveLength(7);
    expect(all.map((c) => c.getAttribute("aria-label"))).toEqual([
      "Sun, Oct 18: no plan",
      "Mon, Oct 19: planned, not eaten",
      "Tue, Oct 20: eaten before noon",
      "Wed, Oct 21: eaten before noon",
      "Thu, Oct 22: eaten before noon",
      "Fri, Oct 23: eaten",
      "Sat, Oct 24: eaten",
    ]);
  });

  it("every cell has a title equal to its aria-label (hover) and role=img", async () => {
    await renderLoaded();
    for (const c of cells()) {
      expect(c).toHaveAttribute("role", "img");
      expect(c.getAttribute("title")).toBe(c.getAttribute("aria-label"));
    }
  });

  it("colours differ per state: eaten green, planned red-ish, no plan faint with a border", async () => {
    await renderLoaded();
    const [none, planned, , , , eatenLate] = cells();
    expect(eatenLate).toHaveStyle({ background: "#34D399" });
    expect(planned.getAttribute("style")).toMatch(/rgba\(248, ?113, ?113/);
    expect(none.getAttribute("style")).toMatch(/border: 1px solid/);
    expect(planned.getAttribute("style")).not.toMatch(/border: 1px solid/);
    expect(none.getAttribute("style")).not.toBe(planned.getAttribute("style"));
  });

  it("shows the first and last dates under the strip, a legend, and the range in the subtitle", async () => {
    await renderLoaded(report(), { days: 7 });
    expect(screen.getByText("One square per day, last 7 days")).toBeInTheDocument();
    expect(screen.getByText("Oct 18")).toBeInTheDocument();
    expect(screen.getByText("Oct 24")).toBeInTheDocument();
    for (const l of ["Eaten", "Not eaten", "No plan"]) expect(screen.getAllByText(l).length).toBeGreaterThan(0);
  });

  it("'all time' subtitle for the all range", async () => {
    await renderLoaded(report(), { days: "all" });
    expect(screen.getByText("One square per day, all time")).toBeInTheDocument();
  });

  it("'all time' with a strip cut at 400 days says how many days it really shows", async () => {
    await renderLoaded(report({ daily: strip(400) }), { days: "all" });
    expect(screen.getByText("One square per day, last 400 days")).toBeInTheDocument();
    expect(screen.queryByText("One square per day, all time")).not.toBeInTheDocument();
  });

  it("a fixed range never uses the capped wording, whatever the strip length", async () => {
    await renderLoaded(report({ daily: strip(365) }), { days: 365 });
    expect(screen.getByText("One square per day, last 365 days")).toBeInTheDocument();
  });

  it("eaten cells carry a check mark (aria-hidden) as a non-colour cue; planned and empty cells do not", async () => {
    await renderLoaded();
    const all = cells();
    all.forEach((c, i) => {
      const eaten = /eaten/.test(c.getAttribute("aria-label") ?? "") && !/not eaten/.test(c.getAttribute("aria-label") ?? "");
      const mark = c.querySelector('[aria-hidden="true"]');
      if (eaten) {
        expect(mark, `cell ${i}`).not.toBeNull();
        expect(mark).toHaveTextContent("✓");
      } else {
        expect(mark, `cell ${i}`).toBeNull();
        expect(c.textContent).toBe("");
      }
    });
    expect(all.filter((c) => c.textContent === "✓")).toHaveLength(5);
    // The accessible name is unchanged by the glyph.
    expect(all[6]).toHaveAccessibleName("Sat, Oct 24: eaten");
  });

  it("renders a 365-cell strip with unique keys (no React warnings) and the year boundary dates", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await renderLoaded(report({ daily: strip(365, (_d, i) => (i % 3 === 0 ? { eaten: true } : i % 3 === 1 ? { planned: true } : {})) }), { days: 365 });
    expect(cells()).toHaveLength(365);
    expect(new Set(cells().map((c) => c.getAttribute("aria-label"))).size).toBe(365);
    expect(screen.getByText("Oct 25")).toBeInTheDocument(); // first cell: 2025-10-25
    expect(errors).not.toHaveBeenCalled();
  });

  it("a single-day strip renders", async () => {
    await renderLoaded(report({ daily: strip(1, () => ({ eaten: true })) }));
    expect(cells()).toHaveLength(1);
  });

  it("an empty strip says so instead of crashing", async () => {
    await renderLoaded(report({ daily: [] }));
    expect(screen.getByText("No days in this range.")).toBeInTheDocument();
  });

  it("the cell list is a plain list (so a screen reader reads N items), not 365 tab stops", async () => {
    await renderLoaded();
    const list = cells()[0].closest("ul")!;
    expect(within(list).getAllByRole("listitem")).toHaveLength(7);
    expect(within(list).queryAllByRole("button")).toHaveLength(0);
    expect(list.querySelectorAll("[tabindex]")).toHaveLength(0);
  });

  it("the strip wraps (flex-wrap, fixed 20px squares) so 375px has no horizontal scroll", async () => {
    await renderLoaded();
    const list = cells()[0].closest("ul")!;
    expect(list).toHaveClass("flex-wrap");
    expect(cells()[0]).toHaveStyle({ width: "20px", height: "20px" });
  });
});

describe("FrogSection: completed by ABCDE", () => {
  const rows = () => within(screen.getByText("Completed by ABCDE").closest("div.rounded-2xl") as HTMLElement).getAllByRole("listitem");

  it("lists A..E then 'No letter', in that order, with counts", async () => {
    await renderLoaded();
    const r = rows();
    expect(r.map((li) => li.textContent)).toEqual([
      "A · Must do4",
      "B · Should do2",
      "C · Nice to do1",
      "D · Delegate0",
      "E · Eliminate0",
      "No letter3",
    ]);
  });

  it("scales bars to the largest count; zero rows get no bar", async () => {
    await renderLoaded();
    const widths = rows().map((li) => {
      const bar = li.querySelector('div[style*="position: absolute"]') as HTMLElement;
      return bar.style.width;
    });
    expect(widths).toEqual(["100%", "50%", "25%", "0%", "0%", "75%"]);
    const zeroBar = rows()[3].querySelector('div[style*="position: absolute"]') as HTMLElement;
    expect(zeroBar.style.minWidth).toMatch(/^0(px)?$/);
    const tinyBar = rows()[2].querySelector('div[style*="position: absolute"]') as HTMLElement;
    expect(tinyBar.style.minWidth).toBe("4px");
  });

  it("a count that is tiny next to the max still shows a visible sliver (minWidth 4px)", async () => {
    await renderLoaded(report({ abcdeCompleted: { A: 500, B: 1, C: 0, D: 0, E: 0, none: 0 } }));
    const b = rows()[1].querySelector('div[style*="position: absolute"]') as HTMLElement;
    expect(b.style.minWidth).toBe("4px");
  });

  it("all zero: says no tasks completed, and no bar list", async () => {
    await renderLoaded(report({ abcdeCompleted: { A: 0, B: 0, C: 0, D: 0, E: 0, none: 0 } }));
    expect(screen.getByText("No tasks completed in this range.")).toBeInTheDocument();
    expect(screen.queryByText("A · Must do")).not.toBeInTheDocument();
  });

  it("only the 'No letter' bucket has tasks: that row is shown at full width", async () => {
    await renderLoaded(report({ abcdeCompleted: { A: 0, B: 0, C: 0, D: 0, E: 0, none: 9 } }));
    const bar = rows()[5].querySelector('div[style*="position: absolute"]') as HTMLElement;
    expect(bar.style.width).toBe("100%");
    expect(rows()[5]).toHaveTextContent("No letter9");
  });

  it("the card names the range", async () => {
    await renderLoaded(report(), { days: 90 });
    expect(screen.getByText("Tasks completed in the last 90 days")).toBeInTheDocument();
  });

  it("for 'all time' the subtitle reads 'Tasks completed, all time' (not 'in the all time')", async () => {
    await renderLoaded(report(), { days: "all" });
    expect(screen.getByText("Tasks completed, all time")).toBeInTheDocument();
    expect(screen.queryByText(/in the all time/)).not.toBeInTheDocument();
  });

  it("each label is truncated by CSS (ellipsis), never wrapped into the bar", async () => {
    await renderLoaded();
    const label = screen.getByText("C · Nice to do");
    expect(label.getAttribute("style")).toMatch(/text-overflow: ellipsis/);
    expect(label.getAttribute("style")).toMatch(/white-space: nowrap/);
  });
});

describe("FrogSection: reflections", () => {
  const items = () => within(screen.getByText("Reflections").closest("div.rounded-2xl") as HTMLElement).queryAllByRole("listitem");

  it("collapses to 5 and shows 'Show more (N)'; clicking reveals all and toggles to 'Show fewer'", async () => {
    await renderLoaded(report({ reflections: Array.from({ length: 8 }, (_, i) => reflection(i + 1)) }));
    expect(items()).toHaveLength(5);
    const more = screen.getByRole("button", { name: "Show more (3)" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(more);
    expect(items()).toHaveLength(8);
    const fewer = screen.getByRole("button", { name: "Show fewer" });
    expect(fewer).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(fewer);
    expect(items()).toHaveLength(5);
  });

  it.each([[0, null], [1, null], [4, null], [5, null], [6, "Show more (1)"], [30, "Show more (25)"]])("%i reflections → button %s", async (n, button) => {
    await renderLoaded(report({ reflections: Array.from({ length: n }, (_, i) => reflection(i + 1)) }));
    expect(items()).toHaveLength(Math.min(n, 5));
    if (button) expect(screen.getByRole("button", { name: button })).toBeInTheDocument();
    else expect(screen.queryByRole("button", { name: /show (more|fewer)/i })).not.toBeInTheDocument();
  });

  it("30 reflections all show after expanding, newest first as delivered", async () => {
    await renderLoaded(report({ reflections: Array.from({ length: 30 }, (_, i) => reflection(i + 1)) }));
    await userEvent.click(screen.getByRole("button", { name: /show more/i }));
    expect(items()).toHaveLength(30);
    expect(items()[0]).toHaveTextContent("Fri, Oct 23");
    expect(items()[29]).toHaveTextContent("Thu, Sep 24");
  });

  it("an empty journal points to Today", async () => {
    await renderLoaded(report({ reflections: [] }));
    expect(screen.getByText(/No reflections yet/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Today" });
    expect(link).toHaveAttribute("href", "/today");
  });

  it("shows date, star rating (accessible), frog title with eaten state, and both notes", async () => {
    await renderLoaded(report({ reflections: [reflection(1, { rating: 4, frogTitle: "Write the report", eaten: true })] }));
    const li = items()[0];
    expect(li).toHaveTextContent("Fri, Oct 23");
    const stars = within(li).getByRole("img", { name: "Rated 4 out of 5" });
    expect(stars).toHaveAttribute("title", "4 / 5");
    expect(stars.textContent).toBe("★★★★★"); // 4 filled + 1 dim
    expect(li).toHaveTextContent("🐸 Write the report · eaten ✓");
    expect(li).toHaveTextContent("Went well: went well 1");
    expect(li).toHaveTextContent("Do differently: improve 1");
  });

  it("an uneaten frog says 'not eaten'; no frog shows no frog line at all", async () => {
    await renderLoaded(
      report({ reflections: [reflection(1, { eaten: false, frogTitle: "Missed it" }), reflection(2, { frogTitle: null, eaten: false })] }),
    );
    expect(items()[0]).toHaveTextContent("🐸 Missed it · not eaten");
    expect(items()[1]).not.toHaveTextContent("🐸");
    expect(items()[1]).not.toHaveTextContent("not eaten");
  });

  it("no rating → no stars; null notes → no note lines", async () => {
    await renderLoaded(report({ reflections: [reflection(1, { rating: null, wentWell: null, improve: "only this" })] }));
    const li = items()[0];
    expect(within(li).queryByRole("img")).not.toBeInTheDocument();
    expect(li).not.toHaveTextContent("Went well");
    expect(li).toHaveTextContent("Do differently: only this");
  });

  it.each([1, 2, 3, 4, 5])("rating %i renders 5 stars total with the right label", async (n) => {
    await renderLoaded(report({ reflections: [reflection(1, { rating: n })] }));
    const stars = screen.getByRole("img", { name: `Rated ${n} out of 5` });
    expect(stars.textContent).toHaveLength(5);
  });

  it("long unbroken text and multi-line text wrap (break-words, pre-wrap) and are rendered as text, not HTML", async () => {
    const long = "W".repeat(600);
    const html = "<img src=x onerror=alert(1)> & <b>bold</b>";
    await renderLoaded(report({ reflections: [reflection(1, { wentWell: `${long}\nline two`, improve: html, frogTitle: "F".repeat(300) })] }));
    const li = items()[0];
    const note = within(li).getByText(new RegExp(`^W{600}`), { exact: false });
    expect(note.closest("p")).toHaveClass("break-words");
    expect(note.closest("p")).toHaveClass("whitespace-pre-wrap");
    expect(li.querySelector("img[src='x']")).toBeNull();
    expect(li.querySelector("b")).toBeNull();
    expect(li).toHaveTextContent(html);
    expect(within(li).getByText(/F{300}/)).toHaveClass("break-words");
  });

  it("each list item is a min-w-0 flex child so nothing pushes the card wider than the screen", async () => {
    await renderLoaded(report({ reflections: [reflection(1)] }));
    expect(items()[0]).toHaveClass("min-w-0");
  });

  it("two reflections never share a key (dates are unique), expanding does not remount the shown ones", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await renderLoaded(report({ reflections: Array.from({ length: 7 }, (_, i) => reflection(i + 1)) }));
    const first = items()[0];
    await userEvent.click(screen.getByRole("button", { name: /show more/i }));
    expect(items()[0]).toBe(first);
    expect(errors).not.toHaveBeenCalled();
  });

  it("expanded state survives a refetch for a new range (the card is not remounted)", async () => {
    freezeNow(NOW);
    mockApi({ [KEY]: report({ reflections: Array.from({ length: 8 }, (_, i) => reflection(i + 1)) }) });
    const { rerender } = render(<FrogSection days={30} projectFilterActive={false} />);
    await screen.findByRole("button", { name: /show more/i });
    await userEvent.click(screen.getByRole("button", { name: /show more/i }));
    rerender(<FrogSection days={7} projectFilterActive={false} />);
    await waitFor(() => expect(screen.getByText("Reflections")).toBeInTheDocument());
    expect(items()).toHaveLength(8);
  });
});

describe("FrogSection: notes about scope", () => {
  it("always says 'Across all projects'", async () => {
    await renderLoaded();
    expect(screen.getByText(/Across all projects/)).toBeInTheDocument();
    expect(screen.queryByText(/project filter above/)).not.toBeInTheDocument();
  });

  it("adds the project-filter note when a project is selected", async () => {
    await renderLoaded(report(), { projectFilterActive: true });
    expect(screen.getByText(/Across all projects/)).toHaveTextContent("the project filter above doesn't apply to frog stats");
  });

  it("the note appears and disappears as the filter changes without refetching", async () => {
    freezeNow(NOW);
    const api = mockApi({ [KEY]: report() });
    const { rerender } = render(<FrogSection days={30} projectFilterActive={false} />);
    await screen.findByText("Current streak");
    rerender(<FrogSection days={30} projectFilterActive />);
    expect(screen.getByText(/project filter above/)).toBeInTheDocument();
    rerender(<FrogSection days={30} projectFilterActive={false} />);
    expect(screen.queryByText(/project filter above/)).not.toBeInTheDocument();
    expect(api.to(KEY)).toHaveLength(1);
  });

  it("is a labelled region (heading id wired to aria-labelledby)", async () => {
    await renderLoaded();
    expect(screen.getByRole("region", { name: /eat that frog/i })).toBeInTheDocument();
  });

  it("the decorative frog emojis are hidden from assistive tech", async () => {
    await renderLoaded();
    const h = screen.getByRole("heading", { name: /eat that frog/i });
    expect(h.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(h).toHaveAccessibleName("Eat that frog");
  });
});

describe("FrogSection: requests", () => {
  it("sends tz, today and days from the browser's clock", async () => {
    const { api } = await renderLoaded(report(), { days: 30 });
    const [call] = api.to(KEY);
    expect(call.query.get("tz")).toBe(TZ);
    expect(call.query.get("today")).toBe(DATE);
    expect(call.query.get("days")).toBe("30");
    expect(call.query.has("groupId")).toBe(false);
  });

  it.each([[7, "7"], [90, "90"], ["all", "all"]] as const)("days=%s is sent as %s", async (days, sent) => {
    const { api } = await renderLoaded(report(), { days });
    expect(api.to(KEY)[0].query.get("days")).toBe(sent);
  });

  it("uses the LOCAL date, not UTC (00:30 on the 25th in Berlin)", async () => {
    freezeNow("2026-10-24T22:30:00Z");
    const api = mockApi({ [KEY]: report() });
    render(<FrogSection days={30} projectFilterActive={false} />);
    await screen.findByText("Current streak");
    expect(api.to(KEY)[0].query.get("today")).toBe("2026-10-25");
  });

  it("changing the range refetches with the new days and keeps the previous report dimmed meanwhile", async () => {
    freezeNow(NOW);
    const gate = deferred<unknown>();
    const api = mockApi({
      [KEY]: (c) => (c.query.get("days") === "30" ? report() : gate.promise),
    });
    const { rerender } = render(<FrogSection days={30} projectFilterActive={false} />);
    await screen.findByText("Current streak");
    const wrapper = () => screen.getByText("Current streak").closest("[aria-busy]") as HTMLElement;
    expect(wrapper()).toHaveAttribute("aria-busy", "false");
    expect(wrapper()).toHaveStyle({ opacity: "1" });

    rerender(<FrogSection days={7} projectFilterActive={false} />);
    await waitFor(() => expect(api.to(KEY)).toHaveLength(2));
    expect(api.to(KEY)[1].query.get("days")).toBe("7");
    // Previous numbers are still on screen, dimmed and marked busy; no skeleton, no flash of empty.
    expect(screen.getByText("Current streak")).toBeInTheDocument();
    expect(wrapper()).toHaveAttribute("aria-busy", "true");
    expect(wrapper()).toHaveStyle({ opacity: "0.55" });
    expect(screen.queryByRole("status", { name: /loading frog stats/i })).not.toBeInTheDocument();
    expect(tile("Current streak")).toHaveTextContent("3days");

    await act(async () => gate.resolve(report({ stats: { plannedDays: 2, eatenDays: 2, eatenRate: 1, beforeNoonRate: 1, current: 9, longest: 9 } })));
    await waitFor(() => expect(tile("Current streak")).toHaveTextContent("9days"));
    expect(wrapper()).toHaveAttribute("aria-busy", "false");
    expect(wrapper()).toHaveStyle({ opacity: "1" });
  });

  it("a failing refetch replaces the dimmed report with the error (and Retry works)", async () => {
    freezeNow(NOW);
    let fail = true;
    mockApi({ [KEY]: (c) => (c.query.get("days") === "7" && fail ? httpError(500, "range broke") : report()) });
    const { rerender } = render(<FrogSection days={30} projectFilterActive={false} />);
    await screen.findByText("Current streak");
    rerender(<FrogSection days={7} projectFilterActive={false} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("range broke");
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("Current streak")).toBeInTheDocument();
  });

  it("after an error, switching range shows a skeleton (nothing to dim) and then the new data", async () => {
    freezeNow(NOW);
    const gate = deferred<unknown>();
    mockApi({ [KEY]: (c) => (c.query.get("days") === "30" ? httpError(500, "bad") : gate.promise) });
    const { rerender } = render(<FrogSection days={30} projectFilterActive={false} />);
    await screen.findByRole("alert");
    rerender(<FrogSection days={90} projectFilterActive={false} />);
    expect(await screen.findByRole("status", { name: /loading frog stats/i })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => gate.resolve(report()));
    expect(await screen.findByText("Current streak")).toBeInTheDocument();
  });

  it("ignores a stale response: a slow answer for the OLD range arriving after the new one is dropped", async () => {
    freezeNow(NOW);
    const slow30 = deferred<unknown>();
    const fast7 = deferred<unknown>();
    mockApi({ [KEY]: (c) => (c.query.get("days") === "30" ? slow30.promise : fast7.promise) });
    const { rerender } = render(<FrogSection days={30} projectFilterActive={false} />);
    await screen.findByRole("status", { name: /loading frog stats/i });
    rerender(<FrogSection days={7} projectFilterActive={false} />);

    await act(async () => fast7.resolve(report({ stats: { plannedDays: 7, eatenDays: 7, eatenRate: 1, beforeNoonRate: 1, current: 7, longest: 7 } })));
    await waitFor(() => expect(tile("Current streak")).toHaveTextContent("7days"));
    await act(async () => slow30.resolve(report({ stats: { plannedDays: 30, eatenDays: 1, eatenRate: 1 / 30, beforeNoonRate: 0, current: 30, longest: 30 } })));
    expect(tile("Current streak")).toHaveTextContent("7days");
    expect(screen.queryByText("30days", { exact: false })).not.toBeInTheDocument();
  });

  it("ignores a stale ERROR for the old range", async () => {
    freezeNow(NOW);
    const slow30 = deferred<unknown>();
    mockApi({ [KEY]: (c) => (c.query.get("days") === "30" ? slow30.promise : report()) });
    const { rerender } = render(<FrogSection days={30} projectFilterActive={false} />);
    await screen.findByRole("status", { name: /loading frog stats/i });
    rerender(<FrogSection days={7} projectFilterActive={false} />);
    await screen.findByText("Current streak");
    await act(async () => {
      slow30.resolve(httpError(500, "late failure"));
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Current streak")).toBeInTheDocument();
  });

  it("flipping 7 → 30 → 7 quickly ends on the last range's data", async () => {
    freezeNow(NOW);
    const gates = new Map<string, ReturnType<typeof deferred<unknown>>[]>();
    mockApi({
      [KEY]: (c) => {
        const g = deferred<unknown>();
        const k = c.query.get("days")!;
        gates.set(k, [...(gates.get(k) ?? []), g]);
        return g.promise;
      },
    });
    const { rerender } = render(<FrogSection days={7} projectFilterActive={false} />);
    await waitFor(() => expect(gates.get("7")).toHaveLength(1));
    rerender(<FrogSection days={30} projectFilterActive={false} />);
    await waitFor(() => expect(gates.get("30")).toHaveLength(1));
    rerender(<FrogSection days={7} projectFilterActive={false} />);
    await waitFor(() => expect(gates.get("7")).toHaveLength(2));
    const mk = (n: number) => report({ stats: { plannedDays: n, eatenDays: n, eatenRate: 1, beforeNoonRate: 1, current: n, longest: n } });
    await act(async () => gates.get("7")![1].resolve(mk(11)));
    await act(async () => gates.get("30")![0].resolve(mk(33)));
    await act(async () => gates.get("7")![0].resolve(mk(77)));
    await waitFor(() => expect(tile("Current streak")).toHaveTextContent("11days"));
  });

  it("unmounting with a request in flight does not warn or throw when it answers", async () => {
    freezeNow(NOW);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const gate = deferred<unknown>();
    mockApi({ [KEY]: () => gate.promise });
    const { unmount } = render(<FrogSection days={30} projectFilterActive={false} />);
    await screen.findByRole("status", { name: /loading frog stats/i });
    unmount();
    await act(async () => gate.resolve(report()));
    expect(errors).not.toHaveBeenCalled();
  });

  it("reloads for the new date when midnight passes (focus event), and drops the old date's answer", async () => {
    freezeNow("2026-10-24T21:59:00Z", { intervals: true }); // 23:59 on the 24th in Berlin
    const api = mockApi({ [KEY]: (c) => report({ daily: strip(7).map((d) => ({ ...d })), stats: { ...report().stats, current: c.query.get("today") === "2026-10-24" ? 3 : 4 } }) });
    render(<FrogSection days={30} projectFilterActive={false} />);
    await screen.findByText("Current streak");
    expect(tile("Current streak")).toHaveTextContent("3days");
    vi.setSystemTime(new Date("2026-10-24T22:01:00Z")); // 00:01 on the 25th
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(tile("Current streak")).toHaveTextContent("4days"));
    expect(api.to(KEY).map((c) => c.query.get("today"))).toEqual(["2026-10-24", "2026-10-25"]);
  });

  it("does not refetch on unrelated re-renders", async () => {
    freezeNow(NOW);
    const api = mockApi({ [KEY]: report() });
    const { rerender } = render(<FrogSection days={30} projectFilterActive={false} />);
    await screen.findByText("Current streak");
    for (let i = 0; i < 3; i++) rerender(<FrogSection days={30} projectFilterActive={i % 2 === 0} />);
    expect(api.to(KEY)).toHaveLength(1);
  });
});

describe("FrogSection: server render and hydration", () => {
  it("renders only the heading and the skeleton on the server (no clock-dependent markup)", () => {
    freezeNow(NOW);
    mockApi({ [KEY]: report() });
    const html = renderToString(<FrogSection days={30} projectFilterActive={false} />);
    expect(html).toContain("Eat that frog");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading frog stats");
    expect(html).not.toContain("Current streak");
    expect(html).not.toContain("Oct 24");
  });

  it("hydrates the server markup without a mismatch warning, then loads the report", async () => {
    freezeNow(NOW);
    mockApi({ [KEY]: report() });
    const html = renderToString(<FrogSection days={30} projectFilterActive={false} />);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, <FrogSection days={30} projectFilterActive={false} />);
    });
    expect(await screen.findByText("Current streak")).toBeInTheDocument();
    expect(errors).not.toHaveBeenCalled();
    act(() => root.unmount());
    container.remove();
  });

  it("hydrates with the project-filter note on the server too (props are the same on both sides)", async () => {
    freezeNow(NOW);
    mockApi({ [KEY]: report() });
    const html = renderToString(<FrogSection days="all" projectFilterActive />);
    expect(html).toContain("the project filter above doesn");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, <FrogSection days="all" projectFilterActive />);
    });
    await screen.findByText("Current streak");
    expect(errors).not.toHaveBeenCalled();
    act(() => root.unmount());
    container.remove();
  });
});
