// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFitInViewport } from "@/lib/fit-in-viewport";
import { restoreBrowserStubs } from "../../tests/ui/pwa-stubs";
import { stubBox, stubBreakpoint, stubViewportWidth } from "../../tests/ui/layout-stubs";

// docs/mobile-pwa/SPEC.md, P4: dropdown menus and the date picker stay inside
// the viewport on phones. useFitInViewport nudges an open popover sideways with
// CSS `translate`, only under lg; desktop is never touched.

afterEach(() => restoreBrowserStubs());

/** A pill and its popover, rendered only while open (how every caller uses the hook). */
function Popover({ gutter }: { gutter?: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useFitInViewport(ref, open, gutter);
  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)}>Toggle</button>
      {open && <div ref={ref} data-testid="pop" className="pop">Menu</div>}
    </div>
  );
}

/** Same, but the popover stays mounted (hidden) while closed. */
function MountedPopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useFitInViewport(ref, open);
  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)}>Toggle</button>
      <div ref={ref} data-testid="pop" className="pop" hidden={!open}>Menu</div>
    </div>
  );
}

async function openIt(Component: React.ComponentType<{ gutter?: number }> = Popover, gutter?: number) {
  const user = userEvent.setup();
  render(<Component gutter={gutter} />);
  await user.click(screen.getByRole("button", { name: "Toggle" }));
  return { user, pop: screen.getByTestId("pop") };
}

describe("useFitInViewport", () => {
  it("under lg, pulls a menu that sticks out on the right back inside the 16px gutter", async () => {
    stubBreakpoint(true);
    stubViewportWidth(360);
    // The ABCDE menu (260px) under a pill that starts at x=250 on a 360px phone.
    stubBox(".pop", { left: 250, width: 260 });
    const { pop } = await openIt();
    expect(pop.style.translate).toBe("-166px 0");
    // Where it ends up: 84 → 344, i.e. 16px clear of the right edge.
    const r = pop.getBoundingClientRect();
    expect(r.left).toBe(84);
    expect(r.right).toBe(344);
  });

  it("under lg, pushes a menu that sticks out on the left back to the gutter", async () => {
    stubBreakpoint(true);
    stubViewportWidth(390);
    stubBox(".pop", { left: -10, width: 160 });
    const { pop } = await openIt();
    expect(pop.style.translate).toBe("26px 0");
  });

  it("under lg, leaves a menu that already fits alone", async () => {
    stubBreakpoint(true);
    stubViewportWidth(360);
    stubBox(".pop", { left: 20, width: 252 });
    const { pop } = await openIt();
    expect(pop.style.translate).toBe("");
  });

  it("under lg, a menu as wide as the space between the gutters is lined up with the left gutter", async () => {
    stubBreakpoint(true);
    stubViewportWidth(360);
    stubBox(".pop", { left: 60, width: 328 }); // max-w-[calc(100vw-2rem)] at 360
    const { pop } = await openIt();
    expect(pop.style.translate).toBe("-44px 0");
  });

  it("uses a custom gutter", async () => {
    stubBreakpoint(true);
    stubViewportWidth(360);
    stubBox(".pop", { left: 200, width: 200 });
    const { pop } = await openIt(Popover, 8);
    expect(pop.style.translate).toBe("-48px 0");
  });

  it("falls back to innerWidth when the root element reports no width", async () => {
    stubBreakpoint(true);
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(0);
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(360);
    stubBox(".pop", { left: 250, width: 260 });
    const { pop } = await openIt();
    expect(pop.style.translate).toBe("-166px 0");
  });

  it("at lg and up (desktop), never measures or moves the menu, even when it sticks out", async () => {
    stubBreakpoint(false);
    stubViewportWidth(1280);
    const box = stubBox(".pop", { left: 1200, width: 260 });
    const { pop } = await openIt();
    expect(pop.style.translate).toBe("");
    expect(pop.getAttribute("style")).toBeNull();
    expect(box.spy.mock.contexts.filter((el) => (el as HTMLElement).matches?.(".pop"))).toHaveLength(0);
  });

  it("without matchMedia (very old browsers, SSR-like environments), leaves the menu alone", async () => {
    // jsdom has no matchMedia unless a test stubs it.
    expect(typeof window.matchMedia).toBe("undefined");
    stubViewportWidth(360);
    stubBox(".pop", { left: 250, width: 260 });
    const { pop } = await openIt();
    expect(pop.style.translate).toBe("");
  });

  it("is reset on close: reopening where it fits shows the menu unshifted", async () => {
    stubBreakpoint(true);
    stubViewportWidth(360);
    const box = stubBox(".pop", { left: 250, width: 260 });
    const { user, pop } = await openIt();
    expect(pop.style.translate).toBe("-166px 0");

    await user.click(screen.getByRole("button", { name: "Toggle" }));
    expect(screen.queryByTestId("pop")).not.toBeInTheDocument();

    box.moveTo(20); // e.g. the sheet was scrolled or rotated, the pill now sits on the left
    await user.click(screen.getByRole("button", { name: "Toggle" }));
    expect(screen.getByTestId("pop").style.translate).toBe("");
  });

  it("re-measures from the untranslated position each time it opens (no shift piles up)", async () => {
    stubBreakpoint(true);
    stubViewportWidth(360);
    stubBox(".pop", { left: 250, width: 260 });
    const { user, pop } = await openIt(MountedPopover);
    expect(pop.style.translate).toBe("-166px 0");
    await user.click(screen.getByRole("button", { name: "Toggle" })); // close
    await user.click(screen.getByRole("button", { name: "Toggle" })); // open again
    expect(pop.style.translate).toBe("-166px 0");
  });

  it("is reset on close for a popover that stays mounted", async () => {
    stubBreakpoint(true);
    stubViewportWidth(360);
    stubBox(".pop", { left: 250, width: 260 });
    const { user, pop } = await openIt(MountedPopover);
    expect(pop.style.translate).toBe("-166px 0");
    await user.click(screen.getByRole("button", { name: "Toggle" })); // close
    expect(pop.style.translate).toBe("");
  });

  it("switching from phone to desktop between openings leaves the desktop menu untouched", async () => {
    const mq = stubBreakpoint(true);
    stubViewportWidth(360);
    stubBox(".pop", { left: 250, width: 260 });
    const { user, pop } = await openIt();
    expect(pop.style.translate).toBe("-166px 0");
    await user.click(screen.getByRole("button", { name: "Toggle" })); // close
    mq.list("(width < 64rem)").matches = false; // rotated a tablet / resized past lg
    await user.click(screen.getByRole("button", { name: "Toggle" }));
    expect(screen.getByTestId("pop").style.translate).toBe("");
  });

  it("a popover that stays mounted carries no phone shift into desktop", async () => {
    const mq = stubBreakpoint(true);
    stubViewportWidth(360);
    stubBox(".pop", { left: 250, width: 260 });
    const { user, pop } = await openIt(MountedPopover);
    expect(pop.style.translate).toBe("-166px 0");
    await user.click(screen.getByRole("button", { name: "Toggle" })); // close
    mq.list("(width < 64rem)").matches = false;
    await user.click(screen.getByRole("button", { name: "Toggle" })); // open on desktop
    expect(pop.style.translate).toBe("");
  });
});
