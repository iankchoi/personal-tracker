import type { CalendarColorToken } from "@/lib/calendar-colors";
import type { GoogleCalendarListEntry } from "@/lib/google-calendar";

/** Fallback color token used if a rendered calendar's id is somehow missing from colorByCalendar. */
const FALLBACK_COLOR_TOKEN: CalendarColorToken = "cal";

/**
 * Ports the mockup's second `.up-next`-styled block, titled "Calendars" —
 * one `.cl-item`/`.cl-dot` per entry in `calendars`. Reused by Agenda view
 * (Task 10) alongside `MiniMonth`, so it takes no Day-view-specific props.
 *
 * Color mapping follows the same convention `HourGrid` established for
 * `.wg-event`/`.wg-chip`: `app/globals.css` has one `.cl-dot.<token>`
 * modifier per `CalendarColorToken` value, so the token string from
 * `colorByCalendar` is used directly as the CSS class name.
 */
export function CalendarsLegend({
  calendars,
  colorByCalendar,
}: {
  calendars: GoogleCalendarListEntry[];
  colorByCalendar: Record<string, CalendarColorToken>;
}) {
  return (
    <div className="up-next">
      <h2>Calendars</h2>
      <div className="cal-legend">
        {calendars.map((calendar) => {
          const colorToken = colorByCalendar[calendar.id] ?? FALLBACK_COLOR_TOKEN;
          return (
            <div key={calendar.id} className="cl-item">
              <span className={`cl-dot ${colorToken}`} />
              {calendar.summary}
            </div>
          );
        })}
      </div>
    </div>
  );
}
