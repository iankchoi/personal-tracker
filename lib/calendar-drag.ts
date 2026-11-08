import type { EventActionInput } from "./actions/calendar-events";
import { addDays, formatDateParam, parseZonedDateTime } from "./calendar-dates";
import { GRID_END_HOUR, GRID_START_HOUR, HOUR_ROW_HEIGHT } from "./calendar-layout";
import type { CalendarTaskItem } from "./calendar-tasks-for-grid";
import type { GoogleCalendarEvent } from "./google-calendar";

/** Whole-day offset from `from` to `to`, both plain local-midnight calendar dates. */
function dayDelta(from: Date, to: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/** The ISO 8601 UTC-offset suffix on an offset-carrying date-time string (e.g. `"-04:00"` or `"Z"`). */
function extractOffset(isoDateTime: string): string {
  const match = isoDateTime.match(/([+-]\d{2}:\d{2}|Z)$/);
  return match ? match[0] : "Z";
}

/** The offset suffix's value in minutes east of UTC (e.g. `"-04:00"` -> `-240`, `"Z"` -> `0`). */
function offsetToMinutes(offset: string): number {
  if (offset === "Z") {
    return 0;
  }
  const sign = offset[0] === "-" ? -1 : 1;
  const [hours, minutes] = offset.slice(1).split(":").map(Number);
  return sign * (hours * 60 + minutes);
}

/**
 * Formats an absolute instant (`utcMs`) as the wall-clock ISO string it reads
 * as under a fixed `offset` — e.g. `formatAtOffset(x, "-04:00")` gives the
 * time a clock in that offset would show, regardless of what timezone this
 * code happens to be running in. Adding the offset's minutes to a UTC instant
 * and reading it back through the `getUTC*` accessors is what makes this
 * independent of the runtime's own local timezone.
 */
function formatAtOffset(utcMs: number, offset: string): string {
  const shifted = new Date(utcMs + offsetToMinutes(offset) * 60000);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}${offset}`;
}

/** Re-formats an offset-carrying ISO date-time string onto a different calendar day, keeping its wall-clock time and offset untouched. */
function shiftDateTime(isoDateTime: string, delta: number): string {
  const parts = parseZonedDateTime(isoDateTime);
  const shiftedDay = addDays(new Date(parts.year, parts.month, parts.day), delta);
  const offset = extractOffset(isoDateTime);
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
 *
 * `fromDay` is the day whose *cell* the drag actually started from, not
 * necessarily the event's own start day: a multi-day all-day event renders a
 * chip in every day it spans (see `getAllDayEvents`), and grabbing, say, the
 * third of those chips and dropping it one cell over means "nudge by one
 * day" — not "move the whole event's start to the drop target", which is
 * what anchoring on the event's own start day would do instead.
 */
export function shiftEventToDay(
  event: GoogleCalendarEvent,
  fromDay: Date,
  targetDay: Date,
): { start: string; end: string } {
  const delta = dayDelta(fromDay, targetDay);

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
 * Builds a fresh start instant at `targetDay`/`targetHour`, preserving the
 * dragged event's own UTC offset rather than the offset of whatever
 * timezone this code happens to run in. The hour grid positions every block
 * by that event's own offset (`layoutTimedEvents` -> `parseZonedDateTime` ->
 * `fractionalHour`), so a drop computed in the *runtime's* local offset would
 * land on a different visual row than the one it was actually dropped on
 * whenever the two offsets differ (e.g. an event stored at `-07:00` viewed
 * from a server/browser running in UTC or `-04:00`). The original duration
 * is preserved for `end`.
 */
export function moveEventToSlot(
  event: GoogleCalendarEvent,
  targetDay: Date,
  targetHour: number,
): { start: string; end: string } {
  const offset = extractOffset(event.start.dateTime as string);
  const wholeHour = Math.floor(targetHour);
  const minute = Math.round((targetHour - wholeHour) * 60);
  // The wall-clock targetDay/wholeHour/minute, *as read in `offset`* — built
  // via Date.UTC and then corrected by the offset, so the result is an
  // absolute instant independent of this runtime's own local timezone.
  const startUtcMs =
    Date.UTC(targetDay.getFullYear(), targetDay.getMonth(), targetDay.getDate(), wholeHour, minute) -
    offsetToMinutes(offset) * 60000;
  const durationMs =
    new Date(event.end.dateTime as string).getTime() - new Date(event.start.dateTime as string).getTime();

  return { start: formatAtOffset(startUtcMs, offset), end: formatAtOffset(startUtcMs + durationMs, offset) };
}

/** Sets a dragged task's `dueDate` to `targetDay` and `dueTime` to `targetHour` (or `null` when dropped into the all-day row). */
export function moveTaskToSlot(
  task: CalendarTaskItem,
  targetDay: Date,
  targetHour: number | null,
): { dueDate: string; dueTime: string | null } {
  return { dueDate: formatDateParam(targetDay), dueTime: targetHour === null ? null : hourToTimeString(targetHour) };
}

/**
 * Blanks the four `EventActionInput` fields `EventEditor` documents as
 * destructive to resend untouched (see its own "Why *Touched flags" note):
 * `colorToken`/`notifyMinutesBefore`/`addGoogleMeet` each have an explicit
 * "remove this" value (`null`/`null`/`false`) that `buildEventPayload`
 * treats as a real removal rather than "leave it alone", and `guestEmails`
 * rebuilt from `attendees` carries no `responseStatus`, so resending it
 * resets every guest to `needsAction` and re-sends their invite. A drag
 * only ever means to change `start`/`end` — setting these four to
 * `undefined` is what `buildEventPayload` already reads as "don't mention
 * this field", so Google leaves the event's actual color, reminders,
 * conference data, and attendees exactly as they were.
 */
export function withoutEventClobberFields(
  mapped: EventActionInput & { eventId: string },
): EventActionInput & { eventId: string } {
  return {
    ...mapped,
    colorToken: undefined,
    notifyMinutesBefore: undefined,
    addGoogleMeet: undefined,
    guestEmails: undefined,
  };
}
