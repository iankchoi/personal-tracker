import type { GoogleCalendarEvent } from "@/lib/google-calendar";

const SHORT_DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** The rail only has room for a handful of entries; the mockup shows 4. */
const MAX_ENTRIES = 4;

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Adds (or subtracts, for negative counts) whole days using local-calendar arithmetic. */
function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Formats a Date's wall-clock time for an event's subtitle, e.g. "9:00 AM". */
function formatTimeLabel(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const period = hours < 12 ? "AM" : "PM";
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHour}:${minutes.toString().padStart(2, "0")} ${period}`;
}

/** The moment an event starts, whether it's timed (`dateTime`) or all-day (`date`). */
function eventStart(event: GoogleCalendarEvent): Date {
  return event.start.dateTime ? new Date(event.start.dateTime) : new Date(`${event.start.date}T00:00:00`);
}

/**
 * Mixed "when" format matching the mockup: "Tomorrow" for next-day events
 * (no time shown, even if timed), a short weekday name + time for timed
 * events further out ("Fri 9:30 AM"), and the bare weekday name for all-day
 * events further out ("Sat"). Falls back to "Today" for a same-day entry,
 * which the mockup doesn't exercise but which keeps the format total.
 */
function formatWhen(event: GoogleCalendarEvent, today: Date): string {
  const start = eventStart(event);

  if (isSameLocalDay(start, today)) {
    return "Today";
  }
  if (isSameLocalDay(start, addDays(today, 1))) {
    return "Tomorrow";
  }

  const weekday = SHORT_DOW_NAMES[start.getDay()];
  return event.start.dateTime ? `${weekday} ${formatTimeLabel(start)}` : weekday;
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
