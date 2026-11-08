import { addDays, eventStartDay, formatDateParam, parseZonedDateTime } from "./calendar-dates";
import { GRID_END_HOUR, GRID_START_HOUR, HOUR_ROW_HEIGHT } from "./calendar-layout";
import type { CalendarTaskItem } from "./calendar-tasks-for-grid";
import type { GoogleCalendarEvent } from "./google-calendar";

/** Whole-day offset from `from` to `to`, both plain local-midnight calendar dates. */
function dayDelta(from: Date, to: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/** Re-formats an offset-carrying ISO date-time string onto a different calendar day, keeping its wall-clock time and offset untouched. */
function shiftDateTime(isoDateTime: string, delta: number): string {
  const parts = parseZonedDateTime(isoDateTime);
  const shiftedDay = addDays(new Date(parts.year, parts.month, parts.day), delta);
  const offsetMatch = isoDateTime.match(/([+-]\d{2}:\d{2}|Z)$/);
  const offset = offsetMatch ? offsetMatch[0] : "Z";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${shiftedDay.getFullYear()}-${pad(shiftedDay.getMonth() + 1)}-${pad(shiftedDay.getDate())}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}${offset}`;
}

/** Re-formats a bare `YYYY-MM-DD` date string onto a different calendar day. */
function shiftDateString(dateStr: string, delta: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return formatDateParam(addDays(new Date(year, month - 1, day), delta));
}

/**
 * Shifts a dragged event's `start`/`end` from Month view's "+N more"/chip
 * drag onto `targetDay`, preserving exact time-of-day (timed) or exact span
 * length (all-day, including multi-day). `end.date` for an all-day event is
 * Google's raw exclusive end — shifted by the identical delta as `start`, no
 * inclusive/exclusive conversion.
 */
export function shiftEventToDay(event: GoogleCalendarEvent, targetDay: Date): { start: string; end: string } {
  const delta = dayDelta(eventStartDay(event), targetDay);

  if (event.start.dateTime && event.end.dateTime) {
    return { start: shiftDateTime(event.start.dateTime, delta), end: shiftDateTime(event.end.dateTime, delta) };
  }

  return {
    start: shiftDateString(event.start.date as string, delta),
    end: shiftDateString(event.end.date as string, delta),
  };
}

/** Changes a dragged task's `dueDate` to `targetDay`, leaving `dueTime` untouched — Month view's day-only drag. */
export function shiftTaskToDay(task: CalendarTaskItem, targetDay: Date): { dueDate: string } {
  return { dueDate: formatDateParam(targetDay) };
}

/**
 * Converts a Week/Day hour-grid drop's pixel Y offset (relative to the day
 * column's own top) into a quarter-hour-granular hour, clamped to the grid's
 * fixed `[GRID_START_HOUR, GRID_END_HOUR)` window so a drop above or below
 * the visible grid still lands inside it.
 */
export function hourFromDropOffset(offsetY: number): number {
  const hour = GRID_START_HOUR + Math.round((offsetY / HOUR_ROW_HEIGHT) * 4) / 4;
  return Math.min(Math.max(hour, GRID_START_HOUR), GRID_END_HOUR - 0.25);
}

/** Formats a fractional hour (quarter-hour granular, e.g. `14.25`) as an `"HH:MM"` 24-hour string. */
function hourToTimeString(hour: number): string {
  const wholeHour = Math.floor(hour);
  const minute = Math.round((hour - wholeHour) * 60);
  return `${wholeHour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

/**
 * Builds a fresh start instant at `targetDay`/`targetHour` — a wholly new
 * time the user picked by dropping here, not an existing instant being
 * shifted, so this uses plain local `Date` construction (the same pattern
 * `QuickCreatePopup`'s `combineDateTime` uses for a freshly-picked date+time)
 * rather than offset-preserving string surgery. The original duration is
 * preserved for `end`.
 */
export function moveEventToSlot(
  event: GoogleCalendarEvent,
  targetDay: Date,
  targetHour: number,
): { start: string; end: string } {
  const durationMs = new Date(event.end.dateTime as string).getTime() - new Date(event.start.dateTime as string).getTime();
  const wholeHour = Math.floor(targetHour);
  const minute = Math.round((targetHour - wholeHour) * 60);
  const start = new Date(targetDay.getFullYear(), targetDay.getMonth(), targetDay.getDate(), wholeHour, minute);
  const end = new Date(start.getTime() + durationMs);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Sets a dragged task's `dueDate` to `targetDay` and `dueTime` to `targetHour` (or `null` when dropped into the all-day row). */
export function moveTaskToSlot(
  task: CalendarTaskItem,
  targetDay: Date,
  targetHour: number | null,
): { dueDate: string; dueTime: string | null } {
  return { dueDate: formatDateParam(targetDay), dueTime: targetHour === null ? null : hourToTimeString(targetHour) };
}
