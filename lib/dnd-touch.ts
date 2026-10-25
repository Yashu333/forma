import { PointerSensor, type Modifier, type PointerSensorOptions } from "@dnd-kit/core";
import { getEventCoordinates } from "@dnd-kit/utilities";
import type { PointerEvent as ReactPointerEvent } from "react";

// Drag and drop on touch screens (docs/mobile-pwa/SPEC.md, P5).

// dnd-kit starts a drag with the first sensor whose activator accepts the
// event. `pointerdown` fires before `touchstart`, so with the PointerSensor
// listed a finger is always caught by it (5px move, no hold) and the
// TouchSensor's 200ms hold never applies: a swipe to scroll a board column
// starts a drag instead. This pointer sensor takes the mouse, and a pen only
// where the screen can hover (a graphics tablet, a pen on a laptop). On a touch
// screen a stylus also fires touch events, and board cards there pan
// (`touch-action: manipulation`), so a stylus goes to the TouchSensor and its
// hold, like a finger.

/** The media query for a screen without hover: phones and tablets. */
export const TOUCH_SCREEN = "(hover: none)";

function onTouchScreen(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(TOUCH_SCREEN).matches;
}

/**
 * Whether the pointer sensor should take this `pointerdown`: always a mouse,
 * a pen unless it's on a touch screen (`touchScreen`), never a finger.
 */
export function pointerSensorTakes(event: Pick<PointerEvent, "pointerType">, touchScreen: boolean): boolean {
  return event.pointerType === "mouse" || (event.pointerType === "pen" && !touchScreen);
}

/** PointerSensor for the mouse (and a pen off touch screens); pair it with a TouchSensor. */
export class MouseAndPenSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: (event: ReactPointerEvent, options: PointerSensorOptions): boolean =>
        pointerSensorTakes(event.nativeEvent, onTouchScreen()) && PointerSensor.activators[0].handler(event, options),
    },
  ];
}

/**
 * Moves the dragged item so its centre sits under the pointer or finger
 * (dnd-kit's snapCenterToCursor; @dnd-kit/modifiers isn't installed). On a
 * DndContext it also moves the rect that collision detection measures, so with
 * `closestCenter` the drop goes to the target nearest the finger, not to the
 * one nearest the centre of a wide row grabbed at its middle.
 */
export const centerOnPointer: Modifier = ({ activatorEvent, draggingNodeRect, transform }) =>
  centredOn(transform, activatorEvent ? getEventCoordinates(activatorEvent) : null, draggingNodeRect);

/** `transform`, shifted so a box at `rect` that was grabbed at `at` has its centre there instead. */
export function centredOn<T extends { x: number; y: number }>(
  transform: T,
  at: { x: number; y: number } | null,
  rect: { left: number; top: number; width: number; height: number } | null,
): T {
  if (!at || !rect) return transform;
  return { ...transform, x: transform.x + at.x - rect.left - rect.width / 2, y: transform.y + at.y - rect.top - rect.height / 2 };
}
