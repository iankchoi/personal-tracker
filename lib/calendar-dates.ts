import type { GoogleCalendarEvent } from "./google-calendar";

/**
 * Shared calendar date/time helpers.
 *
 * Every view (`HourGrid`, `MonthView`, `AgendaView`, `UpNext`, `MiniMonth`)
 * and every lib module (`calendar-layout`, `calendar-ranges`) used to carry
 * its own near-identical copy of these; they live here once so a correctness
 * fix lands in one place instead of six.
 *
 * ## The two kinds of `Date` in this app, and why it matters
 *
 * 1. **Plain calendar dates** — built via `new Date(year, month, day)` and
 *    read back via the local accessors (`getFullYear`/`getMonth`/`getDate`/
 *    `getDay`). These are *date indices*, not real instants: construction and
 *    reading both go through the same runtime-local interpretation, so they're
 *    internally consistent no matter what `TZ` the process runs under.
 *    `addDays`, `atMidnight`, `buildWeeks`, `isSameLocalDay` and
 *    `isSameLocalMonth` all operate on this kind.
 *
 * 2. **Real instants parsed from Google's `dateTime` strings** — e.g.
 *    `"2026-10-22T09:00:00-04:00"`. `new Date(iso)` parses the correct
 *    absolute instant, but reading it back with the local accessors
 *    re-projects that instant into *the server's* timezone, which is not the
 *    offset the string carries. On Vercel (`TZ=UTC`) that renders a
 *    non-UTC event at the wrong hour, and an evening event on the wrong day
 *    entirely. Use `parseZonedDateTime` (and the `event*` helpers built on
 *    it) for anything that needs an event's own wall-clock date or time —
 *    never `new Date(dateTime)` plus local accessors.
 *
 * Absolute-instant arithmetic (`.getTime()` differences, chronological
 * ordering) is timezone-independent by definition and needs neither.
 */

export const WEEKDAY_NAMES_FULL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
/** Three-letter weekday names, e.g. for the "Up next" rail's "Fri 9:30 AM". */
export const WEEKDAY_NAMES_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Upper-case weekday abbreviations used by the hour-grid and month-grid headers. */
export const WEEKDAY_NAMES_UPPER = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
/** Single-letter weekday labels used by the mini-month's day-of-week row. */
export const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

export const MONTH_NAMES_FULL = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
export const MONTH_NAMES_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** The wall-clock components of a date/time, with no timezone attached. `month` is 0-based, matching `Date`. */
export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parses an ISO 8601 string carrying an explicit offset (e.g.
 * `"2026-10-22T09:00:00-04:00"` or `"2026-10-22T13:00:00Z"`) into the
 * wall-clock components *that string itself* names — by reading its literal
 * digits, never by constructing a `Date` and reading it back through the
 * runtime's local accessors. The result is therefore identical whatever
 * timezone the server runs under.
 *
 * Note this deliberately returns the offset-local wall clock as written: for
 * `"...T09:00:00-04:00"` it returns 09:00, which is the time Google says the
 * event happens at in the calendar's own timezone, and the time every view
 * should display and position it at.
 */
export function parseZonedDateTime(iso: string): ZonedParts {
  const match = ISO_DATE_TIME.exec(iso);
  if (!match) {
    throw new Error(`Unexpected ISO dateTime format: ${iso}`);
  }
  const [, year, month, day, hour, minute, second] = match;
  return {
    year: Number(year),
    month: Number(month) - 1,
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
  };
}

/**
 * Parses a date-only ISO string (`"2026-10-25"`, the shape Google uses for
 * all-day events) into its literal components. Like `parseZonedDateTime`,
 * this reads the digits directly, so it never depends on the runtime's `TZ`.
 */
function parseIsoDate(iso: string): ZonedParts {
  const match = ISO_DATE.exec(iso);
  if (!match) {
    throw new Error(`Unexpected ISO date format: ${iso}`);
  }
  const [, year, month, day] = match;
  return { year: Number(year), month: Number(month) - 1, day: Number(day), hour: 0, minute: 0, second: 0 };
}

/**
 * The wall-clock components of a `Date` as read through the runtime's local
 * accessors. Correct only for the two cases where runtime-local *is* the
 * intended frame: a plain calendar date, or a real "now" (`new Date()`).
 * Never use this on a `Date` parsed from an event's `dateTime` — that's what
 * `parseZonedDateTime` is for.
 */
export function localParts(date: Date): ZonedParts {
  return {
    year: date.getFullYear(),
    month: date.getMonth(),
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
  };
}

/** Hour-of-day as a fractional number, e.g. 9:15 -> 9.25. */
export function fractionalHour(parts: ZonedParts): number {
  return parts.hour + parts.minute / 60 + parts.second / 3600;
}

/** Normalizes a Date to local midnight, discarding any time-of-day component. */
export function atMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Adds (or subtracts, for negative counts) whole days using local-calendar arithmetic. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function isSameLocalMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/**
 * Formats a Date as `YYYY-MM-DD` in local time — the shape the `date` search
 * param, `CalendarTaskItem.dueDate`, and Google's date-only `due`/`date`
 * fields all share. `app/(app)/calendar/page.tsx` and `CalendarToolbar.tsx`
 * each still carry their own pre-existing copy of this (predating this
 * shared module's reach into those files); this export exists so new
 * call sites (Task 7's `getTasksForDay` helpers) have one to import rather
 * than adding a fourth copy.
 */
