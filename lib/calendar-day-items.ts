import { eventStart, eventStartDay, formatDateParam, isSameLocalDay } from "./calendar-dates";
import { getAllDayEvents } from "./calendar-layout";
import type { CalendarTaskItem } from "./calendar-tasks-for-grid";
import type { GoogleCalendarEvent } from "./google-calendar";

/**
 * All events (all-day or timed) that fall on `day`, all-day events first and
 * timed events sorted chronologically.
 *
 * The sort is explicit because `events` merges one list per calendar, each
 * individually sorted by Google but whose concatenation is not — so without it
 * a multi-calendar day's order (and, in Month view, which items land inside
 * `MAX_VISIBLE_CHIPS` versus behind "+N more") would follow arbitrary fetch
 * order rather than the clock.
 *
 * Unlike `layoutTimedEvents` (used by the hour grid), this does not restrict
 * timed events to the Day/Week grid's fixed hour window — the list surfaces
 * that use it show every event regardless of time of day. Day membership comes
 * from `eventStartDay`, which reads each event's own offset rather than the
 * server's timezone (see lib/calendar-dates.ts).
 *
 * This lived as a byte-identical private copy in both `MonthView` and
 * `AgendaView`; it moved here once `DayDetailView` needed a third copy, so
 * "which items belong to this day" is answered in exactly one place and the
 * month cell and the day-detail list it opens can never disagree.
 */
export function getEventsForDay(events: GoogleCalendarEvent[], day: Date): GoogleCalendarEvent[] {
  const allDay = getAllDayEvents(events, day);
  const timed = events
    .filter((event) => event.start.dateTime && isSameLocalDay(eventStartDay(event), day))
    .sort((a, b) => eventStart(a).getTime() - eventStart(b).getTime());
  return [...allDay, ...timed];
}

/**
 * Tasks due on `day`. `CalendarTaskItem.dueDate` is already a bare
 * `YYYY-MM-DD` string (see lib/calendar-tasks-for-grid.ts), so this is a plain
 * string match against `day`'s own local date param — no timezone math.
 */
export function getTasksForDay(tasks: CalendarTaskItem[], day: Date): CalendarTaskItem[] {
  const dayParam = formatDateParam(day);
  return tasks.filter((task) => task.dueDate === dayParam);
}
