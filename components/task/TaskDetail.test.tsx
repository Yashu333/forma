// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TaskDetail from "./TaskDetail";
import type { Status, Task } from "@/types";
import { freezeNow, mockApi, type Api } from "../../tests/ui/fixtures";
import { restoreBrowserStubs } from "../../tests/ui/pwa-stubs";
import { stubBox, stubBreakpoint, stubViewportWidth } from "../../tests/ui/layout-stubs";

// docs/mobile-pwa/SPEC.md, P4: under md the task detail is a full-screen sheet,
// its menus stay inside the viewport, subtask checkboxes and the meta pills get
// bigger touch targets, and its row controls are visible without hover under lg.

const STATUSES: Status[] = [
  { id: "s-todo", name: "To do", groupId: "g1", order: 0, celebrate: false },
  { id: "s-doing", name: "Doing", groupId: "g1", order: 1, celebrate: false },
  { id: "s-done", name: "Done", groupId: "g1", order: 2, celebrate: true },
];

function makeTask(o: Partial<Task> = {}): Task {
  return {
    id: "t1", title: "Write the report", description: null, groupId: "g1", statusId: "s-todo",
    priority: "MEDIUM", order: 0, parentTaskId: null, createdBy: "u1",
    createdAt: "2026-10-20T08:00:00Z", updatedAt: "2026-10-20T08:00:00Z",
    dueDate: null, abcde: null, abcdeRank: null, plannedFor: null, repeat: null,
    subtasks: [], comments: [],
    ...o,
  };
}

function sub(id: string, title: string, statusId = "s-todo"): Task {
  return makeTask({ id, title, statusId, parentTaskId: "t1", subtasks: undefined, comments: undefined });
}

let api: Api;
beforeEach(() => {
  freezeNow("2026-10-24T08:00:00Z");
});
afterEach(() => restoreBrowserStubs());

function setup(task: Task = makeTask(), handlers: Record<string, unknown> = {}) {
  api = mockApi(handlers as Parameters<typeof mockApi>[0]);
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(
    <TaskDetail task={task} statuses={STATUSES} userId="u1" onClose={onClose} onUpdated={vi.fn()} onDeleted={vi.fn()} />,
  );
  return { user, onClose, sheet: screen.getByRole("dialog", { name: "Task details" }) };
}

