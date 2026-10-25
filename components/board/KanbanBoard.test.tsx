// @vitest-environment jsdom
// The board on phones (docs/mobile-pwa/SPEC.md, P5): under lg the columns snap
// sideways (about 85vw, at most 320px) and each scrolls on its own; snapping is
// off while a card is dragged, and comes back after the drop or a cancel.
// jsdom has no layout or media queries, so these check the classes that do it,
// and call the DndContext's handlers directly (no pointer simulation).
import { createElement } from "react";
import { act, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import KanbanBoard from "./KanbanBoard";
import { MouseAndPenSensor } from "@/lib/dnd-touch";
import type { Group, Status, Task } from "@/types";
import { mockApi } from "../../tests/ui/fixtures";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/group/g1",
}));

const dnd = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: (props: Parameters<typeof actual.DndContext>[0]) => {
      dnd.props = props as unknown as Record<string, unknown>;
      return createElement(actual.DndContext, props);
    },
  };
});

const STATUSES: Status[] = [
  { id: "s-todo", name: "To Do", groupId: "g1", order: 0, celebrate: false },
  { id: "s-doing", name: "Doing", groupId: "g1", order: 1, celebrate: false },
  { id: "s-done", name: "Done", groupId: "g1", order: 2, celebrate: true },
];
const GROUP: Group & { statuses: Status[] } = { id: "g1", name: "Launch", color: "#7C6EF8", ownerId: "u1", order: 0, createdAt: "", statuses: STATUSES };

function task(o: Partial<Task> & { id: string }): Task {
  return { title: o.id, groupId: "g1", statusId: "s-todo", priority: "MEDIUM", order: 0, createdBy: "u1", createdAt: "", updatedAt: "", ...o };
}
const TASKS = [task({ id: "t1", title: "Write copy" }), task({ id: "t2", title: "Ship it", statusId: "s-doing" })];

function renderBoard() {
  mockApi({ "PATCH /api/tasks/reorder": { spawned: [] } });
  const utils = render(<KanbanBoard group={GROUP} initialTasks={TASKS} userId="u1" />);
  const canvas = utils.container.querySelector<HTMLElement>(".kanban-canvas")!;
  return { ...utils, canvas };
}

const handler = <T,>(name: string) => dnd.props![name] as (e: T) => unknown;
const SNAP_ON = ["max-lg:snap-x", "max-lg:snap-mandatory"];
const active = (id: string) => ({ id, rect: { current: { initial: null, translated: null } }, data: { current: undefined } });

beforeEach(() => {
  dnd.props = null;
});

