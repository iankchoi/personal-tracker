"use client";

import type { CalendarColorToken } from "../../lib/calendar-colors";

/**
 * The app's 6 color tokens, each with a human label for the swatch's
 * accessible name. Order and names match the design doc's "a 6-swatch color
 * picker (our tokens, default cal/blue selected)" and this plan's brief
 * (Blue/cal, Teal/wk, Amber/rem, Green/note, Mauve/jour, Red/cv).
 */
const SWATCHES: { token: CalendarColorToken; name: string }[] = [
  { token: "cal", name: "Blue" },
  { token: "wk", name: "Teal" },
  { token: "rem", name: "Amber" },
  { token: "note", name: "Green" },
  { token: "jour", name: "Mauve" },
  { token: "cv", name: "Red" },
];

/** The default swatch shown selected when `value` is `null` — the app's blue, matching the per-event color override's "no override" default. */
const DEFAULT_TOKEN: CalendarColorToken = "cal";

/**
 * The shared 6-swatch color picker used by both the Event and Task editors.
 * A `role="radiogroup"` of 6 `role="radio"` swatches, each labeled by name
 * via `aria-label` so screen readers (and tests) can target them by color
 * name rather than by the internal `CalendarColorToken` string. `value: null`
 * (no per-item override) renders the `cal`/Blue swatch as selected, matching
 * the design doc's stated default — but still calls back with the real
 * clicked token, never `null`, since clicking a swatch is always choosing an
 * explicit override.
 */
export function ColorPicker(props: {
  value: CalendarColorToken | null;
  onChange(token: CalendarColorToken | null): void;
}) {
  const { value, onChange } = props;
  const selected = value ?? DEFAULT_TOKEN;

  return (
    <div className="color-picker" role="radiogroup" aria-label="Color">
      {SWATCHES.map((swatch) => (
        <button
          key={swatch.token}
          type="button"
          role="radio"
          aria-checked={selected === swatch.token}
          aria-label={swatch.name}
          className={`color-swatch ${swatch.token}`}
          onClick={() => onChange(swatch.token)}
        />
      ))}
    </div>
  );
}