describe("TaskDetail: sheet on phones", () => {
  it("under md is a full-screen sheet (dvh height, safe-area padding, no side edge); md and up keep the 500px side panel", () => {
    const { sheet } = setup();
    expect(sheet).toHaveAttribute("aria-modal", "true");
    expect(sheet).toHaveClass(
      "max-md:max-w-none", "max-md:h-dvh", "max-md:border-l-0",
      "max-md:pt-safe", "max-md:pb-safe", "max-md:px-safe",
    );
    // Desktop/tablet classes are still there, unchanged.
    expect(sheet).toHaveClass("w-full", "max-w-[500px]", "md:w-[500px]", "h-full", "border-l", "border-border-strong");
    // No unprefixed rule fights the desktop width.
    for (const c of sheet.className.split(/\s+/)) {
      if (/^(w-|max-w-|h-)/.test(c)) expect(["w-full", "max-w-[500px]", "h-full"]).toContain(c);
    }
  });

  it("the header with Close stays outside the scrolling body, so it never scrolls away", async () => {
    const { user, onClose, sheet } = setup();
    const close = within(sheet).getByRole("button", { name: "Close" });
    const header = close.closest(".flex-shrink-0.border-b");
    expect(header).not.toBeNull();
    const body = sheet.querySelector(".overflow-y-auto");
    expect(body).not.toBeNull();
    expect(body!.contains(close)).toBe(false);
    expect(body!.contains(within(sheet).getByRole("textbox", { name: "Task title" }))).toBe(true);
    await user.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("TaskDetail: subtask checkboxes (32px hit area under lg)", () => {
  const withSubs = () => makeTask({ subtasks: [sub("st1", "Outline"), sub("st2", "Draft", "s-done")] });

  it("keep their role, accessible name and checked state; the visual box is a plain span inside", () => {
    setup(withSubs());
    const open = screen.getByRole("checkbox", { name: "Mark done: Outline" });
    const done = screen.getByRole("checkbox", { name: "Mark not done: Draft" });
    expect(open).not.toBeChecked();
    expect(done).toBeChecked();
    expect(open.tagName).toBe("BUTTON");
    expect(screen.getAllByRole("checkbox")).toHaveLength(2); // the inner span adds no role
    // 16px box on desktop, 32px button under lg, the 16px box drawn by the inner span.
    expect(open).toHaveClass("w-4", "h-4", "max-lg:w-8", "max-lg:h-8");
    const box = open.firstElementChild as HTMLElement;
    expect(box.tagName).toBe("SPAN");
    expect(box).toHaveClass("w-4", "h-4", "border", "border-input");
    expect(done.firstElementChild).toHaveClass("bg-success", "border-success");
    expect(open).toHaveAccessibleName("Mark done: Outline");
  });

  it("toggle: a click marks it done (PATCH to the Done status) and flips aria-checked and the label", async () => {
    const { user } = setup(withSubs(), {
      "PATCH /api/tasks/st1": (c: { body: { statusId: string } }) => ({ ...sub("st1", "Outline"), statusId: c.body.statusId }),
    });
    await user.click(screen.getByRole("checkbox", { name: "Mark done: Outline" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Mark not done: Outline" })).toBeChecked());
    expect(api.to("PATCH /api/tasks/st1")[0].body).toEqual({ statusId: "s-done" });
    expect(screen.getByRole("progressbar", { name: "Subtasks done" })).toHaveAttribute("aria-valuenow", "2");
  });

  it("toggle back: a done subtask goes to To do", async () => {
    const { user } = setup(withSubs(), {
      "PATCH /api/tasks/st2": (c: { body: { statusId: string } }) => ({ ...sub("st2", "Draft"), statusId: c.body.statusId }),
    });
    await user.click(screen.getByRole("checkbox", { name: "Mark not done: Draft" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Mark done: Draft" })).not.toBeChecked());
    expect(api.to("PATCH /api/tasks/st2")[0].body).toEqual({ statusId: "s-todo" });
  });

  it("works from the keyboard (Space on the focused checkbox)", async () => {
    const { user } = setup(withSubs(), {
      "PATCH /api/tasks/st1": (c: { body: { statusId: string } }) => ({ ...sub("st1", "Outline"), statusId: c.body.statusId }),
    });
    screen.getByRole("checkbox", { name: "Mark done: Outline" }).focus();
    await user.keyboard(" ");
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Mark not done: Outline" })).toBeChecked());
  });

  it("reorder and delete are always visible under lg and hover-revealed only at lg and up", () => {
    setup(withSubs());
    for (const b of [
      screen.getByRole("button", { name: "Reorder Outline" }),
      screen.getByRole("button", { name: "Delete subtask: Outline" }),
    ]) {
      expect(b).toHaveClass("opacity-100", "lg:opacity-0", "lg:group-hover/subtask:opacity-100", "focus-visible:opacity-100");
      expect(b).toHaveClass("max-lg:w-8", "max-lg:h-8");
      expect(b.className).not.toMatch(/(^|\s)sm:(opacity-0|group-hover)/);
    }
  });

  it("a comment's Delete is always visible under lg too", () => {
    setup(makeTask({ comments: [{ id: "c1", taskId: "t1", authorId: "u1", body: "Looks good", createdAt: "2026-10-23T10:00:00Z", updatedAt: "2026-10-23T10:00:00Z" }] }));
    const del = screen.getByRole("button", { name: "Delete" });
    expect(del).toHaveClass("opacity-100", "lg:opacity-0", "lg:group-hover:opacity-100");
    expect(del.className).not.toMatch(/(^|\s)sm:opacity-0/);
  });
});

describe("TaskDetail: meta pills", () => {
  it("status, priority, ABCDE, due date, repeat and plan-for-today pills grow to 36px under lg", () => {
    const { sheet } = setup();
    const names = [/^To do/, /^Medium/, /^ABCDE/, /^Due date/, /^Repeat/, /today/i];
    for (const n of names) {
      const b = within(sheet).getAllByRole("button", { name: n })[0];
      expect(b).toHaveClass("max-lg:!h-9");
      expect(b.style.height).toBe("1.75rem"); // desktop height unchanged
    }
  });
});

describe("TaskDetail: menus stay inside the viewport", () => {
  const MENU = '[role="dialog"][aria-label="Task details"] .dropdown-menu';

  it("under lg, the ABCDE menu opened near the right edge is moved back on screen", async () => {
    stubBreakpoint(true);
    stubViewportWidth(360);
    stubBox(MENU, { left: 250, width: 260 });
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /^ABCDE/ }));
    const menu = document.querySelector<HTMLElement>(MENU)!;
    expect(within(menu).getAllByRole("button")).toHaveLength(5); // A–E
    expect(menu.style.translate).toBe("-166px 0");
  });

  it("under lg, the status and priority menus are fitted too", async () => {
    stubBreakpoint(true);
    stubViewportWidth(360);
    stubBox(MENU, { left: 300, width: 160 });
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /^To do/ }));
    expect(document.querySelector<HTMLElement>(MENU)!.style.translate).toBe("-116px 0");
    await user.click(screen.getByRole("button", { name: /^Medium/ }));
    const menus = document.querySelectorAll<HTMLElement>(MENU);
    expect(menus).toHaveLength(1); // opening one closes the other
    expect(menus[0].style.translate).toBe("-116px 0");
  });

  it("at lg and up, the menus are left where they were", async () => {
    stubBreakpoint(false);
    stubViewportWidth(1280);
    stubBox(MENU, { left: 1200, width: 260 });
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /^ABCDE/ }));
    expect(document.querySelector<HTMLElement>(MENU)!.style.translate).toBe("");
  });

  it("picking a letter closes the menu; reopening where it fits shows it unshifted", async () => {
    stubBreakpoint(true);
    stubViewportWidth(360);
    const box = stubBox(MENU, { left: 250, width: 260 });
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /^ABCDE/ }));
    expect(document.querySelector<HTMLElement>(MENU)!.style.translate).toBe("-166px 0");
    await user.click(within(document.querySelector<HTMLElement>(MENU)!).getAllByRole("button")[0]);
    expect(document.querySelector(MENU)).toBeNull();
    box.moveTo(20);
    await user.click(screen.getByRole("button", { name: /^A · / }));
    expect(document.querySelector<HTMLElement>(MENU)!.style.translate).toBe("");
  });
});
