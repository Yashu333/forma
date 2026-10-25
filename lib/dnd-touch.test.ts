import { describe, expect, it, vi } from "vitest";
import { PointerSensor } from "@dnd-kit/core";
import type { PointerEvent as ReactPointerEvent } from "react";
import { MouseAndPenSensor, centredOn, isMouseOrPen } from "./dnd-touch";

function down(pointerType: string, extra: Partial<PointerEvent> = {}) {
  return { nativeEvent: { pointerType, isPrimary: true, button: 0, ...extra } } as unknown as ReactPointerEvent;
}

describe("isMouseOrPen", () => {
  it("takes mouse and pen, leaves touch", () => {
    expect(isMouseOrPen({ pointerType: "mouse" })).toBe(true);
    expect(isMouseOrPen({ pointerType: "pen" })).toBe(true);
    expect(isMouseOrPen({ pointerType: "touch" })).toBe(false);
  });
});

describe("MouseAndPenSensor", () => {
  const [activator] = MouseAndPenSensor.activators;

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
