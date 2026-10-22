import type { CalendarColorToken } from "@/lib/calendar-colors";
import { getViewRange } from "@/lib/calendar-ranges";
import { getAllDayEvents } from "@/lib/calendar-layout";
import type { GoogleCalendarEvent, GoogleCalendarListEntry } from "@/lib/google-calendar";

import { CalendarsLegend } from "./CalendarsLegend";
import { MiniMonth } from "./MiniMonth";

const WEEKDAY_NAMES_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES_FULL = [
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

/** Length of the agenda window, matching `getViewRange("agenda", ...)` in lib/calendar-ranges.ts. */
const AGENDA_WINDOW_DAYS = 14;

/** Fallback color token used if a rendered event's calendarId is somehow missing from colorByCalendar. */
const FALLBACK_COLOR_TOKEN: CalendarColorToken = "cal";

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Adds (or subtracts, for negative counts) whole days using local-calendar arithmetic. */
function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Formats a Date's wall-clock time for a row's time slot, e.g. "9:00 AM". */
function formatTimeLabel(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const period = hours < 12 ? "AM" : "PM";
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHour}:${minutes.toString().padStart(2, "0")} ${period}`;
}

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
 * `getEventsForDay`, except timed events are explicitly sorted here since
 * `events` may combine multiple calendars whose individual lists are each
 * sorted but whose merge is not guaranteed to be.
 */
function getEventsForDay(events: GoogleCalendarEvent[], day: Date): GoogleCalendarEvent[] {
  const allDay = getAllDayEvents(events, day);
  const timed = events
    .filter((event) => event.start.dateTime && isSameLocalDay(new Date(event.start.dateTime), day))
    .sort((a, b) => new Date(a.start.dateTime as string).getTime() - new Date(b.start.dateTime as string).getTime());
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
                  const timeLabel = event.start.dateTime
                    ? formatTimeLabel(new Date(event.start.dateTime))
                    : "All day";
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
