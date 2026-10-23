import { addDays, atMidnight, fractionalHour, isSameLocalDay, parseZonedDateTime } from "./calendar-dates";
import type { GoogleCalendarEvent } from "./google-calendar";

/** First hour (inclusive, event-local time) shown on the Day/Week hour grid. */
export const GRID_START_HOUR = 7;
/** Hour (exclusive, event-local time) at which the Day/Week hour grid ends. */
export const GRID_END_HOUR = 22;
/** Pixel height of a single hour row in the hour grid. */
export const HOUR_ROW_HEIGHT = 56;

export type PositionedEvent = { event: GoogleCalendarEvent; top: number; height: number };

/**
 * Converts timed events on `day` into pixel positions for the hour grid.
 *
 * Google's `dateTime` strings carry their own explicit UTC offset (e.g.
 * `"2026-10-22T09:00:00-04:00"`), and that offset — not the server's `TZ` —
 * defines the wall-clock day and hour the event should render at. So the
 * event's date/time components are read straight out of the string via
 * `parseZonedDateTime`; feeding the string through `new Date(...)` and the
 * local accessors instead would re-project the instant into whatever
 * timezone the process happens to run under (on Vercel, UTC), misplacing
 * every non-matching event by the offset difference and pushing evening
 * events onto the wrong day entirely.
 *
 * `day` itself is a plain calendar date (`new Date(y, m, d)`), so reading it
 * back with the local accessors is safe — it carries no real instant.
 * `durationHours` uses `.getTime()` subtraction, which is an absolute-instant
 * difference and therefore timezone-independent.
 *
 * All-day events (no `dateTime`) are excluded entirely; see `getAllDayEvents`.
 * Events that fall on a different day, or whose start lies outside
 * [GRID_START_HOUR, GRID_END_HOUR), are excluded (not clamped) per the v1
 * fixed-window limitation.
 */
export function layoutTimedEvents(events: GoogleCalendarEvent[], day: Date): PositionedEvent[] {
  const positioned: PositionedEvent[] = [];

  for (const event of events) {
    if (!event.start.dateTime || !event.end.dateTime) {
      continue;
    }

    const startParts = parseZonedDateTime(event.start.dateTime);

    if (!isSameLocalDay(new Date(startParts.year, startParts.month, startParts.day), day)) {
      continue;
    }

    const startHour = fractionalHour(startParts);
    if (startHour < GRID_START_HOUR || startHour >= GRID_END_HOUR) {
      continue;
    }

    const durationHours =
      (new Date(event.end.dateTime).getTime() - new Date(event.start.dateTime).getTime()) / (1000 * 60 * 60);

    positioned.push({
      event,
      top: (startHour - GRID_START_HOUR) * HOUR_ROW_HEIGHT,
      height: durationHours * HOUR_ROW_HEIGHT,
    });
  }

  return positioned;
}

/**
 * Returns the events in `events` that are all-day (no `dateTime`) and fall on `day`.
 *
 * Unlike the timed path above, this needs no offset handling: an all-day
 * event's `date` is a bare `YYYY-MM-DD` with no offset at all, so parsing it
 * as `${date}T00:00:00` yields a plain calendar date in the reading runtime,
 * which is then compared against `day` — also a plain calendar date in that
 * same runtime. Construction and comparison share one local interpretation,
 * so the result is the same under any `TZ`.
 */
export function getAllDayEvents(events: GoogleCalendarEvent[], day: Date): GoogleCalendarEvent[] {
  const target = atMidnight(day);

  return events.filter((event) => {
    if (event.start.dateTime || !event.start.date) {
      return false;
    }

    const start = new Date(`${event.start.date}T00:00:00`);
    const end = event.end.date ? new Date(`${event.end.date}T00:00:00`) : addDays(start, 1);

    return start.getTime() <= target.getTime() && target.getTime() < end.getTime();
  });
}
