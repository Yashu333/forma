// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DatePicker from "./DatePicker";
import { freezeNow } from "../../tests/ui/fixtures";
import { restoreBrowserStubs } from "../../tests/ui/pwa-stubs";
import { stubBox, stubBreakpoint, stubViewportWidth } from "../../tests/ui/layout-stubs";

// docs/mobile-pwa/SPEC.md, P4: the date picker fits at 360px and its pill can
// take extra classes (TaskDetail passes a taller touch height under lg).

const PILL: React.CSSProperties = { display: "flex", height: "1.75rem", padding: "0 0.625rem" };

beforeEach(() => {
  freezeNow("2026-10-24T08:00:00Z"); // Saturday, 10:00 in Berlin
});
afterEach(() => restoreBrowserStubs());

function Harness({ initial = "", pillClassName, onChange }: { initial?: string; pillClassName?: string; onChange?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <DatePicker
      value={value}
      onChange={(v) => { setValue(v); onChange?.(v); }}
      pillStyle={PILL}
      pillClassName={pillClassName}
    />
  );
}

const pill = () => screen.getByRole("button", { name: /due date|Oct \d+, 2026/i, expanded: false }) as HTMLButtonElement;

describe("DatePicker: pillClassName", () => {
  it("puts the extra classes on the pill and keeps its inline style", () => {
    render(<Harness initial="2026-10-30T09:00" pillClassName="max-lg:!h-9" />);
    const b = screen.getByRole("button", { name: /Oct 30, 2026/ });
    expect(b).toHaveClass("max-lg:!h-9");
    expect(b).toHaveAttribute("aria-haspopup", "dialog");
    expect(b.style.height).toBe("1.75rem");
    expect(b.style.cursor).toBe("pointer");
    // Only the pill: the clear button keeps its own classes.
    expect(screen.getByRole("button", { name: "Clear due date" })).not.toHaveClass("max-lg:!h-9");
  });

  it("without it the pill has no class attribute at all (desktop markup unchanged)", () => {
    render(<Harness initial="" />);
    expect(pill()).not.toHaveAttribute("class");
  });

  it("the pill still opens the picker and a day can be chosen", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness initial="2026-10-30T09:00" pillClassName="max-lg:!h-9" onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /Oct 30, 2026/ }));
    const dialog = screen.getByRole("dialog", { name: "Choose due date" });
    await user.click(screen.getByRole("button", { name: "Wednesday, October 28, 2026" }));
    expect(onChange).toHaveBeenLastCalledWith("2026-10-28T09:00");
    expect(dialog).toBeInTheDocument(); // stays open to adjust the time
  });
});

describe("DatePicker: popover size", () => {
  it("is 252px on desktop and 296px (capped at the screen minus 16px gutters) under lg, set by classes not inline width", async () => {
    const user = userEvent.setup();
    render(<Harness initial="2026-10-30T09:00" />);
    await user.click(screen.getByRole("button", { name: /Oct 30, 2026/ }));
    const dialog = screen.getByRole("dialog", { name: "Choose due date" });
    expect(dialog).toHaveClass("w-[252px]", "max-lg:w-[296px]", "max-lg:max-w-[calc(100vw-2rem)]");
    expect(dialog.style.width).toBe("");
    expect(dialog.style.position).toBe("absolute");
    expect(dialog.style.left).toBe("0px");
  });
});

describe("DatePicker: stays inside the viewport", () => {
  it("under lg, a picker opened from a pill near the right edge is moved back on screen", async () => {
    stubBreakpoint(true);
    stubViewportWidth(360);
    // The due-date pill sits at x=180 in the second row of TaskDetail's pills.
    stubBox('[role="dialog"][aria-label="Choose due date"]', { left: 180, width: 296 });
    const user = userEvent.setup();
    render(<Harness initial="2026-10-30T09:00" pillClassName="max-lg:!h-9" />);
    await user.click(screen.getByRole("button", { name: /Oct 30, 2026/ }));
    const dialog = screen.getByRole("dialog", { name: "Choose due date" });
    expect(dialog.style.translate).toBe("-132px 0"); // 180+296=476 → right edge at 344
    const r = dialog.getBoundingClientRect();
    expect(r.left).toBeGreaterThanOrEqual(16);
    expect(r.right).toBeLessThanOrEqual(360 - 16);
  });

  it("at lg and up, the picker is left where it was", async () => {
    stubBreakpoint(false);
    stubViewportWidth(1280);
    stubBox('[role="dialog"][aria-label="Choose due date"]', { left: 1100, width: 252 });
    const user = userEvent.setup();
    render(<Harness initial="2026-10-30T09:00" />);
    await user.click(screen.getByRole("button", { name: /Oct 30, 2026/ }));
    expect(screen.getByRole("dialog", { name: "Choose due date" }).style.translate).toBe("");
  });

  it("closing and reopening where it fits shows it unshifted", async () => {
    stubBreakpoint(true);
    stubViewportWidth(360);
    const box = stubBox('[role="dialog"][aria-label="Choose due date"]', { left: 180, width: 296 });
    const user = userEvent.setup();
    render(<Harness initial="2026-10-30T09:00" />);
    const p = screen.getByRole("button", { name: /Oct 30, 2026/ });
    await user.click(p);
    expect(screen.getByRole("dialog", { name: "Choose due date" }).style.translate).toBe("-132px 0");
    await user.click(p);
    expect(screen.queryByRole("dialog", { name: "Choose due date" })).not.toBeInTheDocument();
    box.moveTo(20);
    await user.click(p);
    expect(screen.getByRole("dialog", { name: "Choose due date" }).style.translate).toBe("");
  });
});
