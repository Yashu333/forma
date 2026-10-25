// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import RepeatPicker from "./RepeatPicker";
import { restoreBrowserStubs } from "../../tests/ui/pwa-stubs";
import { stubBox, stubBreakpoint, stubViewportWidth } from "../../tests/ui/layout-stubs";

// docs/mobile-pwa/SPEC.md, P4: the repeat menu stays inside the viewport on
// phones, and its pill can take extra classes (TaskDetail's taller touch height).

const PILL: React.CSSProperties = { display: "flex", height: "1.75rem", padding: "0 0.625rem" };
const ANCHOR = "2026-10-24"; // a Saturday
const MENU = ".dropdown-menu";

afterEach(() => restoreBrowserStubs());

function setup(props: Partial<React.ComponentProps<typeof RepeatPicker>> = {}) {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<RepeatPicker value={null} anchorKey={ANCHOR} onChange={onChange} pillStyle={PILL} {...props} />);
  const pill = screen.getByRole("button", { name: /repeat|every/i });
  return { user, onChange, pill };
}

describe("RepeatPicker: pillClassName", () => {
  it("puts the extra classes on the pill and keeps its inline style", () => {
    const { pill } = setup({ pillClassName: "max-lg:!h-9" });
    expect(pill).toHaveClass("max-lg:!h-9");
    expect(pill).toHaveAttribute("aria-haspopup", "true");
    expect(pill).toHaveAttribute("aria-expanded", "false");
    expect(pill.style.height).toBe("1.75rem");
  });

  it("a set rule keeps both the class and the brighter text colour", () => {
    const { pill } = setup({ pillClassName: "max-lg:!h-9", value: { freq: "day", interval: 1 } });
    expect(pill).toHaveTextContent(/every day/i);
    expect(pill).toHaveClass("max-lg:!h-9");
    expect(pill.style.color).toBe("var(--foreground)");
  });

  it("without it the pill has no class attribute at all (desktop markup unchanged)", () => {
    const { pill } = setup();
    expect(pill).not.toHaveAttribute("class");
  });

  it("the pill still opens the menu and a preset can be picked", async () => {
    const { user, onChange, pill } = setup({ pillClassName: "max-lg:!h-9" });
    await user.click(pill);
    expect(pill).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("button", { name: "Weekdays" }));
    expect(onChange).toHaveBeenCalledWith({ freq: "week", interval: 1, weekdays: [1, 2, 3, 4, 5] });
    expect(document.querySelector(MENU)).toBeNull();
  });

  it("the custom weekday toggles grow to 36px under lg and still toggle", async () => {
    const { user, onChange, pill } = setup();
    await user.click(pill);
    await user.click(screen.getByRole("button", { name: "Custom…" }));
    const group = screen.getByRole("group", { name: "Repeat on" });
    const sat = within(group).getByRole("button", { name: "Sat" });
    expect(sat).toHaveClass("max-lg:min-w-9", "max-lg:h-9", "px-2", "py-1");
    expect(sat).toHaveAttribute("aria-pressed", "true"); // the anchor's weekday
    await user.click(within(group).getByRole("button", { name: "Mon" }));
    expect(within(group).getByRole("button", { name: "Mon" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Set repeat" }));
    expect(onChange).toHaveBeenCalledWith({ freq: "week", interval: 1, weekdays: [1, 6] });
  });
});

describe("RepeatPicker: stays inside the viewport", () => {
  it("under lg, a menu opened from a pill near the right edge is moved back on screen", async () => {
    stubBreakpoint(true);
    stubViewportWidth(360);
    stubBox(MENU, { left: 230, width: 260 });
    const { user, pill } = setup({ pillClassName: "max-lg:!h-9" });
    await user.click(pill);
    const menu = document.querySelector<HTMLElement>(MENU)!;
    expect(menu.style.translate).toBe("-146px 0");
    const r = menu.getBoundingClientRect();
    expect(r.left).toBeGreaterThanOrEqual(16);
    expect(r.right).toBeLessThanOrEqual(344);
  });

  it("at lg and up, the menu is left where it was", async () => {
    stubBreakpoint(false);
    stubViewportWidth(1280);
    stubBox(MENU, { left: 1150, width: 260 });
    const { user, pill } = setup();
    await user.click(pill);
    expect(document.querySelector<HTMLElement>(MENU)!.style.translate).toBe("");
  });

  it("closing and reopening where it fits shows it unshifted", async () => {
    stubBreakpoint(true);
    stubViewportWidth(360);
    const box = stubBox(MENU, { left: 230, width: 260 });
    const { user, pill } = setup();
    await user.click(pill);
    expect(document.querySelector<HTMLElement>(MENU)!.style.translate).toBe("-146px 0");
    await user.click(pill);
    expect(document.querySelector(MENU)).toBeNull();
    box.moveTo(16);
    await user.click(pill);
    expect(document.querySelector<HTMLElement>(MENU)!.style.translate).toBe("");
  });
});
