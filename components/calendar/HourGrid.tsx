import type { CalendarColorToken } from "@/lib/calendar-colors";
import {
  GRID_END_HOUR,
  GRID_START_HOUR,
  HOUR_ROW_HEIGHT,
  getAllDayEvents,
  layoutTimedEvents,
} from "@/lib/calendar-layout";
import type { GoogleCalendarEvent } from "@/lib/google-calendar";

const DOW_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** The fixed set of hour rows shown on the grid, e.g. [7, 8, ..., 21] for the default 7 AM–10 PM window. */
const GRID_HOURS = Array.from({ length: GRID_END_HOUR - GRID_START_HOUR }, (_, i) => GRID_START_HOUR + i);

/** Fallback color token used if a rendered event's calendarId is somehow missing from colorByCalendar. */
const FALLBACK_COLOR_TOKEN: CalendarColorToken = "cal";

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Local-time hour-of-day as a fractional number, e.g. 9:15 AM -> 9.25. */
function fractionalHour(date: Date): number {
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
}

/** Formats an hour-of-day (0-23) as a grid row label, e.g. 7 -> "7 AM", 12 -> "12 PM". */
function formatHourLabel(hour: number): string {
  const period = hour < 12 ? "AM" : "PM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour} ${period}`;
}

/** Formats a Date's wall-clock time for an event's subtitle, e.g. "9:00 AM". */
function formatTimeLabel(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const period = hours < 12 ? "AM" : "PM";
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHour}:${minutes.toString().padStart(2, "0")} ${period}`;
}

/**
 * Shared hour-grid presentation for both Day (1-element `days`) and Week
 * (7-element `days`) views, porting the mockup's `.week-grid`/`.day-grid`
 * markup. `events` is the flat, unfiltered list for the whole visible range;
 * this component calls `layoutTimedEvents`/`getAllDayEvents` itself, once per
 * entry in `days`, to compute each column's content.
 *
 * Color mapping: rather than collapsing the six `CalendarColorToken` values
 * down to the mockup's two example classes (`.wg-event.pers`/`.work`),
 * `app/globals.css` was extended with one modifier class per token
 * (`.wg-event.cal`/`.wk`/`.rem`/`.note`/`.jour`/`.cv`, and the `.wg-chip`
 * equivalents), each keyed to that token's existing `--*-bg`/`--*-ink`/
 * `--*-accent` custom properties. That lets the token string returned by
 * `colorByCalendar` be used directly as the CSS class name below.
 */
export function HourGrid({
  days,
  events,
  colorByCalendar,
  today,
}: {
  days: Date[];
  events: GoogleCalendarEvent[];
  colorByCalendar: Record<string, CalendarColorToken>;
  today: Date;
}) {
  const gridClassName = days.length === 1 ? "day-grid" : "week-grid";
  const now = new Date();

  return (
    <div className={gridClassName}>
      <div className="wg-corner" />

      {days.map((day, index) => (
        <div
          key={day.getTime()}
          className={isSameLocalDay(day, today) ? "wg-day-head today" : "wg-day-head"}
          style={{ gridColumn: index + 2 }}
        >
          <span className="dow">{DOW_NAMES[day.getDay()]}</span>
          <span className="num">{day.getDate()}</span>
        </div>
      ))}

      {days.map((day, index) => (
        <div key={day.getTime()} className="wg-allday" style={{ gridColumn: index + 2 }}>
          {getAllDayEvents(events, day).map((event) => {
            const colorToken = colorByCalendar[event.calendarId] ?? FALLBACK_COLOR_TOKEN;
            return (
              <span key={event.id} className={`wg-chip ${colorToken}`}>
                {event.summary}
              </span>
            );
          })}
        </div>
      ))}

      {GRID_HOURS.map((hour) => (
        <div key={hour} className="wg-hour">
          {formatHourLabel(hour)}
        </div>
      ))}

      {days.map((day, index) => {
        const isToday = isSameLocalDay(day, today);
        const nowTop = isToday ? (fractionalHour(now) - GRID_START_HOUR) * HOUR_ROW_HEIGHT : null;

        return (
          <div key={day.getTime()} className="wg-col" style={{ gridColumn: index + 2 }}>
            {GRID_HOURS.map((hour) => (
              <div key={hour} className="wg-line" />
            ))}

            {layoutTimedEvents(events, day).map(({ event, top, height }) => {
              const colorToken = colorByCalendar[event.calendarId] ?? FALLBACK_COLOR_TOKEN;
              // layoutTimedEvents only returns events with a timed start, so this is non-null.
              const start = new Date(event.start.dateTime as string);
              return (
                <div key={event.id} className={`wg-event ${colorToken}`} style={{ top, height }}>
                  <span className="et">{event.summary}</span>
                  <span className="es">{formatTimeLabel(start)}</span>
                </div>
              );
            })}

            {nowTop !== null && <div className="wg-now" style={{ top: nowTop }} />}
          </div>
        );
      })}
    </div>
  );
}
