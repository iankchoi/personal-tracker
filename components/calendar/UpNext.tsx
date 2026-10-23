import {
  WEEKDAY_NAMES_SHORT,
  addDays,
  eventStartDay,
  formatTimeLabel,
  isSameLocalDay,
} from "@/lib/calendar-dates";
import type { GoogleCalendarEvent } from "@/lib/google-calendar";

/** The rail only has room for a handful of entries; the mockup shows 4. */
const MAX_ENTRIES = 4;

/**
 * Mixed "when" format matching the mockup: "Tomorrow" for next-day events
 * (no time shown, even if timed), a short weekday name + time for timed
 * events further out ("Fri 9:30 AM"), and the bare weekday name for all-day
 * events further out ("Sat"). Falls back to "Today" for a same-day entry,
 * which the mockup doesn't exercise but which keeps the format total.
 *
 * Which day an event counts as — and therefore whether it reads "Tomorrow"
 * or "Fri" — comes from `eventStartDay`, the event's own wall-clock day,
 * not from re-reading its instant in the server's timezone (which would
 * push a late-evening event onto the following day under `TZ=UTC`).
 */
function formatWhen(event: GoogleCalendarEvent, today: Date): string {
  const startDay = eventStartDay(event);

  if (isSameLocalDay(startDay, today)) {
    return "Today";
  }
  if (isSameLocalDay(startDay, addDays(today, 1))) {
    return "Tomorrow";
  }

  const weekday = WEEKDAY_NAMES_SHORT[startDay.getDay()];
  return event.start.dateTime ? `${weekday} ${formatTimeLabel(event.start.dateTime)}` : weekday;
}

/**
 * Day view's "Up next" rail card, ported from the mockup's `.up-next`/
 * `.un-item` markup. `upcoming` is expected to already be filtered (events
 * after the viewed day) and sorted chronologically by the caller; this
 * component only caps it at `MAX_ENTRIES` and formats each entry's "when".
 */
export function UpNext({ upcoming }: { upcoming: GoogleCalendarEvent[] }) {
  const today = new Date();
  const entries = upcoming.slice(0, MAX_ENTRIES);

  return (
    <div className="up-next">
      <h2>Up next</h2>
      {entries.map((event) => (
        <div key={event.id} className="un-item">
          <span className="when">{formatWhen(event, today)}</span>
          <span className="what">{event.summary}</span>
        </div>
      ))}
    </div>
  );
}
