// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import TodaysFrogCard from "./TodaysFrogCard";
import type { TodayPayload } from "@/types";
import { DATE, GROUP_HOME, TZ, deferred, freezeNow, httpError, mockApi, payload, task, unplanned } from "../../tests/ui/fixtures";

const NOW = "2026-10-24T08:00:00Z"; // 10:00 on the 24th in Berlin
const KEY = "GET /api/today";

const withFrog = (over: Partial<ReturnType<typeof task>> = {}, rest: Partial<TodayPayload> = {}) => {
  const t = task({ id: "f1", title: "Write the report", abcde: "A", abcdeRank: 1, ...over });
  return payload({ tasks: [t], frogId: "f1", ...rest });
};

async function renderCard(reply: unknown) {
  freezeNow(NOW);
  const api = mockApi({ [KEY]: reply as never });
  const view = render(<TodaysFrogCard />);
  await waitFor(() => expect(screen.queryByRole("status", { name: /loading today's frog/i })).not.toBeInTheDocument());
  return { api, ...view };
}

describe("TodaysFrogCard", () => {
  describe("loading", () => {
    it("is a skeleton (role=status, aria-busy) while the request is in flight, then the card", async () => {
      freezeNow(NOW);
      const gate = deferred<unknown>();
      mockApi({ [KEY]: () => gate.promise });
      render(<TodaysFrogCard />);
      const sk = await screen.findByRole("status", { name: /loading today's frog/i });
      expect(sk).toHaveAttribute("aria-busy", "true");
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      await act(async () => gate.resolve(withFrog()));
      expect(await screen.findByText("Write the report")).toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("asks only for GET /api/today with the browser's local date and zone", async () => {
      const { api } = await renderCard(withFrog());
      expect(api.calls).toHaveLength(1);
      const [call] = api.to(KEY);
      expect(call.query.get("date")).toBe(DATE);
      expect(call.query.get("tz")).toBe(TZ);
    });

    it("uses the LOCAL date (00:30 on the 25th in Berlin is still the 24th in UTC)", async () => {
      freezeNow("2026-10-24T22:30:00Z");
      const api = mockApi({ [KEY]: unplanned({ date: "2026-10-25" }) });
      render(<TodaysFrogCard />);
      await screen.findByText(/No frog yet/);
      expect(api.to(KEY)[0].query.get("date")).toBe("2026-10-25");
    });
  });

  describe("with a frog", () => {
    it("shows the title, the ABCDE badge, the project chip and the 'Today's frog' label", async () => {
      await renderCard(withFrog());
      const card = screen.getByRole("link");
      expect(within(card).getByText("Write the report")).toBeInTheDocument();
      expect(within(card).getByText("A-1")).toBeInTheDocument();
      expect(within(card).getByText("Work")).toBeInTheDocument();
      expect(within(card).getByText(/Today's frog/)).toBeInTheDocument();
      expect(within(card).queryByText(/eaten/i)).not.toBeInTheDocument();
    });

    it("the whole card is ONE link to /today (nothing nested that would be a second link or a button)", async () => {
      await renderCard(withFrog());
      const links = screen.getAllByRole("link");
      expect(links).toHaveLength(1);
      expect(links[0]).toHaveAttribute("href", "/today");
      expect(screen.queryAllByRole("button")).toHaveLength(0);
      expect(links[0].querySelector("a, button")).toBeNull();
      expect(links[0]).toHaveAccessibleName(/Today's frog.*Write the report/);
    });

    it("a frog without a letter has no badge; a letter without a rank shows just the letter", async () => {
      const { unmount } = await renderCard(withFrog({ abcde: null, abcdeRank: null }));
      expect(screen.queryByText(/^[A-E](-\d+)?$/)).not.toBeInTheDocument();
      unmount();
      await renderCard(withFrog({ abcde: "B", abcdeRank: null }));
      expect(screen.getByText("B")).toBeInTheDocument();
    });

    it("an open frog is not struck through and says nothing about eating", async () => {
      await renderCard(withFrog());
      expect(screen.getByText("Write the report")).not.toHaveStyle({ textDecoration: "line-through" });
      expect(screen.queryByText("Eaten")).not.toBeInTheDocument();
      expect(screen.queryByText("Frog eaten")).not.toBeInTheDocument();
    });

    it("an eaten frog says 'Frog eaten', shows 'Eaten' and strikes the title", async () => {
      await renderCard(withFrog({ completedAt: "2026-10-24T05:42:00Z" })); // 07:42 in Berlin, the plan's day
      expect(screen.getByText(/Frog eaten/)).toBeInTheDocument();
      expect(screen.getByText("Eaten")).toBeInTheDocument();
      expect(screen.getByText("Write the report")).toHaveStyle({ textDecoration: "line-through" });
      expect(screen.queryByText(/^Today's frog$/)).not.toBeInTheDocument();
    });

    it("a frog completed late the previous evening counts as eaten (before the plan day's end)", async () => {
      await renderCard(withFrog({ completedAt: "2026-10-23T20:30:00Z" })); // 22:30 on the 23rd in Berlin
      expect(screen.getByText("Eaten")).toBeInTheDocument();
    });

    it("a frog completed the NEXT local day is not eaten for today's plan (isFrogEaten rule)", async () => {
      // Plan date is the 24th; completed at 00:30 on the 25th in Berlin.
      await renderCard(withFrog({ completedAt: "2026-10-24T22:30:00Z" }));
      expect(screen.queryByText("Eaten")).not.toBeInTheDocument();
      expect(screen.getByText(/Today's frog/)).toBeInTheDocument();
    });

    it("eaten at 23:59 local on the plan date is eaten; 00:00 the next day is not", async () => {
      const a = await renderCard(withFrog({ completedAt: "2026-10-24T21:59:00Z" })); // 23:59 Berlin
      expect(screen.getByText("Eaten")).toBeInTheDocument();
      a.unmount();
      await renderCard(withFrog({ completedAt: "2026-10-24T22:00:00Z" })); // 00:00 on the 25th
      expect(screen.queryByText("Eaten")).not.toBeInTheDocument();
    });

    it("the frog's project colour and name come from the payload (another project)", async () => {
      await renderCard(withFrog({ group: GROUP_HOME, groupId: GROUP_HOME.id }));
      expect(screen.getByText("Home")).toBeInTheDocument();
      expect(screen.queryByText("Work")).not.toBeInTheDocument();
    });

    it("a very long title wraps (break-words) and the chips wrap (flex-wrap) so 375px has no sideways scroll", async () => {
      const title = "Supercalifragilistic".repeat(12);
      await renderCard(withFrog({ title }));
      const p = screen.getByText(title);
      expect(p).toHaveClass("break-words");
      expect(p.parentElement).toHaveClass("min-w-0");
      expect(p.nextElementSibling).toHaveClass("flex-wrap");
    });

    it("a very long project name is truncated inside its chip", async () => {
      await renderCard(withFrog({ group: { ...GROUP_HOME, name: "P".repeat(200) } }));
      expect(screen.getByText("P".repeat(200))).toHaveClass("truncate");
    });

    it("renders the title as text, never as HTML", async () => {
      await renderCard(withFrog({ title: "<img src=x onerror=alert(1)> <b>x</b>" }));
      expect(document.querySelector("img[src='x']")).toBeNull();
      expect(screen.getByText("<img src=x onerror=alert(1)> <b>x</b>")).toBeInTheDocument();
    });
  });

  describe("streak chip", () => {
    it("shows '🔥 N-day frog streak' only when the current streak is above 0", async () => {
      const a = await renderCard(withFrog({}, { streak: { current: 4, longest: 9 } }));
      expect(screen.getByText("🔥 4-day frog streak")).toBeInTheDocument();
      a.unmount();
      await renderCard(withFrog({}, { streak: { current: 0, longest: 9 } }));
      expect(screen.queryByText(/frog streak/)).not.toBeInTheDocument();
    });

    it("a streak of 1 reads '1-day'", async () => {
      await renderCard(withFrog({}, { streak: { current: 1, longest: 1 } }));
      expect(screen.getByText("🔥 1-day frog streak")).toBeInTheDocument();
    });

    it("the chip is inside the single link and also shows with no frog planned yet", async () => {
      await renderCard(unplanned({ streak: { current: 3, longest: 3 } }));
      const link = screen.getByRole("link");
      expect(within(link).getByText("🔥 3-day frog streak")).toBeInTheDocument();
      expect(within(link).getByText("No frog yet — plan your day")).toBeInTheDocument();
    });

    it("the longest streak is never shown on the card", async () => {
      await renderCard(withFrog({}, { streak: { current: 2, longest: 99 } }));
      expect(screen.queryByText(/99/)).not.toBeInTheDocument();
    });
  });

  describe("without a frog", () => {
    it("no plan at all: 'No frog yet — plan your day', linking to /today", async () => {
      await renderCard(unplanned());
      const link = screen.getByRole("link");
      expect(link).toHaveAttribute("href", "/today");
      expect(link).toHaveTextContent("No frog yet — plan your day");
      expect(screen.queryByText(/Frog eaten/)).not.toBeInTheDocument();
    });

    it("a plan whose frog is null (none chosen, or the task was trashed) says the same", async () => {
      await renderCard(payload({ frog: null, tasks: [task({ id: "t1" })] }));
      expect(screen.getByText("No frog yet — plan your day")).toBeInTheDocument();
    });

    it("an archived, never-eaten frog is hidden (activeFrog): it was eliminated", async () => {
      const t = task({ id: "f1", title: "Eliminated one" });
      await renderCard(payload({ tasks: [t], frog: { ...t, subtasks: [], archivedAt: "2026-10-24T06:00:00Z" } }));
      expect(screen.getByText("No frog yet — plan your day")).toBeInTheDocument();
      expect(screen.queryByText("Eliminated one")).not.toBeInTheDocument();
    });

    it("an archived frog that WAS eaten is still shown, as eaten", async () => {
      const t = task({ id: "f1", title: "Done and filed", completedAt: "2026-10-24T05:00:00Z" });
      await renderCard(payload({ tasks: [t], frog: { ...t, subtasks: [], archivedAt: "2026-10-24T06:00:00Z" } }));
      expect(screen.getByText("Done and filed")).toBeInTheDocument();
      expect(screen.getByText("Eaten")).toBeInTheDocument();
    });
  });

  describe("errors", () => {
    it("an HTTP error falls back to a quiet link to /today (no error text, no alert, no throw)", async () => {
      await renderCard(httpError(500, "Database exploded SECRET"));
      const link = screen.getByRole("link");
      expect(link).toHaveAttribute("href", "/today");
      expect(link).toHaveTextContent("Today's frog");
      expect(link).toHaveTextContent("Open Today");
      expect(document.body.textContent).not.toContain("SECRET");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it.each([401, 400, 404, 503])("HTTP %i also falls back", async (status) => {
      await renderCard(httpError(status, "nope"));
      expect(screen.getByRole("link")).toHaveTextContent("Open Today");
    });

    it("a network failure falls back too", async () => {
      freezeNow(NOW);
      vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
      render(<TodaysFrogCard />);
      expect(await screen.findByText("Open Today")).toBeInTheDocument();
      expect(screen.getByRole("link")).toHaveAttribute("href", "/today");
    });

    it("a 200 with a non-JSON body falls back instead of crashing", async () => {
      freezeNow(NOW);
      vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>oops</html>", { status: 200 })));
      render(<TodaysFrogCard />);
      expect(await screen.findByText("Open Today")).toBeInTheDocument();
    });

    it("does not log React errors when the request fails", async () => {
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      await renderCard(httpError(500, "x"));
      expect(errors).not.toHaveBeenCalled();
    });
  });

  describe("staleness and the clock", () => {
    it("ignores a late answer for yesterday's date after midnight passed", async () => {
      freezeNow("2026-10-24T21:59:00Z", { intervals: true });
      const slowOld = deferred<unknown>();
      const api = mockApi({
        [KEY]: (c) => (c.query.get("date") === "2026-10-24" ? slowOld.promise : unplanned({ date: "2026-10-25" })),
      });
      render(<TodaysFrogCard />);
      await screen.findByRole("status", { name: /loading today's frog/i });
      vi.setSystemTime(new Date("2026-10-24T22:01:00Z"));
      act(() => {
        window.dispatchEvent(new Event("focus"));
      });
      expect(await screen.findByText("No frog yet — plan your day")).toBeInTheDocument();
      await act(async () => slowOld.resolve(withFrog({ title: "Yesterday's frog" })));
      expect(screen.queryByText("Yesterday's frog")).not.toBeInTheDocument();
      expect(screen.getByText("No frog yet — plan your day")).toBeInTheDocument();
      expect(api.to(KEY).map((c) => c.query.get("date"))).toEqual(["2026-10-24", "2026-10-25"]);
    });

    it("ignores a late ERROR for the old date", async () => {
      freezeNow("2026-10-24T21:59:00Z", { intervals: true });
      const slowOld = deferred<unknown>();
      mockApi({ [KEY]: (c) => (c.query.get("date") === "2026-10-24" ? slowOld.promise : withFrog({}, { date: "2026-10-25" })) });
      render(<TodaysFrogCard />);
      await screen.findByRole("status");
      vi.setSystemTime(new Date("2026-10-24T22:01:00Z"));
      act(() => {
        window.dispatchEvent(new Event("focus"));
      });
      await screen.findByText("Write the report");
      await act(async () => slowOld.resolve(httpError(500, "late")));
      expect(screen.getByText("Write the report")).toBeInTheDocument();
      expect(screen.queryByText("Open Today")).not.toBeInTheDocument();
    });

    it("re-renders from the same clock do not refetch", async () => {
      const { api, rerender } = await renderCard(withFrog());
      rerender(<TodaysFrogCard />);
      rerender(<TodaysFrogCard />);
      expect(api.to(KEY)).toHaveLength(1);
    });

    it("unmounting with a request in flight does not warn when it answers", async () => {
      freezeNow(NOW);
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      const gate = deferred<unknown>();
      mockApi({ [KEY]: () => gate.promise });
      const { unmount } = render(<TodaysFrogCard />);
      await screen.findByRole("status");
      unmount();
      await act(async () => gate.resolve(withFrog()));
      expect(errors).not.toHaveBeenCalled();
    });

    it("removes its window/document listeners and interval on unmount", async () => {
      freezeNow(NOW, { intervals: true });
      const removeWin = vi.spyOn(window, "removeEventListener");
      const removeDoc = vi.spyOn(document, "removeEventListener");
      const clear = vi.spyOn(window, "clearInterval");
      mockApi({ [KEY]: withFrog() });
      const { unmount } = render(<TodaysFrogCard />);
      await screen.findByText("Write the report");
      unmount();
      expect(removeWin).toHaveBeenCalledWith("focus", expect.any(Function));
      expect(removeDoc).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
      expect(clear).toHaveBeenCalled();
    });
  });

  describe("server render and hydration", () => {
    it("server markup is the skeleton only: no title, no date-dependent text", () => {
      freezeNow(NOW);
      mockApi({ [KEY]: withFrog() });
      const html = renderToString(<TodaysFrogCard />);
      expect(html).toContain('aria-busy="true"');
      expect(html).toContain("Loading today&#x27;s frog");
      expect(html).not.toContain("Write the report");
      expect(html).not.toContain("No frog yet");
      expect(html).not.toContain("href=");
    });

    it("hydrates the skeleton without a mismatch and then shows the card", async () => {
      freezeNow(NOW);
      mockApi({ [KEY]: withFrog() });
      const html = renderToString(<TodaysFrogCard />);
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      const container = document.createElement("div");
      container.innerHTML = html;
      document.body.appendChild(container);
      let root!: ReturnType<typeof hydrateRoot>;
      await act(async () => {
        root = hydrateRoot(container, <TodaysFrogCard />);
      });
      expect(await screen.findByText("Write the report")).toBeInTheDocument();
      expect(errors).not.toHaveBeenCalled();
      act(() => root.unmount());
      container.remove();
    });
  });
});
