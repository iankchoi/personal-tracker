"use client";

import { useState } from "react";

import type { RecurrenceEnd, RecurrenceRule } from "../../lib/calendar-recurrence";

/** The five fixed, non-custom presets this field offers. Each maps to a fully-fixed `RecurrenceRule`: `interval: 1`, `end: { type: "never" }`. "Every weekday" is deliberately not one of them — `RecurrenceRule` has no multi-BYDAY concept, and this plan's design doc already scopes BYDAY out, so round-tripping a weekday preset through `RecurrenceRule`/`buildRRule` isn't possible without inventing a representation this feature doesn't otherwise need. The five kept here are exactly the ones the design doc's Global Constraints already cover (Daily/Weekly/Monthly/Annually), plus `Custom...`. */
const PRESET_FREQS: Record<string, RecurrenceRule["freq"]> = {
  daily: "DAILY",
  weekly: "WEEKLY",
  monthly: "MONTHLY",
  yearly: "YEARLY",
};

type CustomUnit = "days" | "weeks" | "months" | "years";

const UNIT_TO_FREQ: Record<CustomUnit, RecurrenceRule["freq"]> = {
  days: "DAILY",
  weeks: "WEEKLY",
  months: "MONTHLY",
  years: "YEARLY",
};

const FREQ_TO_UNIT: Record<RecurrenceRule["freq"], CustomUnit> = {
  DAILY: "days",
  WEEKLY: "weeks",
  MONTHLY: "months",
  YEARLY: "years",
};

type Mode = "none" | "daily" | "weekly" | "monthly" | "yearly" | "custom";

/** Reverse-maps a `RecurrenceRule` to one of the fixed preset keys, if (and only if) it exactly matches that preset's fixed shape (`interval: 1`, `end: { type: "never" }`) — anything else (a non-1 interval, a date/count end, or an unrepresented freq) is `null`, which the caller treats as "custom". */
function presetKeyFor(value: RecurrenceRule): Mode | null {
  if (value.interval !== 1 || value.end.type !== "never") {
    return null;
  }
  for (const [key, freq] of Object.entries(PRESET_FREQS)) {
    if (freq === value.freq) {
      return key as Mode;
    }
  }
  return null;
}

function initialModeFor(value: RecurrenceRule | null): Mode {
  if (value === null) {
    return "none";
  }
  return presetKeyFor(value) ?? "custom";
}

