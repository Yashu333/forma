// @vitest-environment jsdom
// M7: the frog-first switch on its own (props in, events out). The behaviour
// around it (optimistic save, rollback, the lock) is in TodayFrogFirst.test.tsx.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import FrogFirstToggle from "./FrogFirstToggle";

const LABEL = "Frog first: dim other tasks until the frog is eaten";

describe("FrogFirstToggle: switch semantics", () => {
  it("is a button with role=switch, a real <button type=button>, named by its visible label", () => {
    render(<FrogFirstToggle checked={false} onToggle={() => {}} />);
    const sw = screen.getByRole("switch", { name: LABEL });
    expect(sw.tagName).toBe("BUTTON");
    expect(sw).toHaveAttribute("type", "button");
    expect(sw).not.toHaveAttribute("disabled");
    // the label text lives INSIDE the button, so the whole row is the hit area and the name is the visible text
    expect(sw).toHaveTextContent(LABEL);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("reflects `checked` in aria-checked (and nothing else exposes the state)", () => {
    const { rerender } = render(<FrogFirstToggle checked={false} onToggle={() => {}} />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch")).not.toBeChecked();
    rerender(<FrogFirstToggle checked onToggle={() => {}} />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch")).toBeChecked();
  });

  it("the visual track and knob are hidden from assistive tech", () => {
    const { container } = render(<FrogFirstToggle checked onToggle={() => {}} />);
    const hidden = container.querySelectorAll('[aria-hidden="true"]');
    expect(hidden.length).toBeGreaterThanOrEqual(1);
    for (const el of hidden) expect(el.textContent).toBe("");
  });

  it("is a tab stop (focusable), and does not set tabindex", async () => {
    const user = userEvent.setup();
    render(<FrogFirstToggle checked={false} onToggle={() => {}} />);
    await user.tab();
    expect(screen.getByRole("switch")).toHaveFocus();
    expect(screen.getByRole("switch")).not.toHaveAttribute("tabindex");
  });

  it("a click calls onToggle once, with no arguments needed", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<FrogFirstToggle checked={false} onToggle={onToggle} />);
    await user.click(screen.getByRole("switch"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("clicking the label text (inside the button) toggles too", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<FrogFirstToggle checked={false} onToggle={onToggle} />);
    await user.click(screen.getByText(LABEL));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("Space toggles", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<FrogFirstToggle checked={false} onToggle={onToggle} />);
    await user.tab();
    await user.keyboard(" ");
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("Enter toggles", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<FrogFirstToggle checked={false} onToggle={onToggle} />);
    await user.tab();
    await user.keyboard("{Enter}");
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("other keys do nothing", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<FrogFirstToggle checked={false} onToggle={onToggle} />);
    await user.tab();
    await user.keyboard("a{Escape}{ArrowRight}{ArrowDown}");
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("is controlled: a click does not flip aria-checked by itself", async () => {
    const user = userEvent.setup();
    render(<FrogFirstToggle checked={false} onToggle={() => {}} />);
    await user.click(screen.getByRole("switch"));
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });
});

describe("FrogFirstToggle: error", () => {
  it("shows no alert without an error (undefined, null or empty)", () => {
    for (const error of [undefined, null, ""]) {
      const { unmount } = render(<FrogFirstToggle checked={false} onToggle={() => {}} error={error} />);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("shows the message in a role=alert next to the switch", () => {
    render(<FrogFirstToggle checked={false} onToggle={() => {}} error="Couldn't save that setting" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't save that setting");
    // the alert is NOT inside the switch (it would otherwise become part of the switch's accessible name)
    expect(screen.getByRole("switch")).not.toContainElement(screen.getByRole("alert"));
    expect(screen.getByRole("switch", { name: LABEL })).toBeInTheDocument();
  });

  it("renders a message as text, never as markup", () => {
    render(<FrogFirstToggle checked={false} onToggle={() => {}} error={'<img src=x onerror="alert(1)">'} />);
    expect(screen.getByRole("alert").querySelector("img")).toBeNull();
  });
});

describe("FrogFirstToggle: narrow layout (375px) by classes", () => {
  it("the button can shrink and wrap: max-w-full, full width on mobile, min-w-0 + break-words label, 44px minimum height", () => {
    render(<FrogFirstToggle checked={false} onToggle={() => {}} />);
    const sw = screen.getByRole("switch");
    expect(sw.className).toContain("max-w-full");
    expect(sw.className).toContain("w-full");
    expect(sw.className).toContain("sm:w-auto");
    expect(sw.className).toContain("min-h-11");
    const label = screen.getByText(LABEL);
    expect(label.className).toContain("min-w-0");
    expect(label.className).toContain("break-words");
  });

  it("the track doesn't shrink (flex-shrink-0) so a long label can't squash it", () => {
    const { container } = render(<FrogFirstToggle checked={false} onToggle={() => {}} />);
    expect(container.querySelector('[aria-hidden="true"]')!.className).toContain("flex-shrink-0");
  });

  it("an error message may break long words", () => {
    render(<FrogFirstToggle checked={false} onToggle={() => {}} error="x" />);
    expect(screen.getByRole("alert").className).toContain("break-words");
  });
});

describe("FrogFirstToggle: server render and hydration", () => {
  it.each([false, true])("renders the same markup on the server and hydrates without a warning (checked=%s)", async (checked) => {
    const html = renderToString(<FrogFirstToggle checked={checked} onToggle={() => {}} error={checked ? "oops" : null} />);
    expect(html).toContain('role="switch"');
    expect(html).toContain(`aria-checked="${checked}"`);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, <FrogFirstToggle checked={checked} onToggle={() => {}} error={checked ? "oops" : null} />);
    });
    expect(errors).not.toHaveBeenCalled();
    act(() => root.unmount());
    container.remove();
  });
});
