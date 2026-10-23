import type { CalendarColorToken } from "@/lib/calendar-colors";
import {
  WEEKDAY_NAMES_UPPER,
  buildWeeks,
  eventStart,
  eventStartDay,
  isSameLocalDay,
  isSameLocalMonth,
} from "@/lib/calendar-dates";
import { getAllDayEvents } from "@/lib/calendar-layout";
import type { CalendarTaskItem } from "@/lib/calendar-tasks-for-grid";
import type { GoogleCalendarEvent } from "@/lib/google-calendar";
import type { GoogleTaskList } from "@/lib/google-tasks";

/** Maximum number of event chips shown per cell before collapsing into a "+N more" summary. */
const MAX_VISIBLE_CHIPS = 3;

/** Fallback color token used if a rendered event's calendarId is somehow missing from colorByCalendar. */
const FALLBACK_COLOR_TOKEN: CalendarColorToken = "cal";

/**
 * All events (all-day or timed) that fall on `day`, all-day events first and
 * timed events sorted chronologically — mirrors `AgendaView`'s
 * `getEventsForDay`. The sort matters here as much as there: `events` merges
 * one list per calendar, each individually sorted by Google but whose
 * concatenation is not, so without it a multi-calendar day's chip order —
 * and therefore which chips land inside `MAX_VISIBLE_CHIPS` versus behind
 * "+N more" — would follow arbitrary fetch order rather than the clock.
 *
 * Unlike `layoutTimedEvents` (used by the hour grid), this does not restrict
 * timed events to the Day/Week grid's fixed hour window — Month view shows
 * every event regardless of time of day. Day membership comes from
 * `eventStartDay`, which reads each event's own offset rather than the
 * server's timezone (see lib/calendar-dates.ts).
 */
function getEventsForDay(events: GoogleCalendarEvent[], day: Date): GoogleCalendarEvent[] {
  const allDay = getAllDayEvents(events, day);
  const timed = events
    .filter((event) => event.start.dateTime && isSameLocalDay(eventStartDay(event), day))
    .sort((a, b) => eventStart(a).getTime() - eventStart(b).getTime());
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
 *
 * `tasks`/`taskLists` are threaded through by the page (Task 6) but not yet
 * rendered here — that's Task 7.
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
  tasks?: CalendarTaskItem[];
  taskLists?: GoogleTaskList[];
}) {
  const weeks = buildWeeks(referenceDate);

  return (
    <div className="month-grid">
      <div className="mg-dow-row">
        {WEEKDAY_NAMES_UPPER.map((name) => (
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
