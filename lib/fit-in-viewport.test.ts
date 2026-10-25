import { describe, expect, it } from "vitest";
import { VIEWPORT_GUTTER, horizontalShift } from "./fit-in-viewport";

describe("horizontalShift", () => {
  it("leaves a box that fits where it is", () => {
    expect(horizontalShift({ left: 20, right: 180 }, 360)).toBe(0);
    expect(horizontalShift({ left: VIEWPORT_GUTTER, right: 360 - VIEWPORT_GUTTER - 1 }, 360)).toBe(0);
  });

  it("moves a box that sticks out on the right back inside the gutter", () => {
    // The ABCDE menu (260px) under a pill that starts at x=250 on a 360px phone.
    expect(horizontalShift({ left: 250, right: 510 }, 360)).toBe(-166);
  });

  it("moves a box that sticks out on the left back inside the gutter", () => {
    expect(horizontalShift({ left: -10, right: 100 }, 360)).toBe(26);
  });

  it("lines a box as wide as the space (or wider) up with the left gutter", () => {
    expect(horizontalShift({ left: 40, right: 368 }, 360)).toBe(-24);
    expect(horizontalShift({ left: 40, right: 500 }, 360)).toBe(-24);
  });

  it("takes a custom gutter", () => {
    expect(horizontalShift({ left: 300, right: 380 }, 390, 8)).toBe(0);
    expect(horizontalShift({ left: 300, right: 390 }, 390, 8)).toBe(-8);
  });
});
