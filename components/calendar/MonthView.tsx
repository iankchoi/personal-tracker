import type { CalendarColorToken } from "@/lib/calendar-colors";
import { getAllDayEvents } from "@/lib/calendar-layout";
import type { GoogleCalendarEvent } from "@/lib/google-calendar";

const DOW_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** Maximum number of event chips shown per cell before collapsing into a "+N more" summary. */
const MAX_VISIBLE_CHIPS = 3;

/** Fallback color token used if a rendered event's calendarId is somehow missing from colorByCalendar. */
const FALLBACK_COLOR_TOKEN: CalendarColorToken = "cal";

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isSameLocalMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/** Adds (or subtracts, for negative counts) whole days using local-calendar arithmetic. */
function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
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
 */
function buildWeeks(referenceDate: Date): Date[][] {
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
 * All events (all-day or timed) that fall on `day`, all-day events first.
 * Unlike `layoutTimedEvents` (used by the hour grid), this does not restrict
 * timed events to the Day/Week grid's fixed hour window — Month view shows
 * every event regardless of time of day.
 */
function getEventsForDay(events: GoogleCalendarEvent[], day: Date): GoogleCalendarEvent[] {
  const allDay = getAllDayEvents(events, day);
  const timed = events.filter((event) => event.start.dateTime && isSameLocalDay(new Date(event.start.dateTime), day));
  return [...allDay, ...timed];
}

/**
 * Month view: ports the mockup's `.month-grid`/`.mg-dow-row`/`.mg-weeks`/
 * `.mg-week`/`.mg-cell` markup. Leading/trailing days from adjacent months
 * are rendered grayed-out (`.mg-cell.outside`) rather than left empty, and
 * each cell caps its visible event chips at `MAX_VISIBLE_CHIPS`, collapsing
 * any remainder into a `.mg-more` "+N more" (display-only — no click
 * handler, per this plan's read-only scope).
 *
 * Color mapping follows Task 7/8's precedent: `app/globals.css` already
 * defines one `.mg-chip` modifier class per `CalendarColorToken`
 * (`.mg-chip.cal`/`.wk`/`.rem`/`.note`/`.jour`/`.cv`), so the token string
 * returned by `colorByCalendar` is used directly as the chip's class name.
 */
export function MonthView({
  referenceDate,
  events,
  colorByCalendar,
  today,
}: {
  referenceDate: Date;
  events: GoogleCalendarEvent[];
  colorByCalendar: Record<string, CalendarColorToken>;
  today: Date;
}) {
  const weeks = buildWeeks(referenceDate);

  return (
    <div className="month-grid">
      <div className="mg-dow-row">
        {DOW_NAMES.map((name) => (
          <div className="mg-dow" key={name}>
            {name}
          </div>
        ))}
      </div>
      <div className="mg-weeks" style={{ gridTemplateRows: `repeat(${weeks.length}, 1fr)` }}>
        {weeks.map((week) => (
          <div className="mg-week" key={week[0].getTime()}>
            {week.map((day) => {
              const dayEvents = getEventsForDay(events, day);
              const visibleEvents = dayEvents.slice(0, MAX_VISIBLE_CHIPS);
              const overflowCount = dayEvents.length - visibleEvents.length;

              const classes = ["mg-cell"];
              if (!isSameLocalMonth(day, referenceDate)) classes.push("outside");
              if (isSameLocalDay(day, today)) classes.push("today");

              return (
                <div className={classes.join(" ")} key={day.getTime()}>
                  <span className="mg-date">{day.getDate()}</span>
                  {dayEvents.length > 0 && (
                    <div className="mg-events">
                      {visibleEvents.map((event) => {
                        const colorToken = colorByCalendar[event.calendarId] ?? FALLBACK_COLOR_TOKEN;
                        return (
                          <span key={event.id} className={`mg-chip ${colorToken}`}>
                            {event.summary}
                          </span>
                        );
                      })}
                      {overflowCount > 0 && <div className="mg-more">+{overflowCount} more</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
