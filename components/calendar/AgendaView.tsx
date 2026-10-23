import type { CalendarColorToken } from "@/lib/calendar-colors";
import {
  MONTH_NAMES_FULL,
  WEEKDAY_NAMES_FULL,
  addDays,
  eventStart,
  eventStartDay,
  formatTimeLabel,
  isSameLocalDay,
} from "@/lib/calendar-dates";
import { getViewRange } from "@/lib/calendar-ranges";
import { getAllDayEvents } from "@/lib/calendar-layout";
import type { GoogleCalendarEvent, GoogleCalendarListEntry } from "@/lib/google-calendar";

import { CalendarsLegend } from "./CalendarsLegend";
import { MiniMonth } from "./MiniMonth";

/** Length of the agenda window, matching `getViewRange("agenda", ...)` in lib/calendar-ranges.ts. */
const AGENDA_WINDOW_DAYS = 14;

/** Fallback color token used if a rendered event's calendarId is somehow missing from colorByCalendar. */
const FALLBACK_COLOR_TOKEN: CalendarColorToken = "cal";

/**
 * Agenda's day-group heading, matching the mockup: "Today"/"Tomorrow" for
 * those two days (relative to `today`, not `referenceDate` — a day group
 * reads "Today" only when it actually is today, even if the agenda window
 * has been navigated away from the current date), otherwise the day's full
 * weekday name (e.g. "Friday").
 */
function formatGroupLabel(day: Date, today: Date): string {
  if (isSameLocalDay(day, today)) return "Today";
  if (isSameLocalDay(day, addDays(today, 1))) return "Tomorrow";
  return WEEKDAY_NAMES_FULL[day.getDay()];
}

/**
 * Agenda's day-group `.sub` text. "Today"/"Tomorrow" groups pair with the
 * full "Weekday, Month Day" form (the weekday isn't otherwise shown); other
 * groups pair with the bare "Month Day" form, since their main label above
 * already names the weekday.
 */
function formatGroupSub(day: Date, today: Date): string {
  const monthDay = `${MONTH_NAMES_FULL[day.getMonth()]} ${day.getDate()}`;
  if (isSameLocalDay(day, today) || isSameLocalDay(day, addDays(today, 1))) {
    return `${WEEKDAY_NAMES_FULL[day.getDay()]}, ${monthDay}`;
  }
  return monthDay;
}

/**
 * All events (all-day or timed) that fall on `day`, all-day events first and
 * timed events sorted chronologically — mirrors `MonthView`'s
 * `getEventsForDay`. The sort is explicit because `events` may combine
 * multiple calendars whose individual lists are each sorted but whose merge
 * is not guaranteed to be. Day membership comes from `eventStartDay`, which
 * reads each event's own offset rather than the server's timezone (see
 * lib/calendar-dates.ts).
 */
function getEventsForDay(events: GoogleCalendarEvent[], day: Date): GoogleCalendarEvent[] {
  const allDay = getAllDayEvents(events, day);
  const timed = events
    .filter((event) => event.start.dateTime && isSameLocalDay(eventStartDay(event), day))
    .sort((a, b) => eventStart(a).getTime() - eventStart(b).getTime());
  return [...allDay, ...timed];
}

/**
 * Agenda view: ports the mockup's `.agenda-layout` — an `.agenda-col` of
 * `.agenda-group`s (one per day in the 14-day agenda window that has at
 * least one event; days with zero events are skipped entirely, matching the
 * mockup) paired with an `.agenda-rail` reusing `MiniMonth` (Task 8) and
 * `CalendarsLegend` (Task 8). Unlike Day/Week/Month, Agenda is a pure list
 * region with no grid to fall back on, so when every day in the window has
 * zero events, `.agenda-col` renders a single `.empty-block` in place of its
 * (otherwise empty) groups — the rail keeps rendering normally either way.
 *
 * `MiniMonth`'s `inRangeStart`/`inRangeEnd` are taken directly from
 * `getViewRange("agenda", referenceDate)` (lib/calendar-ranges.ts) so the
 * mini-month's highlighted range always matches the agenda's own window.
 *
 * Color mapping follows the same convention as `HourGrid`/`MonthView`:
 * `app/globals.css`'s `.src` modifier classes (`.src.cal`/`.wk`/`.rem`/
 * `.note`/`.jour`/`.cv`) are keyed one-to-one with `CalendarColorToken`
 * values, so the token string from `colorByCalendar` is used directly as
 * the row's `.src` class name.
 */
export function AgendaView({
  referenceDate,
  events,
  calendars,
  colorByCalendar,
  today,
}: {
  referenceDate: Date;
  events: GoogleCalendarEvent[];
  calendars: GoogleCalendarListEntry[];
  colorByCalendar: Record<string, CalendarColorToken>;
  today: Date;
}) {
  const { start, end } = getViewRange("agenda", referenceDate);
  const days = Array.from({ length: AGENDA_WINDOW_DAYS }, (_, index) => addDays(start, index));
  const calendarNameById = new Map(calendars.map((calendar) => [calendar.id, calendar.summary]));

  const groups = days
    .map((day) => ({ day, dayEvents: getEventsForDay(events, day) }))
    .filter(({ dayEvents }) => dayEvents.length > 0);

  return (
    <div className="agenda-layout">
      <div className="agenda-col">
        {groups.length === 0 ? (
          <div className="empty-block">No events scheduled for the next 14 days.</div>
        ) : (
          groups.map(({ day, dayEvents }) => (
            <div className="agenda-group" key={day.getTime()}>
              <div className="agenda-date">
                {formatGroupLabel(day, today)}
                <span className="sub">{formatGroupSub(day, today)}</span>
              </div>
              <div className="cards">
                {dayEvents.map((event) => {
                  const colorToken = colorByCalendar[event.calendarId] ?? FALLBACK_COLOR_TOKEN;
                  const timeLabel = event.start.dateTime ? formatTimeLabel(event.start.dateTime) : "All day";
                  const calendarName = calendarNameById.get(event.calendarId) ?? "";

                  return (
                    <div className="rowcard" key={event.id}>
                      <span className="time">{timeLabel}</span>
                      <span className="title">{event.summary}</span>
                      <span className={`src ${colorToken}`}>{calendarName}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
      <div className="agenda-rail">
        <MiniMonth referenceDate={referenceDate} selectedDate={referenceDate} inRangeStart={start} inRangeEnd={end} />
        <CalendarsLegend calendars={calendars} colorByCalendar={colorByCalendar} />
      </div>
    </div>
  );
}
