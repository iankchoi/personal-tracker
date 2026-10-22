import { auth } from "../../../auth";
import { CalendarToolbar } from "../../../components/calendar/CalendarToolbar";
import { ReconnectBanner } from "../../../components/calendar/ReconnectBanner";
import { AgendaView } from "../../../components/calendar/AgendaView";
import { DayView } from "../../../components/calendar/DayView";
import { MonthView } from "../../../components/calendar/MonthView";
import { WeekView } from "../../../components/calendar/WeekView";
import { getGoogleAccessToken } from "../../../lib/google-token";
import {
  listCalendars,
  listEvents,
  type GoogleCalendarEvent,
  type GoogleCalendarListEntry,
} from "../../../lib/google-calendar";
import { assignCalendarColors, type CalendarColorToken } from "../../../lib/calendar-colors";
import { getViewRange, type ViewType } from "../../../lib/calendar-ranges";

// This page reads the signed-in session (cookies) directly via `auth()`, so
// it can't be statically prerendered under Cache Components — opt it out of
// the static/instant path, same reasoning as the Settings pages.
export const instant = false;

const VALID_VIEWS: ViewType[] = ["day", "week", "month", "agenda"];

/** Formats a Date as `YYYY-MM-DD` in local time, matching the `date` search param's shape. */
function formatDateParam(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Parses the `view` search param, falling back to "week" for anything missing or unrecognized. */
function parseView(raw: string | undefined): ViewType {
  return VALID_VIEWS.includes(raw as ViewType) ? (raw as ViewType) : "week";
}

/** Parses the `date` search param (`YYYY-MM-DD`), falling back to today for anything missing or malformed. */
function parseDate(raw: string | undefined): Date {
  if (raw) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (match) {
      const [, yearStr, monthStr, dayStr] = match;
      const parsed = new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr));
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
  }
  return new Date();
}

/** Adds (or subtracts, for negative counts) whole days using local-calendar arithmetic. */
function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** The moment an event starts, whether it's timed (`dateTime`) or all-day (`date`). */
function eventStart(event: GoogleCalendarEvent): Date {
  return event.start.dateTime ? new Date(event.start.dateTime) : new Date(`${event.start.date}T00:00:00`);
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string }>;
}) {
  const params = await searchParams;
  const view = parseView(params.view);
  const date = parseDate(params.date);

  // app/(app)/layout.tsx has already redirected unauthenticated requests to
  // /sign-in before this page renders, so `session` is guaranteed non-null.
  const session = await auth();
  const tokenResult = await getGoogleAccessToken(session!.user.id);

  if (tokenResult.needsGoogleReconnect) {
    return (
      <div className="cal-col">
        <CalendarToolbar view={view} date={date} />
        <ReconnectBanner />
      </div>
    );
  }

  const { accessToken } = tokenResult;
  const range = getViewRange(view, date);

  // Day view's "Up next" rail (UpNext, Task 8) needs events from days after
  // the one being viewed, not just the viewed day itself — so for Day view
  // only, widen the fetch window to the same 14-day span Agenda view already
  // uses (reusing `getViewRange("agenda", ...)` rather than inventing new
  // date math here). `fetchRange` always starts at the view's own range
  // start, so this is a pure superset for every other view.
  const fetchRange = view === "day" ? getViewRange("agenda", date) : range;

  // Fetching only — no JSX is constructed inside this try/catch, since a
  // rendering error thrown by a child component wouldn't be caught here
  // anyway (React doesn't render JSX synchronously); only the awaited data
  // fetches below are what this try/catch is meant to guard.
  let calendars: GoogleCalendarListEntry[];
  let colorByCalendar: Record<string, CalendarColorToken>;
  let allEvents: GoogleCalendarEvent[];

  try {
    calendars = await listCalendars(accessToken);
    colorByCalendar = assignCalendarColors(calendars.map((calendar) => calendar.id));

    const eventLists = await Promise.all(
      calendars.map((calendar) =>
        listEvents(accessToken, calendar.id, fetchRange.start.toISOString(), fetchRange.end.toISOString()),
      ),
    );
    allEvents = eventLists.flat();
  } catch (error) {
    console.error("Failed to load calendar data:", error);

    return (
      <div className="cal-col">
        <CalendarToolbar view={view} date={date} />
        <div className="error-block">
          <span className="error-dot" />
          <span>Couldn&apos;t load your calendar.</span>
          <a className="error-retry" href={`/calendar?view=${view}&date=${formatDateParam(date)}`}>
            Retry
          </a>
        </div>
      </div>
    );
  }

  // A Week/Day/Month/Agenda grid with zero events for the viewed range is a
  // normal, expected state (just an empty grid/rail) — not a broken page —
  // so there's no page-level "is this range empty" check here. Agenda is the
  // one exception: it's a pure list region with no grid to fall back on, so
  // it renders its own `.empty-block` internally when it has nothing to show
  // (see AgendaView.tsx).
  return (
    <div className="cal-col">
      <CalendarToolbar view={view} date={date} />
      {view === "week" && <WeekView referenceDate={date} events={allEvents} colorByCalendar={colorByCalendar} />}
      {view === "day" && (
        <DayView
          referenceDate={date}
          events={allEvents}
          calendars={calendars}
          colorByCalendar={colorByCalendar}
          upcoming={allEvents
            .filter((event) => eventStart(event).getTime() >= addDays(date, 1).getTime())
            .sort((a, b) => eventStart(a).getTime() - eventStart(b).getTime())}
        />
      )}
      {view === "month" && (
        <MonthView referenceDate={date} events={allEvents} colorByCalendar={colorByCalendar} today={new Date()} />
      )}
      {view === "agenda" && (
        <AgendaView
          referenceDate={date}
          events={allEvents}
          calendars={calendars}
          colorByCalendar={colorByCalendar}
          today={new Date()}
        />
      )}
    </div>
  );
}