describe("KanbanBoard under lg: snapping columns", () => {
  it("the canvas snaps sideways and doesn't scroll vertically itself; desktop classes are unchanged", async () => {
    const { canvas } = renderBoard();
    await screen.findByText("Write copy");
    expect(canvas).toHaveClass(...SNAP_ON, "max-lg:overflow-y-hidden", "max-lg:scroll-px-3", "flex-1", "overflow-auto", "overscroll-contain");
    expect(canvas).not.toHaveClass("max-lg:snap-none");
    // No unprefixed snapping: desktop is as before.
    expect(canvas.className).not.toMatch(/(^|\s)snap-/);
  });

  it("each column is ~85vw (max 320px), snaps at its start, and its card list scrolls on its own", async () => {
    const { container } = renderBoard();
    await screen.findByText("Write copy");
    const columns = Array.from(container.querySelectorAll<HTMLElement>(".kanban-canvas div"))
      .filter((el) => el.classList.contains("max-lg:snap-start"));
    expect(columns).toHaveLength(3);
    for (const col of columns) {
      expect(col).toHaveClass("max-lg:w-[min(85vw,320px)]", "lg:w-72", "max-lg:snap-start", "max-lg:min-h-0", "flex-shrink-0");
      expect(col.className).not.toMatch(/(^|\s)w-\[/); // the old fixed 280px is gone below lg, lg:w-72 above
    }
    const list = screen.getByText("Write copy").closest<HTMLElement>(".min-h-\\[120px\\]")!;
    expect(list).toHaveClass("max-lg:flex-1", "max-lg:min-h-0", "max-lg:overflow-y-auto", "max-lg:overscroll-y-contain");
    // Only the vertical overscroll is contained, so a sideways swipe still reaches the board.
    expect(list.className).not.toMatch(/max-lg:overscroll-contain(\s|$)/);
  });

  it("turns snapping off while a card is dragged and back on after the drop", async () => {
    const { canvas } = renderBoard();
    await screen.findByText("Write copy");
    act(() => { handler("onDragStart")({ active: active("t1") }); });
    expect(canvas).toHaveClass("max-lg:snap-none");
    expect(canvas).not.toHaveClass(...SNAP_ON);
    await act(async () => { await handler("onDragEnd")({ active: active("t1"), over: null }); });
    expect(canvas).toHaveClass(...SNAP_ON);
    expect(canvas).not.toHaveClass("max-lg:snap-none");
  });

  it("a cancelled drag turns snapping back on (onDragCancel clears the dragged card)", async () => {
    const { canvas, container } = renderBoard();
    await screen.findByText("Write copy");
    act(() => { handler("onDragStart")({ active: active("t2") }); });
    expect(canvas).toHaveClass("max-lg:snap-none");
    expect(handler("onDragCancel")).toBeTypeOf("function");
    act(() => { handler("onDragCancel")({ active: active("t2"), over: null }); });
    expect(canvas).toHaveClass(...SNAP_ON);
    expect(canvas).not.toHaveClass("max-lg:snap-none");
    expect(within(container).getByText("Ship it")).toBeInTheDocument();
  });

  it("a drop into another column still saves the order (behaviour unchanged)", async () => {
    renderBoard();
    await screen.findByText("Write copy");
    act(() => { handler("onDragStart")({ active: active("t1") }); });
    act(() => { handler("onDragOver")({ active: active("t1"), over: { id: "s-doing" } }); });
    await act(async () => { await handler("onDragEnd")({ active: active("t1"), over: { id: "s-doing" } }); });
    const fetchMock = globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } };
    const reorder = fetchMock.mock.calls.find(([url]) => String(url) === "/api/tasks/reorder");
    expect(reorder).toBeDefined();
    const body = JSON.parse(String(reorder![1].body)) as { updates: { id: string; statusId: string }[] };
    expect(body.updates.find((u) => u.id === "t1")?.statusId).toBe("s-doing");
  });

  it("uses the mouse-and-pen pointer sensor and a 200ms touch hold", async () => {
    renderBoard();
    await screen.findByText("Write copy");
    const sensors = dnd.props!.sensors as { sensor: unknown; options: { activationConstraint: unknown } }[];
    expect(sensors.map((s) => (s.sensor as { name: string }).name)).toEqual(["MouseAndPenSensor", "TouchSensor"]);
    expect(sensors[0].sensor).toBe(MouseAndPenSensor);
    expect(sensors[0].options.activationConstraint).toEqual({ distance: 5 });
    expect(sensors[1].options.activationConstraint).toEqual({ delay: 200, tolerance: 8 });
  });

  it("header controls are 44px under lg and the status counts get a row of their own", async () => {
    renderBoard();
    await screen.findByText("Write copy");
    for (const name of ["Add column", "Project settings", "Delete project"]) {
      expect(screen.getByRole("button", { name })).toHaveClass("max-lg:h-11", "h-8");
    }
    const counts = screen.getByText("1 To Do").parentElement!;
    expect(counts).toHaveClass("max-lg:order-last", "max-lg:basis-full");
    expect(screen.getByRole("heading", { name: "Launch" })).toHaveClass("max-lg:truncate", "max-lg:min-w-0");
  });
});
