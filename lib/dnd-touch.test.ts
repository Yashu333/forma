import { afterEach, describe, expect, it, vi } from "vitest";
import { PointerSensor } from "@dnd-kit/core";
import type { PointerEvent as ReactPointerEvent } from "react";
import { MouseAndPenSensor, TOUCH_SCREEN, centredOn, pointerSensorTakes } from "./dnd-touch";

function down(pointerType: string, extra: Partial<PointerEvent> = {}) {
  return { nativeEvent: { pointerType, isPrimary: true, button: 0, ...extra } } as unknown as ReactPointerEvent;
}

describe("pointerSensorTakes", () => {
  it("takes a mouse everywhere and never a finger", () => {
    for (const touchScreen of [false, true]) {
      expect(pointerSensorTakes({ pointerType: "mouse" }, touchScreen)).toBe(true);
      expect(pointerSensorTakes({ pointerType: "touch" }, touchScreen)).toBe(false);
    }
  });

  it("takes a pen only where the screen can hover; on a touch screen the stylus gets the hold like a finger", () => {
    expect(pointerSensorTakes({ pointerType: "pen" }, false)).toBe(true);
    expect(pointerSensorTakes({ pointerType: "pen" }, true)).toBe(false);
  });

  it("leaves unknown pointer types alone", () => {
    expect(pointerSensorTakes({ pointerType: "" }, false)).toBe(false);
  });
});

/** A window whose (hover: none) query answers `touchScreen`. */
function screenWith(touchScreen: boolean) {
  vi.stubGlobal("window", { matchMedia: (q: string) => ({ matches: q === TOUCH_SCREEN && touchScreen }) });
}

describe("MouseAndPenSensor", () => {
  const [activator] = MouseAndPenSensor.activators;
  afterEach(() => vi.unstubAllGlobals());

  it("listens on pointerdown like the PointerSensor", () => {
    expect(MouseAndPenSensor.activators).toHaveLength(1);
    expect(activator.eventName).toBe(PointerSensor.activators[0].eventName);
  });

  it("activates for a primary mouse or pen press and reports it", () => {
    const onActivation = vi.fn();
    expect(activator.handler(down("mouse"), { onActivation })).toBe(true);
    expect(activator.handler(down("pen"), { onActivation })).toBe(true);
    expect(onActivation).toHaveBeenCalledTimes(2);
  });

  it("on a touch screen a pen is left to the TouchSensor (cards pan there, so a pen drag would be cancelled)", () => {
    screenWith(true);
    const onActivation = vi.fn();
    expect(activator.handler(down("pen"), { onActivation })).toBe(false);
    expect(activator.handler(down("mouse"), { onActivation })).toBe(true);
    expect(onActivation).toHaveBeenCalledTimes(1);
  });

  it("where the screen can hover, a pen still drags at once", () => {
    screenWith(false);
    expect(activator.handler(down("pen"), {})).toBe(true);
  });

  it("never activates for touch, so the TouchSensor's hold delay applies", () => {
    const onActivation = vi.fn();
    expect(activator.handler(down("touch"), { onActivation })).toBe(false);
    expect(onActivation).not.toHaveBeenCalled();
  });

  it("keeps the PointerSensor's own checks (primary button only)", () => {
    expect(activator.handler(down("mouse", { button: 2 }), {})).toBe(false);
    expect(activator.handler(down("mouse", { isPrimary: false }), {})).toBe(false);
  });
});

describe("centredOn (the centerOnPointer modifier's maths)", () => {
  const rect = { top: 600, left: 16, width: 200, height: 24 };
  const transform = { x: -50, y: -300, scaleX: 1, scaleY: 1 };

  it("moves the box's centre to where it was grabbed, then follows the drag", () => {
    // Grabbed at (180, 610): 64px right of the centre (116) and 2px above it (612).
    expect(centredOn(transform, { x: 180, y: 610 }, rect)).toEqual({ x: 14, y: -302, scaleX: 1, scaleY: 1 });
  });

  it("changes nothing when it was grabbed at the centre", () => {
    expect(centredOn(transform, { x: 116, y: 612 }, rect)).toEqual(transform);
  });

  it("leaves the transform alone without coordinates or a rect", () => {
    expect(centredOn(transform, null, rect)).toBe(transform);
    expect(centredOn(transform, { x: 1, y: 1 }, null)).toBe(transform);
  });
});
