import { offsetToMinutes } from "./calendar-drag";

export type RecurrenceEnd =
  | { type: "never" }
  | { type: "onDate"; date: string } // YYYY-MM-DD, inclusive last possible occurrence day
  | { type: "afterCount"; count: number };

export type RecurrenceRule = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number; // every N [freq units]; 1 = every unit
  end: RecurrenceEnd;
};

/** Maps JS weekday (0 = Sunday) to Google Calendar's two-letter form. */
function weekdayToGoogleCode(weekday: number): string {
  const codes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  return codes[weekday];
}

/** Formats an absolute instant as Google's `YYYYMMDDTHHMMSSZ` UTC form, via UTC accessors only — independent of the runtime's own local timezone. */
function formatUntilInstant(utcMs: number): string {
  const date = new Date(utcMs);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

/**
 * The absolute UTC instant of 23:59:59 on `dateStr` (`YYYY-MM-DD`) as read in
 * `offset` — e.g. with `offset = "-05:00"`, this is the instant a clock
 * reading `-05:00` would call `23:59:59` on that date, not a bare UTC
 * end-of-day. Mirrors `calendar-drag.ts`'s `moveEventToSlot` offset math
 * (`Date.UTC(...) - offsetToMinutes(offset) * 60000`).
 */
function endOfDayInstant(dateStr: string, offset: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  return Date.UTC(year, month - 1, day, 23, 59, 59) - offsetToMinutes(offset) * 60000;
}

/** Parses a date string in YYYYMMDDT235959Z format to YYYY-MM-DD. */
function parseUntilDate(untilStr: string): string {
  const match = untilStr.match(/(\d{4})(\d{2})(\d{2})/);
  if (!match) return "";
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/**
 * Builds an RRULE string from a RecurrenceRule and the event's start day.
 * Field order: FREQ, then INTERVAL (omitted when 1), then BYDAY (only for WEEKLY),
 * then UNTIL/COUNT depending on end type.
 *
 * `eventStartOffset` (default `"Z"`, i.e. bare UTC — this app's own writes
 * are always `Z`-suffixed instants, see `calendar-events.ts`/`EventEditor`)
 * is the event's own UTC-offset suffix (e.g. `"-05:00"`). An `onDate` end's
 * `UNTIL` is computed as end-of-day *in that offset*, not a bare UTC date —
 * a UTC-dated `UNTIL` can fall before a late-in-the-day occurrence in a
 * timezone west of UTC, silently excluding it (see this function's tests).
 */
export function buildRRule(rule: RecurrenceRule, eventStartDay: Date, eventStartOffset: string = "Z"): string {
  let rrule = `RRULE:FREQ=${rule.freq}`;

  if (rule.interval > 1) {
    rrule += `;INTERVAL=${rule.interval}`;
  }

  if (rule.freq === "WEEKLY") {
    const weekday = weekdayToGoogleCode(eventStartDay.getDay());
    rrule += `;BYDAY=${weekday}`;
  }

  if (rule.end.type === "onDate") {
    rrule += `;UNTIL=${formatUntilInstant(endOfDayInstant(rule.end.date, eventStartOffset))}`;
  } else if (rule.end.type === "afterCount") {
    rrule += `;COUNT=${rule.end.count}`;
  }

  return rrule;
}

/**
 * Parses an RRULE string back to a RecurrenceRule.
 * BYDAY is read but not stored (it's context-specific to the event's start day).
 */
export function parseRRule(line: string): RecurrenceRule {
  const parts = line.replace("RRULE:", "").split(";");
  const pairs: Record<string, string> = {};

  for (const part of parts) {
    const [key, value] = part.split("=");
    if (key && value) {
      pairs[key] = value;
    }
  }

  const freq = (pairs.FREQ || "DAILY") as "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  const interval = pairs.INTERVAL ? parseInt(pairs.INTERVAL, 10) : 1;

  let end: RecurrenceEnd = { type: "never" };

  if (pairs.UNTIL) {
    end = { type: "onDate", date: parseUntilDate(pairs.UNTIL) };
  } else if (pairs.COUNT) {
    end = { type: "afterCount", count: parseInt(pairs.COUNT, 10) };
  }

  return { freq, interval, end };
}

/**
 * Removes any existing UNTIL or COUNT from an RRULE and appends a new UNTIL
 * that ends one second before the given occurrence's own absolute instant.
 *
 * Derived directly from `occurrenceStart.getTime() - 1000` and formatted via
 * UTC accessors only (`formatUntilInstant`) — never the parsed `Date`'s LOCAL
 * accessors (`getFullYear`/`getMonth`/`getDate`), which would make the result
 * depend on the *process's own* timezone rather than the occurrence's. That
 * previous "whole day before" framing is subtly different from "one second
 * before this occurrence" when the occurrence isn't at local midnight, but
 * one-second-before is what's actually correct here and is TZ-independent
 * by construction.
 */
export function truncateRRuleBefore(line: string, occurrenceStart: Date): string {
  // Remove UNTIL and COUNT from the RRULE
  const parts = line.replace("RRULE:", "").split(";");
  const filteredParts = parts.filter((part) => !part.startsWith("UNTIL=") && !part.startsWith("COUNT="));

  // Reconstruct the RRULE
  let result = "RRULE:" + filteredParts.join(";");

  // Append new UNTIL, one second before occurrenceStart's own instant.
  result += `;UNTIL=${formatUntilInstant(occurrenceStart.getTime() - 1000)}`;

  return result;
}

/**
 * Checks if an occurrence is the first occurrence by comparing the master's start
 * with the occurrence's start. Compares parsed instants rather than the raw
 * strings, so equivalent timestamps written with different (but equally valid)
 * textual forms — e.g. a different UTC offset notation — still compare equal.
 * Handles both timed and date-only formats, since `Date` parses both.
 */
export function isFirstOccurrence(masterStart: string, occurrenceStart: string): boolean {
  return new Date(masterStart).getTime() === new Date(occurrenceStart).getTime();
}
