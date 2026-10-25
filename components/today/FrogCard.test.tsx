// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import FrogCard from "./FrogCard";
import type { TodayFrog } from "@/types";
import { DATE, GROUP_NODONE, GROUP_WORK, TZ, task } from "../../tests/ui/fixtures";
import { STANDALONE_QUERY } from "@/lib/pwa/use-standalone";
import { restoreBrowserStubs, stubMatchMedia } from "../../tests/ui/pwa-stubs";

const frog = (o: Partial<TodayFrog> = {}): TodayFrog => ({ ...task({ id: "f", title: "Write the report" }), subtasks: [], ...o });
const noop = () => {};
const view = (props: Partial<React.ComponentProps<typeof FrogCard>> = {}) =>
  render(<FrogCard frog={frog()} date={DATE} tz={TZ} busy={false} onEat={noop} onEditPlan={noop} {...props} />);

describe("FrogCard: closed (M5 carry-over)", () => {
  it("an open frog on an open day has an enabled 'Ate it' that calls onEat", async () => {
    const onEat = vi.fn();
    view({ onEat });
    await userEvent.click(screen.getByRole("button", { name: "Ate it" }));
    expect(onEat).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Not eaten today.")).not.toBeInTheDocument();
  });

  it("closed is off by default", () => {
    view();
    expect(screen.getByRole("button", { name: "Ate it" })).toBeEnabled();
  });

  it("closed + uneaten: 'Not eaten today.' and no button at all", () => {
    view({ closed: true });
    expect(screen.getByText("Not eaten today.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("closed + uneaten never triggers onEat", async () => {
    const onEat = vi.fn();
    view({ closed: true, onEat });
    expect(screen.queryByRole("button", { name: /ate it|eating/i })).not.toBeInTheDocument();
    expect(onEat).not.toHaveBeenCalled();
  });

  it("closed + uneaten + busy still shows the text, not 'Eating…'", () => {
    view({ closed: true, busy: true });
    expect(screen.getByText("Not eaten today.")).toBeInTheDocument();
    expect(screen.queryByText("Eating…")).not.toBeInTheDocument();
  });

  it("closed + uneaten, project with no Done column: no tooltip text and no board link", () => {
    view({ closed: true, frog: frog({ group: GROUP_NODONE, groupId: GROUP_NODONE.id }) });
    expect(screen.getByText("Not eaten today.")).toBeInTheDocument();
    expect(screen.queryByText(/no Done column/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Open the board/)).not.toBeInTheDocument();
    expect(document.querySelector('[title="This project has no Done column"]')).toBeNull();
  });

  it("closed + eaten: shows when it was eaten, not 'Not eaten today.'", () => {
    view({ closed: true, frog: frog({ completedAt: "2026-10-24T07:42:00.000Z" }) });
    expect(screen.getByText("Eaten at 9:42")).toBeInTheDocument();
    expect(screen.queryByText("Not eaten today.")).not.toBeInTheDocument();
    expect(screen.getByText("Frog eaten")).toBeInTheDocument();
  });

  it("closed + completed on a later day: 'Not eaten today.' and the card keeps the 'Today's frog' title", () => {
    view({ closed: true, frog: frog({ completedAt: "2026-10-25T08:00:00.000Z" }) });
    expect(screen.getByText("Not eaten today.")).toBeInTheDocument();
    expect(screen.getByText("Today's frog")).toBeInTheDocument();
  });

  it("closed + subtasks: progress still shows, the next bite hint stays, and there is still no button", () => {
    view({ closed: true, frog: frog({ subtasks: [task({ id: "s1", title: "Draft", order: 0 }), task({ id: "s2", title: "Send", order: 1, completedAt: "2026-10-24T05:00:00.000Z" })] }) });
    expect(screen.getByText("1 of 2 bites done")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("closed without a frog is the 'No frog chosen' placeholder with its Edit your plan button", async () => {
    const onEditPlan = vi.fn();
    view({ closed: true, frog: null, onEditPlan });
    expect(screen.getByText(/No frog chosen for today/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit your plan" }));
    expect(onEditPlan).toHaveBeenCalledTimes(1);
  });

  it("the frog title link goes to the project board in every state", () => {
    const { unmount } = view({ closed: true });
    expect(screen.getByRole("link", { name: "Write the report" })).toHaveAttribute("href", `/group/${GROUP_WORK.id}`);
    unmount();
    view({ closed: false });
    expect(screen.getByRole("link", { name: "Write the report" })).toHaveAttribute("href", `/group/${GROUP_WORK.id}`);
  });
});

// docs/mobile-pwa (P6 review): in the installed app, Focus must not open a new
// window (on iOS that's Safari, which isn't signed in). A browser tab keeps it.
describe("FrogCard: Focus link in the installed app", () => {
  afterEach(() => restoreBrowserStubs());

  it("opens /pomodoro in a new tab in the browser", () => {
    view();
    const focus = screen.getByRole("link", { name: "Focus on Write the report" });
    expect(focus).toHaveAttribute("href", "/pomodoro?task=f");
    expect(focus).toHaveAttribute("target", "_blank");
    expect(focus).toHaveAttribute("rel", "noopener");
  });

  it("stays in the app under display-mode: standalone (no target, no rel)", () => {
    stubMatchMedia([STANDALONE_QUERY]);
    view();
    const focus = screen.getByRole("link", { name: "Focus on Write the report" });
    expect(focus).toHaveAttribute("href", "/pomodoro?task=f");
    expect(focus).not.toHaveAttribute("target");
    expect(focus).not.toHaveAttribute("rel");
  });
});
