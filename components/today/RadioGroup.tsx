"use client";

import { Fragment } from "react";

/** What a radio button needs spread onto it (a real <button role="radio">). */
export interface RadioProps {
  type: "button";
  role: "radio";
  "aria-checked": boolean;
  tabIndex: number;
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
  onClick: () => void;
}

interface Props<T extends string | number> {
  /** Accessible name of the group. */
  label: string;
  values: readonly T[];
  /** The chosen value, or null when nothing is chosen yet. */
  value: T | null;
  onChange: (value: T) => void;
  className?: string;
  children: (value: T, checked: boolean, radio: RadioProps) => React.ReactNode;
}

/**
 * The radio pattern, made reusable: one tab stop
 * (the chosen value, or the first when none is), arrow keys move the choice and
 * focus together and wrap. The caller draws each option.
 */
export default function RadioGroup<T extends string | number>({ label, values, value, onChange, className, children }: Props<T>) {
  const stop = Math.max(0, values.indexOf(value as T));

  // Focus moves through the DOM (the group's radios in order), so no refs are needed.
  function onKeyDown(e: React.KeyboardEvent<HTMLElement>, index: number) {
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (step === 0 || values.length === 0) return;
    e.preventDefault();
    const next = (index + step + values.length) % values.length;
    onChange(values[next]);
    const radios = e.currentTarget.closest('[role="radiogroup"]')?.querySelectorAll<HTMLElement>('[role="radio"]');
    radios?.[next]?.focus();
  }

  return (
    <div role="radiogroup" aria-label={label} className={className}>
      {values.map((v, index) => (
        <Fragment key={String(v)}>
          {children(v, v === value, {
          type: "button",
          role: "radio",
          "aria-checked": v === value,
          tabIndex: index === stop ? 0 : -1,
          onKeyDown: (e) => onKeyDown(e, index),
          onClick: () => onChange(v),
        })}
        </Fragment>
      ))}
    </div>
  );
}
