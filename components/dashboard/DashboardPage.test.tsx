// @vitest-environment jsdom
// The dashboard (a server component) rendered with a fake user and DB: the Frog
// card was added above the project grid and nothing else may have changed.
import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { freezeNow, mockApi, unplanned } from "../../tests/ui/fixtures";

const h = vi.hoisted(() => ({
  user: { id: "u1", email: "sai@example.com" } as { id: string; email?: string } | null,
  groups: [] as unknown[],
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
  findMany: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user }, error: null }) } }),
}));
vi.mock("@/lib/db", () => ({ db: { group: { findMany: h.findMany } } }));
vi.mock("next/navigation", () => ({ redirect: h.redirect }));

import DashboardPage from "@/app/(app)/dashboard/page";

const group = (id: string, name: string, remaining: number[]) => ({
  id,
  name,
  color: "#7C6EF8",
  order: 0,
  _count: { tasks: 10 },
  statuses: remaining.map((n) => ({ _count: { tasks: n } })),
});

async function renderPage() {
  const ui = await DashboardPage();
  return render(ui);
}

beforeEach(() => {
  freezeNow("2026-10-24T08:00:00Z");
  h.user = { id: "u1", email: "sai@example.com" };
  h.findMany.mockReset();
  h.findMany.mockImplementation(async () => h.groups);
  h.redirect.mockClear();
  h.groups = [group("g1", "Work", [3, 2]), group("g2", "Home", [1])];
  mockApi({ "GET /api/today": unplanned() });
});

describe("dashboard page", () => {
  it("redirects to /login without a user, before touching the DB", async () => {
    h.user = null;
    await expect(DashboardPage()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(h.findMany).not.toHaveBeenCalled();
  });

  it("queries only the signed-in user's groups", async () => {
    await renderPage();
    expect(h.findMany).toHaveBeenCalledTimes(1);
    expect(h.findMany.mock.calls[0][0].where).toEqual({ ownerId: "u1" });
  });

  it("keeps the THINK → PLAN → DO → REFLECT ∞ strip, in order, untouched", async () => {
    const { container } = await renderPage();
    const labels = ["THINK", "PLAN", "DO", "REFLECT"].map((l) => screen.getByText(l));
    for (let i = 1; i < labels.length; i++) {
      expect(labels[i - 1].compareDocumentPosition(labels[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(screen.getByText("∞")).toBeInTheDocument();
    expect(container.textContent).toContain("THINK→PLAN→DO→REFLECT∞");
  });

  it("keeps the header: greeting fallback and the project/task counts", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Hello, sai");
    expect(screen.getByText("2 projects · 6 left")).toBeInTheDocument();
  });

  it("keeps the project grid: one link per project with its remaining count", async () => {
    await renderPage();
    const work = screen.getByRole("link", { name: /Work/ });
    expect(work).toHaveAttribute("href", "/group/g1");
    expect(within(work).getByText("5 left")).toBeInTheDocument();
    const home = screen.getByRole("link", { name: /Home/ });
    expect(home).toHaveAttribute("href", "/group/g2");
    expect(within(home).getByText("1 left")).toBeInTheDocument();
  });

  it("puts Today's Frog card above the project grid and below the strip", async () => {
    await renderPage();
    const frog = await screen.findByText(/No frog yet — plan your day/);
    const frogLink = frog.closest("a")!;
    expect(frogLink).toHaveAttribute("href", "/today");
    const grid = screen.getByRole("link", { name: /Work/ }).closest("div.grid")!;
    expect(frogLink.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("REFLECT").compareDocumentPosition(frogLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the card is the only new link to /today and the project links are not nested in it", async () => {
    await renderPage();
    await screen.findByText(/No frog yet/);
    expect(screen.getAllByRole("link").filter((a) => a.getAttribute("href") === "/today")).toHaveLength(1);
  });

  it("shows the card even when there are no projects, together with the empty state", async () => {
    h.groups = [];
    await renderPage();
    expect(await screen.findByText(/No frog yet — plan your day/)).toBeInTheDocument();
    expect(screen.getByText("No projects yet")).toBeInTheDocument();
    expect(screen.getByText("Create your first project to get started")).toBeInTheDocument();
  });

  it("a failing /api/today does not break the page: the card degrades to a plain link", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    await renderPage();
    await waitFor(() => expect(screen.getByText("Open Today")).toBeInTheDocument());
    expect(screen.getByText("THINK")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Work/ })).toBeInTheDocument();
  });

  it("singular '1 project' wording is unchanged", async () => {
    h.groups = [group("g1", "Solo", [4])];
    await renderPage();
    expect(screen.getByText("1 project · 4 left")).toBeInTheDocument();
  });
});
