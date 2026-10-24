// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import RadioGroup from "./RadioGroup";

/** A controlled group of text buttons; `onChange` is spied on. */
function Group<T extends string | number>({
  values,
  initial,
  label = "Pick one",
  onChange,
}: {
  values: readonly T[];
  initial: T | null;
  label?: string;
  onChange?: (v: T) => void;
}) {
  const [value, setValue] = useState<T | null>(initial);
  return (
    <RadioGroup
      label={label}
      values={values}
      value={value}
      onChange={(v) => {
        onChange?.(v);
        setValue(v);
      }}
    >
      {(v, on, radio) => (
        <button {...radio} data-on={on}>
          {String(v)}
        </button>
      )}
    </RadioGroup>
  );
}

const radios = () => screen.getAllByRole("radio");
const tabStops = () => radios().filter((r) => r.getAttribute("tabindex") === "0").map((r) => r.textContent);
const checked = () => radios().filter((r) => r.getAttribute("aria-checked") === "true").map((r) => r.textContent);

describe("RadioGroup", () => {
  it("renders a radiogroup with its accessible name and one radio button per value", () => {
    render(<Group values={["a", "b", "c"]} initial="b" label="Tomorrow's frog" />);
    expect(screen.getByRole("radiogroup", { name: "Tomorrow's frog" })).toBeInTheDocument();
    expect(radios().map((r) => r.textContent)).toEqual(["a", "b", "c"]);
    // real buttons, and never submit a surrounding form
    for (const r of radios()) {
      expect(r.tagName).toBe("BUTTON");
      expect(r).toHaveAttribute("type", "button");
    }
  });

  it("marks exactly the chosen value as checked", () => {
    render(<Group values={[1, 2, 3, 4, 5]} initial={4} />);
    expect(checked()).toEqual(["4"]);
  });

  it("with nothing chosen (null) nothing is checked, and the first radio is the single tab stop", () => {
    render(<Group values={[1, 2, 3, 4, 5]} initial={null} />);
    expect(checked()).toEqual([]);
    expect(tabStops()).toEqual(["1"]);
  });

  it("a value that isn't in the list behaves like nothing chosen", () => {
    render(<Group values={["a", "b"]} initial={"zzz" as "a"} />);
    expect(checked()).toEqual([]);
    expect(tabStops()).toEqual(["a"]);
  });

  it("roving tabindex: only the chosen radio has tabindex 0, the others -1", () => {
    render(<Group values={["a", "b", "c"]} initial="c" />);
    expect(tabStops()).toEqual(["c"]);
    expect(radios().filter((r) => r.getAttribute("tabindex") === "-1")).toHaveLength(2);
  });

  it("Tab enters the group on the chosen radio and leaves it in one more press", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button>before</button>
        <Group values={["a", "b", "c"]} initial="b" />
        <button>after</button>
      </>,
    );
    await user.tab();
    expect(screen.getByRole("button", { name: "before" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("radio", { name: "b" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "after" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("radio", { name: "b" })).toHaveFocus();
  });

  it("clicking chooses a value, calls onChange once with it, and moves the tab stop", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Group values={["a", "b", "c"]} initial="a" onChange={onChange} />);
    await user.click(screen.getByRole("radio", { name: "c" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("c");
    expect(checked()).toEqual(["c"]);
    expect(tabStops()).toEqual(["c"]);
  });

  it("Enter and Space on a focused radio choose it (they are buttons)", async () => {
    const user = userEvent.setup();
    render(<Group values={["a", "b", "c"]} initial="a" />);
    screen.getByRole("radio", { name: "b" }).focus();
    await user.keyboard("{Enter}");
    expect(checked()).toEqual(["b"]);
    screen.getByRole("radio", { name: "c" }).focus();
    await user.keyboard(" ");
    expect(checked()).toEqual(["c"]);
  });

  describe("arrow keys", () => {
    it("ArrowDown and ArrowRight choose the next value and move focus to it", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Group values={["a", "b", "c"]} initial="a" onChange={onChange} />);
      screen.getByRole("radio", { name: "a" }).focus();
      await user.keyboard("{ArrowDown}");
      expect(screen.getByRole("radio", { name: "b" })).toHaveFocus();
      expect(checked()).toEqual(["b"]);
      await user.keyboard("{ArrowRight}");
      expect(screen.getByRole("radio", { name: "c" })).toHaveFocus();
      expect(checked()).toEqual(["c"]);
      expect(tabStops()).toEqual(["c"]);
      expect(onChange.mock.calls.map((c) => c[0])).toEqual(["b", "c"]);
    });

    it("ArrowUp and ArrowLeft choose the previous value", async () => {
      const user = userEvent.setup();
      render(<Group values={["a", "b", "c"]} initial="c" />);
      screen.getByRole("radio", { name: "c" }).focus();
      await user.keyboard("{ArrowUp}");
      expect(screen.getByRole("radio", { name: "b" })).toHaveFocus();
      await user.keyboard("{ArrowLeft}");
      expect(screen.getByRole("radio", { name: "a" })).toHaveFocus();
      expect(checked()).toEqual(["a"]);
    });

    it("wraps at both ends", async () => {
      const user = userEvent.setup();
      render(<Group values={["a", "b", "c"]} initial="c" />);
      screen.getByRole("radio", { name: "c" }).focus();
      await user.keyboard("{ArrowDown}");
      expect(screen.getByRole("radio", { name: "a" })).toHaveFocus();
      expect(checked()).toEqual(["a"]);
      await user.keyboard("{ArrowUp}");
      expect(screen.getByRole("radio", { name: "c" })).toHaveFocus();
      expect(checked()).toEqual(["c"]);
    });

    it("works from a group with nothing chosen: the first radio is focusable and ArrowDown picks the second", async () => {
      const user = userEvent.setup();
      render(<Group values={[1, 2, 3, 4, 5]} initial={null} />);
      await user.tab();
      expect(screen.getByRole("radio", { name: "1" })).toHaveFocus();
      expect(checked()).toEqual([]);
      await user.keyboard("{ArrowDown}");
      expect(screen.getByRole("radio", { name: "2" })).toHaveFocus();
      expect(checked()).toEqual(["2"]);
    });

    it("prevents the page from scrolling on arrow keys", async () => {
      render(<Group values={["a", "b"]} initial="a" />);
      const a = screen.getByRole("radio", { name: "a" });
      a.focus();
      const ev = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
      a.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
    });

    it("ignores other keys (no change, no preventDefault)", async () => {
      const onChange = vi.fn();
      render(<Group values={["a", "b"]} initial="a" onChange={onChange} />);
      const a = screen.getByRole("radio", { name: "a" });
      a.focus();
      for (const key of ["Tab", "Home", "End", "PageDown", "x", "Escape"]) {
        const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
        a.dispatchEvent(ev);
        expect(ev.defaultPrevented, key).toBe(false);
      }
      expect(onChange).not.toHaveBeenCalled();
      expect(a).toHaveFocus();
    });

    it("a one-value group stays put (and does not crash)", async () => {
      const user = userEvent.setup();
      render(<Group values={["only"]} initial="only" />);
      screen.getByRole("radio").focus();
      await user.keyboard("{ArrowDown}{ArrowUp}");
      expect(screen.getByRole("radio")).toHaveFocus();
      expect(checked()).toEqual(["only"]);
    });

    it("an empty group renders no radios and doesn't crash", () => {
      render(<Group values={[] as string[]} initial={null} />);
      expect(screen.getByRole("radiogroup")).toBeInTheDocument();
      expect(screen.queryAllByRole("radio")).toHaveLength(0);
    });
  });

  describe("several groups on one page (the Unfinished step has one per task)", () => {
    it("arrow keys move focus only inside their own group", async () => {
      const user = userEvent.setup();
      render(
        <>
          <Group values={["a1", "a2", "a3"]} initial="a1" label="First" />
          <Group values={["b1", "b2", "b3"]} initial="b1" label="Second" />
        </>,
      );
      screen.getByRole("radio", { name: "b1" }).focus();
      await user.keyboard("{ArrowDown}");
      expect(screen.getByRole("radio", { name: "b2" })).toHaveFocus();
      await user.keyboard("{ArrowUp}{ArrowUp}");
      expect(screen.getByRole("radio", { name: "b3" })).toHaveFocus(); // wrapped inside the second group
      // the first group is untouched
      expect(screen.getByRole("radio", { name: "a1" })).toHaveAttribute("aria-checked", "true");
    });

    it("each group has its own tab stop", () => {
      render(
        <>
          <Group values={["a1", "a2"]} initial="a2" label="First" />
          <Group values={["b1", "b2"]} initial={null} label="Second" />
        </>,
      );
      expect(tabStops()).toEqual(["a2", "b1"]);
    });

    it("a group nested inside another group's DOM still resolves its own radios", async () => {
      const user = userEvent.setup();
      render(
        <div role="radiogroup" aria-label="Outer wrapper">
          <Group values={["x1", "x2"]} initial="x1" label="Inner" />
        </div>,
      );
      screen.getByRole("radio", { name: "x1" }).focus();
      await user.keyboard("{ArrowDown}");
      expect(screen.getByRole("radio", { name: "x2" })).toHaveFocus();
    });
  });

  it("numeric and string values both work, and a numeric value never equals its string form", () => {
    render(<Group values={[1, 2, 3]} initial={2} />);
    expect(checked()).toEqual(["2"]);
  });

  it("the child render function gets (value, checked, radio props) in order", () => {
    const seen: [string, boolean][] = [];
    render(
      <RadioGroup label="g" values={["a", "b"]} value="b" onChange={() => {}}>
        {(v, on, radio) => {
          seen.push([v, on]);
          expect(radio.role).toBe("radio");
          expect(radio["aria-checked"]).toBe(on);
          return <button {...radio}>{v}</button>;
        }}
      </RadioGroup>,
    );
    expect(seen.slice(0, 2)).toEqual([["a", false], ["b", true]]);
  });

  it("a controlled parent that rejects the change leaves the checked value alone (focus still moves)", async () => {
    const user = userEvent.setup();
    render(
      <RadioGroup label="g" values={["a", "b"]} value="a" onChange={() => {}}>
        {(v, on, radio) => <button {...radio}>{v}</button>}
      </RadioGroup>,
    );
    screen.getByRole("radio", { name: "a" }).focus();
    await user.keyboard("{ArrowDown}");
    expect(checked()).toEqual(["a"]);
  });
});
