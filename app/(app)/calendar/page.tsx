import { connection } from "next/server";

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
import { addDays, eventStart, eventStartDay } from "../../../lib/calendar-dates";
import { getViewRange, type ViewType } from "../../../lib/calendar-ranges";

// This page reads the signed-in session (cookies) directly via `auth()`, so
// it can't be statically prerendered under Cache Components — opt it out of
// the static/instant path, same reasoning as the Settings pages.
export const instant = false;

const VALID_VIEWS: ViewType[] = ["day", "week", "month", "agenda"];

/**
 * Days of slack added to each end of every `listEvents` window.
 *
 * `timeMin`/`timeMax` go to Google as UTC instants (`toISOString()`) derived
 * from local-midnight boundaries, while each view decides an event's day from
 * the event's *own* UTC offset. Those two frames can differ by up to 14
 * hours, so an event legitimately belonging to the first or last rendered day
 * could otherwise fall just outside the requested window and never be
 * fetched. One day of margin on each side is more than the largest possible
 * offset spread.
 *
 * Over-fetching is safe: every view re-buckets the flat event list per
 * rendered day itself (`layoutTimedEvents`/`getAllDayEvents`/
 * `getEventsForDay`), so extra candidates are simply never matched to a cell.
 */
const FETCH_PADDING_DAYS = 1;

/**
 * Month view's padding. `MonthView` renders whole week rows, so its grid also
 * shows up to 6 leading days of the previous month and up to 6 trailing days
 * of the next (e.g. a 31-day month starting on a Saturday leads in with 6
 * outside cells). Those `.mg-cell.outside` days sit outside
 * `getViewRange("month", ...)`, so without padding they could never show an
 * event. 7 = the 6-day worst-case grid overflow + the 1-day timezone margin
 * above, covered in one window.
 */
const MONTH_FETCH_PADDING_DAYS = 7;

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

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string }>;
}) {
  // `parseDate`'s fallback (`new Date()`) is a non-deterministic value with no
  // traceable dependency on `searchParams` when no `date` param is given, so
  // Next's Cache Components analysis flags it as unstable during prerendering
  // unless the render is explicitly marked dynamic first — `connection()` is
  // Next's sanctioned way to do that (see `instant = false` above, which
  // already opts this page out of static rendering for the same underlying
  // reason: it reads cookies via `auth()`).
  await connection();

  const params = await searchParams;
  const view = parseView(params.view);
  const date = parseDate(params.date);

  // app/(app)/layout.tsx has already redirected unauthenticated requests to
  // /sign-in before this page renders, so `session` is guaranteed non-null.
  const session = await auth();

  const reconnectPage = (
    <div className="cal-col">
      <CalendarToolbar view={view} date={date} />
      <ReconnectBanner />
    </div>
  );

  // The session already carries the answer when a refresh has previously
  // failed (`auth.ts`'s `session` callback copies the JWT's
  // `needsGoogleReconnect` onto it), so check that *before* reaching for a
  // token. Without this guard every page load would spend a DB read plus a
  // doomed POST to Google's token endpoint re-learning what the session just
  // told us — the same reason `auth.ts`'s `jwt` callback guards its own
  // refresh with `!token.needsGoogleReconnect`. A revoked refresh token
  // won't start working on its own; only an explicit reconnect (the banner)
  // clears the flag.
  if (session!.user.needsGoogleReconnect) {
    return reconnectPage;
  }

  // `getGoogleAccessToken` remains the chokepoint for the other direction:
  // the session's cached flag says all is well, but the stored token may
  // have expired since, so this refreshes it (or reports reconnect) from
  // live DB state.
  const tokenResult = await getGoogleAccessToken(session!.user.id);

  if (tokenResult.needsGoogleReconnect) {
    return reconnectPage;
  }

  const { accessToken } = tokenResult;
  const range = getViewRange(view, date);

  // Day view's "Up next" rail (UpNext, Task 8) needs events from days after
  // the one being viewed, not just the viewed day itself — so for Day view
  // only, widen the base window to the same 14-day span Agenda view already
  // uses (reusing `getViewRange("agenda", ...)` rather than inventing new
  // date math here). It always starts at the view's own range start, so this
  // is a pure superset for every other view.
  const baseFetchRange = view === "day" ? getViewRange("agenda", date) : range;

  // ...then pad both ends (see FETCH_PADDING_DAYS / MONTH_FETCH_PADDING_DAYS).
  const paddingDays = view === "month" ? MONTH_FETCH_PADDING_DAYS : FETCH_PADDING_DAYS;
  const fetchStart = addDays(baseFetchRange.start, -paddingDays);
  const fetchEnd = addDays(baseFetchRange.end, paddingDays);

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
        listEvents(accessToken, calendar.id, fetchStart.toISOString(), fetchEnd.toISOString()),
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
          // "Up next" means days strictly after the viewed day, decided by
          // each event's own wall-clock day (`eventStartDay`) rather than by
          // re-reading its instant in the server's timezone — otherwise a
          // late-evening event would jump a day under a mismatched `TZ`.
          // Ordering still uses the absolute instant, which is
          // timezone-independent.
          upcoming={allEvents
            .filter((event) => eventStartDay(event).getTime() >= addDays(date, 1).getTime())
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