export function formatDateParam(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Google Calendar's all-day events carry an **exclusive** `end.date`: a
 * single-day event on Oct 25 is reported as `{ start: { date: "2026-10-25" },
 * end: { date: "2026-10-26" } }`, and a 3-day one ends `"2026-10-28"`. Humans
 * (and therefore the editor's two date inputs) think in *inclusive* last-days,
 * so these two helpers convert at exactly that boundary — one subtracting a day
 * on the way in from Google, the other adding it back on the way out. Both go
 * through `addDays`, so month/year rollover isn't reimplemented per call site.
 *
 * A value that isn't a `YYYY-MM-DD` date is returned unchanged rather than
 * throwing: the "out" direction is fed straight from an `<input type="date">`,
 * which reports `""` while empty or mid-edit, and a half-typed date must not
 * blow up the save path before the editor's own validation can speak.
 */
export function allDayEndToInclusive(exclusiveEndDate: string): string {
  if (!ISO_DATE.test(exclusiveEndDate)) {
    return exclusiveEndDate;
  }
  const { year, month, day } = parseIsoDate(exclusiveEndDate);
  return formatDateParam(addDays(new Date(year, month, day), -1));
}

/** The inverse of `allDayEndToInclusive` — see its doc comment. */
export function allDayEndToExclusive(inclusiveEndDate: string): string {
  if (!ISO_DATE.test(inclusiveEndDate)) {
    return inclusiveEndDate;
  }
  const { year, month, day } = parseIsoDate(inclusiveEndDate);
  return formatDateParam(addDays(new Date(year, month, day), 1));
}

/**
 * Builds the grid of weeks (each a 7-element array of Dates) covering the
 * calendar month that `referenceDate` falls in, padded with the trailing
 * days of the previous month and the leading days of the next month so every
 * week row has exactly 7 cells. The row count is computed from the month's
 * actual length and start-of-week offset (`Math.ceil(totalCells / 7)`) — not
 * hardcoded to 5 — so it correctly yields 6 rows for months whose first day
 * falls late enough in the week (e.g. a 31-day month starting on Saturday),
 * 5 for the common case, and could in principle yield 4 for a short month
 * that starts on the week's first day (28-day February starting on Sunday).
 *
 * The grid can therefore show up to 6 leading days from the previous month
 * and up to 6 trailing days from the next — which is why the Calendar page
 * pads its Month-view fetch window accordingly.
 */
export function buildWeeks(referenceDate: Date): Date[][] {
  const monthStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
  const gridStart = addDays(monthStart, -monthStart.getDay());
  const daysInMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0).getDate();
  const totalCells = monthStart.getDay() + daysInMonth;
  const weekCount = Math.ceil(totalCells / 7);

  const weeks: Date[][] = [];
  for (let week = 0; week < weekCount; week++) {
    const days: Date[] = [];
    for (let day = 0; day < 7; day++) {
      days.push(addDays(gridStart, week * 7 + day));
    }
    weeks.push(days);
  }
  return weeks;
}

/**
 * Formats an event's `dateTime` string as a wall-clock time label, e.g.
 * `"2026-10-22T09:00:00-04:00"` -> `"9:00 AM"`. Reads the string's own
 * offset-local digits via `parseZonedDateTime`, so the label matches the time
 * Google reports regardless of the server's timezone.
 */
export function formatTimeLabel(isoDateTime: string): string {
  const { hour, minute } = parseZonedDateTime(isoDateTime);
  const period = hour < 12 ? "AM" : "PM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${minute.toString().padStart(2, "0")} ${period}`;
}

/**
 * The wall-clock start components of an event — from its own `dateTime`
 * offset when timed, or from its `date` when all-day.
 */
function eventStartParts(event: GoogleCalendarEvent): ZonedParts {
  if (event.start.dateTime) {
    return parseZonedDateTime(event.start.dateTime);
  }
  return parseIsoDate(event.start.date as string);
}

/**
 * The calendar day an event starts on, as a plain calendar date (local
 * midnight) derived from the event's *own* wall clock. This is the value to
 * bucket events by day with (`isSameLocalDay`) and to take a weekday name
 * from (`getDay()`) — unlike `eventStart`, it never shifts an evening event
 * onto the next day because the server runs in a different timezone.
 */
export function eventStartDay(event: GoogleCalendarEvent): Date {
  const { year, month, day } = eventStartParts(event);
  return new Date(year, month, day);
}

/**
 * The absolute instant an event starts, for chronological ordering and
 * duration math only — both timezone-independent uses of `.getTime()`.
 * For anything that needs the event's wall-clock day or time, use
 * `eventStartDay`/`formatTimeLabel` instead.
 */
export function eventStart(event: GoogleCalendarEvent): Date {
  return event.start.dateTime ? new Date(event.start.dateTime) : new Date(`${event.start.date}T00:00:00`);
}