/** Parses a user-typed interval/count string, tolerating an in-progress empty value (mid-edit, e.g. right after a `clear()`) by falling back to `1` rather than producing `NaN` in the built `RecurrenceRule`. */
function parsePositiveInt(raw: string): number {
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function buildEnd(endType: RecurrenceEnd["type"], endDate: string, endCountText: string): RecurrenceEnd {
  if (endType === "onDate") {
    return { type: "onDate", date: endDate };
  }
  if (endType === "afterCount") {
    return { type: "afterCount", count: parsePositiveInt(endCountText) };
  }
  return { type: "never" };
}

/**
 * The event editor's Repeat field: a `<select aria-label="Repeat">` offering
 * the four fixed presets (Daily/Weekly/Monthly/Annually) plus a `Custom...`
 * option that reveals an interval/unit/end-condition builder. `value`/
 * `onChange` carry the resulting `RecurrenceRule | null` (`null` = "Does not
 * repeat"), matching `lib/calendar-recurrence.ts`'s type exactly. The
 * interval/unit/end-condition fields are this component's own uncontrolled
 * builder state (seeded once from `value` on mount, matching every other
 * `initial.*`-seeded `useState` in this codebase's editors) since
 * `RecurrenceRule` alone can't represent "what the user is mid-typing" —
 * every change still calls `onChange` with the fully rebuilt rule.
 */
export function RecurrenceField(props: { value: RecurrenceRule | null; onChange(rule: RecurrenceRule | null): void }) {
  const { value, onChange } = props;

  const [mode, setMode] = useState<Mode>(() => initialModeFor(value));
  const [intervalText, setIntervalText] = useState(() => String(value?.interval ?? 1));
  const [unit, setUnit] = useState<CustomUnit>(() => (value ? FREQ_TO_UNIT[value.freq] : "weeks"));
  const [endType, setEndType] = useState<RecurrenceEnd["type"]>(() => value?.end.type ?? "never");
  const [endDate, setEndDate] = useState(() => (value?.end.type === "onDate" ? value.end.date : ""));
  const [endCountText, setEndCountText] = useState(() =>
    value?.end.type === "afterCount" ? String(value.end.count) : "1",
  );

  function buildCustomRule(overrides: {
    intervalText?: string;
    unit?: CustomUnit;
    endType?: RecurrenceEnd["type"];
    endDate?: string;
    endCountText?: string;
  }): RecurrenceRule {
    const effectiveIntervalText = overrides.intervalText ?? intervalText;
    const effectiveUnit = overrides.unit ?? unit;
    const effectiveEndType = overrides.endType ?? endType;
    const effectiveEndDate = overrides.endDate ?? endDate;
    const effectiveEndCountText = overrides.endCountText ?? endCountText;
    return {
      freq: UNIT_TO_FREQ[effectiveUnit],
      interval: parsePositiveInt(effectiveIntervalText),
      end: buildEnd(effectiveEndType, effectiveEndDate, effectiveEndCountText),
    };
  }

  function handleModeChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value as Mode;
    setMode(next);
    if (next === "none") {
      onChange(null);
    } else if (next === "custom") {
      onChange(buildCustomRule({}));
    } else {
      onChange({ freq: PRESET_FREQS[next], interval: 1, end: { type: "never" } });
    }
  }

  function handleIntervalChange(event: React.ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value;
    setIntervalText(raw);
    onChange(buildCustomRule({ intervalText: raw }));
  }

  function handleUnitChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value as CustomUnit;
    setUnit(next);
    onChange(buildCustomRule({ unit: next }));
  }

  function handleEndTypeChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value as RecurrenceEnd["type"];
    setEndType(next);
    onChange(buildCustomRule({ endType: next }));
  }

  function handleEndDateChange(event: React.ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value;
    setEndDate(raw);
    onChange(buildCustomRule({ endDate: raw }));
  }

  function handleEndCountChange(event: React.ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value;
    setEndCountText(raw);
    onChange(buildCustomRule({ endCountText: raw }));
  }

  return (
    <div className="recurrence-field">
      <select aria-label="Repeat" value={mode} onChange={handleModeChange}>
        <option value="none">Does not repeat</option>
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
        <option value="yearly">Annually</option>
        <option value="custom">Custom...</option>
      </select>

      {mode === "custom" && (
        <div className="recurrence-custom">
          <label htmlFor="rf-every">Every</label>
          <input id="rf-every" type="number" min={1} aria-label="Every" value={intervalText} onChange={handleIntervalChange} />

          <label htmlFor="rf-unit">Unit</label>
          <select id="rf-unit" aria-label="Unit" value={unit} onChange={handleUnitChange}>
            <option value="days">days</option>
            <option value="weeks">weeks</option>
            <option value="months">months</option>
            <option value="years">years</option>
          </select>

          <label htmlFor="rf-ends">Ends</label>
          <select id="rf-ends" aria-label="Ends" value={endType} onChange={handleEndTypeChange}>
            <option value="never">Never</option>
            <option value="onDate">On a date</option>
            <option value="afterCount">After a number of occurrences</option>
          </select>

          {endType === "onDate" && (
            <input type="date" aria-label="End date" value={endDate} onChange={handleEndDateChange} />
          )}

          {endType === "afterCount" && (
            <input
              type="number"
              min={1}
              aria-label="Number of occurrences"
              value={endCountText}
              onChange={handleEndCountChange}
            />
          )}
        </div>
      )}
    </div>
  );
}
