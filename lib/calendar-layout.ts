import type { GoogleCalendarEvent } from "./google-calendar";

/** First hour (inclusive, local time) shown on the Day/Week hour grid. */
export const GRID_START_HOUR = 7;
/** Hour (exclusive, local time) at which the Day/Week hour grid ends. */
export const GRID_END_HOUR = 22;
/** Pixel height of a single hour row in the hour grid. */
export const HOUR_ROW_HEIGHT = 56;

export type PositionedEvent = { event: GoogleCalendarEvent; top: number; height: number };

/** Normalizes a Date to local midnight, discarding any time-of-day component. */
function atMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Local-time hour-of-day as a fractional number, e.g. 9:15 AM -> 9.25. */
function fractionalHour(date: Date): number {
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
}

/**
 * Converts timed events on `day` into pixel positions for the hour grid.
 * Google's `dateTime` strings carry an explicit UTC offset (e.g. "-04:00");
 * the native `Date` constructor correctly honors that offset, and the local
 * accessors (`getHours`/`getMinutes`) read back the wall-clock time the
 * offset encodes — using the UTC accessors here would misplace events whose
 * offset differs from the server's.
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

    const start = new Date(event.start.dateTime);
    const end = new Date(event.end.dateTime);

    if (!isSameLocalDay(start, day)) {
      continue;
    }

    const startHour = fractionalHour(start);
    if (startHour < GRID_START_HOUR || startHour >= GRID_END_HOUR) {
      continue;
    }

    const durationHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);

    positioned.push({
      event,
      top: (startHour - GRID_START_HOUR) * HOUR_ROW_HEIGHT,
      height: durationHours * HOUR_ROW_HEIGHT,
    });
  }

  return positioned;
}

/** Returns the events in `events` that are all-day (no `dateTime`) and fall on `day`. */
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

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}
